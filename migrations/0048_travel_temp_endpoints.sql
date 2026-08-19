-- 0048: 그 날만 쓰는 출발지/복귀지 (숙소 등)
--
-- 배경
--   지방 출장 중에는 숙소에서 출발하거나 숙소로 복귀하는 날이 있습니다.
--   숙소는 매번 바뀌므로 travel_places(자주 쓰는 장소)에 등록하면
--     1) 목록이 끝없이 늘어나 집·사무실을 고르기 어려워지고
--     2) 나중에 정리하려고 지우면 travel_logs.origin_place_id 가 가리킬 곳을 잃어
--        이미 마감한 지난 달 정산 기록의 출발지가 사라집니다.
--
--   그래서 장소 목록을 늘리지 않고, 그 날 기록에 주소와 좌표를 직접 남깁니다.
--   기록에 값이 그대로 들어 있으므로 나중에 무엇을 지워도 깨지지 않고,
--   보고서의 「지역(시/군/구)」도 이 주소에서 뽑아 채웁니다.
--
-- 적용 우선순위 (resolveEndpoints)
--   0) origin_temp_lat/lng 가 채워져 있으면 그 날은 이 값을 씁니다  ← 이번에 추가
--   1) travel_logs.origin_place_id (0 = "없음"을 명시적으로 선택)
--   2) 본인 장소 기본값 → 3) 전사 공용 기본값 → 4) 전역 설정(travel_origin_*)
--
-- 좌표가 없으면 경로를 계산할 수 없으므로, 이름/주소만 있고 좌표가 비면
-- 임시 장소로 취급하지 않고 위 1) 이하로 넘어갑니다.

ALTER TABLE travel_logs ADD COLUMN origin_temp_name TEXT;
ALTER TABLE travel_logs ADD COLUMN origin_temp_address TEXT;
ALTER TABLE travel_logs ADD COLUMN origin_temp_lat REAL;
ALTER TABLE travel_logs ADD COLUMN origin_temp_lng REAL;

ALTER TABLE travel_logs ADD COLUMN return_temp_name TEXT;
ALTER TABLE travel_logs ADD COLUMN return_temp_address TEXT;
ALTER TABLE travel_logs ADD COLUMN return_temp_lat REAL;
ALTER TABLE travel_logs ADD COLUMN return_temp_lng REAL;
