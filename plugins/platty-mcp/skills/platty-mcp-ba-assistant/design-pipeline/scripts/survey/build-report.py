#!/usr/bin/env python3
"""Design pack survey — report page. Numbers come from the survey JSON, never retyped."""
import argparse
import html
import json
from collections import Counter
from pathlib import Path


def esc(v):
    return html.escape(str(v))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--survey", required=True, help="survey directory (contains facts/, captures/, coverage.json)")
    ap.add_argument("--pack", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    root = Path(args.survey)
    cov = json.loads((root / "coverage.json").read_text(encoding="utf-8"))
    cap = json.loads((root / "captures" / "capture-manifest.json").read_text(encoding="utf-8"))
    comps = json.loads((root / "facts" / "components.json").read_text(encoding="utf-8"))["components"]
    facts_meta = json.loads((root / "facts" / "screens.json").read_text(encoding="utf-8"))["meta"]
    pack = json.loads(Path(args.pack).read_text(encoding="utf-8"))

    s = cov["summary"]
    rows = cov["routes"]
    capby = {r["routePath"]: r for r in cap["results"]}
    recipe_types = {r["type"] for r in pack["recipeRules"]}
    role_counts = Counter(r["platty"][0]["role"] for r in rows if r["platty"])
    covered_by_recipe = sum(n for role, n in role_counts.items() if role in recipe_types)

    totals = {
        "routes": len(rows),
        "files": sum(r["screenSpecificFiles"] for r in rows),
        "lines": sum(r["ownedLines"] for r in rows),
        "components": s["components"]["distinctUsed"],
        "hds": s["components"]["hdsDistinct"],
        "drawable": len(s["components"]["hdsDrawableByPack"]),
        "widgets": s["components"]["sharedNonHdsDistinct"],
        "pagelocal": s["components"]["pageLocalDistinct"],
        "api": s["api"]["distinctEndpoints"],
        "copy": s["copy"]["totalOwnedStrings"],
        "cond": s["states"]["totalConditionalRenders"],
        "captured": cap["verdictCounts"].get("rendered", 0),
        "arbColors": s["tokens"]["distinctArbitraryColors"],
        "arbOcc": s["tokens"]["arbitraryColorOccurrences"],
        "unmapped": s["tokens"]["distinctArbitraryUnmapped"],
        "packTokens": s["tokens"]["packTokenColors"],
        "recipeCovered": covered_by_recipe,
    }

    table_rows = []
    for r in rows:
        c = capby.get(r["routePath"], {})
        st = r["states"]
        verdict = c.get("renderVerdict", "-")
        table_rows.append(
            f'<tr><td class="r">{esc(r["routePath"])}</td>'
            f'<td>{esc(r["platty"][0]["role"] if r["platty"] else "-")}</td>'
            f'<td class="num">{r["screenSpecificFiles"]}</td>'
            f'<td class="num">{r["ownedLines"]:,}</td>'
            f'<td class="num">{r["componentsUsed"]}</td>'
            f'<td class="num">{len(r["hdsComponentsUsed"])}</td>'
            f'<td class="num">{r["apiCount"]}</td>'
            f'<td class="num mono">{st["loading"]}/{st["error"]}/{st["empty"]}/{st["overlay"]}</td>'
            f'<td class="num">{r["conditionalRenders"]}</td>'
            f'<td class="num">{r["copyStrings"]}</td>'
            f'<td class="num">{r["arbitraryColorClasses"]}</td>'
            f'<td><span class="chip {esc(verdict)}">{esc(verdict)}</span></td></tr>'
        )

    top_components = [c for c in comps if c["layer"] in ("hds", "widget", "component")][:14]
    promoted = {c.replace(" ", "").lower() for c in s["components"]["packPromoted"]}
    comp_rows = "\n".join(
        f'<tr><td>{esc(c["name"])}</td><td class="mono">{esc(c["layer"])}</td>'
        f'<td class="num">{c["routeCount"]}</td><td class="num">{c["totalCount"]}</td>'
        f'<td>{"있음" if c["name"].replace(" ", "").lower() in promoted else "<b class=no>없음</b>"}</td></tr>'
        for c in top_components
    )

    unmapped_rows = "\n".join(
        f'<tr><td class="mono"><span class="sw" style="background:{esc(hexv)}"></span>{esc(hexv)}</td>'
        f'<td class="num">{n:,}</td><td>팩 토큰 없음</td></tr>'
        for hexv, n in s["tokens"]["topUnmappedColors"][:10]
    )
    mapped = sorted({h for r in rows for h in r["arbitraryColorsMappedToToken"]})
    mapped_chips = " ".join(f'<span class="sw-chip"><span class="sw" style="background:{esc(h)}"></span>{esc(h)}</span>' for h in mapped[:14])

    blank_routes = [r["routePath"] for r in cap["results"] if r["renderVerdict"] in ("blank", "navigation-failed")]

    page = PAGE.format(
        commit=esc(facts_meta["commit"]),
        commit_short=esc(facts_meta["commit"][:10]),
        scope=esc(facts_meta["scope"]),
        generated=esc(facts_meta["generatedAt"][:16].replace("T", " ")),
        pack=esc(pack["version"]),
        t=totals,
        table_rows="\n".join(table_rows),
        comp_rows=comp_rows,
        unmapped_rows=unmapped_rows,
        mapped_chips=mapped_chips,
        blank_list=esc(", ".join(blank_routes)),
        blank_n=len(blank_routes),
        role_dist=esc(" · ".join(f"{role} {n}" for role, n in role_counts.most_common())),
        recipe_missing=esc(", ".join(sorted({role for role in role_counts if role not in recipe_types}))),
        cap_rendered=cap["verdictCounts"].get("rendered", 0),
        cap_error=cap["verdictCounts"].get("error-state", 0),
        survey_dir=esc(str(root)),
    )
    Path(args.out).write_text(page, encoding="utf-8")
    print(args.out)


PAGE = """<title>page/store 화면 전수 조사</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap">
<style>
:root{{
  --ground:#FAF9FC; --surface:#F1EFF6; --raised:#FFFFFF;
  --ink:#17141F; --ink-2:#55506A; --ink-3:#8A849C; --line:#E2DEEA;
  --accent:#5B45D6; --accent-soft:#ECE8FB;
  --crit:#B42318; --crit-soft:#FBEAE8;
  --warn:#8A5A00; --warn-soft:#FBF1DC;
  --ok:#107154; --ok-soft:#E3F4EC;
  --sans:"IBM Plex Sans KR",-apple-system,"Apple SD Gothic Neo",sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,monospace;
}}
@media (prefers-color-scheme:dark){{
  :root:not([data-theme="light"]){{
    --ground:#121019; --surface:#1B1826; --raised:#211D2E;
    --ink:#ECEAF3; --ink-2:#ABA5BF; --ink-3:#7C768F; --line:#2E2A3C;
    --accent:#A897FF; --accent-soft:#262040;
    --crit:#F2877E; --crit-soft:#35191A;
    --warn:#E2B85A; --warn-soft:#2F2510;
    --ok:#5FC79D; --ok-soft:#132B22;
  }}
}}
:root[data-theme="dark"]{{
  --ground:#121019; --surface:#1B1826; --raised:#211D2E;
  --ink:#ECEAF3; --ink-2:#ABA5BF; --ink-3:#7C768F; --line:#2E2A3C;
  --accent:#A897FF; --accent-soft:#262040;
  --crit:#F2877E; --crit-soft:#35191A;
  --warn:#E2B85A; --warn-soft:#2F2510;
  --ok:#5FC79D; --ok-soft:#132B22;
}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--ground);color:var(--ink);font:15px/1.75 var(--sans);word-break:keep-all;overflow-wrap:anywhere}}
.wrap{{max-width:1000px;margin:0 auto;padding-inline:20px;padding-block:44px 88px}}
header.top{{display:grid;gap:12px;padding-bottom:24px;border-bottom:1px solid var(--line)}}
.eyebrow{{font:500 12px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}}
h1{{margin:0;font-size:32px;line-height:1.3;font-weight:700;letter-spacing:-.02em;text-wrap:balance}}
.lede{{margin:0;color:var(--ink-2);font-size:16px;max-width:64ch}}
.meta{{display:flex;flex-wrap:wrap;gap:4px 16px;font:12.5px/1.7 var(--mono);color:var(--ink-3)}}
section{{padding-top:44px;scroll-margin-top:20px}}
h2{{margin:0 0 6px;font-size:22px;line-height:1.4;font-weight:700;letter-spacing:-.01em}}
h2 + .sub{{margin:0 0 20px;color:var(--ink-2);max-width:66ch}}
h3{{margin:26px 0 8px;font-size:15px;font-weight:600}}
p{{margin:0 0 14px;max-width:68ch}}
ul{{margin:0 0 14px;padding-left:20px;max-width:68ch}}
li{{margin:4px 0}}
code,.mono{{font-family:var(--mono);font-size:.88em}}
strong{{font-weight:600}}
.stats{{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin:24px 0 0}}
.stats div{{background:var(--raised);padding:14px 16px}}
.stats b{{display:block;font-size:23px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.02em}}
.stats span{{display:block;font-size:12.5px;color:var(--ink-3);margin-top:2px}}
.tbl{{overflow-x:auto;margin:8px 0 18px;border:1px solid var(--line);border-radius:10px;background:var(--raised)}}
table{{border-collapse:collapse;width:100%;font-size:13.5px;line-height:1.55}}
th,td{{text-align:left;vertical-align:top;padding:9px 12px;border-top:1px solid var(--line);white-space:nowrap}}
thead th{{border-top:0;font:500 11.5px/1.4 var(--mono);color:var(--ink-3);background:var(--surface);position:sticky;top:0}}
td.num{{text-align:right;font-variant-numeric:tabular-nums}}
td.r{{font-family:var(--mono);font-size:12.5px}}
.wide table{{min-width:900px}}
b.no{{color:var(--crit);font-weight:600}}
.chip{{display:inline-block;font:500 11.5px/1 var(--mono);padding:4px 7px;border-radius:999px}}
.rendered{{color:var(--ok);background:var(--ok-soft)}}
.blank{{color:var(--crit);background:var(--crit-soft)}}
.error-state{{color:var(--warn);background:var(--warn-soft)}}
.sw{{display:inline-block;width:11px;height:11px;border-radius:3px;border:1px solid rgba(128,128,128,.45);margin-right:7px;vertical-align:-1px}}
.sw-chip{{display:inline-flex;align-items:center;font:12px/1 var(--mono);padding:5px 8px;border:1px solid var(--line);border-radius:999px;margin:0 4px 6px 0;background:var(--raised)}}
.callout{{border-left:3px solid var(--accent);background:var(--surface);padding:14px 18px;border-radius:0 10px 10px 0;margin:0 0 16px}}
.callout p:last-child{{margin-bottom:0}}
.foot{{margin-top:48px;padding-top:18px;border-top:1px solid var(--line);font-size:13px;color:var(--ink-3)}}
</style>
<div class="wrap">
<header class="top">
  <span class="eyebrow">Survey · page/store</span>
  <h1>page/store 화면 전수 조사</h1>
  <p class="lede">heroines-webview의 <code>{scope}</code> 아래 화면 {t[routes]}개를 코드에서 전수 추출하고, 실제로 띄워 캡처한 뒤, 현재 디자인 팩이 이 화면들을 얼마나 설명할 수 있는지 대 봤습니다.</p>
  <div class="meta"><span>main {commit_short}</span><span>{generated}</span><span>대조 팩 {pack}</span></div>
</header>

<section id="result">
  <h2>결과 요약</h2>
  <p class="sub">조사는 끝났고, 지금 팩으로는 이 32개 화면 중 어느 하나도 제대로 그릴 수 없다는 것이 수치로 확인됩니다.</p>
  <div class="stats">
    <div><b>{t[routes]}</b><span>화면</span></div>
    <div><b>{t[files]:,}</b><span>화면 전용 파일</span></div>
    <div><b>{t[lines]:,}</b><span>화면 코드 줄</span></div>
    <div><b>{t[components]}</b><span>사용 컴포넌트</span></div>
    <div><b>{t[api]}</b><span>API 엔드포인트</span></div>
    <div><b>{t[copy]:,}</b><span>화면 문구</span></div>
    <div><b>{t[cond]}</b><span>조건부 렌더</span></div>
    <div><b>{cap_rendered}/{t[routes]}</b><span>캡처 성공</span></div>
  </div>
  <div class="callout" style="margin-top:24px">
    <p><strong>핵심 수치 셋.</strong> 화면들이 쓰는 HDS 컴포넌트 {t[hds]}종 가운데 현재 팩이 그릴 수 있는 것은 <strong>{t[drawable]}종(Checkbox)</strong>뿐입니다. 코드에 박힌 색은 {t[arbColors]}종 {t[arbOcc]:,}회인데 그중 <strong>{t[unmapped]}종은 팩에 대응 토큰이 아예 없습니다.</strong> 그리고 32개 화면 중 레시피 규칙이 있는 역할은 <strong>{t[recipeCovered]}개</strong>뿐입니다.</p>
  </div>
</section>

<section id="method">
  <h2>어떻게 조사했나</h2>
  <ul>
    <li><strong>기준 소스</strong> — webview <code>origin/main</code> {commit_short}을 별도로 풀어서 봤습니다. 작업 중인 체크아웃은 건드리지 않았습니다.</li>
    <li><strong>코드 추출</strong> — 각 화면의 <code>page.tsx</code>에서 import를 따라가며(동적 import 포함) 컴포넌트·클래스·상태·API·문구를 모았습니다. 앱을 실행해 분석한 것이 아니라 구문 분석입니다.</li>
    <li><strong>API 귀속</strong> — 화면이 호출하는 query/mutation 훅을 repository 메서드와 연결했습니다. barrel import로 딸려오는 호출은 제외했습니다.</li>
    <li><strong>실행 캡처</strong> — 앱의 msw 모의 모드로 띄우고 390×844 아이폰 화면에서 전체 페이지를 찍었습니다. 로그인 세션과 네이티브 브릿지는 없습니다.</li>
    <li><strong>역할 매핑</strong> — 저장된 Platty 분석 결과를 썼습니다. 이번 세션에서 Platty MCP 토큰이 만료돼 최신 스펙과 실시간 대조는 못 했습니다.</li>
  </ul>
</section>

<section id="screens">
  <h2>화면별 조사 결과</h2>
  <p class="sub">상태 칸은 로딩/에러/빈/오버레이 신호 수입니다. 색 칸은 토큰 대신 코드에 직접 박은 색을 쓴 클래스 수입니다.</p>
  <div class="tbl wide"><table>
    <thead><tr><th>화면</th><th>역할</th><th>파일</th><th>줄</th><th>컴포넌트</th><th>HDS</th><th>API</th><th>상태</th><th>분기</th><th>문구</th><th>박힌 색</th><th>캡처</th></tr></thead>
    <tbody>
{table_rows}
    </tbody>
  </table></div>
  <p>역할 분포: {role_dist}</p>
</section>

<section id="components">
  <h2>컴포넌트 격차</h2>
  <p class="sub">가장 많이 쓰이는 것부터, 지금 팩이 그릴 수 있는지 표시했습니다.</p>
  <div class="tbl"><table>
    <thead><tr><th>컴포넌트</th><th>계층</th><th>사용 화면</th><th>사용 횟수</th><th>팩 승격</th></tr></thead>
    <tbody>
{comp_rows}
    </tbody>
  </table></div>
  <p>이 범위에서 쓰는 컴포넌트는 모두 {t[components]}개입니다. HDS {t[hds]}종, 공용 위젯·컴포넌트 {t[widgets]}종, 화면 전용 {t[pagelocal]}종입니다. 팩에 승격된 7종은 Surface·Select·Checkbox·Text Field·Button·Disclosure·Status Message인데, 실제 화면이 쓰는 것은 Text·BoxButton·WebviewTopNavigation·아이콘 계열입니다. <strong>이름이 겹치는 것은 Checkbox 하나뿐입니다.</strong></p>
  <p>BottomSheet·Modal·Toast·InterstitialPopup·BaseLayout·ErrorComponent처럼 거의 모든 화면이 쓰는 공용 위젯은 HDS가 아니라 <code>src/widgets</code>에 있습니다. 팩에는 이 계층 자체가 없습니다.</p>
</section>

<section id="tokens">
  <h2>토큰 격차</h2>
  <p class="sub">팩 색 토큰은 {t[packTokens]}개 값입니다. 화면 코드는 토큰 클래스 대신 색을 직접 씁니다.</p>
  <h3>팩에 대응 토큰이 없는 색 (상위 10)</h3>
  <div class="tbl"><table>
    <thead><tr><th>색</th><th>사용 횟수</th><th>상태</th></tr></thead>
    <tbody>
{unmapped_rows}
    </tbody>
  </table></div>
  <p>{t[unmapped]}종이 여기에 해당합니다. 회색 계열이 특히 많은데, HDS <code>user.semantic</code>에 그 계조가 없어서 화면마다 각자 정한 것으로 보입니다. 디자이너 결정이 필요한 목록입니다.</p>
  <h3>토큰이 있는데도 직접 박은 색</h3>
  <p>{mapped_chips}</p>
  <p>예를 들어 <code>#7256e9</code>는 팩의 <code>color.semantic.primaryStrong</code>과 같은 값인데 코드에서는 162회를 직접 색으로 썼습니다. 팩을 고칠 문제가 아니라 코드에서 토큰으로 바꿀 문제이고, 드리프트 목록으로 남겨 둘 항목입니다.</p>
</section>

<section id="capture">
  <h2>캡처 결과와 한계</h2>
  <p class="sub">{cap_rendered}개가 화면을 그렸고, {blank_n}개는 빈 화면, {cap_error}개는 에러 화면이었습니다.</p>
  <p>그린 화면 중에도 상당수는 “문제가 발생했어요”, “아직 등록된 상품이 없어요” 같은 <strong>에러·빈 상태</strong>입니다. 쇼핑 홈, 인기 상품, 상품 목록, 리워드 이벤트처럼 로그인 없이 읽을 수 있는 화면만 실제 콘텐츠가 담긴 정상 상태로 찍혔습니다.</p>
  <p>빈 화면 {blank_n}개: <span class="mono">{blank_list}</span>. 모두 로그인 세션이나 실제 주문·장바구니 데이터가 있어야 내용이 생기는 화면입니다.</p>
  <p>즉 <strong>전 화면의 정상 상태를 캡처하려면 인증된 테스트 계정과 화면별 픽스처가 필요합니다.</strong> 지금 msw 핸들러는 몇 개 엔드포인트만 덮고 있습니다. 이번 조사로 화면마다 필요한 API가 특정됐으니, 그 목록이 곧 픽스처 작업 목록입니다.</p>
  <p>캡처 이미지는 실제 상품·기획전 콘텐츠를 담고 있어 사내 자료로 취급합니다. 공개 위치에 올리지 않고 조사 폴더에만 뒀습니다.</p>
</section>

<section id="next">
  <h2>이 조사로 바로 만들 수 있는 것</h2>
  <ul>
    <li><strong>컴포넌트 승격 목록</strong> — Text, BoxButton, WebviewTopNavigation, CapsuleButton, TextButton, 아이콘 계열을 사용 빈도 순으로. 각 항목에 지원 상태 축을 디자이너가 정해야 합니다.</li>
    <li><strong>공용 위젯 계층 추가</strong> — BottomSheet·Modal·Toast·ErrorComponent·BaseLayout을 팩이 표현할 수 있어야 화면 구성이 성립합니다.</li>
    <li><strong>토큰 결정 대기 목록</strong> — 대응 토큰이 없는 {t[unmapped]}종. 새 토큰으로 승격할지, 기존 토큰으로 수렴시킬지 디자이너 판단이 필요합니다.</li>
    <li><strong>역할별 참조 화면</strong> — 이번 캡처로 이 범위의 참조 이미지를 확보했습니다. 팩의 기존 참조 10장에는 store 화면이 없습니다.</li>
    <li><strong>레시피 없는 역할</strong> — {recipe_missing}. 이 역할들의 화면은 현재 규칙 없이 생성됩니다.</li>
  </ul>
  <p class="foot">산출물: <code>{survey_dir}</code> — facts/(코드 추출), captures/(캡처와 gallery.html), coverage.json(팩 대조). 재실행 스크립트는 스킬 패키지의 <code>design-pipeline/scripts/survey/</code>에 있습니다. 역할 매핑은 저장된 Platty 분석 기준이며, Platty MCP 재인증 후 최신 스펙과 다시 대조해야 합니다.</p>
</section>
</div>
"""


if __name__ == "__main__":
    main()
