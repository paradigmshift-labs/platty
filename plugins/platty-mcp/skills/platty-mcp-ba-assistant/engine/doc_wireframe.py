"""The wireframe record as a designer and a planner review it.

What the wireframe stage made is pictures, so the document is mostly pictures: per screen, one
capture per render case in the screen behavior's order and names, each linked to its Figma
frame and back to the case it draws. Then the design decisions, what the design system supplied,
and what the image review saw. Runs, hashes, runtime checks and coverage go to the review file.
"""

import html
import json

from doc_common import (ORIGIN, anchor, code, details, joined, json_rows, link, notice, report_lines, review_notice, slug, table,
                        tag, text)

UX, SB, WF = 'user_experience', 'screen_behavior', 'design_system_wireframe'
JSON_NAME = 'design-system-wireframe.json'
VERDICT = {'accept_ai': '자동 확정', 'accept': '확정', 'revise': '보완 필요', 'insufficient_evidence': '근거 부족',
           'invalid': '무효'}
DECISION_ORDER = (('layout', '배치'), ('hierarchy', '위계'), ('components', '컴포넌트'), ('tokens', '토큰'),
                  ('roles', '역할'), ('reference_transfer', '참조'))
COVERAGE_FIELDS = (('screen_ids', '화면'), ('element_ids', '요소'), ('state_axis_ids', '상태 축'),
                   ('transition_ids', '전이'), ('render_case_ids', '재현 사례'), ('design_handoff_ids', '인계'))
COVERAGE_KEYS = tuple(key for key, _ in COVERAGE_FIELDS)
DECISION_STATUS = {'verified': '', 'pending': ' (대기)', 'needs_work': ' (보완 필요)', 'not_applicable': ' (해당 없음)'}
PER_ROW = 3


def _rows(value):
    return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []


def _load(context, stored):
    if context.layout is None or not stored:
        return {}
    path = context.layout.resolve(stored)
    try:
        value = json.loads(path.read_text(encoding='utf-8')) if path and path.exists() else {}
    except (OSError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def _title(data):
    title = str(data.get('title', '')).replace('Design System Wireframes', '').replace('화면 동작 명세', '').strip()
    return f'{title} 와이어프레임' if title else '와이어프레임'


def _screen_rows(context):
    return {row['id']: row for row in _rows(context.get(SB).get('screens'))}


def _cases(context):
    return {row['id']: row for row in _rows(context.get(SB).get('render_cases'))}


def _gallery(data, context, target, cases):
    captures = _rows(target.get('captures'))
    order = [cid for cid, row in cases.items() if row.get('screen_id') == target.get('screen_id')]
    order += [row['render_case_id'] for row in captures if row.get('render_case_id') and row['render_case_id'] not in order]
    cells = []
    for case_id in order:
        for capture in (row for row in captures if row.get('render_case_id') == case_id):
            case = cases.get(case_id, {})
            title = str(case.get('title', case_id)).split(' — ')[0]
            src = context.file_href(WF, capture.get('path'))
            image = (f'<img src="{html.escape(src)}" width="220" alt="{html.escape(title)}">' if src
                     else '<i>캡처 파일 없음</i>')
            links = [f'<a href="{html.escape(href)}">명세</a>' for href in [context.doc_href(WF, SB, slug(case_id))] if href]
            figma = context.figma_frame(case_id)
            if figma:
                links.append(f'<a href="{html.escape(figma)}">Figma</a>')
            viewport = f" · {html.escape(capture['viewport'])}" if capture.get('viewport') not in (None, '', 'mobile') else ''
            cells.append(f'<td valign="top" width="240">{anchor(case_id)}{image}<br><b>{html.escape(title)}</b>{viewport}'
                         f'<br><sub><code>{html.escape(case_id)}</code></sub>' + ('<br>' + ' · '.join(links) if links else '')
                         + '</td>')
    lines = []
    for start in range(0, len(cells), PER_ROW):
        lines += ['<table><tr>' + ''.join(cells[start:start + PER_ROW]) + '</tr></table>', '']
    return lines or ['캡처가 없습니다.', '']


def _design_system(context, target, elements):
    detail = _load(context, (target.get('detail_artifact') or {}).get('path')) if target.get('detail_mode') == 'artifact' else target
    components = _rows(detail.get('component_mappings'))
    tokens = _rows(detail.get('token_mappings'))
    body = table(['요소', '컴포넌트'], [[text(elements.get(row.get('element_id'), row.get('element_id'))),
                                    code(row.get('hds_component'))] for row in components])
    body += table(['토큰', '값', '쓰인 곳'], [[f"`{text(row.get('semantic_token'))}`", text(row.get('value')),
                                          joined(elements.get(ref, ref) for ref in row.get('applied_to', []))] for row in tokens])
    return details(f'디자인 시스템 사용 — 컴포넌트 {len(components)}개 · 토큰 {len(tokens)}개', body)


def render_body(data, context):
    screens = _screen_rows(context)
    cases = _cases(context)
    elements = {row['id']: row.get('name', row['id']) for row in _rows(context.get(SB).get('elements'))}
    targets = {row.get('screen_id'): row for row in _rows(data.get('targets'))}
    order = [sid for sid in context.journey_order(list(screens.values())) if sid in targets] if screens else []
    order += [sid for sid in targets if sid not in order]
    export = context.latest_export()
    knowledge = data.get('knowledge_binding') or {}
    confirmation = data.get('confirmation') or {}

    L = [f"# {text(_title(data))}", ''] + notice(JSON_NAME, context.review_name(WF))
    L += ['## 요약', '']
    if export:
        L.append(f"- **Figma**: {link(text(export.get('file_name') or export.get('canonical_url')), export.get('canonical_url'))}"
                 f" ({text(str(export.get('exported_at', ''))[:10])})")
    else:
        L.append('- **Figma**: 아직 내보내지 않음')
    L += [f"- **디자인 팩**: {text(knowledge.get('pack_id', '—'))} {text(knowledge.get('version', ''))}",
          '- **화면별 결과**: ' + (' · '.join(
              f"{text((screens.get(sid) or {}).get('name', sid))} {VERDICT.get((targets[sid].get('gate') or {}).get('verdict'), text(targets[sid].get('status')))}"
              for sid in order) or '—')]
    if confirmation.get('confirmed'):
        L.append(f"- **확정**: {text(confirmation.get('statement'))}")
    L += ['- **미결** → [미결 사항](#open)', '']

    links = _rows(data.get('navigation_links'))
    if links:
        by_target = {row.get('id'): row.get('screen_id') for row in _rows(data.get('targets'))}
        L += ['## 화면 사이 이동', '']
        for row in links:
            start = (screens.get(by_target.get(row.get('from_target_id'))) or {}).get('name', row.get('from_target_id'))
            end = (screens.get(by_target.get(row.get('to_target_id'))) or {}).get('name', row.get('to_target_id'))
            transition = context.ux_transition(row.get('trigger_ref'))
            trigger = link(text(transition['trigger']) if transition else text(row.get('trigger_ref')),
                           context.doc_href(WF, UX, slug(row.get('trigger_ref', ''))))
            L.append(f"- {text(start)} → {text(end)}: {trigger}")
        L.append('')

    limits = []
    for sid in order:
        target = targets[sid]
        screen = screens.get(sid) or {}
        review = _load(context, ((((target.get('gate') or {}).get('artifacts') or {}).get('review')) or {}).get('path'))
        spec = context.doc_href(WF, SB, slug(sid))
        L += [f"## {text(screen.get('name', sid))} {tag(sid)}{anchor(sid)}", '',
              ' · '.join(part for part in (ORIGIN.get(screen.get('origin'), ''), link('화면 동작 명세', spec) if spec else '') if part), '',
              '### 사례별 캡처', ''] + _gallery(data, context, target, cases)
        decisions = target.get('design_decisions') or {}
        rows = [f"- **{label}**{DECISION_STATUS.get(decisions[key].get('status'), '')} — {text(decisions[key].get('rationale'))}"
                for key, label in DECISION_ORDER if isinstance(decisions.get(key), dict)]
        if rows:
            L += ['### 디자인 결정', ''] + rows + ['']
        L += _design_system(context, target, elements)
        criteria = _rows(review.get('criteria'))
        findings = review.get('findings') or []
        if criteria or findings:
            L += ['### 이미지 검토', '']
            L += [f"- **{text(row.get('id'))}** {text(row.get('observation'))}" for row in criteria]
            L += [f"- **지적** {text(row.get('summary') or row.get('observation') or row) if isinstance(row, dict) else text(row)}"
                  for row in findings]
            L.append('')
        limits += [(screen.get('name', sid), value) for value in review.get('limitations') or []]

    L += ['<a id="open"></a>', '## 미결 사항', '']
    items = [f"- **{text(name)}** {text(value)}" for name, value in limits]
    items += [f"- **확인 필요** {text(row.get('question'))} — {text(row.get('reason'))} {tag(row.get('id'))}"
              for row in _rows(data.get('issues')) if not row.get('resolution')]
    items += [f"- **Figma 내보내기 공백** {text((row.get('gap') or {}).get('reason'))}" for row in _rows(context.receipts.get('exports'))
              if row.get('status') == 'gap']
    unresolved = ((export or {}).get('stats') or {}).get('unresolved') or 0
    if unresolved:
        items.append(f'- **Figma** 요소 {unresolved}개를 라이브러리 컴포넌트로 잇지 못해 도형으로 그렸습니다.')
    items += [f"- **흐릿함** {text(row.get('note'))} — {text(row.get('why_not_ticket'))}" for row in _rows(data.get('fog'))]
    items += [f"- **범위 밖** {text(row.get('note'))} — {text(row.get('reason'))}" for row in _rows(data.get('out_of_scope'))]
    L += (items or ['- 없음']) + ['']
    return '\n'.join(L)


def render_review(data, report, context):
    screens = _screen_rows(context)
    name = lambda sid: (screens.get(sid) or {}).get('name', sid)  # noqa: E731
    targets = _rows(data.get('targets'))
    L = [f"# {text(_title(data))} — 검토 기록", ''] + review_notice(JSON_NAME.replace('.json', '.md'))
    L += report_lines(report)
    L += ['## 현재 실행', '']
    L += table(['화면', 'run', '이전 run', '판정', '근거', '캡처 해시(앞 12자)'],
               [[text(name(row.get('screen_id'))), f"`{text(row.get('run_id'))}`", f"`{text(row.get('parent_run_id'))}`" if row.get('parent_run_id') else '—',
                 text((row.get('gate') or {}).get('verdict')), text((row.get('gate') or {}).get('rationale')),
                 ', '.join(str(value)[:12] for value in (row.get('gate') or {}).get('capture_hashes', []))] for row in targets]) or ['없음', '']
    checks = [[text(name(row.get('screen_id'))), text(check.get('id')), text(check.get('status'))]
              for row in targets for check in _rows(row.get('runtime_checks'))]
    if checks:
        L += ['## 런타임 점검', ''] + table(['화면', '점검', '결과'], checks)
    assertions = [[text(name(row.get('screen_id'))), text(item.get('transition_id')), text(item.get('trigger')),
                   text(item.get('observable_result'))] for row in targets for item in _rows(row.get('transition_assertions'))]
    if assertions:
        L += ['## 전이 단정', ''] + table(['화면', '전이', '트리거', '보일 결과'], assertions)
    coverage = _rows(data.get('coverage'))
    if coverage:
        L += ['## 커버리지', '', f'{len(coverage)}건', '']
        L += table(['대상', '종류', '입력', '상태', '증거'], [[text(row.get('target_id')), text(row.get('kind')), text(row.get('source_id')),
                                                      text(row.get('status')), joined(row.get('evidence_ids', []))] for row in coverage])
    review = data.get('review') or {}
    if review:
        L += ['## 단계 검토', '', f"판정: {text(review.get('verdict'))}", '', text(review.get('rationale')), '']
    coverage_counts = [[text(name(row.get('screen_id')))] + [str(len((row.get('required_coverage') or {}).get(key) or []))
                                                              for key in COVERAGE_KEYS] for row in targets]
    if coverage_counts:
        L += ['## 대상별 입력 범위', ''] + table(['화면'] + [label for _, label in COVERAGE_FIELDS], coverage_counts)
    # The receipts file keeps every export; this file is not rewritten when one is added.
    receipts = context.file_href(WF, context.layout.figma_receipts()) if context.layout else None
    if receipts:
        L += ['## Figma 내보내기 기록', '', f'내보내기마다의 영수증: [{receipts}]({receipts})', '']
    paths = [[text(name(row.get('screen_id'))), text(key), f"`{text(row.get(key))}`"] for row in targets
             for key in ('brief_path', 'packet_path', 'spec_path', 'renderer_path') if row.get(key)]
    if paths:
        L += ['## 실행 파일', ''] + table(['화면', '파일', '경로'], paths)
    L += json_rows('변경 이력', data.get('history') or [])
    L += ['## 입력과 확정', '', '```json',
          json.dumps({key: data.get(key) for key in ('case_id', 'schema_version', 'input_binding', 'knowledge_binding',
                                                     'confirmation')},
                     ensure_ascii=False, indent=1), '```', '']
    return '\n'.join(L)
