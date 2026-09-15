#!/usr/bin/env python3
"""Render a design knowledge pack as one HTML page a designer can read.

The pack is the only source. This script resolves and displays; it invents no value,
no color, and no component. Every row carries the authority and limitation the pack
recorded for it, because a designer who cannot see the limitation will read an AI
synthesis as a settled rule.

Components are drawn with the *same* markup the wireframe engine emits
(`tools/design-pipeline/src/engine.mjs` templateNodeHtml). Showing an idealized mock
would be a lie about what stage 4 actually produces.
"""
import argparse
import json
import re
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import WORKSPACE_ROOT

import pack_tokens_css  # noqa: E402  (flatten/resolve are the proven token readers)


# --- token reading -----------------------------------------------------------------

def token_table(pack):
    """({name: (resolved literal, raw literal)}, {name: raw object}).

    Composite tokens — shadow above all — keep their whole DTCG object as one value,
    so the flattened map is returned alongside: a shadow read only as a literal string
    silently renders as no shadow at all.
    """
    flat = pack_tokens_css.flatten(pack.get('tokens', {}))
    table = {}
    for name, value in flat.items():
        raw = pack_tokens_css.literal(value)
        table[name] = (pack_tokens_css.resolve(flat, value), raw)
    return table, flat


def group(table, prefix):
    return {name: pair for name, pair in sorted(table.items())
            if name == prefix or name.startswith(prefix + '.')}


def rgb_parts(literal):
    """(r, g, b, a) from an rgba() literal, or None when it is not a color."""
    if not literal.startswith('rgba('):
        return None
    try:
        parts = [float(x) for x in literal[5:-1].split(',')]
    except ValueError:
        return None
    return tuple(parts) if len(parts) == 4 else None


def luminance(red, green, blue):
    def channel(value):
        value = value / 255
        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4
    return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)


def contrast(literal, against=(255, 255, 255)):
    """Contrast ratio against a background, or None when the value is not a color.

    Alpha is composited onto the background first; an uncomposited ratio would report
    a translucent token as far more readable than it is.
    """
    parts = rgb_parts(literal)
    if parts is None:
        return None
    red, green, blue, alpha = parts
    red = red * alpha + against[0] * (1 - alpha)
    green = green * alpha + against[1] * (1 - alpha)
    blue = blue * alpha + against[2] * (1 - alpha)
    first = luminance(red, green, blue) + 0.05
    second = luminance(*against) + 0.05
    return round(max(first, second) / min(first, second), 2)


# --- component drawing -------------------------------------------------------------

# engine.mjs roleForNode maps the input semantic type to the textbox role; reverse it
# so the gallery draws what the engine would draw for this knowledge row.
ROLE_TO_SEMANTIC = {'textbox': 'input', 'region': 'section'}  # text/icon draw under their own names

# Which axes can be shown as a still picture. `value`/`visible` are not variants of the
# control, and `focus` cannot be forced without scripting, so they are listed as text.
DRAWABLE_STATES = ('checked', 'selected', 'disabled', 'readonly', 'busy', 'invalid', 'expanded')


def element_html(semantic_type, name, state=''):
    """The engine's own node markup, with one state axis applied."""
    checked = ' checked' if state == 'checked' else ''
    disabled = ' disabled' if state == 'disabled' else ''
    readonly = ' readonly' if state == 'readonly' else ''
    invalid = ' aria-invalid="true"' if state == 'invalid' else ''
    busy = ' aria-busy="true"' if state == 'busy' else ''
    expanded = 'true' if state == 'expanded' else 'false'
    selected = ' aria-selected="true"' if state == 'selected' else ''
    label = esc(name)
    if semantic_type == 'select':
        return (f'<label class="wf-field"><span>{label}</span>'
                f'<select aria-label="{label}"{disabled}{invalid}{busy}>'
                f'<option>선택</option></select></label>')
    if semantic_type == 'checkbox':
        return (f'<label class="wf-check"><input type="checkbox"{checked}{disabled}{invalid}>'
                f' <span>{label}</span></label>')
    if semantic_type == 'input':
        return (f'<label class="wf-field"><span>{label}</span>'
                f'<input aria-label="{label}" placeholder="입력"{disabled}{readonly}{invalid}{busy}>'
                f'</label>')
    if semantic_type == 'button':
        return f'<button type="button"{disabled}{busy}{selected}>{label}</button>'
    if semantic_type == 'disclosure':
        return f'<button type="button" aria-expanded="{expanded}"{disabled}>{label}</button>'
    if semantic_type == 'status':
        return f'<p role="status" aria-live="polite"{busy}{invalid}>{label}</p>'
    if semantic_type == 'radio':
        # The group name must be derived, not hashed: Python randomises str hashes per
        # process, so a hashed name would make this page differ on every regeneration.
        group = re.sub(r'[^a-z0-9]+', '-', str(name).lower()).strip('-') or 'radio'
        return (f'<label class="wf-check"><input type="radio" name="preview-{esc(group)}"'
                f'{checked}{disabled}{invalid}> <span>{label}</span></label>')
    if semantic_type == 'switch':
        aria = 'true' if state == 'checked' else 'false'
        return f'<button type="button" role="switch" aria-checked="{aria}"{disabled}>{label}</button>'
    if semantic_type == 'text':
        return f'<p class="wf-text">{label}</p>'
    if semantic_type == 'icon':
        return f'<span class="wf-icon" role="img" aria-label="{label}" title="{label}"></span>'
    return f'<section role="region" aria-label="{label}">{label}</section>'


# --- html --------------------------------------------------------------------------

def esc(value):
    return (str(value if value is not None else '')
            .replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            .replace('"', '&quot;').replace("'", '&#39;'))


STYLE = '''
:root{
  --primary:#7256E9; --primary-soft:#F4EFFF;
  --ink:#0E0B1A; --ink-2:#4A4658; --ink-3:#8C8993;
  --ground:#FFFFFF; --surface:#F8F8F8; --line:#E7E5EE;
  --warn:#8A6410; --warn-soft:#FBF3DE; --no:#B3261E;
  --sans:"Pretendard","IBM Plex Sans KR",-apple-system,"Apple SD Gothic Neo",sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --primary:#A995FF; --primary-soft:#241E3D;
  --ink:#EDEBF5; --ink-2:#B3AEC4; --ink-3:#7E7995;
  --ground:#141121; --surface:#1C1830; --line:#2C2743;
  --warn:#E0B252; --warn-soft:#2E2512; --no:#F09189;
}}
:root[data-theme="dark"]{
  --primary:#A995FF; --primary-soft:#241E3D;
  --ink:#EDEBF5; --ink-2:#B3AEC4; --ink-3:#7E7995;
  --ground:#141121; --surface:#1C1830; --line:#2C2743;
  --warn:#E0B252; --warn-soft:#2E2512; --no:#F09189;
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--sans);
  font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased;word-break:keep-all}
.wrap{max-width:940px;margin:0 auto;padding-inline:20px;padding-block:0 96px}
code,.mono{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:12.5px}
a{color:var(--primary)}

header{padding-block:40px 20px;border-bottom:1px solid var(--line)}
h1{margin:0 0 6px;font-size:27px;line-height:1.25;font-weight:700;letter-spacing:-.02em}
.sub{margin:0;color:var(--ink-2);font-size:14px}
.note{margin-block:20px;padding:16px 18px;background:var(--surface);border-radius:10px;
  font-size:13.5px;line-height:1.7;color:var(--ink-2)}
.note b{color:var(--ink);font-weight:600}
.note.warn{background:var(--warn-soft)} .note.warn b{color:var(--warn)}

nav.toc{position:sticky;top:0;z-index:5;background:var(--ground);
  border-bottom:1px solid var(--line);padding-block:11px;display:flex;gap:6px;flex-wrap:wrap}
nav.toc a{font-size:12.5px;padding:5px 11px;border-radius:999px;text-decoration:none;
  color:var(--ink-2);background:var(--surface)}

section{scroll-margin-top:56px}
h2{margin:44px 0 2px;scroll-margin-top:56px;font-size:12px;font-weight:600;letter-spacing:.1em;
  text-transform:uppercase;color:var(--ink-3)}
h2+.lede{margin:0 0 8px;font-size:13.5px;color:var(--ink-2)}
h3{margin:26px 0 8px;font-size:15px;font-weight:600}

/* 팩의 must_not: 「모든 콘텐츠에 테두리와 그림자를 추가하지 않는다」.
   반복 항목은 카드가 아니라 구분선 리스트다. 이 문서가 먼저 지킨다. */
.row{border-top:1px solid var(--line);padding-block:16px}
.row .name{font-weight:600;font-size:15px}
.row .id{font-family:var(--mono);font-size:11.5px;color:var(--ink-3);margin-left:8px}
.row p{margin:6px 0 0;font-size:13.5px;color:var(--ink-2)}
dl{margin:10px 0 0;display:grid;grid-template-columns:108px 1fr;gap:4px 14px;font-size:13.5px}
dt{color:var(--ink-3);font-size:12.5px;padding-top:1px}
dd{margin:0;color:var(--ink-2);overflow-wrap:anywhere}
ul.plain{margin:6px 0 0;padding-left:18px;font-size:13.5px;color:var(--ink-2)}
ul.plain li{margin-block:3px}
.tag{display:inline-block;font-size:11px;padding:2px 7px;border-radius:5px;
  background:var(--surface);color:var(--ink-3);margin-right:4px}
.tag.warn{background:var(--warn-soft);color:var(--warn)}
.limit{margin-top:8px;font-size:12.5px;color:var(--ink-3)}

/* tokens */
.swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:2px;margin-top:10px}
.sw{padding:10px 12px;border-radius:8px;background:var(--surface)}
.sw .chip{height:44px;border-radius:6px;margin-bottom:8px;
  background-image:linear-gradient(45deg,#0001 25%,#0000 25% 75%,#0001 75%),
                   linear-gradient(45deg,#0001 25%,#0000 25% 75%,#0001 75%);
  background-size:12px 12px;background-position:0 0,6px 6px}
.sw .chip i{display:block;height:100%;border-radius:6px}
.sw .n{font-size:12px;font-weight:600;overflow-wrap:anywhere}
.sw .v{font-family:var(--mono);font-size:11px;color:var(--ink-3);overflow-wrap:anywhere}
.sw .r{font-size:11px;color:var(--ink-3);margin-top:3px}
.sw .r b{font-weight:600;color:var(--ink-2)}

.type-row{border-top:1px solid var(--line);padding-block:14px;display:flex;gap:16px;
  align-items:baseline;flex-wrap:wrap}
.type-row .meta{font-family:var(--mono);font-size:11.5px;color:var(--ink-3);min-width:170px}
.type-row .sample{flex:1;min-width:200px;overflow-wrap:anywhere}

.bars{margin-top:10px}
.bar{display:flex;gap:12px;align-items:center;padding-block:5px;font-size:12.5px}
.bar .n{font-family:var(--mono);flex:0 1 150px;min-width:0;color:var(--ink-2);
  overflow-wrap:anywhere}
.bar .track{flex:1 1 60px;min-width:40px}
.bar i{display:block;height:14px;border-radius:3px;background:var(--primary);max-width:100%}
.bar .v{font-family:var(--mono);color:var(--ink-3);flex:none}

.boxes{display:flex;gap:14px;flex-wrap:wrap;margin-top:10px}
.box{text-align:center;font-size:11.5px;color:var(--ink-3)}
.box i{display:block;width:74px;height:60px;background:var(--primary-soft);margin-bottom:5px}
.box .n{font-family:var(--mono);font-size:11px}

/* component gallery */
.states{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:2px;margin-top:10px}
.state{padding:12px;border-radius:8px;background:var(--surface)}
.state .lbl{font-family:var(--mono);font-size:11px;color:var(--ink-3);margin-bottom:7px}
.demo main{margin:0;display:grid;gap:8px}
.demo section,.demo label,.demo p{min-height:40px;margin:0}
.demo .wf-field,.demo .wf-check{display:grid;gap:5px}
.demo input,.demo select,.demo button{min-height:40px;font:inherit;font-size:13px;
  padding:6px 10px;border:1px solid var(--line);border-radius:7px;
  background:var(--ground);color:var(--ink);max-width:100%}
.demo .wf-check{display:flex;align-items:center;gap:8px}
.part{margin:0 0 22px;padding:14px 16px;background:var(--surface);border-radius:10px;
  border-left:3px solid var(--primary)}
.part p{margin:0 0 6px}
.part-what{color:var(--ink-2);font-size:14px}
.part-decide{font-size:14px}
.part-decide b{font-weight:600}
.howto{margin-top:10px;font-size:13.5px}
.howto summary{cursor:pointer;color:var(--primary);font-weight:600}
.howto .table{margin-top:10px}
.howto code{display:inline-block;margin:1px 4px 1px 0}
.muted{color:var(--ink-3);font-size:13px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0 4px}
.tile{display:grid;gap:3px;padding:12px 14px;border:1px solid var(--line);border-radius:10px;
  text-decoration:none;background:var(--ground)}
.tile b{color:var(--ink);font-size:14px;font-weight:600}
.tile span{font:12px/1.4 var(--mono);color:var(--ink-3)}
.tile.open{border-color:var(--warn);background:var(--warn-soft)}
.tile.open span{color:var(--warn)}
.impl{margin-top:12px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--ground)}
.impl-head{padding:7px 12px;background:var(--surface);border-bottom:1px solid var(--line);
  font-size:12px;color:var(--ink-2);display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}
.impl-frame{display:block;width:100%;height:120px;border:0;background:#fff}
.demo .wf-text{margin:0;min-height:0}
.demo .wf-icon{display:inline-block;width:24px;height:24px;border:1px solid currentColor;border-radius:4px}
.demo .wf-check input{min-height:auto;width:18px;height:18px}
.demo button{cursor:pointer;font-weight:600}
.demo :disabled{opacity:.45;cursor:not-allowed}
.demo [aria-invalid="true"]{border-color:var(--no)}
.demo [aria-busy="true"]{opacity:.6}
.demo section{display:flex;align-items:center;padding:10px;border-radius:7px;
  background:var(--ground);font-size:13px;color:var(--ink-2)}
.demo p{display:flex;align-items:center;font-size:13px;color:var(--ink-2);
  padding:8px 10px;border-radius:7px;background:var(--ground)}
.demo p[aria-invalid="true"]{color:var(--no);box-shadow:inset 3px 0 0 var(--no)}
.demo span{font-size:13px}

.shots{columns:4 190px;column-gap:14px;margin-top:10px}
.shots figure{margin:0 0 18px;break-inside:avoid}
.shots a{display:block}
.shots img{display:block;width:100%;height:auto;max-height:560px;object-fit:cover;
  object-position:top;border-radius:8px;background:var(--surface)}
.shots figcaption{margin-top:6px;font-size:11.5px;color:var(--ink-3);overflow-wrap:anywhere}

.table{overflow-x:auto;margin-top:10px}
table{border-collapse:collapse;width:100%;font-size:13px;min-width:420px}
th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:11.5px;color:var(--ink-3);font-weight:600;text-transform:uppercase;letter-spacing:.06em}

:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
@media (max-width:560px){
  dl{grid-template-columns:1fr;gap:2px}dt{padding-top:8px}
  .type-row .meta{min-width:100%}
  .bar .n{flex-basis:96px}
}
'''


def render_tokens(table, flat):
    out = []

    semantic = group(table, 'color.semantic')
    palette = group(table, 'color.palette')
    out.append('<h3>색 · semantic</h3>')
    out.append('<p class="lede">와이어프레임이 쓰는 것은 semantic 토큰뿐이다. '
               '대비는 알파를 흰 배경에 합성한 뒤 계산했다.</p>')
    out.append(swatches(semantic))
    out.append(f'<h3>색 · palette <span class="tag">{len(palette)}개 · 원시값</span></h3>')
    out.append('<p class="lede">semantic이 가리키는 원본이다. 화면에 직접 쓰지 않는다.</p>')
    out.append(swatches(palette))

    out.append('<h3>타이포</h3>')
    scale = {}
    for name, (value, _raw) in group(table, 'typography.scale').items():
        role, prop = name.rsplit('.', 1)
        scale.setdefault(role, {})[prop] = value
    rows = []
    for role, props in scale.items():
        size = props.get('fontSize', '16px')
        height = props.get('lineHeight', 'normal')
        short = role.replace('typography.scale.', '')
        rows.append(
            f'<div class="type-row"><span class="meta">{esc(short)}<br>{esc(size)} / {esc(height)}</span>'
            f'<span class="sample" style="font-size:{esc(size)};line-height:{esc(height)}">'
            f'히로인스 캠페인 신청 Heroines 1234</span></div>')
    weights = ', '.join(f'{k.rsplit(".", 1)[-1]} {v}' for k, (v, _) in group(table, 'typography.weight').items())
    family = table.get('typography.fontFamily', ('', ''))[0]
    rows.append(f'<p class="limit">글꼴 {esc(family)} · 굵기 {esc(weights)} — '
                '이 문서는 설치된 글꼴로 렌더하므로 실제 제품과 자간이 다를 수 있다.</p>')
    out.append(''.join(rows))

    out.append('<h3>간격 · spacing</h3>')
    out.append(bars(group(table, 'spacing')))
    out.append('<h3>조판 · layout</h3>')
    out.append(bars(group(table, 'layout')))

    out.append('<h3>모서리 · radius</h3>')
    out.append('<div class="boxes">' + ''.join(
        f'<div class="box"><i style="border-radius:{esc(value)}"></i>'
        f'<span class="n">{esc(name.replace("radius.", ""))}</span><br>{esc(value)}</div>'
        for name, (value, _) in group(table, 'radius').items()) + '</div>')

    out.append('<h3>그림자 · shadow</h3>')
    out.append('<div class="boxes">' + ''.join(
        f'<div class="box"><i style="box-shadow:{esc(shadow_css(flat[name]))};background:var(--ground)"></i>'
        f'<span class="n">{esc(name.replace("shadow.", ""))}</span></div>'
        for name in shadow_names(flat)) + '</div>')
    out.append('<p class="limit">팩의 must_not은 「모든 콘텐츠에 테두리와 그림자를 추가하지 않는다」이다. '
               '그림자는 띄워야 할 이유가 있는 곳에만 쓴다.</p>')

    out.append('<h3>컨트롤 높이 · sizing</h3>')
    out.append('<div class="boxes">' + ''.join(
        f'<div class="box"><i style="height:{esc(value)};width:110px;border-radius:7px"></i>'
        f'<span class="n">{esc(name.replace("sizing.control.", ""))}</span><br>{esc(value)}</div>'
        for name, (value, _) in group(table, 'sizing').items()) + '</div>')

    motion = group(table, 'motion')
    if motion:
        out.append('<h3>모션 · motion</h3>')
        out.append('<div class="table"><table><thead><tr><th>토큰</th><th>값</th></tr></thead><tbody>'
                   + ''.join(f'<tr><td class="mono">{esc(n)}</td><td class="mono">{esc(v)}</td></tr>'
                             for n, (v, _) in motion.items())
                   + '</tbody></table></div>')
    return ''.join(out)


def shadow_names(flat):
    return sorted(name for name in flat if name.startswith('shadow.'))


def shadow_css(entry):
    """Rebuild a CSS shadow from the DTCG parts the pack declared."""
    if not isinstance(entry, dict):
        return 'none'
    part = lambda key: pack_tokens_css.literal(entry.get(key, {'value': 0, 'unit': 'px'}))
    color = pack_tokens_css.literal(entry.get('color', {'components': [0, 0, 0], 'alpha': 0.12}))
    return f"{part('offsetX')} {part('offsetY')} {part('blur')} {part('spread')} {color}"


def short_token_name(name):
    """The leaf alone is ambiguous: `color.palette.violet.500` reads as just `500`."""
    parts = name.split('.')
    if len(parts) >= 4 and parts[1] == 'palette':
        return '.'.join(parts[-2:])
    return parts[-1]


def swatches(rows):
    if not rows:
        return '<p class="limit">선언된 토큰이 없다.</p>'
    cells = []
    for name, (value, raw) in rows.items():
        ratio = contrast(value)
        alias = f'<div class="r">→ {esc(raw)}</div>' if raw != value and raw.startswith('{') else ''
        if ratio is None:
            grade = ''
        else:
            mark = 'AA 본문' if ratio >= 4.5 else 'AA 큰글자' if ratio >= 3 else '본문 부적합'
            grade = f'<div class="r"><b>{ratio}:1</b> 흰 배경 · {mark}</div>'
        cells.append(
            f'<div class="sw"><div class="chip"><i style="background:{esc(value)}"></i></div>'
            f'<div class="n">{esc(short_token_name(name))}</div>'
            f'<div class="v">{esc(value)}</div>{alias}{grade}</div>')
    return '<div class="swatches">' + ''.join(cells) + '</div>'


def bars(rows):
    """Bars drawn as a share of the group's own largest value.

    A fixed pixel width was the first version and it lied twice: it overflowed the
    page at phone width, and once clamped it drew 772px and 360px as near-equal.
    A share of the group needs no clamp and stays inside any viewport.
    """
    if not rows:
        return ''
    sizes = {}
    for name, (value, _raw) in rows.items():
        if value.endswith('px'):
            try:
                sizes[name] = float(value[:-2])
            except ValueError:
                continue
    if not sizes:
        return ''
    largest = max(sizes.values()) or 1
    out = []
    for name, (value, _raw) in rows.items():
        if name not in sizes:
            continue
        share = max(sizes[name] / largest * 100, 0.6 if sizes[name] else 0)
        out.append(f'<div class="bar"><span class="n">{esc(name)}</span>'
                   f'<span class="track"><i style="width:{share:.2f}%"></i></span>'
                   f'<span class="v">{esc(value)}</span></div>')
    return '<div class="bars">' + ''.join(out) + '</div>'


# A frame below the fold never fires load on its own, so it would keep the fallback height
# and clip the variants. Fit on load, when it scrolls into view, and on resize.
IMPLEMENTATION_FRAME_SCRIPT = """<script>
const fitFrame = (frame) => {
  try {
    const body = frame.contentDocument && frame.contentDocument.body;
    if (body && body.scrollHeight) frame.style.height = (body.scrollHeight + 4) + 'px';
  } catch (error) { /* keep the fallback height */ }
};
const implFrames = Array.from(document.querySelectorAll('iframe.impl-frame'));
const implWatcher = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => entries.forEach((entry) => entry.isIntersecting && fitFrame(entry.target)), {rootMargin: '400px'})
  : null;
for (const frame of implFrames) {
  frame.addEventListener('load', () => fitFrame(frame));
  fitFrame(frame);
  if (implWatcher) implWatcher.observe(frame);
}
window.addEventListener('resize', () => implFrames.forEach(fitFrame));
</script>"""


# --- part contract (platty-mcp-ba-design-pack-review/references/page-structure.md) ----
# Every part answers the same four questions in the same order: what it is, what the
# designer decides, how it is changed, then the rows. A part without this block leaves a
# reviewer with no next action, which is how this page became read-only in practice.
PARTS = {
    'tokens': {
        'what': '화면에 쓸 수 있는 색·타이포·간격의 전부다. 여기 없는 값은 와이어프레임에서 쓸 수 없다.',
        'decide': '값이 제품과 맞는지, 없는 값이 필요한지 판단한다.',
        'routes': ['token'],
        'kinds': [],
    },
    'components': {
        'what': '4단계 와이어프레임이 그릴 수 있는 컴포넌트다. 팩에 계약이 있어도 여기 없으면 못 쓴다.',
        'decide': '목록이 맞는지, 지원 상태 축이 실제로 표현 가능한지 판단한다.',
        'routes': ['component-promote', 'component-contract'],
        'kinds': [],
    },
    'roles': {
        'what': '화면 유형 23개의 when·구성·상태·조판 계약이다. 3단계가 화면 목록을 여기서 뽑는다.',
        'decide': '네 문장이 맞는지 판단한다. 전부 AI 합성이고 아직 사람이 확인하지 않았다.',
        'routes': ['role'],
        'kinds': ['role'],
    },
    'recipes': {
        'what': '역할별 must / must_not / optional 규칙이다.',
        'decide': '규칙이 맞는지, 빠진 금지가 있는지 판단한다.',
        'routes': ['recipe'],
        'kinds': ['recipe'],
    },
    'guides': {
        'what': '모든 화면에 적용되는 설계 원칙과 사용성 검사다.',
        'decide': '유지할지, 문장을 고칠지 판단한다.',
        'routes': ['principle', 'usability'],
        'kinds': ['usability'],
    },
    'references': {
        'what': '전이 근거로 삼는 실제 화면이다. Figma 프레임과 실행 캡처가 섞여 있다.',
        'decide': '근거로 삼을지, 역할 지정이 맞는지 판단한다.',
        'routes': ['reference'],
        'kinds': ['reference'],
    },
}


def edit_routes_html(route_keys):
    """The seed, the regeneration command and the rule — read from pack_edit, not retyped."""
    try:
        import pack_edit
    except ImportError:
        return ''
    rows = []
    for key in route_keys:
        route = pack_edit.ROUTES.get(key)
        if not route:
            continue
        commands = ''.join(f'<code>{esc(command)}</code>' for command in route.get('regenerate', []))
        blocked = ' <span class="tag warn">형제 저장소 필요</span>' if route.get('needs_siblings') else ''
        rows.append(
            f'<tr><td>{esc(route["label"])}{blocked}</td>'
            f'<td class="mono">{esc(route["seed"])}</td>'
            f'<td>{commands or "<span class=\'muted\'>재생성 없음 — 정본 파일</span>"}</td></tr>')
    if not rows:
        return ''
    return ('<details class="howto"><summary>어떻게 고치나</summary>'
            '<div class="table"><table><thead><tr><th>대상</th><th>씨앗</th><th>재생성</th></tr></thead>'
            f'<tbody>{"".join(rows)}</tbody></table></div>'
            '<p class="muted">씨앗을 고친 뒤 <code>/ba-design-pack-edit</code>의 build로 새 버전을 만든다. '
            '팩은 판본이라 제자리에서 바뀌지 않는다.</p></details>')


def part_header(key, pending):
    part = PARTS.get(key)
    if not part:
        return ''
    count = pending.get(key)
    if count is None:
        badge = ''
    elif count:
        badge = f'<span class="tag warn">미판정 {count}</span>'
    else:
        badge = '<span class="tag">판정 완료</span>'
    return (f'<div class="part"><p class="part-what">{esc(part["what"])}</p>'
            f'<p class="part-decide"><b>판단할 것</b> — {esc(part["decide"])} {badge}</p>'
            f'{edit_routes_html(part["routes"])}</div>')


def pending_by_part(pack, decisions):
    """How many rows in each part still have no ruling."""
    try:
        import pack_approval
    except ImportError:
        return {}
    counts = {}
    for key, part in PARTS.items():
        if not part['kinds']:
            continue
        counts[key] = 0
    for row in pack_approval.items(pack):
        for key, part in PARTS.items():
            if row['kind'] in part['kinds'] and not decisions.get(row['id']):
                counts[key] = counts.get(key, 0) + 1
    return counts


def render_dashboard(pack, sections, pending, version):
    """Where to start, and what is left. A quiet page when nothing is pending."""
    cells = []
    for key, label, _ in sections:
        count = pending.get(key)
        if count is None:
            cells.append(f'<a class="tile done" href="#{key}"><b>{esc(label)}</b><span>판단 대상 아님</span></a>')
        elif count:
            cells.append(f'<a class="tile open" href="#{key}"><b>{esc(label)}</b><span>미판정 {count}</span></a>')
        else:
            cells.append(f'<a class="tile done" href="#{key}"><b>{esc(label)}</b><span>판정 완료</span></a>')
    total = sum(value for value in pending.values() if value)
    lead = ('아래에서 미판정이 남은 파트부터 본다. 각 파트 머리에 무엇을 판단하는지와 '
            '어떻게 고치는지가 적혀 있다.') if total else '남은 판정이 없다.'
    return (f'<section id="start"><h2>요약</h2>'
            f'<p class="lede">{lead}</p><div class="tiles">{"".join(cells)}</div></section>')


def render_decisions(pack_path, version, state):
    """How a ruling is recorded, with this pack already filled in."""
    path = esc(str(pack_path))
    return (
        '<p class="lede">판단은 이 화면이 아니라 승인 기록에 남는다. 승인은 팩 해시에 묶이므로 '
        '새 팩 버전에서는 다시 판단해야 한다.</p>'
        '<div class="table"><table><thead><tr><th>할 일</th><th>명령</th></tr></thead><tbody>'
        f'<tr><td>판정 시트 보기</td><td><code>python3 scripts/pack_approval.py sheet {path}</code></td></tr>'
        f'<tr><td>판정 화면 만들기</td><td><code>python3 scripts/pack_approval.py page {path}</code></td></tr>'
        f'<tr><td>판정 기록</td><td><code>python3 scripts/pack_approval.py record {path} --approver &lt;이름&gt;</code></td></tr>'
        f'<tr><td>현재 상태</td><td><code>python3 scripts/pack_approval.py status {path}</code></td></tr>'
        '</tbody></table></div>'
        f'<p class="muted">지금 {esc(str(state.get("approved", 0)))} / {esc(str(state.get("total", 0)))} 승인, '
        f'미판정 {esc(str(state.get("pending", 0)))}건.</p>')


def load_implementation_preview(pack_dir):
    """Rendered cases from the real implementation, when the survey put them next to the pack.

    This is the one thing on the page that does not come from the pack, so it carries its
    own commit and file hashes and is labelled as product implementation — a designer must
    never mistake it for what the engine draws.
    """
    if not pack_dir:
        return None
    path = Path(pack_dir) / 'component-preview.json'
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, UnicodeError, ValueError):
        return None


def implementation_block(preview, name):
    entry = (preview or {}).get('components', {}).get(name)
    if not entry or not entry.get('cases'):
        return ''
    # The app's Tailwind would repaint this page, so each strip renders inside its own
    # document. Isolation is the point: the review page must keep its own styling.
    cards = ''.join(
        f'<figure{" class=full" if case.get("fullWidth") else ""}>'
        f'<figcaption>{esc(case["label"])}</figcaption>'
        f'<div class="stage{" stage-full" if case.get("fullWidth") else ""}">{case["html"] or ""}</div></figure>'
        for case in entry['cases'] if not case.get('error'))
    if not cards:
        return ''
    document = (
        '<!doctype html><meta charset="utf-8"><style>' + preview.get('css', '') +
        'body{margin:0;font-family:"Pretendard","IBM Plex Sans KR",-apple-system,sans-serif}'
        '.strip{display:flex;flex-wrap:wrap;gap:10px;padding:12px}'
        'figure{margin:0;display:grid;gap:6px;justify-items:center}'
        'figcaption{font:11px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;color:#8C8993}'
        '.stage{display:flex;align-items:center;justify-content:center;min-height:44px;'
        'padding:8px 10px;border:1px dashed #E7E5EE;border-radius:8px;background:#fff}'
        '.strip figure.full{flex:1 0 100%}'
        '.stage-full>*{width:390px;flex:0 0 390px}'
        '</style><div class="strip">' + cards + '</div>')
    return (f'<div class="impl"><div class="impl-head">제품 구현 '
            f'<span class="mono">{esc(entry.get("sourceFile", ""))}</span> '
            f'<span class="mono">sha256:{esc((entry.get("sourceSha256") or "")[:12])}</span></div>'
            f'<iframe class="impl-frame" srcdoc="{esc(document)}"></iframe></div>')


def render_components(pack, preview=None):
    knowledge = pack.get('componentKnowledge', [])
    out = ['<p class="lede">와이어프레임이 실제로 쓸 수 있는 컴포넌트는 이 목록이 전부다. '
           '아래 그림은 4단계 엔진이 내보내는 것과 같은 마크업으로 그렸다.</p>']
    if preview:
        out.append(
            f'<div class="note"><b>제품 구현 미리보기가 함께 있다.</b> 각 컴포넌트 아래 띠는 '
            f'heroines-webview <span class="mono">{esc((preview.get("commit") or "")[:12])}</span>의 '
            f'실제 구현을 렌더한 것이고, 그 위의 그림은 엔진이 그리는 와이어프레임이다. '
            f'둘은 일부러 다르다 — 엔진은 계층과 토큰 없이 뼈대만 그린다. '
            f'{esc(preview.get("limitation", ""))}</div>')
    for row in knowledge:
        role = (row.get('roles') or ['section'])[0]
        semantic = ROLE_TO_SEMANTIC.get(role, role)
        name = row.get('component', row.get('ref', ''))
        states = row.get('supportedStates', [])
        drawable = [s for s in DRAWABLE_STATES if s in states]
        cells = [f'<div class="state"><div class="lbl">기본</div>'
                 f'<div class="demo"><main>{element_html(semantic, name)}</main></div></div>']
        for state in drawable:
            cells.append(f'<div class="state"><div class="lbl">{esc(state)}</div>'
                         f'<div class="demo"><main>{element_html(semantic, name, state)}</main></div></div>')
        iface = row.get('interface') or {}
        iface_text = (f"{iface.get('interface', '')} · {iface.get('file', '')}"
                      if iface else '닫힌 인터페이스 없음 — 네이티브 어댑터')
        origin = row.get('origin', '')
        origin_tag = ('<span class="tag warn">BA가 작성한 어댑터</span>' if origin == 'ba-authored-adapter'
                      else '<span class="tag">상류 계약에서 파생</span>')
        out.append(
            f'<div class="row"><span class="name">{esc(name)}</span>'
            f'<span class="id">{esc(row.get("ref", ""))}</span><br>{origin_tag}'
            f'<span class="tag">{esc(row.get("kind", ""))}</span>'
            f'<span class="tag">role: {esc(role)}</span>'
            f'<div class="states">{"".join(cells)}</div>'
            f'{implementation_block(preview, name)}'
            f'<dl><dt>지원 상태</dt><dd class="mono">{esc(", ".join(states))}</dd>'
            f'<dt>인터페이스</dt><dd class="mono">{esc(iface_text)}</dd>'
            f'<dt>출처</dt><dd>{esc(row.get("authority", ""))}</dd></dl>'
            f'<p class="limit">한계 — {esc(row.get("limitation", ""))}</p></div>')

    promoted = {row.get('component', '') for row in knowledge}
    interfaces = pack.get('componentProps', {}).get('interfaces', [])
    candidates = []
    seen = set()
    for row in interfaces:
        name = (row.get('interface') or '').replace('Props', '')
        if not name or name in seen or name in promoted:
            continue
        seen.add(name)
        candidates.append((name, row.get('file', '')))
    out.append(f'<h3>아직 승격되지 않은 계약 <span class="tag">{len(candidates)}개</span></h3>')
    out.append('<p class="lede">팩에 닫힌 props 계약이 이미 있지만 <code>componentKnowledge</code>에 없어서 '
               '와이어프레임이 쓸 수 없다. 승격하려면 지원 상태를 사람이 판단해 '
               '<code>build-pack.py</code>에 행을 추가해야 한다 — '
               '<code>/ba-design-pack-edit</code>의 <code>promote-component</code>가 그 일을 한다.</p>')
    out.append('<div class="table"><table><thead><tr><th>컴포넌트</th><th>선언 위치</th></tr></thead><tbody>'
               + ''.join(f'<tr><td>{esc(n)}</td><td class="mono">{esc(f)}</td></tr>'
                         for n, f in sorted(candidates))
               + '</tbody></table></div>')
    return ''.join(out)


def render_roles(pack, decisions):
    out = ['<p class="lede">3단계가 화면·상태·조판을 여기서 도출한다. 기획자에게 묻지 않는다.</p>']
    for row in pack.get('roles', []):
        ruling = decisions.get('role:' + row.get('id', ''))
        status = row.get('status', '')
        tag = f'<span class="tag warn">{esc(status)}</span>' if 'pending' in status else f'<span class="tag">{esc(status)}</span>'
        if ruling:
            tag += f'<span class="tag">판정: {esc(ruling.get("status", ""))}</span>'
        composition = ' → '.join(row.get('composition', []))
        out.append(
            f'<div class="row"><span class="name">{esc(row.get("label", ""))}</span>'
            f'<span class="id">{esc(row.get("id", ""))}</span><br>{tag}'
            f'<dl><dt>언제 쓰나</dt><dd>{esc(row.get("when", ""))}</dd>'
            f'<dt>구성 순서</dt><dd>{esc(composition)}</dd>'
            f'<dt>상태 계약</dt><dd>{esc(row.get("stateContract", ""))}</dd>'
            f'<dt>조판 계약</dt><dd>{esc(row.get("layoutContract", ""))}</dd>'
            f'<dt>근거 화면</dt><dd>{len(row.get("screens", []))}개</dd></dl>'
            + (('<ul class="plain">' + ''.join(f'<li>{esc(x)}</li>' for x in row.get('exceptions', []))
                + '</ul>') if row.get('exceptions') else '')
            + f'<p class="limit">출처 — {esc(row.get("source", ""))}</p></div>')
    return ''.join(out)


def render_recipes(pack, decisions):
    out = ['<p class="lede">must는 지켜야 하는 것, must_not은 하지 말아야 하는 것이다. '
           'must_not은 도메인 중립이라 모든 화면에 적용된다.</p>']
    for row in pack.get('recipeRules', []):
        ruling = decisions.get('recipe:' + row.get('type', ''))
        tag = f'<span class="tag warn">{esc(row.get("status", ""))}</span>'
        if ruling:
            tag += f'<span class="tag">판정: {esc(ruling.get("status", ""))}</span>'
        blocks = []
        for key, label in (('must', '반드시'), ('must_not', '하지 않는다'), ('optional', '선택')):
            values = row.get(key) or []
            if values:
                blocks.append(f'<dt>{label}</dt><dd><ul class="plain">'
                              + ''.join(f'<li>{esc(x)}</li>' for x in values) + '</ul></dd>')
        out.append(
            f'<div class="row"><span class="name">{esc(row.get("type", ""))}</span>'
            f'<span class="id">표본 {row.get("sample_count", 0)}개</span><br>{tag}'
            f'<dl><dt>언제</dt><dd>{esc(row.get("when", ""))}</dd>'
            f'<dt>적용 화면 역할</dt><dd>{esc(", ".join(row.get("appliesTo") or [row.get("type", "")]))}</dd>'
            f'{"".join(blocks)}</dl></div>')
    return ''.join(out)


def render_guides(pack, decisions):
    out = []
    principles = pack.get('principles', {})
    rows = principles.get('principles', [])
    out.append(f'<h3>설계 원칙 <span class="tag">{len(rows)}개</span></h3>')
    out.append(f'<p class="lede">출처 — {esc(principles.get("source", ""))}. '
               f'{esc(principles.get("heuristicPolicy", ""))}</p>')
    for row in rows:
        out.append(
            f'<div class="row"><span class="name">{esc(row.get("title", ""))}</span>'
            f'<span class="id">{esc(row.get("id", ""))}</span>'
            f'<dl><dt>개념</dt><dd>{esc(row.get("concept", ""))}</dd>'
            f'<dt>설계 적용</dt><dd>{esc(row.get("application", ""))}</dd>'
            f'<dt>위험</dt><dd>{esc(row.get("risk", ""))}</dd></dl></div>')

    checks = pack.get('usability', [])
    out.append(f'<h3>사용성 검사 <span class="tag">{len(checks)}개</span></h3>')
    for row in checks:
        ruling = decisions.get('usability:' + row.get('id', ''))
        tag = f'<span class="tag">판정: {esc(ruling.get("status", ""))}</span>' if ruling else ''
        out.append(
            f'<div class="row"><span class="name">{esc(row.get("name", ""))}</span>'
            f'<span class="id">{esc(row.get("id", ""))}</span> {tag}'
            f'<dl><dt>목적</dt><dd>{esc(row.get("purpose", ""))}</dd>'
            f'<dt>위험</dt><dd>{esc(row.get("risk", ""))}</dd>'
            f'<dt>검사 방법</dt><dd>{esc(row.get("check", ""))}</dd>'
            f'<dt>증거 방식</dt><dd class="mono">{esc(row.get("evidenceMode", ""))}</dd></dl></div>')
    return ''.join(out)


def render_references(pack, decisions, pack_dir, out_dir):
    rows = pack.get('references', [])
    out = [f'<p class="lede">4단계가 참조 전이의 근거로 고르는 실제 화면 {len(rows)}장이다. '
           '제품 요구가 아니라 시각 근거다. 여기 축소판은 위쪽만 보여준다 — '
           '참조 전이를 적기 전에 <b>전체 화면을 열어서 본다.</b></p>']
    figures = []
    for row in rows:
        local = row.get('localPath', '')
        source = (pack_dir / local).resolve()
        href = relative_href(source, out_dir)
        ruling = decisions.get('reference:' + row.get('id', ''))
        tag = f' · 판정 {esc(ruling.get("status", ""))}' if ruling else ''
        # A capture is one screen in one state; naming the route and state is what lets a
        # designer tell two captures of the same role apart.
        route = row.get('route', '')
        state_label = row.get('state', '')
        where = (f'<span class="mono">{esc(route)}</span>'
                 + (f' · {esc(state_label)} 상태' if state_label else '') + '<br>') if route else ''
        figures.append(
            f'<figure><a href="{esc(href)}" target="_blank" rel="noopener">'
            f'<img src="{esc(href)}" alt="{esc(route or row.get("role", ""))} 참조 화면" loading="lazy"></a>'
            f'<figcaption><b>{esc(row.get("role", ""))}</b>{tag}<br>'
            f'{where}'
            f'<span class="mono">{esc(row.get("id", ""))}</span><br>'
            f'{esc(row.get("limitation", ""))}<br>'
            f'<a href="{esc(href)}" target="_blank" rel="noopener">전체 화면 열기</a>'
            f'</figcaption></figure>')
    out.append('<div class="shots">' + ''.join(figures) + '</div>')
    return ''.join(out)


def relative_href(target, out_dir):
    try:
        import os
        return os.path.relpath(target, out_dir).replace('\\', '/')
    except ValueError:
        return target.as_uri()


def render(pack, pack_path, out_path, approval):
    pack_dir = Path(pack_path).parent
    out_dir = Path(out_path).parent
    table, flat = token_table(pack)
    decisions = approval.get('decisions', {})
    version = pack.get('version', '')
    digest = approval.get('pack_hash', '')

    state = approval.get('state', {})
    if state.get('pending'):
        banner = (f'<div class="note warn"><b>승인 {state.get("approved", 0)} / {state.get("total", 0)}'
                  f' · 미판정 {state.get("pending", 0)}</b> — 역할 행은 '
                  f'<b>AI synthesis; human approval pending</b>, 레시피는 <b>draft</b> 상태다. '
                  '승인 전에는 아래 규칙 위에서 나온 화면 전체가 사람이 확인하지 않은 합성 위에 놓인다. '
                  '승인은 <code>scripts/pack_approval.py</code>에서 팩 버전마다 한 번 기록한다.</div>')
    elif state.get('stale'):
        banner = ('<div class="note warn"><b>승인 기록이 낡았다</b> — 승인한 뒤 팩이 바뀌었다. '
                  '기록된 판정은 지금 이 팩을 설명하지 않는다.</div>')
    else:
        banner = (f'<div class="note"><b>승인 완료</b> · {esc(state.get("approver", ""))} · '
                  f'{esc(state.get("recorded_at", ""))}</div>')

    sections = [
        ('tokens', '토큰', render_tokens(table, flat)),
        ('components', '컴포넌트', render_components(pack, load_implementation_preview(pack_dir))),
        ('roles', '화면 역할', render_roles(pack, decisions)),
        ('recipes', '레시피 규칙', render_recipes(pack, decisions)),
        ('guides', '원칙과 검사', render_guides(pack, decisions)),
        ('references', '참조 화면', render_references(pack, decisions, pack_dir, out_dir)),
    ]
    pending = pending_by_part(pack, decisions)
    dashboard = render_dashboard(pack, sections, pending, version)
    sections = [(key, label, part_header(key, pending) + html) for key, label, html in sections]
    sections.append(('decisions', '판정 기록', render_decisions(pack_path, version, state)))
    toc = '<a href="#start">요약</a>' + ''.join(f'<a href="#{key}">{esc(label)}</a>' for key, label, _ in sections)
    body = ''.join(f'<section id="{key}"><h2>{esc(label)}</h2>{html}</section>'
                   for key, label, html in sections)

    provenance = pack.get('rowProvenance', [])
    sources = ''.join(
        f'<tr><td>{esc(r.get("collection", ""))}</td><td class="mono">{esc(r.get("sourcePath", ""))}</td>'
        f'<td>{esc(r.get("authority", ""))}</td></tr>' for r in provenance)

    return (
        f'<!doctype html><html lang="ko"><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>디자인 지식 팩 — {esc(version)}</title>'
        f'<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
        f'family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap">'
        f'<style>{STYLE}</style>'
        f'<div class="wrap">'
        f'<header><h1>디자인 지식 팩</h1>'
        f'<p class="sub">{esc(version)} · <code>{esc(digest[:16])}</code></p></header>'
        f'{banner}'
        f'<div class="note">이 문서는 팩만 읽어 만들어졌다. 여기 없는 색·컴포넌트·규칙은 '
        f'와이어프레임에서 쓸 수 없고, 여기 있는 값은 상류 HDS에서 온 것이다. '
        f'고치려면 <code>/ba-design-pack-edit</code>을 쓴다 — 팩은 판본이라 제자리에서 수정되지 않는다.</div>'
        f'<nav class="toc">{toc}</nav>'
        f'{dashboard}'
        f'{body}'
        f'<section id="provenance"><h2>출처</h2>'
        f'<div class="table"><table><thead><tr><th>컬렉션</th><th>상류 경로</th><th>권위</th></tr></thead>'
        f'<tbody>{sources}</tbody></table></div></section>'
        f'</div>{IMPLEMENTATION_FRAME_SCRIPT}</html>\n')


def resolve_pack_path(value):
    """A pack path or `<pack-id>/<version>` spec under the configured workspace."""
    candidate = Path(value)
    if candidate.suffix == '.json' and candidate.exists():
        return candidate.resolve()
    for guess in (WORKSPACE_ROOT / 'design-knowledge' / value / 'pack.json',
                  candidate / 'pack.json'):
        if guess.exists():
            return guess.resolve()
    raise ValueError(f'cannot find a pack for {value!r}')


def latest_pack():
    found = sorted((WORKSPACE_ROOT / 'design-knowledge').glob('*/*/pack.json'))
    if not found:
        raise ValueError('no design knowledge pack found')
    return found[-1].resolve()


MEDIA_TYPES = {'.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif'}


def embed_images(page, base_dir):
    """Inline referenced images so the page survives being copied or sent.

    A review page whose images live beside it breaks the moment someone moves the
    file — and a reviewer who sees broken screenshots reviews nothing.
    """
    import base64
    cache = {}

    def data_uri(path):
        if path not in cache:
            source = (base_dir / path).resolve()
            media = MEDIA_TYPES.get(source.suffix.lower())
            if not media or not source.is_file():
                cache[path] = None
            else:
                cache[path] = f'data:{media};base64,' + base64.b64encode(source.read_bytes()).decode('ascii')
        return cache[path]

    def replace(match):
        attribute, path = match.group(1), match.group(2)
        if path.startswith(('data:', 'http:', 'https:')):
            return match.group(0)
        uri = data_uri(path)
        if not uri:
            return match.group(0)
        # The same screenshot is linked two or three times per figure. Inlining it once
        # and letting the links borrow it keeps the page a third of the size.
        if attribute == 'href':
            return 'href="#" data-open-image="1"'
        return f'src="{uri}"'

    page = re.sub(r'\b(src|href)="([^"]+\.(?:png|webp|jpe?g|gif))"', replace, page)
    if 'data-open-image' in page:
        page += ('\n<script>\n'
                 'for (const link of document.querySelectorAll(\'a[data-open-image]\')) {\n'
                 '  const figure = link.closest("figure");\n'
                 '  const image = figure && figure.querySelector("img");\n'
                 '  if (!image) continue;\n'
                 '  link.addEventListener("click", (event) => {\n'
                 '    event.preventDefault();\n'
                 '    const tab = window.open();\n'
                 '    if (tab) tab.document.write(\'<img src="\' + image.src + \'" style="max-width:100%">\');\n'
                 '  });\n'
                 '}\n</script>\n')
    return page


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pack', nargs='?', help='pack.json path, "<id>/<version>", or a version')
    parser.add_argument('-o', '--output', type=Path, help='default: <pack dir>/pack-review.html')
    parser.add_argument('--self-contained', action='store_true',
                        help='embed reference images in the page so it can be moved or sent on its own')
    args = parser.parse_args()
    try:
        pack_path = resolve_pack_path(args.pack) if args.pack else latest_pack()
        pack = json.loads(pack_path.read_text(encoding='utf-8'))
        out_path = (args.output or pack_path.parent / 'pack-review.html').resolve()
        approval = {'decisions': {}, 'state': {}, 'pack_hash': ''}
        try:
            import pack_approval
            approval['state'] = pack_approval.status(pack_path)
            approval['pack_hash'] = pack_approval.pack_hash(pack_path)
            record = pack_approval.record_path(pack_path)
            if record.exists():
                approval['decisions'] = pack_approval.load_json(record).get('decisions') or {}
        except (OSError, UnicodeError, ValueError, KeyError, ImportError):
            pass
        out_path.parent.mkdir(parents=True, exist_ok=True)
        page = render(pack, pack_path, out_path, approval)
        if args.self_contained:
            page = embed_images(page, out_path.parent)
        out_path.write_text(page, encoding='utf-8')
    except (OSError, UnicodeError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print(json.dumps({'error': str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({
        'pack': str(pack_path),
        'version': pack.get('version', ''),
        'output': str(out_path),
        'tokens': len(token_table(pack)[0]),
        'components': len(pack.get('componentKnowledge', [])),
        'roles': len(pack.get('roles', [])),
        'recipes': len(pack.get('recipeRules', [])),
        'references': len(pack.get('references', [])),
        'approval': approval['state'],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
