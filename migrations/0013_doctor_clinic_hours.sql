-- Add clinic hours (outpatient schedule) to doctors table
-- Format: JSON string like {"mon":"09:00-12:00","tue":"14:00-17:00","wed":"","thu":"09:00-12:00","fri":"14:00-17:00","sat":"","sun":"","notes":"격주 토요일 오전"}
ALTER TABLE doctors ADD COLUMN clinic_hours TEXT DEFAULT '';
