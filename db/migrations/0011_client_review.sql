-- The client gets a door of their own.
--
-- Until now the only way to see a project was to belong to the organisation,
-- which is the right rule for the people who make the subtitles and the wrong
-- one for the people who commission them. A client reviews one job, once, and
-- should never see the productora's other customers — so "invite them as a
-- member" was ruled out on 2026-08-15, and the review rounds have been going
-- by email and re-typing ever since.
--
-- What opens the door is a LINK, not an account. A link belongs to one project
-- and resolves, on the server, to that project's organisation. Whoever holds it
-- says who they are — a name and an address — and from then on their comments
-- and edits carry that identity and a timestamp. The organisation stays the
-- unit of permission: nothing here lets a token name an org_id of its own.
--
-- The token is stored in clear, like the invitation id Better Auth already puts
-- in the accept URL. Hashing it would make "copy the link again" impossible,
-- which is the one thing a productora needs to do with a link three days after
-- making it. A leaked token opens one project until it is revoked; a leaked
-- invitation opens the whole organisation.

-- ── Links ──────────────────────────────────────────────────────────────────
create table if not exists review_links (
  id          uuid primary key default gen_random_uuid(),
  org_id      text not null references "organization" ("id") on delete cascade,
  project_id  uuid not null references projects (id) on delete cascade,
  -- 24 random bytes, base64url. This IS the credential; the row id is not.
  token       text not null unique,
  -- What the productora calls it: "ACME · round 1". Free text, theirs.
  label       text,
  -- Whether the client may change subtitle text, or only read and comment.
  can_edit    boolean not null default true,
  created_by  text,
  created_at  timestamptz not null default now(),
  -- Set from lib/auth/expiry.ts, where every lifespan we promise in prose lives.
  expires_at  timestamptz not null,
  -- Revoking is not deleting: the comments made through a link outlive the link,
  -- and "who let this person in, and when" is a question worth being able to answer.
  revoked_at  timestamptz
);

create index if not exists review_links_project_idx on review_links (project_id, created_at desc);

-- ── Guests ─────────────────────────────────────────────────────────────────
-- A guest is a name and an address that arrived through a link. Not a user:
-- there is no password, no session table, no organisation membership. Deleting
-- the link deletes its guests, and their comments with them (see below).
create table if not exists review_guests (
  id            uuid primary key default gen_random_uuid(),
  org_id        text not null references "organization" ("id") on delete cascade,
  link_id       uuid not null references review_links (id) on delete cascade,
  name          text not null,
  -- Lower-cased on write, so the same person is the same person.
  email         text not null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

-- Unique, so coming back through the same link with the same address is the
-- same guest rather than a second one with the same name.
create unique index if not exists review_guests_link_email_idx on review_guests (link_id, email);

-- ── Comments: a person or a guest ──────────────────────────────────────────
-- author_id was the only author there could be. Now a comment is written by a
-- user OR by a guest, and exactly one of the two must be set. The cascade is
-- deliberate: a guest is only ever removed by removing the link (via its
-- project), and at that point the conversation is over.
alter table comments
  alter column author_id drop not null,
  add column if not exists guest_id    uuid references review_guests (id) on delete cascade,
  -- When the thread was settled, so the record says "fixed on Tuesday" rather
  -- than just "fixed".
  add column if not exists resolved_at timestamptz;

alter table comments
  drop constraint if exists comments_author_or_guest,
  add constraint comments_author_or_guest check (author_id is not null or guest_id is not null);

-- ── Versions: one per save, signed ─────────────────────────────────────────
-- sequence_versions has existed since 0001 and nothing wrote to it. From now on
-- every save records one — and a version somebody can browse needs a number to
-- call it by, a note saying what it was, and an author who may be a guest.
alter table sequence_versions
  add column if not exists version  integer,
  add column if not exists note     text,
  add column if not exists guest_id uuid references review_guests (id) on delete set null;
