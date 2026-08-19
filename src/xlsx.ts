// ============================================================================
// 의존성 없는 XLSX(OOXML) 생성기 — Cloudflare Workers 런타임 전용
//
// 왜 직접 만들었나:
//   재무팀 제출 양식은 2단 병합 헤더 · 수식 · 회계 숫자서식 · 셀 배경색을 요구합니다.
//   기존 XML Spreadsheet 2003(.xls) 방식으로는 확장자가 달라 엑셀이 경고를 띄우고,
//   xlsx 라이브러리는 Workers 10MB 번들 제한과 Node API 의존 때문에 쓸 수 없습니다.
//
// 구현 범위:
//   ZIP 은 무압축(STORE)으로 씁니다. 보고서는 수백 KB 수준이라 압축이 불필요하고,
//   deflate 를 직접 구현하지 않아도 엑셀·구글시트·openpyxl 모두 정상적으로 엽니다.
//   문자열은 sharedStrings 대신 inlineStr 을 써서 파일 구조를 단순하게 유지합니다.
// ============================================================================

/** 셀 하나. v(값) 또는 f(수식) 중 하나를 씁니다. s 는 스타일 인덱스입니다. */
export type XlsxCell = {
  /** 값. number 는 숫자셀, string 은 inlineStr 로 씁니다. */
  v?: string | number | null
  /** 수식 (앞의 '=' 는 제외). 값 대신 이걸 넣으면 엑셀이 열 때 계산합니다. */
  f?: string
  /** styles 배열의 인덱스 (0 = 기본) */
  s?: number
  /** 날짜 serial 로 저장할지. true 면 v 에 'YYYY-MM-DD' 를 주세요. */
  date?: boolean
}

export type XlsxStyle = {
  /** 숫자 서식 코드. 예: '#,##0', 'yyyy/mm/dd' */
  numFmt?: string
  bold?: boolean
  /** pt 단위 (기본 10) */
  size?: number
  /** 글자색 ARGB. 예: 'FF0070C0' */
  color?: string
  /** 배경색 ARGB. 예: 'FFD6DCE4' */
  fill?: string
  align?: 'left' | 'center' | 'right'
  valign?: 'top' | 'center' | 'bottom'
  wrap?: boolean
  /** 얇은 실선 테두리 4면 */
  border?: boolean
}

export type XlsxSheet = {
  name: string
  /** 열 너비 (엑셀 문자 단위). 인덱스 0 = A열. 0 이하는 건너뜁니다. */
  cols?: number[]
  /** 행 배열. 인덱스 0 = 1행. null/빈 셀은 건너뜁니다. */
  rows: (XlsxCell | null | undefined)[][]
  /** 병합 범위. 예: ['B3:B4', 'C3:D3'] */
  merges?: string[]
  /** 틀 고정 기준 셀. 예: 'A5' (1~4행 고정) */
  freeze?: string
  /** 행 높이 지정. 키는 1-based 행번호 */
  rowHeights?: Record<number, number>
}

// ── ZIP (STORE) ──────────────────────────────────────────────────────────────

let CRC_TABLE: Uint32Array | null = null
function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  CRC_TABLE = t
  return t
}

function crc32(buf: Uint8Array): number {
  const t = crcTable()
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

type ZipEntry = { name: string; data: Uint8Array; crc: number }

/** 무압축 ZIP 컨테이너를 만듭니다. */
function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder()
  const entries: (ZipEntry & { nameBytes: Uint8Array; offset: number })[] = []

  let total = 0
  for (const f of files) {
    const nameBytes = enc.encode(f.name)
    entries.push({ ...f, crc: crc32(f.data), nameBytes, offset: 0 })
    total += 30 + nameBytes.length + f.data.length   // local header
    total += 46 + nameBytes.length                   // central directory
  }
  total += 22 // EOCD

  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  let p = 0

  // 날짜/시간은 고정값(2020-01-01 00:00)으로 둡니다 — 같은 입력이면 같은 바이트가 나오도록.
  const DOS_TIME = 0
  const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1

  for (const e of entries) {
    e.offset = p
    dv.setUint32(p, 0x04034b50, true); p += 4
    dv.setUint16(p, 20, true); p += 2          // version needed
    dv.setUint16(p, 0x0800, true); p += 2      // flags: UTF-8 파일명
    dv.setUint16(p, 0, true); p += 2           // method: store
    dv.setUint16(p, DOS_TIME, true); p += 2
    dv.setUint16(p, DOS_DATE, true); p += 2
    dv.setUint32(p, e.crc, true); p += 4
    dv.setUint32(p, e.data.length, true); p += 4
    dv.setUint32(p, e.data.length, true); p += 4
    dv.setUint16(p, e.nameBytes.length, true); p += 2
    dv.setUint16(p, 0, true); p += 2           // extra len
    out.set(e.nameBytes, p); p += e.nameBytes.length
    out.set(e.data, p); p += e.data.length
  }

  const cdStart = p
  for (const e of entries) {
    dv.setUint32(p, 0x02014b50, true); p += 4
    dv.setUint16(p, 20, true); p += 2          // version made by
    dv.setUint16(p, 20, true); p += 2          // version needed
    dv.setUint16(p, 0x0800, true); p += 2
    dv.setUint16(p, 0, true); p += 2
    dv.setUint16(p, DOS_TIME, true); p += 2
    dv.setUint16(p, DOS_DATE, true); p += 2
    dv.setUint32(p, e.crc, true); p += 4
    dv.setUint32(p, e.data.length, true); p += 4
    dv.setUint32(p, e.data.length, true); p += 4
    dv.setUint16(p, e.nameBytes.length, true); p += 2
    dv.setUint16(p, 0, true); p += 2           // extra
    dv.setUint16(p, 0, true); p += 2           // comment
    dv.setUint16(p, 0, true); p += 2           // disk
    dv.setUint16(p, 0, true); p += 2           // internal attrs
    dv.setUint32(p, 0, true); p += 4           // external attrs
    dv.setUint32(p, e.offset, true); p += 4
    out.set(e.nameBytes, p); p += e.nameBytes.length
  }

  const cdSize = p - cdStart

  dv.setUint32(p, 0x06054b50, true); p += 4
  dv.setUint16(p, 0, true); p += 2                  // this disk
  dv.setUint16(p, 0, true); p += 2                  // disk with cd
  dv.setUint16(p, entries.length, true); p += 2     // entries on this disk
  dv.setUint16(p, entries.length, true); p += 2     // total entries
  dv.setUint32(p, cdSize, true); p += 4
  dv.setUint32(p, cdStart, true); p += 4
  dv.setUint16(p, 0, true); p += 2                  // comment len

  if (p !== total) {
    // 위 total 계산과 실제 기록량이 다르면 ZIP 이 깨집니다 — 즉시 드러나게 합니다.
    throw new Error(`ZIP 크기 불일치: 예상 ${total}, 실제 ${p}`)
  }
  return out
}

// ── XML 유틸 ─────────────────────────────────────────────────────────────────

export function xmlEsc(v: any): string {
  const s = v === null || v === undefined ? '' : String(v)
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // 엑셀이 거부하는 제어문자 제거 (탭/개행은 유지)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
}

/** 0-based 열 인덱스 → 엑셀 열 문자 (0='A', 26='AA') */
export function colName(idx: number): string {
  let n = idx + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** 'YYYY-MM-DD' → 엑셀 날짜 serial (1900 날짜계, 1899-12-30 기준) */
function dateSerial(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''))
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const base = Date.UTC(1899, 11, 30)
  return Math.round((t - base) / 86400000)
}

// ── styles.xml ───────────────────────────────────────────────────────────────

function buildStyles(styles: XlsxStyle[]): string {
  // 인덱스 0 은 항상 기본 스타일이어야 합니다.
  const all: XlsxStyle[] = [{}, ...styles]

  // numFmt: 내장 서식과 겹치지 않게 164 부터 부여
  const fmtIds = new Map<string, number>()
  for (const st of all) {
    if (st.numFmt && !fmtIds.has(st.numFmt)) fmtIds.set(st.numFmt, 164 + fmtIds.size)
  }

  const fontKey = (st: XlsxStyle) => `${st.bold ? 1 : 0}|${st.size || 10}|${st.color || ''}`
  const fontIdx = new Map<string, number>()
  for (const st of all) {
    const k = fontKey(st)
    if (!fontIdx.has(k)) fontIdx.set(k, fontIdx.size)
  }

  // fills 0, 1 은 OOXML 예약(none, gray125). 사용자 fill 은 2 부터.
  const fillIdx = new Map<string, number>()
  for (const st of all) {
    if (st.fill && !fillIdx.has(st.fill)) fillIdx.set(st.fill, 2 + fillIdx.size)
  }

  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  x += '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'

  x += `<numFmts count="${fmtIds.size}">`
  for (const [code, id] of fmtIds) x += `<numFmt numFmtId="${id}" formatCode="${xmlEsc(code)}"/>`
  x += '</numFmts>'

  x += `<fonts count="${fontIdx.size}">`
  for (const k of fontIdx.keys()) {
    const [b, sz, col] = k.split('|')
    x += '<font>'
    if (b === '1') x += '<b/>'
    x += `<sz val="${sz}"/>`
    if (col) x += `<color rgb="${col}"/>`
    x += '<name val="맑은 고딕"/><family val="2"/><charset val="129"/>'
    x += '</font>'
  }
  x += '</fonts>'

  x += `<fills count="${2 + fillIdx.size}">`
  x += '<fill><patternFill patternType="none"/></fill>'
  x += '<fill><patternFill patternType="gray125"/></fill>'
  for (const c of fillIdx.keys()) {
    x += `<fill><patternFill patternType="solid"><fgColor rgb="${c}"/><bgColor indexed="64"/></patternFill></fill>`
  }
  x += '</fills>'

  x += '<borders count="2">'
  x += '<border><left/><right/><top/><bottom/><diagonal/></border>'
  x += '<border><left style="thin"><color rgb="FFBFBFBF"/></left>'
  x += '<right style="thin"><color rgb="FFBFBFBF"/></right>'
  x += '<top style="thin"><color rgb="FFBFBFBF"/></top>'
  x += '<bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>'
  x += '</borders>'

  x += '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'

  x += `<cellXfs count="${all.length}">`
  for (const st of all) {
    const nf = st.numFmt ? fmtIds.get(st.numFmt)! : 0
    const fo = fontIdx.get(fontKey(st))!
    const fi = st.fill ? fillIdx.get(st.fill)! : 0
    const bo = st.border ? 1 : 0
    const hasAlign = st.align || st.valign || st.wrap
    x += `<xf numFmtId="${nf}" fontId="${fo}" fillId="${fi}" borderId="${bo}"`
    x += ` applyNumberFormat="${nf ? 1 : 0}" applyFont="1" applyFill="${fi ? 1 : 0}" applyBorder="${bo}"`
    x += hasAlign ? ' applyAlignment="1">' : '>'
    if (hasAlign) {
      x += '<alignment'
      if (st.align) x += ` horizontal="${st.align}"`
      x += ` vertical="${st.valign || 'center'}"`
      if (st.wrap) x += ' wrapText="1"'
      x += '/>'
    }
    x += '</xf>'
  }
  x += '</cellXfs>'

  x += '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  x += '</styleSheet>'
  return x
}

// ── worksheet xml ────────────────────────────────────────────────────────────

function buildSheetXml(sh: XlsxSheet): string {
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  x += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'

  x += '<sheetViews><sheetView workbookViewId="0">'
  if (sh.freeze) {
    const m = /^([A-Z]+)(\d+)$/.exec(sh.freeze)
    if (m) {
      let cx = 0
      for (const ch of m[1]) cx = cx * 26 + (ch.charCodeAt(0) - 64)
      const xSplit = cx - 1
      const ySplit = Number(m[2]) - 1
      x += `<pane xSplit="${xSplit}" ySplit="${ySplit}" topLeftCell="${sh.freeze}"`
      x += ' activePane="bottomRight" state="frozen"/>'
    }
  }
  x += '</sheetView></sheetViews>'

  x += '<sheetFormatPr defaultRowHeight="16.5"/>'

  if (sh.cols && sh.cols.length) {
    x += '<cols>'
    for (let i = 0; i < sh.cols.length; i++) {
      const w = sh.cols[i]
      if (!w || w <= 0) continue
      x += `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`
    }
    x += '</cols>'
  }

  x += '<sheetData>'
  for (let r = 0; r < sh.rows.length; r++) {
    const row = sh.rows[r]
    if (!row || !row.length) continue
    const rn = r + 1
    const h = sh.rowHeights?.[rn]
    let cells = ''
    for (let ci = 0; ci < row.length; ci++) {
      const cell = row[ci]
      if (!cell) continue
      const hasV = cell.v !== undefined && cell.v !== null && cell.v !== ''
      if (!hasV && !cell.f) {
        // 스타일만 지정된 빈 셀 — 테두리/배경 유지를 위해 남깁니다.
        if (cell.s === undefined) continue
      }
      const ref = colName(ci) + rn
      const sAttr = cell.s ? ` s="${cell.s}"` : ''
      if (cell.f) {
        cells += `<c r="${ref}"${sAttr}><f>${xmlEsc(cell.f)}</f></c>`
      } else if (!hasV) {
        cells += `<c r="${ref}"${sAttr}/>`
      } else if (cell.date) {
        const ser = dateSerial(String(cell.v))
        cells += ser === null
          ? `<c r="${ref}"${sAttr} t="inlineStr"><is><t>${xmlEsc(cell.v)}</t></is></c>`
          : `<c r="${ref}"${sAttr}><v>${ser}</v></c>`
      } else if (typeof cell.v === 'number' && isFinite(cell.v)) {
        cells += `<c r="${ref}"${sAttr}><v>${cell.v}</v></c>`
      } else {
        cells += `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(cell.v)}</t></is></c>`
      }
    }
    if (!cells && !h) continue
    x += `<row r="${rn}"${h ? ` ht="${h}" customHeight="1"` : ''}>${cells}</row>`
  }
  x += '</sheetData>'

  if (sh.merges && sh.merges.length) {
    x += `<mergeCells count="${sh.merges.length}">`
    for (const m of sh.merges) x += `<mergeCell ref="${m}"/>`
    x += '</mergeCells>'
  }

  x += '<pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.3" footer="0.3"/>'
  x += '</worksheet>'
  return x
}

// ── 엔트리 포인트 ────────────────────────────────────────────────────────────

/**
 * 시트 목록과 스타일 목록으로 .xlsx 바이너리를 만듭니다.
 *
 * @param sheets 시트 정의 (순서 그대로 탭 순서)
 * @param styles 스타일 정의. 셀의 s 값은 이 배열의 인덱스 + 1 입니다 (0 = 기본).
 */
export function buildXlsx(sheets: XlsxSheet[], styles: XlsxStyle[]): Uint8Array {
  const enc = new TextEncoder()
  const files: { name: string; data: Uint8Array }[] = []
  const add = (name: string, text: string) => files.push({ name, data: enc.encode(text) })

  let ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  ct += '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  ct += '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  ct += '<Default Extension="xml" ContentType="application/xml"/>'
  ct += '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
  ct += '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
  for (let i = 0; i < sheets.length; i++) {
    ct += `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  }
  ct += '</Types>'
  add('[Content_Types].xml', ct)

  let rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  rels += '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  rels += '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
  rels += '</Relationships>'
  add('_rels/.rels', rels)

  let wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  wb += '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
  wb += ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
  for (let i = 0; i < sheets.length; i++) {
    // 시트명 제한: 31자 이내, : \ / ? * [ ] 사용 불가
    const nm = xmlEsc(sheets[i].name.replace(/[:\\\/\?\*\[\]]/g, ' ').substring(0, 31))
    wb += `<sheet name="${nm}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
  }
  wb += '</sheets>'
  // 수식만 넣고 캐시값은 비워두므로, 열 때 전체 재계산을 강제합니다.
  wb += '<calcPr calcId="191029" fullCalcOnLoad="1"/>'
  wb += '</workbook>'
  add('xl/workbook.xml', wb)

  let wbr = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  wbr += '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  for (let i = 0; i < sheets.length; i++) {
    wbr += `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  }
  wbr += `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
  wbr += '</Relationships>'
  add('xl/_rels/workbook.xml.rels', wbr)

  add('xl/styles.xml', buildStyles(styles))
  for (let i = 0; i < sheets.length; i++) {
    add(`xl/worksheets/sheet${i + 1}.xml`, buildSheetXml(sheets[i]))
  }

  return zipStore(files)
}

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
