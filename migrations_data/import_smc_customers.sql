-- SMC 초기사용자 10명 임포트 (엑셀 원본: crm_고객정보 (1).xlsx)
-- hospital_id는 삼성서울병원 이름으로 서브쿼리 (local/remote 자동 매칭)
-- 이미 같은 phone이 있으면 스킵 (INSERT OR IGNORE + UNIQUE(phone) 없으므로 SELECT 체크로 방어)

-- 김중태 (010-7368-8745)
INSERT INTO customers (name, phone, birth_date, gender, customer_type, hospital_id, address, region, status, tags, notes, external_manufacturer, external_supply_date, external_version) SELECT '김중태', '010-7368-8745', '1951-02-26', 'M', 'patient', (SELECT id FROM hospitals WHERE name='삼성서울병원' LIMIT 1), '경기도 고양시 덕양구 은빛로29번길 47-9 (화정동) 201호', '경기', 'active', '["초기사용자","SMC"]', 'SMC01
260627_1.5버전교체', NULL, '2026-06-27', '1.5' WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone='010-7368-8745');

-- 김종광 (010-2111-7815)
INSERT INTO customers (name, phone, birth_date, gender, customer_type, hospital_id, address, region, status, tags, notes, external_manufacturer, external_supply_date, external_version) SELECT '김종광', '010-2111-7815', '1948-01-27', 'M', 'patient', (SELECT id FROM hospitals WHERE name='삼성서울병원' LIMIT 1), '충청북도 청주시 서원구 구룡산로52번길 51 (성화동, 다안채6단지아파트) 608동 1202호', '충북', 'active', '["초기사용자","SMC"]', 'SMC02 (아내 보호자 010-8272-2304)
260604_1.5버전교체', NULL, '2026-06-04', '1.5' WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone='010-2111-7815');

-- 지남숙 (010-3919-5671)
INSERT INTO customers (name, phone, birth_date, gender, customer_type, hospital_id, address, region, status, tags, notes, external_manufacturer, external_supply_date, external_version) SELECT '지남숙', '010-3919-5671', '1962-01-15', 'F', 'patient', (SELECT id FROM hospitals WHERE name='삼성서울병원' LIMIT 1), '서울특별시 노원구 덕릉로73길 28 (중계동, 양지대림2차아파트) 202동 1802호', '서울', 'active', '["초기사용자","SMC"]', 'SMC03
260605_1.5버전교체', NULL, '2026-06-05', '1.5' WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone='010-3919-5671');

-- 김은화 (010-3130-9503)
INSERT INTO customers (name, phone, birth_date, gender, customer_type, hospital_id, address, region, status, tags, notes, external_manufacturer, external_supply_date, external_version) SELECT '김은화', '010-3130-9503', '1971-06-22', 'F', 'patient', (SELECT id FROM hospitals WHERE name='삼성서울병원' LIMIT 1), '대구광역시 달성군 화원읍 성암로 25 (대구본리2단지) 203동 301호', '대구', 'active', '["초기사용자","SMC"]', 'SMC04
260627_1.5버전교체
회사주소: 대구 북구 구리로10(광명자원)', NULL, '2026-06-27', '1.5' WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone='010-3130-9503');

-- 박정화 (010-3347-5441)
INSERT INTO customers (name, phone, birth_date, gender, customer_type, hospital_id, address, region, status, tags, notes, external_manufacturer, external_supply_date, external_version) SELECT '박정화', '010-3347-5441', '1972-06-15', 'F', 'patient', (SELECT id FROM hospitals WHERE name='삼성서울병원' LIMIT 1), '경기도 용인시 수지구 동천로135번길 21 (동천동, 한빛마을 래미안 이스트팰리스 3단지) 1309동 1102호', '경기', 'active', '["초기사용자","SMC"]', 'SMC05
260627_1.5버전교체', NULL, '2026-06-27', '1.5' WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone='010-3347-5441');

-- 김병수 (010-7450-5239)
INSERT INTO customers (name, phone, birth_date, gender, customer_type, hospital_id, address, region, status, tags, notes, external_manufacturer, external_supply_date, external_version) SELECT '김병수', '010-7450-5239', '1968-11-29', 'M', 'patient', (SELECT id FROM hospitals WHERE name='삼성서울병원' LIMIT 1), '광주광역시 광산구 임방울대로 727-6 (월계동, 기산아파트) 101동 504호', '광주', 'active', '["초기사용자","SMC"]', 'SMC06', NULL, NULL, NULL WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone='010-7450-5239');

-- 박의규 (010-4101-7551)
INSERT INTO customers (name, phone, birth_date, gender, customer_type, hospital_id, address, region, status, tags, notes, external_manufacturer, external_supply_date, external_version) SELECT '박의규', '010-4101-7551', '1998-09-16', 'M', 'patient', (SELECT id FROM hospitals WHERE name='삼성서울병원' LIMIT 1), '경기도 안산시 상록구 영화2길 5-1 (사동) 윤성리치빌 202호', '경기', 'active', '["초기사용자","SMC"]', 'SMC07 #은빛
260627_1.5버전교체', NULL, '2026-06-27', '1.5' WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone='010-4101-7551');

-- 이연희 (010-6413-5886)
INSERT INTO customers (name, phone, birth_date, gender, customer_type, hospital_id, address, region, status, tags, notes, external_manufacturer, external_supply_date, external_version) SELECT '이연희', '010-6413-5886', '1941-10-16', 'F', 'patient', (SELECT id FROM hospitals WHERE name='삼성서울병원' LIMIT 1), '경상남도 거창군 거창읍 강변로 127 한성시티빌 101동 1302호', '경남', 'active', '["초기사용자","SMC"]', 'SMC08', NULL, NULL, NULL WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone='010-6413-5886');

-- 홍이빈 (010-2607-2688)
INSERT INTO customers (name, phone, birth_date, gender, customer_type, hospital_id, address, region, status, tags, notes, external_manufacturer, external_supply_date, external_version) SELECT '홍이빈', '010-2607-2688', '1973-10-02', 'F', 'patient', (SELECT id FROM hospitals WHERE name='삼성서울병원' LIMIT 1), '대전광역시 서구 도안동로 77 (도안동, 도안18단지린풀하우스) 1807동 1704호', '대전', 'active', '["초기사용자","SMC"]', 'SMC09', NULL, NULL, NULL WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone='010-2607-2688');

-- 신창규 (010-5592-2502)
INSERT INTO customers (name, phone, birth_date, gender, customer_type, hospital_id, address, region, status, tags, notes, external_manufacturer, external_supply_date, external_version) SELECT '신창규', '010-5592-2502', '1959-06-20', 'M', 'patient', (SELECT id FROM hospitals WHERE name='삼성서울병원' LIMIT 1), '경상남도 밀양시 영남루2길 24-19 (내일동) 한솥만물', '경남', 'active', '["초기사용자","SMC"]', 'SMC10
260627_1.5버전교체
보호자(아내) 010-3883-8585', NULL, '2026-06-27', '1.5' WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone='010-5592-2502');

