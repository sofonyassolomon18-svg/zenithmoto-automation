-- Stores single-use Calendly scheduling link generated after Stripe paid webhook.
-- One link per booking. NULL until paid + slot offered.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS calendly_url text;
CREATE INDEX IF NOT EXISTS idx_bookings_calendly
  ON bookings(calendly_url) WHERE calendly_url IS NOT NULL;
