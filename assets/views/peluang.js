/*
 * View: Peluang — galeri opportunity card (DESIGN §4.3 lengkap), filter status,
 * sort, leaderboard horizontal bar + markLine ambang (§5 aturan 2), arsip
 * keputusan, drawer detail ringkas (§4.18). Data: payload.opportunities + arsip.
 */

/** url http(s) valid → boleh jadi <a> (pola link sumber v3.1; anti link mati/XSS). */
function httpUrl(u) {
  const s = String(u || '').trim();
  return /^https?:\/\//i.test(s) ? s : null;
}

/** Normalisasi dua bentuk sub-skor provisional ke {w, skor, catatan}:
    - subskor_scout (arsip): {w:"W1", skor, catatan} — sudah sesuai.
    - subskor (peluang ter-riset tanpa WPS final, mis. MONORI QA-fail): {key:"w1", nilai, alasan}.
    Hanya entri ber-skor numerik yang dipertahankan (anti-mengarang). */
function normProvisional(arr) {
  return (arr || [])
    .map((s) => {
      const w = String(s.w || s.key || '').toUpperCase();
      const skor = (typeof s.skor === 'number') ? s.skor
        : (typeof s.nilai === 'number') ? s.nilai : null;
      const catatan = s.catatan || s.alasan || '';
      return (w && skor !== null) ? { w, skor, catatan } : null;
    })
    .filter(Boolean);
}

/** Blok mini W1–W5 provisional (dipakai ulang oleh kartu arsip DAN kartu peluang
    tanpa WPS final). Chip OUTLINE dashed berlabel eksplisit "provisional" — BUKAN
    meter/bar sub-skor ter-QA (anti-mengarang). labelKey memilih wording yang jujur
    sesuai sumber: scout (pemindaian) vs sementara (riset tanpa WPS final). */
function provisionalSubskorBlock(rows, ctx, labelKey) {
  const { t, esc, ttSpan } = ctx;
  const items = normProvisional(rows);
  if (!items.length) return '';
  return `
      <div class="arc-scout">
        <span class="arc-scout-label">${ttSpan(t(labelKey + '.label'), t(labelKey + '.keterangan'))}</span>
        <div class="arc-scout-chips">${items.map((s) => {
    const label = t('peluang.dimensi.' + String(s.w).toLowerCase() + '.label', null, s.w);
    const chip = `${label} ${s.skor}/5`;
    return `<span class="scout-chip">${s.catatan ? ttSpan(chip, s.catatan) : esc(chip)}</span>`;
  }).join('')}</div>
      </div>`;
}

/** Kartu §4.3 — anatomi scannable: foto · judul · skor+meter+verdict · chip regulasi ·
    "Yang menarik" (insight_card) · deskripsi singkat · provenance · catatan risiko ·
    link produk · CTA tunggal. */
export function oppCard(o, ctx, opts = {}) {
  const { t, esc, fmt, ui } = ctx;
  const copy = o.copy || {};
  const monogram = `<span class="ph-mono" aria-hidden="true">${esc((o.nama || '?').charAt(0).toUpperCase())}</span>`;
  /* foto produk: referrerpolicy no-referrer wajib (hotlink openfoodfacts/zdnet),
     lazy, fallback "FOTO BELUM TERSEDIA" via data-fallback-img (handler app.js — CSP). */
  const foto = o.gambar && o.gambar.url
    ? `<img src="${esc(o.gambar.url)}" alt="${esc(o.nama)}" loading="lazy" referrerpolicy="no-referrer" data-fallback-img><span class="ph-fallback">${monogram}</span>`
    : monogram;
  const hasWps = (o.wps !== null && o.wps !== undefined);
  const skorHtml = hasWps
    ? `<span class="mono-score">${fmt.skor(o.wps)}</span>${ui.meter(o.wps)}`
    : `<span class="chip-belum">◌ ${esc(t('peluang.skor.belum'))}</span>`;
  /* WPS final belum terbit (mis. MONORI QA-fail) tetapi sub-skor per dimensi sudah
     ada di payload → tampilkan rincian W1–W5 provisional, jangan biarkan "Belum diskor"
     telanjang. Pilih subskor (riset → "sementara") jika ada, jika tidak subskor_scout
     (pemindaian → "scout"). Saat WPS final ADA, breakdown disajikan di halaman detail. */
  const provHtml = hasWps ? '' : (
    (Array.isArray(o.subskor) && o.subskor.length)
      ? provisionalSubskorBlock(o.subskor, ctx, 'peluang.detail.skor_sementara')
      : provisionalSubskorBlock(o.subskor_scout, ctx, 'peluang.detail.skor_scout')
  );
  const regChips = ((o.regulasi || {}).milestones || []).slice(0, 3).map((m) => ui.regChip(m)).join(' ');
  const ev = (copy.evidence_highlights || [])[0] || (o.klaim || [])[0] || null;
  const risiko = (copy.risiko || [])[0];
  const prodUrl = httpUrl(o.produk_url);
  /* label tanpa panah trailing dari string (→/↗) — ikon external ↗ kanonik ditambah sendiri */
  const prodLabel = String(t('peluang.kartu.lihat_produk', null, 'Lihat produk')).replace(/[\s→↗]+$/u, '');
  /* focal point galeri: kartu skor tertinggi dapat ring --accent + badge */
  const topBadge = opts.top
    ? `<span class="opp-topflag"><span aria-hidden="true">★</span> ${esc(t('peluang.kartu.skor_tertinggi', null, 'Skor tertinggi'))}</span>`
    : '';

  /* "Yang menarik": eyebrow kecil + insight 1 kalimat (emphasis ringan, border-left accent) */
  const menarikHtml = copy.insight_card
    ? `<div class="opp-menarik">
        <span class="opp-menarik-eyebrow">${esc(t('peluang.kartu.menarik', null, 'Yang menarik'))}</span>
        <p class="opp-insight">${esc(copy.insight_card)}</p>
      </div>`
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
    ${provHtml}
    ${regChips ? `<div class="opp-reg">${regChips}</div>` : ''}
    ${menarikHtml}
    ${o.deskripsi_singkat ? `<p class="opp-desc">${esc(o.deskripsi_singkat)}</p>` : ''}
    ${ev ? `<div class="opp-src">${ui.tierChip(ev.tier)} ${ui.sourceLink(ev)}</div>` : ''}
    ${risiko ? `<div class="opp-note"><span aria-hidden="true">⚠</span><span>${esc(risiko)}</span></div>` : ''}
    <div class="opp-foot">
      ${prodUrl ? `<a class="opp-prodlink" href="${esc(prodUrl)}" target="_blank" rel="noopener noreferrer">${esc(prodLabel)}<span class="src-ext" aria-hidden="true">↗</span></a>` : ''}
      <button class="textlink" data-opp="${esc(o.id)}">${esc(t('peluang.cta.detail'))} →</button>
    </div>
  </article>`;
}

/** Kartu arsip RINGAN (§4.20 fallback + §8 #17): thumbnail kecil (56px) + nama ·
    brand · kategori + 1 baris deskripsi (bila ada) + status badge + alasan (clamp)
    + link produk eksternal. Lebih redup/kecil dari opportunity card — arsip =
    dipantau/tak dilanjutkan, bukan fokus. gambar/desc/produk_url mayoritas null →
    fallback monogram (BUKAN broken img / area kosong). */
function arsipCard(a, ctx, statusBadge) {
  const { t, esc, fmt } = ctx;
  const monogram = `<span class="ph-mono" aria-hidden="true">${esc((a.nama || '?').charAt(0).toUpperCase())}</span>`;
  /* thumbnail: referrerpolicy no-referrer (hotlink OFF/halaman produk), lazy,
     fallback monogram via data-fallback-img (handler app.js — CSP, BUKAN onerror inline). */
  const foto = a.gambar && a.gambar.url
    ? `<img src="${esc(a.gambar.url)}" alt="${esc(a.nama)}" loading="lazy" referrerpolicy="no-referrer" data-fallback-img><span class="ph-fallback">${monogram}</span>`
    : monogram;
  const hasImg = !!(a.gambar && a.gambar.url);
  const prodUrl = httpUrl(a.produk_url);
  const prodLabel = String(t('peluang.kartu.lihat_produk', null, 'Lihat produk')).replace(/[\s→↗]+$/u, '');
  const meta = [a.kategori, a.id].filter(Boolean).map(esc).join(' · ');
  /* F3 — skor scout provisional: chip OUTLINE dashed berlabel eksplisit, BUKAN
     komponen meter/bar sub-skor ter-QA (anti-mengarang: penilaian awal pemindaian).
     Markup identik dengan blok provisional kartu peluang (helper bersama). */
  const scoutHtml = provisionalSubskorBlock(a.subskor_scout, ctx, 'peluang.detail.skor_scout');
  return `
  <article class="arc-card">
    <div class="arc-photo" role="img" aria-label="${esc(hasImg ? a.nama : t('peluang.kartu.tanpa_foto'))}">${foto}</div>
    <div class="arc-main">
      <div class="arc-head">
        <div class="arc-id-wrap">
          <div class="arc-title">${esc(a.nama)}</div>
          ${a.brand ? `<div class="arc-brand">${esc(a.brand)}</div>` : ''}
        </div>
        ${statusBadge(a.status)}
      </div>
      <div class="arc-meta">${meta}</div>
      ${a.deskripsi_singkat ? `<p class="arc-desc">${esc(a.deskripsi_singkat)}</p>` : ''}
      ${a.alasan ? `<p class="arc-alasan">${esc(a.alasan)}</p>` : ''}
      ${scoutHtml}
      <div class="arc-foot">
        <span class="arc-date">${esc(fmt.tanggal(a.tanggal))}</span>
        ${prodUrl ? `<a class="arc-prodlink" href="${esc(prodUrl)}" target="_blank" rel="noopener noreferrer">${esc(prodLabel)}<span class="src-ext" aria-hidden="true">↗</span></a>` : ''}
      </div>
    </div>
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
    <h2 class="display-m" style="margin:8px 0 4px;max-width:60ch">${esc(t('peluang.leaderboard.takeaway', null, 'Siapa yang melewati ambang lapor'))}</h2>
    <p class="cap">${esc(t('peluang.leaderboard.keterangan', null, 'Posisi tiap skor terhadap ambang lapor (60) — ranking lengkap ada di galeri kartu di bawah.'))}</p>
    <div id="lb-chart-wrap" style="margin-top:10px"></div>
  </article>

  <section class="section">
    <div class="section-head">
      <div class="eyebrow">${esc(t('nav.wawasan.peluang.label'))}</div>
      <h2 class="display-m">${esc(t('peluang.galeri.judul', null, 'Galeri peluang — kartu lengkap per kandidat'))}</h2>
    </div>
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
  </section>

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
    else if (fSort === 'terbaru') {
      /* recency andal: 'tanggal' identik untuk SELURUH batch mingguan (kandidat dalam
         satu batch tak terurut). Pakai created_at bila ada, jika tidak fallback ke id
         berformat C-YYYYWW-NN (lexicographic = newest-last: minggu lebih besar lebih baru,
         NN menanjak dalam minggu). Descending → terbaru di atas. */
      const recency = (o) => String(o.created_at || o.id || '');
      rows.sort((a, b) => recency(b).localeCompare(recency(a)));
    } else rows.sort((a, b) => String(a.nama || '').localeCompare(String(b.nama || '')));
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

  /* ---------- arsip (kartu ringkas ber-thumbnail; lebih redup dari galeri) ---------- */
  const arsipStatusBadge = (s) => {
    const map = { reported: ['●', 'ok'], shortlist: ['◎', 'tip'], raw: ['◌', 'plain'], parked: ['◌', 'plain'], rejected: ['✕', 'warn'] };
    const [sym, cls] = map[s] || ['◌', 'plain'];
    return `<span class="badge ${cls}">${sym} ${esc(t('peluang.filter.status.' + s, null, s))}</span>`;
  };
  function renderArsip() {
    const wrap = el.querySelector('#arsip-wrap');
    let rows = arsip.slice();
    if (fStatus !== 'semua') rows = rows.filter((a) => a.status === fStatus);
    if (!arsip.length) { wrap.innerHTML = `<div class="card">${ui.empty('empty.arsip')}</div>`; return; }
    if (!rows.length) { wrap.innerHTML = `<div class="card">${ui.empty('empty.peluang.filter')}</div>`; return; }
    wrap.innerHTML = `<div class="arc-grid">${rows.map((a) => arsipCard(a, ctx, arsipStatusBadge)).join('')}</div>`;
    ui.bindImgFallbacks(wrap);
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
