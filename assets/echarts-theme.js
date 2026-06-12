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

/** markLine ambang standar (DESIGN §5 aturan 2). */
export function markLineAmbang(value, label) {
  return {
    silent: true, symbol: 'none',
    lineStyle: { color: v('--text-4'), type: 'dashed', width: 1 },
    label: { show: true, position: 'insideStartTop', formatter: label, fontSize: 9, color: v('--text-4') },
    data: [{ xAxis: value }],
  };
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
