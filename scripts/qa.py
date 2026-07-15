#!/usr/bin/env python3
from __future__ import annotations
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEXT_EXTS = {'.html', '.css', '.js', '.md', '.json', '.yml', '.yaml'}
REQUIRED = [
    'index.html','resume.html','cover-letter.html','interview-brief.html','120-day-plan.html',
    'o2c-readiness-airlock.html','source-notes.html','styles.css','brand-tokens.css','app.js',
    'styles/readability-repair.css','brand-intelligence.md','brand-assets.json','README.md',
    'assets/brand/nwn-careers-wordmark.png','assets/brand/nwn-hero.jpg','assets/brand/nwn-slant.svg'
]
PDF_COUNTS = {
    'docs/Russell-Dudek-NWN-Resume.pdf': 2,
    'docs/Russell-Dudek-NWN-Cover-Letter.pdf': 1,
    'docs/NWN-Interview-Thesis-Brief.pdf': 2,
    'docs/NWN-120-Day-Entry-Plan.pdf': 2,
    'docs/O2C-Readiness-Airlock-Worksheet.pdf': 1,
}
FORBIDDEN = [r'RoleForge', r'russelldudek/roleforge', r'candidate-evidence\.yaml', r'portfolio-index\.yaml', r'anti-clone-ledger', r'pattern-ledger']


def fail(message: str) -> None:
    raise SystemExit(f'QA FAILED: {message}')


def source_checks() -> None:
    missing = [p for p in REQUIRED if not (ROOT / p).exists()]
    if missing:
        fail(f'missing required files: {missing}')

    for path in ROOT.rglob('*'):
        if path.is_file() and path.suffix.lower() in TEXT_EXTS:
            text = path.read_text(encoding='utf-8', errors='replace')
            for pattern in FORBIDDEN:
                if re.search(pattern, text, re.I):
                    fail(f'confidential/internal term {pattern!r} in {path.relative_to(ROOT)}')

    index = (ROOT / 'index.html').read_text(encoding='utf-8')
    styles = (ROOT / 'styles.css').read_text(encoding='utf-8')
    fragments = '\n'.join(
        path.read_text(encoding='utf-8')
        for path in sorted((ROOT / 'fragments').glob('index-*.js'))
    )
    repair = (ROOT / 'styles/readability-repair.css').read_text(encoding='utf-8')

    for needle in ['id="airlock"', 'data-scenario="managed"', 'Reset to baseline', 'prefers-reduced-motion']:
        if needle not in (index + styles + fragments + repair):
            fail(f'missing interaction/accessibility evidence: {needle}')

    for obsolete in ['class="offer-capsule"', 'class="airlock-hero"', 'Animated Opportunity-to-Cash readiness airlock']:
        if obsolete in fragments:
            fail(f'obsolete pill/orbit hero markup remains: {obsolete}')

    hero_needles = [
        'Run the readiness model', 'class="readiness-scan"', 'Ready with controls',
        'Commercial', 'Margin', 'Transaction', 'Finance', 'Systems', 'Adoption'
    ]
    for needle in hero_needles:
        if needle not in fragments:
            fail(f'missing six-gate hero evidence: {needle}')

    if not styles.rstrip().endswith('@import url("styles/readability-repair.css");'):
        fail('readability repair stylesheet must be imported last')

    css_needles = [
        'border-radius: 10px', '#001455 !important', '@media (prefers-reduced-motion: reduce)',
        '.scan-gate', '.scan-outcome', 'animation-iteration-count'
    ]
    # animation-iteration-count is supplied by the existing reduced-motion stylesheet;
    # the combined source must retain it while the repair adds its own completed state.
    combined_css = '\n'.join(
        path.read_text(encoding='utf-8')
        for path in sorted((ROOT / 'styles').glob('*.css'))
    ) + '\n' + styles
    for needle in css_needles:
        if needle not in combined_css:
            fail(f'missing readability/motion safeguard: {needle}')

    for html in ['resume.html','cover-letter.html','interview-brief.html','120-day-plan.html','o2c-readiness-airlock.html']:
        text = (ROOT / html).read_text(encoding='utf-8')
        if 'docs/' not in text or 'download' not in text:
            fail(f'{html} does not link its PDF')

    print('Source QA: pill/orbit removal, six-gate scan, readability safeguards, and links passed')


def pdf_checks() -> None:
    try:
        import fitz
    except ImportError as exc:
        fail(f'PyMuPDF unavailable: {exc}')
    for rel, expected in PDF_COUNTS.items():
        path = ROOT / rel
        if not path.exists() or path.stat().st_size < 5000:
            fail(f'missing or suspicious PDF: {rel}')
        doc = fitz.open(path)
        if doc.page_count != expected:
            fail(f'{rel}: expected {expected} pages, got {doc.page_count}')
        for index, page in enumerate(doc):
            text = page.get_text('text').strip()
            if len(text) < 120:
                fail(f'{rel} page {index+1} has too little extractable text')
            for pattern in FORBIDDEN:
                if re.search(pattern, text, re.I):
                    fail(f'confidential/internal term in {rel} page {index+1}')
        doc.close()
    print('PDF QA: exact page counts and extractable text passed')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', action='store_true')
    parser.add_argument('--all', action='store_true')
    args = parser.parse_args()
    source_checks()
    if args.all:
        pdf_checks()
    manifest = {'required': REQUIRED, 'pdfPageCounts': PDF_COUNTS}
    (ROOT / 'artifact-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
