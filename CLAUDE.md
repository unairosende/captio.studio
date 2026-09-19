@AGENTS.md

# captio-studio — guía del proyecto

Producto comercial de subtitulado: transcribir, traducir, revisar y exportar.
Es la reconstrucción de `sub-translate` (`~/Documents/GitHub/sub-translate`), que
sigue vivo dando servicio a la oficina. **Aquel no se toca**; su núcleo ya está
portado aquí.

Next 16 (App Router) · React 19 · TypeScript · Postgres con el driver `pg` a pelo
· Better Auth con el plugin `organization` · R2 para media · Stripe · Vercel.

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

**Base del lint: 0 avisos.** Si tras un cambio sale uno, es tuyo. Eran 5
hasta que el rediseño del editor se llevó por delante `EditorArea` y
`SequenceBar`, y el último vivía en la página de precios vieja.

## Estructura

```
app/            rutas y páginas; app/api/** son route handlers
components/     interfaz por área (editor, timeline, comments, team, palette…)
lib/db/         acceso a datos, TODO filtrado por organización
lib/auth/       Better Auth (server/client), sesión, plazos de caducidad
lib/subtitles/  núcleo puro: timecodes, parsers, QC, formatos, hoja multi-idioma
lib/timeline/   vista, arrastre, transporte, cabezal, lectura de "ir a"
lib/email/      plantillas y envío por Resend
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

**Cada guardado de cues es una versión** (`sequence_versions`, dentro de la
misma transacción). Los guardados del mismo autor en 10 minutos se aplastan en
una. El cliente solo escribe texto por cue (`POST /api/sequences/[id]/edits`);
la forma del track — cues, timings, idiomas — nunca sale de una petición suya.

## Estilo

Tokens y clases en `app/globals.css` (`.btn`, `.field`, `.panel`, `.row`,
`.caps`…). Quedan objetos `style={{}}` inline de un solo uso, y está bien: **hay
un rediseño desde cero en camino**, a partir de referencias que traerá Unai. No
pulas el aspecto actual ni conviertas maquetación puntual en clases nuevas —
sería escribir marcado para un diseño que todavía no hemos visto. Lo que sí
importa es no reintroducir duplicación: si un botón o un panel ya se repite,
tiene clase.

## Commits

Un commit por cambio lógico, nunca varios asuntos juntos. Resumen imperativo
corto, y el cuerpo explicando **por qué**, no qué. Terminar con:
`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
