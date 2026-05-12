-- ============================================================
-- 0028_product_scoped_serial_unique.sql
-- 시리얼번호 UNIQUE 제약을 전역 → 제품(product_id)별로 변경
--
-- 배경:
--   기존 idx_product_units_serial 은 product_id 와 무관하게
--   serial_no 만으로 UNIQUE 를 강제했음. 그 결과:
--     - 휴대보관함의 'CC001' 시리얼이 외부기의 동일 시리얼과 충돌
--     - 다량 입고 시 다른 카테고리 제품의 시리얼과 겹치면 전부 스킵
--   카테고리/모델별로 시리얼 번호 체계가 다르므로, 제품 단위로 UNIQUE 를 적용한다.
-- ============================================================

DROP INDEX IF EXISTS idx_product_units_serial;

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_units_serial
  ON product_units(product_id, serial_no)
  WHERE serial_no IS NOT NULL AND serial_no != '';
