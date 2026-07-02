/*
 * View: Ops › Agen — port fungsional view "agents" v2 dengan komponen v3:
 * grid kartu agent (status dot, model, trigger, aktivitas terakhir, jadwal
 * berikutnya, token/run, instinct) + panel detail (drawer §4.18: peran, DoD,
 * alur data consumes→outputs, instincts + confidence). Plane teknis — istilah
 * internal boleh (DESIGN §1.4).
 *
 * Lapisan tambahan v3: "Ruang kerja agen" — visualisasi pixel-art per agen
 * (replikasi aestetika ekstensi pixel-agents secara client-side, sprite
 * prosedural-deterministik via assets/pixel-agents.js). Toggle dua mode:
 * Ruang kerja (default) + Daftar detail (kartu existing). Klik karakter ATAU
 * kartu → drawer jobdesk yang SAMA (peran/DoD/alur/instinct) — viz adalah
 * lapisan, bukan pengganti.
 */

import { spriteSVG } from '../pixel-agents.js';

/* ============================================================
   Helper bersama plane OPERASIONAL (rework admin-first 2026-06-15).
   Ditaruh di sini (bukan modul terpisah) karena ops-agen.js sudah masuk
   whitelist publish — ops-pipeline.js & ops-kesehatan.js mengimpor dari sini.
   SEMUA derivasi dari payload ops; null/absen → null (jujur), BUKAN 0.
   ============================================================ */

/* Nama awam per skill ID — fallback bila agents[] tak memuat nama.
   Selaras HUMAN_SKILL_LABELS di scripts/build-dashboard-data.mjs. */
const HUMAN_LABEL = {
  'scout-fnb': 'Pemindaian kandidat',
  'pipeline-gatekeeper': 'Seleksi kandidat',
  'product-deep-research': 'Riset produk',
  'regulatory-check-id': 'Cek regulasi',
  'market-research-id': 'Riset pasar',
  'qa-verification': 'Cek mutu',
  'report-composer': 'Susun laporan',
  'reflect-and-learn': 'Evaluasi & belajar',
  'evolve-skills': 'Peningkatan sistem',
  'skill-health': 'Cek kesehatan',
  'skill-repair': 'Perbaikan sistem',
  janitor: 'Perapian data',
  heartbeat: 'Pemantauan rutin',
};

/* Label + glyph awam per chain ID (siklus jadwal). */
const CHAIN_LABEL = {
  'research-phase': { key: 'siklus_riset', glyph: '◔' },
  'qa-report-phase': { key: 'siklus_qa', glyph: '◑' },
  'weekly-evolution': { key: 'siklus_evolusi', glyph: '◕' },
};

export function chainLabel(id, t) {
  const m = CHAIN_LABEL[id];
  return m ? t('ops.admin.' + m.key) : id;
}

export function chainGlyph(id) {
  const m = CHAIN_LABEL[id];
  return m ? m.glyph : '○';
}

/* Nama awam satu skill: dari agents[].nama bila ada, lalu HUMAN_LABEL, lalu ID. */
export function humanSkill(sk, ops) {
  const a = (ops.agents || []).find((x) => x.id === sk);
  if (a && a.nama) return a.nama;
  return HUMAN_LABEL[sk] || sk;
}

/* Entri cron_state satu skill (null-safe). */
function cronOf(sk, ops) {
  return (ops.cron_state || {})[sk] || null;
}

/* BL-10: key cron_state DIKENAL bila merujuk chain/agent yang ADA di payload
   (bukan key legacy spt "chain:weekly-pipeline" sisa orchestrator lama). DATA-driven —
   mencegah alarm palsu dari key usang. */
export function knownCronKey(key, ops) {
  const k = String(key || '');
  if (k.startsWith('chain:')) {
    const bare = k.replace(/^chain:/, '');
    return (ops.chains || []).some((c) => c.id === bare);
  }
  return (ops.agents || []).some((a) => a.id === k);
}

/* Status satu skill dalam siklus minggu ini → kode tahap:
   'selesai' | 'berjalan' | 'gagal' | 'macet' | 'menunggu'. */
export function stepState(sk, ops) {
  const c = cronOf(sk, ops);
  if (!c) return 'menunggu';
  if (c.stuck === true) return 'macet';
  if (c.last_status === 'failed' || (c.consecutive_failures || 0) > 0) return 'gagal';
  if (c.last_status === 'dispatched') return 'berjalan';
  if (c.last_status === 'success') return 'selesai';
  return 'menunggu';
}

/* Flatten semua step-skill satu chain → node timeline berurutan.
   [{sk, nama, state, last_success, parallel}] */
export function chainNodes(chain, ops) {
  const nodes = [];
  for (const st of chain.steps || []) {
    for (const sk of st.skills || []) {
      const c = cronOf(sk, ops);
      const ag = (ops.agents || []).find((x) => x.id === sk);
      const rs = ag ? agentRunStatus(ag, ops) : null;
      nodes.push({
        sk,
        nama: humanSkill(sk, ops),
        state: stepState(sk, ops),
        last_success: c ? c.last_success : null,
        parallel: !!st.parallel,
        /* audit: percobaan terakhir dibatalkan/gagal walau sukses lama ada (konsistensi
           dgn halaman Agen — kegagalan tetap tampil + ber-alasan). */
        gagal_lebih_baru: rs ? rs.gagal_lebih_baru : false,
        gagal: rs ? rs.gagal : null,
        gagal_error: rs ? rs.gagal_error : null,
      });
    }
  }
  return nodes;
}

/* Progress satu chain: {total, done, currentIdx, current}. */
export function chainProgress(nodes) {
  const total = nodes.length;
  const done = nodes.filter((n) => n.state === 'selesai').length;
  const running = nodes.find((n) => n.state === 'berjalan' || n.state === 'macet' || n.state === 'gagal');
  const currentIdx = running ? nodes.indexOf(running) : nodes.findIndex((n) => n.state !== 'selesai');
  return { total, done, currentIdx, current: currentIdx >= 0 ? nodes[currentIdx] : null };
}

/* Run berikutnya across semua chain → {chain, date} paling awal. */
export function nextRun(ops, cron, fromDate) {
  let best = null;
  for (const c of ops.chains || []) {
    if (!c.schedule_cron) continue;
    const n = cron.nextUTC(c.schedule_cron, fromDate);
    if (n && (!best || n < best.date)) best = { chain: c, date: n };
  }
  return best;
}

/* Kendala (obstacles) dari cron_state: per-skill macet/gagal + chain-level
   (key "chain:..") yang last_status failed. → [{kind, key, nama, sejak, error}] */
export function obstacles(ops) {
  const cs = ops.cron_state || {};
  const out = [];
  for (const [key, c] of Object.entries(cs)) {
    if (!c) continue;
    if (!knownCronKey(key, ops)) continue; // BL-10: buang key legacy/tak dikenal
    if (key.startsWith('chain:')) {
      if (c.last_status === 'failed') {
        out.push({ kind: 'chain', key, nama: key.replace(/^chain:/, ''), sejak: c.last_failed || null, error: c.last_error || null });
      }
      continue;
    }
    if (c.stuck === true) {
      out.push({ kind: 'macet', key, nama: humanSkill(key, ops), sejak: c.last_dispatch || c.last_failed || null, error: c.last_error || null });
    } else if (c.last_status === 'failed' || (c.consecutive_failures || 0) > 0) {
      out.push({ kind: 'gagal', key, nama: humanSkill(key, ops), sejak: c.last_failed || null, error: c.last_error || null, beruntun: c.consecutive_failures || 0 });
    }
  }
  return out;
}

/* Isu (memory/issues): buang placeholder "_(tidak ada)_"/baris kosong,
   ekstrak ID "ISS-001" dari markdown-link, pisah open vs resolved. */
function cleanIssueId(raw) {
  const m = String(raw || '').match(/(ISS-\d+)/i);
  if (m) return m[1].toUpperCase();
  return String(raw || '').replace(/^_+|_+$/g, '').trim();
}

function isPlaceholderIssue(iss) {
  if (!iss) return true;
  const id = String(iss.id || '');
  if (/tidak ada/i.test(id)) return true;
  if (!iss.title || !String(iss.title).trim()) return true;
  if (!/ISS-\d+/i.test(id)) return true;
  return false;
}

export function issuesSplit(ops) {
  const all = (ops.issues || []).filter((x) => !isPlaceholderIssue(x)).map((x) => ({ ...x, id: cleanIssueId(x.id) }));
  return {
    open: all.filter((x) => x.status === 'open'),
    resolved: all.filter((x) => x.status === 'resolved'),
  };
}

export function agentStatus(a, now) {
  if (!a || !a.enabled) return 'err';
  const d = a.last_activity && a.last_activity.date;
  if (!d) return 'warn';
  const age = (now - new Date(d + 'T00:00:00Z').getTime()) / 86400000;
  return age <= 7 ? 'ok' : 'warn';
}

/* Entri cron_state untuk satu agent (skill langsung, atau chain bila agent chain). */
export function agentCron(a, ops) {
  const cs = (ops && ops.cron_state) || {};
  if (!a) return null;
  return cs[a.id] || (a.chain ? cs['chain:' + a.chain] : null) || null;
}

/* K4: mode "off" satu agen — 'aktif' | 'via-chain' | 'dimatikan'. Satu sumber
   kebenaran (BL-13/20/21/22). disabled TAPI pernah sukses via chain = 'via-chain'
   (BUKAN "dimatikan"); disabled & tak pernah jalan = 'dimatikan' (truly-off). */
export function agentOffMode(a, ops) {
  if (a && a.enabled) return 'aktif';
  const c = agentCron(a, ops);
  if (c && (c.last_status === 'success' || c.last_success)) return 'via-chain';
  return 'dimatikan';
}

/* Cmp ISO-8601 aman (string lexicographic = kronologis utk format Z yang sama). */
function newerISO(x, y) { return !x ? y : !y ? x : (x > y ? x : y); }

/* Riwayat run satu agent → { last_success, last_failed, last_status } dari entri
   cron_state milik agent SENDIRI. Catatan kontrak: cron-state writer (aeon.yml)
   memetakan SEMUA outcome non-success (TERMASUK GitHub "cancelled") → last_status
   "failed" + last_failed; data layer TIDAK membedakan batal vs gagal, maka microcopy
   memakai "dibatalkan/gagal". */
export function agentRunHistory(a, ops) {
  const cs = (ops && ops.cron_state) || {};
  if (!a) return { last_success: null, last_failed: null, last_status: null };
  const own = cs[a.id] || (a.chain ? cs['chain:' + a.chain] || null : null) || null;
  return {
    last_success: (own && own.last_success) || null,
    last_failed: (own && own.last_failed) || null,
    last_status: (own && own.last_status) || null,
    last_error: (own && own.last_error) || null,
  };
}

/* Percobaan chain DIBATALKAN/GAGAL yang meninggalkan agent ini di belakang →
   { tgl, error } | null. Sebuah agent step (a.chain != null) "ketinggalan" bila ADA entri
   chain "chain:*" yang: (1) punya last_failed, (2) chain.last_success LEBIH BARU dari sukses
   terakhir agent (chain sempat maju tanpa menyertakan agent ini), (3) last_failed chain juga
   lebih baru dari sukses agent. Guard #2 KRUSIAL agar sibling yang BENAR jalan di percobaan
   terakhir (sukses ≥ chain.last_success) tak ikut ter-flag.
   KEBIJAKAN AUDIT (arahan owner 2026-06-17): kegagalan SELALU masuk audit trail & ditampilkan
   + diperjelas alasannya — TERMASUK chain legacy (mis. "chain:weekly-pipeline" yang sudah
   di-split). Maka knownCronKey TIDAK menyaring di sini (riwayat audit lengkap). Banner
   "kendala terbuka" tetap pakai knownCronKey (BL-10) karena itu sinyal AKTIF, bukan riwayat.
   Kasus nyata: weekly-pipeline cancelled 15 Jun (last_error=null → run DIBATALKAN, bukan gagal
   teknis) — hanya market-research-id (sukses 10 Jun) ketinggalan; error null → microcopy
   "dibatalkan, tanpa pesan error". */
function chainAbortedSince(a, ops, ownSuccess) {
  if (!a || !a.chain) return null;
  const cs = (ops && ops.cron_state) || {};
  let worst = null; let worstErr = null;
  for (const [key, c] of Object.entries(cs)) {
    if (!key.startsWith('chain:') || !c || !c.last_failed) continue;
    const cSucc = c.last_success || null;
    let hit = false;
    if (!ownSuccess) { if (!cSucc) hit = true; }
    else if (cSucc && cSucc > ownSuccess && c.last_failed > ownSuccess) hit = true;
    if (hit && (!worst || c.last_failed > worst)) { worst = c.last_failed; worstErr = c.last_error || null; }
  }
  return worst ? { tgl: worst, error: worstErr } : null;
}

/* Status riwayat run untuk tampil "terakhir sukses … · percobaan … dibatalkan/gagal".
   gagal_lebih_baru = true bila:
   (a) entri agent sendiri menunjukkan gagal lebih baru dari sukses (last_failed >
       last_success ATAU last_status non-success), ATAU
   (b) percobaan chain dibatalkan/gagal meninggalkan agent di belakang (chainAbortedSince).
   Tanggal `gagal` yang ditampilkan = yang paling baru di antara keduanya. */
export function agentRunStatus(a, ops) {
  const h = agentRunHistory(a, ops);
  let gagal = null; let gagalErr = null;
  /* ambil tanggal gagal TERBARU + alasan (last_error) dari sumbernya. */
  const consider = (tgl, err) => { if (tgl && (!gagal || tgl > gagal)) { gagal = tgl; gagalErr = err || null; } };
  // (a) sinyal dari entri agent sendiri.
  if (h.last_failed && (!h.last_success || h.last_failed > h.last_success)) consider(h.last_failed, h.last_error);
  if (h.last_status && h.last_status !== 'success' && h.last_status !== 'dispatched' && h.last_failed && (!h.last_success || h.last_failed >= h.last_success)) consider(h.last_failed, h.last_error);
  // (b) percobaan chain yang meninggalkan agent ini (audit lengkap, termasuk chain legacy).
  const chainGagal = chainAbortedSince(a, ops, h.last_success);
  if (chainGagal) consider(chainGagal.tgl, chainGagal.error);
  return { sukses: h.last_success, gagal, gagal_lebih_baru: !!gagal, gagal_error: gagalErr };
}

/* HTML satu baris status run: "Terakhir sukses {tgl}" [+ " · percobaan {tgl}
   dibatalkan/gagal"]. Null-safe; bila belum pernah sukses → "Belum pernah sukses".
   ctx = { t, esc, fmt }. */
export function runHistoryLineHTML(a, ops, ctx) {
  const { t, esc, fmt } = ctx;
  const rs = agentRunStatus(a, ops);
  if (!rs.sukses && !rs.gagal) return '';
  const parts = [];
  parts.push(rs.sukses
    ? esc(t('ops.agen.terakhir_sukses', { tgl: fmt.tanggal(rs.sukses) }))
    : `<span class="warn-text">${esc(t('ops.agen.belum_pernah_sukses'))}</span>`);
  if (rs.gagal_lebih_baru && rs.gagal) {
    const tgl = fmt.tanggal(rs.gagal);
    /* perjelas SEBAB: ada pesan error → tampilkan; null → run dibatalkan (cancelled),
       bukan gagal teknis (arahan owner: kegagalan ber-alasan, bukan label kabur). */
    const msg = rs.gagal_error
      ? t('ops.agen.percobaan_gagal_alasan', { tgl, alasan: String(rs.gagal_error).slice(0, 90) })
      : t('ops.agen.percobaan_dibatalkan', { tgl });
    parts.push(`<span class="warn-text">${esc(msg)}</span>`);
  }
  return parts.join(' · ');
}

/* Status ruang kerja: gabungan cron_state (keandalan run) + last_activity +
   enabled → 'aktif' | 'idle' | 'gagal' | 'macet'.
   - macet: run masih ber-status "dispatched" melebihi batas durasi (cron_state.stuck=true).
            Dibedakan dari 'gagal' (run selesai dengan kegagalan) — macet = hung, belum selesai.
   - gagal: run terakhir failed ATAU ada kegagalan beruntun (>0).
   - aktif: enabled, run terakhir tidak gagal, dan ada aktivitas ≤7 hari.
   - idle:  enabled tapi aktivitas usang / tak ada entri cron (menunggu jadwal),
            atau agent disabled (diam, redup). */
export function agentWorkState(a, ops, now) {
  const c = agentCron(a, ops);
  if (c && c.stuck === true) return 'macet';
  if (c && (c.last_status === 'failed' || (c.consecutive_failures || 0) > 0)) return 'gagal';
  if (!a || !a.enabled) return 'idle';
  const d = a.last_activity && a.last_activity.date;
  if (!d) return 'idle';
  const age = (now - new Date(d + 'T00:00:00Z').getTime()) / 86400000;
  return age <= 7 ? 'aktif' : 'idle';
}

export function agentNext(a, ctx) {
  const { ops, t, fmt, cron } = ctx;
  if (!a) return t('umum.kosong');
  if (a.trigger === 'cron' && a.schedule_cron) {
    const n = cron.nextUTC(a.schedule_cron, new Date());
    return n ? fmt.tanggalWaktu(n.toISOString()) : (a.schedule_human || t('umum.kosong'));
  }
  if (a.trigger === 'chain' && a.chain) {
    const c = (ops.chains || []).find((x) => x.id === a.chain);
    const n = c && c.schedule_cron ? cron.nextUTC(c.schedule_cron, new Date()) : null;
    return `${t('ops.pipeline.step', { n: a.step_index ?? '?' })} · ${a.chain}${n ? ' · ' + fmt.tanggalWaktu(n.toISOString()) : ''}`;
  }
  return a.schedule_human || a.trigger || t('umum.kosong');
}

export function agentInstincts(ops, id) {
  const hit = (ops.instincts || []).find((x) => x.skill === id);
  return hit ? (hit.items || []) : [];
}

/* Status run terakhir → label + kelas badge (dari cron_state.last_status + stuck). */
function runStatusBadge(c, t, esc) {
  if (!c) return '';
  let label;
  let cls;
  if (c.stuck === true) { label = t('ops.agen.status_macet'); cls = 'warn'; }
  else if (c.last_status === 'dispatched') { label = t('ops.agen.status_dispatched'); cls = 'tip'; }
  else if (c.last_status === 'failed') { label = t('ops.agen.status_gagal'); cls = 'warn'; }
  else if (c.last_status === 'success') { label = t('ops.agen.status_sukses'); cls = 'ok'; }
  else return '';
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

export function openAgentDrawer(a, ctx) {
  const { ops, t, esc, fmt, ui, drawer } = ctx;
  const inst = agentInstincts(ops, a.id);
  const cron = agentCron(a, ops);
  const flow = `
    <div class="flow-line">
      ${(a.consumes || []).map((cn) => `<span class="chip mono">${esc(cn)}</span>`).join('')}
      ${(a.consumes || []).length ? '<span aria-hidden="true">→</span>' : ''}
      <span class="badge half">${esc(a.id)}</span>
      ${(a.outputs || []).length ? '<span aria-hidden="true">→</span>' : ''}
      ${(a.outputs || []).map((o) => `<span class="chip mono">${esc(o)}</span>`).join('')}
    </div>`;

  const sec = (label, html) => `<div><div class="meta-rows"><div><span class="k">${esc(label)}</span><span class="v">${html}</span></div></div></div>`;

  /* Keandalan run (dari cron_state) — status terakhir + macet/error + skor QA +
     total run + gagal beruntun. Semua null-safe (tampil hanya yang ada). */
  let cronHealthHTML = '';
  if (cron) {
    const bits = [];
    const sb = runStatusBadge(cron, t, esc);
    if (sb) bits.push(sb);
    if ((cron.consecutive_failures || 0) > 0) {
      bits.push(`<span class="badge warn">${esc(t('ops.kesehatan.gagal_beruntun', { n: fmt.int(cron.consecutive_failures) }))}</span>`);
    }
    const lines = [];
    // Baris riwayat run: "Terakhir sukses … · percobaan … dibatalkan/gagal".
    // Menggabungkan entri skill + chain agar percobaan batal/gagal (sering tercatat
    // di level chain) tidak menyembunyikan diri di balik "sukses" lama.
    const rh = runHistoryLineHTML(a, ops, ctx);
    if (rh) lines.push(`<span class="cap">${rh}</span>`);
    if (cron.stuck === true) {
      const sejak = cron.last_dispatch || cron.last_failed;
      lines.push(`<span class="cap">${esc(t('ops.agen.stuck_macet', { sejak: sejak ? fmt.tanggalWaktu(sejak) : '—' }))}</span>`);
    }
    if (typeof cron.last_quality_score === 'number') {
      lines.push(`<span class="cap">${esc(t('ops.agen.skor_qa_terakhir', { n: fmt.int(cron.last_quality_score) }))}</span>`);
    }
    if (typeof cron.total_runs === 'number') {
      lines.push(`<span class="cap">${esc(t('ops.agen.total_run', { n: fmt.int(cron.total_runs) }))}</span>`);
    }
    if (cron.last_error) {
      lines.push(`<span class="cap mono">${esc(t('ops.agen.stuck_error', { err: String(cron.last_error).slice(0, 160) }))}</span>`);
    }
    if (bits.length || lines.length) {
      cronHealthHTML = sec(
        t('ops.kesehatan.cron_judul'),
        `<span style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px">${bits.join('')}</span>${lines.join('<br>')}`,
      );
    }
  }

  drawer.open({
    title: `${esc(a.nama || a.id)} <span class="opp-id" style="display:block;margin-top:2px">${esc(a.id)}</span>`,
    body: `
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <span class="chip mono">${esc(a.model || a.model_short || '')}</span>
        <span class="chip">${esc(t('ops.agen.trigger'))}: ${esc(a.trigger || '')}</span>
        <span class="badge ${a.enabled ? 'ok' : 'warn'}">${a.enabled ? '● ' + esc(t('ops.agen.enabled')) : '✕ ' + esc(t('ops.agen.disabled'))}</span>
      </div>
      ${sec(t('ops.agen.peran', null, 'Peran'), esc(a.peran || t('umum.kosong')))}
      ${sec(t('ops.pipeline.jadwal'), `${esc(a.schedule_human || t('umum.kosong'))}${a.schedule_cron ? ` <span class="ref-chip">${esc(a.schedule_cron)}</span>` : ''}<br><span class="cap">${esc(t('ops.agen.berikutnya'))}: ${esc(agentNext(a, ctx))}</span>`)}
      ${cronHealthHTML}
      ${sec(t('ops.agen.dod', null, 'Definition of done'), esc(a.dod || t('umum.kosong')))}
      ${sec(t('ops.agen.alur_data', null, 'Alur data'), flow)}
      ${sec(t('ops.agen.aktivitas_terakhir'), a.last_activity
    ? `${esc(a.last_activity.summary)} <span class="cap">(${esc(fmt.tanggal(a.last_activity.date))})</span>`
    : esc(t('ops.agen.belum_ada_aktivitas')))}
      <div class="kv-grid">
        <div class="kv"><span class="kv-v">${esc(fmt.int(a.tokens_avg))}</span><span class="kv-k">${esc(t('ops.agen.token_per_run', { n: '' }).replace('≈', '').trim() || 'token/run')}</span></div>
        <div class="kv"><span class="kv-v">${esc(fmt.int(a.instinct_count || 0))}</span><span class="kv-k">${esc(t('ops.kesehatan.instinct_judul'))}</span></div>
      </div>
      ${inst.length ? `<div>
        <div class="eyebrow" style="margin-bottom:6px">${esc(t('ops.kesehatan.instinct_judul'))}</div>
        ${inst.map((it) => `
        <div class="instinct-item">
          <span class="ref-chip">${esc(it.id)}</span>
          <p style="margin:4px 0 0">${esc(it.lesson)}</p>
          <div class="conf-bar" title="confidence ${Math.round((it.confidence || 0) * 100)}%"><span style="width:${Math.round((it.confidence || 0) * 100)}%"></span></div>
        </div>`).join('')}
      </div>` : ''}
    `,
  });
}

/* Status ruang kerja → properti tampilan (simbol + warna + teks, WCAG §7.2). */
function workMeta(state, t) {
  if (state === 'macet') return { sym: '!', cls: 'macet', label: t('ops.agen.viz.status.macet') };
  if (state === 'gagal') return { sym: '✕', cls: 'gagal', label: t('ops.agen.viz.status.gagal') };
  if (state === 'aktif') return { sym: '●', cls: 'aktif', label: t('ops.agen.viz.status.aktif') };
  return { sym: '◌', cls: 'idle', label: t('ops.agen.viz.status.idle') };
}

/* Satu pos kerja pixel: meja + karakter + nameplate. Tombol aksesibel:
   aria-label "{nama} — {status}", klik/keyboard → drawer jobdesk. */
function deskHTML(a, i, ops, now, ctx) {
  const { t, esc } = ctx;
  const ws = agentWorkState(a, ops, now);
  const m = workMeta(ws, t);
  const nama = a.nama || a.id;
  const role = (a.peran || '').split(/[—·:.;]/)[0].trim().slice(0, 38) || (a.trigger || '');
  return `
    <button class="px-desk-cell px-${m.cls}" data-agent="${i}"
            aria-label="${esc(nama)} — ${esc(m.label)}">
      <span class="px-stage">${spriteSVG(a.id, ws)}</span>
      <span class="px-plate">
        <span class="px-name"><span class="px-dot" aria-hidden="true"></span>${esc(nama)}</span>
        <span class="px-role">${esc(role)}</span>
      </span>
    </button>`;
}

/* Banner agen bermasalah (macet + gagal). Dirakit dari cron_state — bukan tebakan.
   Macet: stuck=true + sejak last_dispatch/last_failed. Gagal: consecutive_failures
   + last_error + sejak last_failed. */
function troubleBannerHTML(agents, ops, now, ctx) {
  const { t, esc, fmt } = ctx;
  const rows = [];
  for (const a of agents) {
    const st = agentWorkState(a, ops, now);
    if (st !== 'macet' && st !== 'gagal') continue;
    const c = agentCron(a, ops) || {};
    const nama = a.nama || a.id;
    if (st === 'macet') {
      const sejak = c.last_dispatch || c.last_failed;
      rows.push(`<li class="trouble-row macet"><span class="badge warn is-critical">! ${esc(t('ops.agen.status_macet'))}</span>
        <b>${esc(nama)}</b> — ${esc(t('ops.agen.stuck_macet', { sejak: sejak ? fmt.tanggalWaktu(sejak) : '—' }))}</li>`);
    } else {
      const n = c.consecutive_failures || 0;
      const sejak = c.last_failed;
      const err = c.last_error;
      rows.push(`<li class="trouble-row gagal"><span class="badge warn">✕ ${esc(t('ops.agen.status_gagal'))}</span>
        <b>${esc(nama)}</b> — ${esc(n > 0 ? t('ops.agen.stuck_gagal', { n: fmt.int(n) }) : t('ops.agen.viz.status.gagal'))}${sejak ? ` · ${esc(t('ops.agen.stuck_sejak', { sejak: fmt.tanggal(sejak) }))}` : ''}${err ? `<br><span class="cap mono">${esc(t('ops.agen.stuck_error', { err: String(err).slice(0, 140) }))}</span>` : ''}</li>`);
    }
  }
  if (!rows.length) return '';
  return `<div class="callout warn trouble-banner" role="status" style="margin-bottom:14px">
    <div class="co-title">! ${esc(t('ops.agen.stuck_judul', { n: fmt.int(rows.length) }))}</div>
    <ul class="trouble-list" style="margin:6px 0 0;padding:0;list-style:none;display:grid;gap:6px">${rows.join('')}</ul>
  </div>`;
}

/* Garis status otonomi — fakta runtime statis dari ops.autonomy (selalu tampil). */
function autonomyLineHTML(ops, ctx) {
  const { t, esc } = ctx;
  const au = ops.autonomy || null;
  const teks = (au && au.teks) || t('ops.agen.autonomy');
  return `<p class="autonomy-line cap" role="note" style="display:flex;align-items:center;gap:8px;margin:0 0 14px">
    <span class="dot dot-ok" aria-hidden="true"></span>
    <span>${esc(teks)}</span>
  </p>`;
}

/* Kartu ringkasan admin (5-detik): kalimat status agen + sebaran aktif/menunggu/
   perlu-perhatian. Plain language — tanpa jargon. */
function summaryCardHTML(counts, total, ctx) {
  const { t, esc, fmt } = ctx;
  const trouble = counts.gagal + counts.macet;
  const ok = trouble === 0;
  const line = ok
    ? t('ops.agen.ringkasan_aman', { aktif: fmt.int(counts.aktif) })
    : t('ops.agen.ringkasan_kendala', { n: fmt.int(trouble), total: fmt.int(total) });
  const pills = [
    `<span class="badge ok">● ${esc(t('ops.agen.viz.status.aktif'))} ${esc(fmt.int(counts.aktif))}</span>`,
    `<span class="badge plain">◌ ${esc(t('ops.agen.viz.status.idle'))} ${esc(fmt.int(counts.idle))}</span>`,
  ];
  if (counts.gagal) pills.push(`<span class="badge warn">✕ ${esc(t('ops.agen.viz.status.gagal'))} ${esc(fmt.int(counts.gagal))}</span>`);
  if (counts.macet) pills.push(`<span class="badge warn is-critical">! ${esc(t('ops.agen.viz.status.macet'))} ${esc(fmt.int(counts.macet))}</span>`);
  return `<article class="card status-card ${ok ? 'all-ok' : 'has-trouble'}" style="margin-bottom:14px">
    <div class="status-head">
      <span class="status-dot ${ok ? 'dot-ok' : 'dot-warn'}" aria-hidden="true"></span>
      <div class="eyebrow">${esc(t('ops.agen.ringkasan_judul'))}</div>
    </div>
    <p class="status-line">${esc(line)}</p>
    <div class="status-pills">${pills.join('')}</div>
  </article>`;
}

export function render(el, ctx) {
  const { ops, t, esc, fmt, ui } = ctx;
  const agents = ops.agents || [];
  const now = Date.now();

  /* mode tersimpan antar kunjungan (ruang kerja default). */
  let mode = 'workspace';
  try { const s = localStorage.getItem('pimas.agen.mode'); if (s === 'list' || s === 'workspace') mode = s; } catch { /* abaikan */ }

  const counts = { aktif: 0, idle: 0, gagal: 0, macet: 0 };
  agents.forEach((a) => { counts[agentWorkState(a, ops, now)]++; });

  const troubleHTML = troubleBannerHTML(agents, ops, now, ctx);
  const autonomyHTML = autonomyLineHTML(ops, ctx);
  const summaryHTML = agents.length ? summaryCardHTML(counts, agents.length, ctx) : '';

  const listHTML = `
  <div class="agent-grid" id="agent-grid">
    ${agents.map((a, i) => {
    const st = agentStatus(a, now);
    return `
    <button class="card agent-card" data-agent="${i}">
      <div class="agent-head">
        <span class="dot dot-${st}" aria-hidden="true"></span>
        <h3>${esc(a.nama || a.id)}</h3>
        <span class="chip mono">${esc(a.model_short || '')}</span>
      </div>
      <p class="agent-role">${esc(a.peran || '')}</p>
      <div class="meta-rows">
        <div><span class="k">${esc(t('ops.agen.trigger'))}</span>
          <span class="v"><span class="chip">${esc(a.trigger || '')}</span> ${esc(a.schedule_human || '')}</span></div>
        <div><span class="k">${esc(t('ops.agen.aktivitas_terakhir'))}</span>
          <span class="v">${a.last_activity ? esc(a.last_activity.summary).slice(0, 220) + ` <span class="cap">(${esc(fmt.tanggal(a.last_activity.date))})</span>` : esc(t('ops.agen.belum_ada_aktivitas'))}</span></div>
        ${(() => { const rh = runHistoryLineHTML(a, ops, ctx); return rh ? `<div><span class="k">${esc(t('ops.agen.status_terakhir'))}</span><span class="v cap">${rh}</span></div>` : ''; })()}
      </div>
      <div class="agent-foot">
        <span class="chip mono">${esc(t('ops.agen.token_per_run', { n: fmt.int(a.tokens_avg) }))}</span>
        <span class="chip">${esc(t('ops.agen.instinct', { n: fmt.int(a.instinct_count || 0) }))}</span>
        <span class="badge ${a.enabled ? 'ok' : 'warn'}">${a.enabled ? '●' : '✕'} ${esc(a.enabled ? t('ops.agen.enabled') : t('ops.agen.disabled'))}</span>
      </div>
    </button>`;
  }).join('')}
  </div>
  <p class="cap" style="margin-top:14px;display:flex;gap:16px;flex-wrap:wrap">
    <span><span class="dot dot-ok" aria-hidden="true"></span> ${esc(t('ops.agen.legend.ok'))}</span>
    <span><span class="dot dot-warn" aria-hidden="true"></span> ${esc(t('ops.agen.legend.warn'))}</span>
    <span><span class="dot dot-err" aria-hidden="true"></span> ${esc(t('ops.agen.legend.err'))}</span>
  </p>`;

  const workspaceHTML = `
  <section class="px-office" aria-label="${esc(t('ops.agen.viz.judul'))}">
    <div class="px-floor">
      ${agents.map((a, i) => deskHTML(a, i, ops, now, ctx)).join('')}
    </div>
  </section>
  <p class="cap px-legend">
    <span><span class="px-dot px-leg-aktif" aria-hidden="true"></span> ${esc(t('ops.agen.viz.status.aktif'))} <span class="num">${esc(fmt.int(counts.aktif))}</span></span>
    <span><span class="px-dot px-leg-idle" aria-hidden="true"></span> ${esc(t('ops.agen.viz.status.idle'))} <span class="num">${esc(fmt.int(counts.idle))}</span></span>
    <span><span class="px-dot px-leg-gagal" aria-hidden="true"></span> ${esc(t('ops.agen.viz.status.gagal'))} <span class="num">${esc(fmt.int(counts.gagal))}</span></span>
    ${counts.macet ? `<span><span class="px-dot px-leg-macet" aria-hidden="true"></span> ${esc(t('ops.agen.viz.status.macet'))} <span class="num">${esc(fmt.int(counts.macet))}</span></span>` : ''}
  </p>`;

  el.innerHTML = `
  <header class="pagehead">
    <div>
      <div class="eyebrow">${esc(t('nav.ops.label'))}</div>
      <h1 class="display-l">${esc(t('ops.agen.judul'))} <span class="num" style="font-size:16px;color:var(--text-3)">${esc(fmt.int(agents.length))}</span></h1>
      <p class="sub">${esc(t('nav.ops.agen.deskripsi'))}</p>
    </div>
    ${agents.length ? `
    <div class="seg" role="tablist" aria-label="${esc(t('ops.agen.viz.judul'))}">
      <button id="mode-workspace" role="tab" data-mode="workspace" aria-selected="${mode === 'workspace'}" class="${mode === 'workspace' ? 'active' : ''}">${esc(t('ops.agen.viz.judul'))}</button>
      <button id="mode-list" role="tab" data-mode="list" aria-selected="${mode === 'list'}" class="${mode === 'list' ? 'active' : ''}">${esc(t('ops.agen.viz.lihat_detail'))}</button>
    </div>` : ''}
  </header>

  ${autonomyHTML}
  ${summaryHTML}
  ${troubleHTML}

  ${agents.length ? `
  <p class="px-caption cap" ${mode === 'list' ? 'hidden' : ''} id="px-caption">${esc(t('ops.agen.viz.keterangan'))}</p>
  <div id="agen-body">${mode === 'workspace' ? workspaceHTML : listHTML}</div>`
    : `<div class="card">${ui.empty('empty.ops.agen')}</div>`}`;

  const body = el.querySelector('#agen-body');
  const caption = el.querySelector('#px-caption');

  function bindCells() {
    body.querySelectorAll('[data-agent]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = agents[parseInt(btn.getAttribute('data-agent'), 10)];
        if (a) openAgentDrawer(a, ctx);
      });
    });
  }

  function setMode(next) {
    mode = next;
    try { localStorage.setItem('pimas.agen.mode', next); } catch { /* abaikan */ }
    el.querySelectorAll('.seg [data-mode]').forEach((b) => {
      const on = b.getAttribute('data-mode') === next;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    if (caption) caption.toggleAttribute('hidden', next !== 'workspace');
    body.innerHTML = next === 'workspace' ? workspaceHTML : listHTML;
    bindCells();
  }

  el.querySelectorAll('.seg [data-mode]').forEach((b) => {
    b.addEventListener('click', () => setMode(b.getAttribute('data-mode')));
  });
  if (body) bindCells();

  return undefined;
}
