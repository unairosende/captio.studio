-- The client a project is for, and the terms that client always uses.
--
-- A project's glossary covers one job. A productora works for the same client
-- again and again — the same brand, the same founder's name, the same product
-- line — and until now every new project started with an empty list, so the
-- spelling settled in the last job had to be typed in again or got lost.
--
-- A client holds a glossary of its own that every project assigned to it
-- inherits. The project's own list still wins where both name the same term:
-- a campaign can have a reason to depart from the house style, and it is the
-- narrower decision.
--
-- Optional on purpose. Plenty of work is one-off, and a client is only worth
-- naming when there will be a second job.

create table if not exists clients (
  id          uuid primary key default gen_random_uuid(),
  org_id      text not null references "organization" ("id") on delete cascade,
  name        text not null,
  -- Same shape as projects.glossary — GlossaryEntry in lib/ai/prompt.ts.
  glossary    jsonb not null default '[]'::jsonb,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists clients_org_name_idx on clients (org_id, name);

drop trigger if exists clients_touch_updated_at on clients;
create trigger clients_touch_updated_at
  before update on clients
  for each row execute function touch_updated_at();

-- Removing a client leaves its projects where they were, unassigned: the work
-- is the project's, and the client was only ever a label and a word list.
--
-- Nothing here stops a project naming another organisation's client; the
-- database has no composite key to say so. lib/db/projects.ts resolves the id
-- through `clients where org_id = $1`, the same guard sequences use to move
-- between projects.
alter table projects
  add column if not exists client_id uuid references clients (id) on delete set null;

create index if not exists projects_client_idx on projects (client_id);
