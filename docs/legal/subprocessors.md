# Subprocessors

Every third party that customer data reaches, taken from the code rather than
from memory. Sources are named so this can be re-checked against a later commit
instead of trusted.

**Status: draft. Not reviewed by a lawyer.** See `review-checklist.md` for the
questions that have to be answered before any of this is published.

Last verified against the codebase: 2026-08-10.

---

## Who is what

For **subtitle content and media** — the video, the audio, the cues, the
translations — the customer is the controller and Captio is the processor. That
material belongs to their production and may contain personal data about people
who never signed up here: everybody audible in the recording, everybody named in
the dialogue.

For **account data** — email address, name, organisation membership, billing —
Captio is the controller.

The split decides who answers a subject access request. Somebody filmed in an
interview asks the production company, not us.

---

## The list

| Subprocessor | What it does | Where | What reaches it |
|---|---|---|---|
| **Vercel** | Hosting and serverless compute | Stockholm (`arn1`) | Everything, in transit |
| **Supabase** | Postgres database | Stockholm (`eu-north-1`) | Account data, organisations, projects and their cues, comments, usage records |
| **Cloudflare R2** | Media storage | EU jurisdiction | Uploaded audio |
| **Resend** (on AWS SES) | Transactional email | Ireland (`eu-west-1`) | Email addresses, names in invitations |
| **Stripe** | Payments | US / Ireland | Billing contact and payment data |
| **ElevenLabs** | Transcription | United States | Audio |
| **Google** (Gemini) | Translation | United States / global | Subtitle text |
| **Groq** | Translation, only when Gemini is unavailable | United States | Subtitle text |

Sources: `vercel.json` (`regions`), the `DATABASE_URL` host, `lib/storage/r2.ts`
with `R2_JURISDICTION`, the MX record on `send.captio.studio`, `lib/stripe.ts`,
the endpoints in `app/api/translate/route.ts` and `app/api/transcribe/route.ts`,
and `lib/providers.ts`.

### Nothing else

No analytics, no product telemetry, no session recording, no advertising pixels,
no tag manager, no error-reporting service. Verified by grep across `app/`,
`lib/`, `components/` and `package.json`. Fonts are self-hosted at build time, so
no visitor IP reaches a font CDN.

The only cookie is the session cookie set by Better Auth, strictly necessary to
keep somebody signed in. On the current build there is nothing to ask consent
for and no cookie banner is needed.

That is unusually short for a SaaS product and it is worth defending. Every item
added to this table is a paragraph in the DPA and a question in somebody's
procurement review.

---

## Resolved: OpenRouter is gone

OpenRouter was a broker. It forwarded to whichever model provider it picked,
and that provider was not known in advance and could change without notice. A
DPA has to name its subprocessors and give notice before they change, and
neither is possible for a party chosen per-request by somebody else.

It was removed rather than disclosed, along with Mistral and OpenAI. Translation
now runs on Gemini alone with Groq as a fallback that never appears in the
interface, and transcription on ElevenLabs. Ten rows became eight, and the
model dropdown — which asked a production company to choose between
`qwen-qwq-32b` and `llama-3.3-70b-versatile` — is gone with it.

## Still to decide: audio and subtitle text leave the EU

Storage, database and compute were all deliberately placed in the EU. The AI
providers undo part of that: ElevenLabs, Google and Groq are US companies, and a
transcription hands them the recorded voices of everybody in the room.

Not automatically a problem, but it is the first thing a European production
company will ask about, and the answer has to be specific. See
`review-checklist.md`.

Consolidating removed the one EU-based translation provider there was. Mistral
hosts in France, and if EU-only processing is ever sold as a feature it is the
obvious thing to bring back — as a server-side choice for those customers, not
as a row in a dropdown for everybody.
