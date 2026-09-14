#!/usr/bin/env python3
"""Project a confirmed job and prd out to Platty. One way; nothing is ever read back.

The case is the source of truth. Platty receives a copy the downstream SDD skills can
validate with the revision contract in `using-platty-mcp/references/sdd-revision-contract.md`,
which is the only reason the contract's formula is reproduced here.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

DEFAULT_ROOT = Path.home() / '.platty' / 'specs'
# Where each document's hashed body stops. The appendix below it is excluded so a re-check
# or a status transition does not move the revision.
BOUNDARY = {'jtbd': '## 5.', 'prd': '## 9.'}
FRONT_KEYS = {'jtbd': ('id', 'outputLanguage', 'projectId', 'type'),
              'prd': ('id', 'outputLanguage', 'projectId', 'type')}


def canonical(value):
    """UTF-8 bytewise key order, no whitespace, as the contract specifies."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def canonical_digest(value):
    return 'sha256:' + hashlib.sha256(canonical(value).encode('utf-8')).hexdigest()


def envelope_revision(body, frontmatter):
    return canonical_digest({'body': body, 'frontmatter': frontmatter})


def normalize(text):
    """UTF-8, LF line endings, exactly one trailing newline."""
    return text.replace('\r\n', '\n').replace('\r', '\n').rstrip('\n') + '\n'


def body_before(text, boundary):
    """Everything before the appendix heading, kept verbatim.

    Platty's `sdd-artifacts.mjs` slices at the heading index and keeps what precedes it
    exactly — the delimiter run and its blank lines included. Trimming them here would
    produce a revision the consumer rejects.

    A missing or duplicated boundary is refused rather than guessed: such a document is
    not hashed at all.
    """
    body = normalize(text)
    marker = '\n' + boundary
    index = body.find(marker)
    if index < 0:
        raise ValueError(f'required boundary heading {boundary!r} missing; cannot compute revision')
    if body.find(marker, index + 1) >= 0:
        raise ValueError(f'duplicate boundary heading {boundary!r}; cannot compute revision')
    return body[:index + 1]


def split_frontmatter(text):
    body = normalize(text)
    if not body.startswith('---\n'):
        return {}, body
    end = body.find('\n---\n', 4)
    if end < 0:
        return {}, body
    front = {}
    for line in body[4:end].splitlines():
        if ': ' in line:
            key, _, value = line.partition(': ')
            front[key.strip()] = value.strip().strip('"')
    return front, body[end + 5:].lstrip('\n')


def revision_of(text, kind):
    front, body = split_frontmatter(text)
    return envelope_revision(body_before(body, BOUNDARY[kind]),
                             {key: front.get(key, '') for key in FRONT_KEYS[kind]})


def render_frontmatter(rows):
    lines = ['---'] + [f'{key}: "{value}"' for key, value in rows] + ['---', '']
    return '\n'.join(lines)


def project(case, specs_root=None):
    """Write the job and the prd where the SDD pipeline expects to find them."""
    case = Path(case)
    specs_root = Path(specs_root) if specs_root else DEFAULT_ROOT
    job_meta = json.loads((case / 'jtbd.json').read_text(encoding='utf-8'))
    prd_meta = json.loads((case / 'prd.json').read_text(encoding='utf-8'))
    if prd_meta.get('status') != 'complete':
        raise ValueError('only a confirmed prd is projected; this one is ' + prd_meta.get('status', ''))
    slug = job_meta['case_id']
    project_id = job_meta['service_context']['project_id']

    job_front = [('id', f'JTBD-{slug}'), ('type', 'jtbd'),
                 ('status', job_meta.get('job_status', 'active')),
                 ('projectId', project_id), ('outputLanguage', 'ko')]
    job_body = normalize((case / 'jtbd.md').read_text(encoding='utf-8'))
    _, job_body = split_frontmatter(job_body)
    job_text = render_frontmatter(job_front) + job_body
    job_path = specs_root / project_id / 'jtbd' / slug / 'jtbd.md'

    prd_front = [('id', f'SPEC-{slug}'), ('type', 'sdd-request'),
                 ('status', 'draft'), ('projectId', project_id), ('outputLanguage', 'ko'),
                 ('jtbdRef', slug), ('jtbdRevision', revision_of(job_text, 'jtbd'))]
    prd_body = normalize((case / 'prd.md').read_text(encoding='utf-8'))
    _, prd_body = split_frontmatter(prd_body)
    prd_text = render_frontmatter(prd_front) + prd_body
    prd_path = specs_root / project_id / slug / 'prd.md'

    written = []
    for path, text in ((job_path, job_text), (prd_path, prd_text)):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(normalize(text), encoding='utf-8')
        written.append(path)
    return written


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('case', type=Path)
    parser.add_argument('--specs-root', type=Path, default=None,
                        help=f'default {DEFAULT_ROOT}')
    args = parser.parse_args()
    try:
        written = project(args.case, args.specs_root)
        print(json.dumps({'projected': [str(path) for path in written]},
                         ensure_ascii=False, indent=2))
        return 0
    except (OSError, UnicodeError, ValueError, KeyError) as exc:
        print(json.dumps({'error': str(exc)}, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
