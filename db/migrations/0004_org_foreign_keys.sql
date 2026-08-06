-- Tie every tenant-scoped table to a real organisation.
--
-- 0001 could not do this: `organization` did not exist until Better Auth's
-- schema landed in 0003. Until now `org_id` was an unverified string, so a typo
-- or a stale id produced rows belonging to an organisation that does not exist
-- — invisible in every list, still occupying storage, and out of reach of a
-- GDPR erasure request that works by organisation.
--
-- ON DELETE CASCADE is the honest semantic: the organisation owns the work.
-- Deleting one removes its projects, media rows, comments and metering.
-- Anything that must outlive an offboarding — invoices, retained billing
-- records — has to be exported first, or kept outside these tables.
--
-- Note the storage objects behind `media` are NOT removed by this cascade.
-- Only the rows go; the bytes need the sweeper (see lib/db/media.ts).

alter table subscriptions
  add constraint subscriptions_org_fk
  foreign key (org_id) references "organization" ("id") on delete cascade;

alter table projects
  add constraint projects_org_fk
  foreign key (org_id) references "organization" ("id") on delete cascade;

alter table project_versions
  add constraint project_versions_org_fk
  foreign key (org_id) references "organization" ("id") on delete cascade;

alter table media
  add constraint media_org_fk
  foreign key (org_id) references "organization" ("id") on delete cascade;

alter table comments
  add constraint comments_org_fk
  foreign key (org_id) references "organization" ("id") on delete cascade;

alter table usage_events
  add constraint usage_events_org_fk
  foreign key (org_id) references "organization" ("id") on delete cascade;
