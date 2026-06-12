/*
 * View: Tentang — cara PIMAS bekerja (5 langkah + prinsip dari strings,
 * content/tentang.md dirender markdown) + glosarium dari glossary.json
 * dengan pencarian (komponen dfn §4.22).
 */

export function render(el, ctx) {
  const { t, esc, ui, renderMd, glossary } = ctx;

  const langkah = [1, 2, 3, 4, 5].map((i) => ({
    judul: t(`tentang.langkah.${i}.judul`),
    isi: t(`tentang.langkah.${i}.isi`),
  }));
  const prinsip = [1, 2, 3].map((i) => t(`tentang.prinsip.${i}`));

  el.innerHTML = `
  <header class="pagehead">
    <div>
      <div class="eyebrow">${esc(t('nav.wawasan.tentang.label'))}</div>
      <h1 class="display-l">${esc(t('tentang.judul'))}</h1>
      <p class="sub">${esc(t('tentang.intro'))}</p>
    </div>
  </header>

  <section class="bento">
    <article class="card b-wide">
      <div class="eyebrow">${esc(t('tentang.langkah.judul'))}</div>
      <ol class="stepper" style="margin-top:16px">
        ${langkah.map((l, i) => `
        <li class="step">
          <span class="s-dot ok" aria-hidden="true">${i + 1}</span>
          <div>
            <div class="s-title">${esc(l.judul)}</div>
            <p class="s-body">${esc(l.isi)}</p>
          </div>
        </li>`).join('')}
      </ol>
    </article>
    <article class="card b-side">
      <div class="eyebrow">${esc(t('tentang.prinsip.judul'))}</div>
      <ul class="feed">
        ${prinsip.map((p) => `<li><span class="f-dot f-ok" aria-hidden="true"></span><span>${esc(p)}</span></li>`).join('')}
      </ul>
    </article>
  </section>

  <section class="section">
    <article class="card" id="tentang-md">${ui.skeleton('page')}</article>
  </section>

  <section class="section">
    <div class="section-head">
      <div class="eyebrow">${esc(t('tentang.glosarium.judul'))}</div>
      <p class="sub">${esc(t('tentang.glosarium.intro'))}</p>
    </div>
    <div class="filters">
      <input class="input" type="search" id="glo-q" placeholder="${esc(t('tentang.glosarium.cari'))}"
             aria-label="${esc(t('tentang.glosarium.cari'))}" style="max-width:320px">
    </div>
    <div id="glo-list"></div>
  </section>`;

  /* markdown tentang.md */
  const mdCard = el.querySelector('#tentang-md');
  let alive = true;
  fetch('content/tentang.md', { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then((md) => renderMd(md))
    .then((html) => { if (alive) mdCard.innerHTML = `<div class="md-body">${html}</div>`; })
    .catch(() => {
      if (alive) mdCard.innerHTML = `<div class="empty"><p class="e-apa">${esc(t('error.dokumen.judul'))}</p><p class="e-kenapa">${esc(t('error.dokumen.pesan'))}</p><p class="e-next">${esc(t('error.dokumen.tindakan'))}</p></div>`;
    });

  /* glosarium + cari */
  function renderGlossary(q) {
    const list = el.querySelector('#glo-list');
    const needle = String(q || '').trim().toLowerCase();
    const rows = (glossary || []).filter((g) => !needle
      || g.term.toLowerCase().includes(needle)
      || (g.alias || []).some((a) => a.toLowerCase().includes(needle))
      || String(g.definisi || '').toLowerCase().includes(needle));
    if (!rows.length) {
      list.innerHTML = `<div class="card" style="margin-top:14px">${ui.empty('empty.peluang.filter')}</div>`;
      return;
    }
    list.innerHTML = `<div class="dfn-list">
      ${rows.map((g) => `
      <article class="card dfn-card">
        <dfn class="dfn-term" style="font-style:normal">${esc(g.term)}</dfn>
        ${(g.alias || []).length ? `<span class="dfn-alias">${esc(g.alias.join(' · '))}</span>` : ''}
        <p class="dfn-def">${esc(g.definisi)}</p>
        ${g.kapan_dipakai ? `<p class="dfn-when">${esc(g.kapan_dipakai)}</p>` : ''}
      </article>`).join('')}
    </div>`;
  }
  renderGlossary('');
  el.querySelector('#glo-q').addEventListener('input', (e) => renderGlossary(e.target.value));

  return () => { alive = false; };
}
