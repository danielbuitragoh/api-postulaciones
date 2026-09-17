/**
 * Esquemas de entrada.
 *
 * Todo lo que llega del cliente pasa por aquí antes de tocar la base de datos.
 * No es paranoia: `express.json()` acepta cualquier JSON, así que sin esta capa
 * el tipo TypeScript de `req.body` es una ficción — dice `Postulacion` y en
 * tiempo de ejecución puede ser `null`.
 *
 * Los mensajes van en español porque se le enseñan al usuario.
 */

import { z } from 'zod';

export const TIPOS_EVENTO = [
  'guardada', 'postulada', 'respuesta', 'entrevista',
  'prueba', 'oferta', 'rechazo', 'retirada',
] as const;

export const MODALIDADES = ['presencial', 'hibrido', 'remoto'] as const;

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('el correo no tiene un formato válido')
  .max(254);

/* 12 caracteres, no 8. La longitud es la única propiedad de una contraseña que
   realmente encarece un ataque por fuerza bruta; exigir "una mayúscula y un
   símbolo" produce Password1! y una falsa sensación de seguridad. */
const contrasena = z
  .string()
  .min(12, 'la contraseña debe tener al menos 12 caracteres')
  .max(200, 'la contraseña no puede superar los 200 caracteres');

export const Registro = z.object({
  email,
  contrasena,
  nombre: z.string().trim().min(1, 'el nombre no puede estar vacío').max(120),
});

export const Acceso = z.object({
  email,
  contrasena: z.string().min(1, 'falta la contraseña'),
});

export const Refresco = z.object({
  refresco: z.string().min(1, 'falta el token de refresco'),
});

export const EmpresaNueva = z.object({
  nombre: z.string().trim().min(1).max(160),
  sitio_web: z.string().trim().url('la web debe ser una URL válida').max(400).optional(),
  sector: z.string().trim().max(120).optional(),
});

const fechaIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'la fecha debe tener el formato AAAA-MM-DD');

export const PostulacionNueva = z
  .object({
    empresa_id: z.string().uuid('empresa_id debe ser un UUID').optional(),
    /* Alternativa a empresa_id: crear la empresa sobre la marcha. Sin esto, dar
       de alta una postulación son dos peticiones y el cliente tiene que
       orquestarlas. */
    empresa: EmpresaNueva.optional(),

    puesto: z.string().trim().min(1, 'el puesto no puede estar vacío').max(200),
    fuente: z.string().trim().max(80).optional(),
    url_oferta: z.string().trim().url('la oferta debe ser una URL válida').max(1000).optional(),
    salario_min: z.number().int().nonnegative().max(100_000_000).optional(),
    salario_max: z.number().int().nonnegative().max(100_000_000).optional(),
    moneda: z.string().trim().length(3, 'la moneda debe ser un código de 3 letras').toUpperCase().optional(),
    modalidad: z.enum(MODALIDADES).optional(),
    ubicacion: z.string().trim().max(160).optional(),
    notas: z.string().max(5000).optional(),
    postulado_en: fechaIso.optional(),
  })
  .refine((d) => Boolean(d.empresa_id) !== Boolean(d.empresa), {
    message: 'indica empresa_id o empresa, pero no ambos',
    path: ['empresa_id'],
  })
  .refine(
    (d) => d.salario_min === undefined || d.salario_max === undefined || d.salario_min <= d.salario_max,
    { message: 'el salario mínimo no puede superar al máximo', path: ['salario_min'] },
  );

export const PostulacionCambio = z.object({
  puesto: z.string().trim().min(1).max(200).optional(),
  fuente: z.string().trim().max(80).nullable().optional(),
  url_oferta: z.string().trim().url().max(1000).nullable().optional(),
  salario_min: z.number().int().nonnegative().nullable().optional(),
  salario_max: z.number().int().nonnegative().nullable().optional(),
  moneda: z.string().trim().length(3).toUpperCase().nullable().optional(),
  modalidad: z.enum(MODALIDADES).nullable().optional(),
  ubicacion: z.string().trim().max(160).nullable().optional(),
  notas: z.string().max(5000).nullable().optional(),
});

export const EventoNuevo = z.object({
  tipo: z.enum(TIPOS_EVENTO),
  nota: z.string().max(2000).optional(),
  /* Se permite fechar un evento en el pasado: la gente registra la entrevista
     del martes el jueves, y si la API forzara `now()` las estadísticas de
     tiempo de respuesta saldrían mal. */
  ocurrido_en: z.string().datetime({ offset: true }).optional(),
});

export const Listado = z.object({
  estado: z.enum(TIPOS_EVENTO).optional(),
  empresa_id: z.string().uuid().optional(),
  desde: fechaIso.optional(),
  hasta: fechaIso.optional(),
  limite: z.coerce.number().int().min(1).max(100).default(20),
  desplazamiento: z.coerce.number().int().min(0).default(0),
});

export type Registro = z.infer<typeof Registro>;
export type Acceso = z.infer<typeof Acceso>;
export type EmpresaNueva = z.infer<typeof EmpresaNueva>;
export type PostulacionNueva = z.infer<typeof PostulacionNueva>;
export type PostulacionCambio = z.infer<typeof PostulacionCambio>;
export type EventoNuevo = z.infer<typeof EventoNuevo>;
export type Listado = z.infer<typeof Listado>;
