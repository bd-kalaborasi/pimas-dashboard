/*
 * PIMAS — KUNCI PRODUK sentimen (sumber kebenaran tunggal; owner 2 Okt 2026).
 * Diimpor TIGA tempat: formulir dashboard (browser), Cloudflare Worker (apps/webhook, di-bundle wrangler) dan
 * pipeline Node (lib/sentiment-product-key.mjs). MURNI: tanpa DOM, tanpa fs, tanpa network.
 *
 * Hierarki produk (owner): JENIS PRODUK → BRAND → NAMA DAGANG (opsional) → VARIAN.
 *   slug = <jenis>-<brand>[-<nama-dagang>][-<varian-kanonik>]   (dibentuk sistem, TIDAK diketik user)
 *   granola · Timur Tengah · Grainnola · semua varian  → granola-timur-tengah-grainnola
 *   muesli  · Safiya · (–) · varian "Coklat"           → muesli-safiya-choco (= slug live; sinonim disatukan)
 *
 * Mode varian:
 *   all    = semua varian: tidak ada varian target & tidak ada varian terlarang (rasa saudara ikut dihitung).
 *   single = satu varian: varian target wajib; pencocokan memakai KATA PEMBEDA keluarga varian (coklat →
 *            choco/cokelat/chocolate/dark chocolate…), dilakukan SETELAH identitas produk terbukti.
 *
 * Kamus & registri di bawah = DATA dengan sumber; menambah entri butuh PR + redeploy Worker.
 */

export const PRODUCT_KEY_V = 1;
export const SLUG_MAX = 64;

/** Slugify lama (identik byte dengan versi sebelum kunci produk) — dipakai request LEGACY & paritas uji. */
export function slugifyLegacy(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

/** Normalisasi teks: tanpa diakritik, lowercase, non-alnum → spasi tunggal. */
export function normKata(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
export function kata(s) { const n = normKata(s); return n ? n.split(' ') : []; }
export function rapat(s) { return kata(s).join(''); }

/** Jarak Damerau-Levenshtein terbatas (typo alias nama dagang: grainola ↔ grainnola). */
export function jarakEdit(a, b) {
  a = String(a || ''); b = String(b || '');
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// ── Kamus JENIS PRODUK (typo/sinonim → kanonik). Kata kanonik juga dipakai guardrail sebagai "jenis lain". ──
export const KAMUS_KATEGORI = {
  granolla: 'granola', granolah: 'granola',
  musli: 'muesli', museli: 'muesli', meusli: 'muesli', muslie: 'muesli',
  trailmix: 'trail mix', 'trail mixes': 'trail mix',
  oatmil: 'oatmeal',
};
/**
 * Jenis produk KEMASAN yang dikenal — dipakai guardrail: sumber yang juga membahas jenis LAIN (pos bundel merek
 * multi-produk "#muesli #trailmix") bukan bukti eksklusif. SENGAJA tanpa kata bahan/rasa/sarapan umum (kurma, madu,
 * yogurt, oatmeal, kopi): judul listing & caption menjejalkannya ("Granola … Oatmeal With Almond", varian "Mango
 * Yogurt") — memasukkannya membuat produk asli gagal cek (uji Grainnola 2 Okt 2026).
 */
export const JENIS_PRODUK = ['granola', 'muesli', 'trail mix', 'granola bar', 'protein bar', 'cereal bar', 'chia seed', 'get oat', 'keripik'];

// ── KELUARGA VARIAN: kanonik → sinonim (frasa dinormalisasi). Kanonik dipakai di slug. ──
// Sumber ejaan: korpus nyata Safiya Choco (choco/coklat/cokelat/chocolate, "nyoklat" ditangani gate) + judul listing
// Grainnola Tokopedia 2 Okt 2026 (Dark Chocolate, Vanilla Honey, Blueberry, Mango Yogurt, Cheese & Cream, Milky Milk).
export const KELUARGA_VARIAN = {
  choco: ['choco', 'coklat', 'cokelat', 'chocolate', 'chocolatey', 'chocolat', 'dark chocolate', 'dark choco', 'coklat hitam'],
  vanilla: ['vanilla', 'vanila', 'vanili', 'vanille'],
  strawberry: ['strawberry', 'stroberi', 'strawbery', 'strawberi'],
  blueberry: ['blueberry', 'bluberi', 'blueberi', 'blue berry', 'blueberries'],
  berry: ['berry', 'beri', 'berries', 'mixed berry', 'mix berry'],
  mango: ['mango', 'mangga'],
  cheese: ['cheese', 'keju', 'cheese cream', 'cheese and cream', 'cheese n cream'],
  milky: ['milky', 'milky milk'],
  matcha: ['matcha', 'macha', 'green tea'],
  apple: ['apple', 'apel'],
  banana: ['banana', 'pisang'],
  honey: ['honey', 'madu'],
  yogurt: ['yogurt', 'yoghurt', 'yogourt'],
  original: ['original', 'ori', 'plain'],
  tropical: ['tropical', 'tropis'],
  kurma: ['kurma', 'dates'],
  almond: ['almond'],
  coconut: ['coconut', 'kelapa'],
  cinnamon: ['cinnamon', 'kayu manis'],
  'peanut butter': ['peanut butter', 'selai kacang'],
};
/** Kata varian GENERIK: bukan pembeda varian (dipakai juga sebagai pendamping/topping). */
export const KATA_GENERIK = new Set(['original', 'honey', 'yogurt', 'banana', 'milk', 'susu', 'cream', 'krim', 'fruit', 'buah', 'seed', 'chia', 'mix', 'campur']);
/** Kata pengubah: tak pernah jadi token varian berdiri sendiri. */
export const KATA_PENGUBAH = new Set(['dark', 'white', 'double', 'extra', 'super', 'special', 'premium', 'classic', 'new', 'baru', 'and', 'n', 'dan', 'with', 'rasa', 'varian', 'flavor']);

// indeks sinonim → kanonik (frasa terpanjang dulu)
const SINONIM = Object.entries(KELUARGA_VARIAN)
  .flatMap(([kan, xs]) => xs.map((x) => [normKata(x), kan]))
  .sort((a, b) => b[0].split(' ').length - a[0].split(' ').length || b[0].length - a[0].length);

/** Teks varian → daftar kata kanonik (urut ketik): "Dark Chocolate" → [choco]; "Vanila Honey" → [vanilla, honey]. */
export function kanonVarian(teks) {
  let ws = kata(teks);
  const out = [];
  while (ws.length) {
    let hit = null;
    for (const [syn, kan] of SINONIM) {
      const sw = syn.split(' ');
      if (sw.length <= ws.length && sw.every((w, i) => ws[i] === w)) { hit = [sw.length, kan]; break; }
    }
    if (hit) { if (!out.includes(hit[1])) out.push(hit[1]); ws = ws.slice(hit[0]); continue; }
    const w = ws.shift();
    // Kata pengubah ("double", "white") dibuang dari bentuk kanonik bila masih ada kata lain: slug stabil
    // ("Double Choco" = "choco"). Label tampilan tetap memakai teks asli / nama varian terdaftar.
    if (KATA_PENGUBAH.has(w) && (ws.length || out.length)) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}
/** Kata kanonik varian → kata PEMBEDA (tanpa generik/pengubah); bila semuanya generik, pakai apa adanya. */
export function kataPembeda(kanon) {
  const p = kanon.filter((w) => !KATA_GENERIK.has(w) && !KATA_PENGUBAH.has(w));
  return p.length ? p : kanon.slice();
}
/**
 * Token pencocokan varian untuk config gate: sinonim tiap kata PEMBEDA + frasa label penuh.
 * "vanilla honey" → [vanilla, vanila, vanili, vanille, "vanilla honey"] (honey = generik, tak berdiri sendiri).
 */
export function variantTokens(label) {
  const kanon = kanonVarian(label);
  const out = new Set();
  for (const w of kataPembeda(kanon)) for (const s of (KELUARGA_VARIAN[w] || [w])) out.add(normKata(s));
  const full = normKata(label);
  if (full && full.includes(' ')) out.add(full);
  return [...out].filter(Boolean);
}

// ── REGISTRI PRODUK (keluarga produk yang sudah diverifikasi; sumber per entri) ──
// Dipakai: (1) saran "Maksud Anda …?" di formulir/Worker (anti-slug-ganda), (2) varian saudara mode satu-varian,
// (3) cek tingkat-2 guardrail (varian terdaftar).
export const REGISTRI_PRODUK = [
  {
    category: 'granola',
    brand: 'Timur Tengah',
    product_line: 'Grainnola',
    variants: ['Dark Chocolate', 'Vanilla Honey', 'Blueberry', 'Mango Yogurt', 'Cheese & Cream', 'Milky Milk'],
    aliases: ['grainola', 'granola timur tengah', 'timur tengah granola', 'timur tengah grainnola'],
    sumber: {
      url: 'https://www.tokopedia.com/timurtengahindon/timur-tengah-grainnola-500-gr-granola-sarapan-sehat-kaya-serat-sereal-praktis-camilan-rendah-kalori-dark-chocolate-vanilla-honey-blueberry-mango-yogurt-cheese-and-cream-milky-milk-1729700913380885601-1734932347761296481/review',
      diakses: '2026-10-02',
      tier: 'T3',
      kutipan: 'Timur Tengah Grainnola 500 gr … Dark Chocolate, Vanilla Honey, Blueberry, Mango Yogurt, Cheese and Cream, Milky Milk',
    },
  },
];

function kategoriKanon(teks) {
  const n = normKata(teks);
  if (!n) return [];
  if (KAMUS_KATEGORI[n]) return kata(KAMUS_KATEGORI[n]);
  return kata(n).map((w) => KAMUS_KATEGORI[w] || w).flatMap((w) => kata(w));
}

/** Entri registri yang cocok dengan isian (jenis sama, dan brand/nama dagang/alias cocok; typo ≤1 dari nama dagang). */
export function cariRegistri({ category, brand, product_line } = {}) {
  const cat = kategoriKanon(category).join(' ');
  const brandIn = rapat(brand);
  const lineIn = rapat(product_line);
  if (!cat || (!brandIn && !lineIn)) return null;
  for (const e of REGISTRI_PRODUK) {
    if (kategoriKanon(e.category).join(' ') !== cat) continue;
    const brandE = rapat(e.brand);
    const lineE = rapat(e.product_line);
    const kenal = new Set([brandE, lineE, ...(e.aliases || []).map(rapat)].filter(Boolean));
    const mirip = (c) => !!c && (kenal.has(c) || (!!lineE && c.length >= 6 && jarakEdit(c, lineE) <= 1));
    if (lineIn) {
      if (mirip(lineIn) && (!brandIn || mirip(brandIn))) return e;
      continue;
    }
    if (mirip(brandIn)) return e;
  }
  return null;
}

/** Alias sah: memuat jangkar (nama dagang, atau brand bila tak ada nama dagang), typo ≤1 dari jangkar, atau jenis+brand. */
export function aliasSah(alias, key) {
  const a = normKata(alias);
  if (!a || !key) return false;
  const anchor = normKata(key.product_line || key.brand);
  const ac = rapat(anchor);
  const aC = a.replace(/ /g, '');
  if (ac && (` ${a} `.includes(` ${anchor} `) || aC.includes(ac))) return true;
  if (ac && ac.length >= 6 && !a.includes(' ') && jarakEdit(aC, ac) <= 1) return true;
  const brand = normKata(key.brand);
  const cat = normKata(key.category);
  return !!(brand && cat && ` ${a} `.includes(` ${brand} `) && ` ${a} `.includes(` ${cat} `));
}

function judul(s) {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  if (/[A-Z]/.test(t)) return t;
  return t.replace(/(^|\s)(\S)/g, (m, sp, c) => sp + c.toUpperCase());
}

export const PRODUCT_KEY_ERRORS = {
  kategori_wajib: { field: 'category', pesan: 'Jenis produk wajib diisi (mis. granola).' },
  kategori_hanya_merek: { field: 'category', pesan: 'Jenis produk hanya berisi brand/nama dagang — isi jenis produknya (mis. granola).' },
  kategori_berisi_varian: { field: 'category', pesan: 'Jenis produk memuat nama varian — pindahkan varian ke kolom Varian dan pilih "Satu varian".' },
  merek_wajib: { field: 'brand', pesan: 'Brand wajib diisi (mis. Timur Tengah, Safiya).' },
  mode_tak_valid: { field: 'variant_mode', pesan: 'Pilih "Semua varian" atau "Satu varian".' },
  varian_wajib: { field: 'variant', pesan: 'Mode "Satu varian" butuh nama varian (mis. coklat).' },
  terlalu_panjang: { field: 'category', pesan: 'Gabungan jenis + brand + nama dagang + varian terlalu panjang (maks 64 huruf kode) — singkatkan.' },
};

/**
 * Bangun kunci produk dari isian terstruktur. Mengembalikan
 * { ok, errors:[{code, field, pesan}], catatan:[{code, pesan}], slug, product_name, label, category, brand,
 *   product_line, variant_mode, variant, variant_input, variant_display, key_v, registri }.
 * Kata yang sudah ada di isian lain dibuang (brand diketik di jenis produk, dsb.). Registri menormalkan
 * isian yang dikenal ("granola · Grainnola" → brand Timur Tengah, nama dagang Grainnola).
 */
export function buildProductKey(input = {}) {
  const errors = [];
  const catatan = [];
  const err = (code) => errors.push({ code, ...PRODUCT_KEY_ERRORS[code] });
  let brandIn = String(input.brand || '').trim();
  let lineIn = String(input.product_line || '').trim();
  const catIn = String(input.category || '').trim();
  const mode = input.variant_mode == null || input.variant_mode === '' ? 'all' : String(input.variant_mode);
  const variantIn = String(input.variant || '').trim();

  // registri: normalkan brand/nama dagang yang dikenal
  const reg = cariRegistri({ category: catIn, brand: brandIn, product_line: lineIn });
  if (reg) {
    if (rapat(brandIn) !== rapat(reg.brand) || rapat(lineIn) !== rapat(reg.product_line)) {
      catatan.push({ code: 'dinormalkan_registri', pesan: `Dikenali sebagai brand ${reg.brand} · nama dagang ${reg.product_line}.` });
    }
    brandIn = reg.brand;
    lineIn = reg.product_line;
  }

  const brandW = kata(brandIn);
  const lineW = kata(lineIn).filter((w) => !brandW.includes(w));
  const catRaw = kategoriKanon(catIn);
  let cat = catRaw.filter((w) => !brandW.includes(w) && !lineW.includes(w));
  // Brand yang MEMUAT kata jenis produk ("bumbu" · "Bumbu Bunda", "madu" · "Madu TJ") sah: jenis produk dipertahankan,
  // tetapi tak diulang di slug/nama (bumbu-bunda, bukan bumbu-bumbu-bunda). Jenis = brand persis → galat.
  const catDiBrand = !cat.length && catRaw.length > 0 && catRaw.length < brandW.length && catRaw.every((w) => brandW.includes(w));
  if (catDiBrand) cat = catRaw.slice();
  if (!brandW.length) err('merek_wajib');
  if (!cat.length) err(catRaw.length ? 'kategori_hanya_merek' : 'kategori_wajib');
  // "granola blueberry" → varian nyasar ke jenis produk. Kata PERTAMA boleh kata varian (jenis produk "madu",
  // "kurma", "matcha latte" sah); jenis produk terdaftar (JENIS_PRODUK) selalu sah.
  else if (!JENIS_PRODUK.includes(cat.join(' ')) && cat.slice(1).some((w) => SINONIM.some(([syn]) => syn === w))) err('kategori_berisi_varian');
  if (mode !== 'all' && mode !== 'single') err('mode_tak_valid');

  let varKanon = [];
  let variantDisplay = null;
  if (mode === 'single') {
    const pakai = new Set([...cat, ...brandW, ...lineW]);
    const vIn = kata(variantIn).filter((w) => !pakai.has(w)).join(' ');
    varKanon = kanonVarian(vIn);
    if (!varKanon.length) err('varian_wajib');
    else if (reg) {
      // cocokkan ke varian terdaftar lewat kata pembeda (coklat → "Dark Chocolate")
      const pemb = new Set(kataPembeda(varKanon));
      const cocok = (reg.variants || []).find((v) => kataPembeda(kanonVarian(v)).some((w) => pemb.has(w)));
      if (cocok) { varKanon = kanonVarian(cocok).filter((w) => pemb.has(w) || !KATA_GENERIK.has(w)); variantDisplay = cocok; if (!varKanon.length) varKanon = kanonVarian(cocok); }
      else catatan.push({ code: 'varian_tak_terdaftar', pesan: `Varian "${variantIn}" belum ada di daftar varian ${reg.product_line} (${(reg.variants || []).join(', ')}) — sistem akan memeriksanya dari hasil panen.` });
    }
  }

  const catSlug = catDiBrand ? '' : cat.join(' ');
  const slugParts = [catSlug, brandW.join(' '), lineW.join(' '), varKanon.join(' ')].filter(Boolean).join(' ');
  const slug = slugParts.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length > SLUG_MAX) err('terlalu_panjang');

  const catJudul = judul(cat.join(' '));
  const brandJudul = judul(brandIn);
  const lineJudul = lineW.length ? judul(lineIn) : '';
  const varJudul = varKanon.length ? judul(varKanon.join(' ')) : '';
  const productName = [catDiBrand ? '' : catJudul, brandJudul, lineJudul, varJudul].filter(Boolean).join(' ');
  const label = [catJudul, brandJudul, lineJudul, mode === 'single' ? `varian ${variantDisplay || varJudul}` : 'semua varian'].filter(Boolean).join(' · ');
  const ok = errors.length === 0;
  return {
    ok,
    errors,
    catatan,
    slug: ok ? slug : null,
    slug_pratinjau: slug || null,
    product_name: productName,
    label,
    category: cat.join(' ') || null,
    brand: brandIn || null,
    product_line: lineW.length ? lineIn : null,
    variant_mode: mode,
    variant: mode === 'single' && varKanon.length ? varKanon.join(' ') : null,
    variant_input: mode === 'single' && variantIn ? variantIn : null,
    variant_display: mode === 'single' ? (variantDisplay || varJudul || null) : null,
    key_v: PRODUCT_KEY_V,
    registri: reg ? { brand: reg.brand, product_line: reg.product_line, variants: reg.variants.slice() } : null,
  };
}

/** Jangkar identitas produk: nama dagang bila ada, selain itu brand (dipakai pencarian & gate). */
export function jangkarIdentitas(key) {
  return (key && (key.product_line || key.brand)) || null;
}

/** Alias identitas turunan kunci (frasa yang SAH saja): "granola timur tengah", "timur tengah grainnola", …. */
export function aliasIdentitas(key, ekstra = []) {
  if (!key) return [];
  const out = [];
  const add = (s) => { const n = normKata(s); if (n && !out.includes(n) && aliasSah(n, key)) out.push(n); };
  const anchor = jangkarIdentitas(key);
  add(anchor);
  if (key.product_line) {
    add(`${key.brand} ${key.product_line}`);
    add(`${key.product_line} ${key.brand}`);
    add(`${key.category} ${key.brand}`);
    add(`${key.brand} ${key.category}`);
  }
  add(`${key.category} ${anchor}`);
  const reg = cariRegistri(key);
  for (const a of (reg && reg.aliases) || []) add(a);
  for (const a of ekstra || []) add(a);
  return out;
}

export default {
  PRODUCT_KEY_V, slugifyLegacy, normKata, kata, rapat, jarakEdit, KAMUS_KATEGORI, JENIS_PRODUK, KELUARGA_VARIAN,
  KATA_GENERIK, KATA_PENGUBAH, kanonVarian, kataPembeda, variantTokens, REGISTRI_PRODUK, cariRegistri, aliasSah,
  PRODUCT_KEY_ERRORS, buildProductKey, jangkarIdentitas, aliasIdentitas,
};
