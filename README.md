<div align="center">

# API de postulaciones

**API REST para seguir candidaturas de empleo con historial completo de eventos y estadísticas reales de respuesta.**

[![CI](https://github.com/danielbuitragoh/api-postulaciones/actions/workflows/ci.yml/badge.svg)](https://github.com/danielbuitragoh/api-postulaciones/actions/workflows/ci.yml)

[Ejemplos listos para ejecutar](docs/peticiones.http) · [Cliente web que la consume](https://github.com/danielbuitragoh/gestor-postulaciones)

</div>

---

## Qué es

Una API REST que registra qué candidatura enviaste, a quién, cuándo te
contestaron y en qué acabó. Node, TypeScript, Express 5, PostgreSQL, Zod,
Argon2id y Vitest, con 46 pruebas en verde contra PostgreSQL real, sin un solo
mock del pool.

Detrás hay decisiones de modelado y de seguridad que no se ven desde fuera pero
que deciden si la herramienta sirve para algo: si puedes responder «cuánto
tardan de media en contestarme» o solo «en qué estado está esto ahora», y si la
candidatura de una persona —con su salario y sus notas— puede acabar en la
pantalla de otra.

## Ejemplo

Ejemplos reales tomados de docs/peticiones.http, con una respuesta ilustrativa (los valores como el token o el id cambian en cada ejecucion real):

```bash
curl -X POST localhost:3000/auth/registro -H "Content-Type: application/json" -d '{"email":"ana@ejemplo.com","contrasena":"una-contrasena-larga","nombre":"Ana"}'
# { "acceso": "eyJhbGciOiJIUzI1NiJ9...", "usuario": { "id": "8f2c...", "nombre": "Ana" } }

curl -X POST localhost:3000/postulaciones -H "Authorization: Bearer $ACCESO" -H "Content-Type: application/json" -d '{"empresa":{"nombre":"Telefonica","sector":"Telecomunicaciones"},"puesto":"Desarrollador backend junior","fuente":"linkedin","modalidad":"hibrido","ubicacion":"Madrid","salario_min":24000,"salario_max":30000}'
# { "postulacion": { "id": "3af9...", "estado": "enviada", "puesto": "Desarrollador backend junior" } }

curl localhost:3000/estadisticas -H "Authorization: Bearer $ACCESO"
# { "embudo": { "enviada": 1, "entrevista": 0, "oferta": 0 }, "tiempo_respuesta_medio_dias": null, "sin_respuesta": 1 }
```

Mas ejemplos listos para copiar en docs/peticiones.http.

## Lo que más me interesa que se mire

**El estado no es una columna que se sobrescribe, es una tabla de eventos.** Lo
fácil es un campo `estado` en la postulación y machacarlo al avanzar el
proceso. Es lo que hace casi todo el mundo, y destruye el historial: con un
solo campo no existe el dato de *cuándo* cambió, así que «cuánto tardan en
contestarme» y «de las 40 que envié, cuántas llegaron a entrevista» dejan de
tener respuesta para siempre. Aquí cada cambio es una fila en `eventos` y el
estado actual es una vista con `distinct on`, que además impide que haya dos
fuentes de verdad desincronizándose el día que alguien inserte un evento sin
actualizar el campo. Cuesta una tabla más y consultas más elaboradas; a cambio,
`GET /estadisticas` puede existir.

**El tiempo de respuesta usa la primera respuesta, no la última.** Es
`min(ocurrido_en)` y no `max` a propósito: lo que se mide es cuánto tardaron en
contestar, y una segunda ronda tres semanas después inflaría la media hasta
volverla inútil. La diferencia entre las dos funciones es un carácter, y es la
diferencia entre un dato y un número bonito.

**Las candidaturas sin respuesta no cuentan como cero días.** Meterlas como
cero diría que contestan al instante, justo lo contrario de la verdad; meterlas
como «muchos días» sería inventarse un dato que nadie midió. Van aparte, en
`sin_respuesta`. Las tasas del embudo devuelven `null` y no `0` cuando no hay
denominador, por lo mismo: un 0 % sugiere una medición, y ahí no hubo ninguna.

**El embudo mira si el paso ocurrió alguna vez, no el estado final.** Una
candidatura que llegó a entrevista y acabó en rechazo pasó por la entrevista.
Contarla solo como rechazo escondería el único dato que dice si el CV está
funcionando.

**Dos tokens con papeles distintos, porque uno solo no cubre los dos.** El de
acceso es un JWT de 15 minutos que no se guarda en ninguna parte: se verifica
con la firma, así que cada petición autenticada cuesta cero consultas. El de
refresco son 32 bytes aleatorios opacos, guardados hasheados con SHA-256 y
rotados en cada uso. Un único JWT de vida larga no se puede revocar sin una
lista negra, que es exactamente la consulta a base de datos que el JWT venía a
evitar; con este reparto, cerrar sesión funciona de verdad y las peticiones
autenticadas siguen sin tocar la base. El refresco va hasheado porque es una
credencial: en claro, un volcado de la base entra como cualquier usuario.

**Argon2id con los parámetros de OWASP: 19 MiB, 2 iteraciones, paralelismo 1.**
bcrypt trunca en silencio a 72 bytes y solo se encarece en CPU. Argon2id se
encarece en memoria, que es lo que arruina a un atacante con GPUs: mil núcleos
que comparten 4 GB no pueden probar mil contraseñas a la vez si cada intento
exige 19 MiB.

**Lista de algoritmos explícita al verificar el JWT, con un test que intenta
`alg: none`.** Sin esa lista, la librería acepta el algoritmo que declara el
propio token, que es el agujero clásico de JWT. Escribir la lista es una línea;
saber que hay que escribirla es el trabajo, y por eso hay una prueba que envía
un token sin firma y exige que la API lo rechace.

**Login sin fugas, también en el tiempo de respuesta.** Mismo mensaje para
correo inexistente y contraseña incorrecta, que es lo que hace todo el mundo, y
además verificación contra un hash señuelo cuando el correo no existe. Sin ese
señuelo la respuesta vuelve en 2 ms en lugar de en 60, y el propio tiempo
contesta la pregunta que el mensaje se negaba a contestar: un atacante enumera
la base de usuarios con un cronómetro.

**404 y no 403 cuando el recurso es de otro usuario.** Un 403 confirmaría que
ese identificador existe, que es precisamente lo que no se quiere revelar.

**`usuario_id = $1` va dentro del `WHERE`, nunca en un `if` de JavaScript.**
Filtrar en la aplicación significa que la fila ajena ya viajó por la red y ya
está en memoria: basta una rama olvidada para devolverla. En el `WHERE`, la
fila ajena no llega a existir.

**Ocho pruebas de autorización ruta por ruta, incluido el recurso anidado.** El
fallo típico no es olvidar la autorización en todas partes, es olvidarla en
una, así que se prueba lectura, modificación, borrado, listado, recuento y
estadísticas por separado. La que más se escapa es
`POST /postulaciones/:id/eventos`: `eventos` no tiene `usuario_id`, así que el
`where` obvio no basta y hay que comprobar la pertenencia del padre antes de
insertar.

**Y para comprobar que esas pruebas sirven, borré a propósito el filtro de
usuario de dos rutas.** La batería se puso roja en esas dos y solo en esas. Un
test que no falla cuando rompes lo que vigila no vigila nada, y la única forma
de saberlo es romperlo a mano. Esto también es lo que justifica correr contra
PostgreSQL real y sin mocks: casi todo lo que protege esta API vive en la base
—el índice único de correos en minúsculas, el `check` del rango de salario, el
`on delete restrict` de empresas, el `distinct on` de la vista, el
`usuario_id = $1` de cada consulta— y un mock devuelve lo que yo le diga, así
que pasaría igual de verde con el filtro de usuario borrado.

**Transacciones donde hay varias escrituras.** Crear empresa, postulación y
primer evento son tres escrituras que forman un solo hecho. Hay un test que
fuerza un fallo a mitad —`postulado_en: "2026-02-31"`, que pasa la validación
de formato y rechaza PostgreSQL— y comprueba que la empresa no queda huérfana.

**Zona horaria fijada a UTC en la conexión, no heredada del sistema.** Las
estadísticas restan un `date` de un `timestamptz`, y esa conversión usa la zona
de la sesión. Sin fijarla, la misma consulta da 10 días en un servidor y 9,96
en otro, y el fallo aparece solo en producción.

**Lista blanca de columnas editables en el `PATCH`.** Construir el `SET` con
las claves que mande el cliente permitiría escribir en `usuario_id` y regalarle
la candidatura a otra cuenta.

**El `PATCH` distingue «no enviado» de «enviado como `null`».** Lo primero no
toca el campo, lo segundo lo borra. Sin esa diferencia hay que reenviar el
objeto entero para cambiar un campo, y entonces dos pestañas abiertas se pisan
los cambios.

**Migraciones registradas en su propia tabla y aplicadas en transacción.**
Correr `migrar` dos veces no rompe nada: la segunda vez no hay nada que
aplicar. Sin ese registro, un despliegue que reinicia el proceso reaplicaría el
esquema y reventaría en el primer `create table`.

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/auth/registro` | Crea la cuenta y abre sesión |
| `POST` | `/auth/acceso` | Inicia sesión |
| `POST` | `/auth/refresco` | Rota el token de refresco |
| `POST` | `/auth/salir` | Revoca todas las sesiones |
| `GET` | `/auth/yo` | Datos de la cuenta |
| `GET` `POST` | `/empresas` | Listar / crear |
| `DELETE` | `/empresas/:id` | Borrar (409 si tiene candidaturas) |
| `GET` `POST` | `/postulaciones` | Listar (filtros + paginación) / crear |
| `GET` `PATCH` `DELETE` | `/postulaciones/:id` | Detalle con historial / editar / borrar |
| `POST` | `/postulaciones/:id/eventos` | Registrar un paso del proceso |
| `GET` | `/estadisticas` | Embudo, tiempos de respuesta, por mes |
| `GET` | `/salud` | Sonda de vida |

Filtros del listado: `estado`, `empresa_id`, `desde`, `hasta`, `limite`
(máx. 100) y `desplazamiento`.

## Cómo correrlo

```bash
cp .env.ejemplo .env          # y pon un JWT_SECRETO de verdad
docker compose up -d          # PostgreSQL 16
npm install
npm run migrar
npm run dev
```

Las pruebas necesitan una base de datos propia:

```bash
createdb postulaciones_prueba
DATABASE_URL_PRUEBA=postgresql://…/postulaciones_prueba npm test
```

## Licencia

MIT · [Daniel Buitrago](https://github.com/danielbuitragoh)


---

## English

A REST API for tracking job applications, with a full event history instead of a single status column that gets overwritten, and real response-time statistics.

Node, TypeScript, Express 5, PostgreSQL, Zod, Argon2id and Vitest, with 46 tests running against a real PostgreSQL database, no mocked pool. Every state change is a row in an events table that is never overwritten, so questions like how long companies take to answer, or how many of 40 applications reached an interview, actually have answers. Passwords are hashed with Argon2id at OWASP's recommended parameters, access tokens are short-lived JWTs with an explicit algorithm allowlist (there is a test that specifically tries to forge an alg none token), refresh tokens are hashed and rotated on every use, and authorization is enforced in the SQL WHERE clause, never in application code. There are eight route-by-route authorization tests, and two of them were verified by deliberately deleting the user filter and watching the suite turn red.

Code and comments are in Spanish. Ready-to-run request examples are in docs/peticiones.http.
