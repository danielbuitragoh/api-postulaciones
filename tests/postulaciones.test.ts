import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { crearCuenta, crearPostulacion, limpiar, montar, type Contexto, type Cuenta } from './ayudas.js';

let c: Contexto;
let yo: Cuenta;

beforeAll(async () => { c = await montar(); });
afterAll(async () => { await c?.pool.end(); });
beforeEach(async () => { await limpiar(c.pool); yo = await crearCuenta(c.app); });

describe('alta', () => {
  it('crea empresa y postulación en una sola petición', async () => {
    const r = await request(c.app).post('/postulaciones').set(yo.cabecera).send({
      empresa: { nombre: 'Tuenti', sector: 'Telecomunicaciones' },
      puesto: 'Backend junior',
      modalidad: 'hibrido',
      salario_min: 24000,
      salario_max: 30000,
    });

    expect(r.status).toBe(201);
    expect(r.body.postulacion.empresa).toBe('Tuenti');
    expect(r.body.postulacion.estado).toBe('postulada');
  });

  it('reutiliza la empresa si ya existe, sin duplicarla', async () => {
    await crearPostulacion(c.app, yo, { empresa: { nombre: 'Acme' } });
    await crearPostulacion(c.app, yo, { empresa: { nombre: 'ACME' }, puesto: 'Otro puesto' });

    const empresas = await request(c.app).get('/empresas').set(yo.cabecera);
    expect(empresas.body.empresas).toHaveLength(1);
    expect(empresas.body.empresas[0].postulaciones).toBe(2);
  });

  it('rechaza un rango de salario invertido', async () => {
    const r = await request(c.app).post('/postulaciones').set(yo.cabecera).send({
      empresa: { nombre: 'Acme' }, puesto: 'X', salario_min: 40000, salario_max: 20000,
    });
    expect(r.status).toBe(400);
  });

  it('exige empresa_id o empresa, no ambos ni ninguno', async () => {
    const ninguno = await request(c.app).post('/postulaciones').set(yo.cabecera).send({ puesto: 'X' });
    const ambos = await request(c.app).post('/postulaciones').set(yo.cabecera).send({
      puesto: 'X', empresa_id: '00000000-0000-4000-8000-000000000000', empresa: { nombre: 'Acme' },
    });
    expect(ninguno.status).toBe(400);
    expect(ambos.status).toBe(400);
  });

  it('no deja empresa huérfana si la postulación falla a mitad', async () => {
    /* Hace falta un fallo que ocurra DENTRO de la transacción, después de
       insertar la empresa. Una fecha como el 31 de febrero pasa el formato
       AAAA-MM-DD del esquema y la rechaza PostgreSQL al convertirla a `date`:
       exactamente el escenario que la transacción existe para cubrir. */
    const r = await request(c.app).post('/postulaciones').set(yo.cabecera).send({
      empresa: { nombre: 'Fantasma' },
      puesto: 'X',
      postulado_en: '2026-02-31',
    });

    expect(r.status).toBe(500); // fallo no previsto, pero controlado

    /* Lo que importa: la empresa no se quedó creada. Sin `begin`/`rollback`,
       el usuario acabaría con una empresa "Fantasma" en su lista que nunca
       pidió y que no puede explicar. */
    const empresas = await request(c.app).get('/empresas').set(yo.cabecera);
    expect(empresas.body.empresas).toHaveLength(0);
  });
});

describe('edición', () => {
  it('cambia solo los campos enviados', async () => {
    const id = await crearPostulacion(c.app, yo, { puesto: 'Junior', ubicacion: 'Madrid' });

    const r = await request(c.app).patch(`/postulaciones/${id}`).set(yo.cabecera).send({ puesto: 'Junior backend' });

    expect(r.status).toBe(200);
    expect(r.body.postulacion.puesto).toBe('Junior backend');
    expect(r.body.postulacion.ubicacion).toBe('Madrid'); // no se envió: no se pisa
  });

  it('distingue "no enviado" de "enviado como null"', async () => {
    const id = await crearPostulacion(c.app, yo, { ubicacion: 'Madrid', notas: 'referido' });

    const r = await request(c.app).patch(`/postulaciones/${id}`).set(yo.cabecera).send({ notas: null });

    /* Es la diferencia entre "no toques las notas" y "borra las notas". Un
       PATCH que no la respeta obliga a reenviar el objeto entero para cambiar
       un campo, y entonces dos pestañas abiertas se pisan los cambios. */
    expect(r.body.postulacion.notas).toBeNull();
    expect(r.body.postulacion.ubicacion).toBe('Madrid');
  });

  it('ignora campos que no son editables', async () => {
    const otra = await crearCuenta(c.app);
    const id = await crearPostulacion(c.app, yo);

    const r = await request(c.app).patch(`/postulaciones/${id}`).set(yo.cabecera)
      .send({ puesto: 'Nuevo', usuario_id: otra.id, id: '00000000-0000-4000-8000-000000000000' });

    expect(r.status).toBe(200);
    /* Sigue siendo mía: la lista blanca de columnas impidió el regalo. */
    const mia = await request(c.app).get(`/postulaciones/${id}`).set(yo.cabecera);
    expect(mia.status).toBe(200);
  });

  it('un PATCH vacío es un 400, no un 200 mentiroso', async () => {
    const id = await crearPostulacion(c.app, yo);
    const r = await request(c.app).patch(`/postulaciones/${id}`).set(yo.cabecera).send({});
    expect(r.status).toBe(400);
  });
});

describe('historial y estado', () => {
  it('el estado es el último evento, no el primero', async () => {
    const id = await crearPostulacion(c.app, yo);

    await request(c.app).post(`/postulaciones/${id}/eventos`).set(yo.cabecera).send({ tipo: 'respuesta' });
    await request(c.app).post(`/postulaciones/${id}/eventos`).set(yo.cabecera).send({ tipo: 'entrevista' });

    const r = await request(c.app).get(`/postulaciones/${id}`).set(yo.cabecera);
    expect(r.body.postulacion.estado).toBe('entrevista');
    expect(r.body.postulacion.eventos).toHaveLength(3);
  });

  it('un evento fechado en el pasado no altera el estado actual', async () => {
    const id = await crearPostulacion(c.app, yo);
    await request(c.app).post(`/postulaciones/${id}/eventos`).set(yo.cabecera).send({ tipo: 'entrevista' });

    /* Registrar el jueves la llamada del martes es el caso normal de uso.
       La vista ordena por `ocurrido_en`, no por orden de inserción, así que
       este evento antiguo no puede convertirse en el estado actual. */
    await request(c.app).post(`/postulaciones/${id}/eventos`).set(yo.cabecera)
      .send({ tipo: 'respuesta', ocurrido_en: '2020-01-01T10:00:00Z' });

    const r = await request(c.app).get(`/postulaciones/${id}`).set(yo.cabecera);
    expect(r.body.postulacion.estado).toBe('entrevista');
  });

  it('rechaza un tipo de evento inventado', async () => {
    const id = await crearPostulacion(c.app, yo);
    const r = await request(c.app).post(`/postulaciones/${id}/eventos`).set(yo.cabecera)
      .send({ tipo: 'me_llamaron_por_whatsapp' });
    expect(r.status).toBe(400);
  });

  it('borrar la postulación se lleva su historial', async () => {
    const id = await crearPostulacion(c.app, yo);
    await request(c.app).post(`/postulaciones/${id}/eventos`).set(yo.cabecera).send({ tipo: 'rechazo' });

    await request(c.app).delete(`/postulaciones/${id}`).set(yo.cabecera);

    const { rows } = await c.pool.query('select count(*)::int as n from eventos');
    expect(rows[0].n).toBe(0); // on delete cascade, no filas zombis
  });

  it('no deja borrar una empresa con postulaciones', async () => {
    await crearPostulacion(c.app, yo);
    const empresas = await request(c.app).get('/empresas').set(yo.cabecera);

    const r = await request(c.app).delete(`/empresas/${empresas.body.empresas[0].id}`).set(yo.cabecera);

    /* `on delete restrict`: borrar la empresa se llevaría por delante el
       historial de esas candidaturas sin avisar. */
    expect(r.status).toBe(409);
  });
});

describe('listado', () => {
  beforeEach(async () => {
    const a = await crearPostulacion(c.app, yo, { empresa: { nombre: 'Uno' }, puesto: 'A', postulado_en: '2026-01-10' });
    await crearPostulacion(c.app, yo, { empresa: { nombre: 'Dos' }, puesto: 'B', postulado_en: '2026-03-15' });
    await request(c.app).post(`/postulaciones/${a}/eventos`).set(yo.cabecera).send({ tipo: 'rechazo' });
  });

  it('filtra por estado actual', async () => {
    const r = await request(c.app).get('/postulaciones?estado=rechazo').set(yo.cabecera);
    expect(r.body.total).toBe(1);
    expect(r.body.postulaciones[0].puesto).toBe('A');
  });

  it('filtra por rango de fechas', async () => {
    const r = await request(c.app).get('/postulaciones?desde=2026-02-01').set(yo.cabecera);
    expect(r.body.total).toBe(1);
    expect(r.body.postulaciones[0].puesto).toBe('B');
  });

  it('pagina y devuelve el total sin paginar', async () => {
    const r = await request(c.app).get('/postulaciones?limite=1').set(yo.cabecera);
    expect(r.body.postulaciones).toHaveLength(1);
    /* El total tiene que ser el de TODAS, no el de la página: sin eso el
       cliente no puede pintar el paginador. */
    expect(r.body.total).toBe(2);
  });

  it('rechaza un límite absurdo en vez de intentar servirlo', async () => {
    const r = await request(c.app).get('/postulaciones?limite=100000').set(yo.cabecera);
    expect(r.status).toBe(400);
  });

  it('un texto con comillas se guarda tal cual y no rompe la consulta', async () => {
    const puesto = "Dev' or 1=1 --";
    await crearPostulacion(c.app, yo, { empresa: { nombre: 'Tres' }, puesto });

    const r = await request(c.app).get('/postulaciones').set(yo.cabecera);
    expect(r.body.total).toBe(3);
    expect(r.body.postulaciones.map((p: { puesto: string }) => p.puesto)).toContain(puesto);
  });
});
