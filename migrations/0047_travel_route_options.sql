-- 0047: 연료 종류별 통행료 + 실제 운행 경로 반영
--
-- 배경
--   1) 통행료를 카카오 길찾기에 항상 car_fuel=GASOLINE 으로 요청해 왔습니다.
--      카카오는 ELECTRIC 을 지원하며 전기차 고속도로 통행료 감면을 자동 반영합니다.
--      (서울역→부산역 실측: GASOLINE 20,200원 / ELECTRIC 14,410원)
--      따라서 담당자별 연료 종류를 저장해 요청에 반영합니다.
--   2) 경로를 항상 priority=RECOMMEND(추천) 로만 산출해 실제 운행 동선과 달랐습니다.
--      일자별로 경로 방식을 고르고, 추천/최단거리 어느 쪽에도 안 나오는 길(정체 우회로
--      국도를 탄 경우 등)은 지도에서 지나온 지점을 경유지로 찍어 재현합니다.

-- ── 담당자 차량 연료 종류 ────────────────────────────────────────────────
-- GASOLINE(휘발유) | DIESEL(경유) | LPG | ELECTRIC(전기)
-- NULL 이면 GASOLINE 으로 간주합니다(기존 동작과 동일).
-- 전기차는 vehicle_fuel_efficiency 를 km/kWh(전비),
-- vehicle_fuel_price 를 원/kWh(전기요금) 로 해석합니다.
ALTER TABLE users ADD COLUMN vehicle_fuel TEXT;

-- ── 일자별 경로 방식 / 경유지 ────────────────────────────────────────────
-- route_priority: RECOMMEND(추천) | DISTANCE(최단거리) | AVOID_TOLL(무료도로)
--   NULL 이면 RECOMMEND. AVOID_TOLL 은 카카오 priority 값이 아니라
--   RECOMMEND + avoid=toll 조합으로 요청합니다(실측 확인).
ALTER TABLE travel_logs ADD COLUMN route_priority TEXT;

-- route_waypoints_json: 사용자가 지도에서 찍은 보정 경유지.
--   [{"lat":37.2,"lng":127.0,"name":"1번국도"}, ...] 형태이며 클릭 순서를 유지합니다.
--   방문 기관 사이에 끼워 넣는 것이 아니라, 그 날 전체 동선에 추가되는 통과 지점입니다.
ALTER TABLE travel_logs ADD COLUMN route_waypoints_json TEXT;

-- ── 경로 형상(지도 표시용) ───────────────────────────────────────────────
-- 카카오 응답의 roads[].vertexes 를 이어 붙인 뒤 Douglas-Peucker 로 간소화한 좌표열.
--   [[lat,lng],[lat,lng], ...] (약 10m 오차, 서울 38km 동선에서 649→123점 / 2.6KB)
-- 거리·통행료 정산에는 카카오 원본 summary 값을 그대로 쓰므로 정확도에 영향이 없습니다.
ALTER TABLE travel_route_cache ADD COLUMN polyline_json TEXT;
