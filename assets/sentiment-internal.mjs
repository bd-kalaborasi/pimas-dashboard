/*
 * PIMAS — SENTIMEN PRODUK INTERNAL (plan 6 Okt 2026, kontrak §4.4/§4.5).
 * Diimpor: formulir dashboard (views/sentimen.js, browser) dan Cloudflare Worker (apps/webhook, di-bundle wrangler).
 * MURNI: tanpa DOM, tanpa fs, tanpa network — bisa diuji langsung di Node.
 */

export const SKU_RE = /^[A-Z0-9][A-Z0-9-]{1,40}$/;
export const SKU_MIN_TEKS = 10;
export const DEPTHS = ['shallow', 'standard', 'deep'];
/** Gabungan varian (keputusan owner 6 Okt 2026): maksimal kode SKU per analisis & panjang nama produk gabungan. */
export const MAX_SKUS = 10;
export const SKU_LABEL_MAX = 80;

/** Normalisasi kode SKU: trim + upper-case. */
export function normalizeSku(s) { return String(s == null ? '' : s).trim().toUpperCase(); }

/** Nama produk gabungan dari pengguna → teks biasa: tag HTML & karakter kontrol dibuang, spasi dirapikan, maks 80 karakter. */
export function sanitizeSkuLabel(s) {
  return String(s == null ? '' : s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SKU_LABEL_MAX)
    .trim();
}

/* Kata ukuran/kemasan yang diabaikan saat mencocokkan nama varian (angka juga diabaikan). */
const KATA_ABAI = new Set(['gr', 'g', 'gram', 'grm', 'gm', 'kg', 'mg', 'ml', 'l', 'lt', 'ltr', 'liter', 'litre', 'oz', 'jar', 'pouch', 'pch',
  'pcs', 'pc', 'pack', 'pak', 'box', 'botol', 'btl', 'sachet', 'kaleng', 'toples', 'cup', 'bundling', 'bundle', 'paket', 'isi', 'dan', 'and']);
/* Kata kemasan yang dibuang dari nama saat membentuk nama produk gabungan (bundling/paket tetap: itu jenis jualan, bukan kemasan). */
const KEMASAN_LABEL = new Set(['jar', 'pouch', 'pch', 'pcs', 'pc', 'pack', 'box', 'botol', 'btl', 'sachet', 'kaleng', 'toples', 'cup',
  'gr', 'g', 'gram', 'grm', 'gm', 'kg', 'mg', 'ml', 'l', 'lt', 'ltr', 'liter', 'litre', 'oz']);
const UKURAN_RE = /^\d+(?:[.,]\d+)?(?:x|gr|g|gram|grm|gm|kg|mg|ml|l|lt|ltr|liter|oz|pcs|pc)?$/i;
const _str = (v) => (typeof v === 'string' ? v.trim() : '');
const _bbKey = (v) => _str(v).toLowerCase().replace(/\s+/g, ' ');

/** Kata inti nama produk (huruf kecil, tanpa angka & kata ukuran/kemasan), unik. */
export function kataInti(nama) {
  const out = new Set();
  for (const w of String(nama == null ? '' : nama).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/)) {
    if (w.length < 2 || /\d/.test(w) || KATA_ABAI.has(w)) continue;
    out.add(w);
  }
  return out;
}

/**
 * Nama produk gabungan bawaan untuk satu opsi SKU: `bb_induk` bila ada; kalau tidak, nama SKU tanpa gramasi/kemasan
 * ("Bundling 2 Pcs PNH Trail Mix Choco Banana 125 g" jadi "Bundling PNH Trail Mix Choco Banana"). Maks 80 karakter.
 */
export function defaultGroupLabel(opt) {
  const o = opt && typeof opt === 'object' ? opt : {};
  const bb = sanitizeSkuLabel(o.bb_induk);
  if (bb) return bb;
  const nama = _str(o.label) || _str(o.nama) || _str(o.kode);
  const kept = nama.split(/\s+/).filter((tok) => {
    const w = tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (!w) return false;
    return !(UKURAN_RE.test(w) || KEMASAN_LABEL.has(w.toLowerCase()));
  });
  return sanitizeSkuLabel(kept.join(' ').replace(/^[\s\-|,]+|[\s\-|,]+$/g, '')) || sanitizeSkuLabel(nama);
}

/**
 * Saran varian lain untuk SKU utama (formulir, murni). Hanya opsi yang ada di `options` (= sku_options).
 * - `bb_induk` sama (keduanya terisi): disarankan dan dicentang (`alasan:'bb_induk'`). Pengaman: bila brand keduanya
 *   terisi dan BEDA (bb_induk master bisa lintas brand, mis. Chiaseed Organik = Safiya & PNH), tetap disarankan tetapi
 *   TANPA centang (`alasan:'bb_induk_brand_lain'`), supaya produk brand lain tak tergabung diam-diam.
 * - salah satu `bb_induk` kosong: disarankan TANPA centang bila nama berbagi minimal 2 kata inti (`alasan:'nama'`);
 *   paling banyak SARAN_NAMA_MAKS (kata sama terbanyak dulu) supaya daftar SKU paket tidak membanjir.
 * - `bb_induk` keduanya terisi tapi beda: bukan varian (walau namanya mirip).
 * Urut: bb_induk dulu, lalu kata sama terbanyak, lalu ulasan bertulisan terbanyak. Mengembalikan salinan opsi + {checked, alasan}.
 */
export const SARAN_NAMA_MAKS = 12;
export function suggestVariants(options, primaryKode) {
  const list = Array.isArray(options) ? options.filter((o) => o && o.kode) : [];
  const kode = normalizeSku(primaryKode);
  const utama = list.find((o) => normalizeSku(o.kode) === kode);
  if (!utama) return [];
  const bbU = _bbKey(utama.bb_induk);
  const brandU = _bbKey(utama.brand);
  const kataU = kataInti(utama.label || utama.nama || '');
  const out = [];
  for (const o of list) {
    const k = normalizeSku(o.kode);
    if (k === kode || out.some((x) => normalizeSku(x.kode) === k)) continue;
    const bbO = _bbKey(o.bb_induk);
    if (bbU && bbO) {
      if (bbU !== bbO) continue;
      const brandO = _bbKey(o.brand);
      const brandLain = !!(brandU && brandO && brandU !== brandO);
      out.push({ ...o, checked: !brandLain, alasan: brandLain ? 'bb_induk_brand_lain' : 'bb_induk', _sama: brandLain ? 1e9 : Infinity });
      continue;
    }
    let sama = 0;
    for (const w of kataInti(o.label || o.nama || '')) if (kataU.has(w)) sama++;
    if (sama >= 2) out.push({ ...o, checked: false, alasan: 'nama', _sama: sama });
  }
  out.sort((a, b) => ((b._sama === a._sama ? 0 : b._sama > a._sama ? 1 : -1)) || ((Number(b.n_teks) || 0) - (Number(a.n_teks) || 0)) || String(a.kode).localeCompare(String(b.kode)));
  let nNama = 0;
  return out.filter((o) => o.alasan !== 'nama' || ++nNama <= SARAN_NAMA_MAKS).map(({ _sama, ...o }) => o);
}

/**
 * Validasi daftar kode varian (Worker & sentiment-request): `sku` = kode utama, `skus` = semua kode (opsional).
 * Kode utama selalu pertama; duplikat dibuang; maks MAX_SKUS; semua harus lolos SKU_RE dan ada di master.
 * Hasil: {ok:true, kode, skus, items, varian:[{kode,nama}]} atau {ok:false, status:422, code, message, kode_salah:[...]}.
 */
export function resolveInternalSkus({ sku, skus, master } = {}) {
  const tolak = (code, message, salah = []) => ({ ok: false, status: 422, code, message, kode_salah: salah });
  const bersih = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 45);
  const kode = normalizeSku(sku);
  if (!SKU_RE.test(kode)) return tolak('sku_tak_valid', `Kode SKU tidak valid: ${bersih(sku) || '(kosong)'}.`, [bersih(sku)]);
  const list = [kode];
  if (skus != null) {
    if (!Array.isArray(skus)) return tolak('sku_tak_valid', 'Daftar kode SKU varian tidak valid.');
    const salah = [];
    for (const s of skus) {
      const k = normalizeSku(s);
      if (!SKU_RE.test(k)) { salah.push(bersih(s) || '(kosong)'); continue; }
      if (!list.includes(k)) list.push(k);
    }
    if (salah.length) return tolak('sku_tak_valid', `Kode SKU tidak valid: ${salah.slice(0, MAX_SKUS).join(', ')}.`, salah.slice(0, MAX_SKUS));
  }
  if (list.length > MAX_SKUS) return tolak('sku_terlalu_banyak', `Maksimal ${MAX_SKUS} kode SKU per analisis (diterima ${list.length}).`);
  const items = master && typeof master === 'object' && master.items && typeof master.items === 'object' ? master.items : {};
  const ada = (k) => Object.prototype.hasOwnProperty.call(items, k) && items[k] && typeof items[k] === 'object';
  const tak = list.filter((k) => !ada(k));
  if (tak.length) return tolak('sku_tak_dikenal', `Kode SKU tidak ada di master produk: ${tak.join(', ')}.`, tak);
  return { ok: true, kode, skus: list, items, varian: list.map((k) => ({ kode: k, nama: String(items[k].nama || k).slice(0, 160) })) };
}

/** Nama produk untuk request: dari pengguna (disanitasi); bila kosong: 1 SKU = nama master, lebih dari 1 SKU = defaultGroupLabel SKU utama. */
export function internalGroupLabel({ sku_label, kode, skus, items } = {}) {
  const dariPengguna = sanitizeSkuLabel(sku_label);
  if (dariPengguna) return dariPengguna;
  const it = items && kode && Object.prototype.hasOwnProperty.call(items, kode) ? items[kode] : null;
  const nama = String((it && it.nama) || kode || '').slice(0, 160);
  if (!Array.isArray(skus) || skus.length <= 1) return nama;
  return defaultGroupLabel({ ...(it || {}), kode, label: nama }) || nama;
}

/** Slug internal: sku-<kode lower, non [a-z0-9] → '-'>. */
export function internalSlug(sku) {
  return 'sku-' + normalizeSku(sku).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Request internal (kontrak §4.5 + gabungan varian 6 Okt 2026). `master` = isi memory/sku-master.json
 * ({items:{KODE:{nama,brand,lini,bb_induk,...}}}). `skus` (opsional) = semua kode varian termasuk utama; `sku_label`
 * (opsional) = nama produk gabungan dari pengguna. Request 1-SKU lama (tanpa skus/sku_label) tetap valid.
 * Kembalikan {ok:true, request} atau {ok:false, status:422, code, message, kode_salah}.
 * `prev` = request lama (bila ada): run_count naik, first_requested_at dipertahankan.
 */
export function buildInternalRequest({ sku, skus, sku_label, master, depth, prev, now, user } = {}) {
  const rs = resolveInternalSkus({ sku, skus, master });
  if (!rs.ok) return rs;
  const kode = rs.kode;
  const it = rs.items[kode];
  const nama = internalGroupLabel({ sku_label, kode, skus: rs.skus, items: rs.items });
  const at = now || new Date().toISOString();
  const prevRuns = prev && Number.isFinite(prev.run_count) ? prev.run_count : 0;
  const request = {
    slug: internalSlug(kode),
    source_mode: 'internal',
    sku: kode,
    skus: rs.skus,
    sku_label: nama,
    varian: rs.varian,
    product_name: nama,
    brand: String(it.brand || ''),
    category: String(it.lini || ''),
    platforms: ['shopee', 'tiktok'],
    reference_urls: [],
    depth: DEPTHS.includes(depth) ? depth : 'standard',
    first_requested_at: (prev && (prev.first_requested_at || prev.requested_at)) || at,
    run_count: prevRuns + 1,
    requested_at: at,
    requested_by: 'dashboard',
  };
  if (user && user.user) request.requested_by_user = { user: user.user, verified: user.verified === true, at };
  return { ok: true, request, rerun: !!prev, run_count: request.run_count };
}

/** Filter opsi dropdown SKU: case-insensitive pada kode, label/nama, brand; urut n_teks desc. Query kosong → semua. */
export function filterSkuOptions(options, query) {
  const list = Array.isArray(options) ? options.filter((o) => o && o.kode) : [];
  const q = String(query == null ? '' : query).trim().toLowerCase();
  const out = q
    ? list.filter((o) => [o.kode, o.label, o.brand].some((f) => String(f || '').toLowerCase().includes(q)))
    : list.slice();
  return out.sort((a, b) => (Number(b.n_teks) || 0) - (Number(a.n_teks) || 0));
}

const _fmtN = (n) => String(Number(n) || 0).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const _namaKey = (o) => String((o && (o.label || o.kode)) || '').trim().toLowerCase();

/** Nama tampil per opsi: nama master; hanya bila dua opsi bernama persis sama ditambah pembeda kecil
 *  (lini, lalu brand, lalu nomor urut) — BUKAN kode. Kembalikan Map kode → nama tampil. */
export function skuDisplayNames(options) {
  const list = Array.isArray(options) ? options.filter((o) => o && o.kode) : [];
  const grup = new Map();
  for (const o of list) { const k = _namaKey(o); if (!grup.has(k)) grup.set(k, []); grup.get(k).push(o); }
  const out = new Map();
  for (const g of grup.values()) {
    if (g.length === 1) { out.set(g[0].kode, g[0].label || g[0].kode); continue; }
    const pakai = new Set();
    g.forEach((o, i) => {
      const base = o.label || o.kode;
      let nm = base;
      const cand = [o.lini, o.brand].map((x) => String(x || '').trim()).filter(Boolean);
      for (const c of cand) {
        const kandidat = `${base} (${c})`;
        if (!pakai.has(kandidat) && g.filter((x) => String(x.lini || '').trim() === String(o.lini || '').trim() && String(x.brand || '').trim() === String(o.brand || '').trim()).length === 1) { nm = kandidat; break; }
      }
      if (nm === base || pakai.has(nm)) nm = `${base} (${i + 1})`;
      pakai.add(nm);
      out.set(o.kode, nm);
    });
  }
  return out;
}

/** Label opsi: "<nama> · <n_teks> ulasan bertulisan" (tanpa kode; angka gaya Indonesia). `nama` opsional = nama tampil (pembeda). */
export function skuOptionLabel(o, nama) {
  const n = Number(o && o.n_teks) || 0;
  return `${nama || (o && (o.label || o.kode)) || ''} · ${_fmtN(n)} ulasan bertulisan`;
}

/** Cari opsi dari teks label yang dipilih/diketik (nama tampil atau label lengkap). Tak ketemu → null. */
export function findSkuByLabel(options, text, names) {
  const list = Array.isArray(options) ? options.filter((o) => o && o.kode) : [];
  const nm = names || skuDisplayNames(list);
  const q = String(text == null ? '' : text).trim().toLowerCase();
  if (!q) return null;
  return list.find((o) => skuOptionLabel(o, nm.get(o.kode)).toLowerCase() === q) || null;
}

/** Payload formulir mode internal. `state` = {sku, skus?, sku_label?, depth, submit_key, username, options?}.
 *  `skus` = kode varian yang digabung (kode utama selalu pertama, unik, maks 10); `sku_label` = nama produk untuk
 *  laporan (kosong: nama bawaan dari opsi). SKU kosong/tak valid, kode tak ada di `options` (bila diberikan), atau
 *  lebih dari 10 kode: null (validasi klien). */
export function buildInternalPayload(state = {}) {
  const sku = normalizeSku(state.sku);
  if (!sku || !SKU_RE.test(sku)) return null;
  const skus = [sku];
  for (const s of Array.isArray(state.skus) ? state.skus : []) {
    const k = normalizeSku(s);
    if (!SKU_RE.test(k)) return null;
    if (!skus.includes(k)) skus.push(k);
  }
  if (skus.length > MAX_SKUS) return null;
  const opts = Array.isArray(state.options) ? state.options.filter((o) => o && o.kode) : null;
  if (opts && !skus.every((k) => opts.some((o) => normalizeSku(o.kode) === k))) return null;
  let label = sanitizeSkuLabel(state.sku_label);
  if (!label && opts) {
    const utama = opts.find((o) => normalizeSku(o.kode) === sku);
    label = skus.length > 1 ? defaultGroupLabel(utama) : sanitizeSkuLabel(utama && (utama.label || utama.kode));
  }
  return {
    source: 'dashboard',
    source_mode: 'internal',
    sku,
    skus,
    sku_label: label || undefined,
    depth: DEPTHS.includes(state.depth) ? state.depth : 'standard',
    submit_key: state.submit_key,
    username: state.username || undefined,
  };
}

/** Total ulasan bertulisan untuk kode-kode terpilih (dari opsi dropdown). */
export function totalUlasanBertulisan(options, skus) {
  const want = new Set((Array.isArray(skus) ? skus : []).map(normalizeSku));
  let n = 0;
  for (const o of Array.isArray(options) ? options : []) if (o && want.has(normalizeSku(o.kode))) n += Number(o.n_teks) || 0;
  return n;
}

/* SINKRON dengan lib/kutipan-format.mjs (dashboard tak mengimpor dari lib/) — ubah keduanya bersamaan. */
export function formatKutipanUlasan(text) {
  const s = String(text == null ? '' : text);
  if (!s.includes(':')) return s;
  const lines = s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (!lines.length) return s;
  /* kunci templat = 1–4 kata (huruf/angka/_), diawali huruf, ":" TANPA spasi sesudahnya (bukan "://"). */
  const KEY = '[A-Za-z][A-Za-z0-9_]*(?: [A-Za-z][A-Za-z0-9_]*){0,3}';
  /* di tengah baris (teks sudah rata) kunci dibatasi: 1 kata huruf kecil, atau kata berkapital + maksimal 1 kata ("Rasa tawar") supaya ekor nilai tidak ikut jadi kunci */
  const MID = '(?:[A-Z][A-Za-z0-9_]*(?: [A-Za-z][A-Za-z0-9_]*)?|[a-z][A-Za-z0-9_]*)';
  const reStart = new RegExp('^(' + KEY + '):(?=[^ /])');
  const reMid = new RegExp('(?<= )(' + MID + '):(?=[^ /])', 'g');
  const reSpaced = new RegExp('^(' + KEY + '): +(?=[^ ])');
  const parsed = lines.map((l) => {
    const hits = [];
    const st = reStart.exec(l);
    if (st) hits.push({ i: 0, end: st[0].length, key: st[1] });
    for (const h of l.matchAll(reMid)) if (h.index >= (st ? st[0].length : 0)) hits.push({ i: h.index, end: h.index + h[0].length, key: h[1] });
    return { l, hits };
  });
  const tight = parsed.reduce((n, p) => n + p.hits.length, 0);
  const startsWithPair = parsed[0].hits.length > 0 && parsed[0].hits[0].i === 0;
  if (!tight || (tight < 2 && !startsWithPair)) return s;
  const cap = (k) => { const t = k.replace(/_/g, ' ').trim(); return `${t.charAt(0).toUpperCase()}${t.slice(1)}`; };
  const out = [];
  for (const p of parsed) {
    let hits = p.hits;
    if (!(hits.length && hits[0].i === 0) && tight >= 2) {
      const sp = reSpaced.exec(p.l);   /* "Rasa tawar: rasanya…" — kunci berspasi di awal baris ikut bila templat terbukti */
      if (sp) hits = [{ i: 0, end: sp[0].length, key: sp[1] }, ...hits.filter((h) => h.i >= sp[0].length)];
    }
    if (!hits.length) { out.push(p.l); continue; }
    if (hits[0].i > 0) out.push(p.l.slice(0, hits[0].i).trim());
    hits.forEach((h, n) => {
      const stop = n + 1 < hits.length ? hits[n + 1].i : p.l.length;
      out.push(`${cap(h.key)}: ${p.l.slice(h.end, stop).trim()}`);
    });
  }
  return out.filter(Boolean).join(' · ');
}
