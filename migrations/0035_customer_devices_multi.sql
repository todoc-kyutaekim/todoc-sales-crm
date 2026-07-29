-- 고객 디바이스 다중 지원
-- 기존 customers.internal_*/external_* 는 유지(백업용, 접이식 UI에서 계속 볼 수 있음)
-- 새 테이블에서 좌/우 내부기(최대 2) + 다중 외부기 관리

-- 1) customers.surgery_side: 시술 부위 ('left' | 'right' | 'both')
--    NULL 허용 (미입력 상태)
ALTER TABLE customers ADD COLUMN surgery_side TEXT;
CREATE INDEX IF NOT EXISTS idx_customers_surgery_side ON customers(surgery_side);

-- 2) customer_internal_devices: 내부기(임플란트)
--    UNIQUE(customer_id, side) — 좌/우 각각 최대 1개
CREATE TABLE IF NOT EXISTS customer_internal_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('left','right')),
  manufacturer TEXT,
  model TEXT,
  serial TEXT,
  implant_date TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(customer_id, side)
);
CREATE INDEX IF NOT EXISTS idx_int_dev_customer ON customer_internal_devices(customer_id);
CREATE INDEX IF NOT EXISTS idx_int_dev_manufacturer ON customer_internal_devices(manufacturer);
CREATE INDEX IF NOT EXISTS idx_int_dev_serial ON customer_internal_devices(serial);

-- 3) customer_external_devices: 외부기(사운드 프로세서, 여러 개)
--    is_active=1 → 현재 사용 중
--    side: 이 외부기가 어느 쪽 귀에 사용되는지
CREATE TABLE IF NOT EXISTS customer_external_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('left','right')),
  manufacturer TEXT,
  model TEXT,
  serial TEXT,
  supply_date TEXT,
  version TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ext_dev_customer ON customer_external_devices(customer_id);
CREATE INDEX IF NOT EXISTS idx_ext_dev_active ON customer_external_devices(customer_id, is_active);
CREATE INDEX IF NOT EXISTS idx_ext_dev_manufacturer ON customer_external_devices(manufacturer);
CREATE INDEX IF NOT EXISTS idx_ext_dev_serial ON customer_external_devices(serial);

-- 4) 기존 데이터 이관
--    (a) 내부기 flat 필드 → customer_internal_devices
--        internal_side 값별로 처리: 'L' → left, 'R' → right, 'BOTH' → left + right 두 건
INSERT INTO customer_internal_devices (customer_id, side, manufacturer, model, serial, implant_date)
  SELECT id, 'left', internal_manufacturer, internal_model, internal_serial, internal_implant_date
  FROM customers
  WHERE (internal_manufacturer IS NOT NULL OR internal_model IS NOT NULL OR internal_serial IS NOT NULL OR internal_implant_date IS NOT NULL)
    AND (internal_side = 'L' OR internal_side = 'BOTH' OR internal_side IS NULL OR internal_side = '');

INSERT INTO customer_internal_devices (customer_id, side, manufacturer, model, serial, implant_date)
  SELECT id, 'right', internal_manufacturer, internal_model, internal_serial, internal_implant_date
  FROM customers
  WHERE (internal_manufacturer IS NOT NULL OR internal_model IS NOT NULL OR internal_serial IS NOT NULL OR internal_implant_date IS NOT NULL)
    AND (internal_side = 'R' OR internal_side = 'BOTH');

--    (b) 외부기 flat 필드 → customer_external_devices
--        internal_side 를 기준으로 어느 쪽에 사용하는지 추정, BOTH이면 좌측만 등록 (사용자가 편집)
--        internal_side가 없으면 기본 left
INSERT INTO customer_external_devices (customer_id, side, manufacturer, model, serial, supply_date, version, is_active)
  SELECT id,
         CASE
           WHEN internal_side = 'R' THEN 'right'
           ELSE 'left'
         END,
         external_manufacturer, external_model, external_serial, external_supply_date, external_version, 1
  FROM customers
  WHERE (external_manufacturer IS NOT NULL OR external_model IS NOT NULL OR external_serial IS NOT NULL OR external_supply_date IS NOT NULL OR external_version IS NOT NULL);

--    (c) customers.surgery_side 추정: internal_side → surgery_side
--        'L' → 'left', 'R' → 'right', 'BOTH' → 'both'
UPDATE customers SET surgery_side = 'left'  WHERE surgery_side IS NULL AND internal_side = 'L';
UPDATE customers SET surgery_side = 'right' WHERE surgery_side IS NULL AND internal_side = 'R';
UPDATE customers SET surgery_side = 'both'  WHERE surgery_side IS NULL AND internal_side = 'BOTH';
--        implant_side (legacy) 도 fallback
UPDATE customers SET surgery_side = 'left'  WHERE surgery_side IS NULL AND implant_side = 'L';
UPDATE customers SET surgery_side = 'right' WHERE surgery_side IS NULL AND implant_side = 'R';
UPDATE customers SET surgery_side = 'both'  WHERE surgery_side IS NULL AND implant_side = 'BOTH';
