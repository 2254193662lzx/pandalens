/* =============================================================================
 * expr.js — a tiny, sandboxed expression language.
 *
 * This is the "query / assign" engine: it lets users type things such as
 *      sepal_length / sepal_width > 2 and species == "setosa"
 *      round(price * qty * (1 - discount), 2)
 * without ever touching eval(). Expressions are parsed once into an AST and then
 * evaluated row by row against the frame's columns.
 * ========================================================================== */
(function (global) {
  'use strict';

  const S = global.Stats;

  /* ------------------------------------------------------------------ lexer */
  const OPS3 = ['**=', '...'];
  const OPERATORS = [
    '**', '==', '!=', '<=', '>=', '&&', '||', '//',
    '+', '-', '*', '/', '%', '^', '<', '>', '=', '!',
    '(', ')', '[', ']', ',', '?', ':', '.',
  ];

  function tokenize(src) {
    const out = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      // number
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        let j = i;
        while (j < n && /[0-9]/.test(src[j])) j++;
        if (src[j] === '.') { j++; while (j < n && /[0-9]/.test(src[j])) j++; }
        if (/[eE]/.test(src[j] || '')) {
          let k = j + 1;
          if (/[+-]/.test(src[k] || '')) k++;
          if (/[0-9]/.test(src[k] || '')) { j = k; while (j < n && /[0-9]/.test(src[j])) j++; }
        }
        out.push({ t: 'num', v: parseFloat(src.slice(i, j)) });
        i = j; continue;
      }
      // string
      if (c === '"' || c === "'" || c === '`') {
        let j = i + 1, buf = '';
        while (j < n && src[j] !== c) {
          if (src[j] === '\\') {
            const nx = src[j + 1];
            buf += nx === 'n' ? '\n' : nx === 't' ? '\t' : nx === '\\' ? '\\' : nx === c ? c : nx;
            j += 2;
          } else { buf += src[j]; j++; }
        }
        if (j >= n) throw new ExprError('Unterminated string literal');
        out.push({ t: 'str', v: buf });
        i = j + 1; continue;
      }
      // identifier / keyword
      if (/[A-Za-z_$\u4e00-\u9fa5]/.test(c)) {
        let j = i;
        while (j < n && /[A-Za-z0-9_$.\u4e00-\u9fa5]/.test(src[j])) j++;
        // allow dotted column names only when the whole chain is not a known member access
        let name = src.slice(i, j);
        out.push({ t: 'id', v: name });
        i = j; continue;
      }
      // operator
      const op3 = OPS3.find((o) => src.startsWith(o, i));
      if (op3) { out.push({ t: 'op', v: '...' }); i += 3; continue; }
      const op = OPERATORS.find((o) => src.startsWith(o, i));
      if (op) { out.push({ t: 'op', v: op }); i += op.length; continue; }
      throw new ExprError('Unexpected character: ' + c);
    }
    out.push({ t: 'eof' });
    return out;
  }

  class ExprError extends Error {}

  /* ----------------------------------------------------------------- parser */
  // Precedence ladder (lowest → highest)
  const BINARY = {
    'or': 1, '||': 1, '|': 1,
    'and': 2, '&&': 2, '&': 2,
    '==': 3, '!=': 3, '=': 3,
    '<': 4, '<=': 4, '>': 4, '>=': 4, 'in': 4, 'not in': 4,
    '+': 5, '-': 5,
    '*': 6, '/': 6, '//': 6, '%': 6,
    '**': 7, '^': 7,
  };

  function parse(tokens) {
    let p = 0;
    const peek = () => tokens[p];
    const next = () => tokens[p++];
    const isOp = (v) => peek().t === 'op' && peek().v === v;
    const expect = (v) => { if (!isOp(v)) throw new ExprError(`Expected "${v}"`); return next(); };

    function parseExpr(minPrec) {
      let left = parseUnary();
      for (;;) {
        const tk = peek();
        let op = null;
        if (tk.t === 'op' && BINARY[tk.v] !== undefined) op = tk.v;
        else if (tk.t === 'id' && (tk.v === 'and' || tk.v === 'or' || tk.v === 'in')) op = tk.v;
        else if (tk.t === 'id' && tk.v === 'not' && tokens[p + 1] && tokens[p + 1].t === 'id' && tokens[p + 1].v === 'in') op = 'not in';
        if (!op) break;
        const prec = BINARY[op];
        if (prec < minPrec) break;
        if (op === 'not in') { next(); next(); } else next();
        const right = parseExpr(prec + 1);
        left = { k: 'bin', op, left, right };
      }
      // ternary binds at the lowest precedence level only
      if (minPrec === 0 && isOp('?')) {
        next();
        const a = parseExpr(0);
        expect(':');
        const b = parseExpr(0);
        return { k: 'cond', test: left, a, b };
      }
      return left;
    }

    function parseUnary() {
      const tk = peek();
      if (tk.t === 'op' && (tk.v === '-' || tk.v === '+' || tk.v === '!')) {
        next();
        return { k: 'un', op: tk.v, arg: parseUnary() };
      }
      if (tk.t === 'id' && tk.v === 'not') { next(); return { k: 'un', op: '!', arg: parseUnary() }; }
      return parsePostfix();
    }

    function parsePostfix() {
      let node = parsePrimary();
      while (peek().t === 'op' && peek().v === '.') {
        next();
        const prop = next();
        if (prop.t !== 'id' && prop.t !== 'num') throw new ExprError('Expected a name after "."');
        node = { k: 'member', obj: node, name: String(prop.v) };
      }
      return node;
    }

    function parsePrimary() {
      const tk = next();
      if (tk.t === 'num') return { k: 'num', v: tk.v };
      if (tk.t === 'str') return { k: 'str', v: tk.v };
      if (tk.t === 'op' && tk.v === '(') {
        const e = parseExpr(0);
        expect(')');
        return e;
      }
      if (tk.t === 'op' && tk.v === '[') {
        const items = [];
        if (!isOp(']')) {
          do { items.push(parseExpr(0)); } while (isOp(',') && next());
        }
        expect(']');
        return { k: 'arr', items };
      }
      if (tk.t === 'id') {
        if (tk.v === 'true') return { k: 'bool', v: true };
        if (tk.v === 'false') return { k: 'bool', v: false };
        if (tk.v === 'null' || tk.v === 'None' || tk.v === 'nan' || tk.v === 'NaN') return { k: 'null' };
        if (isOp('(')) {
          next();
          const args = [];
          if (!isOp(')')) {
            do { args.push(parseExpr(0)); } while (isOp(',') && next());
          }
          expect(')');
          return { k: 'call', name: tk.v.toLowerCase(), args };
        }
        return { k: 'name', name: tk.v };
      }
      throw new ExprError('Unexpected token: ' + (tk.v !== undefined ? tk.v : tk.t));
    }

    const ast = parseExpr(0);
    if (peek().t !== 'eof') throw new ExprError('Unexpected trailing token: ' + peek().v);
    return ast;
  }

  /* -------------------------------------------------------------- evaluator */
  const pad = (n) => String(n).padStart(2, '0');

  function toDateLike(v) {
    if (S.isMissing(v)) return null;
    if (v instanceof Date) return v;
    if (typeof v === 'number') return new Date(v);
    const d = new Date(String(v).replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const truthy = (v) => {
    if (v === null || v === undefined) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
    const s = String(v).toLowerCase();
    return !(s === '' || s === '0' || s === 'false' || s === 'no' || s === 'nan' || s === 'null');
  };

  const asStr = (v) => (v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : String(v));

  const FUNCS = {
    abs: (x) => (S.toNum(x) === null ? null : Math.abs(S.toNum(x))),
    round: (x, d) => { const n = S.toNum(x); return n === null ? null : Number(n.toFixed(Math.max(0, Math.min(15, d === undefined ? 0 : S.toNum(d) || 0)))); },
    floor: (x) => { const n = S.toNum(x); return n === null ? null : Math.floor(n); },
    ceil: (x) => { const n = S.toNum(x); return n === null ? null : Math.ceil(n); },
    sqrt: (x) => { const n = S.toNum(x); return n === null || n < 0 ? null : Math.sqrt(n); },
    exp: (x) => { const n = S.toNum(x); return n === null ? null : Math.exp(n); },
    log: (x) => { const n = S.toNum(x); return n === null || n <= 0 ? null : Math.log(n); },
    ln: (x) => { const n = S.toNum(x); return n === null || n <= 0 ? null : Math.log(n); },
    log10: (x) => { const n = S.toNum(x); return n === null || n <= 0 ? null : Math.log10(n); },
    log2: (x) => { const n = S.toNum(x); return n === null || n <= 0 ? null : Math.log2(n); },
    pow: (x, y) => { const a = S.toNum(x), b = S.toNum(y); return a === null || b === null ? null : Math.pow(a, b); },
    sign: (x) => { const n = S.toNum(x); return n === null ? null : Math.sign(n); },
    mod: (x, y) => { const a = S.toNum(x), b = S.toNum(y); return a === null || b === null || b === 0 ? null : a % b; },
    min: (...xs) => { const a = xs.map(S.toNum).filter((v) => v !== null); return a.length ? Math.min(...a) : null; },
    max: (...xs) => { const a = xs.map(S.toNum).filter((v) => v !== null); return a.length ? Math.max(...a) : null; },
    clip: (x, lo, hi) => { const n = S.toNum(x); if (n === null) return null; return Math.min(Math.max(n, S.toNum(lo)), S.toNum(hi)); },
    int: (x) => { const n = S.toNum(x); return n === null ? null : Math.trunc(n); },
    float: (x) => S.toNum(x),
    str: (x) => asStr(x),
    bool: (x) => truthy(x),
    len: (x) => (x === null || x === undefined ? 0 : Array.isArray(x) ? x.length : asStr(x).length),
    length: (x) => (x === null || x === undefined ? 0 : asStr(x).length),
    upper: (x) => asStr(x).toUpperCase(),
    lower: (x) => asStr(x).toLowerCase(),
    title: (x) => asStr(x).replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()),
    trim: (x) => asStr(x).trim(),
    strip: (x) => asStr(x).trim(),
    ltrim: (x) => asStr(x).replace(/^\s+/, ''),
    rtrim: (x) => asStr(x).replace(/\s+$/, ''),
    substr: (x, start, len2) => {
      const s = asStr(x); const i = Math.trunc(S.toNum(start) || 0);
      return len2 === undefined ? s.slice(i) : s.slice(i, i + Math.trunc(S.toNum(len2)));
    },
    replace: (x, a, b) => asStr(x).split(asStr(a)).join(asStr(b)),
    contains: (x, sub) => asStr(x).toLowerCase().includes(asStr(sub).toLowerCase()),
    startswith: (x, sub) => asStr(x).toLowerCase().startsWith(asStr(sub).toLowerCase()),
    endswith: (x, sub) => asStr(x).toLowerCase().endsWith(asStr(sub).toLowerCase()),
    concat: (...xs) => xs.map(asStr).join(''),
    if: (c, a, b) => (truthy(c) ? a : b),
    iif: (c, a, b) => (truthy(c) ? a : b),
    coalesce: (...xs) => { for (const x of xs) if (!S.isMissing(x)) return x; return null; },
    ifnull: (x, y) => (S.isMissing(x) ? y : x),
    isnull: (x) => S.isMissing(x),
    isna: (x) => S.isMissing(x),
    notnull: (x) => !S.isMissing(x),
    notna: (x) => !S.isMissing(x),
    between: (x, a, b) => { const n = S.toNum(x); return n === null ? false : n >= S.toNum(a) && n <= S.toNum(b); },
    year: (x) => toDateLike(x)?.getFullYear() ?? null,
    month: (x) => { const d = toDateLike(x); return d ? d.getMonth() + 1 : null; },
    day: (x) => { const d = toDateLike(x); return d ? d.getDate() : null; },
    hour: (x) => { const d = toDateLike(x); return d ? d.getHours() : null; },
    minute: (x) => { const d = toDateLike(x); return d ? d.getMinutes() : null; },
    quarter: (x) => { const d = toDateLike(x); return d ? Math.floor(d.getMonth() / 3) + 1 : null; },
    weekday: (x) => { const d = toDateLike(x); return d ? d.getDay() : null; },
    week: (x) => { const d = toDateLike(x); if (!d) return null; const t = new Date(d.getFullYear(), 0, 1); return Math.ceil(((d - t) / 86400000 + t.getDay() + 1) / 7); },
    datediff: (a, b, unit) => {
      const da = toDateLike(a), db = toDateLike(b);
      if (!da || !db) return null;
      const ms = da - db;
      const u = asStr(unit || 'day').toLowerCase();
      const map = { day: 86400000, days: 86400000, hour: 3600000, hours: 3600000, minute: 60000, minutes: 60000, week: 604800000, weeks: 604800000, year: 31557600000, years: 31557600000, second: 1000 };
      return ms / (map[u] || 86400000);
    },
    dateformat: (x, f) => {
      const d = toDateLike(x); if (!d) return null;
      const fmt = asStr(f || 'yyyy-MM-dd');
      return fmt.replace(/yyyy/g, d.getFullYear()).replace(/MM/g, pad(d.getMonth() + 1))
        .replace(/dd/g, pad(d.getDate())).replace(/HH/g, pad(d.getHours()))
        .replace(/mm/g, pad(d.getMinutes())).replace(/ss/g, pad(d.getSeconds()));
    },
    now: () => new Date(),
    today: () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); },
    cast: (x, ty) => {
      const t = asStr(ty).toLowerCase();
      if (t.startsWith('int')) return FUNCS.int(x);
      if (t.startsWith('float')) return S.toNum(x);
      if (t.startsWith('str')) return asStr(x);
      return x;
    },
  };

  const KEYWORDS = new Set(['and', 'or', 'not', 'in', 'true', 'false', 'null', 'None', 'nan', 'NaN']);

  function evalNode(node, row) {
    switch (node.k) {
      case 'num': return node.v;
      case 'str': return node.v;
      case 'bool': return node.v;
      case 'null': return null;
      case 'arr': return node.items.map((it) => evalNode(it, row));
      case 'name': {
        const v = row[node.name];
        return v === undefined && !(node.name in row) ? null : v;
      }
      case 'member': {
        const obj = evalNode(node.obj, row);
        if (obj && typeof obj === 'object') return obj[node.name];
        return null;
      }
      case 'un': {
        const v = evalNode(node.arg, row);
        if (node.op === '-') { const n = S.toNum(v); return n === null ? null : -n; }
        if (node.op === '+') return S.toNum(v);
        return !truthy(v);
      }
      case 'cond': return truthy(evalNode(node.test, row)) ? evalNode(node.a, row) : evalNode(node.b, row);
      case 'bin': return evalBin(node, row);
      case 'call': {
        const fn = FUNCS[node.name];
        if (!fn) throw new ExprError('Unknown function: ' + node.name + '()');
        const args = node.args.map((a) => evalNode(a, row));
        return fn(...args);
      }
      default: throw new ExprError('Bad node: ' + node.k);
    }
  }

  function evalBin(node, row) {
    const op = node.op;
    if (op === 'and' || op === '&&' || op === '&') {
      const l = evalNode(node.left, row);
      if (!truthy(l)) return false;
      return truthy(evalNode(node.right, row));
    }
    if (op === 'or' || op === '||' || op === '|') {
      const l = evalNode(node.left, row);
      if (truthy(l)) return true;
      return truthy(evalNode(node.right, row));
    }
    const a = evalNode(node.left, row);
    const b = evalNode(node.right, row);
    switch (op) {
      case '==': case '=':
        if (a === null || b === null) return false;
        if (typeof a === 'number' && typeof b === 'number') return a === b;
        return asStr(a) === asStr(b);
      case '!=': return !evalBin({ op: '==', left: node.left, right: node.right }, row) && !(a === null && b === null);
      case '<': { const x = S.toNum(a), y = S.toNum(b); return x === null || y === null ? false : x < y; }
      case '<=': { const x = S.toNum(a), y = S.toNum(b); return x === null || y === null ? false : x <= y; }
      case '>': { const x = S.toNum(a), y = S.toNum(b); return x === null || y === null ? false : x > y; }
      case '>=': { const x = S.toNum(a), y = S.toNum(b); return x === null || y === null ? false : x >= y; }
      case 'in': return Array.isArray(b) ? b.some((v) => asStr(v) === asStr(a)) : asStr(b).includes(asStr(a));
      case 'not in': return !(Array.isArray(b) ? b.some((v) => asStr(v) === asStr(a)) : asStr(b).includes(asStr(a)));
      case '+':
        if (a === null || b === null) return null;
        if (typeof a === 'string' || typeof b === 'string') return asStr(a) + asStr(b);
        return S.toNum(a) + S.toNum(b);
      case '-': { const x = S.toNum(a), y = S.toNum(b); return x === null || y === null ? null : x - y; }
      case '*': { const x = S.toNum(a), y = S.toNum(b); return x === null || y === null ? null : x * y; }
      case '/': { const x = S.toNum(a), y = S.toNum(b); return x === null || y === null || y === 0 ? null : x / y; }
      case '//': { const x = S.toNum(a), y = S.toNum(b); return x === null || y === null || y === 0 ? null : Math.floor(x / y); }
      case '%': { const x = S.toNum(a), y = S.toNum(b); return x === null || y === null || y === 0 ? null : x % y; }
      case '**': case '^': { const x = S.toNum(a), y = S.toNum(b); return x === null || y === null ? null : Math.pow(x, y); }
      default: throw new ExprError('Unknown operator: ' + op);
    }
  }

  function collectNames(node, acc) {
    if (!node || typeof node !== 'object') return acc;
    if (node.k === 'name') acc.push(node.name);
    for (const key of ['left', 'right', 'arg', 'a', 'b', 'test', 'obj']) if (node[key]) collectNames(node[key], acc);
    if (node.items) node.items.forEach((it) => collectNames(it, acc));
    if (node.args) node.args.forEach((it) => collectNames(it, acc));
    return acc;
  }

  const cache = new Map();

  function compile(src) {    const key = String(src || '').trim();
    if (cache.has(key)) return cache.get(key);
    let compiled;
    try {
      const ast = parse(tokenize(key));
      const names = [...new Set(collectNames(ast, []))].filter((n) => !KEYWORDS.has(n));
      compiled = {
        ok: true, src: key, ast, names,
        eval: (row) => evalNode(ast, row),
      };
    } catch (e) {
      compiled = { ok: false, src: key, error: e.message, names: [], eval: () => null };
    }
    if (cache.size > 400) cache.clear();
    cache.set(key, compiled);
    return compiled;
  }

  /** Evaluate an expression over a whole frame, returning an array of values. */
  function evaluateColumn(src, df) {
    const c = compile(src);
    if (!c.ok) return { ok: false, error: c.error, values: [] };
    const row = {};
    const out = new Array(df.nrows);
    const cols = df.names;
    for (let i = 0; i < df.nrows; i++) {
      for (let j = 0; j < cols.length; j++) row[cols[j]] = df.values[j][i];
      out[i] = c.eval(row);
    }
    return { ok: true, values: out, names: c.names };
  }

  /* ------------------------------------------------- pandas code generation */
  /**
   * Translates an expression AST into runnable pandas/numpy code, e.g.
   *     profit / revenue            →  df["profit"] / df["revenue"]
   *     round(price * units, 2)     →  (df["price"] * df["units"]).round(2)
   *     species == "setosa"         →  (df["species"] == "setosa")
   * Falls back to the raw source when the expression cannot be parsed.
   */
  function toPython(src, df) {
    const c = compile(src);
    if (!c.ok) return String(src || '');
    const cols = df && df.names ? new Set(df.names) : null;
    const S = global.Stats;

    // The expression language has no free variables: a bare identifier can only
    // be a column, so it always becomes df["name"] in the generated pandas code.
    const isCol = () => true;
    const wrap = (s) => `(${s})`;
    const lit = (v) => {
      if (v === null) return 'None';
      if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
      if (typeof v === 'boolean') return v ? 'True' : 'False';
      return JSON.stringify(String(v));
    };

    const np = (fn, ...args) => `np.${fn}(${args.join(', ')})`;
    const strAccessor = (a) => `${wrap(a)}.astype(str).str`;

    const CALLS = {
      abs: (a) => `${wrap(a)}.abs()`,
      round: (a, d) => `${wrap(a)}.round(${d === undefined ? 0 : num(d)})`,
      floor: (a) => np('floor', a),
      ceil: (a) => np('ceil', a),
      sqrt: (a) => np('sqrt', a),
      exp: (a) => np('exp', a),
      log: (a) => np('log', a),
      ln: (a) => np('log', a),
      log10: (a) => np('log10', a),
      log2: (a) => np('log2', a),
      pow: (a, b) => np('power', a, b),
      sign: (a) => np('sign', a),
      mod: (a, b) => `${wrap(a)} % ${wrap(b)}`,
      clip: (a, lo, hi) => `${wrap(a)}.clip(${num(lo)}, ${num(hi)})`,
      min: (...xs) => (xs.length === 1 ? `${wrap(xs[0])}.min()` : xs.slice(1).reduce((acc, x) => np('minimum', acc, x), xs[0])),
      max: (...xs) => (xs.length === 1 ? `${wrap(xs[0])}.max()` : xs.slice(1).reduce((acc, x) => np('maximum', acc, x), xs[0])),
      int: (a) => `${wrap(a)}.astype("int64")`,
      float: (a) => `${wrap(a)}.astype(float)`,
      str: (a) => `${wrap(a)}.astype(str)`,
      bool: (a) => `${wrap(a)}.astype(bool)`,
      len: (a) => `${wrap(a)}.astype(str).str.len()`,
      length: (a) => `${wrap(a)}.astype(str).str.len()`,
      upper: (a) => `${strAccessor(a)}.upper()`,
      lower: (a) => `${strAccessor(a)}.lower()`,
      title: (a) => `${strAccessor(a)}.title()`,
      trim: (a) => `${strAccessor(a)}.strip()`,
      strip: (a) => `${strAccessor(a)}.strip()`,
      ltrim: (a) => `${strAccessor(a)}.str.lstrip()`,
      rtrim: (a) => `${strAccessor(a)}.str.rstrip()`,
      substr: (a, start, len2) => (len2 === undefined
        ? `${strAccessor(a)}.slice(${num(start)})`
        : `${strAccessor(a)}.slice(${num(start)}, ${num(start)} + ${num(len2)})`),
      replace: (a, b, c2) => `${strAccessor(a)}.replace(${b}, ${c2}, regex=False)`,
      contains: (a, b) => `${strAccessor(a)}.contains(${b}, case=False, na=False)`,
      startswith: (a, b) => `${strAccessor(a)}.startswith(${b})`,
      endswith: (a, b) => `${strAccessor(a)}.endswith(${b})`,
      concat: (...xs) => xs.map((x) => `${wrap(x)}.astype(str)`).join(' + '),
      if: (cnd, a, b) => np('where', cnd, a, b),
      iif: (cnd, a, b) => np('where', cnd, a, b),
      coalesce: (...xs) => xs.slice(1).reduce((acc, x) => `${wrap(acc)}.fillna(${x})`, xs[0]),
      ifnull: (a, b) => `${wrap(a)}.fillna(${b})`,
      isnull: (a) => `${wrap(a)}.isna()`,
      isna: (a) => `${wrap(a)}.isna()`,
      notnull: (a) => `${wrap(a)}.notna()`,
      notna: (a) => `${wrap(a)}.notna()`,
      between: (a, b, c2) => `${wrap(a)}.between(${b}, ${c2})`,
      year: (a) => `pd.to_datetime(${a}).dt.year`,
      month: (a) => `pd.to_datetime(${a}).dt.month`,
      day: (a) => `pd.to_datetime(${a}).dt.day`,
      hour: (a) => `pd.to_datetime(${a}).dt.hour`,
      minute: (a) => `pd.to_datetime(${a}).dt.minute`,
      quarter: (a) => `pd.to_datetime(${a}).dt.quarter`,
      week: (a) => `pd.to_datetime(${a}).dt.isocalendar().week`,
      weekday: (a) => `pd.to_datetime(${a}).dt.weekday`,
      dateformat: (a, f) => `pd.to_datetime(${a}).dt.strftime(${f})`,
      datediff: (a, b, u) => {
        const unit = (u || '"day"').replace(/["']/g, '');
        const map = { day: 'days', days: 'days', hour: 'total_seconds() / 3600', hours: 'total_seconds() / 3600', minute: 'total_seconds() / 60', minutes: 'total_seconds() / 60', week: 'days / 7', weeks: 'days / 7', second: 'total_seconds()', year: 'days / 365.25', years: 'days / 365.25' };
        const expr = map[unit] || 'days';
        const base = `(pd.to_datetime(${a}) - pd.to_datetime(${b})).dt`;
        return expr === 'days' ? `${base}.days` : `${base}.${expr}`;
      },
      now: () => 'pd.Timestamp.now()',
      today: () => 'pd.Timestamp.today().normalize()',
      cast: (a, b) => `${wrap(a)}.astype(${b})`,
    };

    // call arguments are already walked into strings; numeric slots take them verbatim
    const num = (v) => (typeof v === 'string' ? v : walk(v));

    function walk(node) {
      switch (node.k) {
        case 'num': return String(node.v);
        case 'str': return JSON.stringify(node.v);
        case 'bool': return node.v ? 'True' : 'False';
        case 'null': return 'None';
        case 'arr': return '[' + node.items.map(walk).join(', ') + ']';
        case 'name':
          return isCol(node.name) ? `df[${JSON.stringify(node.name)}]` : node.name;
        case 'member':
          return `${wrap(walk(node.obj))}.${node.name}`;
        case 'un': {
          const inner = walk(node.arg);
          if (node.op === '-') return `-${wrap(inner)}`;
          if (node.op === '+') return `+${wrap(inner)}`;
          return `~${wrap(inner)}`;
        }
        case 'cond':
          return `np.where(${walk(node.test)}, ${walk(node.a)}, ${walk(node.b)})`;
        case 'bin': {
          const a = walk(node.left), b = walk(node.right);
          const op = node.op;
          if (op === 'and' || op === '&&' || op === '&') return `${wrap(a)} & ${wrap(b)}`;
          if (op === 'or' || op === '||' || op === '|') return `${wrap(a)} | ${wrap(b)}`;
          if (op === '=' ) return `${wrap(a)} == ${wrap(b)}`;
          if (op === 'in') return `${wrap(a)}.isin(${b})`;
          if (op === 'not in') return `~${wrap(a)}.isin(${b})`;
          if (op === '^') return `np.power(${a}, ${b})`;
          return `${wrap(a)} ${op} ${wrap(b)}`;
        }
        case 'call': {
          const fn = CALLS[node.name];
          const args = node.args.map(walk);
          if (!fn) {
            // unknown function: emit a plain call so the reader can adapt it
            return `${node.name}(${args.join(', ')})`;
          }
          return fn(...args);
        }
        default: return String(src);
      }
    }

    try { return walk(c.ast); } catch (e) { return String(src || ''); }
    void S;
  }

  global.Expr = { compile, evaluateColumn, toPython, ExprError, FUNCS, KEYWORDS };
})(window);
