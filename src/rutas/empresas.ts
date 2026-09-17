/**
 * Empresas. Cada usuario tiene las suyas: dos personas pueden seguir a
 * "Telefónica" sin compartir notas ni sector.
 */

import { Router } from 'express';
import type { Pool } from '../bd/pool.js';
import { Conflicto, NoEncontrado } from '../errores.js';
import { idDe, sujetoDe, validar } from '../auth/middleware.js';
import { EmpresaNueva } from '../esquemas.js';

export function rutasEmpresas(pool: Pool): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const yo = sujetoDe(req);
    const { rows } = await pool.query(
      `select e.id, e.nombre, e.sitio_web, e.sector, e.creado_en,
              count(p.id)::int as postulaciones
         from empresas e
         left join postulaciones p on p.empresa_id = e.id
        where e.usuario_id = $1
        group by e.id
        order by e.nombre`,
      [yo.id],
    );
    res.json({ empresas: rows });
  });

  r.post('/', async (req, res) => {
    const yo = sujetoDe(req);
    const datos = validar(EmpresaNueva, req.body);

    try {
      const { rows } = await pool.query(
        `insert into empresas (usuario_id, nombre, sitio_web, sector)
         values ($1, $2, $3, $4)
         returning id, nombre, sitio_web, sector, creado_en`,
        [yo.id, datos.nombre, datos.sitio_web ?? null, datos.sector ?? null],
      );
      res.status(201).json({ empresa: rows[0] });
    } catch (e) {
      /* 23505 = violación de índice único. Se traduce a 409 en vez de dejar
         que suba como 500: que el usuario repita un nombre no es un fallo del
         servidor. La restricción vive en la base y no en un `select` previo
         porque dos peticiones simultáneas pasarían las dos ese `select`. */
      if ((e as { code?: string }).code === '23505') {
        throw new Conflicto('Ya tienes una empresa con ese nombre');
      }
      throw e;
    }
  });

  r.delete('/:id', async (req, res) => {
    const yo = sujetoDe(req);
    try {
      const { rowCount } = await pool.query(
        'delete from empresas where id = $1 and usuario_id = $2',
        [idDe(req.params.id, 'Empresa'), yo.id],
      );
      if (!rowCount) throw new NoEncontrado('Empresa');
      res.status(204).end();
    } catch (e) {
      /* 23503 = clave foránea. La migración usa `on delete restrict` a
         propósito: borrar una empresa con postulaciones se llevaría por
         delante el historial de esas candidaturas sin avisar. */
      if ((e as { code?: string }).code === '23503') {
        throw new Conflicto('Esa empresa tiene postulaciones; bórralas primero');
      }
      throw e;
    }
  });

  return r;
}
