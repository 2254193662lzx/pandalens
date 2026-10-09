# -*- coding: utf-8 -*-
"""
package.py — builds the submission archive.

    python tools/package.py

Produces dist/PandaLens-source.zip containing the website source, the tooling,
the documents, the screenshots and the demo video, and prints a summary.
"""
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "dist")
ZIP_PATH = os.path.join(OUT_DIR, "PandaLens-source.zip")

SKIP_DIRS = {"node_modules", "work", "tmp", ".git", "__pycache__"}
SKIP_EXT = {".pyc"}
SKIP_FILES = {".cover.html", ".body.html"}

# (source path relative to ROOT, destination folder inside the zip)
# archive layout: web/ + tools/; repository layout: site at the root with tools/ next to it
SITE_SRC = "web" if os.path.isdir(os.path.join(ROOT, "web")) else "."

TREES = [
    (SITE_SRC, "PandaLens/web"),
    ("tools", "PandaLens/tools"),
    ("docs", "PandaLens/docs"),
    ("video", "PandaLens/video"),
]

SINGLE = [
    ("README.md", "PandaLens/README.md"),
]


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
    return added


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    total = 0
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for src, dest in TREES:
            src_dir = os.path.join(ROOT, src)
            if os.path.isdir(src_dir):
                n = add_tree(zf, src_dir, dest)
                total += n
                print("  %-8s -> %-24s %4d files" % (src, dest, n))
        for src, dest in SINGLE:
            full = os.path.join(ROOT, src)
            if os.path.isfile(full):
                zf.write(full, dest)
                total += 1
                print("  %-8s -> %s" % (src, dest))
    size = os.path.getsize(ZIP_PATH) / 1048576
    print("\nwrote %s — %d files, %.1f MB" % (ZIP_PATH, total, size))


if __name__ == "__main__":
    main()
