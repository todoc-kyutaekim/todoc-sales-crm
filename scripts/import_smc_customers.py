#!/usr/bin/env python3
"""
엑셀 파일에서 SMC 초기사용자 10명을 customers 테이블용 SQL로 변환.

매핑:
- 고객명 → name
- 생년월일 → birth_date
- 성별 (남/여) → gender ('M'/'F')  # 현재 프로젝트가 M/F 사용
- 연락처 → phone
- 주소 → address (trim), 앞부분 광역시도 → region (짧은 형태로: '서울', '경기' 등)
- 고객그룹 '삼성서울' → hospital_id = 삼성서울병원 id (서브쿼리)
- 고객등급 '초기사용자(smc)' → tags JSON: ["초기사용자","SMC"]
- customer_type → 'patient' (수술 환자)
- 메모의 "SMCxx" 관리번호 + "260627_1.5버전교체" + 보호자 정보 → notes 유지
- "260627_1.5버전교체" 파싱 → external_supply_date='2026-06-27', external_version='1.5'
- 최근상담일시 → 별도 cs_inquiries SQL로 출력 (있는 4명만)

이 스크립트는 두 파일을 생성:
1. migrations_data/import_smc_customers.sql (customers INSERT)
2. migrations_data/import_smc_inquiries.sql (cs_inquiries INSERT for 4 customers)
"""
import openpyxl
import re
import os

EXCEL = '/home/user/uploaded_files/crm_고객정보 (1).xlsx'
OUT_DIR = '/home/user/webapp/migrations_data'
os.makedirs(OUT_DIR, exist_ok=True)

REGION_LONG_TO_SHORT = {
    '서울특별시': '서울', '부산광역시': '부산', '대구광역시': '대구',
    '인천광역시': '인천', '광주광역시': '광주', '대전광역시': '대전',
    '울산광역시': '울산', '세종특별자치시': '세종',
    '경기도': '경기', '강원도': '강원', '강원특별자치도': '강원',
    '충청북도': '충북', '충청남도': '충남',
    '전라북도': '전북', '전북특별자치도': '전북', '전라남도': '전남',
    '경상북도': '경북', '경상남도': '경남',
    '제주특별자치도': '제주',
}
GENDER_MAP = {'남': 'M', '여': 'F'}

def sql_escape(v):
    """SQL 문자열 이스케이프. None → NULL."""
    if v is None or v == '':
        return 'NULL'
    return "'" + str(v).replace("'", "''") + "'"

def extract_region(address):
    if not address:
        return None
    addr = str(address).strip()
    for long, short in REGION_LONG_TO_SHORT.items():
        if addr.startswith(long):
            return short
    return None

def parse_memo(memo_raw):
    """
    메모 정리 + 외부기 정보 파싱.
    입력 예: "SMC01_x000D_\n260627_1.5버전교체"
    반환: (clean_notes, external_supply_date, external_version)
    """
    if not memo_raw:
        return ('', None, None)
    memo = str(memo_raw).replace('_x000D_', '').replace('\r\n', '\n').replace('\r', '\n')
    # 각 줄 공백 정리
    lines = [l.strip() for l in memo.split('\n') if l.strip()]
    memo_clean = '\n'.join(lines)

    # "260627_1.5버전교체" 같은 패턴 파싱
    # 형식: YYMMDD_X.Y버전교체 → 20YY-MM-DD, X.Y
    supply_date = None
    version = None
    m = re.search(r'(\d{6})_(\d+\.\d+)버전교체', memo_clean)
    if m:
        d = m.group(1)  # e.g. 260627
        v = m.group(2)  # e.g. 1.5
        yy = int(d[0:2])
        mm = int(d[2:4])
        dd = int(d[4:6])
        # YY < 70 → 2000년대, >=70 → 1900년대 (관례상)
        year = 2000 + yy if yy < 70 else 1900 + yy
        try:
            from datetime import date
            supply_date = date(year, mm, dd).isoformat()
            version = v
        except Exception:
            pass
    return (memo_clean, supply_date, version)

def main():
    wb = openpyxl.load_workbook(EXCEL, data_only=True)
    ws = wb['Sheet1']
    rows = list(ws.iter_rows(values_only=True))

    customers = []
    for row in rows[2:]:  # skip title + header
        if not row[0]:
            continue
        name, birth, gender, group, grade, phone, address, memo, last_contact = row

        birth_str = str(birth)[:10] if birth else None
        gender_code = GENDER_MAP.get(str(gender).strip() if gender else '', None)
        region = extract_region(address)
        addr_clean = str(address).strip() if address else None
        notes_clean, ext_supply_date, ext_version = parse_memo(memo)

        # tags: 항상 초기사용자 + SMC
        tags = '["초기사용자","SMC"]'

        # 외부기 제조사: 코클리어로 가정 (SMC=Samsung Medical Center에서 주로 코클리어 사용)
        # 하지만 확실치 않으므로 NULL 처리하고 사용자가 수정하도록 함
        ext_mfr = None

        # 최근상담일시
        last_contact_str = None
        if last_contact:
            s = str(last_contact).strip()
            if s and s != 'None':
                last_contact_str = s[:16].replace(' ', ' ')  # YYYY-MM-DD HH:MM

        customers.append({
            'name': name,
            'birth': birth_str,
            'gender': gender_code,
            'phone': phone,
            'address': addr_clean,
            'region': region,
            'notes': notes_clean,
            'tags': tags,
            'ext_supply_date': ext_supply_date,
            'ext_version': ext_version,
            'ext_mfr': ext_mfr,
            'last_contact': last_contact_str,
        })

    # ===== customers INSERT SQL =====
    out_cust = os.path.join(OUT_DIR, 'import_smc_customers.sql')
    with open(out_cust, 'w', encoding='utf-8') as f:
        f.write('-- SMC 초기사용자 10명 임포트 (엑셀 원본: crm_고객정보 (1).xlsx)\n')
        f.write('-- hospital_id는 삼성서울병원 이름으로 서브쿼리 (local/remote 자동 매칭)\n')
        f.write('-- 이미 같은 phone이 있으면 스킵 (INSERT OR IGNORE + UNIQUE(phone) 없으므로 SELECT 체크로 방어)\n\n')
        for c in customers:
            f.write("-- {name} ({phone})\n".format(**c))
            f.write(
                "INSERT INTO customers (name, phone, birth_date, gender, customer_type, "
                "hospital_id, address, region, status, tags, notes, "
                "external_manufacturer, external_supply_date, external_version) "
                "SELECT {name}, {phone}, {birth}, {gender}, 'patient', "
                "(SELECT id FROM hospitals WHERE name='삼성서울병원' LIMIT 1), "
                "{address}, {region}, 'active', {tags}, {notes}, "
                "{ext_mfr}, {ext_supply_date}, {ext_version} "
                "WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone={phone});\n\n".format(
                    name=sql_escape(c['name']),
                    phone=sql_escape(c['phone']),
                    birth=sql_escape(c['birth']),
                    gender=sql_escape(c['gender']),
                    address=sql_escape(c['address']),
                    region=sql_escape(c['region']),
                    tags=sql_escape(c['tags']),
                    notes=sql_escape(c['notes']),
                    ext_mfr=sql_escape(c['ext_mfr']),
                    ext_supply_date=sql_escape(c['ext_supply_date']),
                    ext_version=sql_escape(c['ext_version']),
                )
            )

    print(f'✅ 생성: {out_cust}')

    # ===== cs_inquiries INSERT SQL (최근상담 있는 고객만) =====
    with_contact = [c for c in customers if c['last_contact']]
    out_inq = os.path.join(OUT_DIR, 'import_smc_inquiries.sql')
    with open(out_inq, 'w', encoding='utf-8') as f:
        f.write('-- 최근상담일시가 있는 SMC 고객의 초기 응대 이력\n')
        f.write('-- 엑셀 임포트 시점의 마지막 상담 기록을 cs_inquiries에 한 건씩 생성\n')
        f.write('-- customer_id는 phone으로 조회, 이미 같은 subject/customer_id 조합이 있으면 스킵\n\n')
        for c in with_contact:
            # last_contact 형식: "2026-06-02 10:55:00" 또는 "2026-06-02 10:55"
            lc = c['last_contact']
            if lc and len(lc) == 16:  # "YYYY-MM-DD HH:MM"
                lc = lc + ':00'
            f.write("-- {name} 최근상담 {lc}\n".format(name=c['name'], lc=c['last_contact']))
            f.write(
                "INSERT INTO cs_inquiries (customer_id, hospital_id, contact_name, contact_phone, "
                "subject, category, channel, priority, status, direction, first_message, created_at, updated_at, resolved_at) "
                "SELECT (SELECT id FROM customers WHERE phone={phone} LIMIT 1), "
                "(SELECT id FROM hospitals WHERE name='삼성서울병원' LIMIT 1), "
                "{name}, {phone}, "
                "'최근 상담 (엑셀 임포트)', 'general', 'phone', 'mid', 'closed', 'inbound', "
                "'엑셀 원본에서 최근상담일시로 기록된 항목. 상세 내용 없음.', "
                "{lc}, {lc}, {lc} "
                "WHERE (SELECT id FROM customers WHERE phone={phone} LIMIT 1) IS NOT NULL "
                "AND NOT EXISTS (SELECT 1 FROM cs_inquiries WHERE customer_id=(SELECT id FROM customers WHERE phone={phone} LIMIT 1) AND subject='최근 상담 (엑셀 임포트)');\n\n".format(
                    name=sql_escape(c['name']),
                    phone=sql_escape(c['phone']),
                    lc=sql_escape(lc),
                )
            )
    print(f'✅ 생성: {out_inq}  ({len(with_contact)}건)')

    # ===== 요약 출력 =====
    print(f'\n총 {len(customers)}명 임포트 준비 완료')
    print(f'  - 최근상담 있음: {len(with_contact)}명')
    print(f'  - 외부기 지급일 파싱: {sum(1 for c in customers if c["ext_supply_date"])}명')

if __name__ == '__main__':
    main()
