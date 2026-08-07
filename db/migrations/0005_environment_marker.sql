-- Let a database say what it is.
--
-- Local development and production share nothing but a connection string, and a
-- connection string is one careless paste away from being the wrong one. The
-- destructive tests in tests/tenancy and tests/auth create and delete rows; run
-- against production they would do it to a customer's work.
--
-- Config cannot answer "am I pointed at production?" reliably, because config is
-- exactly what gets confused. The database can: this marker travels with it.
--
-- It starts EMPTY on purpose. No row means no permission — a fresh or unknown
-- database is treated as production until somebody deliberately says otherwise.
-- Failing closed is the whole point.
--
-- To mark a throwaway database as safe to wipe:
--   insert into deployment_environment (name) values ('development');

create table if not exists deployment_environment (
  -- The check constraint pins the primary key to a single possible value, so a
  -- second row cannot exist.
  singleton  boolean primary key default true check (singleton),
  name       text not null check (name in ('development', 'production')),
  marked_at  timestamptz not null default now()
);
