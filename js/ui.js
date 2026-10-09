/* =============================================================================
 * ui.js — reusable interface pieces: toasts, menus, modals, form controls,
 * sparklines and the DataFrame grid renderer.
 * ========================================================================== */
(function (global) {
  'use strict';

  const { icon } = global.Icons;
  const S = global.Stats;
  const DFm = global.DF;
  const t = (k, p) => global.I18N.t(k, p);

  /* --------------------------------------------------------------- helpers */
  const esc = (v) => String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const attr = esc;

  function debounce(fn, ms) {
    let h = null;
    return function (...args) {
      clearTimeout(h);
      h = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function fmtBytes(n) {
    if (!Number.isFinite(n)) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }

  function download(filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 400);
    return filename;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e2) { return false; }
    }
  }

  /* ---------------------------------------------------------------- toasts */
  let toastHost = null;
  function toast(message, kind) {
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.className = 'toasts';
      document.body.appendChild(toastHost);
    }
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'error' ? ' err' : '');
    el.innerHTML = `${icon(kind === 'error' ? 'alert' : 'check')}<div>${esc(message)}</div>`;
    toastHost.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0';
      el.style.transform = 'translateX(14px)';
      setTimeout(() => el.remove(), 260);
    }, kind === 'error' ? 5200 : 3200);
  }

  /* ----------------------------------------------------------------- menus */
  let openMenu = null;
  function closeMenu() {
    if (openMenu) { openMenu.remove(); openMenu = null; }
  }
  document.addEventListener('click', (e) => {
    if (openMenu && !openMenu.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('resize', closeMenu);

  /**
   * items: {label|html, icon, hint, onClick, active, disabled, danger} |
   *        {sep:true} | {title:'...'} | {custom:'<html>'}
   */
  function menu(anchor, items, opts) {
    closeMenu();
    const el = document.createElement('div');
    el.className = 'menu';
    if (opts && opts.className) el.className += ' ' + opts.className;
    el.innerHTML = items.map((it) => {
      if (it.sep) return '<div class="sep"></div>';
      if (it.title) return `<div class="title">${esc(it.title)}</div>`;
      if (it.custom !== undefined) return `<div class="row">${it.custom}</div>`;
      return `<div class="item${it.active ? ' active' : ''}${it.disabled ? ' disabled' : ''}${it.danger ? ' danger' : ''}" data-i="${items.indexOf(it)}">
        ${it.icon ? icon(it.icon) : ''}<span class="truncate">${it.html !== undefined ? it.html : esc(it.label)}</span>
        ${it.hint ? `<span class="hint">${esc(it.hint)}</span>` : ''}
      </div>`;
    }).join('');
    document.body.appendChild(el);
    const rect = anchor.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = Math.min(rect.left, window.innerWidth - w - 10);
    let top = rect.bottom + 5;
    if (top + h > window.innerHeight - 10) top = Math.max(10, rect.top - h - 5);
    el.style.left = Math.max(8, left) + 'px';
    el.style.top = top + 'px';
    el.addEventListener('click', (e) => {
      const item = e.target.closest('.item');
      if (!item) return;
      const def = items[Number(item.dataset.i)];
      if (!def || def.disabled) return;
      if (def.onClick && def.onClick(e, el) === false) return;
      if (!def.keepOpen) closeMenu();
    });
    openMenu = el;
    return el;
  }

  /* ---------------------------------------------------------------- modals */
  function modal(cfg) {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `<div class="modal${cfg.wide ? ' wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h2>${esc(cfg.title || '')}</h2>
        <div class="right">${cfg.headActions || ''}<button class="icon-btn" data-close>${icon('close')}</button></div>
      </div>
      <div class="modal-body">${cfg.body || ''}</div>
      ${cfg.footer ? `<div class="modal-foot">${cfg.footer}</div>` : ''}
    </div>`;
    document.body.appendChild(overlay);
    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      if (cfg.onClose) cfg.onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-close]')) close();
    });
    if (cfg.onMount) cfg.onMount(overlay.querySelector('.modal'), close);
    return { el: overlay.querySelector('.modal'), close };
  }

  function confirmDialog(message, opts) {
    return new Promise((resolve) => {
      const m = modal({
        title: (opts && opts.title) || t('label.confirm'),
        body: `<p style="font-size:13px;color:var(--text-soft)">${esc(message)}</p>`,
        footer: `<button class="btn" data-no>${esc(t('label.cancel'))}</button><button class="btn ${opts && opts.danger ? 'danger' : 'primary'}" data-yes>${esc((opts && opts.okText) || t('label.apply'))}</button>`,
      });
      m.el.querySelector('[data-no]').onclick = () => { m.close(); resolve(false); };
      m.el.querySelector('[data-yes]').onclick = () => { m.close(); resolve(true); };
    });
  }

  /* --------------------------------------------------------- value display */
  function formatCell(v, dtype, opts) {
    const o = opts || {};
    if (S.isMissing(v)) return 'NaN';
    if (DFm.isDatetime(dtype)) return DFm.formatDatetime(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return 'NaN';
      if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
      return S.fmt.num(v, o.digits);
    }
    return String(v);
  }

  function cellClass(v, dtype) {
    if (S.isMissing(v)) return 'null';
    if (DFm.isNum(dtype)) return 'num';
    if (dtype === 'bool') return 'bool';
    if (DFm.isDatetime(dtype)) return 'date';
    return 'str';
  }

  /* ------------------------------------------------------------- sparklines */
  const HEAT_LIGHT = [59, 109, 246];
  const HEAT_DARK = [91, 140, 255];

  function heatStyle(alpha, theme) {
    const c = theme === 'dark' ? HEAT_DARK : HEAT_LIGHT;
    return `background:rgba(${c[0]},${c[1]},${c[2]},${alpha.toFixed(3)})`;
  }

  /**
   * Inline SVG micro-chart used in table headers, profile cards and the load
   * screen: a histogram for numeric data, ranked bars for categories.
   */
  function sparkline(values, dtype, opts) {
    const o = opts || {};
    const w = 100, h = o.height || 16;
    const theme = o.theme || 'light';
    const fillA = theme === 'dark' ? 0.55 : 0.42;
    const fillB = theme === 'dark' ? 0.9 : 0.75;
    const color = o.color || '#3b6df6';
    const missingPct = values.length ? values.filter((v) => S.isMissing(v)).length / values.length : 0;

    if (DFm.isNum(dtype) || dtype === 'bool') {
      const nums = values.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : S.toNum(v))).filter((v) => v !== null);
      if (!nums.length) return '';
      const bins = Math.max(6, Math.min(28, o.bins || 18));
      const hist = S.histogram(nums, bins);
      const max = Math.max(1, ...hist.counts);
      const bw = w / hist.counts.length;
      const bars = hist.counts.map((c, i) => {
        const bh = Math.max(0.6, (c / max) * (h - 1));
        const a = 0.24 + 0.5 * (c / max);
        return `<rect x="${(i * bw).toFixed(2)}" y="${(h - bh).toFixed(2)}" width="${Math.max(0.6, bw - 0.4).toFixed(2)}" height="${bh.toFixed(2)}" fill="${color}" opacity="${a.toFixed(2)}"/>`;
      }).join('');
      return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" height="${h}">${bars}${missingPct > 0 ? `<rect x="0" y="0" width="${(w * missingPct).toFixed(2)}" height="${h}" fill="#ef4444" opacity="0.12"/>` : ''}</svg>`;
    }
    // categorical: top values as ranked bars
    const counts = new Map();
    values.forEach((v) => {
      if (S.isMissing(v)) return;
      const k = DFm.formatValue(v, dtype);
      counts.set(k, (counts.get(k) || 0) + 1);
    });
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (!entries.length) return '';
    const max = entries[0][1];
    const bh = h / entries.length;
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" height="${h}">${entries.map(([k, c], i) => {
      const bw = Math.max(1, (c / max) * (w - 2));
      return `<rect x="0" y="${(i * bh + 0.4).toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(0.8, bh - 1).toFixed(2)}" rx="0.8" fill="${color}" opacity="${(fillB - i * 0.1).toFixed(2)}"/>`;
    }).join('')}</svg>`;
  }

  /* ---------------------------------------------------------- form controls */
  function columnOptions(df, opts) {
    const o = opts || {};
    return df.names
      .filter((n) => (o.numericOnly ? DFm.isNum(df.dtype(n)) : true))
      .map((n) => `<option value="${attr(n)}">${esc(n)} · ${esc(df.dtype(n))}</option>`)
      .join('');
  }

  function columnSelect(name, value, df, opts) {
    const o = opts || {};
    const empty = o.allowEmpty ? `<option value="">— ${esc(t('label.none'))} —</option>` : '';
    return `<select data-p="${attr(name)}" data-kind="column" ${o.allowEmpty ? '' : 'data-required="1"'}>
      ${o.allowEmpty ? empty : ''}${columnOptions(df, o)}
    </select>`.replace(new RegExp(`value="${attr(value || '')}"`), `value="${attr(value || '')}" selected`);
  }

  function multiList(name, selected, options, opts) {
    const o = opts || {};
    const sel = new Set(selected || []);
    return `<div class="colpick" data-p="${attr(name)}" data-kind="multi" ${o.maxheight ? `style="max-height:${o.maxheight}px"` : ''}>
      ${options.map((opt) => `<div class="item${sel.has(opt.value) ? ' on' : ''}" data-value="${attr(opt.value)}">
        <div class="ck">✓</div><span class="truncate">${esc(opt.label)}</span>${opt.badge || ''}
      </div>`).join('')}
    </div>`;
  }

  /**
   * Renders the visual form for an operation or chart.
   * specs  — parameter descriptors from the registry
   * params — current values (mutated by app.js on change)
   * ctx    — { df, datasets, theme }
   */
  function renderFields(specs, params, ctx) {
    const df = ctx.df;
    const out = [];
    for (const spec of specs) {
      if (spec.when && !spec.when(params)) continue;
      const value = params[spec.name];
      const label = t(spec.labelKey);
      const hint = spec.hintKey ? `<span class="hint">${esc(t(spec.hintKey))}</span>` : '';
      let control = '';
      switch (spec.type) {
        case 'column':
          control = columnSelect(spec.name, value, df, { allowEmpty: spec.allowEmpty, numericOnly: false });
          if (spec.numericOnly) control = columnSelect(spec.name, value, df, { allowEmpty: spec.allowEmpty, numericOnly: true });
          break;
        case 'numColumn':
          control = columnSelect(spec.name, value, df, { allowEmpty: spec.allowEmpty, numericOnly: true });
          break;
        case 'columns': {
          const opts = df.names
            .filter((n) => (spec.numericOnly ? DFm.isNum(df.dtype(n)) : true))
            .map((n) => ({ value: n, label: n, badge: `<span class="dtype-badge ${attr(df.dtype(n))}">${esc(df.dtype(n))}</span>` }));
          const sel = (value || []).filter((n) => df.names.includes(n));
          control = `<div class="colpick-actions">
              <button class="btn sm" data-multi-all="${attr(spec.name)}">${esc(t('table.selectAll'))}</button>
              <button class="btn sm" data-multi-none="${attr(spec.name)}">${esc(t('table.selectNone'))}</button>
              <span class="muted" style="font-size:11px;align-self:center">${sel.length} / ${opts.length}</span>
            </div>
            ${multiList(spec.name, value, opts)}
            ${sel.length ? `<div class="chips-selected mt-8">${sel.map((n) => `<span class="chip">${esc(n)}</span>`).join('')}</div>` : ''}`;
          break;
        }
        case 'aggFuncs': {
          const opts = global.Ops.AGG_CHOICES.map((a) => ({ value: a, label: t('agg.' + a) }));
          control = multiList(spec.name, value, opts, { maxheight: 140 });
          break;
        }
        case 'select':
          control = `<select data-p="${attr(spec.name)}" data-kind="select">
            ${spec.options.map((o) => {
              const labelText = o.labelKey ? t(o.labelKey) : o.label;
              return `<option value="${attr(o.value)}"${String(value) === String(o.value) ? ' selected' : ''}>${esc(labelText)}</option>`;
            }).join('')}
          </select>`;
          break;
        case 'number':
          control = `<input type="number" data-p="${attr(spec.name)}" data-kind="number" value="${attr(value === undefined || value === null ? '' : value)}"
            ${spec.min !== undefined ? `min="${attr(spec.min)}"` : ''}${spec.max !== undefined ? `max="${attr(spec.max)}"` : ''}${spec.step !== undefined ? `step="${attr(spec.step)}"` : ''}>`;
          break;
        case 'text':
          control = `<input type="text" data-p="${attr(spec.name)}" data-kind="text" value="${attr(value === undefined || value === null ? '' : value)}" placeholder="${attr(spec.placeholder || '')}">`;
          break;
        case 'checkbox':
          control = `<label class="check"><input type="checkbox" data-p="${attr(spec.name)}" data-kind="bool" ${value ? 'checked' : ''}><span>${esc(spec.switchLabel || '')}</span></label>`;
          break;
        case 'dataset': {
          const list = (ctx.datasets || []);
          if (!list.length) {
            control = `<div class="muted" style="font-size:12px">${esc(t('pipeline.pickDatasetFirst'))}</div>`;
          } else {
            control = `<select data-p="${attr(spec.name)}" data-kind="select">${list.map((d) => `<option value="${attr(d.name)}"${d.name === value ? ' selected' : ''}>${esc(d.name)} · ${d.df.nrows}×${d.df.ncols}</option>`).join('')}</select>`;
          }
          break;
        }
        case 'expression':
          control = `<textarea data-p="${attr(spec.name)}" data-kind="text" spellcheck="false" placeholder="${attr(spec.placeholder || 'column_a * column_b')}">${esc(value || '')}</textarea>
            <div class="row" style="gap:6px"><span class="hint" data-expr-status="${attr(spec.name)}"></span></div>`;
          break;
        case 'conditionList':
          control = renderConditionList(value, df);
          break;
        default:
          control = `<input type="text" data-p="${attr(spec.name)}" data-kind="text" value="${attr(value || '')}">`;
      }
      const checkboxLike = spec.type === 'checkbox';
      out.push(`<div class="field${checkboxLike ? ' inline-check' : ''}" data-field-name="${attr(spec.name)}">
        ${checkboxLike ? '' : `<label>${esc(label)}</label>`}
        ${control}${hint}
      </div>`);
    }
    return `<div class="fields inline">${out.join('')}</div>`;
  }

  function renderConditionList(conditions, df) {
    const conds = conditions || [];
    const ops = Object.keys(DFm.FILTER_OPS);
    const opLabel = {
      eq: t('fop.eq'), ne: t('fop.ne'), gt: t('fop.gt'), ge: t('fop.ge'), lt: t('fop.lt'), le: t('fop.le'),
      between: t('fop.between'), contains: t('fop.contains'), startswith: t('fop.startswith'), endswith: t('fop.endswith'),
      in: t('fop.in'), notin: t('fop.notin'), isnull: t('fop.isnull'), notnull: t('fop.notnull'),
      isinlist: t('fop.isinlist'), regex: t('fop.regex'), even: t('fop.even'), odd: t('fop.odd'),
    };
    const opOrder = ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'between', 'contains', 'startswith', 'endswith', 'in', 'notin', 'regex', 'isnull', 'notnull', 'even', 'odd'];
    const rows = conds.map((c, i) => {
      const arity = (DFm.FILTER_OPS[c.op] || { arity: 1 }).arity;
      const needsValue = arity > 0;
      const values = df.categoricalColumns(60).includes(c.column) ? df.valueCounts(c.column, { top: 30 }).entries.map((e) => e.label) : null;
      return `<div class="cond-row" data-ci="${i}">
        <select data-cp="column">${df.names.map((n) => `<option value="${attr(n)}"${n === c.column ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <select data-cp="op" data-cop="${i}">${opOrder.map((o) => `<option value="${o}"${o === c.op ? ' selected' : ''}>${esc(opLabel[o])}</option>`).join('')}</select>
        ${needsValue
          ? `<input type="text" data-cp="value" value="${attr(c.value === undefined || c.value === null ? '' : c.value)}" list="dl-${i}" placeholder="${esc(t('param.value'))}">
             ${values ? `<datalist id="dl-${i}">${values.map((v) => `<option value="${attr(v)}"></option>`).join('')}</datalist>` : ''}`
          : '<span class="muted" style="font-size:11.5px;padding-left:2px">—</span>'}
        <div class="row" style="gap:2px">
          ${arity > 1 ? `<input type="text" data-cp="value2" value="${attr(c.value2 === undefined || c.value2 === null ? '' : c.value2)}" placeholder="${esc(t('param.upper'))}" style="width:74px">` : ''}
          <button class="icon-btn" data-remove-cond="${i}" title="${esc(t('pipeline.remove'))}">${icon('close')}</button>
        </div>
      </div>`;
    }).join('');
    return `<div class="cond-list" data-p="conditions" data-kind="conditions">${rows}
      <div><button class="btn sm" data-add-cond>${icon('plus')}${esc(t('pipeline.addStep'))}</button></div>
    </div>`;
  }

  /* ------------------------------------------------------------ data table */
  const DTYPE_CLASS = (dt) => `dtype-badge ${dt}`;

  /**
   * Renders the DataFrame grid.
   * view = { page, pageSize, sortCol, sortAsc, search, hidden:Set, heat, showIndex,
   *          headerSpark, minibars, selectedRow }
   * handlers = { onCell, onHeaderMenu, onSort, onPage, onRow }
   */
  function renderTable(df, view, handlers, opts) {
    const o = opts || {};
    const theme = o.theme || 'light';
    const cols = df.names.filter((n) => !view.hidden.has(n));
    if (!cols.length) return `<div class="empty-state">${icon('columns')}<h3>${esc(t('table.columnPicker'))}</h3></div>`;

    // ---- row selection: search → sort → page
    let rows = null;
    const q = (view.search || '').trim().toLowerCase();
    if (q) {
      rows = [];
      const targets = cols;
      for (let r = 0; r < df.nrows; r++) {
        for (const c of targets) {
          const v = df.at(r, c);
          if (!S.isMissing(v) && String(v).toLowerCase().includes(q)) { rows.push(r); break; }
        }
      }
    }
    if (view.sortCol && df.names.includes(view.sortCol)) {
      const base = rows || DFm.rangeArr(df.nrows);
      const asc = view.sortAsc !== false;
      rows = base.slice().sort((a, b) => {
        const c = DFm.compareValues(df.at(a, view.sortCol), df.at(b, view.sortCol));
        return asc ? c : -c;
      });
    }
    const total = rows ? rows.length : df.nrows;
    const pageSize = view.pageSize === 'all' ? Math.min(total, 5000) : Number(view.pageSize) || 50;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, view.page || 1), pages);
    const start = (page - 1) * pageSize;
    const slice = (rows ? rows.slice(start, start + pageSize) : DFm.rangeArr(Math.min(start, df.nrows), Math.min(start + pageSize, df.nrows)));

    // ---- per-column ranges for heat colouring and header sparklines
    const colStats = {};
    if (view.heat || view.headerSpark) {
      cols.forEach((c) => {
        const dtype = df.dtype(c);
        if (DFm.isNum(dtype)) {
          const vals = df.col(c);
          let mn = Infinity, mx = -Infinity;
          for (const v of vals) { const n = S.toNum(v); if (n !== null) { if (n < mn) mn = n; if (n > mx) mx = n; } }
          colStats[c] = { mn, mx };
        }
      });
    }

    const head = [];
    head.push(view.showIndex ? `<th class="idx">#</th>` : '');
    cols.forEach((c) => {
      const dtype = df.dtype(c);
      const isSorted = view.sortCol === c;
      const spark = view.headerSpark ? sparkline(df.col(c), dtype, { theme, height: 16 }) : '';
      head.push(`<th data-col="${attr(c)}" title="${attr(c + ' · ' + dtype)}">
        <div class="th-inner">
          <span class="th-name">${esc(c)}</span>
          ${isSorted ? `<span class="sort-caret">${view.sortAsc !== false ? '▲' : '▼'}</span>` : ''}
          <span class="th-menu"><button class="icon-btn" style="width:20px;height:20px" data-colmenu="${attr(c)}">${icon('chevron')}</button></span>
        </div>
        ${spark}
      </th>`);
    });

    const body = slice.map((r) => {
      const cells = [];
      if (view.showIndex) cells.push(`<td class="idx">${esc(df.index ? df.index[r] : r)}</td>`);
      cols.forEach((c) => {
        const v = df.at(r, c);
        const dtype = df.dtype(c);
        let style = '';
        if (view.heat && !S.isMissing(v) && DFm.isNum(dtype) && colStats[c] && colStats[c].mx > colStats[c].mn) {
          const norm = (S.toNum(v) - colStats[c].mn) / (colStats[c].mx - colStats[c].mn);
          const alpha = 0.06 + 0.38 * Math.max(0, Math.min(1, norm));
          style = heatStyle(alpha, theme);
        }
        const text = escapeTableText(formatCell(v, dtype));
        cells.push(`<td class="${cellClass(v, dtype)} cell-click" style="${style}" data-row="${r}" data-col="${attr(c)}" title="${attr(text)}">${text}</td>`);
      });
      return `<tr data-row="${r}"${view.selectedRow === r ? ' class="selected"' : ''}>${cells.join('')}</tr>`;
    }).join('');

    const from = total ? start + 1 : 0;
    const to = Math.min(start + pageSize, total);
    return {
      html: `<div class="table-scroll" style="${o.maxHeight ? `max-height:${o.maxHeight}` : ''}">
        <table class="df"><thead><tr>${head.join('')}</tr></thead><tbody>${body || `<tr><td colspan="${cols.length + 1}" style="padding:26px;text-align:center;color:var(--text-muted)">${esc(t('table.noRows'))}</td></tr>`}</tbody></table>
      </div>`,
      meta: { total, page, pages, pageSize, from, to, filtered: rows !== null },
    };
  }

  /** Cell text is escaped for HTML but keeps long strings intact. */
  function escapeTableText(s) {
    return esc(s);
  }

  /** Numeric colour scale used in table heat mode and legend hints. */
  function heatLegend(theme) {
    const T = theme === 'dark' ? 'color-mix(in srgb, var(--accent) 45%, transparent)' : 'color-mix(in srgb, var(--accent) 40%, transparent)';
    return `<span class="row" style="gap:4px;font-size:10.5px;color:var(--text-muted)">
      <span>min</span><span style="display:inline-block;width:52px;height:8px;border-radius:4px;background:linear-gradient(90deg,var(--bg-sunken),${T})"></span><span>max</span>
    </span>`;
  }

  global.UI = {
    esc, attr, debounce, fmtBytes, download, copyText, toast, menu, closeMenu, modal, confirmDialog,
    formatCell, cellClass, sparkline, renderFields, renderConditionList, renderTable, heatStyle,
    heatLegend, columnOptions, columnSelect, multiList, DTYPE_CLASS, icon,
  };
})(window);
