-- Optimistic locking by version counter instead of by updated_at.
--
-- Comparing timestamps looked equivalent and is not. Postgres stores timestamptz
-- with microsecond precision (…:41.178398) while a JavaScript Date can only hold
-- milliseconds (…:41.178), so a timestamp read by the client never matches the
-- stored value when sent back. Every concurrent-edit check would have reported a
-- conflict that did not happen, and the second editor would be told to reload
-- work nobody had touched.
--
-- An integer cannot lose precision, does not depend on clocks, time zones or the
-- driver's date handling, and compares exactly. `updated_at` stays for display
-- and ordering, which is all it was ever good for.

alter table projects add column if not exists version integer not null default 1;

create or replace function touch_project_row() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  new.version    = old.version + 1;
  return new;
end;
$$;

drop trigger if exists projects_touch_updated_at on projects;
drop trigger if exists projects_touch_row on projects;

create trigger projects_touch_row
  before update on projects
  for each row execute function touch_project_row();
