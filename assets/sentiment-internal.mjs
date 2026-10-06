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

/** Label opsi: "<nama> · <kode> · <n_teks> ulasan" (angka dipisah titik gaya Indonesia). */
export function skuOptionLabel(o) {
  const n = Number(o && o.n_teks) || 0;
  return `${(o && (o.label || o.kode)) || ''} · ${(o && o.kode) || ''} · ${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ulasan`;
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
  const re = /^([a-z][a-z_ ]{1,24}):\s*(.+)$/;
  const m = lines.map((l) => re.exec(l));
  if (m.some((x) => !x)) return s;
  if (lines.length === 1 && !/^[a-z][a-z_ ]{1,24}:\S/.test(lines[0])) return s;
  return m.map((x) => {
    const k = x[1].replace(/_/g, ' ').trim();
    return `${k.charAt(0).toUpperCase()}${k.slice(1)}: ${x[2].trim()}`;
  }).join(' · ');
}
