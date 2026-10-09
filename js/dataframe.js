/* =============================================================================
 * dataframe.js — a pandas-like DataFrame for the browser.
 *
 * Storage is columnar:  { names: [...], dtypes: [...], values: [[...], ...] }
 * Missing values are `null`. Datetimes are stored as ISO-8601 strings so that
 * sorting, comparison and export all behave sensibly.
 * ========================================================================== */
(function (global) {
  'use strict';

  const S = global.Stats;

  const DTYPE = {
    INT: 'int64',
    FLOAT: 'float64',
    BOOL: 'bool',
    DATETIME: 'datetime64',
    OBJ: 'object',
    CAT: 'category',
  };

  const NA_TOKENS = new Set(['', 'na', 'n/a', 'nan', 'null', 'none', 'nil', 'missing', '#n/a', '#na', '-', '--', '?']);

  const NUMERIC = new Set([DTYPE.INT, DTYPE.FLOAT]);

  const isNum = (dt) => NUMERIC.has(dt);
  const isDatetime = (dt) => dt === DTYPE.DATETIME;

  /* --------------------------------------------------------------- coercion */
  function parseDate(v) {
    const s = String(v).trim();
    let m;
    // ISO / year-first: 2018-01-31, 2018/01/31, 2018-01-31T10:20:30, 2018-01
    m = /^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?Z?)?$/.exec(s);
    if (m) {
      const [, y, mo, d, hh, mi, ss] = m;
      return { iso: isoOf(+y, +mo, d ? +d : 1, hh ? +hh : 0, mi ? +mi : 0, ss ? +ss : 0), hasTime: !!hh };
    }
    // month-first (US) or day-first when the first part cannot be a month
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
    if (m) {
      const a = +m[1], b = +m[2];
      let y = +m[3];
      if (y < 100) y += y < 70 ? 2000 : 1900;
      let mo, d;
      if (a > 12) { d = a; mo = b; } else { mo = a; d = b; }
      if (mo > 12 || d > 31) return null;
      return { iso: isoOf(y, mo, d, m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0), hasTime: !!m[4] };
    }
    // textual: 31 Jan 2018 / Jan 31, 2018
    m = /^(\d{1,2})[ -]([A-Za-z]{3,9})[ -,]+(\d{4})$/.exec(s);
    if (m) { const mo = monthIndex(m[2]); if (mo) return { iso: isoOf(+m[3], mo, +m[1], 0, 0, 0), hasTime: false }; }
    m = /^([A-Za-z]{3,9})[ -](\d{1,2})[ ,]+(\d{4})$/.exec(s);
    if (m) { const mo = monthIndex(m[1]); if (mo) return { iso: isoOf(+m[3], mo, +m[2], 0, 0, 0), hasTime: false }; }
    return null;
  }

  function monthIndex(name) {
    const idx = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
      .findIndex((m) => name.toLowerCase().startsWith(m));
    return idx >= 0 ? idx + 1 : null;
  }

  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const isoOf = (y, mo, d, h, mi, s) => `${pad(y, 4)}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}`;

  const looksLikeDate = (s) =>
    /^\d{4}[-/.]\d{1,2}([-/.]\d{1,2})?([T ]\d{1,2}:\d{2})?/.test(s) ||
    /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}([T ]\d{1,2}:\d{2})?$/.test(s) ||
    /^\d{1,2}[ -][A-Za-z]{3,9}[ -,]+\d{4}$/.test(s) ||
    /^[A-Za-z]{3,9}[ -]\d{1,2}[ ,]+\d{4}$/.test(s);

  function inferColumn(raw) {
    const vals = raw.filter((v) => !S.isMissing(v)).map((v) => String(v).trim());
    if (!vals.length) return DTYPE.OBJ;
    let allInt = true, allFloat = true, allBool = true, allDate = true;
    for (const v of vals) {
      if (allInt && !/^[+-]?\d+$/.test(v)) allInt = false;
      if (allFloat && !(v !== '' && Number.isFinite(Number(v)))) allFloat = false;
      if (allBool && !/^(true|false)$/i.test(v)) allBool = false;
      if (allDate && !looksLikeDate(v)) allDate = false;
      if (!allInt && !allFloat && !allBool && !allDate) break;
    }
    if (allInt) return DTYPE.INT;
    if (allFloat) return DTYPE.FLOAT;
    if (allBool) return DTYPE.BOOL;
    if (allDate && vals.length === raw.filter((v) => !S.isMissing(v)).length) return DTYPE.DATETIME;
    return DTYPE.OBJ;
  }

  /** Convert one raw cell to its typed representation. */
  function coerce(v, dtype) {
    if (S.isMissing(v)) return null;
    if (typeof v === 'number' || typeof v === 'boolean') {
      if (dtype === DTYPE.DATETIME) { const d = parseDate(v); return d ? d.iso : null; }
      if (dtype === DTYPE.OBJ || dtype === DTYPE.CAT) return v;
      const n = S.toNum(v);
      if (n === null) return null;
      return dtype === DTYPE.INT ? Math.trunc(n) : n;
    }
    const s = String(v).trim();
    if (S.isMissing(v) || NA_TOKENS.has(s.toLowerCase())) return null;
    switch (dtype) {
      case DTYPE.INT: { const n = S.toNum(s); return n === null ? null : Math.trunc(n); }
      case DTYPE.FLOAT: return S.toNum(s);
      case DTYPE.BOOL: {
        const l = s.toLowerCase();
        if (l === 'true' || l === '1' || l === 'yes' || l === 'y' || l === 't') return true;
        if (l === 'false' || l === '0' || l === 'no' || l === 'n' || l === 'f') return false;
        return null;
      }
      case DTYPE.DATETIME: { const d = parseDate(s); return d ? d.iso : null; }
      default: return s;
    }
  }

  function castArray(values, dtype) {
    return values.map((v) => coerce(v, dtype));
  }

  /** Display helper — pandas prints datetimes without the seconds when midnight. */
  function formatDatetime(iso) {
    if (!iso) return '';
    const s = String(iso);
    return s.endsWith('T00:00:00') ? s.slice(0, 10) : s.replace('T', ' ');
  }

  /* ------------------------------------------------------------- aggregation */
  const AGG_FUNCS = {
    count: (a) => a.filter((v) => !S.isMissing(v)).length,
    size: (a) => a.length,
    sum: (a) => { const c = S.clean(a); return c.length ? S.sum(c) : 0; },
    mean: (a) => S.mean(S.clean(a)),
    median: (a) => S.median(S.clean(a)),
    min: (a) => { const c = a.filter((v) => !S.isMissing(v)); return c.length ? c.reduce((m, v) => (sortable(v) < sortable(m) ? v : m)) : null; },
    max: (a) => { const c = a.filter((v) => !S.isMissing(v)); return c.length ? c.reduce((m, v) => (sortable(v) > sortable(m) ? v : m)) : null; },
    std: (a) => S.std(S.clean(a)),
    var: (a) => S.variance(S.clean(a)),
    sem: (a) => S.sem(S.clean(a)),
    nunique: (a) => new Set(a.filter((v) => !S.isMissing(v)).map(String)).size,
    unique: (a) => new Set(a.filter((v) => !S.isMissing(v)).map(String)).size,
    first: (a) => (a.length ? a[0] : null),
    last: (a) => (a.length ? a[a.length - 1] : null),
    mode: (a) => S.mode(a),
    missing: (a) => a.filter((v) => S.isMissing(v)).length,
    concat: (a) => a.filter((v) => !S.isMissing(v)).map(String).join(', '),
    product: (a) => { const c = S.clean(a); return c.length ? c.reduce((x, y) => x * y, 1) : null; },
    q25: (a) => S.quantile(S.clean(a).sort((x, y) => x - y), 0.25),
    q75: (a) => S.quantile(S.clean(a).sort((x, y) => x - y), 0.75),
  };

  const AGG_LABEL = {
    count: 'count', size: 'size', sum: 'sum', mean: 'mean', median: 'median', min: 'min', max: 'max',
    std: 'std', var: 'var', sem: 'sem', nunique: 'nunique', unique: 'nunique', first: 'first',
    last: 'last', mode: 'mode', missing: 'isna().sum', concat: 'join', product: 'prod', q25: '25%', q75: '75%',
  };

  const sortable = (v) => (typeof v === 'number' ? v : String(v));

  function compareValues(a, b) {
    const am = S.isMissing(a), bm = S.isMissing(b);
    if (am && bm) return 0;
    if (am) return 1;   // NaNs sort last, like pandas
    if (bm) return -1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
    const na = Number(a), nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && typeof a !== 'string' === typeof b !== 'string') return na - nb;
    return String(a).localeCompare(String(b));
  }

  /* ---------------------------------------------------------------- filters */
  const FILTER_OPS = {
    eq: { arity: 1, test: (v, x) => !S.isMissing(v) && (typeof v === 'number' ? S.toNum(x) === v : String(v).toLowerCase() === String(x).toLowerCase()) },
    ne: { arity: 1, test: (v, x) => !S.isMissing(v) && !(typeof v === 'number' ? S.toNum(x) === v : String(v).toLowerCase() === String(x).toLowerCase()) },
    gt: { arity: 1, test: (v, x) => { const a = S.toNum(v), b = S.toNum(x); return a !== null && b !== null && a > b; } },
    ge: { arity: 1, test: (v, x) => { const a = S.toNum(v), b = S.toNum(x); return a !== null && b !== null && a >= b; } },
    lt: { arity: 1, test: (v, x) => { const a = S.toNum(v), b = S.toNum(x); return a !== null && b !== null && a < b; } },
    le: { arity: 1, test: (v, x) => { const a = S.toNum(v), b = S.toNum(x); return a !== null && b !== null && a <= b; } },
    between: { arity: 2, test: (v, x, y) => { const a = S.toNum(v), b = S.toNum(x), c = S.toNum(y); return a !== null && b !== null && c !== null && a >= b && a <= c; } },
    contains: { arity: 1, test: (v, x) => !S.isMissing(v) && String(v).toLowerCase().includes(String(x).toLowerCase()) },
    startswith: { arity: 1, test: (v, x) => !S.isMissing(v) && String(v).toLowerCase().startsWith(String(x).toLowerCase()) },
    endswith: { arity: 1, test: (v, x) => !S.isMissing(v) && String(v).toLowerCase().endsWith(String(x).toLowerCase()) },
    in: { arity: 1, test: (v, x) => !S.isMissing(v) && String(x).split(',').map((s) => s.trim().toLowerCase()).includes(String(v).toLowerCase()) },
    notin: { arity: 1, test: (v, x) => !S.isMissing(v) && !String(x).split(',').map((s) => s.trim().toLowerCase()).includes(String(v).toLowerCase()) },
    isnull: { arity: 0, test: (v) => S.isMissing(v) },
    notnull: { arity: 0, test: (v) => !S.isMissing(v) },
    isinlist: { arity: 1, test: (v, x) => !S.isMissing(v) && String(x).split(',').map((s) => s.trim().toLowerCase()).includes(String(v).toLowerCase()) },
    regex: { arity: 1, test: (v, x) => { try { return !S.isMissing(v) && new RegExp(String(x), 'i').test(String(v)); } catch (e) { return false; } } },
    even: { arity: 0, test: (v) => { const n = S.toNum(v); return n !== null && n % 2 === 0; } },
    odd: { arity: 0, test: (v) => { const n = S.toNum(v); return n !== null && Math.abs(n % 2) === 1; } },
  };

  function pythonFilterOp(op, col, v1, v2) {
    const q = (x) => (x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x)) ? String(x) : JSON.stringify(String(x === null || x === undefined ? '' : x)));
    const c = col;
    switch (op) {
      case 'eq': return `df["${c}"] == ${q(v1)}`;
      case 'ne': return `df["${c}"] != ${q(v1)}`;
      case 'gt': return `df["${c}"] > ${q(v1)}`;
      case 'ge': return `df["${c}"] >= ${q(v1)}`;
      case 'lt': return `df["${c}"] < ${q(v1)}`;
      case 'le': return `df["${c}"] <= ${q(v1)}`;
      case 'between': return `df["${c}"].between(${q(v1)}, ${q(v2)})`;
      case 'contains': return `df["${c}"].astype(str).str.contains(${JSON.stringify(String(v1))}, case=False, na=False)`;
      case 'startswith': return `df["${c}"].astype(str).str.startswith(${JSON.stringify(String(v1))})`;
      case 'endswith': return `df["${c}"].astype(str).str.endswith(${JSON.stringify(String(v1))})`;
      case 'in': case 'isinlist': return `df["${c}"].isin(${JSON.stringify(String(v1).split(',').map((s) => s.trim()))})`;
      case 'notin': return `~df["${c}"].isin(${JSON.stringify(String(v1).split(',').map((s) => s.trim()))})`;
      case 'isnull': return `df["${c}"].isna()`;
      case 'notnull': return `df["${c}"].notna()`;
      case 'regex': return `df["${c}"].astype(str).str.contains(${JSON.stringify(String(v1))}, regex=True, na=False)`;
      case 'even': return `(df["${c}"] % 2 == 0)`;
      case 'odd': return `(df["${c}"] % 2 != 0)`;
      default: return `df["${c}"] == ${q(v1)}`;
    }
  }

  /* ==================================================================== Frame */
  class DataFrame {
    constructor(names, values, dtypes, opts) {
      this.names = names.slice();
      this.values = values.map((v) => v.slice());
      this.dtypes = dtypes.slice();
      this.index = (opts && opts.index) ? opts.index.slice() : null;
      this.meta = Object.assign({ sourceName: '', rows: names.length, steps: [] }, (opts && opts.meta) || {});
    }

    get nrows() { return this.values.length ? this.values[0].length : 0; }
    get ncols() { return this.names.length; }
    get shape() { return [this.nrows, this.ncols]; }

    colIndex(name) {
      const i = this.names.indexOf(name);
      if (i < 0) throw new Error(`Column not found: ${name}`);
      return i;
    }

    dtype(name) { return this.dtypes[this.colIndex(name)]; }

    col(name) { return this.values[this.colIndex(name)]; }

    at(row, colName) {
      const i = typeof colName === 'number' ? colName : this.colIndex(colName);
      return this.values[i][row];
    }

    clone() {
      return new DataFrame(this.names, this.values, this.dtypes, { index: this.index, meta: this.meta });
    }

    /* ------------------------------------------------------------ structural */
    select(names) {
      const idx = names.map((n) => this.colIndex(n));
      return new DataFrame(idx.map((i) => this.names[i]), idx.map((i) => this.values[i]), idx.map((i) => this.dtypes[i]), { index: this.index });
    }

    drop(names) {
      const set = new Set(names);
      const keep = this.names.map((n, i) => (set.has(n) ? -1 : i)).filter((i) => i >= 0);
      return new DataFrame(keep.map((i) => this.names[i]), keep.map((i) => this.values[i]), keep.map((i) => this.dtypes[i]), { index: this.index });
    }

    rename(mapping) {
      const names = this.names.map((n) => (mapping[n] !== undefined && mapping[n] !== '' ? mapping[n] : n));
      const seen = new Map();
      const unique = names.map((n) => {
        const c = (seen.get(n) || 0) + 1; seen.set(n, c);
        return c === 1 ? n : `${n}_${c}`;
      });
      return new DataFrame(unique, this.values, this.dtypes, { index: this.index, meta: this.meta });
    }

    reorder(names) {
      const rest = this.names.filter((n) => !names.includes(n));
      return this.select([...names.filter((n) => this.names.includes(n)), ...rest]);
    }

    insert(name, values, pos, dtype) {
      const dt = dtype || inferColumn(values);
      const names = this.names.slice();
      const cols = this.values.map((v) => v.slice());
      const dts = this.dtypes.slice();
      let finalName = name || 'column';
      let k = 2;
      while (names.includes(finalName)) finalName = `${name}_${k++}`;
      const p = pos === undefined || pos === null ? names.length : Math.max(0, Math.min(names.length, pos));
      names.splice(p, 0, finalName);
      cols.splice(p, 0, castArray(values, dt));
      dts.splice(p, 0, dt);
      return new DataFrame(names, cols, dts, { index: this.index, meta: this.meta });
    }

    /** Concat vertically (axis=0) or horizontally (axis=1). */
    static concat(frames, axis) {
      if (!frames.length) return null;
      if (axis === 1) {
        const names = [], cols = [], dts = [], seen = new Map();
        for (const f of frames) {
          f.names.forEach((n, i) => {
            let nm = n; const c = (seen.get(n) || 0) + 1; seen.set(n, c); if (c > 1) nm = `${n}_${c}`;
            names.push(nm); cols.push(f.values[i].slice()); dts.push(f.dtypes[i]);
          });
        }
        return new DataFrame(names, cols, dts);
      }
      const names = frames[0].names;
      const cols = names.map(() => []);
      const dts = frames[0].dtypes.slice();
      for (const f of frames) {
        names.forEach((n, i) => {
          const src = f.names.includes(n) ? f.col(n) : new Array(f.nrows).fill(null);
          cols[i].push(...src);
        });
      }
      return new DataFrame(names, cols, dts);
    }

    /* ------------------------------------------------------------- row views */
    _take(rows) {
      const cols = this.values.map((v) => rows.map((r) => v[r]));
      const index = this.index ? rows.map((r) => this.index[r]) : null;
      return new DataFrame(this.names, cols, this.dtypes, { index: index || rows, meta: this.meta });
    }

    head(n) { return this._take(rangeArr(Math.min(n === undefined ? 5 : n, this.nrows))); }
    tail(n) {
      const k = Math.min(n === undefined ? 5 : n, this.nrows);
      return this._take(rangeArr(this.nrows - k, this.nrows));
    }
    sample(n, seed) {
      const k = Math.min(n === undefined ? 5 : n, this.nrows);
      const rng = mulberry32(seed === undefined ? 42 : seed);
      const idx = rangeArr(this.nrows);
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
      return this._take(idx.slice(0, k).sort((a, b) => a - b));
    }

    filterMask(mask) {
      const rows = [];
      for (let i = 0; i < mask.length; i++) if (mask[i]) rows.push(i);
      return this._take(rows);
    }

    query(src) {
      const res = global.Expr.evaluateColumn(src, this);
      if (!res.ok) throw new Error(res.error);
      return this.filterMask(res.values.map((v) => (typeof v === 'boolean' ? v : !S.isMissing(v) && v !== 0 && v !== 'false')));
    }

    assign(name, src) {
      const res = global.Expr.evaluateColumn(src, this);
      if (!res.ok) throw new Error(res.error);
      return this.insert(name, res.values, null);
    }

    /* ------------------------------------------------------------- filtering */
    /** Structured (visual) filter: [{column, op, value, value2, logic}] */
    static applyConditions(df, conditions, groupLogic, matchAllGroups) {
      const active = conditions.filter((c) => c.column && c.op);
      if (!active.length) return df;
      const mask = new Array(df.nrows).fill(false);
      for (let i = 0; i < df.nrows; i++) {
        let result = null;
        for (const c of active) {
          const f = FILTER_OPS[c.op];
          if (!f) continue;
          const v = df.at(i, c.column);
          const ok = f.test(v, c.value, c.value2);
          if (result === null) result = ok;
          else result = (c.logic || groupLogic || 'and') === 'or' ? (result || ok) : (result && ok);
        }
        mask[i] = !!result;
      }
      return df.filterMask(mask);
    }

    /* --------------------------------------------------------------- sorting */
    sortValues(by, ascending) {
      const asc = Array.isArray(ascending) ? ascending : by.map(() => ascending !== false);
      const idxs = by.map((n) => this.colIndex(n));
      const order = rangeArr(this.nrows);
      order.sort((a, b) => {
        for (let k = 0; k < idxs.length; k++) {
          const c = compareValues(this.values[idxs[k]][a], this.values[idxs[k]][b]);
          if (c !== 0) return asc[k] ? c : -c;
        }
        return a - b;
      });
      return this._take(order);
    }

    sortByColumn(name, ascending) { return this.sortValues([name], [ascending !== false]); }

    /* ------------------------------------------------------------ missingness */
    isNull(name) { return this.col(name).map((v) => S.isMissing(v)); }

    notNull(name) { return this.col(name).map((v) => !S.isMissing(v)); }

    fillNa(rules) {
      // rules: { columnName: {strategy, value} }
      const cols = this.values.map((v) => v.slice());
      const dts = this.dtypes.slice();
      for (const [name, rule] of Object.entries(rules)) {
        const i = this.names.indexOf(name);
        if (i < 0) continue;
        const col = cols[i];
        const strat = rule.strategy || 'value';
        let fillVal = rule.value;
        const present = col.filter((v) => !S.isMissing(v));
        if (strat === 'mean') { const c = S.clean(col); fillVal = c.length ? S.mean(c) : 0; }
        else if (strat === 'median') { const c = S.clean(col).sort((a, b) => a - b); fillVal = c.length ? S.median(c) : 0; }
        else if (strat === 'mode') fillVal = S.mode(present);
        else if (strat === 'ffill') {
          let last = null;
          for (let r = 0; r < col.length; r++) { if (S.isMissing(col[r])) col[r] = last; else last = col[r]; }
          continue;
        } else if (strat === 'bfill') {
          let nxt = null;
          for (let r = col.length - 1; r >= 0; r--) { if (S.isMissing(col[r])) col[r] = nxt; else nxt = col[r]; }
          continue;
        } else if (strat === 'zero') fillVal = 0;
        else if (isNum(dts[i])) { const n = S.toNum(fillVal); fillVal = n === null ? null : n; }
        else if (isDatetime(dts[i])) { const d = parseDate(fillVal); fillVal = d ? d.iso : null; }
        for (let r = 0; r < col.length; r++) if (S.isMissing(col[r])) col[r] = fillVal;
      }
      return new DataFrame(this.names, cols, dts, { index: this.index, meta: this.meta });
    }

    dropNa(opts) {
      const how = (opts && opts.how) || 'any';
      const subset = (opts && opts.subset && opts.subset.length) ? opts.subset : this.names;
      const thresh = opts && opts.thresh;
      const idxs = subset.map((n) => this.colIndex(n));
      const rows = [];
      for (let r = 0; r < this.nrows; r++) {
        const missing = idxs.filter((i) => S.isMissing(this.values[i][r])).length;
        const nonNull = idxs.length - missing;
        let keep = true;
        if (thresh !== undefined && thresh !== null && thresh !== '') keep = nonNull >= Number(thresh);
        else keep = how === 'all' ? missing < idxs.length : missing === 0;
        if (keep) rows.push(r);
      }
      return this._take(rows);
    }

    dropDuplicates(subset, keep) {
      const idxs = (subset && subset.length ? subset : this.names).map((n) => this.colIndex(n));
      const seen = new Map();
      const keepMode = keep || 'first';
      const rows = [];
      const keyOf = (r) => idxs.map((i) => (S.isMissing(this.values[i][r]) ? '\u0000' : String(this.values[i][r]))).join('\u0001');
      if (keepMode === 'last') {
        for (let r = this.nrows - 1; r >= 0; r--) seen.set(keyOf(r), r);
        const keepRows = [...new Set(seen.values())].sort((a, b) => a - b);
        return this._take(keepRows);
      }
      for (let r = 0; r < this.nrows; r++) {
        const k = keyOf(r);
        if (!seen.has(k)) { seen.set(k, r); rows.push(r); }
      }
      return this._take(rows);
    }

    duplicated(subset) {
      const idxs = (subset && subset.length ? subset : this.names).map((n) => this.colIndex(n));
      const seen = new Set();
      const flags = [];
      for (let r = 0; r < this.nrows; r++) {
        const k = idxs.map((i) => String(this.values[i][r])).join('\u0001');
        flags.push(seen.has(k));
        seen.add(k);
      }
      return flags;
    }

    /* ----------------------------------------------------------------- types */
    astype(name, dtype) {
      const i = this.colIndex(name);
      const cols = this.values.map((v) => v.slice());
      const dts = this.dtypes.slice();
      cols[i] = castArray(cols[i], dtype);
      dts[i] = dtype;
      return new DataFrame(this.names, cols, dts, { index: this.index, meta: this.meta });
    }

    /* -------------------------------------------------------------- describe */
    valueCounts(name, opts) {
      const o = opts || {};
      const col = this.col(name);
      const counts = new Map();
      let missingN = 0;
      for (const v of col) {
        if (S.isMissing(v)) { missingN++; if (o.dropna === false) counts.set('NaN', (counts.get('NaN') || 0) + 1); continue; }
        const k = formatValue(v, this.dtype(name));
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      let entries = [...counts.entries()].map(([label, count]) => ({ label, count }));
      entries.sort((a, b) => (o.ascending ? a.count - b.count : b.count - a.count) || String(a.label).localeCompare(String(b.label)));
      const total = o.normalize ? col.length : 0;
      if (o.top) entries = entries.slice(0, o.top);
      return { entries, missing: missingN, total: col.length, normalize: !!o.normalize };
    }

    /** Transposed summary table, like pandas' .describe(). */
    describe(opts) {
      const o = opts || {};
      const pcts = o.percentiles || [0.25, 0.5, 0.75];
      const numCols = this.names.filter((n) => isNum(this.dtype(n)) || this.dtype(n) === DTYPE.BOOL);
      const rows = [];
      const statRow = (label, fn) => {
        const row = [label];
        for (const n of numCols) row.push(fn(this.col(n), n));
        rows.push(row);
      };
      statRow('count', (c) => c.filter((v) => !S.isMissing(v)).length);
      statRow('missing', (c) => c.filter((v) => S.isMissing(v)).length);
      statRow('mean', (c) => { const a = S.clean(c); return a.length ? S.mean(a) : null; });
      statRow('std', (c) => S.std(S.clean(c)));
      statRow('min', (c) => S.min(S.clean(c)));
      for (const p of pcts) statRow(`${Math.round(p * 100)}%`, (c) => S.quantile(S.clean(c).sort((a, b) => a - b), p));
      statRow('max', (c) => S.max(S.clean(c)));
      statRow('skew', (c) => S.skew(S.clean(c)));
      statRow('kurtosis', (c) => S.kurtosis(S.clean(c)));

      const names = ['statistic', ...numCols];
      const values = names.map((_, i) => rows.map((r) => r[i]));
      const dtypes = names.map(() => DTYPE.FLOAT);
      dtypes[0] = DTYPE.OBJ;
      return new DataFrame(names, values, dtypes, { meta: { kind: 'describe' } });
    }

    /** pandas .info() — one row per column. */
    info() {
      const rows = [];
      this.names.forEach((n, i) => {
        const col = this.values[i];
        const nonNull = col.filter((v) => !S.isMissing(v)).length;
        rows.push({
          column: n,
          dtype: this.dtypes[i],
          non_null: nonNull,
          missing: col.length - nonNull,
          missing_pct: col.length ? (col.length - nonNull) / col.length : 0,
          unique: new Set(col.filter((v) => !S.isMissing(v)).map((v) => String(v))).size,
          sample: col.find((v) => !S.isMissing(v)),
          min: isNum(this.dtypes[i]) ? S.min(S.clean(col)) : null,
          max: isNum(this.dtypes[i]) ? S.max(S.clean(col)) : null,
          mean: isNum(this.dtypes[i]) ? S.mean(S.clean(col)) : null,
          std: isNum(this.dtypes[i]) ? S.std(S.clean(col)) : null,
          memory: estimateBytes(col, this.dtypes[i]),
        });
      });
      return rows;
    }

    memoryUsage() {
      let total = 0;
      this.names.forEach((n, i) => { total += estimateBytes(this.values[i], this.dtypes[i]); });
      return total;
    }

    /* ------------------------------------------------------------- grouping */
    /** Map from a composite key to the row indices belonging to it. */
    groupIndices(by) {
      const idxs = by.map((n) => this.colIndex(n));
      const groups = new Map();
      const order = [];
      for (let r = 0; r < this.nrows; r++) {
        const key = idxs.map((i) => (S.isMissing(this.values[i][r]) ? '\u0000NaN' : formatValue(this.values[i][r], this.dtypes[i]))).join('\u0001');
        if (!groups.has(key)) { groups.set(key, { key, values: idxs.map((i) => this.values[i][r]), rows: [] }); order.push(key); }
        groups.get(key).rows.push(r);
      }
      return { groups, order, by };
    }

    /**
     * groupby(by).agg({valueCol: [funcs], ...})  — pass a single 'size' agg to
     * behave like .size(). Multi-function results are named col_func.
     */
    groupAgg(by, spec, opts) {
      const o = opts || {};
      const { groups, order } = this.groupIndices(by);
      const names = by.slice();
      const cols = by.map(() => []);
      const dtypes = by.map((n) => this.dtype(n));
      const valueCols = Object.keys(spec).filter((c) => this.names.includes(c));
      const isSize = !valueCols.length;
      if (isSize) { names.push('count'); cols.push([]); dtypes.push(DTYPE.INT); }
      for (const vc of valueCols) {
        for (const fn of spec[vc]) {
          names.push(spec[vc].length > 1 || o.keepBaseName === false ? `${vc}_${AGG_LABEL[fn] || fn}` : `${vc}_${AGG_LABEL[fn] || fn}`);
          cols.push([]);
          const f = AGG_FUNCS[fn] || AGG_FUNCS.count;
          const numericResult = ['mean', 'median', 'std', 'var', 'sem', 'sum', 'product', 'q25', 'q75'].includes(fn);
          dtypes.push(fn === 'count' || fn === 'size' || fn === 'nunique' || fn === 'unique' || fn === 'missing'
            ? DTYPE.INT
            : numericResult ? DTYPE.FLOAT
              : fn === 'min' || fn === 'max' ? this.dtype(vc) : DTYPE.OBJ);
        }
      }
      let keys = order;
      for (const key of keys) {
        const g = groups.get(key);
        by.forEach((n, k) => cols[k].push(g.values[k]));
        if (isSize) cols[names.length - 1].push(g.rows.length);
        for (const vc of valueCols) {
          const ci = this.colIndex(vc);
          const slice = g.rows.map((r) => this.values[ci][r]);
          for (const fn of spec[vc]) {
            const f = AGG_FUNCS[fn] || AGG_FUNCS.count;
            const val = f(slice);
            cols[names.indexOf(`${vc}_${AGG_LABEL[fn] || fn}`)].push(Array.isArray(val) ? String(val) : val);
          }
        }
      }
      let out = new DataFrame(names, cols, dtypes);
      const sortBy = o.sortBy || null;
      if (sortBy) {
        if (sortBy === '__group__') out = out.sortValues(by, by.map(() => true));
        else out = out.sortValues([sortBy], [!!o.sortAscending]);
      }
      return out;
    }

    pivotTable(cfg) {
      const index = cfg.index || [];
      const columns = cfg.columns || [];
      const values = cfg.values || [];
      const fn = cfg.aggfunc || 'mean';
      const f = AGG_FUNCS[fn] || AGG_FUNCS.mean;
      const format = cfg.format !== false;

      const indexKeys = new Map();
      const colKeys = new Map();
      const buckets = new Map();
      const idxIdx = index.map((n) => this.colIndex(n));
      const colIdx = columns.map((n) => this.colIndex(n));
      const valIdx = values.map((n) => this.colIndex(n));

      for (let r = 0; r < this.nrows; r++) {
        const ik = idxIdx.map((i) => formatValue(this.values[i][r], this.dtypes[i])).join(' | ');
        const ck = colIdx.map((i) => formatValue(this.values[i][r], this.dtypes[i])).join(' | ');
        const bk = ik + '\u0001' + ck;
        if (!buckets.has(bk)) buckets.set(bk, values.map(() => []));
        const arrs = buckets.get(bk);
        valIdx.forEach((vi, vi2) => arrs[vi2].push(this.values[vi][r]));
        if (!indexKeys.has(ik)) indexKeys.set(ik, ik);
      }
      // column order: sorted for readability
      const colList = columns.length
        ? [...new Set([...buckets.keys()].map((k) => k.split('\u0001')[1] || '(blank)'))].sort((a, b) => {
          const na = Number(a), nb = Number(b);
          if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
          return String(a).localeCompare(String(b));
        })
        : ['value'];
      const rowList = [...indexKeys.keys()].sort((a, b) => {
        const na = Number(a.split(' | ')[0]), nb = Number(b.split(' | ')[0]);
        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
        return String(a).localeCompare(String(b));
      });

      const names = [...index, ...values.flatMap((v) => colList.map((c) => (values.length > 1 || columns.length ? `${v} [${c}]` : v)))];
      const outCols = names.map(() => []);
      const dtypes = index.map((n) => this.dtype(n)).concat(new Array(names.length - index.length).fill(DTYPE.FLOAT));
      for (const rk of rowList) {
        index.forEach((n, k) => outCols[k].push(rk.split(' | ')[k]));
        let oi = index.length;
        for (let vi = 0; vi < values.length; vi++) {
          for (const ck of colList) {
            const bk = rk + '\u0001' + (columns.length ? ck : '');
            const arrs = buckets.get(bk);
            const raw = arrs ? arrs[vi] : [];
            const clean = raw.filter((v) => !S.isMissing(v));
            let val;
            if (!clean.length) val = null;
            else if (['count', 'size'].includes(fn)) val = f(raw);
            else if (['first', 'last', 'min', 'max', 'mode', 'concat'].includes(fn) && !isNum(this.dtype(values[vi]))) val = f(raw);
            else val = S.clean(raw).length ? f(S.clean(raw)) : f(raw);
            outCols[oi++].push(typeof val === 'number' && !Number.isFinite(val) ? null : val);
          }
        }
      }
      const df = new DataFrame(names, outCols, dtypes, { meta: { kind: 'pivot' } });
      return format ? df : df;
    }

    crosstab(indexCol, colCol) {
      const res = this.groupAgg([indexCol, colCol], {}, {});
      return res.pivotTable({ index: [indexCol], columns: [colCol], values: [], aggfunc: 'size' });
    }

    melt(idVars, valueVars, varName, valueName) {
      const ids = idVars && idVars.length ? idVars : this.names.filter((n) => !valueVars.includes(n));
      const vals = valueVars && valueVars.length ? valueVars : this.names.filter((n) => !ids.includes(n));
      const vn = varName || 'variable';
      const valn = valueName || 'value';
      const names = [...ids, vn, valn];
      const cols = names.map(() => []);
      for (let r = 0; r < this.nrows; r++) {
        for (const vcol of vals) {
          ids.forEach((id, k) => cols[k].push(this.at(r, id)));
          cols[ids.length].push(vcol);
          cols[ids.length + 1].push(this.at(r, vcol));
        }
      }
      const dtypes = ids.map((n) => this.dtype(n));
      dtypes.push(DTYPE.OBJ);
      dtypes.push(isNum(this.dtype(vals[0])) ? DTYPE.FLOAT : DTYPE.OBJ);
      return new DataFrame(names, cols, dtypes);
    }

    /* ----------------------------------------------------------------- joins */
    merge(other, cfg) {
      const how = cfg.how || 'inner';
      const leftOn = cfg.leftOn && cfg.leftOn.length ? cfg.leftOn : this.names.filter((n) => other.names.includes(n));
      const rightOn = cfg.rightOn && cfg.rightOn.length ? cfg.rightOn : leftOn;
      const suffixes = cfg.suffixes || ['_x', '_y'];
      if (leftOn.length !== rightOn.length || !leftOn.length) throw new Error('Join keys do not match');

      const buildIndex = (df, keys) => {
        const idx = keys.map((k) => df.colIndex(k));
        const map = new Map();
        for (let r = 0; r < df.nrows; r++) {
          const key = idx.map((i) => (S.isMissing(df.values[i][r]) ? '\u0000' : String(df.values[i][r]))).join('\u0001');
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(r);
        }
        return map;
      };
      const rightMap = buildIndex(other, rightOn);
      const leftKeyIdx = leftOn.map((k) => this.colIndex(k));

      const leftNames = this.names.slice();
      const rightNames = [];
      other.names.forEach((n) => {
        if (rightOn.includes(n)) return;
        let nm = n;
        if (leftNames.includes(nm)) nm = n + suffixes[1];
        if (leftNames.includes(nm)) nm = n + '_2';
        if (leftNames.includes(nm)) { let k = 3; while (leftNames.includes(`${n}_${k}`)) k++; nm = `${n}_${k}`; }
        rightNames.push(nm);
      });

      const names = [...leftNames, ...rightNames];
      const cols = names.map(() => []);
      const dtypes = [...this.dtypes, ...other.names.filter((n) => !rightOn.includes(n)).map((n) => other.dtype(n))];
      const usedRight = new Set();

      const pushLeft = (r) => leftNames.forEach((n, k) => cols[k].push(this.at(r, n)));
      const pushRight = (r, skipKeys) => {
        let oi = 0;
        other.names.forEach((n) => {
          if (skipKeys && rightOn.includes(n)) { return; }
          cols[leftNames.length + oi].push(other.at(r, n));
          oi++;
        });
      };
      const pushNullRight = () => { for (let k = leftNames.length; k < names.length; k++) cols[k].push(null); };

      for (let r = 0; r < this.nrows; r++) {
        const key = leftKeyIdx.map((i) => (S.isMissing(this.values[i][r]) ? '\u0000' : String(this.values[i][r]))).join('\u0001');
        const matches = rightMap.get(key) || [];
        if (matches.length) {
          for (const mr of matches) { pushLeft(r); pushRight(mr, true); usedRight.add(mr); }
        } else if (how === 'left' || how === 'outer') {
          pushLeft(r); pushNullRight();
        }
      }
      if (how === 'right' || how === 'outer') {
        for (let r = 0; r < other.nrows; r++) {
          if (usedRight.has(r)) continue;
          for (let k = 0; k < leftNames.length; k++) {
            const lk = leftOn[k];
            cols[k].push(rightOn[k] !== undefined && other.names.includes(rightOn[k]) ? other.at(r, rightOn[k]) : null);
          }
          pushRight(r, true);
        }
      }
      // If the key names differ we keep both key columns.
      const out = new DataFrame(names, cols, dtypes, { meta: { kind: 'merge' } });
      return out;
    }

    /* -------------------------------------------------------------- reshaping */
    cut(name, edges, labels, right) {
      const col = this.col(name);
      const sorted = edges.slice().sort((a, b) => a - b);
      const values = col.map((v) => {
        const n = S.toNum(v);
        if (n === null) return null;
        for (let i = 0; i < sorted.length - 1; i++) {
          const lo = sorted[i], hi = sorted[i + 1];
          const inside = right === false ? (n >= lo && n < hi) : (n > lo && n <= hi);
          if (inside) return labels && labels[i] !== undefined ? labels[i] : `(${round2(lo)}, ${round2(hi)}]`;
        }
        if (n <= sorted[0]) return labels && labels[0] !== undefined ? labels[0] : `<= ${round2(sorted[0])}`;
        return `> ${round2(sorted[sorted.length - 1])}`;
      });
      return this.insert(`${name}_bin`, values, null, DTYPE.CAT);
    }

    qcut(name, q, labels) {
      const a = S.clean(this.col(name)).sort((x, y) => x - y);
      if (!a.length) return this.clone();
      const edges = [];
      for (let i = 0; i <= q; i++) edges.push(S.quantile(a, i / q));
      return this.cut(name, edges.slice(1, -1), labels, true);
    }

    /* --------------------------------------------------------------- numeric */
    _mapNum(name, fn, newName, dtype) {
      const col = this.col(name).map(fn);
      const i = this.colIndex(name);
      if (newName && newName !== name) return this.insert(newName, col, i + 1, dtype || DTYPE.FLOAT);
      const cols = this.values.map((v) => v.slice());
      const dts = this.dtypes.slice();
      cols[i] = col; dts[i] = dtype || DTYPE.FLOAT;
      return new DataFrame(this.names, cols, dts, { index: this.index, meta: this.meta });
    }

    mathOp(name, op, opts) {
      const o = opts || {};
      const newName = o.newColumn ? `${name}_${op}` : name;
      const col = this.col(name);
      const fns = {
        abs: (n) => Math.abs(n),
        round: (n) => Number(n.toFixed(Math.max(0, Math.min(10, o.digits ?? 2)))),
        floor: (n) => Math.floor(n),
        ceil: (n) => Math.ceil(n),
        sqrt: (n) => Math.sqrt(n),
        log: (n) => Math.log(n),
        log10: (n) => Math.log10(n),
        exp: (n) => Math.exp(n),
        clip: (n) => Math.min(Math.max(n, o.lo ?? S.min(S.clean(col))), o.hi ?? S.max(S.clean(col))),
        shift: (n) => n,
        neg: (n) => -n,
        sign: (n) => Math.sign(n),
      };
      if (op === 'shift') {
        const k = Number(o.periods || 1);
        const out = col.map((_, i) => (i - k >= 0 && i - k < col.length ? col[i - k] : null));
        return this.insert(o.newColumn ? `${name}_shift${k}` : name, out, this.colIndex(name) + 1, this.dtype(name));
      }
      if (op === 'diff') {
        const k = Number(o.periods || 1);
        const out = col.map((v, i) => {
          const prev = i - k >= 0 ? S.toNum(col[i - k]) : null;
          const cur = S.toNum(v);
          return cur === null || prev === null ? null : cur - prev;
        });
        return this.insert(o.newColumn ? `${name}_diff${k}` : name, out, this.colIndex(name) + 1, DTYPE.FLOAT);
      }
      if (op === 'pctchange') {
        const k = Number(o.periods || 1);
        const out = col.map((v, i) => {
          const prev = i - k >= 0 ? S.toNum(col[i - k]) : null;
          const cur = S.toNum(v);
          return cur === null || prev === null || prev === 0 ? null : (cur - prev) / Math.abs(prev);
        });
        return this.insert(o.newColumn ? `${name}_pct_change` : name, out, this.colIndex(name) + 1, DTYPE.FLOAT);
      }
      if (op === 'cumsum' || op === 'cumprod' || op === 'cummax' || op === 'cummin') {
        let acc = op === 'cumprod' ? 1 : null;
        const out = col.map((v) => {
          const n = S.toNum(v);
          if (n === null) return acc;
          if (op === 'cumsum') acc = (acc === null ? 0 : acc) + n;
          else if (op === 'cumprod') acc = acc * n;
          else if (op === 'cummax') acc = acc === null ? n : Math.max(acc, n);
          else acc = acc === null ? n : Math.min(acc, n);
          return acc;
        });
        return this.insert(`${name}_${op}`, out, this.colIndex(name) + 1, DTYPE.FLOAT);
      }
      if (op === 'rank') {
        const ranks = S.rankAvg(col);
        return this.insert(`${name}_rank`, ranks, this.colIndex(name) + 1, DTYPE.FLOAT);
      }
      if (op === 'normalize' || op === 'standardize') {
        const a = S.clean(col);
        const mn = S.min(a), mx = S.max(a), mu = S.mean(a), sd = S.std(a, 0);
        const out = col.map((v) => {
          const n = S.toNum(v);
          if (n === null) return null;
          if (op === 'normalize') return mx === mn ? 0 : (n - mn) / (mx - mn);
          return sd ? (n - mu) / sd : 0;
        });
        return this.insert(`${name}_${op === 'normalize' ? 'minmax' : 'zscore'}`, out, this.colIndex(name) + 1, DTYPE.FLOAT);
      }
      const fn = fns[op];
      if (!fn) throw new Error('Unknown math op: ' + op);
      return this._mapNum(name, (v) => { const n = S.toNum(v); return n === null ? null : fn(n); }, newName, this.dtype(name));
    }

    rolling(name, window, minPeriods, agg, center) {
      const col = this.col(name).map(S.toNum);
      const w = Math.max(1, Number(window) || 3);
      const mp = minPeriods === undefined || minPeriods === null || minPeriods === '' ? w : Number(minPeriods);
      const out = col.map((_, i) => {
        const lo = center ? i - Math.floor(w / 2) : i - w + 1;
        const hi = center ? i + Math.ceil(w / 2) - 1 : i;
        const slice = [];
        for (let k = Math.max(0, lo); k <= Math.min(col.length - 1, hi); k++) if (col[k] !== null) slice.push(col[k]);
        if (slice.length < Math.max(1, mp)) return null;
        switch (agg) {
          case 'sum': return S.sum(slice);
          case 'min': return S.min(slice);
          case 'max': return S.max(slice);
          case 'std': return S.std(slice);
          case 'median': return S.median(slice);
          case 'var': return S.variance(slice);
          default: return S.mean(slice);
        }
      });
      const label = `rolling_${agg || 'mean'}_${w}`;
      return this.insert(`${name}_${label}`, out, this.colIndex(name) + 1, DTYPE.FLOAT);
    }

    /* -------------------------------------------------------------- text ops */
    strOp(name, op, opts) {
      const o = opts || {};
      const col = this.col(name);
      const newName = o.newColumn ? `${name}_${op}` : name;
      const map = {
        upper: (s) => s.toUpperCase(),
        lower: (s) => s.toLowerCase(),
        title: (s) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()),
        strip: (s) => s.trim(),
        len: (s) => s.length,
        replace: (s) => s.split(o.find || '').join(o.replace || ''),
        contains: (s) => (o.find ? s.toLowerCase().includes(String(o.find).toLowerCase()) : false),
        startswith: (s) => (o.find ? s.toLowerCase().startsWith(String(o.find).toLowerCase()) : false),
        endswith: (s) => (o.find ? s.toLowerCase().endsWith(String(o.find).toLowerCase()) : false),
        slice: (s) => s.slice(Number(o.start || 0), o.end === undefined || o.end === '' ? undefined : Number(o.end)),
        split: (s) => (s.split(o.sep === undefined ? ' ' : o.sep)[Number(o.index || 0)] ?? null),
        extract: (s) => { try { const m = new RegExp(o.pattern).exec(s); return m ? (m[1] !== undefined ? m[1] : m[0]) : null; } catch (e) { return null; } },
        pad: (s) => s.padStart(Number(o.width || 5), o.fill || '0'),
        cat: (s) => s + (o.suffix || ''),
      };
      const fn = map[op];
      if (!fn) throw new Error('Unknown string op: ' + op);
      const out = col.map((v) => (S.isMissing(v) ? null : fn(String(v))));
      const dtype = op === 'len' ? DTYPE.INT : (['contains', 'startswith', 'endswith'].includes(op) ? DTYPE.BOOL : DTYPE.OBJ);
      return this.insert(newName, out, this.colIndex(name) + 1, dtype);
    }

    dtPart(name, part, opts) {
      const o = opts || {};
      const col = this.col(name);
      const toDate = (v) => {
        if (S.isMissing(v)) return null;
        const d = new Date(typeof v === 'number' ? v : String(v).replace(' ', 'T'));
        return Number.isNaN(d.getTime()) ? null : d;
      };
      const fns = {
        year: (d) => d.getFullYear(),
        month: (d) => d.getMonth() + 1,
        day: (d) => d.getDate(),
        hour: (d) => d.getHours(),
        minute: (d) => d.getMinutes(),
        second: (d) => d.getSeconds(),
        weekday: (d) => d.getDay(),
        week: (d) => { const t = new Date(d.getFullYear(), 0, 1); return Math.ceil(((d - t) / 86400000 + t.getDay() + 1) / 7); },
        quarter: (d) => Math.floor(d.getMonth() / 3) + 1,
        date: (d) => isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate(), 0, 0, 0),
        monthname: (d) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()],
        dayname: (d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()],
        weekofmonth: (d) => Math.ceil(d.getDate() / 7),
      };
      const fn = fns[part];
      if (!fn) throw new Error('Unknown datetime part: ' + part);
      const out = col.map((v) => { const d = toDate(v); return d ? fn(d) : null; });
      const isStr = ['date', 'monthname', 'dayname'].includes(part);
      return this.insert(`${name}_${part}`, out, this.colIndex(name) + 1, isStr ? DTYPE.OBJ : DTYPE.INT);
    }

    dtDiff(a, b, unit, newName) {
      const ca = this.col(a), cb = this.col(b);
      const ms = { day: 86400000, hour: 3600000, minute: 60000, second: 1000, week: 604800000, year: 31557600000 };
      const f = ms[unit] || ms.day;
      const out = ca.map((v, i) => {
        const d1 = v ? new Date(String(v).replace(' ', 'T')) : null;
        const d2 = cb[i] ? new Date(String(cb[i]).replace(' ', 'T')) : null;
        if (!d1 || !d2 || Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return null;
        return (d1 - d2) / f;
      });
      return this.insert(newName || `${a}_minus_${b}`, out, null, DTYPE.FLOAT);
    }

    /* ------------------------------------------------------------------ corr */
    corr(method, cols) {
      const names = cols && cols.length ? cols : this.names.filter((n) => isNum(this.dtype(n)));
      const f = method === 'spearman' ? S.spearman : method === 'kendall' ? S.kendall : S.pearson;
      const values = names.map((a) => names.map((b) => (a === b ? 1 : f(this.col(a), this.col(b)))));
      const colsOut = names.map((_, i) => values[i]);
      return new DataFrame(names, colsOut, names.map(() => DTYPE.FLOAT), { meta: { kind: 'corr' } });
    }

    cov(cols) {
      const names = cols && cols.length ? cols : this.names.filter((n) => isNum(this.dtype(n)));
      const values = names.map((a) => names.map((b) => S.cov(this.col(a), this.col(b))));
      return new DataFrame(names, names.map((_, i) => values[i]), names.map(() => DTYPE.FLOAT));
    }

    /** Pairs of numeric columns with the strongest absolute correlation. */
    topCorrelations(limit, method) {
      const names = this.names.filter((n) => isNum(this.dtype(n)));
      if (names.length < 2) return [];
      const f = method === 'spearman' ? S.spearman : S.pearson;
      const out = [];
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const r = f(this.col(names[i]), this.col(names[j]));
          out.push({ a: names[i], b: names[j], r });
        }
      }
      out.sort((x, y) => Math.abs(y.r || 0) - Math.abs(x.r || 0));
      return out.slice(0, limit || 8);
    }

    /* ------------------------------------------------------ derived metadata */
    numericColumns() { return this.names.filter((n) => isNum(this.dtype(n))); }
    boolColumns() { return this.names.filter((n) => this.dtype(n) === DTYPE.BOOL); }
    datetimeColumns() { return this.names.filter((n) => isDatetime(this.dtype(n))); }
    categoricalColumns(limit) {
      const lim = limit || 25;
      return this.names.filter((n) => {
        const dt = this.dtype(n);
        if (dt === DTYPE.OBJ || dt === DTYPE.CAT || dt === DTYPE.BOOL) return true;
        const uniq = new Set(this.col(n).filter((v) => !S.isMissing(v)).map(String)).size;
        return uniq <= lim && uniq > 0 && uniq <= this.nrows * 0.5;
      });
    }

    missingReport() {
      return this.names.map((n, i) => {
        const miss = this.values[i].filter((v) => S.isMissing(v)).length;
        return { column: n, dtype: this.dtypes[i], missing: miss, pct: this.nrows ? miss / this.nrows : 0, cells: this.nrows };
      });
    }

    /* --------------------------------------------------------------- exports */
    toCSV(opts) {
      const o = opts || {};
      const sep = o.sep || ',';
      const limit = o.limit && o.limit > 0 ? Math.min(o.limit, this.nrows) : this.nrows;
      const fmtCell = (v, dt) => {
        if (S.isMissing(v)) return '';
        if (isDatetime(dt)) return String(v).replace('T', ' ');
        const s = String(v);
        return /["\n,;\t]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const lines = [this.names.map((n) => (/[",;\n]/.test(n) ? '"' + n.replace(/"/g, '""') + '"' : n)).join(sep)];
      for (let r = 0; r < limit; r++) {
        lines.push(this.names.map((n, i) => fmtCell(this.values[i][r], this.dtypes[i])).join(sep));
      }
      return lines.join('\r\n');
    }

    toJSON(opts) {
      const o = opts || {};
      const limit = o.limit && o.limit > 0 ? Math.min(o.limit, this.nrows) : this.nrows;
      const records = [];
      for (let r = 0; r < limit; r++) {
        const rec = {};
        this.names.forEach((n, i) => { rec[n] = this.values[i][r]; });
        records.push(rec);
      }
      const payload = { columns: this.names, dtypes: this.dtypes, data: records };
      return o.plain ? JSON.stringify(records, null, 2) : JSON.stringify(payload, null, 2);
    }

    toRecords(limit) {
      const n = limit && limit > 0 ? Math.min(limit, this.nrows) : this.nrows;
      const out = [];
      for (let r = 0; r < n; r++) {
        const obj = { __index: this.index ? this.index[r] : r };
        this.names.forEach((name, i) => { obj[name] = this.values[i][r]; });
        out.push(obj);
      }
      return out;
    }

    /* --------------------------------------------------------------- parsing */
    static fromArrays(names, colArrays, dtypes, opts) {
      const nn = [], cc = [], dd = [], seen = new Map();
      names.forEach((rawName, i) => {
        let n = String(rawName === null || rawName === undefined ? '' : rawName).trim().replace(/^"|"$/g, '') || `column_${i + 1}`;
        const c = (seen.get(n) || 0) + 1; seen.set(n, c);
        if (c > 1) n = `${n}_${c}`;
        nn.push(n);
        cc.push(colArrays[i] || []);
        dd.push(dtypes ? dtypes[i] : inferColumn(colArrays[i] || []));
      });
      return new DataFrame(nn, cc, dd, opts);
    }

    static fromRows(rows, namesOrder) {
      const names = namesOrder && namesOrder.length ? namesOrder : [...rows.reduce((s, r) => { Object.keys(r).forEach((k) => s.add(k)); return s; }, new Set())];
      const cols = names.map((n) => rows.map((r) => (r[n] === undefined ? null : r[n])));
      return DataFrame.fromArrays(names, cols);
    }

    static fromGrid(header, rows, opts) {
      const o = opts || {};
      let names = header.map((h) => String(h === null || h === undefined ? '' : h));
      let data = rows;
      let index = null;
      // pandas' to_csv writes the index in a first header-less column
      if (!o.keepIndex && names.length && (names[0] === '' || /^unnamed:? ?0?$/i.test(names[0].trim()))) {
        index = rows.map((r) => r[0]);
        names = names.slice(1);
        data = rows.map((r) => r.slice(1));
      }
      const cols = names.map((_, i) => data.map((r) => r[i]));
      const df = DataFrame.fromArrays(names, cols, null, { index });
      return df;
    }

    static parseCSV(text, opts) {
      const o = opts || {};
      const res = global.Papa.parse(text.trim(), {
        skipEmptyLines: 'greedy',
        delimiter: o.delimiter || '',
        dynamicTyping: false,
      });
      if (res.errors && res.errors.length && !res.data.length) {
        throw new Error('CSV parse error: ' + res.errors[0].message);
      }
      const rows = res.data;
      if (!rows.length) throw new Error('No rows found');
      const header = rows[0];
      const body = rows.slice(o.header === false ? 0 : 1);
      const df = DataFrame.fromGrid(header, body, o);
      df.meta.delimiter = res.meta.delimiter;
      return df;
    }

    static parseJSON(text, opts) {
      const o = opts || {};
      let obj;
      try { obj = JSON.parse(text); } catch (e) { throw new Error('Invalid JSON: ' + e.message); }
      if (Array.isArray(obj)) return DataFrame.fromRows(obj);
      if (obj && typeof obj === 'object') {
        if (Array.isArray(obj.data) && obj.columns) return DataFrame.fromArrays(obj.columns, obj.columns.map((c) => obj.data.map((r) => r[c])), obj.dtypes || null);
        if (Array.isArray(obj.records)) return DataFrame.fromRows(obj.records);
        if (Array.isArray(obj.data)) return DataFrame.fromRows(obj.data);
      }
      throw new Error('Unsupported JSON shape — expected an array of objects, or {columns, data}.');
    }

    static parseExcel(buffer) {
      const wb = global.XLSX.read(buffer, { type: 'array', cellDates: false });
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const grid = global.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: false });
      if (!grid.length) throw new Error('Empty sheet');
      const df = DataFrame.fromGrid(grid[0], grid.slice(1));
      df.meta.sourceName = sheetName;
      return df;
    }

    static parseDelimitedAuto(text) {
      const head = text.slice(0, 4000);
      const firstLine = head.split(/\r?\n/)[0] || '';
      const counts = [
        { d: ',', n: (firstLine.match(/,/g) || []).length },
        { d: '\t', n: (firstLine.match(/\t/g) || []).length },
        { d: ';', n: (firstLine.match(/;/g) || []).length },
        { d: '|', n: (firstLine.match(/\|/g) || []).length },
      ].sort((a, b) => b.n - a.n);
      return counts[0].n > 0 ? counts[0].d : ',';
    }

    static parse(text, filename) {
      const name = String(filename || '').toLowerCase();
      if (name.endsWith('.json')) return DataFrame.parseJSON(text);
      const ext = name.slice(name.lastIndexOf('.'));
      const df = DataFrame.parseCSV(text, { delimiter: DataFrame.parseDelimitedAuto(text) });
      df.meta.fileExt = ext;
      return df;
    }
  }

  function rangeArr(nOrStart, end) {
    const out = [];
    if (end === undefined) { for (let i = 0; i < nOrStart; i++) out.push(i); }
    else { for (let i = nOrStart; i < end; i++) out.push(i); }
    return out;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function estimateBytes(col, dtype) {
    switch (dtype) {
      case DTYPE.INT: case DTYPE.FLOAT: return col.length * 8;
      case DTYPE.BOOL: return col.length * 1;
      case DTYPE.DATETIME: return col.length * 26;
      default: {
        let n = 0;
        for (const v of col) n += v === null ? 4 : String(v).length * 2 + 16;
        return n;
      }
    }
  }

  const round2 = (v) => (v === null || v === undefined ? v : Number(Number(v).toFixed(3)));

  function formatValue(v, dtype) {
    if (S.isMissing(v)) return 'NaN';
    if (isDatetime(dtype)) return formatDatetime(v);
    if (typeof v === 'boolean') return v ? 'True' : 'False';
    if (typeof v === 'number') return String(v);
    return String(v);
  }

  global.DF = {
    DataFrame, DTYPE, castArray, coerce, inferColumn, formatValue, formatDatetime,
    FILTER_OPS, AGG_FUNCS, AGG_LABEL, pythonFilterOp, parseDate, compareValues, isNum, isDatetime,
    rangeArr, estimateBytes, mulberry32,
  };
})(window);
