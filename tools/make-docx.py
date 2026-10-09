# -*- coding: utf-8 -*-
"""
make-docx.py — builds the Word version of the highlights document from the same
Markdown source used for the PDF, so the two can never disagree.

    python tools/make-docx.py docs/PandaLens-亮点说明.md docs/PandaLens-亮点说明.docx
"""
import re
import sys
from datetime import date

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

BODY_FONT = "微软雅黑"
MONO_FONT = "Consolas"
ACCENT = RGBColor(0x1D, 0x4E, 0xD8)
DARK = RGBColor(0x12, 0x23, 0x3F)
MUTED = RGBColor(0x6B, 0x76, 0x88)


# --------------------------------------------------------------------- helpers
def set_font(run, name=BODY_FONT, size=10.5, bold=False, color=None, mono=False):
    run.font.name = MONO_FONT if mono else name
    run.font.size = Pt(size)
    run.bold = bold
    if color is not None:
        run.font.color.rgb = color
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    latin = MONO_FONT if mono else name
    rfonts.set(qn("w:ascii"), latin)
    rfonts.set(qn("w:hAnsi"), latin)
    rfonts.set(qn("w:eastAsia"), name)


def shade(element, fill):
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    element.append(shd)


def paragraph_border(p, color="D8E2F3", size=6, side="bottom"):
    ppr = p._p.get_or_add_pPr()
    borders = OxmlElement("w:pBdr")
    b = OxmlElement("w:" + side)
    b.set(qn("w:val"), "single")
    b.set(qn("w:sz"), str(size))
    b.set(qn("w:space"), "4")
    b.set(qn("w:color"), color)
    borders.append(b)
    ppr.append(borders)


def add_field(paragraph, instr):
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr_el = OxmlElement("w:instrText")
    instr_el.set(qn("xml:space"), "preserve")
    instr_el.text = instr
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._element.append(begin)
    run._element.append(instr_el)
    run._element.append(end)
    return run


def keep_with_next(p):
    p.paragraph_format.keep_with_next = True


# ------------------------------------------------------------------ md parsing
def inline_runs(text):
    """Split **bold**, `code` and [links](url) into (text, kind) tuples."""
    out = []
    pattern = re.compile(r"(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))")
    pos = 0
    for m in pattern.finditer(text):
        if m.start() > pos:
            out.append((text[pos:m.start()], "plain"))
        tok = m.group(0)
        if tok.startswith("`"):
            out.append((tok[1:-1], "code"))
        elif tok.startswith("**"):
            out.append((tok[2:-2], "bold"))
        else:
            out.append((re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", tok), "link"))
        pos = m.end()
    if pos < len(text):
        out.append((text[pos:], "plain"))
    return out


def parse_markdown(src):
    lines = src.replace("\r\n", "\n").split("\n")
    blocks, i = [], 0
    while i < len(lines):
        line = lines[i]
        if line.strip().startswith("```"):
            body = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                body.append(lines[i])
                i += 1
            i += 1
            blocks.append(("code", "\n".join(body)))
            continue
        if re.match(r"^---+\s*$", line.strip()):
            blocks.append(("hr", None))
            i += 1
            continue
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            blocks.append(("heading", (len(m.group(1)), m.group(2).strip())))
            i += 1
            continue
        if line.strip().startswith("|") and i + 1 < len(lines) and re.match(r"^\|[\s:|-]+\|$", lines[i + 1].strip()):
            split = lambda l: [c.strip() for c in l.strip().strip("|").split("|")]
            header = split(line)
            i += 2
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(split(lines[i]))
                i += 1
            blocks.append(("table", (header, rows)))
            continue
        if line.strip().startswith(">"):
            body = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                body.append(lines[i].strip().lstrip(">").strip())
                i += 1
            blocks.append(("quote", " ".join(body)))
            continue
        if re.match(r"^\s*([-*]|\d+\.)\s+", line):
            ordered = bool(re.match(r"^\s*\d+\.\s+", line))
            items = []
            while i < len(lines) and re.match(r"^\s*([-*]|\d+\.)\s+", lines[i]):
                items.append(re.sub(r"^\s*([-*]|\d+\.)\s+", "", lines[i]).strip())
                i += 1
            blocks.append(("list", (ordered, items)))
            continue
        if not line.strip():
            i += 1
            continue
        para = [line.strip()]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(
            r"^(#{1,6}\s|```|\||>|\s*([-*]|\d+\.)\s|---)", lines[i]
        ):
            para.append(lines[i].strip())
            i += 1
        blocks.append(("paragraph", " ".join(para)))
    return blocks


# ------------------------------------------------------------------- document
def build(md_path, out_path):
    src = open(md_path, encoding="utf-8").read()
    blocks = parse_markdown(src)
    title = re.search(r"^#\s+(.*)$", src, re.M).group(1)

    meta = []
    body_start = 0
    for idx, (kind, payload) in enumerate(blocks):
        if kind == "paragraph" and re.search(r"\*\*[^*]+[:：]?\*\*", payload):
            meta.append(payload)
            body_start = idx + 1
            continue
        if kind == "hr":
            body_start = idx + 1
            break
        if kind == "heading" and payload[0] >= 2:
            break

    doc = Document()

    # base styles
    normal = doc.styles["Normal"]
    normal.font.name = BODY_FONT
    normal.font.size = Pt(10.5)
    normal.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    normal.paragraph_format.line_spacing = 1.3
    normal.paragraph_format.space_after = Pt(6)
    rpr = normal.element.get_or_add_rPr()
    rfonts = OxmlElement("w:rFonts")
    rfonts.set(qn("w:eastAsia"), BODY_FONT)
    rpr.append(rfonts)

    for name, size in (("Heading 1", 15.5), ("Heading 2", 13), ("Heading 3", 11.5)):
        st = doc.styles[name]
        st.font.name = BODY_FONT
        st.font.size = Pt(size)
        st.font.bold = True
        st.font.color.rgb = DARK
        st.paragraph_format.space_before = Pt(14 if name != "Heading 1" else 6)
        st.paragraph_format.space_after = Pt(6)
        st.paragraph_format.keep_with_next = True

    sec = doc.sections[0]
    sec.page_width, sec.page_height = Cm(21), Cm(29.7)
    sec.left_margin = sec.right_margin = Cm(1.8)
    sec.top_margin = Cm(2.0)
    sec.bottom_margin = Cm(1.8)

    # ------------------------------------------------------------ cover page
    for _ in range(4):
        doc.add_paragraph()
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(title)
    set_font(r, size=36, bold=True, color=DARK)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("可视化 pandas 数据分析工作台 · 关键亮点说明")
    set_font(r, size=14, bold=True, color=ACCENT)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("A visual pandas workbench in the browser — highlights")
    set_font(r, size=10, color=MUTED)
    doc.add_paragraph()
    p = doc.add_paragraph()
    paragraph_border(p, color="3B6DF6", size=18)
    p.paragraph_format.space_after = Pt(18)

    for line in meta:
        m = re.match(r"\*\*([^*]+?)[:：]?\*\*\s*([\s\S]*)", line)
        if not m:
            continue
        label, value = m.group(1).rstrip("："), m.group(2).strip().replace("`", "")
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(4)
        r = p.add_run(label + "  ")
        set_font(r, size=10.5, bold=True, color=MUTED)
        r = p.add_run(value)
        set_font(r, size=10.5, color=DARK)

    doc.add_paragraph()
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("数据可视化课程项目 · " + date.today().isoformat())
    set_font(r, size=9, color=MUTED)

    # ------------------------------------------------------------------ body
    doc.add_section(WD_SECTION.NEW_PAGE)
    sec2 = doc.sections[-1]
    sec2.left_margin = sec2.right_margin = Cm(1.8)
    sec2.top_margin = Cm(2.0)
    sec2.bottom_margin = Cm(1.8)

    # table of contents field
    p = doc.add_paragraph()
    r = p.add_run("目录")
    set_font(r, size=14, bold=True, color=DARK)
    toc_p = doc.add_paragraph()
    add_field(toc_p, r'TOC \o "1-3" \h \z \u')
    note = doc.add_paragraph()
    r = note.add_run("（在 Word 中右键此处 → 更新域，即可生成页码）")
    set_font(r, size=8.5, color=MUTED)

    for kind, payload in blocks[body_start:]:
        if kind == "heading":
            level, text = payload
            doc.add_heading(re.sub(r"[`*]", "", text), level=min(3, max(1, level - 1)))
        elif kind == "paragraph":
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            for text, style in inline_runs(payload):
                r = p.add_run(text)
                if style == "code":
                    set_font(r, size=9.5, color=ACCENT, mono=True)
                elif style == "bold":
                    set_font(r, size=10.5, bold=True, color=DARK)
                elif style == "link":
                    set_font(r, size=10.5, color=ACCENT)
                else:
                    set_font(r, size=10.5)
        elif kind == "list":
            ordered, items = payload
            for n, item in enumerate(items, 1):
                p = doc.add_paragraph(style="List Number" if ordered else "List Bullet")
                p.paragraph_format.space_after = Pt(3)
                p.paragraph_format.line_spacing = 1.25
                for text, style in inline_runs(item):
                    r = p.add_run(text)
                    if style == "code":
                        set_font(r, size=9.5, color=ACCENT, mono=True)
                    elif style == "bold":
                        set_font(r, size=10.5, bold=True, color=DARK)
                    else:
                        set_font(r, size=10.5)
                if ordered:
                    p.text = p.text  # keep numbering intact
        elif kind == "quote":
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.5)
            p.paragraph_format.space_before = Pt(6)
            p.paragraph_format.space_after = Pt(8)
            shade(p._p.get_or_add_pPr(), "F4F8FF")
            for text, style in inline_runs(payload):
                r = p.add_run(text)
                set_font(r, size=10, bold=(style == "bold"), color=RGBColor(0x2B, 0x45, 0x70))
        elif kind == "code":
            tbl = doc.add_table(rows=1, cols=1)
            tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
            cell = tbl.cell(0, 0)
            shade(cell._tc.get_or_add_tcPr(), "0E1729")
            cell.text = ""
            first = True
            for code_line in payload.split("\n"):
                p = cell.paragraphs[0] if first else cell.add_paragraph()
                first = False
                p.paragraph_format.space_after = Pt(0)
                p.paragraph_format.line_spacing = 1.15
                r = p.add_run(code_line if code_line else " ")
                set_font(r, size=8.5, mono=True, color=RGBColor(0xDB, 0xE6, 0xF7))
            doc.add_paragraph().paragraph_format.space_after = Pt(4)
        elif kind == "table":
            header, rows = payload
            tbl = doc.add_table(rows=1, cols=len(header))
            tbl.style = "Table Grid"
            tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
            for j, htext in enumerate(header):
                cell = tbl.rows[0].cells[j]
                cell.text = ""
                p = cell.paragraphs[0]
                p.paragraph_format.space_after = Pt(2)
                for text, style in inline_runs(htext):
                    r = p.add_run(text)
                    set_font(r, size=9, bold=True, color=RGBColor(0x16, 0x30, 0x4F))
                shade(cell._tc.get_or_add_tcPr(), "F2F6FE")
            for row in rows:
                cells = tbl.add_row().cells
                for j, ctext in enumerate(row[:len(header)]):
                    cells[j].text = ""
                    p = cells[j].paragraphs[0]
                    p.paragraph_format.space_after = Pt(2)
                    for text, style in inline_runs(ctext):
                        r = p.add_run(text)
                        if style == "code":
                            set_font(r, size=8.5, color=ACCENT, mono=True)
                        elif style == "bold":
                            set_font(r, size=9, bold=True, color=DARK)
                        else:
                            set_font(r, size=9)
            for row in tbl.rows:
                trpr = row._tr.get_or_add_trPr()
                cant = OxmlElement("w:cantSplit")
                trpr.append(cant)
            hdr = tbl.rows[0]._tr.get_or_add_trPr()
            th = OxmlElement("w:tblHeader")
            hdr.append(th)
            doc.add_paragraph().paragraph_format.space_after = Pt(4)
        elif kind == "hr":
            p = doc.add_paragraph()
            paragraph_border(p, color="E6ECF7", size=6)
            p.paragraph_format.space_after = Pt(10)

    # ------------------------------------------------------------- footer page numbers
    footer = sec2.footer
    fp = footer.paragraphs[0] if footer.paragraphs else footer.add_paragraph()
    fp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    r = fp.add_run("PandaLens · 可视化 pandas 数据分析工作台    ")
    set_font(r, size=8.5, color=MUTED)
    add_field(fp, "PAGE")
    for run in fp.runs:
        if run.font.size is None:
            set_font(run, size=8.5, color=MUTED)

    doc.save(out_path)
    return len(blocks)


if __name__ == "__main__":
    n = build(sys.argv[1], sys.argv[2])
    print("wrote %s (%d markdown blocks)" % (sys.argv[2], n))
