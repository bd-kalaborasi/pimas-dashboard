/*
 * PIMAS dashboard v3 — echarts-theme.js (ES module)
 * Adaptasi DESIGN.md §5: theme 'pimas' dibangun dari CSS custom properties saat
 * runtime, di-registrasi ulang setiap toggle tema (charts dispose + event
 * `pimas:recharts` supaya view render ulang chart-nya). Registry resize global.
 * ECharts dimuat via CDN (UMD, window.echarts) — bila gagal, semua helper jadi
 * no-op dan view merender .chart-fallback (DESIGN §5.5).
 */

function v(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const MONO = "'IBM Plex Mono', monospace";
const BODY = "'Figtree', system-ui, sans-serif";

export function chartsAvailable() {
  return typeof window.echarts !== 'undefined';
}

export function registerPimasTheme() {
  if (!chartsAvailable()) return;
  window.echarts.registerTheme('pimas', {
    /* chartSeries Palet B (Cool Slate): seri 1 = biru brand terang (--chart);
       sisanya biru brand deep / biru-sedang / teal / indigo / slate. Token
       --chart-2..6 di-set per tema (light/dark) di pimas.css, jadi array ini
       otomatis re-theme saat toggle dark (registry membaca CSS vars saat re-register).
       --accent (biru brand deep interaksi) bukan seri data. */
    color: [v('--chart'), v('--chart-2'), v('--chart-3'), v('--chart-4'), v('--chart-5'), v('--chart-6')],
    backgroundColor: 'transparent',
    textStyle: { fontFamily: BODY, color: v('--text-2'), fontSize: 12 },
    title: { show: false }, /* judul chart = elemen HTML (kalimat takeaway), bukan title ECharts */
    legend: {
      bottom: 0, icon: 'circle', itemWidth: 8,
      textStyle: { color: v('--text-3'), fontSize: 11, fontFamily: BODY },
    },
    tooltip: {
      backgroundColor: v('--surface-1'), borderColor: v('--line-soft'), borderWidth: 1,
      padding: [10, 14],
      textStyle: { color: v('--text-1'), fontFamily: BODY, fontSize: 12 },
      extraCssText: 'border-radius:8px;box-shadow:none;',
    },
    categoryAxis: {
      axisLine: { lineStyle: { color: v('--line-soft') } }, axisTick: { show: false },
      axisLabel: { color: v('--text-3'), fontFamily: MONO, fontSize: 10.5 },
      splitLine: { show: false },
    },
    valueAxis: {
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: v('--text-4'), fontFamily: MONO, fontSize: 10.5 },
      splitLine: { lineStyle: { color: v('--line-soft'), opacity: 0.6 } },
    },
    bar: { itemStyle: { borderRadius: [0, 3, 3, 0] } },
    line: { symbol: 'circle', symbolSize: 6, lineStyle: { width: 2 } },
  });
}

/* registry chart hidup — untuk resize global & re-theme saat toggle tema */
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let charts = [];

export const PIMAS_ANIM = { animation: !REDUCED, animationDuration: 500, animationEasing: 'cubicOut' };

/** Init chart ber-theme pimas; null bila CDN ECharts gagal (view render fallback). */
export function pimasInit(el) {
  if (!chartsAvailable() || !el) return null;
  const c = window.echarts.init(el, 'pimas');
  charts.push(c);
  return c;
}

/** Token warna runtime untuk seri chart (dipanggil ulang tiap render). */
export function chartTokens() {
  return {
    chart: v('--chart'), accent: v('--accent'), warn: v('--warn-fg'), ok: v('--ok-fg'),
    track: v('--surface-2'), line: v('--line-soft'), text1: v('--text-1'),
    text2: v('--text-2'), text3: v('--text-3'), text4: v('--text-4'), card: v('--surface-1'),
    mono: MONO, body: BODY,
  };
}

/**
 * markLine ambang standar (DESIGN §5 aturan 2).
 * axis: 'xAxis' (default — bar horizontal, ambang vertikal di nilai-x) atau
 * 'yAxis' (sparkline deret-waktu, ambang HORIZONTAL di nilai-y). Pemanggil 2-arg
 * lama tidak berubah (default xAxis).
 */
export function markLineAmbang(value, label, axis = 'xAxis') {
  return {
    silent: true, symbol: 'none',
    lineStyle: { color: v('--text-4'), type: 'dashed', width: 1 },
    label: { show: true, position: 'insideStartTop', formatter: label, fontSize: 9, color: v('--text-4') },
    data: [axis === 'yAxis' ? { yAxis: value } : { xAxis: value }],
  };
}

/* hex #rrggbb + alpha → #rrggbbaa untuk areaStyle gradient sparkline (fallback: opaque). */
function hexA(hex, a) {
  const h = String(hex).trim();
  if (/^#[0-9a-f]{6}$/i.test(h)) {
    return h + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
  }
  return h;
}

/**
 * §1.2 — sparkline deret-waktu (kiri=lama→kanan=baru). values: number[], `null`=gap
 * (connectNulls:false, TIDAK dipaksa 0). opts:{ ambang, ambangLabel='ambang {n}',
 * labelPoints=(len<=3), color=--chart, area=true, formatPoint=String }.
 * Pemanggil WAJIB bungkus role="img" + aria-label berisi SELURUH deret + ambang.
 */
export function sparkline(el, values, opts = {}) {
  const c = pimasInit(el);
  if (!c) return null;
  const tok = chartTokens();
  const color = opts.color || tok.chart;
  const arr = Array.isArray(values) ? values : [];
  const labelPoints = (opts.labelPoints !== undefined) ? opts.labelPoints : (arr.length <= 3);
  const fp = opts.formatPoint || ((x) => String(x));
  const series = {
    type: 'line', data: arr, connectNulls: false,
    showSymbol: labelPoints, symbol: 'circle', symbolSize: 5,
    lineStyle: { width: 2, color }, itemStyle: { color },
    label: labelPoints
      ? { show: true, position: 'top', fontFamily: MONO, fontSize: 10.5, color: tok.text3, formatter: (p) => (p.value == null ? '' : fp(p.value)) }
      : { show: false },
  };
  if (opts.area !== false) {
    series.areaStyle = { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
      colorStops: [{ offset: 0, color: hexA(color, 0.18) }, { offset: 1, color: hexA(color, 0) }] } };
  }
  if (typeof opts.ambang === 'number') {
    series.markLine = markLineAmbang(opts.ambang, opts.ambangLabel || ('ambang ' + opts.ambang), 'yAxis');
  }
  c.setOption({
    ...PIMAS_ANIM,
    grid: { left: 2, right: 2, top: labelPoints ? 16 : 6, bottom: 4, containLabel: false },
    xAxis: { type: 'category', show: false, boundaryGap: false, data: arr.map((_, i) => i) },
    yAxis: { type: 'value', show: false, scale: true },
    tooltip: { show: false },
    series: [series],
  });
  return c;
}

/**
 * §1.2 — bar horizontal ranked (rank-1 atas). rows: {label, value:number|null, sub?, weak?}.
 * value===null → bar 0 + label '—' (BUKAN 0 bermakna). opts:{ ambang, ambangLabel, max,
 * colorRule=(r)=>r.weak?warn:chart, gridLeft, barWidth=13, track=false, formatValue }.
 * Pemanggil WAJIB aria-label berisi SELURUH pasang label+value (+ambang).
 */
export function barRanked(el, rows, opts = {}) {
  const c = pimasInit(el);
  if (!c) return null;
  const tok = chartTokens();
  const list = Array.isArray(rows) ? rows : [];
  const colorRule = opts.colorRule || ((r) => (r.weak ? tok.warn : tok.chart));
  const numOf = (r) => (r.value == null ? 0 : r.value);
  const maxVal = opts.max || Math.max(1, ...list.map(numOf));
  const series = [{
    type: 'bar', barWidth: opts.barWidth || 13, silent: true,
    data: list.map((r) => ({ value: numOf(r), itemStyle: { color: colorRule(r) } })),
    label: {
      show: true, position: 'right', fontFamily: MONO, fontSize: 11, color: tok.text2,
      formatter: (p) => {
        const r = list[p.dataIndex];
        if (!r || r.value == null) return '—';
        const val = opts.formatValue ? opts.formatValue(r.value) : String(r.value);
        return val + (r.sub ? ' · ' + r.sub : '');
      },
    },
  }];
  if (opts.track) {
    series[0].stack = 'r';
    series.push({
      type: 'bar', barWidth: opts.barWidth || 13, silent: true, stack: 'r',
      itemStyle: { color: tok.track, borderRadius: [0, 3, 3, 0] }, label: { show: false },
      data: list.map((r) => maxVal - numOf(r)),
    });
  }
  if (typeof opts.ambang === 'number') {
    series[0].markLine = markLineAmbang(opts.ambang, opts.ambangLabel || ('ambang ' + opts.ambang));
  }
  c.setOption({
    ...PIMAS_ANIM, animationDelay: (i) => i * 80,
    grid: { left: opts.gridLeft || 8, right: 60, top: 4, bottom: 4, containLabel: true },
    tooltip: { show: false },
    xAxis: { type: 'value', show: false, max: opts.track ? maxVal : (opts.max || null) },
    yAxis: {
      type: 'category', inverse: true, data: list.map((r) => r.label),
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: tok.text2, fontFamily: tok.body, fontSize: 12, fontWeight: 600 },
    },
    series,
  });
  return c;
}

export function disposeAllCharts() {
  charts.forEach((c) => { try { c.dispose(); } catch { /* sudah hilang */ } });
  charts = [];
}

if (chartsAvailable()) registerPimasTheme();

/* re-theme saat html.class berubah (toggle dark) → view render ulang chart-nya */
new MutationObserver((muts) => {
  for (const m of muts) {
    if (m.attributeName !== 'class') continue;
    disposeAllCharts();
    registerPimasTheme();
    document.dispatchEvent(new CustomEvent('pimas:recharts'));
    break;
  }
}).observe(document.documentElement, { attributes: true });

window.addEventListener('resize', () => {
  charts.forEach((c) => { try { c.resize(); } catch { /* abaikan */ } });
});
