#!/usr/bin/env node
/**
 * Tailwind 빌드 타임 전환 검증 스크립트.
 *
 * cdn.tailwindcss.com은 런타임에 DOM을 스캔해 CSS를 즉석 생성하므로
 * "쓰기만 하면 동작"했습니다. 빌드 타임 방식은 정적 스캔이라, 스캐너가
 * 놓친 클래스는 조용히 스타일이 사라집니다 = 시각 회귀.
 *
 * 이 스크립트는 소스에서 Tailwind 유틸리티로 보이는 클래스를 추출하고,
 * 생성된 tailwind.css에 실제로 존재하는지 대조해 누락분을 보고합니다.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const CSS_PATH = path.join(ROOT, 'public/static/tailwind.css')
const SOURCES = [
  path.join(ROOT, 'public/static/app.js'),
  path.join(ROOT, 'src/index.tsx'),
]

const css = fs.readFileSync(CSS_PATH, 'utf8')

// Tailwind가 생성한 셀렉터에서 클래스명만 뽑아 집합으로.
// 이스케이프 문자(\, \[, \], \/, \. 등)를 제거해 원래 클래스명으로 복원.
const generated = new Set()
// 주의: 이스케이프 대안(\\.)을 먼저 시도해야 합니다. 그렇지 않으면
// `.lg\:text-4xl`에서 백슬래시만 소비하고 `:`에서 끊겨 `lg\`만 잡힙니다.
for (const m of css.matchAll(/\.((?:\\.|[^\s{},:>+~()[\]"'])+)/g)) {
  generated.add(m[1].replace(/\\/g, ''))
}

// Tailwind 유틸리티로 보이는 접두사만 검사 (프로젝트 자체 CSS 클래스 제외)
const TW_PREFIX = /^(?:-?(?:m|p)[trblxy]?-|(?:w|h|min-w|min-h|max-w|max-h)-|text-|bg-|border|rounded|flex|grid|gap-|space-[xy]-|items-|justify-|self-|order-|col-|row-|font-|leading-|tracking-|shadow|opacity-|z-|inset-|top-|right-|bottom-|left-|overflow-|whitespace-|truncate$|hidden$|block$|inline|table|absolute$|relative$|fixed$|sticky$|static$|cursor-|select-|resize|transition|duration-|ease-|delay-|animate-|transform$|translate-|rotate-|scale-|skew-|origin-|ring|divide-|placeholder-|appearance-|outline|pointer-events-|visible$|invisible$|sr-only$|not-sr-only$|object-|aspect-|backdrop-|filter$|blur|brightness-|contrast-|grayscale|invert|saturate-|sepia|drop-shadow|mix-blend-|list-|underline$|line-through$|no-underline$|uppercase$|lowercase$|capitalize$|normal-case$|align-|break-|indent-|caret-|accent-|will-change-|content-|basis-|grow|shrink|float-|clear-|box-|isolate$|isolation-)/

// 변형(variant) 접두사 — 검사 시 제거하고 베이스 유틸만 확인
const VARIANT = /^(?:sm|md|lg|xl|2xl|hover|focus|focus-within|focus-visible|active|visited|disabled|checked|group-hover|group-focus|peer-hover|peer-focus|peer-checked|first|last|odd|even|only|empty|target|dark|motion-safe|motion-reduce|print|rtl|ltr|open|placeholder|before|after|file|marker|selection|first-line|first-letter|backdrop|aria-\w+|data-\[[^\]]+\]|\[[^\]]+\]|max-sm|max-md|max-lg|max-xl|min-\[[^\]]+\]|supports-\[[^\]]+\])$/

const candidates = new Set()

for (const file of SOURCES) {
  const src = fs.readFileSync(file, 'utf8')
  // class="..." / class='...' 안의 토큰, 그리고 JS 문자열 안의 클래스 나열을 폭넓게 수집
  for (const m of src.matchAll(/class\s*=\s*["'`]([^"'`]*)["'`]/g)) {
    for (const tok of m[1].split(/\s+/)) if (tok) candidates.add(tok)
  }
  // JS에서 classList.add('...') / 문자열 결합으로 쓰이는 클래스 조각
  for (const m of src.matchAll(/classList\.(?:add|remove|toggle)\(([^)]*)\)/g)) {
    for (const s of m[1].matchAll(/['"`]([^'"`]+)['"`]/g)) {
      for (const tok of s[1].split(/\s+/)) if (tok) candidates.add(tok)
    }
  }
}

const missing = []
for (const raw of candidates) {
  // 템플릿 보간 조각이나 명백한 비클래스 토큰 제외
  if (!raw || raw.includes('${') || raw.includes('+') || raw.includes('(')) continue

  // 변형 접두사 제거: hover:sm:bg-red-500 → bg-red-500
  const parts = raw.split(':')
  const base = parts.pop()
  const variantsOk = parts.every(p => VARIANT.test(p))
  if (!variantsOk) continue          // 알 수 없는 변형은 판단 보류
  if (!base || !TW_PREFIX.test(base)) continue  // Tailwind 유틸리티 아님 → 스킵

  // 임의값 클래스는 이스케이프 복원 후 비교되므로 그대로 대조
  const negBase = base
  if (!generated.has(raw) && !generated.has(negBase)) {
    missing.push(raw)
  }
}

const uniqueMissing = [...new Set(missing)].sort()

console.log(`생성된 클래스 수: ${generated.size}`)
console.log(`검사한 Tailwind 후보 클래스 수: ${candidates.size}`)
console.log(`누락 의심 클래스: ${uniqueMissing.length}`)
if (uniqueMissing.length) {
  console.log('\n--- 누락 의심 목록 ---')
  for (const c of uniqueMissing) console.log('  ' + c)
  process.exitCode = 1
} else {
  console.log('\n✅ 누락 없음')
}
