-- Charging for material must not consume the version the editor is holding.
--
-- `touch_sequence_row` bumps `version` on every UPDATE of the row, which is
-- exactly right while every UPDATE is somebody editing. Billing broke that
-- assumption: /api/translate marks the sequence as charged, the trigger reads
-- it as an edit, and the version the browser opened with is suddenly stale.
--
-- The customer sees it as "somebody else saved first" on their own work, alone,
-- moments after translating — the one message optimistic locking exists to make
-- trustworthy, fired by nobody. Losing faith in that warning is worse than
-- losing the lock, because the next real conflict gets clicked through.
--
-- So the bump now asks whether anything a person authored actually changed.
-- Every column named here is one the editor owns; `billed_seconds`, `billed_at`
-- and the timestamps are deliberately absent, because a row whose only
-- difference is a charge is the same document it was a moment ago.

create or replace function touch_sequence_row() returns trigger language plpgsql as $$
begin
  if new.data          is not distinct from old.data
     and new.name         is not distinct from old.name
     and new.source_lang  is not distinct from old.source_lang
     and new.target_langs is not distinct from old.target_langs
     and new.fps          is not distinct from old.fps
     and new.project_id   is not distinct from old.project_id
  then
    -- Not an edit. Leave updated_at and version exactly as they were, so the
    -- editor's copy stays current and the project list keeps its real ordering.
    return new;
  end if;

  new.updated_at = now();
  new.version    = old.version + 1;
  return new;
end;
$$;
