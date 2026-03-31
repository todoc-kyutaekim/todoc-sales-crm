-- Clinics (의원) table
CREATE TABLE IF NOT EXISTS clinics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  address TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  priority TEXT DEFAULT '3',  -- 1~5 stars as string
  todoc_contact TEXT DEFAULT '',  -- 토닥접점: O, X, triangle
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  -- Business metrics
  patient_count INTEGER DEFAULT 0,        -- 난청 환자수
  hearing_aid_sales INTEGER DEFAULT 0,    -- 보청기 판매량
  ci_referrals INTEGER DEFAULT 0,         -- 인공와우 의뢰 실적
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Clinic contacts (의원 관계자) table
CREATE TABLE IF NOT EXISTS clinic_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT '',           -- 원장, 의사, 청각사, 직원 등
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  influence_level TEXT DEFAULT 'medium',  -- high, medium, low
  notes TEXT DEFAULT '',
  photo TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE
);

-- Clinic visits (의원 방문 기록) table
CREATE TABLE IF NOT EXISTS clinic_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id INTEGER NOT NULL,
  contact_id INTEGER,              -- optional: specific contact met
  visit_date DATE NOT NULL,
  visit_type TEXT DEFAULT 'visit',  -- visit, phone, email, online
  purpose TEXT DEFAULT '',
  content TEXT DEFAULT '',
  result TEXT DEFAULT '',
  next_action TEXT DEFAULT '',
  next_visit_date DATE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES clinic_contacts(id) ON DELETE SET NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_clinic_contacts_clinic ON clinic_contacts(clinic_id);
CREATE INDEX IF NOT EXISTS idx_clinic_visits_clinic ON clinic_visits(clinic_id);
CREATE INDEX IF NOT EXISTS idx_clinic_visits_contact ON clinic_visits(contact_id);
CREATE INDEX IF NOT EXISTS idx_clinic_visits_date ON clinic_visits(visit_date);
