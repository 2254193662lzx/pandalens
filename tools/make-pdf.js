/* =============================================================================
 * make-pdf.js — renders a Markdown document to a print-quality A4 PDF using
 * Chrome's print engine (excellent CJK typography, no LaTeX or pandoc needed).
 *
 * The cover is rendered separately with zero margins so its background bleeds to
 * the page edge, then merged with the paginated body through pdf-lib.
 *
 *   node tools/make-pdf.js docs/PandaLens-亮点说明.md docs/PandaLens-亮点说明.pdf
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { PDFDocument } = require('pdf-lib');
const { parseMarkdown, inlineHtml } = require('./md.js');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const [, , input, output] = process.argv;
const src = fs.readFileSync(input, 'utf8');
const blocks = parseMarkdown(src);

// The meta lines (URL / repo / video) between the title and the first rule become
// the cover's information block and are removed from the body.
const meta = [];
let bodyStart = 0;
for (let i = 0; i < blocks.length; i++) {
  const b = blocks[i];
  if (b.type === 'paragraph' && /\*\*[^*]+：?\*\*/.test(b.text)) { meta.push(b.text); bodyStart = i + 1; continue; }
  if (b.type === 'hr') { bodyStart = i + 1; break; }
  if (b.type === 'heading' && b.level >= 2) break;
}
const titleMatch = /^#\s+(.*)$/m.exec(src);
const title = titleMatch ? titleMatch[1] : 'Document';

function renderBlocks(list) {
  const out = [];
  for (const b of list) {
    switch (b.type) {
      case 'heading': out.push(`<h${Math.min(6, b.level)}>${inlineHtml(b.text)}</h${Math.min(6, b.level)}>`); break;
      case 'paragraph': out.push(`<p>${inlineHtml(b.text)}</p>`); break;
      case 'list':
        out.push(b.ordered
          ? `<ol>${b.items.map((t) => `<li>${inlineHtml(t)}</li>`).join('')}</ol>`
          : `<ul>${b.items.map((t) => `<li>${inlineHtml(t)}</li>`).join('')}</ul>`);
        break;
      case 'table': {
        const head = b.header.map((c) => `<th>${inlineHtml(c)}</th>`).join('');
        const rows = b.rows.map((r) => `<tr>${r.map((c) => `<td>${inlineHtml(c)}</td>`).join('')}</tr>`).join('');
        out.push(`<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`);
        break;
      }
      case 'code': out.push(`<pre><code>${inlineHtml(b.text)}</code></pre>`); break;
      case 'quote': out.push(`<blockquote>${inlineHtml(b.text)}</blockquote>`); break;
      case 'hr': out.push('<hr>'); break;
      default: break;
    }
  }
  return out.join('\n');
}

const coverMeta = meta.map((m) => {
  const mm = /\*\*([^*]+?)[:：]?\*\*\s*([\s\S]*)/.exec(m);
  if (!mm) return '';
  const label = mm[1].replace(/[:：]$/, '');
  const value = mm[2].trim().replace(/`/g, '');
  return `<div class="meta-row"><span class="meta-label">${inlineHtml(label)}</span><span class="meta-value">${inlineHtml(value)}</span></div>`;
}).join('');

const COVER_CSS = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; width: 210mm; height: 296.8mm; overflow: hidden;
         font-family: "Microsoft YaHei", "PingFang SC", "Source Han Sans SC", sans-serif; color: #fff; }
  .cover { width: 210mm; height: 296.8mm; padding: 46mm 24mm 0 24mm; position: relative;
           background: linear-gradient(158deg, #0d1728 0%, #152a4c 46%, #1d3f70 100%); }
  .mark { width: 60px; height: 60px; border-radius: 16px; margin-bottom: 26px;
          background: linear-gradient(135deg, #3b6df6, #7c4dff); display: flex; align-items: center; justify-content: center; }
  .mark svg { width: 36px; height: 36px; }
  h1 { font-size: 42pt; margin: 0 0 8px; letter-spacing: -0.5px; font-weight: 700; }
  .sub { font-size: 15pt; color: #a8c6ff; font-weight: 500; margin-bottom: 6px; }
  .sub2 { font-size: 10.5pt; color: #7e95b8; }
  .rule { width: 76px; height: 4px; border-radius: 2px; margin: 26px 0 20px;
          background: linear-gradient(90deg, #3b6df6, #7c4dff); }
  .tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
  .tag { border: 1px solid rgba(255,255,255,.26); border-radius: 999px; padding: 4px 12px;
         font-size: 9.5pt; color: #cfe0ff; }
  .meta { position: absolute; left: 24mm; right: 24mm; bottom: 30mm; }
  .meta-row { display: flex; gap: 10px; font-size: 9.5pt; padding: 5px 0;
              border-top: 1px solid rgba(255,255,255,.14); }
  .meta-row:last-child { border-bottom: 1px solid rgba(255,255,255,.14); }
  .meta-label { color: #8fa6c8; width: 78px; flex: none; }
  .meta-value { color: #eaf2ff; word-break: break-all; }
  .foot { position: absolute; left: 24mm; bottom: 16mm; font-size: 8.5pt; color: #6d84a6; }
`;

const BODY_CSS = `
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: "Microsoft YaHei", "PingFang SC", "Source Han Sans SC", sans-serif;
         font-size: 10.5pt; line-height: 1.7; color: #1a2233; margin: 0; }
  h2 { font-size: 15.5pt; margin: 4px 0 10px; padding-bottom: 6px; color: #12233f;
       border-bottom: 2px solid #e8eef9; page-break-after: avoid; }
  h3 { font-size: 12.5pt; margin: 15px 0 6px; color: #1d3355; page-break-after: avoid; }
  h4 { font-size: 11pt; margin: 12px 0 5px; color: #2b4a70; page-break-after: avoid; }
  p { margin: 0 0 9px; text-align: justify; }
  strong { font-weight: 700; color: #10233d; }
  code { font-family: Consolas, "Cascadia Mono", monospace; font-size: 9.5pt;
         background: #f1f5fd; color: #1d4ed8; padding: 1px 4px; border-radius: 3px; }
  pre { background: #0e1729; color: #dbe6f7; border-radius: 8px; padding: 11px 13px;
        font-size: 9pt; line-height: 1.6; margin: 8px 0 12px; page-break-inside: avoid;
        white-space: pre-wrap; word-break: break-word; }
  pre code { background: none; color: inherit; padding: 0; font-size: 9pt; }
  ul, ol { margin: 0 0 10px; padding-left: 22px; }
  li { margin-bottom: 4px; text-align: justify; }
  table { width: 100%; border-collapse: collapse; margin: 9px 0 14px; font-size: 9pt; page-break-inside: avoid; }
  th { background: #f2f6fe; color: #16304f; font-weight: 700; text-align: left; }
  th, td { border: 1px solid #dde5f2; padding: 5px 8px; vertical-align: top; word-break: break-word; }
  tbody tr:nth-child(even) td { background: #fafcff; }
  blockquote { margin: 10px 0; padding: 9px 14px; background: #f4f8ff; border-left: 3px solid #3b6df6;
               border-radius: 0 6px 6px 0; color: #2b4570; font-size: 10pt; }
  hr { border: 0; border-top: 1px solid #e6ecf7; margin: 18px 0; }
  a { color: #2563eb; text-decoration: none; word-break: break-all; }
`;

const coverHtml = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>${COVER_CSS}</style></head><body>
  <div class="cover">
    <div class="mark"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round">
      <path d="M4 19V12M9.3 19V5M14.6 19V9M20 19V3"/></svg></div>
    <h1>PandaLens</h1>
    <div class="sub">可视化 pandas 数据分析工作台 · 关键亮点说明</div>
    <div class="sub2">A visual pandas workbench in the browser — highlights</div>
    <div class="rule"></div>
    <div class="tags">
      <span class="tag">23 种 pandas 操作可视化搭建</span>
      <span class="tag">12 类分析图形</span>
      <span class="tag">自动生成可运行 pandas 代码</span>
      <span class="tag">620 项统计与 pandas 逐项比对</span>
      <span class="tag">中英双语</span>
      <span class="tag">纯前端 · 数据不出浏览器</span>
    </div>
    <div class="meta">${coverMeta}</div>
    <div class="foot">数据可视化课程项目 · ${new Date().toISOString().slice(0, 10)}</div>
  </div>
</body></html>`;

const bodyHtml = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>${BODY_CSS}</style></head>
<body>${renderBlocks(blocks.slice(bodyStart))}</body></html>`;

(async () => {
  const dir = path.dirname(output);
  const coverFile = path.join(dir, '.cover.html');
  const bodyFile = path.join(dir, '.body.html');
  fs.writeFileSync(coverFile, coverHtml, 'utf8');
  fs.writeFileSync(bodyFile, bodyHtml, 'utf8');

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();

  await page.goto('file:///' + coverFile.replace(/\\/g, '/'), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const coverPdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });

  await page.goto('file:///' + bodyFile.replace(/\\/g, '/'), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const bodyPdf = await page.pdf({
    format: 'A4', printBackground: true,
    displayHeaderFooter: true,
    margin: { top: '19mm', bottom: '17mm', left: '18mm', right: '18mm' },
    headerTemplate: '<div></div>',
    footerTemplate: `<div style="width:100%;font-family:'Microsoft YaHei',sans-serif;font-size:8pt;color:#94a3b8;padding:0 18mm;display:flex;justify-content:space-between"><span>PandaLens · 可视化 pandas 数据分析工作台</span><span class="pageNumber"></span></div>`,
  });
  await browser.close();

  const merged = await PDFDocument.create();
  const coverDoc = await PDFDocument.load(coverPdf);
  const bodyDoc = await PDFDocument.load(bodyPdf);
  for (const p of await merged.copyPages(coverDoc, coverDoc.getPageIndices())) merged.addPage(p);
  for (const p of await merged.copyPages(bodyDoc, bodyDoc.getPageIndices())) merged.addPage(p);
  merged.setTitle(title);
  merged.setAuthor('PandaLens');
  merged.setSubject('可视化 pandas 数据分析工作台 · 关键亮点说明');
  fs.writeFileSync(output, await merged.save());

  // keep the intermediate HTML when asked, so tools/preview.js can render
  // readable page images of exactly the same markup
  if (!process.argv.includes('--keep-html')) {
    fs.rmSync(coverFile, { force: true });
    fs.rmSync(bodyFile, { force: true });
  } else {
    console.log('kept ' + coverFile + ' and ' + bodyFile);
  }
  const size = fs.statSync(output).size / 1024;
  console.log(`wrote ${output} — ${merged.getPageCount()} pages, ${size.toFixed(0)} KB`);})().catch((e) => { console.error('pdf failed:', e.message); process.exit(1); });
