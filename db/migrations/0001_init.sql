-- captio · initial schema
--
-- Tenancy model: the ORGANIZATION is the unit of both billing and permissions.
-- Every tenant-scoped table carries `org_id` directly, even where it could be
-- reached through a join. That redundancy is deliberate: it makes "is this query
-- scoped?" a one-column check that a reviewer, a grep or a test can verify,
-- instead of a chain of joins nobody re-reads.
--
-- Isolation is enforced in application code (lib/db), not in RLS. Auth is Better
-- Auth on this same database, so `auth.uid()` does not exist here and RLS would
-- not be portable off Supabase anyway. The cost of that choice is that a bug in
-- lib/db has no second line of defence — which is exactly why tests/tenancy
-- exists and must stay green.
--
-- Better Auth owns its own tables (user, session, account, verification,
-- organization, member, invitation) and creates them via its migration command.
-- This file defines only the product's tables and references Better Auth's
-- `organization.id` and `"user".id`, both text.

create extension if not exists "pgcrypto";

-- ── Billing ────────────────────────────────────────────────────────────────
-- One subscription per organization, never per user: a productora buys seats,
-- not individual logins.
create table if not exists subscriptions (
  id                   text primary key,            -- Stripe subscription id
  org_id               text not null,
  stripe_customer_id   text not null,
  status               text not null,               -- active|trialing|past_due|canceled
  plan                 text not null,
  seats                integer not null default 1,
  current_period_end   timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- An org may have many historical subscriptions but only one live at a time.
create unique index if not exists subscriptions_one_live_per_org
  on subscriptions (org_id)
  where status in ('active', 'trialing');

create index if not exists subscriptions_org_idx on subscriptions (org_id);

-- ── Projects ───────────────────────────────────────────────────────────────
-- `data` holds cues and translations as a blob. Normalising to one row per cue
-- only pays off if real-time collaborative editing is sold; until then a blob is
-- fewer moving parts and matches how the editor already works.
create table if not exists projects (
  id            uuid primary key default gen_random_uuid(),
  org_id        text not null,
  name          text not null,
  source_lang   text,
  target_langs  text[] not null default '{}',
  -- Frame rate is per project: PAL is 25, NTSC film 23.976, web often 30.
  -- Timecode snapping in lib/subtitles reads this, so it must not be assumed.
  fps           numeric(6,3) not null default 25,
  data          jsonb not null default '{}'::jsonb,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists projects_org_updated_idx on projects (org_id, updated_at desc);

-- ── History ────────────────────────────────────────────────────────────────
-- "A client deleted three hours of work" is a guaranteed support call.
create table if not exists project_versions (
  id          uuid primary key default gen_random_uuid(),
  org_id      text not null,
  project_id  uuid not null references projects(id) on delete cascade,
  data        jsonb not null,
  created_by  text,
  created_at  timestamptz not null default now()
);

create index if not exists project_versions_project_idx
  on project_versions (project_id, created_at desc);

-- ── Media ──────────────────────────────────────────────────────────────────
-- `storage_key` points at object storage (R2 / Blob), never at bytes in Postgres.
-- Deleting a project cascades these rows, but the stored objects still need a
-- sweeper — orphaned audio is both a cost leak and a GDPR erasure gap.
create table if not exists media (
  id                uuid primary key default gen_random_uuid(),
  org_id            text not null,
  project_id        uuid references projects(id) on delete cascade,
  storage_key       text not null unique,
  filename          text,
  bytes             bigint,
  duration_seconds  numeric,
  created_by        text,
  created_at        timestamptz not null default now()
);

create index if not exists media_org_idx on media (org_id, created_at desc);

-- ── Review ─────────────────────────────────────────────────────────────────
-- Anchored to a cue index rather than a cue row, because cues live inside
-- projects.data. Splitting or deleting a cue renumbers the track, so callers
-- must remap comments in the same transaction that renumbers.
create table if not exists comments (
  id          uuid primary key default gen_random_uuid(),
  org_id      text not null,
  project_id  uuid not null references projects(id) on delete cascade,
  cue_index   integer not null,
  lang        text,
  body        text not null,
  author_id   text not null,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists comments_project_idx on comments (project_id, cue_index);

-- ── Metering ───────────────────────────────────────────────────────────────
-- Written on every AI call. Input and output are counted separately because
-- output tokens cost several times more, so a single "units" column would
-- under-report the bill.
create table if not exists usage_events (
  id          bigserial primary key,
  org_id      text not null,
  project_id  uuid references projects(id) on delete set null,
  user_id     text,
  kind        text not null,               -- translate | transcribe
  model       text,
  units_in    bigint not null default 0,
  units_out   bigint not null default 0,
  cost_usd    numeric(12,6) not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists usage_events_org_created_idx on usage_events (org_id, created_at desc);

-- ── updated_at ─────────────────────────────────────────────────────────────
-- The editor detects concurrent edits by comparing `updated_at` before writing,
-- so it must be maintained by the database, not by whoever remembers to set it.
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_touch_updated_at on projects;
create trigger projects_touch_updated_at
  before update on projects
  for each row execute function touch_updated_at();

drop trigger if exists subscriptions_touch_updated_at on subscriptions;
create trigger subscriptions_touch_updated_at
  before update on subscriptions
  for each row execute function touch_updated_at();
