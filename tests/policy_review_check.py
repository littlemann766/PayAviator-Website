#!/usr/bin/env python3
"""Static privacy/terms consistency checks for the PayAviator website.

No network. Fails if public copy drifts back to a known mismatch:
wrong domain, wrong Plus price, absolute "we don't share" / "only what the law
requires", the account-deletion link landing on the plan section, or the web
app deleting bank data before a recent sign-in.
"""
import os
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {'.git', 'shots', 'node_modules'}
TEXT_SUFFIXES = {'.html', '.js', '.xml', '.txt', '.md', '.css'}

fails = []


def fail(msg):
    fails.append(msg)
    print('  FAIL', msg)


def ok(msg):
    print('  ok  ', msg)


def read(rel):
    return (ROOT / rel).read_text(encoding='utf-8')


def walk_text_files():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith('.')]
        for name in filenames:
            path = Path(dirpath) / name
            if path.suffix.lower() in TEXT_SUFFIXES:
                yield path


class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []
        self.ids = set()

    def handle_starttag(self, tag, attrs):
        ad = dict(attrs)
        if tag == 'a' and ad.get('href'):
            self.links.append(ad['href'])
        if ad.get('id'):
            self.ids.add(ad['id'])


def local_target(href, src):
    if href.startswith(('mailto:', 'tel:', 'javascript:', 'data:')):
        return None
    if href.startswith('#'):
        return ('id', href[1:])
    url = href.split('#', 1)[0].split('?', 1)[0]
    if url.startswith(('http://', 'https://')):
        if 'payaviator.app' not in url and 'groups.google.com' not in url and 'play.google.com' not in url and 'plaid.com' not in url:
            return ('external', url)
        if url.startswith('https://payaviator.app'):
            url = url[len('https://payaviator.app'):] or '/'
        else:
            return None
    if not url or url == '/':
        rel = 'index.html' if not url or url == '/' else url
    else:
        rel = url[1:] if url.startswith('/') else str((Path(src).parent / url).as_posix())
    rel = os.path.normpath(rel)
    if rel.endswith('/'):
        rel += 'index.html'
    return ('file', rel)


def main():
    # Domain: this product is payaviator.app. payaviator.com is a different site.
    com_hits = []
    for path in walk_text_files():
        text = path.read_text(encoding='utf-8', errors='replace')
        if 'payaviator.com' in text.lower():
            com_hits.append(str(path.relative_to(ROOT)))
    if com_hits:
        fail('payaviator.com appears in ' + ', '.join(com_hits))
    else:
        ok('no payaviator.com in site text')

    banned = {
        'privacy.html': ["We don't sell or share", 'all of your data stored', 'to send bill reminders', 'sold through Google Play Billing', 'deleted 30 days later'],
        'faq.html': ['does not sell or share your personal information'],
        'delete-account.html': ['only what the law requires', 'We delete your account and data within 30 days', 'We aim to complete email requests within 30 days', 'href="/app/settings.html#plan">Delete it myself'],
        'terms.html': ['You can subscribe in the Android app through Google Play'],
        'pricing.html': ['there are no refunds for partial periods', 'first bank account is on us'],
        'index.html': ['first bank account is on us'],
        'app/js/pages/accounts.js': ['Plus is coming soon'],
        'assets/billing.js': ['first bank account is free'],
    }
    for rel, phrases in banned.items():
        text = read(rel)
        hit = [p for p in phrases if p in text]
        if hit:
            fail(f'{rel} still has: {hit}')
        else:
            ok(f'{rel} dropped superseded phrases')

    privacy = read('privacy.html')
    terms = read('terms.html')
    delete = read('delete-account.html')
    pricing = read('pricing.html')
    faq = read('faq.html')
    settings = read('app/js/pages/settings.js')
    auth = read('app/js/auth.js')

    if '2026-11a-draft' in privacy or 'not effective' in privacy.lower():
        fail('privacy still reads as an unpublished draft')
    elif 'Version:</strong> 2026-11a' not in privacy or 'November 9, 2026' not in privacy:
        fail('privacy is not version 2026-11a effective November 9, 2026')
    elif 'privacy-2026-10g.html' not in privacy or 'does not change the version stored on that phone' not in privacy:
        fail('privacy does not keep the 2026-10g archive or the old-install consent line')
    elif '420600' not in privacy:
        fail('privacy does not name the active closed-test version code')
    else:
        ok('privacy is 2026-11a and keeps 2026-10g for older installs')
    if 'Version:</strong> 2026-11a' not in terms or 'November 9, 2026' not in terms or 'terms-2026-10-15.html' not in terms:
        fail('terms are not 2026-11a with the October 15 archive link')
    elif 'not effective' in terms.lower() or '2026-11a-draft' in terms:
        fail('terms still read as an unpublished draft')
    else:
        ok('terms are 2026-11a and link the October 15 archive')
    if 'Version:</strong> 2026-11a' not in delete or 'privacy-2026-10g.html' not in delete:
        fail('delete-account page is not tied to 2026-11a and the archive')
    elif '2026-11a-draft' in delete or 'not effective' in delete.lower():
        fail('delete-account page still reads as an unpublished draft')
    else:
        ok('delete-account page is version 2026-11a')
    archived = read('privacy-2026-10g.html')
    old_terms = read('terms-2026-10-15.html')
    if 'Policy version:</strong> 2026-10g' not in archived or 'October 17, 2026' not in archived or 'id="archive-notice"' not in archived:
        fail('2026-10g archive is missing or was rewritten past recognition')
    elif 'kept for 30 days' not in archived:
        fail('2026-10g archive no longer contains the original cooldown sentence')
    else:
        ok('privacy 2026-10g archive preserves the published text')
    if 'October 15, 2026' not in old_terms or 'id="archive-notice"' not in old_terms:
        fail('October 15 terms archive is missing')
    else:
        ok('October 15 terms archive is present')

    for rel, text in (('privacy.html', privacy), ('terms.html', terms), ('faq.html', faq), ('pricing.html', pricing), ('assets/billing.js', read('assets/billing.js')), ('assets/subscribe.js', read('assets/subscribe.js'))):
        if '$3.99' not in text or '$29.99' not in text:
            fail(f'{rel} missing $3.99 and $29.99')
        else:
            ok(f'{rel} shows $3.99 and $29.99')

    # 29.99 vs 3.99*12 is 37% (rounded). Guard the published percentage.
    monthly, yearly = 3.99, 29.99
    pct = round((1 - yearly / (monthly * 12)) * 100)
    if pct != 37:
        fail(f'price math is {pct}%, not 37%')
    elif '37%' not in terms or '37%' not in faq:
        fail('terms or FAQ no longer say 37%')
    else:
        ok('37% yearly savings matches $3.99 x 12 vs $29.99')

    if 'C&R Digital' in privacy or 'C&R Digital' in terms or 'incorporated' in privacy.lower():
        fail('policy asserts an entity or incorporation that was not verified')
    else:
        ok('no unverified entity or incorporation claim')
    if re.search(r'arbitrat', privacy + terms, re.I):
        fail('arbitration language was added')
    else:
        ok('no arbitration clause added')
    if re.search(r'Ask PayAviator (can|will|answers|uses)', privacy + terms + faq, re.I):
        fail('Ask PayAviator described as a live feature')
    elif 'Ask PayAviator' in privacy and 'is not part of this draft' not in privacy:
        fail('Ask PayAviator mentioned without saying it is not in this draft')
    else:
        ok('Ask PayAviator is not disclosed as a live feature')

    for needle in (
        'does not cancel a PayAviator Plus subscription',
        'sign-in account is not deleted',
        'older than 90 days',
        'id="website-and-browser"',
        'payaviator.app/app/settings#delete-account',
        'do not include an advertising or analytics script',
        'does not start a Google Play purchase',
        'cloud project number is 0',
        'not used for bill reminders',
        'does not promise that the production setting is 30 days',
        'does not change the version stored on that phone',
    ):
        if needle not in privacy:
            fail('privacy missing: ' + needle)
        else:
            ok('privacy has: ' + needle)

    if 'href="/app/settings.html#plan">payaviator.app/account' in terms:
        fail('terms cancel link label still disagrees with its href')
    else:
        ok('terms cancel link label matches the plan page')
    if 'Deleting your PayAviator account does not cancel Plus' not in terms:
        fail('terms do not say account deletion is separate from cancellation')
    else:
        ok('terms separate deletion from cancellation')

    if 'href="/app/settings.html#delete-account"' not in delete:
        fail('delete-account page does not link to #delete-account')
    else:
        ok('delete-account page links to #delete-account')
    for needle in (
        'does not close the account at your bank',
        'Your PayAviator sign-in stays',
        'no separate server route for one account inside a connection',
        'The website has no disconnect button',
        'does not ask why',
        'do not have to cancel Plus first',
        'id="disconnect-a-bank"',
    ):
        if needle not in delete:
            fail('delete-account missing: ' + needle)
        else:
            ok('delete-account has: ' + needle)
    if 'does not cancel a Stripe or Google Play subscription' not in settings or 'do not have to cancel it first' not in settings or 'not asked why' not in settings:
        fail('web delete sheet still sounds like a required cancel or a reason')
    else:
        ok('web delete sheet is one confirmation, no reason, no forced cancel')
    if "id: 'delete-account'" not in settings:
        fail('settings page has no delete-account anchor')
    else:
        ok('settings has #delete-account')
    if settings.find('hasRecentLogin') > settings.find('deletePlaidUser') or 'hasRecentLogin' not in settings:
        fail('web deletion still calls deletePlaidUser before a recent-login check')
    else:
        ok('web deletion checks hasRecentLogin before deletePlaidUser')
    if '4 * 60 * 1000' not in auth or 'hasRecentLogin()' not in auth:
        fail('auth.hasRecentLogin is missing the 4-minute window')
    else:
        ok('auth.hasRecentLogin uses the 4-minute window')

    # Internal links on the pages this review edited.
    pages = [
        'index.html', 'privacy.html', 'terms.html', 'delete-account.html', 'pricing.html', 'review/index.html',
        'privacy-2026-10g.html', 'terms-2026-10-15.html',
        'faq.html', 'how-it-works.html', 'support.html', 'subscribe.html', 'account.html',
        'account/index.html', 'billing/success.html', 'billing/cancel.html', 'auth/action.html',
    ]
    missing = []
    for rel in pages:
        parser = LinkParser()
        parser.feed(read(rel))
        for href in parser.links:
            target = local_target(href, rel)
            if not target:
                continue
            kind, value = target
            if kind == 'external':
                missing.append(f'{rel} -> {value}')
            elif kind == 'file':
                dest = ROOT / value
                if not dest.is_file():
                    # extensionless GitHub Pages path: try .html
                    html = ROOT / (value + '.html')
                    index = ROOT / value / 'index.html'
                    if not html.is_file() and not index.is_file():
                        missing.append(f'{rel} -> {value}')
            elif kind == 'id' and value not in parser.ids:
                missing.append(f'{rel}#{value}')
    if missing:
        fail('broken or unexpected links: ' + '; '.join(missing[:12]))
    else:
        ok(f'internal links resolve on {len(pages)} pages')

    # Sitemap lastmod for pages this review changed.
    site = read('sitemap.xml')
    for loc in ('/', '/privacy.html', '/terms.html', '/delete-account.html', '/pricing.html', '/faq.html', '/how-it-works.html', '/support.html'):
        block = re.search(r'<loc>https://payaviator\.app' + re.escape(loc) + r'</loc><lastmod>([^<]+)</lastmod>', site)
        if not block or block.group(1) != '2026-11-09':
            fail(f'sitemap lastmod for {loc} is not 2026-11-09')
        else:
            ok(f'sitemap {loc} lastmod 2026-11-09')
    for loc, day in (('/privacy-2026-10g.html', '2026-10-17'), ('/terms-2026-10-15.html', '2026-10-15')):
        block = re.search(r'<loc>https://payaviator\.app' + re.escape(loc) + r'</loc><lastmod>([^<]+)</lastmod>', site)
        if not block or block.group(1) != day:
            fail(f'sitemap lastmod for {loc} is not {day}')
        else:
            ok(f'sitemap {loc} lastmod {day}')
    support = read('support.html')
    plain = 'PayAviator is independently operated. Support is not monitored continuously. We aim to respond to support requests within 72 hours. Some issues require additional investigation and may take longer to resolve. For urgent banking issues or suspected fraud, contact your bank directly.'
    for rel, text in (('support.html', support), ('faq.html', faq), ('terms.html', terms)):
        if plain not in text:
            fail(rel + ' is missing the concise support wording')
        elif 'business day' in text.lower() or 'automatic reply' in text.lower() or 'elapsed hour' in text.lower():
            fail(rel + ' still has the long support lecture')
        else:
            ok(rel + ' uses the concise support wording')
    if '72-hour support aim is not a waiting period' not in delete:
        fail('delete page no longer says the support aim is not a wait for deletion')
    else:
        ok('delete page keeps one line that support timing is not a deletion wait')
    review = read('review/index.html')
    robots = read('robots.txt')
    if 'noindex, nofollow' not in review or '2026-11a' not in review or '2026-10g' not in review:
        fail('review map is missing noindex or version labels')
    elif '2026-11a-draft' in review:
        fail('review map still says 2026-11a-draft')
    elif 'not a compliance certification' not in review:
        fail('review map could be read as a compliance certification')
    elif review.count('<li>') < 5 or 'Five questions' not in review:
        fail('review map is missing the five questions')
    elif 'forming an Ohio LLC alone' not in review or 'not registered' not in review:
        fail('review map does not say the Ohio LLC is unregistered and formed alone')
    elif '420600' not in review or 'not a production release' not in review and 'Production is not eligible' not in review:
        fail('review map does not record the closed-test build or the production hold')
    elif re.search(r'assistant|Ask PayAviator|artificial intelligence|\bAI\b', review + privacy + terms + faq + read('support.html')):
        fail('AI or an assistant is still described on a review or policy page')
    elif re.search(r'\bmother\b|co-owner|incorporated|C&R Digital', review + privacy + terms, re.I):
        fail('review or policy names a co-owner or an already formed company')
    elif re.search(r'OPPA|immunity|exclusive venue|twelve month|liability is limited', privacy + terms, re.I):
        fail('privacy or terms adds a rejected legal term')
    elif '/review/' in read('sitemap.xml'):
        fail('sitemap includes the lawyer review route')
    elif 'Disallow: /review/' not in robots:
        fail('robots.txt does not keep /review/ out')
    else:
        ok('review map is noindex, asks five questions, and keeps the old policy')
    if 'not described here as what the app does today' not in delete:
        fail('disconnect draft describes an unverified fix as shipped')
    else:
        ok('unverified bank-disconnect fix is not described as shipped')

    print(f'\n{len(fails)} failed' if fails else '\npolicy review checks passed')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
