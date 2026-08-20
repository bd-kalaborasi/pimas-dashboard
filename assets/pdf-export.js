/*
 * PIMAS dashboard — pdf-export.js (ES module, self-contained; TIDAK import app.js
 * agar bebas dependensi siklik). Membangun PDF ber-merek dari markdown laporan
 * PENUH (report_md / md) memakai pdfmake + marked, keduanya dari jsDelivr (pinned)
 * dengan lazy-load termemoisasi. Kegagalan CDN → THROW (pemanggil menampilkan toast).
 *
 * Sumber PDF = markdown laporan penuh, BUKAN kartu/chart terstruktur di layar.
 * Provenance (tabel sumber, seksi Keterbatasan) dijaga utuh — tidak dibuang.
 *
 * Thumbnail produk (opsional, `images`): foto resmi dari situs brand disisipkan ke
 * tabel pemain/produk — paritas dengan kartu "Produk yang ditemukan" di dashboard.
 * Pemuatan gambar bersifat BEST-EFFORT: gagal/lambat/host tanpa CORS → PDF tetap
 * terbit tanpa foto (tak pernah menggagalkan ekspor).
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

/* ============================================================
   TEMA TIPOGRAFI (preset) — sengaja data, bukan angka tersebar
   ============================================================
   Dasar riset redaksi/cetak yang dipakai preset `editorial`:
   - Panjang baris (measure) nyaman 50–75 karakter; ≥90 karakter melelahkan mata.
     Halaman A4 selebar 515pt @10pt ≈ 105 karakter → TERLALU lebar. Solusi grid
     asimetris (pola Canonical A4): PROSA dibatasi kolom sempit, TABEL/gambar tetap
     selebar konten — jadi data padat tak berkorban.
   - Leading 1,4–1,5x ukuran huruf untuk teks panjang (kami 1,45).
   - Ukuran badan teks cetak 10–11pt (kami 10,5pt).
   - Hierarki lewat BOBOT + JARAK, bukan sekadar ukuran; jarak di ATAS judul lebih
     besar daripada di bawahnya agar judul menempel pada teks yang diperkenalkannya.
   - Rata kiri (bukan justify) — tanpa hyphenation, justify menimbulkan "sungai" putih.
   Preset `legacy` = persis tampilan sebelum PR ini (jalur revert cepat saat UAT).

   Cara ganti/revert:
   1. permanen  → ubah TYPO_ACTIVE di bawah (satu baris), publish ulang;
   2. sesaat    → tambahkan `?pdf_typo=legacy` pada URL dashboard (mis.
      https://…/pimas-dashboard/?pdf_typo=legacy#/topik/<slug>) — tanpa deploy;
   3. per-panggilan → exportReportPdf({ …, typo: 'legacy' }).
*/
const THEMES = {
  /* ===== `grid` — hasil metodologi grid-layout-design (kolom + zona + baseline).
     Audit konten (9 laporan topik, 12 dossier, 10 sentimen, 6 digest):
       prosa median 240–340 char/paragraf · TABEL sangat dominan (±10/laporan topik,
       ±14/dossier; median 5 kolom, maksimum 12; sel terpanjang p90 ±257–296 char)
       · list ±21/laporan · kutipan padat di laporan sentimen.
     Karena tabel muncul tiap ±2 paragraf dan butuh 480pt, badan teks DUA KOLOM
     ditolak (tiap tabel akan memaksa span penuh = struktur dilanggar terus-menerus,
     dan pdfmake tak punya mesin alir antar-kolom). Pilihan: COMPOUND GRID —
       9 kolom × 44pt + gutter 12pt = 492pt badan;
       kolom 1–2 (100pt) = jalur judul/marker (side-head, "false margin");
       kolom 3–9 (380pt) = prosa → 71 karakter @11,5pt (rentang nyaman 50–80);
       tabel/garis/gambar = 12 kolom penuh, lebar kolomnya DIKUNCI ke unit grid.
     Padding sel 6+6 = gutter 12 → tepi teks tabel tetap mendarat di garis kolom. ===== */
  grid: {
    fonts: { body: 'PimasSerif', display: 'PimasDisplay' },
    pageMargins: [51.64, 56, 51.64, 56],   /* 595,28 − 2×51,64 = 492 tepat */
    contentW: 492,
    unit: 44,          /* 9 kolom × 44 + 8 gutter × 12 = 492 */
    gutter: 12,
    cols: 9,
    /* Tabel memakai SUB-GRID setengah kolom: 18 slot × langkah 28pt. Kolom tabel
       selebar k slot = 28k − 12; batas antar kolom tetap jatuh di gutter 12pt yang
       dihabiskan padding 6+6. Setengah kolom dipilih karena tabel 6+ kolom tak cukup
       ruang pada 9 slot penuh (kata seperti "positioning" terbelah) — pembagian
       ditambah agar proporsinya jadi bagian sistem, bukan improvisasi. */
    slotStep: 28,
    slots: 18,
    /* Tabel ≥9 kolom TIDAK muat di A4 potret pada ukuran huruf yang masih terbaca
       (10 kolom × ±2 slot = 20 slot > 18). Alih-alih memaksa teks patah di tengah
       kata, tabel seperti itu mendapat HALAMAN MELINTANG sendiri — padanan digital
       dari halaman lipat pada laporan cetak. Sub-grid melintang: 25 slot. */
    wideTable: { minCols: 9, slots: 25 },
    bandW: 100,        /* kolom 1–2 — jalur judul (44+12+44) */
    proseX: 112,       /* 100 + gutter 12 */
    proseW: 380,       /* kolom 3–9 — 71 karakter @11,5pt */
    baseline: 16,
    body: { size: 11.5, lead: 1.391, gap: 8 },        /* 11,5 × 1,391 = 16,0 baseline */
    h1: { size: 19, color: INK, top: 24, bottom: 8, spacing: -0.2, rule: false, side: false },
    h2: { size: 13.5, color: INK, top: 24, bottom: 8, spacing: -0.1, rule: true, side: true },
    /* h3 juga side-head (tanpa garis & tanpa nomor) → SELURUH hierarki judul berbaris
       di tepi kiri, bisa dipindai sekali lihat; zona prosa & tabel tak terganggu. */
    h3: { size: 11, color: ACCENT, top: 16, bottom: 8, spacing: 0, rule: false, side: true },
    h4: { size: 9.5, color: BODY2, top: 12, bottom: 8, spacing: 0.7, caps: true, side: false },
    list: { size: 11.5, lead: 1.35, gap: 8, itemGap: 4 },
    quote: { size: 11, lead: 1.4, pad: 14, bar: 2.5, gap: 12 },
    table: { head: 9, body: 9, tightHead: 8, tightBody: 8, tightCols: 8, padY: 5, headSpacing: 0.3, top: 8, bottom: 12 },
    caption: { size: 8, gap: 12 },
    cover: { title: 24, kicker: 8.5, meta: 9.5, rule: 1, gap: 24 },
    runHead: { size: 8 },
    foot: { size: 8 },
  },
  editorial: {
    pageMargins: [70, 54, 70, 56],
    contentW: 455,          /* 595,28 − 70 − 70 */
    proseW: 392,            /* ≈76 karakter @10,5pt — inti perbaikan keterbacaan */
    body: { size: 10.5, lead: 1.45, gap: 9 },
    h1: { size: 20, color: INK, top: 16, bottom: 8, spacing: -0.2, rule: false },
    h2: { size: 14, color: ACCENT, top: 22, bottom: 7, spacing: 0, rule: true },
    h3: { size: 11.5, color: INK, top: 16, bottom: 5, spacing: 0, rule: false },
    h4: { size: 9.5, color: BODY2, top: 13, bottom: 4, spacing: 0.7, caps: true },
    list: { size: 10.5, lead: 1.42, gap: 10, itemGap: 3 },
    quote: { size: 10.5, lead: 1.45, pad: 12, bar: 2.5, gap: 12 },
    table: { head: 8.5, body: 8.5, padY: 5, headSpacing: 0.25, top: 6, bottom: 12 },
    caption: { size: 7.5, gap: 12 },
    cover: { title: 21, kicker: 8, meta: 9, rule: 1, gap: 18 },
    runHead: { size: 8 },
    foot: { size: 8 },
  },
  compact: {
    /* jalan tengah: lebih rapat dari `editorial` (hemat halaman) tetapi tetap
       memakai pembatas lebar-baca & hierarki barunya. */
    pageMargins: [58, 48, 58, 52],
    contentW: 479,
    proseW: 430,            /* ≈84 karakter @10pt */
    body: { size: 10, lead: 1.4, gap: 7 },
    h1: { size: 18, color: INK, top: 14, bottom: 7, spacing: -0.2, rule: false },
    h2: { size: 13, color: ACCENT, top: 18, bottom: 6, spacing: 0, rule: true },
    h3: { size: 11, color: INK, top: 13, bottom: 4, spacing: 0, rule: false },
    h4: { size: 9.5, color: BODY2, top: 11, bottom: 3, spacing: 0.7, caps: true },
    list: { size: 10, lead: 1.38, gap: 8, itemGap: 2 },
    quote: { size: 10, lead: 1.4, pad: 11, bar: 2.5, gap: 10 },
    table: { head: 8.5, body: 8.5, padY: 4, headSpacing: 0.25, top: 5, bottom: 10 },
    caption: { size: 7.5, gap: 10 },
    cover: { title: 19, kicker: 8, meta: 9, rule: 1, gap: 16 },
    runHead: { size: 8 },
    foot: { size: 8 },
  },
  legacy: {
    pageMargins: [40, 44, 40, 54],
    contentW: 515,
    proseW: 0,              /* 0 = prosa selebar konten (perilaku lama) */
    body: { size: 10, lead: 1.35, gap: 6 },
    h1: { size: 17, color: INK, top: 12, bottom: 6, spacing: 0, rule: false },
    h2: { size: 14, color: ACCENT, top: 12, bottom: 5, spacing: 0, rule: false },
    h3: { size: 12, color: INK, top: 10, bottom: 4, spacing: 0, rule: false },
    h4: { size: 12, color: INK, top: 10, bottom: 4, spacing: 0, caps: false },
    list: { size: 10, lead: 1.3, gap: 8, itemGap: 0 },
    quote: { size: 10, lead: 1.35, pad: 12, bar: 3, gap: 8 },
    table: { head: 8.5, body: 8.5, padY: 4, headSpacing: 0, top: 4, bottom: 10 },
    caption: { size: 7.5, gap: 10 },
    cover: { title: 16, kicker: 8, meta: 9, rule: 1, gap: 14 },
    runHead: { size: 8 },
    foot: { size: 8 },
  },
};

/* preset aktif. Ganti ke 'editorial' (versi PR #165), 'compact', atau 'legacy'
   (tampilan pra-PR #165) untuk revert menyeluruh. */
const TYPO_ACTIVE = 'grid';

/* nama preset → objek tema; input tak dikenal → preset aktif (fail-safe). */
export function resolveTheme(name) {
  if (name && Object.prototype.hasOwnProperty.call(THEMES, name)) return THEMES[name];
  return THEMES[TYPO_ACTIVE] || THEMES.editorial;
}

/* override sesaat lewat query string (butir 2) — hanya nama preset yang dikenal. */
function themeFromLocation() {
  try {
    if (typeof location === 'undefined' || !location.search) return null;
    const v = new URLSearchParams(location.search).get('pdf_typo');
    return (v && Object.prototype.hasOwnProperty.call(THEMES, v)) ? v : null;
  } catch { return null; }
}

/* opts → opts ternormalisasi yang PASTI membawa .T (tema). Dipanggil sekali di pintu
   masuk; seluruh fungsi blok tinggal membaca opts.T. */
function withTheme(opts) {
  const o = opts && typeof opts === 'object' ? { ...opts } : {};
  if (!o.T) o.T = resolveTheme(o.typo || themeFromLocation());
  return o;
}

/* ===== thumbnail produk =====
   THUMB_PX  : sisi terpanjang bitmap yang di-embed (≈4x ukuran cetak 40pt → tajam di
               layar & print, tetap ringan: JPEG q0.82 ~8-15KB per foto).
   *_W / *_FIT: lebar kolom & kotak muat. Varian TIGHT dipakai pada tabel lebar
               (≥7 kolom, mis. §7 "Produk Ditemukan") agar kolom teks tak tergencet. */
const THUMB_PX = 190;
const THUMB_COL_W = 46;
const THUMB_FIT = 40;
const THUMB_COL_W_TIGHT = 38;
const THUMB_FIT_TIGHT = 32;
const THUMB_TIGHT_COLS = 7;
/* batas jumlah foto per PDF (jaga ukuran file) & batas tunggu per gambar. */
const THUMB_MAX = 12;
const THUMB_TIMEOUT_MS = 9000;

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
function softBreak(s) {
  let out = String(s == null ? '' : s);
  out = out.replace(/([/.\-?&=_,;])/g, '$1​');
  out = out.replace(/[^\s​]{40,}/g, (m) => m.replace(/(.{40})/g, '$1​'));
  return out;
}
function breakable(s) { return softBreak(clean(s)); }

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
/* penanda headlineLevel untuk elemen hiasan judul (garis) — bukan level judul nyata. */
const HL_ATTACHED = 90;

/* prosa dibatasi lebar-baca (measure). Tabel/gambar TIDAK lewat sini — mereka tetap
   selebar konten. proseW=0 → tanpa pembatas (preset legacy). */
function proseWrap(node, T, opts) {
  if (!node) return node;
  /* di dalam blok side-head, lebar sudah ditentukan kolom induk → jangan bungkus lagi. */
  if (opts && opts.raw) return node;
  if (!T.proseW || T.proseW >= T.contentW) return node;
  const inner = { ...node };
  const margin = Array.isArray(inner.margin) ? inner.margin.slice() : [0, 0, 0, 0];
  delete inner.margin;
  /* margin kiri = indent zona prosa (kolom 4–12); 0 pada preset lama. */
  return {
    columns: [{ width: T.proseW, ...inner }],
    columnGap: 0,
    margin: [(T.proseX || 0) + (margin[0] || 0), margin[1] || 0, margin[2] || 0, margin[3] || 0],
  };
}

/* h1..h4 — hierarki lewat ukuran + bobot + warna + JARAK (atas > bawah).
   Pada preset `grid`, h2 menjadi SIDE-HEAD: garis penuh 12 kolom sebagai flowline
   pembuka babak, lalu judul duduk di jalur kolom 1–3 sementara teks pertama seksi
   mengalir di kolom 4–12. Pembaca bisa memindai seluruh judul di tepi kiri halaman —
   wayfinding yang mahal harganya untuk laporan 15+ halaman. */

/* nomor seksi ("4. Pemain (ID & Luar)") dipisah agar bisa dicetak dengan huruf display. */
export function splitSectionNumber(text) {
  const m = /^\s*(\d{1,2})[.)]\s+(.*)$/.exec(String(text == null ? '' : text));
  return m ? { num: m[1], rest: m[2] } : { num: '', rest: String(text == null ? '' : text) };
}

function headingTextNode(token, spec, T) {
  const runs = textRuns(token, {});
  let text = runs === '' ? clean(token.text) : runs;
  if (spec.caps) {
    text = Array.isArray(text)
      ? text.map((r) => (r && typeof r.text === 'string' ? { ...r, text: r.text.toUpperCase() } : r))
      : String(text).toUpperCase();
  }
  const node = { text, bold: true, fontSize: spec.size, color: spec.color, lineHeight: 1.2 };
  if (spec.spacing) node.characterSpacing = spec.spacing;
  if (T.fonts && T.fonts.body) node.font = T.fonts.body;
  return node;
}

/* judul di jalur kiri + isi seksi di zona prosa; dipakai HANYA bila tema punya bandW. */
function sideHeadNode(token, o, spec, depth, bodyNodes) {
  const T = o.T;
  const plain = clean(token.text || '');
  const { num, rest } = splitSectionNumber(plain);
  const bandStack = [];
  if (num) {
    bandStack.push({
      text: num,
      font: (T.fonts && T.fonts.display) || undefined,
      fontSize: spec.size * 1.55,
      color: ACCENT,
      lineHeight: 1,
      margin: [0, 0, 0, 6],
    });
  }
  const titleToken = num ? { ...token, text: rest, tokens: null } : token;
  bandStack.push(headingTextNode(titleToken, spec, T));
  const body = (bodyNodes && bodyNodes.length) ? bodyNodes : [{ text: '' }];
  const inner = [];
  if (spec.rule) {
    inner.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: T.contentW, y2: 0, lineWidth: 0.75, lineColor: LINE }], margin: [0, 0, 0, 10], headlineLevel: HL_ATTACHED });
  }
  return {
    headlineLevel: depth,
    margin: [0, spec.top, 0, spec.bottom],
    stack: inner.concat([
      {
        columns: [
          { width: T.bandW, stack: bandStack },
          { width: T.gutter, text: '' },
          { width: T.proseW, stack: body },
        ],
        columnGap: 0,
      },
    ]),
  };
}

function headingNode(token, o) {
  const T = o.T;
  const depth = Math.min(Math.max(token.depth || 1, 1), 4);
  const spec = T[`h${depth}`] || T.h3;
  const node = { ...headingTextNode(token, spec, T), margin: [0, spec.top, 0, spec.bottom] };
  node.headlineLevel = depth;
  if (spec.side && T.bandW) return sideHeadNode(token, o, spec, depth, null);
  if (!spec.rule) {
    const wrapped = proseWrap(node, T, o);
    if (wrapped !== node) wrapped.headlineLevel = depth;
    return wrapped;
  }
  const ruleW = T.proseW || T.contentW;
  /* HL_ATTACHED = penanda "elemen milik judul" (garis). pageBreakBefore memakainya
     untuk membedakan "ada isi setelah judul" vs "cuma hiasan judul". */
  return {
    stack: [
      { ...node, margin: [0, spec.top, 0, 4] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: ruleW, y2: 0, lineWidth: 0.75, lineColor: LINE }], margin: [0, 0, 0, spec.bottom], headlineLevel: HL_ATTACHED },
    ],
  };
}

function paragraphNode(token, o) {
  const T = (o && o.T) || resolveTheme();
  const runs = textRuns(token, {});
  if (runs === '' || (Array.isArray(runs) && runs.length === 0)) return null;
  return proseWrap({
    text: runs,
    fontSize: T.body.size,
    lineHeight: T.body.lead,
    color: BODY,
    margin: [0, 0, 0, T.body.gap],
  }, T, o);
}

function listItemContent(item, opts) {
  const parts = [];
  for (const tk of (item.tokens || [])) {
    if (!tk) continue;
    if (tk.type === 'text') {
      const runs = textRuns(tk, {});
      parts.push({ text: runs === '' ? clean(tk.text) : runs, margin: [0, 0, 0, 0] });
    } else if (tk.type === 'list') {
      parts.push(listNode(tk, opts));
    } else {
      parts.push(...blockToNodes(tk, opts));
    }
  }
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return { stack: parts };
}

function listNode(token, o) {
  const T = o.T;
  const key = token.ordered ? 'ol' : 'ul';
  const items = (token.items || []).map((it) => listItemContent(it, o));
  const node = {
    [key]: items,
    markerColor: ACCENT,
    fontSize: T.list.size,
    color: BODY,
    lineHeight: T.list.lead,
    margin: [0, 2, 0, T.list.gap],
  };
  if (T.list.itemGap) node.separatorSpacing = T.list.itemGap;
  if (token.ordered && token.start && token.start !== 1) node.start = token.start;
  return proseWrap(node, T, o);
}

/* kutipan: batang aksen + latar tipis, dibatasi lebar-baca seperti prosa. */
function blockquoteNode(token, o) {
  const T = o.T;
  const inner = [];
  for (const tk of (token.tokens || [])) {
    if (!tk) continue;
    if (tk.type === 'paragraph' || tk.type === 'text') {
      const runs = textRuns(tk, { italics: true, color: BODY2 });
      inner.push({
        text: runs === '' ? clean(tk.text) : runs,
        italics: true,
        color: BODY2,
        fontSize: T.quote.size,
        lineHeight: T.quote.lead,
        margin: [0, 0, 0, 4],
      });
    } else {
      inner.push(...blockToNodes(tk, o));
    }
  }
  const node = {
    table: { widths: ['*'], body: [[{ stack: inner.length ? inner : [{ text: '' }] }]] },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: (i) => (i === 0 ? T.quote.bar : 0),
      vLineColor: () => ACCENT,
      fillColor: () => SURFACE_TINT,
      paddingLeft: () => T.quote.pad,
      paddingRight: () => T.quote.pad - 2,
      paddingTop: () => 7,
      paddingBottom: () => 7,
    },
    margin: [0, 4, 0, T.quote.gap],
  };
  return proseWrap(node, T, o);
}

/* ============================================================
   Thumbnail produk — pencocokan baris tabel ↔ foto (MURNI, tanpa network)
   ============================================================ */

/* kunci pencocokan: huruf-kecil, hanya alfanumerik (buang spasi/tanda baca/kurung)
   → "Kodiak Cakes" == "kodiakcakes", "RXBAR (Kellanova/Mars)" == "rxbarkellanovamars". */
function normKey(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/* Cari foto yang cocok untuk sebuah NAMA baris tabel (bukan prosa). Cocok bila kunci
   nama baris sama-dengan / memuat / dimuat-oleh kunci brand ATAU nama produk, dengan
   dua rem anti cocok-palsu: (a) kunci ≥4 karakter, (b) panjang kedua sisi harus
   sebanding — sel prosa panjang yang kebetulan menyebut brand ("Purely Elizabeth
   diakuisisi Ferrero \$850 juta …") DITOLAK. Kandidat terpanjang menang: "Catalina
   Crunch" lebih spesifik dari "Catalina". Mengembalikan null bila tak ada. */
export function pickThumb(rowText, thumbs) {
  const k = normKey(rowText);
  if (!k || k.length < 4 || k.length > 72 || !Array.isArray(thumbs)) return null;
  let best = null;
  let bestLen = 0;
  for (const th of thumbs) {
    if (!th || !th.image) continue;
    for (const cand of [th.brand, th.nama]) {
      const c = normKey(cand);
      if (!c || c.length < 4) continue;
      const hit = c === k
        || (k.includes(c) && k.length <= c.length * 1.6 + 6)
        || (c.includes(k) && c.length <= k.length * 2.5 + 8);
      if (hit && c.length > bestLen) {
        best = th;
        bestLen = c.length;
      }
    }
  }
  return best;
}

/* header kolom foto yang SUDAH ada di markdown (mis. §7 "Gambar" berisi placeholder
   "— (akan di-fetch)") → isinya DIGANTI thumbnail, bukan menambah kolom baru. */
const RE_IMG_HEAD = /^(gambar|foto|image|thumbnail|thumb)$/;
/* kolom yang dipakai sebagai nama untuk pencocokan produk. */
const RE_NAME_HEAD = /nama|produk|brand|merek|pemain|player/;

/* sel foto (atau sel kosong bila baris ini tak punya foto). */
function thumbCell(th, tight) {
  const fit = tight ? THUMB_FIT_TIGHT : THUMB_FIT;
  return th ? { image: th.image, fit: [fit, fit], alignment: 'center' } : { text: '' };
}

/* baris atribusi di bawah tabel ber-foto (kepatuhan lisensi — sejajar caption
   "Sumber gambar · Lisensi …" di dashboard). */
function thumbAttribNode(used, T) {
  const lisensi = [...new Set(used.map((t) => String(t.lisensi || '').trim()).filter(Boolean))].join(', ');
  const tanggal = used.map((t) => String(t.tanggal || '').trim()).filter(Boolean).sort().pop();
  const parts = ['Foto produk: situs resmi masing-masing brand'];
  if (lisensi) parts.push(`lisensi ${lisensi}`);
  if (tanggal) parts.push(`diakses ${fmtDate(tanggal)}`);
  return { text: `${parts.join(' · ')}.`, fontSize: T.caption.size, italics: true, color: MUTED, margin: [0, 0, 0, T.caption.gap] };
}

/* lebar kolom — SELALU angka konkret (tak pernah '*'). '*' di pdfmake tidak pernah
   menyusut di bawah lebar-minimum isi sel, sehingga tabel lebar (mis. §7 "Produk
   Ditemukan", 10 kolom) MELUBER keluar halaman & kolom terakhir terpotong. Dengan
   lebar eksplisit, teks dipaksa membungkus dan tabel selalu muat.
   Aturan: kolom pendek diberi lebar tetap (Tier 28pt, tanggal 64pt); sisanya berbagi
   lebar tersisa secara BERBOBOT (kolom berisi teks panjang dapat porsi lebih besar,
   diredam pangkat 0,75 agar kolom pendek tak tergencet), dengan lantai MIN_FLEX_W. */
const CONTENT_W_FALLBACK = 515;
const A4_LONG = 841.89;   /* sisi panjang A4 — lebar halaman saat melintang */
const CELL_PAD_X = 12;        /* paddingLeft+Right normal (6+6) */
const CELL_PAD_X_TIGHT = 6;   /* tabel banyak-kolom: 3+3, tebus ~60pt utk isi */
const TIGHT_PAD_COLS = 8;     /* mulai berapa kolom padding diringkas */
const MIN_FLEX_W = 34;        /* lantai lebar kolom fleksibel (pt) */

/* padding horizontal per sel menurut jumlah kolom — dipakai layout tabel DAN
   perhitungan lebar; keduanya WAJIB memakai angka yang sama agar total tetap muat. */
function cellPadX(nCols) { return nCols >= TIGHT_PAD_COLS ? CELL_PAD_X_TIGHT : CELL_PAD_X; }

/* rerata panjang teks per kolom (header ikut dihitung, di-cap agar sel raksasa tak
   memonopoli lebar). Deterministik — tanpa pengukuran font. */
function colWeight(header, rows, c) {
  const vals = [String((header[c] && header[c].text) || '')]
    .concat(rows.map((r) => String((r[c] && r[c].text) || '')));
  /* cap 160 & eksponen 0,85: kolom prosa panjang ("Catatan") harus menang telak atas
     kolom pendek, tetapi tetap diredam supaya kolom pendek tak tergencet habis. */
  const avg = vals.reduce((a, v) => a + Math.min(v.trim().length, 160), 0) / (vals.length || 1);
  return Math.pow(Math.max(3, avg), 0.85);
}

/* lantai lebar per kolom: kira-kira selebar kata TERPANJANG yang tak bisa dipatah
   (softBreak sudah menyisipkan peluang-putus setelah tanda baca & tiap 40 char), agar
   header seperti "Candidate" tidak terbelah di tengah kata. ~4,7pt/karakter @8,5pt. */
const CHAR_W = 4.7;
const MAX_FLOOR_W = 72;
function colFloor(header, rows, c) {
  const vals = [String((header[c] && header[c].text) || '')]
    .concat(rows.map((r) => String((r[c] && r[c].text) || '')));
  let longest = 0;
  for (const v of vals) {
    for (const word of v.split(/\s+/)) {
      /* potong seperti softBreak: setelah / . - ? & = _ , ; dan tiap 40 char */
      for (const piece of word.split(/(?<=[/.\-?&=_,;])/)) {
        longest = Math.max(longest, Math.min(piece.length, 40));
      }
    }
  }
  return Math.max(MIN_FLEX_W, Math.min(MAX_FLOOR_W, Math.ceil(longest * CHAR_W)));
}

/* bagi `avail` pt ke kolom fleksibel sesuai bobot, menghormati lantai per kolom.
   Kolom yang jatuh di bawah lantainya dikunci ke lantai, sisanya dibagi ulang.
   Bila total lantai melebihi ruang, semua lantai diskalakan turun (tetap muat). */
function distributeWidths(avail, weights, floors) {
  const n = weights.length;
  let fl = floors.slice();
  const flSum = fl.reduce((a, b) => a + b, 0);
  if (flSum > avail) { const k = avail / flSum; fl = fl.map((v) => v * k); }
  const out = new Array(n).fill(0);
  let active = weights.map((_, i) => i);
  let remaining = avail;
  for (let guard = 0; guard <= n; guard++) {
    const wSum = active.reduce((a, i) => a + weights[i], 0) || active.length;
    for (const i of active) out[i] = remaining * (weights[i] / wSum);
    const below = active.filter((i) => out[i] < fl[i]);
    if (!below.length) break;
    for (const i of below) { out[i] = fl[i]; remaining -= fl[i]; }
    active = active.filter((i) => !below.includes(i));
    if (!active.length) break;
  }
  const rounded = out.map((v) => Math.max(1, Math.floor(v)));
  /* pembulatan ke bawah → sisa beberapa pt; berikan ke kolom terlebar (tetap ≤ avail). */
  const slack = Math.floor(avail) - rounded.reduce((a, b) => a + b, 0);
  if (slack > 0) {
    let widest = 0;
    for (let i = 1; i < rounded.length; i++) if (rounded[i] > rounded[widest]) widest = i;
    rounded[widest] += slack;
  }
  return rounded;
}

/* ===== lebar kolom tabel yang DIKUNCI ke grid (preset dengan T.unit) =====
   Kolom ke-i mendapat u_i unit; lebar isinya = 29·u + 12·(u−1) = 41u − 12, dan batas
   antar kolom persis jatuh di gutter 12pt yang dihabiskan padding 6+6. Tepi luar tanpa
   padding sehingga teks kolom pertama/terakhir mendarat tepat di tepi badan.
   Σu = 12 → tabel selalu selebar badan, tak pernah meluber. */
export function allocUnits(weights, floorsUnits, totalUnits) {
  const n = weights.length;
  if (!n) return [];
  const mins = floorsUnits.map((f) => Math.max(1, Math.min(f, totalUnits)));
  let sum = mins.reduce((a, b) => a + b, 0);
  const units = mins.slice();
  /* lantai tak muat → kecilkan kolom terbesar sampai pas (tabel sangat lebar). */
  while (sum > totalUnits) {
    let idx = 0;
    for (let i = 1; i < n; i++) if (units[i] > units[idx]) idx = i;
    if (units[idx] <= 1) break;
    units[idx] -= 1;
    sum -= 1;
  }
  /* sisa unit dibagi ke kolom dengan kebutuhan (bobot) terbesar per unit. */
  const wSum = weights.reduce((a, b) => a + b, 0) || n;
  let left = totalUnits - sum;
  while (left > 0) {
    let idx = 0;
    let best = -Infinity;
    for (let i = 0; i < n; i++) {
      const want = (weights[i] / wSum) * totalUnits;
      const deficit = want - units[i];
      if (deficit > best) { best = deficit; idx = i; }
    }
    units[idx] += 1;
    left -= 1;
  }
  return units;
}

/* Lantai kolom dalam UNIT grid. "Atom" = kata yang tak boleh dipatah: kata pendek
   (≤12 char, mis. tanggal 2026-08-20) utuh; kata panjang (URL) boleh patah di tanda
   baca karena softBreak menyisipkan peluang-putus di sana. Lantai maksimum 4 unit —
   satu kolom tak boleh menyandera sepertiga tabel hanya karena satu kata panjang. */
const TABLE_CHAR_W = 4.3;   /* ≈ lebar rata-rata karakter Source Serif 9pt */
const FLOOR_UNIT_MAX = 7;   /* dalam slot setengah-kolom */
export function colFloorUnits(header, rows, c, T, stepOverride) {
  const vals = [String((header[c] && header[c].text) || '')]
    .concat(rows.map((r) => String((r[c] && r[c].text) || '')));
  let longest = 0;
  for (const v of vals) {
    for (const word of v.split(/\s+/)) {
      if (!word) continue;
      const atoms = word.length <= 12 ? [word] : word.split(/(?<=[/.\-?&=_,;])/);
      for (const a of atoms) longest = Math.max(longest, Math.min(a.length, 40));
    }
  }
  const px = longest * TABLE_CHAR_W;
  const u = Math.ceil((px + T.gutter) / (stepOverride || T.slotStep));
  return Math.max(1, Math.min(FLOOR_UNIT_MAX, u));
}

/* langkah slot = (lebar konten + gutter) / jumlah slot → Σ(step·k − 12) + 12(n−1)
   selalu = lebar konten, berapa pun jumlah kolomnya. */
function slotStepFor(contentW, slots, gutter) { return (contentW + gutter) / slots; }

/* header/rows → {widths, units} pada grid; fixedUnits[i] memaksa jumlah unit kolom i. */
function gridColWidths(header, rows, T, fixedUnits, geo) {
  const G = geo || { step: T.slotStep, slots: T.slots };
  const n = header.length;
  const weights = [];
  const floors = [];
  for (let c = 0; c < n; c++) {
    if (fixedUnits && typeof fixedUnits[c] === 'number') {
      weights.push(0.0001);
      floors.push(fixedUnits[c]);
      continue;
    }
    weights.push(colWeight(header, rows, c));
    floors.push(colFloorUnits(header, rows, c, T, G.step));
  }
  const units = allocUnits(weights, floors, G.slots);
  return { units, widths: units.map((u) => G.step * u - T.gutter) };
}

/* header[] & rows[] token marked → array lebar (angka pt), total ≤ lebar konten.
   `fixedW` (opsional) memaksa lebar kolom tertentu (mis. kolom foto). */
function computeColWidths(header, rows, fixedW, contentW) {
  const n = header.length;
  const padX = cellPadX(n);
  const CW = typeof contentW === 'number' ? contentW : CONTENT_W_FALLBACK;
  const widths = new Array(n).fill(null);
  for (let c = 0; c < n; c++) {
    if (fixedW && typeof fixedW[c] === 'number') { widths[c] = fixedW[c]; continue; }
    const h = String((header[c] && header[c].text) || '').toLowerCase().trim();
    const vals = rows.map((r) => String((r[c] && r[c].text) || '').trim()).filter(Boolean);
    const allTier = vals.length > 0 && vals.every((v) => /^t[1-5]$/i.test(v));
    /* lebar tetap sempit HANYA bila isinya memang pendek. Header gabungan seperti
       "Metode · Tier" yang berisi kalimat TIDAK boleh dikunci 28pt (dulu terpotong
       jadi "sumbe r- langsu ng"). */
    if (allTier || (/^tier$/.test(h) && vals.every((v) => v.length <= 6))) { widths[c] = 28; continue; }
    if (/tanggal|akses|\bdate\b|tgl/.test(h) && vals.every((v) => v.length <= 24)) { widths[c] = 64; continue; }
  }
  const flex = [];
  let fixedSum = 0;
  for (let c = 0; c < n; c++) {
    if (widths[c] === null) flex.push(c);
    else fixedSum += widths[c];
  }
  const avail = CW - (n * padX) - fixedSum;
  if (!flex.length) return widths;
  if (avail <= flex.length) {
    /* ruang habis (kolom sangat banyak) — bagi rata apa adanya, jangan sampai negatif. */
    const each = Math.max(1, Math.floor(Math.max(0, CW - n * padX) / n));
    return widths.map((w) => (w === null ? each : w));
  }
  const shares = distributeWidths(
    avail,
    flex.map((c) => colWeight(header, rows, c)),
    flex.map((c) => colFloor(header, rows, c)),
  );
  flex.forEach((c, i) => { widths[c] = shares[i]; });
  return widths;
}

/* Sel tabel di-render dari token INLINE (bukan flatten cell.text) agar link
   markdown tetap membawa run.link → bisa diklik/ctrl+klik di PDF viewer.
   softBreak diterapkan per-run (teks sudah clean() di inlineRuns) supaya URL
   panjang tetap patah rapi di dalam sel tanpa merusak target link. */
function cellRuns(cell) {
  const toks = (cell && cell.tokens && cell.tokens.length) ? cell.tokens : null;
  if (!toks) return breakable(cell && cell.text);
  const runs = inlineRuns(toks, {});
  if (!runs || !runs.length) return breakable(cell && cell.text);
  return runs.map((r) => (r && typeof r === 'object' && typeof r.text === 'string' && !r.text.includes('\n')
    ? { ...r, text: softBreak(r.text) }
    : r));
}

/* Tabel → [node tabel] atau [node tabel, baris atribusi foto].
   Bila `opts.thumbs` berisi foto produk yang cocok dengan baris tabel:
   - tabel yang SUDAH punya kolom foto (header "Gambar"/"Foto") → sel diganti gambar;
   - selain itu kolom "Foto" DISISIPKAN di paling kiri (pola kartu dashboard: foto → nama).
   Kolom hanya ditambahkan bila ADA minimal satu baris yang cocok (hindari kolom kosong).
   dontBreakRows dinyalakan pada tabel ber-foto supaya gambar tak terpisah dari barisnya. */
function tableNodes(token, opts) {
  const T = opts.T;
  const header = Array.isArray(token.header) ? token.header : [];
  const rows = Array.isArray(token.rows) ? token.rows : [];
  if (!header.length) return [paragraphNode({ text: clean(token.raw || '') }, opts)].filter(Boolean);

  /* --- pencocokan thumbnail (no-op bila opts.thumbs kosong) --- */
  const thumbs = (opts && Array.isArray(opts.thumbs)) ? opts.thumbs.filter((t) => t && t.image) : [];
  const headTxt = header.map((h) => String((h && h.text) || '').toLowerCase().trim());
  const imgCol = headTxt.findIndex((h) => RE_IMG_HEAD.test(h));
  let nameCol = headTxt.findIndex((h, i) => i !== imgCol && RE_NAME_HEAD.test(h));
  /* tanpa kolom nama eksplisit, tabel hanya di-foto bila ia memang punya kolom gambar
     (mis. §7). Tabel prosa ("Poin | Detail | …") sengaja dilewati — kolom pertamanya
     kalimat, bukan nama produk → sumber cocok-palsu. */
  if (nameCol < 0) nameCol = imgCol >= 0 ? (imgCol === 0 ? 1 : 0) : -1;
  const picks = (thumbs.length && nameCol >= 0 && nameCol < header.length)
    ? rows.map((r) => pickThumb(r[nameCol] && r[nameCol].text, thumbs))
    : [];
  const used = picks.filter(Boolean);
  const withThumbs = used.length > 0;
  const tight = header.length >= THUMB_TIGHT_COLS;
  const thumbW = tight ? THUMB_COL_W_TIGHT : THUMB_COL_W;

  /* lebar dihitung SETELAH tahu ada/tidaknya kolom foto agar total tetap ≤ lebar konten. */
  let widths;
  /* Tabel dengan kolom LEBIH BANYAK dari slot grid (mis. §7 "Produk Ditemukan", 10
     kolom pada grid 9) tak bisa dipetakan 1 kolom ≥1 unit — untuk kasus itu kembali
     ke pembagian berbobot yang selalu muat. Deviasi ini disengaja & terbatas. */
  const totalCols = header.length + ((withThumbs && imgCol < 0) ? 1 : 0);
  const gridMode = !!(T.slotStep && T.slots) && totalCols <= T.slots;
  const thumbUnits = 2;   /* 2 slot */
  /* tabel sangat lebar → halaman melintang sendiri (lihat catatan di tema). */
  const wide = !!(gridMode && T.wideTable && totalCols >= T.wideTable.minCols);
  const geo = wide
    ? (() => {
      const [mL, , mR] = T.pageMargins;
      const w = A4_LONG - mL - mR;
      return { contentW: w, slots: T.wideTable.slots, step: slotStepFor(w, T.wideTable.slots, T.gutter) };
    })()
    : { contentW: T.contentW, slots: T.slots, step: T.slotStep };
  if (gridMode) {
    if (withThumbs && imgCol >= 0) {
      const fx = []; fx[imgCol] = thumbUnits;
      widths = gridColWidths(header, rows, T, fx, geo).widths;
    } else if (withThumbs) {
      const blank = { text: '' };
      widths = gridColWidths([blank].concat(header), rows.map((r) => [blank].concat(r)), T, [thumbUnits], geo).widths;
    } else {
      widths = gridColWidths(header, rows, T, null, geo).widths;
    }
  } else if (withThumbs && imgCol >= 0) {
    const fixedW = []; fixedW[imgCol] = thumbW;
    widths = computeColWidths(header, rows, fixedW, T.contentW);
  } else if (withThumbs) {
    const blank = { text: '' };
    widths = computeColWidths([blank].concat(header), rows.map((r) => [blank].concat(r)), [thumbW], T.contentW);
  } else {
    widths = computeColWidths(header, rows, null, T.contentW);
  }

  const tightType = !!(T.table.tightCols && header.length >= T.table.tightCols);
  const headSize = tightType && T.table.tightHead ? T.table.tightHead : T.table.head;
  const bodySize = tightType && T.table.tightBody ? T.table.tightBody : T.table.body;
  const headRow = header.map((cell) => ({
    text: cellRuns(cell),
    bold: true,
    fontSize: headSize,
    color: INK,
    alignment: alignOf(cell),
    ...(T.table.headSpacing ? { characterSpacing: T.table.headSpacing } : {}),
  }));
  const bodyRows = rows.map((row) => header.map((_, c) => {
    const cell = row[c] || { text: '' };
    return {
      text: cellRuns(cell),
      fontSize: bodySize,
      color: BODY,
      alignment: alignOf(cell),
    };
  }));

  if (withThumbs && imgCol >= 0) {
    /* kolom foto sudah ada di markdown → ganti isinya (placeholder teks dibuang). */
    bodyRows.forEach((r, i) => { r[imgCol] = thumbCell(picks[i], tight); });
  } else if (withThumbs) {
    /* sisipkan kolom foto di paling kiri (pola kartu dashboard: foto → nama). */
    headRow.unshift({ text: 'Foto', bold: true, fontSize: headSize, color: INK, alignment: 'left', ...(T.table.headSpacing ? { characterSpacing: T.table.headSpacing } : {}) });
    bodyRows.forEach((r, i) => { r.unshift(thumbCell(picks[i], tight)); });
  }

  const nCols = headRow.length;
  const padHalf = gridMode ? T.gutter / 2 : cellPadX(nCols) / 2;
  /* tepi luar tanpa padding → teks kolom pertama/terakhir mendarat tepat di tepi badan. */
  const padL = gridMode ? ((i) => (i === 0 ? 0 : padHalf)) : (() => padHalf);
  const padR = gridMode ? ((i) => (i === nCols - 1 ? 0 : padHalf)) : (() => padHalf);
  const node = {
    table: { headerRows: 1, dontBreakRows: withThumbs, widths, body: [headRow, ...bodyRows] },
    layout: {
      hLineWidth: (i, n) => ((i === 0 || i === 1 || i === n.table.body.length) ? 0.75 : 0.5),
      vLineWidth: () => 0,
      hLineColor: () => LINE,
      fillColor: (rowIndex) => (rowIndex === 0 ? SURFACE : (rowIndex % 2 === 0 ? SURFACE_TINT : null)),
      paddingLeft: (i) => padL(i),
      paddingRight: (i) => padR(i),
      paddingTop: () => T.table.padY,
      paddingBottom: () => T.table.padY,
    },
    margin: [0, T.table.top, 0, withThumbs ? 3 : T.table.bottom],
  };
  const out = withThumbs ? [node, thumbAttribNode(used, T)] : [node];
  if (!wide) return out;
  /* pindah ke halaman melintang sebelum tabel, kembali ke potret sesudahnya. */
  return [{ text: '', pageBreak: 'before', pageOrientation: 'landscape' }]
    .concat(out)
    .concat([{ text: '', pageBreak: 'before', pageOrientation: 'portrait' }]);
}

function hrNode(o) {
  return {
    canvas: [{ type: 'line', x1: 0, y1: 0, x2: o.T.contentW, y2: 0, lineWidth: 0.75, lineColor: LINE }],
    margin: [0, 10, 0, 12],
  };
}

function codeNode(token, o) {
  return {
    table: { widths: ['*'], body: [[{ text: decode(token.text || ''), fontSize: o.T.table.body, color: BODY2, preserveLeadingSpaces: true, lineHeight: 1.3 }]] },
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

/* paragraf polos (fallback token tak dikenal) — tetap ikut tema. */
function plainBlock(text, o) {
  const T = (o && o.T) || resolveTheme();
  return proseWrap({ text, fontSize: T.body.size, lineHeight: T.body.lead, color: BODY, margin: [0, 0, 0, T.body.gap] }, T, o);
}

/* satu token blok → array node pdfmake. TIDAK PERNAH throw (fallback paragraf). */
function blockToNodes(token, opts) {
  if (!token || typeof token !== 'object') return [];
  if (!opts || !opts.T) opts = withTheme(opts);
  try {
    switch (token.type) {
      case 'heading': return [headingNode(token, opts)];
      case 'paragraph': {
        const n = paragraphNode(token, opts);
        return n ? [n] : [];
      }
      case 'text': {
        const n = paragraphNode(token, opts);
        return n ? [n] : [];
      }
      case 'list': return [listNode(token, opts)];
      case 'blockquote': return [blockquoteNode(token, opts)];
      case 'table': return tableNodes(token, opts);
      case 'hr': return [hrNode(opts)];
      case 'code': return [codeNode(token, opts)];
      case 'space': return [];
      case 'html': {
        const s = clean(token.text || token.raw || '');
        return s.trim() ? [plainBlock(s, opts)] : [];
      }
      default: {
        const s = clean(token.text || token.raw || '');
        return s ? [plainBlock(s, opts)] : [];
      }
    }
  } catch {
    const s = clean(token.text || token.raw || '');
    return s ? [plainBlock(s, opts)] : [];
  }
}

/* ============================================================
   Judul utama laporan (aturan redaksi: judul dicetak SEKALI)
   ============================================================
   Semua laporan PIMAS diawali `# Laporan <jenis> — <Nama> (<id>)`. Bila judul itu
   ikut dirender di badan, halaman 1 memuat judul DUA KALI (kop + H1 raksasa). Maka:
   H1 pembuka dilepas dari badan dan dipakai sebagai judul kop — sekaligus judul kop
   jadi lebih informatif daripada label generik.
   Prefiks jenis ("Laporan Topik — ") dibuang karena sudah ada di kicker kop, dan
   ekor "(<slug/id>)" dibuang karena sudah tercetak di baris meta. */
export function splitLeadTitle(tokens) {
  const list = Array.isArray(tokens) ? tokens : [];
  let i = 0;
  while (i < list.length && list[i] && list[i].type === 'space') i++;
  const head = list[i];
  if (!head || head.type !== 'heading' || (head.depth || 1) !== 1) return { title: '', rest: list };
  return { title: clean(head.text || ''), rest: list.slice(0, i).concat(list.slice(i + 1)) };
}

/* judul H1 → judul kop yang ringkas; kosong/aneh → `fallback`. */
export function coverTitleFrom(leadTitle, fallback, meta) {
  let t = String(leadTitle == null ? '' : leadTitle).trim();
  if (!t) return fallback;
  const id = meta && (meta.slug || meta.id);
  if (id) {
    const tail = `(${String(id).trim()})`;
    if (t.toLowerCase().endsWith(tail.toLowerCase())) t = t.slice(0, -tail.length).trim();
  }
  const stripped = t.replace(/^(laporan|dossier|pimas)\b[^—–]{0,40}[—–]\s*/i, '').trim();
  return stripped || t || fallback;
}

/* ============================================================
   PURE: tokens (marked.lexer) → pdfmake content array
   ============================================================ */
/* Judul TIDAK boleh berdiri sendiri di kaki halaman. pageBreakBefore pdfmake hanya
   satu-lintasan (tak menangkap yatim yang lahir SETELAH pemindahan pertama), jadi
   pengikatan dilakukan di sumber: judul + blok pertama sesudahnya dijadikan satu
   blok tak-terpisah — hanya bila blok itu cukup pendek supaya tidak meninggalkan
   ruang kosong besar di halaman sebelumnya. */
const BIND_PARA_MAX = 520;   /* ±5 baris prosa */
const BIND_TABLE_ROWS = 3;

function bindable(next) {
  if (!next || typeof next !== 'object') return false;
  if (next.type === 'paragraph' || next.type === 'text') {
    return String(next.raw || next.text || '').length <= BIND_PARA_MAX;
  }
  if (next.type === 'table') return (Array.isArray(next.rows) ? next.rows.length : 0) <= BIND_TABLE_ROWS;
  if (next.type === 'blockquote') return String(next.raw || '').length <= BIND_PARA_MAX;
  return false;
}

/* paragraf yang SELURUHNYA miring dan berdiri tepat setelah tabel = keterangan objek
   (mis. "*Price ladder …*"). Keterangan milik tabel → ikut lebar tabel (12 kolom),
   bukan zona prosa; ukurannya kecil agar jelas subordinat. */
function isCaptionToken(tk) {
  if (!tk || (tk.type !== 'paragraph' && tk.type !== 'text')) return false;
  const toks = (tk.tokens || []).filter((t) => t && t.type !== 'space');
  return toks.length === 1 && toks[0].type === 'em';
}

function captionNode(token, o) {
  const T = o.T;
  const runs = textRuns(token, { italics: true, color: BODY2 });
  return {
    text: runs === '' ? clean(token.text) : runs,
    italics: true,
    color: BODY2,
    fontSize: Math.max(T.caption.size, T.body.size - 2),
    lineHeight: 1.35,
    margin: [0, 0, 0, T.caption.gap],
  };
}

export function tokensToPdfContent(tokens, opts) {
  const o = withTheme(opts);
  const list = Array.isArray(tokens) ? tokens : [];
  const content = [];
  let prevWasTable = false;
  for (let i = 0; i < list.length; i++) {
    const tk = list[i];
    if (!tk) continue;
    if (tk.type !== 'space') {
      if (prevWasTable && o.T.bandW && isCaptionToken(tk)) {
        const cap = captionNode(tk, o);
        const last = content[content.length - 1];
        /* tabel melintang: keterangan tetap di halaman melintang itu. */
        if (last && last.pageOrientation === 'portrait' && last.pageBreak === 'before') content.splice(content.length - 1, 0, cap);
        else content.push(cap);
        prevWasTable = false;
        continue;
      }
      prevWasTable = tk.type === 'table';
    }
    /* lewati token 'space' saat mencari pasangan judul */
    let j = i + 1;
    while (j < list.length && list[j] && list[j].type === 'space') j++;
    if (tk.type === 'heading') {
      const depth = Math.min(Math.max(tk.depth || 1, 1), 4);
      const spec = o.T[`h${depth}`] || o.T.h3;
      const next = list[j];
      /* side-head (preset grid): judul di jalur kiri, paragraf pertama seksi di zona
         prosa — hanya untuk PROSA; tabel/gambar tetap 12 kolom penuh di bawahnya. */
      if (spec.side && o.T.bandW) {
        const proseNext = next && (next.type === 'paragraph' || next.type === 'text')
          && String(next.raw || next.text || '').length <= BIND_PARA_MAX;
        const body = proseNext ? blockToNodes(next, { ...o, raw: true }).filter(Boolean) : [];
        content.push(sideHeadNode(tk, o, spec, depth, body));
        if (proseNext) i = j;
        continue;
      }
      if (bindable(next)) {
        const head = blockToNodes(tk, o).filter(Boolean);
        const body = blockToNodes(next, o).filter(Boolean);
        content.push({ stack: head.concat(body), unbreakable: true });
        i = j;
        continue;
      }
    }
    for (const node of blockToNodes(tk, o)) {
      if (node != null) content.push(node);
    }
  }
  return content;
}

/* ============================================================
   marked (CDN) → tokens → content
   ============================================================ */
const CDN_MARKED = 'https://cdn.jsdelivr.net/npm/marked@12.0.2/lib/marked.esm.js';

export async function mdToPdfContent(md, opts) {
  const mod = await import(CDN_MARKED);
  const marked = mod.marked || mod.default;
  /* URL identik dg app.js → instance modul marked yang SAMA (cache browser). gfm
     sudah default true di marked@12 (no-op), jadi tak mengubah perilaku renderMd. */
  if (marked && typeof marked.setOptions === 'function') marked.setOptions({ gfm: true });
  const tokens = marked.lexer(String(md == null ? '' : md));
  /* NB: mengembalikan OBJEK (bukan array) — pemanggil butuh judul pembuka juga. */
  const { title, rest } = splitLeadTitle(tokens);
  return { content: tokensToPdfContent(rest, opts), leadTitle: title };
}

/* ============================================================
   Font tema (browser) — diambil dari origin sendiri, ada jalur mundur
   ============================================================
   pdfmake hanya membundel Roboto. Roboto TIDAK punya glif `→` (dipakai 977x di
   laporan) sehingga selama ini tercetak sebagai kotak; Source Serif 4 punya `→ ≈ μ ✓`
   dan x-height besar → terbaca pada 8–9pt di sel tabel. Berkas TTF dilayani dari
   origin dashboard sendiri, jadi CSP `connect-src 'self'` sudah mengizinkan — TIDAK
   perlu melonggarkan CSP ke CDN font.
   Gagal muat (offline/404) BUKAN kegagalan ekspor: tema dipakai apa adanya dengan
   Roboto (tata letak tetap, hanya rupa huruf yang mundur). */
const FONT_DIR = 'assets/fonts/';
const FONT_MAP = {
  PimasSerif: {
    normal: 'SourceSerif4-Regular.ttf',
    bold: 'SourceSerif4-Semibold.ttf',
    italics: 'SourceSerif4-It.ttf',
    bolditalics: 'SourceSerif4-SemiboldIt.ttf',
  },
  PimasDisplay: {
    normal: 'BricolageGrotesque-Bold.ttf',
    bold: 'BricolageGrotesque-Bold.ttf',
    italics: 'BricolageGrotesque-Bold.ttf',
    bolditalics: 'BricolageGrotesque-Bold.ttf',
  },
};
const ROBOTO_VFS = {
  normal: 'Roboto-Regular.ttf',
  bold: 'Roboto-Medium.ttf',
  italics: 'Roboto-Italic.ttf',
  bolditalics: 'Roboto-MediumItalic.ttf',
};

function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}

let fontsPromise = null;
/* true = font tema siap dipakai; false = pakai Roboto. Dimemo per sesi halaman. */
function ensureThemeFonts(pdfMake) {
  if (typeof fetch !== 'function' || typeof document === 'undefined') return Promise.resolve(false);
  if (!fontsPromise) {
    const files = [...new Set(Object.values(FONT_MAP).flatMap((f) => Object.values(f)))];
    fontsPromise = Promise.all(files.map(async (f) => {
      const url = new URL(FONT_DIR + f, document.baseURI).href;
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`${f} ${res.status}`);
      return [f, bufToBase64(await res.arrayBuffer())];
    })).then((pairs) => {
      pdfMake.vfs = pdfMake.vfs || {};
      for (const [f, b64] of pairs) pdfMake.vfs[f] = b64;
      pdfMake.fonts = { Roboto: ROBOTO_VFS, ...FONT_MAP };
      return true;
    }).catch(() => { fontsPromise = null; return false; });
  }
  return fontsPromise;
}

/* ============================================================
   Foto produk → dataURL (browser saja; BEST-EFFORT, tak pernah throw)
   ============================================================ */

/* Gambar hotlink dari situs resmi brand. Agar bisa masuk PDF, bitmap harus dibaca
   ulang lewat <canvas> → butuh canvas BERSIH → butuh crossOrigin=anonymous + header
   CORS dari host (Shopify dkk mengirim ACAO:*). Host tanpa CORS → canvas ter-taint →
   toDataURL melempar → foto dilewati (baris tetap tampil, hanya tanpa foto).
   fetch() sengaja TIDAK dipakai: CSP connect-src dashboard tak mengizinkan host acak,
   sedangkan img-src mengizinkan https: (sama seperti thumbnail di kartu dashboard). */
function loadThumbDataUrl(url) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof Image === 'undefined' || !url) { resolve(null); return; }
    let settled = false;
    let timer = null;
    const finish = (v) => { if (!settled) { settled = true; if (timer) clearTimeout(timer); resolve(v); } };
    timer = setTimeout(() => finish(null), THUMB_TIMEOUT_MS);
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      img.decoding = 'async';
      img.onerror = () => finish(null);
      img.onload = () => {
        try {
          const w = img.naturalWidth || img.width;
          const h = img.naturalHeight || img.height;
          if (!w || !h) { finish(null); return; }
          const scale = Math.min(1, THUMB_PX / Math.max(w, h));
          const cw = Math.max(1, Math.round(w * scale));
          const ch = Math.max(1, Math.round(h * scale));
          const cv = document.createElement('canvas');
          cv.width = cw;
          cv.height = ch;
          const cx = cv.getContext('2d');
          if (!cx) { finish(null); return; }
          /* PNG/WebP transparan di atas latar putih — PDF tak mengenal alpha JPEG. */
          cx.fillStyle = WHITE;
          cx.fillRect(0, 0, cw, ch);
          cx.drawImage(img, 0, 0, cw, ch);
          const data = cv.toDataURL('image/jpeg', 0.82);
          finish(typeof data === 'string' && data.indexOf('data:image/jpeg') === 0 ? data : null);
        } catch { finish(null); /* canvas ter-taint (host tanpa CORS) */ }
      };
      img.src = String(url);
    } catch { finish(null); }
  });
}

/* items = temuan_produk[] (nama, brand, image_url, image_lisensi, image_tanggal_akses).
   Mengembalikan array thumb siap-pakai untuk tokensToPdfContent({ thumbs }). Selalu
   resolve — foto yang gagal/lambat/tanpa CORS cukup absen dari hasil. */
export async function loadProductThumbs(items) {
  const list = (Array.isArray(items) ? items : [])
    .filter((p) => p && typeof p.image_url === 'string' && /^https?:\/\//i.test(p.image_url))
    .slice(0, THUMB_MAX);
  if (!list.length) return [];
  const out = await Promise.all(list.map(async (p) => {
    const image = await loadThumbDataUrl(p.image_url);
    return image ? {
      nama: p.nama || '',
      brand: p.brand || '',
      image,
      lisensi: p.image_lisensi || '',
      tanggal: p.image_tanggal_akses || '',
    } : null;
  }));
  return out.filter(Boolean);
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

/* Blok kepala merek: letter-mark P + wordmark + kicker, lalu JUDUL besar, meta,
   dan garis aksen. Judul laporan adalah elemen terbesar di halaman — pembaca harus
   tahu "ini laporan apa" sebelum apa pun. */
function coverHeaderNodes(kind, title, metaLine, T) {
  const disp = (T.fonts && T.fonts.display) || undefined;
  const bodyFont = (T.fonts && T.fonts.body) || undefined;
  const letterMark = {
    width: 26,
    stack: [
      { canvas: [{ type: 'rect', x: 0, y: 0, w: 24, h: 24, r: 6, color: ACCENT }] },
      { text: 'P', color: WHITE, bold: true, fontSize: 15, alignment: 'center', width: 24, margin: [0, -21, 0, 0], font: disp },
    ],
  };
  const wordmark = {
    width: '*',
    stack: [
      { text: 'PIMAS', color: INK, bold: true, fontSize: 15, margin: [0, 1, 0, 0], font: disp, characterSpacing: 0.2 },
      { text: kickerFor(kind), color: ACCENT, bold: true, fontSize: T.cover.kicker, characterSpacing: 0.6, margin: [0, 1, 0, 0], font: disp },
    ],
  };
  const nodes = [
    { columns: [letterMark, wordmark], columnGap: 10, margin: [0, 0, 0, 14] },
    {
      text: clean(title),
      fontSize: T.cover.title,
      bold: true,
      color: INK,
      lineHeight: 1.15,
      characterSpacing: -0.3,
      margin: [0, 2, 0, 8],
      width: T.proseW ? T.proseW + (T.proseX || 0) : T.contentW,
      font: bodyFont,
    },
  ];
  if (metaLine) nodes.push({ text: metaLine, fontSize: T.cover.meta, color: MUTED, margin: [0, 0, 0, 10] });
  nodes.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: T.contentW, y2: 0, lineWidth: T.cover.rule, lineColor: ACCENT }], margin: [0, 0, 0, T.cover.gap] });
  return nodes;
}

/* ============================================================
   Rakit docDefinition (MURNI — tanpa network) dari body konten yang sudah jadi.
   Dipisah agar bisa dirender identik di Node (uji layout) & browser.
   `typo` = nama preset tema (lihat THEMES); kosong → preset aktif/override URL.
   ============================================================ */
export function buildDocDefinition({ kind, title, meta, body, downloadedAt, typo, theme } = {}) {
  const T = theme || resolveTheme(typo || themeFromLocation());
  const reportTitle = String(title || kickerFor(kind));
  const metaLine = buildMetaLine(meta || {});
  const dateStr = fmtDate(downloadedAt || new Date());
  const content = coverHeaderNodes(kind, reportTitle, metaLine, T).concat(Array.isArray(body) ? body : []);
  const footTitle = truncate(reportTitle, 64);
  const [mL, mT, mR, mB] = T.pageMargins;
  return {
    pageSize: 'A4',
    pageMargins: [mL, mT, mR, mB],
    info: { title: reportTitle, author: 'PIMAS', creator: 'PIMAS' },
    defaultStyle: { font: (T.fonts && T.fonts.body) || 'Roboto', fontSize: T.body.size, color: BODY, lineHeight: T.body.lead },
    content,
    /* judul yatim: kalau sebuah judul jatuh di ujung halaman tanpa isi mengikutinya,
       dorong ke halaman berikutnya (aturan redaksi dasar — judul tak boleh sendirian). */
    pageBreakBefore: (currentNode, followingNodesOnPage) => {
      /* tabel yang baru mulai di kaki halaman hanya menyisakan baris kepala di sana
         ("kepala tabel yatim") — dorong seluruh tabel ke halaman berikutnya. */
      const pos = currentNode && currentNode.startPosition;
      if (currentNode && currentNode.table && pos && pos.verticalRatio > 0.78
        && (followingNodesOnPage || []).length === 0) return true;
      const lvl = currentNode && currentNode.headlineLevel;
      if (!lvl || lvl === HL_ATTACHED) return false;
      /* pindah halaman bila yang tersisa di bawah judul hanyalah judul lain atau
         garis judul — artinya judul ini bakal berdiri sendirian di kaki halaman. */
      return (followingNodesOnPage || []).every((n) => !!(n && n.headlineLevel));
    },
    header: (currentPage, pageCount, pageSize) => (currentPage > 1
      ? {
        columns: [
          { text: 'PIMAS', color: ACCENT, bold: true, fontSize: T.runHead.size, width: '*', font: (T.fonts && T.fonts.display) || undefined, characterSpacing: 0.4 },
          { text: kickerFor(kind), color: MUTED, fontSize: T.runHead.size, alignment: 'right', width: 'auto' },
        ],
        margin: [mL, Math.max(14, mT - 30), mR, 0],
        width: (pageSize && pageSize.width ? pageSize.width : 595.28) - mL - mR,
      }
      : null),
    footer: (currentPage, pageCount, pageSize) => ({
      stack: [
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: (pageSize && pageSize.width ? pageSize.width : 595.28) - mL - mR, y2: 0, lineWidth: 0.5, lineColor: LINE }], margin: [mL, 0, mR, 5] },
        {
          columns: [
            { text: `${footTitle}  ·  Diunduh ${dateStr}`, color: MUTED, fontSize: T.foot.size, width: '*' },
            { text: `hal. ${currentPage} / ${pageCount}`, color: MUTED, fontSize: T.foot.size, alignment: 'right', width: 'auto' },
          ],
          margin: [mL, 0, mR, 0],
        },
      ],
    }),
  };
}

/* ============================================================
   Entry utama — muat mesin + konten, rakit doc, unduh file.
   ============================================================ */
export async function exportReportPdf({ kind, title, meta, md, filename, images, typo } = {}) {
  const metaObj = meta || {};
  /* muat mesin + foto paralel. Mesin gagal → throw (pemanggil toasts); foto gagal →
     PDF tetap terbit tanpa foto (best-effort, bukan syarat). */
  const [pdfMake, thumbs] = await Promise.all([
    loadPdfMake(),
    loadProductThumbs(images).catch(() => []),
  ]);
  const themeBase = resolveTheme(typo || themeFromLocation());
  /* font tema wajib SIAP sebelum konten dirakit — node membawa nama font di dalamnya. */
  const fontsOk = themeBase.fonts ? await ensureThemeFonts(pdfMake) : true;
  const T = (themeBase.fonts && !fontsOk) ? { ...themeBase, fonts: null } : themeBase;
  const { content: body, leadTitle } = await mdToPdfContent(md, { thumbs, T });
  const docTitle = coverTitleFrom(leadTitle, title, metaObj);
  const docDefinition = buildDocDefinition({ kind, title: docTitle, meta: metaObj, body, theme: T });
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
