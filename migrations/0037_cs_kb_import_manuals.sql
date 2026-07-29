-- ============================================================
-- 0037: CS 매뉴얼 3개 → cs_kb_articles 임포트
--   생성: 매뉴얼2(FAQ) + 매뉴얼3(A/S프로세스) + 매뉴얼1(질의응답+응대매뉴얼)
--   총 아티클: 105
--   상태별: {'published': 103, 'draft': 2}
--   카테고리별: {'기기동작/LED': 5, '충전': 3, '외부기': 4, '앱': 3, '침수': 2, '분실': 2, '액세서리구매': 4, '소리조절/매핑': 1, '기타': 7, 'A/S프로세스': 1, '제품관련': 23, '수술 전': 18, '수술 후 재활': 10, '매핑 후 사후관리': 2, 'A/S 관련': 7, '요양급여': 4, '임상관련': 8, '응대매뉴얼': 1}
-- ============================================================

-- 중복 임포트 방지: 같은 title이 이미 있으면 스킵

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '기기동작/LED', '전원이 안 켜져요.', '**Q. 전원이 안 켜져요.
작동이 안돼요.
소리가 안나요.**

**A.**
1) 내부기-외부기 정렬 위치 재확인
2) 배터리 충전상태 확인
3) LED등 표시 확인
1-3확인 후 안될 시 제조사 A/S 안내(방문 및 택배)

담당부서: **H/W**', '["FAQ", "기기동작/LED", "H/W"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '전원이 안 켜져요.');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '기기동작/LED', 'LED등이 계속 깜빡거려요.', '**Q. LED등이 계속 깜빡거려요.**

**A.**
깜빡임은 외부기와 내부기가 연결되어 정상 작동 중 표시
-녹색 깜빡임: 배터리 잔량이 많음
-노란색 깜빡임: 배터리 잔량이 낮음
깜빡임이 보여 불편하시면 앱에서 LED등 끄기를 눌러 주시면 됩니다.

담당부서: **H/W**', '["FAQ", "기기동작/LED", "H/W"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = 'LED등이 계속 깜빡거려요.');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '기기동작/LED', 'LED등 표시는 되는데 소리가 안 들려요.', '**Q. LED등 표시는 되는데 소리가 안 들려요.**

**A.**
1) 앱 연결 확인
2) 제조사 A/S 안내(방문 및 택배)

담당부서: **H/W**', '["FAQ", "기기동작/LED", "H/W"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = 'LED등 표시는 되는데 소리가 안 들려요.');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '기기동작/LED', 'LED등 표시가 안돼요.', '**Q. LED등 표시가 안돼요.**

**A.**
1) 앱 연결 확인 -> LED등 꺼짐 확인
2) 제조사 A/S 안내(방문 및 택배)

담당부서: **H/W**', '["FAQ", "기기동작/LED", "H/W"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = 'LED등 표시가 안돼요.');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '기기동작/LED', 'LED등이 빨간색이에요(에러표시)', '**Q. LED등이 빨간색이에요(에러표시)**

**A.**
1) 외부기 재부팅(껐다 켜기)
2) 충전 후 재확인
3) 지속적인 문제시 제조사 A/S 안내(방문 및 택배)

담당부서: **H/W**', '["FAQ", "기기동작/LED", "H/W"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = 'LED등이 빨간색이에요(에러표시)');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '충전', '충전하는 법을 잘 모르겠어요', '**Q. 충전하는 법을 잘 모르겠어요**

**A.**
사용자 퀵 매뉴얼 재 설명

담당부서: **H/W**', '["FAQ", "충전", "H/W"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '충전하는 법을 잘 모르겠어요');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '충전', '충전이 안돼요', '**Q. 충전이 안돼요
충전을 오랫동안 해도 완료가 안돼요.
(계속 백색 LED등 깜빡임)**

**A.**
1) 충전방법 재 설명
2) 충전케이블 교체 후 재충전 확인
3) 제조사 A/S 안내(방문 및 택배)

담당부서: **H/W**', '["FAQ", "충전", "H/W"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '충전이 안돼요');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '충전', '충전기가 고장 났어요.', '**Q. 충전기가 고장 났어요.**

담당부서: **H/W**', '["FAQ", "충전", "H/W"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '충전기가 고장 났어요.');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '외부기', '외부기가 자꾸 떨어져요.', '**Q. 외부기가 자꾸 떨어져요.**

**A.**
높은 자석으로 교체 안내
(원하는 강도가 없을 때는 제조사문의)

📝 참고: *1.5세대 이하는 
2,3번 자석만 
구비되어 있음

담당부서: **H/W**', '["FAQ", "외부기", "H/W"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '외부기가 자꾸 떨어져요.');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '외부기', '외부기 부착했는데 너무 아파요.', '**Q. 외부기 부착했는데 너무 아파요.**

**A.**
낮은 자석으로 교체 안내
(원하는 강도가 없을 때는 제조사문의)

📝 참고: *1.5세대 이하는 
2,3번 자석만 
구비되어 있음

담당부서: **H/W**', '["FAQ", "외부기", "H/W"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '외부기 부착했는데 너무 아파요.');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '외부기', '사용하는데 외부기가 뜨거워지는 것 같아요.', '**Q. 사용하는데 외부기가 뜨거워지는 것 같아요.**

**A.**
따뜻하거나 뜨거워지는 경우 바로 사용을 중단 후 제거한 다음, 다시 재 부착 안내.
추후 지속 시 제조사 및 병원 방문안내

담당부서: **H/W**', '["FAQ", "외부기", "H/W"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '사용하는데 외부기가 뜨거워지는 것 같아요.');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '외부기', '외부기 방수가 되나요?', '**Q. 외부기 방수가 되나요?**

**A.**
약간의 생활방수 가능
1m 이하의 얕은 물에서 직접 물이 들어가지 않는 선에서 잠깐 동안 사용하는 것은 가능합니다. 하지만, 목욕이나 수영과 같이 수중 활동을 하는 곳에서 계속 사용하거나 직접적인 물에 접촉하는 건 어려울 수 있습니다. 이때는 방수팩과 같은 추가 엑세서리를 사용해야 합니다.

📝 참고: 현재 방수 등급은 없으며 방수커버 제작예정

담당부서: **H/W**', '["FAQ", "외부기", "H/W"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '외부기 방수가 되나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '앱', '앱 로그인이 안 돼요.', '**Q. 앱 로그인이 안 돼요.**

**A.**
1) 사용자 퀵 매뉴얼 보며 재설명
(이름, 이니셜, 보안키, 제조번호, 페어링키 등 입력방법 설명) 
2) 어려울 시 제조사 및 병원 방문안내

담당부서: **앱**', '["FAQ", "앱", "앱"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '앱 로그인이 안 돼요.');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '앱', '사용방법을 잘 모르겠어요.', '**Q. 사용방법을 잘 모르겠어요.**

**A.**
1) 사용자 퀵 매뉴얼 보며 재설명
(이름, 이니셜, 보안키, 제조번호, 페어링키 등 입력방법 설명) 
2) 어려울 시 제조사 및 병원 방문안내

담당부서: **앱**', '["FAQ", "앱", "앱"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '사용방법을 잘 모르겠어요.');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '앱', '휴대폰을 변경해서 앱 설치 새로 해야 돼요.', '**Q. 휴대폰을 변경해서 앱 설치 새로 해야 돼요.**

**A.**
1) 사용자 퀵 매뉴얼 보며 재설명
(이름, 이니셜, 보안키, 제조번호, 페어링키 등 입력방법 설명) 
2) 어려울 시 제조사 및 병원 방문안내

담당부서: **앱**', '["FAQ", "앱", "앱"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '휴대폰을 변경해서 앱 설치 새로 해야 돼요.');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '침수', '물이 들어간 것 같아요(완전침수).', '**Q. 물이 들어간 것 같아요(완전침수).**', '["FAQ", "침수"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '물이 들어간 것 같아요(완전침수).');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '침수', '세안할 때 물이 조금 들어갔어요.', '**Q. 세안할 때 물이 조금 들어갔어요.**', '["FAQ", "침수"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '세안할 때 물이 조금 들어갔어요.');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '분실', '외부기를 잃어버렸어요.', '**Q. 외부기를 잃어버렸어요.**', '["FAQ", "분실"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '외부기를 잃어버렸어요.');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '분실', '충전기를 잃어버렸어요.', '**Q. 충전기를 잃어버렸어요.**', '["FAQ", "분실"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '충전기를 잃어버렸어요.');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '액세서리구매', '헤어핀을 사고 싶어요.', '**Q. 헤어핀을 사고 싶어요.**', '["FAQ", "액세서리구매"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '헤어핀을 사고 싶어요.');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '액세서리구매', '충전기를 구매하고 싶어요(크레들).', '**Q. 충전기를 구매하고 싶어요(크레들).**', '["FAQ", "액세서리구매"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '충전기를 구매하고 싶어요(크레들).');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '액세서리구매', '자석을 구매하고 싶어요.', '**Q. 자석을 구매하고 싶어요.**', '["FAQ", "액세서리구매"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '자석을 구매하고 싶어요.');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '액세서리구매', '방수팩 구매하고 싶어요.', '**Q. 방수팩 구매하고 싶어요.**', '["FAQ", "액세서리구매"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '방수팩 구매하고 싶어요.');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '소리조절/매핑', '소리가 이상하게 들려요.', '**Q. 소리가 이상하게 들려요.
말소리가 정확하게 안 들려요.
주변 소음만 너무 크고 시끄러워요.
매핑을 했는데도 잘 안 들려요.**

**A.**
[지속적인 매핑과 적응필요 함 설명안내]
매핑은 최대한 자연음에 가까우면서 부드럽고 편한 소리를 사용자에게 맞는 최적의 소리를 찾아가는 과정입니다. 
1-2번 만에 모든 소리를 완벽하게 맞출 수는 없으므로 지속적인 매핑이 필요합니다. 매핑에 관하여 자세한 문의는 병원을 통해 확인 부탁드리겠습니다.', '["FAQ", "소리조절/매핑"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '소리가 이상하게 들려요.');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '기타', 'X-RAY 촬영이 가능한가요?', '**Q. X-RAY 촬영이 가능한가요?**', '["FAQ", "기타"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = 'X-RAY 촬영이 가능한가요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '기타', 'MRI 촬영이 가능한가요?', '**Q. MRI 촬영이 가능한가요?**

**A.**
네, 촬영할 수 있습니다
기존 이식된 내부장치의 종류에 따라 외부기를 고정하기 위한 자석을 제거하고 촬영하거나 각 인공와우 회사에서 호환 가능하다고 보장한 MRI 장비는 임플란트의 자석을 제거하지 않고도 촬영이 가능합니다.', '["FAQ", "기타"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = 'MRI 촬영이 가능한가요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '기타', '비행기 탑승 문제없나요?', '**Q. 비행기 탑승 문제없나요?**

**A.**
네, 탑승 가능합니다. 
금속탐지기 알람이 울릴 수 있으니, 인공와우 사용자 카드를 지참하시고 사전에 보안담당자에게 말씀해 주시는 게 좋습니다. 보안스캐너 통과 시 왜곡된 소리가 발생할 수 있으니, 외부장치를 제거 후 통과하는 것이 좋습니다.', '["FAQ", "기타"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '비행기 탑승 문제없나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '기타', '수영이나 물놀이해도 되나요?', '**Q. 수영이나 물놀이해도 되나요?**

**A.**
현재는 약한 생활방수만 가능합니다.
얕은 물에서 들어가지 않는 선에서 잠깐 사용하는 것은 가능하지만, 목욕이나 수영과 같이 수중 활동을 하는 곳에서 계속 사용하거나 직접적인 물에 접촉하는 건 어려울 수 있습니다. 
이때는 방수팩과 같은 추가 엑세서리를 사용해야 합니다.', '["FAQ", "기타"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '수영이나 물놀이해도 되나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT 'A/S프로세스', '고객불만 발생 시 업무(A/S) 프로세스 [QP-8010]', '# 고객불만 발생 시 업무(A/S) 프로세스

- [QP-8010] ‘서비스 및 고객불만 처리절차서/별첨1’ 에 따른다
- 문서위치: 품질 < 양식 < 양식작성본 – F8010-01, 02, 03, 05 등
- 모든 업무 공유는 가능한 Slack 과 구글시트 공유 및 업데이트 필수
- 업무 처리기간 : 입고일로부터 5일내 출고 목표

## 처리 단계

| 순서 | 업무 내용 | 문서번호/파일명 | 문서 위치 | 관련부서 | 담당자 |
| --- | --- | --- | --- | --- | --- |
| 1 | ◆ 고객센터 문의전화<br>CRM 및 고객센터 전화상담리스트 작성<br>임상고객 / 구매고객 → CS팀 CRM<br>그 외 고객 → 전화상담리스트<br>서비스 및 고객불만처리대장 | 1 - ① SMART 고객관리<br>1 - ② 전화상담리스트<br><br>2. 서비스 및 고객불만 처리 대장(현황표) | 1 - ① CS팀 CRM프로그램<br>1 - ② 구글 드라이브 < 10_팀별 < 21_커머셜팀 < 24_CS<br><br>2. *공유 드라이브 < 10_팀별<br>< 23_QRA팀 < 서비스 및 고<br>객불만 처리대장 | 커머셜팀 | 김민정 |
| 2 | *CS팀 문의전화가 아닌 경우 모든 최초 접수자가 구글시트 및 Slack 공유 후 업데이트 한다.<br><br>◆ 제품 입고<br>제품 입고 확인<br>Slack_smc 공유(SMC 초기 임상자 10명 한정)<br>ex) 택배 입고 및 이슈사항 등<br>고객불만 발생 통보서 작성<br>- 접수번호: 년월일+순번 / ex) 260501-01<br>- 처리구분: 서비스 / 고객불만<br>‘QP-8010 서비스 및 고객불만처리 절차서 [별첨1]’에 따라 분류하고 그 외 사항일 경우 해당 고객불만 건에 대한 구분 결정을 상급자에게 요청한다. → [별첨1]업데이트 | 1-2. Slack 공유<br><br>F8010-05(Rev.0)<br>고객불만 발생 통보서 | 1-2. Slack<br>3.  *Dropbox<br>품질 < 양식 < <br>F8010-05 | 커머셜팀 | 김민정 |
| 3 | ◆ CS팀 → QRA팀 인계 후 접수<br>서비스/고객불만 접수 및 처리대장 작성 | 서비스 및 고객불만 <br>처리 대장(현황표) | *공유 드라이브 < 10_팀별<br>< 23_QRA팀 < 서비스 및 고<br>객불만 처리대장 | QRA팀 | 박효민 |
| 4 | ◆ 서비스보고서 또는 고객불만 처리 보고서 구분<br>서비스 보고서<br>- [~ 영향평가] QRA 작성<br>- 승인자: 품질책임자(이호승)<br><br>고객불만 처리보고서 <br>- [고객불만처리 후 조치 결과확인] QRA 작성<br>- 승인자: 품질책임자(이호승) | 서비스 보고서<br>F8010-03(Rev.0) | *Dropbox<br>품질 < 양식 <<br>F8010-03(Rev.0) | QRA팀 | 박효민 |
| 4 | ◆ 서비스보고서 또는 고객불만 처리 보고서 구분<br>서비스 보고서<br>- [~ 영향평가] QRA 작성<br>- 승인자: 품질책임자(이호승)<br><br>고객불만 처리보고서 <br>- [고객불만처리 후 조치 결과확인] QRA 작성<br>- 승인자: 품질책임자(이호승) | 고객불만처리 <br>보고서<br>F8010-01(Rev.2) | *Dropbox<br>품질 < 양식 <<br>F8010-01(Rev.2) | QRA팀 | 박효민 |
| 5 | ◆ QRA팀 → 개발부 AS 전달<br>서비스 및 고객불만 처리보고서 하단 작성<br>① 서비스 보고서<br>[처리결과~서비스 후 제품검사] 개발부 작성<br><br>② 고객불만 처리보고서<br>[원인조사 ~ 처리결과] 개발부 작성<br>검수 및 매핑데이터 확인<br><br>+ (필요시)병원 매핑 데이터 복사 | 1-①서비스 보고서<br>F8010-03(Rev.0)<br><br>1-②고객불만처리<br>보고서 F8010-01(Rev.2 | 서면 기재 | H/W | Sullivan1.5:<br>이승훈<br><br>Sound1: <br>최진만/강전수 |
| 5 | ◆ QRA팀 → 개발부 AS 전달<br>서비스 및 고객불만 처리보고서 하단 작성<br>① 서비스 보고서<br>[처리결과~서비스 후 제품검사] 개발부 작성<br><br>② 고객불만 처리보고서<br>[원인조사 ~ 처리결과] 개발부 작성<br>검수 및 매핑데이터 확인<br><br>+ (필요시)병원 매핑 데이터 복사 | 1-①서비스 보고서<br>F8010-03(Rev.0)<br><br>1-②고객불만처리<br>보고서 F8010-01(Rev.2 | 서면 기재 | S/W | 매핑앱: <br>권지수<br><br>펌웨어: <br>임정우/김은수 |
| 6 | ◆ AS 후 개발부 → QRA팀 전달<br>서비스 보고서 or 고객불만 처리보고서 <br> → AS 후 나머지 여백 작성<br>서비스/고객불만 접수 및 처리대장 작성<br>최종 검수(매핑데이터 확인) | 1-①서비스 보고서<br>F8010-03(Rev.0)<br>1-②고객불만처리<br>보고서 F8010-01(Rev.2)<br><br>2. 서비스 및 고객불만<br>처리 대장(현황표) | 서면 기재<br><br>2. 공유 드라이브 < 10_팀별<br>< 23_QRA팀 < 서비스<br>및 고객불만 처리대장 | QRA팀 | 박효민 |
| 7 | ◆ QRA팀 → CS팀 전달 후 제품 출고<br>제품 확인<br>서비스 및 고객불만처리대장 확인<br>제품 발송 <br>고객 문자 발송 | 서비스 및 고객불만 <br>처리 대장(현황표) | 공유 드라이브 < 10_팀별 <<br>23_QRA팀 < 서비스 및 고객<br>불만 처리대장 | 커머셜팀 | 김민정 |
| 8 | ◆ 고객상담(처리 피드백 확인)<br>필요시 고객 확인 전화<br>CRM 및 고객센터 전화상담리스트 작성 | SMART 고객관리 | CS팀 CRM프로그램 | 커머셜팀 | 김민정 |', '["프로세스", "A/S", "QP-8010", "고객불만"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '고객불만 발생 시 업무(A/S) 프로세스 [QP-8010]');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '제품관련', '인공와우란 무엇인가요?', '**Q. 인공와우란 무엇인가요?**

**A.**
인공와우는 선천적 또는 후천적으로 소리를 들을 수 없는 사람에게 인공 달팽이관을 이식하여 소리를 들을 수 있게 해 주는 의료기기입니다
또 보청기를 통해 효과가 없거나 소리를 들을 수 없을 때 인공와우를 할 수도 있습니다.', '["Q&A", "제품관련", "#1.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '인공와우란 무엇인가요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '제품관련', '보청기와 인공와우는 무엇이 다른가요?', '**Q. 보청기와 인공와우는 무엇이 다른가요?**

**A.**
﻿보청기는 비수술 방식으로 잔존청력이 남아있는 난청인들에게 소리를 증폭하여 기존 청각 경로로 들을 수 있게 도와주는 의료보조 기기이고,
인공와우는 보청기 효과가 없거나 잔존청력이 거의 없는 고도 난청이 상인 사람에게 인공와우를 이식함으로써 소리를 들을 수 있는 수술적인 의료기기입니다.

⚠️ 상태: 재확인 필요', '["Q&A", "제품관련", "#2.0"]', 'internal', 'draft', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '보청기와 인공와우는 무엇이 다른가요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '제품관련', '보청기 효과 없는 사람도 인공와우하면 잘 들리나요?', '**Q. 보청기 효과 없는 사람도 인공와우하면 잘 들리나요?**

**A.**
일반 보청기와 달리, 인공와우는 소리를 전기적 신호로 변환하여 달팽이관내의 청신경을 직접 자극함으로써 뇌가 소리를 인식할 수 있도록 하는 원리입니다.
이전에 듣던 음향학적 소리가 아닌 전기적신호로 변환하여 듣기 때문에 생소한 기계적인 소리로 들릴 수 도 있지만 개인의 따라 느낌이 다를 수 있음으로 주기적인 매핑을 꾸준히 연습하시면 잘 들을 수 있을 거로 예상됩니다.

⚠️ 상태: 미답변', '["Q&A", "제품관련", "#3.0"]', 'internal', 'draft', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '보청기 효과 없는 사람도 인공와우하면 잘 들리나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '제품관련', '외부기가 겉으로 많이 드러나나요?', '**Q. 외부기가 겉으로 많이 드러나나요?**

**A.**
BTE(Behind The Ear) 제품은 같은 형태는 일반 보청기처럼 겉으로 많이 드러나는 편입니다. 
OTE(Over The Ear) 제품의 경우 귀걸이형이 아닌 내부장치 바로 위에 외부음성처리기 본체가 위치하기 때문에 머리카락 등으로 가릴 수 있습니다.', '["Q&A", "제품관련", "#4.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '외부기가 겉으로 많이 드러나나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '제품관련', '인공와우는 평생 사용할 수 있나요?', '**Q. 인공와우는 평생 사용할 수 있나요?**

**A.**
내부장치의 경우 대부분 평생 사용할 수 있도록 설계되어 있으며, 외부장치는 시간이 지나면 업그레이드나 교체가 필요할 수 있습니다. 이는 정기적인 점검을 통해 기기의 상태를 확인하는 것이 중요합니다.', '["Q&A", "제품관련", "#5.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '인공와우는 평생 사용할 수 있나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '제품관련', '한 쪽만 이식해도 되나요? (양쪽 이식이 필수인지?)', '**Q. 한 쪽만 이식해도 되나요? (양쪽 이식이 필수인지?)**

**A.**
네, 한쪽만 이식할 수 있습니다. 양쪽 이식이 필수는 아닙니다. 
난청의 정도에 따라 양측인지 편측인지 선택할 수 있습니다. 자세한 건 병원 방문 후 검사를 받아보시는 걸 추천드립니다.', '["Q&A", "제품관련", "#6.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '한 쪽만 이식해도 되나요? (양쪽 이식이 필수인지?)');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '제품관련', '언제 출시 되나요?', '**Q. 언제 출시 되나요?
개발 진행상황, 출시 일정**

**A.**
현재 1세대 인공와우 시스템은 개발 완료되어 임상시험 진행 중에 있습니다. 
26년 상반기에 업그레이드된 상향 버전을 출시할 예정입니다. 
출시용 제품은 2025년 연말에 개발이 완료될 예정이지만 의료기기 특성상 제품의 사소한 변경사항에 대해서도 안전성 시험을 기반으로 한 규제기관의 허가를 받아야 합니다. 
인허가 기간이 유동적이기 때문에 지금 단계에서는 확정적인 출시 일자를 말씀드릴 수 없습니다.', '["Q&A", "제품관련", "#7.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '언제 출시 되나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '제품관련', '토닥 인공와우 타사와 무엇이 다른가요?', '**Q. 토닥 인공와우 타사와 무엇이 다른가요?
(토닥의 주요 특장점)**

**A.**
저희 토닥의 인공와우는 국내 최초로 개발한 인공와우 회사입니다.
특히 가장 큰 장점은 전극의 개수가 여러 인공와우 제조사들 중 32개로 가장 많은 세계 유일의 제품이라는 점입니다. 
또한 타 제조사들은 수작업 공정을 통해 제조 하였지만 저희는 자동화 시스템을 구축하여 타사대비 더욱 정확하고 정밀한 생산이 가능합니다.', '["Q&A", "제품관련", "#8.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '토닥 인공와우 타사와 무엇이 다른가요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '제품관련', '32채널의 기대효과', '**Q. 32채널의 기대효과
전극 갯수가 더 많으면 무엇이 좋은가요?**

**A.**
인공와우의 전극은 소리를 전달해 주는 중요한 역할을 합니다.
특히 전극에 따라 사용자의 청취력이 달라질 수도 있습니다. 타사의 경우 12-24개의 전극수를 보유하고 있는 반면 저희는 32개의 전극수로 더욱 넓은 음역대를 청취 할 수 있습니다.
따라서 음악 청취와 같이 음의 높낮이와 음질의 구별력이 중요한 상황에서는 채널 수가 많은 것이 훨씬 더 유리할 것으로 예상됩니다.', '["Q&A", "제품관련", "#9.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '32채널의 기대효과');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '제품관련', 'Sullivan 이 무엇인가요?', '**Q. Sullivan 이 무엇인가요?**

**A.**
저희 토닥에서 국내 최초로 개발한 인공와우로 전극의 개수가 여러 인공와우 제조사들 중 32개로 가장 많은 세계 유일의 제품입니다. 미국 헬렌켈러 스승님으로 알려진 특수교사 설리번의 이니셔티브입니다.', '["Q&A", "제품관련", "#10.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = 'Sullivan 이 무엇인가요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '제품관련', '충전식인가요? 배터리형인가요?', '**Q. 충전식인가요? 배터리형인가요?
(현재BTE는 X)**

**A.**
OTE의 경우 휴대폰처럼 C type 케이블로 충전해서 사용할 수 있습니다.
현재 내년 출시 예정인 외부장치는 케이블 충전 아닌 충전기에 직접 보관하여 충전할 수 있도록 개발 중입니다.  (BTE의 경우 필요에 따라 쉽게 교체 할 수 있습니다.)', '["Q&A", "제품관련", "#11.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '충전식인가요? 배터리형인가요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '제품관련', '배터리 충전시간은 어느정도인가요?', '**Q. 배터리 충전시간은 어느정도인가요?**

**A.**
대략 2시간정도 걸릴 수 있습니다. (1시간정도 충전하여도 80% 충전되기도 합니다)', '["Q&A", "제품관련", "#12.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '배터리 충전시간은 어느정도인가요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '제품관련', '배터리 완충 후 사용시간은 어떻게되나요?', '**Q. 배터리 완충 후 사용시간은 어떻게되나요?**

**A.**
충전 후 대략 6~8시간 정도 사용 가능하지만 사용자마다 내외부간의 거리, 피부의 두께, 머리카락, 청력상태 등에 따라 개인마다 차이가 있을 수 있습니다.', '["Q&A", "제품관련", "#13.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '배터리 완충 후 사용시간은 어떻게되나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '제품관련', '인공와우 착용시 배터리가 소진되면 어떻게 되나요?', '**Q. 인공와우 착용시 배터리가 소진되면 어떻게 되나요?**

**A.**
배터리 소진 시 작동이 중단됩니다. 
제품에 따라 충전기의 휴대가 필수적이며 같은 제품이어도 사용자의 따라 배터리 소모시간이 다를 수도 있습니다. (배터리 소진시 알림 -> 퓨어톤의 기기음작동(삐삐삐-), 기기LED등 노란색 깜빡임, 앱에서 확인)', '["Q&A", "제품관련", "#14.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '인공와우 착용시 배터리가 소진되면 어떻게 되나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '제품관련', '배터리 수명이 있나요?', '**Q. 배터리 수명이 있나요?**

**A.**
네 외부기의 배터리는 영구적이진 않습니다.
약 30개월 이후부터 80% 용량으로 감소할 수 있고, 정확한 교체 시기가 있는건 아니지만 사용자의 불편함의 따라 교체가 필요할 수도 있습니다. (단, 사용자가 직접 교체할 수는 없습니다.)', '["Q&A", "제품관련", "#15.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '배터리 수명이 있나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '제품관련', '내/외부기의 수명은 언제까지인지?', '**Q. 내/외부기의 수명은 언제까지인지?
내부기는 이식 후 영구적인가요?**

**A.**
외부기는 일반 전자제품과 수명연한이 같습니다. 
대략 5년에 한 번씩 교체하는 것이 평균적인 교체주기입니다(단 필수는 아님). 내부기는 특별한 문제가 없는 한평생 동안이라고 생각하셔도 됩니다.', '["Q&A", "제품관련", "#16.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '내/외부기의 수명은 언제까지인지?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '제품관련', '내/외부기의 보증기간이 있나요?', '**Q. 내/외부기의 보증기간이 있나요?**

**A.**
제조사의 공식적인 보증기간은 내부기는 10년이고, 외부기는 5년입니다.
하지만 사용자마다  내외부간의 거리, 피부의 두께, 머리카락, 청력상태 등에 따라 다를 수 있으므로 사용 기한이 달라질 수도 있습니다. (소모품-> 미정)', '["Q&A", "제품관련", "#17.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '내/외부기의 보증기간이 있나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '제품관련', '외부 장치는 방수가 되나요?', '**Q. 외부 장치는 방수가 되나요? 
샤워 등으로 인하여 어음처리기(외부기)에 물이 닿아도 괜찮나요?**

**A.**
현재는 약한 생활방수는 가능합니다.
외부장치는 비가 내릴 때나 습한 장소에서도 사용할 수 있고, 1m 이하의 얕은 물에서 직접 물이 들어가지 않는선에서 잠깐 동안 사용하는 것은 가능합니다. 하지만, 목욕이나 수영과 같이 수중 활동을 하는 곳에서 계속 사용하거나 직접적인 물에 접촉하는건 어려울 수 있습니다. 이때는 방수팩과 같은 추가 엑세서리를 사용해야 합니다.

⚠️ 상태: *생활방수 : 현재기기 가능(현재 등급은 X)  
*추후 SOUND1 IP68-67예정
*방수커버 : 아직미정!', '["Q&A", "제품관련", "#18.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '외부 장치는 방수가 되나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '제품관련', '테스트를 해볼 수 있나요?', '**Q. 테스트를 해볼 수 있나요?**

**A.**
아쉽게도 수술 전 사전 테스트는 어렵습니다.
인공와우의 내부장치는 수술로 달팽이관에 전극이 삽입되기 때문에 수술 없이는 확인이 어렵습니다.', '["Q&A", "제품관련", "#19.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '테스트를 해볼 수 있나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '제품관련', '보청기랑 같이 사용할 수 있나요?', '**Q. 보청기랑 같이 사용할 수 있나요?**

**A.**
네 가능합니다.
청력 상태에 따라 보청기 / 인공와우 각각 개별적으로 사용이 가능합니다.
단 연동이 되는것이 아니므로 각 전문가와 상담 후 개별적인 조절과 매핑이 필요합니다.', '["Q&A", "제품관련", "#20.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '보청기랑 같이 사용할 수 있나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '제품관련', 'MRI촬영 가능한가요?', '**Q. MRI촬영 가능한가요?**

**A.**
네, 촬영할 수 있습니다(내부 자석을 제거하는 수술필요)
기존 이식된 내부장치의 종류에 따라 외부음성처리기를 고정하기 위한 자석을 제거하고 촬영하거나 각 인공와우 회사에서 호환 가능하다고 보장한 MRI 장비는 임플란트의 자석을 제거하지 않고도 촬영이 가능합니다.(현재는 모두 내부 자석제거 후 MRI 필요 -> 수술필요)', '["Q&A", "제품관련", "#21.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = 'MRI촬영 가능한가요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '제품관련', '블루투스 연동이 되나요?', '**Q. 블루투스 연동이 되나요?
 (다이렉트 스트리밍 현재 불가, 내년 새버전 예상)
전화를 바로 들을 수 있나요?**

**A.**
현재 Sullivan는 어렵습니다. (현재 다이렉트 스트리밍 불가)
-Sullivan 1.5세대 (26년상반기 출시예정)에서는 이어폰악세사리로 소리 수신가능
-Sound1(26년하반기 예상) : 다이렉트 스트리밍 계획중', '["Q&A", "제품관련", "#22.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '블루투스 연동이 되나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '제품관련', '소리를 제가 직접 조절 할 수도 있나요?', '**Q. 소리를 제가 직접 조절 할 수도 있나요?
(현재 안드로이드 앱은 소리조절은 가능하지만, 아이폰 앱은 개발중)**

**A.**
안드로이드 : [Sullivan앱] 볼륨, 출력, 프로그램에 따라 약간의 소리조절이 가능합니다.
 -> 소리크기조절, 프로그램조절, 자극출력조절, 배터리잔량확인, led등 표시, 알림확인?)
아이폰 : 현재 개발중(26년 예정)', '["Q&A", "제품관련", "#23.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '소리를 제가 직접 조절 할 수도 있나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 전', '인공와우 수술은 어떻게 하나요?', '**Q. 인공와우 수술은 어떻게 하나요?**

**A.**
먼저 병원 진료와 검사를 통하여 인공와우 이식이 가능한지 확인합니다. 
가능한 경우 귀 뒷부분 일부를 절개하고 인공와우 내부장치를 이식을 합니다.  이식 후 기기의 위치와 상태를 확인한 후 수술을 마칩니다. 병원마다 절차는 다를 수 있지만 보통 수술 하루 전 입원, 사흘 내외에 퇴원하게 됩니다. 수술시간은 편측 기준 2시간 내외정도 됩니다.
자세한 문의는 병원을 통해 확인 부탁드리겠습니다.', '["Q&A", "수술 전", "#24.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '인공와우 수술은 어떻게 하나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 전', '인공와우의 수술 전 받야아하는 검사는 어떤 것들이 있나요? / 어디서하나요?', '**Q. 인공와우의 수술 전 받야아하는 검사는 어떤 것들이 있나요? / 어디서하나요?**

**A.**
수술전 검사와 확인은 저희가 할 수 없습니다. 수술 전 의료진의 확인과 상담이 꼭 필요합니다.
병원마다 다를 수 있지만 보통 청력검사, CT, MRI, 평형기능검사, 언어발달 평가 등 있을 수 있습니다.
자세한 문의는 병원을 통해 확인 부탁드리겠습니다.', '["Q&A", "수술 전", "#25.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '인공와우의 수술 전 받야아하는 검사는 어떤 것들이 있나요? / 어디서하나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 전', '수술의 위험도', '**Q. 수술의 위험도**

**A.**
인공와우 수술은 비교적 안전한 수술로 일반적인 귀 수술과 비슷한 수준의 위험도를 가지고 있습니다. 
대부분의 경우 경미하고 일시적인 부작용은 있을 순 있지만 심각한 합병증은 드뭅니다.', '["Q&A", "수술 전", "#26.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '수술의 위험도');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 전', '수술의 부작용', '**Q. 수술의 부작용**

**A.**
인공와우 수술 후에는 수술 부위의 감염, 뇌막염, 안면신경 자극, 일시적인 어지러움 등의 합병증이 드물게 발생할 수 있습니다. 
그러나 이러한 합병증은 대부분 드물고, 병원에서 이를 예방하고 조기에 발견할 수 있도록 철저한 소독과 감염 관리, 수술전 검사 등을 시행하고 있습니다. 수술 후 증상이 있을 경우 즉시 의료진에게 알리면 적절한 조치를 받을 수 있습니다. 자세한 문의는 병원을 통해 확인 부탁드리겠습니다.', '["Q&A", "수술 전", "#27.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '수술의 부작용');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 전', '인공와우 수술 나이제한이 있나요?', '**Q. 인공와우 수술 나이제한이 있나요?
어린아이는 몇 개월 부터, 노인은 몇 살까지 수술 받을 수 있나요?**

**A.**
전신마취 등에 따른 합병증이 없을 것으로 예상되면 9~10개월 이상이면 어린이와 노인 모두 수술 가능합니다. 영유아 경우 언어 발달 시기에 최대한 빨리 소리를 경험하는 것이 중요하기 때문에 지연 없이 수술하는 것을 권고합니다. 자세한 문의는 병원을 통해 확인 부탁드리겠습니다.', '["Q&A", "수술 전", "#28.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '인공와우 수술 나이제한이 있나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 전', '유소아 수술이 가능한가요?', '**Q. 유소아 수술이 가능한가요?**

**A.**
현재는 성인 위주로 판매 중에 있습니다.
하지만 유소아 수술이 불가능한 건 아니며, 추후 유소아 수술도 함께 할 수 있도록 더욱 완벽히 준비하고 있습니다.

⚠️ 상태: 2026.06.04', '["Q&A", "수술 전", "#29.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '유소아 수술이 가능한가요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 전', '수술시간은 얼마나 걸리며, 입원 기간은 어떻게 되나요?', '**Q. 수술시간은 얼마나 걸리며, 입원 기간은 어떻게 되나요?**

**A.**
수술시간은 편측기준 2시간 내외이며, 문제가 없으면 사흘 내외로 퇴원합니다. 
병원마다 다를 수 있음으로 자세한 문의는 병원을 통해 확인 부탁드리겠습니다.', '["Q&A", "수술 전", "#30.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '수술시간은 얼마나 걸리며, 입원 기간은 어떻게 되나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 전', '인공와우 수술 후 잔존청력을 보존할 수 있나요?', '**Q. 인공와우 수술 후 잔존청력을 보존할 수 있나요?**

**A.**
인공와우 수술시 사용자 매뉴얼 경고 사항에 "인공달팽이관 내부장치의 전극을 삽입하면 이식한 귀에 잔존 청력의 손실이 발생할 가능성이 높습니다." 라는 경고문구가 있습니다. 현재 잔존청력의 경우 보존하기에 어려울 수 있습니다.', '["Q&A", "수술 전", "#31.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '인공와우 수술 후 잔존청력을 보존할 수 있나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 전', '수술 후의 사후관리를 어떻게 해야하나요?', '**Q. 수술 후의 사후관리를 어떻게 해야하나요?**

**A.**
수술한 부위와 기기에 물이 닿거나 감염이 되지 않도록 하고, 이식부위에 충격이 가지 않도록 주의해야 합니다. 외부장치를 부착 후 일정 시기가 지나면 일반적인 생활하는데 큰 지장은 없습니다.
자세한 문의는 병원을 통해 확인 부탁드리겠습니다.', '["Q&A", "수술 전", "#32.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '수술 후의 사후관리를 어떻게 해야하나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 전', '수술 후 일상생활에 불편감이있나요?', '**Q. 수술 후 일상생활에 불편감이있나요?**

**A.**
수술 직후에는 수술 부위에 붓기, 이물감 등의 불편감이 있을 수 있으나, 시간이 지나면서 차차 나아집니다. 자세한 문의는 병원을 통해 확인 부탁드리겠습니다.', '["Q&A", "수술 전", "#33.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '수술 후 일상생활에 불편감이있나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 전', '환자 또는 증상, 난청기간에 따라 수술 효과에 차이가 있나요?', '**Q. 환자 또는 증상, 난청기간에 따라 수술 효과에 차이가 있나요?**

**A.**
난청의 원인, 기간 등 사용자에 따라 달라질 수 있습니다. 예상되는 청력 회복 정도에 따라 담당의가 수술을 결정하게 됩니다. 자세한 문의는 병원을 통해 확인 부탁드리겠습니다.', '["Q&A", "수술 전", "#34.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '환자 또는 증상, 난청기간에 따라 수술 효과에 차이가 있나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 전', '수술 후 바로 소리를 들을 수 있나요?', '**Q. 수술 후 바로 소리를 들을 수 있나요?**

**A.**
수술 직후 바로 소리가 들리지는 않습니다. 
일반적으로 수술 후 1~4주 후 외부장치를 착용하고 활성화하는 매핑을 한 후부터 소리를 들을 수 있으며, 이때부터 청각 재활이 시작됩니다. 
일반적으로 편하게 의사소통하기까지는 사용자마다 차이가 있을 수는 있지만 청능재활 및 언어치료 기간은 난청의 원인, 정도, 기간 등에 따라 수개월에서 수년 이상으로 재활 기간이 달라집니다.', '["Q&A", "수술 전", "#35.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '수술 후 바로 소리를 들을 수 있나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 전', '수술 후 외부기는 언제부착하나요?', '**Q. 수술 후 외부기는 언제부착하나요?**

**A.**
사람에 따라 회복 속도와 부작용 등 다를 수 있지만 보통 수술 후 4주 후 외부기를 착용하여 매핑을 할 수 있습니다.', '["Q&A", "수술 전", "#36.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '수술 후 외부기는 언제부착하나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 전', '수술 후 이명현상이 사라지나요?', '**Q. 수술 후 이명현상이 사라지나요?**

**A.**
많은 경우 수술 후 이명이 감소되는 것으로 알려져 있습니다.
개인차가 있을 수 있으니 자세한 문의는 병원을 통해 확인 부탁드리겠습니다.', '["Q&A", "수술 전", "#37.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '수술 후 이명현상이 사라지나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 전', '이식 후 이물감이 느껴지진 않나요?', '**Q. 이식 후 이물감이 느껴지진 않나요?**

**A.**
수술 직후에는 수술 부위에 붓기, 이물감 등의 불편감이 있을 수 있으나 시간이 지나면서 차차 나아질 수 있습니다. 혹시 불편함이 심할 경우 병원에 문의 부탁드리겠습니다.', '["Q&A", "수술 전", "#38.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '이식 후 이물감이 느껴지진 않나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 전', '이식부위에 흉터나 수술흔적이 크게 남나요?', '**Q. 이식부위에 흉터나 수술흔적이 크게 남나요?**

**A.**
귀 뒤편에 3~4 cm 절개 후 인공와우 내부장치를 이식하는데, 추후 회복되고 머리카락이 자라면 잘 보이지 않습니다.', '["Q&A", "수술 전", "#39.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '이식부위에 흉터나 수술흔적이 크게 남나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 전', '인공와우를 하면 정상적인 청력처럼 들릴 수 있나요?', '**Q. 인공와우를 하면 정상적인 청력처럼 들릴 수 있나요?**

**A.**
인공와우는 소리를 인식하고 말소리를 이해하는 데 큰 도움을 줄 수 있지만, 이전 정상 청력과 동일하지는 않습니다. 기존에 듣던 소리와는 다른 음질로 들릴 수 있음으로 꾸준한 재활과 훈련을 통해 청취 능력은 점차 향상될 수 있습니다.', '["Q&A", "수술 전", "#40.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '인공와우를 하면 정상적인 청력처럼 들릴 수 있나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 전', '양쪽 귀 모두 인공와우를 해야 하나요?', '**Q. 양쪽 귀 모두 인공와우를 해야 하나요?**

**A.**
사용자의 청력에 따라 다를 수 있습니니다. 
양측 귀 모두 난청이 심한 경우 양이(양측) 인공와우를 고려할 수 있으며, 한쪽은 인공와우, 다른 쪽은 보청기를 사용하는 혼합 방식도 가능합니다.', '["Q&A", "수술 전", "#41.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '양쪽 귀 모두 인공와우를 해야 하나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 후 재활', '매핑은 무엇인가요? / 꼭 해야하나요?', '**Q. 매핑은 무엇인가요? / 꼭 해야하나요?**

**A.**
매핑은 사용자의 특성에 맞춰 소리를 더 잘 들을 수 있도록 기기 프로그램을 조정하는 과정을 말합니다.
매핑을 권장하는 이유는 매핑을 통해 최대한 자연 음에 가까우면서 사용자에게 부드럽고 편한 소리를 찾는 과정입니다. 수술 후 1-4주 이내에 시작하며 초기에는 여러 번의 조절이 필요합니다. 일정 기간이 지난 후에는 성인은 연 1회, 소아는 6개월마다 점검하는 것을 권장합니다.', '["Q&A", "수술 후 재활", "#42.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '매핑은 무엇인가요? / 꼭 해야하나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 후 재활', '매핑은 얼마나 자주 해야하나요?', '**Q. 매핑은 얼마나 자주 해야하나요?**

**A.**
사용자마다 연령, 난청의 원인, 기간 등에 따라 재활 기간이 수개월에서 수년까지 달라질 수 있습니다.', '["Q&A", "수술 후 재활", "#43.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '매핑은 얼마나 자주 해야하나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 후 재활', '인공와우 수술 후 어떤 재활훈련을 받아야하나요?', '**Q. 인공와우 수술 후 어떤 재활훈련을 받아야하나요?**

**A.**
수술 후 귀 상태에 맞게 전기 자극을 조절하는 매핑과 단어나 문장 등을 듣는 언어치료를 해야 합니다. 사용자의 연령, 난청의 원인, 기간 등에 따라 수개월에서 수년 이상 재활훈련이 필요할 수 있습니다. 자세한 문의는 병원을 통해 확인 부탁드리겠습니다.', '["Q&A", "수술 후 재활", "#44.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '인공와우 수술 후 어떤 재활훈련을 받아야하나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 후 재활', '수술 후 재활치료는 꼭 받아야 하나요?', '**Q. 수술 후 재활치료는 꼭 받아야 하나요?**

**A.**
네, 인공와우의 내부장치 삽입만으로 청력이 회복되는 것이 아니라 소리를 듣고 말소리를 이해하기 위한 청능재활이 필수입니다. 말소리 구별 능력을 높이기 위해 전문 전문치료사의 도움을 받는 것이 좋습니다.', '["Q&A", "수술 후 재활", "#45.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '수술 후 재활치료는 꼭 받아야 하나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 후 재활', '수술 후 음악을 들을 수 있나요?', '**Q. 수술 후 음악을 들을 수 있나요?**

**A.**
네, 들을 수 있습니다. 인공와우로 들을 수 있는 주파수 범위는 제한적이고 기존에 듣던 음질과는 다를 수는 있습니다. 하지만 익숙한 음악 듣기를 시작으로 다른 음악도 듣다 보면 점차 개선될 수 있습니다.', '["Q&A", "수술 후 재활", "#46.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '수술 후 음악을 들을 수 있나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 후 재활', '수술 후 비행기를 탑승할 수 있나요?', '**Q. 수술 후 비행기를 탑승할 수 있나요?**

**A.**
네, 탑승 가능합니다. 
금속탐지기 알람이 울릴 수 있으니, 인공와우 사용자 카드를 지참하시고 사전에 보안담당자에게  말씀해 주시는 게 좋습니다. 보안스캐너 통과 시 왜곡된 소리가 발생할 수 있으니, 외부장치를 제거 후 통과하는 것이 좋습니다.', '["Q&A", "수술 후 재활", "#47.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '수술 후 비행기를 탑승할 수 있나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 후 재활', '사우나 등 고온의 환경에 노출되도 문제없나요?', '**Q. 사우나 등 고온의 환경에 노출되도 문제없나요?**

**A.**
귀에 질환(고막천공, 중이염 등)이 없고, 수술 부위에 이상이 없다면 외부장치를 제거 후 수영이나 목욕 등을 할 수 있습니다. 하지만 이식된 기기가 고온에 장시간 노출될 수 있는 사우나, 찜질방, 헤어드라이기는 권장하지 않습니다.', '["Q&A", "수술 후 재활", "#48.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '사우나 등 고온의 환경에 노출되도 문제없나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 후 재활', '달리기, 수영 등 스포츠와 같은 격한 활동을 할 수 있나요?', '**Q. 달리기, 수영 등 스포츠와 같은 격한 활동을 할 수 있나요?**

**A.**
가벼운 달리기나 수영 등은 외부장치를 뗀 후 가능합니다. 수술 부위와 인공와우 내부, 외부장치에 충격이 가해질 수 있는 운동은 삼가하는 것이 좋습니다. 
(과하게 땀이 흐르는 운동은 제거 후 권고, 수영은 추후 방수팩 등 액세서리 필요, 약간의 생활방수 기능만 있음 현재 IP등급은 없음)', '["Q&A", "수술 후 재활", "#49.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '달리기, 수영 등 스포츠와 같은 격한 활동을 할 수 있나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 후 재활', '헤어 염색이나 펌을 해도 되나요?', '**Q. 헤어 염색이나 펌을 해도 되나요?**

**A.**
수술직후나 회복기간에는 두피와 수술부위에 자극이 될 수 있으므로 수술 후 상처가 완전히 아물과 난 뒤 문제가 없다면 외부장치 제거 후 가능합니다. 자세한 문의는 병원과 상담 후 진행하시는게 좋을 것 같습니다.', '["Q&A", "수술 후 재활", "#50.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '헤어 염색이나 펌을 해도 되나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '수술 후 재활', '모자를 착용해도 듣는데 문제가 없나요?', '**Q. 모자를 착용해도 듣는데 문제가 없나요?**

**A.**
외부장치의 마이크가 가려지면 소리가 잘 안 들릴 수 있습니다. 마이크 구멍을 가리지 않는 형태로나 착용을 권장합니다.', '["Q&A", "수술 후 재활", "#51.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '모자를 착용해도 듣는데 문제가 없나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '매핑 후 사후관리', '매핑을 했는데 잘 안들려요.', '**Q. 매핑을 했는데 잘 안들려요.
소리가 이상하게 들려요
소리만 크고 말소리는 정확하게 안들려요
매핑을 했는데 머리가 아파요**

**A.**
매핑은 최대한 자연음에 가까우면서 부드럽고 편한 소리를 사용자에게 맞는 최적의 소리를 찾아가는 과정입니다. 1-2번 만에 모든 소리를 완벽하게 맞출 수는 없으므로 지속적인 매핑이 필요합니다. 매핑에 관하여 자세한 문의는 병원을 통해 확인 부탁드리겠습니다.', '["Q&A", "매핑 후 사후관리", "#52.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '매핑을 했는데 잘 안들려요.');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '매핑 후 사후관리', '소리가 끊겨 들려요', '**Q. 소리가 끊겨 들려요**

**A.**
휴대폰 앱을 이용하여 배터리 상태를 확인하세요. 완충된 외부장치로 교체하여 사용하세요.
그 외 지속적인 문제 발생 시 병원을 통해 확인 부탁드리겠습니다.', '["Q&A", "매핑 후 사후관리", "#56.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '소리가 끊겨 들려요');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT 'A/S 관련', '제품이 고장나면 어떻게 하나요?', '**Q. 제품이 고장나면 어떻게 하나요?
외부기에 문제가 없는것 같은데 소리가 안나요?**

**A.**
내부 C/S정책 수립후 답변 예정
(먼저 충전, 앱확인, LED표시 확인 등 간단한 확인먼저)

⚠️ 상태: *배터리도 충전되어있고, 작동에 문제도 없는경우?', '["Q&A", "A/S 관련", "#57.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '제품이 고장나면 어떻게 하나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT 'A/S 관련', '외부기 문제가 있는것 같은데 수리는 어디서 받나요?', '**Q. 외부기 문제가 있는것 같은데 수리는 어디서 받나요?**

**A.**
내부 C/S정책 수립후 답변 예정
(내부 A/S절차, 병원확인 등 답변)

⚠️ 상태: *내부 A/S절차 구축필요', '["Q&A", "A/S 관련", "#58.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '외부기 문제가 있는것 같은데 수리는 어디서 받나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT 'A/S 관련', '어음처리기(외부기)를 분실할 경우 어떻게 하나요?', '**Q. 어음처리기(외부기)를 분실할 경우 어떻게 하나요?**

**A.**
내부 C/S정책 수립후 답변 예정', '["Q&A", "A/S 관련", "#59.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '어음처리기(외부기)를 분실할 경우 어떻게 하나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT 'A/S 관련', '외부기가 자꾸 떨어져요', '**Q. 외부기가 자꾸 떨어져요**

**A.**
1) 헤어핀으로 고정해보시는것을 추천드립니다.
2) 올바른 위치에 잘 부착했는지, 자석은 있는지 확인해보시는것을 추천드립니다.
3) 지속적인 문제 발생 시 높은 숫자의 자석으로 교체해보시는것을 추천드립니다(원하는강도 없을때 제조사문의) (현재는 1-4번까지 존재, 추후 개발예정?)', '["Q&A", "A/S 관련", "#60.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '외부기가 자꾸 떨어져요');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT 'A/S 관련', '사용 중 떨어뜨렸는데 외부장치가 부착되지 않습니다.', '**Q. 사용 중 떨어뜨렸는데 외부장치가 부착되지 않습니다.
/ 외부장치가 안 붙는 경우 어떻게 하나요?**

**A.**
외부기에 장착되어 있는 자석이 탈착되어 분리되었는지를 확인하십시오. 
외부기의 자석이 분리되지 않았다면, 이식된 내부장치의 자석 위치를 확인하십시오. 
자석위치를 모를 경우, 귀 위쪽에서 뒤쪽으로 이동하며 자석이 붙는 위치를 확인하고 외부장치를 돌려 자석이 정렬되도록 하십시오.', '["Q&A", "A/S 관련", "#61.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '사용 중 떨어뜨렸는데 외부장치가 부착되지 않습니다.');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT 'A/S 관련', '인공와우 부분이 뜨거워지는것 같아요', '**Q. 인공와우 부분이 뜨거워지는것 같아요**

**A.**
외부어음처리기나 코일이 평소와 달리 따뜻하거나 뜨거워지는 경우 바로 사용을 중단 후 제거한 다음, 다시 재부착하시는 걸 추천드립니다. 
그래도 지속적인 문제가 발생할 경우 [재전화(내부A/S)/병원] 문의 부탁드립니다.

⚠️ 상태: *내부 A/S절차 구축필요', '["Q&A", "A/S 관련", "#62.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '인공와우 부분이 뜨거워지는것 같아요');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT 'A/S 관련', '외부기에 대한 지속적인 업데이트가 가능한지?', '**Q. 외부기에 대한 지속적인 업데이트가 가능한지?
어떻게 제공되나요?**

**A.**
당사의 경우*OTA기술을 이용하여 무선으로 주기적으로 소프트웨어를 업데이트할 수 있습니다. 
이 같은 방법으로 별도의 외부기 구매 없이 기존 외부기로도 최신의 향상된 기능이나 추가 기능들을 사용할 수 있습니다. 주요 소프트웨어 업데이트 사항들은 고객에게 별도의 방법을 통해 공지할 계획이며 당사의 서비스 센터에 방문하여 업데이트를 수행하면 됩니다.

⚠️ 상태: *OTA 기술(자동화 업데이트)
물리적인 교체가 아닌 블루투스로 업데이트 가능한 기술
-현재 OTA 진행하고 있는지?', '["Q&A", "A/S 관련", "#63.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '외부기에 대한 지속적인 업데이트가 가능한지?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '요양급여', '인공와우 수술비 지원이 있나요?(요양급여)', '**Q. 인공와우 수술비 지원이 있나요?(요양급여)**

**A.**
Shee4 참고', '["Q&A", "요양급여", "#64.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '인공와우 수술비 지원이 있나요?(요양급여)');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '요양급여', '인공와우 임플란트 수술은 비용이 얼마정도 필요한가요?', '**Q. 인공와우 임플란트 수술은 비용이 얼마정도 필요한가요?
수술 후 추가로 드는 비용은 무엇이며 금액은 어느정도 인가요?**

**A.**
현재 간단히 말씀드리자면 
[요양급여시]
-성인기준 : 약600~700만원 자부담금(편측, 양측불가)
-아동기준 : 약250만원(편측), 약400만원(양측)
기기값,병원비(수술비,입원비,검사 등 포함)
[비요양급여]
-내부+외부기기값 : 각각 대략 1000만원
-수술비 : 약300~400만원
검사 및 비급여항목 : 약100~200만원
매핑비 : 약20만원(검사,언어평가까지?)
위 금액은 대략적인 것으로 자세한 문의는 수술하실 병원에 문의 바랍니다(병원별 상이할 수 있음)', '["Q&A", "요양급여", "#65.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '인공와우 임플란트 수술은 비용이 얼마정도 필요한가요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '요양급여', '그 외 할인이 있나요?', '**Q. 그 외 할인이 있나요?**

**A.**
내부 C/S정책 수립후 답변 예정 / (판매 시작 시 프로모션 등? 확인필요)', '["Q&A", "요양급여", "#66.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '그 외 할인이 있나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '요양급여', '실손보험이 되나요?', '**Q. 실손보험이 되나요?**

**A.**
사용자의 보험 종류와 보험사마다 다를 수 있으니 자세한 문의는 보험사 확인 부탁드립니다.', '["Q&A", "요양급여", "#67.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '실손보험이 되나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '임상관련', '임상시험 참여 방법', '**Q. 임상시험 참여 방법**

**A.**
[사전 진행여부에 대한 확인필요]
(문의 주신 시점에 임상시험을 위한 피험자 모집이 진행되고 있을 경우에는 현재 임상진행중인 병원으로 안내 및 진료 말씀드리기)

⚠️ 상태: *자세한 문의 -> 원희님께
진행 중인 임상에 따라 다름', '["Q&A", "임상관련", "#68.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '임상시험 참여 방법');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '임상관련', '임상에 사용하고 있는 인공와우는 어떤건가요?', '**Q. 임상에 사용하고 있는 인공와우는 어떤건가요?**

**A.**
현재 임상에서 진행중인 제품은 Sullivan 입니다
토닥에서 국내 최초로 개발한 인공와우로 전극의 개수가 여러 인공와우 제조사들 중 32개로 가장 많은 세계 유일의 제품입니다.', '["Q&A", "임상관련", "#69.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '임상에 사용하고 있는 인공와우는 어떤건가요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '임상관련', '임상에서 사용하고 있는 제품은 안전한가요?', '**Q. 임상에서 사용하고 있는 제품은 안전한가요?**

**A.**
네 임상에서 사용하는 모든 제품은 식약처로부터 인허가를 취득한 제품입니다. 저희는 허가 후 임상을 진행중입니다.', '["Q&A", "임상관련", "#70.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '임상에서 사용하고 있는 제품은 안전한가요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '임상관련', '어느병원에서 하고 있나요?', '**Q. 어느병원에서 하고 있나요?**

**A.**
현재OO병원, OO병원에서 임상 진행중 입니다.', '["Q&A", "임상관련", "#71.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '어느병원에서 하고 있나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '임상관련', '현재 OO병원에서 하고 있다고 들었는데 다른병원에서는 안하나요?', '**Q. 현재 OO병원에서 하고 있다고 들었는데 다른병원에서는 안하나요?**

**A.**
현재OO병원에서만 임상진행중에 있으며, 다른곳은 아직 미정입니다
(혹시 추후 진행준비중이더라도 현재 진행중인곳만 안내)', '["Q&A", "임상관련", "#72.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '현재 OO병원에서 하고 있다고 들었는데 다른병원에서는 안하나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '임상관련', '제일 안정적인 병원이나 교수님을 추천해주세요.', '**Q. 제일 안정적인 병원이나 교수님을 추천해주세요.**

**A.**
현재OO병원에서만 임상진행중에 있으며, 특정 지정 및 추천을 할 수는 없습니다.
자세한 문의는 임상을 진행하는 병원에 문의 부탁드리겠습니다.', '["Q&A", "임상관련", "#73.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '제일 안정적인 병원이나 교수님을 추천해주세요.');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '임상관련', '임상시험 비용은 어떻게 부담하나요?', '**Q. 임상시험 비용은 어떻게 부담하나요?**

**A.**
임상시험 기간 동안 발생하는 비용은 병원에서 부담하게 됩니다. 
수술전 검사 ~ 임상 기간으로 정해진 기간까지의 비용 전액을 포함합니다. 
(추가적으로 당사는 임상시험 대상자분들에게 외부장치의 차기 모델 출시 시 새로운 기기로 교체 제공을 드리려고 합니다.)', '["Q&A", "임상관련", "#74.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '임상시험 비용은 어떻게 부담하나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '임상관련', '현재 몇 명이 진행 했나요?', '**Q. 현재 몇 명이 진행 했나요?
임상 수술후기 / 효과는 어떤가요?**

**A.**
다수 진행 중에 있습니다. 
현재로서는 문제없이 잘 되고 있습니다. 그 외 자세한 건 개인정보로 알려드릴 수가 없습니다.', '["Q&A", "임상관련", "#75.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '현재 몇 명이 진행 했나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '기타', '심정지 등과 같은 비상 상황에 AED 같은 전기 충격에 대한 조치시 생명에 지장은 없나요? / 기기문제없나요?', '**Q. 심정지 등과 같은 비상 상황에 AED 같은 전기 충격에 대한 조치시 생명에 지장은 없나요? / 기기문제없나요?**

**A.**
네, 생명에는 직접적인 영향이 없다는 것이 현재까지의 의료 및 안전지침입니다. AED 등과 같은 전기 충격에 인공와우 내부기기가 일시적인 영향을 받을 수 있으나 생명에는 지장이 없습니다. 만약 전기 충격 이후에 인공와우가 정상 작동을 하지 않는다면 점검을 받는 것을 추천드립니다.', '["Q&A", "기타", "#76.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '심정지 등과 같은 비상 상황에 AED 같은 전기 충격에 대한 조치시 생명에 지장은 없나요? / 기기문제없나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '기타', '인공와우 사용시 고개가 기울어지거나 얼굴 떨림이 있는 경우 어떻게 해야 하나요?', '**Q. 인공와우 사용시 고개가 기울어지거나 얼굴 떨림이 있는 경우 어떻게 해야 하나요?**

**A.**
자극세기가 약한 맵을 사용하거나 볼륨을 낮추어 사용하는것을 권장합니다. 
지속적으로 문제가 해결되지 않는다면 수술한 병원을 통해 확인 부탁드리겠습니다.', '["Q&A", "기타", "#77.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '인공와우 사용시 고개가 기울어지거나 얼굴 떨림이 있는 경우 어떻게 해야 하나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '기타', '인공와우 사용시 어지러움이 동반되는 경우 어떻게 해야 하나요?', '**Q. 인공와우 사용시 어지러움이 동반되는 경우 어떻게 해야 하나요?**

**A.**
초기에는 약간의 어지러움이 나타날 수도 있습니다.
추후 차차 나아질 수 있으며 오랜 기간 개선되지 않고 일상생활이 어려울 정도로 어지러운 경우 인공와우 수술한 병원을 통해 확인 부탁드리겠습니다.', '["Q&A", "기타", "#78.0"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '인공와우 사용시 어지러움이 동반되는 경우 어떻게 해야 하나요?');

INSERT INTO cs_kb_articles (category, title, content, tags, visibility, status, author_id)
SELECT '응대매뉴얼', '토닥 C/S 전화응대 매뉴얼 (2025.09)', '# 토닥 C/S 전화응대 매뉴얼 (2025.09)

> **C/S 번호**: 1533-2925
> **회사 대표번호**: 070-8666-1121

- C/S번호 : 1533-2925

## 1. 기본 응대요령 회사대표번호 : 070-8666-1121
- - C/S전화문의 :  각팀에 대표자에게 돌려주기 및 메모
- - 제품관련 문의 : ''대표질문별 응대요령''에 따라 1차 답변 -> 추가문의는 연락처기재 후 추후 재피드백 *C/S전화 AI 안내멘트
- - 전화 안내멘트 : 안녕하세요, 인공와우 토닥 고객센터 입니다. 전화 주셔서 감사합니다.
- - 운영시간 : 평일 : 미정 세계 최다 32채널 인공와우 토닥 고객센터 입니다.
- 점심 : 12:00 ~ 13:30 잠시만 기다려주세요.
- * 주의사항1. 정중하고 친절한 태도로 응대한다.
- * 주의사항2. 답변하기 어려운 문의는 "확인해보고 다시 연락드리겠습니다." 로 친절하게 응대한다
- / 가급적 전화를 돌리지 않고, 메모 후 재피드백하는 방식으로 한다.((홈페이지 등을 통해 공개가능한 수준까지만 답변)
- * 주의사항3. "모른다", "안된다", 등 부정적 단답을 사용하지 않는다.
- *주의사항4. 고객문의 리스트를 작성한다.(누락방지)

## 2. 내선전화 사용방법
- *내선전화 돌리기 : 수화기 든 상태에서 "돌려주기"-> 내선번호# -> 설명 -> 수화기 내려놓기
- *전화 당겨받는법 : 수화기 들고 "당겨받기" 버튼

## 3. 각 팀별 대표 담당자
- *각 팀별 문의사항 대표 담당자 지정
- 부서 번호 내선번호 관련내용 비고 담당자
- C/S팀 070-4116-1122 1122# 고객관리, A/S문의, 제품문의 고객센터 전화사용
- 피플팀 070-4116-1125 1125#
- 재무팀 070-8666-1121 1121# 회사대표 전화사용
- QRA팀 070-4116-1123 1123# 관공소, 식약처, 고용노동부(산업안전), 교육 등
- 의과학팀 070-4416-1127 1127# 임상관련. 병원, IRB 류원희
- 마케팅팀
- 영업팀
- H/W팀
- S/W팀
- APP팀
- 연구/생산

## 4. 내방고객응대

## 5. A/S -> 절차구축필요
- 1)병원
- 2)제조사방문', '["가이드", "전화응대", "CS팀", "2025.09"]', 'internal', 'published', NULL
WHERE NOT EXISTS (SELECT 1 FROM cs_kb_articles WHERE title = '토닥 C/S 전화응대 매뉴얼 (2025.09)');

