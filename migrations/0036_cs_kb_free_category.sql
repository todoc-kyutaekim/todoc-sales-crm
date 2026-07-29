-- ============================================================
-- 0036: cs_kb_articles 카테고리 CHECK 제약 완화
--   - 기존: CHECK (category IN ('product','procedure','warranty','billing','other'))
--   - 변경: 자유 문자열 (UI에서 카테고리 자유 관리)
--   - SQLite는 CHECK 제약을 ALTER로 수정 불가 → 테이블 재생성 방식
-- ============================================================

-- 1) 임시 새 테이블 생성 (CHECK 제약 제거, 나머지 동일)
CREATE TABLE cs_kb_articles_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  category TEXT NOT NULL DEFAULT 'other',

  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',

  tags TEXT,

  visibility TEXT NOT NULL DEFAULT 'internal'
    CHECK (visibility IN ('public','internal')),

  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft','published','archived')),

  view_count INTEGER NOT NULL DEFAULT 0,

  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2) 기존 데이터 복사
INSERT INTO cs_kb_articles_new
  (id, category, title, content, tags, visibility, status, view_count, author_id, created_at, updated_at)
SELECT
  id, category, title, content, tags, visibility, status, view_count, author_id, created_at, updated_at
FROM cs_kb_articles;

-- 3) 기존 테이블 삭제
DROP TABLE cs_kb_articles;

-- 4) rename
ALTER TABLE cs_kb_articles_new RENAME TO cs_kb_articles;

-- 5) 인덱스 재생성
CREATE INDEX IF NOT EXISTS idx_cs_kb_category ON cs_kb_articles(category);
CREATE INDEX IF NOT EXISTS idx_cs_kb_status ON cs_kb_articles(status);
CREATE INDEX IF NOT EXISTS idx_cs_kb_visibility ON cs_kb_articles(visibility);
CREATE INDEX IF NOT EXISTS idx_cs_kb_updated_at ON cs_kb_articles(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cs_kb_view_count ON cs_kb_articles(view_count DESC);
