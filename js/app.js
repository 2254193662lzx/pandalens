/* =============================================================================
 * app.js — application shell: state, views, event wiring, chart lifecycle.
 *
 * Architecture
 *   state.datasets  : every loaded frame (the first one is the pipeline source)
 *   state.pipeline  : ordered list of visual operations
 *   state.frame     : the pipeline's output — what every view displays
 *   state.table     : view-only state for the grid (paging, sorting, search)
 *   state.chart     : the visual-analysis configuration
 *
 * Rendering is full-view: each view rebuilds its HTML from state. Focus and
 * caret positions are restored around every render so typing never jumps.
 * ========================================================================== */
(function (global) {
  'use strict';

  const { icon } = global.Icons;
  const UI = global.UI;
  const S = global.Stats;
  const DFm = global.DF;
  const Ops = global.Ops;
  const Charts = global.Charts;
  const Datasets = global.Datasets;
  const t = (k, p) => global.I18N.t(k, p);
  const esc = UI.esc;

  /* --------------------------------------------------------------- runtime */
  const state = {
    lang: 'zh',
    theme: 'light',
    datasets: [],            // [{ id, name, df }]
    activeIdx: 0,
    pipeline: [],
    frame: null,
    trace: [],
    stepError: null,
    view: 'load',
    table: {
      page: 1, pageSize: 50, search: '', sortCol: null, sortAsc: true,
      hidden: new Set(), heat: false, showIndex: true, headerSpark: true,
    },
    chart: { type: 'histogram', params: {}, panels: [] },
    expandedStep: null,
    history: [],
    future: [],
    lastRunMs: 0,
    busy: false,
  };

  const NAV = [
    { id: 'load', icon: 'database', labelKey: 'view.load' },
    { id: 'table', icon: 'table', labelKey: 'view.table' },
    { id: 'profile', icon: 'sigma', labelKey: 'view.profile' },
    { id: 'visualize', icon: 'chart', labelKey: 'view.visualize' },
    { id: 'pipeline', icon: 'flow', labelKey: 'view.pipeline' },
    { id: 'code', icon: 'code', labelKey: 'view.code' },
  ];

  let chartInstance = null;
  let chartHost = null;

  /* ================================================================ helpers */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** Deep-ish clone for history snapshots. */
  const snapshot = () => JSON.stringify({ pipeline: state.pipeline, activeIdx: state.activeIdx });

  function pushHistory() {
    const snap = snapshot();
    if (state.history.length && state.history[state.history.length - 1] === snap) return;
    state.history.push(snap);
    if (state.history.length > 60) state.history.shift();
    state.future.length = 0;
    syncHistoryButtons();
  }

  function restore(snap) {
    const data = JSON.parse(snap);
    state.pipeline = data.pipeline;
    state.activeIdx = Math.min(data.activeIdx, state.datasets.length - 1);
    state.stepError = null;
    recompute();
    render();
    syncHistoryButtons();
  }

  function undo() {
    if (state.history.length < 2) return;
    const current = state.history.pop();
    state.future.push(current);
    restore(state.history[state.history.length - 1]);
    UI.toast(t('toast.undone'));
  }

  function redo() {
    if (!state.future.length) return;
    const snap = state.future.pop();
    state.history.push(snap);
    restore(snap);
    UI.toast(t('toast.redone'));
  }

  function syncHistoryButtons() {
    const u = $('#btn-undo'), r = $('#btn-redo');
    if (u) u.disabled = state.history.length < 2;
    if (r) r.disabled = !state.future.length;
  }

  const activeDataset = () => state.datasets[state.activeIdx] || null;
  const baseFrame = () => (activeDataset() ? activeDataset().df : null);

  /* ============================================================== pipeline */
  function opContext() {
    return { datasets: state.datasets, df: state.frame || baseFrame() };
  }

  function recompute() {
    const base = baseFrame();
    if (!base) { state.frame = null; state.trace = []; return; }
    const t0 = performance.now();
    try {
      const res = Ops.runPipeline(base, state.pipeline, opContext());
      state.frame = res.df;
      state.trace = res.trace;
      state.stepError = null;
    } catch (e) {
      state.stepError = { stepId: e.stepId, message: e.message };
      if (e.trace) {
        state.trace = e.trace;
        // keep the last successfully computed frame so the UI stays usable
        let df = base;
        for (const step of state.pipeline) {
          if (step.id === state.stepError.stepId) break;
          if (!step.enabled) continue;
          try { df = Ops.OPS[step.op].apply(df, step.params, opContext()); } catch (err) { break; }
        }
        state.frame = df;
      }
    }
    state.lastRunMs = Math.round((performance.now() - t0) * 10) / 10;
  }

  function addStep(opId, params, opts) {
    const o = opts || {};
    if (!baseFrame()) { UI.toast(t('pipeline.pickDatasetFirst'), 'error'); return null; }
    pushHistory();
    const df = o.againstFrame || state.frame || baseFrame();
    const step = Ops.makeStep(opId, df, opContext());
    if (params) Object.assign(step.params, params);
    if (o.at !== undefined) state.pipeline.splice(o.at, 0, step);
    else state.pipeline.push(step);
    state.expandedStep = o.expand === false ? state.expandedStep : step.id;
    state.stepError = null;
    recompute();
    if (o.silent !== true) {
      const d = Ops.stepDescribe(step);
      UI.toast(t('pipeline.addedTo', { op: t(Ops.OPS[opId].labelKey), n: state.pipeline.indexOf(step) + 1 }) + ' · ' + t(d.key, d.params));
    }
    render();
    return step;
  }

  function updateStepParams(stepId, name, value) {
    const step = state.pipeline.find((s) => s.id === stepId);
    if (!step) return;
    step.params[name] = value;
    state.stepError = null;
    recompute();
  }

  /* ================================================================== boot */
  function applyStaticI18n() {
    document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en';
    $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-title]').forEach((el) => {
      el.title = t(el.dataset.i18nTitle);
      el.setAttribute('aria-label', el.title);
    });
  }

  function renderShell() {
    // language switch
    const ls = $('#lang-switch');
    ls.innerHTML = `<button data-lang="zh" class="${state.lang === 'zh' ? 'active' : ''}">中文</button>
      <button data-lang="en" class="${state.lang === 'en' ? 'active' : ''}">EN</button>`;

    // theme + misc buttons
    $('#btn-theme').innerHTML = icon(state.theme === 'dark' ? 'sun' : 'moon');
    $('#btn-undo').innerHTML = icon('undo');
    $('#btn-redo').innerHTML = icon('redo');
    $('#btn-help').innerHTML = icon('help');
    $('#btn-export').innerHTML = `${icon('download')}<span>${esc(t('header.export'))}</span>`;

    // nav
    $('#nav-list').innerHTML = NAV.map((n, i) => {
      const count = navCount(n.id);
      return `<div class="nav-item ${state.view === n.id ? 'active' : ''}" data-view="${n.id}" title="${esc(t(n.labelKey))}">
        ${icon(n.icon)}
        <span>${esc(t(n.labelKey))}</span>
        ${count !== null ? `<span class="count">${count}</span>` : `<span class="kbd-hint">${i + 1}</span>`}
      </div>`;
    }).join('');

    $('#rail-label') && ($('#rail-label').textContent = t('nav.workflow'));
    $$('.rail-label').forEach((el) => { el.textContent = t('nav.workflow'); });

    // rail summary
    const ds = activeDataset();
    const df = state.frame;
    const rs = $('#rail-summary');
    if (ds && df) {
      const missing = df.missingReport().reduce((a, r) => a + r.missing, 0);
      const missPct = df.nrows * df.ncols ? missing / (df.nrows * df.ncols) : 0;
      rs.innerHTML = `<h4>${esc(t('profile.overview'))}</h4>
        <div class="rail-kv"><span>${esc(t('label.rows'))}</span><b>${df.nrows.toLocaleString()}</b></div>
        <div class="rail-kv"><span>${esc(t('label.columns'))}</span><b>${df.ncols}</b></div>
        <div class="rail-kv"><span>${esc(t('profile.memory'))}</span><b>${esc(UI.fmtBytes(df.memoryUsage()))}</b></div>
        <div class="rail-kv"><span>${esc(t('label.missing'))}</span><b class="${missPct > 0.05 ? 'neg' : ''}">${S.fmt.pct(missPct, 1)}</b></div>
        <div class="rail-kv"><span>${esc(t('view.pipeline'))}</span><b>${state.pipeline.filter((s) => s.enabled).length}</b></div>`;
    } else {
      rs.innerHTML = `<h4>${esc(t('profile.overview'))}</h4><div class="muted" style="font-size:11.5px">${esc(t('pipeline.pickDatasetFirst'))}</div>`;
    }

    // dataset chip
    const chip = $('#dataset-chip');
    if (ds) {
      chip.innerHTML = `<span class="dot"></span><b>${esc(ds.name)}</b>
        <span class="meta">${state.frame.nrows.toLocaleString()} × ${state.frame.ncols}</span>`;
      chip.title = `${ds.name} — ${t('load.rows')} ${state.frame.nrows}, ${t('load.cols')} ${state.frame.ncols}`;
    } else {
      chip.innerHTML = `<span class="dot" style="background:var(--text-muted)"></span><b>${esc(t('label.none'))}</b>`;
    }

    renderStatus();
  }

  function navCount(id) {
    const df = state.frame;
    if (!df) return null;
    if (id === 'profile') return df.ncols;
    if (id === 'pipeline') return state.pipeline.length;
    if (id === 'table') return df.nrows;
    return null;
  }

  function renderStatus() {
    const df = state.frame;
    const parts = [];
    if (df) {
      parts.push(`<span><b>${df.nrows.toLocaleString()}</b> ${esc(t('label.rows'))}</span>`);
      parts.push(`<span><b>${df.ncols}</b> ${esc(t('label.columns'))}</span>`);
      parts.push(`<span>${esc(UI.fmtBytes(df.memoryUsage()))}</span>`);
      const base = baseFrame();
      if (base && state.pipeline.length) {
        parts.push(`<span>${esc(t('pipeline.summary', { steps: state.pipeline.filter((s) => s.enabled).length, rows: df.nrows.toLocaleString(), source: base.nrows.toLocaleString() }))}</span>`);
      }
      if (state.stepError) parts.push(`<span style="color:var(--danger)">${icon('alert', 'ico')} ${esc(t('pipeline.error'))}</span>`);
      else parts.push(`<span>${esc(t('status.lastRun', { ms: state.lastRunMs }))}</span>`);
    } else {
      parts.push(`<span>${esc(t('status.ready'))}</span>`);
    }
    parts.push(`<span style="margin-left:auto">${esc(activeDataset() ? activeDataset().name : '')} · ${state.lang.toUpperCase()}</span>`);
    $('#statusbar').innerHTML = parts.join('<span class="sep"></span>');
    $$('#statusbar svg').forEach((s) => { s.style.width = '12px'; s.style.height = '12px'; s.style.verticalAlign = '-2px'; });
  }

  /* ============================================================ focus guard */
  function describeFocus() {
    const ae = document.activeElement;
    if (!ae || ae === document.body) return null;
    const step = ae.closest ? ae.closest('.step') : null;
    return {
      p: ae.dataset ? ae.dataset.p : null,
      kind: ae.dataset ? ae.dataset.kind : null,
      cp: ae.dataset ? ae.dataset.cp : null,
      ci: ae.dataset ? ae.dataset.ci : null,
      stepId: step ? step.dataset.stepId : null,
      fieldName: ae.closest && ae.closest('.field') ? ae.closest('.field').dataset.fieldName : null,
      selStart: typeof ae.selectionStart === 'number' ? ae.selectionStart : null,
      selEnd: typeof ae.selectionEnd === 'number' ? ae.selectionEnd : null,
      id: ae.id || null,
    };
  }

  function restoreFocus(desc) {
    if (!desc) return;
    let el = null;
    if (desc.id) el = document.getElementById(desc.id);
    if (!el && desc.stepId && desc.fieldName) {
      const step = $(`.step[data-step-id="${desc.stepId}"]`);
      if (step) el = step.querySelector(`.field[data-field-name="${desc.fieldName}"] [data-p="${desc.p}"]`);
    }
    if (!el && desc.p && desc.stepId) {
      const step = $(`.step[data-step-id="${desc.stepId}"]`);
      if (step) el = step.querySelector(`[data-p="${desc.p}"]`);
    }
    if (!el && desc.p) el = $(`[data-p="${desc.p}"]`);
    if (!el && desc.cp && desc.ci !== null && desc.ci !== undefined) el = $(`[data-ci="${desc.ci}"] [data-cp="${desc.cp}"]`);
    if (el && el.focus) {
      el.focus();
      if (desc.selStart !== null && el.setSelectionRange) {
        try { el.setSelectionRange(desc.selStart, desc.selEnd); } catch (e) { /* select/number types */ }
      }
    }
  }

  function render(opts) {
    const o = opts || {};
    const focus = o.keepFocus ? describeFocus() : null;
    // clean chart instance when the visualize view is rebuilt
    const aliveHost = document.getElementById('chart-host');
    if (chartInstance && chartHost && chartHost !== aliveHost) {
      try { chartInstance.dispose(); } catch (e) { /* already gone */ }
      chartInstance = null; chartHost = null;
    }
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + state.view));
    const renderers = {
      load: renderLoad, table: renderTable, profile: renderProfile,
      visualize: renderVisualize, pipeline: renderPipeline, code: renderCode,
    };
    (renderers[state.view] || renderLoad)();
    renderShell();
    if (o.keepFocus) restoreFocus(focus);
  }

  function setView(id) {
    if (state.view === id) return;
    state.view = id;
    render();
    $('#main').scrollTop = 0;
  }

  /* ============================================================ view: load */
  function renderLoad() {
    const v = $('#view-load');
    const cards = Datasets.CATALOGUE.map((d) => `
      <div class="ds-card ${activeDataset() && activeDataset().id === d.id ? 'active' : ''}" data-ds="${d.id}">
        <div class="ds-top">${icon(d.icon, 'ico')}<span class="ds-name">${esc(t(d.nameKey))}</span></div>
        <div class="ds-desc">${esc(t(d.descKey))}</div>
        <div class="ds-meta"><span class="chip">${esc(d.size)}</span><span class="chip accent">${esc(d.tag)}</span></div>
        <div class="ds-cat">${icon(d.icon)}</div>
      </div>`).join('');

    const loaded = state.datasets.map((d, i) => `
      <div class="row between" style="padding:7px 9px;border:1px solid var(--border);border-radius:10px;background:var(--bg-elev)">
        <div class="row" style="gap:8px;min-width:0">
          ${icon('table')}
          <div style="min-width:0">
            <div style="font-weight:600;font-size:12.5px" class="truncate">${esc(d.name)}</div>
            <div class="muted" style="font-size:11px">${d.df.nrows.toLocaleString()} × ${d.df.ncols} · ${esc(UI.fmtBytes(d.df.memoryUsage()))}</div>
          </div>
        </div>
        <div class="row" style="gap:5px">
          ${i === state.activeIdx ? `<span class="chip ok">${esc(t('dataset.active'))}</span>` : `<button class="btn sm" data-use-ds="${i}">${esc(t('dataset.use'))}</button>`}
          ${state.datasets.length > 1 ? `<button class="icon-btn" data-drop-ds="${i}" title="${esc(t('pipeline.remove'))}">${icon('trash')}</button>` : ''}
        </div>
      </div>`).join('');

    v.innerHTML = `
      <div class="page-head">
        <div class="titles">
          <h2>${esc(t('load.title'))}</h2>
          <p>${esc(t('load.subtitle'))}</p>
        </div>
        <div class="actions">
          <button class="btn" id="btn-open-file">${icon('upload')}${esc(t('load.browse'))}</button>
          <button class="btn" id="btn-load-url">${icon('link')}${esc(t('load.url'))}</button>
          <button class="btn primary" id="btn-paste">${icon('file')}${esc(t('load.paste'))}</button>
        </div>
      </div>

      <div class="grid cols-2 mb-12" style="grid-template-columns:1.4fr 1fr">
        <div class="drop-zone" id="drop-zone">
          ${icon('upload')}
          <h3>${esc(t('load.dragDrop'))}</h3>
          <p>${esc(t('load.dragHint'))}</p>
          <div class="row" style="justify-content:center;gap:8px;margin-top:12px">
            <button class="btn primary" data-browse>${esc(t('load.browse'))}</button>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>${icon('sparkles')} ${esc(t('gen.title'))}</h3></div>
          <div class="card-body">
            <p class="muted" style="font-size:11.5px;margin-bottom:10px">${esc(t('load.generatorHint'))}</p>
            <div class="fields inline">
              <div class="field"><label>${esc(t('gen.rows'))}</label><input type="number" id="gen-rows" value="400" min="10" max="5000" step="10"></div>
              <div class="field"><label>${esc(t('gen.columns'))}</label><input type="number" id="gen-cols" value="4" min="1" max="8" step="1"></div>
              <div class="field"><label>${esc(t('gen.nulls'))}</label><input type="number" id="gen-nulls" value="0.06" min="0" max="0.5" step="0.01"></div>
              <div class="field"><label>${esc(t('gen.seed'))}</label><input type="number" id="gen-seed" value="7" min="0" step="1"></div>
            </div>
            <button class="btn primary mt-12" id="btn-generate" style="width:100%">${icon('zap')}${esc(t('gen.generate'))}</button>
          </div>
        </div>
      </div>

      <div class="card mb-12">
        <div class="card-head"><h3>${esc(t('load.defaults'))}</h3><span class="sub">${esc(t('load.defaultsHint'))}</span></div>
        <div class="card-body"><div class="ds-grid">${cards}</div></div>
      </div>

      ${state.datasets.length ? `<div class="card">
        <div class="card-head"><h3>${esc(t('load.recent'))}</h3><span class="sub">${state.datasets.length}</span></div>
        <div class="card-body col" style="gap:8px">${loaded}</div>
      </div>` : ''}
    `;
  }

  /* =========================================================== view: table */
  function renderTable() {
    const v = $('#view-table');
    const df = state.frame;
    if (!df) { v.innerHTML = emptyView(); return; }
    const view = state.table;
    const res = UI.renderTable(df, view, {}, { theme: state.theme });
    const meta = res.meta;
    const base = baseFrame();

    v.innerHTML = `
      <div class="page-head">
        <div class="titles">
          <h2>${esc(t('table.title'))}</h2>
          <p>${esc(t('table.filteredOf', { n: df.nrows.toLocaleString(), total: base ? base.nrows.toLocaleString() : '—' }))}</p>
        </div>
        <div class="actions">
          <span class="seg" id="slice-seg">
            <button data-slice="head">${esc(t('table.head'))}</button>
            <button data-slice="tail">${esc(t('table.tail'))}</button>
            <button data-slice="sample">${esc(t('table.sample'))}</button>
          </span>
          <button class="btn ${view.heat ? 'primary' : ''}" id="btn-heat" title="${esc(t('table.heatmap'))}">${icon('zap')}${esc(t('table.heatmap'))}</button>
          <button class="btn ${view.headerSpark ? 'primary' : ''}" id="btn-spark">${icon('hist')}${esc(t('table.miniBars'))}</button>
          <button class="btn ${view.showIndex ? 'primary' : ''}" id="btn-index">${icon('hashtag')}${esc(t('table.showIndex'))}</button>
          <button class="btn" id="btn-columns">${icon('columns')}${esc(t('table.columnPicker'))}${view.hidden.size ? ` <span class="chip">${esc(t('table.hidden', { n: view.hidden.size }))}</span>` : ''}</button>
          <button class="btn" id="btn-export-csv">${icon('download')}CSV</button>
        </div>
      </div>

      <div class="card">
        <div class="table-toolbar">
          <div class="search-wrap">${icon('search')}<input type="search" id="table-search" placeholder="${esc(t('table.search'))}" value="${esc(view.search)}"></div>
          <span class="muted" style="font-size:11.5px">${esc(t('table.rowsPerPage'))}</span>
          <select id="page-size" style="width:auto">
            ${[25, 50, 100, 250, 1000, 'all'].map((n) => `<option value="${n}"${String(view.pageSize) === String(n) ? ' selected' : ''}>${n === 'all' ? esc(t('label.all')) : n}</option>`).join('')}
          </select>
          ${view.heat ? UI.heatLegend(state.theme) : ''}
          <span style="flex:1"></span>
          <span class="muted tnum">${esc(t('table.showing', { from: meta.from, to: meta.to, total: meta.total }))}</span>
        </div>
        ${res.html}
        <div class="table-foot">
          <button class="btn sm" id="page-prev" ${meta.page <= 1 ? 'disabled' : ''}>${icon('chevronRight')}<span style="transform:rotate(180deg);display:inline-block">${icon('chevron')}</span></button>
          <span>${esc(t('table.page'))} <b>${meta.page}</b> ${esc(t('table.of'))} ${meta.pages}</span>
          <button class="btn sm" id="page-next" ${meta.page >= meta.pages ? 'disabled' : ''}>${icon('chevron')}</button>
          ${meta.filtered ? `<span class="chip warn">${esc(t('table.filtered'))}</span>` : ''}
          <span style="flex:1"></span>
          <span class="muted">${df.nrows.toLocaleString()} ${esc(t('label.rows'))} · ${df.ncols} ${esc(t('label.columns'))} · ${esc(UI.fmtBytes(df.memoryUsage()))}</span>
        </div>
      </div>
    `;
  }

  /* ========================================================= view: profile */
  function renderProfile() {
    const v = $('#view-profile');
    const df = state.frame;
    if (!df) { v.innerHTML = emptyView(); return; }
    const report = df.missingReport();
    const totalCells = df.nrows * df.ncols;
    const missingCells = report.reduce((a, r) => a + r.missing, 0);
    const dups = df.duplicated().filter(Boolean).length;
    const constants = report.filter((r) => r.unique <= 1).map((r) => r.column);
    const health = Math.max(0, Math.round(100 - (missingCells / (totalCells || 1)) * 55 - (dups / (df.nrows || 1)) * 30 - (constants.length / (df.ncols || 1)) * 15));

    // describe() as a transposed table
    const desc = df.describe();
    const describeTable = desc.ncols > 1 ? renderMiniTable(desc, { maxRows: 20, highlightCol: 'statistic' }) : `<div class="empty-state">${icon('sigma')}<p>${esc(t('err.pickNumeric'))}</p></div>`;

    // column dictionary
    const info = df.info();
    const dictTable = `<div class="table-scroll" style="max-height:340px"><table class="df">
      <thead><tr>
        <th>${esc(t('label.columns'))}</th><th>dtype</th><th>${esc(t('stats.nonNull'))}</th>
        <th>${esc(t('label.missing'))}</th><th>%</th><th>${esc(t('stats.nunique'))}</th><th>${esc(t('profile.sampleValues'))}</th>
      </tr></thead>
      <tbody>${info.map((r) => `<tr>
        <td class="str">${esc(r.column)}</td>
        <td><span class="dtype-badge ${esc(r.dtype)}">${esc(r.dtype)}</span></td>
        <td class="num">${r.non_null.toLocaleString()}</td>
        <td class="num ${r.missing ? 'neg' : ''}">${r.missing.toLocaleString()}</td>
        <td class="num">${S.fmt.pct(r.missing_pct, 1)}</td>
        <td class="num">${r.unique.toLocaleString()}</td>
        <td class="str" style="max-width:260px">${esc(r.sample === null || r.sample === undefined ? '—' : UI.formatCell(r.sample, r.dtype))}</td>
      </tr>`).join('')}</tbody></table></div>`;

    const profileCards = df.names.map((name) => profileCard(df, name)).join('');

    const issues = [];
    report.filter((r) => r.missing > 0 && r.pct > 0.25).forEach((r) => issues.push({
      kind: 'warn', text: t('issue.heavyMissing', { col: r.column, pct: S.fmt.pct(r.pct, 1), n: r.missing }),
    }));
    report.filter((r) => r.unique <= 1).forEach((r) => issues.push({ kind: 'warn', text: t('issue.constant', { col: r.column }) }));
    report.filter((r) => r.unique === df.nrows && df.nrows > 20 && r.dtype === 'object').forEach((r) => issues.push({ kind: 'info', text: t('issue.unique', { col: r.column }) }));
    if (dups) issues.push({ kind: 'warn', text: t('issue.duplicates', { n: dups, pct: S.fmt.pct(dups / (df.nrows || 1), 1) }) });
    // skewed numeric columns
    df.numericColumns().forEach((c) => {
      const sk = S.skew(S.clean(df.col(c)));
      if (sk !== null && Math.abs(sk) > 1.6) issues.push({ kind: 'info', text: t('issue.skewed', { col: c, skew: S.fmt.num(sk, 2), dir: sk > 0 ? t('label.higher') : t('label.lower') }) });
    });

    v.innerHTML = `
      <div class="page-head">
        <div class="titles">
          <h2>${esc(t('profile.title'))}</h2>
          <p>${esc(t('profile.subtitle'))}</p>
        </div>
        <div class="actions">
          <button class="btn" id="btn-report">${icon('file')}${esc(t('export.report'))}</button>
        </div>
      </div>

      <div class="tiles mb-12">
        <div class="tile"><div class="accent-bar"></div><div class="label">${esc(t('profile.rowsCount'))}</div><div class="value">${df.nrows.toLocaleString()}</div><div class="foot">${esc(t('profile.totalCells', { n: '' }))}${totalCells.toLocaleString()}</div></div>
        <div class="tile"><div class="accent-bar"></div><div class="label">${esc(t('profile.columnsCount'))}</div><div class="value">${df.ncols}</div><div class="foot">${df.numericColumns().length} ${esc(t('profile.numeric'))} · ${df.ncols - df.numericColumns().length} ${esc(t('profile.categorical'))}</div></div>
        <div class="tile ${missingCells ? 'warn' : 'ok'}"><div class="accent-bar"></div><div class="label">${esc(t('profile.missingCells'))}</div><div class="value">${missingCells.toLocaleString()}</div><div class="foot">${S.fmt.pct(missingCells / (totalCells || 1), 2)} · ${report.filter((r) => r.missing > 0).length} ${esc(t('label.columns'))}</div></div>
        <div class="tile ${dups ? 'warn' : 'ok'}"><div class="accent-bar"></div><div class="label">${esc(t('profile.duplicateRows'))}</div><div class="value">${dups.toLocaleString()}</div><div class="foot">${S.fmt.pct(dups / (df.nrows || 1), 2)}</div></div>
        <div class="tile"><div class="accent-bar"></div><div class="label">${esc(t('profile.memory'))}</div><div class="value" style="font-size:17px">${esc(UI.fmtBytes(df.memoryUsage()))}</div><div class="foot">${esc(t('profile.datetime'))}: ${df.datetimeColumns().length}</div></div>
        <div class="tile ${health > 85 ? 'ok' : health > 60 ? 'warn' : 'danger'}"><div class="accent-bar"></div><div class="label">${esc(t('profile.healthScore'))}</div><div class="value">${health}</div><div class="foot">${esc(t('profile.healthNote', { missing: S.fmt.num((missingCells / (totalCells || 1)) * 100, 1), dup: S.fmt.num((dups / (df.nrows || 1)) * 100, 1), const: constants.length }))}</div></div>
      </div>

      <div class="grid cols-2 mb-12">
        <div class="card">
          <div class="card-head"><h3>${esc(t('profile.describe'))}</h3><span class="sub">${esc(t('profile.describeHint'))}</span></div>
          <div class="card-body flush">${describeTable}</div>
        </div>
        <div class="card">
          <div class="card-head"><h3>${esc(t('profile.issues'))}</h3><span class="sub">${issues.length}</span></div>
          <div class="card-body" style="max-height:360px;overflow:auto">
            ${issues.length ? issues.map((i) => `<div class="note">${icon(i.kind === 'warn' ? 'alert' : 'info', 'ico')}<span>${esc(i.text)}</span></div>`).join('') : `<div class="note">${icon('check', 'ico')}<span>${esc(t('profile.noIssues'))}</span></div>`}
          </div>
        </div>
      </div>

      <div class="card mb-12">
        <div class="card-head"><h3>${esc(t('profile.columns'))}</h3><span class="sub">${df.ncols}</span></div>
        <div class="card-body flush">${dictTable}</div>
      </div>

      <div class="card-head" style="border:0;padding:0 0 10px"><h3>${esc(t('profile.columnProfile'))}</h3>
        <span class="sub">${esc(t('viz.clickBar'))}</span></div>
      <div class="profile-grid">${profileCards}</div>
    `;
  }

  function profileCard(df, name) {
    const dtype = df.dtype(name);
    const col = df.col(name);
    const spark = UI.sparkline(col, dtype, { height: 44, theme: state.theme, color: '#3b6df6' });
    const numeric = DFm.isNum(dtype) || dtype === 'bool';
    let body;
    if (numeric) {
      const st = S.summary(col);
      const bs = S.boxStats(col);
      const cells = [
        ['stats.count', st.count], ['stats.missing', st.missing], ['stats.mean', S.fmt.num(st.mean)],
        ['stats.std', S.fmt.num(st.std)], ['stats.median', S.fmt.num(st.median)], ['stats.min', S.fmt.num(st.min)],
        ['stats.max', S.fmt.num(st.max)], ['stats.iqr', S.fmt.num(st.iqr)],
        ['stats.skew', S.fmt.num(st.skew)], ['stats.kurtosis', S.fmt.num(st.kurt)],
      ];
      body = `<div class="kv-grid">${cells.map(([k, vv]) => `<div class="kv"><span>${esc(t(k))}</span><b>${esc(vv)}</b></div>`).join('')}</div>
        ${bs && bs.outliers.length ? `<div class="mt-8"><span class="chip warn">${esc(t('profile.outliers'))}: ${bs.outliers.length}</span></div>` : ''}`;
    } else {
      const vc = df.valueCounts(name, { top: 5 });
      const max = vc.entries.length ? vc.entries[0].count : 1;
      body = `<div class="kv-grid">
          <div class="kv"><span>${esc(t('stats.nunique'))}</span><b>${df.valueCounts(name, {}).entries.length.toLocaleString()}</b></div>
          <div class="kv"><span>${esc(t('stats.missing'))}</span><b>${vc.missing}</b></div>
        </div>
        <div class="value-bars">${vc.entries.map((e) => `<div class="value-bar">
          <div class="bl"><i style="width:${((e.count / max) * 100).toFixed(1)}%"></i><span>${esc(e.label)}</span></div>
          <b>${e.count.toLocaleString()}</b></div>`).join('')}</div>`;
    }
    const missPct = col.length ? col.filter((x) => S.isMissing(x)).length / col.length : 0;
    return `<div class="card profile-card">
      <div class="pc-head">
        ${icon(numeric ? 'hist' : 'bar')}
        <span class="pc-name">${esc(name)}</span>
        <span class="dtype-badge ${esc(dtype)}" style="margin-left:auto">${esc(dtype)}</span>
      </div>
      <div class="pc-body">
        ${spark ? `<div class="spark-box">${spark.replace('height="44"', 'height="44" style="height:44px"')}</div>` : ''}
        ${body}
        ${missPct > 0 ? `<div class="mini-bar ${missPct > 0.3 ? 'danger' : 'warn'}"><i style="width:${(missPct * 100).toFixed(1)}%"></i></div>
          <div class="muted" style="font-size:10.5px;margin-top:3px">${esc(t('label.missing'))} ${S.fmt.pct(missPct, 1)}</div>` : ''}
        <div class="row mt-8" style="gap:5px;flex-wrap:wrap">
          <button class="btn sm" data-col-chart="${esc(name)}">${icon('chart')}${esc(t('view.visualize'))}</button>
          <button class="btn sm" data-col-filter="${esc(name)}">${icon('filter')}${esc(t('op.filter'))}</button>
        </div>
      </div>
    </div>`;
  }

  /** Small non-paged table used for describe() output. */
  function renderMiniTable(df, opts) {
    const o = opts || {};
    const cols = df.names.slice(0, 12);
    const rows = Math.min(df.nrows, o.maxRows || 30);
    return `<div class="table-scroll" style="max-height:420px"><table class="df">
      <thead><tr>${cols.map((c) => `<th style="cursor:default">${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${DFm.rangeArr(rows).map((r) => `<tr>${cols.map((c) => {
        const v = df.at(r, c);
        const dt = df.dtype(c);
        return `<td class="${o.highlightCol === c ? 'str' : 'num'}">${esc(UI.formatCell(v, dt))}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  /* ======================================================= view: visualize */
  function renderVisualize() {
    const v = $('#view-visualize');
    const df = state.frame;
    if (!df) { v.innerHTML = emptyView(); return; }
    const chart = Charts.CHARTS[state.chart.type] || Charts.CHARTS.histogram;
    const params = state.chart.params;

    const gallery = Charts.CHART_GROUPS.map((g) => {
      const items = Object.entries(Charts.CHARTS).filter(([, c]) => c.group === g.id);
      if (!items.length) return '';
      return `<div style="margin-bottom:10px">
        <div class="gl" style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);padding:2px 0 6px">${esc(t(g.labelKey))}</div>
        <div class="chart-gallery">${items.map(([id, c]) => `<div class="chart-pick ${id === state.chart.type ? 'active' : ''}" data-chart="${id}" title="${esc(t(c.aboutKey))}">
          ${icon(c.icon)}<span>${esc(t(c.labelKey))}</span></div>`).join('')}</div>
      </div>`;
    }).join('');

    v.innerHTML = `
      <div class="page-head">
        <div class="titles">
          <h2>${esc(t('viz.title'))}</h2>
          <p>${esc(t('viz.subtitle'))}</p>
        </div>
        <div class="actions">
          <button class="btn" id="btn-chart-png">${icon('image')}${esc(t('viz.exportPng'))}</button>
          <button class="btn" id="btn-chart-csv">${icon('download')}${esc(t('viz.exportData'))}</button>
          <button class="btn" id="btn-chart-full">${icon('grid')}${esc(t('viz.fullscreen'))}</button>
        </div>
      </div>

      <div class="grid sidebar-wide">
        <div class="col" style="gap:12px">
          <div class="card">
            <div class="card-head"><h3>${esc(t('viz.chartType'))}</h3></div>
            <div class="card-body tight">${gallery}</div>
          </div>
          <div class="card">
            <div class="card-head"><h3>${esc(t('viz.params'))}</h3><span class="sub">${esc(t(chart.labelKey))}</span></div>
            <div class="card-body" id="chart-params">${UI.renderFields(chart.params, params, { df, datasets: state.datasets, theme: state.theme })}</div>
          </div>
          <div class="card">
            <div class="card-head"><h3>${esc(t('viz.about'))}</h3></div>
            <div class="card-body"><p class="soft" style="font-size:12px">${esc(t(chart.aboutKey))}</p></div>
          </div>
        </div>
        <div class="col" style="gap:12px">
          <div class="chart-canvas" id="chart-host"></div>
          <div class="insight hidden" id="chart-insight"></div>
          <div id="chart-notes"></div>
        </div>
      </div>
    `;
    drawChart();
  }

  function drawChart() {
    const host = document.getElementById('chart-host');
    if (!host) return;
    const df = state.frame;
    const spec = Charts.CHARTS[state.chart.type];
    if (!spec || !df) return;
    let built;
    try {
      built = spec.build(df, state.chart.params, state.theme, { datasets: state.datasets });
    } catch (e) {
      built = { error: e.message };
    }
    const insightBox = document.getElementById('chart-insight');
    const notesBox = document.getElementById('chart-notes');

    if (built.error || !built.option) {
      if (chartInstance) { try { chartInstance.dispose(); } catch (e) { /* noop */ } chartInstance = null; chartHost = null; }
      host.innerHTML = `<div class="chart-empty">${icon('alert')}<div>${esc(built.error || t('viz.noData'))}</div></div>`;
      if (insightBox) insightBox.classList.add('hidden');
      if (notesBox) notesBox.innerHTML = '';
      return;
    }
    if (!host.querySelector('div')) host.innerHTML = '<div style="width:100%;height:100%"></div>';
    const mount = host.firstElementChild;
    if (!chartInstance || chartHost !== mount) {
      if (chartInstance) { try { chartInstance.dispose(); } catch (e) { /* noop */ } }
      chartHost = mount;
      chartInstance = global.echarts.init(mount, null, { renderer: 'canvas' });
      chartInstance.on('click', onChartClick);
    }
    try {
      chartInstance.setOption(built.option, true);
      chartInstance.resize();
    } catch (e) {
      host.innerHTML = `<div class="chart-empty">${icon('alert')}<div>${esc(e.message)}</div></div>`;
    }

    if (insightBox) {
      if (built.insight) {
        insightBox.classList.remove('hidden');
        insightBox.innerHTML = `${icon('sparkles')}<div><b>${esc(t('insight.title'))}</b> · ${esc(built.insight)}</div>`;
      } else insightBox.classList.add('hidden');
    }
    if (notesBox) {
      const notes = (built.notes || []).concat([t('viz.sampleNote')]);
      notesBox.innerHTML = notes.map((n) => `<div class="note">${icon('info', 'ico')}<span>${esc(n)}</span></div>`).join('');
    }
  }

  function onChartClick(params) {
    // Drill-down: correlation heatmap cell → scatter plot of that pair.
    if (state.chart.type === 'corr' && params.value) {
      const cols = state.chart.params.columns && state.chart.params.columns.length
        ? state.chart.params.columns.filter((c) => state.frame.names.includes(c))
        : state.frame.numericColumns();
      const x = cols[params.value[0]], y = cols[params.value[1]];
      if (x && y && x !== y) {
        switchChart('scatter', { x, y });
        UI.toast(`${t('viz.drillDown')} ${x} × ${y}`);
        return;
      }
    }
    if (state.chart.type === 'missing' && params.value && state.chart.params.mode === 'bar') {
      const rows = state.frame.missingReport().slice().sort((a, b) => b.pct - a.pct);
      const col = rows[params.dataIndex];
      if (col) {
        state.table.search = '';
        state.table.sortCol = col.column;
        setView('table');
        UI.toast(`${t('table.quickStats')}: ${col.column}`);
      }
    }
  }

  function switchChart(type, params) {
    const df = state.frame;
    state.chart.type = type;
    state.chart.params = Object.assign(Charts.defaultChartParams(type, df), params || {});
    render();
  }

  /* ======================================================== view: pipeline */
  function renderPipeline() {
    const v = $('#view-pipeline');
    const df = state.frame;
    const base = baseFrame();
    if (!base) { v.innerHTML = emptyView(); return; }

    const palette = Ops.GROUPS.map((g) => {
      const items = Object.entries(Ops.OPS).filter(([, o]) => o.group === g.id);
      if (!items.length) return '';
      return `<div class="palette-group">
        <div class="gl">${esc(t(g.labelKey))}</div>
        <div class="palette">
          ${items.map(([id, o]) => `<div class="palette-item" data-add-op="${id}" title="${esc(t(o.labelKey))}">
            ${icon(o.icon)}<span class="truncate">${esc(t(o.labelKey))}</span><span class="plus">+</span>
          </div>`).join('')}
        </div>
      </div>`;
    }).join('');

    const steps = state.pipeline.map((step, i) => renderStepCard(step, i)).join('');

    // dataflow summary
    const flow = [];
    flow.push({ label: `${activeDataset() ? activeDataset().name : '—'}`, rows: base.nrows, cols: base.ncols, isSource: true });
    state.pipeline.forEach((step, i) => {
      const tr = state.trace.find((x) => x.id === step.id) || {};
      flow.push({ label: Ops.stepDescribe(step), rows: tr.rows, cols: tr.cols, error: tr.error, skipped: tr.skipped, step });
    });
    const maxRows = Math.max(base.nrows, 1);

    v.innerHTML = `
      <div class="page-head">
        <div class="titles">
          <h2>${esc(t('pipeline.title'))}</h2>
          <p>${esc(t('pipeline.subtitle'))}</p>
        </div>
        <div class="actions">
          <span class="chip">${esc(t('pipeline.summary', { steps: state.pipeline.length, rows: df.nrows.toLocaleString(), source: base.nrows.toLocaleString() }))}</span>
          <button class="btn" id="btn-clear-pipeline" ${state.pipeline.length ? '' : 'disabled'}>${icon('trash')}${esc(t('pipeline.reset'))}</button>
          <button class="btn" id="btn-goto-code">${icon('code')}${esc(t('view.code'))}</button>
        </div>
      </div>

      <div class="pipeline-layout">
        <div class="card">
          <div class="card-head"><h3>${esc(t('pipeline.palette'))}</h3></div>
          <div class="card-body tight scroll-y" style="max-height:calc(100vh - 260px)">${palette}</div>
        </div>

        <div class="col" style="gap:14px">
          <div class="card">
            <div class="card-head"><h3>${esc(t('pipeline.title'))}</h3>
              <span class="sub">${state.pipeline.length ? esc(t('pipeline.emptyHint')) : ''}</span>
              <div class="right"><span class="chip">${state.pipeline.filter((s) => s.enabled).length}/${state.pipeline.length}</span></div>
            </div>
            <div class="card-body">
              ${state.pipeline.length ? `<div class="steps">${steps}</div>` : `<div class="empty-state">${icon('flow')}<h3>${esc(t('pipeline.empty'))}</h3><p>${esc(t('pipeline.emptyHint'))}</p></div>`}
            </div>
          </div>

          ${state.pipeline.length ? `<div class="card">
            <div class="card-head"><h3>${esc(t('pipeline.dataflow'))}</h3></div>
            <div class="card-body">
              <div class="flow-line">
                ${flow.map((f) => `<div class="flow-step">
                  <span style="width:22px" class="mono">${f.isSource ? 'Src' : ''}</span>
                  <span class="bar" style="width:${Math.max(1, ((f.rows || 0) / maxRows) * 100).toFixed(1)}%"></span>
                  <span class="n">${f.rows === undefined ? '—' : Number(f.rows).toLocaleString()}</span>
                  <span class="truncate" style="max-width:52%;color:${f.error ? 'var(--danger)' : f.skipped ? 'var(--text-muted)' : 'inherit'}">${typeof f.label === 'string' ? esc(f.label) : esc(t(f.label.key, f.label.params))}</span>
                </div>`).join('')}
              </div>
            </div>
          </div>` : ''}
        </div>
      </div>
    `;
  }

  function renderStepCard(step, i) {
    const op = Ops.OPS[step.op];
    const desc = Ops.stepDescribe(step);
    const trace = state.trace.find((x) => x.id === step.id);
    const err = state.stepError && state.stepError.stepId === step.id ? state.stepError : (trace && trace.error ? { message: trace.error } : null);
    const expanded = state.expandedStep === step.id;
    let rowsPill = '';
    if (trace && trace.rows !== undefined) {
      const delta = trace.delta || 0;
      const cls = delta < 0 ? 'down' : delta > 0 ? 'up' : '';
      rowsPill = `<span class="step-rows ${cls}">${trace.rows.toLocaleString()} ${delta ? `(${delta > 0 ? '+' : ''}${delta.toLocaleString()})` : ''}</span>`;
    }
    return `<div class="step ${err ? 'error' : ''} ${step.enabled ? '' : 'off'}" data-step-id="${step.id}" draggable="true">
      <div class="step-head" data-toggle-step="${step.id}">
        <span class="handle" title="${esc(t('pipeline.dragHint'))}">${icon('grip')}</span>
        <span class="step-num">${i + 1}</span>
        <div style="min-width:0;flex:1">
          <div class="step-title">${esc(t(op.labelKey))}${step.enabled ? '' : ` <span class="chip">${esc(t('pipeline.disabled'))}</span>`}</div>
          <div class="step-desc" title="${esc(t(desc.key, desc.params))}">${esc(t(desc.key, desc.params))}</div>
        </div>
        <div class="step-meta">
          ${rowsPill}
          <span class="step-actions">
            <button class="icon-btn" data-step-up="${step.id}" title="${esc(t('pipeline.moveUp'))}">${icon('arrowUp')}</button>
            <button class="icon-btn" data-step-down="${step.id}" title="${esc(t('pipeline.moveDown'))}">${icon('arrowDown')}</button>
            <button class="icon-btn" data-step-dup="${step.id}" title="${esc(t('pipeline.duplicate'))}">${icon('copy')}</button>
            <button class="icon-btn" data-step-toggle="${step.id}" title="${esc(step.enabled ? t('pipeline.disable') : t('pipeline.enable'))}">${icon(step.enabled ? 'eye' : 'eyeOff')}</button>
            <button class="icon-btn" data-step-del="${step.id}" title="${esc(t('pipeline.remove'))}">${icon('trash')}</button>
          </span>
        </div>
      </div>
      ${err ? `<div class="step-error">${icon('alert', 'ico')}<div><b>${esc(t('pipeline.error'))}</b><br>${esc(err.message)}<br><span class="muted">${esc(t('pipeline.errorHint'))}</span></div></div>` : ''}
      ${expanded ? `<div class="step-body">
        ${op.params.length ? UI.renderFields(op.params, step.params, { df: stepInputFrame(step), datasets: state.datasets, theme: state.theme }) : `<p class="muted" style="padding-top:11px;font-size:12px">${esc(t('pipeline.noParams'))}</p>`}
      </div>` : ''}
    </div>`;
  }

  /** The frame a step sees as input — used so its column pickers list valid columns. */
  function stepInputFrame(step) {
    const base = baseFrame();
    if (!base) return null;
    let df = base;
    for (const s of state.pipeline) {
      if (s.id === step.id) break;
      if (!s.enabled) continue;
      try { df = Ops.OPS[s.op].apply(df, s.params, opContext()); } catch (e) { break; }
    }
    return df;
  }

  /* ============================================================ view: code */
  function renderCode() {
    const v = $('#view-code');
    if (!baseFrame()) { v.innerHTML = emptyView(); return; }
    const ds = activeDataset();
    const source = {
      kind: ds && ds.df.meta.sourceKind === 'generated' ? 'csv' : 'csv',
      name: ds ? `${ds.name.replace(/[^\w.-]+/g, '_')}.csv` : 'data.csv',
    };
    const code = Ops.pipelinePython(source, state.pipeline, ctxForCode()) || '';
    const stepCount = state.pipeline.length;

    v.innerHTML = `
      <div class="page-head">
        <div class="titles">
          <h2>${esc(t('code.title'))}</h2>
          <p>${esc(t('code.subtitle'))}</p>
        </div>
        <div class="actions">
          <span class="chip">${esc(t('code.lineCount', { n: code.split('\n').length }))}</span>
          <span class="chip accent">${esc(t('code.stepNote', { n: stepCount }))}</span>
          <button class="btn" id="btn-copy-code">${icon('copy')}${esc(t('code.copy'))}</button>
          <button class="btn primary" id="btn-download-code">${icon('download')}${esc(t('code.download'))}</button>
        </div>
      </div>
      <div class="grid sidebar">
        <div class="col" style="gap:12px">
          <div class="card">
            <div class="card-head"><h3>${esc(t('code.notesTitle'))}</h3></div>
            <div class="card-body"><p class="soft" style="font-size:12px">${esc(t('code.notes'))}</p>
              ${!stepCount ? `<p class="muted mt-8" style="font-size:12px">${esc(t('code.noSteps'))}</p>` : ''}
            </div>
          </div>
          <div class="card">
            <div class="card-head"><h3>${esc(t('pipeline.title'))}</h3><span class="sub">${stepCount}</span></div>
            <div class="card-body" style="max-height:420px;overflow:auto">
              ${stepCount ? state.pipeline.map((s, i) => {
    const d = Ops.stepDescribe(s);
    const py = Ops.stepPython(s, ctxForCode());
    return `<div style="margin-bottom:10px">
                  <div class="row" style="gap:7px"><span class="step-num">${i + 1}</span><b style="font-size:12px">${esc(t(d.key, d.params))}</b></div>
                  <pre class="code" style="max-height:none;padding:8px 10px;font-size:11px;margin-top:5px">${highlightPython(py)}</pre>
                </div>`;
  }).join('') : `<p class="muted" style="font-size:12px">${esc(t('code.noSteps'))}</p>`}
            </div>
          </div>
        </div>
        <div class="code-wrap">
          <pre class="code" id="code-block">${highlightPython(code)}</pre>
          <div class="code-actions">
            <button class="btn sm" id="btn-copy-code2">${icon('copy')}${esc(t('code.copy'))}</button>
          </div>
        </div>
      </div>
    `;
  }

  /** Language-independent file name used in the generated pandas code. */
  function codeSourceName() {
    const ds = activeDataset();
    const raw = (ds && ds.df && ds.df.meta && ds.df.meta.sourceName) || (ds && ds.name) || 'data';
    return /.[a-z]+$/i.test(raw) ? raw : raw.replace(/[^w.-]+/g, '_') + '.csv';
  }

  function ctxForCode() {
    return { datasets: state.datasets, df: state.frame || baseFrame() };
  }

  /**
   * Lightweight Python highlighter. Comments and strings are stashed as
   * placeholders first, so later passes can never rewrite injected markup.
   */
  const PY_KEYWORDS = ['import', 'as', 'from', 'def', 'return', 'for', 'in', 'if', 'else',
    'elif', 'print', 'lambda', 'None', 'True', 'False', 'not', 'and', 'or', 'with', 'while', 'class'];

  function highlightPython(src) {
    const stash = [];
    const keep = (html) => { stash.push(html); return '\u0000' + (stash.length - 1) + '\u0000'; };
    const text0 = String(src);
    let text = '';
    for (let i = 0; i < text0.length; i++) {
      const ch = text0[i];
      if (ch === '#') {
        let j = i;
        while (j < text0.length && text0[j] !== '\n') j++;
        text += keep(`<span class="c">${UI.esc(text0.slice(i, j))}</span>`);
        i = j - 1;
      } else if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < text0.length && text0[j] !== ch) {
          if (text0[j] === '\\') j++;
          j++;
        }
        text += keep(`<span class="s">${UI.esc(text0.slice(i, Math.min(j + 1, text0.length)))}</span>`);
        i = j;
      } else if (/[A-Za-z_\u4e00-\u9fa5]/.test(ch)) {
        let j = i;
        while (j < text0.length && /[A-Za-z0-9_\u4e00-\u9fa5]/.test(text0[j])) j++;
        const word = text0.slice(i, j);
        if (PY_KEYWORDS.includes(word)) text += keep(`<span class="k">${word}</span>`);
        else if (text0[j] === '(') text += keep(`<span class="f">${word}</span>`);
        else text += UI.esc(word);
        i = j - 1;
      } else if (/[0-9]/.test(ch)) {
        let j = i;
        while (j < text0.length && /[0-9._]/.test(text0[j])) j++;
        text += keep(`<span class="n">${UI.esc(text0.slice(i, j))}</span>`);
        i = j - 1;
      } else {
        text += UI.esc(ch);
      }
    }
    return text.replace(/\u0000(\d+)\u0000/g, (m, idx) => stash[Number(idx)]);
  }

  /* ================================================================ empty */
  function emptyView() {
    return `<div class="empty-state">${icon('database')}<h3>${esc(t('pipeline.pickDatasetFirst'))}</h3>
      <button class="btn primary" data-goto="load">${esc(t('view.load'))}</button></div>`;
  }

  /* ============================================================ load actions */
  async function useCatalogue(id) {
    const entry = Datasets.CATALOGUE.find((d) => d.id === id);
    if (!entry) return;
    UI.toast(t('load.loading'));
    try {
      const df = await Datasets.load(entry);
      adoptFrame(df, { id, name: t(entry.nameKey) });
    } catch (e) {
      UI.toast(`${t('load.failed')}: ${e.message}`, 'error');
    }
  }

  function adoptFrame(df, meta) {
    pushHistory();
    const entry = { id: (meta && meta.id) || null, name: (meta && meta.name) || df.meta.sourceName || t('load.fileName'), df };
    state.datasets.push(entry);
    state.activeIdx = state.datasets.length - 1;
    state.pipeline = [];
    state.table = Object.assign(state.table, { page: 1, search: '', sortCol: null, sortAsc: true, hidden: new Set() });
    state.stepError = null;
    // chart settings point at columns of the previous frame — re-derive them
    state.chart.params = Charts.defaultChartParams(state.chart.type, df);
    if (!Charts.CHARTS[state.chart.type]) state.chart.type = 'histogram';
    recompute();
    state.view = 'table';
    render();
    UI.toast(t('toast.loaded', { name: entry.name, rows: df.nrows.toLocaleString(), cols: df.ncols }));
  }

  function requireFrame() {
    if (!state.frame) { UI.toast(t('pipeline.pickDatasetFirst'), 'error'); return false; }
    return true;
  }

  function parseTextToFrame(text, filename) {
    const lower = String(filename || '').toLowerCase();
    if (lower.endsWith('.json')) return DFm.DataFrame.parseJSON(text);
    return DFm.DataFrame.parse(text, filename);
  }

  function openFilePicker() {
    document.getElementById('file-input').click();
  }

  async function handleFiles(files) {
    for (const file of files) {
      const name = file.name;
      if (state.frame && state.datasets.some((d) => d.name === name)) pushHistory();
      try {
        let df;
        if (/\.(xlsx|xls)$/i.test(name)) {
          const buf = await file.arrayBuffer();
          df = DFm.DataFrame.parseExcel(new Uint8Array(buf));
        } else if (/\.json$/i.test(name)) {
          df = DFm.DataFrame.parseJSON(await file.text());
        } else if (/\.(csv|tsv|txt)$/i.test(name)) {
          df = parseTextToFrame(await file.text(), name);
        } else {
          UI.toast(t('load.supported'), 'error');
          continue;
        }
        df.meta.sourceName = name;
        df.meta.sourceKind = /\.(xlsx|xls)$/i.test(name) ? 'excel' : /\.json$/i.test(name) ? 'json' : 'csv';
        adoptFrame(df, { name });
      } catch (e) {
        UI.toast(`${t('load.failed')}: ${e.message}`, 'error');
      }
    }
  }

  function pasteModal() {
    const m = UI.modal({
      title: t('load.paste'),
      body: `<p class="muted" style="font-size:12px;margin-bottom:8px">${esc(t('load.pasteHint'))}</p>
        <textarea id="paste-area" style="min-height:180px;width:100%" placeholder="sepal_length,sepal_width,species&#10;5.1,3.5,setosa"></textarea>
        <div class="row mt-8" style="gap:8px"><input type="text" id="paste-name" value="pasted.csv" style="max-width:220px">
        <span class="muted" style="font-size:11.5px">${esc(t('load.fileName'))}</span></div>`,
      footer: `<button class="btn" data-close>${esc(t('label.cancel'))}</button><button class="btn primary" id="paste-go">${esc(t('load.pasteApply'))}</button>`,
    });
    m.el.querySelector('#paste-go').onclick = () => {
      const text = m.el.querySelector('#paste-area').value;
      if (!text.trim()) { UI.toast(t('load.emptyText'), 'error'); return; }
      try {
        const df = parseTextToFrame(text, m.el.querySelector('#paste-name').value || 'pasted.csv');
        df.meta.sourceName = m.el.querySelector('#paste-name').value || 'pasted.csv';
        df.meta.sourceKind = /\.json$/i.test(df.meta.sourceName) ? 'json' : 'csv';
        m.close();
        adoptFrame(df, { name: df.meta.sourceName });
      } catch (e) {
        UI.toast(`${t('load.failed')}: ${e.message}`, 'error');
      }
    };
  }

  function urlModal() {
    const m = UI.modal({
      title: t('load.url'),
      body: `<p class="muted" style="font-size:12px;margin-bottom:8px">${esc(t('load.urlHint'))}</p>
        <input type="text" id="url-input" placeholder="https://example.com/data.csv" style="width:100%">`,
      footer: `<button class="btn" data-close>${esc(t('label.cancel'))}</button><button class="btn primary" id="url-go">${esc(t('load.urlApply'))}</button>`,
    });
    m.el.querySelector('#url-go').onclick = async () => {
      const url = m.el.querySelector('#url-input').value.trim();
      if (!url) return;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const name = url.split('/').pop().split('?')[0] || 'remote.csv';
        const df = parseTextToFrame(text, name);
        df.meta.sourceName = name;
        df.meta.sourceKind = 'csv';
        m.close();
        adoptFrame(df, { name });
      } catch (e) {
        UI.toast(`${t('load.failed')}: ${e.message}`, 'error');
      }
    };
  }

  function generateFrame() {
    const df = Datasets.generate({
      rows: Number($('#gen-rows').value) || 400,
      numeric: Number($('#gen-cols').value) || 4,
      nulls: Number($('#gen-nulls').value) || 0,
      seed: Number($('#gen-seed').value) || 7,
      categories: true,
    });
    adoptFrame(df, { name: `${t('gen.name')}.csv` });
  }

  /* ======================================================= column menu ops */
  function openColumnMenu(col, anchor) {
    const df = state.frame;
    const dtype = df.dtype(col);
    const isNum = DFm.isNum(dtype);
    const st = isNum ? S.summary(df.col(col)) : null;
    const items = [];
    if (st) {
      items.push({ title: t('table.quickStats') });
      items.push({ custom: `<div class="kv-grid" style="width:100%">
        <div class="kv"><span>${esc(t('stats.count'))}</span><b>${st.count.toLocaleString()}</b></div>
        <div class="kv"><span>${esc(t('stats.missing'))}</span><b>${st.missing.toLocaleString()}</b></div>
        <div class="kv"><span>${esc(t('stats.mean'))}</span><b>${esc(S.fmt.num(st.mean))}</b></div>
        <div class="kv"><span>${esc(t('stats.std'))}</span><b>${esc(S.fmt.num(st.std))}</b></div>
        <div class="kv"><span>${esc(t('stats.median'))}</span><b>${esc(S.fmt.num(st.median))}</b></div>
        <div class="kv"><span>${esc(t('stats.iqr'))}</span><b>${esc(S.fmt.num(st.iqr))}</b></div>
      </div>` });
      items.push({ sep: true });
    }
    items.push({ label: t('table.sortAsc'), icon: 'arrowUp', onClick: () => { state.table.sortCol = col; state.table.sortAsc = true; render(); } });
    items.push({ label: t('table.sortDesc'), icon: 'arrowDown', onClick: () => { state.table.sortCol = col; state.table.sortAsc = false; render(); } });
    items.push({
      label: t('table.addToPipeline'),
      icon: 'flow',
      onClick: () => addStep('sort', { by: [col], ascending: false }),
    });
    items.push({ sep: true });
    items.push({ label: `${t('op.filter')} — ${t('table.keepRows')}`, icon: 'filter', onClick: () => addStep('filter', { mode: 'visual', conditions: [{ column: col, op: 'notnull', value: '', value2: '' }], logic: 'and' }) });
    items.push({ label: `${t('op.filter')} — ${t('table.excludeRows')}`, icon: 'filterOff', onClick: () => addStep('filter', { mode: 'visual', conditions: [{ column: col, op: 'isnull', value: '', value2: '' }], logic: 'and' }) });
    items.push({ sep: true });
    if (isNum) {
      items.push({
        label: t('table.fillMissing'), icon: 'fill', keepOpen: false,
        onClick: () => addStep('fillna', { column: col, strategy: 'mean', value: '0' }),
      });
      items.push({ label: t('op.bin'), icon: 'bin', onClick: () => addStep('bin', { column: col, mode: 'width', bins: 5, edges: '' }) });
      items.push({ label: t('op.math'), icon: 'math', onClick: () => addStep('math', { column: col, op: 'round', digits: 2, newColumn: true }) });
      items.push({ label: t('op.rolling'), icon: 'rolling', onClick: () => addStep('rolling', { column: col, window: 7, agg: 'mean', minPeriods: 1 }) });
      items.push({ label: t('op.filterOutliers'), icon: 'outlier', onClick: () => addStep('filterOutliers', { column: col, method: 'iqr', threshold: 1.5, z: 3, keep: 'inliers' }) });
    } else if (dtype === 'datetime64') {
      items.push({ label: t('op.datetime'), icon: 'calendar', onClick: () => addStep('datetimePart', { column: col, part: 'month' }) });
    } else {
      items.push({ label: t('op.text'), icon: 'text', onClick: () => addStep('textOp', { column: col, op: 'upper', newColumn: true }) });
      items.push({
        label: t('table.keepRows') + ' (' + t('fop.in') + ')', icon: 'filter',
        onClick: () => addStep('filter', { mode: 'visual', conditions: [{ column: col, op: 'in', value: df.valueCounts(col, { top: 3 }).entries.map((e) => e.label).join(','), value2: '' }], logic: 'and' }),
      });
    }
    items.push({ label: t('op.groupAgg') + ' (' + t('param.groupBy') + ')', icon: 'group', onClick: () => addStep('groupAgg', { by: [col], valueCols: df.numericColumns().slice(0, 1), funcs: ['mean'], sortBy: '__group__' }) });
    items.push({ label: t('view.visualize'), icon: 'chart', onClick: () => { switchChart(isNum ? 'histogram' : 'bar', isNum ? { columns: [col] } : { x: col }); setView('visualize'); } });
    items.push({ sep: true });
    items.push({ title: t('table.castTo') });
    ['int64', 'float64', 'object', 'datetime64', 'category'].forEach((cd) => {
      if (cd === dtype) return;
      items.push({ label: t('dtype.' + cd), icon: 'type', onClick: () => addStep('astype', { column: col, dtype: cd }) });
    });
    items.push({ sep: true });
    items.push({
      label: t('table.renameColumn'), icon: 'rename',
      onClick: () => {
        const m = UI.modal({
          title: t('table.renameColumn'),
          body: `<div class="field"><label>${esc(t('param.column'))}</label><input type="text" value="${esc(col)}" disabled></div>
            <div class="field mt-8"><label>${esc(t('param.newName'))}</label><input type="text" id="rename-value" value="${esc(col)}"></div>`,
          footer: `<button class="btn" data-close>${esc(t('label.cancel'))}</button><button class="btn primary" id="rename-go">${esc(t('label.apply'))}</button>`,
        });
        m.el.querySelector('#rename-go').onclick = () => {
          const nv = m.el.querySelector('#rename-value').value.trim();
          m.close();
          if (nv && nv !== col) addStep('rename', { column: col, newName: nv });
        };
      },
    });
    items.push({ label: t('table.dropColumn'), icon: 'drop', danger: true, onClick: () => addStep('dropColumns', { columns: [col] }) });
    items.push({ label: t('table.keepColumn'), icon: 'columns', onClick: () => addStep('selectColumns', { columns: df.names.filter((n) => n !== col) }) });
    items.push({ label: t('table.hideColumn'), icon: 'eyeOff', onClick: () => { state.table.hidden.add(col); render(); } });
    items.push({ label: t('table.copyColumn'), icon: 'copy', onClick: async () => { await UI.copyText(df.col(col).map((v) => UI.formatCell(v, dtype)).join('\n')); UI.toast(t('toast.copied')); } });
    UI.menu(anchor, items, { className: 'column-picker' });
  }

  /* ============================================================ exports */
  function exportMenu(anchor) {
    const df = state.frame;
    const name = codeSourceName().replace(/\.[a-z]+$/i, '');
    UI.menu(anchor, [
      { title: t('export.view') },
      { label: `${t('export.csv')} ${t('export.filtered')}`, icon: 'download', onClick: () => { UI.download(`${name}_filtered.csv`, '\ufeff' + df.toCSV(), 'text/csv;charset=utf-8'); UI.toast(t('export.done')); } },
      { label: `${t('export.json')} ${t('export.filtered')}`, icon: 'download', onClick: () => { UI.download(`${name}_filtered.json`, df.toJSON({ plain: true }), 'application/json'); UI.toast(t('export.done')); } },
      { sep: true },
      { title: t('code.title') },
      { label: t('export.python'), icon: 'code', onClick: () => { UI.download('pipeline.py', Ops.pipelinePython({ kind: 'csv', name: `${name}.csv` }, state.pipeline, ctxForCode()), 'text/x-python'); UI.toast(t('export.done')); } },
      { label: t('export.pipelineJson'), icon: 'flow', onClick: () => { UI.download(`${name}_pipeline.json`, JSON.stringify({ source: name, steps: state.pipeline, chart: state.chart }, null, 2), 'application/json'); UI.toast(t('export.done')); } },
      { sep: true },
      { title: t('viz.title') },
      { label: t('export.png'), icon: 'image', onClick: () => downloadChartPng() },
      { label: t('viz.exportData'), icon: 'table', onClick: () => exportChartData() },
      { sep: true },
      { label: t('export.report'), icon: 'file', onClick: () => downloadReport() },
    ]);
  }

  function exportChartData() {
    const df = state.frame;
    if (!df) return;
    const spec = Charts.CHARTS[state.chart.type];
    let built;
    try { built = spec.build(df, state.chart.params, state.theme, {}); } catch (e) { built = { error: e.message }; }
    if (!built.option) { UI.toast(built.error || t('viz.noData'), 'error'); return; }
    const rows = [];
    const cols = state.chart.params.columns || [];
    // Fall back to the aggregated view most charts draw from
    const x = state.chart.params.x || state.chart.params.category || state.chart.params.level1 || (cols.length === 1 ? cols[0] : null);
    const y = state.chart.params.y || state.chart.params.value;
    if (x) {
      const keys = (built.option.xAxis && built.option.xAxis.data) || [];
      const series = built.option.series || [];
      keys.forEach((k, i) => {
        const row = { [x]: k };
        series.forEach((s) => { row[s.name || 'value'] = Array.isArray(s.data) ? (Array.isArray(s.data[i]) ? s.data[i][1] : s.data[i]) : null; });
        rows.push(row);
      });
    } else if (Array.isArray(built.option.series) && built.option.series[0] && Array.isArray(built.option.series[0].data)) {
      built.option.series[0].data.slice(0, 20000).forEach((d) => rows.push({ value: Array.isArray(d) ? d.join(',') : d }));
    }
    if (!rows.length) { UI.toast(t('viz.noData'), 'error'); return; }
    const dfOut = DFm.DataFrame.fromRows(rows);
    UI.download(`${state.chart.type}_data.csv`, '\ufeff' + dfOut.toCSV(), 'text/csv;charset=utf-8');
    UI.toast(t('export.done'));
  }

  function downloadChartPng() {
    if (!chartInstance) { UI.toast(t('export.noChart'), 'error'); return; }
    const url = chartInstance.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: state.theme === 'dark' ? '#0b1220' : '#ffffff' });
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.chart.type}_${Date.now()}.png`;
    a.click();
    UI.toast(t('export.done'));
  }

  function downloadReport() {
    const df = state.frame;
    const base = baseFrame();
    const L = (en, zh) => (state.lang === 'zh' ? zh : en);
    const lines = [];
    lines.push(`# ${t('report.title')} — ${activeDataset() ? activeDataset().name : ''}`);
    lines.push('');
    lines.push(`- ${t('report.generated')}: ${new Date().toLocaleString()}`);
    lines.push(`- ${t('report.dataset')}: ${activeDataset() ? activeDataset().name : '—'}`);
    lines.push(`- ${t('report.shape')}: ${df.nrows} × ${df.ncols}${base && base !== df ? L(` (from ${base.nrows} × ${base.ncols})`, `（原始 ${base.nrows} × ${base.ncols}）`) : ''}`);
    lines.push(`- ${t('profile.memory')}: ${UI.fmtBytes(df.memoryUsage())}`);
    lines.push('');
    lines.push(`## ${t('pipeline.title')}`);
    lines.push('');
    if (state.pipeline.length) {
      state.pipeline.forEach((s, i) => {
        const d = Ops.stepDescribe(s);
        lines.push(`${i + 1}. ${t(d.key, d.params)}${s.enabled ? '' : ` (${t('pipeline.disabled')})`}`);
      });
      lines.push('');
      lines.push('```python');
      lines.push(Ops.pipelinePython({ kind: 'csv', name: `${codeSourceName().replace(/\.[a-z]+$/i, '')}.csv` }, state.pipeline, ctxForCode()));
      lines.push('```');
    } else lines.push(t('report.none'));
    lines.push('');
    lines.push(`## ${t('profile.describe')}`);
    lines.push('');
    const desc = df.describe();
    lines.push('| ' + desc.names.join(' | ') + ' |');
    lines.push('|' + desc.names.map(() => '---').join('|') + '|');
    for (let r = 0; r < desc.nrows; r++) {
      lines.push('| ' + desc.names.map((c) => UI.formatCell(desc.at(r, c), desc.dtype(c))).join(' | ') + ' |');
    }
    lines.push('');
    lines.push(`## ${t('report.missing')}`);
    lines.push('');
    const rep = df.missingReport().filter((r) => r.missing > 0);
    if (!rep.length) lines.push(t('report.noMissing'));
    else {
      lines.push(`| ${t('label.columns')} | dtype | ${t('label.missing')} | % |`);
      lines.push('|---|---|---:|---:|');
      rep.sort((a, b) => b.pct - a.pct).forEach((r) => lines.push(`| ${r.column} | ${r.dtype} | ${r.missing} | ${S.fmt.pct(r.pct, 2)} |`));
    }
    lines.push('');
    lines.push(`## ${t('report.topCorr')}`);
    lines.push('');
    const corrs = df.topCorrelations(10, 'pearson');
    if (!corrs.length) lines.push(t('report.none'));
    else {
      lines.push(`| A | B | r |`);
      lines.push('|---|---|---:|');
      corrs.forEach((c) => lines.push(`| ${c.a} | ${c.b} | ${c.r === null ? 'NaN' : c.r.toFixed(3)} |`));
    }
    lines.push('');
    lines.push(`## ${t('report.chart')}`);
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify({ type: state.chart.type, params: state.chart.params }, null, 2));
    lines.push('```');
    const md = lines.join('\n');
    UI.download(`${codeSourceName().replace(/\.[a-z]+$/i, '')}_report.md`, md, 'text/markdown;charset=utf-8');
    UI.toast(t('export.done'));
  }

  function downloadFullBundle() {
    const payload = {
      generatedAt: new Date().toISOString(),
      dataset: activeDataset() ? { name: activeDataset().name, rows: activeDataset().df.nrows, cols: activeDataset().df.ncols, columns: activeDataset().df.names } : null,
      pipeline: state.pipeline,
      result: state.frame ? state.frame.toRecords(2000) : [],
      chart: state.chart,
      code: Ops.pipelinePython({ kind: 'csv', name: 'data.csv' }, state.pipeline, ctxForCode()),
    };
    UI.download('pandalens_bundle.json', JSON.stringify(payload, null, 2), 'application/json');
  }

  /* ============================================================== help */
  function helpModal() {
    const shortcuts = [
      ['1 – 6', t('help.sc.views')],
      ['/', t('help.sc.search')],
      ['L', t('help.sc.toggleLang')],
      ['D', t('help.sc.theme')],
      ['Ctrl+Z / Ctrl+Shift+Z', t('help.sc.undo')],
      ['?', t('help.sc.help')],
      ['Esc', t('help.sc.esc')],
    ];
    const how = [t('help.how1'), t('help.how2'), t('help.how3'), t('help.how4'), t('help.how5'), t('help.how6')];
    UI.modal({
      title: t('help.title'),
      wide: true,
      body: `
        <p class="soft" style="font-size:13px">${esc(t('help.intro'))}</p>
        <div class="grid cols-2 mt-16">
          <div>
            <h3 style="margin-bottom:8px">${esc(t('help.howTitle'))}</h3>
            <ol style="margin:0;padding-left:18px;font-size:12.5px;color:var(--text-soft);line-height:1.85">
              ${how.map((h) => `<li>${esc(h)}</li>`).join('')}
            </ol>
            <div class="insight mt-16">${icon('info')}<div>${esc(t('help.offline'))}</div></div>
            <p class="muted mt-12" style="font-size:11.5px">${esc(t('help.dataCredit'))}</p>
          </div>
          <div>
            <h3 style="margin-bottom:8px">${esc(t('help.shortcuts'))}</h3>
            <div style="display:grid;gap:6px">
              ${shortcuts.map(([k, d]) => `<div class="row between" style="font-size:12.5px"><span class="soft">${esc(d)}</span><span class="kbd">${esc(k)}</span></div>`).join('')}
            </div>
            <div class="mt-16" style="font-size:11.5px;color:var(--text-muted)">${esc(t('help.footer'))}</div>
          </div>
        </div>`,
      footer: `<button class="btn primary" data-close>${esc(t('label.close'))}</button>`,
    });
  }

  /* =========================================================== events */
  function wire() {
    // ---- global buttons
    $('#lang-switch').addEventListener('click', (e) => {
      const b = e.target.closest('[data-lang]');
      if (!b) return;
      setLang(b.dataset.lang);
    });
    $('#btn-theme').addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
    $('#btn-help').addEventListener('click', helpModal);
    $('#btn-undo').addEventListener('click', undo);
    $('#btn-redo').addEventListener('click', redo);
    $('#btn-export').addEventListener('click', (e) => exportMenu(e.currentTarget));
    $('#nav-list').addEventListener('click', (e) => {
      const item = e.target.closest('[data-view]');
      if (item) setView(item.dataset.view);
    });

    // ---- file input / drag & drop
    const fileInput = $('#file-input');
    fileInput.addEventListener('change', () => { if (fileInput.files.length) handleFiles(Array.from(fileInput.files)); fileInput.value = ''; });
    const dz = document.body;
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      e.preventDefault();
      const zone = document.getElementById('drop-zone');
      if (zone) zone.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
      const zone = document.getElementById('drop-zone');
      if (zone) zone.classList.remove('over');
    }));
    dz.addEventListener('drop', (e) => {
      if (!e.dataTransfer) return;
      const files = Array.from(e.dataTransfer.files || []);
      if (!files.length) return;
      e.preventDefault();
      handleFiles(files);
    });

    // ---- delegated clicks inside main
    $('#main').addEventListener('click', onMainClick);
    $('#main').addEventListener('change', onMainChange);
    $('#main').addEventListener('input', onMainInput);

    // ---- chart resize
    window.addEventListener('resize', UI.debounce(() => { if (chartInstance) chartInstance.resize(); }, 120));

    // ---- keyboard
    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '')) || e.target.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (typing) {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      if (e.key >= '1' && e.key <= '6') { setView(NAV[Number(e.key) - 1].id); return; }
      if (e.key === '/') { e.preventDefault(); if (state.view !== 'table') setView('table'); setTimeout(() => { const s = $('#table-search'); if (s) s.focus(); }, 30); return; }
      if (e.key === '?') { helpModal(); return; }
      if (e.key.toLowerCase() === 'l') setLang(state.lang === 'zh' ? 'en' : 'zh');
      if (e.key.toLowerCase() === 'd') setTheme(state.theme === 'dark' ? 'light' : 'dark');
    });
  }

  function onMainClick(e) {
    const target = e.target;
    const hit = (sel) => target.closest(sel);

    // load view
    if (hit('[data-goto]')) { setView(hit('[data-goto]').dataset.goto); return; }
    if (hit('[data-browse]') || target.closest('#btn-open-file') || target.closest('#drop-zone')) { openFilePicker(); return; }
    if (target.closest('#btn-paste')) { pasteModal(); return; }
    if (target.closest('#btn-load-url')) { urlModal(); return; }
    if (target.closest('#btn-generate')) { generateFrame(); return; }
    const dsCard = hit('[data-ds]');
    if (dsCard) { useCatalogue(dsCard.dataset.ds); return; }
    const useBtn = hit('[data-use-ds]');
    if (useBtn) {
      pushHistory();
      state.activeIdx = Number(useBtn.dataset.useDs);
      state.pipeline = [];
      state.chart.params = Charts.defaultChartParams(state.chart.type, state.datasets[state.activeIdx].df);
      recompute();
      render();
      UI.toast(t('toast.loaded', { name: activeDataset().name, rows: state.frame.nrows, cols: state.frame.ncols }));
      return;
    }
    const dropBtn = hit('[data-drop-ds]');
    if (dropBtn) {
      const i = Number(dropBtn.dataset.dropDs);
      pushHistory();
      state.datasets.splice(i, 1);
      state.activeIdx = Math.min(state.activeIdx, state.datasets.length - 1);
      recompute();
      render();
      return;
    }

    // table view
    if (target.closest('#btn-heat')) { state.table.heat = !state.table.heat; render(); return; }
    if (target.closest('#btn-spark')) { state.table.headerSpark = !state.table.headerSpark; render(); return; }
    if (target.closest('#btn-index')) { state.table.showIndex = !state.table.showIndex; render(); return; }
    if (target.closest('#btn-columns')) { columnPicker(e.currentTarget, e); return; }
    if (target.closest('#btn-export-csv')) { UI.download(`${codeSourceName().replace(/\.[a-z]+$/i, '')}.csv`, '\ufeff' + state.frame.toCSV(), 'text/csv;charset=utf-8'); UI.toast(t('export.done')); return; }
    const sliceBtn = hit('[data-slice]');
    if (sliceBtn) {
      const how = sliceBtn.dataset.slice;
      const n = how === 'sample' ? Math.min(200, Math.max(10, Math.round(state.frame.nrows * 0.1))) : 100;
      addStep('limit', { how, n, seed: 42 });
      return;
    }
    if (target.closest('#page-prev')) { state.table.page = Math.max(1, state.table.page - 1); render({ keepFocus: true }); return; }
    if (target.closest('#page-next')) { state.table.page += 1; render({ keepFocus: true }); return; }
    const colMenuBtn = hit('[data-colmenu]');
    if (colMenuBtn) { e.stopPropagation(); openColumnMenu(colMenuBtn.dataset.colmenu, colMenuBtn); return; }
    const th = hit('th[data-col]');
    if (th) {
      const col = th.dataset.col;
      if (state.table.sortCol === col) state.table.sortAsc = !state.table.sortAsc;
      else { state.table.sortCol = col; state.table.sortAsc = true; }
      render();
      return;
    }
    const cell = hit('td.cell-click');
    if (cell) {
      const row = Number(cell.dataset.row), col = cell.dataset.col;
      const v = state.frame.at(row, col);
      UI.modal({
        title: `${col} · ${t('table.cellDetail')}`,
        body: `<div class="col" style="gap:8px">
          <div class="mono" style="font-size:15px;word-break:break-all">${esc(UI.formatCell(v, state.frame.dtype(col)))}</div>
          <div class="muted" style="font-size:11.5px">dtype: <span class="dtype-badge ${esc(state.frame.dtype(col))}">${esc(state.frame.dtype(col))}</span>
          · ${esc(t('label.rows'))} #${esc(state.frame.index ? state.frame.index[row] : row)}${S.isMissing(v) ? ` · <span class="neg">${esc(t('label.missing'))}</span>` : ''}</div>
        </div>`,
        footer: `<button class="btn" data-close>${esc(t('label.close'))}</button>`,
      });
      return;
    }

    // profile view
    const colChart = hit('[data-col-chart]');
    if (colChart) {
      const col = colChart.dataset.colChart;
      const isNum = DFm.isNum(state.frame.dtype(col));
      switchChart(isNum ? 'histogram' : 'bar', isNum ? { columns: [col] } : { x: col });
      setView('visualize');
      return;
    }
    const colFilter = hit('[data-col-filter]');
    if (colFilter) {
      const col = colFilter.dataset.colFilter;
      addStep('filter', { mode: 'visual', conditions: [{ column: col, op: 'notnull', value: '', value2: '' }], logic: 'and' });
      return;
    }
    if (target.closest('#btn-report')) { downloadReport(); return; }

    // visualize view
    const pick = hit('[data-chart]');
    if (pick) { switchChart(pick.dataset.chart); return; }
    if (target.closest('#btn-chart-png')) { downloadChartPng(); return; }
    if (target.closest('#btn-chart-csv')) { exportChartData(); return; }
    if (target.closest('#btn-chart-full')) {
      const host = $('#chart-host');
      if (host) host.classList.toggle('tall');
      if (chartInstance) chartInstance.resize();
      return;
    }

    // pipeline view
    const addOp = hit('[data-add-op]');
    if (addOp) { addStep(addOp.dataset.addOp); return; }
    const toggle = hit('[data-toggle-step]');
    if (toggle && !target.closest('.step-actions')) {
      const id = toggle.dataset.toggleStep;
      state.expandedStep = state.expandedStep === id ? null : id;
      render();
      return;
    }
    const stepUp = hit('[data-step-up]');
    if (stepUp) { moveStep(stepUp.dataset.stepUp, -1); return; }
    const stepDown = hit('[data-step-down]');
    if (stepDown) { moveStep(stepDown.dataset.stepDown, 1); return; }
    const stepDup = hit('[data-step-dup]');
    if (stepDup) {
      const i = state.pipeline.findIndex((s) => s.id === stepDup.dataset.stepDup);
      pushHistory();
      const copy = JSON.parse(JSON.stringify(state.pipeline[i]));
      copy.id = 's' + Math.random().toString(36).slice(2, 9);
      state.pipeline.splice(i + 1, 0, copy);
      recompute();
      render();
      return;
    }
    const stepTog = hit('[data-step-toggle]');
    if (stepTog) {
      const s = state.pipeline.find((x) => x.id === stepTog.dataset.stepToggle);
      pushHistory();
      s.enabled = !s.enabled;
      state.stepError = null;
      recompute();
      render();
      return;
    }
    const stepDel = hit('[data-step-del]');
    if (stepDel) {
      const i = state.pipeline.findIndex((x) => x.id === stepDel.dataset.stepDel);
      pushHistory();
      state.pipeline.splice(i, 1);
      state.stepError = null;
      recompute();
      render();
      return;
    }
    if (target.closest('#btn-clear-pipeline')) {
      pushHistory();
      state.pipeline = [];
      state.stepError = null;
      recompute();
      render();
      UI.toast(t('pipeline.cleared'));
      return;
    }
    if (target.closest('#btn-goto-code')) { setView('code'); return; }

    // code view
    if (target.closest('#btn-copy-code') || target.closest('#btn-copy-code2')) {
      const code = Ops.pipelinePython({ kind: 'csv', name: `${codeSourceName().replace(/\.[a-z]+$/i, '')}.csv` }, state.pipeline, ctxForCode());
      UI.copyText(code).then((ok) => UI.toast(ok ? t('code.copied') : t('toast.copyFailed'), ok ? undefined : 'error'));
      return;
    }
    if (target.closest('#btn-download-code')) {
      UI.download('pipeline.py', Ops.pipelinePython({ kind: 'csv', name: `${codeSourceName().replace(/\.[a-z]+$/i, '')}.csv` }, state.pipeline, ctxForCode()), 'text/x-python');
      UI.toast(t('export.done'));
      return;
    }
  }

  function moveStep(id, dir) {
    const i = state.pipeline.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= state.pipeline.length) return;
    pushHistory();
    const [s] = state.pipeline.splice(i, 1);
    state.pipeline.splice(j, 0, s);
    state.stepError = null;
    recompute();
    render();
  }

  function columnPicker(anchor) {
    const df = state.frame;
    if (!df) return;
    const items = df.names.map((n) => `<div class="item ${state.table.hidden.has(n) ? '' : 'on'}" data-toggle-col="${esc(n)}">
      <span class="ck">✓</span><span class="truncate">${esc(n)}</span>
      <span class="dtype-badge ${esc(df.dtype(n))}">${esc(df.dtype(n))}</span></div>`).join('');
    const el = UI.menu(anchor, [{
      custom: `<div style="padding:6px;width:100%">
        <div class="search-wrap mb-8">${icon('search')}<input type="search" id="col-search" placeholder="${esc(t('table.searchColumns'))}"></div>
        <div class="column-picker"><div class="list">${items}</div></div>
        <div class="colpick-actions mt-8">
          <button class="btn sm" data-col-all>${esc(t('table.selectAll'))}</button>
          <button class="btn sm" data-col-none>${esc(t('table.selectNone'))}</button>
        </div>
      </div>`,
    }], { className: 'column-picker' });

    const refresh = () => {
      const list = el.querySelector('.list');
      list.innerHTML = df.names.filter((n) => !($('#col-search') && $('#col-search').value) || n.toLowerCase().includes($('#col-search').value.toLowerCase()))
        .map((n) => `<div class="item ${state.table.hidden.has(n) ? '' : 'on'}" data-toggle-col="${esc(n)}">
          <span class="ck">✓</span><span class="truncate">${esc(n)}</span>
          <span class="dtype-badge ${esc(df.dtype(n))}">${esc(df.dtype(n))}</span></div>`).join('');
    };
    el.addEventListener('click', (e) => {
      const tcol = e.target.closest('[data-toggle-col]');
      if (tcol) {
        const n = tcol.dataset.toggleCol;
        if (state.table.hidden.has(n)) state.table.hidden.delete(n); else state.table.hidden.add(n);
        tcol.classList.toggle('on');
        const tableHost = $('#view-table');
        if (tableHost) { const keep = state.view; state.view = 'table'; render(); state.view = keep; }
        return;
      }
      if (e.target.closest('[data-col-all]')) { state.table.hidden.clear(); render(); UI.closeMenu(); return; }
      if (e.target.closest('[data-col-none]')) { df.names.forEach((n) => state.table.hidden.add(n)); render(); UI.closeMenu(); return; }
    });
    el.addEventListener('input', (e) => { if (e.target.id === 'col-search') refresh(); });
  }

  function onMainChange(e) {
    const el = e.target;
    // table controls
    if (el.id === 'table-search') return;
    if (el.id === 'page-size') { state.table.pageSize = el.value === 'all' ? 'all' : Number(el.value); state.table.page = 1; render(); return; }

    const kind = el.dataset ? el.dataset.kind : null;
    const pname = el.dataset ? el.dataset.p : null;
    if (!pname) return;
    const stepEl = el.closest('.step');
    const stepId = stepEl ? stepEl.dataset.stepId : null;

    if (pname === 'conditions') {
      // handled by click delegation for add/remove; selects/inputs come through input/change
      return;
    }
    let value;
    if (kind === 'bool') value = el.checked;
    else if (kind === 'number') value = el.value === '' ? '' : Number(el.value);
    else if (kind === 'multi') value = null; // handled below via clicks
    else value = el.value;

    if (kind === 'multi') return;
    if (stepId) {
      pushHistory();
      const step = state.pipeline.find((s) => s.id === stepId);
      updateStepParams(stepId, pname, value);
      // changing an op's mode/op selector may need different fields
      render({ keepFocus: true });
      void step;
      return;
    }
    // chart params
    state.chart.params[pname] = value;
    render({ keepFocus: true });
    drawChart();
  }

  const deferredChart = UI.debounce(() => { drawChart(); }, 260);

  function onMainInput(e) {
    const el = e.target;
    if (el.id === 'table-search') {
      state.table.search = el.value;
      state.table.page = 1;
      render({ keepFocus: true });
      return;
    }
    // live condition editing
    const condRow = el.closest && el.closest('.cond-row');
    if (condRow && el.dataset.cp) {
      const listEl = condRow.closest('[data-p="conditions"]');
      const stepEl = el.closest('.step');
      if (!stepEl) return;
      const step = state.pipeline.find((s) => s.id === stepEl.dataset.stepId);
      if (!step) return;
      const i = Number(condRow.dataset.ci);
      const field = el.dataset.cp;
      step.params.conditions[i] = step.params.conditions[i] || {};
      step.params.conditions[i][field] = el.value;
      state.stepError = null;
      recompute();
      updateStepMetaInPlace(stepEl);
      renderShell();
      return;
    }
    const pname = el.dataset ? el.dataset.p : null;
    if (!pname) return;
    const kind = el.dataset.kind;
    const stepEl = el.closest('.step');
    const stepId = stepEl ? stepEl.dataset.stepId : null;
    if (stepId) {
      const step = state.pipeline.find((s) => s.id === stepId);
      if (!step) return;
      step.params[pname] = kind === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
      if (step.op === 'filter' && pname === 'expr') updateExprStatus(el, step);
      deferredRecompute(stepEl);
      return;
    }
    // chart / expression params outside steps (visualize view)
    state.chart.params[pname] = kind === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
    if (pname === 'expr') updateExprStatus(el, null);
    deferredChart();
  }

  const deferredRecompute = UI.debounce((stepEl) => {
    recompute();
    updateStepMetaInPlace(stepEl);
    renderShell();
    if (state.view === 'pipeline') refreshFlowRows();
  }, 240);

  /** Updates only the row-count pill of a step, avoiding a full re-render. */
  function updateStepMetaInPlace(stepEl) {
    const id = stepEl.dataset.stepId;
    const trace = state.trace.find((x) => x.id === id);
    const pill = stepEl.querySelector('.step-rows');
    if (pill && trace && trace.rows !== undefined) {
      const delta = trace.delta || 0;
      pill.className = 'step-rows' + (delta < 0 ? ' down' : delta > 0 ? ' up' : '');
      pill.textContent = `${trace.rows.toLocaleString()}${delta ? ` (${delta > 0 ? '+' : ''}${delta.toLocaleString()})` : ''}`;
    }
    const desc = stepEl.querySelector('.step-desc');
    const step = state.pipeline.find((s) => s.id === id);
    if (desc && step) { const d = Ops.stepDescribe(step); desc.textContent = t(d.key, d.params); desc.title = desc.textContent; }
  }

  function refreshFlowRows() {
    // cheap refresh of the dataflow bars
    const flow = $('#view-pipeline .flow-line');
    if (!flow) return;
  }

  /** Live validation feedback for expression fields. */
  function updateExprStatus(el, step) {
    const field = el.closest('.field');
    const status = field ? field.querySelector('[data-expr-status]') : null;
    if (!status) return;
    const compiled = global.Expr.compile(el.value);
    if (!el.value.trim()) { status.innerHTML = ''; return; }
    if (compiled.ok) {
      status.innerHTML = `<span class="chip ok">${esc(t('expr.ok'))}</span> <span class="muted">${esc(t('expr.vars'))}: ${esc(compiled.names.join(', ') || '—')}</span>`;
    } else {
      status.innerHTML = `<span class="chip danger">${esc(compiled.error)}</span>`;
    }
    void step;
  }

  /* ------------------------------------------------ delegated multi-select */
  document.addEventListener('click', (e) => {
    const main = document.getElementById('main');
    if (!main || !main.contains(e.target)) return;
    const multiItem = e.target.closest('.colpick .item');
    if (multiItem) {
      const list = multiItem.closest('[data-p]');
      const pname = list.dataset.p;
      const stepEl = multiItem.closest('.step');
      const stepId = stepEl ? stepEl.dataset.stepId : null;
      const val = multiItem.dataset.value;
      const read = () => Array.from(list.querySelectorAll('.item.on')).map((x) => x.dataset.value);
      if (!multiItem.classList.contains('on')) multiItem.classList.add('on'); else multiItem.classList.remove('on');
      const values = read();
      if (stepId) {
        const step = state.pipeline.find((s) => s.id === stepId);
        pushHistory();
        const prev = step.params[pname];
        step.params[pname] = values;
        state.stepError = null;
        recompute();
        // re-render so dependent fields (e.g. per-column choices) refresh
        const changedOptions = Array.isArray(prev) && prev.length !== values.length;
        render({ keepFocus: changedOptions ? false : true });
        return;
      }
      state.chart.params[pname] = values;
      render();
      return;
    }
    const allBtn = e.target.closest('[data-multi-all]');
    const noneBtn = e.target.closest('[data-multi-none]');
    if (allBtn || noneBtn) {
      const pname = (allBtn || noneBtn).dataset.multiAll || (allBtn || noneBtn).dataset.multiNone;
      const list = document.querySelector(`[data-p="${pname}"][data-kind="multi"]`);
      if (!list) return;
      const stepEl = list.closest('.step');
      const stepId = stepEl ? stepEl.dataset.stepId : null;
      const colFilter = list.dataset.filter;
      const values = Array.from(list.querySelectorAll('.item')).map((x) => x.dataset.value);
      const chosen = allBtn ? values : [];
      if (stepId) {
        pushHistory();
        const step = state.pipeline.find((s) => s.id === stepId);
        step.params[pname] = chosen;
        recompute();
        render({ keepFocus: true });
      } else {
        state.chart.params[pname] = chosen;
        render();
      }
      void colFilter;
      return;
    }

    // ---- condition builder
    const addCond = e.target.closest('[data-add-cond]');
    if (addCond) {
      const stepEl = addCond.closest('.step');
      if (!stepEl) return;
      const step = state.pipeline.find((s) => s.id === stepEl.dataset.stepId);
      pushHistory();
      const inputDf = stepInputFrame(step);
      step.params.conditions = (step.params.conditions || []).concat([{ column: inputDf.names[0], op: 'notnull', value: '', value2: '' }]);
      recompute();
      render();
      return;
    }
    const delCond = e.target.closest('[data-remove-cond]');
    if (delCond) {
      const stepEl = delCond.closest('.step');
      if (!stepEl) return;
      const step = state.pipeline.find((s) => s.id === stepEl.dataset.stepId);
      const i = Number(delCond.dataset.removeCond);
      pushHistory();
      step.params.conditions.splice(i, 1);
      recompute();
      render();
      return;
    }
    const cop = e.target.closest('[data-cop]');
    if (cop) { /* handled by change event */ }
  });

  /* ------------------------------------------------------------ i18n/theme */
  function setLang(lang) {
    state.lang = global.I18N.setLang(lang);
    try { localStorage.setItem('pandalens.lang', state.lang); } catch (e) { /* private mode */ }
    applyStaticI18n();
    if (state.frame) {
      // re-derive chart defaults so labels/columns make sense in the new language
      render();
      if (state.view === 'visualize') drawChart();
    } else render();
    UI.toast(t('toast.langChanged'));
  }

  function setTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('pandalens.theme', theme); } catch (e) { /* private mode */ }
    if (chartInstance) { try { chartInstance.dispose(); } catch (e) { /* noop */ } chartInstance = null; chartHost = null; }
    render();
  }

  /* ================================================================== init */
  async function init() {
    let lang = null, theme = null;
    try {
      lang = localStorage.getItem('pandalens.lang');
      theme = localStorage.getItem('pandalens.theme');
    } catch (e) { /* private mode */ }
    state.lang = global.I18N.setLang(lang || global.I18N.detectLang());
    state.theme = theme || (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', state.theme);

    applyStaticI18n();
    wire();
    renderShell();
    syncHistoryButtons();

    // default dataset: the retail orders table shows dates, categories and gaps
    const def = Datasets.CATALOGUE.find((d) => d.id === 'sales') || Datasets.CATALOGUE[0];
    try {
      const df = await Datasets.load(def);
      state.datasets.push({ id: def.id, name: t(def.nameKey), df });
      state.activeIdx = 0;
      state.chart.type = 'histogram';
      state.chart.params = Charts.defaultChartParams('histogram', df);
      pushHistory();
      recompute();
      state.view = 'table';
      render();
      UI.toast(t('toast.loaded', { name: t(def.nameKey), rows: df.nrows, cols: df.ncols }));
    } catch (e) {
      recompute();
      render();
      UI.toast(`${t('load.failed')}: ${e.message}`, 'error');
    }

    // surface any i18n key that was requested but never defined
    const audit = global.I18N.audit();
    if (audit.missing.length) console.warn('[i18n] undefined keys:', audit.missing);
    global.__pandalens = { state, render, recompute, addStep, switchChart, setView, useCatalogue, drawChart };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
