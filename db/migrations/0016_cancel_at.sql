-- When a cancelled subscription actually ends.
--
-- Cancelling from the billing portal does not end a subscription: it schedules
-- the end for the close of the period already paid, and Stripe keeps it active
-- until then. The dashboard only knew current_period_end, so a customer who had
-- just cancelled was told the plan "renews" on the very day it was going to
-- stop. Null means it renews.
alter table subscriptions
  add column if not exists cancel_at timestamptz;
