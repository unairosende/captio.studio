@AGENTS.md

# captio-studio — guía del proyecto

Producto comercial de subtitulado: transcribir, traducir, revisar y exportar.
Es la reconstrucción de `sub-translate` (`~/Documents/GitHub/sub-translate`), que
sigue vivo dando servicio a la oficina. **Aquel no se toca**; su núcleo ya está
portado aquí.

Next 16 (App Router) · React 19 · TypeScript · Postgres con el driver `pg` a pelo
· Better Auth con el plugin `organization` · R2 para media · Stripe · Vercel ·
Claude (API de Anthropic) para el asistente de proyecto nuevo.

## Comandos

```bash
npm test         # sin base de datos
npm run test:db  # con DATABASE_URL; incluye los *.db.test.ts
npm run typecheck
npm run lint
npm run migrate  # runner propio, tabla schema_migrations
```

El servidor de desarrollo se arranca con la herramienta de vista previa, no con
`npm run dev` a mano: `.claude/launch.json` define `captio-dev` en el puerto 3000.

`migrate` y `test:db` leen `.env.local`. Sin ese archivo (una sesión en la nube)
se llaman a pelo: `DATABASE_URL=… node db/migrate.ts` y
`DATABASE_URL=… node --test "tests/**/*.test.ts"`. Sobre un Postgres vacío, la
0010 exige antes los roles de Supabase (`anon`, `authenticated`,
`service_role`), y los tests piden la fila de `deployment_environment`.

**Base del lint: 0 avisos.** Si tras un cambio sale uno, es tuyo. Eran 5
hasta que el rediseño del editor se llevó por delante `EditorArea` y
`SequenceBar`, y el último vivía en la página de precios vieja.

## Estructura

```
app/            rutas y páginas; app/api/** son route handlers
components/     interfaz por área (editor, timeline, comments, team, assistant…)
lib/db/         acceso a datos, TODO filtrado por organización
lib/auth/       Better Auth (server/client), sesión, plazos de caducidad
lib/subtitles/  núcleo puro: timecodes, parsers, QC, formatos, hoja multi-idioma
lib/timeline/   vista, arrastre, transporte, cabezal, lectura de "ir a"
lib/email/      plantillas y envío por Resend
lib/jobs/       subir, leer un archivo y traducir por tandas; los usan editor y asistente
lib/assistant/  el asistente: instrucciones, turno, esquema de respuesta y su validación
db/migrations/  SQL numerado + db/migrate.ts
store/          zustand: cues, traducciones, deshacer, anclas de comentarios
tests/          *.test.ts puros; *.db.test.ts exigen base de datos
```

## Reglas que cuestan caro si se rompen

**La organización es la unidad de permisos y de facturación.** Cada tabla lleva
`org_id` directo, no por join. El id **sale siempre de la sesión en el servidor**,
nunca del cliente: si una ruta lo aceptara del navegador, cada `where org_id = $1`
filtraría obedientemente por el inquilino equivocado. El aislamiento vive en
`lib/db`, no en RLS — con Better Auth no hay `auth.uid()`, y RLS no sería
portable. El precio de esa decisión: **los tests de tenencia son obligatorios**.

**El bloqueo optimista usa el entero `version`, jamás `updated_at`.** Postgres
guarda microsegundos y el `Date` de JS milisegundos, así que el valor que devuelve
el cliente no coincide nunca y *todos* los guardados dirían "alguien te pisó".

**Los comentarios apuntan a un número de cue, y los números se mueven.** Partir o
borrar renumera. Los desplazamientos viajan con el guardado y se aplican **en la
misma transacción** que los cues; si se separan, cada nota por debajo de la
edición cita una línea que nadie escribió, y en pantalla todo parece correcto.

**`npm run test:db` escribe en la base de verdad.** Solo corre si la base se
declara desechable (tabla `deployment_environment`), y limpia por cascada.

**Los correos no lanzan excepción: `sendMail` devuelve `false`.** Y Better Auth
ejecuta `sendInvitationEmail` como tarea en segundo plano, así que ese fallo
**nunca llega al navegador**. No construyas avisos de "no se pudo enviar"
apoyados en eso; el enlace copiable del panel de equipo es la vía que sí funciona.

**Los plazos de los enlaces viven en `lib/auth/expiry.ts`.** La configuración y
el texto que lee el cliente salen de ahí. No escribas "siete días" a mano.

**El cliente entra por un enlace de revisión, no por una cuenta.** El token
(`review_links.token`) es la credencial y **produce** el `org_id` en el
servidor — `getLinkByToken` es la única consulta sin `org_id` permitida en
`lib/db`, y `tests/tenancy/scoping.test.ts` la nombra. Todo lo que un invitado
puede tocar son las rutas que llaman a `requireActor` (`lib/auth/actor.ts`);
`tests/tenancy/guest-surface.test.ts` fija esa lista. Añadir `requireActor` a
`translate` o `transcribe` dejaría a un desconocido gastar los minutos de la org.

**Un corte vertical es el mismo material que su original.** Cada secuencia
guarda su formato (`output_mode`) y, si se cortó de otra, de cuál
(`derived_from`, migración 0014). El corte reproduce la subida del original y se
cobra con él (`billSequenceMaterial`, `markDerivativesPaid`, `inheritPayment`):
los minutos se cobran una vez por material, en todos los formatos e idiomas. Por
eso `/api/translate` pregunta `materialPaid` antes que el saldo: traducir
material ya cobrado pasa aunque no queden minutos; el material nuevo y las demás
tareas, no. Con el saldo primero, el cobro de la primera tanda bloqueaba la
segunda y los demás idiomas: media traducción, y los minutos ya gastados.

**El asistente (`/projects/new`) no crea nada por su cuenta.** El modelo
responde en un esquema JSON que `lib/assistant/reply.ts` vuelve a validar, y el
trabajo corre en la pestaña por las mismas rutas que el editor, así que saldo,
tenencia y cobro único se aplican igual. Cada turno es una petición sin
historial (la conversación viaja como datos) para que el prompt de sistema,
cacheado, no cambie nunca. La clave es `ANTHROPIC_API_KEY` de una organización
de Console, nunca el login de una suscripción de claude.ai. Anthropic figura
como subencargado en `docs/legal/subprocessors.md`: si cambia lo que un turno
le envía, esa fila cambia con él.

**Una vista previa de Vercel no es producción con otra dirección.**
`BETTER_AUTH_URL` apunta a producción, así que `lib/auth/server.ts` confía
además en las dos direcciones de la propia vista previa (`VERCEL_URL`,
`VERCEL_BRANCH_URL`), nunca en `*.vercel.app`, que sería confiar en cualquier
web alojada allí. Las variables van por entorno: lo que una PR necesita
(Anthropic, Gemini, Groq, R2, ElevenLabs) se activa también para Preview y se
redespliega después; subir desde una vista previa exige su origen en el CORS
del bucket.

**Cada guardado de cues es una versión** (`sequence_versions`, dentro de la
misma transacción). Los guardados del mismo autor en 10 minutos se aplastan en
una. El cliente solo escribe texto por cue (`POST /api/sequences/[id]/edits`);
la forma del track — cues, timings, idiomas — nunca sale de una petición suya.

## Estilo

El rediseño (dirección B · Consola, disciplina de Linear) es el producto desde
el 19 de septiembre de 2026. Tokens en `app/tokens.css` (`light-dark()` para
claro y oscuro; bordes y lavados con `color-mix()` sobre la tinta), piezas en
`app/ui.css` (`.btn`, `.field`, `.panel`, `.row`, `.caps`, `.cues`…), y la
maquetación de cada pantalla en su `*.module.css`. **`/styleguide` es la
verdad: si algo no está allí, no existe.** Reglas que evitan volver al desorden:

- Ningún `style={{}}` con un valor que ya tenga nombre (color, tamaño, radio,
  espacio). Un valor de un solo uso va en el módulo de la pantalla; en línea
  solo cabe lo que se calcula (un ancho en %, la posición de un menú) o el
  parámetro de una pieza (`--panel-w`, `--cols`).
- Los estados no son clases: `:hover`, `:focus-visible`, `:disabled`,
  `aria-busy`, `aria-selected`, `aria-invalid`. Un botón ocupado lleva
  `aria-busy`, no otro texto.
- Componente que aparece dos veces, componente que se extrae. Un diálogo es
  `components/Dialog.tsx`: velo, panel, Esc y foco de vuelta van dentro.
- El acento cede dentro del editor: selección y foco neutros; ámbar, rojo y
  verde son del control de calidad y de nadie más.
- La interfaz habla español. Los errores de Better Auth se traducen por su
  código, no por su mensaje.

Tres de estas reglas no dependen de que alguien se acuerde: `tests/design/`
mide el contraste de los tokens, comprueba que cada clase de `ui.css` sale en
`/styleguide` y la usa el producto, y rechaza cualquier literal en un
`style={{}}` fuera de la guía. Si `npm test` falla ahí, la regla se ha roto;
no se afloja el test, se arregla la pantalla.

## Commits

Un commit por cambio lógico, nunca varios asuntos juntos. Resumen imperativo
corto, y el cuerpo explicando **por qué**, no qué. Terminar con:
`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
