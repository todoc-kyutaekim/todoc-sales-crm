-- 미사용 사용자 제거: 관리자(id=2), Test PubMed(id=5), ProdTest(id=6)
-- 참조 정리 후 users 삭제 (로컬/원격 공통 스키마 기준)

-- 1) 세션 삭제
DELETE FROM sessions WHERE user_id IN (2, 5, 6);

-- 2) 사용자 직접 참조 테이블 정리
DELETE FROM mention_notifications WHERE user_id IN (2, 5, 6);
DELETE FROM meeting_users WHERE user_id IN (2, 5, 6);
DELETE FROM meeting_comments WHERE user_id IN (2, 5, 6);
DELETE FROM favorites WHERE user_id IN (2, 5, 6);
DELETE FROM kpi_targets WHERE user_id IN (2, 5, 6);
DELETE FROM pipeline_transitions WHERE changed_by IN (2, 5, 6);
DELETE FROM product_holders WHERE user_id IN (2, 5, 6);

-- 3) 제품 이동 이력 정리 (from_user_id / to_user_id / performed_by)
DELETE FROM product_movements
  WHERE from_user_id IN (2, 5, 6)
     OR to_user_id IN (2, 5, 6)
     OR performed_by IN (2, 5, 6);

-- 4) 병원 등급 변경 이력
DELETE FROM hospital_grade_history WHERE changed_by IN (2, 5, 6);

-- 5) 사용자 삭제
DELETE FROM users WHERE id IN (2, 5, 6);
