-- 0046: 출발지/복귀지를 "장소 목록 + 날짜별 선택" 구조로 확장
--
-- 배경: 실제 영업 동선은 출발지가 집인 날도 있고 사무실인 날도 있으며,
--       복귀지도 집/사무실이 뒤섞입니다. 0044 의 전역 출발지 1개 +
--       include_return(on/off) 구조로는 표현할 수 없습니다.
--
-- 설계:
--   1) travel_places       : 자주 쓰는 장소(집/사무실/기타)를 담당자별로 등록
--   2) travel_logs 확장     : 그 날 실제로 쓴 출발지/복귀지를 일자별로 지정
--
-- 기존 전역 설정(travel_origin_*)은 "기본 출발지"로 계속 쓰이며,
-- 장소를 고르지 않은 날에는 종전과 동일하게 동작합니다 (하위 호환).

-- ── 1) 자주 쓰는 장소 ───────────────────────────────────────────────────────
-- user_id 가 NULL 이면 전사 공용 장소(예: 본사)로 취급합니다.
CREATE TABLE IF NOT EXISTS travel_places (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,                    -- 소유자 (NULL = 전사 공용)
  name        TEXT NOT NULL,              -- '집', '본사', '수원 사무실' 등
  place_type  TEXT NOT NULL DEFAULT 'other', -- home | office | other
  address     TEXT DEFAULT '',
  lat         REAL,
  lng         REAL,
  is_default_origin INTEGER NOT NULL DEFAULT 0, -- 출발지 기본값으로 쓸지
  is_default_return INTEGER NOT NULL DEFAULT 0, -- 복귀지 기본값으로 쓸지
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_travel_places_user ON travel_places(user_id);

-- ── 2) 일자별 출발지/복귀지 지정 ─────────────────────────────────────────────
-- origin_place_id / return_place_id
--   NULL  : 미지정 → 기본값(장소 기본 플래그 → 전역 설정) 적용
--   0     : "없음"을 명시적으로 선택 (첫 방문지에서 시작 / 복귀 구간 없음)
--   양수  : travel_places.id
ALTER TABLE travel_logs ADD COLUMN origin_place_id INTEGER;
ALTER TABLE travel_logs ADD COLUMN return_place_id INTEGER;
