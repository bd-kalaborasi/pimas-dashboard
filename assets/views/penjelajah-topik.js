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
/* buang entri pending yang HASILNYA sudah muncul di daftar terbit ATAU yang basi (>48 jam
   — autorun lokal bisa menunggu PC owner nyala). "Muncul di daftar" = slug entri ADA
   sebagai item list (x.slug) ATAU termuat di aliases[] salah satu item — kasus topik
   DI-MERGE ke kanonik (topic-canonicalize): slug-nya lenyap sebagai item sendiri dan
   pindah jadi alias item kanonik. Tanpa cek aliases, kartu "Masuk antrean" nyangkut
   sampai 48 jam padahal risetnya sudah selesai di bawah judul kanonik.

   PENGECUALIAN status:'failed' — item GAGAL TIDAK dianggap "hasil sudah muncul": kalau
   di-prune, kartu pending lokal lenyap & pengirim tak pernah tahu risetnya gagal (lenyap
   senyap). Maka slug/alias item failed JANGAN masuk `have` → kartu pending TETAP tampil
   (renderQueue merendernya sebagai chip "Terhenti" + hint kirim-ulang). TTL 48 jam tetap
   berlaku sebagai jaring pengaman terakhir. */
function reconcilePending(list) {
  const o = readPending();
  const have = new Set();
  for (const x of (Array.isArray(list) ? list : [])) {
    if (!x) continue;
    if (x.status === 'failed') continue; // gagal ≠ selesai → biar kartu pending bertahan (sadar gagal)
    if (x.slug) have.add(x.slug);
    for (const a of (Array.isArray(x.aliases) ? x.aliases : [])) if (a) have.add(a); // di-merge → alias kanonik
  }
  let changed = false; const now = Date.now();
  for (const s of Object.keys(o)) { if (have.has(s) || (now - (o[s].at || 0)) > 172800000) { delete o[s]; changed = true; } }
  if (changed) writePending(o);
  return o;
}

function slugify(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

/** url http(s) valid → boleh jadi <a> (pola peluang.js; anti link mati/XSS). */
function httpUrl(u) {
  const s = String(u || '').trim();
  return /^https?:\/\//i.test(s) ? s : null;
}

/* ============================================================ Atribusi ===== */

/*
 * Atribusi permintaan (kontrak docs/kontrak-request-log.md) — SIMETRIS dengan
 * sentimen.js: chip "oleh {user}" dari item.requested_by (null → tanpa chip),
 * section "Log Permintaan" dari ctx.data.request_log (absen → disembunyikan),
 * blok "Identitas pengirim" (kunci kirim pribadi per-akun via ctx.submitToken).
 */

function reqChipHtml(ctx, rb) {
  const { t, esc, fmt } = ctx;
  if (!rb || typeof rb !== 'object' || !rb.user) return '';
  const st = rb.verified
    ? t('request_log.verified_label', null, 'terverifikasi')
    : t('request_log.unverified_label', null, 'ditulis sendiri — belum terverifikasi');
  const title = t('request_log.chip_title', {
    user: rb.user, status: st, tanggal: rb.at ? fmt.tanggal(rb.at) : t('umum.kosong'),
  }, 'Diminta {user} · {status} · {tanggal}');
  return `<span class="req-badge" title="${esc(title)}" aria-label="${esc(title)}">${esc(t('request_log.chip_oleh', { user: rb.user }, 'oleh {user}'))}${rb.verified ? ' <span class="req-v" aria-hidden="true">✓</span>' : ''}</span>`;
}

const RL_STATUS = {
  queued: ['◌', 'plain', 'status_queued', 'Mengantre'],
  running: ['◐', 'tip', 'status_running', 'Berjalan'],
  done: ['●', 'ok', 'status_done', 'Selesai'],
  'done-partial': ['◑', 'note', 'status_done_partial', 'Sebagian'],
  partial: ['◑', 'note', 'status_partial', 'Sebagian'],
  failed: ['✕', 'warn', 'status_failed', 'Terhenti'],
};
function reqStatusBadge(ctx, status) {
  const { t, esc } = ctx;
  const m = RL_STATUS[status];
  if (!m) return `<span class="badge plain">⏳ ${esc(t('request_log.status_menunggu', null, 'Menunggu'))}</span>`;
  return `<span class="badge ${m[1]}">${m[0]} ${esc(t('request_log.' + m[2], null, m[3]))}</span>`;
}

function reqLogRowHtml(ctx, ev, opts) {
  const { t, esc, fmt } = ctx;
  const user = ev.user
    ? `<span class="rl-user">${esc(ev.user)}${ev.verified ? ' <span class="req-v" title="' + esc(t('request_log.verified_label', null, 'terverifikasi')) + '">✓</span>' : ''}</span>`
    : `<span class="rl-user rl-anon">${esc(t('request_log.tanpa_user', null, 'tanpa nama'))}</span>`;
  const label = String(ev.label || ev.slug || '').trim();
  const linked = opts && opts.canLink && ev.slug && opts.canLink(ev);
  const labelHtml = linked
    ? `<a class="rl-label rl-link" href="#/${opts.base}/${encodeURIComponent(ev.slug)}">${esc(label)}</a>`
    : `<span class="rl-label">${esc(label)}</span>`;
  const rerun = ev.rerun
    ? `<span class="badge plain snt-rerun-badge">↻ ${esc(t('request_log.ulang', null, 'ulang'))}</span>` : '';
  return `<li>${user}<span class="rl-sep" aria-hidden="true">·</span>${labelHtml}<span class="rl-date">${esc(fmt.tanggal(ev.ts))}</span>${reqStatusBadge(ctx, ev.status)}${rerun}</li>`;
}

function requestLogSectionHtml(ctx, kind, opts) {
  const { t, esc, fmt } = ctx;
  const rl = ctx.data && ctx.data.request_log;
  if (!rl || !Array.isArray(rl.items)) return '';
  const ofKind = rl.items.filter((ev) => ev && ev.kind === kind);
  const items = ofKind.slice(0, 20);
  const body = items.length
    ? `<ul class="req-log">${items.map((ev) => reqLogRowHtml(ctx, ev, opts)).join('')}</ul>`
    : `<p class="cap req-log-empty">${esc(t('request_log.empty', null, 'Belum ada permintaan tercatat lewat dashboard. Kiriman berikutnya akan muncul di sini beserta nama pengirimnya.'))}</p>`;
  const opsLink = ctx.hasOps
    ? `<a class="textlink" href="#/ops/pipeline" style="margin-top:10px;display:inline-block">${esc(t('request_log.lihat_ops', null, 'Lihat log penuh di Operasional'))} →</a>` : '';
  return `
  <section class="section">
    <article class="card">
      <div class="eyebrow">${esc(t('request_log.judul', null, 'Log permintaan'))}</div>
      <p class="cap" style="margin:4px 0 0">${esc(t('request_log.keterangan', null, 'Siapa meminta apa lewat dashboard — beserta waktu dan status terkininya.'))}${ofKind.length > items.length ? ` ${esc(t('request_log.tampil_n', { n: fmt.int(items.length) }, 'Menampilkan {n} terbaru.'))}` : ''}</p>
      ${body}
      ${opsLink}
    </article>
  </section>`;
}

/* ===== Blok "Identitas pengirim" — simetris sentimen.js (ns penjelajah_topik). ===== */

function identStatusHtml(ctx) {
  const { t, esc } = ctx;
  const hasToken = !!(ctx.submitToken && ctx.submitToken.get());
  const u = ctx.user;
  if (hasToken && u) return `<span class="req-v" aria-hidden="true">✓</span><span>${esc(t('penjelajah_topik.form.identitas.status_verified', { user: u }, 'Mengirim sebagai {user} — terverifikasi (kunci pribadi tersimpan di peramban ini).'))}</span>`;
  if (hasToken) return `<span class="req-v" aria-hidden="true">✓</span><span>${esc(t('penjelajah_topik.form.identitas.status_token_saja', null, 'Kunci pribadi tersimpan — identitas dipastikan server dari kunci saat mengirim.'))}</span>`;
  if (u) return `<span aria-hidden="true">•</span><span>${esc(t('penjelajah_topik.form.identitas.status_unverified', { user: u }, 'Mengirim sebagai {user} — belum terverifikasi (memakai kunci bersama). Tempel kunci pribadimu di bawah agar tercatat terverifikasi.'))}</span>`;
  return `<span aria-hidden="true">◌</span><span>${esc(t('penjelajah_topik.form.identitas.status_tanpa_user', null, 'Nama akun tak terbaca dari sesi ini — permintaan tercatat tanpa nama. Login ulang, atau tempel kunci pribadimu agar tetap tercatat atas namamu.'))}</span>`;
}

function identBlockHtml(ctx) {
  const { t, esc } = ctx;
  const k = (key, fb) => t('penjelajah_topik.form.identitas.' + key, null, fb);
  return `
  <div class="req-ident">
    <p class="req-ident-status" id="ident-status" aria-live="polite">${identStatusHtml(ctx)}</p>
    <details class="disclose req-ident-disc">
      <summary>${esc(k('judul', 'Identitas pengirim'))}</summary>
      <div class="disclose-body">
        <p class="cap">${esc(k('ket', 'Kunci kirim pribadi membuat permintaanmu tercatat atas namamu dan terverifikasi server. Minta kuncinya ke pengelola, tempel sekali di sini — tersimpan hanya di peramban ini dan tidak pernah ditampilkan kembali. Jangan bagikan ke siapa pun.'))}</p>
        <label class="field">
          <span>${esc(k('token_label', 'Kunci kirim pribadi'))}</span>
          <input class="input" id="ident-token" type="password" placeholder="${esc(k('token_ph', 'tempel kunci dari pengelola'))}" autocomplete="off" autocapitalize="none" spellcheck="false">
        </label>
        <div class="req-ident-actions">
          <button type="button" class="btn-ghost" id="ident-save">${esc(k('simpan', 'Simpan di peramban ini'))}</button>
          <button type="button" class="btn-ghost" id="ident-clear" hidden>${esc(k('hapus', 'Hapus kunci'))}</button>
        </div>
        <div id="ident-msg" role="status" aria-live="polite"></div>
      </div>
    </details>
  </div>`;
}

function bindIdentBlock(root, ctx) {
  const { t, esc } = ctx;
  const k = (key, fb) => t('penjelajah_topik.form.identitas.' + key, null, fb);
  const status = root.querySelector('#ident-status');
  const input = root.querySelector('#ident-token');
  const save = root.querySelector('#ident-save');
  const clear = root.querySelector('#ident-clear');
  const msg = root.querySelector('#ident-msg');
  if (!input || !save || !clear) return null;
  const refresh = () => {
    if (status) status.innerHTML = identStatusHtml(ctx);
    clear.hidden = !(ctx.submitToken && ctx.submitToken.get());
  };
  refresh();
  save.addEventListener('click', () => {
    const ok = !!(ctx.submitToken && ctx.submitToken.set(input.value));
    input.value = ''; /* nilai kunci tak pernah tinggal di DOM */
    if (msg) {
      msg.innerHTML = ok
        ? `<p class="cap req-ident-ok">✓ ${esc(k('tersimpan', 'Kunci kirim tersimpan di peramban ini. Permintaan berikutnya tercatat terverifikasi.'))}</p>`
        : `<p class="login-err">⚠ ${esc(k('kosong', 'Tempel dulu kuncinya sebelum menyimpan.'))}</p>`;
    }
    refresh();
  });
  clear.addEventListener('click', () => {
    if (ctx.submitToken) ctx.submitToken.clear();
    if (msg) msg.innerHTML = `<p class="cap">${esc(k('terhapus', 'Kunci kirim dihapus dari peramban ini — pengiriman kembali memakai kunci bersama.'))}</p>`;
    refresh();
  });
  return refresh;
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
  // 'running' = SATU panggilan riset panjang (~20-30 mnt) TANPA progres terukur per-fase
  // (workflow hanya publish 2 state: mulai + selesai → pct nyangkut di satu angka spt 30%).
  // Maka pakai bar INDETERMINATE (animasi "berjalan") + estimasi durasi, JANGAN % statis yang
  // terlihat macet. queued/null = bar kosong-statis. Hanya tampilkan % bila benar-benar terukur.
  const indeterminate = running || pct === null;
  const bar = indeterminate
    ? `<div class="sp-bar" aria-hidden="true"><i></i></div>`
    : `<div class="sp-bar" aria-hidden="true"><i style="left:0;width:${pct}%;animation:none"></i></div>`;
  const meta = running
    ? esc(t('penjelajah_topik.queue.estimasi', null, '± 20–30 mnt'))
    : (pct === null ? '' : `${esc(String(Math.round(pct)))}%`);
  return `<div class="card"><div class="sent-progress" role="status" aria-live="polite">
    <div class="sp-head">${running ? '<span class="spinner"></span>' : ''}<span>${esc(it.topic || it.slug)}</span>${reqChipHtml(ctx, it.requested_by)}${statusChip(ctx, it.status)}</div>
    ${bar}
    <div class="sp-meta"><span class="sp-stage">${esc(phase || t('penjelajah_topik.queue.menunggu', null, 'Menunggu giliran'))}</span>${meta ? `<span class="sp-elapsed mono">${meta}</span>` : ''}</div>
  </div></div>`;
}

/* baris topik GAGAL (status:'failed') — bukan progres: bar berhenti (penuh, warna warn),
   chip "✕ Terhenti", + hint kirim-ulang. Dirender bersama antrean agar topik yang gagal
   TIDAK lenyap senyap; pengirim sadar & bisa coba lagi (kirim ulang topik yang sama).
   role="alert" (bukan status) karena ini kondisi yang menuntut perhatian. */
function failedRowHtml(ctx, it) {
  const { esc, t } = ctx;
  const p = (it && it.progress && typeof it.progress === 'object') ? it.progress : {};
  const phase = p.message || p.phase || '';
  return `<div class="card"><div class="sent-progress" role="alert">
    <div class="sp-head"><span>${esc(it.topic || it.slug)}</span>${reqChipHtml(ctx, it.requested_by)}${statusChip(ctx, it.status)}</div>
    <div class="sp-bar is-failed" aria-hidden="true"><i></i></div>
    <div class="sp-meta"><span class="sp-stage">${esc(phase || t('penjelajah_topik.queue.rerun_hint', null, 'Kirim ulang topik yang sama untuk menjalankan lagi.'))}</span></div>
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
  /* kunci PRIBADI per-akun (ctx.submitToken, localStorage perangkat) menang atas kunci
     bersama → requested_by.verified=true di Worker. username sesi ikut (self-declared;
     Worker lama mengabaikannya — nol breaking). */
  const personalKey = ctx.submitToken ? ctx.submitToken.get() : null;
  if (!sub || !sub.enabled || !sub.worker_url || (!sub.submit_key && !personalKey)) {
    const e = new Error('disabled'); e.code = 'DISABLED'; throw e;
  }
  let res;
  try {
    res = await fetch(sub.worker_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'dashboard',
        submit_key: personalKey || sub.submit_key,
        username: ctx.user || undefined,
        topic: payload.topic,
        depth: payload.depth || 'standard',
      }),
    });
  } catch { const e = new Error('network'); e.code = 'HTTP'; throw e; }
  let body = null;
  try { body = await res.json(); } catch { /* tolerate empty/non-JSON */ }
  if (res.ok && body && body.ok) return body; // {ok, slug, queued, rerun, message}
  if (res.status === 401 || res.status === 403) { const e = new Error('key'); e.code = 'TOKEN'; e.httpStatus = res.status; e.serverMessage = (body && body.message) || ''; e.usedPersonalKey = !!personalKey; throw e; }
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
      let extraBtn = '';
      if (err && err.code === 'TOKEN') {
        if (err.httpStatus === 403) pesan = t('penjelajah_topik.error.key_notconfig', null, 'Front-door kirim belum dikonfigurasi di server — pengelola perlu set secret di Worker.');
        else if (/anti-?bot|turnstile|verifikasi/i.test(err.serverMessage || '')) pesan = t('penjelajah_topik.error.key_turnstile', null, 'Verifikasi anti-bot gagal — muat ulang lalu coba lagi.');
        else if (err.usedPersonalKey) {
          /* 401 saat kunci PRIBADI terpakai — beri jalan keluar: hapus kunci. */
          pesan = t('penjelajah_topik.form.identitas.token_invalid', null, 'Kunci kirim pribadimu tidak dikenal server — mungkin dicabut atau salah tempel. Hapus kuncinya lalu minta yang baru ke pengelola; tanpa kunci pribadi, pengiriman memakai kunci bersama.');
          extraBtn = `<button type="button" class="btn-ghost" id="tp-clear-token" style="margin-top:10px">${esc(t('penjelajah_topik.form.identitas.hapus', null, 'Hapus kunci'))}</button>`;
        }
        else pesan = t('penjelajah_topik.error.key_mismatch', null, 'Kunci kirim tak cocok dengan kunci Worker — pengelola perlu sinkron ulang TOPIC_SUBMIT_KEY/SENTIMENT_SUBMIT_KEY.') + (err.serverMessage ? ` [${err.serverMessage}]` : '');
      }
      else if (err && err.code === 'RATE') pesan = t('penjelajah_topik.error.rate_limited', null, 'Terlalu banyak permintaan dari sesi ini. Coba lagi beberapa menit.');
      else pesan = t('penjelajah_topik.error.kirim', { pesan }, 'Topik gagal dikirim: {pesan}. Coba lagi sebentar.');
      msg.innerHTML = `<div class="callout warn"><p>${esc(pesan)}</p>${extraBtn}</div>`;
      const cbtn = msg.querySelector('#tp-clear-token');
      if (cbtn) {
        cbtn.addEventListener('click', () => {
          if (ctx.submitToken) ctx.submitToken.clear();
          msg.innerHTML = '';
          if (typeof opts.identRefresh === 'function') opts.identRefresh();
          ctx.toast(t('penjelajah_topik.form.identitas.terhapus', null, 'Kunci kirim dihapus dari peramban ini — pengiriman kembali memakai kunci bersama.'));
        });
      }
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
  /* topik GAGAL: dirender bersama antrean (chip "Terhenti" + hint kirim-ulang) supaya
     tidak lenyap senyap. reconcilePending menahan kartu pending-nya; tetapi karena slug
     gagal ADA di rowsList, ia tampil sebagai failedRow (bukan kartu pending dobel). */
  const failed = rowsList.filter((it) => it && it.status === 'failed')
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const activeSlugs = new Set(active.map((it) => it.slug));
  const pend = reconcilePending(rowsList);
  const pendSlugs = Object.keys(pend)
    .filter((s) => !activeSlugs.has(s) && !rowsList.some((x) => x && x.slug === s))
    .sort((a, b) => (pend[b].at || 0) - (pend[a].at || 0));

  if (!active.length && !failed.length && !pendSlugs.length) {
    wrap.innerHTML = '';
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const rows = active.map((it) => progressRowHtml(ctx, it))
    .concat(failed.map((it) => failedRowHtml(ctx, it))).join('');
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
    triggerBlock = triggerFormHtml(ctx) + identBlockHtml(ctx);
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
  </section>

  ${requestLogSectionHtml(ctx, 'topic', {
    base: 'penjelajah-topik',
    /* link hanya ke topik yang laporannya sudah terbit */
    canLink: (ev) => ev.status === 'done' || ev.status === 'done-partial',
  })}`;

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
      const reqBy = reqChipHtml(ctx, it.requested_by);
      return `
      <a class="card sent-card" href="#/penjelajah-topik/${encodeURIComponent(it.slug)}">
        <div class="sent-card-head">
          <div class="sent-card-name">${esc(it.topic || it.slug)}</div>
          <div class="sent-card-date">${esc(fmt.tanggal(it.date))}</div>
        </div>
        <div class="sent-card-badges">${statusChip(ctx, 'done')} ${partial} ${rerun} ${reqBy}</div>
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
    /* pending yang slug-nya kini item GAGAL = state terminal (kita SUDAH lihat gagalnya;
       reconcilePending sengaja menahannya agar kartunya tampil) → JANGAN bikin poll jalan
       terus. Hitung pending "hidup" = yang belum cocok ke item failed mana pun. */
    const failedSlugs = new Set(
      currentList.filter((it) => it && it.status === 'failed').map((it) => it.slug).filter(Boolean),
    );
    const livePend = Object.keys(pend).some((s) => !failedSlugs.has(s));
    return activeIdx || livePend;
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
  if (sub && sub.enabled) {
    const identRefresh = bindIdentBlock(el, ctx);
    bindTriggerForm(el, ctx, timers, { getList: () => currentList, onSubmitted: ensurePolling, identRefresh });
  }
  timers.push(() => { if (pollTimer) clearInterval(pollTimer); });

  /* cleanup: hentikan timer polling saat pindah view */
  return () => timers.forEach((fn) => { try { fn(); } catch { /* abaikan */ } });
}

/* ============================================================ Detail ======= */

/* baris "Juga dicari sebagai:" — chip tiap frasa alternatif yang DI-MERGE ke topik
   kanonik (kanonikalisasi slug). Hanya dirender bila ada >1 frasa konten DAN minimal
   satu frasa BERBEDA dari topik utama (display). Frasa = parafrase/typo dari subjek
   riset yang sama → memberi konteks "topik ini juga mewakili pencarian X". Aman bila
   field absent (record lama: phrasings undefined → []). */
function phrasingsRowHtml(ctx, phrasings, topikUtama) {
  const { t, esc } = ctx;
  const arr = Array.isArray(phrasings) ? phrasings : [];
  if (arr.length <= 1) return '';
  const norm = (s) => String(s || '').trim().toLowerCase();
  const utama = norm(topikUtama);
  const seen = new Set();
  const lain = [];
  for (const p of arr) {
    const txt = String(p || '').trim();
    const key = norm(txt);
    if (!txt || key === utama || seen.has(key)) continue;
    seen.add(key);
    lain.push(txt);
  }
  if (!lain.length) return '';
  return `<div class="tp-phrasings">
    <span class="tp-phrasings-label">${esc(t('penjelajah_topik.detail.juga_dicari', null, 'Juga dicari sebagai'))}</span>
    <span class="tp-phrasings-chips">${lain.map((p) => `<span class="tp-phrasing-chip">${esc(p)}</span>`).join('')}</span>
  </div>`;
}

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

/* chip mini sub-skor Wn provisional untuk kartu produk topik — chip OUTLINE dashed
   (reuse .scout-chip), label dimensi dari peluang.dimensi.*, BUKAN meter ter-QA
   (skor topik provisional; gatekeeper pipeline tetap re-screen). subskor = {w1..w5} int. */
function subskorMiniHtml(ctx, subskor) {
  const { t, esc } = ctx;
  const s = subskor && typeof subskor === 'object' ? subskor : null;
  if (!s) return '';
  const chips = ['w1', 'w2', 'w3', 'w5']
    .map((k) => {
      const v = s[k];
      if (typeof v !== 'number' || !isFinite(v)) return '';
      const label = t('peluang.dimensi.' + k + '.label', null, k.toUpperCase());
      return `<span class="scout-chip">${esc(label)} ${esc(String(v))}/5</span>`;
    })
    .filter(Boolean).join('');
  return chips ? `<div class="arc-scout-chips">${chips}</div>` : '';
}

/* satu kartu produk ditemukan (detail topik) — thumbnail+monogram fallback (pola
   peluang.js: data-fallback-img + ui.bindImgFallbacks), nama/brand/meta, chip skor
   screening (provisional) + Wn mini, angle (insight produk), link produk_url RESMI
   (target _blank). Kandidat ter-rute ke #/peluang/<id> → kartu link "Lihat di Peluang";
   belum ter-dossier → kartu statis "Menunggu riset pipeline" (TE-X1/TE-AH-02). */
function temuanProdukCard(ctx, p, routableOpp) {
  const { t, esc } = ctx;
  const asalTxt = p.asal === 'luar' ? t('penjelajah_topik.detail.produk.asal_luar', null, 'luar negeri')
    : p.asal === 'ID' ? t('penjelajah_topik.detail.produk.asal_id', null, 'Indonesia') : '';
  const meta = [p.kategori, asalTxt].filter(Boolean).map(esc).join(' · ');
  const monogram = `<span class="ph-mono" aria-hidden="true">${esc((p.nama || '?').charAt(0).toUpperCase())}</span>`;
  /* thumbnail produk: referrerpolicy no-referrer wajib (hotlink situs resmi / OFF),
     lazy, fallback monogram via data-fallback-img (handler app.js — CSP, BUKAN onerror). */
  const hasImg = !!httpUrl(p.image_url);
  const foto = hasImg
    ? `<img src="${esc(p.image_url)}" alt="${esc(p.nama || '')}" loading="lazy" referrerpolicy="no-referrer" data-fallback-img><span class="ph-fallback">${monogram}</span>`
    : monogram;
  const skor = (typeof p.skor_screening === 'number' && isFinite(p.skor_screening)) ? p.skor_screening : null;
  const skorChip = skor !== null
    ? `<span class="scout-chip">${esc(t('penjelajah_topik.detail.produk.skor', { n: String(skor) }, 'Skor {n}/5'))}</span>` : '';
  /* F2: alasan skor (skor_alasan) — baris kecil di bawah chip, reuse .cap. Hanya saat
     ada skor + alasan; menjawab "kenapa skor segini" tanpa menambah chart. */
  const skorAlasan = (skor !== null && typeof p.skor_alasan === 'string' && p.skor_alasan.trim())
    ? `<p class="cap">${esc(t('penjelajah_topik.detail.produk.alasan_skor', { alasan: p.skor_alasan.trim() }, 'Alasan: {alasan}'))}</p>` : '';
  const skorBlock = (skorChip || subskorMiniHtml(ctx, p.subskor) || skorAlasan) ? `
      <div class="tp-prod-skor">
        <span class="arc-scout-label">${esc(t('penjelajah_topik.detail.produk.skor_label', null, 'Skor screening (sementara)'))}</span>
        <div class="arc-scout-chips">${skorChip}${subskorMiniHtml(ctx, p.subskor)}</div>
        ${skorAlasan}
      </div>` : '';
  const angle = p.angle ? `<p class="opp-insight">${esc(p.angle)}</p>` : '';
  const desc = (!p.angle && p.deskripsi_singkat) ? `<p class="opp-desc">${esc(p.deskripsi_singkat)}</p>` : '';
  const prodUrl = httpUrl(p.produk_url);
  const prodLabel = String(t('penjelajah_topik.detail.produk.lihat_resmi', null, 'Situs resmi')).replace(/[\s→↗]+$/u, '');
  const prodLink = prodUrl
    ? `<a class="opp-prodlink" href="${esc(prodUrl)}" target="_blank" rel="noopener noreferrer">${esc(prodLabel)}<span class="src-ext" aria-hidden="true">↗</span></a>` : '';

  /* F1 (kepatuhan lisensi): atribusi gambar — wajib utk gambar berlisensi atribusi
     (mis. OFF CC-BY-SA). Render HANYA saat ada foto + (sumber URL ATAU lisensi).
     Link "Sumber gambar" → image_sumber_url (target _blank), + teks lisensi. Reuse
     .cap. Tanpa foto (image_url null) → monogram fallback, tanpa caption. */
  const imgSrcUrl = hasImg ? httpUrl(p.image_sumber_url) : null;
  const imgLisensi = (hasImg && typeof p.image_lisensi === 'string' && p.image_lisensi.trim()) ? p.image_lisensi.trim() : '';
  const imgSrcLink = imgSrcUrl
    ? `<a href="${esc(imgSrcUrl)}" target="_blank" rel="noopener noreferrer">${esc(t('penjelajah_topik.detail.produk.sumber_gambar', null, 'Sumber gambar'))}<span class="src-ext" aria-hidden="true">↗</span></a>`
    : '';
  const imgLisensiTxt = imgLisensi
    ? `<span>${esc(t('penjelajah_topik.detail.produk.lisensi_gambar', { lisensi: imgLisensi }, 'Lisensi {lisensi}'))}</span>` : '';
  const imgAttr = (imgSrcLink || imgLisensiTxt)
    ? `<p class="cap tp-prod-imgattr">${[imgSrcLink, imgLisensiTxt].filter(Boolean).join(' · ')}</p>` : '';

  const head = `
    <div class="tp-prod-top">
      <div class="opp-photo tp-prod-photo" role="img" aria-label="${esc(hasImg ? (p.nama || '') : t('peluang.kartu.tanpa_foto'))}">${foto}</div>
      <div style="min-width:0">
        <div class="sent-card-name">${esc(p.nama || '')}</div>
        ${p.brand ? `<div class="opp-brand">${esc(p.brand)}</div>` : ''}
        ${meta ? `<div class="sent-card-meta">${meta}</div>` : ''}
        ${imgAttr}
      </div>
    </div>
    ${skorBlock}
    ${angle}
    ${desc}`;

  const routable = p.candidate_id && routableOpp.has(p.candidate_id);
  const foot = `<div class="tp-prod-foot">
    ${prodLink}
    ${routable
    ? `<a class="textlink" href="#/peluang/${encodeURIComponent(p.candidate_id)}">${esc(t('penjelajah_topik.detail.produk.lihat', null, 'Lihat di Peluang'))} →</a>`
    : `<span class="cap">${esc(t('penjelajah_topik.detail.produk.menunggu_riset', null, 'Menunggu riset pipeline'))}</span>`}
  </div>`;

  return `<div class="card sent-card${routable ? '' : ' is-static'}">${head}${foot}</div>`;
}

/* section "Insight Riset" — poin data penting dari riset (prevalensi/demand/pain
   point/harga/regulasi/peluang), tiap poin ber-provenance (tier + sourceLink). */
function insightRisetHtml(ctx, arr) {
  const { t, esc, ui } = ctx;
  const items = Array.isArray(arr) ? arr.filter(Boolean) : [];
  if (!items.length) return '';
  return `
    <section class="section">
      <article class="card">
        <div class="eyebrow">${esc(t('penjelajah_topik.detail.insight.label', null, 'Insight riset'))}</div>
        <h3 class="title block-takeaway">${esc(t('penjelajah_topik.detail.insight.judul', null, 'Apa yang penting untuk keputusan produk'))}</h3>
        <div class="claims">${items.map((it) => `
          <div class="claim-item">
            ${ui.tierChip(it.tier)}
            <div class="claim-body">
              <p class="claim-text"><b>${esc(it.poin || '')}</b></p>
              ${it.detail ? `<p class="claim-grade">${esc(it.detail)}</p>` : ''}
              ${it.url ? `<p class="claim-ref">${ui.sourceLink({ url: it.url, tanggal_akses: it.tanggal_akses })}</p>` : ''}
            </div>
          </div>`).join('')}</div>
      </article>
    </section>`;
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
      ${phrasingsRowHtml(ctx, d.phrasings, d.topic || slug)}
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
        <div class="snt-grid" style="margin-top:14px">${produk.map((p) => temuanProdukCard(ctx, p, routableOpp)).join('')}</div>`
    : ui.empty('empty.penjelajah_topik.produk')}
      </article>
    </section>`;

  /* ---------- insight riset (poin data ber-sumber) ---------- */
  const insightHtml = insightRisetHtml(ctx, d.insight_riset);

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

  /* biaya run (transparansi token, §5 surfacing) — nullable. HANYA tampil bila usd>0:
     tokens.usd=0 = belum tercatat (bukan "gratis") → "Biaya ~US$0" menyesatkan, sembunyikan. */
  const tok = d.tokens && typeof d.tokens === 'object' ? d.tokens : null;
  const biayaFoot = (tok && typeof tok.usd === 'number' && isFinite(tok.usd) && tok.usd > 0)
    ? `<span class="srcline">${esc(t('penjelajah_topik.detail.biaya_run', { usd: fmt.dec(tok.usd, 2) }, 'Biaya riset topik ini: ~US{usd}'))}</span>`
    : '';

  el.innerHTML = `
  ${hero}
  ${partialNote}
  ${pasarHtml}
  ${gapHtml}
  ${pemainHtml}
  ${calloutsHtml}
  ${insightHtml}
  ${produkHtml}
  ${limHtml}
  ${reportBlock}
  ${biayaFoot ? `<div class="detail-foot">${biayaFoot}</div>` : ''}`;

  /* fallback monogram untuk thumbnail produk gagal-muat (CSP — handler via JS) */
  ui.bindImgFallbacks(el);

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
