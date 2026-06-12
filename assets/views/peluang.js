/*
 * View: Peluang — galeri opportunity card (DESIGN §4.3 lengkap), filter status,
 * sort, leaderboard horizontal bar + markLine ambang (§5 aturan 2), arsip
 * keputusan, drawer detail ringkas (§4.18). Data: payload.opportunities + arsip.
 */

/** Kartu §4.3 — anatomi tetap: foto · judul · skor+meter+verdict · chip regulasi ·
    insight · provenance · catatan risiko/asumsi · CTA tunggal. */
export function oppCard(o, ctx, opts = {}) {
  const { t, esc, fmt, ui } = ctx;
  const copy = o.copy || {};
  const monogram = `<span class="ph-mono" aria-hidden="true">${esc((o.nama || '?').charAt(0).toUpperCase())}</span>`;
  const foto = o.gambar && o.gambar.url
    ? `<img src="${esc(o.gambar.url)}" alt="${esc(o.nama)}" loading="lazy" data-fallback-img><span class="ph-fallback">${monogram}</span>`
    : monogram;
  const skorHtml = (o.wps !== null && o.wps !== undefined)
    ? `<span class="mono-score">${fmt.skor(o.wps)}</span>${ui.meter(o.wps)}`
    : `<span class="chip-belum">◌ ${esc(t('peluang.skor.belum'))}</span>`;
  const regChips = ((o.regulasi || {}).milestones || []).slice(0, 3).map((m) => ui.regChip(m)).join(' ');
  const ev = (copy.evidence_highlights || [])[0] || (o.klaim || [])[0] || null;
  const risiko = (copy.risiko || [])[0];
  /* focal point galeri: kartu skor tertinggi dapat ring --accent + badge */
  const topBadge = opts.top
    ? `<span class="opp-topflag"><span aria-hidden="true">★</span> ${esc(t('peluang.kartu.skor_tertinggi', null, 'Skor tertinggi'))}</span>`
    : '';

  return `
  <article class="card opp${opts.top ? ' opp-top-rank' : ''}">
    ${topBadge}
    <div class="opp-top">
      <div class="opp-photo" role="img" aria-label="${esc(o.gambar && o.gambar.url ? o.nama : t('peluang.kartu.tanpa_foto'))}">${foto}</div>
      <div style="min-width:0">
        <div class="opp-title">${esc(o.nama)}</div>
        <div class="opp-brand">${esc(o.brand || '')}</div>
        <div class="opp-id">${esc(o.kategori || '')} · ${esc(o.id)}</div>
      </div>
    </div>
    <div class="opp-scorewrap">${skorHtml}${ui.verdictBadge(o.verdict)}</div>
    ${regChips ? `<div class="opp-reg">${regChips}</div>` : ''}
    ${copy.insight_card ? `<p class="opp-insight">${esc(copy.insight_card)}</p>` : ''}
    ${ev ? `<div class="opp-src">${ui.tierChip(ev.tier)} ${ui.sourceLink(ev)}</div>` : ''}
    ${risiko ? `<div class="opp-note"><span aria-hidden="true">⚠</span><span>${esc(risiko)}</span></div>` : ''}
    <div class="opp-foot"><button class="textlink" data-opp="${esc(o.id)}">${esc(t('peluang.cta.detail'))} →</button></div>
  </article>`;
}

/** Drawer §4.18 — ringkasan diperluas + CTA buka halaman detail. */
export function openOppDrawer(o, ctx) {
  const { t, esc, fmt, ui, drawer } = ctx;
  const copy = o.copy || {};
  const regChips = ((o.regulasi || {}).milestones || []).map((m) => ui.regChip(m)).join(' ');
  const evs = copy.evidence_highlights || [];
  const risiko = (copy.risiko || [])[0];
  const body = `
    <div class="opp-scorewrap">
      ${(o.wps !== null && o.wps !== undefined)
    ? `<span class="mono-score">${fmt.skor(o.wps)}</span>${ui.meter(o.wps)}`
    : `<span class="chip-belum">◌ ${esc(t('peluang.skor.belum'))}</span>`}
      ${ui.verdictBadge(o.verdict)}
    </div>
    ${copy.insight_card ? `<p class="opp-insight">${esc(copy.insight_card)}</p>` : ''}
    ${regChips ? `<div class="opp-reg">${regChips}</div>` : ''}
    ${copy.ringkasan ? `<p class="body-s" style="color:var(--text-2)">${esc(copy.ringkasan)}</p>` : ''}
    ${risiko ? `<div class="callout warn"><div class="co-title">▲ ${esc(t('peluang.detail.risiko_judul', null, 'Risiko yang menentukan'))}</div><p>${esc(risiko)}</p></div>` : ''}
    ${evs.length ? `<div class="claims" style="margin-top:0">
      ${evs.map((e) => `<div class="claim-item">${ui.tierChip(e.tier)}
        <div class="claim-body"><p class="claim-text">${esc(e.kutipan)}</p>
        <p class="claim-ref">${ui.sourceLink(e)}</p></div></div>`).join('')}
    </div>` : ''}
    <div><a class="cta" href="#/peluang/${encodeURIComponent(o.id)}">${esc(t('peluang.cta.detail'))} →</a></div>`;
  drawer.open({ title: esc(o.nama), body });
}

export function render(el, ctx) {
  const { data, t, esc, fmt, ui, charts, AMBANG } = ctx;
  const opps = data.opportunities || [];
  const arsip = data.arsip || [];
  const week = fmt.minggu(data.week);

  /* status yang benar-benar ada di data (galeri + arsip) */
  const present = new Set();
  opps.forEach((o) => o.status && present.add(o.status));
  arsip.forEach((a) => a.status && present.add(a.status));
  const statusOrder = ['reported', 'shortlist', 'raw', 'parked', 'rejected'].filter((s) => present.has(s));

  let fStatus = 'semua';
  let fSort = 'skor';

  el.innerHTML = `
  <header class="pagehead">
    <div>
      <div class="eyebrow">${esc(t('beranda.eyebrow', { minggu: week }))}</div>
      <h1 class="display-l">${esc(t('peluang.judul'))}</h1>
      <p class="sub">${esc(t('peluang.subjudul'))}</p>
    </div>
  </header>

  <article class="card chart-card" id="lb-card">
    <div class="eyebrow">${esc(t('peluang.leaderboard.judul'))}</div>
    <h3 class="cell-title">${esc(t('peluang.leaderboard.takeaway', null, 'Siapa yang melewati ambang lapor'))}</h3>
    <p class="cap">${esc(t('peluang.leaderboard.keterangan', null, 'Posisi tiap skor terhadap ambang lapor (60) — ranking lengkap ada di galeri kartu di bawah.'))}</p>
    <div id="lb-chart-wrap" style="margin-top:10px"></div>
  </article>

  <div class="filters">
    <label>${esc(t('peluang.filter.label'))}
      <select class="select" id="f-status">
        <option value="semua">${esc(t('peluang.filter.status.semua'))}</option>
        ${statusOrder.map((s) => `<option value="${esc(s)}">${esc(t('peluang.filter.status.' + s))}</option>`).join('')}
      </select>
    </label>
    <label>${esc(t('peluang.sort.label'))}
      <select class="select" id="f-sort">
        <option value="skor">${esc(t('peluang.sort.skor'))}</option>
        <option value="terbaru">${esc(t('peluang.sort.terbaru'))}</option>
        <option value="nama">${esc(t('peluang.sort.nama'))}</option>
      </select>
    </label>
  </div>

  <div id="galeri"></div>

  <section class="section">
    <div class="section-head">
      <div class="eyebrow">${esc(t('peluang.arsip.judul'))}</div>
      <p class="sub">${esc(t('peluang.arsip.keterangan'))}</p>
    </div>
    <div id="arsip-wrap" style="margin-top:14px"></div>
  </section>`;

  /* ---------- leaderboard chart ---------- */
  const scored = opps.filter((o) => typeof o.wps === 'number').sort((a, b) => b.wps - a.wps);
  function renderChart() {
    const wrap = el.querySelector('#lb-chart-wrap');
    if (!wrap) return;
    if (!scored.length) { wrap.innerHTML = ui.empty('empty.peluang.galeri'); return; }
    const aria = `${esc(t('peluang.leaderboard.judul'))}: ${esc(scored.map((o) => `${o.nama} ${o.wps}`).join('; '))} · ${esc(fmt.int(AMBANG))}`;
    if (!charts.ok) {
      wrap.innerHTML = ui.chartFallback(scored.map((o) => `<span class="num">${esc(String(o.wps))}</span> — ${esc(o.nama)}`).join('<br>'));
      return;
    }
    wrap.innerHTML = `<div class="chart-box" id="lb-chart" role="img" aria-label="${aria}" style="min-height:${Math.max(120, scored.length * 38 + 30)}px"></div>`;
    const tok = charts.tokens();
    const c = charts.init(wrap.querySelector('#lb-chart'));
    if (!c) return;
    /* sub-skor ≤ ambang → bar menyala merah (titik lemah), ≥ ambang → biru data */
    const barData = scored.map((o) => ({
      value: o.wps,
      itemStyle: { color: o.wps >= AMBANG ? tok.chart : tok.warn, borderRadius: [0, 3, 3, 0] },
    }));
    c.setOption({
      ...charts.ANIM,
      grid: { left: 8, right: 46, top: 4, bottom: 4, containLabel: true },
      /* tooltip nama penuh + skor (label sumbu Y di-truncate 1 baris → hover/keyboard ungkap penuh) */
      tooltip: {
        trigger: 'item',
        formatter: (p) => `${esc(scored[p.dataIndex].nama)}<br/><b>${esc(String(scored[p.dataIndex].wps))}</b>${esc(t('peluang.skor.satuan'))}`,
      },
      xAxis: { type: 'value', max: 100, show: false },
      yAxis: {
        type: 'category', inverse: true,
        data: scored.map((o) => o.nama),
        axisLine: { show: false }, axisTick: { show: false },
        /* truncate 1 baris + ellipsis (anti-tabrakan label panjang §v3.2) */
        axisLabel: { color: tok.text1, fontFamily: tok.body, fontSize: 12, fontWeight: 600, width: 156, overflow: 'truncate', ellipsis: '…' },
      },
      series: [{
        type: 'bar', barWidth: 13,
        label: { show: true, position: 'right', color: tok.text1, fontFamily: tok.mono, fontSize: 11.5, fontWeight: 600 },
        markLine: charts.markLineAmbang(AMBANG, String(AMBANG)),
        data: barData,
      }],
    });
  }

  /* ---------- galeri ---------- */
  function applyFilterSort(list) {
    let rows = list.slice();
    if (fStatus !== 'semua') rows = rows.filter((o) => o.status === fStatus);
    if (fSort === 'skor') rows.sort((a, b) => (b.wps ?? -1) - (a.wps ?? -1));
    else if (fSort === 'terbaru') rows.sort((a, b) => String(b.tanggal || '').localeCompare(String(a.tanggal || '')));
    else rows.sort((a, b) => String(a.nama || '').localeCompare(String(b.nama || '')));
    return rows;
  }

  /* id peluang skor tertinggi (untuk emphasis kartu #1) */
  const topId = scored.length ? scored[0].id : null;

  function renderGaleri() {
    const wrap = el.querySelector('#galeri');
    const rows = applyFilterSort(opps);
    if (!opps.length) { wrap.innerHTML = `<div class="card" style="margin-top:14px">${ui.empty('empty.peluang.galeri')}</div>`; return; }
    if (!rows.length) { wrap.innerHTML = `<div class="card" style="margin-top:14px">${ui.empty('empty.peluang.filter')}</div>`; return; }
    wrap.innerHTML = `<div class="opp-grid">${rows.map((o) => oppCard(o, ctx, { top: o.id === topId })).join('')}</div>`;
    ui.bindImgFallbacks(wrap);
    wrap.querySelectorAll('[data-opp]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const o = opps.find((x) => x.id === btn.getAttribute('data-opp'));
        if (o) openOppDrawer(o, ctx);
      });
    });
  }

  /* ---------- arsip ---------- */
  function renderArsip() {
    const wrap = el.querySelector('#arsip-wrap');
    let rows = arsip.slice();
    if (fStatus !== 'semua') rows = rows.filter((a) => a.status === fStatus);
    if (!arsip.length) { wrap.innerHTML = `<div class="card">${ui.empty('empty.arsip')}</div>`; return; }
    if (!rows.length) { wrap.innerHTML = `<div class="card">${ui.empty('empty.peluang.filter')}</div>`; return; }
    const statusBadge = (s) => {
      const map = { reported: ['●', 'ok'], shortlist: ['◎', 'tip'], raw: ['◌', 'plain'], parked: ['◌', 'plain'], rejected: ['✕', 'warn'] };
      const [sym, cls] = map[s] || ['◌', 'plain'];
      return `<span class="badge ${cls}">${sym} ${esc(t('peluang.filter.status.' + s, null, s))}</span>`;
    };
    wrap.innerHTML = `<div class="card" style="padding:6px 18px 14px">
      <div class="tbl-scroll"><table class="tbl tbl-stack">
        <thead><tr>
          <th>${esc(t('ops.pipeline.kolom.id'))}</th>
          <th>${esc(t('ops.pipeline.kolom.nama'))}</th>
          <th>${esc(t('ops.pipeline.kolom.kategori'))}</th>
          <th>${esc(t('ops.pipeline.kolom.status'))}</th>
          <th>${esc(t('peluang.arsip.kolom_alasan'))}</th>
          <th>${esc(t('ops.pipeline.kolom.tanggal'))}</th>
        </tr></thead>
        <tbody>
        ${rows.map((a) => `<tr>
          <td class="td-id" data-label="${esc(t('ops.pipeline.kolom.id'))}">${esc(a.id)}</td>
          <td data-label="${esc(t('ops.pipeline.kolom.nama'))}"><b>${esc(a.nama)}</b>${a.brand ? `<span class="cap" style="display:block">${esc(a.brand)}</span>` : ''}</td>
          <td data-label="${esc(t('ops.pipeline.kolom.kategori'))}">${esc(a.kategori || '')}</td>
          <td data-label="${esc(t('ops.pipeline.kolom.status'))}">${statusBadge(a.status)}</td>
          <td data-label="${esc(t('peluang.arsip.kolom_alasan'))}" style="max-width:420px">${esc(a.alasan || '')}</td>
          <td class="td-num" data-label="${esc(t('ops.pipeline.kolom.tanggal'))}">${esc(fmt.tanggal(a.tanggal))}</td>
        </tr>`).join('')}
        </tbody>
      </table></div>
    </div>`;
  }

  el.querySelector('#f-status').addEventListener('change', (e) => { fStatus = e.target.value; renderGaleri(); renderArsip(); });
  el.querySelector('#f-sort').addEventListener('change', (e) => { fSort = e.target.value; renderGaleri(); });

  renderChart();
  renderGaleri();
  renderArsip();

  const onRecharts = () => renderChart();
  document.addEventListener('pimas:recharts', onRecharts);
  return () => document.removeEventListener('pimas:recharts', onRecharts);
}
