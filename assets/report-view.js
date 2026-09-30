/*
 * report-view.js — tampilan laporan sentimen format baru (bagian UTAMA halaman sentimen).
 *
 * Laporan = markdown dari scripts/sentiment-report-build.mjs (report_md) dengan penanda
 * `<!--chart:id-->`. Di sini: penanda -> wadah grafik, markdown -> HTML (ctx.renderMd, yang
 * sudah lewat DOMPurify), lalu grafik SVG digambar dari JSON detail yang sama lewat
 * report-charts.mjs (lebar wadah, token CSS -> ikut tema terang/gelap). Susunan HTML dirapikan
 * jadi kartu (DOM murni, null-safe): kegagalan apa pun -> markdown polos tetap terbaca.
 */
import { renderChart, chartMarkers } from './report-charts.mjs';

const MARK_RE = /<!--\s*chart:([a-z_]+)\s*-->/g;

/* laporan format baru? (H1 "Laporan Sentimen —" hasil builder, atau memuat penanda grafik) */
export function isNewReport(md) {
  const s = String(md || '');
  return /^#\s+Laporan Sentimen\s+—/m.test(s) || chartMarkers(s).length > 0;
}

/* md untuk dashboard: H1 dibuang (nama produk sudah jadi judul halaman), penanda -> wadah */
export function prepareReportMd(md) {
  return String(md || '')
    .replace(/^#\s+Laporan Sentimen\s+—[^\n]*\n+/m, '')
    .replace(MARK_RE, (m, id) => `\n<div class="rpt-chart" data-rpt-chart="${id}"></div>\n`);
}

const KEEP_STRONG = /^(Jadi|Kenapa|Sisi negatif|Keluhan|Hati-hati|Yang bisa dilakukan)/;
const WARN_STRONG = /^(Sisi negatif|Keluhan|Hati-hati)/;

/* susun kartu: tiap h3 + isinya = .rpt-card; h2 = judul bagian; paragraf ber-strong = catatan. */
export function enhanceReportDom(root) {
  if (!root || !root.children) return;
  const kids = Array.from(root.children);
  const out = document.createElement('div');
  out.className = 'rpt-flow';
  let card = null;
  let sectionKey = '';
  let cardIdx = 0;
  const flush = () => { card = null; };
  for (const el of kids) {
    const tag = el.tagName;
    if (tag === 'H2') {
      flush();
      sectionKey = (el.textContent || '').trim().toLowerCase();
      el.classList.add('rpt-h2');
      if (sectionKey === 'tentang data ini') el.classList.add('rpt-about-h');
      out.appendChild(el);
      cardIdx = 0;
      continue;
    }
    if (tag === 'H3') {
      card = document.createElement('div');
      const txt = (el.textContent || '').trim();
      card.className = 'rpt-card' + (sectionKey === 'ringkasan' && cardIdx === 0 ? ' rpt-hero' : '')
        + (sectionKey === 'yang perlu diwaspadai' && /^\d+\./.test(txt) ? ' rpt-warn-card' : '')
        + (sectionKey === 'pintu masuk konten' ? ' rpt-ep' : '')
        + (/^cukup kuat untuk/i.test(txt) ? ' rpt-yes' : '') + (/^belum cukup untuk/i.test(txt) ? ' rpt-no' : '');
      card.appendChild(el);
      out.appendChild(card);
      cardIdx++;
      continue;
    }
    if (tag === 'P' && el.children.length === 1 && el.firstElementChild.tagName === 'STRONG'
      && (el.textContent || '').trim() === (el.firstElementChild.textContent || '').trim() && !card) {
      el.classList.add('rpt-lead');          /* judul-kesimpulan bagian (tebal, sendirian) */
      out.appendChild(el);
      continue;
    }
    if (tag === 'P' && el.firstElementChild && el.firstElementChild.tagName === 'STRONG') {
      const st = (el.firstElementChild.textContent || '').trim();
      if (KEEP_STRONG.test(st)) el.classList.add('rpt-note', ...(WARN_STRONG.test(st) ? ['rpt-note-warn'] : []));
    }
    if (tag === 'P' && /^\s*(Komentar|data per)/.test(el.textContent || '') && !card) el.classList.add('rpt-meta');
    (card || out).appendChild(el);
  }
  /* bagian penutup "Tentang data ini": bungkus paragrafnya jadi kotak */
  const about = out.querySelector('.rpt-about-h');
  if (about) {
    const box = document.createElement('div');
    box.className = 'rpt-about';
    let n = about.nextElementSibling;
    about.parentNode.insertBefore(box, about);
    box.appendChild(about);
    while (n) { const nx = n.nextElementSibling; box.appendChild(n); n = nx; }
  }
  root.textContent = '';
  root.appendChild(out);
}

function drawCharts(root, detail) {
  root.querySelectorAll('[data-rpt-chart]').forEach((el) => {
    const id = el.getAttribute('data-rpt-chart');
    const w = Math.floor(el.clientWidth) || Math.floor(root.clientWidth - 40) || 320;
    let svg = '';
    try { svg = renderChart(id, detail, { width: Math.max(240, w), theme: 'css' }); } catch { svg = ''; }
    el.innerHTML = svg;
    if (!svg) el.hidden = true; else el.hidden = false;
  });
}

/* Pasang laporan ke `host` (elemen kosong). Kembalikan fungsi pembersih. */
export function mountReport(host, ctx, detail, md) {
  if (!host) return () => {};
  let alive = true;
  let lastW = 0;
  let timer = null;
  const onResize = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!alive) return;
      const w = Math.floor(host.clientWidth);
      if (w && w !== lastW) { lastW = w; drawCharts(host, detail); }
    }, 120);
  };
  Promise.resolve(ctx.renderMd(prepareReportMd(md))).then((html) => {
    if (!alive) return;
    host.innerHTML = html;
    try { enhanceReportDom(host); } catch { /* markdown polos tetap terbaca */ }
    lastW = Math.floor(host.clientWidth);
    drawCharts(host, detail);
    window.addEventListener('resize', onResize);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (alive) drawCharts(host, detail); });
  }).catch(() => { /* renderMd sudah punya fallback sendiri */ });
  return () => { alive = false; clearTimeout(timer); window.removeEventListener('resize', onResize); };
}
