/*
 * PIMAS dashboard — app.js
 * Alpine app tunggal `pimasApp()` (SPEC §7): state, hash routing, 6 view,
 * countdown cron client-side (WIB), chart lifecycle (destroy saat ganti view),
 * animasi counter anime.js v3, render markdown marked+DOMPurify.
 * Tidak ada data riset hardcoded — semua dari objek hasil dekripsi data.enc.json.
 */
'use strict';

/* ================= util: cron (UTC) ================= */

function cronFieldSet(spec, min, max) {
  var out = new Set();
  var parts = String(spec).split(',');
  for (var p = 0; p < parts.length; p++) {
    var part = parts[p].trim();
    var m;
    if (part === '*') {
      for (var i = min; i <= max; i++) out.add(i);
    } else if ((m = part.match(/^\*\/(\d+)$/))) {
      var st = parseInt(m[1], 10) || 1;
      for (var j = min; j <= max; j += st) out.add(j);
    } else if ((m = part.match(/^(\d+)-(\d+)(?:\/(\d+))?$/))) {
      var st2 = parseInt(m[3] || '1', 10) || 1;
      for (var k = parseInt(m[1], 10); k <= parseInt(m[2], 10); k += st2) {
        if (k >= min && k <= max) out.add(k);
      }
    } else if ((m = part.match(/^(\d+)$/))) {
      var v = parseInt(m[1], 10);
      if (v >= min && v <= max) out.add(v);
    }
  }
  return out;
}

/* Kejadian berikutnya dari ekspresi cron 5-field (semantik UTC, standar GitHub Actions). */
function cronNextUTC(expr, from) {
  if (!expr) return null;
  var f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) return null;
  var mins = cronFieldSet(f[0], 0, 59);
  var hrs = cronFieldSet(f[1], 0, 23);
  var doms = cronFieldSet(f[2], 1, 31);
  var mons = cronFieldSet(f[3], 1, 12);
  var dowsRaw = cronFieldSet(f[4], 0, 7);
  var dows = new Set();
  dowsRaw.forEach(function (d) { dows.add(d === 7 ? 0 : d); });
  if (!mins.size || !hrs.size || !doms.size || !mons.size || !dows.size) return null;
  var domAny = f[2] === '*';
  var dowAny = f[4] === '*';

  var t = new Date(Math.floor(from.getTime() / 60000) * 60000 + 60000);
  // batas pencarian ~2 tahun; loop melompat per bulan/hari/jam sehingga cepat
  for (var guard = 0; guard < 200000; guard++) {
    if (!mons.has(t.getUTCMonth() + 1)) {
      t = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1));
      continue;
    }
    var dayOk;
    if (domAny && dowAny) dayOk = true;
    else if (domAny) dayOk = dows.has(t.getUTCDay());
    else if (dowAny) dayOk = doms.has(t.getUTCDate());
    else dayOk = doms.has(t.getUTCDate()) || dows.has(t.getUTCDay()); // semantik OR cron standar
    if (!dayOk) {
      t = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1));
      continue;
    }
    if (!hrs.has(t.getUTCHours())) {
      t = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), t.getUTCHours() + 1));
      continue;
    }
    if (!mins.has(t.getUTCMinutes())) {
      t = new Date(t.getTime() + 60000);
      continue;
    }
    return t;
  }
  return null;
}

/* ================= util: format ================= */

function fmtNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return new Intl.NumberFormat('id-ID').format(n);
}

function fmtWIB(d) {
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(d).replace(/\./g, ':') + ' WIB';
  } catch (e) {
    return d.toISOString();
  }
}

function fmtTanggal(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric'
    }).format(new Date(String(iso).length <= 10 ? iso + 'T00:00:00Z' : iso));
  } catch (e) {
    return String(iso);
  }
}

function fmtCountdown(ms) {
  if (ms === null || ms === undefined || isNaN(ms)) return '—';
  if (ms <= 0) return 'sedang berjalan…';
  var s = Math.floor(ms / 1000);
  var d = Math.floor(s / 86400);
  var h = Math.floor((s % 86400) / 3600);
  var m = Math.floor((s % 3600) / 60);
  var sec = s % 60;
  var p = function (n) { return String(n).padStart(2, '0'); };
  return (d > 0 ? d + ' hari ' : '') + p(h) + ':' + p(m) + ':' + p(sec);
}

function hexA(hex, a) {
  var m = String(hex).trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return hex;
  var n = parseInt(m[1], 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

/* ================= chart registry (non-reaktif, di luar Alpine) ================= */

var _pimasCharts = {};
function destroyAllCharts() {
  Object.keys(_pimasCharts).forEach(function (k) {
    try { _pimasCharts[k].destroy(); } catch (e) { /* canvas sudah hilang */ }
    delete _pimasCharts[k];
  });
}

/* ================= komponen Alpine ================= */

function pimasApp() {
  return {
    /* ---- state inti ---- */
    stage: 'boot',            // boot | login | app
    data: null,               // hasil dekripsi data.enc.json — hanya di memori
    theme: 'light',
    view: 'overview',
    viewIds: ['overview', 'agents', 'pipeline', 'reports', 'ops', 'feedback'],

    /* ---- login ---- */
    loginId: '',
    loginPass: '',
    remember: false,
    busy: false,
    loginError: '',
    shake: false,

    /* ---- jam & jadwal ---- */
    now: Date.now(),
    nextRuns: [],

    /* ---- agents ---- */
    selectedAgent: null,
    panelOpen: false,

    /* ---- pipeline: tabel kandidat ---- */
    chainSel: 0,
    q: '',
    statusFilter: 'semua',
    sortKey: 'skor',
    sortDir: -1,
    expandId: null,

    /* ---- reports ---- */
    reportTab: 'dossiers',
    reportOpen: null,

    /* ---- ops & feedback ---- */
    openInstinct: null,
    copied: '',

    /* ============ lifecycle ============ */

    async init() {
      this.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
      var self = this;
      setInterval(function () {
        self.now = Date.now();
        self.refreshDue();
      }, 1000);
      window.addEventListener('hashchange', function () { self.onHash(); });

      // auto-login dari sessionStorage ("ingat sesi ini")
      var saved = null;
      try { saved = JSON.parse(sessionStorage.getItem('pimas.session') || 'null'); } catch (e) { saved = null; }
      if (saved && saved.id) {
        this.loginId = saved.id;
        this.loginPass = saved.pw || '';
        this.remember = true;
        await this.login(true);
      }
      if (this.stage !== 'app') this.stage = 'login';
    },

    async fetchEnc() {
      // produksi: data.enc.json di root repo Pages; dev lokal: dist/data.enc.json
      var urls = ['data.enc.json', 'dist/data.enc.json'];
      for (var i = 0; i < urls.length; i++) {
        try {
          var r = await fetch(urls[i], { cache: 'no-store' });
          if (r.ok) return await r.json();
        } catch (e) { /* coba kandidat URL berikutnya */ }
      }
      var err = new Error('NO_DATA');
      err.code = 'NO_DATA';
      throw err;
    },

    async login(silent) {
      if (this.busy) return;
      this.busy = true;
      this.loginError = '';
      try {
        var enc = await this.fetchEnc();
        // pimasDecrypt: PBKDF2 600k iterasi — sengaja lambat (~1 dtk), spinner aktif selama ini
        var obj = await window.pimasDecrypt(enc, this.loginId, this.loginPass);
        this.data = obj;
        if (this.remember) {
          try {
            sessionStorage.setItem('pimas.session',
              JSON.stringify({ id: this.loginId, pw: this.loginPass }));
          } catch (e) { /* storage penuh/diblok — abaikan */ }
        }
        this.enterApp();
      } catch (e) {
        try { sessionStorage.removeItem('pimas.session'); } catch (e2) { /* abaikan */ }
        if (!silent) {
          this.loginError = (e && e.code === 'NO_DATA')
            ? 'data.enc.json tidak ditemukan di server.'
            : 'ID atau password salah — dekripsi gagal.';
          this.shake = true;
          var self = this;
          setTimeout(function () { self.shake = false; }, 600);
        }
      } finally {
        this.busy = false;
      }
    },

    enterApp() {
      this.stage = 'app';
      this.buildSchedule();
      var v = (location.hash || '').replace(/^#\//, '');
      this.view = this.viewIds.indexOf(v) >= 0 ? v : 'overview';
      if (location.hash !== '#/' + this.view) location.hash = '#/' + this.view;
      var self = this;
      this.$nextTick(function () { self.viewEntered(); });
    },

    logout() {
      try { sessionStorage.removeItem('pimas.session'); } catch (e) { /* abaikan */ }
      location.reload();
    },

    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = this.theme;
      try { localStorage.setItem('pimas.theme', this.theme); } catch (e) { /* abaikan */ }
      var self = this;
      this.$nextTick(function () { self.initCharts(); }); // warna chart ikut tema
    },

    /* ============ routing ============ */

    onHash() {
      if (this.stage !== 'app') return;
      var v = (location.hash || '').replace(/^#\//, '');
      if (this.viewIds.indexOf(v) >= 0 && v !== this.view) this.go(v, true);
    },

    go(v, fromHash) {
      destroyAllCharts();
      this.reportOpen = null;
      this.panelOpen = false;
      this.view = v;
      if (!fromHash) location.hash = '#/' + v;
      var self = this;
      this.$nextTick(function () { self.viewEntered(); });
    },

    viewEntered() {
      this.animateCounters();
      this.initCharts();
    },

    /* ============ animasi counter (anime.js v3) ============ */

    animateCounters() {
      var els = document.querySelectorAll('[data-count]');
      els.forEach(function (el) {
        var target = parseFloat(el.getAttribute('data-count')) || 0;
        if (!window.anime) { el.textContent = fmtNum(target); return; }
        var o = { v: 0 };
        window.anime({
          targets: o,
          v: target,
          duration: 950,
          easing: 'easeOutCubic',
          update: function () { el.textContent = fmtNum(Math.round(o.v)); }
        });
      });
    },

    /* ============ charts (destroy saat ganti view — hindari canvas reuse) ============ */

    initCharts() {
      destroyAllCharts();
      if (!window.Chart || !this.data) return;
      var cs = getComputedStyle(document.documentElement);
      var tok = function (n) { return cs.getPropertyValue(n).trim(); };
      window.Chart.defaults.font.family = tok('--font') ||
        "'Inter',-apple-system,BlinkMacSystemFont,sans-serif";
      window.Chart.defaults.font.size = 12;
      window.Chart.defaults.color = tok('--text-muted') || '#6e6e73';

      if (this.view === 'pipeline') {
        var el = document.getElementById('chartFunnel');
        if (el) {
          var rows = this.funnelRows;
          _pimasCharts.funnel = new window.Chart(el, {
            type: 'bar',
            data: {
              labels: rows.map(function (r) { return r.label; }),
              datasets: [{
                data: rows.map(function (r) { return r.value; }),
                backgroundColor: rows.map(function (_, i) {
                  return hexA(tok('--accent'), 0.35 + 0.65 * ((i + 1) / Math.max(rows.length, 1)));
                }),
                borderRadius: 7,
                barThickness: 18
              }]
            },
            options: {
              indexAxis: 'y',
              responsive: true,
              maintainAspectRatio: false,
              animation: { duration: 650, easing: 'easeOutCubic' },
              plugins: { legend: { display: false } },
              scales: {
                x: {
                  grid: { color: tok('--hairline') },
                  border: { display: false },
                  ticks: { precision: 0 }
                },
                y: { grid: { display: false }, border: { display: false } }
              }
            }
          });
        }
      }

      if (this.view === 'ops') {
        var el2 = document.getElementById('chartBudget');
        var data2 = this.tokensPerSkill;
        if (el2 && data2.length) {
          _pimasCharts.budget = new window.Chart(el2, {
            type: 'bar',
            data: {
              labels: data2.map(function (r) { return r.skill; }),
              datasets: [{
                data: data2.map(function (r) { return r.tokens; }),
                backgroundColor: hexA(tok('--accent'), 0.78),
                borderRadius: 7,
                barThickness: 16
              }]
            },
            options: {
              indexAxis: 'y',
              responsive: true,
              maintainAspectRatio: false,
              animation: { duration: 650, easing: 'easeOutCubic' },
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: function (c) { return fmtNum(c.parsed.x) + ' token'; }
                  }
                }
              },
              scales: {
                x: {
                  grid: { color: tok('--hairline') },
                  border: { display: false },
                  ticks: { callback: function (v) { return fmtNum(v); } }
                },
                y: { grid: { display: false }, border: { display: false } }
              }
            }
          });
        }
      }
    },

    /* ============ jadwal & countdown ============ */

    buildSchedule() {
      if (!this.data) { this.nextRuns = []; return; }
      var items = [];
      (this.data.chains || []).forEach(function (c) {
        if (c.schedule_cron) {
          items.push({ key: 'chain:' + c.id, label: 'Chain ' + c.id, cron: c.schedule_cron, human: c.schedule_human || '' });
        }
      });
      (this.data.agents || []).forEach(function (a) {
        if (a.trigger === 'cron' && a.schedule_cron) {
          items.push({ key: 'agent:' + a.id, label: a.nama || a.id, cron: a.schedule_cron, human: a.schedule_human || '' });
        }
      });
      var nowD = new Date();
      this.nextRuns = items.map(function (it) {
        var n = cronNextUTC(it.cron, nowD);
        return {
          key: it.key, label: it.label, cron: it.cron, human: it.human,
          next: n ? n.getTime() : null,
          nextHuman: n ? fmtWIB(n) : '—'
        };
      }).filter(function (it) { return it.next !== null; })
        .sort(function (a, b) { return a.next - b.next; });
    },

    refreshDue() {
      // jika satu jadwal sudah lewat >5 dtk, hitung ulang kejadian berikutnya
      for (var i = 0; i < this.nextRuns.length; i++) {
        if (this.nextRuns[i].next - this.now < -5000) { this.buildSchedule(); return; }
      }
    },

    countdown(ts) { return fmtCountdown(ts === null || ts === undefined ? null : ts - this.now); },

    nextRunByKey(key) {
      for (var i = 0; i < this.nextRuns.length; i++) {
        if (this.nextRuns[i].key === key) return this.nextRuns[i];
      }
      return null;
    },

    /* ============ header ============ */

    get stampText() {
      if (!this.data) return '';
      var d = this.data.generated_at ? new Date(this.data.generated_at) : null;
      return 'data per ' + (d ? fmtWIB(d) : '—') +
        ' · commit ' + (this.data.source_commit || '—');
    },

    /* ============ overview ============ */

    get funnelRows() {
      var by = (this.data && this.data.funnel && this.data.funnel.by_status) || {};
      var order = ['raw', 'shortlist', 'parked', 'rejected', 'reported'];
      var keys = order.filter(function (k) { return k in by; });
      Object.keys(by).forEach(function (k) { if (order.indexOf(k) < 0) keys.push(k); });
      var self = this;
      return keys.map(function (k) {
        return { key: k, label: self.statusLabel(k), value: by[k] || 0 };
      });
    },

    get activityFeed() {
      var act = (this.data && this.data.activity) || [];
      return act.slice().sort(function (a, b) {
        return String(b.date).localeCompare(String(a.date));
      }).slice(0, 7);
    },

    statusLabel(s) {
      var map = {
        semua: 'Semua status', raw: 'Raw (masuk)', shortlist: 'Shortlist',
        parked: 'Diparkir', rejected: 'Ditolak', reported: 'Dilaporkan'
      };
      return map[s] || s;
    },

    statusBadgeClass(s) {
      var map = {
        reported: 'badge-ok', shortlist: 'badge-accent', raw: 'badge-muted',
        parked: 'badge-warn', rejected: 'badge-err'
      };
      return map[s] || 'badge-muted';
    },

    /* ============ agents ============ */

    agentStatus(a) {
      if (!a || !a.enabled) return 'err';
      var d = a.last_activity && a.last_activity.date;
      if (!d) return 'warn';
      var age = (this.now - new Date(d + 'T00:00:00Z').getTime()) / 86400000;
      return age <= 7 ? 'ok' : 'warn';
    },

    agentStatusLabel(a) {
      var s = this.agentStatus(a);
      if (s === 'ok') return 'Aktif';
      if (s === 'warn') return a.enabled ? 'Aktif (idle)' : 'Nonaktif';
      return 'Nonaktif';
    },

    agentById(id) {
      var ag = (this.data && this.data.agents) || [];
      for (var i = 0; i < ag.length; i++) if (ag[i].id === id) return ag[i];
      return null;
    },

    nodeName(id) {
      var a = this.agentById(id);
      return a ? (a.nama || a.id) : id;
    },

    agentNext(a) {
      if (!a) return '—';
      if (a.trigger === 'cron' && a.schedule_cron) {
        var n = cronNextUTC(a.schedule_cron, new Date());
        return n ? fmtWIB(n) : (a.schedule_human || '—');
      }
      if (a.trigger === 'chain' && a.chain) {
        var c = ((this.data && this.data.chains) || []).find(function (x) { return x.id === a.chain; });
        var n2 = (c && c.schedule_cron) ? cronNextUTC(c.schedule_cron, new Date()) : null;
        return 'Step ' + (a.step_index !== null && a.step_index !== undefined ? a.step_index : '?') +
          ' · ' + a.chain + (n2 ? ' · ' + fmtWIB(n2) : '');
      }
      if (a.trigger === 'reactive') return 'Reaktif — jalan saat dipicu event';
      if (a.trigger === 'message') return 'On-demand — dipicu pesan Telegram';
      return a.schedule_human || '—';
    },

    agentInstincts(id) {
      var list = (this.data && this.data.instincts) || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].skill === id) return list[i].items || [];
      }
      return [];
    },

    openAgent(a) {
      this.selectedAgent = a;
      this.panelOpen = true;
    },

    closePanel() { this.panelOpen = false; },

    gotoAgent(a) {
      var self = this;
      this.go('agents');
      this.$nextTick(function () { self.openAgent(a); });
    },

    /* ============ pipeline ============ */

    get currentChain() {
      var ch = (this.data && this.data.chains) || [];
      return ch[this.chainSel] || ch[0] || null;
    },

    get chainNextItem() {
      return this.currentChain ? this.nextRunByKey('chain:' + this.currentChain.id) : null;
    },

    nodeClick(id) {
      var a = this.agentById(id);
      if (a) this.gotoAgent(a);
    },

    get candidateStatuses() {
      var seen = ['semua'];
      ((this.data && this.data.candidates) || []).forEach(function (c) {
        if (c.status && seen.indexOf(c.status) < 0) seen.push(c.status);
      });
      return seen;
    },

    get filteredCandidates() {
      var rows = ((this.data && this.data.candidates) || []).slice();
      var q = this.q.trim().toLowerCase();
      if (q) {
        rows = rows.filter(function (c) {
          return [c.id, c.nama, c.brand, c.kategori, c.negara_asal]
            .map(function (x) { return String(x || ''); })
            .join(' ').toLowerCase().indexOf(q) >= 0;
        });
      }
      var sf = this.statusFilter;
      if (sf !== 'semua') rows = rows.filter(function (c) { return c.status === sf; });
      var k = this.sortKey;
      var dir = this.sortDir;
      rows.sort(function (a, b) {
        var av = a[k], bv = b[k], cmp;
        if (typeof av === 'number' || typeof bv === 'number') {
          var an = (av === null || av === undefined) ? -Infinity : av;
          var bn = (bv === null || bv === undefined) ? -Infinity : bv;
          cmp = an < bn ? -1 : an > bn ? 1 : 0;
        } else {
          cmp = String(av || '').localeCompare(String(bv || ''));
        }
        if (cmp === 0) cmp = String(a.id || '').localeCompare(String(b.id || ''));
        return cmp * dir;
      });
      return rows;
    },

    setSort(k) {
      if (this.sortKey === k) this.sortDir *= -1;
      else { this.sortKey = k; this.sortDir = -1; }
    },

    sortArrow(k) {
      if (this.sortKey !== k) return '';
      return this.sortDir === 1 ? '↑' : '↓';
    },

    toggleExpand(id) { this.expandId = this.expandId === id ? null : id; },

    /* ============ reports ============ */

    get reportCounts() {
      var r = (this.data && this.data.reports) || {};
      return {
        dossiers: (r.dossiers || []).length,
        briefs: (r.briefs || []).length,
        digests: (r.digests || []).length
      };
    },

    reportList(kind) {
      var r = (this.data && this.data.reports) || {};
      return r[kind] || [];
    },

    openMd(kind, item) {
      var md = (item && item.md) || '';
      var html = '';
      if (window.marked && window.DOMPurify) {
        html = window.DOMPurify.sanitize(window.marked.parse(md));
      }
      this.reportOpen = {
        kind: kind,
        id: item.id || item.week || '',
        title: item.title || item.week || item.id || 'Dokumen',
        html: html
      };
      this.$nextTick(function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    },

    /* ============ ops ============ */

    get budgetRatio() {
      var b = this.data && this.data.budget;
      if (!b || !b.threshold_weekly) return 0;
      return (b.last_cycle_total || 0) / b.threshold_weekly;
    },

    get budgetBadge() {
      var r = this.budgetRatio;
      return r < 0.7 ? 'GREEN' : (r <= 0.9 ? 'AMBER' : 'RED');
    },

    get budgetBadgeClass() {
      var b = this.budgetBadge;
      return b === 'GREEN' ? 'badge-ok' : (b === 'AMBER' ? 'badge-warn' : 'badge-err');
    },

    get budgetBarColor() {
      var b = this.budgetBadge;
      return b === 'GREEN' ? 'var(--ok)' : (b === 'AMBER' ? 'var(--warn)' : 'var(--err)');
    },

    get tokensPerSkill() {
      var m = {};
      (((this.data || {}).budget || {}).runs || []).forEach(function (r) {
        if (!r || !r.skill) return;
        m[r.skill] = (m[r.skill] || 0) + (r.tokens || 0);
      });
      return Object.keys(m).map(function (skill) { return { skill: skill, tokens: m[skill] }; })
        .sort(function (a, b) { return b.tokens - a.tokens; });
    },

    get qaBounceRows() {
      var q = ((this.data || {}).qa || {}).bounce || {};
      return Object.keys(q).map(function (id) { return { id: id, n: q[id] }; });
    },

    severityBadgeClass(sev) {
      var map = { critical: 'badge-err', high: 'badge-err', medium: 'badge-warn', low: 'badge-muted' };
      return map[String(sev || '').toLowerCase()] || 'badge-muted';
    },

    toggleInstinct(skill) {
      this.openInstinct = this.openInstinct === skill ? null : skill;
    },

    /* ============ feedback ============ */

    queueItemText(item) {
      if (item === null || item === undefined) return '—';
      if (typeof item === 'string') return item;
      try { return JSON.stringify(item); } catch (e) { return String(item); }
    },

    async copy(text) {
      try {
        await navigator.clipboard.writeText(text);
        this.copied = text;
        var self = this;
        setTimeout(function () { self.copied = ''; }, 1600);
      } catch (e) { /* clipboard diblok — abaikan */ }
    },

    /* ============ util terekspos ke template ============ */

    fmt: fmtNum,
    fmtTanggal: fmtTanggal,
    fmtWIB: function (iso) { return iso ? fmtWIB(new Date(iso)) : '—'; }
  };
}

/* ekspos global untuk Alpine (dimuat setelah file ini) + tes Node */
if (typeof window !== 'undefined') {
  window.pimasApp = pimasApp;
} else if (typeof globalThis !== 'undefined') {
  globalThis.pimasApp = pimasApp;
  globalThis.cronNextUTC = cronNextUTC;
  globalThis.fmtCountdown = fmtCountdown;
}
