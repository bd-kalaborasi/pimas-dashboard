/*
 * View: Ops › Pipeline — REWORK admin-first 2026-06-15.
 *
 * Tujuan: pengelola non-teknis (owner) paham pipeline dalam 5 detik —
 *   1. DI MANA proses sekarang? (timeline tahap: selesai/berjalan/menunggu)
 *   2. ADA KENDALA? (banner mencolok bila macet/gagal/isu kritis)
 *   3. JADWALNYA? (siklus mingguan + run berikutnya + hitung mundur WIB)
 *   4. SUDAH SAMPAI MANA? (progres langkah)
 *
 * Urutan baca: ringkasan (kartu status) → kendala → tahapan visual → jadwal →
 * data kandidat (disclosure lanjutan, progressive disclosure DESIGN §4.23).
 * Detail teknis per-agen pindah ke halaman Agen; halaman ini fokus alur.
 */

import {
  openAgentDrawer,
  chainLabel, chainGlyph, humanSkill, chainNodes, chainProgress,
  nextRun, obstacles, issuesSplit,
} from './ops-agen.js';

/* ====================================================== Pemicu manual (fallback) ===
 * Tombol OPS-gated untuk MELUNCURKAN chain pipeline secara manual saat cron terbatas
 * (mis. blokir billing Actions, atau run terjadwal gagal). Pola MIRROR sentimen.js:
 * repository_dispatch in-browser dengan token dari blob ops terenkripsi
 * (ctx.ops.pipeline_trigger). Server (pipeline-trigger.yml) memvalidasi ulang chain
 * terhadap allowlist — UI ini hanya menawarkan chain dari ctx.ops.pipeline_trigger.chains. */

/* POST repository_dispatch event_type='pipeline-run' — idiom identik fireTrigger sentimen.
   204=sukses · 401/403=token kedaluwarsa · lainnya=HTTP. Token tak pernah di-log. */
async function firePipeline(ctx, chain) {
  const tr = ctx.ops && ctx.ops.pipeline_trigger;
  if (!tr || !tr.enabled || !tr.token) { const e = new Error('disabled'); e.code = 'DISABLED'; throw e; }
  const res = await fetch(`https://api.github.com/repos/${tr.repo}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tr.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type: tr.event_type || 'pipeline-run',
      client_payload: { chain, requested_at: new Date().toISOString(), requested_by: 'dashboard' },
    }),
  });
  if (res.status === 204) return true;
  if (res.status === 401 || res.status === 403) { const e = new Error('token'); e.code = 'TOKEN'; throw e; }
  const e = new Error('HTTP ' + res.status); e.code = 'HTTP'; throw e;
}

/* fetchPipelineRunStatus — baca STATUS RUN NYATA workflow pipeline-trigger.yml (run yang
   dibuat repository_dispatch kita) lewat GitHub Actions API memakai token + repo yang SAMA.
   CSP mengizinkan api.github.com. Kembalikan run event=repository_dispatch terbaru yang
   created_at >= sinceMs−2mnt (buffer) — filter waktu MEMBUNUH phantom run lama. Error apa
   pun → lempar code='API' agar pemanggil fallback ke pesan sukses sederhana. */
async function fetchPipelineRunStatus(ctx, sinceMs) {
  const tr = ctx.ops && ctx.ops.pipeline_trigger;
  if (!tr || !tr.token || !tr.repo) { const e = new Error('api'); e.code = 'API'; throw e; }
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${tr.repo}/actions/workflows/pipeline-trigger.yml/runs?event=repository_dispatch&per_page=10`, {
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
  const buffer = 2 * 60000;
  const floor = (typeof sinceMs === 'number' ? sinceMs : 0) - buffer;
  const match = runs.find((r) => {
    if (!r) return false;
    const created = Date.parse(r.created_at || '');
    return !(Number.isFinite(created) && created < floor);
  });
  if (!match) return { found: false };
  return {
    found: true,
    status: match.status || 'queued',
    conclusion: match.conclusion || null,
    html_url: match.html_url || '',
    created_at: match.created_at || '',
  };
}

/* POST repository_dispatch event_type='pipeline-step' — perluasan firePipeline untuk SATU
   TAHAP. Klien HANYA kirim {chain, step} (indeks); server (pipeline-step.yml + resolver)
   yang memutuskan skill mana — UI ini tak dipercaya menentukan skill. 204=sukses ·
   401/403=token kedaluwarsa · lainnya=HTTP. Token tak pernah di-log. */
async function fireStep(ctx, chain, stepIdx) {
  const tr = ctx.ops && ctx.ops.pipeline_trigger;
  if (!tr || !tr.enabled || !tr.token) { const e = new Error('disabled'); e.code = 'DISABLED'; throw e; }
  const res = await fetch(`https://api.github.com/repos/${tr.repo}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tr.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type: tr.step_event_type || 'pipeline-step',
      /* step = indeks numerik mentah; server me-resolve ke skill via aeon.yml (batas
         kepercayaan). Kirim sebagai string agar payload stabil; resolver validasi integer. */
      client_payload: { chain, step: String(stepIdx), requested_at: new Date().toISOString(), requested_by: 'dashboard' },
    }),
  });
  if (res.status === 204) return true;
  if (res.status === 401 || res.status === 403) { const e = new Error('token'); e.code = 'TOKEN'; throw e; }
  const e = new Error('HTTP ' + res.status); e.code = 'HTTP'; throw e;
}

/* sanity-guard URL run — hanya tautan github.com (token tak pernah di URL). */
function validGhRunUrl(u) {
  try { const url = new URL(String(u || '')); return /(^|\.)github\.com$/.test(url.hostname) ? url.toString() : ''; }
  catch { return ''; }
}

/* Cari definisi step (idx/label/parallel/consume) di pipeline_trigger untuk chain tertentu.
   Sumber = ctx.ops.pipeline_trigger.chains[].steps[] (di-derive deterministik dari aeon.yml
   di builder). Kembalikan [] bila chain tak ada di allowlist trigger (mis. weekly-evolution)
   → tombol per-tahap TIDAK dirender utk chain itu. */
function triggerStepsFor(ctx, chainId) {
  const tr = ctx.ops && ctx.ops.pipeline_trigger;
  if (!tr || !tr.enabled) return [];
  const c = (tr.chains || []).find((x) => x && x.id === chainId);
  return (c && Array.isArray(c.steps)) ? c.steps : [];
}

/* blok kartu pemicu manual — diselipkan setelah kartu jadwal. State trigger:
   tanpa pipeline_trigger / disabled → catatan; enabled → select chain + konfirmasi + kirim. */
function manualTriggerCardHtml(ctx) {
  const { t, esc } = ctx;
  const tr = ctx.ops && ctx.ops.pipeline_trigger;
  let body;
  if (!tr || !tr.enabled) {
    body = `<div class="callout note" style="margin-top:10px">
      <div class="co-title">◌ ${esc(t('ops.manual.disabled_judul', null, 'Pemicu manual belum aktif'))}</div>
      <p>${esc(t('ops.manual.disabled_pesan', null, 'Token pemicu belum disiapkan pengelola. Untuk sekarang, pipeline berjalan otomatis sesuai jadwal di atas.'))}</p></div>`;
  } else {
    const chains = Array.isArray(tr.chains) ? tr.chains : [];
    body = `
    <form id="mtrig-form" class="mtrig-form" novalidate style="margin-top:10px">
      <label class="field">
        <span>${esc(t('ops.manual.pilih_label', null, 'Pilih pipeline'))}</span>
        <select class="select" id="mtrig-chain">
          ${chains.map((c) => `<option value="${esc(c.id)}">${esc(c.label || c.id)}</option>`).join('')}
        </select>
      </label>
      <div id="mtrig-confirm" class="mtrig-confirm" role="note" aria-live="polite" hidden></div>
      <button class="cta" type="submit" id="mtrig-go">${esc(t('ops.manual.tombol', null, 'Jalankan sekarang'))}</button>
      <div id="mtrig-msg" role="status" aria-live="polite"></div>
    </form>`;
  }
  return `
  <article class="card mtrig-card" style="margin-top:14px">
    <div class="eyebrow">${esc(t('ops.manual.judul', null, 'Jalankan pipeline manual (fallback)'))}</div>
    <p class="cap" style="margin:4px 0 0">${esc(t('ops.manual.keterangan', null, 'Luncurkan satu siklus pipeline secara manual bila jadwal otomatis terkendala (mis. kuota Actions diblokir atau run terjadwal gagal). Prosesnya sama persis dengan run terjadwal.'))}</p>
    ${body}
  </article>`;
}

/* binding form pemicu manual: konfirmasi dua-langkah lalu repository_dispatch + tracking. */
function bindManualTrigger(root, ctx, timers) {
  const { t, esc } = ctx;
  const tr = ctx.ops && ctx.ops.pipeline_trigger;
  if (!tr || !tr.enabled) return;
  const form = root.querySelector('#mtrig-form');
  if (!form) return;
  const chainSel = root.querySelector('#mtrig-chain');
  const confirmEl = root.querySelector('#mtrig-confirm');
  const goBtn = root.querySelector('#mtrig-go');
  const msg = root.querySelector('#mtrig-msg');
  const baseLabel = t('ops.manual.tombol', null, 'Jalankan sekarang');
  let armed = false; /* dua-langkah: klik 1 = minta konfirmasi, klik 2 = kirim */

  const chainLabelOf = (id) => {
    const c = (tr.chains || []).find((x) => x && x.id === id);
    return (c && c.label) || id;
  };
  const disarm = () => {
    armed = false;
    if (confirmEl) { confirmEl.hidden = true; confirmEl.innerHTML = ''; }
    if (goBtn) goBtn.textContent = baseLabel;
  };
  if (chainSel) chainSel.addEventListener('change', disarm);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const chain = chainSel ? chainSel.value : '';
    if (!chain) return;
    /* langkah konfirmasi: klik pertama menampilkan catatan + mengubah tombol jadi "Ya, jalankan". */
    if (!armed) {
      armed = true;
      if (confirmEl) {
        confirmEl.hidden = false;
        confirmEl.innerHTML = `<span class="mtrig-confirm-ico" aria-hidden="true">!</span><span>${esc(t('ops.manual.konfirmasi', { chain: chainLabelOf(chain) }, 'Yakin meluncurkan "{chain}" sekarang? Ini memulai satu run pipeline penuh di cloud.'))}</span>`;
      }
      if (goBtn) goBtn.textContent = t('ops.manual.tombol_konfirmasi', null, 'Ya, jalankan');
      return;
    }
    /* klik kedua: kirim. */
    goBtn.disabled = true;
    goBtn.innerHTML = `<span class="spinner"></span> ${esc(t('ops.manual.mengirim', null, 'Mengirim…'))}`;
    if (msg) msg.innerHTML = '';
    try {
      await firePipeline(ctx, chain);
      trackPipeline(root, ctx, chain, chainLabelOf(chain), timers);
    } catch (err) {
      let pesan = err && err.message;
      if (err && err.code === 'TOKEN') pesan = t('ops.manual.token_invalid', null, 'Akses pemicu sudah kedaluwarsa — pengelola perlu memperbaruinya dulu.');
      if (msg) msg.innerHTML = `<div class="callout warn"><p>${esc(t('ops.manual.error', { pesan }, 'Gagal meluncurkan: {pesan}. Coba lagi sebentar, atau hubungi pengelola bila terus berulang.'))}</p></div>`;
    } finally {
      goBtn.disabled = false;
      disarm();
    }
  });
}

/* tracking ringan: poll status run pipeline-trigger.yml ~15s. Sukses dispatch (run
   muncul / completed-success) → toast + tautan; gagal → pesan jujur. API gagal sekali →
   fallback ke toast sukses sederhana (dispatch sudah terkirim 204). */
function trackPipeline(root, ctx, chain, chainLabelTxt, timers) {
  const { t, esc } = ctx;
  const msg = root.querySelector('#mtrig-msg');
  if (!msg) return;
  const startedAt = Date.now();
  let done = false;
  const tr = ctx.ops && ctx.ops.pipeline_trigger;
  let apiMode = !!(tr && tr.token && tr.repo);

  msg.innerHTML = `<div class="callout note mtrig-track" role="status" aria-live="polite">
    <div class="mtrig-track-head"><span class="spinner"></span><span>${esc(t('ops.manual.track_judul', { chain: chainLabelTxt }, 'Meluncurkan "{chain}"…'))}</span></div>
    <p class="cap">${esc(t('ops.manual.track_catatan', null, 'Pipeline mulai berjalan di cloud (GitHub Actions). Halaman ini tak perlu dibuka terus — prosesnya berlanjut sendiri.'))}</p>
  </div>`;

  const finish = (kind, htmlUrl) => {
    if (done) return; done = true;
    clearInterval(pi); clearTimeout(to);
    const url = validGhRunUrl(htmlUrl);
    const link = url ? `<a class="textlink" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(t('ops.manual.lihat_run', null, 'Lihat detail run →'))}</a>` : '';
    if (kind === 'sent' || kind === 'started') {
      msg.innerHTML = `<div class="callout ok"><p>${esc(t('ops.manual.terkirim', { chain: chainLabelTxt }, 'Pipeline "{chain}" sudah diluncurkan. Hasilnya akan tampil di dashboard begitu run selesai (bisa beberapa jam).'))}</p>${link}</div>`;
      ctx.toast(t('ops.manual.terkirim_toast', { chain: chainLabelTxt }, 'Pipeline "{chain}" diluncurkan.'), 'status');
    } else if (kind === 'failed') {
      msg.innerHTML = `<div class="callout warn"><p>${esc(t('ops.manual.gagal', null, 'Peluncuran terhenti — pemicu gagal memulai run. Coba lagi, atau periksa kuota Actions.'))}</p>${link}</div>`;
    }
  };

  const poll = async () => {
    if (done || !apiMode) return;
    let st;
    try { st = await fetchPipelineRunStatus(ctx, startedAt); }
    catch (err) { if (err && err.code === 'API') { apiMode = false; finish('sent'); } return; }
    if (!st || !st.found) return; /* belum terlihat — terus poll */
    if (st.status === 'completed') {
      if (st.conclusion === 'success') { finish('started', st.html_url); return; }
      finish('failed', st.html_url); return;
    }
    /* queued / in_progress: dispatch jelas mendarat → cukup tunjukkan terkirim + tautan. */
    finish('started', st.html_url);
  };
  const pi = setInterval(poll, 15000);
  poll();
  /* jaring pengaman: bila API diam (run tak terlihat) dalam 90s, tetap konfirmasi terkirim. */
  const to = setTimeout(() => finish('sent'), 90000);
  if (timers) timers.push(() => { done = true; clearInterval(pi); clearTimeout(to); });
}

/* fetchStepRunStatus — sama dgn fetchPipelineRunStatus tapi untuk workflow pipeline-step.yml.
   Kembalikan run repository_dispatch terbaru created_at >= sinceMs−2mnt. */
async function fetchStepRunStatus(ctx, sinceMs) {
  const tr = ctx.ops && ctx.ops.pipeline_trigger;
  if (!tr || !tr.token || !tr.repo) { const e = new Error('api'); e.code = 'API'; throw e; }
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${tr.repo}/actions/workflows/pipeline-step.yml/runs?event=repository_dispatch&per_page=10`, {
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
  const buffer = 2 * 60000;
  const floor = (typeof sinceMs === 'number' ? sinceMs : 0) - buffer;
  const match = runs.find((r) => {
    if (!r) return false;
    const created = Date.parse(r.created_at || '');
    return !(Number.isFinite(created) && created < floor);
  });
  if (!match) return { found: false };
  return {
    found: true,
    status: match.status || 'queued',
    conclusion: match.conclusion || null,
    html_url: match.html_url || '',
    created_at: match.created_at || '',
  };
}

/* tracking ringan untuk SATU TAHAP — pola identik trackPipeline tapi menulis ke elemen
   status yang diberikan (msgEl, di confirm-drawer per-tahap) + poll pipeline-step.yml. */
function trackStep(msgEl, ctx, stepName, timers) {
  const { t, esc } = ctx;
  if (!msgEl) return;
  const startedAt = Date.now();
  let done = false;
  const tr = ctx.ops && ctx.ops.pipeline_trigger;
  let apiMode = !!(tr && tr.token && tr.repo);

  msgEl.innerHTML = `<div class="callout note mtrig-track" role="status" aria-live="polite">
    <div class="mtrig-track-head"><span class="spinner"></span><span>${esc(t('ops.manual.step_track_judul', { nama: stepName }, 'Menjalankan tahap "{nama}"…'))}</span></div>
    <p class="cap">${esc(t('ops.manual.step_track_catatan', null, 'Tahap mulai berjalan di cloud (GitHub Actions). Halaman ini tak perlu dibuka terus — prosesnya berlanjut sendiri.'))}</p>
  </div>`;

  const finish = (kind, htmlUrl) => {
    if (done) return; done = true;
    clearInterval(pi); clearTimeout(to);
    const url = validGhRunUrl(htmlUrl);
    const link = url ? `<a class="textlink" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(t('ops.manual.lihat_run', null, 'Lihat detail run →'))}</a>` : '';
    if (kind === 'sent' || kind === 'started') {
      msgEl.innerHTML = `<div class="callout ok"><p>${esc(t('ops.manual.step_terkirim', { nama: stepName }, 'Tahap "{nama}" sudah dijalankan. Hasilnya akan tampil di dashboard begitu selesai.'))}</p>${link}</div>`;
      ctx.toast(t('ops.manual.step_terkirim_toast', { nama: stepName }, 'Tahap "{nama}" dijalankan.'), 'status');
    } else if (kind === 'failed') {
      msgEl.innerHTML = `<div class="callout warn"><p>${esc(t('ops.manual.step_gagal', null, 'Tahap gagal dimulai — coba lagi, atau periksa kuota Actions.'))}</p>${link}</div>`;
    }
  };

  const poll = async () => {
    if (done || !apiMode) return;
    let st;
    try { st = await fetchStepRunStatus(ctx, startedAt); }
    catch (err) { if (err && err.code === 'API') { apiMode = false; finish('sent'); } return; }
    if (!st || !st.found) return;
    if (st.status === 'completed') {
      if (st.conclusion === 'success') { finish('started', st.html_url); return; }
      finish('failed', st.html_url); return;
    }
    finish('started', st.html_url);
  };
  const pi = setInterval(poll, 15000);
  poll();
  const to = setTimeout(() => finish('sent'), 90000);
  if (timers) timers.push(() => { done = true; clearInterval(pi); clearTimeout(to); });
}

/* ============================================================ Log permintaan =====
 * Log atribusi PENUH (kontrak docs/kontrak-request-log.md): per-EVENT append-only —
 * siapa (akun ✓terverifikasi / self-declared) meminta slug apa (sentimen & topik),
 * kapan, lewat mana, + status kini hasil join index. Plane ops = detail teknis;
 * ringkasan 20-baris per modul hidup di view sentimen/penjelajah-topik.
 * ops.request_log absen (payload lama / builder belum upgrade) → section tak dirender. */
function requestLogOpsHtml(ctx) {
  const { ops, t, esc, fmt } = ctx;
  const rl = ops && ops.request_log;
  if (!rl || !Array.isArray(rl.items)) return '';
  const STATUS = {
    queued: ['◌', 'plain', 'status_queued', 'Mengantre'],
    running: ['◐', 'tip', 'status_running', 'Berjalan'],
    done: ['●', 'ok', 'status_done', 'Selesai'],
    'done-partial': ['◑', 'note', 'status_done_partial', 'Sebagian'],
    partial: ['◑', 'note', 'status_partial', 'Sebagian'],
    failed: ['✕', 'warn', 'status_failed', 'Terhenti'],
  };
  const statusBadge = (ev) => {
    const m = STATUS[ev.status];
    const badge = m
      ? `<span class="badge ${m[1]}">${m[0]} ${esc(t('request_log.' + m[2], null, m[3]))}</span>`
      : `<span class="badge plain">⏳ ${esc(t('request_log.status_menunggu', null, 'Menunggu'))}</span>`;
    /* sentimen: verdict ikut sebagai teks kecil (bukan chip kedua — tabel tetap padat) */
    const verdict = ev.verdict ? ` <span class="cap">${esc(t('sentimen.verdict.' + ev.verdict, null, ev.verdict))}</span>` : '';
    return badge + verdict;
  };
  const rows = rl.items.map((ev) => {
    const user = ev.user
      ? `${esc(ev.user)}${ev.verified ? ' <span class="req-v" title="' + esc(t('request_log.verified_label', null, 'terverifikasi')) + '">✓</span>' : ''}`
      : `<span class="cap">${esc(t('request_log.tanpa_user', null, 'tanpa nama'))}</span>`;
    const sub = ev.slug_submitted || ev.slug || '';
    const canon = ev.slug_canonical;
    const slug = (canon && canon !== sub)
      ? `${esc(sub)} → <b>${esc(canon)}</b>`
      : esc(sub);
    const aksi = [ev.source, ev.action].filter(Boolean).map((x) => esc(String(x))).join(' · ')
      + (ev.rerun ? ` · <span class="snt-rerun-badge">↻${typeof ev.run_count === 'number' ? esc(fmt.int(ev.run_count)) + '×' : ''}</span>` : '');
    return `<tr>
      <td class="td-id">${esc(fmt.tanggalWaktu(ev.ts))}</td>
      <td>${esc(t('request_log.jenis_' + ev.kind, null, ev.kind === 'topic' ? 'Topik' : 'Sentimen'))}</td>
      <td>${user}</td>
      <td class="td-id">${slug}</td>
      <td>${esc(ev.label || '')}</td>
      <td class="td-id">${aksi}</td>
      <td>${statusBadge(ev)}</td>
    </tr>`;
  }).join('');
  return `
  <details class="disclose ops-disclose">
    <summary>
      <span class="dsc-title">${esc(t('request_log.ops_judul', null, 'Log permintaan (penuh)'))}</span>
      <span class="dsc-sub">${esc(t('request_log.ops_sub', { n: fmt.int(rl.total || 0), m: fmt.int(rl.items.length) }, '{n} kejadian tercatat · menampilkan {m} terbaru — siapa meminta analisis sentimen / riset topik, lewat mana, dan statusnya.'))}</span>
    </summary>
    <div class="dsc-body">
      <p class="cap" style="margin:0 0 10px">${esc(t('request_log.ops_ket', null, 'Log per-kejadian, append-only (tahan penggabungan slug — slug lama → kanonik ditampilkan dengan panah). Identitas ✓ = kunci kirim per-akun terverifikasi server; tanpa ✓ = nama diisi sendiri dari sesi login.'))}</p>
      ${rl.items.length ? `<div class="tbl-scroll"><table class="tbl req-log-tbl">
        <thead><tr>
          <th scope="col">${esc(t('request_log.kolom_waktu', null, 'Waktu'))}</th>
          <th scope="col">${esc(t('request_log.kolom_jenis', null, 'Jenis'))}</th>
          <th scope="col">${esc(t('request_log.kolom_akun', null, 'Akun'))}</th>
          <th scope="col">${esc(t('request_log.kolom_slug', null, 'Slug'))}</th>
          <th scope="col">${esc(t('request_log.kolom_label', null, 'Permintaan'))}</th>
          <th scope="col">${esc(t('request_log.kolom_aksi', null, 'Jalur · aksi'))}</th>
          <th scope="col">${esc(t('request_log.kolom_status', null, 'Status'))}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : `<p class="cap">${esc(t('request_log.empty', null, 'Belum ada permintaan tercatat lewat dashboard. Kiriman berikutnya akan muncul di sini beserta nama pengirimnya.'))}</p>`}
    </div>
  </details>`;
}

export function render(el, ctx) {
  const { ops, t, esc, fmt, ui, charts, cron } = ctx;
  const chains = ops.chains || [];
  const now = new Date();

  const candidates = ops.candidates || [];
  const reported = ops.reported || [];
  const funnel = (ops.funnel || {}).by_status || {};
  const funnelTotal = (ops.funnel || {}).total || 0;

  const statusOrder = ['raw', 'shortlist', 'parked', 'rejected', 'reported'].filter((s) => s in funnel);
  Object.keys(funnel).forEach((k) => { if (!statusOrder.includes(k)) statusOrder.push(k); });

  /* ── Derivasi ringkasan (5-detik) ─────────────────────────────────────── */
  const obst = obstacles(ops);
  const issues = issuesSplit(ops);
  const openIssues = issues.open;
  const kendalaTotal = obst.length + openIssues.length;
  const next = nextRun(ops, cron, now);

  // Tahap "sedang berjalan" + "terakhir selesai" lintas semua chain.
  const allNodes = chains.map((c) => ({ chain: c, nodes: chainNodes(c, ops) }));
  let running = null;
  let lastDone = null;
  for (const { nodes } of allNodes) {
    for (const n of nodes) {
      if ((n.state === 'berjalan' || n.state === 'macet') && !running) running = n;
      if (n.state === 'selesai' && n.last_success) {
        if (!lastDone || n.last_success > lastDone.last_success) lastDone = n;
      }
    }
  }
  // Progres total minggu ini: gabungan semua node.
  const flatNodes = allNodes.flatMap((x) => x.nodes);
  const totalSteps = flatNodes.length;
  const doneSteps = flatNodes.filter((n) => n.state === 'selesai').length;

  /* default chain terpilih = chain dengan node 'berjalan', else yang akan jalan
     berikutnya, else pertama. */
  let chainSel = 0;
  if (running) {
    const idx = allNodes.findIndex((x) => x.nodes.includes(running));
    if (idx >= 0) chainSel = idx;
  } else if (next) {
    const idx = chains.findIndex((c) => c.id === next.chain.id);
    if (idx >= 0) chainSel = idx;
  }

  /* state tabel kandidat */
  let q = '';
  let fStatus = 'semua';
  /* default newest-first: kandidat tanpa wps menumpuk → tanggal lebih informatif
     dari skor sebagai urutan awal (sortDir=-1 → terbaru dulu). */
  let sortKey = 'tanggal';
  let sortDir = -1;
  let expandId = null;

  const statusBadge = (s) => {
    const map = { reported: ['●', 'ok'], shortlist: ['◎', 'tip'], raw: ['◌', 'plain'], parked: ['◌', 'plain'], rejected: ['✕', 'warn'] };
    const [sym, cls] = map[s] || ['◌', 'plain'];
    return `<span class="badge ${cls}">${sym} ${esc(t('ops.status.' + s, null, s))}</span>`;
  };

  /* ── Status line (kalimat 5-detik) ────────────────────────────────────── */
  const statusLineParts = [];
  if (running) statusLineParts.push(esc(t('ops.admin.proses_jalan', { nama: running.nama })));
  else if (lastDone) statusLineParts.push(esc(t('ops.admin.proses_terakhir_selesai', { nama: lastDone.nama, waktu: fmt.tanggal(lastDone.last_success) })));
  else statusLineParts.push(esc(t('ops.admin.proses_idle')));
  statusLineParts.push(kendalaTotal
    ? `<b class="warn-text">${esc(t('ops.admin.kendala_jumlah', { n: fmt.int(kendalaTotal) }))}</b>`
    : esc(t('ops.admin.kendala_nihil')));
  if (next) statusLineParts.push(`${esc(t('ops.admin.berikutnya_label'))}: <b>${esc(chainLabel(next.chain.id, t))} ${esc(fmt.tanggalWaktu(next.date.toISOString()))}</b>`);

  /* ── Banner kendala ───────────────────────────────────────────────────── */
  function troubleBannerHTML() {
    const rows = [];
    for (const o of obst) {
      if (o.kind === 'chain') {
        rows.push(`<li class="trouble-row"><span class="badge warn">✕ ${esc(t('ops.admin.tahap_status.gagal'))}</span>
          <span><b>${esc(t('ops.admin.kendala_chain', { nama: o.nama }))}</b>${o.sejak ? ` — <span class="cap">${esc(t('ops.admin.kendala_chain_sejak', { waktu: fmt.tanggalWaktu(o.sejak) }))}</span>` : ''}</span></li>`);
      } else if (o.kind === 'macet') {
        rows.push(`<li class="trouble-row"><span class="badge warn is-critical">! ${esc(t('ops.admin.tahap_status.macet'))}</span>
          <span><b>${esc(o.nama)}</b> — ${esc(t('ops.agen.stuck_macet', { sejak: o.sejak ? fmt.tanggalWaktu(o.sejak) : '—' }))}</span></li>`);
      } else {
        rows.push(`<li class="trouble-row"><span class="badge warn">✕ ${esc(t('ops.admin.tahap_status.gagal'))}</span>
          <span><b>${esc(o.nama)}</b> — ${esc(o.beruntun > 0 ? t('ops.agen.stuck_gagal', { n: fmt.int(o.beruntun) }) : t('ops.agen.status_gagal'))}${o.sejak ? ` · <span class="cap">${esc(t('ops.agen.stuck_sejak', { sejak: fmt.tanggal(o.sejak) }))}</span>` : ''}</span></li>`);
      }
    }
    for (const iss of openIssues) {
      const sev = String(iss.severity || '').toLowerCase();
      const cls = /critical|high/.test(sev) ? 'warn' : 'note';
      rows.push(`<li class="trouble-row"><span class="badge ${cls}">! ${esc(t('ops.kesehatan.severity.' + sev, null, iss.severity || ''))}</span>
        <span><span class="ref-chip">${esc(iss.id)}</span> ${esc(iss.title)}</span></li>`);
    }
    if (!rows.length) return '';
    return `<div class="callout warn trouble-banner ops-trouble" role="alert" style="margin-bottom:16px">
      <div class="co-title">! ${esc(t('ops.admin.status_ada_kendala', { n: fmt.int(kendalaTotal) }))}</div>
      <ul class="trouble-list">${rows.join('')}</ul>
      <a class="textlink" href="#/ops/kesehatan" style="margin-top:10px;display:inline-block">${esc(t('ops.admin.kendala_periksa'))} →</a>
    </div>`;
  }

  /* ── Render halaman ───────────────────────────────────────────────────── */
  el.innerHTML = `
  <header class="pagehead">
    <div>
      <div class="eyebrow">${esc(t('nav.ops.label'))}</div>
      <h1 class="display-l">${esc(t('ops.pipeline.judul'))}</h1>
      <p class="sub">${esc(t('nav.ops.pipeline.deskripsi'))}</p>
    </div>
  </header>

  <p class="autonomy-line cap" role="note">
    <span class="dot dot-ok" aria-hidden="true"></span>
    <span>${esc((ops.autonomy && ops.autonomy.teks) || t('ops.agen.autonomy'))}</span>
  </p>

  ${troubleBannerHTML()}

  <article class="card status-card ${kendalaTotal ? 'has-trouble' : 'all-ok'}">
    <div class="status-head">
      <span class="status-dot ${kendalaTotal ? 'dot-warn' : 'dot-ok'}" aria-hidden="true"></span>
      <div class="eyebrow">${esc(t('ops.admin.ringkasan_judul'))}</div>
    </div>
    <p class="status-line">${statusLineParts.join(' <span class="status-sep" aria-hidden="true">·</span> ')}</p>
    <div class="status-grid">
      <div class="status-cell">
        <span class="sc-k">${esc(t('ops.admin.proses_label'))}</span>
        <span class="sc-v">${running ? `<span class="badge tip">◐ ${esc(running.nama)}</span>` : (lastDone ? `<span class="badge ok">✓ ${esc(lastDone.nama)}</span>` : `<span class="badge plain">◌ ${esc(t('ops.admin.proses_idle'))}</span>`)}</span>
        ${lastDone && !running ? `<span class="sc-sub">${esc(t('ops.admin.tahap_terakhir', { waktu: fmt.tanggalWaktu(lastDone.last_success) }))}</span>` : ''}
      </div>
      <div class="status-cell">
        <span class="sc-k">${esc(t('ops.admin.kendala_label'))}</span>
        <span class="sc-v">${kendalaTotal
    ? `<span class="badge warn">! ${esc(t('ops.admin.kendala_jumlah', { n: fmt.int(kendalaTotal) }))}</span>`
    : `<span class="badge ok">✓ ${esc(t('ops.admin.kendala_nihil'))}</span>`}</span>
      </div>
      <div class="status-cell">
        <span class="sc-k">${esc(t('ops.admin.progres_label'))}</span>
        <span class="sc-v"><b class="num">${esc(fmt.int(doneSteps))}</b><span class="sc-of">/${esc(fmt.int(totalSteps))}</span> ${esc(t('ops.admin.langkah_satuan'))}</span>
        <div class="progress" role="img" aria-label="${esc(t('ops.admin.progres_nilai', { done: fmt.int(doneSteps), total: fmt.int(totalSteps) }))}"><i style="width:${totalSteps ? Math.round((doneSteps / totalSteps) * 100) : 0}%"></i></div>
      </div>
      <div class="status-cell">
        <span class="sc-k">${esc(t('ops.admin.berikutnya_label'))}</span>
        ${next ? `<span class="sc-v"><span class="num" id="status-cd">—</span></span><span class="sc-sub">${esc(chainLabel(next.chain.id, t))} · ${esc(fmt.tanggalWaktu(next.date.toISOString()))}</span>` : `<span class="sc-v"><span class="badge plain">◌ ${esc(t('umum.kosong'))}</span></span>`}
      </div>
    </div>
  </article>

  <article class="card" style="margin-top:14px">
    <div class="cell-head">
      <div>
        <div class="eyebrow">${esc(t('ops.admin.tahap_judul'))}</div>
        <p class="panel-sub">${esc(t('ops.admin.tahap_sub'))}</p>
      </div>
    </div>
    <div class="cyc-seg seg" id="chain-seg" role="tablist" aria-label="${esc(t('ops.admin.siklus_label'))}">
      ${chains.map((c, i) => `<button role="tab" aria-selected="${i === chainSel}" data-chain="${i}" class="${i === chainSel ? 'active' : ''}">
        <span aria-hidden="true">${esc(chainGlyph(c.id))}</span> ${esc(chainLabel(c.id, t))}</button>`).join('')}
    </div>
    <div class="cap cyc-meta" id="chain-meta"></div>
    <div id="chain-flow"></div>
    <p class="cap tahap-legend" id="tahap-legend"></p>
  </article>

  <article class="card sched-card" style="margin-top:14px">
    <div class="eyebrow">${esc(t('ops.admin.jadwal_label'))}</div>
    <p class="sched-line">${esc(t('ops.admin.jadwal_ringkas'))}</p>
    <div class="sched-cycles">
      ${chains.map((c) => {
    const n = c.schedule_cron ? cron.nextUTC(c.schedule_cron, now) : null;
    const isNext = next && c.id === next.chain.id;
    return `<div class="sched-cyc${isNext ? ' is-next' : ''}">
        <span class="sched-glyph" aria-hidden="true">${esc(chainGlyph(c.id))}</span>
        <span class="sched-name">${esc(chainLabel(c.id, t))}</span>
        <span class="sched-when">${esc(c.schedule_human || '')}</span>
        ${n ? `<span class="sched-next cap">${isNext ? esc(t('ops.admin.berikutnya_label')) + ': ' : ''}${esc(fmt.tanggal(n.toISOString()))}</span>` : ''}
      </div>`;
  }).join('')}
    </div>
  </article>

  ${manualTriggerCardHtml(ctx)}

  <details class="disclose ops-disclose" style="margin-top:14px">
    <summary>
      <span class="dsc-title">${esc(t('ops.admin.data_kandidat_judul'))}</span>
      <span class="dsc-sub">${esc(t('ops.admin.data_kandidat_sub'))}</span>
    </summary>
    <div class="dsc-body">
      <section class="bento" style="margin-top:6px">
        <article class="card b-wide chart-card">
          <div class="eyebrow">${esc(t('ops.pipeline.funnel_judul'))}</div>
          <div id="funnel-wrap" style="margin-top:10px;flex:1"></div>
        </article>
        <article class="card b-side">
          <div class="eyebrow">${esc(t('ops.pipeline.kolom.wps'))} — ${esc(t('ops.status.reported'))}</div>
          ${reported.length ? `
          <div class="tbl-scroll" style="margin-top:10px"><table class="tbl">
            <thead><tr><th>#</th><th>${esc(t('ops.pipeline.kolom.id'))}</th><th>${esc(t('ops.pipeline.kolom.nama'))}</th><th>${esc(t('ops.pipeline.kolom.wps'))}</th><th>QA</th></tr></thead>
            <tbody>
              ${reported.map((r) => `<tr>
                <td class="td-num">${esc(fmt.int(r.rank))}</td>
                <td class="td-id">${esc(r.id)}</td>
                <td>${esc(r.nama || '')}</td>
                <td class="td-num"><b>${esc(fmt.int(r.wps))}</b></td>
                <td><span class="badge ${/^PASS\b/.test(r.qa || '') ? 'ok' : 'warn'}">${esc(r.qa || t('umum.kosong'))}</span></td>
              </tr>`).join('')}
            </tbody>
          </table></div>` : ui.empty('empty.peluang.galeri')}
        </article>
      </section>

      <article class="card" style="margin-top:14px">
        <div class="eyebrow">${esc(t('ops.pipeline.kandidat_judul'))}</div>
        <div class="filters">
          <input class="input" type="search" id="cand-q" placeholder="${esc(t('ops.pipeline.cari'))}" style="max-width:320px" aria-label="${esc(t('ops.pipeline.cari'))}">
          <select class="select" id="cand-status" aria-label="${esc(t('ops.pipeline.kolom.status'))}">
            <option value="semua">${esc(t('ops.status.semua'))}</option>
            ${statusOrder.map((s) => `<option value="${esc(s)}">${esc(t('ops.status.' + s, null, s))}</option>`).join('')}
          </select>
        </div>
        <p class="cap" id="cand-count" style="margin:10px 0 4px"></p>
        <div id="cand-table"></div>
      </article>

      <article class="card" style="margin-top:14px">
        <div class="eyebrow">${esc(t('beranda.aktivitas.judul'))}</div>
        ${(ops.activity || []).length ? `
        <ul class="feed">
          ${(ops.activity || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 4).map((day) => (day.entries || []).map((e) => `
            <li><span class="f-dot f-tip" aria-hidden="true"></span>
            <span><b>${esc(humanSkill(e.skill, ops))}</b> — ${esc(e.summary)} <span class="f-date">${esc(fmt.tanggal(day.date))}</span></span></li>`).join('')).join('')}
        </ul>` : ui.empty('empty.beranda.aktivitas')}
      </article>
    </div>
  </details>

  ${requestLogOpsHtml(ctx)}`;

  /* Timer/poll cleanup terkumpul (pemicu chain + tahap). Diberangus saat view ganti. */
  const manualTimers = [];

  /* ── Timeline tahap (per chain terpilih) ──────────────────────────────── */
  function renderChain() {
    const c = chains[chainSel];
    const flowEl = el.querySelector('#chain-flow');
    const metaEl = el.querySelector('#chain-meta');
    const legendEl = el.querySelector('#tahap-legend');
    if (!c) { flowEl.innerHTML = ui.empty('empty.ops.pipeline'); metaEl.textContent = ''; legendEl.textContent = ''; return; }
    const nodes = chainNodes(c, ops);
    const prog = chainProgress(nodes);
    const n = c.schedule_cron ? cron.nextUTC(c.schedule_cron, now) : null;

    /* ── Map node (per-skill, flattened) → step (per-aeon.yml) ──────────────
       chainNodes() men-flatten c.steps[].skills[] berurutan; trigger steps[] di-derive
       dari chain yang SAMA di builder. Bangun nodeStep[]: untuk tiap node, step idx +
       apakah node PERTAMA dari step itu (parallel group = 1 tombol di node pertama).
       Tombol per-tahap HANYA muncul bila chain ada di pipeline_trigger (allowlist) +
       enabled. Mapping pakai c.steps (sumber yang sama dipakai chainNodes) → robust. */
    const trigSteps = triggerStepsFor(ctx, c.id);
    const canFire = trigSteps.length > 0; /* enabled + chain di allowlist trigger */
    const nodeStep = [];
    {
      let ni = 0;
      (c.steps || []).forEach((st, si) => {
        const sk = Array.isArray(st.skills) ? st.skills : [];
        sk.forEach((_, k) => {
          nodeStep[ni] = { stepIdx: si, firstOfStep: k === 0, trig: trigSteps[si] || null };
          ni += 1;
        });
      });
    }

    metaEl.innerHTML = `${esc(c.schedule_human || '')}
      ${nodes.length ? ` · <span class="num">${esc(t('ops.admin.progres_nilai', { done: fmt.int(prog.done), total: fmt.int(nodes.length) }))}</span>` : ''}
      ${n ? ` · ${esc(t('ops.admin.berikutnya_label'))}: <span class="num">${esc(fmt.tanggalWaktu(n.toISOString()))}</span>` : ''}`;

    flowEl.innerHTML = `<ol class="tline" aria-label="${esc(t('ops.admin.tahap_judul'))}">
      ${nodes.map((nd, i) => {
    const m = stepMetaInline(nd.state);
    const isCurrent = i === prog.currentIdx && nd.state !== 'selesai';
    const ns = nodeStep[i] || { stepIdx: i, firstOfStep: true, trig: null };
    /* Tombol per-tahap di node PERTAMA tiap step (parallel group = 1 tombol). */
    const showFire = canFire && ns.firstOfStep && ns.trig;
    const fireBtn = showFire ? `
            <button type="button" class="tline-fire" data-fire-step="${esc(String(ns.stepIdx))}"
              aria-label="${esc(t('ops.manual.step_aria', { n: ns.stepIdx + 1, nama: ns.trig.label || nd.nama }, 'Jalankan tahap {n}: {nama}'))}">
              <span aria-hidden="true">▶</span> ${esc(t('ops.manual.step_tombol', null, 'Jalankan tahap ini'))}
            </button>
            <div class="tline-fire-confirm" data-fire-confirm="${esc(String(ns.stepIdx))}" role="note" aria-live="polite" hidden></div>` : '';
    return `<li class="tline-step tline-${nd.state}${isCurrent ? ' tline-current' : ''}">
        <button class="tline-node" data-node="${esc(nd.sk)}"
          aria-label="${esc(t('ops.pipeline.step', { n: i + 1 }))}: ${esc(nd.nama)} — ${esc(m.label)}">
          <span class="tline-rail" aria-hidden="true"><span class="tline-marker">${esc(m.sym)}</span></span>
          <span class="tline-content">
            <span class="tline-cap">${esc(t('ops.pipeline.step', { n: i + 1 }))}${isCurrent ? ` · ${esc(t('ops.admin.tahap_sekarang'))}` : ''}</span>
            <span class="tline-name">${esc(nd.nama)}</span>
            <span class="tline-status badge ${m.cls}">${esc(m.sym)} ${esc(m.label)}</span>
            <span class="tline-when cap">${nd.state === 'selesai' && nd.last_success ? esc(t('ops.admin.tahap_terakhir', { waktu: fmt.tanggalWaktu(nd.last_success) })) : (nd.state === 'menunggu' ? esc(t('ops.admin.tahap_belum')) : '')}${nd.gagal_lebih_baru && nd.gagal ? ` · <span class="warn-text">${esc(t('ops.admin.tahap_percobaan_dibatalkan', { tgl: fmt.tanggal(nd.gagal) }))}</span>` : ''}</span>
          </span>
        </button>${fireBtn}
      </li>`;
  }).join('')}
    </ol>
    ${canFire ? `<p class="cap tline-fire-hint" role="note"><span aria-hidden="true">↻</span> ${esc(t('ops.manual.step_hint', null, 'Tahap gagal? Jalankan ulang tahap itu atau lanjut dari tahap berikutnya — tanpa mengulang dari awal.'))}</p>` : ''}`;

    legendEl.innerHTML = `
      <span><span class="lg ok" aria-hidden="true">✓</span> ${esc(t('ops.admin.tahap_status.selesai'))}</span>
      <span><span class="lg tip" aria-hidden="true">◐</span> ${esc(t('ops.admin.tahap_status.berjalan'))}</span>
      <span><span class="lg plain" aria-hidden="true">◌</span> ${esc(t('ops.admin.tahap_status.menunggu'))}</span>
      <span><span class="lg warn" aria-hidden="true">✕</span> ${esc(t('ops.admin.tahap_status.gagal'))}</span>
      <span><span class="lg warn" aria-hidden="true">!</span> ${esc(t('ops.admin.tahap_status.macet'))}</span>`;

    flowEl.querySelectorAll('[data-node]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = (ops.agents || []).find((x) => x.id === btn.getAttribute('data-node'));
        if (a) openAgentDrawer(a, ctx);
      });
    });

    /* ── Tombol "Jalankan tahap ini" — konfirmasi (tampilkan dep) lalu fireStep ── */
    if (canFire) bindStepFire(flowEl, c, trigSteps);
  }

  /* Binding tombol per-tahap: klik → drawer konfirmasi (nama tahap + dep consume[]) →
     fireStep(chain, idx) → trackStep. Klik kedua = kirim; tombol Batal menutup. */
  function bindStepFire(flowEl, c, trigSteps) {
    flowEl.querySelectorAll('[data-fire-step]').forEach((btn) => {
      const idx = parseInt(btn.getAttribute('data-fire-step'), 10);
      const stepDef = trigSteps[idx];
      if (!stepDef) return;
      const confirmEl = flowEl.querySelector(`[data-fire-confirm="${idx}"]`);
      const stepName = stepDef.label || (stepDef.skills || []).join(' + ') || `#${idx + 1}`;
      const deps = Array.isArray(stepDef.consume) ? stepDef.consume : [];

      let open = false;
      const close = () => { open = false; if (confirmEl) { confirmEl.hidden = true; confirmEl.innerHTML = ''; } };

      btn.addEventListener('click', () => {
        if (open) { close(); return; }
        open = true;
        if (!confirmEl) return;
        const depHuman = deps.map((d) => humanSkill(d, ops));
        const depHtml = depHuman.length
          ? `<div class="tfc-dep"><span class="tfc-dep-k">${esc(t('ops.manual.step_konfirmasi_dep', null, 'Memakai hasil tahap sebelumnya:'))}</span> ${depHuman.map((d) => `<span class="ref-chip">${esc(d)}</span>`).join(' ')}</div>`
          : `<p class="cap tfc-dep-none">${esc(t('ops.manual.step_konfirmasi_dep_kosong', null, 'Tahap ini tidak bergantung pada hasil tahap lain.'))}</p>`;
        confirmEl.hidden = false;
        confirmEl.innerHTML = `
          <div class="tfc-head"><span class="tfc-ico" aria-hidden="true">!</span><b>${esc(t('ops.manual.step_konfirmasi_judul', { nama: stepName }, 'Jalankan tahap "{nama}"?'))}</b></div>
          <p class="cap">${esc(t('ops.manual.step_konfirmasi_pesan', null, 'Hanya tahap ini yang dijalankan ulang di cloud — tahap lain tidak terganggu.'))}</p>
          ${depHtml}
          <div class="tfc-actions">
            <button type="button" class="cta" data-tfc-go>${esc(t('ops.manual.step_konfirmasi_tombol', null, 'Ya, jalankan tahap ini'))}</button>
            <button type="button" class="btn-ghost" data-tfc-cancel>${esc(t('umum.batal', null, 'Batal'))}</button>
          </div>
          <div class="tfc-msg" role="status" aria-live="polite"></div>`;

        const goBtn = confirmEl.querySelector('[data-tfc-go]');
        const cancelBtn = confirmEl.querySelector('[data-tfc-cancel]');
        const msgEl = confirmEl.querySelector('.tfc-msg');
        if (cancelBtn) cancelBtn.addEventListener('click', close);
        if (goBtn) goBtn.addEventListener('click', async () => {
          goBtn.disabled = true;
          goBtn.innerHTML = `<span class="spinner"></span> ${esc(t('ops.manual.mengirim', null, 'Mengirim…'))}`;
          try {
            await fireStep(ctx, c.id, idx);
            trackStep(msgEl, ctx, stepName, manualTimers);
          } catch (err) {
            let pesan = err && err.message;
            if (err && err.code === 'TOKEN') pesan = t('ops.manual.token_invalid', null, 'Akses pemicu sudah kedaluwarsa — pengelola perlu memperbaruinya dulu.');
            if (msgEl) msgEl.innerHTML = `<div class="callout warn"><p>${esc(t('ops.manual.step_error', { pesan }, 'Gagal menjalankan tahap: {pesan}. Coba lagi sebentar, atau hubungi pengelola bila terus berulang.'))}</p></div>`;
          } finally {
            goBtn.disabled = false;
            goBtn.innerHTML = esc(t('ops.manual.step_konfirmasi_tombol', null, 'Ya, jalankan tahap ini'));
          }
        });
      });
    });
  }

  /* Properti tampilan satu kode tahap (simbol + kelas warna + teks) — WCAG:
     status TIDAK pernah warna-saja. Lokal supaya satu file (whitelist publish). */
  function stepMetaInline(state) {
    const map = {
      selesai: { sym: '✓', cls: 'ok', label: t('ops.admin.tahap_status.selesai') },
      berjalan: { sym: '◐', cls: 'tip', label: t('ops.admin.tahap_status.berjalan') },
      menunggu: { sym: '◌', cls: 'plain', label: t('ops.admin.tahap_status.menunggu') },
      gagal: { sym: '✕', cls: 'warn', label: t('ops.admin.tahap_status.gagal') },
      macet: { sym: '!', cls: 'warn', label: t('ops.admin.tahap_status.macet') },
    };
    return map[state] || map.menunggu;
  }

  el.querySelectorAll('[data-chain]').forEach((btn) => {
    btn.addEventListener('click', () => {
      chainSel = parseInt(btn.getAttribute('data-chain'), 10);
      el.querySelectorAll('[data-chain]').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
      });
      renderChain();
    });
  });

  /* ── Countdown live (status card) ─────────────────────────────────────── */
  let timer = null;
  function tickCountdown() {
    const cd = el.querySelector('#status-cd');
    if (!cd || !next) return;
    const d = fmt.durasi(next.date.getTime() - Date.now());
    cd.textContent = d ? `${d.n1} ${d.u1}${d.n2 ? ' ' + d.n2 + ' ' + d.u2 : ''}` : fmt.tanggalWaktu(next.date.toISOString());
  }
  if (next) { tickCountdown(); timer = setInterval(tickCountdown, 30000); }

  /* ── Funnel (di dalam disclosure) ─────────────────────────────────────── */
  function renderFunnel() {
    const wrap = el.querySelector('#funnel-wrap');
    if (!wrap) return;
    if (!statusOrder.length) { wrap.innerHTML = ui.empty('empty.ops.pipeline'); return; }
    const rows = statusOrder.map((s) => ({
      label: t('ops.status.' + s, null, s), value: funnel[s] || 0,
      pct: funnelTotal ? Math.round(((funnel[s] || 0) / funnelTotal) * 100) : 0,
    }));
    const aria = `${esc(t('ops.pipeline.funnel_judul'))}: ${esc(rows.map((r) => `${r.label} ${r.value} (${r.pct}%)`).join('; '))} · total ${esc(fmt.int(funnelTotal))}`;
    if (!charts.ok) {
      wrap.innerHTML = ui.chartFallback(rows.map((r) => `<span class="num">${esc(String(r.value))}</span> · ${esc(r.label)} (${esc(String(r.pct))}%)`).join('<br>'));
      return;
    }
    wrap.innerHTML = `<div class="chart-box" id="funnel-chart" role="img" aria-label="${aria}" style="min-height:${rows.length * 40 + 20}px"></div>`;
    const tok = charts.tokens();
    const c = charts.init(wrap.querySelector('#funnel-chart'));
    if (!c) return;
    c.setOption({
      ...charts.ANIM,
      grid: { left: 8, right: 70, top: 4, bottom: 4, containLabel: true },
      tooltip: { show: false },
      xAxis: { type: 'value', show: false },
      yAxis: {
        type: 'category', inverse: true, data: rows.map((r) => r.label),
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: tok.text1, fontFamily: tok.body, fontSize: 12, fontWeight: 600 },
      },
      series: [{
        type: 'bar', barWidth: 13, silent: true,
        itemStyle: { color: tok.chart, borderRadius: [0, 3, 3, 0] },
        label: {
          show: true, position: 'right', color: tok.text2, fontFamily: tok.mono, fontSize: 11,
          formatter: (p) => `${fmt.int(p.value)} · ${rows[p.dataIndex].pct}%`,
        },
        data: rows.map((r) => r.value),
      }],
    });
  }

  /* ── Tabel kandidat ───────────────────────────────────────────────────── */
  function filteredCandidates() {
    let rows = candidates.slice();
    const needle = q.trim().toLowerCase();
    if (needle) {
      rows = rows.filter((c) => [c.id, c.nama, c.brand, c.kategori, c.negara_asal]
        .map((x) => String(x || '')).join(' ').toLowerCase().includes(needle));
    }
    if (fStatus !== 'semua') rows = rows.filter((c) => c.status === fStatus);
    rows.sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      let cmp;
      if (typeof av === 'number' || typeof bv === 'number') {
        const an = (av === null || av === undefined) ? -Infinity : av;
        const bn = (bv === null || bv === undefined) ? -Infinity : bv;
        cmp = an < bn ? -1 : an > bn ? 1 : 0;
      } else cmp = String(av || '').localeCompare(String(bv || ''));
      if (cmp === 0) cmp = String(a.id || '').localeCompare(String(b.id || ''));
      return cmp * sortDir;
    });
    return rows;
  }

  function renderTable() {
    const wrap = el.querySelector('#cand-table');
    if (!wrap) return;
    const rows = filteredCandidates();
    el.querySelector('#cand-count').textContent = t('ops.pipeline.ditampilkan', { n: fmt.int(rows.length) });
    if (!rows.length) { wrap.innerHTML = ui.empty('empty.peluang.filter'); return; }
    const arrow = (k) => (sortKey === k ? (sortDir === 1 ? ' ↑' : ' ↓') : '');
    const ariaSort = (k) => (sortKey === k ? (sortDir === 1 ? 'ascending' : 'descending') : 'none');
    const sortHead = (k, label) =>
      `<th class="th-sort td-num" data-sort="${k}" role="columnheader" tabindex="0" aria-sort="${ariaSort(k)}">${esc(label)}${arrow(k)}</th>`;
    wrap.innerHTML = `<div class="tbl-scroll"><table class="tbl tbl-stack">
      <thead><tr>
        <th scope="col">${esc(t('ops.pipeline.kolom.id'))}</th>
        <th scope="col">${esc(t('ops.pipeline.kolom.nama'))}</th>
        <th scope="col">${esc(t('ops.pipeline.kolom.kategori'))}</th>
        <th scope="col">${esc(t('ops.pipeline.kolom.status'))}</th>
        ${sortHead('skor', t('ops.pipeline.kolom.skor'))}
        ${sortHead('wps', t('ops.pipeline.kolom.wps'))}
        ${sortHead('tanggal', t('ops.pipeline.kolom.tanggal'))}
      </tr></thead>
      <tbody>
      ${rows.map((c) => `
        <tr class="row-click" data-expand="${esc(c.id)}" tabindex="0">
          <td class="td-id" data-label="${esc(t('ops.pipeline.kolom.id'))}">${esc(c.id)}</td>
          <td data-label="${esc(t('ops.pipeline.kolom.nama'))}"><b>${esc(c.nama || '')}</b>${c.brand ? `<span class="cap" style="display:block">${esc(c.brand)}</span>` : ''}</td>
          <td data-label="${esc(t('ops.pipeline.kolom.kategori'))}">${esc(c.kategori || '')}</td>
          <td data-label="${esc(t('ops.pipeline.kolom.status'))}">${statusBadge(c.status)}</td>
          <td class="td-num" data-label="${esc(t('ops.pipeline.kolom.skor'))}">${esc(fmt.int(c.skor))}</td>
          <td class="td-num" data-label="${esc(t('ops.pipeline.kolom.wps'))}">${c.wps === null || c.wps === undefined ? `<span class="chip-belum">◌</span>` : `<b>${esc(fmt.int(c.wps))}</b>`}</td>
          <td class="td-num" data-label="${esc(t('ops.pipeline.kolom.tanggal'))}">${esc(fmt.tanggal(c.tanggal))}</td>
        </tr>
        ${expandId === c.id ? `<tr class="row-detail"><td colspan="7">
          <b>${esc(t('ops.pipeline.alasan'))}:</b> ${esc(c.alasan || t('umum.kosong'))}
          ${c.alasan_gatekeeper ? ` · <b>${esc(t('ops.pipeline.gatekeeper'))}:</b> ${esc(c.alasan_gatekeeper)}` : ''}
          ${c.negara_asal ? ` · <b>${esc(t('ops.pipeline.asal'))}:</b> ${esc(c.negara_asal)}` : ''}
        </td></tr>` : ''}`).join('')}
      </tbody>
    </table></div>`;

    wrap.querySelectorAll('.th-sort').forEach((th) => {
      const sort = (restoreFocus) => {
        const k = th.getAttribute('data-sort');
        if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = -1; }
        renderTable();
        if (restoreFocus) {
          const nx = wrap.querySelector(`.th-sort[data-sort="${k}"]`);
          if (nx) nx.focus();
        }
      };
      th.addEventListener('click', () => sort(false));
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(true); } });
    });
    wrap.querySelectorAll('[data-expand]').forEach((tr) => {
      const toggle = () => {
        const id = tr.getAttribute('data-expand');
        expandId = expandId === id ? null : id;
        renderTable();
      };
      tr.addEventListener('click', toggle);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });
  }

  /* Disclosure kandidat: render chart/tabel saat pertama dibuka (lazy — hindari
     chart 0-size di elemen tersembunyi). */
  const disclose = el.querySelector('.ops-disclose');
  let candRendered = false;
  function ensureCandRendered() {
    if (candRendered) return;
    candRendered = true;
    renderFunnel();
    renderTable();
    const qEl = el.querySelector('#cand-q');
    const sEl = el.querySelector('#cand-status');
    if (qEl) qEl.addEventListener('input', (e) => { q = e.target.value; renderTable(); });
    if (sEl) sEl.addEventListener('change', (e) => { fStatus = e.target.value; renderTable(); });
  }
  if (disclose) disclose.addEventListener('toggle', () => { if (disclose.open) ensureCandRendered(); });

  renderChain();

  /* ── Pemicu manual (fallback) — OPS-gated; aktif hanya bila pipeline_trigger.enabled ── */
  bindManualTrigger(el, ctx, manualTimers);

  const onRecharts = () => { if (candRendered) renderFunnel(); };
  document.addEventListener('pimas:recharts', onRecharts);
  return () => {
    if (timer) clearInterval(timer);
    document.removeEventListener('pimas:recharts', onRecharts);
    manualTimers.forEach((fn) => { try { fn(); } catch { /* abaikan */ } });
  };
}
