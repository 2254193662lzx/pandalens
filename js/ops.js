/* =============================================================================
 * ops.js — the operation registry.
 *
 * Every pandas operation the app can perform is declared once here:
 *   params    → the visual form controls the UI renders
 *   apply     → how the operation transforms the frame
 *   python    → the equivalent pandas code
 *   describe  → the human-readable step label
 *
 * Because the palette, the step editor, the code view and the pipeline all read
 * from this table, the visual interface and the generated pandas code can never
 * drift apart.
 * ========================================================================== */
(function (global) {
  'use strict';

  const { AGG_FUNCS, AGG_LABEL, rangeArr } = global.DF;
  const S = global.Stats;
  const t = (k, p) => global.I18N.t(k, p);
  const q = (s) => JSON.stringify(String(s));
  const pyStr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const pyList = (arr) => '[' + arr.map((x) => (typeof x === 'number' ? x : pyStr(x))).join(', ') + ']';

  /** Translate the app's expression dialect into pandas/numpy-ish syntax. */
  function exprToPython(src) {
    let s = String(src || '');
    s = s.replace(/\band\b/gi, '&').replace(/\bor\b/gi, '|').replace(/\bnot\s+/gi, '~');
    s = s.replace(/\btrue\b/gi, 'True').replace(/\bfalse\b/gi, 'False').replace(/\bnull\b|\bnan\b/gi, 'None');
    s = s.replace(/\bif\s*\(/gi, 'np.where(');
    s = s.replace(/\bcontains\s*\(/gi, 'str.contains(');
    return s;
  }

  const AGG_CHOICES = ['count', 'sum', 'mean', 'median', 'min', 'max', 'std', 'var', 'sem', 'nunique', 'first', 'last', 'mode', 'missing'];

  /* ------------------------------------------------------------- operations */
  const OPS = {
    /* ---------------------------------------------------------------- rows */
    filter: {
      group: 'rows', icon: 'filter', labelKey: 'op.filter',
      params: [
        { name: 'mode', type: 'select', labelKey: 'param.mode', options: [{ value: 'visual', labelKey: 'param.mode.visual' }, { value: 'expr', labelKey: 'param.mode.expr' }], default: 'visual' },
        { name: 'conditions', type: 'conditionList', labelKey: 'param.conditions', when: (p) => p.mode !== 'expr', default: [] },
        { name: 'logic', type: 'select', labelKey: 'param.logic', options: [{ value: 'and', labelKey: 'logic.and' }, { value: 'or', labelKey: 'logic.or' }], default: 'and', when: (p) => p.mode !== 'expr' && (p.conditions || []).length > 1 },
        { name: 'expr', type: 'expression', labelKey: 'param.expression', default: '', when: (p) => p.mode === 'expr' },
      ],
      defaults: (df) => ({ mode: 'visual', conditions: [{ column: df.names[0], op: 'notnull', value: '', value2: '' }], logic: 'and', expr: `${df.names[0]} > 0` }),
      apply: (df, p) => {
        if (p.mode === 'expr') {
          if (!String(p.expr || '').trim()) throw new Error(t('err.emptyExpression'));
          return df.query(p.expr);
        }
        const conds = (p.conditions || []).filter((c) => c.column && c.op);
        if (!conds.length) throw new Error(t('err.noConditions'));
        return global.DF.DataFrame.applyConditions(df, conds, p.logic || 'and');
      },
      python: (p) => {
        if (p.mode === 'expr') return `df = df.query(${pyStr(p.expr)})`;
        const conds = (p.conditions || []).filter((c) => c.column && c.op);
        const join = (p.logic || 'and') === 'or' ? ' | ' : ' & ';
        const parts = conds.map((c) => `(${global.DF.pythonFilterOp(c.op, c.column, c.value, c.value2)})`);
        return `df = df[${parts.join(join)}]`;
      },
      describe: (p) => {
        if (p.mode === 'expr') return { key: 'step.filterExpr', params: { expr: p.expr } };
        const conds = (p.conditions || []).filter((c) => c.column && c.op);
        const joiner = (p.logic || 'and') === 'or' ? t('logic.or') : t('logic.and');
        return { key: 'step.filter', params: { n: conds.length, joiner, list: conds.map((c) => `${c.column} ${t('fop.' + c.op)} ${c.op === 'isnull' || c.op === 'notnull' ? '' : (c.op === 'between' ? `${c.value}~${c.value2}` : c.value)}`).join(joiner) } };
      },
    },

    sort: {
      group: 'rows', icon: 'sort', labelKey: 'op.sort',
      params: [
        { name: 'by', type: 'columns', labelKey: 'param.sortBy', default: [] },
        { name: 'ascending', type: 'checkbox', labelKey: 'param.ascending', default: true },
      ],
      defaults: (df) => ({ by: [df.names[0]], ascending: true }),
      apply: (df, p) => {
        const by = (p.by || []).filter((n) => df.names.includes(n));
        if (!by.length) throw new Error(t('err.pickColumn'));
        return df.sortValues(by, by.map(() => p.ascending !== false));
      },
      python: (p) => `df = df.sort_values(by=${pyList(p.by || [])}, ascending=${p.ascending !== false ? 'True' : 'False'}).reset_index(drop=True)`,
      describe: (p) => ({ key: 'step.sort', params: { cols: (p.by || []).join(', '), dir: p.ascending !== false ? t('dir.asc') : t('dir.desc') } }),
    },

    limit: {
      group: 'rows', icon: 'limit', labelKey: 'op.limit',
      params: [
        { name: 'how', type: 'select', labelKey: 'param.method', options: [{ value: 'head', labelKey: 'limit.head' }, { value: 'tail', labelKey: 'limit.tail' }, { value: 'sample', labelKey: 'limit.sample' }], default: 'head' },
        { name: 'n', type: 'number', labelKey: 'param.n', default: 10, min: 1, step: 1 },
        { name: 'seed', type: 'number', labelKey: 'param.seed', default: 42, min: 0, step: 1, when: (p) => p.how === 'sample' },
      ],
      defaults: () => ({ how: 'head', n: 10, seed: 42 }),
      apply: (df, p) => {
        const n = Math.max(1, Number(p.n) || 10);
        if (p.how === 'tail') return df.tail(n);
        if (p.how === 'sample') return df.sample(n, Number(p.seed) || 42);
        return df.head(n);
      },
      python: (p) => (p.how === 'tail' ? `df = df.tail(${p.n})` : p.how === 'sample' ? `df = df.sample(${p.n}, random_state=${p.seed || 42})` : `df = df.head(${p.n})`),
      describe: (p) => ({ key: 'step.limit', params: { how: t('limit.' + p.how), n: p.n } }),
    },

    dropna: {
      group: 'clean', icon: 'clean', labelKey: 'op.dropna',
      params: [
        { name: 'how', type: 'select', labelKey: 'param.how', options: [{ value: 'any', labelKey: 'how.any' }, { value: 'all', labelKey: 'how.all' }], default: 'any' },
        { name: 'subset', type: 'columns', labelKey: 'param.subset', allowEmpty: true, default: [] },
        { name: 'useThresh', type: 'checkbox', labelKey: 'param.useThresh', default: false },
        { name: 'thresh', type: 'number', labelKey: 'param.thresh', default: 1, min: 0, step: 1, when: (p) => p.useThresh },
      ],
      defaults: () => ({ how: 'any', subset: [], useThresh: false, thresh: 1 }),
      apply: (df, p) => df.dropNa({ how: p.how, subset: p.subset, thresh: p.useThresh ? p.thresh : undefined }),
      python: (p) => (p.useThresh
        ? `df = df.dropna(thresh=${p.thresh}${(p.subset || []).length ? `, subset=${pyList(p.subset)}` : ''})`
        : `df = df.dropna(how=${pyStr(p.how)}${(p.subset || []).length ? `, subset=${pyList(p.subset)}` : ''})`),
      describe: (p) => ({ key: 'step.dropna', params: { how: t('how.' + p.how), subset: (p.subset || []).length ? (p.subset || []).join(', ') : t('param.allColumns') } }),
    },

    fillna: {
      group: 'clean', icon: 'fill', labelKey: 'op.fillna',
      params: [
        { name: 'column', type: 'column', labelKey: 'param.column', default: '' },
        { name: 'strategy', type: 'select', labelKey: 'param.strategy', options: [
          { value: 'mean', labelKey: 'fill.mean' }, { value: 'median', labelKey: 'fill.median' }, { value: 'mode', labelKey: 'fill.mode' },
          { value: 'zero', labelKey: 'fill.zero' }, { value: 'value', labelKey: 'fill.value' },
          { value: 'ffill', labelKey: 'fill.ffill' }, { value: 'bfill', labelKey: 'fill.bfill' }], default: 'mean' },
        { name: 'value', type: 'text', labelKey: 'param.value', default: '0', when: (p) => p.strategy === 'value' },
      ],
      defaults: (df) => ({ column: df.names.find((n) => df.isNull(n).some(Boolean)) || df.names[0], strategy: 'mean', value: '0' }),
      apply: (df, p) => {
        if (!p.column) throw new Error(t('err.pickColumn'));
        return df.fillNa({ [p.column]: { strategy: p.strategy, value: p.value } });
      },
      python: (p) => {
        const strategies = {
          mean: `df[${pyStr(p.column)}].mean()`, median: `df[${pyStr(p.column)}].median()`,
          mode: `df[${pyStr(p.column)}].mode().iloc[0]`, zero: '0',
          value: Number.isFinite(Number(p.value)) ? String(p.value) : pyStr(p.value),
          ffill: null, bfill: null,
        };
        if (p.strategy === 'ffill') return `df[${pyStr(p.column)}] = df[${pyStr(p.column)}].ffill()`;
        if (p.strategy === 'bfill') return `df[${pyStr(p.column)}] = df[${pyStr(p.column)}].bfill()`;
        return `df[${pyStr(p.column)}] = df[${pyStr(p.column)}].fillna(${strategies[p.strategy] || '0'})`;
      },
      describe: (p) => ({ key: 'step.fillna', params: { col: p.column, how: t('fill.' + p.strategy) } }),
    },

    dropDuplicates: {
      group: 'clean', icon: 'dedupe', labelKey: 'op.dropDuplicates',
      params: [
        { name: 'subset', type: 'columns', labelKey: 'param.subset', allowEmpty: true, default: [] },
        { name: 'keep', type: 'select', labelKey: 'param.keep', options: [{ value: 'first', labelKey: 'keep.first' }, { value: 'last', labelKey: 'keep.last' }], default: 'first' },
      ],
      defaults: () => ({ subset: [], keep: 'first' }),
      apply: (df, p) => df.dropDuplicates(p.subset, p.keep),
      python: (p) => `df = df.drop_duplicates(${(p.subset || []).length ? `subset=${pyList(p.subset)}, ` : ''}keep=${pyStr(p.keep || 'first')})`,
      describe: (p) => ({ key: 'step.dropDuplicates', params: { cols: (p.subset || []).length ? (p.subset || []).join(', ') : t('param.allColumns') } }),
    },

    filterOutliers: {
      group: 'clean', icon: 'outlier', labelKey: 'op.filterOutliers',
      params: [
        { name: 'column', type: 'numColumn', labelKey: 'param.column', default: '' },
        { name: 'method', type: 'select', labelKey: 'param.method', options: [{ value: 'iqr', labelKey: 'outlier.iqr' }, { value: 'zscore', labelKey: 'outlier.zscore' }], default: 'iqr' },
        { name: 'threshold', type: 'number', labelKey: 'param.threshold', default: 1.5, step: 0.1, min: 0.1, when: (p) => p.method === 'iqr' },
        { name: 'z', type: 'number', labelKey: 'param.zThreshold', default: 3, step: 0.1, min: 0.5, when: (p) => p.method === 'zscore' },
        { name: 'keep', type: 'select', labelKey: 'param.keepRows', options: [{ value: 'inliers', labelKey: 'outlier.inliers' }, { value: 'outliers', labelKey: 'outlier.outliers' }], default: 'inliers' },
      ],
      defaults: (df) => ({ column: df.numericColumns()[0] || df.names[0], method: 'iqr', threshold: 1.5, z: 3, keep: 'inliers' }),
      apply: (df, p) => {
        if (!p.column) throw new Error(t('err.pickColumn'));
        const col = df.col(p.column);
        let flags;
        if (p.method === 'zscore') {
          const zs = S.zscore(col);
          const lim = Number(p.z) || 3;
          flags = zs.map((z) => z === null || Math.abs(z) <= lim);
        } else {
          const bs = S.boxStats(col, Number(p.threshold) || 1.5);
          const lo = bs.q1 - (Number(p.threshold) || 1.5) * bs.iqr;
          const hi = bs.q3 + (Number(p.threshold) || 1.5) * bs.iqr;
          flags = col.map((v) => { const n = S.toNum(v); return n === null ? true : n >= lo && n <= hi; });
        }
        const mask = p.keep === 'outliers' ? flags.map((f) => !f) : flags;
        return df.filterMask(mask);
      },
      python: (p) => (p.method === 'zscore'
        ? `z = (df[${pyStr(p.column)}] - df[${pyStr(p.column)}].mean()) / df[${pyStr(p.column)}].std()\ndf = df[${p.keep === 'outliers' ? `z.abs() > ${p.z || 3}` : `z.abs() <= ${p.z || 3}`}]`
        : `q1, q3 = df[${pyStr(p.column)}].quantile([0.25, 0.75])\niqr = q3 - q1\nlo, hi = q1 - ${p.threshold || 1.5} * iqr, q3 + ${p.threshold || 1.5} * iqr\ndf = df[${p.keep === 'outliers' ? `(df[${pyStr(p.column)}] < lo) | (df[${pyStr(p.column)}] > hi)` : `df[${pyStr(p.column)}].between(lo, hi)`}]`),
      describe: (p) => ({ key: 'step.filterOutliers', params: { col: p.column, method: t('outlier.' + p.method), keep: t('outlier.' + p.keep) } }),
    },

    /* -------------------------------------------------------------- columns */
    selectColumns: {
      group: 'columns', icon: 'columns', labelKey: 'op.selectColumns',
      params: [{ name: 'columns', type: 'columns', labelKey: 'param.columns', default: [] }],
      defaults: (df) => ({ columns: df.names.slice() }),
      apply: (df, p) => {
        const cols = (p.columns || []).filter((n) => df.names.includes(n));
        if (!cols.length) throw new Error(t('err.pickColumn'));
        return df.select(cols);
      },
      python: (p) => `df = df[${pyList(p.columns || [])}]`,
      describe: (p) => ({ key: 'step.selectColumns', params: { cols: (p.columns || []).join(', ') } }),
    },

    dropColumns: {
      group: 'columns', icon: 'drop', labelKey: 'op.dropColumns',
      params: [{ name: 'columns', type: 'columns', labelKey: 'param.columns', default: [] }],
      defaults: (df) => ({ columns: [df.names[df.names.length - 1]] }),
      apply: (df, p) => {
        const cols = (p.columns || []).filter((n) => df.names.includes(n));
        if (!cols.length) throw new Error(t('err.pickColumn'));
        if (cols.length === df.ncols) throw new Error(t('err.keepOneColumn'));
        return df.drop(cols);
      },
      python: (p) => `df = df.drop(columns=${pyList(p.columns || [])})`,
      describe: (p) => ({ key: 'step.dropColumns', params: { cols: (p.columns || []).join(', ') } }),
    },

    rename: {
      group: 'columns', icon: 'rename', labelKey: 'op.rename',
      params: [
        { name: 'column', type: 'column', labelKey: 'param.column', default: '' },
        { name: 'newName', type: 'text', labelKey: 'param.newName', default: '' },
      ],
      defaults: (df) => ({ column: df.names[0], newName: `${df.names[0]}_new` }),
      apply: (df, p) => {
        if (!p.column || !p.newName) throw new Error(t('err.needBoth'));
        if (p.column === p.newName) throw new Error(t('err.sameName'));
        return df.rename({ [p.column]: p.newName });
      },
      python: (p) => `df = df.rename(columns={${pyStr(p.column)}: ${pyStr(p.newName)}})`,
      describe: (p) => ({ key: 'step.rename', params: { from: p.column, to: p.newName } }),
    },

    astype: {
      group: 'columns', icon: 'type', labelKey: 'op.astype',
      params: [
        { name: 'column', type: 'column', labelKey: 'param.column', default: '' },
        { name: 'dtype', type: 'select', labelKey: 'param.dtype', options: [
          { value: 'int64', labelKey: 'dtype.int64' }, { value: 'float64', labelKey: 'dtype.float64' },
          { value: 'object', labelKey: 'dtype.object' }, { value: 'bool', labelKey: 'dtype.bool' },
          { value: 'datetime64', labelKey: 'dtype.datetime64' }, { value: 'category', labelKey: 'dtype.category' }], default: 'float64' },
      ],
      defaults: (df) => ({ column: df.names[0], dtype: 'float64' }),
      apply: (df, p) => {
        if (!p.column) throw new Error(t('err.pickColumn'));
        return df.astype(p.column, p.dtype);
      },
      python: (p) => `df[${pyStr(p.column)}] = df[${pyStr(p.column)}].astype(${pyStr(p.dtype === 'category' ? 'category' : p.dtype)})`,
      describe: (p) => ({ key: 'step.astype', params: { col: p.column, dtype: p.dtype } }),
    },

    assign: {
      group: 'columns', icon: 'formula', labelKey: 'op.assign',
      params: [
        { name: 'name', type: 'text', labelKey: 'param.newColumn', default: 'new_column' },
        { name: 'expr', type: 'expression', labelKey: 'param.expression', default: '' },
      ],
      defaults: (df) => {
        const a = df.numericColumns()[0], b = df.numericColumns()[1];
        return { name: 'new_column', expr: b ? `${a} * ${b}` : `${a} * 2` };
      },
      apply: (df, p) => {
        if (!String(p.expr || '').trim()) throw new Error(t('err.emptyExpression'));
        return df.assign(p.name || 'new_column', p.expr);
      },
      python: (p, ctx) => `df = df.assign(${String(p.name || 'new_column').replace(/[^0-9A-Za-z_一-龥]/g, '_')}=${global.Expr.toPython(p.expr, ctx && ctx.df)})`,
      describe: (p) => ({ key: 'step.assign', params: { name: p.name, expr: p.expr } }),
    },

    math: {
      group: 'columns', icon: 'math', labelKey: 'op.math',
      params: [
        { name: 'column', type: 'numColumn', labelKey: 'param.column', default: '' },
        { name: 'op', type: 'select', labelKey: 'param.operation', options: [
          { value: 'round', labelKey: 'math.round' }, { value: 'abs', labelKey: 'math.abs' },
          { value: 'sqrt', labelKey: 'math.sqrt' }, { value: 'log', labelKey: 'math.log' },
          { value: 'log10', labelKey: 'math.log10' }, { value: 'exp', labelKey: 'math.exp' },
          { value: 'floor', labelKey: 'math.floor' }, { value: 'ceil', labelKey: 'math.ceil' },
          { value: 'clip', labelKey: 'math.clip' }, { value: 'negative', labelKey: 'math.negative' },
          { value: 'diff', labelKey: 'math.diff' }, { value: 'pctchange', labelKey: 'math.pctchange' },
          { value: 'shift', labelKey: 'math.shift' }, { value: 'cumsum', labelKey: 'math.cumsum' },
          { value: 'cummax', labelKey: 'math.cummax' }, { value: 'cummin', labelKey: 'math.cummin' },
          { value: 'rank', labelKey: 'math.rank' }, { value: 'normalize', labelKey: 'math.normalize' },
          { value: 'standardize', labelKey: 'math.standardize' }], default: 'round' },
        { name: 'digits', type: 'number', labelKey: 'param.digits', default: 2, min: 0, step: 1, when: (p) => p.op === 'round' },
        { name: 'lo', type: 'number', labelKey: 'param.lower', default: 0, step: 1, when: (p) => p.op === 'clip' },
        { name: 'hi', type: 'number', labelKey: 'param.upper', default: 100, step: 1, when: (p) => p.op === 'clip' },
        { name: 'periods', type: 'number', labelKey: 'param.periods', default: 1, min: 1, step: 1, when: (p) => ['diff', 'pctchange', 'shift'].includes(p.op) },
        { name: 'newColumn', type: 'checkbox', labelKey: 'param.keepOriginal', default: true },
      ],
      defaults: (df) => ({ column: df.numericColumns()[0] || df.names[0], op: 'round', digits: 2, lo: 0, hi: 100, periods: 1, newColumn: true }),
      apply: (df, p) => {
        if (!p.column) throw new Error(t('err.pickColumn'));
        const op = p.op === 'negative' ? 'neg' : p.op;
        return df.mathOp(p.column, op, { digits: p.digits, lo: p.lo, hi: p.hi, periods: p.periods, newColumn: p.newColumn });
      },
      python: (p) => {
        const c = `df[${pyStr(p.column)}]`;
        const keep = p.newColumn ? `${p.column}_${p.op}` : p.column;
        const exprs = {
          round: `${c}.round(${p.digits ?? 2})`, abs: `${c}.abs()`, sqrt: `np.sqrt(${c})`, log: `np.log(${c})`,
          log10: `np.log10(${c})`, exp: `np.exp(${c})`, floor: `np.floor(${c})`, ceil: `np.ceil(${c})`,
          clip: `${c}.clip(${p.lo}, ${p.hi})`, negative: `-${c}`, diff: `${c}.diff(${p.periods || 1})`,
          pctchange: `${c}.pct_change(${p.periods || 1})`, shift: `${c}.shift(${p.periods || 1})`,
          cumsum: `${c}.cumsum()`, cummax: `${c}.cummax()`, cummin: `${c}.cummin()`, rank: `${c}.rank()`,
          normalize: `(${c} - ${c}.min()) / (${c}.max() - ${c}.min())`,
          standardize: `(${c} - ${c}.mean()) / ${c}.std()`,
        };
        return `df[${pyStr(keep)}] = ${exprs[p.op] || c}`;
      },
      describe: (p) => ({ key: 'step.math', params: { col: p.column, op: t('math.' + p.op) } }),
    },

    textOp: {
      group: 'columns', icon: 'text', labelKey: 'op.text',
      params: [
        { name: 'column', type: 'column', labelKey: 'param.column', default: '' },
        { name: 'op', type: 'select', labelKey: 'param.operation', options: [
          { value: 'upper', labelKey: 'text.upper' }, { value: 'lower', labelKey: 'text.lower' },
          { value: 'title', labelKey: 'text.title' }, { value: 'strip', labelKey: 'text.strip' },
          { value: 'len', labelKey: 'text.len' }, { value: 'replace', labelKey: 'text.replace' },
          { value: 'contains', labelKey: 'text.contains' }, { value: 'startswith', labelKey: 'text.startswith' },
          { value: 'endswith', labelKey: 'text.endswith' }, { value: 'slice', labelKey: 'text.slice' },
          { value: 'split', labelKey: 'text.split' }, { value: 'extract', labelKey: 'text.extract' },
          { value: 'pad', labelKey: 'text.pad' }, { value: 'cat', labelKey: 'text.cat' }], default: 'upper' },
        { name: 'find', type: 'text', labelKey: 'param.find', default: '', when: (p) => ['replace', 'contains', 'startswith', 'endswith'].includes(p.op) },
        { name: 'replace', type: 'text', labelKey: 'param.replaceWith', default: '', when: (p) => p.op === 'replace' },
        { name: 'start', type: 'number', labelKey: 'param.start', default: 0, step: 1, when: (p) => p.op === 'slice' },
        { name: 'end', type: 'number', labelKey: 'param.end', default: 5, step: 1, when: (p) => p.op === 'slice' },
        { name: 'sep', type: 'text', labelKey: 'param.separator', default: ' ', when: (p) => p.op === 'split' },
        { name: 'index', type: 'number', labelKey: 'param.index', default: 0, step: 1, when: (p) => p.op === 'split' },
        { name: 'pattern', type: 'text', labelKey: 'param.regex', default: '([A-Za-z]+)', when: (p) => p.op === 'extract' },
        { name: 'width', type: 'number', labelKey: 'param.width', default: 5, step: 1, when: (p) => p.op === 'pad' },
        { name: 'suffix', type: 'text', labelKey: 'param.suffix', default: '', when: (p) => p.op === 'cat' },
        { name: 'newColumn', type: 'checkbox', labelKey: 'param.keepOriginal', default: true },
      ],
      defaults: (df) => ({ column: df.names.find((n) => !['int64', 'float64'].includes(df.dtype(n))) || df.names[0], op: 'upper', find: '', replace: '', start: 0, end: 5, sep: ' ', index: 0, pattern: '([A-Za-z]+)', width: 5, suffix: '', newColumn: true }),
      apply: (df, p) => {
        if (!p.column) throw new Error(t('err.pickColumn'));
        return df.strOp(p.column, p.op, p);
      },
      python: (p) => {
        const c = `df[${pyStr(p.column)}].astype(str)`;
        const keep = p.newColumn ? `${p.column}_${p.op}` : p.column;
        const exprs = {
          upper: `${c}.str.upper()`, lower: `${c}.str.lower()`, title: `${c}.str.title()`,
          strip: `${c}.str.strip()`, len: `${c}.str.len()`,
          replace: `${c}.str.replace(${pyStr(p.find)}, ${pyStr(p.replace)}, regex=False)`,
          contains: `${c}.str.contains(${pyStr(p.find)}, case=False, na=False)`,
          startswith: `${c}.str.startswith(${pyStr(p.find)})`, endswith: `${c}.str.endswith(${pyStr(p.find)})`,
          slice: `${c}.str.slice(${p.start}, ${p.end})`, split: `${c}.str.split(${pyStr(p.sep)}).str[${p.index}]`,
          extract: `${c}.str.extract(r${pyStr(p.pattern)})[0]`, pad: `${c}.str.zfill(${p.width})`,
          cat: `${c} + ${pyStr(p.suffix)}`,
        };
        return `df[${pyStr(keep)}] = ${exprs[p.op] || c}`;
      },
      describe: (p) => ({ key: 'step.text', params: { col: p.column, op: t('text.' + p.op) } }),
    },

    datetimePart: {
      group: 'columns', icon: 'calendar', labelKey: 'op.datetime',
      params: [
        { name: 'column', type: 'column', labelKey: 'param.column', default: '' },
        { name: 'part', type: 'select', labelKey: 'param.part', options: [
          { value: 'year', labelKey: 'dt.year' }, { value: 'quarter', labelKey: 'dt.quarter' },
          { value: 'month', labelKey: 'dt.month' }, { value: 'monthname', labelKey: 'dt.monthname' },
          { value: 'week', labelKey: 'dt.week' }, { value: 'day', labelKey: 'dt.day' },
          { value: 'weekday', labelKey: 'dt.weekday' }, { value: 'dayname', labelKey: 'dt.dayname' },
          { value: 'hour', labelKey: 'dt.hour' }, { value: 'minute', labelKey: 'dt.minute' },
          { value: 'date', labelKey: 'dt.date' }], default: 'year' },
      ],
      defaults: (df) => ({ column: df.datetimeColumns()[0] || df.names[0], part: 'year' }),
      apply: (df, p) => {
        if (!p.column) throw new Error(t('err.pickColumn'));
        return df.dtPart(p.column, p.part);
      },
      python: (p) => `df[${pyStr(`${p.column}_${p.part}`)}] = pd.to_datetime(df[${pyStr(p.column)}]).dt.${p.part === 'monthname' ? 'month_name()' : p.part === 'dayname' ? 'day_name()' : p.part === 'date' ? 'date' : p.part}`,
      describe: (p) => ({ key: 'step.datetime', params: { col: p.column, part: t('dt.' + p.part) } }),
    },

    bin: {
      group: 'columns', icon: 'bin', labelKey: 'op.bin',
      params: [
        { name: 'column', type: 'numColumn', labelKey: 'param.column', default: '' },
        { name: 'mode', type: 'select', labelKey: 'param.method', options: [{ value: 'width', labelKey: 'bin.width' }, { value: 'quantile', labelKey: 'bin.quantile' }, { value: 'custom', labelKey: 'bin.custom' }], default: 'width' },
        { name: 'bins', type: 'number', labelKey: 'param.bins', default: 5, min: 2, step: 1, when: (p) => p.mode !== 'custom' },
        { name: 'edges', type: 'text', labelKey: 'param.edges', default: '', when: (p) => p.mode === 'custom' },
      ],
      defaults: (df) => ({ column: df.numericColumns()[0] || df.names[0], mode: 'width', bins: 5, edges: '' }),
      apply: (df, p) => {
        if (!p.column) throw new Error(t('err.pickColumn'));
        const a = S.clean(df.col(p.column)).sort((x, y) => x - y);
        if (!a.length) throw new Error(t('err.emptyColumn'));
        if (p.mode === 'quantile') return df.qcut(p.column, Math.max(2, Number(p.bins) || 4));
        let edges;
        if (p.mode === 'custom') {
          edges = String(p.edges).split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
          if (edges.length < 2) throw new Error(t('err.needTwoEdges'));
          return df.cut(p.column, edges.slice(1, -1), null, true);
        }
        const k = Math.max(2, Number(p.bins) || 5);
        const lo = S.min(a), hi = S.max(a);
        edges = rangeArr(k + 1).map((i) => lo + (i * (hi - lo)) / k);
        return df.cut(p.column, edges.slice(1, -1), null, true);
      },
      python: (p) => (p.mode === 'quantile'
        ? `df[${pyStr(`${p.column}_bin`)}] = pd.qcut(df[${pyStr(p.column)}], q=${p.bins}, duplicates="drop")`
        : `df[${pyStr(`${p.column}_bin`)}] = pd.cut(df[${pyStr(p.column)}], bins=${p.mode === 'custom' ? pyList(String(p.edges).split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))) : p.bins})`),
      describe: (p) => ({ key: 'step.bin', params: { col: p.column, mode: t('bin.' + p.mode), bins: p.mode === 'custom' ? p.edges : p.bins } }),
    },

    rolling: {
      group: 'columns', icon: 'rolling', labelKey: 'op.rolling',
      params: [
        { name: 'column', type: 'numColumn', labelKey: 'param.column', default: '' },
        { name: 'window', type: 'number', labelKey: 'param.window', default: 7, min: 2, step: 1 },
        { name: 'agg', type: 'select', labelKey: 'param.function', options: [
          { value: 'mean', labelKey: 'agg.mean' }, { value: 'sum', labelKey: 'agg.sum' },
          { value: 'std', labelKey: 'agg.std' }, { value: 'median', labelKey: 'agg.median' },
          { value: 'min', labelKey: 'agg.min' }, { value: 'max', labelKey: 'agg.max' }], default: 'mean' },
        { name: 'minPeriods', type: 'number', labelKey: 'param.minPeriods', default: 1, min: 1, step: 1 },
      ],
      defaults: (df) => ({ column: df.numericColumns()[0] || df.names[0], window: 7, agg: 'mean', minPeriods: 1 }),
      apply: (df, p) => {
        if (!p.column) throw new Error(t('err.pickColumn'));
        return df.rolling(p.column, p.window, p.minPeriods, p.agg);
      },
      python: (p) => `df[${pyStr(`${p.column}_rolling_${p.agg}_${p.window}`)}] = df[${pyStr(p.column)}].rolling(${p.window}, min_periods=${p.minPeriods || 1}).${p.agg}()`,
      describe: (p) => ({ key: 'step.rolling', params: { col: p.column, window: p.window, agg: t('agg.' + p.agg) } }),
    },

    /* ------------------------------------------------------------ aggregate */
    groupAgg: {
      group: 'aggregate', icon: 'group', labelKey: 'op.groupAgg',
      params: [
        { name: 'by', type: 'columns', labelKey: 'param.groupBy', default: [] },
        { name: 'valueCols', type: 'columns', labelKey: 'param.valueColumns', allowEmpty: true, default: [] },
        { name: 'funcs', type: 'aggFuncs', labelKey: 'param.aggregations', default: ['mean'] },
        { name: 'sortBy', type: 'select', labelKey: 'param.sortResult', options: [{ value: '', labelKey: 'sort.none' }, { value: '__group__', labelKey: 'sort.group' }], default: '' },
      ],
      defaults: (df) => {
        const cat = df.names.find((n) => !df.numericColumns().includes(n));
        return { by: cat ? [cat] : [df.names[0]], valueCols: df.numericColumns().slice(0, 1), funcs: ['mean'], sortBy: '' };
      },
      apply: (df, p) => {
        const by = (p.by || []).filter((n) => df.names.includes(n));
        if (!by.length) throw new Error(t('err.pickColumn'));
        const vals = (p.valueCols || []).filter((n) => df.names.includes(n));
        const funcs = (p.funcs || []).length ? p.funcs : ['mean'];
        const spec = {};
        vals.forEach((v) => { spec[v] = funcs; });
        return df.groupAgg(by, spec, { sortBy: p.sortBy || null });
      },
      python: (p) => {
        const by = pyList(p.by || []);
        const vals = (p.valueCols || []);
        if (!vals.length) return `df = df.groupby(${by}).size().reset_index(name="count")`;
        const spec = '{' + vals.map((v) => `${pyStr(v)}: ${pyList(p.funcs || ['mean'])}`).join(', ') + '}';
        return `df = df.groupby(${by}).agg(${spec}).reset_index()\ndf.columns = ["_".join(c).strip("_") for c in df.columns]`;
      },
      describe: (p) => ({ key: 'step.groupAgg', params: { by: (p.by || []).join('+'), funcs: (p.funcs || []).map((f) => t('agg.' + f)).join('/'), vals: (p.valueCols || []).length ? (p.valueCols || []).join(', ') : t('agg.size') } }),
    },

    pivot: {
      group: 'aggregate', icon: 'pivot', labelKey: 'op.pivot',
      params: [
        { name: 'index', type: 'columns', labelKey: 'param.index', default: [] },
        { name: 'columns', type: 'columns', labelKey: 'param.pivotColumns', allowEmpty: true, default: [] },
        { name: 'values', type: 'columns', labelKey: 'param.valueColumns', allowEmpty: true, default: [] },
        { name: 'aggfunc', type: 'select', labelKey: 'param.aggregations', options: AGG_CHOICES.map((a) => ({ value: a, labelKey: 'agg.' + a })), default: 'mean' },
      ],
      defaults: (df) => {
        const cats = df.names.filter((n) => !df.numericColumns().includes(n));
        return { index: cats.slice(0, 1), columns: cats.slice(1, 2), values: df.numericColumns().slice(0, 1), aggfunc: 'mean' };
      },
      apply: (df, p) => {
        if (!(p.index || []).length) throw new Error(t('err.pickColumn'));
        if (!(p.values || []).length) throw new Error(t('err.pickColumn'));
        return df.pivotTable({ index: p.index, columns: p.columns || [], values: p.values || [], aggfunc: p.aggfunc || 'mean' });
      },
      python: (p) => `df = df.pivot_table(index=${pyList(p.index || [])}, ${(p.columns || []).length ? `columns=${pyList(p.columns)}, ` : ''}values=${pyList(p.values || [])}, aggfunc=${pyStr(p.aggfunc || 'mean')}).reset_index()${(p.columns || []).length ? '\n# flatten the MultiIndex columns into "value [column]" names\nif isinstance(df.columns, pd.MultiIndex):\n    df.columns = [f"{a} [{b}]" if b != "" else a for a, b in df.columns]' : ''}`,
      describe: (p) => ({ key: 'step.pivot', params: { index: (p.index || []).join('+'), columns: (p.columns || []).join('+') || '—', values: (p.values || []).join(', '), agg: t('agg.' + (p.aggfunc || 'mean')) } }),
    },

    melt: {
      group: 'aggregate', icon: 'melt', labelKey: 'op.melt',
      params: [
        { name: 'idVars', type: 'columns', labelKey: 'param.idVars', allowEmpty: true, default: [] },
        { name: 'valueVars', type: 'columns', labelKey: 'param.valueColumns', default: [] },
      ],
      defaults: (df) => ({ idVars: df.names.slice(0, 1), valueVars: df.numericColumns().slice(0, 3) }),
      apply: (df, p) => {
        if (!(p.valueVars || []).length) throw new Error(t('err.pickColumn'));
        return df.melt(p.idVars || [], p.valueVars || []);
      },
      python: (p) => `df = df.melt(id_vars=${pyList(p.idVars || [])}, value_vars=${pyList(p.valueVars || [])}, var_name="variable", value_name="value")`,
      describe: (p) => ({ key: 'step.melt', params: { id: (p.idVars || []).join(', ') || '—', vals: (p.valueVars || []).join(', ') } }),
    },

    merge: {
      group: 'aggregate', icon: 'merge', labelKey: 'op.merge',
      params: [
        { name: 'dataset', type: 'dataset', labelKey: 'param.dataset', default: '' },
        { name: 'how', type: 'select', labelKey: 'param.joinType', options: [
          { value: 'inner', labelKey: 'join.inner' }, { value: 'left', labelKey: 'join.left' },
          { value: 'right', labelKey: 'join.right' }, { value: 'outer', labelKey: 'join.outer' }], default: 'inner' },
        { name: 'leftOn', type: 'columns', labelKey: 'param.leftKey', default: [] },
        { name: 'rightOn', type: 'columns', labelKey: 'param.rightKey', allowEmpty: true, default: [] },
      ],
      defaults: (df, ctx) => {
        const others = (ctx && ctx.datasets || []).filter((d) => d.df !== df);
        const other = others[0];
        const shared = other ? df.names.filter((n) => other.df.names.includes(n)) : [];
        return { dataset: other ? other.name : '', how: 'inner', leftOn: shared.slice(0, 1), rightOn: shared.slice(0, 1) };
      },
      apply: (df, p, ctx) => {
        const target = (ctx.datasets || []).find((d) => d.name === p.dataset);
        if (!target) throw new Error(t('err.pickDataset'));
        if (!(p.leftOn || []).length) throw new Error(t('err.pickColumn'));
        const rightOn = (p.rightOn || []).length ? p.rightOn : p.leftOn;
        return df.merge(target.df, { how: p.how, leftOn: p.leftOn, rightOn, suffixes: ['_x', '_y'] });
      },
      python: (p, ctx) => `other = pd.read_csv(${pyStr((p.dataset || 'other') + '.csv')})\ndf = df.merge(other, left_on=${pyList(p.leftOn || [])}, right_on=${pyList((p.rightOn || []).length ? p.rightOn : p.leftOn || [])}, how=${pyStr(p.how)})`,
      describe: (p) => ({ key: 'step.merge', params: { how: t('join.' + p.how), with: p.dataset, on: (p.leftOn || []).join(', ') } }),
    },

    corr: {
      group: 'aggregate', icon: 'corr', labelKey: 'op.corr',
      params: [
        { name: 'method', type: 'select', labelKey: 'param.method', options: [
          { value: 'pearson', labelKey: 'corr.pearson' }, { value: 'spearman', labelKey: 'corr.spearman' },
          { value: 'kendall', labelKey: 'corr.kendall' }], default: 'pearson' },
        { name: 'columns', type: 'columns', labelKey: 'param.columns', allowEmpty: true, default: [] },
      ],
      defaults: (df) => ({ method: 'pearson', columns: df.numericColumns() }),
      apply: (df, p) => df.corr(p.method, (p.columns || []).length ? p.columns : null),
      python: (p) => `df = df[${pyList((p.columns || []).length ? p.columns : 'df.select_dtypes("number").columns.tolist()')}].corr(method=${pyStr(p.method)})\ndf = df.reset_index().rename(columns={"index": "variable"})`,
      describe: (p) => ({ key: 'step.corr', params: { method: t('corr.' + p.method), n: (p.columns || []).length } }),
    },

    resetIndex: {
      group: 'clean', icon: 'reset', labelKey: 'op.resetIndex',
      params: [],
      defaults: () => ({}),
      apply: (df) => { const c = df.clone(); c.index = null; return c; },
      python: () => 'df = df.reset_index(drop=True)',
      describe: () => ({ key: 'step.resetIndex', params: {} }),
    },
  };

  const GROUPS = [
    { id: 'rows', labelKey: 'group.rows', icon: 'rows' },
    { id: 'columns', labelKey: 'group.columns', icon: 'columns' },
    { id: 'clean', labelKey: 'group.clean', icon: 'clean' },
    { id: 'aggregate', labelKey: 'group.aggregate', icon: 'group' },
  ];

  /** Build the default parameter object for an op against a given frame. */
  function defaultParams(opId, df, ctx) {
    const op = OPS[opId];
    if (!op) return {};
    let p = {};
    if (op.defaults) { try { p = op.defaults(df, ctx) || {}; } catch (e) { p = {}; } }
    op.params.forEach((spec) => {
      if (p[spec.name] === undefined && spec.default !== undefined) {
        p[spec.name] = Array.isArray(spec.default) ? spec.default.slice() : spec.default;
      }
    });
    return p;
  }

  /** Instantiates a new pipeline step. */
  function makeStep(opId, df, ctx) {
    return {
      id: 's' + Math.random().toString(36).slice(2, 9),
      op: opId,
      params: defaultParams(opId, df, ctx),
      enabled: true,
    };
  }

  /** Extracts the pandas code a single step would produce. */
  function stepPython(step, ctx) {
    const op = OPS[step.op];
    if (!op || !op.python) return '';
    try { return op.python(step.params, ctx); } catch (e) { return '# ' + e.message; }
  }

  function stepDescribe(step) {
    const op = OPS[step.op];
    if (!op) return { key: 'step.unknown', params: {} };
    try { return op.describe ? op.describe(step.params) : { key: op.labelKey, params: {} }; } catch (e) { return { key: op.labelKey, params: {} }; }
  }

  /** Runs a whole pipeline, returning the frame and a per-step trace. */
  function runPipeline(baseDf, steps, ctx) {
    let df = baseDf;
    const trace = [];
    for (const step of steps) {
      const op = OPS[step.op];
      const before = df.nrows;
      if (!step.enabled) { trace.push({ id: step.id, skipped: true, rows: before }); continue; }
      try {
        const out = op.apply(df, step.params, ctx);
        df = out;
        trace.push({ id: step.id, rows: out.nrows, delta: out.nrows - before, cols: out.ncols, ok: true });
      } catch (e) {
        trace.push({ id: step.id, error: e.message, rows: before, ok: false });
        throw Object.assign(new Error(e.message), { stepId: step.id, trace });
      }
    }
    return { df, trace };
  }

  /** The full pandas program for a source + pipeline. */
  function pipelinePython(source, steps, ctx) {
    const lines = [];
    lines.push('# ==== auto-generated pandas code ====');
    lines.push('import pandas as pd');
    lines.push('import numpy as np');
    if (source.kind === 'csv') lines.push(`df = pd.read_csv(${pyStr(source.name)})`);
    else if (source.kind === 'excel') lines.push(`df = pd.read_excel(${pyStr(source.name)})`);
    else if (source.kind === 'json') lines.push(`df = pd.read_json(${pyStr(source.name)})`);
    else lines.push(`df = pd.read_csv(${pyStr(source.name)})  # replace with your own file path`);
    lines.push('');
    lines.push('print(df.shape)');
    lines.push('');
    for (const step of steps) {
      let code = '';
      try { code = stepPython(step, ctx); } catch (e) { code = '# ' + e.message; }
      if (!code) continue;
      const label = global.I18N.t(stepDescribe(step).key, stepDescribe(step).params);
      lines.push(`# ${step.enabled ? '' : '[disabled] '}${label}`);
      code.split('\n').forEach((l) => lines.push(l));
      lines.push('');
    }
    lines.push('print(df.head())');
    return lines.join('\n');
  }

  global.Ops = { OPS, GROUPS, AGG_CHOICES, defaultParams, makeStep, stepPython, stepDescribe, runPipeline, pipelinePython, exprToPython };
})(window);
