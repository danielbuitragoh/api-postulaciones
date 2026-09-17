import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { crearCuenta, limpiar, montar, type Contexto } from './ayudas.js';

let c: Contexto;
beforeAll(async () => { c = await montar(); });
afterAll(async () => { await c?.pool.end(); });
beforeEach(async () => { await limpiar(c.pool); });

const CLAVE = 'contraseña-larga-de-prueba';

describe('registro', () => {
  it('crea la cuenta y devuelve ya la sesión abierta', async () => {
    const r = await request(c.app)
      .post('/auth/registro')
      .send({ email: 'ana@ejemplo.test', contrasena: CLAVE, nombre: 'Ana' });

    expect(r.status).toBe(201);
    expect(r.body.acceso).toBeTypeOf('string');
    expect(r.body.refresco).toBeTypeOf('string');
    /* Registrarse y tener que hacer login acto seguido es un paso de más que
       no aporta nada: las credenciales acaban de validarse. */
  });

  it('nunca devuelve el hash de la contraseña', async () => {
    const r = await request(c.app)
      .post('/auth/registro')
      .send({ email: 'ana@ejemplo.test', contrasena: CLAVE, nombre: 'Ana' });

    const cuerpo = JSON.stringify(r.body);
    expect(cuerpo).not.toContain('argon2');
    expect(cuerpo).not.toContain(CLAVE);
  });

  it('trata el correo como insensible a mayúsculas', async () => {
    await request(c.app).post('/auth/registro').send({ email: 'Ana@Ejemplo.Test', contrasena: CLAVE, nombre: 'Ana' });
    const repe = await request(c.app).post('/auth/registro').send({ email: 'ana@ejemplo.test', contrasena: CLAVE, nombre: 'Otra' });

    expect(repe.status).toBe(409);

    /* Y se puede entrar escribiéndolo de cualquier forma: es el caso real de
       quien se registró desde el móvil con la primera letra en mayúscula. */
    const entra = await request(c.app).post('/auth/acceso').send({ email: 'ANA@ejemplo.test', contrasena: CLAVE });
    expect(entra.status).toBe(200);
  });

  it('rechaza contraseñas cortas con un mensaje por campo', async () => {
    const r = await request(c.app)
      .post('/auth/registro')
      .send({ email: 'ana@ejemplo.test', contrasena: 'corta', nombre: 'Ana' });

    expect(r.status).toBe(400);
    expect(r.body.error.detalles).toContainEqual(
      expect.objectContaining({ campo: 'contrasena' }),
    );
  });
});

describe('acceso', () => {
  it('no distingue entre correo inexistente y contraseña incorrecta', async () => {
    await crearCuenta(c.app);
    const cuenta = await request(c.app).post('/auth/registro')
      .send({ email: 'real@ejemplo.test', contrasena: CLAVE, nombre: 'Real' });
    expect(cuenta.status).toBe(201);

    const inexistente = await request(c.app).post('/auth/acceso')
      .send({ email: 'nadie@ejemplo.test', contrasena: CLAVE });
    const malaClave = await request(c.app).post('/auth/acceso')
      .send({ email: 'real@ejemplo.test', contrasena: 'otra-contraseña-larga' });

    expect(inexistente.status).toBe(401);
    expect(malaClave.status).toBe(401);
    /* Idéntico cuerpo: si difiriera, el formulario de login se convierte en un
       comprobador de qué correos tienen cuenta. */
    expect(inexistente.body).toEqual(malaClave.body);
  });
});

describe('refresco', () => {
  it('rota el token: el usado deja de servir', async () => {
    const a = await crearCuenta(c.app);

    const primero = await request(c.app).post('/auth/refresco').send({ refresco: a.refresco });
    expect(primero.status).toBe(200);
    expect(primero.body.refresco).not.toBe(a.refresco);

    /* Reutilizar el viejo no funciona. Sin rotación, un refresh token robado
       vale para siempre y nadie se entera. */
    const reintento = await request(c.app).post('/auth/refresco').send({ refresco: a.refresco });
    expect(reintento.status).toBe(401);
  });

  it('el token de refresco no se guarda en claro en la base', async () => {
    const a = await crearCuenta(c.app);
    const { rows } = await c.pool.query<{ hash_refresh: string }>('select hash_refresh from sesiones');

    expect(rows).toHaveLength(1);
    expect(rows[0]!.hash_refresh).not.toBe(a.refresco);
    expect(rows[0]!.hash_refresh).toMatch(/^[0-9a-f]{64}$/); // sha-256 en hexadecimal
  });

  it('salir revoca todas las sesiones, no solo la actual', async () => {
    const a = await crearCuenta(c.app);
    const otra = await request(c.app).post('/auth/acceso')
      .send({ email: a.email, contrasena: CLAVE });

    const salida = await request(c.app).post('/auth/salir').set(a.cabecera);
    expect(salida.status).toBe(204);

    /* Quien pulsa "salir" porque cree que le han entrado en la cuenta espera
       justo esto: que la otra sesión también muera. */
    const r = await request(c.app).post('/auth/refresco').send({ refresco: otra.body.refresco });
    expect(r.status).toBe(401);
  });
});
