-- 인공와우이식술(S5800) 통계 데이터 테이블
-- 연도별 기본 통계
CREATE TABLE IF NOT EXISTS ci_yearly_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL UNIQUE,
  procedures INTEGER NOT NULL DEFAULT 0,
  patients INTEGER NOT NULL DEFAULT 0,
  male_patients INTEGER NOT NULL DEFAULT 0,
  female_patients INTEGER NOT NULL DEFAULT 0,
  is_estimated INTEGER NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 연령대별 통계 (연도별)
CREATE TABLE IF NOT EXISTS ci_age_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  age_group TEXT NOT NULL,
  age_label TEXT DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  ratio REAL NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(year, age_group)
);

-- 지역별 통계 (연도별)
CREATE TABLE IF NOT EXISTS ci_region_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  region TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  ratio REAL NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(year, region)
);

-- 요양기관종별 통계 (연도별)
CREATE TABLE IF NOT EXISTS ci_institution_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  institution_type TEXT NOT NULL,
  ratio REAL NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(year, institution_type)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_ci_yearly_year ON ci_yearly_stats(year);
CREATE INDEX IF NOT EXISTS idx_ci_age_year ON ci_age_stats(year);
CREATE INDEX IF NOT EXISTS idx_ci_region_year ON ci_region_stats(year);
CREATE INDEX IF NOT EXISTS idx_ci_inst_year ON ci_institution_stats(year);
