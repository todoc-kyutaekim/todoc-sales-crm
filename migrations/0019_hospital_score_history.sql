-- Hospital grade change history (S/A/B/C/D)
-- Used together with pipeline_transitions and meetings to render
-- a time-series score chart for each hospital.
CREATE TABLE IF NOT EXISTS hospital_grade_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  from_grade TEXT,
  to_grade TEXT NOT NULL,
  changed_by INTEGER,
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_hgh_hospital ON hospital_grade_history(hospital_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_hgh_changed_at ON hospital_grade_history(changed_at);

-- Seed initial grade entries from current hospitals
INSERT INTO hospital_grade_history (hospital_id, from_grade, to_grade, changed_at)
SELECT id, NULL, COALESCE(grade, 'A'), created_at
FROM hospitals
WHERE NOT EXISTS (
  SELECT 1 FROM hospital_grade_history hgh WHERE hgh.hospital_id = hospitals.id
);
