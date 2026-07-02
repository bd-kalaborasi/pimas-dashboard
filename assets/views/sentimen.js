/*
 * View: Sentimen — modul SENTIMEN standalone (DESIGN tokens + ECharts theme pimas).
 * List: formulir front-door MULTIUSER (login-gated, POST ke Cloudflare Worker) + daftar
 * analisis tersimpan. Detail: ringkasan + 7 visual (donut · mentah-vs-tertimbang ·
 * per-platform · pujian-vs-keluhan · scatter engagement×sentimen · tren · grid kutipan)
 * + Keterbatasan.
 * Data: ctx.data.sentiment {list, detail, submit}. KIRIM: ctx.data.sentiment.submit
 * {enabled, worker_url, submit_key} — kunci enqueue ber-privilese rendah (BUKAN PAT) di
 * blob VIEWER terenkripsi → terbaca SEMUA pengguna login (gate multiuser). Tracker live
 * owner-only memakai ctx.ops.sentiment_trigger (PAT di blob ops, read-only status Actions);
 * non-owner degradasi ke konfirmasi + polling daftar. Sentimen = measure turunan (T3/T4);
 * suka/bintang = bobot, BUKAN angka pasar.
 */

const ALLOW_HOSTS = [/(^|\.)tiktok\.com$/, /(^|\.)shopee\.[a-z.]+$/, /(^|\.)tokopedia\.com$/, /(^|\.)instagram\.com$/, /(^|\.)youtube\.com$/, /(^|\.)youtu\.be$/];
const QUEUED_KEY = 'pimas.sentimen.queued';
/* Antrean LOKAL persisten (localStorage, bukan sessionStorage) — bertahan lintas reload &
   tutup-tab, jadi pengguna SELALU lihat permintaannya tersimpan & sedang diproses → tak lupa
   & tak kirim ulang produk yang sama. Bentuk: { [slug]: { produk, at } }. */
const PENDING_KEY = 'pimas.sentimen.pending';
function readPending() {
  try { const o = JSON.parse(localStorage.getItem(PENDING_KEY) || '{}'); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; } catch { return {}; }
}
function writePending(o) { try { localStorage.setItem(PENDING_KEY, JSON.stringify(o)); } catch { /* abaikan */ } }
function addPending(slug, produk) { if (!slug) return; const o = readPending(); o[slug] = { produk: produk || slug, at: Date.now() }; writePending(o); }
/* buang entri pending yang HASILNYA sudah muncul di daftar terbit (slug ada di list) atau yang
   basi (>24 jam). Kembalikan map yang sudah dibersihkan. */
function reconcilePending(list) {
  const o = readPending(); const have = new Set(); const now = Date.now(); let changed = false;
  for (const x of (list || [])) {
    if (!x || !x.slug) continue;
    have.add(x.slug);
    for (const a of (Array.isArray(x.aliases) ? x.aliases : [])) if (a) have.add(a); // slug merged → alias kanonik → pending bersih
  }
  for (const s of Object.keys(o)) { if (have.has(s) || (now - (o[s].at || 0)) > 86400000) { delete o[s]; changed = true; } }
  if (changed) writePending(o);
  return o;
}
/* kartu "Sedang diproses" untuk produk yang BARU dikirim & hasilnya belum mendarat. */
function pendingCardHtml(ctx, slug, info) {
  const { esc, t } = ctx;
  return `<div class="card sent-card sent-card-pending" data-pending="${esc(slug)}">
    <div class="sent-card-head">
      <div class="sent-card-name">${esc((info && info.produk) || slug)}</div>
      <div class="sent-card-date">${esc(t('sentimen.list.baru_dikirim', null, 'baru dikirim'))}</div>
    </div>
    <div class="sent-card-badges"><span class="badge plain snt-pending-badge"><span class="spinner spinner-sm" aria-hidden="true"></span> ${esc(t('sentimen.list.sedang_diproses', null, 'Sedang diproses'))}</span></div>
    <div class="sent-card-meta"><span class="cap">${esc(t('sentimen.list.pending_ket', null, 'Tersimpan & masuk antrean — hasil muncul di sini saat selesai. Tak perlu kirim ulang.'))}</span></div>
  </div>`;
}
/* render/segarkan baris pending di puncak daftar (#sent-list) tanpa reload halaman. */
function renderPendingRows(root, ctx) {
  const wrap = root.querySelector('#sent-list'); if (!wrap) return;
  const list = (ctx.data && ctx.data.sentiment && Array.isArray(ctx.data.sentiment.list)) ? ctx.data.sentiment.list : [];
  const pend = reconcilePending(list);
  const slugs = Object.keys(pend).filter((s) => !list.some((x) => x && x.slug === s)).sort((a, b) => (pend[b].at || 0) - (pend[a].at || 0));
  const old = wrap.querySelector('.snt-pending-grid'); if (old) old.remove();
  if (!slugs.length) return;
  wrap.insertAdjacentHTML('afterbegin', `<div class="snt-grid snt-pending-grid">${slugs.map((s) => pendingCardHtml(ctx, s, pend[s])).join('')}</div>`);
}

function slugify(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}
function validRefUrl(s) {
  const v = String(s || '').trim();
  if (!/^https:\/\//i.test(v)) return null;
  try { const u = new URL(v); return ALLOW_HOSTS.some((re) => re.test(u.hostname)) ? u.toString() : null; }
  catch { return null; }
}

const VERDICT_TONE = { 'positif-signifikan': 'ok', 'negatif-signifikan': 'warn', 'tidak-konklusif': 'note', indikatif: 'note', 'no-data': 'plain' };
const VERDICT_SYM = { 'positif-signifikan': '▲', 'negatif-signifikan': '▼', 'tidak-konklusif': '=', indikatif: '◍', 'no-data': '◌' };

function verdictBadge(ctx, v) {
  const code = v || 'no-data';
  return ctx.ui.toneBadge(VERDICT_TONE[code] || 'plain', VERDICT_SYM[code] || '◌', ctx.t('sentimen.verdict.' + code, null, code));
}
/* T7 — hint awam untuk verdict "indikatif" (sinyal awal vs kesimpulan pasti): glyph ⓘ
   ber-tabindex + title + aria-label, dapat diakses keyboard/sentuh (§7.8). Verdict lain
   → tak ada hint (string kosong). */
function verdictHint(ctx, verdict) {
  if (verdict !== 'indikatif') return '';
  const txt = ctx.t('sentimen.insight.indikatif_plain', null, '');
  if (!txt) return '';
  return ` <span class="snt-fig-info" tabindex="0" role="note" title="${ctx.esc(txt)}" aria-label="${ctx.esc(txt)}">ⓘ</span>`;
}
function muFmt(ctx, x) { return x === null || x === undefined ? ctx.t('umum.kosong') : ctx.fmt.dec(x, 2); }
function pctFmt(ctx, x) { return x === null || x === undefined ? ctx.t('umum.kosong') : ctx.fmt.persen(x * 100); }

/* ============================================================ Trigger ====== */

/* fireTrigger — front-door MULTIUSER: POST ke Cloudflare Worker (BUKAN api.github.com),
   TANPA PAT di browser. Satu-satunya kredensial yang dikirim = submit_key ber-privilese
   rendah (enqueue-only, rate-limited di Worker) yang hidup di blob VIEWER terenkripsi —
   hanya terbaca sesi login. Worker yang men-derive slug + commit + dispatch (logika SAMA
   dengan jalur GitHub-issue). Mengembalikan body Worker {ok, slug, queued, rerun, message}. */
async function fireTrigger(ctx, payload) {
  const sub = ctx.data && ctx.data.sentiment && ctx.data.sentiment.submit;
  if (!sub || !sub.enabled || !sub.worker_url || !sub.submit_key) {
    const e = new Error('disabled'); e.code = 'DISABLED'; throw e;
  }
  let res;
  try {
    res = await fetch(sub.worker_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'dashboard',
        product_name: payload.product_name,
        brand: payload.brand || undefined,
        reference_urls: payload.reference_urls || [],
        platforms: payload.platforms || ['tiktok', 'shopee', 'tokopedia'],
        depth: payload.depth || 'standard',
        submit_key: sub.submit_key,
      }),
    });
  } catch { const e = new Error('network'); e.code = 'HTTP'; throw e; }
  let body = null;
  try { body = await res.json(); } catch { /* tolerate empty/non-JSON */ }
  if (res.ok && body && body.ok) return body; // {ok, slug, queued, rerun, message}
  // Bawa status + pesan Worker agar UI bisa BEDAKAN: 403 (server tak dikonfigurasi) vs 401
  // (key drift) vs 401-antibot (Turnstile) — sebelumnya semua kolaps jadi satu pesan opaque.
  if (res.status === 401 || res.status === 403) { const e = new Error('key'); e.code = 'TOKEN'; e.httpStatus = res.status; e.serverMessage = (body && body.message) || ''; throw e; }
  if (res.status === 429) { const e = new Error('rate'); e.code = 'RATE'; throw e; }
  const e = new Error((body && body.message) || ('HTTP ' + res.status)); e.code = 'HTTP'; throw e;
}

function triggerFormHtml(ctx) {
  const { t, esc } = ctx;
  return `
  <form id="sent-form" class="sent-form" novalidate>
    <div class="sf-row">
      <label class="field">
        <span>${esc(t('sentimen.form.produk_label'))}</span>
        <input class="input" id="sf-produk" type="text" placeholder="${esc(t('sentimen.form.produk_ph'))}" autocapitalize="none" spellcheck="false" required>
      </label>
      <label class="field sf-depth">
        <span>${esc(t('sentimen.form.depth_label'))}</span>
        <select class="select" id="sf-depth">
          <option value="standard" selected>${esc(t('sentimen.form.depth_standard'))}</option>
          <option value="shallow">${esc(t('sentimen.form.depth_shallow'))}</option>
          <option value="deep">${esc(t('sentimen.form.depth_deep'))}</option>
        </select>
        <span class="cap sf-hint">${esc(t('sentimen.form.depth_ket', null, ''))}</span>
      </label>
    </div>
    <div class="field">
      <span>${esc(t('sentimen.form.url_label'))}</span>
      <span class="cap sf-hint">${esc(t('sentimen.form.url_ket', null, ''))}</span>
      <div id="sf-urls"></div>
      <button type="button" class="textlink" id="sf-addurl">${esc(t('sentimen.form.url_tambah'))}</button>
    </div>
    <div id="sf-rerun" class="sf-rerun" role="note" aria-live="polite" hidden></div>
    <button class="cta" type="submit" id="sf-go">${esc(t('sentimen.form.tombol'))}</button>
    <div id="sf-msg" role="status" aria-live="polite"></div>
  </form>`;
}

function bindTriggerForm(root, ctx, timers) {
  const { t, esc, fmt } = ctx;
  const urlsWrap = root.querySelector('#sf-urls');
  const addUrlRow = (value) => {
    const row = document.createElement('div');
    row.className = 'sf-urlrow';
    row.innerHTML = `<input class="input" type="url" placeholder="${esc(t('sentimen.form.url_ph'))}" inputmode="url">
      <button type="button" class="icon-btn" data-rm aria-label="${esc(t('sentimen.form.url_hapus'))}">✕</button>`;
    if (value) row.querySelector('input').value = value;
    row.querySelector('[data-rm]').addEventListener('click', () => row.remove());
    urlsWrap.appendChild(row);
  };
  root.querySelector('#sf-addurl').addEventListener('click', () => addUrlRow());
  /* seed satu baris kosong agar field referensi terlihat; URL OPSIONAL (akselerator presisi)
     — lihat submit gate (hanya slug yang wajib). Prefill rerun bisa menggantinya (allEmpty check). */
  addUrlRow();

  /* RE-RUN AWARENESS: saat user mengetik nama produk, cek apakah slug-nya sudah
     pernah dianalisis (ctx.data.sentiment.list). Bila cocok → catatan inline + tombol
     berubah jadi varian "Perbarui". Murni UI: submit tetap memanggil fireTrigger
     sama persis (server menggabungkan referensi run sebelumnya). */
  const sd = ctx.data && ctx.data.sentiment;
  const list = (sd && Array.isArray(sd.list)) ? sd.list : [];
  const detail = (sd && sd.detail && typeof sd.detail === 'object') ? sd.detail : {};
  const noteEl = root.querySelector('#sf-rerun');
  const goBtn = root.querySelector('#sf-go');
  const baseLabel = t('sentimen.form.tombol');
  let prefilledSlug = null; /* slug yang reference_urls-nya sudah di-prefill (anti dobel) */

  const findMatch = (val) => {
    const slug = slugify(val);
    if (!slug) return null;
    return list.find((it) => it && it.slug === slug) || null;
  };
  const onProdukInput = () => {
    const input = root.querySelector('#sf-produk');
    if (!input || !noteEl || !goBtn) return;
    const match = findMatch(input.value);
    if (!match) {
      /* dedup PENDING: bila produk yang diketik sedang diproses (baru dikirim), beri tahu — anti dobel-kirim. */
      const pslug = slugify(input.value);
      const pend = readPending();
      if (pslug && pend[pslug]) {
        noteEl.hidden = false;
        noteEl.innerHTML = `<span class="sf-rerun-ico" aria-hidden="true">⏳</span><span>${esc(t('sentimen.form.sedang_diproses_note', null, 'Produk ini sedang diproses (kamu baru mengirimnya) — tak perlu kirim ulang; pantau di daftar bawah.'))}</span>`;
        goBtn.textContent = baseLabel;
        return;
      }
      if (!noteEl.hidden) { noteEl.hidden = true; noteEl.innerHTML = ''; }
      goBtn.textContent = baseLabel;
      return;
    }
    const verdictTxt = t('sentimen.verdict.' + (match.verdict || 'no-data'), null, match.verdict || '');
    const nKom = match.n == null ? null : fmt.int(match.n);
    const tgl = match.date ? fmt.tanggal(match.date) : '';
    noteEl.hidden = false;
    noteEl.innerHTML = `<span class="sf-rerun-ico" aria-hidden="true">↻</span><span>${esc(t('sentimen.form.rerun_note', {
      verdict: verdictTxt,
      n: nKom == null ? t('umum.kosong') : nKom,
      tanggal: tgl,
    }, 'Produk ini sudah dianalisis — verdict {verdict} · {n} komentar · {tanggal}. Menjalankan ulang akan MEMPERBARUI datanya; referensi run sebelumnya otomatis digabung.'))}</span>`;
    goBtn.textContent = t('sentimen.form.tombol_perbarui', null, 'Perbarui analisis');
    /* nicety: bila detail run sebelumnya sudah termuat, prefill baris URL dengan
       reference_urls lama (owner bisa lihat/sunting). Null-guarded; hanya bila baris
       URL masih kosong & belum di-prefill untuk slug ini. */
    const det = detail[match.slug];
    const prevUrls = det && Array.isArray(det.reference_urls) ? det.reference_urls.filter(Boolean) : [];
    const existingInputs = [...urlsWrap.querySelectorAll('input')];
    const allEmpty = existingInputs.every((i) => !i.value.trim());
    if (prevUrls.length && prefilledSlug !== match.slug && allEmpty) {
      existingInputs.forEach((i) => i.closest('.sf-urlrow') && i.closest('.sf-urlrow').remove());
      prevUrls.slice(0, 10).forEach((u) => addUrlRow(u));
      prefilledSlug = match.slug;
    }
  };
  const produkInput = root.querySelector('#sf-produk');
  if (produkInput) produkInput.addEventListener('input', onProdukInput);

  root.querySelector('#sent-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = root.querySelector('#sf-go');
    const msg = root.querySelector('#sf-msg');
    const produk = root.querySelector('#sf-produk').value.trim();
    const depth = root.querySelector('#sf-depth').value;
    const slug = slugify(produk);
    if (!slug) { msg.innerHTML = `<p class="login-err">⚠ ${esc(t('sentimen.form.produk_label'))}</p>`; return; }
    const urls = [...urlsWrap.querySelectorAll('input')].map((i) => validRefUrl(i.value)).filter(Boolean).slice(0, 10);
    /* reference_urls OPSIONAL (akselerator, bukan syarat). Bila ada → jadi anchor presisi +
       buka jalur marketplace. Bila kosong → pipeline AUTO-DISCOVER lewat ekspansi kata kunci;
       terbukti menghasilkan analisis nyata utk brand ber-jejak ID (proof Oatside: 233 in-universe,
       verdict positif-signifikan, TANPA URL). Gate relevansi + watchdog menjaga hasil tetap jujur
       (no-data jujur bila korpus memang sepi). Prinsip full-agentic: agen yang harus pandai, bukan owner. */
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ${esc(t('sentimen.form.mengirim'))}`;
    msg.innerHTML = '';
    let ok = false;
    try {
      /* Worker = otoritas slugifikasi → pakai conf.slug untuk link & tracking
         (fallback ke slug sisi-klien bila respons tak memuatnya). */
      const conf = await fireTrigger(ctx, {
        product_name: produk.slice(0, 120), reference_urls: urls,
        platforms: ['tiktok', 'shopee', 'tokopedia'], depth,
      });
      ok = true;
      const finalSlug = (conf && conf.slug) || slug;
      addPending(finalSlug, produk); /* localStorage persisten → baris "Sedang diproses" di daftar (anti-lupa/anti-dobel) */
      try { sessionStorage.setItem(QUEUED_KEY, JSON.stringify({ slug: finalSlug, produk, at: Date.now() })); } catch { /* abaikan */ }
      /* Kartu pending di daftar = REKAMAN istirahat kanonik (satu indikator proses). startTracking
         hanya mengisi #sf-msg sbg detail live ephemeral; keduanya tak lagi jadi dua kartu kembar. */
      renderPendingRows(root, ctx); /* tampilkan baris pending SEKARANG, tanpa reload, biar user lihat tersimpan */
      startTracking(root, ctx, finalSlug, produk, timers);
      /* RESOLVED STATE: kosongkan formulir agar "formulir kosong + Mulai analisis" terbaca jelas
         sebagai SIAP untuk produk berikutnya (bukan "kirim ulang produk ini?"). Dedup anti-resubmit
         tetap berfungsi bila user mengetik nama yang sama lagi (onProdukInput → readPending). */
      const pInput = root.querySelector('#sf-produk'); if (pInput) pInput.value = '';
      [...urlsWrap.querySelectorAll('.sf-urlrow')].forEach((r) => r.remove());
      addUrlRow();
      prefilledSlug = null;
      if (noteEl) {
        noteEl.hidden = false;
        noteEl.innerHTML = `<span class="sf-rerun-ico" aria-hidden="true">✓</span><span>${esc(t('sentimen.form.tersimpan_lanjut', null, 'Tersimpan & masuk antrean — pantau hasilnya di daftar bawah. Formulir siap untuk produk berikutnya.'))}</span>`;
      }
    } catch (err) {
      let pesan = err && err.message;
      if (err && err.code === 'TOKEN') {
        if (err.httpStatus === 403) pesan = t('sentimen.form.key_notconfig', null, 'Front-door kirim belum dikonfigurasi di server — pengelola perlu set secret SENTIMENT_SUBMIT_KEY di Worker.');
        else if (/anti-?bot|turnstile|verifikasi/i.test(err.serverMessage || '')) pesan = t('sentimen.form.key_turnstile', null, 'Verifikasi anti-bot gagal — muat ulang halaman lalu coba lagi.');
        else pesan = t('sentimen.form.key_mismatch', null, 'Kunci kirim dashboard tak cocok dengan kunci Worker — pengelola perlu menyinkronkan ulang SENTIMENT_SUBMIT_KEY (secret Worker = nilai yang di-bake saat publish).') + (err.serverMessage ? ` [${err.serverMessage}]` : '');
      }
      else if (err && err.code === 'RATE') pesan = t('sentimen.form.rate_limited', null, 'Terlalu banyak permintaan dari sesi ini. Coba lagi beberapa menit.');
      msg.innerHTML = `<div class="callout warn"><p>${esc(t('sentimen.form.error', { pesan }))}</p></div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = baseLabel;
      /* HANYA pada error: pulihkan label "Perbarui" + catatan rerun bila masih cocok. Pada
         sukses, reset di atas sudah memiliki state bersih — jangan ditimpa onProdukInput. */
      if (!ok) onProdukInput();
    }
  });
}

/* ===== progress tracking: poll data viewer tiap ~30s, tampilkan saat siap (tanpa refresh) ===== */

/* fetchRunStatus — baca STATUS RUN NYATA dari GitHub Actions API memakai token yang SAMA
   dengan repository_dispatch (ctx.ops.sentiment_trigger.token + .repo). CSP mengizinkan
   api.github.com. Kembalikan status run workflow_dispatch (event pemicu) paling baru yang
   judul/display_title-nya memuat slug + 'sentiment-analyst' DAN created_at >= sinceMs−5mnt
   (buffer). Filter created_at inilah yang MEMBUNUH phantom: run lama yang dibatalkan untuk
   slug yang sama TIDAK ikut tercocok. Token tak pernah di-log. Error apa pun (token hilang,
   non-200, jaringan) → lempar error ber-tag code='API' agar pemanggil fallback. */
async function fetchRunStatus(ctx, slug, sinceMs) {
  const tr = ctx.ops && ctx.ops.sentiment_trigger;
  if (!tr || !tr.token || !tr.repo) { const e = new Error('api'); e.code = 'API'; throw e; }
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${tr.repo}/actions/workflows/aeon.yml/runs?event=workflow_dispatch&per_page=20`, {
      headers: {
        Authorization: `Bearer ${tr.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch { const e = new Error('network'); e.code = 'API'; throw e; }
  if (!res || res.status !== 200) { const e = new Error('HTTP ' + (res && res.status)); e.code = 'API'; throw e; }
  let json;
  try { json = await res.json(); } catch { const e = new Error('parse'); e.code = 'API'; throw e; }
  const runs = json && Array.isArray(json.workflow_runs) ? json.workflow_runs : [];
  const key = normTheme(slug);
  const buffer = 5 * 60000;
  const floor = (typeof sinceMs === 'number' ? sinceMs : 0) - buffer;
  /* runs sudah desc by created_at (default GitHub); cari yang pertama cocok */
  const match = runs.find((r) => {
    if (!r) return false;
    const created = Date.parse(r.created_at || '');
    if (Number.isFinite(created) && created < floor) return false;
    const hay = normTheme(`${r.name || ''} ${r.display_title || ''}`);
    return hay.includes(key) && hay.includes('sentiment-analyst');
  });
  if (!match) return { found: false };
  return {
    found: true,
    status: match.status || 'queued',
    conclusion: match.conclusion || null,
    html_url: match.html_url || '',
    runId: match.id,
    created_at: match.created_at || '',
  };
}

/* fetchRunStep — best-effort: nama step yang sedang in_progress untuk label tahap nyata.
   Gagal/diam → null (pemanggil jatuh ke stageFor berbasis waktu). */
async function fetchRunStep(ctx, runId) {
  const tr = ctx.ops && ctx.ops.sentiment_trigger;
  if (!tr || !tr.token || !tr.repo || !runId) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${tr.repo}/actions/runs/${runId}/jobs`, {
      headers: {
        Authorization: `Bearer ${tr.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res || res.status !== 200) return null;
    const json = await res.json();
    const jobs = json && Array.isArray(json.jobs) ? json.jobs : [];
    for (const j of jobs) {
      const steps = j && Array.isArray(j.steps) ? j.steps : [];
      const cur = steps.find((s) => s && s.status === 'in_progress');
      if (cur && cur.name) return String(cur.name);
    }
    return null;
  } catch { return null; }
}

/* konklusi terminal yang BUKAN sukses → render pesan jujur (tanpa phantom timer). */
const FAIL_CONCLUSIONS = new Set(['cancelled', 'failure', 'timed_out', 'startup_failure', 'action_required', 'stale']);

function startTracking(root, ctx, slug, produk, timers, startedAtArg) {
  const { t, esc } = ctx;
  const msg = root.querySelector('#sf-msg');
  if (!msg) return;
  /* resume: pakai timestamp tersimpan agar elapsed AKURAT lintas reload/pindah-halaman */
  const resumed = typeof startedAtArg === 'number' && startedAtArg > 0;
  const startedAt = resumed ? startedAtArg : Date.now();
  let done = false;
  /* apiMode: pakai status run NYATA via GitHub API. Bila token absen atau API gagal sekali,
     jatuh permanen ke fallback berbasis waktu (perilaku lama) agar tak menggempur API rusak. */
  const tr = ctx.ops && ctx.ops.sentiment_trigger;
  let apiMode = !!(tr && tr.token && tr.repo);
  let lastStepName = null; /* nama step in_progress nyata (best-effort) */
  let runUrl = '';
  let runStatusCode = ''; /* 'queued' | 'in_progress' | 'completed' | '' */

  msg.innerHTML = trackingHtml(ctx, produk, apiMode);
  const rl2 = msg.querySelector('#st-reload2'); if (rl2) rl2.addEventListener('click', () => location.reload());
  const fmtE = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const stageFor = (min) => (min < 1 ? t('sentimen.progress.s1') : min < 6 ? t('sentimen.progress.s2') : min < 12 ? t('sentimen.progress.s3') : t('sentimen.progress.s4'));

  /* status chip — sumber kebenaran tunggal untuk state visual (Mengantre/Berjalan/Selesai). */
  const setChip = (state) => {
    const chip = msg.querySelector('#st-chip');
    if (!chip) return;
    const map = {
      queued: ['note', t('sentimen.progress.status_queued', null, 'Mengantre…')],
      running: ['tip', t('sentimen.progress.status_running', null, 'Berjalan')],
      done: ['ok', t('sentimen.progress.status_done', null, 'Selesai — memuat hasil…')],
    };
    const [tone, label] = map[state] || map.running;
    chip.className = `sp-chip ${tone}`;
    chip.textContent = label;
  };

  const tick = () => {
    const el = msg.querySelector('#st-elapsed'); const es = msg.querySelector('#st-stage');
    const dt = Date.now() - startedAt;
    if (el) el.textContent = fmtE(dt);
    if (es) {
      /* tahap: pakai nama step NYATA bila ada (apiMode), selain itu tebak berbasis waktu */
      es.textContent = (apiMode && lastStepName) ? lastStepName : stageFor(dt / 60000);
    }
  };
  /* viewer (tanpa PAT): chip "Mengantre" + nada konfirmasi antrean (BUKAN seolah run
     dilihat live). owner (apiMode): chip queued; status run nyata mengambil alih di poll. */
  setChip('queued');
  tick();
  const ti = setInterval(tick, 1000);

  /* cek apakah hasil sudah tayang di daftar terbit (sumber siap = finish sukses). */
  const listHasSlug = async () => {
    const data = ctx.reloadViewer ? await ctx.reloadViewer() : null;
    return !!(data && data.sentiment && (data.sentiment.list || []).some((x) => x.slug === slug));
  };

  const poll = async () => {
    if (done) return;
    /* 1) hasil sudah di daftar terbit → selalu menang (apa pun mode) */
    if (await listHasSlug()) { finish('ready'); return; }
    if (!apiMode) return; /* fallback: hanya andalkan daftar + timeout (di bawah) */

    /* 2) status run NYATA */
    let st;
    try { st = await fetchRunStatus(ctx, slug, startedAt); }
    catch (err) { if (err && err.code === 'API') { apiMode = false; setChip('running'); return; } return; }

    if (!st || !st.found) { setChip('queued'); runStatusCode = 'queued'; return; } /* baru di-dispatch, belum terlihat */
    runUrl = st.html_url || runUrl;
    runStatusCode = st.status || '';

    if (st.status === 'queued') { setChip('queued'); return; }
    if (st.status === 'in_progress') {
      setChip('running');
      /* nama step nyata (best-effort) untuk label tahap */
      fetchRunStep(ctx, st.runId).then((name) => { if (name) lastStepName = name; }).catch(() => {});
      return;
    }
    if (st.status === 'completed') {
      if (st.conclusion === 'success') {
        if (await listHasSlug()) { finish('ready'); return; }
        /* sukses tapi hasil belum terbit → publish sedang menyebar; tahan, terus poll daftar */
        setChip('done');
        return;
      }
      if (st.conclusion && FAIL_CONCLUSIONS.has(st.conclusion)) { finish('failed', st.conclusion, st.html_url); return; }
      /* konklusi tak terduga (mis. null sesaat) → perlakukan sebagai masih jalan */
      setChip('running');
    }
  };
  const pi = setInterval(poll, 30000);
  poll(); /* cek sekali segera (dispatch baru / resume / hasil mungkin sudah siap) */

  /* ~60 mnt timeout HANYA relevan di fallback mode. Di apiMode, status terminal nyata
     (failure/cancelled) yang menghentikan — bukan jam tebakan. Namun tetap pasang sebagai
     jaring pengaman bila API diam-diam berhenti merespons. */
  const to = setTimeout(() => finish('timeout'), Math.max(0, 60 * 60000 - (Date.now() - startedAt)));

  function finish(kind, conclusion, htmlUrl) {
    if (done) return; done = true;
    clearInterval(ti); clearInterval(pi); clearTimeout(to);
    if (kind === 'ready') {
      msg.innerHTML = `<div class="callout ok"><p>${esc(t('sentimen.progress.ready', { produk }))}</p><a class="cta" href="#/sentimen/${encodeURIComponent(slug)}">${esc(t('sentimen.list.kolom_verdict'))} →</a></div>`;
      try { sessionStorage.removeItem(QUEUED_KEY); } catch { /* abaikan */ }
      ctx.toast(t('sentimen.progress.ready_toast', { produk }), 'status');
    } else if (kind === 'failed') {
      /* TERMINAL JUJUR: run berhenti dengan konklusi gagal — TIDAK ada phantom timer. */
      const url = validGhRunUrl(htmlUrl);
      const link = url
        ? `<a class="textlink" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(t('sentimen.progress.lihat_run', null, 'Lihat detail run →'))}</a>`
        : '';
      msg.innerHTML = `<div class="callout warn"><p>${esc(t('sentimen.progress.failed', { conclusion: conclusion || '—' }, 'Analisis terhenti ({conclusion}). Mungkin timeout atau error — coba jalankan ulang.'))}</p>${link}</div>`;
      try { sessionStorage.removeItem(QUEUED_KEY); } catch { /* abaikan */ }
    } else if (kind === 'timeout') {
      /* fallback only: proses lanjut di latar, hasil muncul otomatis. Reload aman bila
         sesi tab diingat — tracking lanjut dari QUEUED_KEY (lihat restoreQueuedTracking). */
      msg.innerHTML = `<div class="callout note"><p>${esc(t('sentimen.progress.timeout', null, 'Masih diproses di latar belakang — ini wajar untuk analisis yang besar. Hasilnya akan muncul di sini secara otomatis begitu siap; halaman ini tak perlu ditutup. Bila sesi tab diingat, memuat ulang halaman pun aman dan tracking akan lanjut sendiri.'))}</p><button type="button" class="textlink" id="st-reload">${esc(t('sentimen.progress.reload', null, 'Muat ulang halaman'))}</button></div>`;
      const r = msg.querySelector('#st-reload'); if (r) r.addEventListener('click', () => location.reload());
    }
  }
  if (timers) timers.push(() => { done = true; clearInterval(ti); clearInterval(pi); clearTimeout(to); });
}

/* sanity-guard URL run agar hanya tautan github.com yang dirender (token tak pernah di URL). */
function validGhRunUrl(u) {
  try { const url = new URL(String(u || '')); return /(^|\.)github\.com$/.test(url.hostname) ? url.toString() : ''; }
  catch { return ''; }
}

function trackingHtml(ctx, produk, apiMode) {
  const { t, esc } = ctx;
  const manual = ctx.reloadViewer ? '' : `<button type="button" class="textlink" id="st-reload2">${esc(t('sentimen.progress.reload'))}</button>`;
  /* viewer (tanpa PAT): konfirmasi antrean — hasil muncul di daftar otomatis. owner
     (apiMode): catatan generik; status run nyata mengisi tahap di #st-stage. */
  const catatan = apiMode
    ? t('sentimen.progress.catatan')
    : t('sentimen.form.queued', { produk }, t('sentimen.progress.catatan'));
  return `<div class="sent-progress" role="status" aria-live="polite">
    <div class="sp-head"><span class="spinner"></span><span>${esc(t('sentimen.progress.judul', { produk }))}</span><span id="st-chip" class="sp-chip note">${esc(t('sentimen.progress.status_queued', null, 'Mengantre…'))}</span></div>
    <div class="sp-bar" aria-hidden="true"><i></i></div>
    <div class="sp-meta"><span id="st-stage" class="sp-stage"></span><span id="st-elapsed" class="sp-elapsed mono">00:00</span></div>
    <p class="cap">${esc(catatan)}</p>${manual}
  </div>`;
}

/* ============================================================ List ========= */

function renderList(el, ctx) {
  const { data, t, esc, fmt, ui } = ctx;
  const sd = data.sentiment;
  const list = (sd && Array.isArray(sd.list)) ? sd.list.slice() : [];
  list.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  /* blok pemicu MULTIUSER: setiap pengguna login melihat & memakai form (gate = login,
     bukan lagi OPS). submit.enabled (dari blob viewer) → form; submit_key absen → catatan
     disabled jujur + fallback Telegram. ctx.hasOps tak lagi menentukan akses kirim. */
  const sub = ctx.data && ctx.data.sentiment && ctx.data.sentiment.submit;
  let triggerBlock;
  if (sub && sub.enabled) {
    triggerBlock = triggerFormHtml(ctx);
  } else {
    triggerBlock = `<div class="callout note">
      <div class="co-title">◌ ${esc(t('sentimen.form.disabled_judul'))}</div>
      <p>${esc(t('sentimen.form.disabled_pesan', { slug: 'nama-produk' }))}</p></div>`;
  }

  el.innerHTML = `
  <header class="pagehead">
    <div>
      <div class="eyebrow">${esc(t('sentimen.eyebrow'))}</div>
      <h1 class="display-l">${esc(t('sentimen.judul'))}</h1>
      <p class="sub">${esc(t('sentimen.subjudul'))}</p>
    </div>
  </header>

  <article class="card">
    <div class="eyebrow">${esc(t('sentimen.form.judul'))}</div>
    <p class="cap snt-form-ket">${esc(t('sentimen.form.keterangan'))}</p>
    ${(sub && sub.enabled) ? `<p class="cap snt-multiuser-note">${esc(t('sentimen.form.multiuser_note', null, ''))} ${esc(t('sentimen.form.login_note', null, ''))}</p>` : ''}
    ${triggerBlock}
  </article>

  <section class="section">
    <div class="section-head"><div class="eyebrow">${esc(t('sentimen.list.judul'))}</div></div>
    <div id="sent-list" style="margin-top:12px"></div>
  </section>`;

  const timers = [];
  if (sub && sub.enabled) bindTriggerForm(el, ctx, timers);

  const wrap = el.querySelector('#sent-list');
  /* baris PENDING lokal (produk baru dikirim, hasil belum mendarat) di puncak daftar — persisten. */
  const pend = reconcilePending(list);
  const pendSlugs = Object.keys(pend).filter((s) => !list.some((x) => x && x.slug === s)).sort((a, b) => (pend[b].at || 0) - (pend[a].at || 0));
  const pendGrid = pendSlugs.length ? `<div class="snt-grid snt-pending-grid">${pendSlugs.map((s) => pendingCardHtml(ctx, s, pend[s])).join('')}</div>` : '';
  if (!list.length && !pendSlugs.length) { wrap.innerHTML = `<div class="card snt-empty-card">${ui.empty('empty.sentimen.list')}</div>`; }
  else if (!list.length) { wrap.innerHTML = pendGrid; }
  else {
    const renderCard = (it) => {
      /* badge "diperbarui {n}×" — field additif run_count (item lama tak punya → skip). */
      const rerun = (typeof it.run_count === 'number' && it.run_count > 1)
        ? `<span class="badge plain snt-rerun-badge">↻ ${esc(t('sentimen.list.diperbarui', { n: fmt.int(it.run_count) }, 'diperbarui {n}×'))}</span>`
        : '';
      /* Item TANPA hasil (running/failed) TIDAK boleh jadi kartu klik buntu — render
         sebagai kartu statis (non-link) dengan isyarat status + umur. running yang sudah
         lama tak diperbarui (>60m) kemungkinan macet/mati → tandai "Macet?". */
      if (it.status === 'running' || it.status === 'failed') {
        /* Staleness HANYA dari timestamp penuh (ISO dengan jam). updated_at date-only
           ("YYYY-MM-DD") tak punya waktu → Date.parse-nya = tengah malam UTC → akan salah
           tandai "Macet?" tiap kali dilihat >60m setelah tengah malam UTC. Runner menulis
           updated_at full-ISO (proposed:340), jadi ini hanya melindungi item lama/date-only. */
        const fullTs = typeof it.updated_at === 'string' && it.updated_at.length > 10;
        const ageMs = fullTs ? (Date.now() - Date.parse(it.updated_at)) : null;
        const stale = ageMs != null && !Number.isNaN(ageMs) && ageMs > 60 * 60000;
        const failed = it.status === 'failed';
        /* reaper-timeout (it.reaped) = dipanen watchdog karena lewat batas waktu → "Timeout",
           BUKAN "Gagal" jujur dari error. Bedakan agar pesan ke pengguna tepat. */
        const badge = failed
          ? (it.reaped
              ? `<span class="badge warn snt-failed-badge">⌛ ${esc(t('sentimen.list.timeout', null, 'Timeout'))}</span>`
              : `<span class="badge warn snt-failed-badge">✕ ${esc(t('sentimen.progress.status_failed', null, 'Gagal'))}</span>`)
          : (stale
              ? `<span class="badge note snt-stale-badge">⚠ ${esc(t('sentimen.list.stuck', null, 'Macet?'))}</span>`
              : `<span class="badge plain snt-running-badge"><span class="spinner spinner-sm" aria-hidden="true"></span> ${esc(t('sentimen.progress.status_running', null, 'Berjalan'))}</span>`);
        const ket = (it.progress && it.progress.message)
          ? esc(it.progress.message)
          : esc(failed
            ? t('sentimen.list.failed_ket', null, 'Analisis tak selesai — mungkin timeout atau korpus sepi. Coba jalankan ulang.')
            : t('sentimen.list.pending_ket', null, 'Tersimpan & masuk antrean — hasil muncul di sini saat selesai. Tak perlu kirim ulang.'));
        const dateIso = it.updated_at || it.date;
        return `
      <div class="card sent-card is-static sent-card-${failed ? 'failed' : 'running'}" aria-disabled="true">
        <div class="sent-card-head">
          <div class="sent-card-name">${esc(it.product_name || it.slug)}</div>
          <div class="sent-card-date">${esc(fmt.tanggal(dateIso))}</div>
        </div>
        <div class="sent-card-badges">${badge} ${rerun}</div>
        <div class="sent-card-meta"><span class="cap">${ket}</span></div>
      </div>`;
      }
      const conf = it.confidence === 'low' ? `<span class="badge plain">◌ ${esc(t('sentimen.confidence.low'))}</span>` : '';
      return `
      <a class="card sent-card" href="#/sentimen/${encodeURIComponent(it.slug)}">
        <div class="sent-card-head">
          <div class="sent-card-name">${esc(it.product_name || it.slug)}</div>
          <div class="sent-card-date">${esc(fmt.tanggal(it.date))}</div>
        </div>
        <div class="sent-card-badges">${verdictBadge(ctx, it.verdict)} ${conf} ${rerun}</div>
        <div class="sent-card-meta">
          <span>${esc(t('sentimen.detail.sentimen_tertimbang'))}: <b class="mono">${esc(muFmt(ctx, it.mu_weighted))}</b></span>
          <span>${esc(t('sentimen.list.kolom_n'))}: <b class="mono">${esc(fmt.dec(it.n_eff, 1))}</b></span>
        </div>
      </a>`;
    };
    /* PARTISI RENDER: hanya hasil nyata (category 'result') + running/queued yang MASIH SEGAR
       jadi kartu utama; gagal / tak-ada-data / running-basi (>60m) masuk disclosure sekunder
       agar daftar utama bersih dari kartu mati. `list` tetap utuh untuk tracking + reconcile. */
    const isStaleRunning = (it) => {
      if (it.status !== 'running' && it.status !== 'queued') return false;
      if (typeof it.updated_at !== 'string' || it.updated_at.length <= 10) return false;
      const age = Date.now() - Date.parse(it.updated_at);
      return !Number.isNaN(age) && age > 60 * 60000;
    };
    const isPrimary = (it) => it.category === 'result' || (it.category === 'pending' && !isStaleRunning(it));
    const results = list.filter(isPrimary);
    const attempts = list.filter((it) => !isPrimary(it));
    const resultsGrid = results.length ? `<div class="snt-grid">${results.map(renderCard).join('')}</div>` : '';
    const attemptsHtml = attempts.length
      ? `<details class="ops-disclose snt-attempts"><summary><span class="dsc-title">${esc(t('sentimen.list.attempts_judul', null, 'Percobaan gagal / tak ada data'))} <span class="badge plain snt-attempts-count">${esc(fmt.int(attempts.length))}</span></span></summary><div class="dsc-body" style="margin-top:10px"><p class="cap">${esc(t('sentimen.list.attempts_ket', null, ''))}</p><div class="snt-grid">${attempts.map(renderCard).join('')}</div></div></details>`
      : '';
    wrap.innerHTML = pendGrid + (resultsGrid || (attempts.length ? `<p class="cap">${esc(t('sentimen.list.results_kosong', null, ''))}</p>` : '')) + attemptsHtml;
  }

  /* pulihkan bar progres bila ada analisis tertunda — lintas reload/pindah-halaman */
  restoreQueuedTracking(el, ctx, list, timers);

  /* cleanup: hentikan timer polling progres saat pindah view */
  return () => timers.forEach((fn) => { try { fn(); } catch { /* abaikan */ } });
}

/* Pulihkan tracking bila user reload/pindah-halaman saat analisis masih berjalan.
   - Hasil sudah muncul di daftar → cukup bersihkan flag (tak perlu bar).
   - Masih diproses + form ops tersedia (#sf-msg) → render ulang bar dengan elapsed
     AKURAT dari timestamp tersimpan (q.at) + lanjut polling (lihat startTracking).
   Proses backend (GitHub Actions) tak terpengaruh apa pun — ini murni pemulihan UI. */
function restoreQueuedTracking(root, ctx, list, timers) {
  let q = null;
  try { q = JSON.parse(sessionStorage.getItem(QUEUED_KEY) || 'null'); } catch { /* abaikan */ }
  if (!q || !q.slug) return;
  if (list.some((it) => it.slug === q.slug)) { try { sessionStorage.removeItem(QUEUED_KEY); } catch { /* abaikan */ } return; }
  /* Sesi BASI: trigger >90 mnt lalu = run pasti sudah selesai/mati (job timeout ~60 mnt + buffer).
     JANGAN resume jadi "hantu" (timer/pesan menyesatkan) — bersihkan diam-diam, tampilkan form bersih.
     Run nyata yang masih hidup tak akan pernah setua ini; bila hasil sudah ada ia tertangkap cabang di atas. */
  if (typeof q.at === 'number' && Date.now() - q.at > 90 * 60000) {
    try { sessionStorage.removeItem(QUEUED_KEY); } catch { /* abaikan */ }
    return;
  }
  if (!root.querySelector('#sf-msg')) return; /* tanpa form ops → tak ada tempat bar */
  startTracking(root, ctx, q.slug, q.produk, timers, q.at);
}

/* ============================================================ Detail ======= */

/* kebab/snake-case → Title Case manusiawi ("rasa-manis" → "Rasa Manis"). */
function humanizeTheme(label) {
  return String(label || '').replace(/[-_]+/g, ' ').trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/* peta label platform kanonik — brand-casing benar (TikTok/YouTube) + token internal
   ("reference") dimanusiakan. Dipakai untuk JUDUL drawer drill & fallback label.
   Tak dikenal → humanizeTheme generik. Disediakan via strings (uiux-writer) dengan
   fallback inline agar tetap aman bila key belum ada. */
function platformLabel(ctx, platform) {
  const key = normTheme(platform);
  if (!key) return '';
  const map = {
    tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram',
    shopee: 'Shopee', tokopedia: 'Tokopedia', reference: 'Sumber referensi',
  };
  return ctx.t('sentimen.platform_label.' + key, null, map[key] || humanizeTheme(platform));
}

/* periode mesin "YYYY-MM" → "Bln YYYY" manusiawi ("2026-06" → "Jun 2026").
   Bukan format → dikembalikan apa adanya. */
const BULAN_SINGKAT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function humanizePeriod(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || '').trim());
  if (!m) return String(period || '');
  const mi = parseInt(m[2], 10) - 1;
  return (BULAN_SINGKAT[mi] || m[2]) + ' ' + m[1];
}

/* sanitasi defensif report_md sebelum render (BUG report_md — kebocoran data dari
   penghasil lib/sentiment-insight.mjs, dirutekan ke backend-dev). Frontend hanya
   membersihkan ARTEFAK RENDER agar tak menampilkan kotak <code></code> kosong,
   kalimat menggantung, atau token mentah (ASUMSI all-caps / params.*) ke stakeholder.
   Transform reversibel: begitu sumber diperbaiki, regex tak menemukan apa pun.
   Tidak menambah/mengarang angka — hanya merapikan prosa metode yang sudah ada. */
function sanitizeReportMd(md) {
  let out = String(md || '');
  /* 1. footer metode dengan inline-code KOSONG (placeholder template gagal resolve):
     "Statistik dihitung via `` (deterministik). Tiap angka ber-formula di `` atau
     berlabel ASUMSI di params.*" → prosa Indonesia natural tanpa token mentah. */
  out = out.replace(
    /Statistik dihitung via\s*``[^]*?params\.\*/g,
    'Statistik dihitung secara deterministik; setiap angka memiliki formula eksplisit atau ditandai sebagai asumsi (best/base/worst).*'
  );
  /* 2. sapu sisa inline-code kosong di mana pun (artefak placeholder) */
  out = out.replace(/``+/g, '');
  return out;
}

/* sanitasi defensif PROSA NARATIF (apa_artinya / headline / catatan_keyakinan) sebelum
   render: penghasil backend (lib/sentiment-insight.mjs) kadang menuliskan token statistik
   mentah "d_mu" ke prosa yang dibaca stakeholder (mis. "(d_mu +0,004)") — jargon yang
   dilarang di plane Wawasan (DESIGN §8 #11). Frontend hanya MERAPIKAN token jadi frasa
   awam; ANGKA dipertahankan apa adanya (telusur-balik), tidak menambah/mengarang.
   Transform reversibel: begitu sumber diperbaiki, regex tak menemukan apa pun.
   Kebutuhan kontrak: backend menormalkan prosa (dirutekan ke backend-dev). */
function sanitizeNarrative(text) {
  let out = String(text || '');
  /* "(d_mu +0,004)" / "d_mu = -0,01" / "d_mu +0,004" → "pergeseran arah +0,004"
     (angka & tanda dibiarkan; hanya token "d_mu [=]" yang diganti frasa awam). */
  out = out.replace(/\bd_mu\b\s*=?\s*/gi, 'pergeseran arah ');
  return out;
}

function confChip(ctx, confLow) {
  const { t, esc } = ctx;
  if (confLow) return `<span class="badge plain">◌ ${esc(t('sentimen.confidence.low'))}</span>`;
  return `<span class="badge ok">● ${esc(t('sentimen.confidence.normal'))}</span>`;
}

/* engagement → string ringkas (♥ likes / ★ stars / 👍 helpful). */
function engStr(ctx, eng) {
  const e = eng || {};
  if (typeof e.likes === 'number') return `♥ ${ctx.fmt.compact(e.likes)}`;
  if (Number.isInteger(e.stars)) return `★ ${e.stars}/5`;
  if (typeof e.helpful === 'number') return `👍 ${ctx.fmt.compact(e.helpful)}`;
  return '';
}

/* drill-down: normalisasi label tema/aspek agar cocok lintas-format
   ("Rasa Manis" ~ "rasa-manis" ~ "rasa_manis"). */
function normTheme(s) {
  return String(s || '').toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/* komentar (detail.comments) yang aspek-nya memuat tema tertentu. */
function commentsForTheme(comments, tema) {
  const key = normTheme(tema);
  if (!key) return [];
  return (Array.isArray(comments) ? comments : []).filter((c) => {
    const asp = Array.isArray(c && c.aspek) ? c.aspek : [];
    return asp.some((a) => normTheme(a) === key);
  });
}

/* polaritas → kelas pos/neg/neu. Menerima number (−1..+1) ATAU label string
   ("positif"/"negatif"/"netral", juga varian Inggris pos/neg/neu). Tak dikenal → 'neu'. */
function polClass(p) {
  if (typeof p === 'number') return p > 0 ? 'pos' : p < 0 ? 'neg' : 'neu';
  const s = String(p || '').toLowerCase();
  if (s.startsWith('pos')) return 'pos';
  if (s.startsWith('neg')) return 'neg';
  return 'neu';
}

/* polaritas → angka −1/0/+1 untuk sumbu-y scatter. number → dipakai apa adanya
   (clamp ke −1..+1); string → lewat polClass. null/tak terdefinisi → null (di-skip). */
function polNum(p) {
  if (typeof p === 'number' && Number.isFinite(p)) return Math.max(-1, Math.min(1, p));
  const k = polClass(p);
  if (p === null || p === undefined || p === '') return null;
  return k === 'pos' ? 1 : k === 'neg' ? -1 : 0;
}

/* drill-down lintas-chart (JOB 2): filter detail.comments client-side untuk
   tiap visual. Semua tahan-banting (array kosong → drawer "belum ada komentar"). */

/* komentar dengan polaritas sesuai kelas pos/neu/neg (donut & mentah-vs-tertimbang). */
function commentsForPolarity(comments, kind) {
  return (Array.isArray(comments) ? comments : []).filter((c) => polClass(c.polaritas) === kind);
}

/* komentar dari platform tertentu (bar per-platform). Cocokkan ternormalisasi —
   label bar bisa "tiktok (T4)" sementara c.platform = "tiktok". */
function commentsForPlatform(comments, platform) {
  const key = normTheme(platform);
  if (!key) return [];
  return (Array.isArray(comments) ? comments : []).filter((c) => normTheme(c.platform) === key);
}

/* komentar pada periode bulan tertentu (tren). date diawali "YYYY-MM". */
function commentsForPeriod(comments, period) {
  const p = String(period || '').trim();
  if (!p) return [];
  return (Array.isArray(comments) ? comments : []).filter((c) => String(c.date || '').startsWith(p));
}

/* satu baris komentar mentah untuk drawer drill-down: teks · dot polaritas ·
   engagement · tier · platform · tautan sumber (tab baru). */
function commentRowHtml(ctx, c) {
  const { esc, ui } = ctx;
  const pol = polClass(c.polaritas);
  const eng = engStr(ctx, c.engagement) || engStr(ctx, c);
  const src = ui.sourceLink({ sumber: c.platform, url: c.url, tanggal_akses: c.date });
  const meta = [
    ui.tierChip(c.tier),
    c.platform ? `<span class="sq-plat">${esc(c.platform)}</span>` : '',
    eng ? `<span class="sq-eng">${esc(eng)}</span>` : '',
    src,
  ].filter(Boolean).join(' · ');
  return `<article class="snt-crow ${pol}" data-pol="${pol}">
    <span class="snt-crow-dot" aria-hidden="true"></span>
    <div class="snt-crow-main">
      <p class="snt-crow-text">${esc(String(c.text || '').slice(0, 280))}</p>
      ${meta ? `<div class="snt-crow-meta">${meta}</div>` : ''}
    </div>
  </article>`;
}

const DRILL_CAP = 80;

/* body drawer drill-down: daftar komentar + (opsional) filter polaritas + catatan
   bila terpotong. Komentar sudah di-sort engagement-desc oleh pemanggil. */
function drillBodyHtml(ctx, comments, opts = {}) {
  const { t, esc } = ctx;
  const list = Array.isArray(comments) ? comments : [];
  if (!list.length) return `<div class="snt-drill"><p class="cap">${esc(t('sentimen.insight.drill_kosong', null, 'Belum ada komentar yang bisa ditampilkan untuk ini.'))}</p></div>`;
  const total = list.length;
  const shown = list.slice(0, DRILL_CAP);
  const truncNote = total > DRILL_CAP
    ? `<p class="cap snt-drill-trunc">${esc(t('sentimen.insight.drill_terpotong', { tampil: ctx.fmt.int(shown.length), total: ctx.fmt.int(total) }, 'Menampilkan {tampil} dari {total} komentar.'))}</p>`
    : '';
  /* filter polaritas (nice-to-have): hanya bila ada >1 kelas polaritas */
  const kinds = new Set(shown.map((c) => polClass(c.polaritas)));
  const neuPill = kinds.has('neu')
    ? `<button type="button" class="snt-fpill" data-f="neu">${esc(t('sentimen.insight.drill_filter_neu', null, 'Netral'))}</button>`
    : '';
  const filterBar = (opts.filter && kinds.size > 1)
    ? `<div class="snt-drill-filter" role="group" aria-label="${esc(t('sentimen.insight.drill_filter_semua', null, 'Semua'))}">
        <button type="button" class="snt-fpill is-on" data-f="all">${esc(t('sentimen.insight.drill_filter_semua', null, 'Semua'))}</button>
        <button type="button" class="snt-fpill" data-f="pos">${esc(t('sentimen.insight.drill_filter_pos', null, 'Positif'))}</button>
        ${neuPill}
        <button type="button" class="snt-fpill" data-f="neg">${esc(t('sentimen.insight.drill_filter_neg', null, 'Negatif'))}</button>
      </div>`
    : '';
  return `<div class="snt-drill">
    ${filterBar}
    ${truncNote}
    <div class="snt-crow-list">${shown.map((c) => commentRowHtml(ctx, c)).join('')}</div>
  </div>`;
}

/* buka drawer berisi komentar mentah (drill-down verifikasi). Helper kanonik
   bersama (JOB 2): SETIAP visual yang bisa di-drill memanggil ini. title = teks
   polos (di-esc di sini); comments di-sort engagement-desc; opts.filter → bar
   filter polaritas. */
function openCommentDrawer(ctx, title, comments, opts = {}) {
  const { esc, drawer } = ctx;
  const sorted = (Array.isArray(comments) ? comments.slice() : [])
    .sort((a, b) => (engNum(b) - engNum(a)));
  const body = drillBodyHtml(ctx, sorted, opts);
  drawer.open({ title: esc(title), body });
  /* bind filter polaritas pasca-render (drawer body = innerHTML mentah) */
  if (opts.filter) bindDrillFilter();
}

/* alias urutan-argumen lama (comments, title) — pemanggil tema lama tak berubah. */
function openDrillDrawer(ctx, comments, title, opts = {}) {
  return openCommentDrawer(ctx, title, comments, opts);
}

/* drill-down chart: rakit judul "{label} (N)" + buka drawer; skip diam bila kosong.
   Dipakai semua handler chart.on('click'). filterPol default true (komentar
   campur polaritas). */
function drillChartComments(ctx, rows, title, opts = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return;
  const full = `${title} (${ctx.fmt.int(list.length)})`;
  openCommentDrawer(ctx, full, list, { filter: opts.filter !== false });
}

/* engagement → angka untuk sort (likes > stars > helpful). */
function engNum(c) {
  const e = (c && c.engagement) || c || {};
  if (typeof e.likes === 'number') return e.likes;
  if (Number.isInteger(e.stars)) return e.stars;
  if (typeof e.helpful === 'number') return e.helpful;
  return 0;
}

/* filter polaritas di dalam drawer drill-down (toggle visibilitas baris). */
function bindDrillFilter() {
  const root = document.querySelector('.drawer .snt-drill');
  if (!root) return;
  const pills = root.querySelectorAll('.snt-fpill');
  const rows = root.querySelectorAll('.snt-crow');
  pills.forEach((p) => p.addEventListener('click', () => {
    const f = p.getAttribute('data-f');
    pills.forEach((x) => x.classList.toggle('is-on', x === p));
    rows.forEach((r) => { r.style.display = (f === 'all' || r.getAttribute('data-pol') === f) ? '' : 'none'; });
  }));
}

/* kutipan ringkas untuk kartu insight (tema / suara menonjol). */
function insightQuote(ctx, q) {
  const { esc, ui } = ctx;
  if (!q || !q.text) return '';
  const eng = engStr(ctx, q.engagement);
  const src = ui.sourceLink({ sumber: q.platform, url: q.url, tanggal_akses: q.date });
  const meta = [
    ui.tierChip(q.tier),
    q.platform ? `<span class="sq-plat">${esc(q.platform)}</span>` : '',
    eng ? `<span class="sq-eng">${esc(eng)}</span>` : '',
    src,
  ].filter(Boolean).join(' · ');
  return `<blockquote class="snt-iq">${esc(String(q.text).slice(0, 200))}</blockquote>
    ${meta ? `<div class="snt-iq-meta">${meta}</div>` : ''}`;
}

/* kolom tema (pendorong positif / kekhawatiran). kind: 'pos' | 'neg'.
   drillCount = peta normTheme(tema) → jumlah komentar; bila >0, kartu jadi
   pemicu drawer drill-down (data-drill-tema). */
function themeColumnHtml(ctx, items, kind, drillCount) {
  const { t, esc } = ctx;
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return `<p class="cap">${esc(t('sentimen.insight.tema_kosong'))}</p>`;
  return list.map((it) => {
    const tema = humanizeTheme(it.tema);
    const share = it.share == null ? '' : t('sentimen.insight.tema_share', { persen: ctx.fmt.persen(it.share * 100) });
    const n = drillCount ? (drillCount.get(normTheme(it.tema)) || 0) : 0;
    const drill = n > 0
      ? `<button type="button" class="snt-theme-drill textlink" data-drill-tema="${esc(it.tema)}">${esc(t('sentimen.insight.drill_lihat_tema', null, 'Lihat komentar aslinya'))} (${esc(ctx.fmt.int(n))}) →</button>`
      : '';
    return `<article class="snt-theme ${kind}">
      <div class="snt-theme-head">
        <span class="snt-theme-name">${esc(tema)}</span>
        ${share ? `<span class="snt-theme-share">${esc(share)}</span>` : ''}
      </div>
      ${insightQuote(ctx, it.kutipan)}
      ${drill}
    </article>`;
  }).join('');
}

/* peta normTheme → jumlah komentar yang menyebut tema itu (untuk badge drill-down). */
function buildDrillCount(comments) {
  const m = new Map();
  (Array.isArray(comments) ? comments : []).forEach((c) => {
    const asp = Array.isArray(c && c.aspek) ? c.aspek : [];
    const seen = new Set();
    asp.forEach((a) => { const k = normTheme(a); if (k && !seen.has(k)) { seen.add(k); m.set(k, (m.get(k) || 0) + 1); } });
  });
  return m;
}

/* DEPRECATED (DELIVERABLE #7b) — kolom aspek pendorong/kekhawatiran. TAK LAGI DIRENDER:
   severity (pain-points hierarchy) + depthKlasterHtml (questions/concerns/praises) sudah
   meliput sinyal ini → menampilkannya juga = insight dobel. Fn dipertahankan agar tak
   memutus pemanggil/uji, tetapi renderDetail tidak lagi memanggilnya. */
function themeColumnsHtml(ctx, ins, drillCount) {
  const { t, esc } = ctx;
  const pos = (ins.pendorong_positif || []).filter(Boolean);
  const neg = (ins.kekhawatiran || []).filter(Boolean);
  if (!pos.length && !neg.length) return '';
  const col = (judul, ket, items, kind) => (items.length ? `
    <section class="snt-theme-col">
      <div class="snt-col-head">
        <h2 class="display-m snt-col-title ${kind}">${esc(judul)}</h2>
        <p class="cap">${esc(ket)}</p>
      </div>
      <div class="snt-theme-stack">${themeColumnHtml(ctx, items, kind, drillCount)}</div>
    </section>` : '');
  /* MAJOR #1: bila hanya satu sisi (pendorong / kekhawatiran) yang berisi, jadikan
     grid satu kolom agar konten tak menempati ~50% lebar kartu (dead zone kanan). */
  const single = !pos.length || !neg.length;
  return `<section class="snt-section snt-themes-section">
    <div class="snt-theme-grid${single ? ' is-single' : ''}">
      ${col(t('sentimen.insight.pendorong_judul'), t('sentimen.insight.pendorong_ket'), pos, 'pos')}
      ${col(t('sentimen.insight.kekhawatiran_judul'), t('sentimen.insight.kekhawatiran_ket'), neg, 'neg')}
    </div>
  </section>`;
}

/* engagement → angka likes mentah (untuk klaim FAKTUAL "♥ {n} suka"). */
function likesOf(v) {
  const e = (v && v.engagement) || v || {};
  return typeof e.likes === 'number' ? e.likes : null;
}

/* suara menonjol — JUJUR (anti-halu). Bila engagement sampel rendah ATAU tak ada
   suara → catatan jujur, BUKAN kartu dengan klaim "banyak disukai". Saat suara
   benar-benar menonjol: per-kartu menampilkan angka suka NYATA + framing faktual. */
function prominentVoicesHtml(ctx, voices, engagementLow) {
  const { t, esc, ui } = ctx;
  const list = (Array.isArray(voices) ? voices : []).filter((v) => v && v.text);

  const head = `<div class="snt-block-head">
      <h2 class="display-m">${esc(t('sentimen.insight.suara_judul'))}</h2>
      <p class="cap">${esc(t('sentimen.insight.suara_ket'))}</p>
    </div>`;

  /* engagement rendah / kosong → catatan jujur (tanpa kartu klaim) */
  if (engagementLow || !list.length) {
    return `<section class="section snt-section">
      ${head}
      <div class="callout note snt-voice-low"><p>${esc(t('sentimen.insight.suara_low', null, 'Komentar di sampel ini belum banyak disukai — belum ada satu suara pun yang benar-benar menonjol.'))}</p></div>
    </section>`;
  }

  const cards = list.map((v) => {
    /* T8 — angka engagement FAKTUAL & MENONJOL: bila likes nyata ada → angka besar +
       label "suka" (dasar pembobotan, harus terbaca jelas); selain itu fallback ke
       string engagement umum (★ bintang / 👍 helpful) — tak pernah mengklaim "suka". */
    const likes = likesOf(v);
    const engBlock = likes !== null
      ? `<div class="snt-voice-eng" aria-label="${esc(t('sentimen.insight.suara_eng', { n: ctx.fmt.int(likes) }, '{n} suka'))}">
          <span class="snt-eng-ico" aria-hidden="true">♥</span><span class="snt-eng-n">${esc(ctx.fmt.int(likes))}</span><span class="snt-eng-unit">${esc(t('sentimen.insight.suara_eng_label', null, 'suka'))}</span>
        </div>`
      : (() => { const s = engStr(ctx, v.engagement) || engStr(ctx, v); return s ? `<div class="snt-voice-eng snt-voice-eng-alt">${esc(s)}</div>` : ''; })();
    const pol = polClass(v.polaritas);
    const src = ui.sourceLink({ sumber: v.platform, url: v.url, tanggal_akses: v.date });
    const meta = [
      ui.tierChip(v.tier),
      v.platform ? `<span class="sq-plat">${esc(v.platform)}</span>` : '',
      src,
    ].filter(Boolean).join(' · ');
    return `<article class="snt-voice ${pol}">
      ${engBlock}
      <blockquote class="snt-voice-text">${esc(String(v.text).slice(0, 240))}</blockquote>
      ${meta ? `<div class="snt-voice-meta">${meta}</div>` : ''}
      <p class="snt-voice-why">${esc(t('sentimen.insight.suara_why'))}</p>
    </article>`;
  }).join('');
  return `<section class="section snt-section">
    ${head}
    <div class="snt-voice-grid">${cards}</div>
  </section>`;
}

/* rekomendasi — checklist. */
function recommendationsHtml(ctx, recs) {
  const { t, esc } = ctx;
  const list = (Array.isArray(recs) ? recs : []).filter((x) => x && String(x).trim());
  if (!list.length) return '';
  /* Judul polos "Rekomendasi" (DELIVERABLE #7a — bukan "Implikasi…"). Keterangan menyebut
     SUMBER (pola komentar publik) & UNTUK SIAPA (keputusan impor/produk). Ini RUMAH TUNGGAL
     rekomendasi — tak mengulang metrik (di jalur manifest digerbangi seksi 'recommendations'). */
  return `<article class="card snt-recs">
    <div class="snt-block-head">
      <h2 class="display-m">${esc(t('sentimen.insight.rekomendasi_judul'))}</h2>
      <p class="cap">${esc(t('sentimen.insight.rekomendasi_ket', null, 'Disusun dari pola komentar publik di atas — untuk keputusan impor/produk, bukan instruksi pemasaran.'))}</p>
    </div>
    <ul class="snt-rec-list">${list.map((r) => `<li><span class="snt-rec-mark" aria-hidden="true">✓</span><span>${esc(String(r))}</span></li>`).join('')}</ul>
  </article>`;
}

/* strip cakupan/representativeness JUJUR di bawah hero: berapa komentar, dari berapa
   sumber, di platform apa, berapa suara berpengaruh + batas (belum termasuk marketplace;
   engagement rendah). Semua nullable → skip diam-diam bila tak cukup data. */
function coverageStripHtml(ctx, coverage, engagementLow) {
  const { t, esc, fmt } = ctx;
  const c = coverage && typeof coverage === 'object' ? coverage : null;
  if (!c) return '';
  const nK = typeof c.n_komentar === 'number' ? c.n_komentar : null;
  const nS = typeof c.n_sumber === 'number' ? c.n_sumber : null;
  const nE = typeof c.n_efektif === 'number' ? c.n_efektif : null;
  const plats = Array.isArray(c.platform) ? c.platform.filter(Boolean) : [];
  /* butuh minimal jumlah komentar untuk berarti — selain itu jangan tampilkan klaim */
  if (nK == null) return '';
  const platTxt = plats.length ? plats.join(', ') : t('umum.kosong');
  const main = t('sentimen.insight.cakupan_strip', {
    n_komentar: fmt.int(nK),
    n_sumber: nS == null ? '—' : fmt.int(nS),
    platform: platTxt,
    n_efektif: nE == null ? '—' : fmt.int(nE),
  }, '{n_komentar} komentar dari {n_sumber} sumber di {platform} · {n_efektif} di antaranya cukup berpengaruh');
  /* caveat "belum termasuk ulasan marketplace" HANYA bila marketplace memang TAK ada di
     cakupan — kini ulasan Tokopedia/Shopee bisa ikut terhitung, jadi klaim ini tak boleh
     statis (menyesatkan bila marketplace sudah masuk). */
  const hasMarketplace = plats.some((p) => /tokopedia|shopee/i.test(String(p)));
  const limits = [
    hasMarketplace ? '' : t('sentimen.insight.cakupan_belum_marketplace', null, 'belum termasuk ulasan marketplace'),
    engagementLow ? t('sentimen.insight.cakupan_engagement_rendah', null, 'suka antar-komentar masih rendah') : '',
  ].filter(Boolean);
  const limTxt = limits.length ? ` · ${limits.join(' · ')}` : '';
  return `<p class="snt-coverage" role="note">
    <span class="snt-cov-ico" aria-hidden="true">◍</span>
    <span>${esc(main)}<span class="snt-cov-lim">${esc(limTxt)}</span></span>
  </p>`;
}

/* lampiran sumber: daftar video/etalase asal komentar (detail.sources) sebagai
   tautan tab-baru + jumlah komentar per sumber. Disclosure di area bukti. */
function sourcesAppendixHtml(ctx, sources) {
  const { t, esc, ui } = ctx;
  const list = (Array.isArray(sources) ? sources : []).filter((s) => s && (s.url || s.judul || s.platform));
  if (!list.length) return '';
  const rows = list.map((s) => {
    const label = String(s.judul || s.platform || '').trim() || hostOf(s.url) || t('umum.kosong');
    const link = ui.sourceLink({ sumber: label, url: s.url });
    const host = s.url ? hostOf(s.url) : '';
    const plat = s.platform && String(s.platform).toLowerCase() !== String(label).toLowerCase() ? esc(s.platform) : '';
    const sub = [plat, host && plat ? '' : esc(host)].filter(Boolean).join(' · ');
    const n = typeof s.n === 'number'
      ? `<span class="snt-src-n">${esc(t('sentimen.insight.sumber_komentar', { n: ctx.fmt.int(s.n) }, '{n} komentar'))}</span>`
      : '';
    return `<li class="snt-src-row">
      <span class="snt-src-main">${link || `<span class="src-plain">${esc(label)}</span>`}${sub ? `<span class="snt-src-sub">${sub}</span>` : ''}</span>
      ${n}
    </li>`;
  }).join('');
  return `<details class="ops-disclose snt-sources">
    <summary><span class="dsc-title">${esc(t('sentimen.insight.sumber_judul', { n: ctx.fmt.int(list.length) }, 'Sumber data — {n} video/etalase'))}</span></summary>
    <div class="dsc-body" style="margin-top:10px">
      <p class="cap" style="margin:0 0 10px">${esc(t('sentimen.insight.sumber_ket', null, 'Komentar di atas diambil dari tautan publik berikut.'))}</p>
      <ul class="snt-src-list">${rows}</ul>
    </div>
  </details>`;
}

/* host ringkas dari URL (tanpa www.) — untuk sub-label sumber. */
function hostOf(url) {
  try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/* strip angka kunci ringkas (sentimen, μ tertimbang+CI, suara efektif). */
function keyFiguresHtml(ctx, ov) {
  const { t, esc, fmt } = ctx;
  const w = ov.weighted || {};
  const ci = ov.ci || {};
  /* hint (opsional): glosarium awam yang bisa diakses keyboard (focus) + sentuh —
       glyph ⓘ ber-tabindex + title + aria-label (§7.8). Tak ada → label saja. */
  const hintMark = (hint) => hint
    ? ` <span class="snt-fig-info" tabindex="0" role="note" title="${esc(hint)}" aria-label="${esc(hint)}">ⓘ</span>`
    : '';
  const fig = (label, valueHtml, ket, hint) => `<div class="snt-fig">
    <div class="snt-fig-label">${esc(label)}${hintMark(hint)}</div>
    <div class="snt-fig-value mono">${valueHtml}</div>
    ${ket ? `<div class="snt-fig-ket">${esc(ket)}</div>` : ''}
  </div>`;
  const posVal = w.pos == null ? esc(t('umum.kosong')) : esc(fmt.persen(w.pos * 100));
  const muVal = w.mu == null ? esc(t('umum.kosong')) : esc(fmt.dec(w.mu, 2));
  const neffVal = ov.n_eff == null ? esc(t('umum.kosong')) : esc(fmt.dec(ov.n_eff, 1));
  return `<div class="snt-figs" role="group" aria-label="${esc(t('sentimen.insight.angka_judul'))}">
    ${fig(t('sentimen.insight.kf_pos'), posVal, '')}
    ${fig(t('sentimen.insight.kf_mu'), muVal, t('sentimen.insight.kf_mu_ket', { lo: muFmt(ctx, ci.lo), hi: muFmt(ctx, ci.hi) }), t('sentimen.insight.ci_plain', null, ''))}
    ${fig(t('sentimen.insight.kf_neff'), neffVal, t('sentimen.insight.kf_neff_ket', { n: fmt.int(ov.n) }), t('sentimen.insight.neff_plain', { n: fmt.int(ov.n) }, ''))}
  </div>`;
}

/* Agregat marketplace (T3) — kartu TERPISAH dari donut sentimen (T4). Fakta rating toko/
   etalase: TikTok Shop (etalase Tokopedia, agregat per-listing) + Tokopedia (overall +
   breakdown bintang). Nullable → '' (skip diam). Reuse .snt-figs/.snt-fig agar konsisten. */
function marketplaceAggregatesHtml(ctx, agg) {
  const { t, esc, fmt } = ctx;
  if (!agg || typeof agg !== 'object') return '';
  const fig = (label, value, ket) => `<div class="snt-fig">
    <div class="snt-fig-label">${esc(label)}</div>
    <div class="snt-fig-value mono">${esc(value)}</div>
    ${ket ? `<div class="snt-fig-ket">${esc(ket)}</div>` : ''}
  </div>`;
  const blocks = [];
  const tts = Array.isArray(agg.tiktokshop) ? agg.tiktokshop.filter((a) => a && Number.isFinite(a.overall_score)) : [];
  for (const a of tts) {
    const figs = [fig(t('sentimen.mkt.skor', null, 'Skor'), `${fmt.dec(a.overall_score, 1)} / 5`, '')];
    if (Number.isFinite(a.review_count)) figs.push(fig(t('sentimen.mkt.ulasan_teks', null, 'Ulasan berteks'), fmt.int(a.review_count), ''));
    if (Number.isFinite(a.sold_count)) figs.push(fig(t('sentimen.mkt.terjual', null, 'Terjual'), fmt.int(a.sold_count), ''));
    const name = a.listing_name
      ? (a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener nofollow">${esc(a.listing_name)}</a>` : esc(a.listing_name))
      : '';
    blocks.push(`<div class="snt-mkt-block">
      <div class="snt-mkt-plat">${esc(t('sentimen.mkt.tiktokshop', null, 'TikTok Shop'))}${name ? ` · <span class="snt-mkt-name">${name}</span>` : ''}</div>
      <div class="snt-figs">${figs.join('')}</div>
    </div>`);
  }
  const tk = agg.tokopedia;
  if (tk && (Number.isFinite(tk.overall) || tk.star_breakdown)) {
    const figs = [];
    if (Number.isFinite(tk.overall)) figs.push(fig(t('sentimen.mkt.skor', null, 'Skor'), `${fmt.dec(tk.overall, 1)} / 5`, ''));
    if (Number.isFinite(tk.rating_count)) figs.push(fig(t('sentimen.mkt.rating', null, 'Rating'), fmt.int(tk.rating_count), ''));
    if (Number.isFinite(tk.review_count)) figs.push(fig(t('sentimen.mkt.ulasan', null, 'Ulasan'), fmt.int(tk.review_count), ''));
    let breakdown = '';
    if (tk.star_breakdown && typeof tk.star_breakdown === 'object') {
      const parts = [];
      for (let star = 5; star >= 1; star--) {
        const b = tk.star_breakdown[String(star)] || tk.star_breakdown[star];
        if (b && Number.isFinite(b.pct)) parts.push(`${star}★ ${esc(fmt.persen(b.pct))}`);
      }
      if (parts.length) breakdown = `<div class="snt-mkt-stars cap">${parts.join(' · ')}</div>`;
    }
    blocks.push(`<div class="snt-mkt-block">
      <div class="snt-mkt-plat">${esc(t('sentimen.mkt.tokopedia', null, 'Tokopedia'))}</div>
      <div class="snt-figs">${figs.join('')}</div>
      ${breakdown}
    </div>`);
  }
  if (!blocks.length) return '';
  return `<article class="card snt-mkt-card">
    <div class="snt-block-head">
      <h2 class="display-m">${esc(t('sentimen.mkt.judul', null, 'Rating marketplace'))}</h2>
      <p class="cap">${esc(t('sentimen.mkt.ket', null, 'Agregat rating toko/etalase (sumber T3) — fakta marketplace, TERPISAH dari analisis sentimen komentar di atas dan TIDAK dicampur ke skor sentimen.'))}</p>
    </div>
    ${blocks.join('')}
  </article>`;
}

/* desimal bertanda untuk pergeseran d_mu ("+0,004" / "−0,012") — fmt.dec tak menambah
   "+" untuk positif; minus via mnum (U+2212). */
function signedDec(ctx, x, d = 3) {
  if (x === null || x === undefined || !Number.isFinite(x)) return ctx.t('umum.kosong');
  return (x > 0 ? '+' : '') + ctx.fmt.dec(x, d);
}

/* T7 — "Seberapa kokoh kesimpulan ini?": terjemahkan weighting_effect.d_mu (jargon)
   ke bahasa awam, dengan ANGKA ASLI ter-interpolasi (telusur-balik) — bukan "d_mu
   +0,004" mentah. Geser kecil (|d_mu|<0,03) → verdict kokoh; geser berarti → baca
   dengan hati-hati. Skip diam bila data tak ada. */
function weightingNoteHtml(ctx, ov) {
  const { t, esc } = ctx;
  const we = ov && ov.weighting_effect;
  if (!we || typeof we.d_mu !== 'number' || !Number.isFinite(we.d_mu)) return '';
  const dmu = we.d_mu;
  const kecil = Math.abs(dmu) < 0.03;
  const body = kecil
    ? t('sentimen.insight.weighting_plain', { d_mu: signedDec(ctx, dmu) }, 'Setelah komentar yang banyak disukai diberi bobot lebih besar, arah sentimen nyaris tak berubah (geser {d_mu}).')
    : t('sentimen.insight.weighting_plain_besar', { d_mu: signedDec(ctx, dmu) }, 'Setelah pembobotan, arah sentimen bergeser {d_mu} — suara nyaring ikut menimbang.');
  const tone = kecil ? 'ok' : 'note';
  const sym = kecil ? '●' : '◆';
  return `<div class="callout ${tone} snt-weighting">
    <div class="co-title">${sym} ${esc(t('sentimen.insight.weighting_judul', null, 'Seberapa kokoh kesimpulan ini?'))}</div>
    <p>${esc(body)}</p>
  </div>`;
}

/* ============================================================ Bagian v2 (kontrak §5) ===
   Render-only untuk field deterministik baru (kontrak-sentiment.md §5). SEMUA nullable →
   tiap fn null-guard sendiri & kembalikan '' bila datanya tak ada (backward-compat: JSON
   lama tanpa field ini → blok kosong, tata-letak legacy tak berubah). Penamaan snt-*. */

/* peta kategori enum (projectCategory) → label awam i18n. fallback inline aman bila
   key strings belum ada (uiux-writer). */
const CAT_LABEL = {
  positif: 'Positif', negatif: 'Negatif', pertanyaan: 'Pertanyaan',
  request: 'Permintaan/Demand', humor_sarkas: 'Humor/Sarkas', netral: 'Netral',
};
function catLabel(ctx, cat) {
  const key = String(cat || '').toLowerCase();
  if (!key) return '';
  return ctx.t('sentimen.insight.cat.' + key, null, CAT_LABEL[key] || humanizeTheme(key));
}

/* DELIVERABLE #1 — THE SIGNATURE REVEAL: per kategori HADIR, porsi MENTAH (jumlah
   komentar) vs porsi TERTIMBANG-LIKE, menyoroti kategori signature (delta like terbesar,
   mis. "Humor/Sarkas = 8% komentar tapi 31% like"). low_reliability → counts-only + chip
   peringatan (tanpa headline like tebal). Juga RUMAH TUNGGAL pernyataan "pembobotan nyaris
   tak menggeser" via d_mu_ci (rekonsiliasi: weightingNote tak ditampilkan saat blok ini ada).
   Null-guard: category_distribution absen → ''. */
function categoryDistributionHtml(ctx, ov) {
  const { t, esc, fmt } = ctx;
  const cd = ov && ov.category_distribution;
  if (!cd || !Array.isArray(cd.categories)) return '';
  const cats = cd.categories.filter((c) => c && c.cat && typeof c.share_raw === 'number');
  if (!cats.length) return '';
  const lowRel = cd.low_reliability === true;
  const sig = (!lowRel && cd.signature && cd.signature.cat) ? cd.signature : null;
  const sigCat = sig ? String(sig.cat).toLowerCase() : null;

  const pct = (x) => (typeof x === 'number' && Number.isFinite(x)) ? fmt.persen(x * 100) : '—';
  const pctW = (x) => (typeof x === 'number' && Number.isFinite(x)) ? x * 100 : 0;

  /* baris per kategori: nama · n · dua mini-bar (mentah vs like-tertimbang). Saat
     low_reliability → sembunyikan kolom like (counts-only). */
  const rows = cats.map((c) => {
    const isSig = sigCat && String(c.cat).toLowerCase() === sigCat;
    const nTxt = typeof c.n === 'number' ? fmt.int(c.n) : '—';
    const rawBar = `<span class="snt-cd-track"><i class="snt-cd-fill raw" style="width:${pctW(c.share_raw).toFixed(1)}%"></i></span>`;
    const likeBar = lowRel ? '' : `<span class="snt-cd-track"><i class="snt-cd-fill like${isSig ? ' is-sig' : ''}" style="width:${pctW(c.likes_share).toFixed(1)}%"></i></span>`;
    const likeCell = lowRel ? '' : `<div class="snt-cd-cell snt-cd-like">
        <span class="snt-cd-num mono">${esc(pct(c.likes_share))}</span>${likeBar}
      </div>`;
    return `<div class="snt-cd-row${isSig ? ' is-sig' : ''}">
      <div class="snt-cd-name">${esc(catLabel(ctx, c.cat))}${isSig ? `<span class="snt-cd-sigmark">${esc(t('sentimen.insight.cat_signature_tag', null, 'sorotan'))}</span>` : ''}<span class="snt-cd-n mono">${esc(nTxt)}</span></div>
      <div class="snt-cd-cell snt-cd-raw">
        <span class="snt-cd-num mono">${esc(pct(c.share_raw))}</span>${rawBar}
      </div>
      ${likeCell}
    </div>`;
  }).join('');

  /* headline signature: "X = a% komentar tapi b% like" — HANYA bila reliabel & ada signature. */
  const sigHead = sig
    ? `<p class="snt-cd-headline">${esc(t('sentimen.insight.cat_signature_head', {
        cat: catLabel(ctx, sig.cat), raw: pct(sig.share_raw), like: pct(sig.likes_share),
      }, '{cat} = {raw} dari jumlah komentar, tapi {like} dari semua like — suara nyaring ini menyedot perhatian jauh di atas porsinya.'))}</p>`
    : '';

  /* chip peringatan saat low_reliability (counts-only). */
  const caveat = lowRel
    ? `<div class="snt-cd-caveat"><span class="badge note">◆ ${esc(t('sentimen.insight.cat_lowrel', null, 'Keandalan klasifikasi rendah — ditampilkan apa adanya (jumlah komentar), tanpa klaim bobot like.'))}</span></div>`
    : '';

  /* RUMAH TUNGGAL "pembobotan nyaris tak menggeser" (rekonsiliasi dgn weightingNote).
     Pakai d_mu_ci bila ada: CI memuat 0 → tak signifikan (kokoh); CI kecualikan 0 → bergeser. */
  let robust = '';
  const we = ov.weighting_effect;
  if (we && we.d_mu_ci && typeof we.d_mu_ci.lo === 'number' && typeof we.d_mu_ci.hi === 'number') {
    const lo = we.d_mu_ci.lo, hi = we.d_mu_ci.hi;
    const memuatNol = lo <= 0 && hi >= 0;
    const dmuTxt = (typeof we.d_mu === 'number') ? signedDec(ctx, we.d_mu) : '—';
    const ciTxt = `${signedDec(ctx, lo)} … ${signedDec(ctx, hi)}`;
    const body = memuatNol
      ? t('sentimen.insight.cat_robust_stabil', { d_mu: dmuTxt, ci: ciTxt }, 'Saat komentar ber-like-tinggi diberi bobot lebih, arah sentimen tak bergeser secara meyakinkan (pergeseran {d_mu}, rentang {ci} masih melewati nol) — kesimpulan tak ditarik segelintir komentar viral.')
      : t('sentimen.insight.cat_robust_geser', { d_mu: dmuTxt, ci: ciTxt }, 'Pembobotan engagement menggeser arah sentimen ({d_mu}, rentang {ci} di luar nol) — suara nyaring ikut menimbang; baca dengan itu di kepala.');
    robust = `<p class="snt-cd-robust ${memuatNol ? 'ok' : 'note'}"><span aria-hidden="true">${memuatNol ? '●' : '◆'}</span> ${esc(body)}</p>`;
  }

  return `<section class="snt-section snt-cd">
    <div class="snt-block-head">
      <h2 class="display-m">${esc(t('sentimen.insight.cat_judul', null, 'Apa yang ramai vs apa yang disukai'))}</h2>
      <p class="cap">${esc(t('sentimen.insight.cat_ket', null, 'Porsi tiap jenis komentar dari jumlahnya (mentah) dibanding dari total like (tertimbang) — di mana perhatian publik benar-benar mengalir.'))}</p>
    </div>
    ${sigHead}
    ${caveat}
    <div class="snt-cd-table" role="table" aria-label="${esc(t('sentimen.insight.cat_judul', null, 'Apa yang ramai vs apa yang disukai'))}">
      <div class="snt-cd-headrow" role="row">
        <span class="snt-cd-h-name">${esc(t('sentimen.insight.cat_col_kategori', null, 'Kategori'))}</span>
        <span class="snt-cd-h-raw">${esc(t('sentimen.insight.cat_col_raw', null, '% komentar'))}</span>
        ${lowRel ? '' : `<span class="snt-cd-h-like">${esc(t('sentimen.insight.cat_col_like', null, '% like'))}</span>`}
      </div>
      ${rows}
    </div>
    ${robust}
  </section>`;
}

/* DELIVERABLE #3 — Reliabilitas ⭐ (reliability_score): score/5 + label, komponen di
   balik disclosure. Tampil di area metodologi/hero (dekat keyFigures). Null-guard:
   reliability_score absen → ''. */
function reliabilityScoreHtml(ctx, s) {
  const { t, esc, fmt } = ctx;
  const rs = s && s.reliability_score;
  if (!rs || typeof rs.score !== 'number' || !Number.isFinite(rs.score)) return '';
  const score = Math.max(1, Math.min(5, Math.round(rs.score)));
  const stars = '★★★★★'.slice(0, score) + '☆☆☆☆☆'.slice(0, 5 - score);
  const label = rs.label ? t('sentimen.insight.rel_label.' + String(rs.label).toLowerCase().replace(/\s+/g, '_'), null, rs.label) : '';
  /* komponen 0..1 → baris persen di disclosure (label awam per komponen). */
  const comp = rs.components && typeof rs.components === 'object' ? rs.components : null;
  const COMP_KEY = {
    c_neff: 'rel_comp_neff', c_conc: 'rel_comp_conc', c_balance: 'rel_comp_balance',
    c_stable: 'rel_comp_stable', c_cover: 'rel_comp_cover',
  };
  const COMP_FB = {
    c_neff: 'Volume suara berpengaruh', c_conc: 'Tidak didominasi sedikit akun',
    c_balance: 'Keseimbangan positif/negatif', c_stable: 'Sentimen sudah mengendap',
    c_cover: 'Cakupan platform',
  };
  let compHtml = '';
  if (comp) {
    const rows = Object.keys(comp)
      .filter((k) => typeof comp[k] === 'number' && Number.isFinite(comp[k]))
      .map((k) => {
        const v = Math.max(0, Math.min(1, comp[k]));
        const lbl = t('sentimen.insight.' + (COMP_KEY[k] || ''), null, COMP_FB[k] || humanizeTheme(k));
        return `<li class="snt-rel-comprow">
          <span class="snt-rel-complabel">${esc(lbl)}</span>
          <span class="snt-rel-cbar"><i style="width:${(v * 100).toFixed(0)}%"></i></span>
          <span class="snt-rel-cval mono">${esc(fmt.persen(v * 100))}</span>
        </li>`;
      }).join('');
    if (rows) {
      compHtml = `<details class="ops-disclose snt-rel-disclose">
        <summary><span class="dsc-title">${esc(t('sentimen.insight.rel_komponen', null, 'Rincian komponen skor'))}</span></summary>
        <ul class="snt-rel-complist" style="margin-top:10px">${rows}</ul>
      </details>`;
    }
  }
  return `<div class="snt-rel">
    <div class="snt-rel-head">
      <span class="snt-rel-stars" aria-hidden="true">${stars}</span>
      <span class="snt-rel-score mono">${esc(fmt.int(score))}<span class="snt-rel-denom">/5</span></span>
      <span class="snt-rel-meta">
        <span class="snt-rel-title">${esc(t('sentimen.insight.rel_judul', null, 'Keandalan analisis'))}</span>
        ${label ? `<span class="snt-rel-label">${esc(label)}</span>` : ''}
      </span>
    </div>
    ${compHtml}
  </div>`;
}

/* DELIVERABLE #5 — Stability note: acquisition_stability.verdict (stabil/cukup/belum)
   sebagai catatan jujur. reason='insufficient-batch-support' → '' (omit diam). Null-guard:
   acquisition_stability/verdict absen → ''. */
function stabilityNoteHtml(ctx, s) {
  const { t, esc } = ctx;
  const as = s && s.acquisition_stability;
  if (!as || !as.verdict) return '';
  if (as.reason === 'insufficient-batch-support') return '';
  const v = String(as.verdict);
  const MAP = {
    stabil: { tone: 'ok', sym: '●', fb: 'Arah sentimen sudah mengendap — menambah komentar baru tak lagi banyak menggeser kesimpulan.' },
    'cukup-stabil': { tone: 'note', sym: '◆', fb: 'Arah sentimen cukup mengendap, tapi belum sepenuhnya — sedikit data baru masih bisa menggeser angka.' },
    'belum-stabil': { tone: 'warn', sym: '▲', fb: 'Sentimen kumulatif masih bergeser di batch terakhir — tambah data sebelum mengandalkan arahnya.' },
  };
  const m = MAP[v];
  if (!m) return '';
  const body = t('sentimen.insight.stab_' + v.replace(/-/g, '_'), null, m.fb);
  return `<div class="callout ${m.tone} snt-stab">
    <p>${m.sym} ${esc(body)}</p>
  </div>`;
}

/* DELIVERABLE #2 — Pain-points hierarchy + impact matrix: depth.severity.items ber-
   peringkat, tiap item chip severity_label berwarna (Critical/High/Med/Low) + n +
   total_eng + kutipan. MENGGANTI rendering keluhan ad-hoc. reason='insufficient-concern-
   support' atau items kosong → ''. Null-guard penuh. */
const SEV_TONE = { Critical: 'warn', High: 'warn', Med: 'note', Low: 'plain' };
function severityHtml(ctx, dp) {
  const { t, esc, fmt } = ctx;
  const sv = dp && dp.severity;
  if (!sv || !Array.isArray(sv.items)) return '';
  const items = sv.items.filter((it) => it && it.tema);
  if (!items.length) return '';
  const sevLabel = (lab) => {
    const key = String(lab || '').toLowerCase();
    const fb = { critical: 'Kritis', high: 'Tinggi', med: 'Sedang', low: 'Rendah' }[key] || lab || '';
    return t('sentimen.insight.sev_' + key, null, fb);
  };
  const rows = items.map((it) => {
    const tone = SEV_TONE[it.severity_label] || 'plain';
    const sym = tone === 'warn' ? '▲' : tone === 'note' ? '◆' : '◌';
    const chip = it.severity_label
      ? `<span class="badge ${tone} snt-sev-chip">${sym} ${esc(sevLabel(it.severity_label))}</span>`
      : '';
    const n = typeof it.n === 'number'
      ? `<span class="snt-sev-stat mono">${esc(t('sentimen.insight.sev_n', { n: fmt.int(it.n) }, '{n} sebutan'))}</span>` : '';
    const eng = typeof it.total_eng === 'number' && it.total_eng > 0
      ? `<span class="snt-sev-stat snt-sev-eng"><span class="snt-eng-ico" aria-hidden="true">♥</span><span class="mono">${esc(fmt.compact(it.total_eng))}</span></span>` : '';
    const kutipan = it.kutipan
      ? `<blockquote class="snt-sev-q">${esc(String(it.kutipan).slice(0, 180))}</blockquote>` : '';
    return `<article class="snt-sev-row ${tone}">
      <div class="snt-sev-head">
        <span class="snt-sev-tema">${esc(humanizeTheme(it.tema))}</span>
        ${chip}
      </div>
      <div class="snt-sev-meta">${n}${eng}</div>
      ${kutipan}
    </article>`;
  }).join('');
  return `<section class="snt-section snt-depth snt-sev">
    <div class="snt-block-head">
      <h2 class="display-m">${esc(t('sentimen.insight.sev_judul', null, 'Kekhawatiran berdasarkan dampaknya'))}</h2>
      <p class="cap">${esc(t('sentimen.insight.sev_ket', null, 'Tema keluhan diperingkat dari seberapa sering muncul, seberapa diperhatikan (like), dan seberapa tajam nadanya — bukan sekadar daftar.'))}</p>
    </div>
    <div class="snt-sev-list">${rows}</div>
  </section>`;
}

/* DELIVERABLE #4 — Claim tracker: depth.claims [{claim+reach+correction_rate+supported}].
   supported HANYA 'belum-jelas'/'disputed-in-thread' (corpus-internal, NEVER "terbukti").
   Null-guard: claims absen/kosong → ''. */
const CLAIM_SUPPORT = {
  'belum-jelas': { tone: 'note', fb: 'Belum terverifikasi di thread' },
  'disputed-in-thread': { tone: 'warn', fb: 'Dibantah komentar lain' },
};
function claimTrackerHtml(ctx, dp) {
  const { t, esc, fmt } = ctx;
  const list = (Array.isArray(dp && dp.claims) ? dp.claims : []).filter((c) => c && c.claim_id);
  if (!list.length) return '';
  const rows = list.map((c) => {
    const sup = CLAIM_SUPPORT[c.supported] || null;
    const supChip = sup
      ? `<span class="badge ${sup.tone} snt-claim-sup">${esc(t('sentimen.insight.claim_sup_' + String(c.supported).replace(/-/g, '_'), null, sup.fb))}</span>`
      : '';
    const assert = typeof c.n_assert === 'number'
      ? `<span class="snt-claim-stat mono">${esc(t('sentimen.insight.claim_assert', { n: fmt.int(c.n_assert) }, '{n}× disebut'))}</span>` : '';
    const reach = typeof c.weighted_reach === 'number'
      ? `<span class="snt-claim-stat mono">${esc(t('sentimen.insight.claim_reach', { n: fmt.dec(c.weighted_reach, 1) }, 'jangkauan {n}'))}</span>` : '';
    const corr = typeof c.correction_rate === 'number'
      ? `<span class="snt-claim-stat mono">${esc(t('sentimen.insight.claim_corr', { p: fmt.persen(c.correction_rate * 100) }, '{p} dikoreksi'))}</span>` : '';
    const kutipan = c.kutipan
      ? `<blockquote class="snt-claim-q">${esc(String(c.kutipan).slice(0, 180))}</blockquote>` : '';
    return `<article class="snt-claim-row">
      <div class="snt-claim-head">
        <span class="snt-claim-id">${esc(humanizeTheme(c.claim_id))}</span>
        ${supChip}
      </div>
      <div class="snt-claim-meta">${assert}${reach}${corr}</div>
      ${kutipan}
    </article>`;
  }).join('');
  return `<section class="snt-section snt-depth snt-claim">
    <div class="snt-block-head">
      <h2 class="display-m">${esc(t('sentimen.insight.claim_judul', null, 'Klaim yang beredar di komentar'))}</h2>
      <p class="cap">${esc(t('sentimen.insight.claim_ket', null, 'Apa yang dikatakan konsumen tentang produk — seberapa sering, dan apakah ada yang membantah di thread. Bukan penilaian benar/salah faktual.'))}</p>
    </div>
    <div class="snt-claim-list">${rows}</div>
  </section>`;
}

/* DELIVERABLE (audience_voice) — question_clusters: pertanyaan berulang ('Celah informasi').
   Null-guard: question_clusters absen/kosong → ''. */
function questionClustersHtml(ctx, dp) {
  const { t, esc, fmt } = ctx;
  const list = (Array.isArray(dp && dp.question_clusters) ? dp.question_clusters : []).filter((q) => q && q.cluster);
  if (!list.length) return '';
  const rows = list.map((q) => {
    const n = typeof q.n === 'number'
      ? `<span class="snt-qc-stat mono">${esc(t('sentimen.insight.kl_sebutan', { n: fmt.int(q.n) }, '{n} sebutan'))}</span>` : '';
    const likes = typeof q.total_likes === 'number' && q.total_likes > 0
      ? `<span class="snt-qc-stat snt-qc-eng"><span class="snt-eng-ico" aria-hidden="true">♥</span><span class="mono">${esc(fmt.compact(q.total_likes))}</span></span>` : '';
    const ans = (q.answered === true)
      ? `<span class="badge ok snt-qc-ans">● ${esc(t('sentimen.insight.qc_terjawab', null, 'Terjawab di thread'))}</span>`
      : (q.answered === false)
        ? `<span class="badge note snt-qc-ans">◌ ${esc(t('sentimen.insight.qc_belum', null, 'Belum terjawab'))}</span>` : '';
    const kutipan = q.kutipan
      ? `<blockquote class="snt-qc-q">${esc(String(q.kutipan).slice(0, 180))}</blockquote>` : '';
    return `<article class="snt-qc-row">
      <div class="snt-qc-head">
        <span class="snt-qc-tema">${esc(humanizeTheme(q.cluster))}</span>
        ${ans}
      </div>
      <div class="snt-qc-meta">${n}${likes}</div>
      ${kutipan}
    </article>`;
  }).join('');
  return `<section class="snt-section snt-depth snt-qc">
    <div class="snt-block-head">
      <h2 class="display-m">${esc(t('sentimen.insight.qc_judul', null, 'Yang paling sering ditanyakan'))}</h2>
      <p class="cap">${esc(t('sentimen.insight.qc_ket', null, 'Pertanyaan berulang konsumen — celah informasi paling berdampak untuk dijawab brand.'))}</p>
    </div>
    <div class="snt-qc-list">${rows}</div>
  </section>`;
}

/* DELIVERABLE #6 — MANIFEST-DRIVEN EMISSION: bila insights.sections ada, render stack
   sekunder darinya (urut manifest, hanya emit:true); emit:false → one-liner redup dari
   reason (opsional). Tiap id → fn render. Argumen helper di-bind di renderDetail via closure
   (akses ke ctx/ov/s/dp/ins). Section tanpa renderer dikenal → di-skip (tak men-throw). */
function buildSectionRenderers(api) {
  /* api = { ctx, ov, s, dp, ins, recsHtml } — semua sudah null-checked oleh pemanggil. */
  const { ctx, ov, s, dp, ins } = api;
  return {
    distribution_raw_weighted: () => categoryDistributionHtml(ctx, ov),
    pain_points: () => severityHtml(ctx, dp),
    audience_voice: () => questionClustersHtml(ctx, dp) + (dp ? depthKlasterHtml(ctx, dp) : ''),
    language_emoji: () => (dp ? depthBahasaHtml(ctx, dp) : ''),
    claim_tracker: () => claimTrackerHtml(ctx, dp),
    key_findings_top3: () => (dp ? depthTestimoniHtml(ctx, dp) : ''),
    recommendations: () => api.recsHtml || '',
    /* executive_overview / methodology / conclusion / limitations dirender di area
       primer/hero/keterbatasan (bukan stack sekunder) → tak ada blok di sini. */
  };
}

/* reason emit:false → one-liner redup awam. Hanya untuk reason yang dikenal & relevan
   (mis. 'insufficient-concern-support'). Tak dikenal → '' (jangan tampilkan jargon). */
function sectionAbsentNote(ctx, sec) {
  const { t, esc } = ctx;
  if (!sec || sec.emit !== false || !sec.reason) return '';
  const REASON_FB = {
    'insufficient-concern-support': 'Keluhan belum cukup muncul di sampel ini.',
    'insufficient-batch-support': '',
    'no-claims-in-corpus': 'Belum ada klaim spesifik yang beredar di komentar.',
    'no-question-clusters': 'Belum ada pertanyaan berulang yang menonjol.',
  };
  const fb = REASON_FB[sec.reason];
  if (fb === '' ) return ''; /* sengaja disenyapkan */
  if (fb === undefined) return '';
  const txt = t('sentimen.insight.absent_' + String(sec.reason).replace(/-/g, '_'), null, fb);
  if (!txt) return '';
  return `<p class="snt-absent cap" role="note">${esc(txt)}</p>`;
}

/* perakit stack sekunder dari manifest (kontrak §5.7). Mengembalikan '' bila manifest
   kosong/absen → pemanggil pakai jalur legacy (depthLayerHtml). */
function manifestStackHtml(ctx, sections, api) {
  if (!Array.isArray(sections) || !sections.length) return '';
  const renderers = buildSectionRenderers(api);
  /* hanya seksi yang punya renderer stack (yang lain hidup di area primer). */
  const STACK_IDS = new Set(Object.keys(renderers));
  const out = sections
    .filter((sec) => sec && sec.id && STACK_IDS.has(sec.id))
    .map((sec) => {
      if (sec.emit === true) return renderers[sec.id]() || '';
      return sectionAbsentNote(ctx, sec);
    })
    .filter(Boolean);
  return out.join('');
}

/* blok bukti+data: 7 chart + grid kutipan provenance + lampiran sumber +
   pemicu "semua komentar", di dalam <details> tertutup. */
function evidenceDiscloseHtml(ctx, sources, commentsTotal) {
  const { t, esc } = ctx;
  const allBtn = commentsTotal > 0
    ? `<div class="snt-allcomments"><button type="button" class="textlink" id="snt-all-comments">${esc(t('sentimen.insight.drill_semua', { total: ctx.fmt.int(commentsTotal) }, 'Lihat semua komentar ({total})'))} →</button></div>`
    : '';
  return `<details class="ops-disclose snt-evidence" id="snt-evidence">
    <summary><span class="dsc-title">${esc(t('sentimen.insight.bukti_judul'))}</span></summary>
    <div class="dsc-body" style="margin-top:12px">
      <p class="cap" style="margin:0 0 12px">${esc(t('sentimen.insight.bukti_ket'))}</p>
      <div class="callout note" style="margin:0 0 14px"><p>${esc(t('sentimen.metodologi'))}</p></div>
      <div class="sent-charts">
        ${chartCard(ctx, 'donut', t('sentimen.detail.donut_judul'), '')}
        ${chartCard(ctx, 'rvw', t('sentimen.detail.rawvsweighted_judul'), t('sentimen.detail.rawvsweighted_ket'))}
        ${chartCard(ctx, 'plat', t('sentimen.detail.platform_judul'), t('sentimen.detail.platform_ket'))}
        ${themeChartCard(ctx)}
        ${chartCard(ctx, 'scatter', t('sentimen.detail.scatter_judul'), t('sentimen.detail.scatter_ket'))}
        ${chartCard(ctx, 'tren', t('sentimen.detail.tren_judul'), '')}
      </div>
      <section class="section" style="margin-top:8px">
        <div class="section-head"><div class="eyebrow">${esc(t('sentimen.detail.kutipan_judul'))}</div></div>
        <div id="sent-quotes" style="margin-top:12px"></div>
        ${allBtn}
      </section>
      ${sourcesAppendixHtml(ctx, sources)}
    </div>
  </details>`;
}

/* ============================================================ Deep insight (depth) ===
   Lapisan wawasan mendalam dari ctx.data...insights.depth. Semua sub-field nullable →
   tiap helper skip diam-diam (string kosong) bila datanya tak ada. Helper di-namespace
   `depth*`. Label fungsi/sub-tema dimanusiakan; teks UI lewat t(...) dengan fallback. */

/* fungsi komentar (enum) → label manusiawi (niat_beli → "Niat beli", tips_saran →
   "Tips & saran"). Tak dikenal → humanizeTheme generik. */
const FUNGSI_LABEL = {
  testimoni: 'Sudah mencoba', niat_beli: 'Niat beli', pertanyaan: 'Bertanya',
  tips_saran: 'Tips & saran', perbandingan: 'Perbandingan', humor: 'Candaan',
  advokasi: 'Merekomendasikan', keluhan: 'Keluhan', lainnya: 'Lainnya',
};
function humanizeFungsi(ctx, f) {
  const key = String(f || '').toLowerCase();
  if (!key) return '';
  const fb = FUNGSI_LABEL[key] || humanizeTheme(key);
  return ctx.t('sentimen.insight.fungsi.' + key, null, fb);
}

/* persen dari share 0..1 (×100, ramah-locale). null → '—'. */
function depthPct(ctx, share) {
  return (typeof share === 'number' && Number.isFinite(share)) ? ctx.fmt.persen(share * 100) : '—';
}

/* 1. Testimoni vs niat-beli (HIGH PRIORITY) — pisahkan "sudah coba" dari "baru penasaran"
   agar 91%-positif tak salah-baca. + (opsional) bar tipis distribusi fungsi. */
function depthTestimoniHtml(ctx, dp) {
  const { t, esc, fmt } = ctx;
  const tv = dp.testimoni_vs_intent;
  const dist = dp.distribusi_fungsi;
  if (!tv && !(dist && Object.keys(dist).length)) return '';

  let splitHtml = '';
  if (tv) {
    const niat = fmt.persen((tv.niat_beli_share || 0) * 100);
    const sudah = fmt.persen((tv.testimoni_share || 0) * 100);
    const tanya = fmt.persen((tv.pertanyaan_share || 0) * 100);
    const seg = (val, key, fb) => `<span class="snt-split-seg"><b class="mono">${esc(val)}</b> ${esc(t('sentimen.insight.' + key, null, fb))}</span>`;
    splitHtml = `<p class="snt-split">
      ${seg(niat, 'split_niat', 'baru penasaran / niat coba')}
      <span class="snt-split-sep" aria-hidden="true">·</span>
      ${seg(sudah, 'split_sudah', 'sudah mencoba')}
      <span class="snt-split-sep" aria-hidden="true">·</span>
      ${seg(tanya, 'split_tanya', 'bertanya dulu')}
    </p>`;
  }

  const note = (tv && tv.catatan)
    ? `<div class="callout note snt-split-note"><p>${esc(tv.catatan)}</p></div>`
    : '';

  /* bar tipis distribusi fungsi — DARI JUMLAH KOMENTAR (share_raw), konsisten dgn split di atas
     (dulu pakai share_w → angka beda dgn split = terlihat inkonsisten). */
  let barHtml = '';
  if (dist && Object.keys(dist).length) {
    const segs = Object.entries(dist)
      .map(([f, v]) => ({ f, share: (v && typeof v.share_raw === 'number') ? v.share_raw : 0, n: (v && v.n) || 0 }))
      .filter((x) => x.share > 0)
      .sort((a, b) => b.share - a.share);
    if (segs.length) {
      const bar = segs.map((x, i) => {
        const pct = Math.max(0.5, x.share * 100);
        const lbl = `${humanizeFungsi(ctx, x.f)} ${fmt.persen(x.share * 100)}`;
        return `<span class="snt-distseg snt-distc-${i % 6}" style="flex:${pct.toFixed(2)} 1 0%" title="${esc(lbl)}"></span>`;
      }).join('');
      const legend = segs.slice(0, 6).map((x, i) =>
        `<span class="snt-distleg"><span class="snt-distdot snt-distc-${i % 6}" aria-hidden="true"></span>${esc(humanizeFungsi(ctx, x.f))} <b class="mono">${esc(fmt.persen(x.share * 100))}</b></span>`
      ).join('');
      barHtml = `<div class="snt-distlabel cap">${esc(t('sentimen.insight.dist_label_raw', null, 'Komposisi jenis komentar (dari jumlah komentar)'))}</div>
        <div class="snt-distbar" role="img" aria-label="${esc(t('sentimen.insight.dist_aria', null, 'Distribusi jenis komentar'))}">${bar}</div>
        <div class="snt-distlegend">${legend}</div>`;
    }
  }

  /* kejutan engagement (referensi "the surprising truth"): fungsi yang menyedot like jauh di
     atas porsi komentarnya — mis. humor/sarkas. TERPISAH & berlabel "tertimbang engagement"
     agar tak rancu dgn angka "dari jumlah komentar" di atas. */
  let surpriseHtml = '';
  const es = dp.engagement_surprise;
  if (es && es.fungsi) {
    surpriseHtml = `<div class="callout note snt-eng-surprise"><p>${esc(t('sentimen.insight.eng_surprise',
      { fungsi: humanizeFungsi(ctx, es.fungsi), w: fmt.persen((es.share_w || 0) * 100), r: fmt.persen((es.share_raw || 0) * 100) },
      'Secara engagement: komentar “{fungsi}” menyedot {w} dari total like — padahal hanya {r} dari jumlah komentar. Suara nyaring ini mendominasi perhatian publik.'))}</p></div>`;
  }

  return `<section class="snt-section snt-depth snt-depth-split">
    <div class="snt-block-head">
      <h2 class="display-m">${esc(t('sentimen.insight.testimoni_judul', null, 'Sudah mencoba, atau baru penasaran?'))}</h2>
      <p class="cap">${esc(t('sentimen.insight.testimoni_ket', null, 'Komentar positif belum tentu dari yang sudah beli — ini pemecahannya.'))}</p>
    </div>
    ${splitHtml}
    ${note}
    ${barHtml}
    ${surpriseHtml}
  </section>`;
}

/* 2. Bahasa konsumen — chip kata/frasa yang sering muncul + baris emoji. Apa adanya
   (count = sering muncul), bukan klaim statistik. */
function depthBahasaHtml(ctx, dp) {
  const { t, esc, fmt } = ctx;
  const b = dp.bahasa;
  if (!b) return '';
  const uni = (Array.isArray(b.unigram) ? b.unigram : []).filter((x) => x && x.term).slice(0, 8);
  const bi = (Array.isArray(b.bigram) ? b.bigram : []).filter((x) => x && x.term).slice(0, 5);
  const emo = (Array.isArray(b.emoji) ? b.emoji : []).filter((x) => x && x.char).slice(0, 8);
  if (!uni.length && !bi.length && !emo.length) return '';

  const chip = (term, count) => `<span class="snt-chip">${esc(term)}<span class="snt-chip-n mono">${esc(fmt.int(count))}</span></span>`;
  const uniHtml = uni.length ? `<div class="snt-chips">${uni.map((x) => chip(x.term, x.count)).join('')}</div>` : '';
  const biHtml = bi.length
    ? `<div class="snt-chips snt-chips-bi">${bi.map((x) => chip(x.term, x.count)).join('')}</div>`
    : '';
  const emoHtml = emo.length
    ? `<div class="snt-emojis" aria-label="${esc(t('sentimen.insight.bahasa_emoji_aria', null, 'Emoji yang sering dipakai'))}">${emo.map((x) =>
        `<span class="snt-emoji"><span class="snt-emoji-c" aria-hidden="true">${esc(x.char)}</span><span class="snt-emoji-n mono">${esc(fmt.int(x.count))}</span></span>`).join('')}</div>`
    : '';

  return `<section class="snt-section snt-depth snt-depth-bahasa">
    <div class="snt-block-head">
      <h2 class="display-m">${esc(t('sentimen.insight.bahasa_judul', null, 'Bahasa yang dipakai konsumen'))}</h2>
      <p class="cap">${esc(t('sentimen.insight.bahasa_ket', null, 'Kata, frasa, dan emoji yang paling sering muncul — bahan untuk meniru cara mereka bicara.'))}</p>
    </div>
    ${uniHtml}
    ${biHtml}
    ${emoHtml}
  </section>`;
}

/* satu kartu kutipan papan — teks · badge fungsi · dot polaritas · engagement · sumber
   (tab baru) · kenapa_penting (italic, bila ada). */
function depthQuoteCardHtml(ctx, q) {
  const { esc, ui } = ctx;
  if (!q || !q.text) return '';
  const pol = polClass(q.polaritas);
  const eng = engStr(ctx, q.engagement) || engStr(ctx, q);
  const fungsi = q.fungsi ? `<span class="snt-pk-fungsi">${esc(humanizeFungsi(ctx, q.fungsi))}</span>` : '';
  const src = ui.sourceLink({ sumber: q.platform || '', url: q.url, tanggal_akses: q.date });
  const meta = [
    ui.tierChip(q.tier),
    eng ? `<span class="sq-eng">${esc(eng)}</span>` : '',
    src,
  ].filter(Boolean).join(' · ');
  const why = q.kenapa_penting
    ? `<p class="snt-pk-why">${esc(q.kenapa_penting)}</p>` : '';
  return `<article class="snt-pk ${pol}">
    <div class="snt-pk-head">
      <span class="snt-pk-dot" aria-hidden="true"></span>
      ${fungsi}
    </div>
    <blockquote class="snt-pk-text">${esc(String(q.text).slice(0, 220))}</blockquote>
    ${meta ? `<div class="snt-pk-meta">${meta}</div>` : ''}
    ${why}
  </article>`;
}

/* 3. Papan kutipan — kutipan paling berpengaruh sebagai kartu. */
function depthPapanHtml(ctx, dp) {
  const { t, esc } = ctx;
  const list = (Array.isArray(dp.papan_kutipan) ? dp.papan_kutipan : []).filter((q) => q && q.text);
  if (!list.length) return '';
  return `<section class="snt-section snt-depth snt-depth-papan">
    <div class="snt-block-head">
      <h2 class="display-m">${esc(t('sentimen.insight.papan_judul', null, 'Kutipan paling berpengaruh'))}</h2>
      <p class="cap">${esc(t('sentimen.insight.papan_ket', null, 'Komentar yang paling banyak menggerakkan percakapan — beserta alasan kenapa penting.'))}</p>
    </div>
    <div class="snt-pk-grid">${list.map((q) => depthQuoteCardHtml(ctx, q)).join('')}</div>
  </section>`;
}

/* 4. Perbandingan vs lain — kutipan yang membandingkan dengan produk/varian lain. */
function depthPerbandinganHtml(ctx, dp) {
  const { t, esc, ui } = ctx;
  const list = (Array.isArray(dp.perbandingan) ? dp.perbandingan : []).filter((c) => c && c.text);
  if (!list.length) return '';
  const items = list.map((c) => {
    const eng = engStr(ctx, c.engagement) || engStr(ctx, c);
    const src = ui.sourceLink({ sumber: c.platform || '', url: c.url });
    const meta = [eng ? `<span class="sq-eng">${esc(eng)}</span>` : '', src].filter(Boolean).join(' · ');
    return `<li class="snt-cmp-row">
      <blockquote class="snt-cmp-text">${esc(String(c.text).slice(0, 200))}</blockquote>
      ${meta ? `<div class="snt-cmp-meta">${meta}</div>` : ''}
    </li>`;
  }).join('');
  return `<section class="snt-section snt-depth snt-depth-cmp">
    <div class="snt-block-head">
      <h2 class="display-m">${esc(t('sentimen.insight.cmp_judul', null, 'Dibandingkan produk lain'))}</h2>
      <p class="cap">${esc(t('sentimen.insight.cmp_ket', null, 'Saat konsumen membandingkan dengan merek atau varian lain — sinyal posisi di benak mereka.'))}</p>
    </div>
    <ul class="snt-cmp-list">${items}</ul>
  </section>`;
}

/* 5. Sub-tema — pecahan tema dominan jadi butir spesifik (rasa → manis/segar/wangi-apel). */
function depthSubTemaHtml(ctx, dp) {
  const { t, esc, fmt } = ctx;
  const st = dp.sub_tema;
  if (!st || typeof st !== 'object') return '';
  const keys = Object.keys(st).filter((k) => Array.isArray(st[k]) && st[k].length);
  if (!keys.length) return '';
  const rows = keys.map((tema) => {
    const subs = st[tema];
    const parts = subs.map((s) => {
      const lbl = humanizeTheme(s.label);
      const title = s.kutipan ? ` title="${esc(String(s.kutipan))}"` : '';
      return `<span class="snt-sub-item"${title}>${esc(lbl)} <span class="snt-sub-n mono">(${esc(fmt.int(s.count))})</span></span>`;
    }).join('<span class="snt-sub-sep" aria-hidden="true">·</span>');
    return `<li class="snt-sub-row">
      <span class="snt-sub-tema">${esc(humanizeTheme(tema))}</span>
      <span class="snt-sub-parts">${parts}</span>
    </li>`;
  }).join('');
  return `<section class="snt-section snt-depth snt-depth-sub">
    <div class="snt-block-head">
      <h2 class="display-m">${esc(t('sentimen.insight.sub_judul', null, 'Rincian di balik tiap pujian'))}</h2>
      <p class="cap">${esc(t('sentimen.insight.sub_ket', null, 'Apa persisnya yang konsumen sukai — pecahan tema besar jadi hal-hal spesifik.'))}</p>
    </div>
    <ul class="snt-sub-list">${rows}</ul>
  </section>`;
}

/* 6. Perlu dipantau — tema risiko di bawah ambang (indikatif, bukan kesimpulan). */
function depthWatchHtml(ctx, dp) {
  const { t, esc, fmt } = ctx;
  const list = (Array.isArray(dp.watch_items) ? dp.watch_items : []).filter((w) => w && w.tema);
  if (!list.length) return '';
  const items = list.map((w) => {
    const mention = (typeof w.mention === 'number') ? w.mention : null;
    const head = mention != null
      ? t('sentimen.insight.watch_baris', { tema: humanizeTheme(w.tema), n: fmt.int(mention) }, '{tema} — {n} sebutan (indikatif)')
      : `${humanizeTheme(w.tema)} (${t('sentimen.insight.watch_indikatif', null, 'indikatif')})`;
    const kutipan = w.kutipan ? `<p class="snt-watch-q">${esc(String(w.kutipan).slice(0, 160))}</p>` : '';
    return `<li class="snt-watch-row">
      <span class="snt-watch-head">${esc(head)}</span>
      ${kutipan}
    </li>`;
  }).join('');
  return `<section class="snt-section snt-depth snt-depth-watch">
    <div class="snt-block-head">
      <h2 class="display-m">${esc(t('sentimen.insight.watch_judul', null, 'Perlu dipantau'))}</h2>
      <p class="cap">${esc(t('sentimen.insight.watch_ket', null, 'Belum cukup banyak untuk jadi keluhan utama — tapi cukup untuk diawasi sebelum membesar.'))}</p>
    </div>
    <ul class="snt-watch-list">${items}</ul>
  </section>`;
}

/* DEPRECATED (DELIVERABLE #7c) — peluang konten sintetik. TAK LAGI DIRENDER (rekomendasi
   adalah rumah tunggal untuk arahan keputusan; ide konten sintetik = restatement). Fn
   dipertahankan agar tak memutus pemanggil/uji; depthLayerHtml & manifest tak memanggilnya. */
function depthKontenHtml(ctx, dp) {
  const { t, esc } = ctx;
  const list = (Array.isArray(dp.konten_peluang) ? dp.konten_peluang : []).filter((k) => k && (k.ide || k.tema));
  if (!list.length) return '';
  const items = list.map((k) => {
    const judul = k.ide ? String(k.ide) : humanizeTheme(k.tema);
    const dasar = k.dasar ? `<span class="snt-konten-dasar">${esc(String(k.dasar))}</span>` : '';
    return `<li class="snt-konten-row">
      <span class="snt-konten-mark" aria-hidden="true">→</span>
      <span class="snt-konten-main"><span class="snt-konten-ide">${esc(judul)}</span>${dasar}</span>
    </li>`;
  }).join('');
  return `<section class="snt-section snt-depth snt-depth-konten">
    <div class="snt-block-head">
      <h2 class="display-m">${esc(t('sentimen.insight.konten_judul', null, 'Peluang konten'))}</h2>
      <p class="cap">${esc(t('sentimen.insight.konten_ket', null, 'Ide konten yang berangkat dari hal yang sudah terbukti disukai konsumen.'))}</p>
    </div>
    <ul class="snt-konten-list">${items}</ul>
  </section>`;
}

/* low-n: catatan jujur bahwa sampel masih kecil → baca lapisan mendalam sebagai indikatif. */
function depthLowNHtml(ctx, dp) {
  const { t, esc } = ctx;
  if (!dp.low_n) return '';
  return `<div class="callout note snt-depth-lown"><p>${esc(t('sentimen.insight.depth_low_n', null, 'Sampel masih kecil — baca rincian di bawah sebagai indikasi awal, bukan kesimpulan pasti.'))}</p></div>`;
}

/* perakit lapisan depth — semua nullable-guarded di tiap helper; gabung yang non-kosong.
   Mengembalikan '' bila tak ada satu pun lapisan (mis. depth null → renderDetail skip). */
/* Klaster kontekstual: APA yang ditanyakan/dikeluhkan/dipuji publik — bukan sekadar %fungsi,
   tapi tema spesifik berulang + frekuensi + engagement + contoh. Skip diam bila kosong. */
function klasterGroupHtml(ctx, judul, ket, list, kind) {
  const { t, esc, fmt } = ctx;
  const rows = (Array.isArray(list) ? list : []).filter((k) => k && k.tema).slice(0, 6).map((k) => {
    const n = Number.isFinite(k.n) ? k.n : null;
    const likes = Number.isFinite(k.total_likes) ? k.total_likes : null;
    const meta = [
      n != null ? `<span class="snt-kl-n mono">${esc(t('sentimen.insight.kl_sebutan', { n: fmt.int(n) }, '{n} sebutan'))}</span>` : '',
      likes ? `<span class="snt-kl-eng"><span class="snt-eng-ico" aria-hidden="true">♥</span><span class="snt-eng-n">${esc(fmt.compact(likes))}</span><span class="snt-eng-unit">${esc(t('sentimen.insight.suara_eng_label', null, 'suka'))}</span></span>` : '',
    ].filter(Boolean).join('');
    const contoh = (Array.isArray(k.contoh) ? k.contoh : []).slice(0, 2)
      .map((c) => `<li>${esc(String(c).slice(0, 160))}</li>`).join('');
    return `<article class="snt-kl-row ${kind}">
      <div class="snt-kl-head"><span class="snt-kl-tema">${esc(k.tema)}</span>${meta ? `<span class="snt-kl-meta">${meta}</span>` : ''}</div>
      ${contoh ? `<ul class="snt-kl-contoh">${contoh}</ul>` : ''}
    </article>`;
  }).join('');
  if (!rows) return '';
  return `<div class="snt-kl-group snt-kl-${kind}">
    <h3 class="snt-kl-judul">${esc(judul)}</h3>
    <p class="cap">${esc(ket)}</p>
    <div class="snt-kl-list">${rows}</div>
  </div>`;
}

function depthKlasterHtml(ctx, dp) {
  const { t, esc } = ctx;
  const kl = dp.klaster;
  if (!kl || typeof kl !== 'object') return '';
  const groups = [
    klasterGroupHtml(ctx, t('sentimen.insight.kl_tanya_judul', null, 'Yang paling banyak ditanyakan'), t('sentimen.insight.kl_tanya_ket', null, 'Pertanyaan berulang konsumen — gap konten paling berdampak untuk dijawab brand.'), kl.pertanyaan, 'tanya'),
    klasterGroupHtml(ctx, t('sentimen.insight.kl_keluhan_judul', null, 'Kekhawatiran yang berulang'), t('sentimen.insight.kl_keluhan_ket', null, 'Keluhan yang muncul lebih dari sekali — prioritas perbaikan.'), kl.keluhan, 'keluhan'),
    klasterGroupHtml(ctx, t('sentimen.insight.kl_pujian_judul', null, 'Yang paling dipuji'), t('sentimen.insight.kl_pujian_ket', null, 'Hal yang berulang kali disukai — kekuatan untuk ditonjolkan.'), kl.pujian, 'pujian'),
  ].filter(Boolean);
  if (!groups.length) return '';
  return `<section class="snt-section snt-depth snt-depth-klaster">
    <div class="snt-block-head">
      <h2 class="display-m">${esc(t('sentimen.insight.kl_judul', null, 'Apa yang sebenarnya dibicarakan'))}</h2>
      <p class="cap">${esc(t('sentimen.insight.kl_ket', null, 'Bukan sekadar persentase — tema spesifik yang berulang di komentar, beserta seberapa sering & seberapa diperhatikan (like).'))}</p>
    </div>
    ${groups.join('')}
  </section>`;
}

/* JALUR LEGACY (JSON lama tanpa insights.sections). depthKontenHtml (peluang konten
   sintetik) SENGAJA DI-DROP dari render (DELIVERABLE #7c — redundan; rekomendasi adalah
   rumah tunggal). Dipertahankan sebagai fn agar tak memutus impor/uji, tapi tak dipanggil. */
function depthLayerHtml(ctx, dp) {
  if (!dp) return '';
  const blocks = [
    depthTestimoniHtml(ctx, dp),
    depthKlasterHtml(ctx, dp),
    depthBahasaHtml(ctx, dp),
    depthSubTemaHtml(ctx, dp),
    depthPapanHtml(ctx, dp),
    depthPerbandinganHtml(ctx, dp),
    depthWatchHtml(ctx, dp),
  ].filter(Boolean);
  if (!blocks.length) return '';
  /* low-n di paling atas lapisan agar membingkai semua butir di bawahnya */
  return depthLowNHtml(ctx, dp) + blocks.join('');
}

function renderDetail(el, ctx, slug) {
  const { data, t, esc, fmt, ui } = ctx;
  const sd = data.sentiment;
  const d = sd && sd.detail ? sd.detail[slug] : null;

  const back = `<a class="textlink" href="#/sentimen">${esc(t('sentimen.kembali'))}</a>`;
  if (!d || !d.stats || !d.stats.overall) {
    /* status-aware empty: item running/failed di daftar punya status tapi belum punya
       hasil → pesan jelas alih-alih "tidak ditemukan" generik (yang bingungkan saat
       analisis masih jalan / baru gagal). */
    const li = (sd && Array.isArray(sd.list)) ? sd.list.find((x) => x && x.slug === slug) : null;
    const st = li && li.status;
    const nm = (li && li.product_name) || (d && d.product_name) || slug;
    let body;
    if (st === 'running') {
      body = `<div class="empty"><p class="e-apa"><span class="spinner spinner-sm" aria-hidden="true"></span> ${esc(t('sentimen.detail.running', null, 'Analisis sedang berjalan — hasil muncul saat selesai.'))}</p></div>`;
    } else if (st === 'failed') {
      body = `<div class="empty"><p class="e-apa">${esc(t('sentimen.detail.failed', null, 'Analisis tak selesai (mungkin timeout atau korpus sepi). Coba jalankan ulang dari halaman daftar.'))}</p></div>`;
    } else {
      body = ui.empty('empty.sentimen.detail');
    }
    el.innerHTML = `<header class="pagehead"><div>${back}<h1 class="display-l">${esc(nm)}</h1></div></header>
      <div class="card">${body}</div>`;
    return;
  }

  const s = d.stats;
  const ov = s.overall;
  const ins = d.insights && typeof d.insights === 'object' ? d.insights : null;
  const confLow = (s.limitations || []).includes('n-kecil') || (s.limitations || []).includes('single-loud-voice');

  /* data baru (semua nullable → guard): engagement rendah, cakupan, komentar mentah,
     sumber. engagementLow = sinyal jujur untuk suara menonjol & strip cakupan. */
  const engagementLow = !!(ins && ins.engagement_low === true);
  const coverage = d.coverage && typeof d.coverage === 'object' ? d.coverage : null;
  const comments = Array.isArray(d.comments) ? d.comments : [];
  const sources = Array.isArray(d.sources) ? d.sources : [];
  const drillCount = comments.length ? buildDrillCount(comments) : null;

  /* 1. Hero — headline besar (fallback verdict_ringkas), verdict + confidence +
     strip cakupan jujur (berapa komentar/sumber/platform, batas data). */
  const headline = (ins && (ins.headline || ins.verdict_ringkas)) ? sanitizeNarrative(ins.headline || ins.verdict_ringkas) : null;
  const coverageStrip = coverageStripHtml(ctx, coverage, engagementLow);
  const hero = `
  <header class="pagehead snt-hero">
    <div>
      ${back}
      <div class="eyebrow" style="margin-top:8px">${esc(t('sentimen.eyebrow'))} · ${esc(fmt.tanggal(d.generated_at))}</div>
      <h1 class="display-l snt-hero-name">${esc(d.product_name || slug)}</h1>
      ${headline ? `<p class="snt-headline">${esc(headline)}</p>` : ''}
      <div class="sent-card-badges snt-hero-badges">${verdictBadge(ctx, ov.verdict)}${verdictHint(ctx, ov.verdict)} ${confChip(ctx, confLow)}</div>
      ${coverageStrip}
    </div>
  </header>`;

  /* 2. Apa artinya (skip jika null) — sanitasi jargon naratif (d_mu) defensif */
  const apaArtinya = ins && ins.apa_artinya
    ? `<p class="snt-lead body">${esc(sanitizeNarrative(ins.apa_artinya))}</p>`
    : '';

  /* 3. Strip angka kunci ringkas + skor reliabilitas ⭐ (di area metodologi/hero). */
  const figs = keyFiguresHtml(ctx, ov);
  const reliability = reliabilityScoreHtml(ctx, s);

  /* 3·MKT. Agregat marketplace (T3) — kartu terpisah, fakta rating toko/etalase (TikTok Shop
     + Tokopedia). Nullable → '' (skip). TIDAK dicampur ke donut/stats sentimen. */
  const marketplaceAgg = marketplaceAggregatesHtml(ctx, d.marketplace_aggregates);

  /* 3a. Signature reveal (kontrak §5.1) — RUMAH TUNGGAL "ramai vs disukai" + robustness
     pembobotan via d_mu_ci. Bila blok ini ADA → weightingNote LAMA disenyapkan (rekonsiliasi
     "barely shifts" satu kali). Bila absen (JSON lama) → fallback ke weightingNote legacy. */
  const categoryDist = categoryDistributionHtml(ctx, ov);
  const weightingNote = categoryDist ? '' : weightingNoteHtml(ctx, ov);

  /* 3b. Catatan kestabilan akuisisi (kontrak §5.4) — nullable, skip diam. */
  const stabilityNote = stabilityNoteHtml(ctx, s);

  /* 3c. Lapisan wawasan mendalam (insights.depth). dp null → '' (tak merusak). */
  const dp = ins && ins.depth && typeof ins.depth === 'object' ? ins.depth : null;

  /* 5. Suara menonjol — JUJUR: engagementLow → catatan, bukan klaim "banyak disukai". */
  const voices = ins ? prominentVoicesHtml(ctx, ins.suara_menonjol, engagementLow) : '';

  /* 6. Rekomendasi (retitle: bukan "Implikasi…"; gerbang manifest di jalur baru). */
  const recs = ins ? recommendationsHtml(ctx, ins.rekomendasi) : '';

  /* 4/3d. STACK SEKUNDER — manifest-driven bila insights.sections ada (kontrak §5.7);
     else jalur LEGACY (depthLayerHtml) untuk JSON lama. Manifest path: rekomendasi keluar
     lewat seksi 'recommendations' (jangan dobel di bawah). themeColumnsHtml & depthKontenHtml
     SENGAJA TAK dirender (redundansi — diliput severity + klaster). */
  const hasManifest = !!(ins && Array.isArray(ins.sections) && ins.sections.length);
  const secApi = { ctx, ov, s, dp, ins, recsHtml: recs };
  const secondaryStack = hasManifest ? manifestStackHtml(ctx, ins.sections, secApi) : '';
  const depthLayer = hasManifest ? '' : (dp ? depthLayerHtml(ctx, dp) : '');
  /* di jalur manifest, rekomendasi dirender oleh stack (seksi 'recommendations') →
     jangan render lagi standalone. di jalur legacy, recs standalone seperti dulu. */
  const recsStandalone = hasManifest ? '' : recs;

  /* fallback: tanpa insights, tampilkan catatan ringkas agar tak kosong total */
  const insightFallbackNote = (!ins || (!headline && !ins.apa_artinya))
    ? `<div class="callout note"><p>${esc(t('sentimen.insight.kosong_insight'))}</p></div>`
    : '';

  /* 7. Bukti pendukung & data lengkap (7 chart + grid kutipan + lampiran sumber +
     pemicu "semua komentar") */
  const evidence = evidenceDiscloseHtml(ctx, sources, comments.length);

  /* 8. Keterbatasan — catatan_keyakinan + daftar limitations */
  const catKeyakinan = ins && ins.catatan_keyakinan
    ? `<p class="snt-lim-note body-s">${esc(sanitizeNarrative(ins.catatan_keyakinan))}</p>` : '';

  /* 9. Laporan analisis lengkap — uraian naratif mendalam (sekunder, paling bawah). */
  const reportBlock = d.report_md
    ? `<details class="ops-disclose snt-report"><summary><span class="dsc-title">${esc(t('sentimen.detail.laporan_lengkap'))}</span></summary><div class="dsc-body" style="margin-top:10px"><p class="cap" style="margin:0 0 12px">${esc(t('sentimen.detail.laporan_lengkap_ket', null, 'Uraian naratif mendalam di balik kesimpulan di atas.'))}</p><div class="md-body snt-md" id="sent-md"></div></div></details>`
    : '';

  el.innerHTML = `
  ${hero}
  ${apaArtinya ? `<section class="snt-section snt-apa">
    <div class="eyebrow">${esc(t('sentimen.insight.apa_artinya_judul'))}</div>
    ${apaArtinya}
  </section>` : ''}
  ${insightFallbackNote}
  ${figs}
  ${reliability}
  ${marketplaceAgg}
  ${categoryDist}
  ${weightingNote}
  ${stabilityNote}
  ${secondaryStack}
  ${depthLayer}
  ${voices}
  ${recsStandalone}
  ${evidence}
  <article class="card snt-lim-card">
    <div class="co-title">⚠ ${esc(t('sentimen.insight.keterbatasan_judul'))}</div>
    ${catKeyakinan}
    <div id="sent-lim"></div>
  </article>
  ${reportBlock}`;

  /* keterbatasan list */
  el.querySelector('#sent-lim').innerHTML = limitationsHtml(ctx, s);

  /* laporan md (async) — sanitasi defensif artefak render footer metode dulu */
  if (d.report_md) { ctx.renderMd(sanitizeNarrative(sanitizeReportMd(d.report_md))).then((html) => { const m = el.querySelector('#sent-md'); if (m) m.innerHTML = html; }); }

  /* ===== charts + kutipan provenance hidup DI DALAM <details> tertutup =====
     ECharts butuh container terlihat agar ter-size benar. Render tertunda
     sampai disclosure pertama dibuka (event 'toggle'); sesudahnya, resize.
     'pimas:recharts' (toggle tema) hanya merender ulang bila sudah pernah dibuka. */
  /* drill-down: buka komentar mentah untuk satu tema (verifikasi). */
  const openTheme = (tema) => {
    if (!comments.length) return;
    const rows = commentsForTheme(comments, tema);
    if (!rows.length) return;
    const title = t('sentimen.insight.drill_judul', { tema: humanizeTheme(tema) }, 'Komentar tentang {tema}')
      + ` (${fmt.int(rows.length)})`;
    openDrillDrawer(ctx, rows, title, { filter: true });
  };

  /* ===== JOB 1 — drill-down lintas-chart: tiap visual memetakan komentar mentah =====
     Semua handler bertumpu pada drillChartComments (skip diam bila kosong) sehingga
     callback tak pernah men-throw. Hanya dipasang bila comments.length>0; chart tanpa
     komentar tetap non-interaktif (cursor default, klik tak melakukan apa pun). */
  const hasComments = comments.length > 0;

  /* donut & mentah-vs-tertimbang: irisan/segmen polaritas → komentar polaritas itu */
  const onPolarity = (kind) => {
    const label = t('sentimen.drill.polaritas.' + kind, null,
      kind === 'pos' ? 'Komentar positif' : kind === 'neg' ? 'Komentar negatif' : 'Komentar netral');
    drillChartComments(ctx, commentsForPolarity(comments, kind), label, { filter: false });
  };
  /* per-platform: bar → komentar platform itu (filter polaritas berguna: campur).
     Label platform pakai peta kanonik (TikTok/YouTube/Sumber referensi), bukan
     humanizeTheme generik. */
  const onPlatform = (platform) => {
    const label = t('sentimen.drill.platform', { platform: platformLabel(ctx, platform) }, 'Komentar di {platform}');
    drillChartComments(ctx, commentsForPlatform(comments, platform), label, { filter: true });
  };
  /* scatter: titik = satu komentar nyata → buka komentar tunggal itu */
  const onPoint = (cm) => {
    if (!cm) return;
    openCommentDrawer(ctx, t('sentimen.drill.satu', null, 'Komentar'), [cm], { filter: false });
  };
  /* tren: titik/label periode → komentar pada rentang waktu itu; bila tak bisa
     difilter ke periode, jangan biarkan mati — buka seluruh komentar sebagai gantinya. */
  const onPeriod = (period) => {
    const rows = commentsForPeriod(comments, period);
    if (rows.length) {
      const label = t('sentimen.drill.periode', { periode: humanizePeriod(period) }, 'Komentar {periode}');
      drillChartComments(ctx, rows, label, { filter: true });
    } else {
      const label = t('sentimen.insight.drill_semua_judul', null, 'Semua komentar');
      drillChartComments(ctx, comments, label, { filter: true });
    }
  };

  let chartsDrawn = false;
  const renderCharts = () => {
    drawDonut(ctx, el.querySelector('#wrap-donut'), ov, hasComments ? onPolarity : null);
    drawRawVsWeighted(ctx, el.querySelector('#wrap-rvw'), ov, hasComments ? onPolarity : null);
    drawPlatforms(ctx, el.querySelector('#wrap-plat'), s.per_platform, hasComments ? onPlatform : null);
    /* tema chart: bar bisa diklik → drill-down komentar tema (bila ada komentar) */
    drawThemes(ctx, el.querySelector('#wrap-tema'), s.themes, drillCount ? openTheme : null);
    /* scatter: titik dibangun 1:1 dari komentar nyata → klik buka komentarnya */
    drawScatter(ctx, el.querySelector('#wrap-scatter'), d.scatter || [], comments, hasComments ? onPoint : null);
    drawTrend(ctx, el.querySelector('#wrap-tren'), s.temporal, hasComments ? onPeriod : null);
    chartsDrawn = true;
  };
  const dispo = el.querySelector('#snt-evidence');
  /* kutipan provenance grid (selalu siap di DOM; ECharts saja yang ditunda) */
  const qel = el.querySelector('#sent-quotes');
  if (qel) { qel.innerHTML = quotesHtml(ctx, d.quotes); ui.bindImgFallbacks(el); }
  const onToggle = () => {
    if (!dispo || !dispo.open) return;
    if (!chartsDrawn) renderCharts();
    else resizeCharts(el); /* sudah ter-init: pastikan ukuran benar setelah tutup→buka */
  };
  if (dispo) dispo.addEventListener('toggle', onToggle);

  /* ===== drill-down handlers (kartu tema · tombol semua komentar) ===== */
  /* kartu tema "yang disukai / dikhawatirkan" → komentar mentah tema itu */
  el.querySelectorAll('[data-drill-tema]').forEach((btn) => {
    btn.addEventListener('click', () => openTheme(btn.getAttribute('data-drill-tema')));
  });
  /* "Lihat semua komentar (N)" → seluruh komentar in-universe + filter polaritas */
  const allBtn = el.querySelector('#snt-all-comments');
  if (allBtn) {
    allBtn.addEventListener('click', () => {
      const title = t('sentimen.insight.drill_semua_judul', null, 'Semua komentar') + ` (${fmt.int(comments.length)})`;
      openDrillDrawer(ctx, comments, title, { filter: true });
    });
  }

  /* toggle tema → echarts-theme.js sudah dispose semua chart. Bila disclosure
     terbuka, render ulang sekarang; bila tertutup, tandai perlu render ulang
     saat dibuka berikutnya (instance lama sudah ter-dispose). */
  const onRecharts = () => {
    chartsDrawn = false;
    if (dispo && dispo.open) renderCharts();
  };
  document.addEventListener('pimas:recharts', onRecharts);
  return () => {
    document.removeEventListener('pimas:recharts', onRecharts);
    if (dispo) dispo.removeEventListener('toggle', onToggle);
  };
}

/* resize semua chart-box dalam el (saat disclosure dibuka ulang). */
function resizeCharts(el) {
  el.querySelectorAll('.chart-box').forEach((box) => {
    const inst = window.echarts && window.echarts.getInstanceByDom ? window.echarts.getInstanceByDom(box) : null;
    if (inst) { try { inst.resize(); } catch { /* abaikan */ } }
  });
}

/* ===== chart shell + helpers ===== */

function chartCard(ctx, id, judul, ket) {
  const { esc } = ctx;
  return `<article class="card chart-card">
    <h2 class="display-m" style="margin:0 0 4px;font-size:1.05rem">${esc(judul)}</h2>
    ${ket ? `<p class="cap">${esc(ket)}</p>` : ''}
    <div class="chart-wrap" id="wrap-${id}" style="margin-top:10px"></div>
  </article>`;
}

/* T5 — kartu chart pujian-vs-keluhan dengan legend eksplisit (hijau=pujian /
   merah=keluhan / panjang=porsi suara), label skala sumbu-X, dan caption "cara baca".
   Tanpa ini chart diverging tak terinterpretasi sendiri. */
function themeChartCard(ctx) {
  const { t, esc } = ctx;
  const dot = (cls, label) => `<span class="snt-tema-leg"><span class="snt-tema-dot ${cls}" aria-hidden="true"></span>${esc(label)}</span>`;
  return `<article class="card chart-card snt-tema-card">
    <h2 class="display-m" style="margin:0 0 4px;font-size:1.05rem">${esc(t('sentimen.detail.tema_judul'))}</h2>
    <div class="snt-tema-legend" role="list">
      <span role="listitem">${dot('pos', t('sentimen.detail.tema_legend_hijau', null, 'Hijau — yang dipuji'))}</span>
      <span role="listitem">${dot('neg', t('sentimen.detail.tema_legend_merah', null, 'Merah — yang dikeluhkan'))}</span>
      <span class="snt-tema-leg snt-tema-leg-scale" role="listitem"><span class="snt-tema-bar" aria-hidden="true"></span>${esc(t('sentimen.detail.tema_legend_skala', null, 'Panjang batang — porsi suara'))}</span>
    </div>
    <div class="chart-wrap" id="wrap-tema" style="margin-top:10px"></div>
    <div class="snt-tema-scale cap" aria-hidden="true">${esc(t('sentimen.detail.tema_skala_label', null, 'Porsi suara tertimbang →'))}</div>
    <p class="cap snt-tema-carabaca">${esc(t('sentimen.detail.tema_carabaca', null, 'Batang hijau = dipuji, merah = dikeluhkan; makin panjang makin besar porsi percakapannya.'))}</p>
  </article>`;
}

function setBox(ctx, wrap, chartId, aria, minH, fallbackHtml) {
  if (!wrap) return null;
  if (!ctx.charts.ok) { wrap.innerHTML = ctx.ui.chartFallback(fallbackHtml); return null; }
  wrap.innerHTML = `<div class="chart-box" id="${chartId}" role="img" aria-label="${ctx.esc(aria)}" style="min-height:${minH}px"></div>`;
  return ctx.charts.init(wrap.querySelector('#' + chartId));
}

function senColors(ctx) {
  const tok = ctx.charts.tokens();
  return { pos: tok.ok, neg: tok.warn, neu: tok.text4, track: tok.track, line: tok.line, t2: tok.text2, t3: tok.text3, mono: tok.mono, body: tok.body, chart: tok.chart, accent: tok.accent };
}

/* onSlice(kind): klik irisan → drill-down komentar polaritas itu (pos/neu/neg). */
function drawDonut(ctx, wrap, ov, onSlice) {
  const w = ov.weighted || {};
  const pos = (w.pos || 0), neu = (w.neu || 0), neg = (w.neg || 0);
  const aria = `${ctx.t('sentimen.detail.donut_judul')}: ${ctx.t('sentimen.detail.pos')} ${pctFmt(ctx, pos)}, ${ctx.t('sentimen.detail.neu')} ${pctFmt(ctx, neu)}, ${ctx.t('sentimen.detail.neg')} ${pctFmt(ctx, neg)}`;
  const fb = `${ctx.t('sentimen.detail.pos')} ${pctFmt(ctx, pos)} · ${ctx.t('sentimen.detail.neu')} ${pctFmt(ctx, neu)} · ${ctx.t('sentimen.detail.neg')} ${pctFmt(ctx, neg)}`;
  const c = setBox(ctx, wrap, 'chart-donut', aria, 200, fb);
  if (!c) return;
  const col = senColors(ctx);
  c.setOption({
    ...ctx.charts.ANIM,
    tooltip: { trigger: 'item', formatter: (p) => `${p.name}: ${Math.round(p.percent)}%` },
    legend: { bottom: 0, icon: 'circle', itemWidth: 8 },
    series: [{
      type: 'pie', radius: ['58%', '82%'], center: ['50%', '46%'], avoidLabelOverlap: false,
      cursor: onSlice ? 'pointer' : 'default',
      label: { show: true, position: 'center', formatter: () => `${Math.round(pos * 100)}%`, fontSize: 22, fontWeight: 700, color: col.t2 },
      labelLine: { show: false },
      data: [
        { value: +(pos * 100).toFixed(1), name: ctx.t('sentimen.detail.pos'), kind: 'pos', itemStyle: { color: col.pos } },
        { value: +(neu * 100).toFixed(1), name: ctx.t('sentimen.detail.neu'), kind: 'neu', itemStyle: { color: col.neu } },
        { value: +(neg * 100).toFixed(1), name: ctx.t('sentimen.detail.neg'), kind: 'neg', itemStyle: { color: col.neg } },
      ],
    }],
  });
  if (onSlice) {
    c.off('click');
    c.on('click', (p) => { const k = p.data && p.data.kind; if (k) onSlice(k); });
  }
}

/* onSeg(kind): klik segmen (pos/neu/neg) → drill-down komentar polaritas itu. */
function drawRawVsWeighted(ctx, wrap, ov, onSeg) {
  const r = ov.raw || {}, w = ov.weighted || {};
  const cats = [ctx.t('sentimen.detail.mentah'), ctx.t('sentimen.detail.tertimbang')];
  const aria = `${ctx.t('sentimen.detail.rawvsweighted_judul')}: ${ctx.t('sentimen.detail.mentah')} ${ctx.t('sentimen.detail.pos')} ${pctFmt(ctx, r.pos)}; ${ctx.t('sentimen.detail.tertimbang')} ${ctx.t('sentimen.detail.pos')} ${pctFmt(ctx, w.pos)}`;
  const fb = `${ctx.t('sentimen.detail.mentah')}: +${pctFmt(ctx, r.pos)} / −${pctFmt(ctx, r.neg)} · ${ctx.t('sentimen.detail.tertimbang')}: +${pctFmt(ctx, w.pos)} / −${pctFmt(ctx, w.neg)}`;
  const c = setBox(ctx, wrap, 'chart-rvw', aria, 150, fb);
  if (!c) return;
  const col = senColors(ctx);
  const pct = (x) => +(((x || 0) * 100)).toFixed(1);
  const mk = (name, color, key) => ({ name, type: 'bar', stack: 'x', barWidth: 26, cursor: onSeg ? 'pointer' : 'default', itemStyle: { color }, data: [pct(r[key]), pct(w[key])], label: { show: true, formatter: (p) => (p.value >= 8 ? p.value + '%' : ''), color: '#fff', fontSize: 10 } });
  const segKinds = ['pos', 'neu', 'neg']; /* urutan series = urutan map klik */
  c.setOption({
    ...ctx.charts.ANIM,
    grid: { left: 4, right: 8, top: 6, bottom: 24, containLabel: true },
    legend: { bottom: 0, icon: 'circle', itemWidth: 8 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps) => ps.map((p) => `${p.seriesName}: ${p.value}%`).join('<br/>') },
    xAxis: { type: 'value', max: 100, show: false },
    yAxis: { type: 'category', data: cats, axisLabel: { color: col.t2, fontFamily: col.body, fontWeight: 600 } },
    series: [mk(ctx.t('sentimen.detail.pos'), col.pos, 'pos'), mk(ctx.t('sentimen.detail.neu'), col.neu, 'neu'), mk(ctx.t('sentimen.detail.neg'), col.neg, 'neg')],
  });
  if (onSeg) {
    c.off('click');
    c.on('click', (p) => { const k = segKinds[p.seriesIndex]; if (k) onSeg(k); });
  }
}

/* onBar(platform): klik bar → drill-down komentar dari platform itu. */
function drawPlatforms(ctx, wrap, perPlatform, onBar) {
  const entries = Object.entries(perPlatform || {});
  if (!entries.length) { if (wrap) wrap.innerHTML = ctx.ui.empty('empty.sentimen.detail'); return; }
  const rows = entries.map(([p, blk]) => ({ platform: p, label: `${p} (${blk.tier})`, mu: blk.weighted ? blk.weighted.mu : null, n_eff: blk.n_eff }));
  const aria = `${ctx.t('sentimen.detail.platform_judul')}: ${rows.map((r) => `${r.label} ${muFmt(ctx, r.mu)} (n_eff ${ctx.fmt.dec(r.n_eff, 1)})`).join('; ')}`;
  const fb = rows.map((r) => `${r.label}: <span class="num">${ctx.esc(muFmt(ctx, r.mu))}</span> (n_eff ${ctx.esc(ctx.fmt.dec(r.n_eff, 1))})`).join('<br>');
  const c = setBox(ctx, wrap, 'chart-plat', aria, Math.max(120, rows.length * 44 + 20), fb);
  if (!c) return;
  const col = senColors(ctx);
  c.setOption({
    ...ctx.charts.ANIM,
    grid: { left: 8, right: 60, top: 6, bottom: 6, containLabel: true },
    tooltip: { trigger: 'item', formatter: (p) => `${rows[p.dataIndex].label}<br/>μ ${muFmt(ctx, rows[p.dataIndex].mu)} · n_eff ${ctx.fmt.dec(rows[p.dataIndex].n_eff, 1)}` },
    xAxis: { type: 'value', min: -1, max: 1, axisLabel: { color: col.t3, fontFamily: col.mono }, splitLine: { lineStyle: { color: col.line, opacity: 0.5 } } },
    yAxis: { type: 'category', inverse: true, data: rows.map((r) => r.label), axisLabel: { color: col.t2, fontFamily: col.body, fontWeight: 600 } },
    series: [{
      type: 'bar', barWidth: 16,
      cursor: onBar ? 'pointer' : 'default',
      data: rows.map((r) => ({ value: r.mu == null ? 0 : +r.mu.toFixed(3), itemStyle: { color: (r.mu || 0) >= 0 ? col.pos : col.neg, borderRadius: 3 } })),
      markLine: { silent: true, symbol: 'none', lineStyle: { color: col.t3, type: 'dashed', width: 1 }, data: [{ xAxis: 0 }] },
      label: { show: true, position: 'right', formatter: (p) => muFmt(ctx, rows[p.dataIndex].mu) + ' · n' + ctx.fmt.dec(rows[p.dataIndex].n_eff, 0), color: col.t2, fontFamily: col.mono, fontSize: 10.5 },
    }],
  });
  if (onBar) {
    c.off('click');
    c.on('click', (p) => { const r = rows[p.dataIndex]; if (r) onBar(r.platform); });
  }
}

/* warna RGBA dari token hex + alpha (untuk meredam tema ber-polaritas-lemah). Token
   kita berupa hex (#rrggbb) → konversi; gagal-parse → kembalikan warna apa adanya. */
function rgbaFromToken(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/* T5 — Pujian vs keluhan utama: diverging-bar yang TIDAK menyembunyikan dualitas tema.
   • panjang batang = share_w (porsi suara tertimbang yang menyinggung tema).
   • sisi/warna = bucket pujian (hijau, kanan) vs keluhan (merah, kiri).
   • intensitas warna ∝ |polarity_w| — tema yang nyaris netral (mis. "tekstur"
     polarity_w≈−0,06: ada sisi positif "renyah" tersembunyi) tampil REDUP + ditandai
     "(campur)" supaya tak terbaca sebagai murni negatif. Tema kuat-arah tampil pekat.
   onBar(label): klik bar → drill-down komentar tema itu (verifikasi mentah). */
function drawThemes(ctx, wrap, themes, onBar) {
  const { t, esc, fmt } = ctx;
  const praises = (themes && themes.top_praises) || [];
  const complaints = (themes && themes.top_complaints) || [];
  /* polW: net polaritas tema (−1..+1) bila ada; null bila tak tersedia (jangan karang). */
  const mkRow = (x, kind) => ({
    label: x.label,
    share: x.share_w || 0,
    value: (kind === 'pos' ? 1 : -1) * (x.share_w || 0),
    polW: (typeof x.polarity_w === 'number' && Number.isFinite(x.polarity_w)) ? x.polarity_w : null,
    kind,
  });
  const rows = [
    ...complaints.map((x) => mkRow(x, 'neg')),
    ...praises.map((x) => mkRow(x, 'pos')),
  ];
  if (!rows.length) { if (wrap) wrap.innerHTML = ctx.ui.empty('empty.sentimen.detail'); return; }
  rows.sort((a, b) => a.value - b.value);
  /* tema dianggap "campur" bila net polaritasnya lemah (|polW|<0,15) meski masuk satu
     bucket — sinyal jujur bahwa ada sisi berlawanan di dalamnya. */
  const isMixed = (r) => r.polW !== null && Math.abs(r.polW) < 0.15;
  const labelTone = (r) => (r.kind === 'pos' ? t('sentimen.detail.kutipan_positif') : t('sentimen.detail.kutipan_negatif'))
    + (isMixed(r) ? ` (${t('sentimen.detail.tema_campur', null, 'campur')})` : '');
  const aria = `${t('sentimen.detail.tema_judul')}: ${rows.map((r) => `${r.label} ${fmt.persen(r.share * 100)} ${labelTone(r)}`).join('; ')}`;
  const fb = rows.map((r) => `${esc(r.label)}: <span class="num">${esc(fmt.persen(r.share * 100))}</span> ${r.kind === 'pos' ? '👍' : '👎'}${isMixed(r) ? ` <span class="cap">(${esc(t('sentimen.detail.tema_campur', null, 'campur'))})</span>` : ''}`).join('<br>');
  const c = setBox(ctx, wrap, 'chart-tema', aria, Math.max(120, rows.length * 34 + 20), fb);
  if (!c) return;
  const col = senColors(ctx);
  /* opacity menurun saat polaritas lemah: kuat-arah (|polW|≥0,4)→1; netral→~0,42.
     polW null (tak ada data arah) → solid (jangan meredam tanpa dasar). */
  const opacityFor = (r) => (r.polW === null ? 1 : Math.max(0.42, Math.min(1, 0.42 + 0.58 * Math.min(1, Math.abs(r.polW) / 0.4))));
  c.setOption({
    ...ctx.charts.ANIM,
    grid: { left: 8, right: 40, top: 6, bottom: 6, containLabel: true },
    tooltip: {
      trigger: 'item',
      formatter: (p) => {
        const r = rows[p.dataIndex];
        const arah = r.kind === 'pos' ? t('sentimen.detail.kutipan_positif') : t('sentimen.detail.kutipan_negatif');
        const mix = isMixed(r) ? ` · ${t('sentimen.detail.tema_campur_tip', null, 'arah campur — ada sisi sebaliknya')}` : '';
        const polLine = r.polW === null ? '' : `<br/>${t('sentimen.detail.tema_arah_tip', null, 'arah')} ${muFmt(ctx, r.polW)}${mix}`;
        return `${esc(r.label)}<br/>${t('sentimen.detail.tema_share_tip', null, 'porsi suara')} ${fmt.persen(r.share * 100)} · ${arah}${polLine}`;
      },
    },
    xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { show: false }, axisLine: { show: false } },
    yAxis: { type: 'category', data: rows.map((r) => r.label), axisLabel: { color: col.t2, fontFamily: col.body, fontWeight: 600 }, axisLine: { lineStyle: { color: col.line } } },
    series: [{
      type: 'bar', barWidth: 14,
      cursor: onBar ? 'pointer' : 'default',
      data: rows.map((r) => ({
        value: +(r.value * 100).toFixed(1),
        itemStyle: { color: rgbaFromToken(r.kind === 'pos' ? col.pos : col.neg, opacityFor(r)), borderRadius: 3 },
      })),
      markLine: { silent: true, symbol: 'none', lineStyle: { color: col.t3, type: 'dashed', width: 1 }, data: [{ xAxis: 0 }] },
      label: { show: true, position: (p) => (p.value < 0 ? 'left' : 'right'), formatter: (p) => Math.abs(p.value) + '%', color: col.t3, fontFamily: col.mono, fontSize: 10 },
    }],
  });
  if (onBar) {
    c.off('click');
    c.on('click', (p) => { const r = rows[p.dataIndex]; if (r) onBar(r.label); });
  }
}

/* onPoint(comment): klik titik → drawer komentar persis itu. Bila `comments`
   tersedia, titik dibangun 1:1 dari komentar (engagement×polaritas) → tooltip
   menampilkan teks komentar + klik membuka komentarnya. Tanpa komentar → fallback
   ke array `scatter` lama (tanpa teks/klik). */
function drawScatter(ctx, wrap, scatter, comments, onPoint) {
  /* sumber utama: komentar in-universe (mapping eksak). engagement → angka via engNum. */
  const fromComments = (Array.isArray(comments) ? comments : [])
    .map((c) => ({ x: engNum(c), y: polNum(c.polaritas), comment: c }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const useComments = fromComments.length > 0;
  const pts = useComments
    ? fromComments
    : (scatter || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!pts.length) { if (wrap) wrap.innerHTML = ctx.ui.empty('empty.sentimen.detail'); return; }
  const aria = `${ctx.t('sentimen.detail.scatter_judul')}: ${pts.length} komentar; sumbu-x engagement (skala log), sumbu-y polaritas −1 sampai +1; titik makin besar = engagement makin tinggi`;
  const fb = `${pts.length} komentar — visual butuh grafik; lihat ringkasan & per-platform.`;
  const c = setBox(ctx, wrap, 'chart-scatter', aria, 240, fb);
  if (!c) return;
  const col = senColors(ctx);
  const interactive = useComments && !!onPoint;
  const maxX = Math.max(...pts.map((p) => p.x), 1);
  /* MINOR: deterministik jitter agar titik ber-koordinat sama (mis. 39 komentar
     engagement=0 → semua di x=0) tak menumpuk persis sehingga tiap komentar tetap
     bisa diklik. Hitung dulu jumlah anggota per koordinat (round) supaya amplitudo
     menyesuaikan kepadatan; lalu sebar simetris di sekitar x. Jitter HANYA kosmetik —
     tooltip & engagement asli (engX) tak terpengaruh. */
  const coordKey = (lx, ly) => lx.toFixed(3) + '|' + ly.toFixed(2);
  const counts = new Map();
  pts.forEach((p) => { const k = coordKey(Math.log10(1 + p.x), p.y); counts.set(k, (counts.get(k) || 0) + 1); });
  const seen = new Map();
  const data = pts.map((p) => {
    const lx = Math.log10(1 + p.x);
    const k = coordKey(lx, p.y);
    const total = counts.get(k) || 1;
    const idx = seen.get(k) || 0; seen.set(k, idx + 1);
    let jx = 0;
    if (total > 1) {
      /* sebar [−span..+span] merata; span tumbuh dengan kepadatan (maks 0,55 unit-log)
         supaya cluster padat (engagement rendah) terbaca sebagai sebaran, bukan satu
         titik — tiap komentar dapat koordinat unik → tetap bisa diklik. */
      const span = Math.min(0.55, 0.05 + total * 0.018);
      jx = total === 1 ? 0 : (idx / (total - 1) - 0.5) * 2 * span;
    }
    return {
      value: [lx + jx, p.y],
      symbolSize: 6 + 16 * (lx / Math.log10(1 + maxX)),
      itemStyle: { color: p.y > 0 ? col.pos : p.y < 0 ? col.neg : col.neu, opacity: 0.6 },
      comment: p.comment || null,
      engX: p.x, /* engagement asli untuk tooltip (jitter hanya kosmetik) */
    };
  });
  c.setOption({
    ...ctx.charts.ANIM,
    grid: { left: 8, right: 12, top: 10, bottom: 28, containLabel: true },
    tooltip: {
      trigger: 'item',
      formatter: (p) => {
        const engVal = (p.data && typeof p.data.engX === 'number') ? p.data.engX : Math.round(Math.pow(10, p.value[0]) - 1);
        const head = `engagement ≈ ${ctx.fmt.int(Math.round(engVal))} · polaritas ${ctx.fmt.dec(p.value[1], 2)}`;
        const cm = p.data && p.data.comment;
        const txt = cm && cm.text ? `<div style="max-width:240px;white-space:normal;color:var(--text-1);margin-bottom:4px">${ctx.esc(String(cm.text).slice(0, 160))}</div>` : '';
        return `${txt}${head}`;
      },
    },
    xAxis: { type: 'value', name: 'engagement (log)', nameLocation: 'middle', nameGap: 22, nameTextStyle: { color: col.t3, fontFamily: col.body, fontSize: 10 }, axisLabel: { color: col.t3, fontFamily: col.mono, formatter: (x) => ctx.fmt.compact(Math.round(Math.pow(10, x) - 1)) }, splitLine: { show: false } },
    yAxis: { type: 'value', min: -1, max: 1, interval: 0.5, axisLabel: { color: col.t3, fontFamily: col.mono }, splitLine: { lineStyle: { color: col.line, opacity: 0.4 } } },
    series: [{ type: 'scatter', data, cursor: interactive ? 'pointer' : 'default' }],
  });
  if (interactive) {
    c.off('click');
    c.on('click', (p) => { const cm = p.data && p.data.comment; if (cm) onPoint(cm); });
  }
}

/* onPeriod(period): klik titik periode → drill-down komentar bulan itu. */
function drawTrend(ctx, wrap, temporal, onPeriod) {
  const buckets = (temporal && temporal.buckets) || [];
  if (!temporal || temporal.trend === null || buckets.length < 2) {
    if (wrap) wrap.innerHTML = `<div class="empty"><p class="e-kenapa">${ctx.esc(ctx.t('empty.sentimen.detail.kenapa'))}</p></div>`;
    return;
  }
  const periods = buckets.map((b) => b.period);
  const mus = buckets.map((b) => (b.mu_w == null ? null : b.mu_w));
  const aria = `${ctx.t('sentimen.detail.tren_judul')}: ${buckets.map((b) => `${b.period} ${muFmt(ctx, b.mu_w)}`).join('; ')}`;
  const fb = buckets.map((b) => `${b.period}: <span class="num">${ctx.esc(muFmt(ctx, b.mu_w))}</span>`).join('<br>');
  const c = setBox(ctx, wrap, 'chart-tren', aria, 180, fb);
  if (!c) return;
  const col = senColors(ctx);
  c.setOption({
    ...ctx.charts.ANIM,
    grid: { left: 8, right: 12, top: 10, bottom: 24, containLabel: true },
    tooltip: { trigger: 'axis', formatter: (ps) => `${ps[0].axisValue}<br/>μ ${muFmt(ctx, ps[0].value)}` },
    xAxis: { type: 'category', data: periods, axisLabel: { color: col.t3, fontFamily: col.mono, fontSize: 10 }, triggerEvent: !!onPeriod },
    yAxis: { type: 'value', min: -1, max: 1, interval: 0.5, axisLabel: { color: col.t3, fontFamily: col.mono }, splitLine: { lineStyle: { color: col.line, opacity: 0.4 } } },
    series: [{ type: 'line', data: mus, connectNulls: false, smooth: true, cursor: onPeriod ? 'pointer' : 'default', symbolSize: onPeriod ? 9 : 6, lineStyle: { width: 2, color: col.chart }, itemStyle: { color: col.chart }, areaStyle: { color: 'rgba(0,0,0,0)' }, markLine: { silent: true, symbol: 'none', lineStyle: { color: col.t3, type: 'dashed', width: 1 }, data: [{ yAxis: 0 }] } }],
  });
  if (onPeriod) {
    c.off('click');
    c.on('click', (p) => {
      /* klik titik garis (dataIndex) ATAU label sumbu-x (value) */
      let period = null;
      if (p.componentType === 'series' && typeof p.dataIndex === 'number') period = periods[p.dataIndex];
      else if (p.componentType === 'xAxis') period = p.value;
      if (period != null) onPeriod(period);
    });
  }
}

/* ===== quotes + limitations ===== */

function quoteCard(ctx, q, kind) {
  const { esc, fmt, ui } = ctx;
  const eng = q.engagement || {};
  const engStr = typeof eng.likes === 'number' ? `♥ ${fmt.compact(eng.likes)}`
    : Number.isInteger(eng.stars) ? `★ ${eng.stars}/5`
      : typeof eng.helpful === 'number' ? `👍 ${fmt.compact(eng.helpful)}` : '';
  const src = ui.sourceLink({ sumber: q.platform, url: q.url, tanggal_akses: q.date });
  return `<figure class="snt-quote ${kind}">
    <blockquote>${esc(String(q.text || '').slice(0, 240))}</blockquote>
    <figcaption>${ui.tierChip(q.tier)} <span class="sq-plat">${esc(q.platform || '')}</span>${engStr ? ` · <span class="sq-eng">${esc(engStr)}</span>` : ''} · ${src}</figcaption>
  </figure>`;
}

function quotesHtml(ctx, quotes) {
  const { t, ui } = ctx;
  const pos = (quotes && quotes.positif) || [];
  const neg = (quotes && quotes.negatif) || [];
  if (!pos.length && !neg.length) return `<div class="card">${ui.empty('empty.sentimen.detail')}</div>`;
  const col = (title, arr, kind) => `<div class="sent-qcol">
    <div class="eyebrow">${ctx.esc(title)}</div>
    ${arr.length ? arr.map((q) => quoteCard(ctx, q, kind)).join('') : `<p class="cap">${ctx.esc(t('umum.kosong'))}</p>`}
  </div>`;
  return `<div class="sent-quotes-grid">
    ${col(t('sentimen.detail.kutipan_positif'), pos, 'pos')}
    ${col(t('sentimen.detail.kutipan_negatif'), neg, 'neg')}
  </div>`;
}

function limitationsHtml(ctx, s) {
  const { esc } = ctx;
  const lims = s.limitations || [];
  const det = s.limitations_detail || {};
  if (!lims.length) return `<p class="cap">—</p>`;
  return `<ul class="sent-lim-list">${lims.map((k) => `<li><span class="badge plain">${esc(k)}</span> ${esc(det[k] || '')}</li>`).join('')}</ul>`;
}

export function render(el, ctx) {
  if (ctx.route && ctx.route.slug) return renderDetail(el, ctx, ctx.route.slug);
  return renderList(el, ctx);
}
