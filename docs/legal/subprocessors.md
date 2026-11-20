# Subencargados

Cada tercero al que llegan datos de clientes, sacado del código y no de memoria, con
las condiciones de cada uno citadas por su dirección para que se pueda volver a
comprobar en vez de creerse.

**Borrador. No lo ha revisado un abogado; no se publica.** Ver
`review-checklist.md`.

Comprobado contra el código y contra las condiciones de cada proveedor el
2026-11-20.

[CONFIRMAR AJUSTES DE PROVEEDORES — lo que esta página dice de ElevenLabs, Vercel,
Google y Groq solo es verdad con los ajustes de cuenta de `review-checklist.md`
hechos.]

---

## Quién es qué

Con el **contenido** —el vídeo, el audio, los subtítulos, las traducciones y los
comentarios, también los de quien revisa por enlace— el cliente es el responsable y
Captio el encargado. Ese material es de su producción y puede contener datos de
personas que nunca se registraron aquí: cualquiera que se oiga en la grabación o se
nombre en el diálogo.

Con los **datos de la cuenta** —correo, nombre, pertenencia a la organización,
facturación— el responsable es Captio.

Ese reparto decide quién atiende una petición de acceso: alguien filmado en una
entrevista se dirige a la productora, no a nosotros.

---

## La lista

| Subencargado (con quién se contrata) | Qué hace | Dónde | Qué le llega | Transferencia | ¿Entrena con ello? |
|---|---|---|---|---|---|
| **Vercel** (Vercel Inc., EE. UU.) | Alojamiento y funciones | Funciones en Estocolmo (`arn1`); la empresa procesa principalmente en EE. UU. | Todo, de paso; registros de ejecución de 1 día | Marco de Privacidad UE-EE. UU. y cláusulas tipo | No, en el plan Pro con la opción de entrenamiento desactivada |
| **Supabase** (Supabase Pte. Ltd., Singapur) | Base de datos Postgres | Estocolmo (`eu-north-1`) | Cuentas, organizaciones, proyectos, subtítulos, comentarios, invitados de revisión, registros de uso | Cláusulas tipo | No |
| **Cloudflare R2** (Cloudflare, Inc., EE. UU.) | Ficheros de audio y vídeo | Jurisdicción UE: los objetos se guardan en la UE | El audio y el vídeo subidos | Marco de Privacidad y cláusulas tipo | No |
| **Resend** (Plus Five Five, Inc., EE. UU.) | Correo transaccional | Envía desde Irlanda (`eu-west-1`); guarda la cuenta, los registros y los correos en EE. UU., 30 días | Direcciones, nombres y el texto de cada correo, también el de los comentarios | Cláusulas tipo (su certificación en el Marco está en revisión) | No |
| **Stripe** (Stripe Payments Europe, Ltd., Irlanda) | Pagos | Irlanda y EE. UU. | Correo de quien paga y datos de pago; nunca grabaciones ni subtítulos | Marco de Privacidad (Stripe, LLC) y cláusulas tipo | Entrena sus sistemas antifraude con datos de pago, como responsable por su cuenta |
| **ElevenLabs** (Eleven Labs Inc., EE. UU.) | Transcripción | EE. UU. | El fichero subido completo, vídeo incluido, y los términos del glosario | Marco de Privacidad y cláusulas tipo | No: lo haría por defecto, y está desactivado en nuestra cuenta |
| **Google**, Gemini API de pago (Google Cloud EMEA Ltd., Irlanda) | Traducción y revisión | Cualquier país donde Google tenga instalaciones | El texto de los subtítulos, el glosario y las instrucciones | Marco de Privacidad (Google LLC) y cláusulas tipo | No; guarda las peticiones 55 días para vigilar abusos |
| **Groq** (Groq UK Ltd., Reino Unido) | Traducción, solo si Gemini falla | EE. UU. | El texto de los subtítulos | Cláusulas tipo | No; retención cero activada |

«Marco de Privacidad» es el Marco de Privacidad de Datos UE-EE. UU.; «cláusulas
tipo», las cláusulas contractuales tipo de la Comisión Europea. Todos los
proveedores las incluyen en su acuerdo de tratamiento, que forma parte de sus
condiciones sin firma aparte.

De dónde sale cada fila en el código: `vercel.json` (`regions`), el host de
`DATABASE_URL`, `lib/storage/r2.ts` con `R2_JURISDICTION`, `lib/email/send.ts`,
`lib/stripe.ts`, y los puntos de acceso de `app/api/transcribe/route.ts` y
`app/api/translate/route.ts`.

### Nada más

Ni analítica, ni telemetría, ni grabación de sesiones, ni publicidad, ni gestor de
etiquetas, ni servicio de errores. Comprobado en `package.json` y buscando en `app/`,
`lib/` y `components/`. Las fuentes las sirve Next desde nuestro dominio, así que la
IP de un visitante no llega a ningún CDN de fuentes.

Es una lista corta para un producto así, y merece la pena defenderla: cada fila que
se añade es un párrafo del acuerdo de tratamiento y una pregunta en la revisión de
compras de alguien.

---

## Lo que cada proveedor hace con lo que le llega

**ElevenLabs.** Sus condiciones le dan una licencia para usar el contenido para
mejorar sus servicios y entrenar modelos, salvo que la cuenta lo desactive
(«Improve the models for everyone», en *Data use*). La desactivación no afecta a lo
enviado antes. Guarda el audio y la transcripción por defecto; el modo sin
retención (`enable_logging=false`) y la residencia en la UE son solo para su plan
Enterprise.

[RETENCIÓN EN ELEVENLABS — hoy guarda el audio y la transcripción sin plazo
definido; la API permite borrar cada transcripción en cuanto se recibe, y el código
aún no lo hace.]

**Google.** Con la Gemini API de pago no usa las peticiones ni las respuestas para
mejorar sus productos. Las guarda 55 días solo para vigilar usos prohibidos, y ese
registro puede servir para entrenar los sistemas que detectan esos usos, no los
modelos que traducen. Para quien desarrolla desde la UE se aplican las condiciones
de pago incluso a la parte gratuita, y solo la de pago puede usarse en productos
para usuarios europeos.

**Groq.** Sus condiciones le prohíben entrenar con lo que recibe salvo permiso
expreso. Con la retención cero activada no guarda ni el registro de 30 días que
mantiene por defecto para depurar y vigilar abusos.

**Vercel.** En el plan Hobby sus condiciones le permiten entrenar con el contenido
y su acuerdo de tratamiento no se aplica; en Pro el entrenamiento está desactivado
por defecto y el acuerdo sí se aplica. Captio tiene que estar en Pro.

---

## Fuentes

Leídas el 2026-11-20:

- ElevenLabs — condiciones UE `elevenlabs.io/terms-of-use-eu` (§4), acuerdo de
  tratamiento `elevenlabs.io/dpa` (§11, cláusulas tipo), modo sin retención
  `elevenlabs.io/docs/eleven-api/resources/zero-retention-mode`, residencia
  `elevenlabs.io/docs/overview/administration/data-residency`, Marco de Privacidad
  `dataprivacyframework.gov/participant/9996`.
- Google — condiciones adicionales de la Gemini API `aistudio.google.com/docs/terms`,
  vigilancia de abusos `aistudio.google.com/docs/usage-policies`, registros
  `aistudio.google.com/docs/logs-datasets`, acuerdo de tratamiento
  `business.safety.google/processorterms`.
- Groq — `console.groq.com/docs/legal/services-agreement` (§4.2),
  `console.groq.com/docs/your-data`,
  `console.groq.com/docs/legal/customer-data-processing-addendum` (§8.2).
- Vercel — `vercel.com/legal/terms` (§3), `vercel.com/legal/dpa`.
- Supabase — `supabase.com/terms` (§6), `supabase.com/legal/dpa` (§6, §12.2).
- Cloudflare — `cloudflare.com/cloudflare-customer-dpa` (§6),
  `developers.cloudflare.com/r2/reference/data-location`.
- Resend — `resend.com/legal/dpa` (§6), `resend.com/docs/dashboard/domains/regions`,
  `resend.com/pricing`.
- Stripe — `stripe.com/en-es/legal/dpa`, `stripe.com/en-es/legal/dta`,
  `stripe.com/en-es/privacy`.

---

## Decidido: un solo proveedor por tarea

OpenRouter, Mistral y OpenAI se quitaron en agosto. OpenRouter elegía el proveedor
final en cada petición, y un acuerdo de tratamiento tiene que nombrar a sus
subencargados y avisar antes de cambiarlos. La traducción va por Gemini, con Groq
solo como respaldo que nunca aparece en la interfaz, y la transcripción por
ElevenLabs.

Ninguno procesa en la UE en los planes que usamos. Si algún día se vende
«procesamiento solo en la UE», hará falta otro proveedor o un plan Enterprise; hoy
no se ofrece y estos textos no lo prometen.
