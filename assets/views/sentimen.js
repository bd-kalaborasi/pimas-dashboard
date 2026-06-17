/*
 * View: Sentimen — modul SENTIMEN standalone (DESIGN tokens + ECharts theme pimas).
 * List: formulir pemicu (ops-gated, in-browser repository_dispatch) + daftar analisis
 * tersimpan. Detail: ringkasan + 7 visual (donut · mentah-vs-tertimbang · per-platform ·
 * pujian-vs-keluhan · scatter engagement×sentimen · tren · grid kutipan) + Keterbatasan.
 * Data: ctx.data.sentiment {list, detail}. Pemicu: ctx.ops.sentiment_trigger (token di
 * blob ops terenkripsi — hanya owner ber-DEK ops). Sentimen = measure turunan (T3/T4);
 * suka/bintang = bobot, BUKAN angka pasar.
 */

const ALLOW_HOSTS = [/(^|\.)tiktok\.com$/, /(^|\.)shopee\.[a-z.]+$/, /(^|\.)tokopedia\.com$/, /(^|\.)instagram\.com$/, /(^|\.)youtube\.com$/, /(^|\.)youtu\.be$/];
const QUEUED_KEY = 'pimas.sentimen.queued';

function slugify(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}
function validRefUrl(s) {
  const v = String(s || '').trim();
  if (!/^https:\/\//i.test(v)) return null;
  try { const u = new URL(v); return ALLOW_HOSTS.some((re) => re.test(u.hostname)) ? u.toString() : null; }
  catch { return null; }
}

const VERDICT_TONE = { 'positif-signifikan': 'ok', 'negatif-signifikan': 'warn', 'tidak-konklusif': 'note', indikatif: 'note', 'no-data': 'plain' };
const VERDICT_SYM = { 'positif-signifikan': '▲', 'negatif-signifikan': '▼', 'tidak-konklusif': '=', indikatif: '◍', 'no-data': '◌' };

function verdictBadge(ctx, v) {
  const code = v || 'no-data';
  return ctx.ui.toneBadge(VERDICT_TONE[code] || 'plain', VERDICT_SYM[code] || '◌', ctx.t('sentimen.verdict.' + code, null, code));
}
function muFmt(ctx, x) { return x === null || x === undefined ? ctx.t('umum.kosong') : ctx.fmt.dec(x, 2); }
function pctFmt(ctx, x) { return x === null || x === undefined ? ctx.t('umum.kosong') : ctx.fmt.persen(x * 100); }

/* ============================================================ Trigger ====== */

async function fireTrigger(ctx, payload) {
  const tr = ctx.ops && ctx.ops.sentiment_trigger;
  if (!tr || !tr.enabled || !tr.token) { const e = new Error('disabled'); e.code = 'DISABLED'; throw e; }
  const res = await fetch(`https://api.github.com/repos/${tr.repo}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tr.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ event_type: tr.event_type || 'sentiment-request', client_payload: payload }),
  });
  if (res.status === 204) return true;
  if (res.status === 401 || res.status === 403) { const e = new Error('token'); e.code = 'TOKEN'; throw e; }
  const e = new Error('HTTP ' + res.status); e.code = 'HTTP'; throw e;
}

function triggerFormHtml(ctx) {
  const { t, esc } = ctx;
  return `
  <form id="sent-form" class="sent-form" novalidate>
    <div class="sf-row">
      <label class="field">
        <span>${esc(t('sentimen.form.produk_label'))}</span>
        <input class="input" id="sf-produk" type="text" placeholder="${esc(t('sentimen.form.produk_ph'))}" autocapitalize="none" spellcheck="false" required>
      </label>
      <label class="field sf-depth">
        <span>${esc(t('sentimen.form.depth_label'))}</span>
        <select class="select" id="sf-depth">
          <option value="shallow">${esc(t('sentimen.form.depth_shallow'))}</option>
          <option value="standard" selected>${esc(t('sentimen.form.depth_standard'))}</option>
          <option value="deep">${esc(t('sentimen.form.depth_deep'))}</option>
        </select>
      </label>
    </div>
    <div class="field">
      <span>${esc(t('sentimen.form.url_label'))}</span>
      <div id="sf-urls"></div>
      <button type="button" class="textlink" id="sf-addurl">${esc(t('sentimen.form.url_tambah'))}</button>
    </div>
    <button class="cta" type="submit" id="sf-go">${esc(t('sentimen.form.tombol'))}</button>
    <div id="sf-msg" role="status" aria-live="polite"></div>
  </form>`;
}

function bindTriggerForm(root, ctx, timers) {
  const { t, esc } = ctx;
  const urlsWrap = root.querySelector('#sf-urls');
  const addUrlRow = () => {
    const row = document.createElement('div');
    row.className = 'sf-urlrow';
    row.innerHTML = `<input class="input" type="url" placeholder="${esc(t('sentimen.form.url_ph'))}" inputmode="url">
      <button type="button" class="icon-btn" data-rm aria-label="${esc(t('sentimen.form.url_hapus'))}">✕</button>`;
    row.querySelector('[data-rm]').addEventListener('click', () => row.remove());
    urlsWrap.appendChild(row);
  };
  root.querySelector('#sf-addurl').addEventListener('click', addUrlRow);

  root.querySelector('#sent-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = root.querySelector('#sf-go');
    const msg = root.querySelector('#sf-msg');
    const produk = root.querySelector('#sf-produk').value.trim();
    const depth = root.querySelector('#sf-depth').value;
    const slug = slugify(produk);
    if (!slug) { msg.innerHTML = `<p class="login-err">⚠ ${esc(t('sentimen.form.produk_label'))}</p>`; return; }
    const urls = [...urlsWrap.querySelectorAll('input')].map((i) => validRefUrl(i.value)).filter(Boolean).slice(0, 10);
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ${esc(t('sentimen.form.mengirim'))}`;
    msg.innerHTML = '';
    try {
      await fireTrigger(ctx, {
        slug, product_name: produk.slice(0, 120), reference_urls: urls, platforms: ['tiktok', 'shopee', 'tokopedia'],
        depth, requested_at: new Date().toISOString(), requested_by: 'dashboard',
      });
      try { sessionStorage.setItem(QUEUED_KEY, JSON.stringify({ slug, produk, at: Date.now() })); } catch { /* abaikan */ }
      startTracking(root, ctx, slug, produk, timers);
    } catch (err) {
      let pesan = err && err.message;
      if (err && err.code === 'TOKEN') pesan = t('sentimen.form.token_invalid');
      msg.innerHTML = `<div class="callout warn"><p>${esc(t('sentimen.form.error', { pesan }))}</p></div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = t('sentimen.form.tombol');
    }
  });
}

/* ===== progress tracking: poll data viewer tiap ~45s, tampilkan saat siap (tanpa refresh) ===== */

function startTracking(root, ctx, slug, produk, timers) {
  const { t, esc } = ctx;
  const msg = root.querySelector('#sf-msg');
  if (!msg) return;
  const startedAt = Date.now();
  let done = false;
  msg.innerHTML = trackingHtml(ctx, produk);
  const rl2 = msg.querySelector('#st-reload2'); if (rl2) rl2.addEventListener('click', () => location.reload());
  const fmtE = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const stageFor = (min) => (min < 1 ? t('sentimen.progress.s1') : min < 6 ? t('sentimen.progress.s2') : min < 12 ? t('sentimen.progress.s3') : t('sentimen.progress.s4'));
  const tick = () => {
    const el = msg.querySelector('#st-elapsed'); const es = msg.querySelector('#st-stage');
    const dt = Date.now() - startedAt;
    if (el) el.textContent = fmtE(dt);
    if (es) es.textContent = stageFor(dt / 60000);
  };
  tick();
  const ti = setInterval(tick, 1000);
  const poll = async () => {
    if (done) return;
    const data = ctx.reloadViewer ? await ctx.reloadViewer() : null;
    if (data && data.sentiment && (data.sentiment.list || []).some((x) => x.slug === slug)) finish(true);
  };
  const pi = setInterval(poll, 45000);
  const to = setTimeout(() => finish(false, true), 25 * 60000);
  function finish(found, timeout) {
    if (done) return; done = true;
    clearInterval(ti); clearInterval(pi); clearTimeout(to);
    if (found) {
      msg.innerHTML = `<div class="callout ok"><p>${esc(t('sentimen.progress.ready', { produk }))}</p><a class="cta" href="#/sentimen/${encodeURIComponent(slug)}">${esc(t('sentimen.list.kolom_verdict'))} →</a></div>`;
      try { sessionStorage.removeItem(QUEUED_KEY); } catch { /* abaikan */ }
      ctx.toast(t('sentimen.progress.ready_toast', { produk }), 'status');
    } else if (timeout) {
      msg.innerHTML = `<div class="callout warn"><p>${esc(t('sentimen.progress.timeout'))}</p><button type="button" class="textlink" id="st-reload">${esc(t('sentimen.progress.reload'))}</button></div>`;
      const r = msg.querySelector('#st-reload'); if (r) r.addEventListener('click', () => location.reload());
    }
  }
  if (timers) timers.push(() => { done = true; clearInterval(ti); clearInterval(pi); clearTimeout(to); });
}

function trackingHtml(ctx, produk) {
  const { t, esc } = ctx;
  const manual = ctx.reloadViewer ? '' : `<button type="button" class="textlink" id="st-reload2">${esc(t('sentimen.progress.reload'))}</button>`;
  return `<div class="sent-progress" role="status" aria-live="polite">
    <div class="sp-head"><span class="spinner"></span><span>${esc(t('sentimen.progress.judul', { produk }))}</span></div>
    <div class="sp-bar" aria-hidden="true"><i></i></div>
    <div class="sp-meta"><span id="st-stage" class="sp-stage"></span><span id="st-elapsed" class="sp-elapsed mono">00:00</span></div>
    <p class="cap">${esc(t('sentimen.progress.catatan'))}</p>${manual}
  </div>`;
}

/* ============================================================ List ========= */

function renderList(el, ctx) {
  const { data, t, esc, fmt, ui } = ctx;
  const sd = data.sentiment;
  const list = (sd && Array.isArray(sd.list)) ? sd.list.slice() : [];
  list.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  /* blok pemicu: ops → form; tanpa ops → catatan; trigger disabled → fallback Telegram */
  const tr = ctx.ops && ctx.ops.sentiment_trigger;
  let triggerBlock;
  if (!ctx.hasOps) {
    triggerBlock = `<div class="callout note"><p>${esc(t('sentimen.form.ops_only'))}</p></div>`;
  } else if (!tr || !tr.enabled) {
    triggerBlock = `<div class="callout note">
      <div class="co-title">◌ ${esc(t('sentimen.form.disabled_judul'))}</div>
      <p>${esc(t('sentimen.form.disabled_pesan', { slug: 'nama-produk' }))}</p></div>`;
  } else {
    triggerBlock = triggerFormHtml(ctx);
  }

  el.innerHTML = `
  <header class="pagehead">
    <div>
      <div class="eyebrow">${esc(t('sentimen.eyebrow'))}</div>
      <h1 class="display-l">${esc(t('sentimen.judul'))}</h1>
      <p class="sub">${esc(t('sentimen.subjudul'))}</p>
    </div>
  </header>

  <article class="card">
    <div class="eyebrow">${esc(t('sentimen.form.judul'))}</div>
    <p class="cap" style="margin:4px 0 12px">${esc(t('sentimen.form.keterangan'))}</p>
    ${triggerBlock}
  </article>

  <section class="section">
    <div class="section-head"><div class="eyebrow">${esc(t('sentimen.list.judul'))}</div></div>
    <div id="sent-list" style="margin-top:12px"></div>
  </section>`;

  const timers = [];
  if (ctx.hasOps && tr && tr.enabled) bindTriggerForm(el, ctx, timers);

  const wrap = el.querySelector('#sent-list');
  if (!list.length) { wrap.innerHTML = `<div class="card">${ui.empty('empty.sentimen.list')}</div>`; }
  else {
    wrap.innerHTML = `<div class="snt-grid">${list.map((it) => {
      const conf = it.confidence === 'low' ? `<span class="badge plain">◌ ${esc(t('sentimen.confidence.low'))}</span>` : '';
      return `
      <a class="card sent-card" href="#/sentimen/${encodeURIComponent(it.slug)}">
        <div class="sent-card-head">
          <div class="sent-card-name">${esc(it.product_name || it.slug)}</div>
          <div class="sent-card-date">${esc(fmt.tanggal(it.date))}</div>
        </div>
        <div class="sent-card-badges">${verdictBadge(ctx, it.verdict)} ${conf}</div>
        <div class="sent-card-meta">
          <span>${esc(t('sentimen.detail.sentimen_tertimbang'))}: <b class="mono">${esc(muFmt(ctx, it.mu_weighted))}</b></span>
          <span>${esc(t('sentimen.list.kolom_n'))}: <b class="mono">${esc(fmt.dec(it.n_eff, 1))}</b></span>
        </div>
      </a>`;
    }).join('')}</div>`;
  }

  /* notifikasi 'baru saja dipicu' (queued) — bersihkan bila slug sudah muncul */
  showQueuedNotice(el, list);

  /* cleanup: hentikan timer polling progres saat pindah view */
  return () => timers.forEach((fn) => { try { fn(); } catch { /* abaikan */ } });
}

function showQueuedNotice(el, list) {
  let q = null;
  try { q = JSON.parse(sessionStorage.getItem(QUEUED_KEY) || 'null'); } catch { /* abaikan */ }
  if (!q || !q.slug) return;
  if (list.some((it) => it.slug === q.slug)) { try { sessionStorage.removeItem(QUEUED_KEY); } catch { /* abaikan */ } }
}

/* ============================================================ Detail ======= */

function renderDetail(el, ctx, slug) {
  const { data, t, esc, fmt, ui, charts } = ctx;
  const sd = data.sentiment;
  const d = sd && sd.detail ? sd.detail[slug] : null;

  const back = `<a class="textlink" href="#/sentimen">${esc(t('sentimen.kembali'))}</a>`;
  if (!d || !d.stats || !d.stats.overall) {
    el.innerHTML = `<header class="pagehead"><div>${back}<h1 class="display-l">${esc((d && d.product_name) || slug)}</h1></div></header>
      <div class="card">${ui.empty('empty.sentimen.detail')}</div>`;
    return;
  }

  const s = d.stats;
  const ov = s.overall;
  const we = ov.weighting_effect || {};
  const confLow = (s.limitations || []).includes('n-kecil') || (s.limitations || []).includes('single-loud-voice');

  el.innerHTML = `
  <header class="pagehead">
    <div>
      ${back}
      <div class="eyebrow" style="margin-top:8px">${esc(t('sentimen.eyebrow'))} · ${esc(fmt.tanggal(d.generated_at))}</div>
      <h1 class="display-l">${esc(d.product_name || slug)}</h1>
      <div class="sent-card-badges">${verdictBadge(ctx, ov.verdict)} ${confLow ? `<span class="badge plain">◌ ${esc(t('sentimen.confidence.low'))}</span>` : ''}</div>
    </div>
  </header>

  <div class="callout note"><p>${esc(t('sentimen.metodologi'))}</p></div>

  <article class="card">
    <div class="kpi-row">
      ${ui.statCard({ label: t('sentimen.detail.sentimen_tertimbang'), value: ov.weighted.mu, valueFormat: (x) => fmt.dec(x, 2), formula: `CI 95%: ${muFmt(ctx, ov.ci.lo)} … ${muFmt(ctx, ov.ci.hi)}` })}
      ${ui.statCard({ label: t('sentimen.detail.n_eff'), value: ov.n_eff, valueFormat: (x) => fmt.dec(x, 1), baseline: `${fmt.int(ov.n)} suara mentah` })}
      ${ui.statCard({ label: t('sentimen.detail.pos'), value: ov.weighted.pos == null ? null : ov.weighted.pos * 100, valueFormat: (x) => fmt.persen(x), satuan: '' })}
      ${ui.statCard({ label: t('sentimen.detail.efek_bobot'), value: we.d_mu == null ? null : we.d_mu, valueFormat: (x) => fmt.delta(Math.round(x * 100) / 100), baseline: we.interpretation || '' })}
    </div>
  </article>

  <div class="sent-charts">
    ${chartCard(ctx, 'donut', t('sentimen.detail.donut_judul'), '')}
    ${chartCard(ctx, 'rvw', t('sentimen.detail.rawvsweighted_judul'), t('sentimen.detail.rawvsweighted_ket'))}
    ${chartCard(ctx, 'plat', t('sentimen.detail.platform_judul'), t('sentimen.detail.platform_ket'))}
    ${chartCard(ctx, 'tema', t('sentimen.detail.tema_judul'), '')}
    ${chartCard(ctx, 'scatter', t('sentimen.detail.scatter_judul'), t('sentimen.detail.scatter_ket'))}
    ${chartCard(ctx, 'tren', t('sentimen.detail.tren_judul'), '')}
  </div>

  <section class="section">
    <div class="section-head"><div class="eyebrow">${esc(t('sentimen.detail.kutipan_judul'))}</div></div>
    <div id="sent-quotes" style="margin-top:12px"></div>
  </section>

  <article class="card">
    <div class="co-title">⚠ ${esc(t('sentimen.detail.keterbatasan_judul'))}</div>
    <div id="sent-lim"></div>
  </article>

  ${d.report_md ? `<details class="ops-disclose" style="margin-top:16px"><summary><span class="dsc-title">${esc(t('sentimen.detail.laporan_lengkap'))}</span></summary><div class="dsc-body markdown" id="sent-md" style="margin-top:10px"></div></details>` : ''}`;

  /* kutipan */
  el.querySelector('#sent-quotes').innerHTML = quotesHtml(ctx, d.quotes);
  ui.bindImgFallbacks(el);

  /* keterbatasan */
  el.querySelector('#sent-lim').innerHTML = limitationsHtml(ctx, s);

  /* laporan md (async) */
  if (d.report_md) { ctx.renderMd(d.report_md).then((html) => { const m = el.querySelector('#sent-md'); if (m) m.innerHTML = html; }); }

  /* charts */
  const renderCharts = () => {
    drawDonut(ctx, el.querySelector('#wrap-donut'), ov);
    drawRawVsWeighted(ctx, el.querySelector('#wrap-rvw'), ov);
    drawPlatforms(ctx, el.querySelector('#wrap-plat'), s.per_platform);
    drawThemes(ctx, el.querySelector('#wrap-tema'), s.themes);
    drawScatter(ctx, el.querySelector('#wrap-scatter'), d.scatter || []);
    drawTrend(ctx, el.querySelector('#wrap-tren'), s.temporal);
  };
  renderCharts();
  const onRecharts = () => renderCharts();
  document.addEventListener('pimas:recharts', onRecharts);
  return () => document.removeEventListener('pimas:recharts', onRecharts);
}

/* ===== chart shell + helpers ===== */

function chartCard(ctx, id, judul, ket) {
  const { esc } = ctx;
  return `<article class="card chart-card">
    <h2 class="display-m" style="margin:0 0 4px;font-size:1.05rem">${esc(judul)}</h2>
    ${ket ? `<p class="cap">${esc(ket)}</p>` : ''}
    <div class="chart-wrap" id="wrap-${id}" style="margin-top:10px"></div>
  </article>`;
}

function setBox(ctx, wrap, chartId, aria, minH, fallbackHtml) {
  if (!wrap) return null;
  if (!ctx.charts.ok) { wrap.innerHTML = ctx.ui.chartFallback(fallbackHtml); return null; }
  wrap.innerHTML = `<div class="chart-box" id="${chartId}" role="img" aria-label="${ctx.esc(aria)}" style="min-height:${minH}px"></div>`;
  return ctx.charts.init(wrap.querySelector('#' + chartId));
}

function senColors(ctx) {
  const tok = ctx.charts.tokens();
  return { pos: tok.ok, neg: tok.warn, neu: tok.text4, track: tok.track, line: tok.line, t2: tok.text2, t3: tok.text3, mono: tok.mono, body: tok.body, chart: tok.chart, accent: tok.accent };
}

function drawDonut(ctx, wrap, ov) {
  const w = ov.weighted || {};
  const pos = (w.pos || 0), neu = (w.neu || 0), neg = (w.neg || 0);
  const aria = `${ctx.t('sentimen.detail.donut_judul')}: ${ctx.t('sentimen.detail.pos')} ${pctFmt(ctx, pos)}, ${ctx.t('sentimen.detail.neu')} ${pctFmt(ctx, neu)}, ${ctx.t('sentimen.detail.neg')} ${pctFmt(ctx, neg)}`;
  const fb = `${ctx.t('sentimen.detail.pos')} ${pctFmt(ctx, pos)} · ${ctx.t('sentimen.detail.neu')} ${pctFmt(ctx, neu)} · ${ctx.t('sentimen.detail.neg')} ${pctFmt(ctx, neg)}`;
  const c = setBox(ctx, wrap, 'chart-donut', aria, 200, fb);
  if (!c) return;
  const col = senColors(ctx);
  c.setOption({
    ...ctx.charts.ANIM,
    tooltip: { trigger: 'item', formatter: (p) => `${p.name}: ${Math.round(p.percent)}%` },
    legend: { bottom: 0, icon: 'circle', itemWidth: 8 },
    series: [{
      type: 'pie', radius: ['58%', '82%'], center: ['50%', '46%'], avoidLabelOverlap: false,
      label: { show: true, position: 'center', formatter: () => `${Math.round(pos * 100)}%`, fontSize: 22, fontWeight: 700, color: col.t2 },
      labelLine: { show: false },
      data: [
        { value: +(pos * 100).toFixed(1), name: ctx.t('sentimen.detail.pos'), itemStyle: { color: col.pos } },
        { value: +(neu * 100).toFixed(1), name: ctx.t('sentimen.detail.neu'), itemStyle: { color: col.neu } },
        { value: +(neg * 100).toFixed(1), name: ctx.t('sentimen.detail.neg'), itemStyle: { color: col.neg } },
      ],
    }],
  });
}

function drawRawVsWeighted(ctx, wrap, ov) {
  const r = ov.raw || {}, w = ov.weighted || {};
  const cats = [ctx.t('sentimen.detail.mentah'), ctx.t('sentimen.detail.tertimbang')];
  const aria = `${ctx.t('sentimen.detail.rawvsweighted_judul')}: ${ctx.t('sentimen.detail.mentah')} ${ctx.t('sentimen.detail.pos')} ${pctFmt(ctx, r.pos)}; ${ctx.t('sentimen.detail.tertimbang')} ${ctx.t('sentimen.detail.pos')} ${pctFmt(ctx, w.pos)}`;
  const fb = `${ctx.t('sentimen.detail.mentah')}: +${pctFmt(ctx, r.pos)} / −${pctFmt(ctx, r.neg)} · ${ctx.t('sentimen.detail.tertimbang')}: +${pctFmt(ctx, w.pos)} / −${pctFmt(ctx, w.neg)}`;
  const c = setBox(ctx, wrap, 'chart-rvw', aria, 150, fb);
  if (!c) return;
  const col = senColors(ctx);
  const pct = (x) => +(((x || 0) * 100)).toFixed(1);
  const mk = (name, color, key) => ({ name, type: 'bar', stack: 'x', barWidth: 26, itemStyle: { color }, data: [pct(r[key]), pct(w[key])], label: { show: true, formatter: (p) => (p.value >= 8 ? p.value + '%' : ''), color: '#fff', fontSize: 10 } });
  c.setOption({
    ...ctx.charts.ANIM,
    grid: { left: 4, right: 8, top: 6, bottom: 24, containLabel: true },
    legend: { bottom: 0, icon: 'circle', itemWidth: 8 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps) => ps.map((p) => `${p.seriesName}: ${p.value}%`).join('<br/>') },
    xAxis: { type: 'value', max: 100, show: false },
    yAxis: { type: 'category', data: cats, axisLabel: { color: col.t2, fontFamily: col.body, fontWeight: 600 } },
    series: [mk(ctx.t('sentimen.detail.pos'), col.pos, 'pos'), mk(ctx.t('sentimen.detail.neu'), col.neu, 'neu'), mk(ctx.t('sentimen.detail.neg'), col.neg, 'neg')],
  });
}

function drawPlatforms(ctx, wrap, perPlatform) {
  const entries = Object.entries(perPlatform || {});
  if (!entries.length) { if (wrap) wrap.innerHTML = ctx.ui.empty('empty.sentimen.detail'); return; }
  const rows = entries.map(([p, blk]) => ({ label: `${p} (${blk.tier})`, mu: blk.weighted ? blk.weighted.mu : null, n_eff: blk.n_eff }));
  const aria = `${ctx.t('sentimen.detail.platform_judul')}: ${rows.map((r) => `${r.label} ${muFmt(ctx, r.mu)} (n_eff ${ctx.fmt.dec(r.n_eff, 1)})`).join('; ')}`;
  const fb = rows.map((r) => `${r.label}: <span class="num">${ctx.esc(muFmt(ctx, r.mu))}</span> (n_eff ${ctx.esc(ctx.fmt.dec(r.n_eff, 1))})`).join('<br>');
  const c = setBox(ctx, wrap, 'chart-plat', aria, Math.max(120, rows.length * 44 + 20), fb);
  if (!c) return;
  const col = senColors(ctx);
  c.setOption({
    ...ctx.charts.ANIM,
    grid: { left: 8, right: 60, top: 6, bottom: 6, containLabel: true },
    tooltip: { trigger: 'item', formatter: (p) => `${rows[p.dataIndex].label}<br/>μ ${muFmt(ctx, rows[p.dataIndex].mu)} · n_eff ${ctx.fmt.dec(rows[p.dataIndex].n_eff, 1)}` },
    xAxis: { type: 'value', min: -1, max: 1, axisLabel: { color: col.t3, fontFamily: col.mono }, splitLine: { lineStyle: { color: col.line, opacity: 0.5 } } },
    yAxis: { type: 'category', inverse: true, data: rows.map((r) => r.label), axisLabel: { color: col.t2, fontFamily: col.body, fontWeight: 600 } },
    series: [{
      type: 'bar', barWidth: 16,
      data: rows.map((r) => ({ value: r.mu == null ? 0 : +r.mu.toFixed(3), itemStyle: { color: (r.mu || 0) >= 0 ? col.pos : col.neg, borderRadius: 3 } })),
      markLine: { silent: true, symbol: 'none', lineStyle: { color: col.t3, type: 'dashed', width: 1 }, data: [{ xAxis: 0 }] },
      label: { show: true, position: 'right', formatter: (p) => muFmt(ctx, rows[p.dataIndex].mu) + ' · n' + ctx.fmt.dec(rows[p.dataIndex].n_eff, 0), color: col.t2, fontFamily: col.mono, fontSize: 10.5 },
    }],
  });
}

function drawThemes(ctx, wrap, themes) {
  const praises = (themes && themes.top_praises) || [];
  const complaints = (themes && themes.top_complaints) || [];
  const rows = [
    ...complaints.map((x) => ({ label: x.label, value: -(x.share_w || 0), kind: 'neg' })),
    ...praises.map((x) => ({ label: x.label, value: (x.share_w || 0), kind: 'pos' })),
  ];
  if (!rows.length) { if (wrap) wrap.innerHTML = ctx.ui.empty('empty.sentimen.detail'); return; }
  rows.sort((a, b) => a.value - b.value);
  const aria = `${ctx.t('sentimen.detail.tema_judul')}: ${rows.map((r) => `${r.label} ${ctx.fmt.persen(Math.abs(r.value) * 100)} ${r.kind === 'pos' ? ctx.t('sentimen.detail.kutipan_positif') : ctx.t('sentimen.detail.kutipan_negatif')}`).join('; ')}`;
  const fb = rows.map((r) => `${ctx.esc(r.label)}: <span class="num">${ctx.esc(ctx.fmt.persen(Math.abs(r.value) * 100))}</span> ${r.kind === 'pos' ? '👍' : '👎'}`).join('<br>');
  const c = setBox(ctx, wrap, 'chart-tema', aria, Math.max(120, rows.length * 34 + 20), fb);
  if (!c) return;
  const col = senColors(ctx);
  c.setOption({
    ...ctx.charts.ANIM,
    grid: { left: 8, right: 40, top: 6, bottom: 6, containLabel: true },
    tooltip: { trigger: 'item', formatter: (p) => `${rows[p.dataIndex].label}: ${ctx.fmt.persen(Math.abs(rows[p.dataIndex].value) * 100)}` },
    xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { show: false }, axisLine: { show: false } },
    yAxis: { type: 'category', data: rows.map((r) => r.label), axisLabel: { color: col.t2, fontFamily: col.body, fontWeight: 600 }, axisLine: { lineStyle: { color: col.line } } },
    series: [{
      type: 'bar', barWidth: 14,
      data: rows.map((r) => ({ value: +(r.value * 100).toFixed(1), itemStyle: { color: r.kind === 'pos' ? col.pos : col.neg, borderRadius: 3 } })),
      label: { show: true, position: (p) => (p.value < 0 ? 'left' : 'right'), formatter: (p) => Math.abs(p.value) + '%', color: col.t3, fontFamily: col.mono, fontSize: 10 },
    }],
  });
}

function drawScatter(ctx, wrap, scatter) {
  const pts = (scatter || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!pts.length) { if (wrap) wrap.innerHTML = ctx.ui.empty('empty.sentimen.detail'); return; }
  const aria = `${ctx.t('sentimen.detail.scatter_judul')}: ${pts.length} komentar; sumbu-x engagement (skala log), sumbu-y polaritas −1 sampai +1; titik makin besar = engagement makin tinggi`;
  const fb = `${pts.length} komentar — visual butuh grafik; lihat ringkasan & per-platform.`;
  const c = setBox(ctx, wrap, 'chart-scatter', aria, 240, fb);
  if (!c) return;
  const col = senColors(ctx);
  const maxX = Math.max(...pts.map((p) => p.x), 1);
  const data = pts.map((p) => ({
    value: [Math.log10(1 + p.x), p.y],
    symbolSize: 6 + 16 * (Math.log10(1 + p.x) / Math.log10(1 + maxX)),
    itemStyle: { color: p.y > 0 ? col.pos : p.y < 0 ? col.neg : col.neu, opacity: 0.6 },
  }));
  c.setOption({
    ...ctx.charts.ANIM,
    grid: { left: 8, right: 12, top: 10, bottom: 28, containLabel: true },
    tooltip: { trigger: 'item', formatter: (p) => `${ctx.t('sentimen.detail.scatter_judul')}<br/>engagement ≈ ${ctx.fmt.int(Math.round(Math.pow(10, p.value[0]) - 1))} · polaritas ${ctx.fmt.dec(p.value[1], 2)}` },
    xAxis: { type: 'value', name: 'engagement (log)', nameLocation: 'middle', nameGap: 22, nameTextStyle: { color: col.t3, fontFamily: col.body, fontSize: 10 }, axisLabel: { color: col.t3, fontFamily: col.mono, formatter: (x) => ctx.fmt.compact(Math.round(Math.pow(10, x) - 1)) }, splitLine: { show: false } },
    yAxis: { type: 'value', min: -1, max: 1, interval: 0.5, axisLabel: { color: col.t3, fontFamily: col.mono }, splitLine: { lineStyle: { color: col.line, opacity: 0.4 } } },
    series: [{ type: 'scatter', data }],
  });
}

function drawTrend(ctx, wrap, temporal) {
  const buckets = (temporal && temporal.buckets) || [];
  if (!temporal || temporal.trend === null || buckets.length < 2) {
    if (wrap) wrap.innerHTML = `<div class="empty"><p class="e-kenapa">${ctx.esc(ctx.t('empty.sentimen.detail.kenapa'))}</p></div>`;
    return;
  }
  const periods = buckets.map((b) => b.period);
  const mus = buckets.map((b) => (b.mu_w == null ? null : b.mu_w));
  const aria = `${ctx.t('sentimen.detail.tren_judul')}: ${buckets.map((b) => `${b.period} ${muFmt(ctx, b.mu_w)}`).join('; ')}`;
  const fb = buckets.map((b) => `${b.period}: <span class="num">${ctx.esc(muFmt(ctx, b.mu_w))}</span>`).join('<br>');
  const c = setBox(ctx, wrap, 'chart-tren', aria, 180, fb);
  if (!c) return;
  const col = senColors(ctx);
  c.setOption({
    ...ctx.charts.ANIM,
    grid: { left: 8, right: 12, top: 10, bottom: 24, containLabel: true },
    tooltip: { trigger: 'axis', formatter: (ps) => `${ps[0].axisValue}<br/>μ ${muFmt(ctx, ps[0].value)}` },
    xAxis: { type: 'category', data: periods, axisLabel: { color: col.t3, fontFamily: col.mono, fontSize: 10 } },
    yAxis: { type: 'value', min: -1, max: 1, interval: 0.5, axisLabel: { color: col.t3, fontFamily: col.mono }, splitLine: { lineStyle: { color: col.line, opacity: 0.4 } } },
    series: [{ type: 'line', data: mus, connectNulls: false, smooth: true, lineStyle: { width: 2, color: col.chart }, itemStyle: { color: col.chart }, areaStyle: { color: 'rgba(0,0,0,0)' }, markLine: { silent: true, symbol: 'none', lineStyle: { color: col.t3, type: 'dashed', width: 1 }, data: [{ yAxis: 0 }] } }],
  });
}

/* ===== quotes + limitations ===== */

function quoteCard(ctx, q, kind) {
  const { esc, fmt, ui } = ctx;
  const eng = q.engagement || {};
  const engStr = typeof eng.likes === 'number' ? `♥ ${fmt.compact(eng.likes)}`
    : Number.isInteger(eng.stars) ? `★ ${eng.stars}/5`
      : typeof eng.helpful === 'number' ? `👍 ${fmt.compact(eng.helpful)}` : '';
  const src = ui.sourceLink({ sumber: q.platform, url: q.url, tanggal_akses: q.date });
  return `<figure class="snt-quote ${kind}">
    <blockquote>${esc(String(q.text || '').slice(0, 240))}</blockquote>
    <figcaption>${ui.tierChip(q.tier)} <span class="sq-plat">${esc(q.platform || '')}</span>${engStr ? ` · <span class="sq-eng">${esc(engStr)}</span>` : ''} · ${src}</figcaption>
  </figure>`;
}

function quotesHtml(ctx, quotes) {
  const { t, ui } = ctx;
  const pos = (quotes && quotes.positif) || [];
  const neg = (quotes && quotes.negatif) || [];
  if (!pos.length && !neg.length) return `<div class="card">${ui.empty('empty.sentimen.detail')}</div>`;
  const col = (title, arr, kind) => `<div class="sent-qcol">
    <div class="eyebrow">${ctx.esc(title)}</div>
    ${arr.length ? arr.map((q) => quoteCard(ctx, q, kind)).join('') : `<p class="cap">${ctx.esc(t('umum.kosong'))}</p>`}
  </div>`;
  return `<div class="sent-quotes-grid">
    ${col(t('sentimen.detail.kutipan_positif'), pos, 'pos')}
    ${col(t('sentimen.detail.kutipan_negatif'), neg, 'neg')}
  </div>`;
}

function limitationsHtml(ctx, s) {
  const { esc } = ctx;
  const lims = s.limitations || [];
  const det = s.limitations_detail || {};
  if (!lims.length) return `<p class="cap">—</p>`;
  return `<ul class="sent-lim-list">${lims.map((k) => `<li><span class="badge plain">${esc(k)}</span> ${esc(det[k] || '')}</li>`).join('')}</ul>`;
}

export function render(el, ctx) {
  if (ctx.route && ctx.route.slug) return renderDetail(el, ctx, ctx.route.slug);
  return renderList(el, ctx);
}
