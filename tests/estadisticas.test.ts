/**
 * Lo que la tabla de eventos hace posible.
 *
 * Estos números son la razón de ser del diseño: con un campo `estado`
 * sobrescrito, ni el tiempo de respuesta ni el embudo se pueden calcular,
 * porque el dato de cuándo ocurrió cada paso ya no existe.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { crearCuenta, crearPostulacion, limpiar, montar, type Contexto, type Cuenta } from './ayudas.js';

let c: Contexto;
let yo: Cuenta;

beforeAll(async () => { c = await montar(); });
afterAll(async () => { await c?.pool.end(); });
beforeEach(async () => { await limpiar(c.pool); yo = await crearCuenta(c.app); });

async function evento(id: string, tipo: string, ocurrido_en?: string) {
  const r = await request(c.app).post(`/postulaciones/${id}/eventos`).set(yo.cabecera)
    .send({ tipo, ...(ocurrido_en ? { ocurrido_en } : {}) });
  expect(r.status).toBe(201);
}

describe('estadísticas', () => {
  it('con cero postulaciones no inventa números', async () => {
    const r = await request(c.app).get('/estadisticas').set(yo.cabecera);

    expect(r.status).toBe(200);
    expect(r.body.total).toBe(0);
    /* null y no 0: un 0% de entrevistas sugiere un resultado medido y aquí no
       se ha medido nada. La diferencia importa cuando el panel lo pinta. */
    expect(r.body.embudo.tasa_entrevista).toBeNull();
    expect(r.body.respuesta.dias_mediana).toBeNull();
  });

  it('calcula los días hasta la PRIMERA respuesta', async () => {
    const a = await crearPostulacion(c.app, yo, { empresa: { nombre: 'Uno' }, postulado_en: '2026-01-01' });
    await evento(a, 'respuesta', '2026-01-11T00:00:00Z');   // 10 días
    await evento(a, 'entrevista', '2026-01-30T00:00:00Z');  // no debe contar

    const b = await crearPostulacion(c.app, yo, { empresa: { nombre: 'Dos' }, postulado_en: '2026-01-01' });
    await evento(b, 'rechazo', '2026-01-05T00:00:00Z');     // 4 días

    const r = await request(c.app).get('/estadisticas').set(yo.cabecera);

    expect(r.body.respuesta.contestadas).toBe(2);
    expect(r.body.respuesta.dias_mediana).toBeCloseTo(7, 0);
    /* Si contase la ÚLTIMA respuesta, la media saldría ~16 días en vez de ~7:
       la entrevista de tres semanas después ensuciaría el dato que interesa. */
    expect(r.body.respuesta.dias_media).toBeCloseTo(7, 0);
  });

  it('las mudas no cuentan como respuesta instantánea', async () => {
    const a = await crearPostulacion(c.app, yo, { empresa: { nombre: 'Uno' }, postulado_en: '2026-01-01' });
    await evento(a, 'respuesta', '2026-01-11T00:00:00Z');
    await crearPostulacion(c.app, yo, { empresa: { nombre: 'Dos' }, postulado_en: '2026-01-01' });
    await crearPostulacion(c.app, yo, { empresa: { nombre: 'Tres' }, postulado_en: '2026-01-01' });

    const r = await request(c.app).get('/estadisticas').set(yo.cabecera);

    /* Meter las que no contestaron como cero días diría que responden al
       instante — justo lo contrario de lo que pasa. Van aparte. */
    expect(r.body.respuesta.dias_mediana).toBeCloseTo(10, 0);
    expect(r.body.respuesta.contestadas).toBe(1);
    expect(r.body.respuesta.sin_respuesta).toBe(2);
  });

  it('el embudo cuenta por dónde se PASÓ, no dónde se acabó', async () => {
    const a = await crearPostulacion(c.app, yo, { empresa: { nombre: 'Uno' } });
    await evento(a, 'entrevista');
    await evento(a, 'rechazo');   // acabó en rechazo, pero hubo entrevista

    await crearPostulacion(c.app, yo, { empresa: { nombre: 'Dos' } });

    const r = await request(c.app).get('/estadisticas').set(yo.cabecera);

    /* Contarla solo como rechazo escondería el único dato que dice si el CV
       está funcionando: llegó a entrevista. */
    expect(r.body.embudo.entrevistas).toBe(1);
    expect(r.body.embudo.rechazos).toBe(1);
    expect(r.body.embudo.postuladas).toBe(2);
    expect(r.body.embudo.tasa_entrevista).toBe(50);
    expect(r.body.por_estado.rechazo).toBe(1);
  });

  it('agrupa por mes de postulación', async () => {
    await crearPostulacion(c.app, yo, { empresa: { nombre: 'Uno' }, postulado_en: '2026-01-10' });
    await crearPostulacion(c.app, yo, { empresa: { nombre: 'Dos' }, postulado_en: '2026-01-20' });
    await crearPostulacion(c.app, yo, { empresa: { nombre: 'Tres' }, postulado_en: '2026-02-03' });

    const r = await request(c.app).get('/estadisticas').set(yo.cabecera);

    expect(r.body.por_mes).toEqual([
      { mes: '2026-01', n: 2 },
      { mes: '2026-02', n: 1 },
    ]);
  });
});
