-- Add geocoding columns to hospitals for real map plotting
ALTER TABLE hospitals ADD COLUMN lat REAL;
ALTER TABLE hospitals ADD COLUMN lng REAL;
ALTER TABLE hospitals ADD COLUMN geocoded_at DATETIME;
-- Cache the geocoded address so re-geocoding only happens when address changes
ALTER TABLE hospitals ADD COLUMN geocoded_address TEXT;

CREATE INDEX IF NOT EXISTS idx_hospitals_latlng ON hospitals(lat, lng);
