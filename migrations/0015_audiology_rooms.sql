-- Add audiology/mapping room information to hospitals
ALTER TABLE hospitals ADD COLUMN audiology_room TEXT DEFAULT '';
ALTER TABLE hospitals ADD COLUMN mapping_room TEXT DEFAULT '';
