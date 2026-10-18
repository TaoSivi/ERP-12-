#!/usr/bin/env python3
"""
Build a single-file index.html for the LaoBooks ERP.
Inlines assets/css/styles.css + the 5 JS files into index_src.html.

Usage:  python build.py
Output: index.html  (upload THIS file to GitHub Pages / open directly)
"""
import os, sys

BASE = os.path.dirname(os.path.abspath(__file__))
JS_FILES = ["config.js", "store.js", "accounting.js", "ui.js", "app.js"]

def read(p):
    return open(p, encoding="utf-8").read().replace("\x00", "")

def main():
    html = read(os.path.join(BASE, "index_src.html"))
    css = read(os.path.join(BASE, "assets", "css", "styles.css"))

    # sanity: CSS braces must balance (a truncated styles.css breaks all buttons)
    if css.count("{") != css.count("}"):
        sys.exit("ERROR: styles.css brace mismatch { %d } %d — file likely truncated"
                 % (css.count("{"), css.count("}")))

    js = ""
    for f in JS_FILES:
        js += "\n/* ===== %s ===== */\n" % f + read(os.path.join(BASE, "assets", "js", f)) + "\n"

    html = html.replace(
        '<link rel="stylesheet" href="assets/css/styles.css" />',
        "<style>\n" + css + "\n</style>")

    tags = "".join('  <script src="assets/js/%s"></script>\n' % f for f in JS_FILES).rstrip("\n")
    html = html.replace(tags, "  <script>\n" + js + "\n  </script>")
    html = html.replace("\x00", "")

    out = os.path.join(BASE, "index.html")
    open(out, "w", encoding="utf-8").write(html)
    print("Built %s  (%d bytes)" % (out, len(html)))

if __name__ == "__main__":
    main()
