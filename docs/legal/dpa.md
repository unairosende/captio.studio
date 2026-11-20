# Acuerdo de encargo de tratamiento

**Borrador. No lo ha revisado un abogado; ni se publica ni se firma.** Es el
documento que el departamento de compras de una cadena lee con más cuidado, y
donde una frase equivocada es un incumplimiento y no un descuido.

Última actualización: [FECHA]

Entre **[ENTIDAD]** («el Encargado») y el cliente («el Responsable»), como parte de
las Condiciones del servicio y conforme al artículo 28 del RGPD.

---

## 1 · Objeto

Captio trata datos personales por cuenta del Responsable para transcribir,
traducir, revisar y guardar contenido de subtítulos, y para que el Responsable lo
comparta con sus propios clientes mediante enlaces de revisión. El Responsable
decide qué se sube y para qué; el Encargado solo sigue sus instrucciones.

## 2 · Duración

El tratamiento dura lo que dure la cuenta del Responsable y, tras cancelarla, los
90 días de conservación que fijan las Condiciones, salvo que el Responsable borre
antes su organización.

## 3 · Naturaleza y finalidad

Guardar proyectos de subtítulos y los ficheros de audio y vídeo que se suben;
transcribir ese audio a texto con tiempos; traducir, acortar y revisar el texto;
mostrarlo al equipo del Responsable y a quien este invite a revisarlo; avisar por
correo de los comentarios; y llevar los registros de uso que el servicio necesita
para funcionar y facturarse.

## 4 · Tipos de datos personales

El Responsable decide qué contiene una grabación, así que el Encargado no puede
enumerarlo del todo. En la práctica:

- **En los ficheros y los subtítulos**: voces, imagen, nombres y lo que las personas
  grabadas digan de sí mismas o de otras. Una voz grabada ya es un dato personal, y
  el diálogo suele contener mucho más.
- **En la revisión por enlace**: nombre y correo de quien revisa, cuándo abrió el
  enlace, y sus comentarios y correcciones.
- **En la cuenta**: nombre, correo y pertenencia a la organización del personal del
  Responsable.

**Pueden aparecer categorías especiales.** Una entrevista documental puede contener
salud, opiniones políticas, religión, orientación sexual o antecedentes penales —no
como un campo que alguien rellena, sino como algo que una persona dice ante la
cámara—. Corresponde al Responsable saber cuándo ocurre y tener una base legal
conforme al artículo 9. El Encargado no puede detectarlo y no lo intenta.

## 5 · Categorías de interesados

Cualquier persona que aparezca o se nombre en las grabaciones del Responsable, el
personal del Responsable con cuenta en Captio, y las personas a las que el
Responsable envía un enlace de revisión.

## 6 · Obligaciones del Encargado

El Encargado:

- trata los datos solo siguiendo instrucciones documentadas del Responsable,
  también en lo relativo a transferencias;
- obliga a confidencialidad a todas las personas con acceso;
- aplica las medidas de la sección 10;
- recurre a subencargados solo como permite la sección 7;
- ayuda al Responsable a atender las peticiones de los interesados;
- ayuda con las brechas de seguridad, las evaluaciones de impacto y las consultas
  previas;
- borra o devuelve los datos al terminar, según la sección 12;
- pone a disposición del Responsable lo necesario para demostrar todo lo anterior.

## 7 · Subencargados

El Responsable da una autorización general a los subencargados que figuran en
[/subprocessors], que se mantiene al día y cita el código del que se obtuvo.

El Encargado avisará con **30 días** de antelación antes de añadir o sustituir uno.
El Responsable puede oponerse por motivos razonables de protección de datos; si la
objeción no se resuelve, puede dar por terminado el servicio afectado sin
penalización por el resto del periodo.

Cada subencargado está obligado por un acuerdo de tratamiento que forma parte de
sus propias condiciones, con obligaciones de confidencialidad, seguridad, ayuda y
borrado equivalentes a las de este acuerdo. Las direcciones de cada uno están al
final de [/subprocessors]. El de Vercel solo cubre sus planes Pro y Enterprise, y
Captio está en Pro.

[CONFIRMAR AJUSTES DE PROVEEDORES — plan de Vercel incluido; ver
`review-checklist.md`.]

## 8 · Transferencias internacionales

El cálculo, la base de datos y el almacenamiento de ficheros están en la UE: las
funciones en Estocolmo, la base de datos en `eu-north-1` y los ficheros en un
almacenamiento con jurisdicción europea, que el punto de acceso no europeo ni
siquiera puede ver.

Los proveedores de IA están fuera de la UE, y el audio o el vídeo y el texto de los
subtítulos se les envían para procesarlos. Cada transferencia se ampara en las
cláusulas contractuales tipo de la Comisión Europea incluidas en el acuerdo de
tratamiento del proveedor y, cuando está certificado, también en el Marco de
Privacidad de Datos UE-EE. UU.:

| Subencargado | Datos | Mecanismo |
|---|---|---|
| ElevenLabs (Eleven Labs Inc., EE. UU.) | Audio y vídeo, para transcribir | Marco de Privacidad y cláusulas tipo |
| Google, Gemini API de pago (Google Cloud EMEA Ltd., Irlanda) | Texto de subtítulos; puede almacenarse temporalmente en cualquier país donde Google tenga instalaciones | Marco de Privacidad (Google LLC) y cláusulas tipo |
| Groq (Groq UK Ltd.; datos en EE. UU.) | Texto de subtítulos, solo si Gemini falla | Cláusulas tipo |
| Resend (Plus Five Five, Inc., EE. UU.) | Correos, incluido el texto de los comentarios | Cláusulas tipo |
| Vercel (Vercel Inc., EE. UU.) | Todo, de paso por las funciones | Marco de Privacidad y cláusulas tipo |
| Supabase (Supabase Pte. Ltd., Singapur) | Base de datos alojada en `eu-north-1` | Cláusulas tipo |
| Cloudflare (Cloudflare, Inc., EE. UU.) | Ficheros guardados en la UE | Marco de Privacidad y cláusulas tipo |

Con los proveedores que usa no hay hoy procesamiento solo en la UE, y este acuerdo
no lo ofrece.

## 9 · Entrenamiento de modelos

Ni el Encargado ni sus subencargados usan el contenido del Responsable para
entrenar o mejorar modelos de IA:

- **Google** lo excluye en las condiciones de la Gemini API de pago. Guarda las
  peticiones 55 días solo para vigilar usos prohibidos.
- **Groq** lo tiene prohibido por su contrato salvo permiso expreso, que no se ha
  dado, y con la retención cero activada no guarda ni siquiera registros.
- **ElevenLabs** lo haría por defecto según sus condiciones; el Encargado lo tiene
  desactivado en su cuenta. [RETENCIÓN EN ELEVENLABS — hoy guarda el audio y la
  transcripción sin plazo definido.]

[CONFIRMAR AJUSTES DE PROVEEDORES — esta sección solo es verdad con los ajustes de
cuenta de `review-checklist.md` hechos.]

## 10 · Medidas de seguridad

Descritas como lo que hace el software, para que cada una se pueda comprobar en vez
de creerse:

- **Aislamiento entre clientes.** Cada consulta a la base de datos se limita a una
  organización. Una prueba automática lee el SQL de la capa de datos y hace fallar
  la compilación si alguna sentencia sobre tablas de clientes no lleva ese filtro:
  el aislamiento es una propiedad comprobada, no una costumbre.
- **Subidas.** Los ficheros van del navegador al almacenamiento con una dirección
  firmada para un único objeto, una única operación y un tamaño declarado, que
  caduca a los quince minutos. El tamaño forma parte de la firma, así que lo impone
  el propio almacenamiento.
- **Reproducción.** Las direcciones para ver un fichero se firman en el servidor y
  caducan; el proveedor de transcripción recibe una que caduca a los quince minutos.
- **Revisión por enlace.** El enlace es una credencial aleatoria de 24 bytes que
  caduca a los 30 días o al revocarse, solo da acceso a lo que comparte y solo
  puede escribir texto de subtítulos y comentarios; nunca la forma de la pista ni
  nada de facturación o de IA.
- **Residencia.** La de la sección 8.
- **Cifrado.** En tránsito con TLS en todo el recorrido; en reposo, el de los
  proveedores de almacenamiento y de base de datos.
- **Control de acceso.** La pertenencia a la organización se vuelve a comprobar en
  cada petición en vez de fiarse de la sesión, así que quitar a alguien surte
  efecto en su petición siguiente.
- **Secretos.** Las credenciales de los proveedores viven en variables de entorno
  de la plataforma y nunca llegan al navegador.

[MEDIDAS ORGANIZATIVAS — quién tiene acceso a producción y cómo, copias de
seguridad de la base de datos y su plazo, y procedimiento ante incidentes. No se
leen del código: hay que decidirlas y escribirlas.]

## 11 · Brechas de seguridad

El Encargado notificará al Responsable cualquier brecha que afecte a sus datos sin
dilación indebida y, en todo caso, dentro de las **48 horas** siguientes a tener
conocimiento de ella, con la información disponible para que el Responsable pueda
cumplir su propio plazo de 72 horas ante la autoridad.

## 12 · Borrado y devolución

El Responsable puede exportar sus subtítulos y traducciones cuando quiera desde el
editor, en todos los formatos disponibles, sin pedírselo al Encargado.

Puede borrar su organización en cualquier momento, y con ella todo lo que contiene.
Si cancela sin borrarla, el Encargado conserva los datos 90 días desde el final del
último periodo pagado, avisa a los propietarios al menos siete días antes, y
después los borra.

[BORRADO DE FICHEROS — hoy, borrar un proyecto o una secuencia no borra su audio ni
su vídeo del almacenamiento. No se firma esta cláusula hasta que se arregle.]

## 13 · Auditoría

El Encargado pondrá a disposición la información necesaria para demostrar el
cumplimiento y colaborará en las auditorías, con un preaviso de **30 días** y no
más de **una vez al año**, a costa del Responsable salvo que se descubra un
incumplimiento grave.

## 14 · Responsabilidad

La de las Condiciones del servicio. [La cláusula 9 de las Condiciones aún no está
escrita, así que esta remisión no vale nada hasta que exista.]
