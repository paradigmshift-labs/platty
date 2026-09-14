#!/usr/bin/env python3
"""Put a design knowledge pack's synthesized rows in front of a human, and record the answer.

Stage 3 derives screens, states and layout from the pack. Those rows ship as
`AI synthesis; human approval pending`, so until someone signs them the screen inventory
rests on synthesis nobody checked. This emits the review sheet and pins the decision to a
pack revision.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

STATUSES = ('approved', 'held', 'rejected')
RECORD_NAME = 'approval.json'
PAGE_TEMPLATE = '<title>디자인 지식 팩 승인</title>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap">\n<style>\n:root{\n  --primary:#7256E9; --primary-soft:#F4EFFF;\n  --ink:#0E0B1A; --ink-2:#4A4658; --ink-3:#8C8993;\n  --ground:#FFFFFF; --surface:#F8F8F8; --line:#E7E5EE;\n  --ok:#0A66C2; --ok-soft:#EAF2FB;\n  --hold:#8A6410; --hold-soft:#FBF3DE;\n  --no:#B3261E; --no-soft:#FBECEA;\n  --sans:"Pretendard","IBM Plex Sans KR",-apple-system,"Apple SD Gothic Neo",sans-serif;\n  --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,monospace;\n}\n@media (prefers-color-scheme:dark){\n  :root:not([data-theme="light"]){\n    --primary:#A995FF; --primary-soft:#241E3D;\n    --ink:#EDEBF5; --ink-2:#B3AEC4; --ink-3:#7E7995;\n    --ground:#141121; --surface:#1C1830; --line:#2C2743;\n    --ok:#6FB3FF; --ok-soft:#152438;\n    --hold:#E0B252; --hold-soft:#2E2512;\n    --no:#F09189; --no-soft:#33191A;\n  }\n}\n:root[data-theme="dark"]{\n  --primary:#A995FF; --primary-soft:#241E3D;\n  --ink:#EDEBF5; --ink-2:#B3AEC4; --ink-3:#7E7995;\n  --ground:#141121; --surface:#1C1830; --line:#2C2743;\n  --ok:#6FB3FF; --ok-soft:#152438;\n  --hold:#E0B252; --hold-soft:#2E2512;\n  --no:#F09189; --no-soft:#33191A;\n}\n*{box-sizing:border-box}\nbody{margin:0;background:var(--ground);color:var(--ink);font-family:var(--sans);\n  font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}\n.wrap{max-width:860px;margin:0 auto;padding-inline:20px;padding-block:0 96px}\ncode,.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}\n\nheader{padding-block:40px 24px;border-bottom:1px solid var(--line)}\nh1{margin:0 0 6px;font-size:27px;line-height:1.25;font-weight:700;letter-spacing:-.02em;text-wrap:balance}\n.sub{margin:0;color:var(--ink-2);font-size:14px}\n.sub code{color:var(--ink-3);font-size:12.5px}\n\n.why{margin-block:24px;padding:18px 20px;background:var(--surface);border-radius:10px}\n.why p{margin:0;font-size:13.5px;line-height:1.7;color:var(--ink-2)}\n.why b{color:var(--ink);font-weight:600}\n\n.brief{margin-block:24px;display:grid;gap:1px;background:var(--line);\n  border-radius:10px;overflow:hidden;border:1px solid var(--line)}\n.brief div{background:var(--ground);padding:13px 16px;display:flex;gap:14px;align-items:baseline}\n.brief .n{font-family:var(--mono);font-size:17px;font-weight:500;color:var(--primary);\n  min-width:46px;font-variant-numeric:tabular-nums}\n.brief .t{font-size:13.5px;color:var(--ink-2);line-height:1.5}\n.brief .t b{color:var(--ink);font-weight:600}\n\n.bar{position:sticky;top:0;z-index:5;background:var(--ground);\n  border-bottom:1px solid var(--line);padding-block:12px;\n  display:flex;gap:10px;align-items:center;flex-wrap:wrap}\n.chips{display:flex;gap:6px;flex-wrap:wrap}\n.chip{appearance:none;border:1px solid var(--line);background:transparent;color:var(--ink-2);\n  font:inherit;font-size:12.5px;padding:5px 11px;border-radius:999px;cursor:pointer}\n.chip[aria-pressed="true"]{background:var(--primary);border-color:var(--primary);color:#fff}\n.track{flex:1;min-width:120px;height:5px;border-radius:999px;background:var(--line);overflow:hidden}\n.track i{display:block;height:100%;background:var(--primary);width:0;transition:width .25s}\n.count{font-family:var(--mono);font-size:12.5px;color:var(--ink-2);font-variant-numeric:tabular-nums}\n\nh2{margin:40px 0 2px;font-size:12px;font-weight:600;letter-spacing:.1em;\n  text-transform:uppercase;color:var(--ink-3)}\nh2+p{margin:0 0 4px;font-size:13.5px;color:var(--ink-2)}\n\n/* The pack forbids a border and a shadow on every row, so this list obeys it. */\n.item{border-top:1px solid var(--line);padding:20px 0 20px 14px;position:relative}\n.item::before{content:"";position:absolute;left:0;top:20px;bottom:20px;width:3px;\n  border-radius:2px;background:var(--line)}\n.item[data-d="approved"]::before{background:var(--ok)}\n.item[data-d="held"]::before{background:var(--hold)}\n.item[data-d="rejected"]::before{background:var(--no)}\n.item[hidden]{display:none}\n.head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}\n.id{font-family:var(--mono);font-size:12px;color:var(--ink-3)}\n.name{font-weight:600;font-size:16px}\n.flags{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}\n.flag{font-size:11.5px;padding:3px 8px;border-radius:5px;background:var(--hold-soft);color:var(--hold)}\n.rec{margin:10px 0 0;font-size:13px;line-height:1.6;padding:9px 12px;border-radius:7px;background:var(--surface);color:var(--ink-2)}\n.rec b{display:block;font-size:12px;font-weight:600;margin-bottom:2px}\n.rec-held b{color:var(--hold)} .rec-rejected b{color:var(--no)} .rec-review b{color:var(--ink-3)}\n.shot{display:block;margin:12px 0 0;width:100%;max-width:300px;height:auto;border:1px solid var(--line);border-radius:8px;background:var(--surface)}\n\ndl{margin:12px 0 0;display:grid;grid-template-columns:104px 1fr;gap:5px 14px;font-size:13.5px}\ndt{color:var(--ink-3);font-size:12.5px;padding-top:1px}\ndd{margin:0;color:var(--ink-2);overflow-wrap:anywhere}\ndd .mono{font-size:12.5px}\n\n.seg{margin-top:14px;display:flex;gap:6px;flex-wrap:wrap}\n.seg button{appearance:none;font:inherit;font-size:13px;padding:7px 15px;border-radius:7px;\n  border:1px solid var(--line);background:transparent;color:var(--ink-2);cursor:pointer}\n.seg button:hover{border-color:var(--ink-3)}\n.seg button[aria-pressed="true"]{font-weight:600}\n.seg button[data-v="approved"][aria-pressed="true"]{background:var(--ok-soft);border-color:var(--ok);color:var(--ok)}\n.seg button[data-v="held"][aria-pressed="true"]{background:var(--hold-soft);border-color:var(--hold);color:var(--hold)}\n.seg button[data-v="rejected"][aria-pressed="true"]{background:var(--no-soft);border-color:var(--no);color:var(--no)}\n.note{margin-top:10px;width:100%;font:inherit;font-size:13.5px;padding:9px 11px;\n  border:1px solid var(--line);border-radius:7px;background:var(--surface);color:var(--ink)}\n.note::placeholder{color:var(--ink-3)}\n.note[hidden]{display:none}\n.need{border-color:var(--no)}\n\n.dock{position:fixed;left:0;right:0;bottom:0;background:var(--ground);\n  border-top:1px solid var(--line);padding:12px 20px;display:flex;gap:12px;\n  align-items:center;justify-content:center;flex-wrap:wrap}\n.dock .inner{width:100%;max-width:860px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}\n.dock .count{flex:1;min-width:150px}\nbutton.act{appearance:none;font:inherit;font-size:13.5px;font-weight:600;padding:10px 18px;\n  border-radius:8px;border:1px solid var(--primary);background:var(--primary);color:#fff;cursor:pointer}\nbutton.ghost{background:transparent;color:var(--ink-2);border-color:var(--line);font-weight:400}\n:focus-visible{outline:2px solid var(--primary);outline-offset:2px}\n@media (prefers-reduced-motion:reduce){*{transition:none!important}}\n@media (max-width:520px){dl{grid-template-columns:1fr;gap:2px}dt{padding-top:8px}}\n</style>\n\n<div class="wrap">\n  <header>\n    <h1>디자인 지식 팩 승인</h1>\n    <p class="sub">__VERSION__ · <code>__HASH__</code></p>\n  </header>\n\n  <div class="why">\n    <p>3단계는 화면·상태·조판을 이 팩에서 도출하고 기획자에게 묻지 않는다. 그런데 역할 행은\n    <b>AI synthesis; human approval pending</b>, 레시피는 <b>draft</b> 상태다. 승인 전에는\n    화면 목록 전체가 사람이 확인하지 않은 합성 위에 놓인다. 케이스마다가 아니라\n    <b>팩 버전마다 한 번</b> 승인하며, 승인은 팩 해시에 묶인다.</p>\n  </div>\n\n  <div class="brief" id="brief"></div>\n\n  <div class="bar">\n    <div class="chips" id="filters"></div>\n    <div class="track"><i id="fill"></i></div>\n    <span class="count" id="progress">0 / __TOTAL__</span>\n  </div>\n\n  <main id="list"></main>\n</div>\n\n<div class="dock">\n  <div class="inner">\n    <span class="count" id="tally"></span>\n    <button class="act ghost" id="reset" type="button">판정 지우기</button>\n    <button class="act" id="copy" type="button">decisions.json 복사</button>\n  </div>\n</div>\n\n<script>\nconst DATA = __DATA__;\nconst KEY = "pack-approval:" + DATA.version;\nconst LABEL = {approved:"승인", held:"보류", rejected:"기각"};\nconst KIND = {role:"역할", recipe:"레시피", usability:"검사 항목", reference:"참조"};\nlet decisions = {};\ntry { decisions = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { decisions = {}; }\n\nfunction save(){ try { localStorage.setItem(KEY, JSON.stringify(decisions)); } catch (e) {} }\n\nconst brief = document.getElementById("brief");\nfor (const row of DATA.brief) {\n  const el = document.createElement("div");\n  el.innerHTML = \'<span class="n"></span><span class="t"></span>\';\n  el.querySelector(".n").textContent = row.count;\n  el.querySelector(".t").innerHTML = row.text;\n  brief.append(el);\n}\n\nconst filters = [["all","전체"],["role","역할"],["recipe","레시피"],["usability","검사 항목"],["reference","참조"],\n                 ["pending","미판정"],["judge","직접 확인 필요"],["flagged","위험 표시"]];\nlet active = "all";\nconst bar = document.getElementById("filters");\nfor (const [value, label] of filters) {\n  const b = document.createElement("button");\n  b.className = "chip"; b.type = "button"; b.textContent = label;\n  b.setAttribute("aria-pressed", String(value === active));\n  b.addEventListener("click", () => { active = value; paintFilters(); apply(); });\n  b.dataset.v = value; bar.append(b);\n}\nfunction paintFilters(){\n  for (const b of bar.children) b.setAttribute("aria-pressed", String(b.dataset.v === active));\n}\n\nconst list = document.getElementById("list");\nlet lastKind = null;\nfor (const item of DATA.items) {\n  if (item.kind !== lastKind) {\n    lastKind = item.kind;\n    const h = document.createElement("h2");\n    h.textContent = KIND[item.kind];\n    const p = document.createElement("p");\n    p.textContent = DATA.intro[item.kind];\n    list.append(h, p);\n  }\n  const el = document.createElement("article");\n  el.className = "item"; el.id = "item-" + item.id; el.dataset.kind = item.kind;\n  el.dataset.flagged = item.flags.length ? "1" : "";\n  el.dataset.judge = item.recommend === "review" ? "1" : "";\n\n  const head = document.createElement("div");\n  head.className = "head";\n  const id = document.createElement("span"); id.className = "id"; id.textContent = item.id;\n  const name = document.createElement("span"); name.className = "name"; name.textContent = item.name;\n  head.append(name, id);\n  el.append(head);\n\n  if (item.why) {\n    var rec = document.createElement("p");\n    rec.className = "rec rec-" + (item.recommend || "review");\n    var recTitle = document.createElement("b");\n    recTitle.textContent = item.recommend && item.recommend !== "review"\n      ? "추천: " + LABEL[item.recommend] : "직접 확인";\n    var body = document.createElement("span");\n    body.textContent = item.why;\n    rec.append(recTitle, body);\n    el.append(rec);\n  }\n\n  if (item.flags.length) {\n    const flags = document.createElement("div"); flags.className = "flags";\n    for (const text of item.flags) {\n      const f = document.createElement("span"); f.className = "flag"; f.textContent = text;\n      flags.append(f);\n    }\n    el.append(flags);\n  }\n\n  if (item.image) {\n    var shot = document.createElement("img");\n    shot.className = "shot";\n    shot.src = item.image;\n    shot.alt = item.name + " 참조 화면";\n    shot.loading = "lazy";\n    el.append(shot);\n  }\n\n  const dl = document.createElement("dl");\n  for (const [key, value] of item.fields) {\n    const dt = document.createElement("dt"); dt.textContent = key;\n    const dd = document.createElement("dd"); dd.textContent = value;\n    if (key === "수치" || key === "경로" || key === "참조 화면") dd.className = "mono";\n    dl.append(dt, dd);\n  }\n  el.append(dl);\n\n  const seg = document.createElement("div"); seg.className = "seg";\n  for (const value of ["approved","held","rejected"]) {\n    const b = document.createElement("button");\n    b.type = "button"; b.dataset.v = value; b.textContent = LABEL[value];\n    b.addEventListener("click", () => {\n      const current = decisions[item.id];\n      if (current && current.status === value) delete decisions[item.id];\n      else decisions[item.id] = {status:value, note:(current && current.note) || ""};\n      save(); paintItem(item, el); tally(); apply();\n    });\n    seg.append(b);\n  }\n  el.append(seg);\n\n  const note = document.createElement("input");\n  note.className = "note"; note.type = "text"; note.id = "note-" + item.id;\n  note.placeholder = "보류·기각 사유 (필수)";\n  note.addEventListener("input", () => {\n    if (!decisions[item.id]) return;\n    decisions[item.id].note = note.value; save(); paintItem(item, el); tally();\n  });\n  el.append(note);\n  list.append(el);\n  paintItem(item, el);\n}\n\nfunction paintItem(item, el){\n  const row = decisions[item.id];\n  el.dataset.d = row ? row.status : "";\n  for (const b of el.querySelector(".seg").children)\n    b.setAttribute("aria-pressed", String(!!row && row.status === b.dataset.v));\n  const note = el.querySelector(".note");\n  const needs = !!row && row.status !== "approved";\n  note.hidden = !needs;\n  if (needs) { note.value = row.note || ""; note.classList.toggle("need", !row.note.trim()); }\n}\n\nfunction apply(){\n  for (const el of list.querySelectorAll(".item")) {\n    const row = decisions[el.id.slice(5)];\n    el.hidden =\n      active in KIND ? el.dataset.kind !== active\n      : active === "pending" ? !!row\n      : active === "judge" ? !el.dataset.judge\n      : active === "flagged" ? !el.dataset.flagged\n      : false;\n  }\n}\n\nfunction tally(){\n  const rows = Object.values(decisions);\n  const n = {approved:0, held:0, rejected:0};\n  for (const row of rows) n[row.status] = (n[row.status] || 0) + 1;\n  const missing = rows.filter(r => r.status !== "approved" && !r.note.trim()).length;\n  document.getElementById("progress").textContent = rows.length + " / " + DATA.items.length;\n  document.getElementById("fill").style.width =\n    (rows.length / DATA.items.length * 100).toFixed(1) + "%";\n  document.getElementById("tally").textContent =\n    "승인 " + n.approved + " · 보류 " + n.held + " · 기각 " + n.rejected +\n    " · 미판정 " + (DATA.items.length - rows.length) +\n    (missing ? " · 사유 없는 판정 " + missing : "");\n}\n\ndocument.getElementById("copy").addEventListener("click", async (event) => {\n  const body = JSON.stringify(decisions, null, 2);\n  try {\n    await navigator.clipboard.writeText(body);\n    event.target.textContent = "복사됨";\n  } catch (e) {\n    const box = document.createElement("textarea");\n    box.value = body; box.className = "note"; box.rows = 8;\n    box.style.display = "block";\n    document.querySelector(".wrap").append(box); box.select();\n    event.target.textContent = "아래에서 직접 복사";\n  }\n  setTimeout(() => { event.target.textContent = "decisions.json 복사"; }, 2200);\n});\n\ndocument.getElementById("reset").addEventListener("click", () => {\n  decisions = {}; save();\n  for (const el of list.querySelectorAll(".item")) {\n    const item = DATA.items.find(i => "item-" + i.id === el.id);\n    paintItem(item, el);\n  }\n  tally(); apply();\n});\n\ntally(); apply();\n</script>\n'


def load_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def pack_hash(pack_path):
    """The same fingerprint the stage bindings pin, so both go stale together."""
    import design_system_wireframe
    return design_system_wireframe.knowledge_pack_fingerprint(Path(pack_path))


# 종류가 세 군데에 하드코딩돼 있어서, `usability`를 승인 항목으로 넣자 검토지·승인 페이지·
# 추천이 각각 다른 데서 터졌다. 종류는 한 곳에서 정한다.
KIND_LABELS = {'role': '역할', 'recipe': '레시피', 'usability': '검사 항목', 'reference': '참조'}


def items(pack):
    """Every row a reviewer has to rule on, with what they need to rule on it."""
    found = []
    for role in pack.get('roles', []):
        found.append({
            'kind': 'role', 'id': 'role:' + role['id'], 'name': role.get('label', role['id']),
            'declared_status': role.get('status', ''),
            'detail': {
                'type': role.get('type', ''),
                'when': role.get('when', ''),
                'composition': role.get('composition', []),
                'stateContract': role.get('stateContract', ''),
                'layoutContract': role.get('layoutContract', ''),
                'screens': len(role.get('screens', [])),
            },
        })
    for recipe in pack.get('recipeRules', []):
        found.append({
            'kind': 'recipe', 'id': 'recipe:' + recipe['type'], 'name': recipe['type'],
            'declared_status': recipe.get('status', ''),
            'detail': {
                'sample_count': recipe.get('sample_count', 0),
                'must': len(recipe.get('must') or []),
                'optional': len(recipe.get('optional') or []),
                'must_not': len(recipe.get('must_not') or []),
                'exemplars': len(recipe.get('exemplars') or []),
            },
        })
    # 3단계 스킬의 파생 매니페스트가 「검사 항목 ← usability N01~N10」이라고 시키는데,
    # 이 열 행에는 승인 항목 id가 없어서 **시킨 대로 인용하면 3단계가 막혔다**(7차 실측).
    # 그 결과 로딩·실패·복구 상태의 실제 근거가 역할의 stateContract로만 가리켜져
    # 한 단계 흐려졌다. 이 행들도 사람이 판정해야 하는 것이다 — 목적·위험·검사 방법을 갖고 있다.
    for heuristic in pack.get('usability', []):
        found.append({
            'kind': 'usability', 'id': 'usability:' + heuristic['id'],
            'name': heuristic.get('name', heuristic['id']),
            'declared_status': heuristic.get('status', ''),
            'detail': {
                'purpose': heuristic.get('purpose', ''),
                'risk': heuristic.get('risk', ''),
                'check': heuristic.get('check', ''),
                'evidenceMode': heuristic.get('evidenceMode', ''),
            },
        })
    for reference in pack.get('references', []):
        found.append({
            'kind': 'reference', 'id': 'reference:' + reference['id'],
            'name': reference.get('role', reference['id']),
            'declared_status': reference.get('authority', ''),
            'detail': {
                'path': reference.get('localPath', ''),
                'limitation': reference.get('limitation', ''),
            },
        })
    return found


def consistency(pack):
    """The gaps a reviewer would otherwise have to find by reading two lists side by side."""
    roles = {row['type'] for row in pack.get('roles', [])}
    recipes = {role for row in pack.get('recipeRules', [])
               for role in (row.get('appliesTo') or [row['type']])}
    unbound = sorted(row['type'] for row in pack.get('recipeRules', [])
                     if any(role not in roles for role in (row.get('appliesTo') or [row['type']])))
    referenced = {row.get('role', '') for row in pack.get('references', [])}
    return {
        'roles_without_recipe': sorted(roles - recipes),
        'recipes_without_role': unbound,
        'recipes_without_samples': sorted(row['type'] for row in pack.get('recipeRules', [])
                                          if not row.get('sample_count')),
        'roles_without_reference': sorted(roles - referenced),
    }


# Where each collection comes from upstream; the builder reads these paths.
SOURCE_FILES = {
    'recipe': 'recipes/validation-input.json',
    'reference': 'inventory/figma-frames.jsonl',
    'role': 'expansion/type-rules.json',
}
# Rules filed at role level that describe a state of another role, not a screen of their own.
MISFILED = {
    'blocked': 'apply',
    'waiting': 'mission',
    'select-notice': 'cart',
}


# Corrections confirmed by opening the frame. A label not listed here is reported without
# a guess, because naming a role for a screen nobody looked at is the failure being fixed.
SEEN_REFERENCES = {
    'qO7H6YMiVXzaFY5nmv10Ck:1326:12244': ('resubmit',
        '리뷰 인증 수정요청 화면이다. `수정요청` 뱃지와 「기준에 맞지 않아 수정이 필요해요」, '
        '필수 정보 1~3을 짚어주는 주석, 「제출한 사진 수정하기」가 있다. 라벨은 Figma 기본 '
        '프레임명이 그대로 들어왔다.'),
    'qO7H6YMiVXzaFY5nmv10Ck:2443:86538': ('account',
        '계좌 정보 입력하기 화면의 **미입력** 상태다. 전부 placeholder이고 저장 체크가 꺼져 '
        '있으며 완료 버튼이 비활성이다. 라벨에 상위 플로우 경로가 들어왔다.'),
    'qO7H6YMiVXzaFY5nmv10Ck:2443:86563': ('account',
        '같은 계좌 정보 입력하기 화면의 **입력 완료** 상태다. 예금주·은행·계좌번호가 채워지고 '
        '저장 체크가 켜지며 완료 버튼이 활성이다. 앞 프레임과 중복이 아니라 다른 상태다.'),
}


def reference_role_gaps(pack):
    """References whose role names no role. Reference transfer can never find them."""
    roles = {row['type'] for row in pack.get('roles', [])}
    found = []
    for row in pack.get('references', []):
        label = row.get('role', '')
        if label in roles:
            continue
        suggest, why = SEEN_REFERENCES.get(row['id'], ('', ''))
        found.append({'id': row['id'], 'label': label, 'suggest': suggest,
                      'seen': bool(suggest), 'path': row.get('localPath', ''),
                      'why': why or f'`{label}`은 역할 목록에 없다. 이 프레임이 어느 역할의 '
                                    f'대표인지 화면을 열어 정해야 한다.'})
    return found


def when_overlaps(pack):
    """Role pairs whose `when` clauses share enough vocabulary to be confused.

    Two roles that read alike are the failure a taxonomy review exists to catch, and it is
    the one part of a role a reader can check without knowing the product.
    """
    import re
    # Connectives and bare verbs of doing carry no meaning about which screen this is.
    stop = {'또는', '그리고', '확인하고', '확인할', '변경할', '전달할', '때에', '하는'}
    words = {}
    for role in pack.get('roles', []):
        tokens = {token for token in re.split(r'[^0-9A-Za-z가-힣]+', role.get('when', ''))
                  if len(token) >= 2 and token not in stop}
        words[role['id']] = tokens
    found = {}
    names = sorted(words)
    for index, left in enumerate(names):
        for right in names[index + 1:]:
            shared = words[left] & words[right]
            if shared:
                found.setdefault(left, []).append((right, sorted(shared)))
                found.setdefault(right, []).append((left, sorted(shared)))
    return found


def recommendations(pack):
    """A reasoned proposal per row. Never `approved` — recording one is the reviewer's act.

    Structural findings are decidable from the pack alone. Whether a role's `when` actually
    describes the product's screens is not; that is why the review exists.
    """
    roles = {row['type'] for row in pack.get('roles', [])}
    recipes = {row['type'] for row in pack.get('recipeRules', [])}
    referenced = {row.get('role', '') for row in pack.get('references', [])}
    by_type = {row['type']: row for row in pack.get('recipeRules', [])}
    overlaps = when_overlaps(pack)
    rows = []
    for item in items(pack):
        name, detail = item['id'], item['detail']
        row = {'id': name, 'kind': item['kind'], 'name': item['name'],
               'overlaps': [], 'recommend': 'review',
               'confidence': 'needs_product_knowledge', 'why': ''}
        if item['kind'] == 'role':
            kind_type = detail['type']
            missing = ([] if kind_type in recipes else ['recipeRule']) + \
                      ([] if kind_type in referenced else ['참조 화면'])
            row['overlaps'] = [{'with': other, 'shared': shared}
                               for other, shared in overlaps.get(name.split(':', 1)[1], [])]
            if missing:
                row.update(recommend='held', confidence='structural',
                           why=f"{' · '.join(missing)}이 없다. 승인해도 이 역할로는 "
                               f"{'상호작용 규칙 없이 조판만' if 'recipeRule' in missing else '행 조판을'} "
                               f"얻지 못한다. 팩이 채워진 뒤 다시 본다.")
            else:
                row['why'] = (f"규칙·참조·사례를 모두 갖췄고 참조 화면 {detail['screens']}건이 붙어 있다. "
                              f"`when`이 실제 화면을 맞게 서술하는지는 제품을 아는 사람만 판단할 수 있다.")
            if row['overlaps']:
                row['why'] += (' 다른 역할과 `when` 어휘가 겹친다: '
                               + ', '.join(o['with'] for o in row['overlaps']) + '.')
        elif item['kind'] == 'recipe':
            if item['name'] not in roles:
                host = MISFILED.get(item['name'], '다른 역할')
                row.update(recommend='rejected', confidence='structural',
                           why=f'역할 목록에 없는 유형을 가리켜 영원히 발동하지 않는다. 내용은 '
                               f'{host}의 상태를 서술하므로 상태 규칙으로 옮겨야 한다.')
            elif not detail['sample_count']:
                row.update(recommend='held', confidence='structural',
                           why='근거 사례 0건으로 합성된 규칙이다. 사례 없이는 그 도메인 안에서도 '
                               '신뢰할 수 없다.')
            else:
                row['why'] = (f"사례 {detail['sample_count']}건에서 합성됐다. must "
                              f"{detail['must']}·must_not {detail['must_not']}이 실제 화면과 맞는지는 "
                              f"제품을 아는 사람만 판단할 수 있다."
                              + (' 사례가 3건 미만이라 도메인 밖 일반화는 피해야 한다.'
                                 if detail['sample_count'] < 3 else ''))
        elif item['kind'] == 'usability':
            # 이 열 행은 3단계가 「검사 항목」으로 인용하는 휴리스틱이다. 구조로는 판정할 것이
            # 없고(목적·위험·검사 방법이 모두 적혀 있다), 이 제품에서 그 위험이 실제로
            # 일어나는지는 제품을 아는 사람만 안다.
            row['why'] = (f"{detail['risk']}를 막기 위한 검사 항목이다. 검사 방법은 "
                          f"「{detail['check']}」이고 증거는 {detail['evidenceMode']}로 남는다. "
                          f"이 위험이 이 제품에서 실제로 일어나는지는 제품을 아는 사람만 판단할 수 있다.")
        else:
            row['why'] = (f"{detail['limitation']} 이 프레임이 `{item['name']}` 역할의 대표로 "
                          f"맞는지는 실제 화면을 아는 사람만 판단할 수 있다.")
        rows.append(row)
    return rows


def write_recommendations(pack_path):
    """Write the proposal beside the pack. This is not an approval and never becomes one."""
    pack = load_json(pack_path)
    path = Path(pack_path).parent / 'recommendations.json'
    written = {
        'pack_version': f'{Path(pack_path).parent.parent.name}/{Path(pack_path).parent.name}',
        'pack_hash': pack_hash(pack_path),
        'note': '판정 추천이며 승인이 아니다. 승인은 pack_approval.py record로 사람이 기록한다.',
        'recommendations': recommendations(pack),
    }
    with path.open('w', encoding='utf-8') as out:
        json.dump(written, out, ensure_ascii=False, indent=2)
        out.write('\n')
    return path


def supplement(pack):
    """What the upstream repo must add before this pack can ground a derivation.

    The rules and frames are produced in the design-system repo, so they cannot be written
    into a generated pack. This names the order and where each item belongs.
    """
    roles = {row['type'] for row in pack.get('roles', [])}
    recipes = {role for row in pack.get('recipeRules', [])
               for role in (row.get('appliesTo') or [row['type']])}
    referenced = {row.get('role', '') for row in pack.get('references', [])}
    by_type = {row['type']: row for row in pack.get('recipeRules', [])}
    rows = []
    for row in pack.get('recipeRules', []):
        name = row['type']
        unmatched = sorted(role for role in (row.get('appliesTo') or [name]) if role not in roles)
        if not unmatched:
            continue
        host = ', '.join(unmatched) or MISFILED.get(name)
        rows.append({
            'id': 'recipe:' + name, 'action': 'refile', 'where': SOURCE_FILES['recipe'],
            'why': f'역할 목록에 없는 유형이다. 화면 역할이 아니라 '
                   f'{host or "다른 역할"}의 **상태**를 서술한다. 상태 규칙으로 옮기거나 '
                   f'역할을 신설할지 정해야 한다.',
        })
    for name in sorted(roles - recipes):
        rows.append({
            'id': 'role:type-' + name, 'action': 'add_recipe', 'where': SOURCE_FILES['recipe'],
            'why': '이 역할로 화면을 도출하면 상호작용 규칙 없이 조판만 나온다. '
                   '실제 화면에서 뽑은 must/must_not이 필요하다.',
        })
    for name in sorted(roles - referenced):
        rows.append({
            'id': 'role:type-' + name, 'action': 'add_reference',
            'where': SOURCE_FILES['reference'],
            'why': '참조 화면이 없으면 레시피가 일반화를 거부할 때 행 조판을 얻을 경로가 없다. '
                   'high-confidence 프레임 한 장이 필요하다.',
        })
    for row in reference_role_gaps(pack):
        rows.append({
            'id': 'reference:' + row['id'], 'action': 'relabel',
            'where': SOURCE_FILES['reference'],
            'why': row['why'] + (f" → `{row['suggest']}`로 고친다."
                                 if row['suggest'] else ''),
        })
    for name in sorted(name for name, row in by_type.items() if not row.get('sample_count')):
        if name in roles:
            rows.append({
                'id': 'recipe:' + name, 'action': 'add_samples', 'where': SOURCE_FILES['recipe'],
                'why': '근거 사례 0건으로 합성된 규칙이다. 사례 없이는 그 도메인 안에서도 '
                       '규칙을 신뢰할 수 없다.',
            })
    totals = {}
    for row in rows:
        totals[row['action']] = totals.get(row['action'], 0) + 1
    ready = sorted(name for name in roles
                   if name in recipes and name in referenced and by_type[name].get('sample_count'))
    # A relabel is cheap and unblocks a role that already has its rule and samples.
    unblocks = sorted({row['suggest'] for row in reference_role_gaps(pack)
                       if row['suggest'] and row['suggest'] in recipes
                       and by_type[row['suggest']].get('sample_count')})
    return {'items': rows, 'totals': totals, 'ready_roles': ready,
            'relabel_unblocks': unblocks, 'blocked_roles': sorted(roles - set(ready))}


def record_path(pack_path):
    return Path(pack_path).parent / RECORD_NAME


def record(pack_path, approver, decisions):
    """Write decisions against a pack revision. An unknown id is refused, not ignored."""
    pack = load_json(pack_path)
    known = {item['id'] for item in items(pack)}
    unknown = sorted(set(decisions) - known)
    if unknown:
        raise ValueError('unknown item ids: ' + ', '.join(unknown))
    for name, row in decisions.items():
        if row.get('status') not in STATUSES:
            raise ValueError(f'{name}: status must be one of {", ".join(STATUSES)}')
        if row['status'] != 'approved' and not str(row.get('note', '')).strip():
            raise ValueError(f'{name}: a held or rejected row records why')
    path = record_path(pack_path)
    existing = load_json(path) if path.exists() else {}
    merged = dict(existing.get('decisions') or {})
    merged.update(decisions)
    written = {
        'pack_version': f'{Path(pack_path).parent.parent.name}/{Path(pack_path).parent.name}',
        'pack_hash': pack_hash(pack_path),
        'approver': approver,
        'recorded_at': datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds'),
        'decisions': merged,
    }
    with path.open('w', encoding='utf-8') as out:
        json.dump(written, out, ensure_ascii=False, indent=2)
        out.write('\n')
    return written


def status(pack_path):
    """Approval coverage for a pack, and whether the record still describes it."""
    pack = load_json(pack_path)
    everything = items(pack)
    path = record_path(pack_path)
    saved = load_json(path) if path.exists() else {}
    decisions = saved.get('decisions') or {}
    counts = {name: sum(1 for row in decisions.values() if row.get('status') == name)
              for name in STATUSES}
    pending = [item['id'] for item in everything if item['id'] not in decisions]
    stale = bool(saved) and saved.get('pack_hash') != pack_hash(pack_path)
    return {
        'pack_version': saved.get('pack_version', ''),
        'total': len(everything), 'pending': len(pending), 'pending_ids': pending[:20],
        'stale': stale, 'approver': saved.get('approver', ''),
        'recorded_at': saved.get('recorded_at', ''),
        'complete': not pending and not stale and counts['rejected'] == 0,
        **counts,
    }


def sheet(pack, version):
    """A markdown sheet one person can read top to bottom and decide from."""
    findings = consistency(pack)
    rows = items(pack)
    by_kind = {kind: [row for row in rows if row['kind'] == kind] for kind in KIND_LABELS}
    lines = [
        f'# 디자인 지식 팩 승인 검토지 — {version}', '',
        '항목 ' + str(len(rows)) + '개 ('
        + ' · '.join(f'{label} {len(by_kind[kind])}' for kind, label in KIND_LABELS.items())
        + ')', '',
        '## 왜 승인이 필요한가', '',
        '3단계는 화면·상태·조판을 이 팩에서 도출하고 기획자에게 묻지 않는다. 그런데 역할 행은',
        '`AI synthesis; human approval pending`, 레시피는 `draft` 상태로 나와 있다. 승인 전에는',
        '화면 목록 전체가 **사람이 확인하지 않은 합성** 위에 놓인다.',
        '',
        '케이스마다가 아니라 **팩 버전마다 한 번** 승인한다. 승인은 팩 해시에 묶이므로 팩이',
        '바뀌면 다시 받아야 한다.', '',
        '## 먼저 볼 것 — 팩 정합성', '',
        f"- **역할에 recipeRule 없음 ({len(findings['roles_without_recipe'])}/"
        f"{len(by_kind['role'])})**: {', '.join(findings['roles_without_recipe'])}",
        '  → 이 역할로 화면을 도출하면 상호작용 규칙 없이 조판만 나온다.',
        f"- **recipeRule이 없는 역할을 가리킴**: {', '.join(findings['recipes_without_role'])}",
        '  → 역할 목록에 없는 유형이다. 역할을 추가하거나 규칙을 내린다.',
        f"- **sample 0인 규칙**: {', '.join(findings['recipes_without_samples'])}",
        '  → 근거 사례 없이 합성된 규칙이다. 승인 대상에서 빼거나 사례를 먼저 채운다.',
        f"- **역할에 참조 화면 없음 ({len(findings['roles_without_reference'])})**: "
        f"{', '.join(findings['roles_without_reference'])}",
        '  → 참조 전이로 행 조판을 얻을 수 없는 역할이다.', '',
        '## 판정', '',
        '| 값 | 뜻 |', '| --- | --- |',
        '| `approved` | 이 행을 근거로 화면을 도출해도 된다 |',
        '| `held` | 보류. 사유 필수. 이 행은 도출에 쓰지 않는다 |',
        '| `rejected` | 틀렸다. 사유 필수. 팩에서 고쳐야 한다 |', '',
        '기록:', '', '```',
        'python3 scripts/pack_approval.py record <pack.json> --approver <이름> \\',
        '    --decisions <decisions.json>',
        'python3 scripts/pack_approval.py status <pack.json>',
        '```', '',
        '`decisions.json`은 `{"role:type-list": {"status": "approved", "note": ""}}` 형태다.', '',
        '---', '', '## 1. 역할 — 언제 이 유형을 쓰는가', '',
        '`when`이 다른 역할과 구별되는지, `composition`·`stateContract`·`layoutContract`가',
        '실제 화면과 맞는지 본다.', '',
    ]
    for row in by_kind['role']:
        detail = row['detail']
        lines += [
            f"### `{row['id']}` — {row['name']}", '',
            f"| | |", '| --- | --- |',
            f"| when | {detail['when']} |",
            f"| composition | {' · '.join(detail['composition'])} |",
            f"| stateContract | {detail['stateContract']} |",
            f"| layoutContract | {detail['layoutContract']} |",
            f"| 참조 화면 수 | {detail['screens']} |",
            f"| 현재 상태 | {row['declared_status']} |", '',
            '판정: ( ) approved  ( ) held  ( ) rejected · 사유:', '',
        ]
    lines += ['---', '', '## 2. 레시피 규칙 — 무엇을 강제하는가', '',
              '`sample_count`가 규칙의 근거 폭이다. 낮으면 그 도메인 밖으로 일반화할 수 없다.', '']
    for row in by_kind['recipe']:
        detail = row['detail']
        lines += [
            f"### `{row['id']}`", '',
            f"sample {detail['sample_count']} · must {detail['must']} · "
            f"optional {detail['optional']} · must_not {detail['must_not']} · "
            f"exemplar {detail['exemplars']} · 상태 {row['declared_status']}", '',
            '판정: ( ) approved  ( ) held  ( ) rejected · 사유:', '',
        ]
    lines += ['---', '', '## 3. 검사 항목 — 이 위험이 이 제품에서 실제로 일어나는가', '',
              '3단계가 상태를 세울 때 근거로 인용하는 휴리스틱이다. 승인 항목 id가 없어서',
              '**스킬이 인용하라고 시키는데 검증기가 거부하던** 자리였다.', '']
    for row in by_kind['usability']:
        detail = row['detail']
        lines += [
            f"### `{row['id']}` — {row['name']}", '',
            f"| | |", '| --- | --- |',
            f"| 목적 | {detail['purpose']} |",
            f"| 위험 | {detail['risk']} |",
            f"| 검사 | {detail['check']} |",
            f"| 증거 | {detail['evidenceMode']} |", '',
            '판정: ( ) approved  ( ) held  ( ) rejected · 사유:', '',
        ]
    lines += ['---', '', '## 4. 참조 화면 — 이 역할의 대표 화면이 맞는가', '',
              '3단계의 행 조판은 레시피가 아니라 이 화면에서 전이된다.', '']
    for row in by_kind['reference']:
        lines += [
            f"### `{row['id']}` — {row['name']}", '',
            f"{row['detail']['path']}", '',
            f"권위: {row['declared_status']} · 한계: {row['detail']['limitation']}", '',
            '판정: ( ) approved  ( ) held  ( ) rejected · 사유:', '',
        ]
    return '\n'.join(lines) + '\n'


def page_data(pack, version, digest):
    """Everything the review page shows, derived from the pack so it cannot drift."""
    findings = consistency(pack)
    roles = {row['type'] for row in pack.get('roles', [])}
    recipes = {row['type'] for row in pack.get('recipeRules', [])}
    referenced = {row.get('role', '') for row in pack.get('references', [])}
    advice = {row['id']: row for row in recommendations(pack)}
    rows = []
    for item in items(pack):
        detail = item['detail']
        flags, fields = [], []
        if item['kind'] == 'role':
            kind_type = detail['type']
            if kind_type not in recipes:
                flags.append('recipeRule 없음')
            if kind_type not in referenced:
                flags.append('참조 화면 없음')
            fields = [
                ('언제', detail['when']),
                ('구성', ' · '.join(detail['composition'])),
                ('상태 계약', detail['stateContract']),
                ('조판 계약', detail['layoutContract']),
                ('참조 화면', str(detail['screens'])),
                ('현재', item['declared_status']),
            ]
        elif item['kind'] == 'recipe':
            if item['name'] not in roles:
                flags.append('역할 목록에 없는 유형')
            if not detail['sample_count']:
                flags.append('근거 사례 0건')
            elif detail['sample_count'] < 3:
                flags.append(f"근거 사례 {detail['sample_count']}건")
            fields = [
                ('수치', f"sample {detail['sample_count']} · must {detail['must']} · "
                         f"optional {detail['optional']} · must_not {detail['must_not']} · "
                         f"exemplar {detail['exemplars']}"),
                ('현재', item['declared_status']),
            ]
        elif item['kind'] == 'usability':
            fields = [
                ('목적', detail['purpose']),
                ('위험', detail['risk']),
                ('검사', detail['check']),
                ('증거', detail['evidenceMode']),
            ]
        else:
            fields = [
                ('경로', detail['path']),
                ('한계', detail['limitation']),
                ('권위', item['declared_status']),
            ]
        proposal = advice.get(item['id'], {})
        rows.append({'id': item['id'], 'kind': item['kind'], 'name': item['name'],
                     'flags': flags, 'fields': fields,
                     'image': detail.get('path', '') if item['kind'] == 'reference' else '',
                     'recommend': proposal.get('recommend', 'review'),
                     'confidence': proposal.get('confidence', ''),
                     'why': proposal.get('why', '')})
    brief = [
        {'count': f"{len(findings['roles_without_recipe'])}/{len(roles)}",
         'text': '역할에 <b>recipeRule 없음</b>. 이 역할로 화면을 도출하면 상호작용 규칙 없이 '
                 '조판만 나온다.'},
        {'count': f"{len(findings['roles_without_reference'])}/{len(roles)}",
         'text': '역할에 <b>참조 화면 없음</b>. 규칙이 일반화를 거부할 때 행 조판을 얻을 경로가 '
                 '없다.'},
        {'count': str(len(findings['recipes_without_role'])),
         'text': '규칙이 <b>역할 목록에 없는 유형</b>을 가리킨다 — '
                 + ', '.join(findings['recipes_without_role'])},
        {'count': str(len(findings['recipes_without_samples'])),
         'text': '규칙이 <b>근거 사례 0건</b>으로 합성됐다 — '
                 + ', '.join(findings['recipes_without_samples'])},
    ]
    return {
        'version': version, 'brief': brief, 'items': rows,
        'intro': {
            'role': 'when이 다른 역할과 구별되는지, 구성·상태·조판 계약이 실제 화면과 맞는지 본다.',
            'recipe': 'sample_count가 규칙의 근거 폭이다. 낮으면 그 도메인 밖으로 일반화할 수 없다.',
            'reference': '3단계의 행 조판은 규칙이 아니라 이 화면에서 전이된다.',
        },
    }


def page(pack, version, digest):
    data = page_data(pack, version, digest)
    return (PAGE_TEMPLATE
            .replace('__VERSION__', version)
            .replace('__HASH__', digest[:16])
            .replace('__TOTAL__', str(len(data['items'])))
            .replace('__DATA__', json.dumps(data, ensure_ascii=False)))


def supplement_sheet(pack, version):
    """The order, as a document the design-system owner can work from."""
    order = supplement(pack)
    labels = {'refile': '층위 재분류', 'add_recipe': '레시피 추가',
              'add_reference': '참조 화면 추가', 'add_samples': '사례 추가',
              'relabel': '참조 라벨 교정'}
    lines = [f'# 팩 보강 주문서 — {version}', '',
             '이 항목들은 디자인 시스템 리포에서 만들어진다. 팩은 생성물이므로 여기에 직접 쓰면',
             '`rowProvenance`가 거짓이 되고, 승인 게이트가 막으려는 미승인 합성을 만들어낸다.', '',
             '## 지금 파생이 가능한 역할', '',
             ('- ' + ', '.join(order['ready_roles'])) if order['ready_roles'] else '- 없다',
             '',
             f"규칙과 참조와 사례를 모두 갖춘 역할만 3단계가 근거로 쓸 수 있다. "
             f"나머지 {len(order['blocked_roles'])}개는 막혀 있다.", '',
             '## 집계', '', '| 작업 | 건수 |', '| --- | --- |']
    for action, count in sorted(order['totals'].items(), key=lambda row: -row[1]):
        lines.append(f'| {labels[action]} | {count} |')
    for action in ('relabel', 'refile', 'add_recipe', 'add_reference', 'add_samples'):
        rows = [row for row in order['items'] if row['action'] == action]
        if not rows:
            continue
        lines += ['', f'## {labels[action]} ({len(rows)})', '',
                  f'대상 파일: `{rows[0]["where"]}`', '']
        for row in rows:
            lines.append(f"- **`{row['id']}`** — {row['why']}")
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for command in ('sheet', 'page', 'supplement', 'status', 'record'):
        sub = commands.add_parser(command)
        sub.add_argument('pack', type=Path)
        if command in ('sheet', 'page', 'supplement'):
            sub.add_argument('-o', '--output', type=Path)
        if command == 'record':
            sub.add_argument('--approver', required=True)
            sub.add_argument('--decisions', type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command in ('sheet', 'page', 'supplement'):
            pack = load_json(args.pack)
            version = f'{args.pack.parent.parent.name}/{args.pack.parent.name}'
            body = (sheet(pack, version) if args.command == 'sheet'
                    else supplement_sheet(pack, version) if args.command == 'supplement'
                    else page(pack, version, pack_hash(args.pack)))
            if args.output:
                args.output.write_text(body, encoding='utf-8')
                print(str(args.output))
            else:
                print(body, end='')
            return 0
        if args.command == 'record':
            written = record(args.pack, args.approver, load_json(args.decisions))
            print(json.dumps(status(args.pack), ensure_ascii=False, indent=2))
            return 0 if written else 1
        print(json.dumps(status(args.pack), ensure_ascii=False, indent=2))
        return 0
    except (OSError, UnicodeError, ValueError) as exc:
        print(json.dumps({'error': str(exc)}, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
