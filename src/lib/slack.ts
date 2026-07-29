// Slack Incoming Webhook 알림 유틸리티
// AS/수리 이벤트를 Slack 채널에 알림으로 전송

// 상태·우선순위 한글 레이블
const REPAIR_STATUS_LABEL: Record<string, string> = {
  received: '접수',
  diagnosing: '진단중',
  waiting_parts: '부품대기',
  repairing: '수리중',
  completed: '수리완료',
  shipped: '발송',
  closed: '종료',
  rejected: '반려',
}
const PRIORITY_LABEL: Record<string, string> = {
  low: '낮음',
  mid: '보통',
  high: '높음',
  urgent: '긴급',
}
const PRIORITY_EMOJI: Record<string, string> = {
  low: '🟢',
  mid: '🟡',
  high: '🟠',
  urgent: '🔴',
}
const STATUS_EMOJI: Record<string, string> = {
  received: '📥',
  diagnosing: '🔍',
  waiting_parts: '⏳',
  repairing: '🔧',
  completed: '✅',
  shipped: '📦',
  closed: '📁',
  rejected: '❌',
}

function statusLabel(s?: string | null) {
  if (!s) return '—'
  return REPAIR_STATUS_LABEL[s] || s
}
function priorityLabel(p?: string | null) {
  if (!p) return '—'
  return PRIORITY_LABEL[p] || p
}

// AS 상세 페이지 URL 생성 (공개 URL 우선, 없으면 상대경로)
function repairUrl(baseUrl: string | undefined, repairId: number): string {
  const base = baseUrl || 'https://todoc-crm.pages.dev'
  return `${base}/#cs_repair?open=${repairId}`
}

// Slack 메시지 헬퍼 - context 라인
function ctxItem(label: string, value: string | number | null | undefined): any {
  return {
    type: 'mrkdwn',
    text: `*${label}:* ${value == null || value === '' ? '—' : value}`,
  }
}

// ─────────────────────────────────────────────────────────────
// 이벤트 타입
// ─────────────────────────────────────────────────────────────
export type RepairEvent =
  | { kind: 'created'; repair: any; user_name?: string }
  | { kind: 'status_changed'; repair: any; from_status: string; to_status: string; user_name?: string }
  | { kind: 'assigned'; repair: any; from_assignee?: string; to_assignee?: string; user_name?: string }

// ─────────────────────────────────────────────────────────────
// 메시지 빌더 (Block Kit)
// ─────────────────────────────────────────────────────────────
function buildBlocks(env: any, evt: RepairEvent) {
  const r = evt.repair
  const url = repairUrl(env.PUBLIC_BASE_URL, r.id)

  // 헤더: 이벤트별
  let headerText = ''
  let headerEmoji = ''
  if (evt.kind === 'created') {
    headerEmoji = '🆕'
    headerText = `AS 신규 접수 · #${r.id}`
  } else if (evt.kind === 'status_changed') {
    headerEmoji = STATUS_EMOJI[evt.to_status] || '🔄'
    headerText = `AS 상태 변경 · #${r.id}`
  } else if (evt.kind === 'assigned') {
    headerEmoji = '👤'
    headerText = `AS 담당자 배정 · #${r.id}`
  }

  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${headerEmoji} ${headerText}`, emoji: true },
    },
  ]

  // 이벤트별 변경 요약 라인
  if (evt.kind === 'status_changed') {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*상태 변경:* ${statusLabel(evt.from_status)} → *${statusLabel(evt.to_status)}*`,
      },
    })
  } else if (evt.kind === 'assigned') {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*담당자 배정:* ${evt.from_assignee || '미지정'} → *${evt.to_assignee || '미지정'}*`,
      },
    })
  }

  // 증상 (본문)
  if (r.symptom) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*증상*\n> ${String(r.symptom).replace(/\n/g, '\n> ').slice(0, 800)}`,
      },
    })
  }

  // 컨텍스트 - 고객·병원·우선순위·상태·담당자
  const priorityText = `${PRIORITY_EMOJI[r.priority] || ''} ${priorityLabel(r.priority)}`.trim()
  const statusText = `${STATUS_EMOJI[r.status] || ''} ${statusLabel(r.status)}`.trim()

  const ctxFields = [
    ctxItem('고객', r.customer_name || r.contact_name || '—'),
    ctxItem('병원', r.hospital_name || '—'),
    ctxItem('상태', statusText),
    ctxItem('우선순위', priorityText),
    ctxItem('담당자', r.assignee_name || '미지정'),
  ]
  // 제품 정보 있으면 추가
  if (r.product_name || r.product_master_name) {
    ctxFields.push(ctxItem('제품', r.product_master_name || r.product_name))
  }
  if (r.product_serial_no || r.serial_no_text) {
    ctxFields.push(ctxItem('시리얼', r.product_serial_no || r.serial_no_text))
  }

  // Slack section fields는 2열 그리드, 최대 10개
  blocks.push({
    type: 'section',
    fields: ctxFields.slice(0, 10),
  })

  // urgent면 강조 안내
  if (r.priority === 'urgent') {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '🚨 *긴급 건입니다.* 신속한 확인 부탁드립니다.',
        },
      ],
    })
  }

  // 액션: CRM에서 열기 버튼
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '🔗 CRM에서 열기', emoji: true },
        url,
        style: r.priority === 'urgent' ? 'danger' : 'primary',
      },
    ],
  })

  // 푸터: 이벤트 실행자
  if (evt.user_name) {
    blocks.push({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `_by ${evt.user_name}_ · <${url}|#${r.id}>` },
      ],
    })
  }

  return blocks
}

// 짧은 fallback 텍스트 (알림 프리뷰용)
function buildFallback(evt: RepairEvent): string {
  const r = evt.repair
  const who = r.customer_name || r.contact_name || '고객'
  const symptomShort = (r.symptom || '').slice(0, 40)
  if (evt.kind === 'created') return `[AS #${r.id}] 신규 접수 · ${who} · ${symptomShort}`
  if (evt.kind === 'status_changed') return `[AS #${r.id}] ${statusLabel(evt.from_status)} → ${statusLabel(evt.to_status)} · ${who}`
  if (evt.kind === 'assigned') return `[AS #${r.id}] 담당자 배정: ${evt.to_assignee || '미지정'} · ${who}`
  return `[AS #${r.id}]`
}

// ─────────────────────────────────────────────────────────────
// 발송 (실패해도 예외를 던지지 않음 - 알림 실패가 비즈니스 로직을 막지 않도록)
// ─────────────────────────────────────────────────────────────
export async function notifyRepair(env: any, evt: RepairEvent): Promise<void> {
  const url = env?.SLACK_WEBHOOK_URL
  if (!url) {
    // Secret 미설정 상태 - 조용히 스킵
    console.log('[slack] SLACK_WEBHOOK_URL not configured, skipping notification')
    return
  }
  try {
    const payload = {
      text: buildFallback(evt),
      blocks: buildBlocks(env, evt),
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '')
      console.error('[slack] notify failed', res.status, bodyText.slice(0, 200))
    }
  } catch (e: any) {
    console.error('[slack] notify error', e?.message || String(e))
  }
}
