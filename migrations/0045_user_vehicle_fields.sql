-- 0045: 마이페이지 차량 정보 (출장 거리 정산용)
--
-- 차량 형태와 km당 단가는 사람마다 다를 수 있어(법인차 이용자 / 개인차 이용자 혼재)
-- 전역 설정(app_settings)이 아니라 사용자별로 저장합니다.
-- 전역 설정값은 개인값이 비어 있을 때의 기본값(fallback)으로 씁니다.

-- 차량 형태: '' (미설정) | corporate(법인차) | private_allowance(개인차+자가운전보조금)
--            | private_actual(개인차+실비)
ALTER TABLE users ADD COLUMN vehicle_type TEXT;

-- 차종 (예: 쏘렌토) — 국세청 운행기록부 필수 항목
ALTER TABLE users ADD COLUMN vehicle_model TEXT;

-- 자동차 등록번호 (예: 12가3456) — 국세청 운행기록부 필수 항목
ALTER TABLE users ADD COLUMN vehicle_plate TEXT;

-- km당 지급 단가 (원). NULL 이면 전역 설정값을 사용합니다.
ALTER TABLE users ADD COLUMN travel_rate_per_km REAL;

-- 실비(유류비) 정산용 연비(km/L)와 유가(원/L). NULL 이면 전역 설정값 사용.
ALTER TABLE users ADD COLUMN vehicle_fuel_efficiency REAL;
ALTER TABLE users ADD COLUMN vehicle_fuel_price REAL;
