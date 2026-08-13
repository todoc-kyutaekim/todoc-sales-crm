-- 0044: 출장 거리 정산(유류비/톨게이트비 증빙) 지원 테이블
--
-- 재무팀이 요구하는 "거리 증빙 + 톨게이트 사용 내역" 자동화용.
-- 거리는 카카오모빌리티 길찾기 API 의 실제 도로 주행거리를 사용합니다.

-- ── 1) 전역 설정 (key-value) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 출발지(사무실) 기본값 — 실제 주소/좌표로 반드시 수정해야 합니다.
-- 값이 비어 있으면 그 날의 첫 방문지를 출발지로 삼습니다.
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('travel_origin_name', '');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('travel_origin_address', '');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('travel_origin_lat', '');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('travel_origin_lng', '');

-- km 당 지급 단가 (원). 회사 규정값으로 바꿔주세요. 0 이면 금액 열을 비웁니다.
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('travel_rate_per_km', '0');

-- 정산 방식: none(거리만) | mileage(km 단가 정산) | fuel(실비: 연비 기준 유류비)
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('travel_settlement_mode', 'none');

-- fuel 모드용: 연비(km/L), 유가(원/L)
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('travel_fuel_efficiency', '12');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('travel_fuel_price', '1700');

-- 마지막 방문지에서 출발지로 복귀하는 거리를 포함할지 (1=포함)
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('travel_include_return', '1');

-- ── 2) 일자별 운행기록 (국세청 별지 제65호 대응) ─────────────────────────────
-- 계기판 누적거리는 API 로 알 수 없어 사용자가 직접 입력합니다.
CREATE TABLE IF NOT EXISTS travel_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  log_date      TEXT NOT NULL,            -- YYYY-MM-DD
  user_id       INTEGER,                  -- 운전자 (users.id)
  vehicle_model TEXT,                     -- 차종
  vehicle_plate TEXT,                     -- 자동차 등록번호
  odo_start     INTEGER,                  -- 주행 전 계기판 누적거리 (km)
  odo_end       INTEGER,                  -- 주행 후 계기판 누적거리 (km)
  toll_amount   INTEGER,                  -- 하이패스 내역 기준 실제 통행료 (원)
  fuel_amount   INTEGER,                  -- 실제 주유 금액 (원)
  note          TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(log_date, user_id)
);
CREATE INDEX IF NOT EXISTS idx_travel_logs_date ON travel_logs(log_date);

-- ── 3) 경로 계산 캐시 ───────────────────────────────────────────────────────
-- 같은 기간 보고서를 여러 번 뽑아도 카카오 API 무료 한도(자동차 10,000건/일,
-- 다중경유지 5,000건/일)를 소모하지 않도록 좌표 시퀀스 단위로 캐시합니다.
CREATE TABLE IF NOT EXISTS travel_route_cache (
  route_key   TEXT PRIMARY KEY,   -- "lng,lat|lng,lat|..." 좌표 시퀀스
  distance_m  INTEGER NOT NULL,
  duration_s  INTEGER NOT NULL,
  toll        INTEGER NOT NULL DEFAULT 0,
  legs_json   TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
