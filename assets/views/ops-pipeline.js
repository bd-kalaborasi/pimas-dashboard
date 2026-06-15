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
  let sortKey = 'skor';
  let sortDir = -1;
  let expandId = null;

  const statusBadge = (s) => {
    const map = { reported: ['●', 'ok'], shortlist: ['◎', 'tip'], raw: ['◌', 'plain'], parked: ['◌', 'half'], rejected: ['✕', 'warn'] };
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
        rows.push(`<li class="trouble-row"><span class="badge note">⚠ ${esc(t('ops.admin.tahap_status.macet'))}</span>
          <span><b>${esc(o.nama)}</b> — ${esc(t('ops.agen.stuck_macet', { sejak: o.sejak ? fmt.tanggalWaktu(o.sejak) : '—' }))}</span></li>`);
      } else {
        rows.push(`<li class="trouble-row"><span class="badge warn">✕ ${esc(t('ops.admin.tahap_status.gagal'))}</span>
          <span><b>${esc(o.nama)}</b> — ${esc(o.beruntun > 0 ? t('ops.agen.stuck_gagal', { n: fmt.int(o.beruntun) }) : t('ops.agen.status_gagal'))}${o.sejak ? ` · <span class="cap">${esc(t('ops.agen.stuck_sejak', { sejak: fmt.tanggal(o.sejak) }))}</span>` : ''}</span></li>`);
      }
    }
    for (const iss of openIssues) {
      const sev = String(iss.severity || '').toLowerCase();
      const cls = /critical|high/.test(sev) ? 'warn' : 'note';
      rows.push(`<li class="trouble-row"><span class="badge ${cls}">⚠ ${esc(t('ops.kesehatan.severity.' + sev, null, iss.severity || ''))}</span>
        <span><span class="ref-chip">${esc(iss.id)}</span> ${esc(iss.title)}</span></li>`);
    }
    if (!rows.length) return '';
    return `<div class="callout warn trouble-banner ops-trouble" role="alert" style="margin-bottom:16px">
      <div class="co-title">⚠ ${esc(t('ops.admin.status_ada_kendala', { n: fmt.int(kendalaTotal) }))}</div>
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
    ? `<span class="badge warn">⚠ ${esc(t('ops.admin.kendala_jumlah', { n: fmt.int(kendalaTotal) }))}</span>`
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
  </details>`;

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

    metaEl.innerHTML = `${esc(c.schedule_human || '')}
      ${nodes.length ? ` · <span class="num">${esc(t('ops.admin.progres_nilai', { done: fmt.int(prog.done), total: fmt.int(nodes.length) }))}</span>` : ''}
      ${n ? ` · ${esc(t('ops.admin.berikutnya_label'))}: <span class="num">${esc(fmt.tanggalWaktu(n.toISOString()))}</span>` : ''}`;

    flowEl.innerHTML = `<ol class="tline" aria-label="${esc(t('ops.admin.tahap_judul'))}">
      ${nodes.map((nd, i) => {
    const m = stepMetaInline(nd.state);
    const isCurrent = i === prog.currentIdx && nd.state !== 'selesai';
    return `<li class="tline-step tline-${nd.state}${isCurrent ? ' tline-current' : ''}">
        <button class="tline-node" data-node="${esc(nd.sk)}"
          aria-label="${esc(t('ops.pipeline.step', { n: i + 1 }))}: ${esc(nd.nama)} — ${esc(m.label)}">
          <span class="tline-rail" aria-hidden="true"><span class="tline-marker">${esc(m.sym)}</span></span>
          <span class="tline-content">
            <span class="tline-cap">${esc(t('ops.pipeline.step', { n: i + 1 }))}${isCurrent ? ` · ${esc(t('ops.admin.tahap_sekarang'))}` : ''}</span>
            <span class="tline-name">${esc(nd.nama)}</span>
            <span class="tline-status badge ${m.cls}">${esc(m.sym)} ${esc(m.label)}</span>
            <span class="tline-when cap">${nd.state === 'selesai' && nd.last_success ? esc(t('ops.admin.tahap_terakhir', { waktu: fmt.tanggalWaktu(nd.last_success) })) : (nd.state === 'menunggu' ? esc(t('ops.admin.tahap_belum')) : '')}</span>
          </span>
        </button>
      </li>`;
  }).join('')}
    </ol>`;

    legendEl.innerHTML = `
      <span><span class="lg ok" aria-hidden="true">✓</span> ${esc(t('ops.admin.tahap_status.selesai'))}</span>
      <span><span class="lg tip" aria-hidden="true">◐</span> ${esc(t('ops.admin.tahap_status.berjalan'))}</span>
      <span><span class="lg plain" aria-hidden="true">◌</span> ${esc(t('ops.admin.tahap_status.menunggu'))}</span>
      <span><span class="lg warn" aria-hidden="true">✕</span> ${esc(t('ops.admin.tahap_status.gagal'))}</span>
      <span><span class="lg note" aria-hidden="true">⚠</span> ${esc(t('ops.admin.tahap_status.macet'))}</span>`;

    flowEl.querySelectorAll('[data-node]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = (ops.agents || []).find((x) => x.id === btn.getAttribute('data-node'));
        if (a) openAgentDrawer(a, ctx);
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
      macet: { sym: '⚠', cls: 'note', label: t('ops.admin.tahap_status.macet') },
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

  const onRecharts = () => { if (candRendered) renderFunnel(); };
  document.addEventListener('pimas:recharts', onRecharts);
  return () => {
    if (timer) clearInterval(timer);
    document.removeEventListener('pimas:recharts', onRecharts);
  };
}
