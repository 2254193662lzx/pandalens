/* =============================================================================
 * probe.js — headless smoke test.
 *   node tools/probe.js [--shots]
 * Loads every view, exercises the pipeline, all chart types and both languages,
 * reporting console errors, failed requests and layout metrics.
 * ========================================================================== */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';
const SHOT_DIR = path.join(__dirname, '..', 'video', 'shots');

(async () => {
  const wantShots = process.argv.includes('--shots');
  if (wantShots) fs.mkdirSync(SHOT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1600,1000', '--force-device-scale-factor=1'],
    defaultViewport: { width: 1600, height: 1000 },
  });
  const page = await browser.newPage();
  const errors = [];
  const warnings = [];
  const requests = [];

  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') errors.push('console: ' + text);
    else if (msg.type() === 'warning') warnings.push(text);
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => requests.push(`${r.url()} — ${r.failure() ? r.failure().errorText : '?'}`));
  page.on('response', (r) => { if (r.status() >= 400) requests.push(`${r.status()} ${r.url()}`); });

  const step = async (name, fn) => {
    const before = errors.length;
    try {
      await fn();
    } catch (e) {
      errors.push(`STEP ${name}: ${e.message}`);
    }
    const added = errors.slice(before);
    console.log(`${added.length ? 'FAIL' : ' ok '} ${name}${added.length ? ' -> ' + added.join(' | ').slice(0, 400) : ''}`);
    return added.length === 0;
  };

  // ---------------------------------------------------------------- boot
  await step('load page + default dataset', async () => {
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
    await page.waitForFunction('window.__pandalens && window.__pandalens.state.frame', { timeout: 30000 });
  });

  const info = async () => page.evaluate(() => {
    const s = window.__pandalens.state;
    return { view: s.view, rows: s.frame ? s.frame.nrows : null, cols: s.frame ? s.frame.ncols : null, steps: s.pipeline.length, chart: s.chart.type, datasets: s.datasets.length };
  });
  console.log('   state:', JSON.stringify(await info()));

  // ------------------------------------------------------------- all views
  for (const view of ['load', 'table', 'profile', 'visualize', 'pipeline', 'code']) {
    await step(`view: ${view}`, async () => {
      await page.evaluate((v) => window.__pandalens.setView(v), view);
      await new Promise((r) => setTimeout(r, 320));
      const has = await page.evaluate((v) => document.getElementById('view-' + v).innerHTML.length > 120, view);
      if (!has) throw new Error('view rendered empty');
    });
    if (wantShots) await page.screenshot({ path: path.join(SHOT_DIR, `view-${view}.png`) });
  }

  // ---------------------------------------------------------- every dataset
  for (const id of ['iris', 'titanic', 'planets', 'flights', 'airquality', 'stocks', 'diamonds']) {
    await step(`dataset: ${id}`, async () => {
      await page.evaluate((d) => window.__pandalens.useCatalogue(d), id);
      await page.waitForFunction((d) => window.__pandalens.state.datasets.some((x) => x.id === d), { timeout: 30000 }, id);
      await new Promise((r) => setTimeout(r, 200));
    });
  }

  // ------------------------------------- default chart is valid per dataset
  for (const id of ['iris', 'titanic', 'planets', 'flights', 'airquality', 'stocks']) {
    await step(`default chart on: ${id}`, async () => {
      await page.evaluate((d) => window.__pandalens.useCatalogue(d), id);
      await page.waitForFunction((d) => window.__pandalens.state.datasets.some((x) => x.id === d) && window.__pandalens.state.datasets[window.__pandalens.state.activeIdx].id === d, { timeout: 30000 }, id);
      await page.evaluate(() => window.__pandalens.setView('visualize'));
      await new Promise((r) => setTimeout(r, 420));
      const res = await page.evaluate(() => {
        const host = document.getElementById('chart-host');
        const empty = host ? host.querySelector('.chart-empty') : null;
        return { ok: !!host && !empty, why: empty ? empty.textContent.trim() : 'no host' };
      });
      if (!res.ok) throw new Error('empty default chart: ' + res.why);
    });
    if (wantShots) await page.screenshot({ path: path.join(SHOT_DIR, `default-chart-${id}.png`) });
  }

  // --------------------------------------------------------- every chart type
  await page.evaluate(() => window.__pandalens.useCatalogue('sales'));
  await page.waitForFunction(() => window.__pandalens.state.frame && window.__pandalens.state.datasets.some((d) => d.id === 'sales'), { timeout: 30000 });
  await page.evaluate(() => window.__pandalens.setView('visualize'));
  const chartTypes = await page.evaluate(() => Object.keys(window.Charts.CHARTS));
  for (const type of chartTypes) {
    await step(`chart: ${type}`, async () => {
      await page.evaluate((ty) => window.__pandalens.switchChart(ty), type);
      await new Promise((r) => setTimeout(r, 260));
      const res = await page.evaluate(() => {
        const host = document.getElementById('chart-host');
        if (!host) return { ok: false, why: 'no host' };
        const empty = host.querySelector('.chart-empty');
        return { ok: !empty, why: empty ? empty.textContent.trim() : '' };
      });
      if (!res.ok) throw new Error('empty chart: ' + res.why);
    });
    if (wantShots) await page.screenshot({ path: path.join(SHOT_DIR, `chart-${type}.png`) });
  }

  // --------------------------------------------------------- every operation
  await page.evaluate(() => window.__pandalens.setView('pipeline'));
  const opIds = await page.evaluate(() => Object.keys(window.Ops.OPS));
  for (const opId of opIds) {
    await step(`op: ${opId}`, async () => {
      const res = await page.evaluate((id) => {
        const s = window.__pandalens.state;
        s.pipeline = [];
        window.__pandalens.recompute();
        try {
          window.__pandalens.addStep(id);
        } catch (e) { return { ok: false, why: 'addStep threw: ' + e.message }; }
        const err = s.stepError;
        return { ok: !err, why: err ? err.message : '', rows: s.frame.nrows, steps: s.pipeline.length };
      }, opId);
      if (!res.ok) throw new Error(`${res.why} (rows=${res.rows})`);
    });
    await page.evaluate(() => { window.__pandalens.state.pipeline = []; window.__pandalens.recompute(); window.__pandalens.render(); });
  }

  // ------------------------------------------------- realistic chain + code
  await step('pipeline chain + code generation', async () => {
    await page.evaluate(() => {
      const A = window.__pandalens;
      A.state.pipeline = [];
      A.addStep('filter', { mode: 'visual', conditions: [{ column: 'region', op: 'in', value: 'East,West', value2: '' }], logic: 'and' });
      A.addStep('assign', { name: 'margin', expr: 'profit / revenue' });
      A.addStep('groupAgg', { by: ['region', 'category'], valueCols: ['revenue', 'profit'], funcs: ['sum', 'mean'], sortBy: '__group__' });
      A.addStep('sort', { by: ['revenue_sum'], ascending: false });
    });
    await page.evaluate(() => window.__pandalens.setView('code'));
    await new Promise((r) => setTimeout(r, 250));
    const code = await page.evaluate(() => document.getElementById('code-block').textContent);
    for (const needle of ['groupby', 'assign', 'isin', 'sort_values']) {
      if (!code.includes(needle)) throw new Error('generated code missing: ' + needle);
    }
  });
  if (wantShots) await page.screenshot({ path: path.join(SHOT_DIR, 'pipeline-chain.png') });

  // ------------------------------------------------- visual filter builder
  await step('visual filter builder (dropdowns + typing)', async () => {
    await page.evaluate(() => { window.__pandalens.state.pipeline = []; window.__pandalens.recompute(); window.__pandalens.setView('pipeline'); });
    await page.waitForSelector('[data-add-op="filter"]');
    await page.click('[data-add-op="filter"]');
    await new Promise((r) => setTimeout(r, 350));
    // pick a real category column, then switch the operator to "is one of"
    await page.select('.step .cond-row select[data-cp="column"]', 'region');
    await new Promise((r) => setTimeout(r, 350));
    await page.select('.step .cond-row select[data-cp="op"]', 'in');
    await new Promise((r) => setTimeout(r, 350));
    if (!(await page.$('.step .cond-row input[data-cp="value"]'))) throw new Error('value input did not appear');
    await page.click('.step .cond-row input[data-cp="value"]');
    await page.type('.step .cond-row input[data-cp="value"]', 'East,West', { delay: 30 });
    await new Promise((r) => setTimeout(r, 600));
    const res = await page.evaluate(() => {
      const s = window.__pandalens.state;
      const c = s.pipeline[0].params.conditions[0];
      return { op: c.op, value: c.value, rows: s.frame.nrows, err: s.stepError };
    });
    if (res.err) throw new Error('step error: ' + res.err.message);
    if (res.op !== 'in' || res.value !== 'East,West') throw new Error('builder did not record input: ' + JSON.stringify(res));
    if (res.rows === 1200 || res.rows === 0) throw new Error('filter had no effect, rows=' + res.rows);
    await page.evaluate(() => { window.__pandalens.state.pipeline = []; window.__pandalens.recompute(); });
  });

  // ------------------------------------------------------- table interactions
  await step('table: sort / search / heat / paging', async () => {
    await page.evaluate(() => { window.__pandalens.setView('table'); });
    await new Promise((r) => setTimeout(r, 200));
    await page.evaluate(() => {
      const th = document.querySelector('#view-table th[data-col]');
      if (th) th.click();
    });
    await new Promise((r) => setTimeout(r, 150));
    await page.evaluate(() => { const b = document.getElementById('btn-heat'); if (b) b.click(); });
    await new Promise((r) => setTimeout(r, 150));
    await page.evaluate(() => {
      const s = document.getElementById('table-search');
      s.value = 'East';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 300));
    await page.evaluate(() => { const b = document.getElementById('page-next'); if (b) b.click(); });
    await new Promise((r) => setTimeout(r, 200));
    await page.evaluate(() => { const b = document.getElementById('btn-columns'); if (b) b.click(); });
    await new Promise((r) => setTimeout(r, 200));
    await page.evaluate(() => { window.UI.closeMenu(); });
  });
  if (wantShots) await page.screenshot({ path: path.join(SHOT_DIR, 'table-interactions.png') });

  // --------------------------------------------------------- column menu ops
  await step('column menu builds a step', async () => {
    const res = await page.evaluate(() => {
      const s = window.__pandalens.state;
      s.pipeline = [];
      window.__pandalens.recompute();
      const before = s.pipeline.length;
      const df = s.frame;
      // simulate the menu path used by the table headers
      window.__pandalens.addStep('bin', { column: df.numericColumns()[0], mode: 'quantile', bins: 4, edges: '' });
      return { before, after: s.pipeline.length };
    });
    if (res.after !== res.before + 1) throw new Error('step was not added');
  });

  // ---------------------------------------------------------------- language
  for (const lang of ['en', 'zh']) {
    await step(`language: ${lang}`, async () => {
      await page.evaluate((l) => document.querySelector(`#lang-switch [data-lang="${l}"]`).click(), lang);
      await new Promise((r) => setTimeout(r, 400));
      const bad = await page.evaluate(() => {
        // any visible text that still looks like a raw i18n key (contains a dot, lowercase)
        const out = [];
        document.querySelectorAll('.view.active h2, .view.active h3, .nav-item span, .btn, .field > label').forEach((el) => {
          const s = el.textContent.trim();
          if (/^[a-z]+\.[a-z][\w.]*$/.test(s)) out.push(s);
        });
        return out;
      });
      if (bad.length) throw new Error('untranslated keys visible: ' + bad.slice(0, 8).join(', '));
    });
    if (wantShots) await page.screenshot({ path: path.join(SHOT_DIR, `lang-${lang}.png`) });
  }

  // ------------------------------------------------------------------ theme
  for (const theme of ['dark', 'light']) {
    await step(`theme: ${theme}`, async () => {
      await page.evaluate(() => document.getElementById('btn-theme').click());
      await new Promise((r) => setTimeout(r, 400));
      await page.evaluate(() => window.__pandalens.setView('visualize'));
      await new Promise((r) => setTimeout(r, 400));
    });
    if (wantShots) await page.screenshot({ path: path.join(SHOT_DIR, `theme-${theme}.png`) });
  }

  // ----------------------------------------------------------- i18n coverage
  await step('i18n key coverage', async () => {
    const missing = await page.evaluate(() => {
      const keys = Object.keys(window.I18N.STRINGS);
      const bad = [];
      keys.forEach((k) => {
        const v = window.I18N.STRINGS[k];
        if (!Array.isArray(v) || v.length !== 2 || v.some((x) => typeof x !== 'string' || !x.trim())) bad.push(k);
      });
      // also confirm every key referenced in the registries resolves
      const refs = new Set();
      Object.values(window.Ops.OPS).forEach((o) => {
        refs.add(o.labelKey);
        (o.params || []).forEach((p) => { refs.add(p.labelKey); if (p.hintKey) refs.add(p.hintKey); (p.options || []).forEach((op) => op.labelKey && refs.add(op.labelKey)); });
      });
      Object.values(window.Charts.CHARTS).forEach((c) => {
        refs.add(c.labelKey); refs.add(c.aboutKey);
        (c.params || []).forEach((p) => { refs.add(p.labelKey); if (p.hintKey) refs.add(p.hintKey); (p.options || []).forEach((op) => op.labelKey && refs.add(op.labelKey)); });
      });
      Object.keys(window.Ops.OPS).forEach((id) => refs.add('op.' + id));
      window.Ops.AGG_CHOICES.forEach((a) => refs.add('agg.' + a));
      return { unresolved: [...refs].filter((k) => k && !window.I18N.STRINGS[k]), malformed: bad };
    });
    if (missing.malformed.length) throw new Error('malformed entries: ' + missing.malformed.join(', '));
    if (missing.unresolved.length) throw new Error('unresolved keys: ' + missing.unresolved.join(', '));
  });

  // ------------------------------------------------- broken step is survivable
  await step('a failing step is reported and the app stays usable', async () => {
    const res = await page.evaluate(() => {
      const A = window.__pandalens;
      A.state.pipeline = [];
      A.recompute();
      A.addStep('assign', { name: 'temp_col', expr: 'revenue * 2' });
      A.addStep('dropColumns', { columns: ['revenue'] });
      // references a column the previous step removed
      A.addStep('sort', { by: ['revenue'], ascending: false });
      A.setView('pipeline');
      const s = A.state;
      const err = s.stepError;
      const errBoxes = document.querySelectorAll('.step-error').length;
      s.pipeline.splice(2, 1);           // drop the broken step
      A.recompute();
      return {
        errorShown: !!err,
        errBoxes,
        recovered: !s.stepError && s.frame.nrows > 0 && s.frame.names.includes('temp_col'),
      };
    });
    if (!res.errorShown) throw new Error('the broken step produced no error');
    if (res.errBoxes < 1) throw new Error('no error box rendered');
    if (!res.recovered) throw new Error('the app did not recover after removing the step');
  });

  // ------------------------------------------------------------------ export
  await step('report + CSV generation', async () => {
    const ok = await page.evaluate(() => {
      const s = window.__pandalens.state;
      const csv = s.frame.toCSV({ limit: 50 });
      const json = JSON.parse(s.frame.toJSON({ plain: true }));
      return csv.split('\r\n').length > 5 && Array.isArray(json);
    });
    if (!ok) throw new Error('exports look wrong');
  });

  await browser.close();

  console.log('\n---- summary ----');
  console.log('errors            :', errors.length);
  console.log('failed requests   :', requests.length);
  if (requests.length) requests.slice(0, 20).forEach((r) => console.log('  req', r));
  const raws = warnings.filter((w) => /i18n|undefined keys/.test(w));
  if (raws.length) raws.forEach((w) => console.log('  warn', w));
  if (errors.length) {
    console.log('\nERRORS:');
    errors.slice(0, 40).forEach((e) => console.log(' -', e.slice(0, 400)));
  }
  process.exit(errors.length ? 1 : 0);
})();
