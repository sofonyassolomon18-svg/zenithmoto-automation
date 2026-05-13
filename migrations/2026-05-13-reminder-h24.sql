ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_h24_sent boolean DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_bookings_reminder_h24 ON bookings(reminder_h24_sent) WHERE reminder_h24_sent = false;
