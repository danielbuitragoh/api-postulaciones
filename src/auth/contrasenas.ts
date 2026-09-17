/**
 * Hash de contraseñas con Argon2id.
 *
 * Argon2id y no bcrypt: bcrypt sigue siendo aceptable, pero está limitado a 72
 * bytes de entrada (silenciosamente trunca el resto) y solo se puede encarecer
 * en tiempo de CPU. Argon2id además se puede encarecer en MEMORIA, que es lo
 * que arruina a un atacante con GPUs: mil núcleos que comparten 4 GB no pueden
 * probar mil contraseñas a la vez si cada intento exige 64 MB.
 *
 * Los parámetros siguen la recomendación de OWASP para Argon2id: 19 MiB de
 * memoria, 2 iteraciones, paralelismo 1.
 */

import argon2 from 'argon2';

const OPCIONES = {
  type: argon2.argon2id,
  memoryCost: 19_456, // KiB = 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashear(contrasena: string): Promise<string> {
  return argon2.hash(contrasena, OPCIONES);
}

export async function verificar(hash: string, contrasena: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, contrasena);
  } catch {
    /* Un hash corrupto en la base no debe tumbar el login con un 500: es un
       fallo de verificación, y como tal se trata. */
    return false;
  }
}
