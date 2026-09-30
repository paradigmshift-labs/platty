#!/usr/bin/env python3
"""Convert a BA-rendered Markdown file to Notion-flavored Markdown.

usage: md_to_notion.py <in.md> <out.nmd> [--keep-title]

- pipe tables -> <table header-row="true"> blocks (Notion cells take rich text only)
- Markdown backslash escapes and HTML entities are undone, then only the characters Notion
  treats as syntax (\\ [ ] < > { } $ ^ | ~) are escaped again, outside code and real links
- a [label](target) is kept as a link only when the target looks like a URL; otherwise the
  brackets are escaped, so "[적립만 하기](바로 적립)" stays text
- the first "# " heading is dropped (Notion shows the page title separately) unless --keep-title
"""
import html
import re
import sys

ESC_MD = re.compile(r'\\([\\`*_{}\[\]()#+\-.!|<>~^$])')
LINK = re.compile(r'\[([^\]]+)\]\(((?:https?://|mailto:|/|#)[^)\s]*)\)')


def unesc(s):
    return html.unescape(ESC_MD.sub(r'\1', s))


def esc_text(s, allow_quote=False):
    keep = []

    def hold(m):
        keep.append(m.group(0))
        return f'\x00{len(keep) - 1}\x00'
    s = re.sub(r'`[^`]*`', hold, s)
    s = LINK.sub(hold, s)
    lead = ''
    if allow_quote and s.startswith('> '):
        lead, s = '> ', s[2:]
    for ch in '\\[]<>{}$^|~':
        s = s.replace(ch, '\\' + ch)
    s = re.sub(r'\x00(\d+)\x00', lambda m: keep[int(m.group(1))], s)
    return lead + s


def convert(md, keep_title=False):
    out, lines, i, incode = [], md.split('\n'), 0, False
    if not keep_title and lines and lines[0].startswith('# '):
        lines = lines[1:]
    while i < len(lines):
        ln = lines[i]
        if ln.startswith('```'):
            incode = not incode
            out.append(ln)
            i += 1
            continue
        if incode:
            out.append(ln)
            i += 1
            continue
        if ln.strip().startswith('|') and i + 1 < len(lines) and re.match(r'^\s*\|[\s:\-|]+\|\s*$', lines[i + 1]):
            rows = [ln]
            i += 2
            while i < len(lines) and lines[i].strip().startswith('|'):
                rows.append(lines[i])
                i += 1
            out.append('<table header-row="true">')
            for r in rows:
                cells = [c.strip() for c in re.split(r'(?<!\\)\|', r.strip())[1:-1]]
                out.append('\t<tr>')
                out.extend('\t\t<td>' + esc_text(unesc(c)) + '</td>' for c in cells)
                out.append('\t</tr>')
            out.append('</table>')
            continue
        t = unesc(ln)
        m = re.match(r'^(#{1,4} |\s*[-*] |\s*\d+\. )(.*)$', t)
        out.append(m.group(1) + esc_text(m.group(2)) if m else esc_text(t, allow_quote=True))
        i += 1
    # collapse runs of blank lines; Notion strips them anyway
    return re.sub(r'\n{3,}', '\n\n', '\n'.join(out)).strip() + '\n'


if __name__ == '__main__':
    src, dst = sys.argv[1:3]
    open(dst, 'w', encoding='utf-8').write(convert(open(src, encoding='utf-8').read(), '--keep-title' in sys.argv))
