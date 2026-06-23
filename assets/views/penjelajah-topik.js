/*
 * View: Penjelajah Topik (Topic Explorer) — DESIGN tokens + komponen bersama.
 * List: formulir front-door MULTIUSER (login-gated, POST ke Cloudflare Worker
 * /topik-submit) untuk mengantrekan topik riset bebas + status live antrean +
 * galeri kartu topik terbit. Detail: ringkasan + skala pasar TAM/SAM/SOM + gap +
 * pemain (ID & luar) + kompetisi + momentum & potensi + produk ditemukan (link ke
 * #/peluang/<id>) + limitasi + sumber + laporan naratif.
 *
 * Data: ctx.data.topic_explorer {list, detail, submit}. KIRIM: submit
 * {enabled, worker_url, submit_key} — kunci enqueue ber-privilese rendah (BUKAN PAT)
 * di blob VIEWER terenkripsi → terbaca SEMUA pengguna login (gate multiuser).
 * Progres = data-poll murni (status/progress dari list[], re-fetch viewer ~30s) —
 * BUKAN GitHub Actions API (autorun lokal tak punya run untuk dipoll).
 */

const QUEUED_KEY = 'pimas.topik.queued';
/* Antrean LOKAL persisten (localStorage) — bertahan lintas reload & tutup-tab, jadi
   pengguna SELALU lihat topiknya tersimpan & sedang diproses → tak lupa & tak kirim
   ulang topik yang sama. Bentuk: { [slug]: { topic, at } }. */
const PENDING_KEY = 'pimas.topik.pending';
function readPending() {
  try { const o = JSON.parse(localStorage.getItem(PENDING_KEY) || '{}'); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; } catch { return {}; }
}
function writePending(o) { try { localStorage.setItem(PENDING_KEY, JSON.stringify(o)); } catch { /* abaikan */ } }
function addPending(slug, topic) { if (!slug) return; const o = readPending(); o[slug] = { topic: topic || slug, at: Date.now() }; writePending(o); }
/* buang entri pending yang HASILNYA sudah muncul di daftar terbit (slug ada di list) atau
   yang basi (>48 jam — autorun lokal bisa menunggu PC owner nyala). */
function reconcilePending(list) {
  const o = readPending(); const have = new Set((list || []).map((x) => x && x.slug)); let changed = false; const now = Date.now();
  for (const s of Object.keys(o)) { if (have.has(s) || (now - (o[s].at || 0)) > 172800000) { delete o[s]; changed = true; } }
  if (changed) writePending(o);
  return o;
}

function slugify(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

/* ============================================================ Status ======= */

/* peta status item → chip tone + simbol + label string. status data-driven dari
   topic-index.json (queued | running | done | failed | done-partial). */
const STATUS_TONE = { queued: 'note', running: 'tip', done: 'ok', 'done-partial': 'note', failed: 'warn' };
const STATUS_SYM = { queued: '◌', running: '◐', done: '●', 'done-partial': '◑', failed: '✕' };

function statusChip(ctx, status) {
  const { esc, t } = ctx;
  const code = STATUS_TONE[status] ? status : 'queued';
  const tone = STATUS_TONE[code];
  const sym = STATUS_SYM[code] || '◌';
  return `<span class="sp-chip ${tone}">${sym} ${esc(t('penjelajah_topik.queue.status_' + code.replace('-', '_'), null, code))}</span>`;
}

/* baris progres live untuk topik yang BELUM selesai (queued/running). Spinner +
   bar pct (determinate bila progress.pct ada, else indeterminate) + label fase. */
function progressRowHtml(ctx, it) {
  const { esc, t } = ctx;
  const p = (it && it.progress && typeof it.progress === 'object') ? it.progress : {};
  const pct = (typeof p.pct === 'number' && isFinite(p.pct)) ? Math.max(0, Math.min(100, p.pct)) : null;
  const phase = p.message || p.phase || '';
  const running = it.status === 'running';
  const bar = pct === null
    ? `<div class="sp-bar" aria-hidden="true"><i></i></div>`
    : `<div class="sp-bar" aria-hidden="true"><i style="left:0;width:${pct}%;animation:none"></i></div>`;
  return `<div class="card"><div class="sent-progress" role="status" aria-live="polite">
    <div class="sp-head">${running ? '<span class="spinner"></span>' : ''}<span>${esc(it.topic || it.slug)}</span>${statusChip(ctx, it.status)}</div>
    ${bar}
    <div class="sp-meta"><span class="sp-stage">${esc(phase || t('penjelajah_topik.queue.menunggu', null, 'Menunggu giliran'))}</span>${pct === null ? '' : `<span class="sp-elapsed mono">${esc(String(Math.round(pct)))}%</span>`}</div>
  </div></div>`;
}

/* kartu "Sedang diproses" untuk topik yang BARU dikirim & belum muncul di index. */
function pendingCardHtml(ctx, slug, info) {
  const { esc, t } = ctx;
  return `<div class="card sent-card sent-card-pending" data-pending="${esc(slug)}">
    <div class="sent-card-head">
      <div class="sent-card-name">${esc((info && info.topic) || slug)}</div>
      <div class="sent-card-date">${esc(t('penjelajah_topik.queue.baru_dikirim', null, 'baru dikirim'))}</div>
    </div>
    <div class="sent-card-badges"><span class="badge plain"><span class="spinner spinner-sm" aria-hidden="true"></span> ${esc(t('penjelajah_topik.queue.sedang_diproses', null, 'Masuk antrean'))}</span></div>
    <div class="sent-card-meta"><span class="cap">${esc(t('penjelajah_topik.queue.pending_ket', null, 'Tersimpan & masuk antrean — riset jalan saat PC pengelola menyala; hasil muncul di sini saat selesai.'))}</span></div>
  </div>`;
}

/* ============================================================ Trigger ====== */

/* fireTrigger — front-door MULTIUSER: POST ke Cloudflare Worker /topik-submit
   (BUKAN api.github.com), TANPA PAT di browser. Satu-satunya kredensial = submit_key
   ber-privilese rendah (enqueue-only, rate-limited di Worker) yang hidup di blob
   VIEWER terenkripsi. Worker yang men-derive slug + commit request. Mengembalikan
   body Worker {ok, slug, queued, rerun, message}. */
async function fireTrigger(ctx, payload) {
  const sub = ctx.data && ctx.data.topic_explorer && ctx.data.topic_explorer.submit;
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
        submit_key: sub.submit_key,
        topic: payload.topic,
        depth: payload.depth || 'standard',
      }),
    });
  } catch { const e = new Error('network'); e.code = 'HTTP'; throw e; }
  let body = null;
  try { body = await res.json(); } catch { /* tolerate empty/non-JSON */ }
  if (res.ok && body && body.ok) return body; // {ok, slug, queued, rerun, message}
  if (res.status === 401 || res.status === 403) { const e = new Error('key'); e.code = 'TOKEN'; throw e; }
  if (res.status === 429) { const e = new Error('rate'); e.code = 'RATE'; throw e; }
  const e = new Error((body && body.message) || ('HTTP ' + res.status)); e.code = 'HTTP'; throw e;
}

function triggerFormHtml(ctx) {
  const { t, esc } = ctx;
  return `
  <form id="tp-form" class="sent-form" novalidate>
    <label class="field">
      <span>${esc(t('penjelajah_topik.form.topik_label'))}</span>
      <span class="cap sf-hint">${esc(t('penjelajah_topik.form.topik_ket', null, ''))}</span>
      <textarea class="input" id="tp-topik" rows="2" maxlength="280" style="height:auto;min-height:64px;padding:11px 13px;line-height:1.5;resize:vertical" placeholder="${esc(t('penjelajah_topik.form.topik_ph'))}" autocapitalize="none" spellcheck="false" required></textarea>
      <span class="cap sf-hint">${esc(t('penjelajah_topik.form.topik_limit', null, 'Maksimal 280 karakter.'))}</span>
    </label>
    <label class="field" style="max-width:360px">
      <span>${esc(t('penjelajah_topik.form.depth_label'))}</span>
      <select class="select" id="tp-depth">
        <option value="standard" selected>${esc(t('penjelajah_topik.form.depth_standard'))}</option>
        <option value="shallow">${esc(t('penjelajah_topik.form.depth_shallow'))}</option>
        <option value="deep">${esc(t('penjelajah_topik.form.depth_deep'))}</option>
      </select>
      <span class="cap sf-hint">${esc(t('penjelajah_topik.form.depth_ket', null, ''))}</span>
    </label>
    <div id="tp-rerun" class="sf-rerun" role="note" aria-live="polite" hidden></div>
    <button class="cta" type="submit" id="tp-go">${esc(t('penjelajah_topik.form.tombol'))}</button>
    <div id="tp-msg" role="status" aria-live="polite"></div>
  </form>`;
}

function bindTriggerForm(root, ctx, timers, opts = {}) {
  const { t, esc, fmt } = ctx;
  /* list terkini: getList() bila disediakan (mengikuti currentList renderList yg
     diperbarui poll), else snapshot dari ctx.data saat bind. */
  const getList = typeof opts.getList === 'function'
    ? opts.getList
    : () => { const td = ctx.data && ctx.data.topic_explorer; return (td && Array.isArray(td.list)) ? td.list : []; };
  const noteEl = root.querySelector('#tp-rerun');
  const goBtn = root.querySelector('#tp-go');
  const baseLabel = t('penjelajah_topik.form.tombol');

  const findMatch = (val) => {
    const slug = slugify(val);
    if (!slug) return null;
    return getList().find((it) => it && it.slug === slug) || null;
  };
  /* RE-RUN / PENDING AWARENESS: saat user mengetik, cek apakah slug-nya sudah
     diriset (list) atau sedang diproses (pending). Murni UI — submit memanggil
     fireTrigger sama; runner menggabung permintaan slug yang sama (run_count++). */
  const onTopikInput = () => {
    const input = root.querySelector('#tp-topik');
    if (!input || !noteEl || !goBtn) return;
    const match = findMatch(input.value);
    if (match) {
      const tgl = match.date ? fmt.tanggal(match.date) : '';
      noteEl.hidden = false;
      noteEl.innerHTML = `<span class="sf-rerun-ico" aria-hidden="true">↻</span><span>${esc(t('penjelajah_topik.form.rerun_note', { tanggal: tgl }, 'Topik serupa sudah diriset — {tanggal}. Menjalankan ulang akan MEMPERBARUI laporannya.'))}</span>`;
      goBtn.textContent = t('penjelajah_topik.form.tombol_perbarui', null, 'Perbarui riset topik');
      return;
    }
    const pslug = slugify(input.value);
    const pend = readPending();
    if (pslug && pend[pslug]) {
      noteEl.hidden = false;
      noteEl.innerHTML = `<span class="sf-rerun-ico" aria-hidden="true">⏳</span><span>${esc(t('penjelajah_topik.form.sedang_diproses_note', null, 'Topik ini sedang diproses (kamu baru mengirimnya) — tak perlu kirim ulang; pantau di antrean bawah.'))}</span>`;
      goBtn.textContent = baseLabel;
      return;
    }
    if (!noteEl.hidden) { noteEl.hidden = true; noteEl.innerHTML = ''; }
    goBtn.textContent = baseLabel;
  };
  const topikInput = root.querySelector('#tp-topik');
  if (topikInput) topikInput.addEventListener('input', onTopikInput);

  root.querySelector('#tp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = root.querySelector('#tp-go');
    const msg = root.querySelector('#tp-msg');
    const topic = root.querySelector('#tp-topik').value.trim();
    const depth = root.querySelector('#tp-depth').value;
    const slug = slugify(topic);
    if (!slug) { msg.innerHTML = `<div class="callout warn"><p>${esc(t('penjelajah_topik.form.topik_kosong', null, 'Ketik dulu topik riset yang ingin dijelajahi.'))}</p></div>`; return; }
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ${esc(t('penjelajah_topik.form.mengirim'))}`;
    msg.innerHTML = '';
    try {
      /* Worker = otoritas slugifikasi → pakai conf.slug untuk tracking
         (fallback ke slug sisi-klien bila respons tak memuatnya). */
      const conf = await fireTrigger(ctx, { topic: topic.slice(0, 280), depth });
      const finalSlug = (conf && conf.slug) || slug;
      addPending(finalSlug, topic); /* localStorage persisten → kartu "Masuk antrean" (anti-lupa/anti-dobel) */
      try { sessionStorage.setItem(QUEUED_KEY, JSON.stringify({ slug: finalSlug, topic, at: Date.now() })); } catch { /* abaikan */ }
      renderQueue(root, ctx, getList()); /* segarkan antrean SEKARANG tanpa reload (pending baru + item index yg ada) */
      if (typeof opts.onSubmitted === 'function') opts.onSubmitted(); /* mulai polling live bila belum jalan */
      msg.innerHTML = `<div class="callout ok"><p>${esc(t('penjelajah_topik.form.queued', { topik: topic }, 'Topik "{topik}" masuk antrean. Riset jalan saat PC pengelola menyala; hasil muncul otomatis di antrean & galeri di bawah.'))}</p></div>`;
      root.querySelector('#tp-topik').value = '';
    } catch (err) {
      let pesan = err && err.message;
      if (err && err.code === 'TOKEN') pesan = t('penjelajah_topik.error.key_invalid', null, 'Akses kirim sudah tidak berlaku — pengelola perlu memperbarui kunci kirim dashboard.');
      else if (err && err.code === 'RATE') pesan = t('penjelajah_topik.error.rate_limited', null, 'Terlalu banyak permintaan dari sesi ini. Coba lagi beberapa menit.');
      else pesan = t('penjelajah_topik.error.kirim', { pesan }, 'Topik gagal dikirim: {pesan}. Coba lagi sebentar.');
      msg.innerHTML = `<div class="callout warn"><p>${esc(pesan)}</p></div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = baseLabel;
      onTopikInput();
    }
  });
}

/* ============================================================ Queue ======== */

/* renderQueue — render/segarkan blok antrean live (#tp-queue): topik pending lokal
   (baru dikirim) + topik queued/running dari index, sebagai baris progres. Topik
   selesai TIDAK di sini (mereka jadi kartu galeri). list = sumber kebenaran terkini
   (diteruskan eksplisit dari poll agar tak baca ctx.data yang basi pasca-reload). */
function renderQueue(root, ctx, list) {
  const wrap = root.querySelector('#tp-queue');
  if (!wrap) return;
  const rowsList = Array.isArray(list) ? list : [];
  const active = rowsList.filter((it) => it && (it.status === 'queued' || it.status === 'running'))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const activeSlugs = new Set(active.map((it) => it.slug));
  const pend = reconcilePending(rowsList);
  const pendSlugs = Object.keys(pend)
    .filter((s) => !activeSlugs.has(s) && !rowsList.some((x) => x && x.slug === s))
    .sort((a, b) => (pend[b].at || 0) - (pend[a].at || 0));

  if (!active.length && !pendSlugs.length) {
    wrap.innerHTML = '';
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const rows = active.map((it) => progressRowHtml(ctx, it)).join('');
  const pendCards = pendSlugs.length ? `<div class="snt-grid">${pendSlugs.map((s) => pendingCardHtml(ctx, s, pend[s])).join('')}</div>` : '';
  wrap.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">${rows}</div>${pendCards ? `<div style="margin-top:12px">${pendCards}</div>` : ''}`;
}

/* ============================================================ List ========= */

function renderList(el, ctx) {
  const { t, esc, fmt, ui } = ctx;
  const td = ctx.data && ctx.data.topic_explorer;
  const list = (td && Array.isArray(td.list)) ? td.list.slice() : [];
  const published = list.filter((it) => it && (it.status === 'done' || it.status === 'done-partial'))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const sub = td && td.submit;
  let triggerBlock;
  if (sub && sub.enabled) {
    triggerBlock = triggerFormHtml(ctx);
  } else {
    triggerBlock = `<div class="callout note">
      <div class="co-title">◌ ${esc(t('penjelajah_topik.form.disabled_judul'))}</div>
      <p>${esc(t('penjelajah_topik.form.disabled_pesan'))}</p></div>`;
  }

  el.innerHTML = `
  <header class="pagehead">
    <div>
      <div class="eyebrow">${esc(t('penjelajah_topik.eyebrow'))}</div>
      <h1 class="display-l">${esc(t('penjelajah_topik.judul'))}</h1>
      <p class="sub">${esc(t('penjelajah_topik.subjudul'))}</p>
    </div>
  </header>

  <article class="card">
    <div class="eyebrow">${esc(t('penjelajah_topik.form.judul'))}</div>
    <p class="cap" style="margin:4px 0 12px">${esc(t('penjelajah_topik.form.keterangan'))}</p>
    ${(sub && sub.enabled) ? `<p class="cap snt-multiuser-note" style="margin:0 0 12px">${esc(t('penjelajah_topik.form.multiuser_note', null, ''))}</p>` : ''}
    ${triggerBlock}
  </article>

  <section class="section" id="tp-queue-sec">
    <div class="section-head"><div class="eyebrow">${esc(t('penjelajah_topik.queue.judul'))}</div></div>
    <div id="tp-queue" style="margin-top:12px" hidden></div>
  </section>

  <section class="section">
    <div class="section-head">
      <div class="eyebrow">${esc(t('penjelajah_topik.published.judul'))}</div>
      <p class="sub">${esc(t('penjelajah_topik.published.keterangan'))}</p>
    </div>
    <div id="tp-cards" style="margin-top:14px"></div>
  </section>`;

  const timers = [];

  /* galeri kartu topik terbit */
  const cardsWrap = el.querySelector('#tp-cards');
  function renderCards() {
    if (!published.length) {
      cardsWrap.innerHTML = `<div class="card">${ui.empty('empty.penjelajah_topik.list')}</div>`;
      return;
    }
    cardsWrap.innerHTML = `<div class="snt-grid">${published.map((it) => {
      const partial = it.status === 'done-partial'
        ? `<span class="badge note">◑ ${esc(t('penjelajah_topik.queue.status_done_partial', null, 'Sebagian'))}</span>` : '';
      const nProd = (typeof it.produk_count === 'number')
        ? `<span>${esc(t('penjelajah_topik.published.produk_n', { n: fmt.int(it.produk_count) }, '{n} produk'))}</span>` : '';
      const rerun = (typeof it.run_count === 'number' && it.run_count > 1)
        ? `<span class="badge plain snt-rerun-badge">↻ ${esc(t('penjelajah_topik.published.diperbarui', { n: fmt.int(it.run_count) }, 'diperbarui {n}×'))}</span>` : '';
      return `
      <a class="card sent-card" href="#/penjelajah-topik/${encodeURIComponent(it.slug)}">
        <div class="sent-card-head">
          <div class="sent-card-name">${esc(it.topic || it.slug)}</div>
          <div class="sent-card-date">${esc(fmt.tanggal(it.date))}</div>
        </div>
        <div class="sent-card-badges">${statusChip(ctx, 'done')} ${partial} ${rerun}</div>
        ${it.ringkasan ? `<p class="opp-insight">${esc(it.ringkasan)}</p>` : ''}
        <div class="sent-card-meta">${nProd}</div>
      </a>`;
    }).join('')}</div>`;
  }

  /* currentList = sumber kebenaran list terkini (awal = render, lalu diperbarui poll
     dari hasil reloadViewer — JANGAN baca ctx.data di poll karena reloadViewer
     mengganti state.data dengan objek baru, sedang ctx.data masih menunjuk yg lama). */
  let currentList = list;
  renderCards();
  renderQueue(el, ctx, currentList);

  /* ===== poll live: re-fetch viewer ~30s, perbarui antrean + galeri tanpa reload =====
     Progres murni data-poll (status/progress dari index) — autorun lokal tak punya
     run Actions untuk dipoll. Hanya aktif bila ada topik tertunda (pending/queued/
     running) ATAU sesi baru saja mengirim — hemat fetch. */
  let pollTimer = null;
  function hasActive() {
    const pend = reconcilePending(currentList);
    const activeIdx = currentList.some((it) => it && (it.status === 'queued' || it.status === 'running'));
    return activeIdx || Object.keys(pend).length > 0;
  }
  async function poll() {
    if (!ctx.reloadViewer) return;
    const fresh = await ctx.reloadViewer();
    if (!fresh) return; /* DEK sesi tak tersimpan → degrade: tetap render dari state lama */
    /* re-derive list dari data terbaru, render ulang antrean + galeri */
    const fd = fresh.topic_explorer;
    currentList = (fd && Array.isArray(fd.list)) ? fd.list.slice() : [];
    published.length = 0;
    currentList.filter((it) => it && (it.status === 'done' || it.status === 'done-partial'))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .forEach((it) => published.push(it));
    renderCards();
    renderQueue(el, ctx, currentList);
    if (!hasActive()) { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  }
  /* ensurePolling — mulai loop poll bila belum jalan (dipanggil saat mount bila ada
     item aktif, & oleh form setelah submit agar topik baru terpantau live). */
  function ensurePolling() { if (!pollTimer && ctx.reloadViewer) pollTimer = setInterval(poll, 30000); }
  if (hasActive()) ensurePolling();

  /* form pemicu: di-bind setelah controller poll siap, agar onSubmitted bisa
     memulai polling + menyegarkan antrean dengan list terkini. */
  if (sub && sub.enabled) bindTriggerForm(el, ctx, timers, { getList: () => currentList, onSubmitted: ensurePolling });
  timers.push(() => { if (pollTimer) clearInterval(pollTimer); });

  /* cleanup: hentikan timer polling saat pindah view */
  return () => timers.forEach((fn) => { try { fn(); } catch { /* abaikan */ } });
}

/* ============================================================ Detail ======= */

/* satu kartu ukuran pasar (TAM/SAM/SOM) — nilai VERBATIM string payload (mono),
   formula + asumsi + sumber bila ada. nilai null → empty dash (anti angka karangan). */
function sizeCardHtml(ctx, key, label, node) {
  const { t, esc } = ctx;
  const n = node && typeof node === 'object' ? node : {};
  const val = n.nilai ? esc(String(n.nilai)) : `<span class="empty-dash">${esc(t('umum.kosong'))}</span>`;
  const periode = n.periode ? `<span class="scn-ctx">${esc(n.periode)}</span>` : '';
  return `<div class="scn ${key === 'sam' ? 'base' : ''}">
    <span class="scn-label">${esc(label)}</span>
    <span class="scn-val">${val}</span>
    ${periode}
    ${(Array.isArray(n.asumsi) && n.asumsi.length) ? `<span class="asumsi-badge">${ctx.ttSpan(t('penjelajah_topik.detail.asumsi_badge', null, 'ASUMSI'), (ctx.glossaryFind('Asumsi') || {}).definisi)}</span>` : ''}
  </div>`;
}

/* baris sumber provenance kecil: tier + sourceLink. dipakai di kartu pasar/momentum. */
function sourcesLine(ctx, sumber) {
  const { ui } = ctx;
  const arr = Array.isArray(sumber) ? sumber.filter(Boolean) : [];
  if (!arr.length) return '';
  return `<div class="opp-src">${arr.map((s) => `${ui.tierChip(s.tier)} ${ui.sourceLink(s)}`).filter(Boolean).join(' · ')}</div>`;
}

/* daftar pemain (ID atau luar) → kartu ringkas. nama + catatan + tier + sumber. */
function pemainListHtml(ctx, arr) {
  const { esc, ui } = ctx;
  const items = Array.isArray(arr) ? arr.filter(Boolean) : [];
  if (!items.length) return ui.empty('empty.penjelajah_topik.pemain');
  return `<div class="claims">${items.map((p) => `
    <div class="claim-item">
      ${ui.tierChip(p.tier)}
      <div class="claim-body">
        <p class="claim-text"><b>${esc(p.nama || '')}</b>${p.catatan ? ` — ${esc(p.catatan)}` : ''}</p>
        ${p.url ? `<p class="claim-ref">${ui.sourceLink({ url: p.url, tanggal_akses: p.tanggal_akses })}</p>` : ''}
      </div>
    </div>`).join('')}</div>`;
}

function renderDetail(el, ctx, slug) {
  const { data, t, esc, fmt, ui } = ctx;
  const td = data.topic_explorer;
  const d = td && td.detail ? td.detail[slug] : null;
  const listItem = (td && Array.isArray(td.list)) ? td.list.find((x) => x && x.slug === slug) : null;

  const back = `<a class="textlink" href="#/penjelajah-topik">${esc(t('penjelajah_topik.kembali'))}</a>`;

  /* tidak ditemukan → empty state jujur (slug salah / belum terbit) */
  if (!d) {
    el.innerHTML = `
    <header class="pagehead"><div>
      <div class="eyebrow">${esc(t('penjelajah_topik.eyebrow'))}</div>
      <h1 class="display-l">${esc((listItem && listItem.topic) || slug)}</h1>
    </div></header>
    <div class="card" style="max-width:560px">${ui.empty('empty.penjelajah_topik.detail')}
      <a class="textlink" href="#/penjelajah-topik">${esc(t('umum.kembali'))} →</a></div>`;
    return undefined;
  }

  const partial = d.status === 'done-partial';
  const partialNote = partial
    ? `<div class="callout note"><div class="co-title">◑ ${esc(t('penjelajah_topik.detail.partial_judul', null, 'Hasil sebagian'))}</div><p>${esc(t('penjelajah_topik.detail.partial_pesan', null, 'Riset berhenti sebelum tuntas (batas token/waktu). Bagian di bawah sudah terverifikasi; sisanya menyusul saat dijalankan ulang.'))}</p></div>`
    : '';

  /* ---------- hero ---------- */
  const hero = `
  <header class="pagehead">
    <div>
      ${back}
      <div class="eyebrow" style="margin-top:8px">${esc(t('penjelajah_topik.eyebrow'))}${d.generated_at ? ` · ${esc(fmt.tanggal(d.generated_at))}` : ''}</div>
      <h1 class="display-m">${esc(d.topic || slug)}</h1>
      ${d.ringkasan ? `<p class="snt-headline">${esc(d.ringkasan)}</p>` : ''}
    </div>
  </header>`;

  /* ---------- skala pasar TAM/SAM/SOM ---------- */
  const tss = d.tam_sam_som && typeof d.tam_sam_som === 'object' ? d.tam_sam_som : null;
  let pasarHtml = '';
  if (tss && (tss.tam || tss.sam || tss.som)) {
    const allSrc = [].concat(
      (tss.tam && tss.tam.sumber) || [], (tss.sam && tss.sam.sumber) || [], (tss.som && tss.som.sumber) || [],
    );
    const formulaParts = ['tam', 'sam', 'som']
      .map((k) => (tss[k] && tss[k].formula) ? `<p class="scn-foot cara-hitung"><span class="ch-k">${esc(t('penjelajah_topik.detail.size.' + k))}:</span> ${esc(tss[k].formula)}</p>` : '')
      .filter(Boolean).join('');
    pasarHtml = `
    <section class="section">
      <article class="card">
        <div class="eyebrow">${esc(t('penjelajah_topik.detail.size.label'))}</div>
        <h3 class="title block-takeaway">${ctx.ttSpan(t('penjelajah_topik.detail.size.judul'), (ctx.glossaryFind('SAM') || {}).definisi)}</h3>
        <div class="scn-grid">
          ${sizeCardHtml(ctx, 'tam', t('penjelajah_topik.detail.size.tam'), tss.tam)}
          ${sizeCardHtml(ctx, 'sam', t('penjelajah_topik.detail.size.sam'), tss.sam)}
          ${sizeCardHtml(ctx, 'som', t('penjelajah_topik.detail.size.som'), tss.som)}
        </div>
        ${formulaParts}
        ${sourcesLine(ctx, allSrc)}
      </article>
    </section>`;
  }

  /* ---------- gap ---------- */
  const gapArr = Array.isArray(d.gap) ? d.gap.filter(Boolean) : [];
  const gapHtml = gapArr.length ? `
    <section class="section">
      <article class="card">
        <div class="eyebrow">${esc(t('penjelajah_topik.detail.gap.label'))}</div>
        <h3 class="title block-takeaway">${ctx.ttSpan(t('penjelajah_topik.detail.gap.judul'), (ctx.glossaryFind('Celah pasar') || {}).definisi)}</h3>
        <div class="claims">${gapArr.map((g) => `
          <div class="claim-item">
            ${ui.tierChip(g.tier)}
            <div class="claim-body">
              <p class="claim-text"><b>${esc(g.klaim || '')}</b></p>
              ${g.bukti_query ? `<p class="claim-grade">${esc(t('penjelajah_topik.detail.gap.bukti', { query: g.bukti_query }, 'Dasar: {query}'))}</p>` : ''}
              ${g.url ? `<p class="claim-ref">${ui.sourceLink({ url: g.url, tanggal_akses: g.tanggal_akses })}</p>` : ''}
            </div>
          </div>`).join('')}</div>
      </article>
    </section>` : '';

  /* ---------- pemain ID & luar ---------- */
  const pem = d.pemain && typeof d.pemain === 'object' ? d.pemain : null;
  const pemainHtml = pem ? `
    <section class="section">
      <div class="section-head">
        <div class="eyebrow">${esc(t('penjelajah_topik.detail.pemain.label'))}</div>
        <h3 class="title block-takeaway">${esc(t('penjelajah_topik.detail.pemain.judul'))}</h3>
      </div>
      <div class="detail-grid">
        <article class="card">
          <div class="eyebrow">${esc(t('penjelajah_topik.detail.pemain.indonesia'))}</div>
          ${pemainListHtml(ctx, pem.indonesia)}
        </article>
        <article class="card">
          <div class="eyebrow">${esc(t('penjelajah_topik.detail.pemain.luar'))}</div>
          ${pemainListHtml(ctx, pem.luar)}
        </article>
      </div>
    </section>` : '';

  /* ---------- kompetisi + momentum + potensi (callouts) ---------- */
  const mom = d.momentum && typeof d.momentum === 'object' ? d.momentum : null;
  const ARAH_SYM = { naik: '▲', datar: '=', turun: '▼' };
  const callouts = [];
  if (d.kompetisi) {
    callouts.push(`<div class="callout note"><div class="co-title">◍ ${esc(t('penjelajah_topik.detail.kompetisi.judul'))}</div><p>${esc(d.kompetisi)}</p></div>`);
  }
  if (mom && (mom.arah || mom.bukti)) {
    const sym = ARAH_SYM[mom.arah] || '◍';
    const arahLabel = mom.arah ? t('penjelajah_topik.detail.momentum.arah_' + mom.arah, null, mom.arah) : '';
    callouts.push(`<div class="callout tip"><div class="co-title">${sym} ${esc(t('penjelajah_topik.detail.momentum.judul'))}${arahLabel ? ` — ${esc(arahLabel)}` : ''}</div>${mom.bukti ? `<p>${esc(mom.bukti)}</p>` : ''}${mom.url ? `<span class="co-src">${ui.tierChip(mom.tier)} ${ui.sourceLink({ url: mom.url, tanggal_akses: mom.tanggal_akses })}</span>` : ''}</div>`);
  }
  if (d.potensi_ke_depan) {
    callouts.push(`<div class="callout ok"><div class="co-title">→ ${esc(t('penjelajah_topik.detail.potensi.judul'))}</div><p>${esc(d.potensi_ke_depan)}</p></div>`);
  }
  const calloutsHtml = callouts.length ? `<div class="callout-grid">${callouts.join('')}</div>` : '';

  /* ---------- produk ditemukan → link ke #/peluang/<id> ---------- */
  /* hanya kandidat yang BENAR-BENAR ada di ctx.data.opportunities yang punya rute
     #/peluang/<id> hidup. Topik menemukan kandidat status:'raw' (belum ber-dossier) →
     TIDAK ada di opportunities → render kartu non-link "Menunggu riset pipeline" alih-alih
     tautan mati (TE-X1/TE-AH-02). */
  const routableOpp = new Set(
    (Array.isArray(data.opportunities) ? data.opportunities : [])
      .map((o) => o && o.id).filter(Boolean),
  );
  const produk = Array.isArray(d.temuan_produk) ? d.temuan_produk.filter(Boolean) : [];
  const produkHtml = `
    <section class="section">
      <article class="card">
        <div class="eyebrow">${esc(t('penjelajah_topik.detail.produk.label'))}</div>
        <h3 class="title block-takeaway">${esc(t('penjelajah_topik.detail.produk.judul'))}</h3>
        ${produk.length ? `<p class="panel-sub">${esc(t('penjelajah_topik.detail.produk.subjudul'))}</p>
        <div class="snt-grid" style="margin-top:14px">${produk.map((p) => {
          const asalTxt = p.asal === 'luar' ? t('penjelajah_topik.detail.produk.asal_luar', null, 'luar negeri') : p.asal === 'ID' ? t('penjelajah_topik.detail.produk.asal_id', null, 'Indonesia') : '';
          const meta = [p.kategori, asalTxt].filter(Boolean).map(esc).join(' · ');
          const head = `<div class="sent-card-head">
              <div class="sent-card-name">${esc(p.nama || '')}</div>
            </div>
            ${p.brand ? `<div class="opp-brand">${esc(p.brand)}</div>` : ''}
            ${meta ? `<div class="sent-card-meta">${meta}</div>` : ''}`;
          return (p.candidate_id && routableOpp.has(p.candidate_id))
            ? `<a class="card sent-card" href="#/peluang/${encodeURIComponent(p.candidate_id)}">${head}<span class="textlink" style="margin-top:auto">${esc(t('penjelajah_topik.detail.produk.lihat', null, 'Lihat di Peluang'))} →</span></a>`
            : `<div class="card sent-card is-static">${head}<span class="cap" style="margin-top:auto">${esc(t('penjelajah_topik.detail.produk.menunggu_riset', null, 'Menunggu riset pipeline'))}</span></div>`;
        }).join('')}</div>` : ui.empty('empty.penjelajah_topik.produk')}
      </article>
    </section>`;

  /* ---------- limitasi ---------- */
  const lims = Array.isArray(d.limitations) ? d.limitations.filter(Boolean) : [];
  const limHtml = lims.length ? `
    <section class="section">
      <article class="card limits">
        <div class="eyebrow">${esc(t('penjelajah_topik.detail.limitasi.label'))}</div>
        <h3 class="title block-takeaway">${esc(t('penjelajah_topik.detail.limitasi.judul'))}</h3>
        <ol>${lims.map((l) => `<li><span>${esc(l)}</span></li>`).join('')}</ol>
      </article>
    </section>` : '';

  /* ---------- laporan naratif (markdown, async, di balik disclosure) ---------- */
  const reportBlock = d.report_md
    ? `<details class="ops-disclose snt-report"><summary><span class="dsc-title">${esc(t('penjelajah_topik.detail.laporan_lengkap'))}</span></summary><div class="dsc-body" style="margin-top:10px"><p class="cap" style="margin:0 0 12px">${esc(t('penjelajah_topik.detail.laporan_lengkap_ket', null, 'Uraian naratif penuh di balik kesimpulan di atas, dengan sumber lengkap.'))}</p><div class="md-body" id="tp-md"></div></div></details>`
    : '';

  /* biaya run (transparansi token, §5 surfacing) — nullable */
  const tok = d.tokens && typeof d.tokens === 'object' ? d.tokens : null;
  const biayaFoot = (tok && typeof tok.usd === 'number')
    ? `<span class="srcline">${esc(t('penjelajah_topik.detail.biaya_run', { usd: fmt.dec(tok.usd, 2) }, 'Biaya riset topik ini: ~US{usd}'))}</span>`
    : '';

  el.innerHTML = `
  ${hero}
  ${partialNote}
  ${pasarHtml}
  ${gapHtml}
  ${pemainHtml}
  ${calloutsHtml}
  ${produkHtml}
  ${limHtml}
  ${reportBlock}
  ${biayaFoot ? `<div class="detail-foot">${biayaFoot}</div>` : ''}`;

  /* laporan md (async) */
  if (d.report_md) {
    ctx.renderMd(d.report_md).then((html) => { const m = el.querySelector('#tp-md'); if (m) m.innerHTML = html; });
  }

  return undefined;
}

/* ============================================================ Dispatch ===== */

export function render(el, ctx) {
  if (ctx.route && ctx.route.slug) return renderDetail(el, ctx, ctx.route.slug);
  return renderList(el, ctx);
}
