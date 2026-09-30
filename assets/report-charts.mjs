/*
 * report-charts.mjs — grafik SVG murni untuk laporan sentimen PIMAS.
 *
 * Satu sumber untuk TIGA pemakai: dashboard (innerHTML), PDF (node `{svg}` pdfmake) dan
 * skrip build/tes di Node. Karena itu: tanpa DOM, tanpa library, tanpa canvas, dan
 * berkas ini tinggal di assets/ (yang dilayani situs); `lib/report-charts.mjs` hanya
 * meneruskan ekspornya untuk skrip Node.
 *
 * API utama (kontrak PR-A/B/C):
 *   renderChart(id, detailJson, opts) -> string SVG ('' bila data grafik itu belum ada)
 *   id ∈ CHART_IDS = komposisi, proporsi, tren, topik, fungsi_x_sentimen, waspada, kreator, kebaruan
 *   detailJson = JSON sentimen (memory/sentiment/<slug>.json ATAU detail di payload dashboard).
 *
 * opts:
 *   width  : lebar px (default 640). Dashboard mengisi lebar wadah supaya teks tidak mengecil.
 *   theme  : 'light' (default) | 'dark' | 'css' (var(--token) dashboard, ikut ganti tema)
 *            | objek parsial yang menimpa 'light'. PDF SELALU terang: {font:'PimasDisplay'}.
 *   label  : teks alternatif (aria-label); bila kosong dibangkitkan dari data.
 *   textScale : pengali perkiraan lebar teks (PDF memakai satu font tebal yang lebih lebar).
 *
 * Judul-kesimpulan TIDAK ada di dalam SVG (judulnya ada di markdown); grafik memakai
 * label langsung + angka, tidak bergantung pada warna saja.
 */

export const CHART_IDS = ['komposisi', 'proporsi', 'tren', 'topik', 'fungsi_x_sentimen', 'waspada', 'kreator', 'kebaruan'];

const FONT = "'Bricolage Grotesque', system-ui, sans-serif";

export const THEMES = {
  light: {
    font: FONT, ink: '#141b27', ink2: '#475463', muted: '#5f6e82', line: '#d3dbe5', track: '#e9edf3', surface: '#ffffff',
    accent: '#0e69a7', pos: '#1c8a68', neu: '#a3afbf', neg: '#c8372d', cat: ['#0e69a7', '#4fb3e3', '#8a6fd0', '#b8c2d0'],
  },
  dark: {
    font: FONT, ink: '#f0f3f7', ink2: '#aebac9', muted: '#94a2b3', line: '#2e3845', track: '#26303b', surface: '#181f28',
    accent: '#42addf', pos: '#3fb58f', neu: '#66758a', neg: '#e5665b', cat: ['#42addf', '#8fd0f2', '#a893e0', '#56657a'],
  },
  /* token CSS dashboard (pimas.css: --text-1.. / --rpt-*): ikut ganti tema tanpa gambar ulang */
  css: {
    font: "var(--rpt-font, 'Bricolage Grotesque', system-ui, sans-serif)", ink: 'var(--text-1)', ink2: 'var(--text-2)', muted: 'var(--text-3)',
    line: 'var(--line)', track: 'var(--surface-2)', surface: 'var(--surface-1)', accent: 'var(--accent)',
    pos: 'var(--rpt-pos)', neu: 'var(--rpt-neu)', neg: 'var(--rpt-neg)',
    cat: ['var(--rpt-c1)', 'var(--rpt-c2)', 'var(--rpt-c3)', 'var(--rpt-c4)'],
  },
};
export const DEFAULT_THEME = THEMES.light;

function T(opts) {
  const t = opts && opts.theme;
  const base = typeof t === 'string' ? (THEMES[t] || THEMES.light) : THEMES.light;
  const th = { ...base, ...(t && typeof t === 'object' ? t : {}) };
  th.k = (opts && opts.textScale) || 1;
  return th;
}

/* ------------------------------------------------------------------ util format (id-ID) */
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const pct = (v, d = 0) => (v * 100).toFixed(d).replace('.', ',') + '%';
export const num = (v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/* perkiraan lebar teks (px) — cukup untuk tata letak tanpa DOM */
export const est = (s, size, bold) => String(s).length * size * (bold ? 0.58 : 0.53);

const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function dateShort(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${Number(m[3])} ${BLN[Number(m[2]) - 1] || ''}` : String(iso || '');
}

/* ------------------------------------------------------------------ primitif SVG */
function wrap(text, size, maxW, bold, k) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (est(next, size, bold) * k > maxW && cur) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

function open(w, h, title, th) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" font-family="${esc(th.font)}"><title>${esc(title)}</title>`;
}
const txt = (x, y, s, o = {}) =>
  `<text x="${Math.round(x * 10) / 10}" y="${Math.round(y * 10) / 10}" font-size="${o.size || 13}" font-weight="${o.weight || 500}" fill="${o.fill}" text-anchor="${o.anchor || 'start'}">${esc(s)}</text>`;

function roundRectPath(x, y, w, h, rl, rr) {
  return `M${x + rl},${y} H${x + w - rr} ${rr ? `A${rr},${rr} 0 0 1 ${x + w},${y + rr}` : `L${x + w},${y}`} V${y + h - rr} ${rr ? `A${rr},${rr} 0 0 1 ${x + w - rr},${y + h}` : `L${x + w},${y + h}`} H${x + rl} ${rl ? `A${rl},${rl} 0 0 1 ${x},${y + h - rl}` : `L${x},${y + h}`} V${y + rl} ${rl ? `A${rl},${rl} 0 0 1 ${x + rl},${y}` : `L${x},${y}`} Z`;
}
function segmentsPath(x0, y, w, h, vals, gap, r) {
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  const usable = w - gap * (vals.length - 1);
  let x = x0;
  return vals.map((v, i) => {
    const sw = Math.max(2, (v / total) * usable);
    const seg = { x, w: sw, path: roundRectPath(x, y, sw, h, i === 0 ? r : 0, i === vals.length - 1 ? r : 0) };
    x += sw + gap;
    return seg;
  });
}

/* ------------------------------------------------------------------ 1. stackedBar (komposisi, kreator, kebaruan)
   data: { segments: [{ label, value (0..1), n?, color? }], unitN? } */
export function stackedBar(data, opts = {}) {
  const th = T(opts);
  const w = opts.width || 640;
  const seg = data.segments;
  const barH = 32, top = 4;
  const hasN = seg.some((s) => s.n != null);
  const colors = seg.map((s, i) => (typeof s.color === 'string' ? s.color : th.cat[s.color ?? i] || th.cat[th.cat.length - 1]));
  const shapes = segmentsPath(0, top, w, barH, seg.map((s) => Math.max(s.value, 0)), 2, 8);
  const rows = seg.map((s) => {
    const valTxt = pct(s.value, s.value < 0.1 ? 1 : 0);
    const valW = est(valTxt, 16, true) * th.k;
    return { valTxt, lines: wrap(s.label, 14, w - 20 - valW - 10, false, th.k).slice(0, 2) };
  });
  const rowHs = rows.map((r) => 22 + (r.lines.length - 1) * 16 + (hasN ? 16 : 0) + 8);
  const h = top + barH + 14 + rowHs.reduce((a, b) => a + b, 0);
  const label = opts.label || 'Komposisi: ' + seg.map((s) => `${s.label} ${pct(s.value)}`).join('; ');
  let g = open(w, h, label, th);
  shapes.forEach((sh, i) => { g += `<path d="${sh.path}" fill="${colors[i]}"/>`; });
  let y = top + barH + 30;
  seg.forEach((s, i) => {
    const r = rows[i];
    g += `<rect x="0" y="${y - 11}" width="12" height="12" rx="3" fill="${colors[i]}"/>`;
    r.lines.forEach((ln, k) => { g += txt(20, y + k * 16, ln, { size: 14, fill: th.ink, weight: 500 }); });
    g += txt(w, y, r.valTxt, { size: 16, weight: 700, fill: th.ink, anchor: 'end' });
    if (s.n != null) g += txt(20, y + r.lines.length * 16, `${num(s.n)} ${data.unitN || ''}`.trim(), { size: 12, fill: th.muted });
    y += rowHs[i];
  });
  return g + '</svg>';
}

/* ------------------------------------------------------------------ 2. rangeBars (proporsi)
   data: { rows: [{ label, value, lo?, hi?, tone, note? }], rangeWord? } */
export function rangeBars(data, opts = {}) {
  const th = T(opts);
  const w = opts.width || 640;
  const rows = data.rows;
  const heights = rows.map((r) => (r.lo != null ? 96 : 76));
  const h = heights.reduce((a, b) => a + b, 0) + 6;
  const label = opts.label || 'Proporsi: ' + rows.map((r) => `${r.label} ${pct(r.value)}` + (r.lo != null ? ` (kisaran ${pct(r.lo)} sampai ${pct(r.hi)})` : '')).join('; ');
  let g = open(w, h, label, th);
  let y = 0;
  rows.forEach((r, i) => {
    const fill = th[r.tone] || r.tone;
    g += txt(0, y + 20, r.label, { size: 14.5, weight: 600, fill: th.ink });
    g += txt(w, y + 24, pct(r.value, 0), { size: 26, weight: 700, fill: th.ink, anchor: 'end' });
    const by = y + 34, bh = 14;
    g += `<rect x="0" y="${by}" width="${w}" height="${bh}" rx="7" fill="${th.track}"/>`;
    g += `<path d="${roundRectPath(0, by, Math.max(4, w * r.value), bh, 7, 7)}" fill="${fill}"/>`;
    if (r.lo != null) {
      const x1 = w * r.lo, x2 = w * r.hi, wy = by + bh + 14;
      g += `<path d="M${x1},${by + bh + 2} V${wy} M${x2},${by + bh + 2} V${wy}" stroke="${th.muted}" stroke-width="1" stroke-dasharray="2 2" fill="none"/>`;
      g += `<path d="M${x1},${wy} H${x2} M${x1},${wy - 5} V${wy + 5} M${x2},${wy - 5} V${wy + 5}" stroke="${th.ink}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
      const t = `${data.rangeWord || 'kemungkinan besar antara'} ${pct(r.lo)} dan ${pct(r.hi)}`;
      const mid = (x1 + x2) / 2, tw = est(t, 12.5) * th.k;
      const tx = Math.min(Math.max(mid, tw / 2), w - tw / 2);
      g += txt(tx, wy + 22, t, { size: 12.5, fill: th.ink2, anchor: 'middle' });
    } else if (r.note) {
      g += txt(0, by + bh + 20, r.note, { size: 12.5, fill: th.muted });
    }
    y += heights[i];
  });
  return g + '</svg>';
}

/* ------------------------------------------------------------------ 3. phaseTrend (tren)
   data: { points: [{ label, sub?, value (0..1), lo?, hi? }] } (>= 2 titik). Sumbu 0–100%. */
export function phaseTrend(data, opts = {}) {
  const th = T(opts);
  const w = opts.width || 640;
  const h = opts.height || 210;
  const padL = 40, padR = 16, padT = 30, padB = 46;
  const pw = w - padL - padR, ph = h - padT - padB;
  const pts = data.points;
  const margin = Math.min(70, pw / (pts.length * 2));
  const X = (i) => padL + (pts.length === 1 ? pw / 2 : margin + (i * (pw - 2 * margin)) / (pts.length - 1));
  const Y = (v) => padT + ph * (1 - v);
  const label = opts.label || 'Tren: ' + pts.map((p) => `${p.label} ${pct(p.value, 1)}`).join('; ');
  let g = open(w, h, label, th);
  [0, 0.5, 1].forEach((v) => {
    g += `<line x1="${padL}" x2="${w - padR}" y1="${Y(v)}" y2="${Y(v)}" stroke="${th.line}" stroke-width="1"${v === 0 ? '' : ' stroke-dasharray="3 4"'}/>`;
    g += txt(padL - 8, Y(v) + 4, pct(v), { size: 11.5, fill: th.muted, anchor: 'end' });
  });
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const solid = !a.muted && !b.muted;
    g += `<line x1="${X(i - 1)}" y1="${Y(a.value)}" x2="${X(i)}" y2="${Y(b.value)}" stroke="${solid ? th.pos : th.muted}" stroke-width="${solid ? 2.5 : 1.75}" stroke-linecap="round"${solid ? '' : ' stroke-dasharray="4 5"'}/>`;
  }
  pts.forEach((p, i) => {
    const x = X(i), y = Y(p.value);
    const whisker = !p.muted && p.lo != null && (i === 0 || i === pts.length - 1 || pts.length <= 3);
    if (whisker) g += `<path d="M${x},${Y(p.lo)} V${Y(p.hi)} M${x - 5},${Y(p.lo)} H${x + 5} M${x - 5},${Y(p.hi)} H${x + 5}" stroke="${th.muted}" stroke-width="1.5" fill="none"/>`;
    g += `<circle cx="${x}" cy="${y}" r="6.5" fill="${p.muted ? th.neu : th.pos}" stroke="${th.surface}" stroke-width="2"/>`;
    const top = whisker ? Y(p.hi) : y;
    g += txt(x, Math.max(14, top - 10), pct(p.value, p.value < 0.1 ? 1 : 0), { size: p.muted ? 14 : 16, weight: p.muted ? 600 : 700, fill: p.muted ? th.muted : th.ink, anchor: 'middle' });
    g += txt(x, h - 24, p.label, { size: 13, weight: 600, fill: p.muted ? th.muted : th.ink, anchor: 'middle' });
    const sub = p.muted ? 'awal pengumpulan' : p.sub;
    if (sub) g += txt(x, h - 8, sub, { size: 11.5, fill: th.muted, anchor: 'middle' });
  });
  return g + '</svg>';
}

/* ------------------------------------------------------------------ 4. divergingBars (fungsi_x_sentimen)
   data: { rows: [{ label, neg, neu, pos }] } (jumlah komentar). */
export function divergingBars(data, opts = {}) {
  const th = T(opts);
  const w = opts.width || 640;
  const rows = data.rows;
  const rowH = 78, barH = 18;
  const h = rows.length * rowH + 4;
  const L = Math.max(...rows.map((r) => r.neg + r.neu / 2)) || 1;
  const R = Math.max(...rows.map((r) => r.pos + r.neu / 2)) || 1;
  const sc = (w - 4) / (L + R);
  const cx = 2 + L * sc;
  const label = opts.label || 'Positif, netral, negatif per jenis komentar: ' + rows.map((r) => `${r.label} ${r.pos} positif, ${r.neu} netral, ${r.neg} negatif`).join('; ');
  let g = open(w, h, label, th);
  rows.forEach((r, i) => {
    const y = i * rowH;
    const n = r.neg + r.neu + r.pos;
    g += txt(0, y + 16, r.label, { size: 14, weight: 600, fill: th.ink });
    g += txt(w, y + 16, `${num(n)} komentar`, { size: 12, fill: th.muted, anchor: 'end' });
    const by = y + 26;
    g += `<line x1="${cx}" x2="${cx}" y1="${by - 3}" y2="${by + barH + 3}" stroke="${th.ink2}" stroke-width="1"/>`;
    const negW = r.neg * sc, neuW = r.neu * sc, posW = r.pos * sc;
    const xNeg = cx - neuW / 2 - negW;
    if (r.neg) g += `<path d="${roundRectPath(xNeg, by, Math.max(3, negW) - 1, barH, 4, 0)}" fill="${th.neg}"/>`;
    if (r.neu) g += `<rect x="${cx - neuW / 2}" y="${by}" width="${neuW}" height="${barH}" fill="${th.neu}"/>`;
    if (r.pos) g += `<path d="${roundRectPath(cx + neuW / 2 + 1, by, Math.max(3, posW) - 1, barH, 0, 4)}" fill="${th.pos}"/>`;
    let lx = 0;
    [['pos', r.pos, 'positif'], ['neu', r.neu, 'netral'], ['neg', r.neg, 'negatif']].forEach(([k, v, name]) => {
      if (!v) return;
      const t = `${v} ${name}`;
      g += `<rect x="${lx}" y="${by + barH + 10}" width="9" height="9" rx="2.5" fill="${th[k]}"/>`;
      g += txt(lx + 14, by + barH + 19, t, { size: 12.5, fill: th.ink2 });
      lx += 14 + est(t, 12.5) * th.k + 14;
    });
  });
  return g + '</svg>';
}

/* ------------------------------------------------------------------ 5. barSimple (topik, waspada)
   data: { rows: [{ label, value, highlight?, color? }], max?, format? } */
export function barSimple(data, opts = {}) {
  const th = T(opts);
  const w = opts.width || 640;
  const rows = data.rows;
  const barH = 12;
  const max = data.max || Math.max(...rows.map((r) => r.value)) || 1;
  const fmt = data.format || ((v) => num(v));
  const valCol = 64;
  const bw = w - valCol;
  const color = opts.color || th.accent;
  const lines = rows.map((r) => wrap(r.label, 13.5, w - valCol - 8, r.highlight, th.k).slice(0, 2));
  const rowHs = lines.map((l) => 44 + (l.length - 1) * 16);
  const h = rowHs.reduce((a, b) => a + b, 2);
  const label = opts.label || 'Bar: ' + rows.map((r) => `${r.label} ${fmt(r.value)}`).join('; ');
  let g = open(w, h, label, th);
  let y = 0;
  rows.forEach((r, i) => {
    lines[i].forEach((ln, k) => { g += txt(0, y + 15 + k * 16, ln, { size: 13.5, weight: r.highlight ? 700 : 500, fill: th.ink }); });
    const by = y + 23 + (lines[i].length - 1) * 16;
    g += `<rect x="0" y="${by}" width="${bw}" height="${barH}" rx="6" fill="${th.track}"/>`;
    g += `<path d="${roundRectPath(0, by, Math.max(4, (r.value / max) * bw), barH, 6, 6)}" fill="${r.highlight === false ? th.neu : (r.color ? th[r.color] || r.color : color)}"/>`;
    g += txt(w, by + 11, fmt(r.value), { size: 15, weight: 700, fill: th.ink, anchor: 'end' });
    y += rowHs[i];
  });
  return g + '</svg>';
}

export const CHARTS = { stackedBar, rangeBars, phaseTrend, divergingBars, barSimple };

/* ================================================================== DATA GRAFIK (dari JSON)
   Semua angka dibaca dari JSON; field yang belum ada -> fallback jujur atau null (grafik dilepas). */

const TOPIK_AWAM = {
  rasa: 'Rasa', manfaat: 'Manfaat secara umum', tekstur: 'Tekstur', harga: 'Harga', kemasan: 'Kemasan', aroma: 'Aroma',
  bahan: 'Bahan', warna: 'Warna', porsi: 'Porsi', 'manfaat-kesehatan': 'Manfaat kesehatan (klaim)', 'keamanan-produk': 'Efek ke perut dan keamanan',
  'cara-minum': 'Cara minum', 'edukasi-cara-pakai': 'Pertanyaan cara konsumsi', 'gula-aren': 'Gula aren', 'daun-kelor': 'Daun kelor',
  'bahan-daun-kelor': 'Daun kelor', 'bahan-gula': 'Gula', gula: 'Gula', 'tekstur-serbuk': 'Tekstur serbuk', ketersediaan: 'Ketersediaan', pengiriman: 'Pengiriman',
};
export function topikAwam(id, labelAwam) {
  if (typeof labelAwam === 'string' && labelAwam.trim()) return labelAwam.trim();
  const k = String(id || '').trim();
  if (TOPIK_AWAM[k]) return TOPIK_AWAM[k];
  const s = k.replace(/[-_]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

export const FUNGSI_AWAM = {
  testimoni: 'Cerita pengalaman memakai', advokasi: 'Merekomendasikan ke orang lain', tips_saran: 'Tips dan saran',
  keluhan: 'Keluhan', perbandingan: 'Membandingkan dengan produk lain',
};

const get = (o, path) => path.split('.').reduce((a, k) => (a && typeof a === 'object' ? a[k] : undefined), o);

/* ringkasan komposisi dasar dipakai chartData + pembangun laporan */
export function opinionOf(d) {
  const op = get(d, 'stats.opinion');
  if (!op || !op.composition || !op.among_opinions) return null;
  return op;
}

function polar(cells, col) {
  const f = (row) => ((cells.find((c) => c.row === row && c.col === col) || {}).n) || 0;
  return { pos: f('pos'), neu: f('neu'), neg: f('neg') };
}

/* baris topik ber-jumlah: PR-A stats.aspects.by_topic bila ada, jika tidak gabungan field lama. */
export function topicRows(d) {
  const by = get(d, 'stats.aspects.by_topic');
  if (Array.isArray(by) && by.length) {
    const lt = get(d, 'insights.narasi.label_topik') || {};
    return by.filter((t) => t && isNum(t.n) && t.n > 0)
      .map((t) => ({ id: t.topik, label: topikAwam(t.topik, t.label_awam || lt[t.topik]), n: t.n, pos: t.pos, neu: t.neu, neg: t.neg, contoh: t.contoh || null }))
      .sort((a, b) => b.n - a.n);
  }
  const map = new Map();
  const put = (id, n) => { if (id && isNum(n) && n > 0) map.set(id, Math.max(map.get(id) || 0, n)); };
  const th = get(d, 'stats.themes') || {};
  [...(th.top_praises || []), ...(th.top_complaints || []), ...(th.suppressed_low_support || [])].forEach((t) => t && put(t.label, t.mention_count));
  (get(d, 'insights.depth.konten_peluang') || []).forEach((k) => {
    if (!k) return;
    const n = isNum(k.n) ? k.n : Number(String(k.dasar || '').match(/\d+/)?.[0]);
    put(k.tema, n);
  });
  return [...map].map(([id, n]) => ({ id, label: topikAwam(id), n })).sort((a, b) => b.n - a.n);
}

const WASPADA_RE = /kesehatan|keamanan|harga|efek|alergi|bpom|halal|palsu|kadaluarsa|basi|mahal|mual|perut/;
export function waspadaRows(d) {
  const rows = [];
  const seen = new Set();
  const add = (id, label, n) => { if (isNum(n) && n > 0 && !seen.has(id)) { seen.add(id); rows.push({ id, label, value: n }); } };
  const op = opinionOf(d);
  const kel = op && (op.composition.by_function || []).find((f) => f.fungsi === 'keluhan');
  if (kel) add('keluhan', 'Berisi keluhan', kel.n);
  const th = get(d, 'stats.themes') || {};
  [...(th.top_complaints || []), ...(th.suppressed_low_support || [])].forEach((t) => {
    if (t && (WASPADA_RE.test(String(t.label)) || (th.top_complaints || []).includes(t))) add(t.label, topikAwam(t.label), t.mention_count);
  });
  (get(d, 'insights.depth.watch_items') || []).forEach((w) => w && WASPADA_RE.test(String(w.tema)) && add(w.tema, topikAwam(w.tema), w.mention));
  /* kategori "curiga klaim atau iklan" (S6b0: insights.curiga_klaim, dihitung dari SEMUA komentar); satu sumber data untuk grafik, kartu, contoh */
  const cg = get(d, 'insights.curiga_klaim');
  if (cg && cg.v === 1) add('curiga-klaim', 'Curiga klaim atau iklan', cg.n);
  rows.sort((a, b) => b.value - a.value);
  return rows.slice(0, 5);
}

/* Klaim naik/turun hanya boleh antar titik yang SEBANDING: n_opini >= TREND_MIN_N dan (bila titik membawa
   `coverage`) coverage >= TREND_MIN_COVERAGE. Titik lain (sumber "arah", pembacaan awal yang kecil) tetap
   digambar tetapi abu-abu ("awal pengumpulan") dan tak boleh dijadikan dasar kalimat naik/turun. */
export const TREND_MIN_N = 150;
export const TREND_MIN_COVERAGE = 0.7;

/* -> { points:[{label,sub,value,lo,hi,neg,n,coverage,comparable,muted}], cmp:[indeks sebanding], stable } | null */
export function trendInfo(d) {
  const op = opinionOf(d);
  if (!op) return null;
  const am = op.among_opinions;
  const hist = Array.isArray(op.history) ? op.history.filter((h) => h && isNum(h.pos)) : [];
  let raw = null;
  if (hist.length >= 2) {
    raw = hist.slice(-4).map((h, i, arr) => ({
      label: h.date ? dateShort(h.date) : (i === arr.length - 1 ? 'Sekarang' : 'Sebelumnya'),
      sub: isNum(h.n_opini) ? `${num(h.n_opini)} opini` : undefined,
      value: h.pos,
      lo: isNum(h.pos_lo) ? h.pos_lo : undefined, hi: isNum(h.pos_hi) ? h.pos_hi : undefined,
      neg: isNum(h.neg) ? h.neg : undefined, n: isNum(h.n_opini) ? h.n_opini : undefined,
      coverage: isNum(h.coverage) ? h.coverage : undefined,
    }));
  } else {
    const prev = get(d, 'provenance.opini.arah.p_prev');
    if (isNum(prev) && isNum(am.pos_raw)) {
      raw = [
        { label: 'Sebelumnya', value: prev },
        { label: 'Sekarang', sub: `${num(am.n)} opini`, value: am.pos_raw, lo: am.wilson_pos && am.wilson_pos.lo, hi: am.wilson_pos && am.wilson_pos.hi, neg: am.neg_raw, n: am.n },
      ];
    }
  }
  if (!raw) return null;
  const points = raw.map((p) => {
    const comparable = isNum(p.n) && p.n >= TREND_MIN_N && (p.coverage == null || p.coverage >= TREND_MIN_COVERAGE);
    return { ...p, comparable, muted: !comparable };
  });
  const cmp = points.map((p, i) => (p.comparable ? i : -1)).filter((i) => i >= 0);
  return { points, cmp, stable: get(d, 'provenance.opini.arah.status') === 'stabil' };
}
export function trendPoints(d) {
  const t = trendInfo(d);
  return t ? t.points : null;
}

/* id -> { fn, data } ; null bila data grafik belum ada */
export function chartSpec(id, d) {
  if (!d || typeof d !== 'object') return null;
  const op = opinionOf(d);
  const rep = op && op.representativeness;
  switch (id) {
    case 'komposisi': {
      if (!op) return null;
      const c = op.composition, fn = Object.fromEntries((c.by_function || []).map((f) => [f.fungsi, f]));
      if (!isNum(c.n) || !c.n || !isNum(c.opinion_n)) return null;
      const niat = (fn.niat_beli && fn.niat_beli.n) || 0, tanya = (fn.pertanyaan && fn.pertanyaan.n) || 0;
      const other = Math.max(0, c.n - c.opinion_n - niat - tanya);
      return { fn: 'stackedBar', data: { unitN: 'komentar', segments: [
        { label: 'Berisi pendapat (cerita, saran, keluhan)', value: c.opinion_n / c.n, n: c.opinion_n, color: 0 },
        { label: 'Bilang mau coba atau mau beli', value: niat / c.n, n: niat, color: 1 },
        { label: 'Bertanya', value: tanya / c.n, n: tanya, color: 2 },
        { label: 'Sapaan, humor, dan lainnya', value: other / c.n, n: other, color: 3 },
      ] } };
    }
    case 'proporsi': {
      if (!op) return null;
      const a = op.among_opinions;
      if (![a.pos_raw, a.neu_raw, a.neg_raw].every(isNum)) return null;
      return { fn: 'rangeBars', data: { rows: [
        { label: 'Suka (positif)', value: a.pos_raw, lo: a.wilson_pos && a.wilson_pos.lo, hi: a.wilson_pos && a.wilson_pos.hi, tone: 'pos' },
        { label: 'Biasa saja (netral)', value: a.neu_raw, tone: 'neu', note: 'Tanpa kisaran; ini sisa dari dua angka lain.' },
        { label: 'Tidak suka (negatif)', value: a.neg_raw, lo: a.wilson_neg && a.wilson_neg.lo, hi: a.wilson_neg && a.wilson_neg.hi, tone: 'neg' },
      ].map((r) => (r.lo == null || r.hi == null ? { ...r, lo: undefined, hi: undefined } : r)) } };
    }
    case 'tren': {
      const t = trendInfo(d);
      /* ada dasar bicara: >= 2 titik sebanding, atau pipeline menilai arah stabil */
      if (!t || t.points.length < 2 || !(t.cmp.length >= 2 || t.stable)) return null;
      return { fn: 'phaseTrend', data: { points: t.points } };
    }
    case 'topik': {
      const rows = topicRows(d).slice(0, 6);
      if (rows.length < 2) return null;
      return { fn: 'barSimple', data: { rows: rows.map((r, i) => ({ label: r.label, value: r.n, highlight: i < 2 ? true : undefined })) } };
    }
    case 'fungsi_x_sentimen': {
      const cells = get(d, 'stats.overall.cross_tab.sentiment_x_function.cells');
      if (!Array.isArray(cells) || !cells.length) return null;
      const rows = Object.keys(FUNGSI_AWAM).map((k) => ({ label: FUNGSI_AWAM[k], ...polar(cells, k) })).filter((r) => r.pos + r.neu + r.neg >= 3);
      return rows.length >= 2 ? { fn: 'divergingBars', data: { rows } } : null;
    }
    case 'waspada': {
      const rows = waspadaRows(d);
      return rows.length ? { fn: 'barSimple', data: { rows }, color: 'neg' } : null;
    }
    case 'kreator': {
      if (!rep || !isNum(rep.top3_creator_share) || !isNum(rep.n_creators)) return null;
      const s = rep.top3_creator_share;
      return { fn: 'stackedBar', data: { segments: [
        { label: '3 kreator teratas', value: s, color: 0 },
        { label: `${num(Math.max(0, rep.n_creators - 3))} kreator lainnya`, value: 1 - s, color: 3 },
      ] } };
    }
    case 'kebaruan': {
      if (!rep || !isNum(rep.share_last_90d)) return null;
      return { fn: 'stackedBar', data: { segments: [
        { label: '90 hari terakhir', value: rep.share_last_90d, color: 0 },
        { label: 'Lebih lama', value: 1 - rep.share_last_90d, color: 3 },
      ] } };
    }
    default:
      return null;
  }
}

/* id + JSON -> SVG (string kosong bila data grafik itu belum ada; tak pernah throw) */
export function renderChart(id, detailJson, opts = {}) {
  let spec = null;
  try { spec = chartSpec(id, detailJson); } catch { spec = null; }
  if (!spec) return '';
  const o = { ...opts };
  if (spec.color && !o.color) o.color = T(o)[spec.color];
  try {
    return CHARTS[spec.fn](spec.data, o);
  } catch {
    return '';
  }
}

/* penanda `<!--chart:id-->` di markdown -> daftar id (urut kemunculan) */
export function chartMarkers(md) {
  const out = [];
  String(md || '').replace(/<!--\s*chart:([a-z_]+)\s*-->/g, (m, id) => { out.push(id); return m; });
  return out;
}
