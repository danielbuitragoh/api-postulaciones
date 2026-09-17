/**
 * Utilidades de prueba.
 *
 * Los tests corren contra PostgreSQL DE VERDAD, no contra un doble.
 *
 * No es celo: casi todo lo que protege esta API vive en la base de datos —
 * el índice único de correos en minúsculas, el `check` del salario, el
 * `on delete restrict`, el `distinct on` de la vista, la condición
 * `usuario_id = $1` de cada consulta. Un mock del pool devuelve lo que yo le
 * diga, así que pasaría igual de verde con el filtro de usuario borrado. El
 * test que importa aquí — que un usuario no puede leer lo de otro — solo
 * significa algo si lo responde PostgreSQL.
 */

import type { Express } from 'express';
import request from 'supertest';
import { crearApp } from '../src/aplicacion.js';
import { crearPool, migrar, type Pool } from '../src/bd/pool.js';
import { cargarConfig, type Config } from '../src/config.js';

export interface Contexto {
  app: Express;
  pool: Pool;
  config: Config;
}

export async function montar(): Promise<Contexto> {
  const config = cargarConfig({
    NODE_ENV: 'prueba',
    DATABASE_URL: process.env['DATABASE_URL_PRUEBA'] ?? process.env['DATABASE_URL'],
    JWT_SECRETO: 'secreto-de-pruebas-con-longitud-mas-que-suficiente',
    PUERTO: '3000',
  } as NodeJS.ProcessEnv);

  const pool = crearPool(config.urlBd);
  await migrar(pool);
  return { app: crearApp(pool, config), pool, config };
}

/** Vacía las tablas entre casos. `truncate ... cascade` y no `delete` porque
 *  reinicia de golpe y no depende del orden de las claves foráneas. */
export async function limpiar(pool: Pool): Promise<void> {
  await pool.query('truncate usuarios, empresas, postulaciones, eventos, sesiones cascade');
}

export interface Cuenta {
  id: string;
  email: string;
  acceso: string;
  refresco: string;
  cabecera: { Authorization: string };
}

let contador = 0;

export async function crearCuenta(app: Express, nombre = 'Prueba'): Promise<Cuenta> {
  const email = `persona${++contador}.${Date.now()}@ejemplo.test`;
  const r = await request(app)
    .post('/auth/registro')
    .send({ email, contrasena: 'contraseña-larga-de-prueba', nombre });

  if (r.status !== 201) throw new Error(`no se pudo crear la cuenta: ${r.status} ${JSON.stringify(r.body)}`);

  return {
    id: r.body.usuario.id,
    email,
    acceso: r.body.acceso,
    refresco: r.body.refresco,
    cabecera: { Authorization: `Bearer ${r.body.acceso}` },
  };
}

export async function crearPostulacion(
  app: Express,
  cuenta: Cuenta,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const r = await request(app)
    .post('/postulaciones')
    .set(cuenta.cabecera)
    .send({ empresa: { nombre: 'Acme' }, puesto: 'Desarrollador junior', ...extra });

  if (r.status !== 201) throw new Error(`no se pudo crear la postulación: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.postulacion.id;
}
