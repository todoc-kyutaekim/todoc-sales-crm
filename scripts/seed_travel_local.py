#!/usr/bin/env python3
"""로컬 검증용 시드. meeting_type 은 프로덕션과 동일하게 영문 'visit' 을 사용합니다.
검증 후 scripts/seed_travel_local.py --clean 으로 반드시 삭제하세요."""
import subprocess, sys, json, re

DB = 'todoc-crm-production'

def run(sql):
    p = subprocess.run(
        ['npx', 'wrangler', 'd1', 'execute', DB, '--local', '--command', sql, '--json'],
        cwd='/home/user/webapp', capture_output=True, text=True)
    out = p.stdout
    m = re.search(r'"results": (\[[\s\S]*?\]),\n    "success"', out)
    ok = '"success": true' in out
    if not ok:
        print('  FAIL:', sql[:80], '\n   ', (p.stderr or out)[-400:])
        sys.exit(1)
    return json.loads(m.group(1)) if m else []

CLEAN = [
    "DELETE FROM meetings WHERE purpose LIKE '[TEST]%'",
    "DELETE FROM travel_logs WHERE note LIKE '[TEST]%'",
    "DELETE FROM travel_places WHERE name LIKE '[TEST]%'",
    "DELETE FROM doctors WHERE name LIKE '[TEST]%'",
    "DELETE FROM hospitals WHERE name LIKE '[TEST]%'",
]

# 실제 서울 좌표 (기관명 → 위도, 경도)
HOSPITALS = [
    ('[TEST]소리의원 면목점', '서울', '서울 중랑구 면목로 442-3', 37.5915531, 127.087082),
    ('[TEST]강남세브란스', '서울', '서울 강남구 언주로 211', 37.4926, 127.0470),
    ('[TEST]서울아산병원', '서울', '서울 송파구 올림픽로43길 88', 37.5270, 127.1080),
    ('[TEST]분당서울대병원', '경기', '경기 성남시 분당구 구미로173번길 82', 37.3520, 127.1240),
]

# (날짜, 병원 index, visit_time) — 하루에 2~3곳 방문하는 날 포함
MEETINGS = [
    ('2026-08-03', 0, 'am'), ('2026-08-03', 1, 'pm'),
    ('2026-08-04', 2, 'am'), ('2026-08-04', 3, 'pm'), ('2026-08-04', 1, 'allday'),
    ('2026-08-05', 0, 'am'),
]


def clean():
    print('[clean] 테스트 데이터 삭제')
    for s in CLEAN:
        run(s)
    print('[clean] 완료')


def seed():
    clean()
    print('[seed] 시작')
    uid = run("SELECT id FROM users ORDER BY id LIMIT 1")[0]['id']

    hids = []
    for (name, region, addr, lat, lng) in HOSPITALS:
        run(f"INSERT INTO hospitals (name, region, address, lat, lng) VALUES ('{name}','{region}','{addr}',{lat},{lng})")
        hids.append(run(f"SELECT id FROM hospitals WHERE name='{name}'")[0]['id'])

    run(f"INSERT INTO doctors (name, hospital_id) VALUES ('[TEST]김의사', {hids[0]})")
    did = run("SELECT id FROM doctors WHERE name='[TEST]김의사'")[0]['id']

    # 출발지(집) / 복귀지(사무실) 기본값 등록
    run(f"INSERT INTO travel_places (user_id, name, place_type, address, lat, lng, is_default_origin) "
        f"VALUES ({uid}, '[TEST]집', 'home', '서울 강동구 천호대로 1000', 37.5385, 127.1230, 1)")
    run(f"INSERT INTO travel_places (user_id, name, place_type, address, lat, lng, is_default_return) "
        f"VALUES ({uid}, '[TEST]사무실', 'office', '서울 강남구 테헤란로 152', 37.5000, 127.0365, 1)")

    for (d, hi, vt) in MEETINGS:
        run("INSERT INTO meetings (doctor_id, hospital_id, meeting_date, meeting_type, purpose, visit_time, user_id) "
            f"VALUES ({did}, {hids[hi]}, '{d}', 'visit', '[TEST]정기 방문', '{vt}', {uid})")

    # 비방문 유형도 섞어서 필터가 제대로 걸러내는지 확인
    run("INSERT INTO meetings (doctor_id, hospital_id, meeting_date, meeting_type, purpose, visit_time, user_id) "
        f"VALUES ({did}, {hids[0]}, '2026-08-03', 'phone', '[TEST]전화 상담', 'am', {uid})")
    run("INSERT INTO meetings (doctor_id, hospital_id, meeting_date, meeting_type, purpose, visit_time, user_id) "
        f"VALUES ({did}, {hids[1]}, '2026-08-06', 'conference', '[TEST]학회', 'allday', {uid})")

    n = run("SELECT COUNT(*) c FROM meetings WHERE purpose LIKE '[TEST]%' AND meeting_type='visit'")[0]['c']
    print(f'[seed] 완료 — visit {n}건, 병원 {len(hids)}곳, 장소 2곳 (user_id={uid})')


if __name__ == '__main__':
    if '--clean' in sys.argv:
        clean()
    else:
        seed()
