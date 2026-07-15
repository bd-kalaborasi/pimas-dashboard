/*
 * View: Laporan — brief bisnis + rangkuman mingguan (payload.laporan),
 * mode baca markdown via route nested #/laporan/{jenis}/{id} (KONTRAK §1).
 */

import { wirePdfButton } from '../pdf-export.js';

export function render(el, ctx) {
  const { data, route, t, esc, fmt, ui, renderMd } = ctx;
  const briefs = (data.laporan || {}).briefs || [];
  const digests = (data.laporan || {}).digests || [];

  /* ---------- mode baca ---------- */
  if (route.jenis && route.id) {
    let doc = null; let title = '';
    if (route.jenis === 'brief') {
      doc = briefs.find((b) => b.id === route.id);
      title = doc ? doc.title : '';
    } else if (route.jenis === 'digest') {
      doc = digests.find((d) => d.week === route.id);
      title = doc ? t('laporan.minggu', { minggu: fmt.minggu(doc.week) }) : '';
    }

    const mdText = doc && typeof doc.md === 'string' ? doc.md : '';
    const pdfLabel = t('umum.unduh_pdf');
    const pdfBtnHtml = mdText.trim()
      ? `<button class="btn-ghost" data-pdf aria-label="${esc(pdfLabel)}">⤓ <span>${esc(pdfLabel)}</span></button>`
      : '';

    el.innerHTML = `
    <header class="pagehead">
      <div>
        <div class="eyebrow">${esc(t('laporan.judul'))} › ${esc(t('laporan.jenis.' + route.jenis, null, route.jenis))}</div>
        <h1 class="display-m">${esc(title || t('laporan.judul'))}</h1>
      </div>
      <div class="meta">${pdfBtnHtml}<a class="textlink" href="#/laporan">${esc(t('laporan.kembali_daftar'))} →</a></div>
    </header>
    <article class="card" id="doc-card">${ui.skeleton('page')}</article>`;

    const card = el.querySelector('#doc-card');
    if (!doc || !doc.md) {
      card.innerHTML = ui.empty(route.jenis === 'digest' ? 'empty.laporan.digest' : 'empty.laporan.brief');
      return undefined;
    }

    /* tombol Unduh PDF (laporan penuh = doc.md, bukan kartu di layar) */
    const unbindPdf = wirePdfButton(el, ctx, () => ({
      kind: route.jenis === 'digest' ? 'digest' : 'produk',
      title: title || t('laporan.judul'),
      meta: { id: doc.id || doc.week, jenis: route.jenis },
      md: doc.md,
    }));

    let alive = true;
    renderMd(doc.md).then((html) => { if (alive) card.innerHTML = `<div class="md-body">${html}</div>`; })
      .catch(() => {
        if (alive) card.innerHTML = `<div class="empty"><p class="e-apa">${esc(t('error.dokumen.judul'))}</p><p class="e-kenapa">${esc(t('error.dokumen.pesan'))}</p><p class="e-next">${esc(t('error.dokumen.tindakan'))}</p></div>`;
      });
    return () => { alive = false; unbindPdf(); };
  }

  /* ---------- mode daftar ---------- */
  const row = (href, title, chip) => `
    <a class="lb-row" style="grid-template-columns:1fr auto" href="${href}">
      <span class="lb-name">${esc(title)}<span class="lb-id">${esc(chip)}</span></span>
      <span class="textlink" style="align-self:center">${esc(t('laporan.cta_baca'))} →</span>
    </a>`;

  el.innerHTML = `
  <header class="pagehead">
    <div>
      <div class="eyebrow">${esc(t('nav.wawasan.laporan.label'))}</div>
      <h1 class="display-l">${esc(t('laporan.judul'))}</h1>
      <p class="sub">${esc(t('laporan.subjudul'))}</p>
    </div>
  </header>

  <section class="bento">
    <article class="card b-wide">
      <div class="eyebrow">${esc(t('laporan.jenis.brief'))}</div>
      ${briefs.length
    ? `<div class="lb" style="margin-top:14px">${briefs.map((b) => row(`#/laporan/brief/${encodeURIComponent(b.id)}`, b.title, b.id)).join('')}</div>`
    : ui.empty('empty.laporan.brief')}
    </article>
    <article class="card b-side">
      <div class="eyebrow">${esc(t('laporan.jenis.digest'))}</div>
      ${digests.length
    ? `<div class="lb" style="margin-top:14px">${digests.slice().sort((a, b) => String(b.week || '').localeCompare(String(a.week || ''))).map((d) => row(`#/laporan/digest/${encodeURIComponent(d.week)}`, t('laporan.minggu', { minggu: fmt.minggu(d.week) }), '')).join('')}</div>`
    : ui.empty('empty.laporan.digest')}
    </article>
  </section>`;

  return undefined;
}
