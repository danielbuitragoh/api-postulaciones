/**
 * Errores de dominio con su código HTTP.
 *
 * El manejador central los traduce a respuestas. La ventaja de tipar el error
 * en vez de llamar a `res.status(...)` en cada ruta es que un servicio que no
 * conoce Express puede lanzar `new NoEncontrado(...)` y la capa HTTP decide
 * cómo se ve eso por el cable.
 */

export class ErrorApi extends Error {
  constructor(
    override readonly message: string,
    readonly estado: number,
    readonly codigo: string,
    readonly detalles?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class PeticionInvalida extends ErrorApi {
  constructor(mensaje: string, detalles?: unknown) {
    super(mensaje, 400, 'peticion_invalida', detalles);
  }
}

export class NoAutenticado extends ErrorApi {
  constructor(mensaje = 'Credenciales ausentes o inválidas') {
    super(mensaje, 401, 'no_autenticado');
  }
}

export class Prohibido extends ErrorApi {
  constructor(mensaje = 'No tienes permiso para esta operación') {
    super(mensaje, 403, 'prohibido');
  }
}

/**
 * Se usa TAMBIÉN cuando el recurso existe pero es de otro usuario.
 *
 * Responder 403 en ese caso sería filtrar información: confirmaría que ese id
 * existe. Con 404 el atacante no distingue "no existe" de "no es tuyo", que es
 * exactamente lo que debe ver.
 */
export class NoEncontrado extends ErrorApi {
  constructor(recurso = 'Recurso') {
    super(`${recurso} no encontrado`, 404, 'no_encontrado');
  }
}

export class Conflicto extends ErrorApi {
  constructor(mensaje: string) {
    super(mensaje, 409, 'conflicto');
  }
}
