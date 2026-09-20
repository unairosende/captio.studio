-- A cancelled organisation does not live for ever, and is warned before it dies.
--
-- Until now nothing ever removed an organisation whose subscription had lapsed:
-- its projects, its recorded audio and its members simply stayed, which is a
-- storage bill that never stops and, once the customer has gone, data kept with
-- no reason to keep it. Retention closes that — see lib/retention.ts for the
-- window — but deleting a customer's work without a word is its own failure, so
-- there is a notice first.
--
-- This column records when that notice was sent. Null means not yet warned;
-- erasure is not allowed to happen until it is set and enough days have passed
-- since, so the clock that ends the data is tied to a message that actually went
-- out, not to the cancellation date alone. It lives on the subscription rather
-- than the organisation because the cancelled subscription is what the retention
-- sweep keys on, and a re-subscribe writes a new row that starts clean.
alter table subscriptions
  add column if not exists retention_warned_at timestamptz;
