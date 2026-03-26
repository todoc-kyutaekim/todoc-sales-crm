-- 교수 테이블에 photo 컬럼 추가 (Base64 저장)
ALTER TABLE doctors ADD COLUMN photo TEXT DEFAULT '';
