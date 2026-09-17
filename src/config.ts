/**
 * Configuración leída del entorno, validada al arrancar.
 *
 * Se valida aquí y no donde se usa por una razón concreta: si falta
 * `JWT_SECRETO`, el fallo tiene que ocurrir al arrancar el proceso, no en la
 * primera petición de login de un usuario real a las tres de la mañana.
 * Un arranque que falla lo ve el despliegue; una petición que falla la ve el
 * usuario.
 */

import { z } from 'zod';

const Entorno = z.object({
  NODE_ENV: z.enum(['desarrollo', 'prueba', 'produccion']).default('desarrollo'),
  PUERTO: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'hace falta una cadena de conexión a PostgreSQL'),

  /* Mínimo 32 caracteres: un secreto de firma corto es un secreto que se
     puede romper por fuerza bruta, y entonces cualquiera se emite tokens. */
  JWT_SECRETO: z.string().min(32, 'el secreto de firma debe tener al menos 32 caracteres'),

  MINUTOS_ACCESO: z.coerce.number().int().positive().default(15),
  DIAS_REFRESCO: z.coerce.number().int().positive().default(30),

  /* Lista blanca de orígenes. Vacía = mismo origen solamente. */
  ORIGENES: z.string().default(''),
});

export type Config = {
  entorno: 'desarrollo' | 'prueba' | 'produccion';
  puerto: number;
  urlBd: string;
  jwtSecreto: string;
  minutosAcceso: number;
  diasRefresco: number;
  origenes: string[];
};

export function cargarConfig(bruto: NodeJS.ProcessEnv = process.env): Config {
  const r = Entorno.safeParse(bruto);

  if (!r.success) {
    const detalle = r.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuración inválida:\n${detalle}`);
  }

  const v = r.data;
  return {
    entorno: v.NODE_ENV,
    puerto: v.PUERTO,
    urlBd: v.DATABASE_URL,
    jwtSecreto: v.JWT_SECRETO,
    minutosAcceso: v.MINUTOS_ACCESO,
    diasRefresco: v.DIAS_REFRESCO,
    origenes: v.ORIGENES.split(',').map((s) => s.trim()).filter(Boolean),
  };
}
