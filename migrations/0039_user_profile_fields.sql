-- 마이페이지용 사용자 프로필 확장 필드
-- SQLite ALTER TABLE ADD COLUMN 사용 (기존 데이터 보존)

ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN department TEXT;         -- 부서 (예: 영업1팀, CS팀)
ALTER TABLE users ADD COLUMN position TEXT;            -- 직책 (예: 팀장, 대리)
ALTER TABLE users ADD COLUMN job_role TEXT;            -- 담당 직무 (예: 영업, CS, 임상, 마케팅)
ALTER TABLE users ADD COLUMN avatar_url TEXT;          -- 프로필 사진 URL
ALTER TABLE users ADD COLUMN bio TEXT;                 -- 자기소개 / 메모

-- 담당 직무별 필터/조회 지원 (dashboard, 미팅 필터에서 활용 가능)
CREATE INDEX IF NOT EXISTS idx_users_job_role ON users(job_role);
CREATE INDEX IF NOT EXISTS idx_users_department ON users(department);
