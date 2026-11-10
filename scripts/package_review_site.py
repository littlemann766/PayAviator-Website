#!/usr/bin/env python3
"""Copy the public site into a folder that opens from a ZIP or file:// URL.

The hosted pages keep cache-busting query strings (?v=...) and a few
site-root links (/app/..., /account). GitHub Pages resolves both. Some ZIP
viewers and file:// browsers do not: the query is treated as part of the
filename, the stylesheet never loads, and an inline SVG with no size paints
as a large black shape. This script fixes that in the copy only.
"""
import os
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP = {'.git', 'shots', 'node_modules', '__pycache__'}
LOCAL_ATTR = re.compile(r'(?P<attr>href|src|srcset)=(?P<q>["\'])(?P<val>[^"\']+)(?P=q)')


def rewrite_one(url, page_rel):
    if url.startswith(('http://', 'https://', 'mailto:', 'tel:', 'data:', 'javascript:')):
        return url
    path, sep, frag = url.partition('#')
    path, qsep, _query = path.partition('?')
    if not path:
        return '#' + frag if frag else url
    if path.startswith('/'):
        path = path[1:]
        if path == '' or path.endswith('/'):
            path = (path + 'index.html') if path else 'index.html'
        elif not Path(path).suffix:
            # /account is the directory page
            path = path + '/index.html' if (ROOT / path / 'index.html').is_file() else path + '.html'
        source = Path(page_rel).parent
        rel = os.path.relpath(path, start=str(source) if str(source) != '.' else '')
        path = Path(rel).as_posix()
    else:
        path = path
    if frag:
        return path + '#' + frag
    return path


def rewrite_html(text, page_rel):
    def repl(m):
        val = m.group('val')
        if m.group('attr') == 'srcset':
            parts = []
            for piece in val.split(','):
                bit = piece.strip()
                if not bit:
                    continue
                url, _, rest = bit.partition(' ')
                url = rewrite_one(url, page_rel)
                parts.append(url if not rest else url + ' ' + rest)
            val = ', '.join(parts)
        else:
            val = rewrite_one(val, page_rel)
        return f"{m.group('attr')}={m.group('q')}{val}{m.group('q')}"
    return LOCAL_ATTR.sub(repl, text)


def copy_site(dest: Path):
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP and not d.startswith('.')]
        rel_dir = Path(dirpath).relative_to(ROOT)
        if str(rel_dir) == 'scripts' or str(rel_dir).startswith('tests'):
            continue
        for name in filenames:
            src = Path(dirpath) / name
            rel = src.relative_to(ROOT)
            if src.suffix.lower() not in {'.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.xml', '.txt', '.ico', '.json', '.webmanifest'}:
                if name not in {'CNAME', 'robots.txt', 'sitemap.xml'}:
                    continue
            target = dest / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            if src.suffix.lower() == '.html':
                target.write_text(rewrite_html(src.read_text(encoding='utf-8'), rel.as_posix()), encoding='utf-8')
            else:
                shutil.copy2(src, target)
    return dest


def main():
    dest = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/payaviator-offline-site')
    copy_site(dest)
    print(dest)


if __name__ == '__main__':
    main()
