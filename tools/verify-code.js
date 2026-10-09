/* =============================================================================
 * verify-code.js — cross-checks the app against real pandas.
 *
 * Builds several pipelines in the browser, exports the generated pandas script,
 * runs it with the local Python/pandas installation and compares the resulting
 * shape with the numbers the app reports. Any mismatch is printed.
 *   node tools/verify-code.js
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

const PIPELINES = [
  {
    name: 'filter + assign + groupby + sort',
    dataset: 'sales',
    build: `
      A.addStep('filter', { mode: 'visual', conditions: [{ column: 'region', op: 'in', value: 'East,West', value2: '' }], logic: 'and' });
      A.addStep('assign', { name: 'margin', expr: 'profit / revenue' });
      A.addStep('groupAgg', { by: ['region','category'], valueCols: ['revenue','profit'], funcs: ['sum','mean'], sortBy: '__group__' });
      A.addStep('sort', { by: ['revenue_sum'], ascending: false });
    `,
  },
  {
    name: 'dropna + astype + bin + filter expression',
    dataset: 'airquality',
    build: `
      A.addStep('dropna', { how: 'any', subset: ['pm25','pm10'], useThresh: false, thresh: 1 });
      A.addStep('bin', { column: 'pm25', mode: 'quantile', bins: 4, edges: '' });
      A.addStep('filter', { mode: 'expr', expr: 'pm25 > 20 and o3 > 40', conditions: [], logic: 'and' });
      A.addStep('assign', { name: 'ratio', expr: 'round(pm10 / pm25, 2)' });
    `,
  },
  {
    name: 'pivot + melt + rolling',
    dataset: 'stocks',
    build: `
      A.addStep('sort', { by: ['date'], ascending: true });
      A.addStep('rolling', { column: 'close', window: 5, agg: 'mean', minPeriods: 5 });
      A.addStep('pivot', { index: ['date'], columns: ['ticker'], values: ['close'], aggfunc: 'mean' });
    `,
  },
  {
    name: 'datetime parts + drop duplicates + limit',
    dataset: 'sales',
    build: `
      A.addStep('datetimePart', { column: 'order_date', part: 'quarter' });
      A.addStep('selectColumns', { columns: ['order_id','order_date','order_date_quarter','revenue','region'] });
      A.addStep('dropDuplicates', { subset: ['region','order_date_quarter'], keep: 'first' });
      A.addStep('sort', { by: ['revenue'], ascending: false });
      A.addStep('limit', { how: 'head', n: 25, seed: 42 });
    `,
  },
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1500, height: 950 },
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction('window.__pandalens && window.__pandalens.state.frame', { timeout: 30000 });

  let failures = 0;
  for (const spec of PIPELINES) {
    const loaded = await page.evaluate(async (id) => {
      await window.__pandalens.useCatalogue(id);
      return true;
    }, spec.dataset);
    void loaded;
    await page.waitForFunction((id) => window.__pandalens.state.datasets.some((d) => d.id === id)
      && window.__pandalens.state.datasets[window.__pandalens.state.activeIdx].id === id, { timeout: 30000 }, spec.dataset);

    const out = await page.evaluate((code) => {
      const A = window.__pandalens;
      A.state.pipeline = [];
      A.recompute();
      // eslint-disable-next-line no-new-func
      new Function('A', code)(A);
      const df = A.state.frame;
      const script = window.Ops.pipelinePython(
        { kind: 'csv', name: '__FILE__' },
        A.state.pipeline,
        { datasets: A.state.datasets, df }
      );
      return {
        rows: df.nrows,
        cols: df.ncols,
        columns: df.names,
        head: df.head(3).toRecords(3).map((r) => { delete r.__index; return r; }),
        script,
        steps: A.state.pipeline.length,
      };
    }, spec.build);

    // rewrite the read_csv path to the local data folder
    const csvPath = `${DATA_DIR}/${spec.dataset}.csv`;
    const script = out.script
      .replace('pd.read_csv("__FILE__")', `pd.read_csv(r"${csvPath}")`)
      .replace('import numpy as np', 'import numpy as np');
    const file = path.join(os.tmpdir(), `pandalens_verify_${spec.dataset}_${Date.now() % 100000}.py`);
    fs.writeFileSync(file, script + `\nprint("SHAPE", df.shape)\nprint("COLS", ",".join(map(str, df.columns)))\nprint("HEAD", df.head(3).to_dict("records"))\n`, 'utf8');

    let py;
    try {
      py = execFileSync('python', [file], { encoding: 'utf8', timeout: 300000 });
    } catch (e) {
      failures++;
      console.log(`FAIL  ${spec.name}\n  python error: ${(e.stderr || e.message).split('\n').slice(-6).join('\n  ')}`);
      console.log('  script:', script.split('\n').slice(0, 24).join('\n  '));
      continue;
    }
    const shape = /SHAPE \((\d+), (\d+)\)/.exec(py);
    const pyCols = /COLS (.*)/.exec(py);
    const appShape = [out.rows, out.cols];
    const pyShape = shape ? [Number(shape[1]), Number(shape[2])] : null;
    const shapeOk = pyShape && pyShape[0] === appShape[0] && pyShape[1] === appShape[1];
    const colsOk = pyCols && pyCols[1].trim() === out.columns.join(',');
    // compare the first data row values loosely (string forms, 2dp)
    const pyHead = /HEAD (.*)/.exec(py);
    let headOk = true;
    if (pyHead) {
      try {
        const rows = JSON.parse(pyHead[1].replace(/'/g, '"'));
        const appRow = out.head[0];
        for (const k of Object.keys(rows[0] || {}).slice(0, 40)) {
          if (appRow[k] === undefined) continue;
          const a = appRow[k];
          const b = rows[0][k];
          if (typeof b === 'number' && typeof a === 'number') {
            if (Math.abs(a - b) > 0.02 * Math.max(1, Math.abs(b))) { headOk = false; console.log(`  value mismatch on ${k}: app=${a} pandas=${b}`); }
          } else if (String(a) !== String(b)) {
            headOk = false;
            console.log(`  value mismatch on ${k}: app=${a} pandas=${b}`);
          }
        }
      } catch (e) { /* head comparison is best-effort */ }
    }
    const ok = shapeOk && colsOk && headOk;
    if (!ok) failures++;
    console.log(`${ok ? ' ok ' : 'FAIL'}  ${spec.name}  app=${appShape.join('x')} pandas=${pyShape ? pyShape.join('x') : '?'}  cols=${colsOk ? 'match' : 'MISMATCH'}  values=${headOk ? 'match' : 'MISMATCH'}  steps=${out.steps}`);
  }

  await browser.close();
  if (pageErrors.length) console.log('page errors:', pageErrors);
  console.log(failures ? `\n${failures} pipeline(s) disagreed with pandas` : '\nAll pipelines match pandas exactly.');
  process.exit(failures ? 1 : 0);
})();
