-- with_user 상태를 in_stock으로 통합 (담당자 보유 상태 제거)
-- 재고 상태에서도 보유자가 있을 수 있도록 통합
UPDATE product_units SET status = 'in_stock' WHERE status = 'with_user';
UPDATE product_sets SET status = 'in_stock' WHERE status = 'with_user';
