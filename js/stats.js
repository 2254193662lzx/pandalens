/* =============================================================================
 * stats.js — numeric kernel of the app.
 * Mirrors the statistical behaviour of pandas / numpy closely enough that the
 * numbers a user sees in the UI match what pandas would print.
 * ========================================================================== */
(function (global) {
  'use strict';

  const isMissing = (v) =>
    v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v)) ||
    (typeof v === 'string' && v.trim() === '');

  const toNum = (v) => {
    if (isMissing(v)) return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const n = Number(String(v).trim().replace(/,/g, ''));
    return Number.isNaN(n) ? null : n;
  };

  const clean = (values) => {
    const out = [];
    for (let i = 0; i < values.length; i++) {
      const n = toNum(values[i]);
      if (n !== null) out.push(n);
    }
    return out;
  };

  const sum = (a) => a.reduce((s, v) => s + v, 0);

  const mean = (a) => (a.length ? sum(a) / a.length : null);

  /** Sample variance (ddof=1) like pandas' .std() default. */
  const variance = (a, ddof = 1) => {
    const n = a.length;
    if (n - ddof <= 0) return null;
    const m = mean(a);
    return a.reduce((s, v) => s + (v - m) * (v - m), 0) / (n - ddof);
  };

  const std = (a, ddof = 1) => {
    const v = variance(a, ddof);
    return v === null ? null : Math.sqrt(v);
  };

  const sem = (a) => {
    const s = std(a, 1);
    return s === null ? null : s / Math.sqrt(a.length);
  };

  const min = (a) => (a.length ? Math.min.apply(null, a) : null);
  const max = (a) => (a.length ? Math.max.apply(null, a) : null);

  /** numpy-compatible linear-interpolated quantile. */
  const quantile = (sorted, q) => {
    if (!sorted.length) return null;
    if (sorted.length === 1) return sorted[0];
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };

  const median = (a) => quantile(a.slice().sort((x, y) => x - y), 0.5);

  const mode = (values) => {
    const counts = new Map();
    let best = null, bestN = 0;
    for (const v of values) {
      if (isMissing(v)) continue;
      const k = String(v);
      const n = (counts.get(k) || 0) + 1;
      counts.set(k, n);
      if (n > bestN) { bestN = n; best = v; }
    }
    return best;
  };

  /** Third standardised moment (pandas uses the adjusted Fisher–Pearson form). */
  const skew = (a) => {
    const n = a.length;
    if (n < 3) return null;
    const m = mean(a);
    const s = std(a, 0);
    if (!s) return null;
    const m3 = a.reduce((acc, v) => acc + Math.pow(v - m, 3), 0) / n;
    return (Math.sqrt(n * (n - 1)) / (n - 2)) * (m3 / Math.pow(s, 3));
  };

  const kurtosis = (a) => {
    const n = a.length;
    if (n < 4) return null;
    const m = mean(a);
    const s = std(a, 0);
    if (!s) return null;
    const m4 = a.reduce((acc, v) => acc + Math.pow(v - m, 4), 0) / n;
    const g2 = m4 / Math.pow(s, 4) - 3;
    return ((n - 1) / ((n - 2) * (n - 3))) * ((n + 1) * g2 + 6);
  };

  const mad = (a) => {
    const m = median(a);
    if (m === null) return null;
    return median(a.map((v) => Math.abs(v - m)));
  };

  /** Pearson correlation between two arrays (pairwise-complete, like pandas). */
  const pearson = (x, y) => {
    const xs = [], ys = [];
    for (let i = 0; i < x.length; i++) {
      const a = toNum(x[i]), b = toNum(y[i]);
      if (a === null || b === null) continue;
      xs.push(a); ys.push(b);
    }
    const n = xs.length;
    if (n < 2) return null;
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - mx, dy = ys[i] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    if (sxx === 0 || syy === 0) return null;
    return sxy / Math.sqrt(sxx * syy);
  };

  /** Average-rank transform (ties share the mean rank). */
  const rankAvg = (values) => {
    const idx = values.map((v, i) => [toNum(v), i]).filter((d) => d[0] !== null);
    idx.sort((a, b) => a[0] - b[0]);
    const ranks = new Array(values.length).fill(null);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const r = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[idx[k][1]] = r;
      i = j + 1;
    }
    return ranks;
  };

  const spearman = (x, y) => pearson(rankAvg(x), rankAvg(y));
  const kendall = (x, y) => {
    const xs = [], ys = [];
    for (let i = 0; i < x.length; i++) {
      const a = toNum(x[i]), b = toNum(y[i]);
      if (a === null || b === null) continue;
      xs.push(a); ys.push(b);
    }
    const n = xs.length;
    if (n < 3) return null;
    let conc = 0, disc = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = (xs[i] - xs[j]) * (ys[i] - ys[j]);
        if (d > 0) conc++; else if (d < 0) disc++;
      }
    }
    const tot = n * (n - 1) / 2;
    return tot ? (conc - disc) / tot : null;
  };

  const cov = (x, y, ddof = 1) => {
    const xs = [], ys = [];
    for (let i = 0; i < x.length; i++) {
      const a = toNum(x[i]), b = toNum(y[i]);
      if (a === null || b === null) continue;
      xs.push(a); ys.push(b);
    }
    if (xs.length - ddof <= 0) return null;
    const mx = mean(xs), my = mean(ys);
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += (xs[i] - mx) * (ys[i] - my);
    return s / (xs.length - ddof);
  };

  /** Ordinary least squares y = a + bx, with R² and standard error of slope. */
  const linreg = (x, y) => {
    const xs = [], ys = [];
    for (let i = 0; i < x.length; i++) {
      const a = toNum(x[i]), b = toNum(y[i]);
      if (a === null || b === null) continue;
      xs.push(a); ys.push(b);
    }
    const n = xs.length;
    if (n < 3) return null;
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) ** 2;
      syy += (ys[i] - my) ** 2;
    }
    if (sxx === 0) return null;
    const slope = sxy / sxx;
    const intercept = my - slope * mx;
    const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
    let sse = 0;
    for (let i = 0; i < n; i++) sse += (ys[i] - (intercept + slope * xs[i])) ** 2;
    const se = n > 2 ? Math.sqrt((sse / (n - 2)) / sxx) : null;
    return { slope, intercept, r2, n, se, xMin: min(xs), xMax: max(xs) };
  };

  /** Sturges' / Freedman–Diaconis hybrid bin count, like pandas' hist(). */
  const autoBins = (a) => {
    const n = a.length;
    if (!n) return 10;
    const iqr = (quantile(a.slice().sort((x, y) => x - y), 0.75) - quantile(a.slice().sort((x, y) => x - y), 0.25));
    const fd = iqr > 0 ? Math.ceil((max(a) - min(a)) / (2 * iqr / Math.cbrt(n))) : 0;
    const sturges = Math.ceil(Math.log2(n) + 1);
    return Math.max(4, Math.min(60, fd > 0 ? Math.max(fd, sturges) : sturges));
  };

  /** Histogram with optional explicit edges. Returns counts + bin edges. */
  const histogram = (values, bins, range) => {
    const a = clean(values);
    if (!a.length) return { counts: [], edges: [], centers: [] };
    let lo = range && range[0] !== null && range[0] !== undefined ? range[0] : min(a);
    let hi = range && range[1] !== null && range[1] !== undefined ? range[1] : max(a);
    if (lo === hi) { lo -= 0.5; hi += 0.5; }
    const k = Math.max(1, bins || autoBins(a));
    const w = (hi - lo) / k;
    const counts = new Array(k).fill(0);
    for (const v of a) {
      let i = Math.floor((v - lo) / w);
      if (i === k) i = k - 1;
      if (i < 0 || i > k - 1) continue;
      counts[i]++;
    }
    const edges = [], centers = [];
    for (let i = 0; i <= k; i++) edges.push(lo + i * w);
    for (let i = 0; i < k; i++) centers.push((edges[i] + edges[i + 1]) / 2);
    return { counts, edges, centers, width: w, lo, hi };
  };

  /** Gaussian KDE evaluated on a grid — gives the smooth curve pandas plots. */
  const kde = (values, points, bandwidth) => {
    const a = clean(values);
    const n = a.length;
    if (n < 3) return points.map(() => 0);
    const s = std(a, 1) || 1;
    const h = bandwidth || 1.06 * s * Math.pow(n, -1 / 5);
    if (!h) return points.map(() => 0);
    const norm = 1 / (n * h * Math.sqrt(2 * Math.PI));
    return points.map((p) => {
      let acc = 0;
      for (const v of a) acc += Math.exp(-0.5 * ((p - v) / h) ** 2);
      return acc * norm;
    });
  };

  /** Five-number summary + outlier fences (box plot). */
  const boxStats = (values, whis = 1.5) => {
    const a = clean(values).sort((x, y) => x - y);
    if (!a.length) return null;
    const q1 = quantile(a, 0.25), q2 = quantile(a, 0.5), q3 = quantile(a, 0.75);
    const iqr = q3 - q1;
    const loFence = q1 - whis * iqr, hiFence = q3 + whis * iqr;
    const inside = a.filter((v) => v >= loFence && v <= hiFence);
    const outliers = a.filter((v) => v < loFence || v > hiFence);
    return { min: min(a), max: max(a), q1, q2, q3, iqr, whiskerLow: inside.length ? min(inside) : q1, whiskerHigh: inside.length ? max(inside) : q3, outliers, mean: mean(a) };
  };

  const zscore = (values) => {
    const a = clean(values);
    const m = mean(a), s = std(a, 0);
    return values.map((v) => {
      const n = toNum(v);
      if (n === null || !s) return null;
      return (n - m) / s;
    });
  };

  /** Summary numbers used by the column-profile cards and describe(). */
  const summary = (values) => {
    const a = clean(values).sort((x, y) => x - y);
    const n = a.length;
    const missing = values.length - n;
    if (!n) {
      return { count: 0, missing, mean: null, std: null, min: null, q1: null, median: null, q3: null, max: null, iqr: null, skew: null, kurt: null, sem: null, mad: null, range: null, cv: null };
    }
    const q1 = quantile(a, 0.25), q3 = quantile(a, 0.75);
    const m = mean(a), s = std(a, 1);
    return {
      count: n, missing,
      mean: m, std: s, min: a[0], q1, median: quantile(a, 0.5), q3, max: a[n - 1],
      iqr: q3 - q1, skew: skew(a), kurt: kurtosis(a), sem: sem(a), mad: mad(a),
      range: a[n - 1] - a[0],
      cv: m ? s / Math.abs(m) : null,
      sum: sum(a),
      zeros: a.filter((v) => v === 0).length,
      negatives: a.filter((v) => v < 0).length,
    };
  };

  const fmt = {
    int: (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })),
    num: (v, d) => {
      if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) return '—';
      const av = Math.abs(v);
      if (av !== 0 && (av >= 1e7 || av < 1e-4)) return Number(v).toExponential(3);
      const digits = d !== undefined ? d : av >= 1000 ? 1 : av >= 1 ? 2 : 4;
      return Number(v).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
    },
    pct: (v, d) => (v === null || v === undefined ? '—' : (v * 100).toFixed(d === undefined ? 2 : d) + '%'),
    sig: (v) => (v === null || v === undefined ? '—' : Number(v).toPrecision(3)),
    /** Compact axis-tick style: no thousands separators, k/M/B for large values. */
    compact: (v) => {
      if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) return '—';
      const n = Number(v);
      const a = Math.abs(n);
      if (a >= 1e9) return trimZeros((n / 1e9).toFixed(1)) + 'B';
      if (a >= 1e6) return trimZeros((n / 1e6).toFixed(1)) + 'M';
      if (a >= 1e4) return trimZeros((n / 1e3).toFixed(1)) + 'k';
      if (a >= 100) return String(Math.round(n * 10) / 10);
      if (a >= 1) return trimZeros(n.toFixed(2));
      if (a === 0) return '0';
      return trimZeros(n.toPrecision(3));
    },
  };

  const trimZeros = (s) => String(s).replace(/\.?0+$/, '') || '0';

  global.Stats = {
    isMissing, toNum, clean, sum, mean, variance, std, sem, min, max, quantile, median, mode,
    skew, kurtosis, mad, pearson, spearman, kendall, cov, linreg, autoBins, histogram, kde,
    boxStats, zscore, summary, rankAvg, fmt,
  };
})(window);
