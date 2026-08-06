-- 외부기(어음처리기) 등록에 '이니셜'과 '보안키'를 추가합니다(사용자 요청).
-- 같은 요청에서 내부기·외부기의 '제조사' 입력칸은 화면에서 제거했습니다.
--
-- ⚠️ manufacturer 컬럼은 삭제하지 않습니다.
--    SQLite DROP COLUMN 제약도 있지만, 무엇보다 과거 값을 보존하고
--    되살릴 여지를 남기기 위함입니다. (프로덕션 현재 값은 전부 NULL 이라 손실 없음)
--
-- ⚠️ DEFAULT '' 대신 NULL 허용으로 둡니다.
--    device 테이블의 다른 텍스트 컬럼(model/serial/version)이 모두
--    `b.x || null` 패턴으로 NULL 을 저장하므로 일관성을 맞춥니다.
--    표시 로직은 `dev.initial || '—'` 로 NULL/'' 를 동일 취급합니다.
ALTER TABLE customer_external_devices ADD COLUMN initial TEXT;
ALTER TABLE customer_external_devices ADD COLUMN security_key TEXT;
