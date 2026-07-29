/** @type {import('tailwindcss').Config} */
// 빌드 타임 Tailwind 설정.
// 기존 cdn.tailwindcss.com 인라인 config(brand 팔레트 + Pretendard fontFamily)를
// 그대로 이식했습니다. 값이 바뀌면 시각 회귀가 발생하므로 임의로 수정하지 마세요.
module.exports = {
  content: [
    './src/**/*.{ts,tsx}',
    './public/static/app.js',
  ],
  // ⚠️ safelist: app.js가 런타임에 문자열 결합으로 만드는 클래스는
  // Tailwind 정적 스캐너가 감지하지 못합니다. 반드시 유지해야 합니다.
  // 출처(app.js): 6118-6119, 6166-6167, 6681, 7411, 8147 라인
  //   - 'bg-' + color + '-500' 형태의 타임라인 필터 버튼
  //   - 'bg-' + c + '-50 border-' + c + '-200 text-' + c + '-700' 미팅 카드
  //   - 'bg-' + s.color + '-100 ... ring-' + s.color + '-300' 파이프라인 단계 버튼
  safelist: [
    {
      // 동적 조합에 등장하는 색상 전체 (typeMeta / tc / stages 정의에서 추출)
      pattern: /^(bg|text|border|ring)-(blue|violet|emerald|sky|rose|amber|indigo|slate|brand)-(50|100|200|300|500|700)$/,
      variants: ['hover'],
    },
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Pretendard', 'Inter', '-apple-system', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#d9e6ff',
          200: '#bcd2ff',
          300: '#8eb5ff',
          400: '#598eff',
          500: '#2563eb',
          600: '#1d4ed8',
          700: '#1e40af',
          800: '#1e3a8a',
          900: '#102d92',
        },
      },
    },
  },
  plugins: [],
}
