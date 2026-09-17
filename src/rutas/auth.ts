/**
 * Registro, acceso, refresco y cierre de sesión.
 */

import { Router } from 'express';
import type { Pool } from '../bd/pool.js';
import type { Config } from '../config.js';
import { Conflicto, NoAutenticado } from '../errores.js';
import { hashear, verificar } from '../auth/contrasenas.js';
import {
  emitirAcceso, generarRefresco, hashearRefresco, type Sujeto,
} from '../auth/tokens.js';
import { autenticar, sujetoDe, validar } from '../auth/middleware.js';
import { Acceso, Refresco, Registro } from '../esquemas.js';

interface FilaUsuario {
  id: string;
  email: string;
  hash: string;
  nombre: string;
  rol: 'usuario' | 'admin';
}

export function rutasAuth(pool: Pool, config: Config): Router {
  const r = Router();

  async function abrirSesion(u: Sujeto): Promise<{ acceso: string; refresco: string; caduca_en: number }> {
    const refresco = generarRefresco();
    const expira = new Date(Date.now() + config.diasRefresco * 86_400_000);

    await pool.query(
      'insert into sesiones (usuario_id, hash_refresh, expira_en) values ($1, $2, $3)',
      [u.id, hashearRefresco(refresco), expira],
    );

    return {
      acceso: emitirAcceso(u, config.jwtSecreto, config.minutosAcceso),
      refresco,
      caduca_en: config.minutosAcceso * 60,
    };
  }

  r.post('/registro', async (req, res) => {
    const datos = validar(Registro, req.body);

    const existe = await pool.query('select 1 from usuarios where lower(email) = $1', [datos.email]);
    if (existe.rowCount) {
      /* Aquí sí se admite que el correo ya existe. Es una fuga de información
         real, pero inevitable en un formulario de registro: si respondiera
         "listo" sin crear nada, el usuario legítimo que olvidó tener cuenta
         se quedaría atrapado sin saber por qué no puede entrar. */
      throw new Conflicto('Ya existe una cuenta con ese correo');
    }

    const { rows } = await pool.query<FilaUsuario>(
      `insert into usuarios (email, hash, nombre)
       values ($1, $2, $3)
       returning id, email, nombre, rol`,
      [datos.email, await hashear(datos.contrasena), datos.nombre],
    );

    const u = rows[0]!;
    res.status(201).json({
      usuario: { id: u.id, email: u.email, nombre: u.nombre, rol: u.rol },
      ...(await abrirSesion({ id: u.id, rol: u.rol })),
    });
  });

  r.post('/acceso', async (req, res) => {
    const datos = validar(Acceso, req.body);

    const { rows } = await pool.query<FilaUsuario>(
      'select id, email, hash, nombre, rol from usuarios where lower(email) = $1',
      [datos.email],
    );
    const u = rows[0];

    /* Mismo mensaje para "no existe" y "clave incorrecta": distinguirlos
       convierte el login en un comprobador de correos registrados, que es
       justo lo que busca quien prepara un ataque de relleno de credenciales. */
    const malas = new NoAutenticado('Correo o contraseña incorrectos');

    if (!u) {
      /* Se verifica igualmente contra un hash de descarte. Sin esto, la
         respuesta para un correo inexistente vuelve en 2 ms y la de uno real
         en 60 ms: el propio TIEMPO responde la pregunta que el mensaje se
         negaba a responder. */
      await verificar(HASH_SEÑUELO, datos.contrasena);
      throw malas;
    }

    if (!(await verificar(u.hash, datos.contrasena))) throw malas;

    res.json({
      usuario: { id: u.id, email: u.email, nombre: u.nombre, rol: u.rol },
      ...(await abrirSesion({ id: u.id, rol: u.rol })),
    });
  });

  r.post('/refresco', async (req, res) => {
    const { refresco } = validar(Refresco, req.body);
    const hash = hashearRefresco(refresco);

    /* Se revoca y se comprueba en un solo UPDATE condicional. Hacerlo en dos
       pasos (select, luego update) deja una ventana en la que dos peticiones
       simultáneas con el mismo token pasan las dos. */
    const { rows } = await pool.query<{ usuario_id: string; rol: 'usuario' | 'admin' }>(
      `update sesiones s
          set revocada_en = now()
        from usuarios u
       where s.hash_refresh = $1
         and s.revocada_en is null
         and s.expira_en > now()
         and u.id = s.usuario_id
       returning s.usuario_id, u.rol`,
      [hash],
    );

    const fila = rows[0];
    if (!fila) throw new NoAutenticado('El token de refresco no es válido, ya se usó o caducó');

    res.json(await abrirSesion({ id: fila.usuario_id, rol: fila.rol }));
  });

  r.post('/salir', autenticar(config.jwtSecreto), async (req, res) => {
    const yo = sujetoDe(req);
    /* Se revocan TODAS las sesiones del usuario, no solo la del token enviado:
       "cerrar sesión en todas partes" es lo que espera quien pulsa salir
       porque cree que alguien le entró en la cuenta. */
    await pool.query(
      'update sesiones set revocada_en = now() where usuario_id = $1 and revocada_en is null',
      [yo.id],
    );
    res.status(204).end();
  });

  r.get('/yo', autenticar(config.jwtSecreto), async (req, res) => {
    const yo = sujetoDe(req);
    const { rows } = await pool.query(
      'select id, email, nombre, rol, creado_en from usuarios where id = $1',
      [yo.id],
    );
    res.json({ usuario: rows[0] });
  });

  return r;
}

/* Hash real de una contraseña que nadie usa, precalculado con los mismos
   parámetros que los de verdad. Solo sirve para gastar el mismo tiempo. */
const HASH_SEÑUELO =
  '$argon2id$v=19$m=19456,p=1,t=2$GI0Swoc9G6dxKAFDkXQ84g$uexdb4fEfI5ejlFZBsL+Zm9XBW0myPaLITIvQF2QSrI';
