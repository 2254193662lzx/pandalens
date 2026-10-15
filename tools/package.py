# -*- coding: utf-8 -*-
"""
package.py — builds the submission archives.

    python tools/package.py

Produces
  dist/PandaLens-source.zip          website source code only
                                     (index.html + css/ + js/ + vendor/)
  dist/PandaLens-full-delivery.zip   everything: the full site (with datasets),
                                     tools, docs, the demo video and screenshots

The source archive deliberately excludes the datasets, the development tools and
the documents — they are not source code. vendor/ is the third-party runtime
(ECharts / PapaParse / SheetJS) and has to stay for the code to run.
"""
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "dist")

# the archive layout keeps the site in web/, the repository layout keeps it at the root
SITE_SRC = "web" if os.path.isfile(os.path.join(ROOT, "web", "index.html")) else "."

SKIP_DIRS = {"node_modules", "work", "tmp", ".git", "__pycache__", "check"}
SKIP_EXT = {".pyc"}
SKIP_FILES = {".cover.html", ".body.html"}

# website source code: the page, the styles, the scripts and the vendored runtime
CODE_PATHS = ["index.html", "css", "js", "vendor"]

FULL_TREES = [(SITE_SRC, "PandaLens/web"), ("video", "PandaLens/video"),
              ("tools", "PandaLens/tools"), ("docs", "PandaLens/docs")]


def add_dir(zf, src_dir, dest_prefix):
    added = 0
    for dirpath, dirnames, filenames in os.walk(src_dir):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in sorted(filenames):
            if name in SKIP_FILES or os.path.splitext(name)[1] in SKIP_EXT:
                continue
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, src_dir).replace("\\", "/")
            zf.write(full, dest_prefix + "/" + rel)
            added += 1
    return added


def build_source(zip_path):
    """Website source code only: no datasets, no tools, no documents."""
    total = 0
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for rel in CODE_PATHS:
            full = os.path.join(ROOT, SITE_SRC, rel)
            if os.path.isdir(full):
                n = add_dir(zf, full, "PandaLens/" + rel)
                print("  PandaLens/%-12s %3d files" % (rel + "/", n))
            else:
                n = 1 if os.path.isfile(full) else 0
                if n:
                    zf.write(full, "PandaLens/" + rel)
                    print("  PandaLens/%-12s %3d files" % (rel, n))
            total += n
    size = os.path.getsize(zip_path) / 1048576
    print("  => %s — %d files, %.2f MB\n" % (os.path.basename(zip_path), total, size))


def build_full(zip_path):
    total = 0
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for src, dest in FULL_TREES:
            src_dir = os.path.join(ROOT, src)
            if not os.path.isdir(src_dir):
                print("  (skip %s — not found)" % src)
                continue
            n = add_dir(zf, src_dir, dest)
            total += n
            print("  %-8s -> %-22s %4d files" % (src, dest, n))
        readme = os.path.join(ROOT, SITE_SRC, "README.md")
        if os.path.isfile(readme):
            zf.write(readme, "PandaLens/README.md")
            total += 1
    size = os.path.getsize(zip_path) / 1048576
    print("  => %s — %d files, %.2f MB\n" % (os.path.basename(zip_path), total, size))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    print("source archive (website code only):")
    build_source(os.path.join(OUT_DIR, "PandaLens-source.zip"))
    print("complete delivery archive (site + tools + docs + video + screenshots):")
    build_full(os.path.join(OUT_DIR, "PandaLens-full-delivery.zip"))


if __name__ == "__main__":
    main()
