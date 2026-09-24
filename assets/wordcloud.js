/*
 * wordcloud.js — render DOM/canvas untuk kartu "Keyword Terkait" (Penjelajah
 * Topik, WORK ORDER 2). Layout murni ada di wordcloud-layout.mjs (importable
 * di Node tanpa DOM, dites tersendiri); file ini HANYA urusan canvas: ukur
 * teks via CanvasRenderingContext2D, gambar, dan ekspor PNG. Tanpa dependency
 * eksternal (BUKAN echarts-wordcloud — layout library itu acak tiap render,
 * bertentangan dgn kebutuhan deterministik/testable di sini).
 *
 * Kategori warna (identitas sumber): trends / autocomplete / tiktok / multi
 * (>1 sumber). Dipetakan ke token DESIGN.md --chart/--chart-2..6 (konsultasi
 * skill dataviz — lihat catatan CATEGORY_COLOR_VAR di bawah utk rasional
 * pemilihan & keterbatasan palet dark-mode situs).
 */

import { layoutWordcloud } from './wordcloud-layout.mjs';

/* ============================================================
   Warna kategorikal — sumber → var(--chart*)
   ============================================================
   4 kategori (trends/autocomplete/tiktok/multi) dipetakan ke 4 dari 6 token
   --chart* DESIGN.md (skip --chart-2 & --chart-6: --chart-2 nyaris identik
   dgn --chart di dark mode /ΔE 2.6 normal-vision — gagal floor 15/; --chart-6
   abu netral "lainnya", di bawah chroma floor kategorikal). Kombinasi terpilih
   (--chart/--chart-5/--chart-4/--chart-3) LOLOS seluruh 6 cek dataviz-skill di
   LIGHT mode (node scripts/validate_palette.js "#0eaae1,#5a6fd6,#2bb9a4,#3a9fc7"
   --mode light → ALL CHECKS PASS, WARN kontras-vs-surface dimitigasi krn tiap
   kata SELALU membawa label teksnya sendiri — identitas primer sudah dari teks,
   bukan warna semata).
   // CATATAN DESAIN (keterbatasan token situs, di luar scope): di DARK mode token --chart-2..6 situs (semua L≈0.69–0.77, di luar
   // band ideal 0.48–0.67 utk kanvas gelap) tidak lolos gate CVD all-pairs keras
   // manapun dari kombinasi 4-dari-6 yang dicoba (worst-case ΔE normal-vision
   // 6.8–11.5, di bawah floor 15) — keterbatasan PALET SITUS YANG SUDAH ADA
   // (dipakai juga di 6-seri chart lain di seluruh dashboard), BUKAN sesuatu yang
   // diperkenalkan di sini; mengubahnya = mengubah DESIGN.md token global, di
   // luar scope work order ini. Mitigasi yang dikirim: (1) setiap kata = label
   // teks sendiri (identitas tak pernah warna-saja), (2) legend wajib tampil,
   // (3) tabel "Term dominan korpus" mencantumkan kolom Sumber sebagai teks —
   // 3 kanal non-warna. Pemilik desain sebaiknya meninjau ulang --chart-2..6
   // dark utk semua chart situs, bukan hanya word cloud ini.
   */
const CATEGORY_COLOR_VAR = {
  trends: '--chart',
  autocomplete: '--chart-5',
  tiktok: '--chart-4',
  multi: '--chart-3',
};

const CATEGORY_FALLBACK_HEX = {
  trends: '#0eaae1',
  autocomplete: '#5a6fd6',
  tiktok: '#2bb9a4',
  multi: '#3a9fc7',
};

/** Palet LIGHT eksplisit (hex tetap) — dipakai render PDF (item 5 work order):
 * kanvas offscreen SELALU latar putih, jadi warna HARUS dari set light (warna
 * dark-mode di atas putih akan pudar/kontras rendah). Diekspor agar pdf-export.js
 * tak perlu menduplikasi tabel warna. */
export const LIGHT_PALETTE = { ...CATEGORY_FALLBACK_HEX };

function cssVar(name, fallback) {
  try {
    if (typeof document === 'undefined') return fallback;
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

/** kategori sumber primer dari sumber[] (subset trends|autocomplete|tiktok):
 * >1 sumber unik → 'multi'; 1 sumber → sumber itu sendiri; 0/tak dikenal →
 * 'multi' (netral, fallback defensif: kontrak menjamin sumber[] tak pernah kosong utk
 * item wordcloud nyata, tapi fallback defensif tetap dipasang). */
export function primarySource(sumber) {
  const arr = Array.isArray(sumber) ? sumber.filter((s) => typeof s === 'string' && s) : [];
  const uniq = Array.from(new Set(arr));
  if (uniq.length > 1) return 'multi';
  if (uniq.length === 1 && CATEGORY_COLOR_VAR[uniq[0]]) return uniq[0];
  return 'multi';
}

/** Warna kategori sesuai tema saat ini (via CSS var — otomatis ikut light/dark
 * toggle situs) atau override eksplisit dari `palette` (dipakai PDF/tes). */
export function categoryColor(cat, palette) {
  if (palette && typeof palette[cat] === 'string') return palette[cat];
  const varName = CATEGORY_COLOR_VAR[cat] || CATEGORY_COLOR_VAR.multi;
  return cssVar(varName, CATEGORY_FALLBACK_HEX[cat] || CATEGORY_FALLBACK_HEX.multi);
}

/** measure() berbasis canvas asli — akurat per font situs (Figtree). */
function makeCanvasMeasure(ctx, fontFamily) {
  return (text, fontPx, bold) => {
    ctx.font = `${bold ? 700 : 400} ${fontPx}px ${fontFamily}`;
    const m = ctx.measureText(String(text == null ? '' : text));
    const w = (m && typeof m.width === 'number') ? m.width : 0.6 * fontPx * String(text || '').length;
    const h = fontPx * 1.2;
    return { w, h };
  };
}

const FONT_FAMILY = "'Figtree', system-ui, sans-serif";

/**
 * renderWordcloud(canvas, items, opts) — gambar word cloud ke <canvas> yang
 * sudah ada di DOM (atau offscreen). items = kt.wordcloud[] (kontrak: term,
 * bobot, stabil, khas, jenis, sumber[], ...). opts:
 *   {width, height, minFont, maxFont, padding, palette, theme, background}
 * - `palette` {trends,autocomplete,tiktok,multi} hex → override eksplisit
 *   (dipakai PDF: selalu LIGHT_PALETTE krn kanvas PDF selalu putih).
 * - `theme` 'light'|'dark' → HANYA memengaruhi warna latar fallback bila
 *   `background` tak diberi & CSS var tak terbaca (mis. kanvas offscreen tanpa
 *   elemen ter-attach ke DOM bertema).
 * - stabil:false → opacity 55% + berat normal; stabil:true → tebal (bold).
 * - jenis:'kandidat' → gaya sama (dibedakan lewat legend/catatan, bukan visual
 *   tambahan — kesederhanaan disengaja per spec work order).
 * Mengembalikan {placed, overflow} dari layoutWordcloud (overflow berguna utk
 * pemanggil menampilkan catatan "+N kata lain" bila perlu).
 */
export function renderWordcloud(canvas, items, opts = {}) {
  const width = opts.width > 0 ? opts.width : (canvas.clientWidth || 640);
  const height = opts.height > 0 ? opts.height : 320;
  const dpr = 2; // spec: selalu 2x devicePixelRatio (tajam di layar HiDPI & saat diekspor PNG)

  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return { placed: [], overflow: [] };
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const theme = opts.theme === 'dark' ? 'dark' : 'light';
  const bg = opts.background || cssVar('--surface-1', theme === 'dark' ? '#181f28' : '#ffffff');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const measure = makeCanvasMeasure(ctx, FONT_FAMILY);
  const list = (Array.isArray(items) ? items : [])
    .filter((it) => it && typeof it.term === 'string' && it.term && Number.isFinite(it.bobot));

  const { placed, overflow } = layoutWordcloud(list, {
    width,
    height,
    minFont: opts.minFont > 0 ? opts.minFont : 12,
    maxFont: opts.maxFont > 0 ? opts.maxFont : 40,
    padding: opts.padding != null ? opts.padding : 4,
    measure,
  });

  ctx.textBaseline = 'top';
  for (const p of placed) {
    const cat = primarySource(p.item && p.item.sumber);
    const color = categoryColor(cat, opts.palette);
    const stabil = !!(p.item && p.item.stabil);
    ctx.globalAlpha = stabil ? 1 : 0.55;
    ctx.fillStyle = color;
    ctx.font = `${p.bold ? 700 : 400} ${p.font}px ${FONT_FAMILY}`;
    ctx.fillText(p.term, p.x, p.y);
    // jenis:'kandidat' → garis bawah 2px warna sama (WORK ORDER 3 #12) — legenda
    // menjelaskan "garis bawah = kandidat kata kunci" (dibedakan dari term korpus
    // murni yg tak digarisbawahi).
    if (p.item && p.item.jenis === 'kandidat') {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      const underlineY = p.y + p.h - 1;
      ctx.beginPath();
      ctx.moveTo(p.x, underlineY);
      ctx.lineTo(p.x + p.w, underlineY);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  return { placed, overflow };
}

/** Kanvas → data URL PNG (unduh tombol "Unduh PNG" & embed gambar PDF). */
export function toPngDataUrl(canvas) {
  return canvas.toDataURL('image/png');
}

/* Global window.PimasWordcloud — sesuai spec work order (konsumen non-modul /
   debugging konsol). Konsumen internal (view, pdf-export) memakai named export
   ESM di atas langsung; global ini murni tambahan, bukan jalur utama. */
if (typeof window !== 'undefined') {
  window.PimasWordcloud = { layoutWordcloud, renderWordcloud, toPngDataUrl };
}
