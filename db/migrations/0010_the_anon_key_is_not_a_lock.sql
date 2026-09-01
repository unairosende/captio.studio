-- The anon key is not a lock.
--
-- Supabase publishes the `public` schema through PostgREST and grants `anon`
-- and `authenticated` full read and write on everything created there. The only
-- thing standing in that doorway is the anon key: a JWT designed to be pasted
-- into browsers, valid for as long as the project's JWT secret is, and rotated
-- by nobody. Nothing here ships it — lib/db/client.ts speaks to Postgres
-- directly and there is no supabase-js in the tree — so today the key sits
-- unused in a dashboard. That is luck, not a control. One leak and `account`,
-- which is where Better Auth keeps password hashes and OAuth tokens, becomes a
-- public HTTP endpoint.
--
-- This is not a change of heart about RLS (see 0001). Auth is Better Auth on
-- this same database, `auth.uid()` does not exist here, and a policy would have
-- nothing to compare a row against. The door is one we never walk through, so
-- it gets closed rather than guarded.
--
-- Default privileges are recorded per granting role. Running this as `postgres`
-- covers every table these migrations create, because `postgres` is who creates
-- them. A table made by another role — through the dashboard, say — can still
-- arrive with the grants back on, which is what tests/tenancy/api-exposure
-- watches for.
--
-- Note this is defence in depth, not what silences the advisor email: the
-- `rls_disabled_in_public` lint reads `relrowsecurity`, not grants, and keeps
-- firing until `public` is taken out of Settings → API → Exposed schemas.

revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- Belt and braces, and the one that actually blocks a reachable table: without
-- USAGE on the schema, a grant that comes back is unusable.
revoke usage on schema public from anon, authenticated;
