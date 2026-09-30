/*
 * report-view.js — tampilan laporan sentimen format baru (bagian UTAMA halaman sentimen).
 *
 * Laporan = markdown dari scripts/sentiment-report-build.mjs (report_md) dengan penanda
 * `<!--chart:id-->`. Di sini: penanda -> wadah grafik, markdown -> HTML (ctx.renderMd, yang
 * sudah lewat DOMPurify), lalu grafik SVG digambar dari JSON detail yang sama lewat
 * report-charts.mjs (lebar wadah, token CSS -> ikut tema terang/gelap). Susunan HTML dirapikan
 * jadi kartu (DOM murni, null-safe): kegagalan apa pun -> markdown polos tetap terbaca.
 */
import { renderChart, chartMarkers, num } from './report-charts.mjs';

const MARK_RE = /<!--\s*chart:([a-z_]+)\s*-->/g;
/* penanda "lihat lebih banyak": <!--contoh:<jenis>:<id ter-encode>:<jumlah kutipan yang sudah tampil>--> */
const CONTOH_RE = /<!--\s*contoh:(topik|fungsi|waspada):([^:\s>]+):(\d+)\s*-->/g;
const BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/* laporan format baru? (H1 "Laporan Sentimen —" hasil builder, atau memuat penanda grafik) */
export function isNewReport(md) {
  const s = String(md || '');
  return /^#\s+Laporan Sentimen\s+—/m.test(s) || chartMarkers(s).length > 0;
}

/* md untuk dashboard: H1 dibuang (nama produk sudah jadi judul halaman), penanda -> wadah */
export function prepareReportMd(md) {
  return String(md || '')
    .replace(/^#\s+Laporan Sentimen\s+—[^\n]*\n+/m, '')
    .replace(MARK_RE, (m, id) => `\n<div class="rpt-chart" data-rpt-chart="${id}"></div>\n`)
    .replace(CONTOH_RE, (m, jenis, id, n) => `\n<div class="rpt-contoh" data-rpt-contoh="${jenis}:${id}:${n}"></div>\n`);
}

/* ---- contoh komentar tambahan ("Lihat lebih banyak komentar") — fungsi murni, bisa diuji di Node ---- */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
function tglPendek(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${Number(m[3])} ${BULAN_PENDEK[Number(m[2]) - 1] || ''} ${m[1]}` : '';
}
const kunciTeks = (t) => String(t || '').replace(/[\u201C\u201D"]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
/* Model data satu blok: item contoh yang BELUM tampil di laporan, urut ER, hingga `maks`.
   `sudahTampil` = daftar teks kutipan yang sudah tampil di blok itu (atau jumlah: lewati sekian item pertama).
   Null-safe: data absen / bentuk tak dikenal -> []. Tak ada HTML di sini; teks dipasang lewat textContent. */
export function modelContohLagi(detail, jenis, id, sudahTampil = 0, maks = 5) {
  const c = detail && detail.insights && detail.insights.contoh_komentar;
  let arr = c && c.v === 1 && c[jenis] && Array.isArray(c[jenis][id]) ? c[jenis][id] : [];
  if (Array.isArray(sudahTampil)) { const s = new Set(sudahTampil.map(kunciTeks)); arr = arr.filter((it) => !(it && s.has(kunciTeks(it.text)))); }
  else arr = arr.slice(Math.max(0, sudahTampil | 0));
  return arr.filter((it) => it && typeof it.text === 'string' && it.text.trim()).slice(0, maks).map((it) => {
    const meta = [];
    if (isNum(it.likes) && it.likes > 0) meta.push(`${num(it.likes)} like`);
    if (isNum(it.replies) && it.replies > 0) meta.push(`${num(it.replies)} balasan`);
    const tgl = tglPendek(it.date);
    if (tgl) meta.push(tgl);
    if (it.polaritas === 'positif' || it.polaritas === 'netral' || it.polaritas === 'negatif') meta.push(it.polaritas);
    return { text: it.text.trim(), meta: meta.join(' · '), url: typeof it.url === 'string' && /^https?:\/\//.test(it.url) ? it.url : null };
  });
}

function isiContoh(root, detail) {
  root.querySelectorAll('[data-rpt-contoh]').forEach((el) => {
    let model = [];
    try {
      const [jenis, idEnc, n] = String(el.getAttribute('data-rpt-contoh') || '').split(':');
      /* kutipan yang sudah tampil = blockquote berurutan tepat di atas penanda */
      const tampil = [];
      for (let p = el.previousElementSibling; p && p.tagName === 'BLOCKQUOTE'; p = p.previousElementSibling) {
        const q = p.querySelector('p');
        if (q) tampil.push(q.textContent || '');
      }
      model = modelContohLagi(detail, jenis, decodeURIComponent(idEnc || ''), tampil.length ? tampil : (parseInt(n, 10) || 0), 5);
    } catch { model = []; }
    if (!model.length) { el.remove(); return; }
    const det = document.createElement('details');
    det.className = 'rpt-more';
    const sum = document.createElement('summary');
    sum.textContent = 'Lihat lebih banyak komentar';
    det.appendChild(sum);
    const list = document.createElement('ul');
    list.className = 'rpt-more-list';
    for (const m of model) {
      const li = document.createElement('li');
      const q = document.createElement('p');
      q.className = 'rpt-more-text';
      q.textContent = `\u201C${m.text}\u201D`;
      li.appendChild(q);
      const meta = document.createElement('div');
      meta.className = 'rpt-more-meta';
      meta.textContent = m.meta;
      if (m.url) {
        const a = document.createElement('a');
        a.href = m.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.textContent = 'lihat video';
        if (m.meta) meta.appendChild(document.createTextNode(' \u00B7 '));
        meta.appendChild(a);
      }
      li.appendChild(meta);
      list.appendChild(li);
    }
    det.appendChild(list);
    el.appendChild(det);
  });
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
  /* bagian "Tentang data ini" (kini tepat setelah Ringkasan): bungkus paragrafnya jadi kotak, berhenti di judul
     bagian berikutnya — laporan lama menaruhnya di akhir, jadi keduanya tetap benar */
  const about = out.querySelector('.rpt-about-h');
  if (about) {
    const box = document.createElement('div');
    box.className = 'rpt-about';
    let n = about.nextElementSibling;
    about.parentNode.insertBefore(box, about);
    box.appendChild(about);
    while (n && n.tagName !== 'H2') { const nx = n.nextElementSibling; box.appendChild(n); n = nx; }
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
    try { isiContoh(host, detail); } catch { /* tanpa "lihat lebih banyak" laporan tetap utuh */ }
    lastW = Math.floor(host.clientWidth);
    drawCharts(host, detail);
    window.addEventListener('resize', onResize);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (alive) drawCharts(host, detail); });
  }).catch(() => { /* renderMd sudah punya fallback sendiri */ });
  return () => { alive = false; clearTimeout(timer); window.removeEventListener('resize', onResize); };
}
