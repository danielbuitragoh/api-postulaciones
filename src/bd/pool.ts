/**
 * Pool de conexiones y el runner de migraciones.
 *
 * Las migraciones se aplican en una transacción y se registran en
 * `migraciones_aplicadas`, así que correr `migrar` dos veces no rompe nada:
 * la segunda vez no hay nada que aplicar. Sin ese registro, un despliegue que
 * reinicia el proceso reaplicaría el esquema y fallaría en el primer
 * `create table`.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
export type Pool = pg.Pool;

/* Los DECIMAL/NUMERIC de PostgreSQL llegan como string por defecto, porque no
   caben siempre en un double. Aquí no se usan para dinero (los salarios son
   integer), así que no se toca ese parser: cambiarlo globalmente es la clase
   de atajo que rompe otra cosa meses después. */

export function crearPool(urlBd: string): Pool {
  return new Pool({
    connectionString: urlBd,

    /* Zona horaria fijada a UTC en la conexión, no heredada del sistema.
       `postulado_en` es un `date` y las estadísticas lo convierten a
       timestamptz para restarlo de la fecha de respuesta: esa conversión usa
       la zona de la SESIÓN. Sin fijarla, la misma consulta da 10 días en un
       servidor y 9,96 en otro, y el fallo aparecería solo en producción. */
    options: '-c timezone=UTC',

    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

const AQUI = dirname(fileURLToPath(import.meta.url));

export async function migrar(pool: Pool, dirMigraciones = join(AQUI, 'migraciones')): Promise<string[]> {
  await pool.query(`
    create table if not exists migraciones_aplicadas (
      nombre      text primary key,
      aplicada_en timestamptz not null default now()
    )
  `);

  const archivos = readdirSync(dirMigraciones).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await pool.query<{ nombre: string }>('select nombre from migraciones_aplicadas');
  const ya = new Set(rows.map((r) => r.nombre));

  const aplicadas: string[] = [];

  for (const archivo of archivos) {
    if (ya.has(archivo)) continue;

    const sql = readFileSync(join(dirMigraciones, archivo), 'utf8');
    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      await cliente.query(sql);
      await cliente.query('insert into migraciones_aplicadas (nombre) values ($1)', [archivo]);
      await cliente.query('commit');
      aplicadas.push(archivo);
    } catch (e) {
      await cliente.query('rollback');
      throw new Error(`La migración ${archivo} falló: ${(e as Error).message}`, { cause: e });
    } finally {
      cliente.release();
    }
  }

  return aplicadas;
}
