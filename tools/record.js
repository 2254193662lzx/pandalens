/* =============================================================================
 * record.js — records the narrated demo video (Chinese voice-over, burned-in
 * subtitles, real UI interactions).
 *
 * Pipeline per scene
 *   1. synthesise the narration with the Windows SAPI voice (Microsoft Huihui),
 *   2. drive the real interface with real clicks and typing,
 *   3. hold the final state until the scene is at least as long as its narration.
 * Frames come from the CDP screencast (a frame whenever the page changes) with
 * wall-clock timing, so static holds cost no storage and the pacing is exact.
 * Narration is padded to the length each scene actually took, which keeps audio
 * and video locked together no matter how long the interactions ran.
 *
 *   node tools/record.js [--dry] [--only=3,4] [--nofinal] [--keep]
 * Output: video/PandaLens-demo.mp4 and video/PandaLens-demo.zh.srt
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const FFMPEG = path.join(__dirname, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:8899/index.html';

const OUT_DIR = path.join(__dirname, '..', 'video');
const WORK = path.join(OUT_DIR, 'work');
const FRAME_DIR = path.join(WORK, 'frames');
const AUDIO_DIR = path.join(WORK, 'audio');
const CAPTURE = { width: 1600, height: 900 };
const NL = String.fromCharCode(10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log('  ' + m);

function run(cmd, args, opts) {
  return execFileSync(cmd, args, Object.assign({ encoding: 'utf8', maxBuffer: 1 << 28 }, opts || {}));
}

/** Windows SAPI text-to-speech -> 16-bit mono WAV. */
function tts(text, file) {
  const ps = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    "$s.SelectVoice('Microsoft Huihui Desktop')",
    '$s.Rate = 2',
    '$s.Volume = 100',
    "$s.SetOutputToWaveFile('" + file.replace(/\\/g, '\\\\') + "')",
    "$s.Speak('" + text.replace(/'/g, "''") + "')",
    '$s.Dispose()',
  ].join(NL);
  const psFile = path.join(WORK, 'tts.ps1');
  fs.writeFileSync(psFile, ps, 'utf8');
  run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile]);
}

/** ffmpeg reports the duration on stderr (ffprobe is not bundled). */
function mediaDuration(file) {
  let text = '';
  try {
    text = execFileSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    text = String(e.stderr || e.stdout || '');
  }
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(text);
  if (!m) throw new Error('could not read the duration of ' + file);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function fmtTime(t) {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const p = (n) => String(Math.floor(n)).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}.${String(Math.round((s % 1) * 1000)).padStart(3, '0')}`;
}

/* ------------------------------------------------------------- the scenes */
const SCENES = [
  {
    id: 'intro',
    caption: 'PandaLens — 浏览器里的可视化 pandas 数据分析工作台',
    narration: '大家好，这是 PandaLens，一个完全运行在浏览器里的可视化 pandas 数据分析工作台。它把 pandas 的数据处理能力，变成了可以直接点击、看得见的数据分析流程，并且支持中英文双语。',
    min: 15,
    async run(page, h) {
      await h.evaluate(() => {
        window.__pandalens.state.pipeline = [];
        window.__pandalens.recompute();
        window.__pandalens.setView('load');
      });
      await h.wait(1100);
      await h.moveTo('#dataset-chip');
      await h.wait(1300);
      await h.scrollMain(200);
      await h.wait(1100);
      await h.scrollMain(-200);
      await h.wait(600);
    },
  },
  {
    id: 'load',
    caption: '十个内置数据集 + 拖拽 / 粘贴 / 网址 / Excel 加载',
    narration: '首先是加载数据。网站内置了十个数据集，涵盖鸢尾花、泰坦尼克号、空气质量、股票行情等不同类型，点击卡片立刻载入。你也可以拖入文件、粘贴表格、从网址抓取，支持 CSV、JSON 和 Excel，全过程在本地完成，数据不会上传。',
    min: 20,
    async run(page, h) {
      await h.click('[data-ds="iris"]');
      await h.wait(1500);
      await h.click('.nav-item[data-view="load"]');
      await h.wait(500);
      await h.click('[data-ds="titanic"]');
      await h.wait(1500);
      await h.click('.nav-item[data-view="load"]');
      await h.wait(500);
      await h.click('[data-ds="diamonds"]');
      await h.wait(1900);
      await h.click('.nav-item[data-view="load"]');
      await h.wait(500);
      await h.click('[data-ds="sales"]');
      await h.wait(1700);
    },
  },
  {
    id: 'table',
    caption: '数据表：表头分布条 · 排序 · 数值热力着色 · 搜索',
    narration: '这是数据表视图。表头里每列都带一个迷你分布图，一眼就能看出这一列的形态。点击表头排序，打开数值热力着色，数字大小会变成颜色深浅，再配合搜索和分页，可以快速定位到关心的行。',
    min: 18,
    async run(page, h) {
      await h.click('.nav-item[data-view="table"]');
      await h.wait(800);
      await h.type('#table-search', 'East');
      await h.wait(2400);
      await h.clear('#table-search');
      await h.wait(600);
      await h.click('#view-table th[data-col="revenue"]');
      await h.wait(600);
      await h.click('#view-table th[data-col="revenue"]');
      await h.wait(500);
      await h.click('#btn-heat');
      await h.wait(2600);
    },
  },
  {
    id: 'column',
    caption: '列菜单：统计信息 + 一键生成 pandas 步骤',
    narration: '每一列的菜单里都带着这一列的统计信息：计数、缺失、均值、标准差、四分位距，同时这里的每个动作都会变成流水线里的一个 pandas 步骤，比如按这一列筛选、填充缺失值、分箱或者转换类型。',
    min: 16,
    async run(page, h) {
      await h.wait(400);
      await h.click('#view-table th[data-col="profit"] .th-menu button');
      await h.wait(3200);
      await h.menuHover(4);
      await h.wait(900);
      await h.clickMenu(2);
      await h.wait(1100);
      await h.click('#view-table th[data-col="satisfaction"] .th-menu button');
      await h.wait(2000);
      await h.clickMenu(5);
      await h.wait(1600);
      await h.click('#btn-undo');
      await h.wait(900);
    },
  },
  {
    id: 'profile',
    caption: '统计剖析：describe() · 列字典 · 列画像 · 质量评分',
    narration: '统计剖析视图给出数据概览和质量评分，下面是 pandas 的 describe 统计表，count、mean、std、四分位、偏度、峰度都在这里，并且和 pandas 输出逐项一致。再往下是列字典和每一列的画像卡片，可以直接跳到对应的图形。',
    min: 20,
    async run(page, h) {
      await h.click('.nav-item[data-view="profile"]');
      await h.wait(3000);
      await h.scrollMain(380);
      await h.wait(2400);
      await h.scrollMain(440);
      await h.wait(2800);
      await h.scrollMain(440);
      await h.wait(2000);
      await h.scrollMain(-1000);
      await h.wait(800);
    },
  },
  {
    id: 'missing',
    caption: '缺失值工具箱：缺失矩阵 · 缺失条形图 · 缺失相关性',
    narration: '数据质量往往是分析里最花时间的一环，所以缺失值被做成了专门的图形。载入空气质量数据，缺失矩阵的行按缺失多少排序，一眼看出哪些行最不完整；切到条形图看各列的缺失比例，或者用相关性视图看两列的缺失是否同时发生。',
    min: 21,
    async run(page, h) {
      await h.click('.nav-item[data-view="load"]');
      await h.wait(500);
      await h.click('[data-ds="airquality"]');
      await h.wait(1900);
      await h.click('.nav-item[data-view="visualize"]');
      await h.wait(2400);
      await h.setChart('missing', { mode: 'bar' });
      await h.wait(2600);
      await h.setChart('missing', { mode: 'heat' });
      await h.wait(2600);
      await h.setChart('missing', { mode: 'matrix' });
      await h.wait(1800);
    },
  },
  {
    id: 'pipeline',
    caption: '操作流水线：每一步都显示输出行数与变化量',
    narration: '接下来是核心功能：操作流水线。左边是全部二十三种 pandas 操作，点击就追加进来。这里加一个筛选，只保留 East 和 West 两个地区，行数立刻从一千二百降到六百；再加一个计算列，算利润率；然后按地区和品类分组聚合；最后按收入排序。每一步都实时显示输出行数和变化量，可以拖动调整顺序、停用或者复制。',
    min: 32,
    async run(page, h) {
      await h.click('.nav-item[data-view="load"]');
      await h.wait(500);
      await h.click('[data-ds="sales"]');
      await h.wait(1500);
      await h.click('.nav-item[data-view="pipeline"]');
      await h.wait(900);
      // 1. filter: region is one of East, West
      await h.click('[data-add-op="filter"]');
      await h.wait(800);
      await h.select('.step .cond-row select[data-cp="column"]', 'region');
      await h.wait(500);
      await h.select('.step .cond-row select[data-cp="op"]', 'in');
      await h.wait(400);
      await h.click('.step .cond-row input[data-cp="value"]');
      await h.type('.step .cond-row input[data-cp="value"]', 'East,West', { delay: 45 });
      await h.wait(1800);
      // 2. computed column: margin = profit / revenue
      await h.click('[data-add-op="assign"]');
      await h.wait(800);
      await h.clear('.step:nth-of-type(2) .field[data-field-name="name"] input');
      await h.type('.step:nth-of-type(2) .field[data-field-name="name"] input', 'margin');
      await h.clear('.step:nth-of-type(2) textarea[data-p="expr"]');
      await h.type('.step:nth-of-type(2) textarea[data-p="expr"]', 'profit / revenue', { delay: 40 });
      await h.wait(1600);
      await h.collapseStep(2);
      // 3. group & aggregate: by region + category, sum of revenue and profit
      await h.click('[data-add-op="groupAgg"]');
      await h.wait(900);
      await h.setMulti('by', ['region', 'category'], 3);
      await h.setMulti('valueCols', ['revenue', 'profit'], 3);
      await h.setMulti('funcs', ['sum'], 3);
      await h.wait(1600);
      await h.collapseStep(3);
      // 4. sort by the aggregated revenue
      await h.click('[data-add-op="sort"]');
      await h.wait(900);
      await h.setMulti('by', ['revenue_sum'], 4);
      await h.wait(1400);
      await h.collapseStep(4);
      await h.wait(400);
      await h.scrollMain(240);
      await h.wait(2200);
    },
  },
  {
    id: 'code',
    caption: '自动生成可直接运行的 pandas 代码',
    narration: '刚才用鼠标搭出来的流程，一键就能变成真正能跑的 pandas 脚本：先用 isin 做筛选，再用 assign 计算利润率，然后 groupby 加 agg 分组聚合，最后 sort_values 排序。这段代码已经用真实的 pandas 逐值比对过，形状、列名和数值完全一致，可以直接放进 Jupyter 运行。',
    min: 21,
    async run(page, h) {
      await h.click('.nav-item[data-view="code"]');
      await h.wait(2600);
      await h.scrollCode(340);
      await h.wait(2600);
      await h.scrollCode(-340);
      await h.wait(1400);
    },
  },
  {
    id: 'charts',
    caption: '图形分析：直方图 · 散点图 + 最小二乘 · 相关热力图下钻',
    narration: '图形分析是理解数据最快的方式。先清空流水线，回到完整数据。直方图自动选择箱数并叠加密度曲线；散点图会做最小二乘拟合，直接给出斜率和 R 方，量化两个变量关系的强弱；相关性热力图把整个相关系数矩阵变成色块，点击任意一个色块就能下钻到这一对变量的散点图，这是从整体到细节最自然的一条路径。',
    min: 24,
    async run(page, h) {
      await h.click('.nav-item[data-view="pipeline"]');
      await h.wait(900);
      await h.click('#btn-clear-pipeline');
      await h.wait(1200);
      await h.click('.nav-item[data-view="visualize"]');
      await h.wait(1200);
      await h.setChart('histogram', {});
      await h.wait(2600);
      await h.setChart('scatter', {});
      await h.wait(3000);
      await h.setChart('corr', {});
      await h.wait(2400);
      await h.clickHeatmapCell(4, 5);
      await h.wait(3000);
    },
  },
  {
    id: 'charts2',
    caption: '箱线图 · 透视热力图 · 散点矩阵 · 平行坐标 · 矩形树图',
    narration: '还有更多图形：箱线图按品类比较分布并标出离群点；透视热力图把两个分类维度和一个指标画成色块；散点矩阵一次看完所有两两关系；平行坐标同时比较多维指标；矩形树图用面积表达构成。每种图形都写明了适用场景，并自动给出一句基于数据的洞察。',
    min: 21,
    async run(page, h) {
      await h.setChart('box', {});
      await h.wait(2600);
      await h.setChart('heatmap', {});
      await h.wait(2600);
      await h.setChart('scatterMatrix', {});
      await h.wait(3000);
      await h.setChart('parallel', {});
      await h.wait(2200);
      await h.setChart('treemap', {});
      await h.wait(2200);
    },
  },
  {
    id: 'bilingual',
    caption: '中英双语内容一致 · 深色模式',
    narration: '网站支持中英文切换，两种语言的内容完全一致：界面、提示、图形参数、自动洞察，连生成的代码注释都会跟着切换。再加上深色模式，长时间做分析会舒服一些。',
    min: 15,
    async run(page, h) {
      await h.click('#lang-switch [data-lang="en"]');
      await h.wait(2200);
      await h.setChart('bar', {});
      await h.wait(2200);
      await h.click('#btn-theme');
      await h.wait(2400);
      await h.setChart('scatter', {});
      await h.wait(2200);
      await h.click('#btn-theme');
      await h.wait(1000);
      await h.click('#lang-switch [data-lang="zh"]');
      await h.wait(1400);
    },
  },
  {
    id: 'export',
    caption: '导出 CSV / JSON / pandas 脚本 / 分析报告 / 图片',
    narration: '最后是导出。当前视图可以导出 CSV 和 JSON，流水线可以导出成 pandas 脚本或者 JSON 定义，还能一键生成 Markdown 分析报告，里面包含数据规模、处理步骤、描述统计、缺失值清单和相关性排名。整个工具不用安装、不用服务器，打开网页就能用。',
    min: 20,
    async run(page, h) {
      await h.wait(400);
      await h.evaluate(() => window.__pandalens.setView('profile'));
      await h.wait(1200);
      await h.click('#btn-export');
      await h.wait(2600);
      await h.menuHover(7);
      await h.wait(900);
      await h.evaluate(() => window.UI.closeMenu());
      await h.wait(600);
      await h.click('.nav-item[data-view="visualize"]');
      await h.wait(1800);
      await h.click('#btn-chart-png');
      await h.wait(2000);
      await h.evaluate(() => window.__pandalens.setView('table'));
      await h.wait(2200);
    },
  },
  {
    id: 'outro',
    caption: '在线地址见提交说明 · 全部计算在浏览器本地完成',
    narration: '以上就是 PandaLens 的关键亮点：二十三种 pandas 操作可视化搭建，十二类分析图形，自动生成的 pandas 代码，统计结果与 pandas 逐项一致，中英双语，全部在浏览器本地运行。在线地址和完整源代码都在提交内容里，谢谢观看。',
    min: 17,
    async run(page, h) {
      await h.evaluate(() => {
        window.__pandalens.state.pipeline = [];
        window.__pandalens.recompute();
        window.__pandalens.setView('visualize');
        window.__pandalens.switchChart('histogram', {});
      });
      await h.wait(2200);
      await h.evaluate(() => window.__pandalens.switchChart('corr', {}));
      await h.wait(2600);
      await h.evaluate(() => window.__pandalens.switchChart('bar', {}));
      await h.wait(2600);
    },
  },
];

/* ---------------------------------------------------------------- driver */
(async () => {
  const only = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];
  const wanted = only ? new Set(only.split(',').map(Number)) : null;
  const skipFinal = process.argv.includes('--nofinal');
  const dry = process.argv.includes('--dry');

  try { fs.rmSync(WORK, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) { log('work folder busy, reusing it'); }
  fs.mkdirSync(FRAME_DIR, { recursive: true });
  fs.mkdirSync(AUDIO_DIR, { recursive: true });

  // ---- narration first, so every scene can be paced against its voice-over
  const plan = [];
  for (let i = 0; i < SCENES.length; i++) {
    const s = SCENES[i];
    if (wanted && !wanted.has(i)) continue;
    const wav = path.join(AUDIO_DIR, `n${String(i).padStart(2, '0')}_${s.id}.wav`);
    if (!fs.existsSync(wav)) tts(s.narration, wav);
    const d = mediaDuration(wav);
    plan.push(Object.assign({}, s, { index: i, wav, voice: d, target: Math.max(d + 0.9, s.min || 0) }));
    log(`scene ${String(i).padStart(2)} ${s.id.padEnd(10)} narration ${d.toFixed(1)}s -> ${Math.max(d + 0.9, s.min || 0).toFixed(1)}s`);
  }
  const planned = plan.reduce((a, s) => a + s.target, 0);
  log(`planned length ${Math.floor(planned / 60)}m ${(planned % 60).toFixed(1)}s`);
  if (dry) return;
  if (planned > 300) log('WARNING: planned length exceeds 5 minutes');

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--force-device-scale-factor=1',
      `--window-size=${CAPTURE.width},${CAPTURE.height}`],
    defaultViewport: { width: CAPTURE.width, height: CAPTURE.height },
    protocolTimeout: 300000,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction('window.__pandalens && window.__pandalens.state.frame', { timeout: 40000 });
  await page.evaluate(() => {
    localStorage.setItem('pandalens.lang', 'zh');
    localStorage.setItem('pandalens.theme', 'light');
  });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction('window.__pandalens && window.__pandalens.state.frame', { timeout: 40000 });
  // The app uses CSS smooth scrolling, which makes Puppeteer's scroll-into-view
  // animate — clicks would then land where the element *was*. Explicit
  // scrollBy({behavior:'smooth'}) calls in the scene scripts still animate.
  await page.addStyleTag({ content: '* { scroll-behavior: auto !important; }' });
  await sleep(1500);

  // ---- frame capture via CDP screencast (a frame whenever the page changes)
  const frameList = [];
  const client = await page.target().createCDPSession();
  client.on('Page.screencastFrame', async (f) => {
    const file = `f${String(frameList.length).padStart(5, '0')}.jpg`;
    try { fs.writeFileSync(path.join(FRAME_DIR, file), Buffer.from(f.data, 'base64')); } catch (e) { /* disk */ }
    // metadata.timestamp has sub-millisecond resolution; Date.now() batches
    // frames into the same millisecond and would stretch the timeline
    frameList.push({ file, cdp: f.metadata && f.metadata.timestamp ? f.metadata.timestamp * 1000 : null, wall: Date.now() });
    try { await client.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (e) { /* closed */ }
  });
  await client.send('Page.startScreencast', {
    format: 'jpeg', quality: 62, maxWidth: CAPTURE.width, maxHeight: CAPTURE.height, everyNthFrame: 1,
  });

  // ---- helpers the scene scripts use to drive the real UI
  const helpers = {
    page,
    wait: (ms) => sleep(ms),
    /** Chrome's native <datalist> popup swallows the next trusted click, so we
     *  dismiss any popup (Escape blurs the field) before interacting. */
    async settle() {
      await page.keyboard.press('Escape').catch(() => {});
      await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
      await sleep(80);
    },
    async click(sel) {
      await page.waitForSelector(sel, { timeout: 20000 });
      await helpers.settle();
      const before = sel.includes('data-add-op') ? await page.evaluate(() => document.querySelectorAll('.step').length) : null;
      await page.click(sel);
      if (before !== null) {
        await sleep(250);
        const after = await page.evaluate(() => document.querySelectorAll('.step').length);
        if (after === before) {
          // the trusted click was swallowed — fall back to a DOM click
          await page.evaluate((s) => document.querySelector(s).click(), sel);
        }
      }
    },
    async type(sel, text) {
      await page.waitForSelector(sel, { timeout: 20000 });
      await helpers.settle();
      await page.click(sel);
      await page.type(sel, text, { delay: 60 });
    },
    async clear(sel) {
      await page.waitForSelector(sel, { timeout: 20000 });
      await helpers.settle();
      await page.click(sel, { clickCount: 3 });
      await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
    },
    async select(sel, value) { await page.waitForSelector(sel, { timeout: 20000 }); await page.select(sel, value); },
    async evaluate(fn) { return page.evaluate(fn); },
    async moveTo(sel) {
      const box = await page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await page.mouse.move(box.x, box.y, { steps: 14 });
    },
    async scrollMain(dy) {
      await page.evaluate((d) => { document.getElementById('main').scrollBy({ top: d, behavior: 'smooth' }); }, dy);
      await sleep(750);
    },
    async scrollCode(dy) {
      await page.evaluate((d) => { const el = document.getElementById('code-block'); if (el) el.scrollBy({ top: d, behavior: 'smooth' }); }, dy);
      await sleep(750);
    },
    async collapseStep(n) {
      await page.evaluate((i) => {
        const el = document.querySelectorAll('.step')[i - 1];
        if (el) el.querySelector('.step-head').click();
      }, n);
      await sleep(450);
    },
    async setChart(type, params) {
      await page.evaluate((ty, ps) => window.__pandalens.switchChart(ty, ps), type, params);
      await sleep(450);
    },
    async clickHeatmapCell(i, j) {
      // ask ECharts where the data cell actually sits, then click it for real
      const pt = await page.evaluate((ci, cj) => {
        const host = document.getElementById('chart-host');
        if (!host) return null;
        const inst = window.echarts.getInstanceByDom(host.firstElementChild || host);
        if (!inst) return null;
        const px = inst.convertToPixel({ seriesIndex: 0 }, [ci, cj]);
        if (!px) return null;
        const rect = host.getBoundingClientRect();
        return { x: rect.x + px[0], y: rect.y + px[1] };
      }, i, j);
      if (!pt) return;
      await page.mouse.move(pt.x, pt.y, { steps: 10 });
      await sleep(350);
      await page.mouse.click(pt.x, pt.y);
    },
    /** Toggle entries in a multi-select list (columns, aggregation functions). */
    async setMulti(param, values, stepIndex) {
      const scope = stepIndex ? `.step:nth-of-type(${stepIndex})` : '.step';
      const field = `${scope} .field[data-field-name="${param}"]`;
      const clearBtn = await page.$(`${field} [data-multi-none="${param}"]`);
      if (clearBtn) { await clearBtn.click(); await sleep(400); }
      for (const v of values) {
        await page.waitForSelector(`${field} .colpick .item[data-value="${v}"]`, { timeout: 10000 });
        await page.click(`${field} .colpick .item[data-value="${v}"]`);
        await sleep(320);
      }
    },
    async menuHover(i) {
      const items = await page.$$('.menu .item');
      if (items[i]) { await items[i].hover(); await sleep(300); }
    },
    async clickMenu(i) {
      const items = await page.$$('.menu .item');
      if (items[i]) await items[i].click();
    },
  };

  // ---- record every scene
  const sceneMarks = [];
  for (const scene of plan) {
    log(`* recording ${scene.id}`);
    const started = Date.now();
    const firstFrame = frameList.length;
    try {
      await scene.run(page, helpers);
    } catch (e) {
      log(`  ! scene error: ${e.message}`);
      errors.push(`scene ${scene.id}: ${e.message}`);
    }
    const remaining = scene.target * 1000 - (Date.now() - started);
    if (remaining > 0) await sleep(remaining);
    sceneMarks.push({ id: scene.id, from: firstFrame, to: frameList.length, start: started, end: Date.now() });
    const st = await page.evaluate(() => {
      const s = window.__pandalens.state;
      return {
        view: s.view, ops: s.pipeline.map((x) => x.op).join('>'), chart: s.chart.type,
        rows: s.frame ? s.frame.nrows : 0, err: s.stepError ? s.stepError.message : '',
      };
    });
    if (st.err) errors.push(`scene ${scene.id}: pipeline step error — ${st.err}`);
    log(`  ${frameList.length - firstFrame} frames, ${((Date.now() - started) / 1000).toFixed(1)}s | view=${st.view} chart=${st.chart} rows=${st.rows} pipeline=[${st.ops}]${st.err ? ' STEP-ERROR: ' + st.err : ''}`);
  }
  try { await client.send('Page.stopScreencast'); } catch (e) { /* noop */ }
  await browser.close();

  // ---- frame timings: each frame lasts until the next one appears. CDP
  // timestamps are used where available so the total matches the recording time
  // exactly (which is what keeps the narration in sync).
  const endTime = sceneMarks.length ? sceneMarks[sceneMarks.length - 1].end : Date.now();
  const baseCdp = frameList.find((f) => f.cdp) ? frameList.find((f) => f.cdp).cdp : null;
  const baseWall = frameList.find((f) => f.cdp) ? frameList.find((f) => f.cdp).wall : null;
  const offset = baseCdp !== null ? baseWall - baseCdp : 0;
  frameList.forEach((f, i) => {
    f.t = f.cdp !== null ? f.cdp + offset : f.wall;
  });
  frameList.forEach((f, i) => {
    const next = i + 1 < frameList.length ? frameList[i + 1].t : endTime;
    f.duration = Math.max(0.001, (next - f.t) / 1000);
  });
  const videoSeconds = frameList.reduce((a, f) => a + f.duration, 0);
  log(`${frameList.length} frames covering ${videoSeconds.toFixed(1)}s; ${errors.length} errors`);
  errors.slice(0, 8).forEach((e) => log('  ! ' + e));
  if (!frameList.length) throw new Error('no frames captured');

  const lastFrame = frameList[frameList.length - 1].file;
  const listFile = path.join(WORK, 'frames.txt');
  fs.writeFileSync(listFile,
    frameList.map((f) => `file 'frames/${f.file}'${NL}duration ${f.duration.toFixed(4)}`).join(NL)
    + `${NL}file 'frames/${lastFrame}'${NL}`, 'utf8');

  // ---- narration padded to the length each scene actually took (exact sync)
  const leadIn = Math.max(0, (sceneMarks[0].start - frameList[0].t) / 1000);
  const audioParts = [];
  let cursor = 0;
  plan.forEach((s, i) => {
    const mark = sceneMarks.find((m) => m.id === s.id);
    const dur = mark ? (mark.end - mark.start) / 1000 : s.target;
    const out = path.join(AUDIO_DIR, `p${String(i).padStart(2, '0')}.wav`);
    run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', s.wav,
      '-af', `apad=whole_dur=${(dur + (i === 0 ? leadIn : 0)).toFixed(3)}`,
      '-c:a', 'pcm_s16le', '-ar', '44100', '-y', out]);
    audioParts.push(out);
    s.start = cursor + (i === 0 ? leadIn : 0);
    s.length = dur;
    cursor += dur + (i === 0 ? leadIn : 0);
  });
  log(`audio timeline ${cursor.toFixed(1)}s vs video ${videoSeconds.toFixed(1)}s`);

  const audioList = path.join(WORK, 'audio.txt');
  fs.writeFileSync(audioList, audioParts.map((f) => `file 'audio/${path.basename(f)}'`).join(NL), 'utf8');
  const narration = path.join(WORK, 'narration.wav');
  run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', audioList,
    '-c:a', 'pcm_s16le', '-ar', '44100', '-y', narration]);

  // ---- subtitles: shipped as .srt, plus an .ass for burning (an explicit
  //      PlayRes keeps the font size in real pixels — plain SRTs get scaled by
  //      libass against a 384x288 canvas and come out far too large)
  const srt = plan.map((s, i) => {
    const from = fmtTime(s.start + 0.15);
    const to = fmtTime(Math.max(s.start + 1.2, s.start + s.voice + 0.5));
    return `${i + 1}${NL}${from} --> ${to}${NL}${s.caption}${NL}`;
  }).join(NL);
  fs.writeFileSync(path.join(OUT_DIR, 'PandaLens-demo.zh.srt'), srt, 'utf8');

  const assTime = (t) => {
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const sec = t % 60;
    return `${h}:${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`;
  };
  const ass = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${CAPTURE.width}`,
    `PlayResY: ${CAPTURE.height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Cap,Microsoft YaHei,30,&H00FFFFFF,&H000000FF,&H73000000,&H73000000,0,0,0,0,100,100,0.4,0,3,1,0,2,90,90,42,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...plan.map((s) => `Dialogue: 0,${assTime(s.start + 0.15)},${assTime(Math.max(s.start + 1.2, s.start + s.voice + 0.5))},Cap,,0,0,0,,${s.caption}`),
    '',
  ].join(NL);
  fs.writeFileSync(path.join(WORK, 'subs.ass'), ass, 'utf8');

  if (!skipFinal) {
    const outFile = path.join(OUT_DIR, 'PandaLens-demo.mp4');
    log('encoding...');
    run(FFMPEG, ['-hide_banner', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', 'frames.txt',
      '-i', 'narration.wav',
      '-vsync', 'cfr', '-r', '30',
      '-vf', 'subtitles=subs.ass:fontsdir=.',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-shortest',
      '-movflags', '+faststart', '-y', outFile], { cwd: WORK });
    const size = fs.statSync(outFile).size / 1048576;
    log(`wrote video/PandaLens-demo.mp4 - ${size.toFixed(1)} MB, ${mediaDuration(outFile).toFixed(1)}s`);
  }

  if (!process.argv.includes('--keep')) {
    try { fs.rmSync(FRAME_DIR, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { /* ignore */ }
  }
  log('done');
})().catch((e) => {
  console.error('recording failed:', e.message);
  process.exit(1);
});
