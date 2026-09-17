/**
 * Postulaciones y su historial de eventos: el núcleo de la API.
 *
 * Regla que se repite en cada consulta: `usuario_id = $1` va en el WHERE, no
 * en un `if` de JavaScript después de traer la fila. Filtrar en la aplicación
 * significa que la fila ajena ya viajó por la red y ya está en memoria; basta
 * una rama olvidada para devolverla. Si el filtro vive en el SQL, la fila que
 * no es tuya no existe para esta consulta.
 */

import { Router } from 'express';
import type { PoolClient } from 'pg';
import type { Pool } from '../bd/pool.js';
import { Conflicto, NoEncontrado, PeticionInvalida } from '../errores.js';
import { idDe, sujetoDe, validar } from '../auth/middleware.js';
import { EventoNuevo, Listado, PostulacionCambio, PostulacionNueva } from '../esquemas.js';

/* Lista blanca de columnas actualizables. Construir el SET a partir de las
   claves que mande el cliente sin filtrarlas permitiría escribir en
   `usuario_id` y regalarle la postulación a otra cuenta. */
const CAMPOS_EDITABLES = [
  'puesto', 'fuente', 'url_oferta', 'salario_min', 'salario_max',
  'moneda', 'modalidad', 'ubicacion', 'notas',
] as const;

const SELECT_BASE = `
  select p.id, p.puesto, p.fuente, p.url_oferta,
         p.salario_min, p.salario_max, p.moneda,
         p.modalidad, p.ubicacion, p.notas,
         p.postulado_en, p.creado_en,
         e.id as empresa_id, e.nombre as empresa,
         coalesce(a.estado, 'guardada') as estado,
         a.desde as estado_desde
    from postulaciones p
    join empresas e on e.id = p.empresa_id
    left join estado_actual a on a.postulacion_id = p.id
`;

export function rutasPostulaciones(pool: Pool): Router {
  const r = Router();

  /* ---------------------------------------------------------------- */

  r.get('/', async (req, res) => {
    const yo = sujetoDe(req);
    const f = validar(Listado, req.query);

    /* Los filtros se acumulan como fragmentos con marcadores numerados. Nada
       de interpolar valores en la cadena: eso es inyección SQL, y el hecho de
       que los valores vengan de Zod no cambia nada — Zod valida la FORMA, no
       impide que un texto legítimo lleve comillas. */
    const donde = ['p.usuario_id = $1'];
    const args: unknown[] = [yo.id];

    if (f.empresa_id) { args.push(f.empresa_id); donde.push(`p.empresa_id = $${args.length}`); }
    if (f.desde)      { args.push(f.desde);      donde.push(`p.postulado_en >= $${args.length}`); }
    if (f.hasta)      { args.push(f.hasta);      donde.push(`p.postulado_en <= $${args.length}`); }
    if (f.estado)     { args.push(f.estado);     donde.push(`coalesce(a.estado, 'guardada') = $${args.length}`); }

    const sqlDonde = `where ${donde.join(' and ')}`;

    const total = await pool.query<{ n: string }>(
      `select count(*) as n
         from postulaciones p
         left join estado_actual a on a.postulacion_id = p.id
       ${sqlDonde}`,
      args,
    );

    args.push(f.limite, f.desplazamiento);
    const { rows } = await pool.query(
      `${SELECT_BASE} ${sqlDonde}
        order by p.postulado_en desc, p.creado_en desc
        limit $${args.length - 1} offset $${args.length}`,
      args,
    );

    res.json({
      postulaciones: rows,
      total: Number(total.rows[0]?.n ?? 0),
      limite: f.limite,
      desplazamiento: f.desplazamiento,
    });
  });

  /* ---------------------------------------------------------------- */

  r.post('/', async (req, res) => {
    const yo = sujetoDe(req);
    const d = validar(PostulacionNueva, req.body);

    /* Transacción: crear la empresa, la postulación y su primer evento son
       tres escrituras que forman UN hecho. Si falla la tercera y las dos
       primeras quedan, el usuario acaba con una postulación sin historial y
       una empresa que nunca pidió. */
    const cliente = await pool.connect();
    try {
      await cliente.query('begin');

      const empresaId = await resolverEmpresa(cliente, yo.id, d);

      const { rows } = await cliente.query<{ id: string }>(
        `insert into postulaciones
           (usuario_id, empresa_id, puesto, fuente, url_oferta,
            salario_min, salario_max, moneda, modalidad, ubicacion, notas, postulado_en)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, coalesce($12::date, current_date))
         returning id`,
        [
          yo.id, empresaId, d.puesto, d.fuente ?? null, d.url_oferta ?? null,
          d.salario_min ?? null, d.salario_max ?? null, d.moneda ?? 'EUR',
          d.modalidad ?? null, d.ubicacion ?? null, d.notas ?? null,
          d.postulado_en ?? null,
        ],
      );
      const id = rows[0]!.id;

      /* Evento inicial. Sin él, una postulación recién creada no tendría
         estado y la vista `estado_actual` no la incluiría: el `coalesce`
         del SELECT la salvaría, pero las estadísticas contarían mal. */
      await cliente.query(
        `insert into eventos (postulacion_id, tipo, ocurrido_en)
         values ($1, 'postulada', coalesce($2::date, current_date))`,
        [id, d.postulado_en ?? null],
      );

      await cliente.query('commit');

      const creada = await pool.query(`${SELECT_BASE} where p.id = $1 and p.usuario_id = $2`, [id, yo.id]);
      res.status(201).json({ postulacion: creada.rows[0] });
    } catch (e) {
      await cliente.query('rollback');
      throw e;
    } finally {
      cliente.release();
    }
  });

  /* ---------------------------------------------------------------- */

  r.get('/:id', async (req, res) => {
    const yo = sujetoDe(req);
    const id = idDe(req.params.id, 'Postulación');

    const { rows } = await pool.query(`${SELECT_BASE} where p.id = $1 and p.usuario_id = $2`, [id, yo.id]);
    const p = rows[0];
    if (!p) throw new NoEncontrado('Postulación');

    const eventos = await pool.query(
      `select id, tipo, nota, ocurrido_en
         from eventos where postulacion_id = $1
        order by ocurrido_en asc, creado_en asc`,
      [id],
    );

    res.json({ postulacion: { ...p, eventos: eventos.rows } });
  });

  /* ---------------------------------------------------------------- */

  r.patch('/:id', async (req, res) => {
    const yo = sujetoDe(req);
    const id = idDe(req.params.id, 'Postulación');
    const cambios = validar(PostulacionCambio, req.body);

    const sets: string[] = [];
    const args: unknown[] = [];

    for (const campo of CAMPOS_EDITABLES) {
      const valor = cambios[campo];
      if (valor === undefined) continue;   // no enviado: no se toca
      args.push(valor);                    // null enviado: se borra a propósito
      sets.push(`${campo} = $${args.length}`);
    }

    if (sets.length === 0) throw new PeticionInvalida('No enviaste ningún campo que cambiar');

    args.push(id, yo.id);
    try {
      const { rowCount } = await pool.query(
        `update postulaciones set ${sets.join(', ')}
          where id = $${args.length - 1} and usuario_id = $${args.length}`,
        args,
      );
      /* Cero filas puede ser "no existe" o "es de otro". Se responde igual:
         404. Un 403 aquí confirmaría que el id existe. */
      if (!rowCount) throw new NoEncontrado('Postulación');
    } catch (e) {
      if ((e as { code?: string }).code === '23514') {
        throw new PeticionInvalida('El salario mínimo no puede superar al máximo');
      }
      throw e;
    }

    const { rows } = await pool.query(`${SELECT_BASE} where p.id = $1 and p.usuario_id = $2`, [id, yo.id]);
    res.json({ postulacion: rows[0] });
  });

  /* ---------------------------------------------------------------- */

  r.delete('/:id', async (req, res) => {
    const yo = sujetoDe(req);
    const { rowCount } = await pool.query(
      'delete from postulaciones where id = $1 and usuario_id = $2',
      [idDe(req.params.id, 'Postulación'), yo.id],
    );
    if (!rowCount) throw new NoEncontrado('Postulación');
    res.status(204).end();
  });

  /* ---------------------------------------------------------------- */

  r.post('/:id/eventos', async (req, res) => {
    const yo = sujetoDe(req);
    const id = idDe(req.params.id, 'Postulación');
    const d = validar(EventoNuevo, req.body);

    /* La pertenencia se comprueba ANTES de insertar, en la misma consulta que
       trae la fila: `eventos` no tiene `usuario_id`, así que un insert directo
       con el id de la URL dejaría escribir en el historial de cualquiera. Es
       el agujero exacto que busca esta clase de recurso anidado. */
    const dueño = await pool.query('select 1 from postulaciones where id = $1 and usuario_id = $2', [id, yo.id]);
    if (!dueño.rowCount) throw new NoEncontrado('Postulación');

    const { rows } = await pool.query(
      `insert into eventos (postulacion_id, tipo, nota, ocurrido_en)
       values ($1, $2, $3, coalesce($4::timestamptz, now()))
       returning id, tipo, nota, ocurrido_en`,
      [id, d.tipo, d.nota ?? null, d.ocurrido_en ?? null],
    );

    res.status(201).json({ evento: rows[0] });
  });

  return r;
}

/* ------------------------------------------------------------------ */

async function resolverEmpresa(
  cliente: PoolClient,
  usuarioId: string,
  d: { empresa_id?: string | undefined; empresa?: { nombre: string; sitio_web?: string | undefined; sector?: string | undefined } | undefined },
): Promise<string> {
  if (d.empresa_id) {
    const { rows } = await cliente.query<{ id: string }>(
      'select id from empresas where id = $1 and usuario_id = $2',
      [d.empresa_id, usuarioId],
    );
    if (!rows[0]) throw new NoEncontrado('Empresa');
    return rows[0].id;
  }

  const e = d.empresa!;
  /* `on conflict` sobre el índice único (usuario_id, lower(nombre)): si la
     empresa ya existe se reutiliza en vez de fallar. Postular dos veces a la
     misma empresa es lo normal, no un error. */
  const { rows } = await cliente.query<{ id: string }>(
    `insert into empresas (usuario_id, nombre, sitio_web, sector)
     values ($1, $2, $3, $4)
     on conflict (usuario_id, lower(nombre))
       do update set sitio_web = coalesce(excluded.sitio_web, empresas.sitio_web),
                     sector    = coalesce(excluded.sector,    empresas.sector)
     returning id`,
    [usuarioId, e.nombre, e.sitio_web ?? null, e.sector ?? null],
  );

  const id = rows[0]?.id;
  if (!id) throw new Conflicto('No se pudo resolver la empresa');
  return id;
}
