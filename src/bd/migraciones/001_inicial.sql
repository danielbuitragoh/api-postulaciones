-- ====================================================================
-- Esquema inicial · seguimiento de postulaciones de empleo
--
-- La decisión de diseño que importa está en la tabla `eventos`. Lo fácil
-- sería tener un campo `estado` en `postulaciones` y sobrescribirlo al
-- avanzar el proceso. Es lo que hace todo el mundo, y pierde el historial:
-- con un solo campo no hay forma de saber CUÁNDO cambió, y por tanto no se
-- puede responder "cuánto tarda de media esta empresa en contestar".
--
-- Guardando cada cambio como un evento, el estado actual es una consulta
-- (el último evento) y el historial queda para siempre. Cuesta una tabla
-- más y una consulta algo más elaborada; a cambio, las estadísticas que
-- hacen útil la herramienta son posibles.
-- ====================================================================

create extension if not exists pgcrypto;

-- --------------------------------------------------------------------
create table usuarios (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  hash          text not null,
  nombre        text not null,
  rol           text not null default 'usuario'
                check (rol in ('usuario', 'admin')),
  creado_en     timestamptz not null default now()
);

-- Los correos se comparan en minúsculas; sin esto, Ana@x.com y ana@x.com
-- serían dos cuentas distintas y el usuario juraría que su clave falla.
create unique index usuarios_email_minusculas on usuarios (lower(email));

-- --------------------------------------------------------------------
-- Los refresh tokens se guardan HASHEADOS, igual que las contraseñas: si
-- alguien se lleva un volcado de la base, no obtiene sesiones utilizables.
create table sesiones (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null references usuarios(id) on delete cascade,
  hash_refresh  text not null,
  expira_en     timestamptz not null,
  revocada_en   timestamptz,
  creado_en     timestamptz not null default now()
);
create index sesiones_usuario on sesiones (usuario_id);

-- --------------------------------------------------------------------
create table empresas (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null references usuarios(id) on delete cascade,
  nombre        text not null,
  sitio_web     text,
  sector        text,
  creado_en     timestamptz not null default now()
);
create unique index empresas_por_usuario on empresas (usuario_id, lower(nombre));

-- --------------------------------------------------------------------
create table postulaciones (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null references usuarios(id) on delete cascade,
  empresa_id    uuid not null references empresas(id) on delete restrict,
  puesto        text not null,
  fuente        text,                 -- linkedin, referencia, web propia…
  url_oferta    text,
  salario_min   integer,              -- en unidades enteras de la moneda
  salario_max   integer,
  moneda        text default 'EUR',
  modalidad     text check (modalidad in ('presencial','hibrido','remoto')),
  ubicacion     text,
  notas         text,
  postulado_en  date not null default current_date,
  creado_en     timestamptz not null default now(),

  -- Un rango invertido es un error de quien llama, no un dato válido.
  -- Mejor que lo rechace la base de datos que confiar en que ninguna ruta
  -- se olvide de comprobarlo.
  constraint salario_coherente check (
    salario_min is null or salario_max is null or salario_min <= salario_max
  )
);
create index postulaciones_usuario on postulaciones (usuario_id, postulado_en desc);
create index postulaciones_empresa on postulaciones (empresa_id);

-- --------------------------------------------------------------------
create table eventos (
  id             uuid primary key default gen_random_uuid(),
  postulacion_id uuid not null references postulaciones(id) on delete cascade,
  tipo           text not null check (tipo in (
                   'guardada','postulada','respuesta','entrevista',
                   'prueba','oferta','rechazo','retirada'
                 )),
  nota           text,
  ocurrido_en    timestamptz not null default now(),
  creado_en      timestamptz not null default now()
);
create index eventos_postulacion on eventos (postulacion_id, ocurrido_en desc);

-- --------------------------------------------------------------------
-- El estado actual de cada postulación: el evento más reciente.
-- Vive como vista para que no haya dos fuentes de verdad — un campo
-- `estado` denormalizado acabaría desincronizado del historial el día que
-- alguien inserte un evento sin actualizarlo.
create view estado_actual as
select distinct on (e.postulacion_id)
  e.postulacion_id,
  e.tipo        as estado,
  e.ocurrido_en as desde
from eventos e
order by e.postulacion_id, e.ocurrido_en desc, e.creado_en desc;
