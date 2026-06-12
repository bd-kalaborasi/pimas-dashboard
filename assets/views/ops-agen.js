/*
 * View: Ops › Agen — port fungsional view "agents" v2 dengan komponen v3:
 * grid kartu agent (status dot, model, trigger, aktivitas terakhir, jadwal
 * berikutnya, token/run, instinct) + panel detail (drawer §4.18: peran, DoD,
 * alur data consumes→outputs, instincts + confidence). Plane teknis — istilah
 * internal boleh (DESIGN §1.4).
 *
 * Lapisan tambahan v3: "Ruang kerja agen" — visualisasi pixel-art per agen
 * (replikasi aestetika ekstensi pixel-agents secara client-side, sprite
 * prosedural-deterministik via assets/pixel-agents.js). Toggle dua mode:
 * Ruang kerja (default) + Daftar detail (kartu existing). Klik karakter ATAU
 * kartu → drawer jobdesk yang SAMA (peran/DoD/alur/instinct) — viz adalah
 * lapisan, bukan pengganti.
 */

import { spriteSVG } from '../pixel-agents.js';

export function agentStatus(a, now) {
  if (!a || !a.enabled) return 'err';
  const d = a.last_activity && a.last_activity.date;
  if (!d) return 'warn';
  const age = (now - new Date(d + 'T00:00:00Z').getTime()) / 86400000;
  return age <= 7 ? 'ok' : 'warn';
}

/* Status ruang kerja: gabungan cron_state (keandalan run) + last_activity +
   enabled → 'aktif' | 'idle' | 'gagal'.
   - gagal: run terakhir failed ATAU ada kegagalan beruntun (>0).
   - aktif: enabled, run terakhir tidak gagal, dan ada aktivitas ≤7 hari.
   - idle:  enabled tapi aktivitas usang / tak ada entri cron (menunggu jadwal),
            atau agent disabled (diam, redup). */
export function agentWorkState(a, ops, now) {
  const cs = (ops && ops.cron_state) || {};
  const c = cs[a && a.id] || (a && a.chain ? cs['chain:' + a.chain] : null);
  if (c && (c.last_status === 'failed' || (c.consecutive_failures || 0) > 0)) return 'gagal';
  if (!a || !a.enabled) return 'idle';
  const d = a.last_activity && a.last_activity.date;
  if (!d) return 'idle';
  const age = (now - new Date(d + 'T00:00:00Z').getTime()) / 86400000;
  return age <= 7 ? 'aktif' : 'idle';
}

export function agentNext(a, ctx) {
  const { ops, t, fmt, cron } = ctx;
  if (!a) return t('umum.kosong');
  if (a.trigger === 'cron' && a.schedule_cron) {
    const n = cron.nextUTC(a.schedule_cron, new Date());
    return n ? fmt.tanggalWaktu(n.toISOString()) : (a.schedule_human || t('umum.kosong'));
  }
  if (a.trigger === 'chain' && a.chain) {
    const c = (ops.chains || []).find((x) => x.id === a.chain);
    const n = c && c.schedule_cron ? cron.nextUTC(c.schedule_cron, new Date()) : null;
    return `${t('ops.pipeline.step', { n: a.step_index ?? '?' })} · ${a.chain}${n ? ' · ' + fmt.tanggalWaktu(n.toISOString()) : ''}`;
  }
  return a.schedule_human || a.trigger || t('umum.kosong');
}

export function agentInstincts(ops, id) {
  const hit = (ops.instincts || []).find((x) => x.skill === id);
  return hit ? (hit.items || []) : [];
}

export function openAgentDrawer(a, ctx) {
  const { ops, t, esc, fmt, ui, drawer } = ctx;
  const inst = agentInstincts(ops, a.id);
  const flow = `
    <div class="flow-line">
      ${(a.consumes || []).map((cn) => `<span class="chip mono">${esc(cn)}</span>`).join('')}
      ${(a.consumes || []).length ? '<span aria-hidden="true">→</span>' : ''}
      <span class="badge half">${esc(a.id)}</span>
      ${(a.outputs || []).length ? '<span aria-hidden="true">→</span>' : ''}
      ${(a.outputs || []).map((o) => `<span class="chip mono">${esc(o)}</span>`).join('')}
    </div>`;

  const sec = (label, html) => `<div><div class="meta-rows"><div><span class="k">${esc(label)}</span><span class="v">${html}</span></div></div></div>`;

  drawer.open({
    title: `${esc(a.nama || a.id)} <span class="opp-id" style="display:block;margin-top:2px">${esc(a.id)}</span>`,
    body: `
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <span class="chip mono">${esc(a.model || a.model_short || '')}</span>
        <span class="chip">${esc(t('ops.agen.trigger'))}: ${esc(a.trigger || '')}</span>
        <span class="badge ${a.enabled ? 'ok' : 'warn'}">${a.enabled ? '● ' + esc(t('ops.agen.enabled')) : '✕ ' + esc(t('ops.agen.disabled'))}</span>
      </div>
      ${sec(t('ops.agen.peran', null, 'Peran'), esc(a.peran || t('umum.kosong')))}
      ${sec(t('ops.pipeline.jadwal'), `${esc(a.schedule_human || t('umum.kosong'))}${a.schedule_cron ? ` <span class="ref-chip">${esc(a.schedule_cron)}</span>` : ''}<br><span class="cap">${esc(t('ops.agen.berikutnya'))}: ${esc(agentNext(a, ctx))}</span>`)}
      ${sec(t('ops.agen.dod', null, 'Definition of done'), esc(a.dod || t('umum.kosong')))}
      ${sec(t('ops.agen.alur_data', null, 'Alur data'), flow)}
      ${sec(t('ops.agen.aktivitas_terakhir'), a.last_activity
    ? `${esc(a.last_activity.summary)} <span class="cap">(${esc(fmt.tanggal(a.last_activity.date))})</span>`
    : esc(t('ops.agen.belum_ada_aktivitas')))}
      <div class="kv-grid">
        <div class="kv"><span class="kv-v">${esc(fmt.int(a.tokens_avg))}</span><span class="kv-k">${esc(t('ops.agen.token_per_run', { n: '' }).replace('≈', '').trim() || 'token/run')}</span></div>
        <div class="kv"><span class="kv-v">${esc(fmt.int(a.instinct_count || 0))}</span><span class="kv-k">${esc(t('ops.kesehatan.instinct_judul'))}</span></div>
      </div>
      ${inst.length ? `<div>
        <div class="eyebrow" style="margin-bottom:6px">${esc(t('ops.kesehatan.instinct_judul'))}</div>
        ${inst.map((it) => `
        <div class="instinct-item">
          <span class="ref-chip">${esc(it.id)}</span>
          <p style="margin:4px 0 0">${esc(it.lesson)}</p>
          <div class="conf-bar" title="confidence ${Math.round((it.confidence || 0) * 100)}%"><span style="width:${Math.round((it.confidence || 0) * 100)}%"></span></div>
        </div>`).join('')}
      </div>` : ''}
    `,
  });
}

/* Status ruang kerja → properti tampilan (simbol + warna + teks, WCAG §7.2). */
function workMeta(state, t) {
  if (state === 'gagal') return { sym: '✕', cls: 'gagal', label: t('ops.agen.viz.status.gagal') };
  if (state === 'aktif') return { sym: '●', cls: 'aktif', label: t('ops.agen.viz.status.aktif') };
  return { sym: '◌', cls: 'idle', label: t('ops.agen.viz.status.idle') };
}

/* Satu pos kerja pixel: meja + karakter + nameplate. Tombol aksesibel:
   aria-label "{nama} — {status}", klik/keyboard → drawer jobdesk. */
function deskHTML(a, i, ops, now, ctx) {
  const { t, esc } = ctx;
  const ws = agentWorkState(a, ops, now);
  const m = workMeta(ws, t);
  const nama = a.nama || a.id;
  const role = (a.peran || '').split(/[—·:.;]/)[0].trim().slice(0, 38) || (a.trigger || '');
  return `
    <button class="px-desk-cell px-${m.cls}" data-agent="${i}"
            aria-label="${esc(nama)} — ${esc(m.label)}">
      <span class="px-stage">${spriteSVG(a.id, ws)}</span>
      <span class="px-plate">
        <span class="px-name"><span class="px-dot" aria-hidden="true"></span>${esc(nama)}</span>
        <span class="px-role">${esc(role)}</span>
      </span>
    </button>`;
}

export function render(el, ctx) {
  const { ops, t, esc, fmt, ui } = ctx;
  const agents = ops.agents || [];
  const now = Date.now();

  /* mode tersimpan antar kunjungan (ruang kerja default). */
  let mode = 'workspace';
  try { const s = localStorage.getItem('pimas.agen.mode'); if (s === 'list' || s === 'workspace') mode = s; } catch { /* abaikan */ }

  const counts = { aktif: 0, idle: 0, gagal: 0 };
  agents.forEach((a) => { counts[agentWorkState(a, ops, now)]++; });

  const listHTML = `
  <div class="agent-grid" id="agent-grid">
    ${agents.map((a, i) => {
    const st = agentStatus(a, now);
    return `
    <button class="card agent-card" data-agent="${i}">
      <div class="agent-head">
        <span class="dot dot-${st}" aria-hidden="true"></span>
        <h3>${esc(a.nama || a.id)}</h3>
        <span class="chip mono">${esc(a.model_short || '')}</span>
      </div>
      <p class="agent-role">${esc(a.peran || '')}</p>
      <div class="meta-rows">
        <div><span class="k">${esc(t('ops.agen.trigger'))}</span>
          <span class="v"><span class="chip">${esc(a.trigger || '')}</span> ${esc(a.schedule_human || '')}</span></div>
        <div><span class="k">${esc(t('ops.agen.aktivitas_terakhir'))}</span>
          <span class="v">${a.last_activity ? esc(a.last_activity.summary).slice(0, 220) + ` <span class="cap">(${esc(fmt.tanggal(a.last_activity.date))})</span>` : esc(t('ops.agen.belum_ada_aktivitas'))}</span></div>
      </div>
      <div class="agent-foot">
        <span class="chip mono">${esc(t('ops.agen.token_per_run', { n: fmt.int(a.tokens_avg) }))}</span>
        <span class="chip">${esc(t('ops.agen.instinct', { n: fmt.int(a.instinct_count || 0) }))}</span>
        <span class="badge ${a.enabled ? 'ok' : 'warn'}">${a.enabled ? '●' : '✕'} ${esc(a.enabled ? t('ops.agen.enabled') : t('ops.agen.disabled'))}</span>
      </div>
    </button>`;
  }).join('')}
  </div>
  <p class="cap" style="margin-top:14px;display:flex;gap:16px;flex-wrap:wrap">
    <span><span class="dot dot-ok" aria-hidden="true"></span> ${esc(t('ops.agen.legend.ok'))}</span>
    <span><span class="dot dot-warn" aria-hidden="true"></span> ${esc(t('ops.agen.legend.warn'))}</span>
    <span><span class="dot dot-err" aria-hidden="true"></span> ${esc(t('ops.agen.legend.err'))}</span>
  </p>`;

  const workspaceHTML = `
  <section class="px-office" aria-label="${esc(t('ops.agen.viz.judul'))}">
    <div class="px-floor">
      ${agents.map((a, i) => deskHTML(a, i, ops, now, ctx)).join('')}
    </div>
  </section>
  <p class="cap px-legend">
    <span><span class="px-dot px-leg-aktif" aria-hidden="true"></span> ${esc(t('ops.agen.viz.status.aktif'))} <span class="num">${esc(fmt.int(counts.aktif))}</span></span>
    <span><span class="px-dot px-leg-idle" aria-hidden="true"></span> ${esc(t('ops.agen.viz.status.idle'))} <span class="num">${esc(fmt.int(counts.idle))}</span></span>
    <span><span class="px-dot px-leg-gagal" aria-hidden="true"></span> ${esc(t('ops.agen.viz.status.gagal'))} <span class="num">${esc(fmt.int(counts.gagal))}</span></span>
  </p>`;

  el.innerHTML = `
  <header class="pagehead">
    <div>
      <div class="eyebrow">${esc(t('nav.ops.label'))}</div>
      <h1 class="display-l">${esc(t('ops.agen.judul'))} <span class="num" style="font-size:16px;color:var(--text-3)">${esc(fmt.int(agents.length))}</span></h1>
      <p class="sub">${esc(t('nav.ops.agen.deskripsi'))}</p>
    </div>
    ${agents.length ? `
    <div class="seg" role="tablist" aria-label="${esc(t('ops.agen.viz.judul'))}">
      <button id="mode-workspace" role="tab" data-mode="workspace" aria-selected="${mode === 'workspace'}" class="${mode === 'workspace' ? 'active' : ''}">${esc(t('ops.agen.viz.judul'))}</button>
      <button id="mode-list" role="tab" data-mode="list" aria-selected="${mode === 'list'}" class="${mode === 'list' ? 'active' : ''}">${esc(t('ops.agen.viz.lihat_detail'))}</button>
    </div>` : ''}
  </header>

  ${agents.length ? `
  <p class="px-caption cap" ${mode === 'list' ? 'hidden' : ''} id="px-caption">${esc(t('ops.agen.viz.keterangan'))}</p>
  <div id="agen-body">${mode === 'workspace' ? workspaceHTML : listHTML}</div>`
    : `<div class="card">${ui.empty('empty.ops.agen')}</div>`}`;

  const body = el.querySelector('#agen-body');
  const caption = el.querySelector('#px-caption');

  function bindCells() {
    body.querySelectorAll('[data-agent]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = agents[parseInt(btn.getAttribute('data-agent'), 10)];
        if (a) openAgentDrawer(a, ctx);
      });
    });
  }

  function setMode(next) {
    mode = next;
    try { localStorage.setItem('pimas.agen.mode', next); } catch { /* abaikan */ }
    el.querySelectorAll('.seg [data-mode]').forEach((b) => {
      const on = b.getAttribute('data-mode') === next;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    if (caption) caption.toggleAttribute('hidden', next !== 'workspace');
    body.innerHTML = next === 'workspace' ? workspaceHTML : listHTML;
    bindCells();
  }

  el.querySelectorAll('.seg [data-mode]').forEach((b) => {
    b.addEventListener('click', () => setMode(b.getAttribute('data-mode')));
  });
  if (body) bindCells();

  return undefined;
}
