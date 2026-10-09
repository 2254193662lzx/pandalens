/* =============================================================================
 * charts.js — the chart registry.
 *
 * Each entry declares the parameters the UI should render, how to turn the
 * current DataFrame into an ECharts option, and (where it is meaningful) a short
 * natural-language insight derived from the data, so the visualisation also
 * *explains* what it shows.
 * ========================================================================== */
(function (global) {
  'use strict';

  const S = global.Stats;
  const DFm = global.DF;
  const { AGG_FUNCS, AGG_LABEL, formatDatetime, isDatetime } = DFm;
  const t = (k, p) => global.I18N.t(k, p);

  const PALETTE = ['#4f8cff', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#0ea5e9', '#a855f7', '#eab308'];

  const THEMES = {
    light: {
      text: '#1f2937', subtext: '#6b7280', axis: '#d1d5db', split: '#eef1f6',
      tooltipBg: 'rgba(255,255,255,0.97)', tooltipBorder: '#e2e8f0', tooltipText: '#111827',
      palette: PALETTE, empty: '#f3f4f6',
    },
    dark: {
      text: '#e5e7eb', subtext: '#9ca3af', axis: '#374151', split: '#1f2937',
      tooltipBg: 'rgba(17,24,39,0.97)', tooltipBorder: '#374151', tooltipText: '#f9fafb',
      palette: PALETTE, empty: '#111827',
    },
  };

  function base(theme) {
    const T = THEMES[theme] || THEMES.light;
    return {
      __T: T,
      color: T.palette,
      backgroundColor: 'transparent',
      textStyle: { color: T.text, fontFamily: 'Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif' },
      grid: { left: 58, right: 26, top: 46, bottom: 54, containLabel: true },
      animationDuration: 420,
      tooltip: {
        backgroundColor: T.tooltipBg,
        borderColor: T.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: T.tooltipText, fontSize: 12 },
        extraCssText: 'box-shadow:0 8px 24px rgba(15,23,42,.14);border-radius:10px;padding:8px 10px;',
      },
      title: { show: false },
    };
  }

  function axis(theme, opts) {
    const T = THEMES[theme] || THEMES.light;
    return Object.assign({
      axisLine: { lineStyle: { color: T.axis } },
      axisTick: { show: false },
      axisLabel: { color: T.subtext, fontSize: 11, hideOverlap: true },
      splitLine: { lineStyle: { color: T.split } },
      nameTextStyle: { color: T.subtext, fontSize: 11 },
    }, opts || {});
  }

  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

  /** Groups a frame by one or more key columns, keeping insertion order. */
  function groupKeys(df, byCols) {
    const idx = byCols.map((c) => df.colIndex(c));
    const order = [];
    const map = new Map();
    for (let r = 0; r < df.nrows; r++) {
      const k = idx.map((i) => DFm.formatValue(df.values[i][r], df.dtypes[i])).join('\u0001');
      if (!map.has(k)) { map.set(k, []); order.push(k); }
      map.get(k).push(r);
    }
    return { order, map, labels: idx.map((i) => df.names[i]) };
  }

  function applyAgg(values, fn) {
    const clean = values.filter((v) => !S.isMissing(v));
    if (fn === 'count') return clean.length;
    if (!clean.length) return null;
    const f = AGG_FUNCS[fn] || AGG_FUNCS.mean;
    const numeric = fn !== 'nunique' && fn !== 'mode' && fn !== 'first' && fn !== 'last' && fn !== 'concat';
    return numeric ? f(clean) : f(values);
  }

  /** Aggregate x-category × y-column into chart-ready series. */
  function aggregateSeries(df, xCol, yCols, aggFn) {
    const g = groupKeys(df, [xCol]);
    const labels = g.order.map((k) => k);
    const series = yCols.map((y) => {
      const ci = df.colIndex(y);
      return {
        name: y,
        data: g.order.map((k) => {
          const rows = g.map.get(k);
          const vals = rows.map((r) => df.values[ci][r]);
          const v = applyAgg(vals, aggFn);
          return v === null || (typeof v === 'number' && !Number.isFinite(v)) ? null : v;
        }),
      };
    });
    return { labels, series };
  }

  function sortCategories(labels, series, sortMode, topN) {
    let idx = labels.map((_, i) => i);
    if (sortMode && sortMode !== 'none') {
      const key = (i) => (series[0].data[i] === null ? -Infinity : series[0].data[i]);
      idx.sort((a, b) => (sortMode === 'desc' ? key(b) - key(a) : key(a) - key(b)));
    }
    if (topN && topN > 0) idx = idx.slice(0, topN);
    return {
      labels: idx.map((i) => labels[i]),
      series: series.map((s) => Object.assign({}, s, { data: idx.map((i) => s.data[i]) })),
    };
  }

  function numericPairs(df, x, y, extra) {
    const xi = df.colIndex(x), yi = df.colIndex(y);
    const out = [];
    for (let r = 0; r < df.nrows; r++) {
      const a = S.toNum(df.values[xi][r]), b = S.toNum(df.values[yi][r]);
      if (a === null || b === null) continue;
      const row = { x: a, y: b, r };
      if (extra) extra.forEach((e) => { row[e.name] = e.value(r); });
      out.push(row);
    }
    return out;
  }

  /** Down-samples large point clouds while keeping the visual shape. */
  function samplePoints(points, max) {
    if (points.length <= max) return points;
    const step = points.length / max;
    const out = [];
    for (let i = 0; i < points.length; i += step) out.push(points[Math.floor(i)]);
    return out;
  }

  /**
   * Default categorical column for a chart: prefer real categories (few distinct
   * values) over identifiers, which is what a human would pick first.
   */
  const CAT = (df) => {
    const cands = df.categoricalColumns(30).map((c) => ({
      name: c,
      n: new Set(df.col(c).filter((v) => !S.isMissing(v)).map(String)).size,
    })).filter((c) => c.n > 1);
    cands.sort((a, b) => {
      // prefer genuine multi-level categories over binary flags / identifiers
      const prefer = (x) => (x.n >= 3 && x.n <= 12 ? 0 : x.n === 2 ? 1 : x.n <= 30 ? 2 : 3);
      return prefer(a) - prefer(b) || a.n - b.n;
    });
    return cands.map((c) => c.name);
  };
  const NUMC = (df) => df.numericColumns();

  /**
   * Preferred numeric column for a chart: a rich continuous measure beats a
   * near-constant one (year, month) or an identifier-like integer.
   */
  const pickNumeric = (df, skip) => {
    const skipSet = new Set(skip || []);
    const scored = df.numericColumns().filter((c) => !skipSet.has(c)).map((c) => {
      const vals = df.col(c);
      const uniq = new Set(vals.map((v) => (S.isMissing(v) ? '\u0000' : v))).size;
      const integer = df.dtype(c) === 'int64';
      const idLike = integer && uniq === df.nrows && df.nrows > 50;
      let score = 0;
      if (uniq <= 2) score = 1;
      else if (uniq <= 12 && integer) score = 2;
      else if (uniq <= 20) score = 3;
      else if (idLike) score = 4;
      else score = 10;
      if (integer && !idLike) score += 0.5;              // counts are still useful
      return { c, score, uniq };
    });
    scored.sort((a, b) => b.score - a.score || a.uniq - b.uniq);
    return scored.length ? scored.map((s) => s.c) : df.numericColumns();
  };

  /* ------------------------------------------------------------------ registry */
  const CHARTS = {
    histogram: {
      icon: 'hist', labelKey: 'chart.histogram', group: 'distribution',
      aboutKey: 'chart.histogram.about',
      params: [
        { name: 'columns', type: 'columns', labelKey: 'param.columns', numericOnly: true, default: [] },
        { name: 'bins', type: 'number', labelKey: 'param.bins', default: 0, min: 0, step: 1, hintKey: 'hint.autoBins' },
        { name: 'groupBy', type: 'column', labelKey: 'param.splitBy', allowEmpty: true, default: '' },
        { name: 'kde', type: 'checkbox', labelKey: 'param.showCurve', default: true },
        { name: 'stack', type: 'select', labelKey: 'param.splitLayout', options: [{ value: 'overlay', labelKey: 'split.overlay' }, { value: 'stack', labelKey: 'split.stack' }, { value: 'grid', labelKey: 'split.grid' }], default: 'overlay', when: (p) => !!p.groupBy },
      ],
      defaults: (df) => ({ columns: pickNumeric(df).slice(0, 1), bins: 0, groupBy: '', kde: true, stack: 'overlay' }),
      build: (df, p, theme) => {
        const cols = (p.columns || []).filter((c) => df.names.includes(c) && DFm.isNum(df.dtype(c)));
        if (!cols.length) return { error: t('err.pickNumeric') };
        const opt = base(theme);
        const T = opt.__T;
        const cats = p.groupBy ? groupKeys(df, [p.groupBy]).order : [null];
        const groupMap = p.groupBy ? groupKeys(df, [p.groupBy]) : null;
        const warns = [];
        const ci = cols.map((c) => df.colIndex(c));
        const allValues = cols.flatMap((c, k) => df.values[ci[k]].filter((v) => !S.isMissing(v)));
        if (!allValues.length) return { error: t('err.emptyColumn') };
        const bins = p.bins && p.bins > 0 ? p.bins : S.autoBins(allValues.map(S.toNum).filter((v) => v !== null));
        const lo = S.min(allValues), hi = S.max(allValues);

        if (cols.length === 1) {
          if (p.groupBy && p.stack !== 'grid') {
            const series = cats.map((cat) => {
              const rows = groupMap.map.get(cat);
              const vals = rows.map((r) => S.toNum(df.values[ci[0]][r])).filter((v) => v !== null);
              const h = S.histogram(vals, bins, [lo, hi]);
              return { name: cat === null ? '—' : cat, h, vals, rows };
            });
            if (p.stack === 'stack') {
              opt.xAxis = axis(theme, { type: 'category', data: series[0].h.centers.map((c) => S.fmt.compact(c)), name: cols[0], nameLocation: 'middle', nameGap: 30 });
              opt.yAxis = axis(theme, { type: 'value', name: t('label.count') });
              opt.series = series.map((s) => ({
                name: s.name, type: 'bar', stack: 'total', data: s.h.counts, barGap: '0%', barCategoryGap: '6%',
                emphasis: { focus: 'series' },
              }));
              opt.legend = { top: 4, textStyle: { color: T.subtext }, type: 'scroll' };
              opt.tooltip = Object.assign(opt.tooltip, { trigger: 'axis', axisPointer: { type: 'shadow' } });
            } else {
              const s0 = series[0];
              const step = (hi - lo) / bins;
              opt.xAxis = axis(theme, { type: 'category', data: s0.h.centers.map((c) => S.fmt.compact(c)), name: cols[0], nameLocation: 'middle', nameGap: 30 });
              opt.yAxis = axis(theme, { type: 'value', name: t('label.density') });
              // normalise each group so overlays are comparable, like seaborn
              opt.series = series.map((s) => ({
                name: s.name, type: 'line', smooth: true, symbol: 'none', step: false,
                areaStyle: { opacity: 0.16 },
                data: s.h.counts.map((c) => (s.rows.length ? c / s.rows.length / step : 0)),
                lineStyle: { width: 2 },
              }));
              opt.legend = { top: 4, textStyle: { color: T.subtext }, type: 'scroll' };
              opt.tooltip = Object.assign(opt.tooltip, { trigger: 'axis' });
            }
          } else if (p.groupBy && p.stack === 'grid') {
            const n = cats.length;
            const colCount = Math.min(2, n);
            const rowsCount = Math.ceil(n / colCount);
            opt.grid = [];
            opt.xAxis = []; opt.yAxis = []; opt.series = []; opt.title = [];
            cats.forEach((cat, k) => {
              const rows = groupMap.map.get(cat);
              const vals = rows.map((r) => S.toNum(df.values[ci[0]][r])).filter((v) => v !== null);
              const h = S.histogram(vals, bins, [lo, hi]);
              const cx = k % colCount, cy = Math.floor(k / colCount);
              const left = 8 + cx * (84 / colCount), top = 14 + cy * (80 / rowsCount);
              const w = 84 / colCount - 8, hh = 80 / rowsCount - 14;
              opt.grid.push({ left: left + '%', top: top + '%', width: w + '%', height: hh + '%' });
              opt.title.push({ text: String(cat), left: left + '%', top: (top - 7) + '%', textStyle: { fontSize: 11, color: T.subtext, fontWeight: 'normal' } });
              opt.xAxis.push(axis(theme, { type: 'category', gridIndex: k, data: h.centers.map((c) => S.fmt.compact(c)), axisLabel: { fontSize: 9, color: T.subtext, showMaxLabel: true } }));
              opt.yAxis.push(axis(theme, { type: 'value', gridIndex: k, axisLabel: { fontSize: 9, color: T.subtext }, splitLine: { show: false } }));
              opt.series.push({ type: 'bar', xAxisIndex: k, yAxisIndex: k, data: h.counts, itemStyle: { borderRadius: [2, 2, 0, 0] }, color: PALETTE[k % PALETTE.length] });
            });
          } else {
            const vals = df.values[ci[0]].map(S.toNum).filter((v) => v !== null);
            const h = S.histogram(vals, bins, [lo, hi]);
            opt.xAxis = axis(theme, { type: 'category', data: h.centers.map((c) => S.fmt.compact(c)), name: cols[0], nameLocation: 'middle', nameGap: 28 });
            opt.yAxis = axis(theme, { type: 'value', name: t('label.count') });
            const centerStep = h.edges.length > 1 ? h.edges[1] - h.edges[0] : 1;
            opt.series = [{
              name: cols[0], type: 'bar', data: h.counts,
              itemStyle: { borderRadius: [3, 3, 0, 0], color: PALETTE[0], opacity: 0.86 },
            }];
            const distinct = new Set(vals).size;
            if (p.kde && vals.length > 2 && distinct > 8) {
              const grid = [];
              const steps = 120;
              for (let i = 0; i <= steps; i++) grid.push(h.lo + (i * (h.hi - h.lo)) / steps);
              const dens = S.kde(vals, grid);
              const scaled = dens.map((d) => d * vals.length * centerStep);
              opt.series.push({
                name: t('label.kde'), type: 'line', smooth: true, symbol: 'none', z: 3,
                data: grid.map((g, i) => [Math.round(((g - h.lo) / centerStep) * 100) / 100, scaled[i]]),
                lineStyle: { width: 2.2, color: PALETTE[3] },
              });
            }
            const nOut = vals.length;
            warns.push(t('note.rowsUsed', { n: nOut, total: df.nrows }));
          }
          opt.tooltip.trigger = opt.tooltip.trigger || 'axis';
        } else {
          // multiple columns → grouped bars of counts (pandas' df.hist side by side)
          const series = cols.map((c, k) => {
            const vals = df.values[ci[k]].map(S.toNum).filter((v) => v !== null);
            const h = S.histogram(vals, bins, [lo, hi]);
            return { name: c, zeros: h.counts, vals };
          });
          opt.xAxis = axis(theme, { type: 'category', data: series[0].zeros.map((_, i) => {
            const w = (hi - lo) / bins;
            return S.fmt.compact(S.histogram(series[0].vals, bins, [lo, hi]).edges[i]);
          }), name: t('label.bins'), nameLocation: 'middle', nameGap: 28 });
          opt.yAxis = axis(theme, { type: 'value', name: t('label.count') });
          opt.series = series.map((s, k) => ({ name: s.name, type: 'bar', data: s.zeros, itemStyle: { borderRadius: [3, 3, 0, 0], opacity: 0.9 } }));
          opt.legend = { top: 4, textStyle: { color: T.subtext }, type: 'scroll' };
          opt.tooltip.trigger = 'axis';
        }
        const insight = (() => {
          const vals = allValues.map(S.toNum).filter((v) => v !== null);
          const st = S.summary(vals);
          const shape = st.skew === null ? '—' : st.skew > 0.5 ? t('insight.rightSkewed') : st.skew < -0.5 ? t('insight.leftSkewed') : t('insight.symmetric');
          return t('insight.histogram', { n: st.count, mean: S.fmt.num(st.mean), median: S.fmt.num(st.median), std: S.fmt.num(st.std), shape });
        })();
        return { option: opt, insight, notes: warns };
      },
    },

    bar: {
      icon: 'bar', labelKey: 'chart.bar', group: 'comparison',
      aboutKey: 'chart.bar.about',
      params: [
        { name: 'x', type: 'column', labelKey: 'param.category', default: '' },
        { name: 'y', type: 'columns', labelKey: 'param.valueColumns', numericOnly: true, allowEmpty: true, default: [] },
        { name: 'agg', type: 'select', labelKey: 'param.aggregations', options: [
          { value: 'count', labelKey: 'agg.count' }, { value: 'sum', labelKey: 'agg.sum' },
          { value: 'mean', labelKey: 'agg.mean' }, { value: 'median', labelKey: 'agg.median' },
          { value: 'max', labelKey: 'agg.max' }, { value: 'min', labelKey: 'agg.min' }], default: 'sum' },
        { name: 'splitBy', type: 'column', labelKey: 'param.splitBy', allowEmpty: true, default: '' },
        { name: 'layout', type: 'select', labelKey: 'param.splitLayout', options: [{ value: 'group', labelKey: 'split.group' }, { value: 'stack', labelKey: 'split.stack' }], default: 'stack', when: (p) => !!p.splitBy },
        { name: 'sort', type: 'select', labelKey: 'param.sort', options: [{ value: 'desc', labelKey: 'sort.desc' }, { value: 'asc', labelKey: 'sort.asc' }, { value: 'none', labelKey: 'sort.none' }], default: 'desc' },
        { name: 'topN', type: 'number', labelKey: 'param.topN', default: 0, min: 0, step: 1, hintKey: 'hint.zeroAll' },
        { name: 'horizontal', type: 'checkbox', labelKey: 'param.horizontal', default: false },
      ],
      defaults: (df) => ({ x: CAT(df)[0] || df.names[0], y: pickNumeric(df).slice(0, 1), agg: 'sum', splitBy: '', layout: 'stack', sort: 'desc', topN: 0, horizontal: false }),
      build: (df, p, theme) => {
        if (!p.x || !df.names.includes(p.x)) return { error: t('err.pickColumn') };
        const y = (p.y || []).filter((c) => df.names.includes(c));
        const opt = base(theme);
        const T = opt.__T;
        const aggFn = y.length ? p.agg : 'count';
        let series, labels;
        if (p.splitBy && p.splitBy !== p.x) {
          const inner = aggregateSeries(df, p.x, y.length ? y : [df.names[0]], aggFn);
          const outer = groupKeys(df, [p.x, p.splitBy]);
          const catSet = new Set(df.col(p.x).map((v) => DFm.formatValue(v, df.dtype(p.x))));
          const labs = [...catSet];
          const splitVals = [...new Set(df.col(p.splitBy).map((v) => DFm.formatValue(v, df.dtype(p.splitBy))))];
          const ci = y.length ? df.colIndex(y[0]) : null;
          const lookup = new Map();
          for (const k of outer.order) {
            const [a, b] = k.split('\u0001');
            const rows = outer.map.get(k);
            const val = ci === null ? rows.length : applyAgg(rows.map((r) => df.values[ci][r]), aggFn);
            lookup.set(a + '\u0001' + b, val);
          }
          labels = labs;
          series = splitVals.map((sv) => ({
            name: sv,
            data: labs.map((a) => {
              const v = lookup.get(a + '\u0001' + sv);
              return v === undefined ? null : v;
            }),
          }));
          void inner;
        } else {
          const res = aggregateSeries(df, p.x, y.length ? y : [df.names[0]], aggFn);
          labels = res.labels; series = res.series;
        }
        const sorted = sortCategories(labels, series, p.sort, p.topN);
        const catAxis = { type: 'category', data: sorted.labels, name: p.x, nameLocation: 'middle', nameGap: 32 };
        const valAxis = { type: 'value', name: y.length === 1 ? `${AGG_LABEL[aggFn] || aggFn}(${y[0]})` : t('label.count') };
        opt.xAxis = axis(theme, p.horizontal ? valAxis : catAxis);
        opt.yAxis = axis(theme, p.horizontal ? catAxis : valAxis);
        opt.series = sorted.series.map((s) => ({
          name: s.name, type: 'bar',
          data: s.data,
          stack: p.splitBy && p.layout === 'stack' ? 'total' : undefined,
          barMaxWidth: 46,
          itemStyle: { borderRadius: p.horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0], opacity: 0.92 },
          emphasis: { focus: 'series' },
          label: p.splitBy ? undefined : { show: sorted.labels.length <= 12, position: p.horizontal ? 'right' : 'top', fontSize: 10, color: T.subtext, formatter: (d) => S.fmt.num(d.value) },
        }));
        if (sorted.series.length > 1) opt.legend = { top: 4, textStyle: { color: T.subtext }, type: 'scroll' };
        opt.tooltip.trigger = 'axis';
        opt.tooltip.axisPointer = { type: 'shadow' };
        const total = sorted.series.reduce((acc, s) => acc + s.data.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0), 0);
        const top = sorted.labels.length ? { label: sorted.labels[0], value: sorted.series[0].data[0] } : null;
        const insight = top && total ? t('insight.bar', {
          label: top.label, value: S.fmt.num(top.value),
          pct: S.fmt.pct((Number(top.value) || 0) / total, 1),
          n: sorted.labels.length,
        }) : null;
        return { option: opt, insight };
      },
    },

    line: {
      icon: 'line', labelKey: 'chart.line', group: 'comparison',
      aboutKey: 'chart.line.about',
      params: [
        { name: 'x', type: 'column', labelKey: 'param.xAxis', default: '' },
        { name: 'y', type: 'columns', labelKey: 'param.valueColumns', numericOnly: true, default: [] },
        { name: 'agg', type: 'select', labelKey: 'param.aggregations', options: [
          { value: 'mean', labelKey: 'agg.mean' }, { value: 'sum', labelKey: 'agg.sum' },
          { value: 'median', labelKey: 'agg.median' }, { value: 'count', labelKey: 'agg.count' },
          { value: 'max', labelKey: 'agg.max' }, { value: 'min', labelKey: 'agg.min' }], default: 'mean' },
        { name: 'splitBy', type: 'column', labelKey: 'param.splitBy', allowEmpty: true, default: '' },
        { name: 'smooth', type: 'checkbox', labelKey: 'param.smooth', default: false },
        { name: 'area', type: 'checkbox', labelKey: 'param.area', default: false },
        { name: 'stack', type: 'checkbox', labelKey: 'param.stacked', default: false },
      ],
      defaults: (df) => {
        const dt = df.datetimeColumns()[0];
        const cat = CAT(df)[0];
        return { x: dt || cat || df.names[0], y: pickNumeric(df).slice(0, 2), agg: 'mean', splitBy: '', smooth: false, area: false, stack: false };
      },
      build: (df, p, theme) => {
        if (!p.x || !df.names.includes(p.x)) return { error: t('err.pickColumn') };
        const y = (p.y || []).filter((c) => df.names.includes(c));
        if (!y.length) return { error: t('err.pickNumeric') };
        const opt = base(theme);
        const T = opt.__T;
        const isTime = isDatetime(df.dtype(p.x));
        let labels, series;
        if (p.splitBy && p.splitBy !== p.x && !y.includes(p.splitBy)) {
          const xVals = [...new Set(df.col(p.x).map((v) => DFm.formatValue(v, df.dtype(p.x))))];
          xVals.sort(isTime ? (a, b) => String(a).localeCompare(String(b)) : (a, b) => a.localeCompare(b, undefined, { numeric: true }));
          const groups = groupKeys(df, [p.splitBy]);
          const xi = df.colIndex(p.x), yi = df.colIndex(y[0]);
          series = groups.order.map((gname) => {
            const byX = new Map();
            for (const r of groups.map.get(gname)) {
              const k = DFm.formatValue(df.values[xi][r], df.dtype(p.x));
              if (!byX.has(k)) byX.set(k, []);
              byX.get(k).push(df.values[yi][r]);
            }
            return { name: gname, data: xVals.map((k) => (byX.has(k) ? applyAgg(byX.get(k), p.agg) : null)) };
          });
          labels = xVals;
        } else {
          const res = aggregateSeries(df, p.x, y, p.agg);
          labels = res.labels;
          const order = labels.map((l, i) => [l, i]);
          order.sort((a, b) => (isTime ? String(a[0]).localeCompare(String(b[0])) : a[0].localeCompare(b[0], undefined, { numeric: true })));
          labels = order.map((o) => o[0]);
          series = res.series.map((s) => Object.assign({}, s, { data: order.map((o) => s.data[o[1]]) }));
        }
        opt.xAxis = axis(theme, {
          type: 'category', data: labels, name: p.x, nameLocation: 'middle', nameGap: 32,
          boundaryGap: false, axisLabel: { color: T.subtext, fontSize: 11, hideOverlap: true, rotate: labels.length > 14 ? 30 : 0 },
        });
        opt.yAxis = axis(theme, { type: 'value', name: y.length === 1 ? y[0] : '' });
        opt.series = series.map((s, k) => ({
          name: s.name, type: 'line', smooth: !!p.smooth, symbol: labels.length > 60 ? 'none' : 'circle', symbolSize: 5,
          data: s.data, connectNulls: false, stack: p.stack ? 'total' : undefined,
          areaStyle: p.area ? { opacity: 0.15 } : undefined, lineStyle: { width: 2.2 },
          emphasis: { focus: 'series' },
        }));
        opt.legend = { top: 4, textStyle: { color: T.subtext }, type: 'scroll' };
        opt.tooltip.trigger = 'axis';
        opt.dataZoom = labels.length > 30 ? [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 6 }] : undefined;
        const allVals = series[0] ? series[0].data.filter((v) => Number.isFinite(v)) : [];
        const insight = allVals.length > 1
          ? t('insight.line', {
            n: labels.length, first: labels[0], last: labels[labels.length - 1],
            change: S.fmt.num(((allVals[allVals.length - 1] - allVals[0]) / (Math.abs(allVals[0]) || 1)) * 100, 1),
          })
          : null;
        return { option: opt, insight };
      },
    },

    scatter: {
      icon: 'scatter', labelKey: 'chart.scatter', group: 'relationship',
      aboutKey: 'chart.scatter.about',
      params: [
        { name: 'x', type: 'column', labelKey: 'param.xAxis', numericOnly: true, default: '' },
        { name: 'y', type: 'column', labelKey: 'param.yAxis', numericOnly: true, default: '' },
        { name: 'colorBy', type: 'column', labelKey: 'param.colorBy', allowEmpty: true, default: '' },
        { name: 'colorNumeric', type: 'checkbox', labelKey: 'param.colorAsScale', default: false, when: (p) => !!p.colorBy },
        { name: 'sizeBy', type: 'column', labelKey: 'param.sizeBy', numericOnly: true, allowEmpty: true, default: '' },
        { name: 'trend', type: 'checkbox', labelKey: 'param.trendline', default: true },
        { name: 'ellipse', type: 'checkbox', labelKey: 'param.groupEllipses', default: false, when: (p) => !!p.colorBy && !p.colorNumeric },
        { name: 'logX', type: 'checkbox', labelKey: 'param.logX', default: false },
        { name: 'logY', type: 'checkbox', labelKey: 'param.logY', default: false },
        { name: 'opacity', type: 'number', labelKey: 'param.opacity', default: 0.75, min: 0.05, max: 1, step: 0.05 },
      ],
      defaults: (df) => {
        const n = pickNumeric(df);
        const cat = CAT(df).filter((c) => new Set(df.col(c).map(String)).size <= 12)[0];
        return { x: n[0], y: n[1] || n[0], colorBy: cat || '', colorNumeric: false, sizeBy: '', trend: true, ellipse: false, logX: false, logY: false, opacity: 0.75 };
      },
      build: (df, p, theme) => {
        if (!p.x || !p.y) return { error: t('err.pickTwoNumeric') };
        const opt = base(theme);
        const T = opt.__T;
        const sizeBy = p.sizeBy && p.sizeBy !== p.x && p.sizeBy !== p.y ? p.sizeBy : null;
        const points = numericPairs(df, p.x, p.y, [
          p.colorBy ? { name: '__color', value: (r) => df.at(r, p.colorBy) } : null,
          sizeBy ? { name: '__size', value: (r) => df.at(r, sizeBy) } : null,
        ].filter(Boolean));
        if (!points.length) return { error: t('err.noNumericPairs') };
        const shown = samplePoints(points, 6000);
        const sizeScale = (() => {
          if (!sizeBy) return null;
          const vals = points.map((d) => S.toNum(d.__size)).filter((v) => v !== null);
          const mn = S.min(vals), mx = S.max(vals);
          return (v) => { const n = S.toNum(v); if (n === null || mx === mn) return 6; return 5 + 18 * ((n - mn) / (mx - mn)); };
        })();
        opt.grid = { left: 66, right: 30, top: 40, bottom: 56, containLabel: true };
        opt.xAxis = axis(theme, { type: p.logX ? 'log' : 'value', name: p.x, nameLocation: 'middle', nameGap: 30, scale: true });
        opt.yAxis = axis(theme, { type: p.logY ? 'log' : 'value', name: p.y, nameLocation: 'middle', nameGap: 42, scale: true });

        if (p.colorBy && p.colorNumeric) {
          const cvals = points.map((d) => S.toNum(d.__color)).filter((v) => v !== null);
          const mn = S.min(cvals), mx = S.max(cvals);
          opt.visualMap = {
            min: mn, max: mx, dimension: 2, calculable: true, orient: 'vertical', right: 8, top: 'middle',
            textStyle: { color: T.subtext, fontSize: 11 },
            inRange: { color: ['#3b82f6', '#22d3ee', '#facc15', '#f97316', '#ef4444'] },
          };
          opt.series = [{
            type: 'scatter',
            data: shown.map((d) => [d.x, d.y, S.toNum(d.__color)]),
            symbolSize: sizeBy ? (d) => sizeScale(d[2]) : 7,
            itemStyle: { opacity: p.opacity },
            large: shown.length > 2000, largeThreshold: 2000, progressive: 4000, progressiveThreshold: 4000,
            emphasis: { itemStyle: { borderColor: '#fff', borderWidth: 1 } },
          }];
        } else if (p.colorBy) {
          const groups = groupKeys(df, [p.colorBy]);
          const groupOf = new Map();
          groupKeys(df, [p.colorBy]).order.forEach((g, gi) => groupOf.set(g, gi));
          const bucket = new Map();
          const keyOfRow = (r) => DFm.formatValue(df.at(r, p.colorBy), df.dtype(p.colorBy));
          shown.forEach((d) => {
            const k = keyOfRow(d.r);
            if (!bucket.has(k)) bucket.set(k, []);
            bucket.get(k).push(sizeBy ? [d.x, d.y, S.toNum(d.__size)] : [d.x, d.y]);
          });
          if (bucket.size > 14) return { error: t('err.tooManyCategories', { n: bucket.size }) };
          opt.legend = { top: 4, type: 'scroll', textStyle: { color: T.subtext } };
          opt.series = [...bucket.entries()].map(([name, data], k) => ({
            name, type: 'scatter', data,
            symbolSize: sizeBy ? (d) => sizeScale(d[2]) : 7,
            itemStyle: { opacity: p.opacity },
            large: data.length > 2000, largeThreshold: 2000, progressive: 4000,
            emphasis: { focus: 'series', itemStyle: { borderColor: '#fff', borderWidth: 1 } },
            color: PALETTE[k % PALETTE.length],
          }));
          if (p.ellipse) {
            // 1-sigma ellipse per group, drawn as a parametric polyline
            const ellipses = [...bucket.entries()].map(([name, data], k) => {
              const xs = data.map((d) => d[0]), ys = data.map((d) => d[1]);
              const mx = S.mean(xs), my = S.mean(ys), sx = S.std(xs, 0) || 0, sy = S.std(ys, 0) || 0;
              const pts = [];
              for (let a = 0; a <= 360; a += 6) {
                const rad = (a * Math.PI) / 180;
                pts.push([mx + Math.cos(rad) * sx, my + Math.sin(rad) * sy]);
              }
              return {
                name: `${name} 1σ`, type: 'line', data: pts, symbol: 'none', showSymbol: false,
                silent: true, z: 3, tooltip: { show: false },
                lineStyle: { color: PALETTE[k % PALETTE.length], type: 'dashed', width: 1.5, opacity: 0.9 },
                itemStyle: { opacity: 0 },
              };
            });
            opt.series = opt.series.concat(ellipses);
          }
        } else {
          opt.series = [{
            type: 'scatter',
            data: shown.map((d) => (sizeBy ? [d.x, d.y, S.toNum(d.__size)] : [d.x, d.y])),
            symbolSize: sizeBy ? (d) => sizeScale(d[2]) : 7,
            itemStyle: { opacity: p.opacity, color: PALETTE[0] },
            large: shown.length > 2000, largeThreshold: 2000, progressive: 4000,
            emphasis: { itemStyle: { borderColor: '#fff', borderWidth: 1.5 } },
          }];
        }
        let insight = null;
        if (p.trend) {
          const reg = S.linreg(points.map((d) => d.x), points.map((d) => d.y));
          if (reg) {
            opt.series.push({
              name: 'OLS', type: 'line', symbol: 'none', silent: true, z: 5,
              data: [[reg.xMin, reg.intercept + reg.slope * reg.xMin], [reg.xMax, reg.intercept + reg.slope * reg.xMax]],
              lineStyle: { width: 2.2, color: PALETTE[3], type: 'solid' },
              tooltip: { show: false },
              endLabel: undefined,
            });
            const strength = Math.abs(reg.r2) > 0.64 ? t('insight.strong') : Math.abs(reg.r2) > 0.25 ? t('insight.moderate') : t('insight.weak');
            insight = t('insight.scatter', {
              n: points.length, slope: S.fmt.num(reg.slope, 3), r2: S.fmt.num(reg.r2, 3), strength,
              dir: reg.slope > 0 ? t('insight.positive') : t('insight.negative'),
            });
          }
        } else if (points.length < df.nrows) {
          insight = t('note.rowsUsed', { n: points.length, total: df.nrows });
        }
        opt.tooltip.trigger = 'item';
        opt.tooltip.formatter = (d) => {
          const v = Array.isArray(d.value) ? d.value : [d.value];
          const lines = [`<b>${p.x}</b>: ${S.fmt.num(v[0])}`, `<b>${p.y}</b>: ${S.fmt.num(v[1])}`];
          if (p.colorBy && sizeBy) lines.push(`<b>${p.colorBy}</b>: ${v[2]}`);
          return `<div style="font-size:12px">${lines.join('<br/>')}</div>`;
        };
        const notes = [t('note.rowsUsed', { n: points.length, total: df.nrows })];
        if (shown.length < points.length) notes.push(t('note.sampled', { n: shown.length }));
        return { option: opt, insight, notes };
      },
    },

    box: {
      icon: 'box', labelKey: 'chart.box', group: 'distribution',
      aboutKey: 'chart.box.about',
      params: [
        { name: 'value', type: 'columns', labelKey: 'param.valueColumns', numericOnly: true, default: [] },
        { name: 'groupBy', type: 'column', labelKey: 'param.groupBy', allowEmpty: true, default: '' },
        { name: 'showPoints', type: 'checkbox', labelKey: 'param.showPoints', default: true },
        { name: 'showOutliers', type: 'checkbox', labelKey: 'param.showOutliers', default: true },
        { name: 'whis', type: 'number', labelKey: 'param.whisker', default: 1.5, min: 0, step: 0.5 },
      ],
      defaults: (df) => {
        const cat = CAT(df).find((c) => new Set(df.col(c).map(String)).size <= 20);
        return { value: pickNumeric(df).slice(0, 1), groupBy: cat || '', showPoints: true, showOutliers: true, whis: 1.5 };
      },
      build: (df, p, theme) => {
        const vals = (p.value || []).filter((c) => df.names.includes(c));
        if (!vals.length) return { error: t('err.pickNumeric') };
        const opt = base(theme);
        const T = opt.__T;
        const cats = p.groupBy ? groupKeys(df, [p.groupBy]).order : null;
        const labels = cats || vals;
        const boxData = [];
        const scatter = [];
        const notes = [];
        const groupMap = p.groupBy ? groupKeys(df, [p.groupBy]) : null;
        labels.forEach((g, k) => {
          vals.forEach((v) => {
            const rows = cats ? groupMap.map.get(g) : null;
            const raw = cats ? rows.map((r) => df.at(r, v)) : df.col(v);
            const bs = S.boxStats(raw, p.whis);
            if (!bs) return;
            boxData.push([bs.whiskerLow, bs.q1, bs.q2, bs.q3, bs.whiskerHigh]);
            if (p.showOutliers) bs.outliers.slice(0, 200).forEach((o) => scatter.push([cats ? String(g) : v, o]));
          });
        });
        if (p.groupBy && vals.length > 1) {
          const names = [];
          labels.forEach((g) => vals.forEach((v) => names.push(`${g}\n${v}`)));
          opt.xAxis = axis(theme, { type: 'category', data: names, axisLabel: { color: T.subtext, fontSize: 10, interval: 0, rotate: names.length > 8 ? 30 : 0 } });
        } else {
          opt.xAxis = axis(theme, { type: 'category', data: cats ? labels.map(String) : vals, name: p.groupBy || '', nameLocation: 'middle', nameGap: 30 });
        }
        opt.yAxis = axis(theme, { type: 'value', scale: true, name: vals.length === 1 ? vals[0] : t('label.value') });
        opt.series = [{
          name: t('label.distribution'), type: 'boxplot', data: boxData,
          itemStyle: { borderWidth: 1.6, color: 'rgba(79,140,255,0.16)' },
          boxWidth: [12, 44],
          tooltip: {
            formatter: (d) => {
              const v = d.value;
              return `<b>${d.name}</b><br/>max ${S.fmt.num(v[5])}<br/>Q3 ${S.fmt.num(v[4])}<br/>median ${S.fmt.num(v[3])}<br/>Q1 ${S.fmt.num(v[2])}<br/>min ${S.fmt.num(v[1])}`;
            },
          },
        }];
        if (p.showPoints) {
          opt.series.push({
            name: t('label.outliers'), type: 'scatter', data: scatter, symbolSize: 5,
            itemStyle: { color: '#ef4444', opacity: 0.65 }, tooltip: { show: false }, z: 4,
          });
        }
        opt.tooltip.trigger = 'item';
        const firstBs = boxData[0];
        const insight = firstBs ? t('insight.box', {
          q1: S.fmt.num(firstBs[1]), median: S.fmt.num(firstBs[2]), q3: S.fmt.num(firstBs[3]),
          iqr: S.fmt.num(firstBs[3] - firstBs[1]), n: Math.max(1, scatter.length),
        }) : null;
        notes.push(t('note.rowsUsed', { n: labels.reduce((acc, g) => acc + (cats ? groupMap.map.get(g).length : df.nrows), 0), total: df.nrows }));
        return { option: opt, insight, notes };
      },
    },

    pie: {
      icon: 'pie', labelKey: 'chart.pie', group: 'composition',
      aboutKey: 'chart.pie.about',
      params: [
        { name: 'category', type: 'column', labelKey: 'param.category', default: '' },
        { name: 'y', type: 'column', labelKey: 'param.valueColumn', numericOnly: true, allowEmpty: true, default: '' },
        { name: 'agg', type: 'select', labelKey: 'param.aggregations', options: [{ value: 'count', labelKey: 'agg.count' }, { value: 'sum', labelKey: 'agg.sum' }, { value: 'mean', labelKey: 'agg.mean' }], default: 'count' },
        { name: 'donut', type: 'checkbox', labelKey: 'param.donut', default: true },
        { name: 'topN', type: 'number', labelKey: 'param.topN', default: 8, min: 1, step: 1 },
        { name: 'other', type: 'checkbox', labelKey: 'param.groupOther', default: true },
      ],
      defaults: (df) => ({ category: CAT(df)[0] || df.names[0], y: '', agg: 'count', donut: true, topN: 8, other: true }),
      build: (df, p, theme) => {
        if (!p.category) return { error: t('err.pickColumn') };
        const opt = base(theme);
        const vc = p.y ? df.valueCounts(p.category, {}) : df.valueCounts(p.category, {});
        let entries;
        if (p.y && df.names.includes(p.y)) {
          const res = aggregateSeries(df, p.category, [p.y], p.agg);
          entries = res.labels.map((l, i) => ({ label: l, count: res.series[0].data[i] })).filter((e) => e.count !== null);
        } else {
          entries = vc.entries.map((e) => ({ label: e.label, count: e.count }));
        }
        entries.sort((a, b) => b.count - a.count);
        if (p.topN && entries.length > p.topN) {
          const head = entries.slice(0, p.topN);
          if (p.other) head.push({ label: t('label.other'), count: entries.slice(p.topN).reduce((a, e) => a + e.count, 0) });
          entries = head;
        }
        const total = entries.reduce((a, e) => a + e.count, 0) || 1;
        const T = opt.__T;
        opt.tooltip.trigger = 'item';
        opt.tooltip.formatter = (d) => `${d.name}<br/><b>${S.fmt.num(d.value)}</b> · ${S.fmt.pct(d.percent / 100, 1)}`;
        opt.series = [{
          type: 'pie', radius: p.donut ? ['46%', '72%'] : '70%', center: ['50%', '52%'],
          data: entries.map((e, k) => ({ name: String(e.label), value: e.count, itemStyle: { color: PALETTE[k % PALETTE.length] } })),
          itemStyle: { borderColor: theme === 'dark' ? '#0b1220' : '#fff', borderWidth: 2, borderRadius: 4 },
          label: { color: T.subtext, fontSize: 11, formatter: '{b}\n{d}%' },
          labelLine: { lineStyle: { color: T.axis } },
          emphasis: { scale: true, scaleSize: 6, itemStyle: { shadowBlur: 12, shadowColor: 'rgba(0,0,0,.2)' } },
        }];
        if (p.donut) {
          opt.graphic = [{
            type: 'text', left: 'center', top: '46%',
            style: { text: S.fmt.num(total), fill: T.text, fontSize: 22, fontWeight: 700, align: 'center' },
          }, {
            type: 'text', left: 'center', top: '56%',
            style: { text: p.y ? `${AGG_LABEL[p.agg] || p.agg}(${p.y})` : t('label.count'), fill: T.subtext, fontSize: 11, align: 'center' },
          }];
        }
        const top = entries[0];
        const insight = top ? t('insight.pie', {
          n: vc.entries.length, label: top.label, pct: S.fmt.pct(top.count / total, 1),
        }) : null;
        return { option: opt, insight };
      },
    },

    corr: {
      icon: 'corr', labelKey: 'chart.corr', group: 'relationship',
      aboutKey: 'chart.corr.about',
      params: [
        { name: 'method', type: 'select', labelKey: 'param.method', options: [
          { value: 'pearson', labelKey: 'corr.pearson' }, { value: 'spearman', labelKey: 'corr.spearman' }], default: 'pearson' },
        { name: 'columns', type: 'columns', labelKey: 'param.columns', numericOnly: true, allowEmpty: true, default: [] },
        { name: 'annotate', type: 'checkbox', labelKey: 'param.showValues', default: true },
        { name: 'labels', type: 'checkbox', labelKey: 'param.shortLabels', default: false },
      ],
      defaults: (df) => ({ method: 'pearson', columns: [], annotate: true, labels: false }),
      build: (df, p, theme) => {
        const cols = (p.columns || []).length ? p.columns.filter((c) => df.names.includes(c)) : NUMC(df);
        if (cols.length < 2) return { error: t('err.needTwoNumeric') };
        const opt = base(theme);
        const T = opt.__T;
        const f = p.method === 'spearman' ? S.spearman : S.pearson;
        const data = [];
        let best = null;
        const short = (c) => (p.labels ? c.slice(0, 6) : c);
        for (let i = 0; i < cols.length; i++) {
          for (let j = 0; j < cols.length; j++) {
            const r = i === j ? 1 : f(df.col(cols[i]), df.col(cols[j]));
            data.push([j, i, r === null ? null : Number(r.toFixed(4))]);
            if (i < j && r !== null && (!best || Math.abs(r) > Math.abs(best.r))) best = { a: cols[i], b: cols[j], r };
          }
        }
        opt.grid = { left: 96, right: 26, top: 20, bottom: 82, containLabel: true };
        opt.xAxis = axis(theme, { type: 'category', data: cols.map(short), position: 'bottom', splitArea: { show: true, areaStyle: { color: ['transparent'] } }, axisLabel: { color: T.subtext, fontSize: 10, rotate: cols.length > 6 ? 40 : 0, interval: 0 } });
        opt.yAxis = axis(theme, { type: 'category', data: cols.map(short), inverse: true, axisLabel: { color: T.subtext, fontSize: 10, interval: 0 } });
        opt.visualMap = {
          min: -1, max: 1, calculable: true, orient: 'horizontal', left: 'center', bottom: 4, itemHeight: 90,
          textStyle: { color: T.subtext, fontSize: 10 },
          inRange: { color: ['#2563eb', '#93c5fd', '#f8fafc', '#fca5a5', '#dc2626'] },
        };
        opt.series = [{
          type: 'heatmap', data, label: { show: !!p.annotate, fontSize: 9, color: T.text, formatter: (d) => (d.value[2] === null ? '' : d.value[2].toFixed(2)) },
          itemStyle: { borderColor: theme === 'dark' ? '#0b1220' : '#fff', borderWidth: 1 },
          emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,.3)' } },
          progressive: 2000,
        }];
        opt.tooltip.trigger = 'item';
        opt.tooltip.formatter = (d) => `<b>${cols[d.value[0]]}</b> × <b>${cols[d.value[1]]}</b><br/>r = ${d.value[2] === null ? 'NaN' : d.value[2].toFixed(4)}`;
        const insight = best ? t('insight.corr', {
          a: best.a, b: best.b, r: best.r.toFixed(3),
          strength: Math.abs(best.r) > 0.7 ? t('insight.strong') : Math.abs(best.r) > 0.4 ? t('insight.moderate') : t('insight.weak'),
          dir: best.r > 0 ? t('insight.positive') : t('insight.negative'),
        }) : null;
        const notes = [];
        if (p.method === 'spearman') notes.push(t('note.spearman'));
        return { option: opt, insight, notes };
      },
    },

    heatmap: {
      icon: 'heatmap', labelKey: 'chart.heatmap', group: 'relationship',
      aboutKey: 'chart.heatmap.about',
      params: [
        { name: 'x', type: 'column', labelKey: 'param.xAxis', default: '' },
        { name: 'y', type: 'column', labelKey: 'param.yAxis', default: '' },
        { name: 'value', type: 'column', labelKey: 'param.valueColumn', numericOnly: true, default: '' },
        { name: 'agg', type: 'select', labelKey: 'param.aggregations', options: [
          { value: 'count', labelKey: 'agg.count' }, { value: 'sum', labelKey: 'agg.sum' },
          { value: 'mean', labelKey: 'agg.mean' }, { value: 'median', labelKey: 'agg.median' },
          { value: 'max', labelKey: 'agg.max' }], default: 'mean' },
        { name: 'annotate', type: 'checkbox', labelKey: 'param.showValues', default: true },
      ],
      defaults: (df) => {
        const cats = CAT(df);
        return { x: cats[0] || df.names[0], y: cats[1] || df.names[1] || df.names[0], value: pickNumeric(df)[0] || '', agg: 'mean', annotate: true };
      },
      build: (df, p, theme) => {
        if (!p.x || !p.y) return { error: t('err.pickTwoColumns') };
        const useValue = p.value && df.names.includes(p.value) && p.agg !== 'count';
        const cv = df.crosstab ? null : null;
        void cv;
        const yVals = [...new Set(df.col(p.y).map((v) => DFm.formatValue(v, df.dtype(p.y))))];
        const xVals = [...new Set(df.col(p.x).map((v) => DFm.formatValue(v, df.dtype(p.x))))];
        if (xVals.length * yVals.length > 4000) return { error: t('err.tooManyCells', { n: xVals.length * yVals.length }) };
        yVals.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        xVals.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const b = new Map();
        const xi = df.colIndex(p.x), yi = df.colIndex(p.y), vi = useValue ? df.colIndex(p.value) : null;
        for (let r = 0; r < df.nrows; r++) {
          const k = DFm.formatValue(df.values[xi][r], df.dtype(p.x)) + '\u0001' + DFm.formatValue(df.values[yi][r], df.dtype(p.y));
          if (!b.has(k)) b.set(k, []);
          b.get(k).push(vi === null ? 1 : df.values[vi][r]);
        }
        const data = [];
        let mn = Infinity, mx = -Infinity;
        yVals.forEach((yv, j) => xVals.forEach((xv, i) => {
          const rows = b.get(xv + '\u0001' + yv) || [];
          const val = rows.length ? applyAgg(rows, useValue ? p.agg : 'count') : null;
          if (val !== null) { mn = Math.min(mn, val); mx = Math.max(mx, val); }
          data.push([i, j, val === null ? null : Number(val.toFixed(4))]);
        }));
        const opt = base(theme);
        const T = opt.__T;
        opt.grid = { left: 90, right: 30, top: 24, bottom: 84, containLabel: true };
        opt.xAxis = axis(theme, { type: 'category', data: xVals, name: p.x, nameLocation: 'middle', nameGap: 46, axisLabel: { color: T.subtext, fontSize: 10, rotate: xVals.length > 8 ? 35 : 0, interval: 0 } });
        opt.yAxis = axis(theme, { type: 'category', data: yVals, name: p.y, nameLocation: 'middle', nameGap: 62, axisLabel: { color: T.subtext, fontSize: 10, interval: 0 }, inverse: true });
        opt.visualMap = {
          min: Number.isFinite(mn) ? mn : 0, max: Number.isFinite(mx) ? mx : 1, calculable: true,
          orient: 'horizontal', left: 'center', bottom: 4, itemHeight: 90, textStyle: { color: T.subtext, fontSize: 10 },
          inRange: { color: ['#e0f2fe', '#7dd3fc', '#38bdf8', '#0284c7', '#075985'] },
        };
        opt.series = [{
          type: 'heatmap', data,
          label: { show: !!p.annotate && xVals.length * yVals.length <= 200, fontSize: 9, color: theme === 'dark' ? '#e5e7eb' : '#0f172a', formatter: (d) => (d.value[2] === null ? '' : S.fmt.num(d.value[2], 1)) },
          itemStyle: { borderColor: theme === 'dark' ? '#0b1220' : '#fff', borderWidth: 1, borderRadius: 2 },
          emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,.28)' } },
        }];
        opt.tooltip.trigger = 'item';
        opt.tooltip.formatter = (d) => `${p.y}: <b>${yVals[d.value[1]]}</b><br/>${p.x}: <b>${xVals[d.value[0]]}</b><br/>${useValue ? `${AGG_LABEL[p.agg] || p.agg}(${p.value})` : t('agg.count')} = <b>${d.value[2] === null ? '—' : S.fmt.num(d.value[2])}</b>`;
        const filled = data.filter((d) => d[2] !== null).length;
        const insight = t('insight.heatmap', { cells: data.length, filled, empty: data.length - filled });
        return { option: opt, insight };
      },
    },

    missing: {
      icon: 'missing', labelKey: 'chart.missing', group: 'quality',
      aboutKey: 'chart.missing.about',
      params: [
        { name: 'mode', type: 'select', labelKey: 'param.mode', options: [
          { value: 'matrix', labelKey: 'missing.matrix' }, { value: 'bar', labelKey: 'missing.bar' }, { value: 'heat', labelKey: 'missing.heat' }], default: 'matrix' },
        { name: 'rows', type: 'number', labelKey: 'param.maxRows', default: 200, min: 20, step: 20 },
      ],
      defaults: () => ({ mode: 'matrix', rows: 200 }),
      build: (df, p, theme) => {
        const opt = base(theme);
        const T = opt.__T;
        const report = df.missingReport();
        const totalMissing = report.reduce((a, r) => a + r.missing, 0);
        if (p.mode === 'bar') {
          const rows = report.slice().sort((a, b) => b.pct - a.pct);
          opt.grid = { left: 96, right: 60, top: 20, bottom: 40, containLabel: true };
          opt.xAxis = axis(theme, { type: 'value', max: 1, axisLabel: { color: T.subtext, fontSize: 10, formatter: (v) => (v * 100).toFixed(0) + '%' } });
          opt.yAxis = axis(theme, { type: 'category', data: rows.map((r) => r.column), inverse: true, axisLabel: { color: T.subtext, fontSize: 10, interval: 0 } });
          opt.series = [{
            type: 'bar', barMaxWidth: 16, data: rows.map((r) => ({ value: r.pct, itemStyle: { color: r.pct > 0.3 ? '#ef4444' : r.pct > 0.05 ? '#f59e0b' : '#22c55e', borderRadius: [0, 4, 4, 0] } })),
            label: { show: true, position: 'right', fontSize: 10, color: T.subtext, formatter: (d) => (d.value > 0 ? `${(d.value * 100).toFixed(1)}%  (${rows[d.dataIndex].missing})` : t('label.complete')) },
          }];
          opt.tooltip.trigger = 'item';
          opt.tooltip.formatter = (d) => `<b>${rows[d.dataIndex].column}</b><br/>${t('label.missing')}: ${rows[d.dataIndex].missing} / ${df.nrows}`;
          return {
            option: opt,
            insight: totalMissing
              ? t('insight.missingBar', { cols: report.filter((r) => r.missing > 0).length, cells: totalMissing, pct: S.fmt.pct(totalMissing / (df.nrows * df.ncols || 1), 2) })
              : t('insight.noMissing'),
          };
        }
        if (p.mode === 'heat') {
          // missingness correlation: does one column's absence predict another's?
          const cols = report.map((r) => r.column);
          const miss = cols.map((c) => df.isNull(c).map((b) => (b ? 1 : 0)));
          const data = [];
          cols.forEach((_, i) => cols.forEach((_, j) => {
            data.push([j, i, Number((S.pearson(miss[i], miss[j]) ?? 0).toFixed(3))]);
          }));
          opt.grid = { left: 96, right: 30, top: 20, bottom: 84, containLabel: true };
          opt.xAxis = axis(theme, { type: 'category', data: cols, axisLabel: { color: T.subtext, fontSize: 10, rotate: cols.length > 6 ? 40 : 0, interval: 0 } });
          opt.yAxis = axis(theme, { type: 'category', data: cols, inverse: true, axisLabel: { color: T.subtext, fontSize: 10, interval: 0 } });
          opt.visualMap = { min: -1, max: 1, calculable: true, orient: 'horizontal', left: 'center', bottom: 4, itemHeight: 90, textStyle: { color: T.subtext, fontSize: 10 }, inRange: { color: ['#2563eb', '#93c5fd', '#f8fafc', '#fca5a5', '#dc2626'] } };
          opt.series = [{ type: 'heatmap', data, itemStyle: { borderColor: theme === 'dark' ? '#0b1220' : '#fff', borderWidth: 1 } }];
          opt.tooltip.trigger = 'item';
          opt.tooltip.formatter = (d) => `${cols[d.value[1]]} ↔ ${cols[d.value[0]]}<br/>r = ${d.value[2]}`;
          return { option: opt, insight: t('insight.missingHeat') };
        }
        // default: nullity matrix (missingno-style), worst rows first
        const maxRows = Math.min(df.nrows, p.rows || 200);
        const nullFlags = report.map((rep) => df.isNull(rep.column));
        const rowMiss = DFm.rangeArr(df.nrows).map((r) => {
          let n = 0;
          for (let c = 0; c < nullFlags.length; c++) if (nullFlags[c][r]) n++;
          return { r, n };
        });
        const withMissing = rowMiss.filter((x) => x.n > 0).sort((a, b) => b.n - a.n || a.r - b.r);
        const shownRows = (withMissing.length ? withMissing : rowMiss).slice(0, maxRows).map((x) => x.r);
        const data = [];
        nullFlags.forEach((nulls, ci) => {
          shownRows.forEach((r, ri) => { if (nulls[r]) data.push([ci, ri]); });
        });
        opt.grid = { left: 96, right: 30, top: 20, bottom: 44, containLabel: true };
        opt.xAxis = axis(theme, { type: 'category', data: report.map((r) => r.column), axisLabel: { color: T.subtext, fontSize: 10, rotate: report.length > 6 ? 40 : 0, interval: 0 }, splitLine: { show: false } });
        opt.yAxis = axis(theme, {
          type: 'category', data: shownRows.map((r) => (df.index ? df.index[r] : r)), inverse: true,
          axisLabel: { color: T.subtext, fontSize: 9, interval: Math.max(1, Math.floor(shownRows.length / 14)) }, splitLine: { show: false },
        });
        const cellH = Math.max(2, Math.min(12, 460 / Math.max(1, shownRows.length)));
        opt.series = [{
          type: 'scatter', data,
          symbolSize: [Math.max(2, 620 / Math.max(1, report.length)), cellH],
          itemStyle: { color: '#ef4444' }, progressive: 3000,
          tooltip: { formatter: (d) => `${report[d.value[0]].column} · ${t('label.rows')} #${shownRows[d.value[1]]}` },
        }];
        opt.tooltip.trigger = 'item';
        const missRows = rowMiss.filter((x) => x.n > 0).length;
        return {
          option: opt,
          insight: totalMissing
            ? t('insight.missingMatrix', { cells: totalMissing, cols: report.filter((r) => r.missing > 0).length, shown: shownRows.length, rows: df.nrows })
            : t('insight.noMissing'),
          notes: totalMissing ? [t('note.matrixSorted', { n: missRows, total: df.nrows })] : [],
        };
      },
    },

    scatterMatrix: {
      icon: 'splom', labelKey: 'chart.scatterMatrix', group: 'relationship',
      aboutKey: 'chart.scatterMatrix.about',
      params: [
        { name: 'columns', type: 'columns', labelKey: 'param.columns', numericOnly: true, default: [] },
        { name: 'colorBy', type: 'column', labelKey: 'param.colorBy', allowEmpty: true, default: '' },
        { name: 'log', type: 'checkbox', labelKey: 'param.logScale', default: false },
      ],
      defaults: (df) => ({ columns: pickNumeric(df).slice(0, 4), colorBy: CAT(df).filter((c) => new Set(df.col(c).map(String)).size <= 6)[0] || '', log: false }),
      build: (df, p, theme) => {
        const cols = (p.columns || []).filter((c) => df.names.includes(c) && DFm.isNum(df.dtype(c)));
        if (cols.length < 2) return { error: t('err.needTwoNumeric') };
        if (cols.length > 6) return { error: t('err.tooManyColumns', { n: 6 }) };
        const opt = base(theme);
        const T = opt.__T;
        const n = cols.length;
        opt.grid = []; opt.xAxis = []; opt.yAxis = []; opt.series = []; opt.title = [];
        const gap = 3.4;
        const w = (100 - 14) / n;
        const h = (100 - 12) / n;
        const groups = p.colorBy ? groupKeys(df, [p.colorBy]) : null;
        const keyOfRow = groups ? (r) => DFm.formatValue(df.at(r, p.colorBy), df.dtype(p.colorBy)) : null;
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            const k = i * n + j;
            const left = 11 + j * (w + w * gap / 100);
            const top = 6 + i * (h + h * gap / 100);
            const isDiag = i === j;
            opt.grid.push({ left: left + '%', top: top + '%', width: (w - 1) + '%', height: (h - 1.5) + '%', containLabel: false });
            const showLabels = i === n - 1 || j === 0;
            opt.xAxis.push(axis(theme, {
              type: isDiag ? 'category' : (p.log ? 'log' : 'value'), gridIndex: k, scale: true,
              axisLabel: { show: showLabels, color: T.subtext, fontSize: 9, formatter: (v) => S.fmt.compact(v) },
              axisLine: { show: showLabels, lineStyle: { color: T.axis } }, splitLine: { show: false },
            }));
            opt.yAxis.push(axis(theme, {
              type: p.log && !isDiag ? 'log' : 'value', gridIndex: k, scale: true,
              axisLabel: { show: j === 0, color: T.subtext, fontSize: 9, formatter: (v) => S.fmt.compact(v) },
              axisLine: { show: j === 0, lineStyle: { color: T.axis } }, splitLine: { show: false },
            }));
            if (isDiag) {
              const sc = [];
              const step = Math.ceil(df.nrows / 400);
              for (let r = 0; r < df.nrows; r += step) { const v = S.toNum(df.at(r, cols[i])); if (v !== null) sc.push([v, 1]); }
              opt.series.push({ type: 'scatter', xAxisIndex: k, yAxisIndex: k, data: sc, symbolSize: 2, itemStyle: { color: PALETTE[4], opacity: 0.5 }, progressive: 2000 });
            } else {
              const pts = numericPairs(df, cols[j], cols[i], groups ? [{ name: '__g', value: keyOfRow }] : null);
              const sampled = samplePoints(pts, 900);
              if (groups) {
                const bucket = new Map();
                sampled.forEach((d) => { if (!bucket.has(d.__g)) bucket.set(d.__g, []); bucket.get(d.__g).push([d.x, d.y]); });
                [...bucket.entries()].slice(0, 6).forEach(([gname, data], gi) => {
                  opt.series.push({ type: 'scatter', xAxisIndex: k, yAxisIndex: k, name: gname, data, symbolSize: 3.2, itemStyle: { color: PALETTE[gi % PALETTE.length], opacity: 0.6 }, progressive: 2000 });
                });
              } else {
                opt.series.push({ type: 'scatter', xAxisIndex: k, yAxisIndex: k, data: sampled.map((d) => [d.x, d.y]), symbolSize: 3.2, itemStyle: { color: PALETTE[0], opacity: 0.5 }, progressive: 2000 });
              }
            }
            if (j === 0) opt.title.push({ text: cols[i], left: '1%', top: (top + h / 2 - 1.2) + '%', textStyle: { fontSize: 10, color: T.subtext, fontWeight: 'normal' } });
          }
        }
        opt.axisPointer = { show: true, link: [{ xAxisIndex: 'all' }], lineStyle: { color: T.axis, type: 'dashed' } };
        opt.tooltip = Object.assign(opt.tooltip, { show: false });
        const corrs = [];
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) corrs.push({ a: cols[i], b: cols[j], r: S.pearson(df.col(cols[i]), df.col(cols[j])) });
        corrs.sort((x, y) => Math.abs(y.r || 0) - Math.abs(x.r || 0));
        const top = corrs[0];
        return {
          option: opt,
          insight: top ? t('insight.corr', { a: top.a, b: top.b, r: (top.r ?? 0).toFixed(3), strength: Math.abs(top.r) > 0.7 ? t('insight.strong') : Math.abs(top.r) > 0.4 ? t('insight.moderate') : t('insight.weak'), dir: top.r > 0 ? t('insight.positive') : t('insight.negative') }) : null,
        };
      },
    },

    parallel: {
      icon: 'parallel', labelKey: 'chart.parallel', group: 'relationship',
      aboutKey: 'chart.parallel.about',
      params: [
        { name: 'columns', type: 'columns', labelKey: 'param.columns', default: [] },
        { name: 'colorBy', type: 'column', labelKey: 'param.colorBy', allowEmpty: true, default: '' },
        { name: 'lines', type: 'number', labelKey: 'param.maxLines', default: 300, min: 20, step: 20 },
      ],
      defaults: (df) => ({ columns: [...pickNumeric(df).slice(0, 4), ...CAT(df).slice(0, 1)].slice(0, 6), colorBy: CAT(df)[0] || '', lines: 300 }),
      build: (df, p, theme) => {
        const cols = (p.columns || []).filter((c) => df.names.includes(c));
        if (cols.length < 2) return { error: t('err.pickTwoColumns') };
        const opt = base(theme);
        const dims = cols.map((c) => {
          const vals = df.col(c).map((v) => (DFm.isNum(df.dtype(c)) ? S.toNum(v) : DFm.formatValue(v, df.dtype(c))));
          const numeric = DFm.isNum(df.dtype(c));
          return {
            name: c, type: numeric ? 'value' : 'category',
            data: numeric ? undefined : [...new Set(vals.filter((v) => v !== null && v !== 'NaN'))].sort().slice(0, 30),
            min: numeric ? S.min(vals.filter((v) => v !== null)) : undefined,
            max: numeric ? S.max(vals.filter((v) => v !== null)) : undefined,
            axisLabel: { color: theme === 'dark' ? '#9ca3af' : '#6b7280', fontSize: 10, formatter: (v) => (typeof v === 'number' ? S.fmt.compact(v) : v) },
          };
        });
        if (cols.length > 8) dims.length = 8;
        const step = Math.max(1, Math.ceil(df.nrows / (p.lines || 300)));
        const groups = p.colorBy ? groupKeys(df, [p.colorBy]) : null;
        const keyOfRow = groups ? (r) => DFm.formatValue(df.at(r, p.colorBy), df.dtype(p.colorBy)) : null;
        const buckets = new Map();
        for (let r = 0; r < df.nrows; r += step) {
          const k = groups ? keyOfRow(r) : '__all';
          if (!buckets.has(k)) buckets.set(k, []);
          buckets.get(k).push(cols.map((c) => {
            const v = df.at(r, c);
            return DFm.isNum(df.dtype(c)) ? S.toNum(v) : DFm.formatValue(v, df.dtype(c));
          }));
        }
        opt.parallel = { left: 70, right: 40, top: 40, bottom: 40, parallelAxisDefault: { nameTextStyle: { color: theme === 'dark' ? '#9ca3af' : '#6b7280', fontSize: 11 } } };
        opt.parallelAxis = dims;
        opt.series = [...buckets.entries()].slice(0, 10).map(([name, data], k) => ({
          name, type: 'parallel', data, lineStyle: { width: 1, opacity: buckets.size > 3 ? 0.3 : 0.42, color: PALETTE[k % PALETTE.length] },
          emphasis: { lineStyle: { width: 2.4, opacity: 1 } },
          smooth: false, progressive: 2000,
        }));
        if (buckets.size > 1) opt.legend = { top: 4, type: 'scroll', textStyle: { color: theme === 'dark' ? '#9ca3af' : '#6b7280' } };
        opt.tooltip = Object.assign(opt.tooltip, { trigger: 'item' });
        opt.tooltip.formatter = (d) => {
          const vals = d.value;
          return cols.map((c, i) => `<b>${c}</b>: ${typeof vals[i] === 'number' ? S.fmt.num(vals[i]) : vals[i]}`).join('<br/>');
        };
        return { option: opt, insight: t('insight.parallel', { cols: cols.length, lines: [...buckets.values()].reduce((a, d) => a + d.length, 0) }) };
      },
    },

    treemap: {
      icon: 'treemap', labelKey: 'chart.treemap', group: 'composition',
      aboutKey: 'chart.treemap.about',
      params: [
        { name: 'level1', type: 'column', labelKey: 'param.level1', default: '' },
        { name: 'level2', type: 'column', labelKey: 'param.level2', allowEmpty: true, default: '' },
        { name: 'value', type: 'column', labelKey: 'param.valueColumn', numericOnly: true, default: '' },
        { name: 'agg', type: 'select', labelKey: 'param.aggregations', options: [{ value: 'sum', labelKey: 'agg.sum' }, { value: 'count', labelKey: 'agg.count' }, { value: 'mean', labelKey: 'agg.mean' }], default: 'sum' },
      ],
      defaults: (df) => {
        const cats = CAT(df);
        return { level1: cats[0] || df.names[0], level2: cats[1] || '', value: pickNumeric(df)[0] || '', agg: 'sum' };
      },
      build: (df, p, theme) => {
        if (!p.level1) return { error: t('err.pickColumn') };
        const opt = base(theme);
        const T = opt.__T;
        const hasVal = p.value && df.names.includes(p.value);
        const aggFn = hasVal ? p.agg : 'count';
        const vi = hasVal ? df.colIndex(p.value) : null;
        const l1 = df.colIndex(p.level1);
        const l2 = p.level2 && p.level2 !== p.level1 ? df.colIndex(p.level2) : null;
        const tree = new Map();
        let total = 0;
        for (let r = 0; r < df.nrows; r++) {
          const a = DFm.formatValue(df.values[l1][r], df.dtype(p.level1));
          const bkey = l2 !== null ? DFm.formatValue(df.values[l2][r], df.dtype(p.level2)) : null;
          if (!tree.has(a)) tree.set(a, new Map());
          const inner = tree.get(a);
          if (!inner.has(bkey)) inner.set(bkey, []);
          inner.get(bkey).push(vi === null ? 1 : df.values[vi][r]);
        }
        const data = [...tree.entries()].map(([lvl1, inner]) => {
          const children = [...inner.entries()].map(([lvl2, vals]) => {
            const v = applyAgg(vals, aggFn);
            total += v || 0;
            return { name: lvl2 === null ? lvl1 : lvl2, value: Math.max(0, v || 0) };
          });
          return { name: lvl1, children: l2 !== null ? children : undefined, value: l2 !== null ? undefined : children.reduce((a, c) => a + c.value, 0) };
        });
        opt.tooltip = Object.assign(opt.tooltip, {
          trigger: 'item',
          formatter: (d) => `${d.name}<br/><b>${S.fmt.num(d.value)}</b> · ${S.fmt.pct(d.value / (total || 1), 1)}`,
        });
        opt.series = [{
          type: 'treemap', data, roam: false, nodeClick: false, breadcrumb: { show: l2 !== null, bottom: 0, itemStyle: { color: 'transparent', textStyle: { color: T.subtext } } },
          left: 0, right: 0, top: 6, bottom: l2 !== null ? 22 : 0,
          label: { show: true, formatter: '{b}', color: '#fff', fontSize: 11, overflow: 'truncate' },
          upperLabel: { show: l2 !== null, height: 20, color: '#fff', fontSize: 11 },
          itemStyle: { borderColor: theme === 'dark' ? '#0b1220' : '#fff', borderWidth: 2, gapWidth: 2 },
          levels: [
            { itemStyle: { borderWidth: 3, gapWidth: 3, borderColor: theme === 'dark' ? '#0b1220' : '#fff' } },
            { colorSaturation: [0.35, 0.65], itemStyle: { gapWidth: 2, borderColorSaturation: 0.6 } },
          ],
          progressive: 2000,
        }];
        return { option: opt, insight: t('insight.treemap', { n: tree.size, total: S.fmt.num(total), metric: hasVal ? `${aggFn}(${p.value})` : t('agg.count') }) };
      },
    },

    radar: {
      icon: 'radar', labelKey: 'chart.radar', group: 'comparison',
      aboutKey: 'chart.radar.about',
      params: [
        { name: 'category', type: 'column', labelKey: 'param.category', default: '' },
        { name: 'columns', type: 'columns', labelKey: 'param.valueColumns', numericOnly: true, default: [] },
        { name: 'agg', type: 'select', labelKey: 'param.aggregations', options: [{ value: 'mean', labelKey: 'agg.mean' }, { value: 'sum', labelKey: 'agg.sum' }, { value: 'median', labelKey: 'agg.median' }, { value: 'max', labelKey: 'agg.max' }], default: 'mean' },
        { name: 'normalize', type: 'checkbox', labelKey: 'param.normalize', default: true },
      ],
      defaults: (df) => ({ category: CAT(df)[0] || df.names[0], columns: pickNumeric(df).slice(0, 5), agg: 'mean', normalize: true }),
      build: (df, p, theme) => {
        const cols = (p.columns || []).filter((c) => df.names.includes(c));
        if (!p.category || cols.length < 3) return { error: t('err.needThreeNumeric') };
        const g = groupKeys(df, [p.category]);
        if (g.order.length > 12) return { error: t('err.tooManyCategories', { n: g.order.length }) };
        const opt = base(theme);
        const T = opt.__T;
        const raw = g.order.map((k) => cols.map((c) => applyAgg(g.map.get(k).map((r) => df.at(r, c)), p.agg)));
        let matrix = raw;
        if (p.normalize) {
          matrix = raw.map((row) => row.map((v, j) => {
            const col = raw.map((r) => r[j]).filter((x) => Number.isFinite(x));
            const mn = S.min(col), mx = S.max(col);
            return mx === mn ? 0.5 : (v - mn) / (mx - mn);
          }));
        }
        opt.tooltip = Object.assign(opt.tooltip, { trigger: 'item' });
        opt.radar = {
          indicator: cols.map((c) => ({ name: c, max: p.normalize ? 1 : Math.max(...raw.map((r) => r[cols.indexOf(c)]).filter(Number.isFinite)) })),
          center: ['50%', '54%'], radius: '66%',
          axisName: { color: T.subtext, fontSize: 11 },
          splitLine: { lineStyle: { color: T.split } },
          splitArea: { areaStyle: { color: ['transparent'] } },
          axisLine: { lineStyle: { color: T.split } },
        };
        opt.legend = { top: 4, type: 'scroll', textStyle: { color: T.subtext } };
        opt.series = [{
          type: 'radar', symbolSize: 5, areaStyle: { opacity: 0.14 },
          data: g.order.map((k, i) => ({ name: k, value: matrix[i], lineStyle: { width: 2 }, color: PALETTE[i % PALETTE.length] })),
        }];
        return { option: opt, insight: t('insight.radar', { groups: g.order.length, cols: cols.length, metric: AGG_LABEL[p.agg] || p.agg }) };
      },
    },
  };

  const CHART_GROUPS = [
    { id: 'distribution', labelKey: 'chartGroup.distribution' },
    { id: 'relationship', labelKey: 'chartGroup.relationship' },
    { id: 'comparison', labelKey: 'chartGroup.comparison' },
    { id: 'composition', labelKey: 'chartGroup.composition' },
    { id: 'quality', labelKey: 'chartGroup.quality' },
  ];

  function defaultChartParams(chartId, df) {
    const c = CHARTS[chartId];
    if (!c) return {};
    let p = {};
    try { p = c.defaults(df) || {}; } catch (e) { p = {}; }
    c.params.forEach((spec) => {
      if (p[spec.name] === undefined && spec.default !== undefined) p[spec.name] = Array.isArray(spec.default) ? spec.default.slice() : spec.default;
    });
    return p;
  }

  global.Charts = { CHARTS, CHART_GROUPS, PALETTE, THEMES, defaultChartParams, base, axis };
})(window);
