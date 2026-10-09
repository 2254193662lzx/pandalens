# -*- coding: utf-8 -*-
"""
package.py — builds the submission archives.

    python tools/package.py

Produces
  dist/PandaLens-source.zip          the website source (site + tools + docs)
  dist/PandaLens-full-delivery.zip   the same plus the demo video and screenshots

Works in both layouts: the workshop layout (site in web/, tools/ next to it) and
the repository layout (site at the root, tools/ and docs/ beside it).
"""
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "dist")

# the archive layout keeps the site in web/, the repository layout keeps it at the root
SITE_SRC = "web" if os.path.isdir(os.path.join(ROOT, "web")) else "."

SKIP_DIRS = {"node_modules", "work", "tmp", ".git", "__pycache__", "check"}
SKIP_EXT = {".pyc"}
SKIP_FILES = {".cover.html", ".body.html"}

SOURCE_TREES = [(SITE_SRC, "PandaLens/web")]
EXTRA_TREES = [("video", "PandaLens/video")]


# some unzip tools ignore the UTF-8 filename flag, so the documents are also
# shipped under ASCII names
ASCII_ALIASES = {
    "PandaLens-亮点说明.md": "PandaLens-highlights.md",
    "PandaLens-亮点说明.pdf": "PandaLens-highlights.pdf",
    "PandaLens-亮点说明.docx": "PandaLens-highlights.docx",
    "提交说明-SUBMISSION.md": "SUBMISSION-notes.md",
}


def add_tree(zf, src_dir, dest_prefix):
    added = 0
    for dirpath, dirnames, filenames in os.walk(src_dir):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if name in SKIP_FILES or os.path.splitext(name)[1] in SKIP_EXT:
                continue
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, src_dir).replace("\\", "/")
            zf.write(full, dest_prefix + "/" + rel)
            added += 1
            if name in ASCII_ALIASES:
                zf.write(full, dest_prefix + "/" + ASCII_ALIASES[name])
                added += 1
    return added


def build(zip_path, trees):
    total = 0
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for src, dest in trees:
            src_dir = os.path.join(ROOT, src)
            if not os.path.isdir(src_dir):
                print("  (skip %s — not found)" % src)
                continue
            n = add_tree(zf, src_dir, dest)
            total += n
            print("  %-8s -> %-22s %4d files" % (src, dest, n))
        # standalone tools and documents, in case the site folder does not carry them
        for src, dest in (("tools", "PandaLens/tools"), ("docs", "PandaLens/docs")):
            src_dir = os.path.join(ROOT, src)
            if os.path.isdir(src_dir):
                n = add_tree(zf, src_dir, dest)
                total += n
                print("  %-8s -> %-22s %4d files" % (src, dest, n))
        readme = os.path.join(ROOT, SITE_SRC, "README.md")
        if os.path.isfile(readme):
            zf.write(readme, "PandaLens/README.md")
            total += 1
    size = os.path.getsize(zip_path) / 1048576
    print("  => %s — %d files, %.1f MB\n" % (os.path.basename(zip_path), total, size))
    return size


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    print("source archive:")
    build(os.path.join(OUT_DIR, "PandaLens-source.zip"), SOURCE_TREES)
    print("complete delivery archive (with the video and screenshots):")
    build(os.path.join(OUT_DIR, "PandaLens-full-delivery.zip"), SOURCE_TREES + EXTRA_TREES)


if __name__ == "__main__":
    main()
