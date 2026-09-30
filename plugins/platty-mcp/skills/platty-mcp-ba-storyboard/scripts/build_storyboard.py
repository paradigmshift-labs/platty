#!/usr/bin/env python3
"""Render a Snow White storyboard page from a storyboard spec JSON.

usage:
  build_storyboard.py <spec.json> --out <dir> [--standalone]

Writes <dir>/storyboard.html (images referenced as img/scene-N.jpg) and, with --standalone,
<dir>/<slug>.html where every image is embedded as a data URI so the file works on its own.
A scene whose image file is missing is drawn as a labelled placeholder, never as a broken image.
The spec shape is documented in ../SKILL.md and ../examples/sample.spec.json.
"""
import argparse
import base64
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSS = (ROOT / 'assets' / 'storyboard.css').read_text(encoding='utf-8')
FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hahmlet:wght@500;700'
         '&family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap">\n')

E = lambda s: html.escape(str(s), quote=True)


def img(spec_dir, out_dir, rel, alt, cls=''):
    """An <img> when the file exists next to the output, otherwise a placeholder box."""
    if rel and (out_dir / rel).exists():
        return f'<img src="{E(rel)}" alt="{E(alt)}"{f" class={chr(34)}{cls}{chr(34)}" if cls else ""}>'
    return f'<div class="noimg" role="img" aria-label="{E(alt)}">그림 자리 · {E(alt)}</div>'


def thought(t):
    arm = t.get('arm', 'both')
    return f'<div class="thought {E(arm)}"><b>{E(t.get("label", ""))}</b>{E(t["text"])}</div>'


def block(b):
    k = b['type']
    if k == 'bubble':
        cls = 'bub hi' if b.get('hi') else 'bub'
        inner = f'<span>{b["html"]}</span>' if b.get('hi') else b['html']
        return f'<div class="{cls}">{inner}</div>'
    if k == 'title':
        return f'<b>{E(b["text"])}</b>'
    if k == 'list':
        return '<ol class="ol">' + ''.join(f'<li>{E(i)}</li>' for i in b['items']) + '</ol>'
    if k == 'text':
        return f'<div>{E(b["text"])}</div>'
    if k == 'steps':
        return f'<div class="steps">{E(b["text"])}</div>'
    if k == 'entry':
        return f'<div class="entry"><b>{E(b["label"])}</b><span class="chip">{E(b.get("chip", "진입점"))}</span></div>'
    if k == 'toast':
        return f'<div class="toast">{E(b["text"])}</div>'
    if k == 'chips':
        return '<div>' + ''.join(f'<span class="chip">{E(c)}</span>' for c in b['items']) + '</div>'
    if k == 'field':
        return f'<div class="field">{E(b["text"])}</div>'
    if k == 'button':
        style = {'primary': 'p', 'soft': 's'}.get(b.get('style'), 'g')
        dim = ' style="margin-top:auto;opacity:.6"' if b.get('disabled') else ' style="margin-top:auto"'
        return f'<div class="btn {style}"{dim}>{E(b["text"])}</div>'
    if k == 'points':
        return (f'<div class="pts"><s>{E(b["from"])}</s> {E(b["to"])}</div>'
                + (f'<div class="plus">{E(b["plus"])}</div>' if b.get('plus') else ''))
    if k == 'note':
        return f'<div class="note"{" style=" + chr(34) + "margin-top:auto" + chr(34) if b.get("bottom") else ""}>{E(b["text"])}</div>'
    if k == 'sheet':
        buttons = ''.join(f'<div class="btn {"p" if i else "s"}">{E(t)}</div>' for i, t in enumerate(b['buttons']))
        return ('<div class="sheet">'
                f'<div class="t"><em>{E(b.get("em", ""))}</em>{E(b.get("title", ""))}</div>'
                + (f'<div class="note">{E(b["note"])}</div>' if b.get('note') else '')
                + f'<div class="row2">{buttons}</div></div>')
    raise ValueError(f'unknown phone block type {k!r}')


def phone(p):
    arm = p.get('arm', 'both')
    return (f'<div class="ph {E(arm)}"><span class="tag">{E(p.get("tag", ""))}</span>'
            + ''.join(block(b) for b in p.get('blocks', [])) + '</div>')


def curve_svg(spec):
    """The mood curve: one polyline per arm across the stage columns (values 1–5)."""
    curve = spec.get('curve')
    if not curve:
        return ''
    n = len(spec['stages'])
    w, colw, top, bottom = n * 264, 264, 12, 100
    y = lambda v: bottom - (float(v) - 1) / 4 * (bottom - top)
    parts = [f'<line x1="0" y1="{(top + bottom) / 2}" x2="{w}" y2="{(top + bottom) / 2}" stroke="var(--line)" stroke-dasharray="4 6"/>']
    for arm in curve.get('arms', []):
        color = {'ctl': 'var(--ctl)', 'exp': 'var(--exp)'}.get(arm['arm'], 'var(--muted)')
        pts = [(colw / 2 + i * colw, y(v)) for i, v in enumerate(arm['values']) if v is not None]
        parts.append(f'<polyline fill="none" stroke="{color}" stroke-width="3" points="'
                     + ' '.join(f'{x:.0f},{yy:.0f}' for x, yy in pts) + '"/>')
        parts.append(f'<g fill="{color}">' + ''.join(f'<circle cx="{x:.0f}" cy="{yy:.0f}" r="5"/>' for x, yy in pts) + '</g>')
    for lab in curve.get('labels', []):
        i = lab['stage']
        parts.append(f'<text x="{colw / 2 + i * colw + 16:.0f}" y="{lab.get("y", 112)}">{E(lab["text"])}</text>')
    return (f'<div class="rowlab">기분<small>{E(curve.get("caption", "가설"))}</small></div>'
            f'<div class="curve" style="grid-column:2 / span {n}" aria-label="{E(curve.get("aria", "기분 곡선"))}">'
            f'<svg viewBox="0 0 {w} 120" preserveAspectRatio="none" role="img">' + ''.join(parts) + '</svg></div>')


def cell_scene(st, spec_dir, out_dir):
    s = st.get('scene', {})
    out = ''
    if s.get('moment'):
        out += f'<span class="moment">{E(s["moment"])}</span>'
    out += img(spec_dir, out_dir, s.get('image', ''), s.get('alt', st['title']))
    out += ''.join(thought(t) for t in s.get('thoughts', []))
    if s.get('note'):
        out += f'<p>{E(s["note"])}</p>'
    return out


def cell_product(st):
    pr = st.get('product', {})
    phones = pr.get('phones', [])
    if not phones:
        return '<span class="empty">—</span>'
    cls = 'pair one' if len(phones) == 1 else 'pair'
    out = f'<div class="{cls}">' + ''.join(phone(p) for p in phones) + '</div>'
    if pr.get('note'):
        out += f'<p class="note" style="margin:0">{E(pr["note"])}</p>'
    return out


def cell_policy(st):
    items = st.get('policy', [])
    if not items:
        return '<span class="empty">—</span>'
    return ''.join('<div>' + ''.join(f'<code>{E(i)}</code>' for i in it.get('ids', [])) + E(it['text']) + '</div>'
                   for it in items)


def cell_service(st):
    items = st.get('service', [])
    if not items:
        return '<span class="empty">—</span>'
    return '<ul class="svc">' + ''.join(f'<li>{E(i)}</li>' for i in items) + '</ul>'


def cell_metric(st):
    items = st.get('metrics', [])
    if not items:
        return '<span class="empty">—</span>'
    return ''.join(f'<div class="metric {E(m.get("kind", ""))}"><b>{E(m["title"])}</b>{E(m.get("text", ""))}</div>'
                   for m in items)


def build(spec, spec_dir, out_dir):
    stages = spec['stages']
    n = len(stages)
    p = spec['persona']
    why = spec.get('why', {})
    rows = []
    rows.append('<div class="rowlab stage">장면</div>' + ''.join(
        f'<div class="cell stage{" off" if s.get("off") else ""}"><span class="n">{i + 1:02d} · {E(s.get("when", ""))}</span>'
        f'<h3>{E(s["title"])}</h3><span class="when">{E(s.get("sub", ""))}</span></div>' for i, s in enumerate(stages)))
    layers = [('사람', '장면 · 속마음', lambda s: cell_scene(s, spec_dir, out_dir), 'cell scene'),
              (None, None, None, None),
              ('제품', '그 순간 보이는 화면 · 실제 문구', cell_product, 'cell'),
              ('정책', 'PRD 규칙 · 결정', cell_policy, 'cell pol'),
              ('서비스', '뒤에서 시스템이 하는 일', cell_service, 'cell'),
              ('측정', '이 장면이 움직이는 숫자', cell_metric, 'cell')]
    for name, small, fn, cls in layers:
        if name is None:
            rows.append(curve_svg(spec))
            continue
        rows.append(f'<div class="rowlab">{name}<small>{small}</small></div>' + ''.join(
            f'<div class="{cls}{" off" if s.get("off") else ""}">{fn(s)}</div>' for s in stages))
    docs = spec.get('docs', [])
    docs_html = ''
    if docs:
        docs_html = ('<nav class="docs" aria-label="기획 문서"><span class="eyebrow">기획 문서</span><div class="doclinks">'
                     + ''.join(f'<a class="doc" href="{E(d["url"])}" target="_blank" rel="noopener"><b>{E(d["title"])}</b>'
                               f'<span>{E(d.get("desc", ""))}</span></a>' for d in docs) + '</div>'
                     + (f'<a class="note" href="{E(spec["docs_home"])}" target="_blank" rel="noopener">문서 묶음 페이지 열기 →</a>'
                        if spec.get('docs_home') else '') + '</nav>')
    arms = ''.join(f'<span class="arm {E(a["arm"])}"><i></i>{E(a["label"])}</span>' for a in spec.get('arms', []))
    job = ''.join(f'<dt>{E(k)}</dt><dd>{E(v)}</dd>' for k, v in p.get('job', []))
    notes = ''.join(f'<section class="card"><div class="who">{E(c["who"])}</div><h2>{E(c["title"])}</h2><ul>'
                    + ''.join(f'<li>{E(i)}</li>' for i in c['items']) + '</ul></section>' for c in spec.get('notes', []))
    foot = ''.join(f'<span>{E(f)}</span>' for f in spec.get('footer', []))
    board_cols = f'grid-template-columns:96px repeat({n},264px)'
    page = f'''<meta charset="utf-8">
<title>{E(spec["title"])}</title>
{FONTS}<style>
{CSS}
</style>
<div class="wrap">
  <div class="eyebrow">{E(spec.get("eyebrow", ""))}</div>
  <h1>{E(spec["title"])}</h1>
  <p class="lede">{E(spec.get("lede", ""))}</p>
  <div class="intro">
    <section class="card persona" aria-label="페르소나">
      {img(spec_dir, out_dir, p.get("image", ""), p.get("alt", "페르소나"))}
      <div>
        <div class="eyebrow">{E(p.get("eyebrow", "이 사람"))}</div>
        <h2 style="margin-top:4px">{E(p["subject"])}</h2>
        <dl class="job">{job}</dl>
      </div>
    </section>
    <section class="card why" aria-label="왜 이 실험인가">
      <div class="eyebrow">{E(why.get("eyebrow", "왜 이 작업인가"))}</div>
      <div><span class="big">{E(why.get("big", ""))}</span></div>
      <p style="margin:0">{E(why.get("text", ""))}</p>
      <div class="arms">{arms}</div>
      <p class="note" style="margin:0">{E(why.get("note", ""))}</p>
    </section>
  </div>
  {docs_html}
  <div class="howto" aria-label="보는 법">
    <span><b>가로</b> 여정의 흐름</span><span><b>사람</b> 장면과 속마음</span><span><b>제품</b> 그 순간 보이는 화면</span>
    <span><b>정책</b> PRD 규칙·결정</span><span><b>서비스</b> 뒤에서 시스템이 하는 일</span><span><b>측정</b> 이 장면이 움직이는 숫자</span>
  </div>
  <div class="boardhead"><h2>{E(spec.get("board_title", "여정의 장면"))}</h2><span class="note">표가 넓으면 옆으로 밀어서 보세요</span></div>
  <div class="scroller" tabindex="0" aria-label="스토리보드 표"><div class="board" style="{board_cols}">
  {"".join(rows)}
  </div></div>
  <div class="notes">{notes}</div>
  <div class="foot">{foot}</div>
</div>
'''
    return page


def standalone(page, out_dir):
    def data(m):
        raw = (out_dir / m.group(1)).read_bytes()
        mime = 'image/png' if raw.startswith(b'\x89PNG') else 'image/jpeg'
        return f'src="data:{mime};base64,{base64.b64encode(raw).decode()}"'
    body = re.sub(r'src="(img/[^"]+\.jpg)"', data, page)
    i = body.index('<div class="wrap">')
    return ('<!doctype html>\n<html lang="ko">\n<head>\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            '<style>html,body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n'
            + body[:i] + '</head>\n<body>\n' + body[i:] + '\n</body>\n</html>\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('spec')
    ap.add_argument('--out', required=True)
    ap.add_argument('--standalone', action='store_true')
    a = ap.parse_args()
    spec_path = Path(a.spec)
    spec = json.loads(spec_path.read_text(encoding='utf-8'))
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    page = build(spec, spec_path.parent, out)
    (out / 'storyboard.html').write_text(page, encoding='utf-8')
    missing = [s['scene'].get('image') for s in spec['stages']
               if s.get('scene', {}).get('image') and not (out / s['scene']['image']).exists()]
    print(json.dumps({'page': str(out / 'storyboard.html'), 'missing_images': missing}, ensure_ascii=False))
    if a.standalone:
        slug = spec.get('slug') or 'storyboard'
        path = out / f'{slug}.html'
        path.write_text(standalone(page, out), encoding='utf-8')
        print(json.dumps({'standalone': str(path), 'kb': path.stat().st_size // 1024}, ensure_ascii=False))


if __name__ == '__main__':
    main()
