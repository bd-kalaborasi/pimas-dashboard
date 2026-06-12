/*
 * View: Ops › Pipeline — port fungsional v2 (overview + pipeline) dengan v3:
 * fase sistem, chain flow per step (klik node → drawer agent), countdown run
 * berikutnya (cron UTC), funnel kandidat per status (bar + % konversi, DO §8.18),
 * tabel WPS kandidat dilaporkan (W1–W5), tabel kandidat lengkap (cari/filter/
 * sort/expand alasan), feed aktivitas ops. Plane teknis — jargon internal boleh.
 */

import { openAgentDrawer } from './ops-agen.js';

export function render(el, ctx) {
  const { ops, t, esc, fmt, ui, charts, cron } = ctx;
  const chains = ops.chains || [];
  const agents = ops.agents || [];
  const candidates = ops.candidates || [];
  const reported = ops.reported || [];
  const funnel = (ops.funnel || {}).by_status || {};
  const funnelTotal = (ops.funnel || {}).total || 0;

  const agentById = (id) => agents.find((a) => a.id === id) || null;
  const statusOrder = ['raw', 'shortlist', 'parked', 'rejected', 'reported'].filter((s) => s in funnel);
  Object.keys(funnel).forEach((k) => { if (!statusOrder.includes(k)) statusOrder.push(k); });

  let chainSel = 0;
  let q = '';
  let fStatus = 'semua';
  let sortKey = 'skor';
  let sortDir = -1;
  let expandId = null;

  const statusBadge = (s) => {
    const map = { reported: ['●', 'ok'], shortlist: ['◎', 'tip'], raw: ['◌', 'plain'], parked: ['◌', 'half'], rejected: ['✕', 'warn'] };
    const [sym, cls] = map[s] || ['◌', 'plain'];
    return `<span class="badge ${cls}">${sym} ${esc(t('ops.status.' + s, null, s))}</span>`;
  };

  el.innerHTML = `
  <header class="pagehead">
    <div>
      <div class="eyebrow">${esc(t('nav.ops.label'))}</div>
      <h1 class="display-l">${esc(t('ops.pipeline.judul'))}</h1>
      <p class="sub">${esc(t('nav.ops.pipeline.deskripsi'))}${ops.phase && ops.phase.mode ? ` · <span class="badge half">◐ ${esc(ops.phase.mode)}</span>` : ''}</p>
    </div>
  </header>

  ${ops.phase && ops.phase.note ? `<div class="callout note" style="margin-bottom:14px"><div class="co-title">◆ ${esc(ops.phase.mode || '')}</div><p>${esc(ops.phase.note)}</p></div>` : ''}

  <article class="card">
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;justify-content:space-between">
      <div class="seg" id="chain-seg" role="tablist">
        ${chains.map((c, i) => `<button role="tab" aria-selected="${i === 0}" data-chain="${i}" class="${i === 0 ? 'active' : ''}">${esc(c.id)}</button>`).join('')}
      </div>
      <div class="cap" id="chain-meta"></div>
    </div>
    <div id="chain-flow"></div>
  </article>

  <section class="bento" style="margin-top:14px">
    <article class="card b-wide chart-card">
      <div class="eyebrow">${esc(t('ops.pipeline.funnel_judul'))}</div>
      <div id="funnel-wrap" style="margin-top:10px;flex:1"></div>
    </article>
    <article class="card b-side">
      <div class="eyebrow">${esc(t('ops.pipeline.kolom.wps'))} — ${esc(t('ops.status.reported'))}</div>
      ${reported.length ? `
      <div class="tbl-scroll" style="margin-top:10px"><table class="tbl">
        <thead><tr><th>#</th><th>${esc(t('ops.pipeline.kolom.id'))}</th><th>${esc(t('ops.pipeline.kolom.nama'))}</th><th>${esc(t('ops.pipeline.kolom.wps'))}</th><th>W1–W5</th><th>QA</th></tr></thead>
        <tbody>
          ${reported.map((r) => `<tr>
            <td class="td-num">${esc(fmt.int(r.rank))}</td>
            <td class="td-id">${esc(r.id)}</td>
            <td>${esc(r.nama || '')}</td>
            <td class="td-num"><b>${esc(fmt.int(r.wps))}</b></td>
            <td><span style="display:inline-flex;gap:2px;align-items:flex-end" aria-label="${esc((r.w || []).map((w, i) => `W${i + 1}=${w}`).join(', '))}">
              ${(r.w || []).map((w) => `<span style="display:inline-block;width:6px;height:${Math.max((Math.min(w, 5) / 5) * 22, 3)}px;border-radius:2px;background:${w <= 1 ? 'var(--warn-fg)' : 'var(--chart)'}"></span>`).join('')}
            </span></td>
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
        <span><b>${esc(e.skill)}</b> — ${esc(e.summary)} <span class="f-date">${esc(fmt.tanggal(day.date))}</span></span></li>`).join('')).join('')}
    </ul>` : ui.empty('empty.beranda.aktivitas')}
  </article>`;

  /* ---------- chain flow + countdown ---------- */
  let timer = null;
  function renderChain() {
    const c = chains[chainSel];
    const flowEl = el.querySelector('#chain-flow');
    const metaEl = el.querySelector('#chain-meta');
    if (!c) { flowEl.innerHTML = ui.empty('empty.ops.pipeline'); metaEl.textContent = ''; return; }
    const next = c.schedule_cron ? cron.nextUTC(c.schedule_cron, new Date()) : null;
    metaEl.innerHTML = `${esc(c.schedule_human || '')}${c.schedule_cron ? ` <span class="ref-chip">${esc(c.schedule_cron)}</span>` : ''}
      ${c.on_error ? ` · ${esc(t('ops.pipeline.on_error'))}: <b>${esc(c.on_error)}</b>` : ''}
      ${next ? ` · ${esc(t('ops.pipeline.run_berikutnya'))}: <span class="num" id="chain-cd"></span>` : ''}`;
    flowEl.innerHTML = `<div class="chain-flow">
      ${(c.steps || []).map((st, si) => `
        ${si > 0 ? '<div class="pedge" aria-hidden="true"></div>' : ''}
        <div class="pstep">
          <span class="pstep-cap">${esc(t('ops.pipeline.step', { n: si + 1 }))}</span>
          ${(st.skills || []).map((sk) => {
    const a = agentById(sk);
    return `<button class="pnode" data-node="${esc(sk)}">
              <span class="pname">${esc(a ? (a.nama || a.id) : sk)}</span>
              <span class="pmodel">${esc(a ? (a.model_short || '') : '')}${st.parallel ? ' · ∥' : ''}${(st.consume || []).length ? ' · ← ' + esc(st.consume.join(', ')) : ''}</span>
            </button>`;
  }).join('')}
        </div>`).join('')}
    </div>`;
    flowEl.querySelectorAll('[data-node]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = agentById(btn.getAttribute('data-node'));
        if (a) openAgentDrawer(a, ctx);
      });
    });
    if (timer) { clearInterval(timer); timer = null; }
    if (next) {
      const tick = () => {
        const cd = el.querySelector('#chain-cd');
        if (!cd) return;
        const d = fmt.durasi(next.getTime() - Date.now());
        cd.textContent = d ? `${d.n1} ${d.u1}${d.n2 ? ' ' + d.n2 + ' ' + d.u2 : ''}` : fmt.tanggalWaktu(next.toISOString());
      };
      tick();
      timer = setInterval(tick, 30000);
    }
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

  /* ---------- funnel ---------- */
  function renderFunnel() {
    const wrap = el.querySelector('#funnel-wrap');
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

  /* ---------- tabel kandidat ---------- */
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
          const next = wrap.querySelector(`.th-sort[data-sort="${k}"]`);
          if (next) next.focus();
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

  el.querySelector('#cand-q').addEventListener('input', (e) => { q = e.target.value; renderTable(); });
  el.querySelector('#cand-status').addEventListener('change', (e) => { fStatus = e.target.value; renderTable(); });

  renderChain();
  renderFunnel();
  renderTable();

  const onRecharts = () => renderFunnel();
  document.addEventListener('pimas:recharts', onRecharts);
  return () => {
    if (timer) clearInterval(timer);
    document.removeEventListener('pimas:recharts', onRecharts);
  };
}
