/*
 * wordcloud-layout.mjs — layout PURA (tanpa DOM) untuk kartu "Keyword Terkait"
 * (Penjelajah Topik, WORK ORDER 2). Deterministik: NOL Math.random — spiral
 * Archimedean tetap + urutan input yang deterministik (bobot desc, tie-break
 * term asc) menjamin posisi identik untuk input identik (dites di
 * tests/unit/wordcloud-layout.test.mjs).
 *
 * Diimpor DUA jalur:
 *   - Node (tanpa DOM) via node:test — measure() default di bawah.
 *   - Browser via wordcloud.js, yang menyuntik measure() berbasis
 *     CanvasRenderingContext2D.measureText (lebih akurat, sadar font asli).
 *
 * Bentuk kotak: {x,y,w,h} — x/y = pojok kiri-atas (origin canvas standar),
 * BUKAN pusat kata.
 */

/** measure teks default (tanpa DOM): perkiraan lebar/tinggi rata-rata glyph
 * sans-serif. 0.6× lebar-per-karakter adalah pendekatan umum utk font
 * proporsional pada ukuran body/heading (dipakai node test + fallback). */
export function defaultMeasure(text, fontPx, bold) {
  const len = String(text == null ? '' : text).length;
  const w = 0.6 * fontPx * len * (bold ? 1.06 : 1);
  const h = 1.2 * fontPx;
  return { w, h };
}

function boxesOverlap(a, b, padding) {
  return !(
    a.x + a.w + padding <= b.x
    || b.x + b.w + padding <= a.x
    || a.y + a.h + padding <= b.y
    || b.y + b.h + padding <= a.y
  );
}

const SPIRAL_STEP = 0.35;       // radian per langkah pencarian slot
const SPIRAL_RADIUS_STEP = 1.6; // px per radian (kerapatan spiral)

/**
 * layoutWordcloud(items, opts) → {placed:[{term,x,y,w,h,font,bold,item}], overflow:[]}
 *
 * items: [{term:string, bobot:number, ...field lain diteruskan verbatim via `item`}]
 * opts: {width, height, minFont, maxFont, padding, measure}
 *   - font = minFont + (maxFont-minFont) * sqrt((bobot-min)/(max-min)); monoton naik
 *     terhadap bobot; bobot semua sama → titik tengah (minFont+maxFont)/2.
 *   - urutan penempatan = bobot desc, tie-break term asc (deterministik & stabil).
 *   - packing: spiral Archimedean dari pusat kanvas, first-fit + cek overlap
 *     bounding-box (padding px antar kata). Kata yang tak muat di dalam kanvas
 *     (mentok radius maksimum) dibuang ke overflow[] — TAK PERNAH digambar
 *     separuh di luar kanvas.
 */
export function layoutWordcloud(items, opts = {}) {
  const width = opts.width > 0 ? opts.width : 640;
  const height = opts.height > 0 ? opts.height : 360;
  const minFont = opts.minFont > 0 ? opts.minFont : 11;
  const maxFont = opts.maxFont > minFont ? opts.maxFont : minFont + 1;
  const padding = opts.padding >= 0 ? opts.padding : 3;
  const measure = typeof opts.measure === 'function' ? opts.measure : defaultMeasure;

  const list = Array.isArray(items)
    ? items.filter((it) => it && typeof it.term === 'string' && it.term && Number.isFinite(it.bobot))
    : [];
  if (!list.length) return { placed: [], overflow: [] };

  let min = Infinity;
  let max = -Infinity;
  for (const it of list) {
    if (it.bobot < min) min = it.bobot;
    if (it.bobot > max) max = it.bobot;
  }
  const span = max - min;

  // urutan deterministik: bobot desc, tie-break term (locale-independent, byte order).
  const ordered = list.slice().sort((a, b) => {
    if (b.bobot !== a.bobot) return b.bobot - a.bobot;
    return a.term < b.term ? -1 : a.term > b.term ? 1 : 0;
  });

  const fontOf = (bobot) => {
    if (!(span > 0)) return (minFont + maxFont) / 2;
    const t = (bobot - min) / span;
    return minFont + (maxFont - minFont) * Math.sqrt(t);
  };

  const cx = width / 2;
  const cy = height / 2;
  const maxRadius = Math.hypot(width, height);
  const placed = [];
  const overflow = [];

  for (const item of ordered) {
    const font = fontOf(item.bobot);
    const bold = !!item.stabil;
    const { w, h } = measure(item.term, font, bold);

    let box = null;
    for (let theta = 0; ; theta += SPIRAL_STEP) {
      const r = SPIRAL_RADIUS_STEP * theta;
      if (r > maxRadius) break;
      const x = cx + r * Math.cos(theta) - w / 2;
      const y = cy + r * Math.sin(theta) - h / 2;
      if (x < 0 || y < 0 || x + w > width || y + h > height) continue;
      const cand = { x, y, w, h };
      let hit = false;
      for (let i = 0; i < placed.length; i++) {
        if (boxesOverlap(cand, placed[i], padding)) { hit = true; break; }
      }
      if (!hit) { box = cand; break; }
    }

    if (box) {
      placed.push({ term: item.term, x: box.x, y: box.y, w: box.w, h: box.h, font, bold, item });
    } else {
      overflow.push(item);
    }
  }

  return { placed, overflow };
}
