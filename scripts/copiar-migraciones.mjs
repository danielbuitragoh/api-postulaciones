// `tsc` solo compila TypeScript: los .sql de las migraciones no llegan a
// dist/ y `npm start` fallaba al arrancar buscando dist/bd/migraciones. En
// desarrollo no se notaba porque `npm run dev` ejecuta desde src/.
import { cpSync } from 'node:fs';

cpSync('src/bd/migraciones', 'dist/bd/migraciones', { recursive: true });
