import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /* Un solo proceso: todos los ficheros de prueba comparten la misma base
       de datos y la vacían entre casos. En paralelo se pisarían los datos y
       los fallos aparecerían y desaparecerían sin motivo aparente, que es la
       peor clase de test. */
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 20_000,
  },
});
