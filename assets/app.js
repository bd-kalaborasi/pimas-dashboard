/*
 * PIMAS dashboard v3 — app.js (ES module)
 * Bootstrap, loader strings/glossary, helper t()/fmt (id-ID, DESIGN §9),
 * alur login (unwrapDeks → fetch blob → decryptBlob), sesi tab (DEK raw di
 * sessionStorage — TIDAK PERNAH password), router hash nested (KONTRAK §1),
 * shell nav dua seksi + gating plane OPERASIONAL via kepemilikan DEK ops,
 * drawer/toast/tooltip/empty-state/count-up untuk dipakai semua view.
 *
 * Tidak ada data riset hardcoded — semua dari payload terdekripsi.
 * Semua teks UI via t('key') dari content/strings.json (pemilik: uiux-writer).
 */

import { unwrapDeks, decryptBlob } from './crypt.js';
import {
  pimasInit, PIMAS_ANIM, chartsAvailable, chartTokens, markLineAmbang, disposeAllCharts,
  sparkline, barRanked,
} from './echarts-theme.js';
import * as vBeranda from './views/beranda.js';
import * as vPeluang from './views/peluang.js';
import * as vPeluangDetail from './views/peluang-detail.js';
import * as vLaporan from './views/laporan.js';
import * as vTentang from './views/tentang.js';
import * as vOpsPipeline from './views/ops-pipeline.js';
import * as vOpsAgen from './views/ops-agen.js';
import * as vOpsKesehatan from './views/ops-kesehatan.js';
import * as vSentimen from './views/sentimen.js';

/* ============================================================
   Konfigurasi pipeline (BUKAN data riset — parameter metodologi PIMAS;
   idealnya ikut payload — tercatat sebagai kebutuhan data ke backend-dev)
   ============================================================ */
const AMBANG_LAPOR = 60; /* ambang Skor Peluang untuk status "dilaporkan" */
const SCORE_WEIGHTS = { w1: 25, w2: 20, w3: 20, w4: 20, w5: 15 }; /* bobot formula skor (DESIGN §5) */

const CDN_MARKED = 'https://cdn.jsdelivr.net/npm/marked@12.0.2/lib/marked.esm.js';
const CDN_DOMPURIFY = 'https://cdn.jsdelivr.net/npm/dompurify@3.1.7/dist/purify.es.mjs';

/* ============================================================
   Util dasar
   ============================================================ */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function fetchJSON(paths) {
  let lastErr = null;
  for (const p of paths) {
    try {
      const r = await fetch(p, { cache: 'no-store' });
      if (r.ok) return await r.json();
      lastErr = new Error('HTTP ' + r.status);
    } catch (e) { lastErr = e; }
  }
  const err = new Error('NO_DATA');
  err.code = 'NO_DATA';
  err.cause = lastErr;
  throw err;
}

/* ============================================================
   Strings (t) + glossary
   ============================================================ */
let STRINGS = {};
let GLOSSARY = [];
const missingKeys = new Set();

function lookup(obj, key) {
  return key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

function interpolate(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/**
 * t(key, vars) — string UI dari strings.json. Key hilang → fallback key-name
 * (sementara, dilaporkan ke uiux-writer via window.__pimasMissingStrings).
 * Arg ke-3 (fallback) HANYA untuk copy yang sudah diratifikasi verbatim di
 * DESIGN.md/v2 — tetap tercatat sebagai key yang harus dimiliki uiux-writer.
 */
export function t(key, vars, fallback) {
  const val = lookup(STRINGS, key);
  if (typeof val === 'string') return interpolate(val, vars);
  if (!missingKeys.has(key)) {
    missingKeys.add(key);
    window.__pimasMissingStrings = [...missingKeys];
    console.warn('[pimas] string key hilang:', key);
  }
  return fallback !== undefined ? interpolate(fallback, vars) : key;
}

function glossaryFind(term) {
  const q = String(term).trim().toLowerCase();
  return GLOSSARY.find((g) =>
    g.term.toLowerCase() === q || (g.alias || []).some((a) => a.toLowerCase() === q)) || null;
}

let ttSeq = 0;
/** §4.22 — istilah ber-tooltip (hover/focus/tap), definisi dari glossary/strings. */
export function ttSpan(label, definition) {
  const def = definition || (glossaryFind(label) || {}).definisi;
  if (!def) return esc(label);
  const id = 'tt-' + (++ttSeq);
  return `<span class="tt" tabindex="0" aria-describedby="${id}">${esc(label)}<span class="tt-panel" role="tooltip" id="${id}">${esc(def)}</span></span>`;
}

/* ============================================================
   Format angka & tanggal Indonesia (DESIGN §9)
   ============================================================ */
const nfID = new Intl.NumberFormat('id-ID');
const MINUS = '−';

function mnum(s) { return String(s).replace(/-/g, MINUS); }

function compactNum(n) {
  const abs = Math.abs(n);
  let div = 1; let unit = '';
  if (abs >= 1e12) { div = 1e12; unit = 'T'; }
  else if (abs >= 1e9) { div = 1e9; unit = 'M'; }
  else if (abs >= 1e6) { div = 1e6; unit = 'jt'; }
  if (!unit) return nfID.format(n);
  const x = n / div;
  /* ≤2 desimal: <10 → 2 desimal (mis. 1,10 T); <100 → 1; ≥100 → bulat (141 M) */
  const dec = Math.abs(x) < 10 ? 2 : (Math.abs(x) < 100 ? 1 : 0);
  return x.toLocaleString('id-ID', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + ' ' + unit;
}

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function toDate(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).length <= 10 ? iso + 'T00:00:00Z' : iso);
  return isNaN(d.getTime()) ? null : d;
}

export const fmt = {
  int(n) { return (n === null || n === undefined || isNaN(n)) ? t('umum.kosong') : mnum(nfID.format(n)); },
  dec(n, d = 1) {
    if (n === null || n === undefined || isNaN(n)) return t('umum.kosong');
    return mnum(n.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: d }));
  },
  compact(n) { return (n === null || n === undefined || isNaN(n)) ? t('umum.kosong') : mnum(compactNum(n)); },
  rp(n) { return (n === null || n === undefined || isNaN(n)) ? t('umum.kosong') : 'Rp' + mnum(compactNum(n)); },
  persen(n, sign) {
    if (n === null || n === undefined || isNaN(n)) return t('umum.kosong');
    const s = sign && n > 0 ? '+' : '';
    return mnum(s + n.toLocaleString('id-ID', { maximumFractionDigits: 1 }) + '%');
  },
  delta(n) {
    if (n === null || n === undefined || isNaN(n)) return t('umum.kosong');
    return mnum((n > 0 ? '+' : '') + nfID.format(n));
  },
  /* "11 Jun 2026" (UI) — zona WIB */
  tanggal(iso) {
    const d = toDate(iso);
    if (!d) return t('umum.kosong');
    try {
      const p = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric' })
        .format(d).replace(/\./g, '');
      return p;
    } catch { return String(iso); }
  },
  /* "11 Jun 2026 09.44 WIB" untuk stamp */
  tanggalWaktu(iso) {
    const d = toDate(iso);
    if (!d) return t('umum.kosong');
    try {
      const tgl = fmt.tanggal(iso);
      const jam = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false })
        .format(d).replace(':', '.');
      return `${tgl} ${jam} WIB`;
    } catch { return String(iso); }
  },
  /* ISO untuk lapisan mono/ref */
  tanggalISO(iso) {
    const d = toDate(iso);
    return d ? d.toISOString().slice(0, 10) : t('umum.kosong');
  },
  /* skor "74<small>/100</small>" — html */
  skor(wps) {
    if (wps === null || wps === undefined) return null;
    return `${esc(fmt.int(wps))}<small>${esc(t('peluang.skor.satuan'))}</small>`;
  },
  /*
   * Durasi relatif — unit hari/jam/menit diisi frontend sesuai konvensi slot
   * {kapan} di strings.json _meta ("mis. 'dalam 2 hari'").
   */
  durasi(ms) {
    if (ms === null || ms === undefined || isNaN(ms) || ms <= 0) return null;
    const mnt = Math.floor(ms / 60000);
    const d = Math.floor(mnt / 1440);
    const h = Math.floor((mnt % 1440) / 60);
    const m = mnt % 60;
    if (d > 0) return { n1: d, u1: 'hari', n2: h, u2: 'jam' };
    if (h > 0) return { n1: h, u1: 'jam', n2: m, u2: 'menit' };
    return { n1: Math.max(m, 1), u1: 'menit', n2: null, u2: null };
  },
  /*
   * Label pekan ramah-manusia dari kode ISO "YYYY-Www" (mis. "2026-W24").
   * Deterministik, tidak mengarang: hanya memformat ulang kode yang ada.
   * Disisipkan ke template "Minggu {minggu}" → "Minggu ke-24 2026".
   * Bila format tak dikenali, kembalikan apa adanya (tanpa menebak).
   */
  minggu(week) {
    const s = String(week || '').trim();
    const m = s.match(/^(\d{4})-?W(\d{1,2})$/i);
    if (!m) return s || t('umum.kosong');
    return `ke-${parseInt(m[2], 10)} ${m[1]}`;
  },
};

/** Parse tanggal Indonesia di teks bebas payload, mis. "17 Okt 2026" → Date (WIB). */
export function parseTanggalIndo(text) {
  const m = String(text || '').match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agu|Sep|Okt|Nov|Des)[a-z]*\.?\s+(\d{4})/i);
  if (!m) return null;
  const bln = BULAN.findIndex((b) => b.toLowerCase() === m[2].slice(0, 3).toLowerCase());
  if (bln < 0) return null;
  const d = new Date(Date.UTC(parseInt(m[3], 10), bln, parseInt(m[1], 10), -7)); /* 00:00 WIB */
  return isNaN(d.getTime()) ? null : { date: d, label: `${parseInt(m[1], 10)} ${BULAN[bln]} ${m[3]}` };
}

/* ============================================================
   Cron util (semantik UTC — GitHub Actions) — untuk plane ops
   ============================================================ */
function cronFieldSet(spec, min, max) {
  const out = new Set();
  for (const partRaw of String(spec).split(',')) {
    const part = partRaw.trim(); let m;
    if (part === '*') { for (let i = min; i <= max; i++) out.add(i); }
    else if ((m = part.match(/^\*\/(\d+)$/))) { const st = parseInt(m[1], 10) || 1; for (let j = min; j <= max; j += st) out.add(j); }
    else if ((m = part.match(/^(\d+)-(\d+)(?:\/(\d+))?$/))) {
      const st = parseInt(m[3] || '1', 10) || 1;
      for (let k = parseInt(m[1], 10); k <= parseInt(m[2], 10); k += st) if (k >= min && k <= max) out.add(k);
    } else if ((m = part.match(/^(\d+)$/))) { const v = parseInt(m[1], 10); if (v >= min && v <= max) out.add(v); }
  }
  return out;
}

export function cronNextUTC(expr, from) {
  if (!expr) return null;
  const f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) return null;
  const mins = cronFieldSet(f[0], 0, 59); const hrs = cronFieldSet(f[1], 0, 23);
  const doms = cronFieldSet(f[2], 1, 31); const mons = cronFieldSet(f[3], 1, 12);
  const dowsRaw = cronFieldSet(f[4], 0, 7); const dows = new Set();
  dowsRaw.forEach((d) => dows.add(d === 7 ? 0 : d));
  if (!mins.size || !hrs.size || !doms.size || !mons.size || !dows.size) return null;
  const domAny = f[2] === '*'; const dowAny = f[4] === '*';
  let tCur = new Date(Math.floor(from.getTime() / 60000) * 60000 + 60000);
  for (let guard = 0; guard < 200000; guard++) {
    if (!mons.has(tCur.getUTCMonth() + 1)) { tCur = new Date(Date.UTC(tCur.getUTCFullYear(), tCur.getUTCMonth() + 1, 1)); continue; }
    let dayOk;
    if (domAny && dowAny) dayOk = true;
    else if (domAny) dayOk = dows.has(tCur.getUTCDay());
    else if (dowAny) dayOk = doms.has(tCur.getUTCDate());
    else dayOk = doms.has(tCur.getUTCDate()) || dows.has(tCur.getUTCDay());
    if (!dayOk) { tCur = new Date(Date.UTC(tCur.getUTCFullYear(), tCur.getUTCMonth(), tCur.getUTCDate() + 1)); continue; }
    if (!hrs.has(tCur.getUTCHours())) { tCur = new Date(Date.UTC(tCur.getUTCFullYear(), tCur.getUTCMonth(), tCur.getUTCDate(), tCur.getUTCHours() + 1)); continue; }
    if (!mins.has(tCur.getUTCMinutes())) { tCur = new Date(tCur.getTime() + 60000); continue; }
    return tCur;
  }
  return null;
}

/* ============================================================
   Markdown (marked + DOMPurify, CDN pinned — pola sanitasi v2)
   ============================================================ */
let mdLibs = null;
async function loadMdLibs() {
  if (!mdLibs) {
    mdLibs = Promise.all([import(CDN_MARKED), import(CDN_DOMPURIFY)])
      .then(([m, d]) => ({ marked: m.marked || m.default, DOMPurify: d.default }))
      .catch((e) => { mdLibs = null; throw e; });
  }
  return mdLibs;
}

export async function renderMd(md) {
  try {
    const { marked, DOMPurify } = await loadMdLibs();
    return DOMPurify.sanitize(marked.parse(String(md || '')));
  } catch {
    /* CDN gagal → fallback teks mentah ter-escape (tetap terbaca) */
    return `<pre style="white-space:pre-wrap">${esc(md)}</pre>`;
  }
}

/* ============================================================
   Count-up KPI (vanilla, ≤600ms, hanya first paint, hormati reduced-motion)
   ============================================================ */
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export function countUp(el, target, format) {
  const f = format || ((x) => fmt.int(Math.round(x)));
  if (REDUCED || !isFinite(target)) { el.textContent = f(target); return; }
  const t0 = performance.now(); const dur = 600;
  function tick(now) {
    const p = Math.min((now - t0) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = f(target * eased);
    if (p < 1) requestAnimationFrame(tick); else el.textContent = f(target);
  }
  requestAnimationFrame(tick);
}

/* ============================================================
   Komponen UI bersama (badge/verdict/chip/empty/skeleton)
   ============================================================ */
const VERDICT_STYLE = { kaji: { sym: '◆', cls: 'ok' }, pantau: { sym: '◇', cls: 'note' }, tolak: { sym: '✕', cls: 'warn' } };

export const ui = {
  /** §4.4 — verdict badge manusiawi; null → ◌ Belum diriset.
   *  BL-45 (§1.9): label yang bocor jargon (mis. "pathway regulasi C-07") di-fallback
   *  ke label kanonik per verdict.code, lalu ke "Status belum diringkas". Simbol+warna
   *  tetap dari code (redundansi WCAG terjaga). Signature & opts.alasan dipertahankan. */
  verdictBadge(verdict, opts = {}) {
    if (!verdict || !verdict.code || !VERDICT_STYLE[verdict.code]) {
      return `<span class="badge plain">◌ ${esc(t('umum.belum_diriset'))}</span>`;
    }
    const st = VERDICT_STYLE[verdict.code];
    const labelRaw = verdict.label;
    const label = (labelRaw && !ui.looksLikeJargon(labelRaw))
      ? labelRaw
      : t(`peluang.verdict.${verdict.code}.label`, null, t('peluang.verdict.tanpa_label'));
    const alasan = (opts.alasan && verdict.alasan && !ui.looksLikeJargon(verdict.alasan)) ? ` — ${esc(verdict.alasan)}` : '';
    return `<span class="badge ${st.cls}">${st.sym} ${esc(label)}${alasan}</span>`;
  },
  /** §4.6 — chip regulasi compact: simbol + warna + teks. */
  regChip(ms) {
    const map = { lolos: ['●', 'ok'], proses: ['◐', 'half'], blocker: ['✕', 'warn'], belum: ['◌', 'plain'] };
    const [sym, cls] = map[ms.status] || map.belum;
    const short = t(`peluang.regulasi.${ms.key}`, null, ms.label || ms.key);
    let fact = '';
    const tgl = parseTanggalIndo(ms.catatan);
    if (ms.status === 'proses' && tgl) fact = ` ≤ ${tgl.label}`;
    else if (ms.catatan) {
      const seg = String(ms.catatan).split(/\s+—\s+|\s+—\s+|;/)[0].trim();
      fact = seg && seg.length <= 52 ? `: ${seg}` : `: ${t(`peluang.regulasi.status.${ms.status}`, null, ms.status)}`;
    }
    return `<span class="badge ${cls}">${sym} ${esc(short)}${esc(fact)}</span>`;
  },
  /** §4.5 — tier badge; T1 varian ok. */
  tierChip(tier) {
    const tval = String(tier || '').toUpperCase();
    if (!/^T[1-5]$/.test(tval)) return '';
    return `<span class="tier ${tval === 'T1' ? 't1' : ''}" title="${esc(t('peluang.bukti.tier.' + tval.toLowerCase()))}">${tval}</span>`;
  },
  /**
   * §4.5/§4.12 — sumber sebagai tautan ramah. Label = NAMA sumber (bukan URL
   * mentah); bila ada url http(s) valid → <a> bertanda link + ikon external,
   * target _blank rel noopener noreferrer. Url non-http / null → teks biasa
   * (tidak ada link mati). Tanggal akses opsional ("· diakses {tanggal}").
   * src: { sumber, url, tanggal_akses } — semua di-esc (anti-XSS).
   */
  sourceLink(src) {
    const o = src || {};
    const nama = String(o.sumber || '').trim();
    const url = String(o.url || '').trim();
    const valid = /^https?:\/\//i.test(url);
    const label = nama || (valid ? url.replace(/^https?:\/\//i, '').replace(/\/.*$/, '') : '');
    if (!label) return '';
    const tgl = o.tanggal_akses
      ? `<span class="src-date">· ${esc(t('peluang.bukti.diakses', { tanggal: fmt.tanggal(o.tanggal_akses) }, 'diakses {tanggal}'))}</span>`
      : '';
    if (valid) {
      return `<a class="src-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}<span class="src-ext" aria-hidden="true">↗</span></a>${tgl}`;
    }
    return `<span class="src-plain">${esc(label)}</span>${tgl}`;
  },
  qaBadge(qa) {
    if (qa === 'PASS' || /^PASS\b/.test(String(qa || ''))) return `<span class="badge plain">✓ ${esc(t('peluang.qa.pass'))}</span>`;
    if (qa === 'FAIL') return `<span class="badge warn">✕ ${esc(t('peluang.qa.fail'))}</span>`;
    return `<span class="badge plain">◌ ${esc(t('peluang.qa.belum'))}</span>`;
  },
  /** §4.20 #2 — chip data belum diriset. */
  belumChip() { return `<span class="chip-belum">◌ ${esc(t('umum.belum_diriset'))}</span>`; },

  /* ===== Fondasi v4 (spec docs/revamp-v4/02-implementation-spec.md §1) ===== */

  /**
   * §1.3 (BL-02 view-side, K1) — detektor jargon ops untuk fallback DI VIEW.
   * Deterministik, nol network. JARING PENGAMAN lapis-kedua — akar humanisasi
   * ada di builder (follow-up BL-02). false-negative mungkin (konservatif).
   * Korpus golden diuji di harness fondasi (14 verdict.alasan + aktivitas).
   */
  looksLikeJargon(str) {
    const s = String(str == null ? '' : str);
    const PATTERNS = [
      /\brun[_ ]?id\b/i, /\bDoD\b/, /\bcron\b/i, /\bchain[:-]/i,
      /\bC-\d{6}(-\d{2})?\b/,            // ID kandidat penuh, format C-YYYYWW-NN
      /\bC-\d{2}\b/,                     // ID singkat "C-07"
      /\b(internal )?iteration(s)?\b/i, /\bquality[_ ]?score\b/i,
      /\bexit[_ ]?code\b/i, /\bskill[_-]?id\b/i,
      /\b(SUCCESS|FAILURE|FAIL|PARTIAL)\b/, /\bSHA\b/, /\bQA bounce\b/i,
      /\bpathway\b/i,
      /kapasitas (penuh|terbatas)/i,
      /menunggu (cek mutu|QA)\b/i,       // TIDAK match "lolos cek mutu"
    ];
    return PATTERNS.some((re) => re.test(s));
  },

  /**
   * §1.4 — kontrak null≠0. null/undefined/NaN → empty-state jujur (HTML);
   * 0 (number) → '0' (nol valid); selainnya → null (pemanggil format sendiri).
   * Pola: `const h=ui.honestValue(v,'pfx'); return h!==null?h:fmt.compact(v);`
   * — JANGAN `(v||0)`.
   */
  honestValue(val, emptyPrefix) {
    if (val === null || val === undefined || (typeof val === 'number' && isNaN(val))) {
      if (emptyPrefix) return `<span class="belum-tersedia">${esc(t(emptyPrefix + '.belum'))}</span>`;
      return ui.belumChip();
    }
    if (val === 0) return '0';
    return null;
  },

  /**
   * §1.5 (BL-04, K2) — delta badge ber-baseline. KONTRAK null≠0: prev null/undefined
   * ATAU now bukan number → "Belum ada pembanding" (BUKAN +0/panah hijau). Simbol
   * redundan (▲/▼/=) DI-PREPEND di sini; baseline/unit di-sisip di sini. String
   * naik_n/turun_n/tetap_s = teks polos bebas-simbol/bebas-baseline.
   */
  deltaBadge(now, prev, opts = {}) {
    if (prev === null || prev === undefined || typeof now !== 'number') {
      return `<span class="delta-badge delta-flat">${esc(t('umum.delta.tanpa_pembanding'))}</span>`;
    }
    const d = now - prev;
    const numTxt = opts.asPercent ? fmt.persen(Math.abs(d)) : fmt.int(Math.abs(d)) + (opts.unit ? ' ' + esc(opts.unit) : '');
    const num = `<span class="num">${numTxt}</span>`;
    let sym; let cls; let txt;
    if (d > 0) { sym = opts.invert ? '▼' : '▲'; cls = opts.invert ? 'delta-down' : 'delta-up'; txt = t('umum.delta.naik_n', { n: num }); }
    else if (d < 0) { sym = opts.invert ? '▲' : '▼'; cls = opts.invert ? 'delta-up' : 'delta-down'; txt = t('umum.delta.turun_n', { n: num }); }
    else { sym = '='; cls = 'delta-flat'; txt = esc(t('umum.delta.tetap_s')); }
    const base = opts.baseline ? ` <span class="d-base">${esc(opts.baseline)}</span>` : '';
    return `<span class="delta-badge ${cls}">${sym} ${txt}${base}</span>`;
  },

  /** §1.7 (K5) — badge tone ok/warn/tip/plain (simbol+warna+teks 3-redundan).
   *  verdictBadge hanya map kaji/pantau/tolak — toneBadge untuk hero/status ops. */
  toneBadge(tone, sym, teks) { return `<span class="badge ${tone}">${sym} ${esc(teks)}</span>`; },

  /**
   * §1.6 (BL-04) — kartu KPI ber-baseline kanonik (§4.7). value null → honestValue
   * (empty-state jujur). delta bila now&prev number, else baseline teks. Reuse
   * belumChip/ttSpan/deltaBadge/fmt.* — tidak duplikasi.
   */
  statCard(opts = {}) {
    const o = opts;
    const label = o.labelTip ? ttSpan(o.label, o.labelTip) : esc(o.label);
    const isEmpty = o.value === null || o.value === undefined || (typeof o.value === 'number' && isNaN(o.value));
    const valHtml = isEmpty
      ? `<div class="stat-value">${ui.honestValue(o.value, o.emptyPrefix)}</div>`
      : `<div class="stat-value mono-kpi">${(o.valueFormat || fmt.int)(o.value)}${o.satuan ? `<small>${esc(o.satuan)}</small>` : ''}</div>`;
    let mid = '';
    if (typeof o.now === 'number') {
      mid = `<div class="k-delta">${ui.deltaBadge(o.now, (o.prev === undefined ? null : o.prev), o.deltaOpts || {})}</div>`;
    } else if (o.baseline) {
      mid = `<div class="stat-baseline">${esc(o.baseline)}</div>`;
    }
    const formula = o.formula ? `<div class="stat-formula">${esc(o.formula)}</div>` : '';
    const asumsi = o.asumsi ? `<div><span class="badge note">◆ ${esc(o.asumsi === true ? 'ASUMSI' : o.asumsi)}</span></div>` : '';
    return `<article class="stat-card"><div class="k-label">${label}</div>${valHtml}${mid}${formula}${asumsi}</article>`;
  },
  /** Empty state 3-bagian dari strings (`{prefix}.apa/kenapa/berikutnya`). */
  empty(prefix) {
    return `<div class="empty">
      <p class="e-apa">${esc(t(prefix + '.apa'))}</p>
      <p class="e-kenapa">${esc(t(prefix + '.kenapa'))}</p>
      <p class="e-next">${esc(t(prefix + '.berikutnya'))}</p>
    </div>`;
  },
  skeleton(kind = 'card') {
    if (kind === 'page') {
      return `<div class="sk-stack" role="status" aria-busy="true"><span class="sr-only">${esc(t('umum.muat'))}</span>
        <div class="sk sk-title"></div><div class="sk sk-line"></div><div class="sk sk-line s"></div><div class="sk sk-chart"></div><div class="sk sk-card"></div></div>`;
    }
    if (kind === 'chart') return `<div class="sk sk-chart" role="status" aria-busy="true"><span class="sr-only">${esc(t('umum.muat'))}</span></div>`;
    return `<div class="sk sk-card" role="status" aria-busy="true"><span class="sr-only">${esc(t('umum.muat'))}</span></div>`;
  },
  /** §5.5 — fallback chart saat CDN ECharts gagal: data dalam teks. */
  chartFallback(text) { return `<div class="chart-fallback">${text}</div>`; },
  meter(pct) {
    const w = Math.max(0, Math.min(100, pct || 0));
    return `<span class="meter" aria-hidden="true"><i style="width:${w}%"></i></span>`;
  },
  /**
   * §4.20 — foto produk gagal-muat → tampilkan fallback monogram "FOTO BELUM ADA".
   * CSP melarang inline onerror, jadi handler dipasang via JS setelah render.
   * Panggil dengan root view setelah el.innerHTML diisi.
   */
  bindImgFallbacks(root) {
    if (!root) return;
    root.querySelectorAll('img[data-fallback-img]').forEach((img) => {
      const fail = () => { const p = img.parentNode; if (p) p.classList.add('img-failed'); img.remove(); };
      if (img.complete && img.naturalWidth === 0) { fail(); return; } /* sudah gagal sebelum listener */
      img.addEventListener('error', fail, { once: true });
    });
  },
};

/* ============================================================
   Toast (§4.21) — maks 1 tampil, antre sisanya
   ============================================================ */
const toastQueue = [];
let toastBusy = false;
export function toast(msg, kind = 'status') {
  toastQueue.push({ msg, kind });
  if (!toastBusy) nextToast();
}
function nextToast() {
  const item = toastQueue.shift();
  if (!item) { toastBusy = false; return; }
  toastBusy = true;
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', item.kind === 'alert' ? 'alert' : 'status');
  el.innerHTML = `<span>${esc(item.msg)}</span><button class="t-x" aria-label="${esc(t('umum.tutup'))}">✕</button>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  let timer = setTimeout(close, 5000);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => { timer = setTimeout(close, 2500); });
  el.querySelector('.t-x').addEventListener('click', close);
  function close() {
    clearTimeout(timer);
    el.classList.remove('show');
    setTimeout(() => { el.remove(); nextToast(); }, 250);
  }
}

/* ============================================================
   Drawer (§4.18) — slide kanan / bottom-sheet, focus-trap, Esc
   ============================================================ */
let drawerState = null;
export const drawer = {
  open({ title, body, onClose }) {
    drawer.close(true);
    const trigger = document.activeElement;
    const scrim = document.createElement('div');
    scrim.className = 'drawer-scrim';
    const el = document.createElement('aside');
    el.className = 'drawer';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'drawer-title');
    el.innerHTML = `<div class="drawer-handle"></div>
      <div class="drawer-head">
        <h2 class="title" id="drawer-title">${title}</h2>
        <button class="icon-btn" data-close aria-label="${esc(t('umum.tutup'))}">✕</button>
      </div>
      <div class="drawer-body">${body}</div>`;
    document.body.appendChild(scrim);
    document.body.appendChild(el);
    requestAnimationFrame(() => { scrim.classList.add('show'); el.classList.add('show'); });
    const keyHandler = (e) => {
      if (e.key === 'Escape') { drawer.close(); return; }
      if (e.key !== 'Tab') return;
      const foci = el.querySelectorAll('a[href],button,input,select,[tabindex="0"]');
      if (!foci.length) return;
      const first = foci[0]; const last = foci[foci.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    };
    document.addEventListener('keydown', keyHandler);
    scrim.addEventListener('click', () => drawer.close());
    el.querySelector('[data-close]').addEventListener('click', () => drawer.close());
    drawerState = { el, scrim, keyHandler, trigger, onClose };
    const f = el.querySelector('[data-close]');
    if (f) f.focus();
  },
  close(immediate) {
    if (!drawerState) return;
    const { el, scrim, keyHandler, trigger, onClose } = drawerState;
    drawerState = null;
    document.removeEventListener('keydown', keyHandler);
    if (immediate) { el.remove(); scrim.remove(); }
    else {
      el.classList.add('closing'); el.classList.remove('show'); scrim.classList.remove('show');
      setTimeout(() => { el.remove(); scrim.remove(); }, 250);
    }
    if (onClose) onClose();
    if (trigger && trigger.focus) trigger.focus();
  },
};

/* tooltip glosarium: tap toggle (sentuh) — hover/focus via CSS */
document.addEventListener('click', (e) => {
  const tip = e.target.closest('.tt');
  document.querySelectorAll('.tt.open').forEach((x) => { if (x !== tip) x.classList.remove('open'); });
  if (tip) tip.classList.toggle('open');
});

/* ============================================================
   Sesi & auth — envelope (KONTRAK §2)
   ============================================================ */
const SES_VIEWER = 'pimas.dek.viewer';
const SES_OPS = 'pimas.dek.ops';

const te = new TextEncoder();
function b64ToBytes(b64) {
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(buf) {
  const b = new Uint8Array(buf); let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

/*
 * "Ingat sesi tab ini" = simpan DEK raw (b64) di sessionStorage — BUKAN password.
 * crypt.js mengembalikan CryptoKey non-extractable (exportKey mustahil), maka
 * raw DEK diturunkan lewat jalur unwrap paralel DI SINI dengan konstanta yang
 * WAJIB identik kontrak §2 (PBKDF2-SHA256 600000; AAD `pimas-wrap|{uid}|{role}|{kv}`).
 * unwrapDeks (crypt.js) tetap menjadi verifier kredensial kanonik saat login.
 */
async function unwrapRawDeks(usersJson, username, password) {
  const subtle = crypto.subtle;
  const uname = String(username == null ? '' : username).trim().toLowerCase();
  const digest = await subtle.digest('SHA-256', te.encode(uname + ':' + usersJson.site_salt));
  const uid = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
  const user = usersJson.users.find((u) => u && u.uid === uid);
  if (!user) return null;
  const baseKey = await subtle.importKey('raw', te.encode(String(password == null ? '' : password).trim()), { name: 'PBKDF2' }, false, ['deriveKey']);
  const kek = await subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64ToBytes(user.salt), iterations: 600000 },
    baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  const out = {};
  for (const roleKey of ['viewer', 'ops']) {
    const w = user.wrapped_keys[roleKey];
    if (!w) continue;
    try {
      const raw = await subtle.decrypt(
        { name: 'AES-GCM', iv: b64ToBytes(w.iv), additionalData: te.encode(`pimas-wrap|${uid}|${roleKey}|${w.kv}`) },
        kek, b64ToBytes(w.ct),
      );
      out[roleKey] = bytesToB64(raw);
    } catch { /* wrap ini gagal — sudah diverifikasi unwrapDeks */ }
  }
  return out;
}

async function importRawDek(b64) {
  return crypto.subtle.importKey('raw', b64ToBytes(b64), { name: 'AES-GCM' }, false, ['decrypt']);
}

function clearSession() {
  try { sessionStorage.removeItem(SES_VIEWER); sessionStorage.removeItem(SES_OPS); } catch { /* abaikan */ }
}

/* ============================================================
   State + boot
   ============================================================ */
const state = {
  data: null,      /* payload viewer (plane WAWASAN) */
  ops: null,       /* payload ops (plane OPERASIONAL) — hanya bila DEK ops dimiliki */
  cleanup: null,   /* fn cleanup view aktif */
  route: null,
};

const app = document.getElementById('app');

async function fetchAndDecrypt(roleKey, dek) {
  /* produksi (Pages): blob di root · dev lokal: dist/ — urutan per environment
     supaya jalur normal tidak menghasilkan 404 di console */
  const isDev = ['localhost', '127.0.0.1'].includes(location.hostname);
  const paths = [`data.${roleKey}.enc.json`, `dist/data.${roleKey}.enc.json`];
  const enc = await fetchJSON(isDev ? paths.slice().reverse() : paths);
  return decryptBlob(enc, dek);
}

/* Re-fetch + dekripsi ulang payload viewer (untuk polling progres analisis).
   Mengembalikan data viewer terbaru + memperbarui state.data; null bila DEK sesi
   tak tersimpan (user tak centang "ingat sesi") → pemanggil degrade ke tombol manual. */
async function reloadViewer() {
  try {
    const vB64 = sessionStorage.getItem(SES_VIEWER);
    if (!vB64) return null;
    const dek = await importRawDek(vB64);
    const fresh = await fetchAndDecrypt('viewer', dek);
    if (fresh) state.data = fresh;
    return fresh;
  } catch { return null; }
}

async function boot() {
  try {
    const [strings, glossary] = await Promise.all([
      fetchJSON(['content/strings.json']),
      fetchJSON(['content/glossary.json']).catch(() => []),
    ]);
    STRINGS = strings || {};
    GLOSSARY = Array.isArray(glossary) ? glossary : [];
  } catch {
    STRINGS = {}; GLOSSARY = [];
  }

  /* restore sesi tab (opt-in) */
  let restored = false;
  try {
    const vB64 = sessionStorage.getItem(SES_VIEWER);
    if (vB64) {
      app.innerHTML = `<div class="boot"><span class="spinner"></span><span>${esc(t('umum.menyiapkan'))}</span></div>`;
      const dekV = await importRawDek(vB64);
      state.data = await fetchAndDecrypt('viewer', dekV);
      const oB64 = sessionStorage.getItem(SES_OPS);
      if (oB64) {
        try { state.ops = await fetchAndDecrypt('ops', await importRawDek(oB64)); }
        catch { state.ops = null; }
      }
      restored = true;
    }
  } catch {
    clearSession();
    state.data = null; state.ops = null;
  }

  if (restored && state.data) enterApp();
  else renderLogin();
}

/* ============================================================
   Login screen
   ============================================================ */
function renderLogin(prefillErr) {
  document.title = t('login.judul') + ' — ' + t('login.subjudul');
  app.innerHTML = `
  <div class="login-wrap">
    <div class="card login-card fade-in">
      <div class="login-mark" aria-hidden="true">P</div>
      <h1>${esc(t('login.judul'))}</h1>
      <p class="login-sub">${esc(t('login.subjudul'))}</p>
      <p class="login-sapa">${esc(t('login.sapaan'))}</p>
      <form id="login-form" novalidate>
        <label class="field">
          <span>${esc(t('login.username.label'))}</span>
          <input class="input" id="login-user" type="text" placeholder="${esc(t('login.username.placeholder'))}"
                 autocomplete="username" autocapitalize="none" spellcheck="false" required>
        </label>
        <label class="field">
          <span>${esc(t('login.password.label'))}</span>
          <input class="input" id="login-pass" type="password" placeholder="${esc(t('login.password.placeholder'))}"
                 autocomplete="current-password" required>
        </label>
        <label class="check-row">
          <input type="checkbox" id="login-remember">
          <span>${esc(t('login.ingat_sesi.label'))}<span class="hint">${esc(t('login.ingat_sesi.hint'))}</span></span>
        </label>
        <button class="cta" type="submit" id="login-btn">${esc(t('login.tombol'))}</button>
        <div id="login-err" role="alert">${prefillErr ? `<p class="login-err">⚠ ${esc(prefillErr)}</p>` : ''}</div>
      </form>
      <p class="login-keamanan">${esc(t('login.keamanan'))}</p>
    </div>
  </div>`;

  const form = document.getElementById('login-form');
  const btn = document.getElementById('login-btn');
  const errBox = document.getElementById('login-err');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (btn.disabled) return;
    const username = document.getElementById('login-user').value;
    const password = document.getElementById('login-pass').value;
    const remember = document.getElementById('login-remember').checked;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ${esc(t('login.loading'))}`;
    errBox.innerHTML = '';
    try {
      const users = await fetchJSON(['users.json']);
      const deks = await unwrapDeks(users, username, password); /* verifier kanonik (crypt.js) */
      state.data = await fetchAndDecrypt('viewer', deks.viewer);
      if (deks.ops) {
        try { state.ops = await fetchAndDecrypt('ops', deks.ops); }
        catch { state.ops = null; toast(t('error.muat_data.pesan'), 'alert'); }
      }
      if (remember) {
        try {
          const raw = await unwrapRawDeks(users, username, password);
          if (raw && raw.viewer) sessionStorage.setItem(SES_VIEWER, raw.viewer);
          if (raw && raw.ops) sessionStorage.setItem(SES_OPS, raw.ops);
        } catch { /* storage diblok — sesi tetap jalan tanpa restore */ }
      }
      enterApp();
    } catch (err) {
      state.data = null; state.ops = null;
      clearSession();
      let msg;
      if (err && (err.message === 'WRONG_CREDENTIALS' || err.message === 'BAD_USERS_JSON')) msg = t('login.error.wrong_credentials');
      else if (err && err.message === 'DECRYPT_FAILED') msg = t('error.dekripsi.pesan') + ' ' + t('error.dekripsi.tindakan');
      else msg = t('login.error.jaringan');
      errBox.innerHTML = `<p class="login-err">⚠ ${esc(msg)}</p>`;
      btn.disabled = false;
      btn.textContent = t('login.tombol');
    }
  });
}

/* ============================================================
   Shell aplikasi: sidebar + apphead + tabbar
   ============================================================ */
function themeBtnLabel() {
  return document.documentElement.classList.contains('dark') ? t('umum.tema.ke_terang') : t('umum.tema.ke_gelap');
}

function navData() {
  return {
    wawasan: [
      { hash: '#/', glyph: '⌂', label: t('nav.wawasan.beranda.label'), match: 'beranda' },
      { hash: '#/peluang', glyph: '◎', label: t('nav.wawasan.peluang.label'), match: 'peluang' },
      { hash: '#/sentimen', glyph: '◍', label: t('nav.wawasan.sentimen.label'), match: 'sentimen' },
      { hash: '#/laporan', glyph: '▤', label: t('nav.wawasan.laporan.label'), match: 'laporan' },
      { hash: '#/tentang', glyph: '✳', label: t('nav.wawasan.tentang.label'), match: 'tentang' },
    ],
    ops: [
      { hash: '#/ops/pipeline', glyph: '⛁', label: t('nav.ops.pipeline.label'), match: 'ops-pipeline' },
      { hash: '#/ops/agen', glyph: '⚙', label: t('nav.ops.agen.label'), match: 'ops-agen' },
      { hash: '#/ops/kesehatan', glyph: '♡', label: t('nav.ops.kesehatan.label'), match: 'ops-kesehatan' },
    ],
  };
}

function renderShell() {
  const nav = navData();
  const hasOps = !!state.ops;
  const agents = hasOps ? (state.ops.agents || []) : [];
  const enabledCount = agents.filter((a) => a.enabled).length;
  const opsStat = agents.length
    ? `<span class="ops-status num">${enabledCount}/${agents.length}${enabledCount === agents.length ? ' ✓' : ''}</span>` : '';

  app.innerHTML = `
  <div class="shell">
    <nav class="sidebar" aria-label="${esc(t('nav.wawasan.label'))}">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">P</div>
        <div>
          <div class="brand-name">${esc(t('login.judul'))}</div>
          <div class="brand-sub">${esc(t('login.subjudul'))}</div>
        </div>
      </div>
      <div class="nav-section">${esc(t('nav.wawasan.label'))}</div>
      <div id="nav-wawasan">
        ${nav.wawasan.map((n) => `<a class="nav-item" data-match="${n.match}" href="${n.hash}"><span class="nav-glyph" aria-hidden="true">${n.glyph}</span> ${esc(n.label)}</a>`).join('')}
      </div>
      ${hasOps ? `
      <div class="nav-ops">
        <div class="nav-section" style="margin-top:0">${esc(t('nav.ops.label'))}</div>
        ${nav.ops.map((n, i) => `<a class="nav-item" data-match="${n.match}" href="${n.hash}"><span class="nav-glyph" aria-hidden="true">${n.glyph}</span> ${esc(n.label)} ${i === 0 ? opsStat : ''}</a>`).join('')}
      </div>` : '<div class="nav-ops" style="border:none"></div>'}
    </nav>

    <main class="main">
      <div class="apphead">
        <span class="stamp">${esc(t('umum.terakhir_diperbarui', { tanggal: fmt.tanggalWaktu(state.data.generated_at) }))}</span>
        <button class="btn-ghost" id="btn-theme">◐ <span>${esc(themeBtnLabel())}</span></button>
        <button class="btn-ghost" id="btn-logout">${esc(t('umum.keluar'))}</button>
      </div>
      <div id="view" tabindex="-1"></div>
    </main>
  </div>

  <nav class="tabbar" aria-label="${esc(t('nav.wawasan.label'))}">
    ${nav.wawasan.map((n) => `<a class="tab" data-match="${n.match}" href="${n.hash}"><span class="t-glyph" aria-hidden="true">${n.glyph}</span>${esc(n.label)}</a>`).join('')}
    ${hasOps ? `<a class="tab ops" data-match="ops" href="#/ops/pipeline"><span class="t-glyph" aria-hidden="true">⚙</span>${esc(t('nav.ops.label'))}</a>` : ''}
  </nav>`;

  document.getElementById('btn-theme').addEventListener('click', () => {
    const dark = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('pimas.theme', dark ? 'dark' : 'light'); } catch { /* abaikan */ }
    document.querySelector('#btn-theme span').textContent = themeBtnLabel();
  });
  document.getElementById('btn-logout').addEventListener('click', () => {
    clearSession();
    location.hash = '';
    location.reload();
  });
}

/* ============================================================
   Router hash nested (KONTRAK §1)
   ============================================================ */
function parseRoute() {
  const h = (location.hash || '#/').replace(/^#/, '');
  const seg = h.split('/').filter(Boolean).map(decodeURIComponent);
  if (seg.length === 0) return { view: 'beranda' };
  if (seg[0] === 'peluang') {
    if (seg.length === 1) return { view: 'peluang' };
    if (seg.length === 2) return { view: 'peluang-detail', id: seg[1] };
    if (seg.length === 3 && seg[2] === 'dossier') return { view: 'peluang-detail', id: seg[1], dossier: true };
    return null;
  }
  if (seg[0] === 'sentimen') {
    if (seg.length === 1) return { view: 'sentimen' };
    if (seg.length === 2) return { view: 'sentimen', slug: seg[1] };
    return null;
  }
  if (seg[0] === 'laporan') {
    if (seg.length === 1) return { view: 'laporan' };
    if (seg.length === 3 && ['brief', 'digest'].includes(seg[1])) return { view: 'laporan', jenis: seg[1], id: seg[2] };
    return null;
  }
  if (seg[0] === 'tentang' && seg.length === 1) return { view: 'tentang' };
  if (seg[0] === 'ops') {
    if (seg.length === 1) return { redirect: '#/ops/pipeline' };
    if (seg.length === 2 && ['pipeline', 'agen', 'kesehatan'].includes(seg[1])) return { view: 'ops-' + seg[1] };
    return null;
  }
  return null;
}

const VIEWS = {
  beranda: vBeranda, peluang: vPeluang, 'peluang-detail': vPeluangDetail,
  sentimen: vSentimen,
  laporan: vLaporan, tentang: vTentang,
  'ops-pipeline': vOpsPipeline, 'ops-agen': vOpsAgen, 'ops-kesehatan': vOpsKesehatan,
};

function titleFor(route) {
  const map = {
    beranda: t('nav.wawasan.beranda.label'), peluang: t('nav.wawasan.peluang.label'),
    'peluang-detail': t('nav.wawasan.peluang.label'), laporan: t('nav.wawasan.laporan.label'),
    sentimen: t('nav.wawasan.sentimen.label'),
    tentang: t('nav.wawasan.tentang.label'),
    'ops-pipeline': `${t('nav.ops.label')} · ${t('nav.ops.pipeline.label')}`,
    'ops-agen': `${t('nav.ops.label')} · ${t('nav.ops.agen.label')}`,
    'ops-kesehatan': `${t('nav.ops.label')} · ${t('nav.ops.kesehatan.label')}`,
  };
  let suffix = map[route.view] || '';
  if (route.view === 'peluang-detail' && route.id) {
    const opp = (state.data.opportunities || []).find((o) => o.id === route.id);
    if (opp) suffix = opp.nama;
  }
  return `${suffix ? suffix + ' — ' : ''}${t('login.judul')}`;
}

function makeCtx(route) {
  return {
    data: state.data,
    ops: state.ops,
    hasOps: !!state.ops,
    route,
    t, esc, fmt, ui, ttSpan, toast, drawer, renderMd, countUp,
    parseTanggalIndo,
    glossary: GLOSSARY,
    glossaryFind,
    AMBANG: AMBANG_LAPOR,
    WEIGHTS: SCORE_WEIGHTS,
    cron: { nextUTC: cronNextUTC },
    charts: {
      ok: chartsAvailable(), init: pimasInit, ANIM: PIMAS_ANIM,
      tokens: chartTokens, markLineAmbang, sparkline, barRanked,
    },
    navigate(hash) { location.hash = hash; },
    reloadViewer,
  };
}

function renderOpsLocked(el) {
  /* route ops tanpa DEK ops → empty state "halaman khusus pengelola" (KONTRAK §1) */
  el.innerHTML = `
  <header class="pagehead">
    <div>
      <div class="eyebrow">${esc(t('nav.ops.label'))}</div>
      <h1 class="display-l">${esc(t('ops.locked.apa'))}</h1>
    </div>
  </header>
  <div class="card" style="max-width:560px">
    <div class="empty">
      <p class="e-apa">${esc(t('ops.locked.apa'))}</p>
      <p class="e-kenapa">${esc(t('ops.locked.kenapa'))}</p>
      <p class="e-next">${esc(t('ops.locked.berikutnya'))}</p>
    </div>
    <a class="textlink" href="#/">${esc(t('umum.kembali'))} →</a>
  </div>`;
}

function route() {
  let r = parseRoute();
  if (r && r.redirect) { location.replace(r.redirect); return; }
  if (!r) { location.replace('#/'); return; } /* route tak dikenal → beranda */

  if (state.cleanup) { try { state.cleanup(); } catch { /* abaikan */ } state.cleanup = null; }
  drawer.close(true);
  disposeAllCharts();

  const el = document.getElementById('view');
  state.route = r;
  document.title = titleFor(r);

  /* nav active */
  const matchKey = r.view.startsWith('ops-') ? r.view : r.view.split('-')[0] === 'peluang' ? 'peluang' : r.view;
  document.querySelectorAll('[data-match]').forEach((a) => {
    const m = a.getAttribute('data-match');
    const active = m === matchKey || (m === 'ops' && r.view.startsWith('ops-')) || (m === 'beranda' && r.view === 'beranda');
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });

  el.innerHTML = '';
  el.className = r.view.startsWith('ops-') ? 'ops-plane fade-in' : 'fade-in';

  if (r.view.startsWith('ops-') && !state.ops) { renderOpsLocked(el); window.scrollTo(0, 0); return; }

  const mod = VIEWS[r.view];
  const cleanup = mod.render(el, makeCtx(r));
  if (typeof cleanup === 'function') state.cleanup = cleanup;
  window.scrollTo(0, 0);
}

function enterApp() {
  renderShell();
  if (!location.hash || location.hash === '#') location.replace('#/');
  route();
}

window.addEventListener('hashchange', () => {
  if (state.data) route();
});

boot();
