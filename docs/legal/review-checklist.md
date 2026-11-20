# Qué falta antes de publicar

Notas de trabajo, no un documento legal: `lib/legal.ts` no lo sirve nunca. Los
borradores de esta carpeta están escritos a partir del código y son exactos sobre lo
que hace el software. No son asesoramiento jurídico y no los ha leído nadie
cualificado.

Revisado contra el código el 2026-11-20. La versión anterior (2026-08-10) daba por
hechas cosas que ya no lo son: el audio ya no se borra a las 24 horas, la prueba ya
no es una hora más 2.000 subtítulos, y borrar una organización y la retención tras
cancelar ya existen.

---

## Lo que depende de la empresa

Se rellena el día que exista la sociedad, y no antes:

- `[ENTIDAD, DOMICILIO, NIF]` y `[ENTIDAD]` — en los tres documentos.
- `[TRATAMIENTO DEL IVA]` — condiciones, cláusula 3. Que lo confirme el gestor.
- `[LEY Y TRIBUNALES]` — condiciones, cláusula 11. Sigue al domicilio social.
- `[FECHA]` — el día que se publique.

## Lo que necesita un abogado

- `[RESPONSABILIDAD]` — condiciones, cláusula 9, y la remisión del encargo,
  sección 14. Es la cláusula que más probablemente se discuta.
- Una lectura completa de los tres documentos antes de publicar nada.

## Lo que necesita un buzón

- `[CONTACTO DE PRIVACIDAD]` — `captio.studio` no tiene registro MX, así que hoy
  ninguna dirección @captio.studio recibe correo. Hace falta un buzón real
  (privacidad@ o soporte@) antes de poder escribirla.

## Lo que necesita código

Los documentos no prometen lo que el software no cumple. Estos huecos bloquean la
publicación hasta que el código los cierre:

1. **`[BORRADO DE FICHEROS]`** — borrar un proyecto o una secuencia borra la fila
   `media` en cascada, pero no el objeto de R2. Sin fila, ni el barrido diario ni el
   borrado de la organización lo vuelven a encontrar: el vídeo se queda en el bucket
   para siempre. Es el más grave, porque contradice la frase «se borran cuando los
   borras tú».
2. **`[RETENCIÓN DE INVITADOS]`** — el nombre y el correo de quien revisa por enlace
   (`review_guests`) se guardan aunque el enlace haya caducado, hasta que se borra el
   enlace, el proyecto o la organización. Hay que decidir un plazo tras la caducidad
   y hacer que un barrido lo cumpla.
3. **`[BORRAR LA CUENTA PERSONAL]`** — se puede borrar una organización, pero no la
   cuenta de una persona (`user`, `session`, `account` sobreviven). Better Auth lo
   trae (`deleteUser`); falta activarlo y ponerle un botón.

Menor, sin hueco en los textos: si el correo de aviso antes de borrar una
organización cancelada falla para todos los propietarios, esa organización no se
borra nunca (`retention_warned_at` no se marca). Los textos dicen «después se borra
todo»; casi siempre es verdad.

4. **`[RETENCIÓN EN ELEVENLABS]`** — ElevenLabs guarda el audio y la transcripción
   por defecto, y su modo sin retención es solo para Enterprise. La API permite
   borrar cada transcripción (`DELETE /v1/speech-to-text/transcripts/{id}`) en
   cuanto llega; `app/api/transcribe/route.ts` no lo hace. Falta comprobar si ese
   borrado se lleva también el audio.

## Lo que necesita ajustes de cuenta

`[CONFIRMAR AJUSTES DE PROVEEDORES]` marca cada frase que solo es verdad con esto
hecho. Leído en las condiciones de cada proveedor el 2026-11-20 (fuentes al final
de [/subprocessors]):

1. **ElevenLabs** — *Data use* → desactivar «Improve the models for everyone». Sus
   condiciones le dan una licencia irrevocable para entrenar con el contenido de
   las cuentas que no lo desactivan, y lo enviado antes de desactivarlo no se
   recupera.
2. **Vercel** — el proyecto tiene que estar en **Pro**, no en Hobby. En Hobby sus
   condiciones permiten entrenar con el contenido, su acuerdo de tratamiento no se
   aplica, y el plan no es para uso comercial. En Pro, comprobar que el
   entrenamiento sigue desactivado en los ajustes del equipo.
3. **Google** — el proyecto de Google Cloud de `GEMINI_API_KEY` tiene que tener la
   facturación activa: solo así es «servicio de pago». Además, desactivar los
   registros de AI Studio si el proyecto se creó después del 26 de octubre de 2026
   (vienen activados y guardan las peticiones 55 días), y no compartir conjuntos de
   datos con Google.
4. **Groq** — consola → *Data Controls* → activar la retención cero.

Resend, Supabase, Cloudflare y Stripe no necesitan nada: su acuerdo de tratamiento
se aplica al aceptar sus condiciones.

## Decisiones tomadas en estos borradores

Valores puestos por defecto, que se pueden cambiar antes de publicar:

- **Idioma: español, y la versión española es la que vale** (condiciones, cláusula
  12). La interfaz habla español y un tribunal español lee español.
- **Avisos: 30 días** para cambiar precios, cambiar las condiciones y añadir un
  subencargado; **30 días** para corregir un incumplimiento antes de resolver.
- **Brechas: aviso al cliente en 48 horas**, para que él llegue a sus 72 ante la
  AEPD.
- **Auditorías: una al año, con 30 días de preaviso**, a costa del cliente salvo
  incumplimiento grave.
- **Conservación tras cancelar: 90 días** — no es una decisión nueva, es lo que ya
  hace `sweep-cancelled` (`lib/retention.ts`).
- **No hay herramienta de soporte que lea proyectos**, y la política se compromete
  a decirlo antes de usar una. Comprobado: ninguna consulta lee proyectos fuera de
  su organización salvo las que lista `tests/tenancy/scoping.test.ts`.

## Lo que necesita decidirse y escribirse

- `[MEDIDAS ORGANIZATIVAS]` — encargo, sección 10: quién tiene acceso a
  producción (Vercel, Supabase, R2, Stripe) y con qué protección (doble factor),
  qué copias de seguridad tiene la base de datos y cuánto duran, y qué se hace ante
  un incidente.
- Si algún día se vende «procesamiento solo en la UE», con qué proveedores y en qué
  plan. Hoy no se ofrece y los textos no lo prometen.

---

## Lo que ya es verdad y se puede decir sin matices

Comprobado en el código el 2026-11-20, no supuesto:

- Ni analítica, ni telemetría, ni grabación de sesiones, ni publicidad, ni servicio
  de errores. Las dependencias son solo `@stripe/stripe-js`, `better-auth`, `next`,
  `pg`, `react`, `react-dom`, `resend`, `stripe` y `zustand`.
- La fuente Inter la sirve Next desde nuestro dominio; ninguna IP de un visitante
  llega a un CDN de fuentes.
- Dos cookies, las dos necesarias: la de sesión de Better Auth y
  `review_guest_<enlace>` (30 días, `httpOnly`) para quien revisa por enlace. En
  `localStorage` solo preferencias de interfaz (`theme`, `captio.autosave`,
  `captio.viewer`, `captio.wave`). No hace falta banner de cookies.
- Funciones en Estocolmo (`vercel.json`, `arn1`), base de datos en `eu-north-1`,
  ficheros en un bucket R2 con jurisdicción europea.
- A los modelos de traducción llega el texto de los subtítulos, el glosario y el
  contexto de las cues anteriores; nunca nombres de organización, proyecto o
  persona usuaria. Al de transcripción le llega el fichero completo (vídeo incluido)
  por una dirección firmada de 15 minutos que él mismo descarga.
- Subidas firmadas para un objeto, una operación y un tamaño (hasta 1 GiB), 15
  minutos. Reproducción firmada, 12 horas.
- Enlaces de revisión: token aleatorio de 24 bytes, 30 días, revocables; los
  invitados solo alcanzan las rutas de `tests/tenancy/guest-surface.test.ts`.
