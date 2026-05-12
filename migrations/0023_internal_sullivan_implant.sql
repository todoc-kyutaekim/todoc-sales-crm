-- 내부기 제품명을 'Sullivan Implant'로 변경
-- model은 식별자라 유지, name만 표시용 라벨로 변경
UPDATE products
SET name = 'Sullivan Implant',
    model = 'sullivan_implant',
    updated_at = CURRENT_TIMESTAMP
WHERE category = 'internal' AND model = 'default';
