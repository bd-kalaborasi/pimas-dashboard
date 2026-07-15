/*
 * PIMAS dashboard — pdf-export.js (ES module, self-contained; TIDAK import app.js
 * agar bebas dependensi siklik). Membangun PDF ber-merek dari markdown laporan
 * PENUH (report_md / md) memakai pdfmake + marked, keduanya dari jsDelivr (pinned)
 * dengan lazy-load termemoisasi. Kegagalan CDN → THROW (pemanggil menampilkan toast).
 *
 * Sumber PDF = markdown laporan penuh, BUKAN kartu/chart terstruktur di layar.
 * Provenance (tabel sumber, seksi Keterbatasan) dijaga utuh — tidak dibuang.
 *
 * tokensToPdfContent() adalah fungsi MURNI (tanpa network, tanpa import marked)
 * sehingga bisa diuji di Node (lihat pdf-export.test.mjs).
 */

/* ===== token warna brand (DESIGN.md §2 — hex literal by design: pdfmake butuh
   nilai konkret, bukan CSS custom properties; PDF tak punya akses ke :root). ===== */
const ACCENT = '#0e69a7';
const INK = '#141b27';
const BODY = '#242c38';
const BODY2 = '#475463';
const MUTED = '#76849a';
const LINE = '#d3dbe5';
const SURFACE = '#eef1f6';
const SURFACE_TINT = '#f6f8fb';
const WHITE = '#ffffff';

/* lebar konten A4 (595.28pt − margin 40 − 40 ≈ 515pt) untuk garis full-width. */
const CONTENT_W = 515;

/* ============================================================
   Util teks murni
   ============================================================ */

/* buang penanda HTML-comment (mis. <!--sec:...--> <!--ins:...--> <!--num:...-->)
   yang bocor dari pipeline; aman dibuang di mana pun. */
function stripMarkers(s) {
  return String(s == null ? '' : s).replace(/<!--[\s\S]*?-->/g, '');
}

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&apos;': "'", '&nbsp;': ' ', '&hellip;': '…', '&mdash;': '—', '&ndash;': '–',
};
function decode(s) {
  return String(s == null ? '' : s)
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp|hellip|mdash|ndash);/g, (m) => ENTITIES[m] || m)
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return _; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; } });
}
function clean(s) { return decode(stripMarkers(s)); }

/* sisipkan peluang-putus (zero-width space) agar URL/token panjang di dalam sel
   tabel TIDAK meluber keluar halaman. pdfmake (linebreak Unicode) menghormati
   U+200B sebagai titik putus. Cap keras setiap 40 char utk token tanpa pemisah. */
function breakable(s) {
  let out = clean(s);
  out = out.replace(/([/.\-?&=_,;])/g, '$1​');
  out = out.replace(/[^\s​]{40,}/g, (m) => m.replace(/(.{40})/g, '$1​'));
  return out;
}

function alignOf(cell) {
  const a = cell && cell.align;
  return (a === 'right' || a === 'center' || a === 'left') ? a : 'left';
}

/* ============================================================
   Inline tokens → pdfmake text runs
   ============================================================ */
function mkRun(text, inh) {
  const r = { text };
  if (inh.bold) r.bold = true;
  if (inh.italics) r.italics = true;
  if (inh.decoration) r.decoration = inh.decoration;
  if (inh.color) r.color = inh.color;
  return r;
}

function inlineRuns(tokens, inh) {
  inh = inh || {};
  const out = [];
  for (const tk of (tokens || [])) {
    if (!tk) continue;
    switch (tk.type) {
      case 'text':
        if (tk.tokens && tk.tokens.length) out.push(...inlineRuns(tk.tokens, inh));
        else out.push(mkRun(clean(tk.text), inh));
        break;
      case 'escape':
        out.push(mkRun(decode(tk.text), inh));
        break;
      case 'strong':
        out.push(...inlineRuns(tk.tokens, { ...inh, bold: true }));
        break;
      case 'em':
        out.push(...inlineRuns(tk.tokens, { ...inh, italics: true }));
        break;
      case 'del':
        out.push(...inlineRuns(tk.tokens, { ...inh, decoration: 'lineThrough' }));
        break;
      case 'codespan':
        /* pdfmake tak punya bg per-run inline & font default hanya Roboto; kode inline
           di-approksimasi dengan warna aksen agar terbaca beda dari prosa. */
        out.push({ text: decode(tk.text), color: ACCENT, ...(inh.bold ? { bold: true } : {}) });
        break;
      case 'br':
        out.push({ text: '\n' });
        break;
      case 'link': {
        const txt = clean(tk.text || '');
        const href = String(tk.href || '');
        const run = { text: txt || href, color: ACCENT };
        if (href) run.link = href;
        out.push(run);
        /* tampilkan URL mentah HANYA bila teks link beda & URL pendek — hindari
           membuang URL panjang di tengah kalimat. */
        if (href && txt && txt !== href && href.length <= 40) out.push({ text: ` (${href})`, color: MUTED });
        break;
      }
      case 'image':
        out.push({ text: clean(tk.text || tk.title || ''), italics: true, color: MUTED });
        break;
      case 'html': {
        const s = clean(tk.text || tk.raw || '');
        if (s.trim()) out.push(mkRun(s, inh));
        break;
      }
      default: {
        const s = clean(tk.text || tk.raw || '');
        if (s) out.push(mkRun(s, inh));
      }
    }
  }
  return out.length ? out : '';
}

/* runs untuk sebuah token blok yang punya .tokens inline atau hanya .text. */
function textRuns(token, inh) {
  const toks = (token.tokens && token.tokens.length) ? token.tokens : (token.text != null ? [{ type: 'text', text: token.text }] : []);
  return inlineRuns(toks, inh);
}

/* ============================================================
   Block tokens → pdfmake nodes
   ============================================================ */
function headingNode(token) {
  const depth = token.depth || 1;
  let spec;
  if (depth === 1) spec = { fontSize: 17, color: INK, top: 12, bottom: 6 };
  else if (depth === 2) spec = { fontSize: 14, color: ACCENT, top: 12, bottom: 5 };
  else spec = { fontSize: 12, color: INK, top: 10, bottom: 4 }; /* depth 3 & 4+ */
  const runs = textRuns(token, {});
  return {
    text: runs === '' ? clean(token.text) : runs,
    bold: true,
    fontSize: spec.fontSize,
    color: spec.color,
    margin: [0, spec.top, 0, spec.bottom],
  };
}

function paragraphNode(token) {
  const runs = textRuns(token, {});
  if (runs === '' || (Array.isArray(runs) && runs.length === 0)) return null;
  return { text: runs, fontSize: 10, lineHeight: 1.35, color: BODY, margin: [0, 0, 0, 6] };
}

function listItemContent(item) {
  const parts = [];
  for (const tk of (item.tokens || [])) {
    if (!tk) continue;
    if (tk.type === 'text') {
      const runs = textRuns(tk, {});
      parts.push({ text: runs === '' ? clean(tk.text) : runs, margin: [0, 0, 0, 0] });
    } else if (tk.type === 'list') {
      parts.push(listNode(tk));
    } else {
      parts.push(...blockToNodes(tk));
    }
  }
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return { stack: parts };
}

function listNode(token) {
  const key = token.ordered ? 'ol' : 'ul';
  const items = (token.items || []).map(listItemContent);
  const node = {
    [key]: items,
    markerColor: ACCENT,
    fontSize: 10,
    color: BODY,
    lineHeight: 1.3,
    margin: [0, 2, 0, 8],
  };
  if (token.ordered && token.start && token.start !== 1) node.start = token.start;
  return node;
}

function blockquoteNode(token) {
  const inner = [];
  for (const tk of (token.tokens || [])) {
    if (!tk) continue;
    if (tk.type === 'paragraph' || tk.type === 'text') {
      const runs = textRuns(tk, { italics: true, color: BODY2 });
      inner.push({ text: runs === '' ? clean(tk.text) : runs, italics: true, color: BODY2, fontSize: 10, lineHeight: 1.35, margin: [0, 0, 0, 4] });
    } else {
      inner.push(...blockToNodes(tk));
    }
  }
  return {
    table: { widths: ['*'], body: [[{ stack: inner.length ? inner : [{ text: '' }] }]] },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: (i) => (i === 0 ? 3 : 0),
      vLineColor: () => ACCENT,
      fillColor: () => SURFACE_TINT,
      paddingLeft: () => 12,
      paddingRight: () => 10,
      paddingTop: () => 6,
      paddingBottom: () => 6,
    },
    margin: [0, 4, 0, 8],
  };
}

/* lebar kolom: kolom pendek (Tier T1..T5, tanggal) diberi lebar tetap sempit;
   sisanya berbagi '*'. Tabel adalah risiko meluber #1 → widths konkret + '*'. */
function computeColWidths(header, rows) {
  const n = header.length;
  const widths = new Array(n).fill('*');
  for (let c = 0; c < n; c++) {
    const h = String((header[c] && header[c].text) || '').toLowerCase().trim();
    const vals = rows.map((r) => String((r[c] && r[c].text) || '').trim()).filter(Boolean);
    const allTier = vals.length > 0 && vals.every((v) => /^t[1-5]$/i.test(v));
    if (/\btier\b/.test(h) || allTier) { widths[c] = 28; continue; }
    if (/tanggal|akses|\bdate\b|tgl/.test(h)) { widths[c] = 64; continue; }
  }
  return widths;
}

function tableNode(token) {
  const header = Array.isArray(token.header) ? token.header : [];
  const rows = Array.isArray(token.rows) ? token.rows : [];
  if (!header.length) return paragraphNode({ text: clean(token.raw || '') });
  const widths = computeColWidths(header, rows);

  const headRow = header.map((cell) => ({
    text: breakable(cell && cell.text),
    bold: true,
    fontSize: 8.5,
    color: INK,
    alignment: alignOf(cell),
  }));
  const bodyRows = rows.map((row) => header.map((_, c) => {
    const cell = row[c] || { text: '' };
    return {
      text: breakable(cell.text),
      fontSize: 8.5,
      color: BODY,
      alignment: alignOf(cell),
    };
  }));

  return {
    table: { headerRows: 1, dontBreakRows: false, widths, body: [headRow, ...bodyRows] },
    layout: {
      hLineWidth: (i, node) => ((i === 0 || i === 1 || i === node.table.body.length) ? 0.75 : 0.5),
      vLineWidth: () => 0,
      hLineColor: () => LINE,
      fillColor: (rowIndex) => (rowIndex === 0 ? SURFACE : (rowIndex % 2 === 0 ? SURFACE_TINT : null)),
      paddingLeft: () => 6,
      paddingRight: () => 6,
      paddingTop: () => 4,
      paddingBottom: () => 4,
    },
    margin: [0, 4, 0, 10],
  };
}

function hrNode() {
  return {
    canvas: [{ type: 'line', x1: 0, y1: 0, x2: CONTENT_W, y2: 0, lineWidth: 0.75, lineColor: LINE }],
    margin: [0, 8, 0, 8],
  };
}

function codeNode(token) {
  return {
    table: { widths: ['*'], body: [[{ text: decode(token.text || ''), fontSize: 8.5, color: BODY2, preserveLeadingSpaces: true, lineHeight: 1.3 }]] },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      fillColor: () => SURFACE,
      paddingLeft: () => 10,
      paddingRight: () => 10,
      paddingTop: () => 8,
      paddingBottom: () => 8,
    },
    margin: [0, 4, 0, 8],
  };
}

/* satu token blok → array node pdfmake. TIDAK PERNAH throw (fallback paragraf). */
function blockToNodes(token) {
  if (!token || typeof token !== 'object') return [];
  try {
    switch (token.type) {
      case 'heading': return [headingNode(token)];
      case 'paragraph': {
        const n = paragraphNode(token);
        return n ? [n] : [];
      }
      case 'text': {
        const n = paragraphNode(token);
        return n ? [n] : [];
      }
      case 'list': return [listNode(token)];
      case 'blockquote': return [blockquoteNode(token)];
      case 'table': return [tableNode(token)];
      case 'hr': return [hrNode()];
      case 'code': return [codeNode(token)];
      case 'space': return [];
      case 'html': {
        const s = clean(token.text || token.raw || '');
        return s.trim() ? [{ text: s, fontSize: 10, color: BODY, margin: [0, 0, 0, 6] }] : [];
      }
      default: {
        const s = clean(token.text || token.raw || '');
        return s ? [{ text: s, fontSize: 10, color: BODY, margin: [0, 0, 0, 6] }] : [];
      }
    }
  } catch {
    const s = clean(token.text || token.raw || '');
    return s ? [{ text: s, fontSize: 10, color: BODY, margin: [0, 0, 0, 6] }] : [];
  }
}

/* ============================================================
   PURE: tokens (marked.lexer) → pdfmake content array
   ============================================================ */
export function tokensToPdfContent(tokens, opts) {
  void opts;
  const content = [];
  for (const tk of (Array.isArray(tokens) ? tokens : [])) {
    for (const node of blockToNodes(tk)) {
      if (node != null) content.push(node);
    }
  }
  return content;
}

/* ============================================================
   marked (CDN) → tokens → content
   ============================================================ */
const CDN_MARKED = 'https://cdn.jsdelivr.net/npm/marked@12.0.2/lib/marked.esm.js';

export async function mdToPdfContent(md) {
  const mod = await import(CDN_MARKED);
  const marked = mod.marked || mod.default;
  /* URL identik dg app.js → instance modul marked yang SAMA (cache browser). gfm
     sudah default true di marked@12 (no-op), jadi tak mengubah perilaku renderMd. */
  if (marked && typeof marked.setOptions === 'function') marked.setOptions({ gfm: true });
  const tokens = marked.lexer(String(md == null ? '' : md));
  return tokensToPdfContent(tokens);
}

/* ============================================================
   pdfmake (CDN) lazy-load + vfs wiring (memoized)
   ============================================================ */
const CDN_PDFMAKE = 'https://cdn.jsdelivr.net/npm/pdfmake@0.2.20/+esm';
const CDN_PDFMAKE_VFS = 'https://cdn.jsdelivr.net/npm/pdfmake@0.2.20/build/vfs_fonts.js/+esm';

let pdfMakePromise = null;
function loadPdfMake() {
  if (!pdfMakePromise) {
    pdfMakePromise = Promise.all([import(CDN_PDFMAKE), import(CDN_PDFMAKE_VFS)])
      .then(([pm, vfs]) => {
        const pdfMake = pm.default || pm;
        /* vfs 0.2.x bisa berbentuk: default langsung objek vfs, atau
           {pdfMake:{vfs}}, atau default.{pdfMake.vfs|vfs} — tangani semua. */
        pdfMake.vfs = (vfs && vfs.pdfMake && vfs.pdfMake.vfs)
          || (vfs && vfs.default && vfs.default.pdfMake && vfs.default.pdfMake.vfs)
          || (vfs && vfs.default && vfs.default.vfs)
          || (vfs && vfs.default)
          || vfs;
        return pdfMake;
      })
      .catch((e) => { pdfMakePromise = null; throw e; });
  }
  return pdfMakePromise;
}

/* ============================================================
   Header/meta helpers
   ============================================================ */
const KICKER = {
  produk: 'Laporan Produk',
  digest: 'Rangkuman Mingguan',
  sentimen: 'Laporan Sentimen',
  topik: 'Laporan Penjelajah Topik',
};
function kickerFor(kind) { return KICKER[kind] || 'Laporan PIMAS'; }

function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v);
  if (!isNaN(d.getTime())) {
    try {
      return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
    } catch { /* fall through */ }
  }
  return String(v);
}

function buildMetaLine(meta) {
  const m = meta || {};
  const parts = [];
  const name = m.product_name || m.topic || m.jenis;
  if (name) parts.push(String(name));
  const date = fmtDate(m.date);
  if (date) parts.push(date);
  if (m.verdict) parts.push(`Verdict: ${m.verdict}`);
  if (m.status) parts.push(`Status: ${m.status}`);
  const idv = m.id || m.slug;
  if (idv) parts.push(String(idv));
  return parts.join('  ·  ');
}

function safeFileName(meta, kind) {
  const base = `${(meta && (meta.slug || meta.id)) || 'laporan'}-${kind || 'laporan'}`;
  const s = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${s || 'laporan'}.pdf`;
}

function truncate(s, n) {
  const str = String(s == null ? '' : s);
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

/* blok kepala merek (letter-mark P + wordmark PIMAS + kicker) → di atas konten. */
function coverHeaderNodes(kind, title, metaLine) {
  const letterMark = {
    width: 26,
    stack: [
      { canvas: [{ type: 'rect', x: 0, y: 0, w: 24, h: 24, r: 6, color: ACCENT }] },
      { text: 'P', color: WHITE, bold: true, fontSize: 15, alignment: 'center', width: 24, margin: [0, -21, 0, 0] },
    ],
  };
  const wordmark = {
    width: '*',
    stack: [
      { text: 'PIMAS', color: INK, bold: true, fontSize: 15, margin: [0, 1, 0, 0] },
      { text: kickerFor(kind), color: ACCENT, bold: true, fontSize: 8, characterSpacing: 0.6, margin: [0, 1, 0, 0] },
    ],
    margin: [0, 0, 0, 0],
  };
  const nodes = [
    { columns: [letterMark, wordmark], columnGap: 10, margin: [0, 0, 0, 10] },
    { text: clean(title), fontSize: 16, bold: true, color: INK, margin: [0, 2, 0, 4] },
  ];
  if (metaLine) nodes.push({ text: metaLine, fontSize: 9, color: MUTED, margin: [0, 0, 0, 8] });
  nodes.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: CONTENT_W, y2: 0, lineWidth: 1, lineColor: ACCENT }], margin: [0, 0, 0, 14] });
  return nodes;
}

/* ============================================================
   Rakit docDefinition (MURNI — tanpa network) dari body konten yang sudah jadi.
   Dipisah agar bisa dirender identik di Node (uji layout) & browser.
   ============================================================ */
export function buildDocDefinition({ kind, title, meta, body, downloadedAt } = {}) {
  const reportTitle = String(title || kickerFor(kind));
  const metaLine = buildMetaLine(meta || {});
  const dateStr = fmtDate(downloadedAt || new Date());
  const content = coverHeaderNodes(kind, reportTitle, metaLine).concat(Array.isArray(body) ? body : []);
  const footTitle = truncate(reportTitle, 64);
  return {
    pageSize: 'A4',
    pageMargins: [40, 44, 40, 54],
    info: { title: reportTitle, author: 'PIMAS', creator: 'PIMAS' },
    defaultStyle: { font: 'Roboto', fontSize: 10, color: BODY, lineHeight: 1.35 },
    content,
    header: (currentPage) => (currentPage > 1
      ? {
        columns: [
          { text: 'PIMAS', color: ACCENT, bold: true, fontSize: 8, width: '*' },
          { text: kickerFor(kind), color: MUTED, fontSize: 8, alignment: 'right', width: 'auto' },
        ],
        margin: [40, 22, 40, 0],
      }
      : null),
    footer: (currentPage, pageCount) => ({
      stack: [
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: CONTENT_W, y2: 0, lineWidth: 0.5, lineColor: LINE }], margin: [40, 0, 40, 4] },
        {
          columns: [
            { text: `${footTitle}  ·  Diunduh ${dateStr}`, color: MUTED, fontSize: 8, width: '*' },
            { text: `hal. ${currentPage} / ${pageCount}`, color: MUTED, fontSize: 8, alignment: 'right', width: 'auto' },
          ],
          margin: [40, 0, 40, 0],
        },
      ],
    }),
  };
}

/* ============================================================
   Entry utama — muat mesin + konten, rakit doc, unduh file.
   ============================================================ */
export async function exportReportPdf({ kind, title, meta, md, filename } = {}) {
  const metaObj = meta || {};
  /* muat mesin + konten paralel; salah satu gagal → throw (pemanggil toasts). */
  const [pdfMake, body] = await Promise.all([loadPdfMake(), mdToPdfContent(md)]);
  const docDefinition = buildDocDefinition({ kind, title, meta: metaObj, body });
  const name = filename || safeFileName(metaObj, kind);
  pdfMake.createPdf(docDefinition).download(name);
  return name;
}

/* ============================================================
   Helper UI: kabel tombol [data-pdf] → exportReportPdf (dipakai 3 view).
   Menonaktifkan tombol + label "Menyiapkan…" selama proses, toast saat gagal,
   pulih setelahnya; kebal klik-ganda. `args` boleh objek atau fungsi (lazy).
   Mengembalikan fungsi unbind untuk teardown view.
   ============================================================ */
export function wirePdfButton(el, ctx, args) {
  const btn = el.querySelector('[data-pdf]');
  if (!btn) return () => {};
  const span = btn.querySelector('span');
  const orig = span ? span.textContent : '';
  const origLabel = btn.getAttribute('aria-label');
  const t = ctx.t;
  const onClick = async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    /* label terlihat & nama aksesibel bergerak seiring (WCAG 2.5.3 label-in-name). */
    const busy = t('umum.pdf_menyiapkan');
    if (span) span.textContent = busy;
    if (origLabel != null) btn.setAttribute('aria-label', busy);
    try {
      await ctx.exportReportPdf(typeof args === 'function' ? args() : args);
    } catch {
      ctx.toast(t('umum.pdf_gagal'), 'warn');
    } finally {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      if (span) span.textContent = orig;
      if (origLabel != null) btn.setAttribute('aria-label', origLabel);
    }
  };
  btn.addEventListener('click', onClick);
  return () => btn.removeEventListener('click', onClick);
}
