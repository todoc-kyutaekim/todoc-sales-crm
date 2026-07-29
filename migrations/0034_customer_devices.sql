-- 고객 내부기/외부기 정보 확장
-- 내부기 = 수술로 삽입되는 임플란트
-- 외부기 = 착용형 사운드 프로세서 (교체 가능)
-- 기존 implant_date/implant_side/device_model/device_serial 필드는 유지 (호환성)

-- 내부기 (Implant)
ALTER TABLE customers ADD COLUMN internal_manufacturer TEXT;
ALTER TABLE customers ADD COLUMN internal_model TEXT;
ALTER TABLE customers ADD COLUMN internal_serial TEXT;
ALTER TABLE customers ADD COLUMN internal_implant_date TEXT;
ALTER TABLE customers ADD COLUMN internal_side TEXT;

-- 외부기 (Sound Processor)
ALTER TABLE customers ADD COLUMN external_manufacturer TEXT;
ALTER TABLE customers ADD COLUMN external_model TEXT;
ALTER TABLE customers ADD COLUMN external_serial TEXT;
ALTER TABLE customers ADD COLUMN external_supply_date TEXT;
ALTER TABLE customers ADD COLUMN external_version TEXT;

-- 검색용 인덱스 (제조사·시리얼로 조회하는 경우 대비)
CREATE INDEX IF NOT EXISTS idx_customers_internal_manufacturer ON customers(internal_manufacturer);
CREATE INDEX IF NOT EXISTS idx_customers_external_manufacturer ON customers(external_manufacturer);
CREATE INDEX IF NOT EXISTS idx_customers_internal_serial ON customers(internal_serial);
CREATE INDEX IF NOT EXISTS idx_customers_external_serial ON customers(external_serial);
