# What has to be answered before any of this is published

The drafts in this folder are written from the code. They are accurate about
what the software does. They are not legal advice, nobody qualified has read
them, and several of them contain claims that are only true if the answers below
come back the right way.

Ordered by what sinks a deal fastest.

---

## 1 · Do the AI providers train on what we send them?

**This is the question a production company asks first, and the only one where a
vague answer loses the sale.** Unreleased dialogue is the most confidential
thing a producer owns. "We use AI" and "your unreleased script trains somebody
else's model" are different products.

It has to be answered per provider, in writing, from their terms — not from a
marketing page:

- **Google** (Gemini) — subtitle text, and now the only translation path, so this
  is the one that matters. The free tier of Google's AI offerings has
  historically carried different data terms from the paid one; check which tier
  the key in use belongs to before relying on the answer.
- **ElevenLabs** — audio. Recorded voices, which is the more sensitive half.
- **Groq** — subtitle text, but only when Gemini is unavailable. Still needs an
  answer: "rarely" is not "never".

OpenRouter, Mistral and OpenAI were removed from the product, so they no longer
need answering.

Each answer needs three parts: does the provider train on inputs, how long do
they retain them, and can retention be turned off. Where a zero-retention or
no-training mode exists but has to be requested or configured, that
configuration is a code change and should be raised as one.

Until this is settled, `privacy.md` and `dpa.md` carry a placeholder rather than
a claim. Do not fill it in optimistically.

## 2 · What legal basis covers sending audio to the United States?

Groq, OpenAI and Google are US companies. The recorded voices of everybody in an
interview go to them.

Confirm for each: certification under the EU–US Data Privacy Framework, or
Standard Contractual Clauses in their terms, and whether a transfer impact
assessment is needed. Mistral is in France and is the fallback if any of this
proves unworkable — the provider is already chosen per request, so restricting a
customer to EU-only processing is a configuration change rather than a rewrite.

## 3 · Is a DPA in place with each subprocessor?

Not the DPA we hand customers — the ones we sign with them. Every party in
`subprocessors.md` needs one, and most publish a standard version accepted by
reference. Collect them and file them; a customer's procurement will ask.

## 4 · Who is the legal entity?

Every draft says "Captio" and means nothing by it yet. A contract needs a
company, an address and a VAT number. If this trades through keweke for now, the
drafts have to say keweke — and the eventual separation becomes a contract
novation with every customer signed in the meantime, which is an argument for
settling the entity before the first paying customer rather than after.

## 5 · Which language governs?

The drafts are in English because the product is. Customers in Spain will want
Spanish, and a Spanish court will read the Spanish version. Decide which version
governs and say so in the terms; do not publish two versions without that
clause.

## 6 · Retention, which is code as much as policy

What the software does today, so the policy can describe it instead of promising
something else:

- **Uploaded audio** — deleted about a day after upload by the sweeper
  (`app/api/cron/sweep-media`), with a 7-day lifecycle rule on the bucket
  underneath as a floor. Audio is not kept.
- **Projects, cues and translations** — kept until the customer deletes them.
  No automatic expiry.
- **Usage records** — kept indefinitely, because they are the billing record.
- **Account and organisation data** — kept while the account exists.

Two gaps to close, both of them code:

- **Account deletion does not exist.** There is no way for a customer to delete
  an organisation and everything in it. That is an erasure obligation with no
  implementation, and it will be asked about.
- **Nothing states how long anything survives cancellation.** Decide the window,
  then build it. The policy should not name a period the software does not
  enforce.

## 7 · Do we ever look at customer content?

Say so plainly either way. Support access to a customer's project is normal and
defensible; discovering it undisclosed is not. There is no admin view in the
code today, so the honest answer is currently "no, and there is no mechanism" —
worth writing down before somebody adds one.

---

## What is already true and can be stated without qualification

Verified in the code, not assumed:

- No analytics, telemetry, session recording or advertising tags anywhere.
- Fonts are self-hosted; no visitor IP reaches a third-party CDN.
- The only cookie is the session cookie, strictly necessary. The current build
  requires no consent banner.
- Compute runs in Stockholm, the database is in `eu-north-1`, and media sits in
  an EU-jurisdiction R2 bucket that the non-EU endpoint cannot even see.
- Every database query is scoped by organisation, enforced by a test that reads
  the SQL (`tests/tenancy/scoping.test.ts`).
- Uploads are signed for one object, one method and one size, and expire after
  fifteen minutes.
