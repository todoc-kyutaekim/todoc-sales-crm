-- Pipeline stage transition history
-- Tracks every stage change for a hospital so we can compute
-- dwell time per stage, conversion rates, and bottlenecks.
CREATE TABLE IF NOT EXISTS pipeline_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  changed_by INTEGER,
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_pt_hospital ON pipeline_transitions(hospital_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_pt_to_stage ON pipeline_transitions(to_stage, changed_at);
CREATE INDEX IF NOT EXISTS idx_pt_changed_at ON pipeline_transitions(changed_at);

-- Seed initial entries from existing hospitals so analytics has a baseline
-- (treats current pipeline_stage as the latest known position at created_at).
INSERT INTO pipeline_transitions (hospital_id, from_stage, to_stage, changed_at)
SELECT id, NULL, COALESCE(pipeline_stage, 'contact'), created_at
FROM hospitals
WHERE NOT EXISTS (
  SELECT 1 FROM pipeline_transitions pt WHERE pt.hospital_id = hospitals.id
);
