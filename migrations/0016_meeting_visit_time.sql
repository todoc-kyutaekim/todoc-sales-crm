-- Add visit_time column to meetings (am=오전, pm=오후, full=종일, '' or NULL=미지정)
ALTER TABLE meetings ADD COLUMN visit_time TEXT DEFAULT '';
