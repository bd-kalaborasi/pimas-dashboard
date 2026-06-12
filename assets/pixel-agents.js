/*
 * pixel-agents.js — generator sprite pixel-art PROSEDURAL & DETERMINISTIK untuk
 * "Ruang kerja agen" (Ops › Agen). Replikasi aestetika ekstensi VS Code
 * pixel-agents (karakter pixel di meja kerja) secara client-side: TANPA aset
 * eksternal / CDN / sprite pack — tiap karakter digambar sebagai grid <rect>
 * SVG (shape-rendering:crispEdges) sehingga tajam di retina, skala bersih di
 * semua breakpoint, dan ikut tema lewat token CSS (warna netral) + warna
 * pembeda per-agen (seed dari id). Palet selaras brand B (aksen biru).
 *
 * Bukan modul stateful: hanya fungsi murni penghasil string SVG + util seed.
 * Animasi status diatur via class CSS di pimas.css (#agen ruang kerja), bukan
 * di sini — JS hanya menempel atribut status. prefers-reduced-motion dimatikan
 * oleh kill-switch global pimas.css.
 */

/* FNV-1a 32-bit → seed deterministik dari id agen. */
function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/* PRNG kecil deterministik (mulberry32) — variasi fitur stabil per agen. */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Palet warna pembeda baju — biru-brand-led + sekunder selaras (teal/indigo/
   slate/biru-tip). Sengaja dalam keluarga cool yang sama dengan Palet B; tiap
   warna cukup gelap agar kontras dengan kulit/latar di light & dark. */
const SHIRT = [
  '#0e69a7', // biru brand deep (aksen brand)
  '#0e8ac0', // biru sedang
  '#2bb9a4', // teal
  '#5a6fd6', // indigo
  '#2a63a2', // biru-tip
  '#3a7ca8', // biru baja
  '#4a8f86', // hijau-teal teredam
  '#6a72c0', // ungu-biru
];
/* Rambut/penutup kepala — netral hangat-gelap → terang, tetap terbaca di dua tema. */
const HAIR = ['#2a2018', '#3d2c1a', '#5a4632', '#1f242b', '#6b5840', '#33373d', '#4a3a28', '#262b31'];
/* Kulit — rentang netral, semuanya kontras vs baju & latar meja. */
const SKIN = ['#e8b894', '#d99a6c', '#c4814f', '#a9663b', '#8a5230', '#f0c8a8'];

/* Ukuran grid logis (unit pixel). Karakter duduk di meja menghadap monitor. */
const W = 22;
const H = 20;

function rect(x, y, w, h, fill, extra) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra || ''}/>`;
}

/**
 * Bangun SVG sprite untuk satu agen.
 * @param {string} id     id agen (seed)
 * @param {string} status 'aktif' | 'idle' | 'gagal'
 * @returns {string} markup <svg> (string), berisi grup ber-class untuk animasi.
 */
export function spriteSVG(id, status) {
  const seed = hashSeed(id || 'agent');
  const r = rng(seed);
  const skin = SKIN[seed % SKIN.length];
  const hair = HAIR[(seed >> 3) % HAIR.length];
  const shirt = SHIRT[(seed >> 7) % SHIRT.length];
  const shirtDark = shade(shirt, -0.22);
  const skinDark = shade(skin, -0.18);

  // Fitur deterministik
  const hairStyle = Math.floor(r() * 3); // 0 pendek, 1 berjambul, 2 topi
  const hasGlasses = r() < 0.4;
  const hasHeadset = !hasGlasses && r() < 0.4;
  const capColor = SHIRT[(seed >> 11) % SHIRT.length];

  // Warna layar monitor mengikuti status (token via CSS class .px-screen-*).
  // Nilai default di sini = aktif; class CSS menimpa fill untuk idle/gagal.
  const deskTop = 'var(--px-desk)';
  const deskLeg = 'var(--px-desk-leg)';
  const monBody = 'var(--px-monitor)';
  const monEdge = 'var(--px-monitor-edge)';

  let head = '';
  // Kepala (6x6) di (10,3)
  head += rect(10, 3, 6, 6, skin);
  // telinga
  head += rect(9, 5, 1, 2, skinDark);
  // mata (menghadap kiri ke monitor)
  head += rect(10, 5, 1, 1, '#1a2330');
  head += rect(12, 5, 1, 1, '#1a2330');
  // Rambut / penutup kepala
  if (hairStyle === 2) {
    // topi (cap)
    head += rect(9, 2, 8, 2, capColor);
    head += rect(9, 3, 3, 1, shade(capColor, -0.18));
  } else {
    head += rect(10, 2, 6, 2, hair);
    head += rect(9, 3, 1, 2, hair);
    head += rect(16, 3, 1, 3, hair);
    if (hairStyle === 1) head += rect(11, 1, 3, 1, hair); // jambul
  }
  // Kacamata
  if (hasGlasses) {
    head += rect(9, 5, 4, 1, '#1a2330');
    head += rect(10, 5, 1, 1, '#cfe3f2');
    head += rect(12, 5, 1, 1, '#cfe3f2');
  }
  // Headset
  if (hasHeadset) {
    head += rect(9, 2, 1, 4, '#33373d');
    head += rect(8, 5, 1, 2, '#33373d');
  }

  // Badan / baju (di bawah kepala), bahu lebar 8 mulai (9,9)
  let body = '';
  body += rect(9, 9, 8, 5, shirt);
  body += rect(9, 9, 8, 1, shade(shirt, 0.12)); // kerah highlight
  body += rect(12, 10, 2, 4, shirtDark); // garis tengah baju
  // Lengan menjulur ke keyboard (kiri = ke arah meja)
  // grup .px-arm dianimasikan "mengetik" saat aktif
  const arm =
    `<g class="px-arm">` +
    rect(8, 11, 2, 2, shirt) +
    rect(7, 12, 2, 1, skin) + // tangan
    `</g>`;

  // Meja + monitor (kiri karakter). Meja membentang penuh lebar bawah.
  let desk = '';
  desk += rect(0, 16, W, 2, deskTop); // permukaan meja
  desk += rect(1, 18, 2, 2, deskLeg); // kaki meja kiri
  desk += rect(W - 3, 18, 2, 2, deskLeg); // kaki meja kanan
  // Monitor di kiri menghadap karakter
  desk += rect(2, 6, 6, 8, monEdge); // bingkai
  // layar (di-warnai status via class)
  desk += `<rect class="px-screen" x="3" y="7" width="4" height="5"/>`;
  // baris teks layar (berkedip saat aktif → class .px-code)
  desk += `<rect class="px-code px-code-1" x="3" y="8" width="3" height="1"/>`;
  desk += `<rect class="px-code px-code-2" x="3" y="10" width="2" height="1"/>`;
  desk += rect(4, 14, 2, 2, monBody); // dudukan monitor
  desk += rect(3, 16, 4, 1, monEdge); // kaki dudukan
  // keyboard kecil di meja depan karakter
  desk += rect(8, 15, 6, 1, monEdge);

  // Lapisan badge status (titik di pojok layar) ditangani DOM nameplate; di sini
  // hanya sprite. Bobot animasi: grup .px-body (bob), .px-arm (typing).
  const svg =
    `<svg class="px-svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" ` +
    `preserveAspectRatio="xMidYMax meet" shape-rendering="crispEdges" aria-hidden="true" focusable="false">` +
    `<g class="px-desk">${desk}</g>` +
    `<g class="px-body">${body}${arm}<g class="px-head">${head}</g></g>` +
    `</svg>`;
  return svg;
}

/* Geser terang/gelap sebuah hex (#rrggbb). amt ∈ [-1,1]. */
function shade(hex, amt) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let rC = (n >> 16) & 255, gC = (n >> 8) & 255, bC = n & 255;
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + (amt < 0 ? c : 255 - c) * amt)));
  rC = f(rC); gC = f(gC); bC = f(bC);
  return '#' + ((1 << 24) + (rC << 16) + (gC << 8) + bC).toString(16).slice(1);
}

export { hashSeed };
