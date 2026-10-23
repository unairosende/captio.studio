-- The suggestions somebody already said no to.
--
-- The project page offers, as glossary variants, the corrections the team keeps
-- making by hand to transcriptions (lib/subtitles/corrections.ts). They are
-- computed from the cues every time, so a suggestion declined once would be
-- offered again on every visit for as long as those cues exist — which is for
-- ever. This remembers the refusal, by the key `suggestionKey` builds.
--
-- On the project rather than the client: it is where the suggestion was seen
-- and refused, and a project with no client still needs somewhere to keep it.
alter table projects
  add column if not exists dismissed_variants jsonb not null default '[]'::jsonb;
