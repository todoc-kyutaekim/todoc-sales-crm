-- Phase 3-3: Add precise start/end time fields for timeline grid view
-- Existing visit_time (am/pm/full) is preserved for backward compatibility.
-- start_time / end_time use HH:MM 24h format (TEXT). NULL means time unset.

ALTER TABLE meetings ADD COLUMN start_time TEXT DEFAULT NULL;
ALTER TABLE meetings ADD COLUMN end_time   TEXT DEFAULT NULL;

-- Backfill default times based on visit_time slot so existing rows render in the timeline
-- am  → 09:00 ~ 10:00
-- pm  → 14:00 ~ 15:00
-- full→ 09:00 ~ 18:00
-- ''  → leave NULL (timeline will list under "시간 미지정")
UPDATE meetings SET start_time='09:00', end_time='10:00' WHERE (start_time IS NULL OR start_time='') AND visit_time='am';
UPDATE meetings SET start_time='14:00', end_time='15:00' WHERE (start_time IS NULL OR start_time='') AND visit_time='pm';
UPDATE meetings SET start_time='09:00', end_time='18:00' WHERE (start_time IS NULL OR start_time='') AND visit_time='full';

CREATE INDEX IF NOT EXISTS idx_meetings_start_time ON meetings(meeting_date, start_time);
