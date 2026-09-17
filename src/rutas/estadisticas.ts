/**
 * Estadísticas. Esto es lo que justifica la tabla de eventos.
 *
 * Con un campo `estado` sobrescrito, "cuánto tardan de media en contestarme"
 * no tiene respuesta: el dato de CUÁNDO pasó a 'respuesta' se perdió al
 * sobrescribirlo. Aquí sale de una consulta.
 */

import { Router } from 'express';
import type { Pool } from '../bd/pool.js';
import { sujetoDe } from '../auth/middleware.js';

export function rutasEstadisticas(pool: Pool): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const yo = sujetoDe(req);

    const porEstado = pool.query<{ estado: string; n: string }>(
      `select coalesce(a.estado, 'guardada') as estado, count(*) as n
         from postulaciones p
         left join estado_actual a on a.postulacion_id = p.id
        where p.usuario_id = $1
        group by 1
        order by 2 desc`,
      [yo.id],
    );

    /* Días hasta la PRIMERA respuesta de cada postulación.
       `min(ocurrido_en)` y no `max`: lo que interesa es cuánto tardaron en
       contestar, y una segunda respuesta semanas después estropearía la media.
       Se calcula solo sobre las que respondieron; meter las mudas como cero
       diría que contestan al instante, y meterlas como "muchos días" sería
       inventarse un dato. Por eso van aparte, en `sin_respuesta`. */
    const respuesta = pool.query<{ mediana: string | null; media: string | null; n: string }>(
      `with primeras as (
         select p.id,
                p.postulado_en,
                min(e.ocurrido_en) filter (
                  where e.tipo in ('respuesta','entrevista','prueba','oferta','rechazo')
                ) as contestaron
           from postulaciones p
           join eventos e on e.postulacion_id = p.id
          where p.usuario_id = $1
          group by p.id
       ),
       dias as (
         select extract(epoch from (contestaron - postulado_en::timestamptz)) / 86400 as d
           from primeras where contestaron is not null
       )
       select percentile_cont(0.5) within group (order by d) as mediana,
              avg(d) as media,
              count(*) as n
         from dias`,
      [yo.id],
    );

    /* El embudo mira si el evento OCURRIÓ ALGUNA VEZ, no si es el estado
       actual. Una postulación que llegó a entrevista y acabó en rechazo pasó
       por la entrevista: contarla solo como rechazo escondería el único dato
       que dice si el CV funciona. */
    const embudo = pool.query<{ postuladas: string; entrevistas: string; ofertas: string; rechazos: string }>(
      `select
         count(*) filter (where p.id in (select postulacion_id from eventos where tipo = 'postulada'))  as postuladas,
         count(*) filter (where p.id in (select postulacion_id from eventos where tipo = 'entrevista')) as entrevistas,
         count(*) filter (where p.id in (select postulacion_id from eventos where tipo = 'oferta'))     as ofertas,
         count(*) filter (where p.id in (select postulacion_id from eventos where tipo = 'rechazo'))    as rechazos
       from postulaciones p
       where p.usuario_id = $1`,
      [yo.id],
    );

    const porMes = pool.query<{ mes: string; n: string }>(
      `select to_char(date_trunc('month', postulado_en), 'YYYY-MM') as mes, count(*) as n
         from postulaciones
        where usuario_id = $1
        group by 1 order by 1`,
      [yo.id],
    );

    const [estados, tiempos, f, meses] = await Promise.all([porEstado, respuesta, embudo, porMes]);

    const total = estados.rows.reduce((s, x) => s + Number(x.n), 0);
    const emb = f.rows[0];
    const t = tiempos.rows[0];

    res.json({
      total,
      por_estado: Object.fromEntries(estados.rows.map((x) => [x.estado, Number(x.n)])),
      por_mes: meses.rows.map((x) => ({ mes: x.mes, n: Number(x.n) })),
      respuesta: {
        contestadas: Number(t?.n ?? 0),
        sin_respuesta: total - Number(t?.n ?? 0),
        dias_mediana: redondear(t?.mediana),
        dias_media: redondear(t?.media),
      },
      embudo: {
        postuladas: Number(emb?.postuladas ?? 0),
        entrevistas: Number(emb?.entrevistas ?? 0),
        ofertas: Number(emb?.ofertas ?? 0),
        rechazos: Number(emb?.rechazos ?? 0),
        /* Tasas, no solo cuentas: "3 entrevistas" no dice nada sin saber sobre
           cuántas postulaciones. Se devuelve null en vez de 0 cuando no hay
           denominador — un 0% sugiere un resultado medido, y aquí no hay
           medición ninguna. */
        tasa_entrevista: tasa(emb?.entrevistas, emb?.postuladas),
        tasa_oferta: tasa(emb?.ofertas, emb?.postuladas),
      },
    });
  });

  return r;
}

function redondear(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

function tasa(parte: string | undefined, total: string | undefined): number | null {
  const p = Number(parte ?? 0);
  const t = Number(total ?? 0);
  if (!t) return null;
  return Math.round((p / t) * 1000) / 10;
}
