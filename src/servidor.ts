/** Arranque del proceso. */

import { cargarConfig } from './config.js';
import { crearPool, migrar } from './bd/pool.js';
import { crearApp } from './aplicacion.js';

const config = cargarConfig();
const pool = crearPool(config.urlBd);

await migrar(pool);

const servidor = crearApp(pool, config).listen(config.puerto, () => {
  console.log(`API escuchando en el puerto ${config.puerto} (${config.entorno})`);
});

/* Cierre ordenado: SIGTERM es lo que manda Docker, Render o systemd al
   desplegar. Sin esto, las peticiones en vuelo se cortan a medias y las
   conexiones del pool quedan abiertas del lado de PostgreSQL. */
for (const señal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(señal, () => {
    console.log(`${señal} recibida, cerrando…`);
    servidor.close(() => { void pool.end().then(() => process.exit(0)); });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
