-- 제품 마스터에 모델명(model_code) 필드 추가
-- 카테고리별 기본 모델명을 등록해두면 유닛 입고 시 자동 적용됨
-- 기존 product_units.asset_code는 호환 유지하되, 비어있으면 제품의 model_code를 표시용으로 사용

ALTER TABLE products ADD COLUMN model_code TEXT;
