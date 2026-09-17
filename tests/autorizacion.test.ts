/**
 * EL TEST QUE IMPORTA.
 *
 * Todo lo demás de esta API es comodidad. Esto es lo que impide que la
 * candidatura de una persona, con su salario y sus notas, la lea otra.
 *
 * Se prueba recurso por recurso y verbo por verbo porque el fallo típico no es
 * olvidar la autorización en todas partes: es olvidarla en UNA ruta. La que se
 * añadió con prisa, o la anidada (`/postulaciones/:id/eventos`), donde la tabla
 * hija no tiene `usuario_id` y el `where` obvio no basta.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { crearCuenta, crearPostulacion, limpiar, montar, type Contexto, type Cuenta } from './ayudas.js';

let c: Contexto;
let ana: Cuenta;
let luis: Cuenta;
let deAna: string;

beforeAll(async () => { c = await montar(); });
afterAll(async () => { await c?.pool.end(); });

beforeEach(async () => {
  await limpiar(c.pool);
  ana = await crearCuenta(c.app, 'Ana');
  luis = await crearCuenta(c.app, 'Luis');
  deAna = await crearPostulacion(c.app, ana, { puesto: 'Backend junior', notas: 'contacto interno' });
});

describe('una cuenta no alcanza los datos de otra', () => {
  it('no puede leer la postulación ajena', async () => {
    const r = await request(c.app).get(`/postulaciones/${deAna}`).set(luis.cabecera);
    expect(r.status).toBe(404);
    /* Y que el cuerpo no se haya escapado por el camino: un 404 con los datos
       dentro seguiría siendo una fuga. */
    expect(JSON.stringify(r.body)).not.toContain('contacto interno');
  });

  it('no puede modificarla', async () => {
    const r = await request(c.app)
      .patch(`/postulaciones/${deAna}`)
      .set(luis.cabecera)
      .send({ puesto: 'secuestrado' });
    expect(r.status).toBe(404);

    const mia = await request(c.app).get(`/postulaciones/${deAna}`).set(ana.cabecera);
    expect(mia.body.postulacion.puesto).toBe('Backend junior');
  });

  it('no puede borrarla', async () => {
    const r = await request(c.app).delete(`/postulaciones/${deAna}`).set(luis.cabecera);
    expect(r.status).toBe(404);

    const sigue = await request(c.app).get(`/postulaciones/${deAna}`).set(ana.cabecera);
    expect(sigue.status).toBe(200);
  });

  it('no puede escribir en su historial (el recurso anidado)', async () => {
    const r = await request(c.app)
      .post(`/postulaciones/${deAna}/eventos`)
      .set(luis.cabecera)
      .send({ tipo: 'rechazo', nota: 'evento inyectado' });
    expect(r.status).toBe(404);

    const detalle = await request(c.app).get(`/postulaciones/${deAna}`).set(ana.cabecera);
    expect(detalle.body.postulacion.eventos).toHaveLength(1); // solo la 'postulada' inicial
  });

  it('no la ve en su listado ni en su recuento', async () => {
    const r = await request(c.app).get('/postulaciones').set(luis.cabecera);
    expect(r.status).toBe(200);
    expect(r.body.postulaciones).toHaveLength(0);
    /* El total se cuenta con otra consulta distinta a la del listado: es fácil
       filtrar bien una y olvidar la otra. */
    expect(r.body.total).toBe(0);
  });

  it('no la cuenta en sus estadísticas', async () => {
    const r = await request(c.app).get('/estadisticas').set(luis.cabecera);
    expect(r.body.total).toBe(0);
    expect(r.body.embudo.postuladas).toBe(0);
  });

  it('no puede colgar una postulación de la empresa de otra cuenta', async () => {
    const empresas = await request(c.app).get('/empresas').set(ana.cabecera);
    const idEmpresaDeAna = empresas.body.empresas[0].id;

    const r = await request(c.app)
      .post('/postulaciones')
      .set(luis.cabecera)
      .send({ empresa_id: idEmpresaDeAna, puesto: 'colado' });

    expect(r.status).toBe(404);
  });

  it('no puede borrar la empresa de otra cuenta', async () => {
    const empresas = await request(c.app).get('/empresas').set(ana.cabecera);
    const r = await request(c.app)
      .delete(`/empresas/${empresas.body.empresas[0].id}`)
      .set(luis.cabecera);
    expect(r.status).toBe(404);
  });
});

describe('sin credenciales no se entra', () => {
  it.each([
    ['get', '/postulaciones'],
    ['get', '/empresas'],
    ['get', '/estadisticas'],
  ] as const)('%s %s responde 401', async (verbo, ruta) => {
    const r = await request(c.app)[verbo](ruta);
    expect(r.status).toBe(401);
  });

  it('rechaza un token firmado con otro secreto', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const falso = jwt.sign({ rol: 'admin' }, 'otro-secreto-cualquiera-de-32-caracteres', {
      subject: ana.id, expiresIn: '1h',
    });
    const r = await request(c.app).get('/postulaciones').set({ Authorization: `Bearer ${falso}` });
    expect(r.status).toBe(401);
  });

  it('rechaza un token sin firma (alg: none)', async () => {
    /* El ataque clásico contra JWT: se cambia la cabecera a `alg: none`, se
       quita la firma y una librería mal configurada lo acepta. Aquí la lista
       de algoritmos es explícita, así que no. */
    const cabecera = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const carga = Buffer.from(JSON.stringify({ sub: ana.id, rol: 'admin' })).toString('base64url');
    const r = await request(c.app)
      .get('/postulaciones')
      .set({ Authorization: `Bearer ${cabecera}.${carga}.` });
    expect(r.status).toBe(401);
  });

  it('un id que no es UUID da 404, no 500', async () => {
    const r = await request(c.app).get('/postulaciones/no-es-un-uuid').set(ana.cabecera);
    expect(r.status).toBe(404);
  });
});
