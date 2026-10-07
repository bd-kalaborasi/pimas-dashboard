/*
 * report-view.js — tampilan laporan sentimen format baru (bagian UTAMA halaman sentimen).
 *
 * Laporan = markdown dari scripts/sentiment-report-build.mjs (report_md) dengan penanda
 * `<!--chart:id-->`. Di sini: penanda -> wadah grafik, markdown -> HTML (ctx.renderMd, yang
 * sudah lewat DOMPurify), lalu grafik SVG digambar dari JSON detail yang sama lewat
 * report-charts.mjs (lebar wadah, token CSS -> ikut tema terang/gelap). Susunan HTML dirapikan
 * jadi kartu (DOM murni, null-safe): kegagalan apa pun -> markdown polos tetap terbaca.
 *
 * Laporan GABUNGAN produk internal (baris pertama `<!--laporan:gabungan v1-->`): bab 1 = ulasan
 * pembeli (detail induk, penanda tanpa awalan), bab 2 = media sosial (penanda berawalan `publik:`,
 * digambar dari `opts.detailPublik`). H2 = judul bab, H3 = judul sub-bab, H4 = kartu temuan.
 * Tanpa penanda itu semua jalur di bawah persis seperti sebelumnya.
 */
import { renderChart, chartMarkers, num } from './report-charts.mjs';

/* awalan `publik:` opsional (laporan gabungan, bab media sosial) */
const MARK_RE = /<!--\s*chart:(?:(publik):)?([a-z_]+)\s*-->/g;
/* penanda "lihat lebih banyak": <!--contoh:[publik:]<jenis>:<id ter-encode>:<jumlah kutipan yang sudah tampil>--> */
const CONTOH_RE = /<!--\s*contoh:(?:(publik):)?(topik|fungsi|waspada):([^:\s>]+):(\d+)\s*-->/g;
/* baris jenis laporan (`<!--laporan:gabungan v1-->`) — penanda mesin, tidak untuk pembaca */
const LAPORAN_LINE_RE = /^[ \t]*<!--\s*laporan:[^\n]*?-->[ \t]*(?:\r?\n|$)/gm;
const GABUNGAN_RE = /<!--\s*laporan:gabungan\b[^\n]*?-->/;
const BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/* laporan format baru? (H1 "Laporan Sentimen —" hasil builder, atau memuat penanda grafik) */
export function isNewReport(md) {
  const s = String(md || '');
  return /^#\s+Laporan Sentimen\s+—/m.test(s) || chartMarkers(s).length > 0;
}

/* laporan gabungan produk internal (ulasan pembeli + media sosial)? */
export function isGabungan(md) {
  return GABUNGAN_RE.test(String(md || ''));
}

/* wadah penanda: atribut sumber hanya untuk awalan `publik:` (penanda lama → keluaran persis seperti dulu) */
const sumberAttr = (pub) => (pub ? ' data-rpt-sumber="publik"' : '');

/* md untuk dashboard: H1 dibuang (nama produk sudah jadi judul halaman), penanda -> wadah */
export function prepareReportMd(md, opts) {
  let src = String(md || '');
  /* internal: kalimat judul kartu Ringkasan (### …) sama persis dengan headline di kepala halaman → buang dari Ringkasan
     (hanya bila persis sama setelah dinormalkan; kalimat kedua + Poin utama tetap). */
  const hl = opts && typeof opts.tanpaHeadlineRingkasan === 'string' ? kunciTeks(opts.tanpaHeadlineRingkasan) : '';
  if (hl) {
    src = src.replace(/(^##[ \t]+Ringkasan[ \t]*\n+)###[ \t]+([^\n]*)\n+/m, (m, h2, judul) => (kunciTeks(judul) === hl ? h2 : m));
  }
  return src
    .replace(LAPORAN_LINE_RE, '')
    .replace(/^#\s+Laporan Sentimen\s+—[^\n]*\n+/m, '')
    .replace(MARK_RE, (m, pub, id) => `\n<div class="rpt-chart" data-rpt-chart="${id}"${sumberAttr(pub)}></div>\n`)
    .replace(CONTOH_RE, (m, pub, jenis, id, n) => `\n<div class="rpt-contoh" data-rpt-contoh="${jenis}:${id}:${n}"${sumberAttr(pub)}></div>\n`);
}

/* ---- contoh komentar tambahan ("Lihat lebih banyak komentar") — fungsi murni, bisa diuji di Node ---- */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
function tglPendek(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${Number(m[3])} ${BULAN_PENDEK[Number(m[2]) - 1] || ''} ${m[1]}` : '';
}
const kunciTeks = (t) => String(t || '').replace(/[\u201C\u201D"]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
/* kunci kuat (internal): hanya huruf/angka — kebal pemformatan templat, tanda baca, pemotongan */
const kunciKuat = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9À-ɏ]+/g, '');
const samaKutipan = (a, b) => {
  if (!a || !b) return false;
  const [pendek, panjang] = a.length <= b.length ? [a, b] : [b, a];
  return pendek.length >= 12 ? panjang.startsWith(pendek) : pendek === panjang;
};
/* Model data satu blok: item contoh yang BELUM tampil di laporan, urut ER, hingga `maks`.
   `sudahTampil` = daftar teks kutipan yang sudah tampil di blok itu (atau jumlah: lewati sekian item pertama).
   Null-safe: data absen / bentuk tak dikenal -> []. Tak ada HTML di sini; teks dipasang lewat textContent. */
export function modelContohLagi(detail, jenis, id, sudahTampil = 0, maks = 5, opts) {
  const c = detail && detail.insights && detail.insights.contoh_komentar;
  let arr = c && c.v === 1 && c[jenis] && Array.isArray(c[jenis][id]) ? c[jenis][id] : [];
  if (Array.isArray(sudahTampil)) { const s = new Set(sudahTampil.map(kunciTeks)); arr = arr.filter((it) => !(it && s.has(kunciTeks(it.text)))); }
  else arr = arr.slice(Math.max(0, sudahTampil | 0));
  /* internal: buang kutipan yang sudah tampil walau beda format/terpotong, dan duplikat di dalam daftar (apa pun label polaritasnya) */
  if (opts && opts.dedupKuat) {
    const tampilKuat = Array.isArray(sudahTampil) ? sudahTampil.map(kunciKuat).filter(Boolean) : [];
    const lihat = [];
    arr = arr.filter((it) => {
      const k = kunciKuat(it && it.text);
      if (!k) return true;
      if (tampilKuat.some((x) => samaKutipan(x, k)) || lihat.some((x) => samaKutipan(x, k))) return false;
      lihat.push(k);
      return true;
    });
  }
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

export function isiContoh(root, detailInduk, optsInduk, detailPublik) {
  root.querySelectorAll('[data-rpt-contoh]').forEach((el) => {
    let model = [];
    /* bab media sosial (laporan gabungan): data & aturan dedup milik hasil publik, bukan induk */
    const pub = el.getAttribute('data-rpt-sumber') === 'publik';
    const detail = pub ? detailPublik : detailInduk;
    const opts = pub ? undefined : optsInduk;
    try {
      const [jenis, idEnc, n] = String(el.getAttribute('data-rpt-contoh') || '').split(':');
      /* kutipan yang sudah tampil = blockquote berurutan tepat di atas penanda */
      const tampil = [];
      for (let p = el.previousElementSibling; p && p.tagName === 'BLOCKQUOTE'; p = p.previousElementSibling) {
        const q = p.querySelector('p');
        if (q) tampil.push(q.textContent || '');
      }
      model = modelContohLagi(detail, jenis, decodeURIComponent(idEnc || ''), tampil.length ? tampil : (parseInt(n, 10) || 0), 5, opts);
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

/* susun kartu: tiap h3 + isinya = .rpt-card; h2 = judul bagian; paragraf ber-strong = catatan.
   `opts.gabungan` (laporan gabungan) → susunan bab/sub-bab, lihat enhanceGabunganDom. */
export function enhanceReportDom(root, opts) {
  if (!root || !root.children) return;
  if (opts && opts.gabungan) { enhanceGabunganDom(root); return; }
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

/* Laporan gabungan: H2 = judul bab (.rpt-bab), H3 = judul sub-bab (.rpt-subbab, bukan kartu), H4 + isinya =
   .rpt-card. Bab "Ringkasan" tetap satu kartu utama (.rpt-hero), juga bila kalimat judulnya sudah dibuang
   karena sama dengan kepala halaman. Penanda kartu (waspada/pintu masuk/cukup kuat) dibaca dari sub-bab. */
const kunciJudul = (el) => (el.textContent || '').trim().toLowerCase();
function enhanceGabunganDom(root) {
  const kids = Array.from(root.children);
  const out = document.createElement('div');
  out.className = 'rpt-flow rpt-gab';
  let card = null;
  let babKey = '';
  let subKey = '';
  let cardIdx = 0;
  const kartu = (cls) => {
    card = document.createElement('div');
    card.className = cls;
    out.appendChild(card);
    cardIdx++;
    return card;
  };
  for (const el of kids) {
    const tag = el.tagName;
    if (tag === 'H2') {
      card = null; subKey = ''; cardIdx = 0;
      babKey = kunciJudul(el);
      el.classList.add('rpt-h2', 'rpt-bab');
      out.appendChild(el);
      continue;
    }
    if (tag === 'H3' && babKey === 'ringkasan') {
      kartu('rpt-card' + (cardIdx === 0 ? ' rpt-hero' : '')).appendChild(el);
      continue;
    }
    if (tag === 'H3') {
      card = null; cardIdx = 0;
      subKey = kunciJudul(el);
      el.classList.add('rpt-h3', 'rpt-subbab');
      out.appendChild(el);
      continue;
    }
    if (tag === 'H4') {
      const txt = (el.textContent || '').trim();
      kartu('rpt-card'
        + (subKey === 'yang perlu diwaspadai' && /^\d+\./.test(txt) ? ' rpt-warn-card' : '')
        + (subKey === 'pintu masuk konten' ? ' rpt-ep' : '')
        + (/^cukup kuat untuk/i.test(txt) ? ' rpt-yes' : '') + (/^belum cukup untuk/i.test(txt) ? ' rpt-no' : '')).appendChild(el);
      continue;
    }
    /* isi Ringkasan tanpa kalimat judul → tetap di dalam kartu utama */
    if (!card && babKey === 'ringkasan') kartu('rpt-card rpt-hero');
    if (tag === 'P' && el.children.length === 1 && el.firstElementChild.tagName === 'STRONG'
      && (el.textContent || '').trim() === (el.firstElementChild.textContent || '').trim() && !card) {
      el.classList.add('rpt-lead');
      out.appendChild(el);
      continue;
    }
    if (tag === 'P' && el.firstElementChild && el.firstElementChild.tagName === 'STRONG') {
      const st = (el.firstElementChild.textContent || '').trim();
      if (KEEP_STRONG.test(st)) el.classList.add('rpt-note', ...(WARN_STRONG.test(st) ? ['rpt-note-warn'] : []));
    }
    /* kalimat pembuka bab (tanggal data / keadaan bab media sosial) sebelum sub-bab pertama */
    if (tag === 'P' && !card && !subKey && babKey) el.classList.add('rpt-bab-ket');
    (card || out).appendChild(el);
  }
  root.textContent = '';
  root.appendChild(out);
}

/* grafik bab media sosial (data-rpt-sumber="publik") digambar dari detail hasil publik; tanpa data → disembunyikan */
export function drawCharts(root, detail, detailPublik) {
  root.querySelectorAll('[data-rpt-chart]').forEach((el) => {
    const id = el.getAttribute('data-rpt-chart');
    const w = Math.floor(el.clientWidth) || Math.floor(root.clientWidth - 40) || 320;
    const src = el.getAttribute('data-rpt-sumber') === 'publik' ? detailPublik : detail;
    let svg = '';
    try { svg = renderChart(id, src, { width: Math.max(240, w), theme: 'css' }); } catch { svg = ''; }
    el.innerHTML = svg;
    if (!svg) el.hidden = true; else el.hidden = false;
  });
}

/* Pasang laporan ke `host` (elemen kosong). Kembalikan fungsi pembersih.
   `opts.detailPublik` = detail hasil media sosial (laporan gabungan); absen → penanda `publik:` disembunyikan. */
export function mountReport(host, ctx, detail, md, opts) {
  if (!host) return () => {};
  let alive = true;
  let lastW = 0;
  let timer = null;
  const gabungan = isGabungan(md);
  const detailPublik = opts && opts.detailPublik && typeof opts.detailPublik === 'object' ? opts.detailPublik : null;
  const onResize = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!alive) return;
      const w = Math.floor(host.clientWidth);
      if (w && w !== lastW) { lastW = w; drawCharts(host, detail, detailPublik); }
    }, 120);
  };
  Promise.resolve(ctx.renderMd(prepareReportMd(md, opts))).then((html) => {
    if (!alive) return;
    host.innerHTML = html;
    try { enhanceReportDom(host, gabungan ? { gabungan: true } : undefined); } catch { /* markdown polos tetap terbaca */ }
    try { isiContoh(host, detail, opts && opts.tanpaHeadlineRingkasan != null ? { dedupKuat: true } : undefined, detailPublik); } catch { /* tanpa "lihat lebih banyak" laporan tetap utuh */ }
    lastW = Math.floor(host.clientWidth);
    drawCharts(host, detail, detailPublik);
    window.addEventListener('resize', onResize);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (alive) drawCharts(host, detail, detailPublik); });
  }).catch(() => { /* renderMd sudah punya fallback sendiri */ });
  return () => { alive = false; clearTimeout(timer); window.removeEventListener('resize', onResize); };
}
