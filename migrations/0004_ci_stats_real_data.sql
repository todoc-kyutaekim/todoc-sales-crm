-- 기존 CI 통계 테이블 드롭 및 실제 HIRA 데이터 구조로 재생성

DROP TABLE IF EXISTS ci_yearly_stats;
DROP TABLE IF EXISTS ci_age_stats;
DROP TABLE IF EXISTS ci_region_stats;
DROP TABLE IF EXISTS ci_institution_stats;
DROP INDEX IF EXISTS idx_ci_yearly_year;
DROP INDEX IF EXISTS idx_ci_age_year;
DROP INDEX IF EXISTS idx_ci_region_year;
DROP INDEX IF EXISTS idx_ci_inst_year;

-- 1. 입원외래별현황 (성별 포함)
CREATE TABLE IF NOT EXISTS ci_inpatient_outpatient (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  gender TEXT NOT NULL,        -- '계','남','여'
  visit_type TEXT NOT NULL,    -- '계','소계','입원','외래'
  patients INTEGER DEFAULT 0,
  usage INTEGER DEFAULT 0,
  amount INTEGER DEFAULT 0,
  UNIQUE(year, gender, visit_type)
);

-- 2. 성별 연령 10세 구간별 현황
CREATE TABLE IF NOT EXISTS ci_age10_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  gender TEXT NOT NULL,         -- '계','남','여'
  age_group TEXT NOT NULL,      -- '계','소계','0_9세','10_19세',...,'80세이상'
  patients INTEGER DEFAULT 0,
  usage INTEGER DEFAULT 0,
  amount INTEGER DEFAULT 0,
  UNIQUE(year, gender, age_group)
);

-- 3. 성별 연령 5세 구간별 현황
CREATE TABLE IF NOT EXISTS ci_age5_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  gender TEXT NOT NULL,         -- '계','남','여'
  age_group TEXT NOT NULL,      -- '계','소계','5세미만','5_9세',...,'80세이상'
  patients INTEGER DEFAULT 0,
  usage INTEGER DEFAULT 0,
  amount INTEGER DEFAULT 0,
  UNIQUE(year, gender, age_group)
);

-- 4. 요양기관 소재지별 현황
CREATE TABLE IF NOT EXISTS ci_region_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  region TEXT NOT NULL,         -- '계','서울','부산',...
  patients INTEGER DEFAULT 0,
  usage INTEGER DEFAULT 0,
  amount INTEGER DEFAULT 0,
  UNIQUE(year, region)
);

-- 5. 요양기관 종별 현황
CREATE TABLE IF NOT EXISTS ci_institution_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  institution_type TEXT NOT NULL,  -- '계','상급종합병원','종합병원','병원급','의원급','보건기관등'
  patients INTEGER DEFAULT 0,
  usage INTEGER DEFAULT 0,
  amount INTEGER DEFAULT 0,
  UNIQUE(year, institution_type)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_ci_io_year ON ci_inpatient_outpatient(year);
CREATE INDEX IF NOT EXISTS idx_ci_age10_year ON ci_age10_stats(year);
CREATE INDEX IF NOT EXISTS idx_ci_age5_year ON ci_age5_stats(year);
CREATE INDEX IF NOT EXISTS idx_ci_region_year ON ci_region_stats(year);
CREATE INDEX IF NOT EXISTS idx_ci_inst_year ON ci_institution_stats(year);
