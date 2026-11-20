-- A reviewer's address is only needed while their link works.
--
-- Somebody who opens a review link gives a name and an email. The email lets
-- them come back as the same guest and receive notice of replies, and both of
-- those need a live link. It was kept anyway, for as long as the link, the
-- project or the organisation existed — long after the link had expired —
-- which is personal data held for no purpose.
--
-- The nightly retention sweep now clears it once the link has expired or been
-- revoked (forgetExpiredGuests). The row stays, and with it the name beside the
-- comments it signed: deleting the guest would cascade their comments away, and
-- those are the customer's record of the review.
alter table review_guests
  alter column email drop not null;
