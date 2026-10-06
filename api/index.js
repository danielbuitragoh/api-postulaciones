/**
 * Punto de entrada en Vercel.
 *
 * En Vercel no hay un proceso que viva y llame a `listen`: cada petición la
 * atiende una función. Por eso no se usa `src/servidor.ts` (que sigue siendo
 * el arranque en local y en cualquier servidor normal) sino la app ya
 * compilada en `dist/`, que Vercel genera con `npm run build`.
 *
 * El pool se crea una vez por instancia, fuera del handler: Vercel reutiliza
 * la instancia entre peticiones mientras está caliente. Las migraciones
 * también se aplican una sola vez por instancia, pero si fallan NO se guarda
 * el fallo: la siguiente petición lo vuelve a intentar. La primera versión
 * guardaba la promesa rechazada y una base que tardó en despertar (Neon se
 * suspende tras unos minutos sin uso) dejaba la instancia respondiendo error
 * a todo, aunque la base ya estuviera arriba.
 */

import { crearApp } from '../dist/aplicacion.js';
import { crearPool, migrar } from '../dist/bd/pool.js';
import { cargarConfig } from '../dist/config.js';

const config = cargarConfig();
const pool = crearPool(config.urlBd);
const app = crearApp(pool, config);

let migrada = null;

function asegurarMigrada() {
  migrada ??= migrar(pool).catch((error) => {
    migrada = null;
    throw error;
  });
  return migrada;
}

export default async function manejador(req, res) {
  try {
    await asegurarMigrada();
  } catch (error) {
    // Sin esto la excepción escapa del handler y Vercel responde con su
    // página genérica de FUNCTION_INVOCATION_FAILED en vez de JSON.
    console.error('[arranque] la base de datos no respondió:', error);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Retry-After', '5');
    res.end(JSON.stringify({ error: { codigo: 'bd_no_disponible', mensaje: 'La base de datos no responde, inténtalo en unos segundos' } }));
    return;
  }
  return app(req, res);
}
