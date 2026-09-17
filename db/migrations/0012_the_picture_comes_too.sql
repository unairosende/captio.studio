-- The video reaches the bucket, and the waveform stops needing the bytes.
--
-- Until now only the audio went up: the browser stripped it out of whatever was
-- dropped on it, so the picture never left the customer's machine. That was the
-- right first cut — a transcript needs nothing else — and the wrong final one,
-- because a subtitle is timed against a face, and a client reviewing a
-- translation wants to see it under the shot, not read it in a column. So the
-- object behind a media row can now be the video itself. Nothing about that
-- needs a new column: R2 serves whatever was put there, and a <video> reads it
-- straight from a signed URL with range requests, so seeking never downloads
-- the whole file.
--
-- What does need columns is knowing what the object is, and drawing the
-- waveform without fetching it. The browser can only be told what to render
-- from the content type; and the timeline's waveform was until now decoded from
-- a local file on every visit, which is fine for a screener somebody has to
-- hand, and absurd for a gigabyte that is already in the bucket. The peaks are
-- four thousand numbers computed once, at upload, when the file was being
-- decoded anyway. They are the same reduction lib/audio/peaks.ts has always
-- drawn from; they just survive the tab now.
alter table media
  add column if not exists content_type text,
  -- Waveform peaks, 0..1, PEAK_BUCKETS of them. Null when the browser could
  -- not decode the upload, in which case there is no waveform — a ProRes MOV
  -- still transcribes, it just does not draw.
  add column if not exists peaks        jsonb;
