#!/usr/bin/env python3
"""The hosted pages keep ?v= cache busters. The offline copy must not."""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from package_review_site import copy_site  # noqa: E402

DEST = Path('/tmp/payaviator-offline-site-test')


def main():
    fails = []
    hosted = (ROOT / 'index.html').read_text(encoding='utf-8')
    if 'assets/site.css?v=' not in hosted:
        fails.append('hosted home page lost its stylesheet cache buster')
    copy_site(DEST)
    htmls = list(DEST.rglob('*.html'))
    if not htmls:
        fails.append('offline copy has no html')
    for page in htmls:
        text = page.read_text(encoding='utf-8')
        for m in re.finditer(r'(?:href|src|srcset)=["\']([^"\']+)', text):
            url = m.group(1).split()[0]
            if url.startswith(('http://', 'https://', 'mailto:', 'data:', '#')):
                continue
            path = url.split('#', 1)[0]
            if '?' in path:
                fails.append(f'{page.name} still has a query on {url}')
                break
            if path.startswith('/'):
                fails.append(f'{page.name} still has a site-root link {url}')
                break
            target = (page.parent / path).resolve()
            if not target.is_file():
                fails.append(f'{page.relative_to(DEST)} missing {url}')
                break
    privacy = (DEST / 'privacy.html').read_text(encoding='utf-8')
    if 'fill="none"' not in privacy or 'width="22"' not in privacy:
        fails.append('offline privacy icons have no intrinsic size or fill')
    if not (DEST / 'assets' / 'site.css').is_file():
        fails.append('offline copy is missing site.css')
    if fails:
        print('\n'.join('FAIL ' + f for f in fails[:20]))
        return 1
    print(f'offline package ok ({len(htmls)} html files, query strings stripped, files present)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
