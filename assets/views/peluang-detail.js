/*
 * View: Peluang › Detail kandidat (+ sub-route dossier).
 * Hero skor raksasa (mono-giant §3) · breakdown 5 dimensi stacked bar + footnote
 * formula (§5 aturan 1) · stepper regulasi + countdown tenggat + chip pasal (§4.9)
 * · red flags · skenario tri-card ASUMSI (§4.11) · jangkar harga (§4.13) ·
 * klaim ber-sumber (§4.12) · limitations bernomor (§4.14) · CTA dossier (markdown).
 */

const PASAL_RE = /\b(?:PerBPOM|PP|UU|Permendag|Permenkes|PMK|Perpres|KepBPOM)\s+No\.?\s*\d+[\w./-]*\s*(?:\/|Tahun\s+)?\d{0,4}(?:\s+(?:Psl|Pasal)\s+[\d().]+)?|\b(?:PerBPOM|PP|UU|Permendag|Permenkes|PMK|Perpres)\s+\d+\/\d{4}(?:\s+(?:Psl|Pasal)\s+[\d().]+)?/g;

function pasalChips(text, esc) {
  const found = String(text || '').match(PASAL_RE) || [];
  return [...new Set(found)].map((p) => `<span class="ref-chip">${esc(p)}</span>`).join(' ');
}

export function render(el, ctx) {
  const { data, route, t, esc, fmt, ui, ttSpan, charts, AMBANG, WEIGHTS, renderMd, parseTanggalIndo } = ctx;
  const opp = (data.opportunities || []).find((o) => o.id === route.id);

  /* ---------- tidak ditemukan ---------- */
  if (!opp) {
    el.innerHTML = `
    <header class="pagehead"><div>
      <div class="eyebrow">${esc(t('nav.wawasan.peluang.label'))}</div>
      <h1 class="display-l">${esc(t('empty.peluang.tidak_ditemukan.apa'))}</h1>
    </div></header>
    <div class="card" style="max-width:560px">${ui.empty('empty.peluang.tidak_ditemukan')}
      <a class="textlink" href="#/peluang">${esc(t('umum.kembali'))} →</a></div>`;
    return undefined;
  }

  /* ---------- sub-route dossier (riset lengkap, markdown) ---------- */
  if (route.dossier) return renderDossier(el, ctx, opp);

  const copy = opp.copy || {};
  const subskor = opp.subskor || [];
  const reg = opp.regulasi || {};
  const pasar = opp.pasar || {};
  const sam = pasar.sam;

  /* breakdown: kontribusi poin per dimensi — pts = bobot × (sub/5).
     Ditampilkan HANYA bila jumlahnya cocok dengan WPS payload (anti angka karangan). */
  let dims = null;
  if (subskor.length === 5 && typeof opp.wps === 'number') {
    const tryDims = subskor.map((s) => ({
      key: s.key, label: s.label || t(`peluang.dimensi.${s.key}.label`), sub: s.nilai,
      max: WEIGHTS[s.key] || 0, pts: Math.round((WEIGHTS[s.key] || 0) * (s.nilai / 5) * 10) / 10,
      alasan: s.alasan || '',
    }));
    const total = Math.round(tryDims.reduce((a, d) => a + d.pts, 0));
    if (total === Math.round(opp.wps)) dims = tryDims;
  }

  const statusLabel = t('peluang.filter.status.' + opp.status, null, opp.status);
  /* fallback monogram + label "FOTO BELUM ADA" (§4.20); saat img gagal → onerror
     buang img + tandai .img-failed (CSS menampilkan fallback yang sudah ter-render). */
  const fotoFallback = `<span class="ph-mono" aria-hidden="true">${esc((opp.nama || '?').charAt(0).toUpperCase())}</span><span class="ph-label">${esc(t('peluang.kartu.tanpa_foto'))}</span>`;
  const fotoHtml = opp.gambar && opp.gambar.url
    ? `<img src="${esc(opp.gambar.url)}" alt="${esc(opp.nama)}" loading="lazy" data-fallback-img><span class="ph-fallback">${fotoFallback}</span>`
    : fotoFallback;

  const deltaAmbang = (typeof opp.wps === 'number')
    ? t('peluang.detail.delta_ambang', { delta: fmt.delta(opp.wps - AMBANG), ambang: fmt.int(AMBANG) }, '{delta} vs ambang lapor ({ambang})')
    : '';

  /* ---------- helper disclosure "Selengkapnya / Tutup" (progressive disclosure) ---------- */
  const disclose = (bodyHtml, openLabel) => `
    <details class="disclose">
      <summary><span class="lbl-buka">${esc(openLabel || t('umum.selengkapnya'))}</span><span class="lbl-tutup">${esc(t('umum.tutup'))}</span></summary>
      <div class="disclose-body">${bodyHtml}</div>
    </details>`;

  /* ---------- stat-chip BAN: angka kunci ditarik dari payload (anti angka karangan) ---------- */
  const klaimAll = opp.klaim || [];
  const evAll = (copy.evidence_highlights || []);
  const nSumber = new Set([...klaimAll, ...evAll].map((x) => x && (x.url || x.sumber)).filter(Boolean)).size;
  const samBase = (((opp.pasar || {}).sam) || {}).base;
  const nKuat = (subskor || []).filter((s) => typeof s.nilai === 'number' && s.nilai >= 4).length;
  const stats = [];
  if (typeof opp.wps === 'number') {
    stats.push(`<div class="stat"><span class="s-eyebrow">${esc(t('peluang.skor.label'))}</span>
      <span class="s-num">${esc(fmt.int(opp.wps))}<small>${esc(t('peluang.skor.satuan'))}</small></span>
      <span class="s-ctx num">${esc(deltaAmbang)}</span></div>`);
  }
  if (typeof samBase === 'number') {
    stats.push(`<div class="stat"><span class="s-eyebrow">${esc(t('peluang.detail.pasar.base'))} · SAM</span>
      <span class="s-num">${esc(fmt.rp(samBase))}<small>/th</small></span>
      <span class="asumsi-badge">${ttSpan('ASUMSI', (ctx.glossaryFind('Asumsi') || {}).definisi)}</span></div>`);
  }
  if (nSumber) {
    stats.push(`<div class="stat"><span class="s-eyebrow">${esc(t('peluang.bukti.label'))}</span>
      <span class="s-num">${esc(fmt.int(nSumber))}</span>
      <span class="s-ctx">${esc(t('peluang.detail.klaim.judul'))}</span></div>`);
  }
  if (subskor && subskor.length) {
    stats.push(`<div class="stat"><span class="s-eyebrow">${esc(t('peluang.detail.stat.dimensi_kuat', null, 'Dimensi kuat'))}</span>
      <span class="s-num">${esc(fmt.int(nKuat))}<small>/${esc(String(subskor.length))}</small></span>
      <span class="s-ctx">${esc(t('peluang.detail.stat.dimensi_ket', null, 'sub-skor ≥ 4 dari 5'))}</span></div>`);
  }
  const statRow = stats.length ? `<div class="stat-row">${stats.join('')}</div>` : '';

  /* ---------- ringkasan: ringkas + "Selengkapnya" (konteks penuh tetap ada) ---------- */
  /* Pisah di batas kalimat pertama yang ≥120 char; bila ringkasan pendek → tampil utuh. */
  function splitProse(text, minHead) {
    const s = String(text || '').trim();
    if (s.length <= (minHead + 80)) return [s, ''];
    let cut = -1;
    const re = /[.!?](\s|$)/g; let m;
    while ((m = re.exec(s)) !== null) { if (m.index + 1 >= minHead) { cut = m.index + 1; break; } }
    if (cut < 0 || cut >= s.length - 1) return [s, ''];
    return [s.slice(0, cut).trim(), s.slice(cut).trim()];
  }
  let ringkasanHtml = '';
  if (copy.ringkasan) {
    const [head, rest] = splitProse(copy.ringkasan, 160);
    ringkasanHtml = `<div class="prose-clamp" style="margin-top:16px">${esc(head)}${rest
      ? ` ${disclose(`<p class="prose-clamp" style="margin-top:0">${esc(rest)}</p>`)}` : ''}</div>`;
  }

  /* ---------- risiko: ikon severity + 2 teratas terlihat, sisanya expand ---------- */
  const risikoArr = (copy.risiko || []).filter(Boolean);
  let risikoHtml = '';
  if (risikoArr.length) {
    const item = (r) => `<li class="risk-item"><span class="r-ico" aria-hidden="true">▲</span><span>${esc(r)}</span></li>`;
    const head = risikoArr.slice(0, 2).map(item).join('');
    const rest = risikoArr.slice(2).map(item).join('');
    risikoHtml = `
    <section class="section">
      <article class="card">
        <div class="eyebrow">${esc(t('peluang.detail.risiko_label', null, 'Risiko'))}</div>
        <h3 class="title block-takeaway">${esc(t('peluang.detail.risiko_judul', null, 'Risiko utama'))}</h3>
        <ul class="risk-list">${head}</ul>
        ${rest ? disclose(`<ul class="risk-list" style="margin-top:0">${rest}</ul>`,
    t('peluang.detail.risiko_lainnya', { n: fmt.int(risikoArr.length - 2) }, 'Selengkapnya')) : ''}
      </article>
    </section>`;
  }

  /* ---------- skenario tri-card ---------- */
  let scnHtml = '';
  if (sam && [sam.worst, sam.base, sam.best].some((x) => typeof x === 'number')) {
    const cell = (key, val) => `
      <div class="scn ${key === 'base' ? 'base' : ''}">
        <span class="scn-label">${esc(t('peluang.detail.pasar.' + key))}</span>
        <span class="scn-val">${esc(fmt.rp(val))}</span>
        <span class="asumsi-badge">${ttSpan('ASUMSI', (ctx.glossaryFind('Asumsi') || {}).definisi)}</span>
      </div>`;
    scnHtml = `
    <section class="section">
      <article class="card">
        <div class="eyebrow">${esc(t('peluang.detail.pasar.label', null, 'Ukuran pasar'))}</div>
        <h3 class="title block-takeaway">${ttSpan(t('peluang.detail.pasar.judul'), t('peluang.detail.pasar.tooltip_sam'))}</h3>
        <div class="scn-grid" role="group" aria-label="${esc(t('peluang.detail.pasar.judul'))}: ${esc(t('peluang.detail.pasar.worst'))} ${esc(fmt.rp(sam.worst))}; ${esc(t('peluang.detail.pasar.base'))} ${esc(fmt.rp(sam.base))}; ${esc(t('peluang.detail.pasar.best'))} ${esc(fmt.rp(sam.best))}">
          ${cell('worst', sam.worst)}${cell('base', sam.base)}${cell('best', sam.best)}
        </div>
        ${sam.formula ? `<p class="mono-ref scn-foot">${esc(t('peluang.detail.pasar.formula'))}: ${esc(sam.formula)}</p>` : ''}
      </article>
    </section>`;
  }

  /* ---------- jangkar harga lokal (§4.13) ---------- */
  let anchorHtml = '';
  const komp = pasar.kompetitor || [];
  if (komp.length) {
    anchorHtml = `
    <section class="section">
      <div class="eyebrow">${esc(t('peluang.detail.kompetitor.label', null, 'Jangkar harga lokal'))}</div>
      <h3 class="title block-takeaway">${esc(t('peluang.detail.kompetitor.judul'))}</h3>
      <div class="anchor-row">
        ${komp.map((k) => {
    const seg = String(k.harga || '').split(/\s+—\s+/);
    const price = seg[0] || t('umum.kosong');
    const src = seg.slice(1).join(' — ');
    return `<div class="anchor"><b>${esc(price)}</b>${esc(k.nama)}${k.positioning ? ` — ${esc(k.positioning)}` : ''}${src ? `<span class="a-src">${esc(src)}</span>` : ''}</div>`;
  }).join('')}
      </div>
    </section>`;
  }

  /* ---------- klaim ber-sumber (§4.12) ---------- */
  const klaim = opp.klaim || [];
  const klaimHtml = klaim.length ? `
    <section class="section" id="provenance-sec">
      <article class="card">
        <div class="eyebrow">${esc(t('peluang.bukti.label', null, 'Bukti'))}</div>
        <h3 class="title block-takeaway">${ttSpan(t('peluang.detail.klaim.judul'), t('peluang.bukti.tooltip_tier'))}</h3>
        <div class="claims">
          ${klaim.map((k) => `
          <div class="claim-item">
            ${ui.tierChip(k.tier)}
            <div class="claim-body">
              <p class="claim-text"><b>${esc(k.klaim)}</b>${k.kutipan ? ` — ${esc(k.kutipan)}` : ''}</p>
              ${k.grade ? `<p class="claim-grade">${esc(t('peluang.detail.klaim.kolom.grade'))}: ${esc(k.grade)}</p>` : ''}
              ${(k.sumber || k.url) ? `<p class="claim-ref">${ui.sourceLink({ sumber: k.sumber, url: k.url, tanggal_akses: k.tanggal_akses })}</p>` : ''}
            </div>
          </div>`).join('')}
        </div>
      </article>
    </section>` : '';

  /* ---------- limitations bernomor (§4.14) — 2 teratas tampil, sisanya expand ---------- */
  const lims = (opp.limitations && opp.limitations.length ? opp.limitations : copy.limitations) || [];
  const limItem = (l) => `<li><span>${esc(l)}</span></li>`;
  const limHead = lims.slice(0, 2);
  const limRest = lims.slice(2);
  const limHtml = lims.length ? `
    <section class="section">
      <article class="card limits">
        <div class="eyebrow">${esc(t('peluang.detail.limitations.judul'))}</div>
        <h3 class="title block-takeaway">${esc(t('peluang.detail.limitations.keterangan'))}</h3>
        <ol>${limHead.map(limItem).join('')}</ol>
        ${limRest.length ? disclose(`<ol start="3" style="counter-reset:lim 2">${limRest.map(limItem).join('')}</ol>`,
    t('peluang.detail.limitations_lainnya', { n: fmt.int(limRest.length) }, 'Selengkapnya')) : ''}
        <p class="limits-close">${esc(t('peluang.detail.limitations.penutup', null,
    'Kejujuran soal batas data adalah bagian dari produk riset ini — setiap angka ber-sumber atau ber-label ASUMSI.'))}</p>
      </article>
    </section>` : '';

  /* ---------- callouts: bukti · why-now (risiko punya blok sendiri ber-disclosure) ---------- */
  const ev = (copy.evidence_highlights || [])[0];
  const callouts = [];
  if (ev) {
    callouts.push(`<div class="callout ok"><div class="co-title">● ${esc(t('peluang.detail.bukti_judul', null, 'Bukti terkuat'))}</div>
      <p>${esc(ev.kutipan)}</p>
      <span class="co-src">${ui.tierChip(ev.tier)} ${ui.sourceLink(ev)}</span></div>`);
  }
  if (copy.why_now) {
    callouts.push(`<div class="callout tip"><div class="co-title">→ ${esc(t('peluang.detail.why_now'))}</div>
      <p>${esc(copy.why_now)}</p></div>`);
  }

  /* ---------- stepper regulasi (§4.9) ---------- */
  const milestones = reg.milestones || [];
  const dotMap = { lolos: ['✓', 'ok'], proses: ['◐', 'half'], blocker: ['✕', 'warn'], belum: ['◌', 'off'] };
  let halalDeadline = null;
  const stepHtml = milestones.map((m) => {
    const [sym, cls] = dotMap[m.status] || dotMap.belum;
    const tgl = parseTanggalIndo(m.catatan);
    let cdHtml = '';
    if (m.key === 'halal' && tgl) {
      halalDeadline = tgl;
      cdHtml = `<span class="s-status half" id="halal-cd" aria-live="polite"></span>`;
    }
    const refs = pasalChips(m.catatan, esc);
    return `
    <li class="step">
      <span class="s-dot ${cls}" aria-hidden="true">${sym}</span>
      <div>
        <div class="s-title">${esc(m.label || t('peluang.regulasi.' + m.key, null, m.key))}
          <span class="s-status ${cls}">${esc(t('peluang.regulasi.status.' + m.status, null, m.status))}</span>${cdHtml}</div>
        ${m.catatan ? `<p class="s-body">${esc(m.catatan)}</p>` : ''}
        ${refs ? `<div class="s-refs">${refs}</div>` : ''}
      </div>
    </li>`;
  }).join('');

  const redFlags = reg.red_flags || [];
  const redHtml = redFlags.length ? `
    <div class="callout warn" style="margin-top:14px">
      <div class="co-title">▲ ${esc(t('peluang.regulasi.red_flags'))}</div>
      ${redFlags.map((r) => `<p style="margin-bottom:6px">${esc(r)} ${pasalChips(r, esc)}</p>`).join('')}
    </div>` : '';

  /* ---------- breakdown chart card ---------- */
  // Footnote formula provenance: pakai label dimensi yang sudah dihumanisasi
  // (Traksi global, dst.), BUKAN kode internal W1–W5 — plane Wawasan bebas jargon.
  const formulaParts = dims
    ? dims.map((d) => `${d.max}×(${d.label}/5)`).join(' + ')
    : '';
  const chartCard = `
  <article class="card chart-card">
    <div class="eyebrow">${ttSpan(t('peluang.skor.label'), t('peluang.skor.tooltip'))}</div>
    <h3 class="title block-takeaway">${esc(typeof opp.wps === 'number' ? t('peluang.detail.skor_judul', { skor: fmt.int(opp.wps) }) : t('peluang.detail.skor_judul_kosong'))}</h3>
    <div id="bar5-wrap" style="flex:1;margin-top:8px"></div>
    ${dims ? `<p class="mono-ref" style="margin-top:10px">${esc(`${formulaParts} = ${fmt.int(opp.wps)}`)}${opp.qa ? ` · ${esc(t('peluang.qa.label'))}: ${esc(opp.qa === 'PASS' ? t('peluang.qa.pass') : opp.qa === 'FAIL' ? t('peluang.qa.fail') : t('peluang.qa.belum'))}` : ''}${data.week ? ` · ${esc(t('laporan.minggu', { minggu: fmt.minggu(data.week) }))}` : ''}</p>` : ''}
  </article>`;

  const stepCard = `
  <article class="card step-card">
    <div class="eyebrow">${esc(t('peluang.regulasi.label', null, 'Regulasi'))}</div>
    <h3 class="title block-takeaway">${esc(t('peluang.regulasi.judul'))}</h3>
    ${milestones.length ? `<ol class="stepper">${stepHtml}</ol>` : `<div style="margin-top:10px">${ui.belumChip()}</div>`}
    ${redHtml}
  </article>`;

  /* ---------- meta + dossier CTA ---------- */
  const metaBits = [opp.id, opp.kategori, opp.negara_asal].filter(Boolean).map(esc).join(' · ');
  const dossierCta = opp.dossier_md
    ? `<a class="cta" href="#/peluang/${encodeURIComponent(opp.id)}/dossier">${esc(t('peluang.cta.riset_lengkap'))} →</a>`
    : `<div class="empty-dash" style="max-width:380px">${esc(t('empty.peluang.riset_lengkap.apa'))} ${esc(t('empty.peluang.riset_lengkap.berikutnya'))}</div>`;

  el.innerHTML = `
  <header class="pagehead">
    <div>
      <div class="eyebrow">${esc(t('nav.wawasan.peluang.label'))} › <span class="num">${esc(opp.id)}</span></div>
      <h1 class="display-m">${esc(copy.headline || opp.nama)}</h1>
    </div>
    <div class="meta"><a class="textlink" href="#/peluang">${esc(t('umum.kembali'))} →</a></div>
  </header>

  <article class="card detail-hero">
    <div class="d-photo" role="img" aria-label="${esc(opp.gambar && opp.gambar.url ? opp.nama : t('peluang.kartu.tanpa_foto'))}">${fotoHtml}</div>
    <div class="d-headblock" style="min-width:0">
      <div class="opp-id">${metaBits}</div>
      <h2 class="d-name display">${esc(opp.nama)}</h2>
      <div class="d-details">
        <div class="d-meta">${esc(opp.brand || '')} · ${esc(t('peluang.detail.meta.tanggal'))}: <span class="num" style="font-size:12px">${esc(fmt.tanggal(opp.tanggal))}</span> · ${esc(statusLabel)}</div>
        <div class="d-badges">${ui.verdictBadge(opp.verdict)} ${ui.qaBadge(opp.qa)}</div>
      </div>
    </div>
    <div class="d-scorebox">
      ${typeof opp.wps === 'number'
    ? `<div class="mono-giant">${fmt.skor(opp.wps)}</div>
       <div class="d-meter"><i style="width:${Math.max(0, Math.min(100, opp.wps))}%"></i></div>
       <div class="d-delta num">${esc(deltaAmbang)}</div>`
    : `<div style="margin-bottom:8px">${ui.belumChip()}</div><div class="empty-dash">${esc(t('empty.peluang.skor.kenapa'))}</div>`}
    </div>
  </article>

  ${statRow}
  ${copy.insight_card ? `<blockquote class="pullquote">${esc(copy.insight_card)}</blockquote>` : ''}
  ${ringkasanHtml}
  ${opp.verdict && opp.verdict.alasan ? `<p class="cap" style="margin-top:8px;max-width:840px">${ui.verdictBadge(opp.verdict)} ${esc(opp.verdict.alasan)}</p>` : ''}

  <!-- provenance dinaikkan: klaim ber-sumber tepat setelah ringkasan/pull-quote (§v3.2 "provenance visible") -->
  ${klaimHtml}

  <div class="detail-grid">
    ${chartCard}
    ${stepCard}
  </div>

  ${callouts.length ? `<div class="callout-grid">${callouts.join('')}</div>` : ''}
  ${risikoHtml}
  ${scnHtml}
  ${anchorHtml}
  ${limHtml}

  <div class="detail-foot">
    <span class="srcline">${esc(t('umum.terakhir_diperbarui', { tanggal: fmt.tanggal(data.generated_at) }))}${data.week ? ` · <span class="num">${esc(t('laporan.minggu', { minggu: fmt.minggu(data.week) }))}</span>` : ''}</span>
    ${dossierCta}
  </div>`;

  ui.bindImgFallbacks(el);

  /* ---------- chart breakdown ---------- */
  function renderChart() {
    const wrap = el.querySelector('#bar5-wrap');
    if (!wrap) return;
    if (!subskor.length) { wrap.innerHTML = `<div>${ui.belumChip()}</div><div class="empty-dash" style="margin-top:8px">${esc(t('empty.peluang.skor.kenapa'))}</div>`; return; }
    if (!dims) {
      /* sub-skor ada tapi kontribusi tak bisa diverifikasi → tampilkan nilai mentah (tanpa angka karangan) */
      wrap.innerHTML = subskor.map((s) => `
        <div style="display:flex;align-items:center;gap:10px;padding:6px 0">
          <span style="flex:0 0 150px;font-size:12.5px;font-weight:600">${esc(s.label || t('peluang.dimensi.' + s.key + '.label'))}</span>
          ${ui.meter((s.nilai / 5) * 100)}
          <span class="mono-data">${esc(fmt.int(s.nilai))}/5</span>
        </div>`).join('');
      return;
    }
    const aria = `${esc(t('peluang.skor.label'))}: ${esc(dims.map((d) => `${d.label} ${fmt.dec(d.pts, 1)} dari ${d.max}`).join('; '))}`;
    if (!charts.ok) {
      wrap.innerHTML = ui.chartFallback(dims.map((d) => `<span class="num">${esc(fmt.dec(d.pts, 1))}/${esc(String(d.max))}</span> — ${esc(d.label)} (${esc(String(d.sub))}/5)`).join('<br>'));
      return;
    }
    wrap.innerHTML = `<div class="chart-box tall" id="bar5" role="img" aria-label="${aria}"></div>`;
    const tok = charts.tokens();
    const c = charts.init(wrap.querySelector('#bar5'));
    if (!c) return;
    c.setOption({
      ...charts.ANIM,
      grid: { left: 168, right: 18, top: 8, bottom: 8 },
      tooltip: {
        formatter: (p) => {
          const d = dims[p.dataIndex];
          return `<b>${d.label}</b><br>${fmt.int(d.sub)}/5 · ${fmt.dec(d.pts, 1)}/${d.max}`;
        },
      },
      xAxis: { type: 'value', max: Math.max(...dims.map((d) => d.max)), show: false },
      yAxis: {
        type: 'category', inverse: true,
        data: dims.map((d) => `${d.label}|${fmt.dec(d.pts, 1)}/${d.max} · ${d.sub}/5`),
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: {
          margin: 12,
          formatter: (v) => { const p = v.split('|'); return `{a|${p[0]}}\n{b|${p[1]}}`; },
          rich: {
            a: { color: tok.text1, fontFamily: tok.body, fontSize: 12.5, fontWeight: 600, lineHeight: 18, align: 'right' },
            b: { color: tok.text3, fontFamily: tok.mono, fontSize: 10.5, lineHeight: 14, align: 'right' },
          },
        },
      },
      series: [
        {
          type: 'bar', stack: 's', barWidth: 13, z: 2,
          data: dims.map((d) => ({ value: d.pts, itemStyle: { color: d.sub <= 1 ? tok.warn : tok.chart, borderRadius: [3, 0, 0, 3] } })),
        },
        {
          type: 'bar', stack: 's', barWidth: 13, silent: true, z: 1,
          itemStyle: { color: tok.track, borderRadius: [0, 3, 3, 0] },
          data: dims.map((d) => Math.max(d.max - d.pts, 0)),
        },
      ],
    });
  }
  renderChart();

  /* ---------- countdown tenggat halal (live, §4.9) ---------- */
  let timer = null;
  function tickHalal() {
    const elCd = el.querySelector('#halal-cd');
    if (!elCd || !halalDeadline) return;
    const ms = halalDeadline.date.getTime() - Date.now();
    const days = Math.ceil(ms / 86400000);
    if (ms <= 0) {
      elCd.className = 's-status warn';
      elCd.textContent = `✕ ${t('peluang.regulasi.tenggat_lewat', null, 'tenggat terlewati')}`;
    } else {
      elCd.className = 's-status ' + (days <= 30 ? 'warn' : 'half');
      elCd.textContent = t('peluang.regulasi.tenggat_sisa', { n: fmt.int(days) }, '{n} hari tersisa');
    }
  }
  if (halalDeadline) { tickHalal(); timer = setInterval(tickHalal, 60000); }

  const onRecharts = () => renderChart();
  document.addEventListener('pimas:recharts', onRecharts);
  return () => {
    if (timer) clearInterval(timer);
    document.removeEventListener('pimas:recharts', onRecharts);
  };
}

/* ============ sub-route: dossier (riset lengkap) ============ */
function renderDossier(el, ctx, opp) {
  const { t, esc, ui, renderMd } = ctx;
  el.innerHTML = `
  <header class="pagehead">
    <div>
      <div class="eyebrow">${esc(t('nav.wawasan.peluang.label'))} › <span class="num">${esc(opp.id)}</span> › ${esc(t('peluang.cta.riset_lengkap'))}</div>
      <h1 class="display-m">${esc(opp.nama)}</h1>
    </div>
    <div class="meta"><a class="textlink" href="#/peluang/${encodeURIComponent(opp.id)}">${esc(t('umum.kembali'))} →</a></div>
  </header>
  <article class="card" id="dossier-card">${ui.skeleton('page')}</article>`;

  const card = el.querySelector('#dossier-card');
  if (!opp.dossier_md) {
    card.innerHTML = ui.empty('empty.peluang.riset_lengkap');
    return undefined;
  }
  let alive = true;
  renderMd(opp.dossier_md).then((html) => {
    if (alive) card.innerHTML = `<div class="md-body">${html}</div>`;
  }).catch(() => {
    if (alive) card.innerHTML = `<div class="empty"><p class="e-apa">${esc(t('error.dokumen.judul'))}</p><p class="e-kenapa">${esc(t('error.dokumen.pesan'))}</p><p class="e-next">${esc(t('error.dokumen.tindakan'))}</p></div>`;
  });
  return () => { alive = false; };
}
