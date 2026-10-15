-- A sequence says what it is cut for, and which sequence it was cut from.
--
-- Horizontal or vertical was a switch in the editor, kept for as long as the
-- tab was open and never written down. Every sequence therefore opened as
-- horizontal, whatever it had been made for: a vertical cut was checked
-- against 42 characters a line and exported at 42 unless somebody remembered
-- to flip the switch first, every time, on every machine. The format is a
-- property of the delivery, so it moves onto the row.
--
-- The second column exists because one piece of material can now arrive as
-- two sequences at once — the assistant on /projects/new cuts a horizontal and
-- a vertical version from the same recording or the same subtitle file. They
-- are one job as far as the customer is concerned, and two rows as far as the
-- schema was concerned, which had two consequences nobody would have chosen:
--
--   · The upload belongs to one sequence (media.sequence_id), so the second
--     cut had no picture to play.
--   · Material is charged once per container — once per upload, or once per
--     imported sequence — so a subtitle file delivered in both formats would
--     have been charged twice for the same minutes.
--
-- `derived_from` names the sequence a cut was made from. Playback falls back to
-- the origin's upload (lib/db/media.ts), and a derived cut never charges for
-- material of its own: it is paid when its origin is, and translating it
-- charges the origin instead (lib/db/billing.ts, app/api/translate). Set null
-- if the origin is deleted, which leaves the cut standing on its own.
alter table sequences
  add column if not exists output_mode  text not null default 'horizontal'
    check (output_mode in ('horizontal', 'vertical')),
  add column if not exists derived_from uuid references sequences (id) on delete set null;

-- Read in one direction only: from an origin, to mark what was cut from it as paid.
create index if not exists sequences_derived_from_idx
  on sequences (org_id, derived_from) where derived_from is not null;
