-- 고객 '유형'/'상태' 구분 폐기 → 전원 '수술 환자'(patient) · '활성'(active)로 통일
--
-- 배경:
--   유형(가망고객/보호자/수술 환자)과 상태(활성/비활성/휴면) 입력칸을 사용자 요청으로
--   폼·목록·필터·통계에서 모두 제거했습니다. 고객 분류는 '고객 그룹' 기능이 담당합니다.
--
-- ⚠️ 컬럼은 삭제하지 않습니다.
--   1) SQLite의 DROP COLUMN 은 제약이 많고, 되살릴 여지를 남겨두는 편이 안전합니다.
--   2) 백엔드 GET /api/customers 의 type/status 쿼리 파라미터가 그대로 살아 있어
--      필요해지면 프런트 select 만 되살리면 동작합니다.
--
-- ⚠️ 백엔드 PUT 은 customer_type/status 를 UPDATE 대상에서 제외했습니다.
--   폼이 값을 보내지 않는데 SET 절에 남겨두면 고객을 수정할 때마다
--   기존 값이 기본값으로 덮어써지기 때문입니다(조용한 데이터 변조).

-- 기존 데이터 정리: 비어 있거나 다른 유형인 행을 patient 로 통일
UPDATE customers
   SET customer_type = 'patient'
 WHERE customer_type IS NULL
    OR customer_type <> 'patient';

-- 상태도 활성으로 통일 (화면에 조작 수단이 없어졌으므로 비활성/휴면이 남으면 혼란)
UPDATE customers
   SET status = 'active'
 WHERE status IS NULL
    OR status <> 'active';
