-- Two levels where there was one: a PROJECT holds SEQUENCES.
--
-- What this schema has called a "project" since 0001 is one subtitle track — one
-- set of cues with its translations. Real work does not arrive one track at a
-- time: a feature comes in reels, a series in episodes, a campaign in cuts, and
-- all of them share a client, a deadline and above all a terminology. There was
-- nowhere to say so, so a customer's list of projects was a flat pile of tracks
-- with the grouping living in their filenames.
--
-- The track therefore becomes a `sequence`, and `projects` is created fresh as
-- the thing that holds them. Renaming rather than adding a `folders` table on
-- top is the more invasive change today and the only one that leaves the schema
-- saying what people mean; a folder table would have left every column, route
-- and component calling a track a "project" for as long as the product exists.
--
-- This is also the cheapest hour it will ever be done in: every product table is
-- empty. The backfill below therefore moves nothing, and is here so that the
-- file still applies cleanly to a development database that does have rows.

-- ── 1. The track becomes a sequence ────────────────────────────────────────
-- Renames only; no data is rewritten. Every foreign key, index and trigger
-- follows the table it belongs to. What does not follow is their NAMES, and a
-- constraint called `comments_project_id_fkey` sitting on a column called
-- `sequence_id` is what makes the next person distrust the whole schema.

alter table projects         rename to sequences;
alter table project_versions rename to sequence_versions;

alter table sequence_versions rename column project_id to sequence_id;
alter table comments          rename column project_id to sequence_id;
alter table media             rename column project_id to sequence_id;
alter table usage_events      rename column project_id to sequence_id;

alter index projects_pkey                rename to sequences_pkey;
alter index projects_org_updated_idx     rename to sequences_org_updated_idx;
alter index project_versions_pkey        rename to sequence_versions_pkey;
alter index project_versions_project_idx rename to sequence_versions_sequence_idx;
alter index comments_project_idx         rename to comments_sequence_idx;

alter table sequences         rename constraint projects_org_fk         to sequences_org_fk;
alter table sequence_versions rename constraint project_versions_org_fk to sequence_versions_org_fk;

alter table sequence_versions
  rename constraint project_versions_project_id_fkey to sequence_versions_sequence_id_fkey;
alter table comments     rename constraint comments_project_id_fkey     to comments_sequence_id_fkey;
alter table media        rename constraint media_project_id_fkey        to media_sequence_id_fkey;
alter table usage_events rename constraint usage_events_project_id_fkey to usage_events_sequence_id_fkey;

-- The trigger keeps working across a rename because it binds to the function by
-- oid rather than by name. Renamed anyway: it is what an error message quotes.
alter function touch_project_row() rename to touch_sequence_row;
alter trigger projects_touch_row on sequences rename to sequences_touch_row;

-- ── 2. The project, as a container ─────────────────────────────────────────
-- Deliberately thin. It owns a name and the terminology and nothing else:
-- source and target languages stay on the sequence, because a project is
-- routinely a film plus its trailer, and the trailer is not always cut for the
-- same markets.
create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  org_id      text not null references "organization" ("id") on delete cascade,
  name        text not null,
  -- The reason to group work at all. One list of terms per project, inherited by
  -- every sequence in it: a character's name has to survive from reel one to
  -- reel six, and re-typing it per reel is how it stops surviving. Shape matches
  -- GlossaryEntry in lib/ai/prompt.ts — [{ term, translation? }].
  glossary    jsonb not null default '[]'::jsonb,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists projects_org_updated_idx on projects (org_id, updated_at desc);

drop trigger if exists projects_touch_updated_at on projects;
create trigger projects_touch_updated_at
  before update on projects
  for each row execute function touch_updated_at();

-- ── 3. Every sequence lives in a project ───────────────────────────────────
-- Not nullable. A nullable parent would mean a second place for a sequence to be
-- — loose at the top level — and therefore a second state for every list, every
-- breadcrumb and every delete to handle, for ever, in order to save one column.
alter table sequences
  add column if not exists project_id uuid references projects(id) on delete cascade;

-- The backfill. It runs against no rows here, and is kept so a development
-- database with tracks in it is carried over rather than refused. One project
-- per organisation, because nothing in the old schema recorded how its owner
-- would have grouped them — that guess is theirs to make afterwards.
insert into projects (id, org_id, name)
select gen_random_uuid(), s.org_id, 'Imported'
  from (select distinct org_id from sequences where project_id is null) s;

update sequences s
   set project_id = p.id
  from projects p
 where s.project_id is null
   and p.org_id = s.org_id
   and p.name = 'Imported';

-- Terminology comes up with the sequences that carried it. The per-sequence
-- copies are left untouched inside `data`, so nothing is destroyed if merging
-- them turns out to be the wrong call for somebody.
update projects p
   set glossary = coalesce((
         select jsonb_agg(distinct entry)
           from sequences s,
                jsonb_array_elements(
                  case when jsonb_typeof(s.data -> 'glossary') = 'array'
                       then s.data -> 'glossary'
                       else '[]'::jsonb end
                ) as entry
          where s.project_id = p.id
       ), '[]'::jsonb)
 where p.name = 'Imported';

alter table sequences alter column project_id set not null;

create index if not exists sequences_project_updated_idx
  on sequences (project_id, updated_at desc);
