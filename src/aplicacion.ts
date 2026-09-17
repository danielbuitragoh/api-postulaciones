/**
 * Construcción de la aplicación Express.
 *
 * Va separada de `servidor.ts` (que es quien llama a `listen`) porque así los
 * tests montan la app entera y la atacan con peticiones HTTP reales sin abrir
 * un puerto. Probar la app y no las funciones sueltas es lo que hace que un
 * test detecte un middleware mal ordenado, que es donde suelen estar los fallos
 * de autorización.
 */

import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import type { Pool } from './bd/pool.js';
import type { Config } from './config.js';
import { ErrorApi, NoEncontrado } from './errores.js';
import { autenticar } from './auth/middleware.js';
import { rutasAuth } from './rutas/auth.js';
import { rutasEmpresas } from './rutas/empresas.js';
import { rutasEstadisticas } from './rutas/estadisticas.js';
import { rutasPostulaciones } from './rutas/postulaciones.js';

export function crearApp(pool: Pool, config: Config): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // detrás de un proxy: si no, todos los clientes comparten IP

  app.use(helmet());
  app.use(
    cors({
      /* Lista blanca explícita. `origin: true` refleja el Origin que venga y
         con `credentials` deja que cualquier web haga peticiones autenticadas
         en nombre del usuario. Aquí los tokens van en cabecera y no en cookie,
         pero la lista blanca no cuesta nada y cierra la puerta igual. */
      origin: config.origenes.length ? config.origenes : false,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    }),
  );

  /* Límite de tamaño del cuerpo. Sin él, un POST de 500 MB de JSON es una
     denegación de servicio de una línea. */
  app.use(express.json({ limit: '64kb' }));

  app.get('/salud', (_req, res) => { res.json({ ok: true, entorno: config.entorno }); });

  /* Límite por IP más estricto en autenticación que en el resto: el login es
     donde se prueban contraseñas a lo bruto. Se desactiva en los tests porque
     si no, la propia batería de pruebas acaba bloqueada. */
  const limitar = (max: number) =>
    config.entorno === 'prueba'
      ? (_req: Request, _res: Response, next: NextFunction) => next()
      : rateLimit({ windowMs: 15 * 60_000, limit: max, standardHeaders: 'draft-7', legacyHeaders: false });

  app.use('/auth', limitar(20), rutasAuth(pool, config));

  const protegido = autenticar(config.jwtSecreto);
  app.use('/empresas', limitar(300), protegido, rutasEmpresas(pool));
  app.use('/postulaciones', limitar(300), protegido, rutasPostulaciones(pool));
  app.use('/estadisticas', limitar(300), protegido, rutasEstadisticas(pool));

  app.use((_req, _res, next) => { next(new NoEncontrado('Ruta')); });

  /* Manejador de errores. Express 5 encamina aquí también las promesas
     rechazadas de los handlers `async`, que en Express 4 había que envolver a
     mano en un try/catch o se quedaban colgadas para siempre. */
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ErrorApi) {
      res.status(err.estado).json({
        error: { codigo: err.codigo, mensaje: err.message, ...(err.detalles ? { detalles: err.detalles } : {}) },
      });
      return;
    }

    /* Lo inesperado se registra entero en el servidor y se le cuenta al
       cliente lo justo. Un stack trace en la respuesta le regala al atacante
       las rutas del proyecto, las versiones de las librerías y a veces la
       consulta SQL con nombres de columnas. */
    if (config.entorno !== 'prueba') console.error('[error no controlado]', err);
    res.status(500).json({ error: { codigo: 'error_interno', mensaje: 'Error interno del servidor' } });
  });

  return app;
}
