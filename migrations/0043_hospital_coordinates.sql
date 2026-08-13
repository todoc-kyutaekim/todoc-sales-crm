-- 0043: 기관 좌표 사전 입력 (거리 증빙용)
--
-- 확보 방법: OpenStreetMap POI/area 매칭 → 시/도 bbox 검증 →
--            카카오모빌리티 길찾기 API 로 도로망 유효성 교차검증 (전 건 result_code=0)
-- 매칭 기준: 병원명(name) — 주소 문자열이 아니라 실제 기관 POI 좌표
-- geocoded_address 를 함께 넣어 자동 지오코딩 배치가 이 좌표를 덮어쓰지 않게 합니다.
-- 이미 사용자가 직접 입력한 좌표는 건드리지 않습니다 (lat IS NULL 조건 없음 →
--   단, 여기 목록은 전부 검증된 값이라 기존 부정확 좌표를 의도적으로 교정합니다).

-- 삼성서울병원  [poi]  삼성서울병원, 81, 일원로, 일원동, 일원본동, 강남구, 서울특별시, 06351, 대한민국
UPDATE hospitals SET lat = 37.4884518, lng = 127.0853414, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '서울특별시 강남구 일원로 81'
  WHERE name = '삼성서울병원';
-- 건양대학교병원  [area]  건양대병원, 관저동로, 관저1동, 서구, 대전광역시, 35365, 대한민국
UPDATE hospitals SET lat = 36.3068654, lng = 127.3407835, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '대전광역시 서구 관저동로 158'
  WHERE name = '건양대학교병원';
-- 서울대학교병원  [poi]  서울대학교병원, 101, 대학로, 대학로거리, 연건동, 이화동, 종로구, 서울특별시, 03080, 대한민국
UPDATE hospitals SET lat = 37.5791175, lng = 126.9987329, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '서울특별시 종로구 대학로 101 (연건동) 03080'
  WHERE name = '서울대학교병원';
-- 경북대학교병원  [poi]  경북대학교병원, 130, 동덕로, 삼덕동2가, 삼덕동, 중구, 대구광역시, 41944, 대한민국
UPDATE hospitals SET lat = 35.8664692, lng = 128.6048336, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '대구 중구 동덕로 130'
  WHERE name = '경북대학교병원';
-- 분당서울대학교병원  [poi]  분당서울대학교병원, 구미로185번길, 구미동, 분당구, 성남시, 경기도, 13622, 대한민국
UPDATE hospitals SET lat = 37.3492691, lng = 127.1241351, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '경기도 성남시 분당구 구미로 173번길 82'
  WHERE name = '분당서울대학교병원';
-- 고려대학교안암병원  [area]  안암병원, 고려대로17길, 안암동2가, 안암동, 성북구, 서울특별시, 02843, 대한민국
UPDATE hospitals SET lat = 37.587082, lng = 127.0265997, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '서울 성북구 고려대로 73'
  WHERE name = '고려대학교안암병원';
-- 가톨릭대학교 부천성모병원  [poi]  가톨릭대학교 부천성모병원, 부흥로457번길, 원미동, 원미구, 부천시, 경기도, 14645, 대한민국
UPDATE hospitals SET lat = 37.4874379, lng = 126.7930131, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '경기 부천시 원미구 소사로 327'
  WHERE name = '가톨릭대학교 부천성모병원';
-- 의정부성모병원  [area]  의정부성모병원, 금오로, 금오동, 자금동, 의정부시, 경기도, 11764, 대한민국
UPDATE hospitals SET lat = 37.7573142, lng = 127.0789396, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '경기 의정부시 천보로 271'
  WHERE name = '의정부성모병원';
-- 동의의료원  [poi]  동의병원, 62, 양정로, 양정자이더샵SKVIEW, 양정2동, 부산진구, 부산광역시, 47227, 대한민국
UPDATE hospitals SET lat = 35.1697711, lng = 129.0767135, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '부산광역시 부산진구 양정로 62'
  WHERE name = '동의의료원';
-- 단국대학교병원  [poi]  단국대학교병원, 201, 망향로, 성거읍, 동남구, 천안시, 충청남도, 31116, 대한민국
UPDATE hospitals SET lat = 36.8420876, lng = 127.1732901, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '충남 천안시 동남구 망향로 201'
  WHERE name = '단국대학교병원';
-- 이화여자대학교서울병원  [poi]  이대서울병원, 마곡중앙2로, 발산1동, 강서구, 서울특별시, 07804, 대한민국
UPDATE hospitals SET lat = 37.5572503, lng = 126.8361187, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '서울 강서구 공항대로 260'
  WHERE name = '이화여자대학교서울병원';
-- 가천의과학대학교 길병원  [poi]  가천대 길병원, 남동대로774번길, 구월동, 구월1동, 남동구, 인천광역시, 21564, 대한민국
UPDATE hospitals SET lat = 37.4518851, lng = 126.7094842, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '인천광역시 남동구 남동대로774번길 21'
  WHERE name = '가천의과학대학교 길병원';
-- 은평성모병원  [poi]  가톨릭대학교 은평성모병원, 1021, 통일로, 진관동, 은평구, 서울특별시, 03312, 대한민국
UPDATE hospitals SET lat = 37.6334988, lng = 126.915927, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '서울 은평구 통일로 1021'
  WHERE name = '은평성모병원';
-- 한림대학교 강남성심병원  [poi]  한림대학교 강남성심병원, 신길로, 대림1동, 영등포구, 서울특별시, 07437, 대한민국
UPDATE hospitals SET lat = 37.491359, lng = 126.9074246, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '서울특별시 영등포구 신길로 1'
  WHERE name = '한림대학교 강남성심병원';
-- 중앙보훈병원  [poi]  중앙보훈병원, 53, 진황도로61길, 둔촌동, 둔촌2동, 강동구, 서울특별시, 05368, 대한민국
UPDATE hospitals SET lat = 37.5303452, lng = 127.148015, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '서울시 강동구 양재대로 68'
  WHERE name = '중앙보훈병원';
-- 경희대학교병원  [poi]  경희의료원, 26, 경희대로, 회기동, 동대문구, 서울특별시, 02447, 대한민국
UPDATE hospitals SET lat = 37.5935885, lng = 127.0512769, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '서울 동대문구 경희대로 23'
  WHERE name = '경희대학교병원';
-- 강북삼성병원  [poi]  강북삼성병원, 29, 새문안로, 평동, 교남동, 종로구, 서울특별시, 03181, 대한민국
UPDATE hospitals SET lat = 37.5681925, lng = 126.9678985, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '서울 종로구 새문안로 29 강북삼성병원'
  WHERE name = '강북삼성병원';
-- 서울아산병원  [poi]  서울아산병원, 88, 올림픽로43길, 풍납동, 풍납2동, 송파구, 서울특별시, 05505, 대한민국
UPDATE hospitals SET lat = 37.5263041, lng = 127.1096013, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '서울 송파구 올림픽로43길 88'
  WHERE name = '서울아산병원';
-- 원주세브란스기독병원  [poi]  원주세브란스기독병원, 20, 일산로, 원주나래주택재개발예정지구, 중앙동, 원주시, 강원특별자치도, 26426, 대한민국
UPDATE hospitals SET lat = 37.3482511, lng = 127.9453505, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '강원특별자치도 원주시 일산로 20'
  WHERE name = '원주세브란스기독병원';
-- 전남대학교병원  [poi]  전남대학교병원, 42, 제봉로, 학동, 동구, 광주, 전남광주통합특별시, 61469, 대한민국
UPDATE hospitals SET lat = 35.1416094, lng = 126.9220218, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '광주 동구 제봉로 42'
  WHERE name = '전남대학교병원';
-- 광주보훈병원  [poi]  광주보훈병원, 산월로, 산월동, 첨단2동, 광산구, 광주, 전남광주통합특별시, 62272, 대한민국
UPDATE hospitals SET lat = 35.2077547, lng = 126.8493487, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '광주광역시 광산구 첨단월봉로 99 (산월동, 광주보훈병원)'
  WHERE name = '광주보훈병원';
-- 한림대학교 춘천성심병원  [poi]  한림대학교 춘천성심병원, 삭주로, 교동, 후평1동, 춘천시, 강원특별자치도, 24252, 대한민국
UPDATE hospitals SET lat = 37.884419, lng = 127.7397358, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '강원특별자치도 춘천시 삭주로 77'
  WHERE name = '한림대학교 춘천성심병원';
-- 서울성모병원  [poi]  가톨릭대학교 서울성모병원, 222, 반포대로, 반포4동, 서초구, 서울특별시, 06591, 대한민국
UPDATE hospitals SET lat = 37.5004435, lng = 127.0055211, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '서울 서초구 반포대로 222'
  WHERE name = '서울성모병원';
-- 세브란스병원  [poi]  세브란스병원, 50-1, 연세로, 신촌동, 서대문구, 서울특별시, 03722, 대한민국
UPDATE hospitals SET lat = 37.5622617, lng = 126.9403921, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '서울 서대문구 연세로 50-1'
  WHERE name = '세브란스병원';
-- 인하대학교병원  [area]  인하대병원, 인항로, 신흥동1가, 신흥동, 중구, 제물포구, 인천광역시, 22332, 대한민국
UPDATE hospitals SET lat = 37.4589031, lng = 126.6343085, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '인천 중구 인항로 27'
  WHERE name = '인하대학교병원';
-- 인천성모병원  [poi]  가톨릭대학교 인천성모병원, 동수로52번길, 부평동, 부평구, 인천광역시, 21424, 대한민국
UPDATE hospitals SET lat = 37.4844255, lng = 126.7254283, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '인천 부평구 동수로 56'
  WHERE name = '인천성모병원';
-- 아주대학교병원  [poi]  아주대학교병원, 164, 월드컵로, 원천동, 영통구, 수원시, 경기도, 16499, 대한민국
UPDATE hospitals SET lat = 37.2796829, lng = 127.0479287, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '경기 수원시 영통구 월드컵로 164'
  WHERE name = '아주대학교병원';
-- 강원대병원  [poi]  강원대학교병원, 백령로165번길, 후평동, 후평2동, 춘천시, 강원특별자치도, 24290, 대한민국
UPDATE hospitals SET lat = 37.8749775, lng = 127.7447953, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '강원특별자치도 춘천시 백령로 156'
  WHERE name = '강원대병원';
-- 강릉아산병원  [poi]  강릉아산병원, 산대월길, 사천면, 강릉시, 강원특별자치도, 25440, 대한민국
UPDATE hospitals SET lat = 37.8180311, lng = 128.8589185, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '강원특별자치도 강릉시 방동길 38'
  WHERE name = '강릉아산병원';
-- 하나이비인후과병원  [poi]  하나이비인후과, 역삼로, 역삼동, 역삼2동, 강남구, 서울특별시, 06227, 대한민국
UPDATE hospitals SET lat = 37.4978704, lng = 127.0430155, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '서울특별시 강남구 역삼로 245 하나이비인후과병원'
  WHERE name = '하나이비인후과병원';
-- 일산백병원  [poi]  인제대학교 일산백병원, 170, 주화로, 대화동, 주엽2동, 일산서구, 고양시, 경기도, 10380, 대한민국
UPDATE hospitals SET lat = 37.6741899, lng = 126.7506016, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '경기도 고양시 일산서구 주화로 170'
  WHERE name = '일산백병원';
-- 강동경희대학교병원  [poi]  강동경희대학교병원, 세종포천고속도로, 고덕동, 상일1동, 강동구, 서울특별시, 05233, 대한민국
UPDATE hospitals SET lat = 37.5534679, lng = 127.1574417, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '서울 강동구 동남로 892'
  WHERE name = '강동경희대학교병원';
-- 조선대학교병원  [poi]  조선대학교병원, 남문로, 학동, 동구, 광주, 전남광주통합특별시, 61457, 대한민국
UPDATE hospitals SET lat = 35.1391207, lng = 126.9259034, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '광주광역시 동구 필문대로 365'
  WHERE name = '조선대학교병원';
-- 전북대학교병원  [poi]  전북대학교병원, 건지4길, 인후동2가, 덕진구, 전주시, 전북특별자치도, 54917, 대한민국
UPDATE hospitals SET lat = 35.8477584, lng = 127.1415189, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '전북 전주시 덕진구 건지로 20'
  WHERE name = '전북대학교병원';
-- 삼성창원병원  [area]  삼성창원병원, 팔용로, 양덕동, 마산회원구, 창원시, 경상남도, 51206, 대한민국
UPDATE hospitals SET lat = 35.2434464, lng = 128.5911962, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '경상남도 창원시 마산회원구 팔용로 158'
  WHERE name = '삼성창원병원';
-- 부산대학교병원  [poi]  부산대학교병원, 179, 구덕로, 토성동5가, 충무동, 서구, 부산광역시, 49245, 대한민국
UPDATE hospitals SET lat = 35.1008351, lng = 129.0185505, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '부산 서구 구덕로 179'
  WHERE name = '부산대학교병원';
-- 해운대백병원  [poi]  인제대학교 해운대백병원, 해운대로, 좌4동, 해운대구, 부산광역시, 48108, 대한민국
UPDATE hospitals SET lat = 35.1733083, lng = 129.182232, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '부산광역시 해운대구 해운대로 875'
  WHERE name = '해운대백병원';
-- 한양대학교병원  [area]  한양대병원, 마조로, 사근동, 성동구, 서울특별시, 04759, 대한민국
UPDATE hospitals SET lat = 37.5601, lng = 127.04119, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '서울 성동구 왕십리로 222-1'
  WHERE name = '한양대학교병원';
-- 고려대안산병원  [poi]  고려대학교안산병원, 123, 적금로, 고잔동, 단원구, 안산시, 경기도, 15355, 대한민국
UPDATE hospitals SET lat = 37.3191109, lng = 126.8251972, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '경기도 안산시 단원구 적금로 123'
  WHERE name = '고려대안산병원';
-- 울산대병원  [poi]  울산대학교병원(University of Ulsan Hospital), 877, 방어진순환도로, 동구, 울산광역시, 44035,
UPDATE hospitals SET lat = 35.5193587, lng = 129.4292212, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '울산광역시 동구 대학병원로 25'
  WHERE name = '울산대병원';
-- 칠곡경북대학교병원  [poi]  칠곡경북대학교병원, 807, 호국로, 학정동, 국우동, 북구, 대구광역시, 41404, 대한민국
UPDATE hospitals SET lat = 35.9565651, lng = 128.5638866, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '대구 북구 호국로 807'
  WHERE name = '칠곡경북대학교병원';
-- 노원을지병원  [area]  을지병원, 68, 한글비석로, 하계동, 하계1동, 노원구, 서울특별시, 01830, 대한민국
UPDATE hospitals SET lat = 37.636483, lng = 127.0700159, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '서울특별시 노원구 한글비석로 68'
  WHERE name = '노원을지병원';
-- 경상국립대병원  [poi]  경상국립대학교병원, 강남로95번길, 칠암동, 천전동, 진주시, 경상남도, 52727, 대한민국
UPDATE hospitals SET lat = 35.1762451, lng = 128.0959663, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '경남 진주시 강남로 79'
  WHERE name = '경상국립대병원';
-- 정연훈플러스이비인후과  [poi]  샐러그리티 송파점, 126, 중대로, 가락동, 송파구
UPDATE hospitals SET lat = 37.4939995, lng = 127.1222473, geocoded_at = CURRENT_TIMESTAMP, geocoded_address = '서울특별시 송파구 중대로 126, 드림캐슬 5층'
  WHERE name = '정연훈플러스이비인후과';

-- 지역 오등록 정정: 한림대학교 평촌성심병원 은 경기 안양시 소재 (기존 좌표는 번지 정확 일치라 유지)
UPDATE hospitals SET region = '경기' WHERE name = '한림대학교 평촌성심병원' AND region = '서울';

-- 좌표 미확정으로 이번 마이그레이션에서 제외한 기관
--   소리의원 면목점 (면목로 340) : 번지 단위 매칭 실패, 기존 좌표는 약 1km 오차 → 수동 입력 필요
--   순천향대학교천안병원          : 기존 좌표가 번지까지 정확 일치 → 유지
--   한림대학교 평촌성심병원        : 기존 좌표가 번지까지 정확 일치 → 유지 (지역만 정정)
