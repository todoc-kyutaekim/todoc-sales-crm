-- ==============================================
-- Migration: Merge clinics into hospitals
-- 의원(clinics)을 병원(hospitals)으로 통합
-- ==============================================

-- Step 1: Add clinic-specific fields + type column to hospitals table
ALTER TABLE hospitals ADD COLUMN type TEXT DEFAULT 'hospital';  -- 'hospital' or 'clinic'
ALTER TABLE hospitals ADD COLUMN priority TEXT DEFAULT '3';
ALTER TABLE hospitals ADD COLUMN todoc_contact TEXT DEFAULT '';
ALTER TABLE hospitals ADD COLUMN patient_count INTEGER DEFAULT 0;
ALTER TABLE hospitals ADD COLUMN hearing_aid_sales INTEGER DEFAULT 0;
ALTER TABLE hospitals ADD COLUMN ci_referrals INTEGER DEFAULT 0;

-- Step 2: Migrate clinics data into hospitals
INSERT INTO hospitals (name, region, address, phone, grade, notes, status, type, priority, todoc_contact, patient_count, hearing_aid_sales, ci_referrals, created_at, updated_at)
SELECT name, region, address, phone, 'C', notes, status, 'clinic', priority, todoc_contact, patient_count, hearing_aid_sales, ci_referrals, created_at, updated_at
FROM clinics;

-- Step 3: Migrate clinic_contacts → doctors
-- Map clinic_contacts to the new hospital IDs for migrated clinics
-- The new hospital_id for a clinic can be found by matching name + type='clinic'
INSERT INTO doctors (hospital_id, name, department, position, phone, email, specialty, influence_level, notes, photo, created_at, updated_at)
SELECT 
  (SELECT h.id FROM hospitals h WHERE h.name = cl.name AND h.type = 'clinic' LIMIT 1),
  cc.name,
  '',
  cc.role,
  cc.phone,
  cc.email,
  '',
  cc.influence_level,
  cc.notes,
  cc.photo,
  cc.created_at,
  cc.updated_at
FROM clinic_contacts cc
JOIN clinics cl ON cc.clinic_id = cl.id
WHERE (SELECT h.id FROM hospitals h WHERE h.name = cl.name AND h.type = 'clinic' LIMIT 1) IS NOT NULL;

-- Step 4: Migrate clinic_visits → meetings
-- Map visit_type to meeting_type (same values), contact_id → doctor_id via name lookup
INSERT INTO meetings (hospital_id, doctor_id, meeting_date, meeting_type, purpose, content, result, next_action, next_meeting_date, created_at, updated_at)
SELECT
  (SELECT h.id FROM hospitals h WHERE h.name = cl.name AND h.type = 'clinic' LIMIT 1),
  COALESCE(
    (SELECT d.id FROM doctors d 
     WHERE d.hospital_id = (SELECT h.id FROM hospitals h WHERE h.name = cl.name AND h.type = 'clinic' LIMIT 1)
       AND d.name = cc.name LIMIT 1),
    0
  ),
  cv.visit_date,
  cv.visit_type,
  cv.purpose,
  cv.content,
  cv.result,
  cv.next_action,
  cv.next_visit_date,
  cv.created_at,
  cv.updated_at
FROM clinic_visits cv
JOIN clinics cl ON cv.clinic_id = cl.id
LEFT JOIN clinic_contacts cc ON cv.contact_id = cc.id
WHERE (SELECT h.id FROM hospitals h WHERE h.name = cl.name AND h.type = 'clinic' LIMIT 1) IS NOT NULL;

-- Step 5: Create meeting_doctors entries for the migrated meetings
INSERT INTO meeting_doctors (meeting_id, doctor_id)
SELECT m.id, m.doctor_id
FROM meetings m
WHERE m.doctor_id > 0
  AND m.hospital_id IN (SELECT id FROM hospitals WHERE type = 'clinic')
  AND NOT EXISTS (SELECT 1 FROM meeting_doctors md WHERE md.meeting_id = m.id AND md.doctor_id = m.doctor_id);

-- Step 6: Add index on type
CREATE INDEX IF NOT EXISTS idx_hospitals_type ON hospitals(type);

-- Note: We keep the clinics/clinic_contacts/clinic_visits tables intact for now
-- They can be dropped in a future migration after verifying data integrity
