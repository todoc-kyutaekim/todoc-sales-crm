-- 교수 연구논문 테이블
CREATE TABLE IF NOT EXISTS doctor_papers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  journal TEXT DEFAULT '',
  year INTEGER,
  authors TEXT DEFAULT '',
  doi TEXT DEFAULT '',
  abstract TEXT DEFAULT '',
  paper_type TEXT DEFAULT 'journal',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);

-- 교수 추가 프로필 정보 (bio, education, career)
ALTER TABLE doctors ADD COLUMN bio TEXT DEFAULT '';
ALTER TABLE doctors ADD COLUMN education TEXT DEFAULT '';
ALTER TABLE doctors ADD COLUMN career TEXT DEFAULT '';

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_doctor_papers_doctor ON doctor_papers(doctor_id);
CREATE INDEX IF NOT EXISTS idx_doctor_papers_year ON doctor_papers(year);
