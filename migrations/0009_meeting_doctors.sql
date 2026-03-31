-- meeting_doctors 조인 테이블: 미팅-교수 다대다 관계
CREATE TABLE IF NOT EXISTS meeting_doctors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL,
  doctor_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
  UNIQUE(meeting_id, doctor_id)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_meeting_doctors_meeting ON meeting_doctors(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_doctors_doctor ON meeting_doctors(doctor_id);

-- 기존 meetings의 doctor_id 데이터를 meeting_doctors로 마이그레이션
INSERT OR IGNORE INTO meeting_doctors (meeting_id, doctor_id)
  SELECT id, doctor_id FROM meetings WHERE doctor_id IS NOT NULL AND doctor_id != 0;
