# Data Processing Agreement — DRAFT

**Not reviewed by a lawyer. Do not publish or sign.** This is the document a
broadcaster's procurement department reads most carefully, and the one where a
wrong sentence is a breach rather than an embarrassment.

Last updated: [DATE]

Between **[LEGAL ENTITY]** ("Processor") and the customer ("Controller"), forming
part of the Terms of Service.

---

## 1 · What this covers

Captio processes personal data on the Controller's behalf in order to
transcribe, translate and store subtitle content. The Controller decides what is
uploaded and why; the Processor acts only on those instructions.

## 2 · Subject matter and duration

Processing lasts as long as the Controller's account, plus any wind-down period
agreed in the Terms.

## 3 · Nature and purpose

Storing subtitle projects, transcribing uploaded audio into timed text,
translating that text between languages, and keeping the account and billing
records the service needs in order to run.

## 4 · Types of personal data

The Controller decides what a recording contains, so the Processor cannot list
this exhaustively. In practice:

- **In the media and subtitles**: voices, names, and whatever the people
  recorded happen to say about themselves or others. A recorded voice is
  personal data. Dialogue routinely contains a great deal more.
- **In the account**: names, email addresses, organisation membership.
- **In billing**: billing contact details, handled by Stripe.

**Special categories may occur.** A documentary interview can contain health,
political opinion, religion, sexual orientation or criminal history — not as a
field somebody filled in, but as something a person said on camera. The
Controller is responsible for recognising when that is so and for having a
lawful basis under Article 9. The Processor cannot detect it and does not try.

## 5 · Categories of data subject

Anybody appearing or named in the Controller's recordings, and the Controller's
own staff who hold accounts.

## 6 · Processor obligations

The Processor will:

- process only on documented instructions, including as to transfers;
- keep everybody with access under a duty of confidentiality;
- apply the measures in section 9;
- engage subprocessors only as section 7 allows;
- assist with data subject requests, given the Controller's own limited access
  to the underlying material;
- assist with security incidents, impact assessments and prior consultation;
- delete or return the data at the end, per section 10;
- make available what is needed to demonstrate all of the above.

## 7 · Subprocessors

The Controller gives general authorisation to the subprocessors listed at
[/subprocessors], which is kept current and cites the code it was derived from.

The Processor will give **[NOTICE PERIOD]** notice before adding or replacing
one. The Controller may object on reasonable data-protection grounds; if the
objection cannot be resolved, the Controller may terminate the affected service
without penalty for the remainder of the term.

Each subprocessor is bound by obligations no weaker than these.
**[Confirm this is actually true of each — see review-checklist.md item 3.]**

## 8 · International transfers

Compute, database and media storage are in the EU: functions in Stockholm, the
database in `eu-north-1`, media in an EU-jurisdiction bucket that the non-EU
endpoint cannot reach.

Some AI providers are outside the EU, and audio and subtitle text are sent to
them to be processed.

**[TRANSFER MECHANISM — see review-checklist.md item 2. Name, per provider,
either the EU–US Data Privacy Framework or Standard Contractual Clauses, and
attach a transfer impact assessment if one is required. Do not write this
paragraph from assumption; it is the one most likely to be checked against the
provider's published terms.]**

**[MODEL TRAINING — see review-checklist.md item 1. The Controller will want an
unambiguous statement that their unreleased dialogue is not used to train third
party models. Write it only once every provider's terms have been read.]**

Where a Controller requires EU-only processing, the provider is selected per
request and can therefore be restricted — a configuration change rather than a
rewrite. **[Whether that is offered, and on which plans, is a product
decision.]**

## 9 · Security measures

Stated as what the software does, so each can be verified rather than believed:

- **Tenant isolation.** Every database query is scoped by organisation. An
  automated test reads the SQL in the data-access layer and fails the build if
  any statement touching customer tables lacks that filter, which makes
  isolation a checked property rather than a convention.
- **Upload authorisation.** Media goes straight from the browser to object
  storage with a URL signed for a single object, a single method and a single
  declared size, expiring after fifteen minutes. The size is part of the
  signature, so the storage layer enforces it.
- **Media minimisation.** Uploaded audio is deleted about a day after upload by
  a scheduled job, with a lifecycle rule on the bucket underneath as a second
  mechanism. Audio is not retained after transcription.
- **Data residency.** As set out in section 8.
- **Encryption.** In transit over TLS throughout; at rest by the storage and
  database providers.
- **Access control.** Organisation membership is re-checked on every request
  rather than trusted from the session, so removing somebody takes effect on
  their next request instead of whenever their session happens to expire.
- **Secrets.** Provider credentials live as environment variables in the hosting
  platform and never reach the browser.

**[Add: personnel access controls, backup and restore, and an incident response
procedure. Those are organisational rather than code, so they cannot be read out
of the repository — they have to be decided, then written.]**

## 10 · Deletion and return

Subtitles and translations can be exported by the Controller at any time from
the editor, in every supported format, without asking the Processor.

On termination, [PERIOD] to export, then deletion.
**[Undecided, and account deletion is not implemented — see review-checklist.md
item 6. Do not sign this clause before the software can honour it.]**

## 11 · Audit

The Processor will make available the information needed to demonstrate
compliance and will contribute to audits, on reasonable notice and no more than
[FREQUENCY], at the Controller's cost unless a material breach is found.

## 12 · Liability

Follows the Terms of Service. **[Clause 9 of the Terms is unwritten, so this
cross-reference is worthless until it exists.]**
