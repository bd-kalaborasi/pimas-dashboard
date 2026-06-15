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
  /* referrerpolicy no-referrer wajib (hotlink openfoodfacts/zdnet) + lazy + fallback (data-fallback-img, app.js — CSP) */
  const fotoHtml = opp.gambar && opp.gambar.url
    ? `<img src="${esc(opp.gambar.url)}" alt="${esc(opp.nama)}" loading="lazy" referrerpolicy="no-referrer" data-fallback-img><span class="ph-fallback">${fotoFallback}</span>`
    : fotoFallback;

  /* ---------- caption atribusi foto (WAJIB untuk CC-BY-SA) ----------
     "Foto: {sumber} · {lisensi} · diakses {tanggal}" dengan link ke gambar.sumber_url.
     Lisensi null → tetap tampil sumber + tanggal (segmen lisensi dilewati). */
  let fotoAtribusi = '';
  if (opp.gambar && opp.gambar.url) {
    const g = opp.gambar;
    const srcUrl = /^https?:\/\//i.test(String(g.sumber_url || '').trim()) ? String(g.sumber_url).trim() : null;
    const sumberLabel = srcUrl
      ? srcUrl.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
      : t('umum.kosong');
    const sumberHtml = srcUrl
      ? `<a class="src-link" href="${esc(srcUrl)}" target="_blank" rel="noopener noreferrer">${esc(sumberLabel)}<span class="src-ext" aria-hidden="true">↗</span></a>`
      : esc(sumberLabel);
    /* lisensi: label ringkas terlihat (mis. "CC BY-SA · Open Food Facts"); teks lisensi
       mentah jadi tooltip (provenance utuh — dipadatkan, bukan dihapus). */
    let lisensiHtml = '';
    if (g.lisensi_ringkas) lisensiHtml = g.lisensi ? ttSpan(g.lisensi_ringkas, String(g.lisensi)) : esc(g.lisensi_ringkas);
    else if (g.lisensi) lisensiHtml = esc(String(g.lisensi));
    /* rakit baris: prefix "Foto:" + sumber(link) + [· lisensi ringkas] + [· diakses tgl] */
    const bits = [sumberHtml];
    if (lisensiHtml) bits.push(lisensiHtml);
    if (g.tanggal_akses) bits.push(esc(t('peluang.detail.gambar_diakses', { tanggal: fmt.tanggal(g.tanggal_akses) }, 'diakses {tanggal}')));
    fotoAtribusi = `<p class="d-photo-cap">${esc(t('peluang.detail.gambar_atribusi_prefix', null, 'Foto:'))} ${bits.join(' · ')}</p>`;
  }

  const deltaAmbang = (typeof opp.wps === 'number')
    ? t('peluang.detail.delta_ambang', { delta: fmt.delta(opp.wps - AMBANG), ambang: fmt.int(AMBANG) }, '{delta} vs ambang lapor ({ambang})')
    : '';

  /* ---------- helper disclosure "Selengkapnya / Tutup" (progressive disclosure) ---------- */
  const disclose = (bodyHtml, openLabel) => `
    <details class="disclose">
      <summary><span class="lbl-buka">${esc(openLabel || t('umum.selengkapnya'))}</span><span class="lbl-tutup">${esc(t('umum.tutup'))}</span></summary>
      <div class="disclose-body">${bodyHtml}</div>
    </details>`;

  /* ---------- footnote "Cara hitung": kalimat metode awam + rumus teknis mentah di tooltip ----------
     ringkas (humanized) tampil; raw formula tersimpan di tooltip "rumus teknis" (provenance utuh,
     dipadatkan — bukan dihapus). Hanya raw → tampil apa adanya (fallback). */
  const formulaFoot = (label, ringkas, raw) => (ringkas || raw)
    ? `<p class="scn-foot cara-hitung"><span class="ch-k">${esc(label)}:</span> ${ringkas ? esc(ringkas) : esc(String(raw))}${(ringkas && raw) ? ` ${ttSpan(t('peluang.detail.rumus_teknis'), String(raw))}` : ''}</p>`
    : '';

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
      <span class="asumsi-badge">${ttSpan(t('peluang.detail.asumsi_badge', null, 'ASUMSI'), (ctx.glossaryFind('Asumsi') || {}).definisi)}</span></div>`);
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

  /* ---------- F1 helper: chip metode ("dasar angka") + tooltip ----------
     Lookup literal dari nilai payload (sumber-langsung|formula|ASUMSI|
     search-snippet|halaman-publik) — "ASUMSI" uppercase di-lowercase-kan.
     Nilai di luar vocabulary → chip teks apa adanya TANPA t() (hindari warn). */
  const METODE_KEYS = ['sumber-langsung', 'formula', 'asumsi', 'search-snippet', 'halaman-publik'];
  const metodeBadge = (metode) => {
    const key = String(metode || '').trim().toLowerCase();
    if (!key) return '';
    if (!METODE_KEYS.includes(key)) return `<span class="metode-chip">${esc(metode)}</span>`;
    return `<span class="metode-chip ${key === 'asumsi' ? 'asumsi' : ''}">${ttSpan(t('peluang.detail.metode.label.' + key), t('peluang.detail.metode.tooltip.' + key))}</span>`;
  };

  /* ---------- F1 #5: segmen "Siapa pembelinya" — blok kecil di kartu pasar ---------- */
  const segmenInner = pasar.segmen
    ? `<div class="sg-title">${ttSpan(t('peluang.detail.segmen.judul'), t('peluang.detail.segmen.subjudul'))}</div><p>${esc(pasar.segmen)}</p>`
    : '';

  /* ---------- skenario tri-card ---------- */
  let scnHtml = '';
  if (sam && [sam.worst, sam.base, sam.best].some((x) => typeof x === 'number')) {
    const cell = (key, val) => `
      <div class="scn ${key === 'base' ? 'base' : ''}">
        <span class="scn-label">${esc(t('peluang.detail.pasar.' + key))}</span>
        <span class="scn-val">${esc(fmt.rp(val))}</span>
        <span class="asumsi-badge">${ttSpan(t('peluang.detail.asumsi_badge', null, 'ASUMSI'), (ctx.glossaryFind('Asumsi') || {}).definisi)}</span>
      </div>`;
    scnHtml = `
    <section class="section">
      <article class="card">
        <div class="eyebrow">${esc(t('peluang.detail.pasar.label', null, 'Ukuran pasar'))}</div>
        <h3 class="title block-takeaway">${ttSpan(t('peluang.detail.pasar.judul'), t('peluang.detail.pasar.tooltip_sam'))}</h3>
        <div class="scn-grid" role="group" aria-label="${esc(t('peluang.detail.pasar.judul'))}: ${esc(t('peluang.detail.pasar.worst'))} ${esc(fmt.rp(sam.worst))}; ${esc(t('peluang.detail.pasar.base'))} ${esc(fmt.rp(sam.base))}; ${esc(t('peluang.detail.pasar.best'))} ${esc(fmt.rp(sam.best))}">
          ${cell('worst', sam.worst)}${cell('base', sam.base)}${cell('best', sam.best)}
        </div>
        ${formulaFoot(t('peluang.detail.pasar.formula'), sam.formula_ringkas, sam.formula)}
        <div class="segmen-block">${segmenInner || ui.empty('empty.peluang.segmen')}</div>
      </article>
    </section>`;
  } else if (segmenInner) {
    /* SAM belum ada tapi segmen terisi → kartu pasar kecil berisi segmen saja */
    scnHtml = `
    <section class="section">
      <article class="card"><div class="segmen-block standalone">${segmenInner}</div></article>
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

  /* ---------- F1 #4: landed cost — tri-skenario Rp, menyandingi jangkar harga ---------- */
  let lcHtml = '';
  const lc = pasar.landed_cost;
  if (lc && ['worst', 'base', 'best'].some((k) => typeof lc[k] === 'number')) {
    const unitTxt = lc.unit ? t('peluang.detail.landed_cost.satuan', { unit: lc.unit }) : '';
    const lcCell = (k) => `
      <div class="scn ${k === 'base' ? 'base' : ''}">
        <span class="scn-label">${esc(t('peluang.detail.landed_cost.skenario.' + k))}</span>
        <span class="scn-val">${esc(fmt.rp(lc[k]))}</span>
        ${unitTxt ? `<span class="scn-ctx">${esc(unitTxt)}</span>` : ''}
      </div>`;
    const lcAria = `${esc(t('peluang.detail.landed_cost.judul'))}: ${esc(t('peluang.detail.landed_cost.skenario.worst'))} ${esc(fmt.rp(lc.worst))}; ${esc(t('peluang.detail.landed_cost.skenario.base'))} ${esc(fmt.rp(lc.base))}; ${esc(t('peluang.detail.landed_cost.skenario.best'))} ${esc(fmt.rp(lc.best))}${unitTxt ? ` ${esc(unitTxt)}` : ''}`;
    lcHtml = `
    <section class="section">
      <article class="card">
        <h3 class="title block-takeaway">${esc(t('peluang.detail.landed_cost.judul'))}</h3>
        <p class="panel-sub">${esc(t('peluang.detail.landed_cost.subjudul'))}</p>
        <div class="scn-grid" role="group" aria-label="${lcAria}">
          ${lcCell('worst')}${lcCell('base')}${lcCell('best')}
        </div>
        <div class="panel-meta"><span><span class="pm-k">${esc(t('peluang.detail.landed_cost.metode_label'))}</span> ${metodeBadge(lc.metode)}</span></div>
        ${formulaFoot(t('peluang.detail.landed_cost.formula_label'), lc.formula_ringkas, lc.formula)}
      </article>
    </section>`;
  }

  /* ---------- F1 #1: revenue brand di pasar asal ----------
     Nilai dirender VERBATIM (string payload apa adanya, mono) — keputusan PM #1:
     tanpa konversi mata uang, tertelusur byte-per-byte. null → empty state berlabel
     (kandidat tanpa estimasi revenue = kasus uji; JANGAN angka 0). */
  let revHtml = '';
  {
    const rev = opp.revenue;
    if (rev) {
      const revVal = (k) => (rev[k] ? String(rev[k]) : t('umum.kosong'));
      const revCell = (k) => `
        <div class="scn ${k === 'base' ? 'base' : ''}">
          <span class="scn-label">${esc(t('peluang.detail.revenue.skenario.' + k))}</span>
          <span class="scn-val">${esc(revVal(k))}</span>
        </div>`;
      const metaBits = [
        `<span><span class="pm-k">${esc(t('peluang.detail.revenue.metode_label'))}</span> ${metodeBadge(rev.metode)}</span>`,
      ];
      if (rev.periode) metaBits.push(`<span><span class="pm-k">${esc(t('peluang.detail.revenue.periode'))}</span> <span class="num" style="font-size:11.5px">${esc(rev.periode)}</span></span>`);
      if (rev.entitas) metaBits.push(`<span><span class="pm-k">${esc(t('peluang.detail.revenue.entitas'))}</span> ${esc(rev.entitas)}</span>`);
      if (rev.sumber_url) metaBits.push(`<span>${ui.sourceLink({ url: rev.sumber_url, tanggal_akses: rev.tanggal_akses })}</span>`);
      const inputs = rev.inputs || [];
      const kol = (k) => t('peluang.detail.revenue.inputs_kolom.' + k);
      const inputsHtml = inputs.length ? disclose(`
        <div class="table-wrap"><table class="data-table tbl-stack">
          <thead><tr>
            <th scope="col">${esc(kol('input'))}</th><th scope="col">${esc(kol('nilai'))}</th>
            <th scope="col">${esc(kol('sumber'))}</th><th scope="col">${esc(kol('tanggal'))}</th>
            <th scope="col">${esc(kol('tier'))}</th>
          </tr></thead>
          <tbody>${inputs.map((i) => `<tr>
            <td data-label="${esc(kol('input'))}">${esc(i.input || '')}</td>
            <td data-label="${esc(kol('nilai'))}">${esc(i.nilai || '')}</td>
            <td data-label="${esc(kol('sumber'))}">${i.url ? ui.sourceLink({ url: i.url }) : esc(t('umum.kosong'))}</td>
            <td data-label="${esc(kol('tanggal'))}" class="td-mono">${i.tanggal_akses ? esc(fmt.tanggal(i.tanggal_akses)) : esc(t('umum.kosong'))}</td>
            <td data-label="${esc(kol('tier'))}">${ui.tierChip(i.tier) || esc(t('umum.kosong'))}</td>
          </tr>`).join('')}</tbody>
        </table></div>`, t('peluang.detail.revenue.inputs_judul')) : '';
      const revAria = `${esc(t('peluang.detail.revenue.judul'))}: ${esc(t('peluang.detail.revenue.skenario.worst'))} ${esc(revVal('worst'))}; ${esc(t('peluang.detail.revenue.skenario.base'))} ${esc(revVal('base'))}; ${esc(t('peluang.detail.revenue.skenario.best'))} ${esc(revVal('best'))}`;
      revHtml = `
      <section class="section">
        <article class="card">
          <h3 class="title block-takeaway">${esc(t('peluang.detail.revenue.judul'))}</h3>
          <p class="panel-sub">${esc(t('peluang.detail.revenue.subjudul'))}</p>
          <div class="scn-grid" role="group" aria-label="${revAria}">
            ${revCell('worst')}${revCell('base')}${revCell('best')}
          </div>
          <div class="panel-meta">${metaBits.join('')}</div>
          ${formulaFoot(t('peluang.detail.revenue.cara_hitung'), rev.formula_ringkas, rev.formula)}
          ${inputsHtml}
        </article>
      </section>`;
    } else {
      revHtml = `
      <section class="section">
        <article class="card">
          <h3 class="title block-takeaway">${esc(t('peluang.detail.revenue.judul'))}</h3>
          ${ui.empty('empty.peluang.revenue')}
        </article>
      </section>`;
    }
  }

  /* ---------- F1 #2: rating konsumen per platform ----------
     DILARANG agregat/rata-rata lintas platform; nilai SELALU bersama skala + n.
     metode=search-snippet → kartu diredam (indikasi, bukan bukti setara).
     Flags di luar vocabulary terkontrol → chip teks apa adanya tanpa t(). */
  let ratingHtml = '';
  {
    const rows = opp.rating;
    const RATING_FLAGS = ['n-kecil', 'kategori-rawan-fake-review', 'snippet-stale', 'self-selection'];
    const body = (rows && rows.length) ? `
      <div class="rate-grid">
        ${rows.map((r) => {
    const muted = String(r.metode || '').trim().toLowerCase() === 'search-snippet';
    const nilai = (typeof r.nilai === 'number') ? fmt.dec(r.nilai, 2) : t('umum.kosong');
    const skala = (r.skala === null || r.skala === undefined) ? '' : `<small>/${esc(String(r.skala))}</small>`;
    let nHtml;
    if (typeof r.n_rating === 'number') nHtml = `${esc(t('peluang.detail.rating.kolom.n_rating'))}: <span class="num">${esc(fmt.int(r.n_rating))}</span>`;
    else if (typeof r.n_review === 'number') nHtml = `${esc(t('peluang.detail.rating.kolom.n_review'))}: <span class="num">${esc(fmt.int(r.n_review))}</span>`;
    else nHtml = `${esc(t('peluang.detail.rating.kolom.n_rating'))}: ${esc(t('umum.kosong'))}`;
    const flags = (r.flags || []).map((f) => {
      const key = String(f || '').trim();
      return RATING_FLAGS.includes(key)
        ? `<span class="flag-chip">${ttSpan(key, t('peluang.detail.rating.flags.' + key))}</span>`
        : `<span class="flag-chip">${esc(key)}</span>`;
    }).join('');
    return `
        <div class="rate-card${muted ? ' muted' : ''}">
          <span class="rate-platform">${esc(r.platform || '')}</span>
          <div class="rate-score">
            <span class="rate-val">${esc(nilai)}${skala}</span>
            <span class="rate-n">${nHtml}</span>
          </div>
          <div class="rate-meta">${metodeBadge(r.metode)} ${ui.tierChip(r.tier)}</div>
          ${flags ? `<div class="rate-flags">${flags}</div>` : ''}
          ${r.url ? `<span class="rate-src">${ui.sourceLink({ url: r.url, tanggal_akses: r.tanggal_akses })}</span>` : ''}
        </div>`;
  }).join('')}
      </div>
      <p class="cap" style="margin-top:10px">${esc(t('peluang.detail.rating.per_platform_catatan'))}</p>`
      : ui.empty('empty.peluang.rating');
    ratingHtml = `
    <section class="section">
      <article class="card">
        <h3 class="title block-takeaway">${esc(t('peluang.detail.rating.judul'))}</h3>
        <p class="panel-sub">${esc(t('peluang.detail.rating.subjudul'))}</p>
        ${body}
      </article>
    </section>`;
  }

  /* ---------- F1 #3: suara konsumen — kutipan verbatim ----------
     Urutan payload dipertahankan (kutipan negatif TIDAK disembunyikan/diturunkan);
     2 teratas tampil, sisanya di balik "Selengkapnya". */
  let sentimenHtml = '';
  {
    const sents = opp.sentimen;
    const sentItem = (s) => `
      <figure class="sent-item">
        <blockquote class="sent-quote">“${esc(s.kutipan)}”</blockquote>
        <figcaption>
          <span class="sent-attr">${esc(s.atribusi || '')}</span>
          <span class="sent-src">${ui.tierChip(s.tier)} ${ui.sourceLink({ url: s.url, tanggal_akses: s.tanggal_akses })}</span>
        </figcaption>
      </figure>`;
    const body = (sents && sents.length) ? `
      <div class="sent-grid">${sents.slice(0, 2).map(sentItem).join('')}</div>
      ${sents.length > 2 ? disclose(`<div class="sent-grid" style="margin-top:0">${sents.slice(2).map(sentItem).join('')}</div>`) : ''}`
      : ui.empty('empty.peluang.sentimen');
    sentimenHtml = `
    <section class="section">
      <article class="card">
        <h3 class="title block-takeaway">${esc(t('peluang.detail.sentimen.judul'))}</h3>
        <p class="panel-sub">${esc(t('peluang.detail.sentimen.subjudul'))}</p>
        ${body}
      </article>
    </section>`;
  }

  /* ---------- F1 #6: referensi — semua sumber, bernomor, collapsible ----------
     url null → sumber_teks polos (JANGAN link mati). 8 teratas tampil. */
  let refHtml = '';
  {
    const refs = opp.referensi || [];
    if (refs.length) {
      const SHOW_REF = 8;
      const refRow = (r) => `
        <li class="ref-row">
          <span class="ref-no" aria-hidden="true">${esc(String(r.no == null ? '' : r.no).padStart(2, '0'))}</span>
          <div class="ref-main">
            ${r.url ? ui.sourceLink({ url: r.url }) : `<span class="src-plain">${esc(r.sumber_teks || t('umum.kosong'))}</span>`}${ui.tierChip(r.tier)}
            <div class="ref-use">${[
    r.dipakai_untuk_tag
      ? `<span class="use-chip">${r.dipakai_untuk ? ttSpan(r.dipakai_untuk_tag, String(r.dipakai_untuk)) : esc(r.dipakai_untuk_tag)}</span>`
      : (r.dipakai_untuk ? esc(r.dipakai_untuk) : ''),
    r.tanggal_akses ? esc(t('peluang.bukti.diakses', { tanggal: fmt.tanggal(r.tanggal_akses) }, 'diakses {tanggal}')) : '',
  ].filter(Boolean).join(' · ')}</div>
          </div>
        </li>`;
      refHtml = `
      <section class="section">
        <article class="card">
          <h3 class="title block-takeaway">${esc(t('peluang.detail.referensi.judul'))}</h3>
          <p class="panel-sub">${esc(t('peluang.detail.referensi.subjudul'))}</p>
          <ol class="ref-list">${refs.slice(0, SHOW_REF).map(refRow).join('')}</ol>
          ${refs.length > SHOW_REF ? disclose(`<ol class="ref-list" style="margin-top:0">${refs.slice(SHOW_REF).map(refRow).join('')}</ol>`) : ''}
        </article>
      </section>`;
    }
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
    <div class="d-photo-col">
      <div class="d-photo" role="img" aria-label="${esc(opp.gambar && opp.gambar.url ? opp.nama : t('peluang.kartu.tanpa_foto'))}">${fotoHtml}</div>
      ${fotoAtribusi}
    </div>
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

  <!-- sinyal pasar asal (F1): rating per platform + suara konsumen — dekat blok klaim -->
  ${ratingHtml}
  ${sentimenHtml}

  <div class="detail-grid">
    ${chartCard}
    ${stepCard}
  </div>

  ${callouts.length ? `<div class="callout-grid">${callouts.join('')}</div>` : ''}
  ${risikoHtml}

  <!-- blok uang (F1): revenue + ukuran pasar tampil; jangkar harga + biaya impor di balik
       satu disclosure untuk menurunkan beban visual default (DESIGN §4.23 kepadatan) -->
  ${revHtml}
  ${scnHtml}
  ${(anchorHtml || lcHtml)
    ? `<section class="section money-more">${disclose(`${anchorHtml}${lcHtml}`, t('peluang.detail.ekonomi.buka', null, 'Jangkar harga lokal & biaya sampai gudang'))}</section>`
    : ''}

  <!-- semua sumber (F1 #6) sebelum limitations — limitations tetap penutup halaman -->
  ${refHtml}
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
