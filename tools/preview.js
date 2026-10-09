/* =============================================================================
 * preview.js — renders readable page images of the document HTML that make-pdf.js
 * produced, so the layout can be reviewed (and judged) page by page.
 *
 *   node tools/make-pdf.js <in.md> <out.pdf> --keep-html
 *   node tools/preview.js docs/.cover.html docs/.body.html docs/preview
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const A4 = { width: 794, height: 1123 };   // A4 at 96 dpi

const [, , coverFile, bodyFile, outDir] = process.argv;
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });

  // ---- cover: exactly one A4 page
  const c = await browser.newPage();
  await c.setViewport({ width: A4.width, height: A4.height, deviceScaleFactor: 2 });
  await c.goto('file:///' + path.resolve(coverFile).replace(/\\/g, '/'), { waitUntil: 'load' });
  await c.evaluate(() => document.fonts.ready);
  await c.screenshot({ path: path.join(outDir, 'page-01-cover.png') });

  // ---- body: mimic the print margins, then slice into page-height images
  const b = await browser.newPage();
  await b.setViewport({ width: A4.width, height: A4.height, deviceScaleFactor: 2 });
  await b.goto('file:///' + path.resolve(bodyFile).replace(/\\/g, '/'), { waitUntil: 'load' });
  await b.evaluate(() => {
    document.fonts.ready;
    document.body.style.padding = '19mm 18mm';
    document.body.style.width = '210mm';
  });
  await new Promise((r) => setTimeout(r, 500));
  const total = await b.evaluate(() => document.body.scrollHeight);
  const pages = Math.ceil(total / A4.height);
  for (let i = 0; i < pages; i++) {
    await b.screenshot({
      path: path.join(outDir, `page-${String(i + 2).padStart(2, '0')}.png`),
      clip: { x: 0, y: i * A4.height, width: A4.width, height: Math.min(A4.height, total - i * A4.height) },
      captureBeyondViewport: true,
    });
  }
  await browser.close();
  console.log(`wrote ${pages + 1} page images to ${outDir}`);
})().catch((e) => { console.error('preview failed:', e.message); process.exit(1); });
