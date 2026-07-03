/*
 * View: Beranda — bento grid (DESIGN §4.2)
 * Tile inverted hero (payload.hero) · KPI + delta + sparkline ber-ambang ·
 * top-3 peluang (leaderboard §4.10) · countdown riset berikutnya (live) ·
 * aktivitas riset humanized. Semua teks via t(); semua angka dari payload.
 */

export function render(el, ctx) {
  const { data, t, esc, fmt, ui, ttSpan, charts, AMBANG, countUp } = ctx;
  const kpi = data.kpi || {};
  const opps = (data.opportunities || []).slice().sort((a, b) => (b.wps ?? -1) - (a.wps ?? -1));
  const week = fmt.minggu(data.week);

  /* ---------- hero (tile inverted) ---------- */
  const hero = data.hero;
  let heroHtml;
  if (hero && hero.headline) {
    const ev = hero.evidence || {};
    /* Alur baca: eyebrow → headline → standfirst → CTA (terminal, margin-top:auto)
       → srcline bukti DI BAWAH CTA sebagai baris kecil (§ studi Z-pattern v3.2). */
    heroHtml = `
    <article class="card tile-inv b-hero">
      <div class="eyebrow">${esc(t('beranda.hero.judul', { minggu: week }))}</div>
      <h2 class="display-xl">${esc(hero.headline)}</h2>
      <p class="standfirst">${esc(hero.body || '')}</p>
      <div class="heroline">
        <a class="cta" href="#/peluang/${encodeURIComponent(hero.candidate_id)}">${esc(t('beranda.hero.cta'))} →</a>
        <span class="srcline">${ui.tierChip(ev.tier)} ${esc(t('beranda.hero.label_bukti'))}: ${ui.sourceLink(ev)}</span>
      </div>
    </article>`;
  } else {
    heroHtml = `
    <article class="card tile-inv b-hero">
      <div class="eyebrow">${esc(t('beranda.hero.judul', { minggu: week }))}</div>
      <div class="empty" style="color:inherit">
        <p class="e-apa" style="color:var(--inv-ink)">${esc(t('empty.beranda.hero.apa'))}</p>
        <p class="e-kenapa" style="color:var(--inv-ink-2)">${esc(t('empty.beranda.hero.kenapa'))}</p>
        <p class="e-next" style="color:var(--inv-ink-2)">${esc(t('empty.beranda.hero.berikutnya'))}</p>
      </div>
      <div class="heroline"><a class="cta" href="#/peluang">${esc(t('beranda.top_peluang.cta'))} →</a></div>
    </article>`;
  }

  /* ---------- KPI ---------- */
  const by = kpi.by_status || {};
  const statusChips = [
    ['reported', 'ok', '●'], ['shortlist', 'tip', '◎'], ['parked', 'plain', '◌'],
    ['raw', 'plain', '◌'], ['rejected', 'warn', '✕'],
  ].filter(([k]) => by[k] !== undefined && by[k] !== null)
    .map(([k, cls, sym]) => `<span class="badge ${cls}">${sym} ${esc(fmt.int(by[k]))} ${esc(t('peluang.filter.status.' + k).toLowerCase())}</span>`)
    .join('');

  const lalu = kpi.minggu_lalu;
  /* BL-04 (K2): minggu_lalu={0,0} = baseline PALSU → prev=null ("Belum ada pembanding"),
     BUKAN delta dari 0. Mitigasi view-side sementara; akar = builder BL-01 (kirim null
     bukan {0,0}). deltaBadge merakit simbol+baseline; null≠0 dijaga. */
  const punyaPembanding = !!(lalu && (((lalu.reported || 0) > 0) || ((lalu.kandidat_baru || 0) > 0)));
  const prevKandidat = punyaPembanding ? (kpi.kandidat_total - (lalu.kandidat_baru || 0)) : null;
  const prevReported = punyaPembanding ? lalu.reported : null;
  const deltaKandidat = ui.deltaBadge(kpi.kandidat_total, prevKandidat);
  const deltaReported = ui.deltaBadge(kpi.reported_minggu_ini, prevReported);

  const top = kpi.top || {};
  const scored = opps.filter((o) => o.wps !== null && o.wps !== undefined);
  const sparkVals = scored.map((o) => o.wps).sort((a, b) => a - b);
  /* skor-tertinggi vs ambang lapor (baseline jelas, BUKAN "minggu lalu") */
  const topDelta = (typeof top.wps === 'number')
    ? ui.deltaBadge(top.wps, AMBANG, { baseline: t('beranda.kpi.vs_ambang', { ambang: fmt.int(AMBANG) }, 'vs ambang lapor ({ambang})') })
    : '';

  /* Rail kanan: SATU kolom span 4 setinggi hero — 2 KPI primer ditumpuk
     (dipantau+chips di atas, skor-tertinggi di bawah). Angka KPI sekunder
     (lebih kecil dari headline hero) — focal point tetap headline (§v3.2). */
  const kpiHtml = `
    <div class="b-rail">
      <article class="card b-kpi">
        <span class="k-label">${esc(t('beranda.kpi.dipantau'))}</span>
        <span class="mono-kpi" id="kpi-total">${esc(fmt.int(kpi.kandidat_total))}</span>
        <span class="k-delta">${deltaKandidat}</span>
        <div class="k-chips">${statusChips}</div>
      </article>
      <article class="card b-kpi">
        <span class="k-label">${ttSpan(t('beranda.kpi.skor_tertinggi'), t('peluang.skor.tooltip'))}</span>
        <span class="mono-kpi">${typeof top.wps === 'number' ? `<span id="kpi-top">${esc(fmt.int(top.wps))}</span><small>${esc(t('peluang.skor.satuan'))}</small>` : ui.belumChip()}</span>
        <span class="k-delta">${topDelta}</span>
        ${sparkVals.length ? `<div class="chart-box spark" id="spark-skor" role="img"
          aria-label="${esc(t('beranda.kpi.skor_tertinggi'))}: ${esc(sparkVals.join(', '))} · ${esc(fmt.int(AMBANG))}"></div>` : ''}
      </article>
    </div>`;

  /* ---------- baris sekunder: riset selesai + countdown riset berikutnya ---------- */
  const nr = data.next_run;
  const secondaryHtml = `
    <article class="card b-kpi b-sec">
      <span class="k-label">${esc(t('beranda.kpi.riset_selesai'))}</span>
      <span class="mono-kpi" id="kpi-reported">${esc(fmt.int(kpi.reported_minggu_ini))}</span>
      <span class="k-delta">${deltaReported}</span>
    </article>
    <article class="card b-third b-sec">
      <div class="eyebrow">${esc(nr && nr.label ? nr.label : t('beranda.jadwal.judul_kosong'))}</div>
      ${nr && nr.next_iso
    ? `<span class="cd-num" id="cd-next" aria-live="polite">—</span>
       <p class="cap" style="margin-top:6px"><b>${esc(nr.human || '')}</b> · ${esc(t('beranda.jadwal.keterangan'))}</p>`
    : `<div class="empty-dash">${esc(t('beranda.jadwal.judul_kosong'))}</div>`}
    </article>`;

  /* ---------- top peluang (leaderboard §4.10) ---------- */
  const top3 = scored.slice(0, 3);
  const lbHtml = top3.length ? `
    <div class="lb">
      ${top3.map((o, i) => `
      <a class="lb-row" href="#/peluang/${encodeURIComponent(o.id)}">
        <span class="lb-rank num">${String(i + 1).padStart(2, '0')}</span>
        <span class="lb-name">${esc(o.nama)}
          <span class="lb-id">${esc(o.id)}</span>
          ${o.copy && o.copy.insight_card ? `<span class="lb-sub">${esc(o.copy.insight_card)}</span>` : ''}
        </span>
        <span class="lb-score">${esc(fmt.int(o.wps))} <small>${esc(t('peluang.skor.satuan'))}</small></span>
        <span class="lb-bar"><i style="width:${Math.max(0, Math.min(100, o.wps))}%"></i></span>
      </a>`).join('')}
    </div>
    <p class="cap" style="margin-top:12px"><a class="textlink" href="#/peluang" style="font-size:12px">${esc(t('beranda.top_peluang.cta'))} →</a></p>`
    : ui.empty('empty.peluang.galeri');

  const topHtml = `
    <article class="card b-wide">
      <div class="eyebrow">${esc(t('nav.wawasan.peluang.label'))}</div>
      <h3 class="title block-takeaway">${esc(top3.length ? t('beranda.top_peluang.judul', { n: fmt.int(top3.length) }) : t('beranda.top_peluang.judul_kosong'))}</h3>
      ${lbHtml}
    </article>`;

  /* ---------- aktivitas riset ---------- */
  const days = (data.aktivitas || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const items = [];
  for (const d of days) for (const it of (d.items || [])) items.push({ date: d.date, ...it });
  /* BL-44 (K3): drop item PENUH hanya bila LABEL bocor jargon (label aktivitas 100%
     bersih — verified). Summary bocor (run-log mentah "Run ID… DoD PASS") → tampilkan
     LABEL + chip "ringkasan belum disusun", JANGAN render summary mentah ke plane bisnis.
     Summary bersih → clamp 2 baris. */
  const feedItems = items.filter((it) => !ui.looksLikeJargon(it.label)).slice(0, 6);
  const aktHtml = `
    <article class="card b-side">
      <div class="eyebrow">${esc(t('beranda.aktivitas.judul'))}</div>
      ${feedItems.length ? `
      <ul class="feed">
        ${feedItems.map((it) => {
    const bocor = ui.looksLikeJargon(it.summary);
    const body = bocor
      ? `<span class="feed-fallback">${esc(t('beranda.aktivitas.detail_disaring'))}</span>`
      : `— <span class="feed-clamp">${esc(it.summary)}</span>`;
    return `<li><span class="f-dot f-tip" aria-hidden="true"></span>
          <span><b>${esc(it.label)}</b> ${body} <span class="f-date">${esc(fmt.tanggal(it.date))}</span></span>
        </li>`;
  }).join('')}
      </ul>
      <p class="cap" style="margin-top:10px"><a class="textlink" href="#/laporan" style="font-size:12px">${esc(t('beranda.aktivitas.cta'))} →</a></p>`
    : ui.empty('empty.beranda.aktivitas')}
    </article>`;

  /* ---------- compose ---------- */
  el.innerHTML = `
  <header class="pagehead">
    <div>
      <div class="eyebrow">${esc(t('beranda.eyebrow', { minggu: week }))}</div>
      <h1 class="display-l">${esc(kpi.kandidat_total ? t('beranda.kpi.judul', { n: fmt.int(kpi.kandidat_total) }) : t('beranda.kpi.judul_kosong'))}</h1>
    </div>
  </header>
  <section class="bento">
    ${heroHtml}
    ${kpiHtml}
    ${secondaryHtml}
    ${topHtml}
    ${aktHtml}
  </section>`;

  /* count-up KPI (hanya first paint) */
  const elTotal = el.querySelector('#kpi-total');
  if (elTotal && typeof kpi.kandidat_total === 'number') countUp(elTotal, kpi.kandidat_total);
  const elRep = el.querySelector('#kpi-reported');
  if (elRep && typeof kpi.reported_minggu_ini === 'number') countUp(elRep, kpi.reported_minggu_ini);
  const elTop = el.querySelector('#kpi-top');
  if (elTop && typeof top.wps === 'number') countUp(elTop, top.wps);

  /* countdown live */
  let timer = null;
  function tickCountdown() {
    const cd = el.querySelector('#cd-next');
    if (!cd || !nr || !nr.next_iso) return;
    const ms = new Date(nr.next_iso).getTime() - Date.now();
    const d = fmt.durasi(ms);
    cd.innerHTML = d
      ? `${esc(fmt.int(d.n1))}<small> ${esc(d.u1)}${d.n2 ? ' ' + esc(fmt.int(d.n2)) + ' ' + esc(d.u2) : ''} lagi</small>`
      : `<small>${esc(nr.human || t('umum.muat'))}</small>`;
  }
  if (nr && nr.next_iso) { tickCountdown(); timer = setInterval(tickCountdown, 30000); }

  /* sparkline skor ber-ambang (§4.7) */
  function renderCharts() {
    const box = el.querySelector('#spark-skor');
    if (!box || !sparkVals.length) return;
    if (!charts.ok) { box.outerHTML = ui.chartFallback(`<span class="num">${esc(sparkVals.join(' · '))}</span> · ${esc(fmt.int(AMBANG))}`); return; }
    const tok = charts.tokens();
    const c = charts.init(box);
    if (!c) return;
    c.setOption({
      ...charts.ANIM,
      grid: { left: 6, right: 6, top: 8, bottom: 4 },
      xAxis: { type: 'category', show: false, data: sparkVals.map((_, i) => i + 1), boundaryGap: false },
      yAxis: { type: 'value', show: false, min: Math.min(AMBANG - 10, Math.min(...sparkVals) - 5), max: Math.max(...sparkVals) + 6 },
      series: [{
        type: 'line', symbol: 'circle', symbolSize: 5, silent: true,
        lineStyle: { color: tok.chart, width: 2 },
        itemStyle: { color: tok.chart, borderColor: tok.card, borderWidth: 1.5 },
        areaStyle: { opacity: 0.14, color: tok.chart },
        label: sparkVals.length <= 3 ? { show: true, position: 'top', color: tok.text2, fontFamily: tok.mono, fontSize: 10 } : { show: false },
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { color: tok.text4, type: 'dashed', width: 1 },
          label: { show: true, position: 'insideStartTop', formatter: String(AMBANG), fontSize: 9, color: tok.text4 },
          data: [{ yAxis: AMBANG }],
        },
        data: sparkVals,
      }],
    });
  }
  renderCharts();
  const onRecharts = () => renderCharts();
  document.addEventListener('pimas:recharts', onRecharts);

  return () => {
    if (timer) clearInterval(timer);
    document.removeEventListener('pimas:recharts', onRecharts);
  };
}
