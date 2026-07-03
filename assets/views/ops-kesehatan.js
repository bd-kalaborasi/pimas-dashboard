/*
 * View: Ops › Kesehatan — port fungsional v2 (ops + feedback) dengan v3:
 * budget token mingguan (ratio + ambang GREEN/AMBER/RED) + chart token per
 * skill, pemakaian token terbaru (token-usage.csv), QA bounce, isu terbuka,
 * keandalan cron (cron_state), instincts per skill, antrean feedback +
 * perintah Telegram (salin). Plane teknis — jargon internal boleh.
 *
 * Rework admin-first 2026-06-15: kartu ringkasan kesehatan di kepala halaman
 * (sehat/ada-isu + budget + keandalan), pemisahan isu TERBUKA vs TERATASI
 * (ISS-001 tampil sebagai "kendala teratasi", bukan dikubur), nama proses
 * diterjemahkan ke bahasa awam.
 */

import { issuesSplit, humanSkill, knownCronKey, agentOffMode, agentWorkState, nextRun } from './ops-agen.js';

export function render(el, ctx) {
  const { ops, t, esc, fmt, ui, charts, cron } = ctx;
  const now = Date.now();
  const budget = ops.budget || {};
  /* BL-12: null≠0 — last_cycle_total null → JANGAN band GREEN palsu dari 0. hasBudget
     gerbang semua derivasi ratio/band; 0 (number) = nol valid. */
  const hasBudget = typeof budget.last_cycle_total === 'number';
  const ratio = (hasBudget && budget.threshold_weekly) ? budget.last_cycle_total / budget.threshold_weekly : 0;
  const band = !hasBudget ? null : (ratio < 0.7 ? 'GREEN' : (ratio <= 0.9 ? 'AMBER' : 'RED'));
  const bandCls = band === 'GREEN' ? 'ok' : band === 'AMBER' ? 'half' : band === 'RED' ? 'warn' : 'plain';
  const barCls = band === 'GREEN' ? '' : band === 'AMBER' ? 'half' : band === 'RED' ? 'warn' : '';
  const bandLabel = band ? t('ops.kesehatan.budget_band.' + band.toLowerCase(), null, band) : '';

  const perSkill = {};
  (budget.runs || []).forEach((r) => { if (r && r.skill) perSkill[r.skill] = (perSkill[r.skill] || 0) + (r.tokens || 0); });
  const skillRows = Object.keys(perSkill).map((s) => ({ skill: s, tokens: perSkill[s] })).sort((a, b) => b.tokens - a.tokens);

  const bounce = (ops.qa || {}).bounce || {};
  const bounceRows = Object.keys(bounce).map((id) => ({ id, n: bounce[id] }));
  const issueSplit = issuesSplit(ops);
  const openIssues = issueSplit.open;
  const resolvedIssues = issueSplit.resolved;
  const cronState = ops.cron_state || {};
  // Keandalan: sembunyikan key chain-level mentah dari ringkasan keandalan tabel?
  // Tetap tampilkan semua (transparansi ops), tapi terjemahkan nama skill ke awam.
  const cronRows = Object.keys(cronState).filter((k) => knownCronKey(k, ops)).map((k) => ({ key: k, ...cronState[k] })); // BL-15: keandalan atas skill/chain aktual
  const cronOkCount = cronRows.filter((r) => r.last_status === 'success').length;
  const instincts = ops.instincts || [];
  const feedback = ops.feedback_queue || [];
  const tg = ops.telegram || {};
  /* CSV token-usage tersimpan terlama-dulu; heading "aktivitas terakhir" → render
     salinan terurut tanggal desc (newest-first) tanpa memutasi sumber. */
  const tokenUsage = (ops.token_usage || []).slice()
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const sevBadge = (sev) => {
    const map = { critical: 'warn', high: 'warn', medium: 'half', low: 'plain' };
    const cls = map[String(sev || '').toLowerCase()] || 'plain';
    const sym = cls === 'warn' ? '✕' : cls === 'half' ? '◐' : '◌';
    return `<span class="badge ${cls}">${sym} ${esc(t('ops.kesehatan.severity.' + String(sev || '').toLowerCase(), null, sev))}</span>`;
  };

  /* BL-13: hero 3-keadaan (sehat / kendala / mesin-riset-dimatikan) — kalimat keputusan
     di puncak. worst-of: kegagalan KNOWN selalu naik; openIss WAJIB dari issuesSplit. */
  const agents = ops.agents || [];
  const INTI = ['scout-fnb', 'pipeline-gatekeeper', 'product-deep-research', 'regulatory-check-id', 'market-research-id', 'qa-verification'];
  const agFail = agents.filter((a) => ['gagal', 'macet'].includes(agentWorkState(a, ops, now))).length;
  const offInti = agents.filter((a) => agentOffMode(a, ops) === 'dimatikan' && INTI.includes(a.id)).length;
  const okCron = cronRows.filter((r) => r.last_status === 'success').length;
  const cronTotal = cronRows.length;
  const openIss = openIssues.length;
  const next = nextRun(ops, cron, new Date(now));
  const nextLabel = next ? fmt.tanggalWaktu(next.date.toISOString()) : t('umum.kosong');
  const sehat = openIss === 0 && agFail === 0 && offInti === 0;
  let heroBadge;
  if (sehat) heroBadge = ui.toneBadge('ok', '●', t('ops.kesehatan.hero_sehat', { ok: fmt.int(okCron), total: fmt.int(cronTotal) }));
  else if (offInti > 0) heroBadge = ui.toneBadge('tip', '◐', t('ops.kesehatan.hero_dimatikan', { n: fmt.int(offInti), next: nextLabel }));
  else heroBadge = ui.toneBadge('warn', '✕', t('ops.kesehatan.hero_kendala', { n: fmt.int(openIss + agFail) }));
  const budgetPill = hasBudget
    ? ui.toneBadge(bandCls, band === 'GREEN' ? '●' : band === 'AMBER' ? '◐' : '✕', t('ops.kesehatan.ringkasan_budget', { persen: fmt.persen(Math.round(ratio * 100)), band: bandLabel }))
    : `<span class="badge plain">◌ ${esc(t('ops.kesehatan.budget_judul'))}: ${esc(t('ops.kesehatan.budget.belum'))}</span>`;
  const keandalanPill = ui.toneBadge((okCron === cronTotal && cronTotal > 0) ? 'ok' : 'half', (okCron === cronTotal && cronTotal > 0) ? '●' : '◐', t('ops.kesehatan.ringkasan_keandalan', { ok: fmt.int(okCron), total: fmt.int(cronTotal) }));

  el.innerHTML = `
  <header class="pagehead">
    <div>
      <div class="eyebrow">${esc(t('nav.ops.label'))}</div>
      <h1 class="display-l">${esc(t('ops.kesehatan.judul'))}</h1>
      <p class="sub">${esc(t('nav.ops.kesehatan.deskripsi'))}</p>
    </div>
  </header>

  <article class="ops-hero" style="margin-bottom:14px">
    <div class="eyebrow">${esc(t('ops.kesehatan.hero_eyebrow'))}</div>
    <div class="ops-hero-verdict">${heroBadge}</div>
    <div class="status-pills" style="margin-top:12px">${budgetPill} ${keandalanPill}</div>
  </article>

  <section class="bento">
    <article class="card b-wide chart-card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div class="eyebrow">${esc(t('ops.kesehatan.budget_judul'))} · ${esc(t('ops.kesehatan.token_judul'))}</div>
        ${hasBudget ? `<span class="badge ${bandCls}">${band === 'GREEN' ? '●' : band === 'AMBER' ? '◐' : '✕'} ${esc(band)}</span>` : `<span class="badge plain">◌ ${esc(t('ops.kesehatan.budget.belum'))}</span>`}
      </div>
      ${hasBudget ? `
      <p style="margin:8px 0 0" class="mono-data"><b style="font-size:18px">${esc(fmt.int(budget.last_cycle_total))}</b> / ${esc(fmt.int(budget.threshold_weekly))} · ${esc(fmt.persen(Math.round(ratio * 100)))}</p>
      <div class="progress" role="img" aria-label="${esc(t('ops.kesehatan.budget_judul'))}: ${esc(fmt.int(budget.last_cycle_total))} / ${esc(fmt.int(budget.threshold_weekly))} (${esc(fmt.persen(Math.round(ratio * 100)))})">
        <i class="${barCls}" style="width:${Math.min(ratio * 100, 100)}%"></i>
      </div>` : `<div class="belum-tersedia box" style="margin-top:8px">${esc(t('ops.kesehatan.budget.belum'))}${budget.threshold_weekly ? ` — ${esc(t('ops.kesehatan.budget_judul'))} ${esc(fmt.int(budget.threshold_weekly))}` : ''}</div>`}
      <div id="budget-wrap" style="flex:1;margin-top:8px"></div>
    </article>

    <article class="card b-side">
      <div class="eyebrow">${esc(t('ops.kesehatan.keandalan_judul'))}</div>
      <p class="panel-sub">${esc(t('ops.kesehatan.keandalan_sub'))}</p>
      ${cronRows.length ? `
      <div class="tbl-scroll" style="margin-top:10px"><table class="tbl">
        <thead><tr><th>${esc(t('ops.kesehatan.proses_kolom', null, 'Proses'))}</th><th>${esc(t('ops.kesehatan.status_terakhir'))}</th><th class="td-num">${esc(t('ops.kesehatan.success_rate'))}</th></tr></thead>
        <tbody>
          ${cronRows.map((r) => `<tr>
            <td>${esc(r.key.startsWith('chain:') ? r.key.replace(/^chain:/, '') : humanSkill(r.key, ops))}</td>
            <td><span class="badge ${r.last_status === 'success' ? 'ok' : 'warn'}">${r.last_status === 'success' ? '●' : '✕'} ${esc(r.last_status === 'success' ? t('ops.agen.status_sukses') : r.last_status === 'failed' ? t('ops.agen.status_gagal') : (r.last_status || t('umum.kosong')))}</span>
              ${r.consecutive_failures ? `<span class="badge warn" style="margin-left:4px">${esc(t('ops.kesehatan.gagal_beruntun', { n: fmt.int(r.consecutive_failures) }))}</span>` : ''}</td>
            <td class="td-num">${r.success_rate === null || r.success_rate === undefined ? esc(t('umum.kosong')) : esc(fmt.persen(Math.round(r.success_rate * 100)))}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : ui.empty('empty.ops.kesehatan')}
    </article>
  </section>

  <section class="bento" style="margin-top:14px">
    <article class="card b-side">
      <div class="eyebrow">${esc(t('ops.kesehatan.qa_judul'))}</div>
      ${(ops.qa && ops.qa.note) ? `<p class="cap" style="margin-top:8px">${esc(ops.qa.note)}</p>` : ''}
      ${bounceRows.length ? `
      <table class="tbl" style="margin-top:8px">
        <thead><tr><th>${esc(t('ops.pipeline.kolom.id'))}</th><th class="td-num">bounce</th></tr></thead>
        <tbody>${bounceRows.map((b) => `<tr><td class="td-id">${esc(b.id)}</td><td class="td-num"><span class="badge half">◐ ${esc(fmt.int(b.n))}×</span></td></tr>`).join('')}</tbody>
      </table>` : `<div class="empty-dash" style="margin-top:10px">${esc(t('empty.ops.isu.apa'))}</div>`}
    </article>

    <article class="card b-wide">
      <div class="eyebrow">${esc(t('ops.kesehatan.isu_judul'))}</div>
      ${openIssues.length ? openIssues.map((iss) => `
        <div class="isu-row">
          <span class="ref-chip">${esc(iss.id || '')}</span>
          <span class="isu-title">${esc(iss.title || '')}</span>
          ${sevBadge(iss.severity)}
        </div>`).join('')
    : `<div class="empty-dash" style="margin-top:10px">${esc(t('ops.kesehatan.isu_nihil_aman'))}</div>`}

      ${resolvedIssues.length ? `
      <div class="isu-teratasi">
        <div class="eyebrow" style="margin-bottom:8px">${esc(t('ops.kesehatan.isu_teratasi_judul'))}</div>
        ${resolvedIssues.map((iss) => `
        <div class="isu-row resolved">
          <span class="badge ok">✓</span>
          <span class="ref-chip">${esc(iss.id || '')}</span>
          <span class="isu-title">${esc(iss.title || '')}</span>
          ${sevBadge(iss.severity)}
        </div>`).join('')}
      </div>` : ''}
    </article>
  </section>

  <article class="card" style="margin-top:14px">
    <div class="eyebrow">${esc(t('ops.kesehatan.token_judul'))} — ${esc(t('ops.agen.aktivitas_terakhir').toLowerCase())}</div>
    ${tokenUsage.length ? `
    <div class="tbl-scroll" style="margin-top:10px"><table class="tbl">
      <thead><tr><th>${esc(t('ops.pipeline.kolom.tanggal'))}</th><th>skill</th><th>model</th><th class="td-num">input</th><th class="td-num">output</th><th class="td-num">cache read</th><th class="td-num">cache write</th></tr></thead>
      <tbody>
        ${tokenUsage.map((r) => `<tr>
          <td class="td-num">${esc(fmt.tanggal(r.date))}</td>
          <td class="td-id">${esc(r.skill || '')}</td>
          <td class="td-id">${esc(r.model || '')}</td>
          <td class="td-num">${esc(fmt.int(r.input_tokens))}</td>
          <td class="td-num">${esc(fmt.int(r.output_tokens))}</td>
          <td class="td-num">${esc(fmt.int(r.cache_read))}</td>
          <td class="td-num">${esc(fmt.int(r.cache_creation))}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>` : `<div class="empty-dash" style="margin-top:10px">${esc(t('empty.ops.kesehatan.apa'))} ${esc(t('empty.ops.kesehatan.berikutnya'))}</div>`}
  </article>

  <section class="section">
    <div class="section-head"><div class="eyebrow">${esc(t('ops.kesehatan.instinct_judul'))}</div></div>
    <div id="instincts" style="margin-top:14px">
      ${instincts.length ? instincts.map((ins, i) => `
      <div class="acc">
        <button class="acc-head" data-acc="${i}" aria-expanded="false">
          <span class="td-id">${esc(ins.skill)}</span>
          <span style="display:inline-flex;align-items:center;gap:8px"><span class="chip">${esc(fmt.int((ins.items || []).length))}</span><span aria-hidden="true">›</span></span>
        </button>
        <div class="acc-body" hidden>
          ${(ins.items || []).map((it) => `
          <div class="instinct-item">
            <span class="ref-chip">${esc(it.id)}</span>
            <p style="margin:4px 0 0">${esc(it.lesson)}</p>
            <div class="conf-bar" title="confidence ${Math.round((it.confidence || 0) * 100)}%"><span style="width:${Math.round((it.confidence || 0) * 100)}%"></span></div>
          </div>`).join('')}
        </div>
      </div>`).join('')
    : `<div class="card">${ui.empty('empty.ops.kesehatan')}</div>`}
    </div>
  </section>

  <section class="bento" style="margin-top:14px">
    <article class="card b-side">
      <div class="eyebrow">${esc(t('ops.kesehatan.feedback_judul'))}</div>
      ${feedback.length
    ? feedback.map((item) => `<div class="queue-item">${esc(typeof item === 'string' ? item : JSON.stringify(item))}</div>`).join('')
    : `<div class="empty-dash" style="margin-top:10px">${esc(t('empty.ops.isu.apa'))}</div>`}
    </article>
    <article class="card b-wide">
      <div class="eyebrow">${esc(t('ops.kesehatan.telegram_judul', null, 'Perintah Telegram'))}${tg.bot ? ` — <span class="td-id">${esc(tg.bot)}</span>` : ''}</div>
      ${(tg.commands || []).length ? `
      <div class="cmd-grid">
        ${(tg.commands || []).map((cm, i) => `
        <div class="cmd-card">
          <code>${esc(cm.contoh)}</code>
          <p class="cap">${esc(cm.fungsi || '')}</p>
          <button class="btn-ghost" data-copy="${i}" style="align-self:flex-start">${esc(t('umum.salin'))}</button>
        </div>`).join('')}
      </div>` : `<div class="empty-dash" style="margin-top:10px">${esc(t('empty.ops.kesehatan.apa'))}</div>`}
    </article>
  </section>`;

  /* ---------- chart token per skill ---------- */
  function renderChart() {
    const wrap = el.querySelector('#budget-wrap');
    if (!wrap) return;
    if (!skillRows.length) { wrap.innerHTML = `<div class="empty-dash">${esc(t('empty.ops.kesehatan.apa'))}</div>`; return; }
    const aria = `${esc(t('ops.kesehatan.token_judul'))}: ${esc(skillRows.map((r) => `${r.skill} ${fmt.int(r.tokens)}`).join('; '))}`;
    if (!charts.ok) {
      wrap.innerHTML = ui.chartFallback(skillRows.map((r) => `<span class="num">${esc(fmt.int(r.tokens))}</span> — ${esc(r.skill)}`).join('<br>'));
      return;
    }
    wrap.innerHTML = `<div class="chart-box" id="budget-chart" role="img" aria-label="${aria}" style="min-height:${skillRows.length * 34 + 16}px"></div>`;
    const tok = charts.tokens();
    const c = charts.init(wrap.querySelector('#budget-chart'));
    if (!c) return;
    c.setOption({
      ...charts.ANIM,
      grid: { left: 8, right: 76, top: 4, bottom: 4, containLabel: true },
      tooltip: { show: false },
      xAxis: { type: 'value', show: false },
      yAxis: {
        type: 'category', inverse: true, data: skillRows.map((r) => r.skill),
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: tok.text2, fontFamily: tok.mono, fontSize: 10.5 },
      },
      series: [{
        type: 'bar', barWidth: 11, silent: true,
        itemStyle: { color: tok.chart, borderRadius: [0, 3, 3, 0] },
        label: { show: true, position: 'right', color: tok.text2, fontFamily: tok.mono, fontSize: 10.5, formatter: (p) => fmt.int(p.value) },
        data: skillRows.map((r) => r.tokens),
      }],
    });
  }
  renderChart();

  /* accordion instincts */
  el.querySelectorAll('[data-acc]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const body = btn.nextElementSibling;
      const open = body.hasAttribute('hidden');
      body.toggleAttribute('hidden', !open);
      btn.setAttribute('aria-expanded', String(open));
    });
  });

  /* salin perintah telegram */
  el.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cm = (tg.commands || [])[parseInt(btn.getAttribute('data-copy'), 10)];
      if (!cm) return;
      try {
        await navigator.clipboard.writeText(cm.contoh);
        btn.textContent = t('umum.tersalin') + ' ✓';
        setTimeout(() => { btn.textContent = t('umum.salin'); }, 1600);
      } catch { /* clipboard diblok — abaikan */ }
    });
  });

  const onRecharts = () => renderChart();
  document.addEventListener('pimas:recharts', onRecharts);
  return () => document.removeEventListener('pimas:recharts', onRecharts);
}
