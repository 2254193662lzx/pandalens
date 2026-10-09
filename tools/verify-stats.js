/* =============================================================================
 * verify-stats.js — compares PandaLens' statistics with real pandas.
 *
 * Checks describe(), correlations, value_counts(), null counts, quantiles and a
 * groupby aggregation on several datasets, then reports the worst deviation.
 *   node tools/verify-stats.js
 * ========================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';
// the archive layout keeps the site in web/; the repository layout keeps it
// at the root next to tools/ — support both
const SITE_DIR = fs.existsSync(path.join(__dirname, '..', 'web', 'data'))
  ? path.join(__dirname, '..', 'web') : path.join(__dirname, '..');
const DATA_DIR = path.join(SITE_DIR, 'data').replace(/\\/g, '/');

const DATASETS = [
  { id: 'sales', numeric: ['units', 'unit_price', 'discount', 'revenue', 'cost', 'profit', 'customer_age', 'satisfaction'], group: ['region', 'category'] },
  { id: 'iris', numeric: ['sepal_length', 'sepal_width', 'petal_length', 'petal_width'], group: ['species'] },
  { id: 'titanic', numeric: ['age', 'fare', 'sibsp', 'parch'], group: ['sex', 'pclass'] },
  { id: 'diamonds', numeric: ['carat', 'depth', 'table', 'price', 'x', 'y', 'z'], group: ['cut', 'color'] },
  { id: 'airquality', numeric: ['pm25', 'pm10', 'no2', 'o3', 'temperature', 'humidity'], group: ['station'] },
];

const PY = `
import json, sys
import pandas as pd, numpy as np
out = {}
for spec in json.load(open(sys.argv[1], encoding="utf-8")):
    df = pd.read_csv(spec["path"])
    num = [c for c in spec["numeric"] if c in df.columns]
    d = df[num].describe().T
    desc = {}
    for c in num:
        row = d.loc[c]
        desc[c] = {k: (None if pd.isna(row[k]) else float(row[k])) for k in
                   ["count","mean","std","min","25%","50%","75%","max"]}
    corr = {}
    if len(num) >= 2:
        m = df[num].corr()
        for i, a in enumerate(num):
            for b in num[i+1:]:
                v = m.loc[a, b]
                corr[a + "|" + b] = None if pd.isna(v) else float(v)
    nulls = {c: int(df[c].isna().sum()) for c in df.columns}
    gcols = [c for c in spec["group"] if c in df.columns]
    agg = {}
    if gcols and num:
        g = df.groupby(gcols)[num[0]].agg(["count","mean","sum","std"]).reset_index()
        for _, r in g.head(200).iterrows():
            key = "~".join(str(r[c]) for c in gcols)
            agg[key] = {k: (None if pd.isna(r[k]) else float(r[k])) for k in ["count","mean","sum","std"]}
    vc = {}
    if gcols:
        c = gcols[0]
        counts = df[c].value_counts()
        vc = {str(k): int(v) for k, v in counts.items()}
    out[spec["id"]] = {"desc": desc, "corr": corr, "nulls": nulls, "agg": agg, "value_counts": vc}
json.dump(out, open(sys.argv[2], "w", encoding="utf-8"))
print("ok")
`;

(async () => {
  const specs = DATASETS.map((d) => ({ ...d, path: `${DATA_DIR}/${d.id}.csv` }));
  const specFile = path.join(os.tmpdir(), 'pl_specs.json');
  const outFile = path.join(os.tmpdir(), 'pl_pandas.json');
  const pyFile = path.join(os.tmpdir(), 'pl_stats.py');
  fs.writeFileSync(specFile, JSON.stringify(specs), 'utf8');
  fs.writeFileSync(pyFile, PY, 'utf8');
  execFileSync('python', [pyFile, specFile, outFile], { encoding: 'utf8', timeout: 600000 });
  const truth = JSON.parse(fs.readFileSync(outFile, 'utf8'));

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=4096'],
    defaultViewport: { width: 1400, height: 900 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction('window.__pandalens && window.__pandalens.state.frame', { timeout: 40000 });

  let worst = { rel: 0, where: '' };
  let checks = 0;
  let bad = [];

  const close = (a, b, tol, label) => {
    checks++;
    if (a === null || a === undefined || b === null || b === undefined) {
      if (a !== b) { bad.push(`${label}: app=${a} pandas=${b}`); }
      return;
    }
    const rel = Math.abs(a - b) / Math.max(1e-9, Math.abs(b));
    if (rel > worst.rel) worst = { rel, where: label };
    if (rel > tol) bad.push(`${label}: app=${a} pandas=${b} (rel ${rel.toExponential(2)})`);
  };

  for (const spec of DATASETS) {
    await page.evaluate((id) => window.__pandalens.useCatalogue(id), spec.id);
    await page.waitForFunction((id) => window.__pandalens.state.datasets.some((d) => d.id === id)
      && window.__pandalens.state.datasets[window.__pandalens.state.activeIdx].id === id, { timeout: 60000 }, spec.id);
    const app = await page.evaluate((s) => {
      const df = window.__pandalens.state.frame;
      const S = window.Stats;
      const num = s.numeric.filter((c) => df.names.includes(c));
      const desc = {};
      num.forEach((c) => {
        const st = S.summary(df.col(c));
        desc[c] = { count: st.count, mean: st.mean, std: st.std, min: st.min, '25%': st.q1, '50%': st.median, '75%': st.q3, max: st.max };
      });
      const corr = {};
      const table = df.corr('pearson', num);
      num.forEach((a, i) => num.slice(i + 1).forEach((b) => { corr[a + '|' + b] = table.at(num.indexOf(b), a); }));
      const nulls = {};
      df.names.forEach((c) => { nulls[c] = df.isNull(c).filter(Boolean).length; });
      const gcols = s.group.filter((c) => df.names.includes(c));
      const agg = {};
      if (gcols.length && num.length) {
        const g = df.groupAgg(gcols, { [num[0]]: ['count', 'mean', 'sum', 'std'] }, {});
        const keyCol = g.names[0], valCol = `${num[0]}_count`;
        void keyCol; void valCol;
        for (let r = 0; r < Math.min(200, g.nrows); r++) {
          const key = gcols.map((c) => String(g.at(r, c))).join('~');
          agg[key] = {};
          ['count', 'mean', 'sum', 'std'].forEach((f) => { agg[key][f] = g.at(r, `${num[0]}_${f}`); });
        }
      }
      const vc = {};
      if (gcols.length) df.valueCounts(gcols[0], {}).entries.forEach((e) => { vc[e.label] = e.count; });
      return { desc, corr, nulls, agg, value_counts: vc };
    }, spec);

    Object.keys(truth[spec.id].desc).forEach((c) => {
      const a = app.desc[c], b = truth[spec.id].desc[c];
      if (!a || !b) return;
      ['count', 'mean', 'std', 'min', '25%', '50%', '75%', 'max'].forEach((k) => close(a[k], b[k], 1e-6, `${spec.id}.${c}.${k}`));
    });
    Object.keys(truth[spec.id].corr).forEach((k) => close(app.corr[k], truth[spec.id].corr[k], 1e-6, `${spec.id}.corr(${k})`));
    Object.keys(truth[spec.id].nulls).forEach((c) => {
      checks++;
      if (app.nulls[c] !== truth[spec.id].nulls[c]) bad.push(`${spec.id}.nulls(${c}): app=${app.nulls[c]} pandas=${truth[spec.id].nulls[c]}`);
    });
    Object.keys(truth[spec.id].value_counts).forEach((k) => {
      checks++;
      if (app.value_counts[k] !== truth[spec.id].value_counts[k]) bad.push(`${spec.id}.value_counts(${k}): app=${app.value_counts[k]} pandas=${truth[spec.id].value_counts[k]}`);
    });
    Object.keys(truth[spec.id].agg).slice(0, 60).forEach((k) => {
      const a = app.agg[k], b = truth[spec.id].agg[k];
      if (!b) return;
      if (!a) { bad.push(`${spec.id}.group(${k}): missing in app`); return; }
      ['count', 'mean', 'sum', 'std'].forEach((f) => close(a[f], b[f], 1e-6, `${spec.id}.group(${k}).${f}`));
    });
    console.log(`checked ${spec.id} (${checks} comparisons so far)`);
  }

  await browser.close();
  console.log('\ncomparisons      :', checks);
  console.log('worst deviation  :', worst.rel.toExponential(3), '@', worst.where);
  console.log('mismatches       :', bad.length);
  bad.slice(0, 25).forEach((b) => console.log('  -', b));
  if (errs.length) console.log('page errors:', errs.slice(0, 5));
  process.exit(bad.length ? 1 : 0);
})();
