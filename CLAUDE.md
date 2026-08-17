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

**Base del lint: 6 avisos, 3 de ellos errores.** Son previos y conocidos
(`app/pricing/page.tsx`, un componente creado en render en `EditorArea`, un
`setState` en efecto en `ProjectBar`). Si tras un cambio salen 7, el séptimo es
tuyo.

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
`Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
