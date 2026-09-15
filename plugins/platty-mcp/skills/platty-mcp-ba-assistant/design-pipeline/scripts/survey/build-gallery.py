#!/usr/bin/env python3
"""Design pack survey — local capture gallery.

Writes one HTML page next to the captures so a designer can see every screen at once.
Stays local on purpose: captures carry live product and campaign content.
"""
import argparse
import html
import json
from pathlib import Path

TEMPLATE = """<!doctype html>
<meta charset="utf-8">
<title>page/store 화면 캡처 — {commit_short}</title>
<style>
:root{{color-scheme:light dark;--ink:#17141f;--ink2:#55506a;--line:#e2deea;--ground:#faf9fc;--card:#fff;--accent:#5b45d6}}
@media (prefers-color-scheme:dark){{:root{{--ink:#eceaf3;--ink2:#aba5bf;--line:#2e2a3c;--ground:#121019;--card:#1b1826;--accent:#a897ff}}}}
body{{margin:0;background:var(--ground);color:var(--ink);font:14px/1.6 "IBM Plex Sans KR",-apple-system,sans-serif}}
main{{max-width:1400px;margin:0 auto;padding:32px 20px 80px}}
h1{{font-size:24px;margin:0 0 6px}}
p.meta{{color:var(--ink2);margin:0 0 24px;font-size:13px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px}}
figure{{margin:0;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}}
figure img{{width:100%;display:block;border-bottom:1px solid var(--line);background:#fff}}
figcaption{{padding:10px 12px;font-size:12.5px;display:grid;gap:4px}}
figcaption b{{font-weight:600;word-break:break-all}}
figcaption span{{color:var(--ink2)}}
.v{{display:inline-block;font:11px/1 ui-monospace,monospace;padding:3px 6px;border-radius:999px;border:1px solid var(--line)}}
.rendered{{color:#107154}}.blank{{color:#b42318}}.error-state{{color:#8a5a00}}
a{{color:var(--accent)}}
</style>
<main>
<h1>page/store 화면 캡처</h1>
<p class="meta">{commit} · {captured} · {viewport}<br>{mode}<br>실데이터가 포함된 사내 자료입니다. 외부 공유 금지.</p>
<div class="grid">
{cards}
</div>
</main>
"""

CARD = """<figure>
  <a href="{shot}" target="_blank" rel="noopener"><img src="{shot}" alt="{route}" loading="lazy"></a>
  <figcaption><b>{route}</b><span class="v {verdict}">{verdict}</span><span>{sample}</span></figcaption>
</figure>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--captures", required=True)
    args = ap.parse_args()
    root = Path(args.captures)
    manifest = json.loads((root / "capture-manifest.json").read_text(encoding="utf-8"))
    cards = []
    for row in manifest["results"]:
        if not row.get("screenshot"):
            continue
        cards.append(CARD.format(
            shot=html.escape(row["screenshot"]),
            route=html.escape(row["routePath"]),
            verdict=html.escape(row["renderVerdict"]),
            sample=html.escape((row.get("textSample") or "(빈 화면)").replace("\n", " · ")[:90]),
        ))
    page = TEMPLATE.format(
        commit=html.escape(manifest["commit"]),
        commit_short=html.escape(manifest["commit"][:8]),
        captured=html.escape(manifest["capturedAt"]),
        viewport=html.escape(manifest["viewport"]),
        mode=html.escape(manifest["mode"]),
        cards="\n".join(cards),
    )
    (root / "gallery.html").write_text(page, encoding="utf-8")
    print(str(root / "gallery.html"))


if __name__ == "__main__":
    main()
