/**
 * Punto de entrada en Vercel.
 *
 * En Vercel no hay un proceso que viva y llame a `listen`: cada petición la
 * atiende una función. Por eso no se usa `src/servidor.ts` (que sigue siendo
 * el arranque en local y en cualquier servidor normal) sino la app ya
 * compilada en `dist/`, que Vercel genera con `npm run build`.
 *
 * El pool y las migraciones se preparan una vez por instancia, fuera del
 * handler: Vercel reutiliza la instancia entre peticiones mientras está
 * caliente, así que solo la primera paga la conexión y la comprobación de
 * migraciones. Si la migración falla, todas las peticiones de esa instancia
 * fallan con el mismo error, en vez de servir una API con el esquema a medias.
 */

import { crearApp } from '../dist/aplicacion.js';
import { crearPool, migrar } from '../dist/bd/pool.js';
import { cargarConfig } from '../dist/config.js';

const config = cargarConfig();
const pool = crearPool(config.urlBd);
const migrada = migrar(pool);
// Sin este catch, si la base no responde la promesa se rechaza antes de que
// llegue ninguna petición, Node lo trata como un rechazo no capturado y tumba
// la instancia. El error no se pierde: cada petición lo recibe en el await.
migrada.catch(() => {});
const app = crearApp(pool, config);

export default async function manejador(req, res) {
  await migrada;
  return app(req, res);
}
