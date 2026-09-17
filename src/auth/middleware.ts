/**
 * El middleware de autenticación y el ayudante de validación.
 */

import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { NoAutenticado, NoEncontrado, PeticionInvalida, Prohibido } from '../errores.js';
import { verificarAcceso, type Sujeto } from './tokens.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sujeto?: Sujeto;
    }
  }
}

export function autenticar(secreto: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const cabecera = req.get('authorization');
    if (!cabecera?.startsWith('Bearer ')) {
      next(new NoAutenticado('Falta la cabecera Authorization: Bearer <token>'));
      return;
    }
    try {
      req.sujeto = verificarAcceso(cabecera.slice(7).trim(), secreto);
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function exigirRol(...roles: Array<Sujeto['rol']>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.sujeto) return next(new NoAutenticado());
    if (!roles.includes(req.sujeto.rol)) return next(new Prohibido());
    next();
  };
}

/**
 * Devuelve el sujeto o lanza. Existe para que las rutas no tengan que escribir
 * `req.sujeto!` — esa exclamación es una promesa al compilador que nadie
 * comprueba, y el día que una ruta se monte sin `autenticar` delante, revienta
 * con un TypeError en vez de con un 401 honesto.
 */
export function sujetoDe(req: Request): Sujeto {
  if (!req.sujeto) throw new NoAutenticado();
  return req.sujeto;
}

/** Valida y devuelve el dato tipado, o lanza un 400 con el detalle por campo. */
export function validar<T>(esquema: ZodType<T>, dato: unknown): T {
  const r = esquema.safeParse(dato);
  if (r.success) return r.data;

  const detalles = r.error.issues.map((i) => ({
    campo: i.path.join('.') || '(cuerpo)',
    mensaje: i.message,
  }));
  throw new PeticionInvalida('Los datos enviados no son válidos', detalles);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Comprueba un id de la ruta antes de que llegue a PostgreSQL.
 *
 * Sin esto, `/postulaciones/hola` hace que el driver lance `invalid input
 * syntax for type uuid` y el manejador lo convierta en un 500. No es un fallo
 * del servidor: el cliente mandó una ruta que no existe.
 */
export function idDe(valor: string | undefined, recurso = 'Recurso'): string {
  if (!valor || !UUID.test(valor)) throw new NoEncontrado(recurso);
  return valor;
}
