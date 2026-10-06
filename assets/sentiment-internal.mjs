/*
 * PIMAS — SENTIMEN PRODUK INTERNAL (plan 6 Okt 2026, kontrak §4.4/§4.5).
 * Diimpor: formulir dashboard (views/sentimen.js, browser) dan Cloudflare Worker (apps/webhook, di-bundle wrangler).
 * MURNI: tanpa DOM, tanpa fs, tanpa network — bisa diuji langsung di Node.
 */

export const SKU_RE = /^[A-Z0-9][A-Z0-9-]{1,40}$/;
export const SKU_MIN_TEKS = 10;
export const DEPTHS = ['shallow', 'standard', 'deep'];

/** Normalisasi kode SKU: trim + upper-case. */
export function normalizeSku(s) { return String(s == null ? '' : s).trim().toUpperCase(); }

/** Slug internal: sku-<kode lower, non [a-z0-9] → '-'>. */
export function internalSlug(sku) {
  return 'sku-' + normalizeSku(sku).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Request internal (kontrak §4.5). `master` = isi memory/sku-master.json ({items:{KODE:{nama,brand,lini,…}}}).
 * Kembalikan {ok:true, request} atau {ok:false, status:422, code, message}.
 * `prev` = request lama (bila ada) → run_count naik, first_requested_at dipertahankan.
 */
export function buildInternalRequest({ sku, master, depth, prev, now, user } = {}) {
  const kode = normalizeSku(sku);
  if (!SKU_RE.test(kode)) return { ok: false, status: 422, code: 'sku_tak_valid', message: 'Kode SKU tidak valid.' };
  const items = master && typeof master === 'object' && master.items && typeof master.items === 'object' ? master.items : {};
  const it = Object.prototype.hasOwnProperty.call(items, kode) ? items[kode] : null;
  if (!it || typeof it !== 'object') return { ok: false, status: 422, code: 'sku_tak_dikenal', message: 'Kode SKU tidak ada di master produk.' };
  const nama = String(it.nama || kode).slice(0, 160);
  const at = now || new Date().toISOString();
  const prevRuns = prev && Number.isFinite(prev.run_count) ? prev.run_count : 0;
  const request = {
    slug: internalSlug(kode),
    source_mode: 'internal',
    sku: kode,
    sku_label: nama,
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

/** Label opsi: "<nama> · <n_teks> ulasan" (tanpa kode; angka gaya Indonesia). `nama` opsional = nama tampil (pembeda). */
export function skuOptionLabel(o, nama) {
  const n = Number(o && o.n_teks) || 0;
  return `${nama || (o && (o.label || o.kode)) || ''} · ${_fmtN(n)} ulasan`;
}

/** Cari opsi dari teks label yang dipilih/diketik (nama tampil atau label lengkap). Tak ketemu → null. */
export function findSkuByLabel(options, text, names) {
  const list = Array.isArray(options) ? options.filter((o) => o && o.kode) : [];
  const nm = names || skuDisplayNames(list);
  const q = String(text == null ? '' : text).trim().toLowerCase();
  if (!q) return null;
  return list.find((o) => skuOptionLabel(o, nm.get(o.kode)).toLowerCase() === q) || null;
}

/** Payload formulir mode internal. `state` = {sku, depth, submit_key, username, options?}.
 *  SKU kosong / tak ada di `options` (bila diberikan) → null (validasi klien). */
export function buildInternalPayload(state = {}) {
  const sku = normalizeSku(state.sku);
  if (!sku || !SKU_RE.test(sku)) return null;
  if (Array.isArray(state.options) && !state.options.some((o) => o && normalizeSku(o.kode) === sku)) return null;
  return {
    source: 'dashboard',
    source_mode: 'internal',
    sku,
    depth: DEPTHS.includes(state.depth) ? state.depth : 'standard',
    submit_key: state.submit_key,
    username: state.username || undefined,
  };
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
