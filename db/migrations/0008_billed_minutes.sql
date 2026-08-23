-- The plans stop being sold in subtitles and start being sold in minutes.
--
-- Subtitles were the wrong unit twice over. A producer knows how many minutes an
-- episode runs before starting; how many subtitles will come out of it is not
-- knowable until the machine has finished, so the customer was being asked to
-- pick a plan against a number they could not estimate. And every competitor
-- quotes minutes, which made the one comparison a buyer wants to make
-- impossible.
--
-- Minutes also close the hole the old unit left open: transcription was capped
-- only during the trial, so a paid account could transcribe without limit at our
-- expense. One pool for both now, because both spend the same material.
--
-- WHY THE COUNTER LIVES ON THE ROW AND NOT IN usage_events
--
-- The promise is unlimited languages, which means the same material must be
-- charged once no matter how many times it is translated. usage_events records
-- every call, so summing it would charge the sixth language as if it were new
-- work. A mark on the material itself can only be set once, so the promise is
-- enforced by the shape of the data rather than by remembering to check.

-- Transcribed material is billed against the upload. It exists before there is
-- anything to save, which is the whole reason billing cannot hang off the
-- sequence: transcription is the first thing anybody does, and at that moment a
-- sequence would have no cues and could not be saved.
alter table media
  add column if not exists billed_seconds integer not null default 0,
  add column if not exists billed_at      timestamptz;

-- Imported subtitles arrive with no upload, so they are billed against the
-- sequence, whose cues carry the timecodes the duration is read from. This one
-- does require a save first, and can: an import produces cues immediately.
alter table sequences
  add column if not exists billed_seconds integer not null default 0,
  add column if not exists billed_at      timestamptz;

-- The month's consumption is a sum over what was billed within it, so both
-- indexes are on the pair the query filters by.
create index if not exists media_org_billed_idx     on media     (org_id, billed_at);
create index if not exists sequences_org_billed_idx on sequences (org_id, billed_at);
