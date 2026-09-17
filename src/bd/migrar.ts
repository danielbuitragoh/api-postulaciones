/** Entrada de `npm run migrar`. */

import { cargarConfig } from '../config.js';
import { crearPool, migrar } from './pool.js';

const config = cargarConfig();
const pool = crearPool(config.urlBd);

try {
  const aplicadas = await migrar(pool);
  console.log(
    aplicadas.length === 0
      ? 'Sin migraciones pendientes.'
      : `Aplicadas: ${aplicadas.join(', ')}`,
  );
} finally {
  await pool.end();
}
