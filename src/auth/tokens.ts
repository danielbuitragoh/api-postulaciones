/**
 * Emisión y verificación de tokens.
 *
 * Dos tokens con papeles distintos:
 *
 * - El de ACCESO es un JWT de vida corta (15 min). No se guarda en ninguna
 *   parte: se verifica con la firma, así que cada petición autenticada se
 *   resuelve sin tocar la base de datos.
 * - El de REFRESCO es un valor aleatorio opaco de 32 bytes, guardado HASHEADO
 *   en `sesiones`. Al usarlo se revoca y se emite otro (rotación).
 *
 * Por qué no un solo JWT largo: un JWT no se puede revocar sin una lista negra,
 * que es justo la consulta a base de datos que el JWT pretendía evitar. Con
 * este reparto, cerrar sesión funciona de verdad y el coste por petición sigue
 * siendo cero consultas.
 *
 * Y por qué el refresco se guarda hasheado: si alguien se lleva un volcado de
 * la base, con los tokens en claro entra como cualquier usuario. Un refresh
 * token es una credencial, y las credenciales no se guardan en claro.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { NoAutenticado } from '../errores.js';

export interface Sujeto {
  id: string;
  rol: 'usuario' | 'admin';
}

export function emitirAcceso(sujeto: Sujeto, secreto: string, minutos: number): string {
  return jwt.sign({ rol: sujeto.rol }, secreto, {
    subject: sujeto.id,
    expiresIn: `${minutos}m`,
    algorithm: 'HS256',
  });
}

export function verificarAcceso(token: string, secreto: string): Sujeto {
  try {
    /* `algorithms` explícito. Sin esta lista, una librería que acepte el
       algoritmo declarado EN el propio token admite `alg: none` o un HS256
       firmado con la clave pública: el agujero clásico de JWT. */
    const carga = jwt.verify(token, secreto, { algorithms: ['HS256'] });

    if (typeof carga === 'string' || !carga.sub) throw new Error('carga inesperada');
    const rol = (carga as jwt.JwtPayload)['rol'];
    if (rol !== 'usuario' && rol !== 'admin') throw new Error('rol inesperado');

    return { id: carga.sub, rol };
  } catch {
    throw new NoAutenticado('El token de acceso no es válido o ha caducado');
  }
}

/** Valor opaco para el cliente. No lleva información: es solo una llave. */
export function generarRefresco(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * SHA-256 y no Argon2 a propósito.
 *
 * Argon2 es lento *por diseño* para resistir ataques de diccionario contra
 * contraseñas que las personas eligen mal. Un refresh token son 256 bits
 * aleatorios: no hay diccionario que lo adivine, así que encarecer el cálculo
 * solo encarece el login legítimo.
 */
export function hashearRefresco(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Comparación en tiempo constante: `===` sobre un hash filtra información
 *  por el tiempo que tarda en diferir el primer byte. */
export function iguales(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
