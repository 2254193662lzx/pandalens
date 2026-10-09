/* =============================================================================
 * datasets.js — the built-in catalogue.
 *
 * Each entry is fetched from ./data/<file>.csv and parsed with the same code
 * path a dropped file uses, so the demo data exercises the real parser.
 * The generator dataset is created in memory with a seeded RNG.
 * ========================================================================== */
(function (global) {
  'use strict';

  const S = global.Stats;

  const CATALOGUE = [
    { id: 'iris', file: 'iris.csv', nameKey: 'ds.iris', descKey: 'ds.iris.desc', tag: 'starter', icon: 'hist', size: 'small' },
    { id: 'tips', file: 'tips.csv', nameKey: 'ds.tips', descKey: 'ds.tips.desc', tag: 'categorical', icon: 'bar', size: 'small' },
    { id: 'titanic', file: 'titanic.csv', nameKey: 'ds.titanic', descKey: 'ds.titanic.desc', tag: 'missing', icon: 'missing', size: 'medium' },
    { id: 'penguins', file: 'penguins.csv', nameKey: 'ds.penguins', descKey: 'ds.penguins.desc', tag: 'missing', icon: 'scatter', size: 'small' },
    { id: 'planets', file: 'planets.csv', nameKey: 'ds.planets', descKey: 'ds.planets.desc', tag: 'sparse', icon: 'splom', size: 'medium' },
    { id: 'flights', file: 'flights.csv', nameKey: 'ds.flights', descKey: 'ds.flights.desc', tag: 'time', icon: 'line', size: 'tiny' },
    { id: 'sales', file: 'sales.csv', nameKey: 'ds.sales', descKey: 'ds.sales.desc', tag: 'business', icon: 'treemap', size: 'medium' },
    { id: 'airquality', file: 'airquality.csv', nameKey: 'ds.airquality', descKey: 'ds.airquality.desc', tag: 'missing', icon: 'parallel', size: 'medium' },
    { id: 'stocks', file: 'stocks.csv', nameKey: 'ds.stocks', descKey: 'ds.stocks.desc', tag: 'time', icon: 'rolling', size: 'medium' },
    { id: 'diamonds', file: 'diamonds.csv', nameKey: 'ds.diamonds', descKey: 'ds.diamonds.desc', tag: 'large', icon: 'box', size: 'large' },
  ];

  const cache = new Map();

  /** Loads a catalogue entry (or any URL) and returns a DataFrame. */
  async function load(entry) {
    const file = typeof entry === 'string' ? entry : entry.file;
    const key = file;
    if (cache.has(key)) return cache.get(key).clone();
    const res = await fetch('data/' + file);
    if (!res.ok) throw new Error(`HTTP ${res.status} while loading ${file}`);
    const text = await res.text();
    const df = global.DF.DataFrame.parseCSV(text, { delimiter: global.DF.DataFrame.parseDelimitedAuto(text) });
    df.meta.sourceName = file;
    df.meta.sourceKind = 'csv';
    df.meta.datasetId = (typeof entry === 'object' && entry.id) || null;
    cache.set(key, df.clone());
    return df;
  }

  /**
   * A small random table so users can see column types, categories, dates and
   * missing values all at once without loading a file.
   */
  function generate(opts) {
    const o = Object.assign({ rows: 400, numeric: 4, categories: true, nulls: 0.06, seed: 7 }, opts || {});
    const rng = global.DF.mulberry32(o.seed);
    const gauss = (mu, sd) => {
      let u = 0, v = 0;
      while (u === 0) u = rng();
      while (v === 0) v = rng();
      return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const pad = (n) => String(n).padStart(2, '0');
    const names = ['record_id'];
    const cols = [global.DF.rangeArr(o.rows).map((i) => i + 1)];
    const dtypes = ['int64'];
    for (let k = 0; k < o.numeric; k++) {
      const mu = [50, 200, 12, 900, 4, 68, 320, 9][k % 8];
      const sd = [14, 60, 3.4, 210, 1.2, 12, 88, 2.1][k % 8];
      names.push(`metric_${k + 1}`);
      cols.push(global.DF.rangeArr(o.rows).map(() => Number(gauss(mu, sd).toFixed(2))));
      dtypes.push('float64');
    }
    if (o.categories) {
      const cats = ['Segment A', 'Segment B', 'Segment C', 'Segment D', 'Segment E'];
      names.push('segment');
      cols.push(global.DF.rangeArr(o.rows).map(() => cats[Math.floor(rng() * cats.length)]));
      dtypes.push('object');
      const regions = ['North', 'South', 'East', 'West'];
      names.push('region');
      cols.push(global.DF.rangeArr(o.rows).map(() => regions[Math.floor(rng() * regions.length)]));
      dtypes.push('object');
      names.push('is_active');
      cols.push(global.DF.rangeArr(o.rows).map(() => rng() > 0.28));
      dtypes.push('bool');
    }
    names.push('event_date');
    const start = new Date(2022, 0, 1).getTime();
    cols.push(global.DF.rangeArr(o.rows).map(() => {
      const d = new Date(start + Math.floor(rng() * 730) * 86400000);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00`;
    }));
    dtypes.push('datetime64');
    if (o.nulls > 0) {
      names.push('score');
      cols.push(global.DF.rangeArr(o.rows).map(() => (rng() < o.nulls ? null : Number(gauss(72, 15).toFixed(1)))));
      dtypes.push('float64');
      const mi = names.indexOf('metric_2');
      cols[mi] = cols[mi].map((v) => (rng() < o.nulls ? null : v));
      const ri = names.indexOf('region');
      if (ri >= 0) cols[ri] = cols[ri].map((v) => (rng() < o.nulls ? null : v));
    }
    const df = global.DF.DataFrame.fromArrays(names, cols, dtypes);
    df.meta.sourceName = 'generated.csv';
    df.meta.sourceKind = 'generated';
    return df;
  }

  global.Datasets = { CATALOGUE, load, generate };
})(window);
