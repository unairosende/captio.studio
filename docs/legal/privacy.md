# Privacy Policy — DRAFT

**Not reviewed by a lawyer. Do not publish.** The placeholders in `[BRACKETS]`
and the open questions in `review-checklist.md` have to be settled first.

Last updated: [DATE] · Entity: [LEGAL ENTITY, ADDRESS, VAT NUMBER]

---

## The short version

Captio turns recordings into subtitles and translates them. To do that we store
your subtitles, send them to AI providers, and keep an account for you.

We do not track you. There is no analytics, no advertising, no session
recording, and the only cookie we set is the one that keeps you signed in.

Your audio is deleted about a day after it is transcribed. Your subtitles stay
until you delete them.

---

## Two different roles

**Your subtitle content is yours.** The video, the audio, the cues and the
translations belong to your production. We are a processor for that material: we
handle it on your instructions and for no purpose of our own. If somebody
appearing in your recording wants to know what is held about them, that request
goes to you rather than to us — you are the one who filmed them. We will help you
answer it.

**Your account is ours to be responsible for.** Your email address, your name,
who belongs to your organisation and what you have been billed — for those we
are the controller, and this policy is our own.

---

## What we hold

**Account** — email address, name, organisation membership and role, and a
hashed password if you did not sign in with Google.

**Your work** — projects, source subtitles, translations, comments, and the audio
you upload for transcription.

**Usage** — for each AI job: which kind, which model, how many tokens or seconds
of audio, how many subtitles, and when. This is what a bill is calculated from
and what the free trial is measured against.

**Billing** — handled by Stripe. Card numbers never reach our servers.

We ask for nothing else, and there is no hidden collection: every item in this
list corresponds to a table you could point at in the schema.

---

## Who else sees it

The full list, with locations and what reaches each one, is at
[/subprocessors]. In summary:

Hosting, database and media storage are all in the EU — compute in Stockholm,
database in Stockholm, media in an EU-jurisdiction bucket. Transactional email
goes through Resend in Ireland. Payments go through Stripe.

Transcription and translation are done by AI providers, and some of them are
outside the EU: **[PROVIDER TRANSFER BASIS — see review-checklist.md item 2]**.
The audio you upload and the subtitle text you translate are sent to those
providers to be processed.

**[TRAINING CLAUSE — see review-checklist.md item 1. Do not fill this in until
each provider's terms have been read. This is the sentence customers care about
most, and it has to be exactly true.]**

---

## How long

| | |
|---|---|
| Uploaded audio | Deleted about a day after upload, automatically |
| Projects, subtitles, translations, comments | Until you delete them |
| Usage records | Kept — they are the billing record |
| Account data | While your account exists |

Audio is genuinely deleted rather than merely hidden: a scheduled job removes
the objects from storage and the rows that point at them, and a rule on the
bucket removes anything that job missed.

**[RETENTION AFTER CANCELLATION — undecided. See review-checklist.md item 6.]**

---

## Your rights

You can ask for a copy of your data, ask us to correct it, ask us to delete it,
or object to how we use it. Write to [PRIVACY CONTACT] and we will answer within
a month.

Your subtitles are exportable from the editor at any time, in every format the
product supports, without asking us — including after a free trial has run out.

**[ACCOUNT DELETION — not implemented yet. See review-checklist.md item 6. Do not
publish a deletion promise the software cannot keep.]**

You can also complain to your data protection authority. In Spain that is the
AEPD.

---

## Security

Access is scoped to your organisation by construction: every database query
filters on it, and an automated test reads the SQL to check that none has been
written without it.

Uploads go straight from your browser to storage using a signed URL good for one
file, one method and one size, which expires after fifteen minutes.

We have no support tool that reads your projects. **[Confirm, and keep it true —
see review-checklist.md item 7.]**

---

## Cookies

One: the session cookie that keeps you signed in. It is strictly necessary and
does not need your consent. We set no other cookie, and no third party sets one
through us — the fonts are served from our own domain precisely so that loading
a page tells nobody else you were here.

---

## Changes

If we add a subprocessor, or change what we do with your content, we will update
this page and tell account owners before the change takes effect.
