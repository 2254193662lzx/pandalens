/* =============================================================================
 * md.js — a very small Markdown subset parser used by the document builders.
 *
 * Supports: # headings, paragraphs, - / 1. lists, | tables |, ``` code fences,
 * --- rules, **bold**, `code`, [text](url) and > quotes. That is exactly the
 * subset used by the project documents, and nothing more.
 *
 *   node tools/md.js docs/input.md docs/blocks.json
 * ========================================================================== */
const fs = require('fs');

function parseMarkdown(src) {
  const lines = String(src).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  const isTableSep = (l) => /^\|[\s:|-]+\|$/.test(l.trim());
  const splitRow = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

  while (i < lines.length) {
    const line = lines[i];

    // code fence
    if (/^```/.test(line.trim())) {
      const lang = line.trim().slice(3).trim();
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { body.push(lines[i]); i++; }
      i++;
      blocks.push({ type: 'code', lang, text: body.join('\n') });
      continue;
    }
    // horizontal rule
    if (/^---+\s*$/.test(line.trim())) { blocks.push({ type: 'hr' }); i++; continue; }
    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() }); i++; continue; }
    // table
    if (line.trim().startsWith('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(splitRow(lines[i])); i++; }
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    // blockquote
    if (line.trim().startsWith('>')) {
      const body = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) { body.push(lines[i].trim().replace(/^>\s?/, '')); i++; }
      blocks.push({ type: 'quote', text: body.join(' ') });
      continue;
    }
    // lists
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '').trim());
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    // blank
    if (!line.trim()) { i++; continue; }
    // paragraph (join wrapped lines)
    const para = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\||>|\s*([-*]|\d+\.)\s|---)/.test(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: 'paragraph', text: para.join(' ') });
  }
  return blocks;
}

/** Inline markup → safe HTML. */
function inlineHtml(s) {
  const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

/** Inline markup → {text, bold, code} runs for python-docx. */
function inlineRuns(s) {
  const runs = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) runs.push({ text: s.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith('`')) runs.push({ text: tok.slice(1, -1), code: true });
    else if (tok.startsWith('**')) runs.push({ text: tok.slice(2, -2), bold: true });
    else runs.push({ text: tok.replace(/\[([^\]]+)\]\(([^)]+)\)/, '$1'), link: true });
    last = m.index + tok.length;
  }
  if (last < s.length) runs.push({ text: s.slice(last) });
  return runs;
}

module.exports = { parseMarkdown, inlineHtml, inlineRuns };

if (require.main === module) {
  const [, , input, output] = process.argv;
  const blocks = parseMarkdown(fs.readFileSync(input, 'utf8'));
  fs.writeFileSync(output, JSON.stringify({ blocks, inlineRuns, inlineHtml }, null, 1), 'utf8');
  console.log(`parsed ${blocks.length} blocks -> ${output}`);
}
