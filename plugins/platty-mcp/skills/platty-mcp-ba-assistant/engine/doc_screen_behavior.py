"""The screen behavior spec as a designer, a developer and QA read it (schema 3).

Screens come in the order the journey reaches them, and every screen has the same sections in
the same order: purpose → what changes from today → parts → states → render cases → behavior →
rules → design handoff. Upstream codes written into the prose, coverage checks, input
dispositions, reviews and bindings go to the review file.
"""

import json
from collections import OrderedDict

from doc_common import (CHANGE, DECISION_STATUS, DIMENSION, MAPPING_STATUS, ORIGIN, SCENARIO_KIND, anchor, code,
                        details, joined, json_rows, link, mermaid_label, notice, record_ids, report_lines,
                        review_notice, slug, strip_codes, table, tag, text)

UX, SB, WF = 'user_experience', 'screen_behavior', 'design_system_wireframe'
JSON_NAME = 'screen-behavior.json'
COMMON = '공통'  # the owner of codes moved out of prose that belongs to no one screen


def _rows(data, key):
    return [row for row in data.get(key) or [] if isinstance(row, dict)]


class _Spec:
    """Lookups over one screen behavior record."""

    def __init__(self, data, context):
        self.data, self.context = data, context
        self.screens = OrderedDict((row['id'], row) for row in _rows(data, 'screens'))
        self.elements = OrderedDict((row['id'], row) for row in _rows(data, 'elements'))
        self.axes = OrderedDict((row['id'], row) for row in _rows(data, 'state_axes'))
        self.cases = OrderedDict((row['id'], row) for row in _rows(data, 'render_cases'))
        self.transitions = OrderedDict((row['id'], row) for row in _rows(data, 'transitions'))
        self.codes = OrderedDict()
        self.known = context.known_ids() | record_ids(data)

    def plain(self, value, owner):
        """Prose without upstream codes; the codes are kept per screen for the review file."""
        return text(strip_codes(value, self.codes.setdefault(owner, []), self.known))

    def name(self, scope_id):
        row = self.elements.get(scope_id) or self.screens.get(scope_id)
        return row['name'] if row else scope_id

    def value(self, axis_id, value_id):
        axis = self.axes.get(axis_id) or {}
        return next((row.get('label', value_id) for row in axis.get('values', []) if row.get('id') == value_id), value_id)

    def assignment(self, row):
        item = f" (항목 {row['item_ref']})" if row.get('item_ref') else ''
        if 'content' in row:
            return f"{text(self.name(row['scope_id']))}{item}: {text(row['content'])} (채운 쪽: {text(row.get('filled_by'))})"
        return f"{text(self.name(row['scope_id']))}{item}: {text(self.value(row.get('axis_id'), row.get('value_id')))}"

    def assignments(self, rows, empty='—'):
        return ', '.join(self.assignment(row) for row in rows if isinstance(row, dict)) or empty

    def case_title(self, case_id):
        case = self.cases.get(case_id)
        return case['title'].split(' — ')[0] if case else case_id

    def action(self, ref):
        return self.context.view_item(ref) or ref

    def ux_link(self, transition_id):
        row = self.context.ux_transition(transition_id)
        href = self.context.doc_href(SB, UX, slug(transition_id))
        return link(text(row['trigger']) if row else text(transition_id), href)

    def scopes(self, screen_id):
        return {screen_id} | {eid for eid, row in self.elements.items() if row.get('screen_id') == screen_id}


def _summary(spec, order):
    changed = [sid for sid in order if spec.screens[sid].get('origin') in ('changed', 'new')]
    L = ['## 요약', '',
         f"- **화면 {len(order)}개** (여정 순) — " + ', '.join(
             f"{text(spec.screens[sid]['name'])}({ORIGIN.get(spec.screens[sid].get('origin'), '미표시')})" for sid in order),
         f"- **재현 사례 {len(spec.cases)}개**, 동작 {len(spec.transitions)}개"]
    for sid in changed:
        L.append(f"- **{text(spec.screens[sid]['name'])}**: {spec.plain(spec.screens[sid].get('purpose'), sid)}")
    L += ['- **미결** → [미결 사항과 범위 밖](#open)', '',
          '> 읽는 순서 — 기획: 요약·화면 목록·각 화면의 「지금과 달라지는 점」 · 디자인: 구성·상태·디자인 인계 · '
          '개발/QA: 재현 사례·동작·규칙', '']
    return L


def _screen_index(spec, order):
    rows = []
    for sid in order:
        screen = spec.screens[sid]
        cases = sum(row.get('screen_id') == sid for row in spec.cases.values())
        target, _ = next(((t, c) for t, c in (spec.context.capture(cid) for cid, row in spec.cases.items()
                                                if row.get('screen_id') == sid) if t), (None, None))
        wireframe = link('캡처', spec.context.doc_href(SB, WF, slug(sid))) if target else '—'
        rows.append([link(text(screen['name']), f'#{slug(sid)}'), spec.plain(screen.get('purpose'), sid),
                     ORIGIN.get(screen.get('origin'), '미표시'), str(cases), wireframe])
    return ['## 화면 목록', ''] + table(['화면', '무엇을 하나', '상태', '재현 사례', '와이어프레임'], rows)


def _changes(spec, sid):
    screen = spec.screens[sid]
    baseline = screen.get('current_baseline')
    L = ['### 지금과 달라지는 점', '']
    if not baseline:
        L += ['신규 화면 — 지금 코드에는 없습니다.' if screen.get('origin') == 'new'
              else '현재 화면을 코드에서 읽은 기록이 없습니다.', '']
        return L
    if baseline.get('status') == 'unavailable':
        return L + [f"현재 화면을 코드에서 읽지 못했습니다 — {spec.plain(baseline.get('reason'), sid)}", '']
    regions = {row['id']: row for row in baseline.get('regions') or [] if isinstance(row, dict)}
    changes = [row for row in baseline.get('changes') or [] if isinstance(row, dict)]
    if changes:
        L += ['위에서 아래 순서(바뀐 뒤 기준)입니다.', '']
        rows = []
        for change in changes:
            region = regions.get(change.get('region_id'), {})
            now = text(region.get('name', change.get('region_id', '')))
            texts = region.get('texts') or []
            if texts:
                now += ' — 「' + '」「'.join(text(value) for value in texts[:2]) + '」' + (' …' if len(texts) > 2 else '')
            rows.append([CHANGE.get(change.get('change'), text(change.get('change'))), now,
                         spec.plain(change.get('what'), sid)])
        L += table(['', '지금 (코드 기준)', '바뀐 뒤'], rows)
    else:
        L += ['변경 없음 — 현재 코드 그대로 둡니다.', '']
    if baseline.get('reason'):
        L += [f"근거: {spec.plain(baseline['reason'], sid)}", '']
    L += details('현재 화면 구성 (코드 기준)',
                 table(['순서', '영역', '지금 보이는 글자', '컴포넌트', '코드'],
                       [[str(row.get('order', '')), text(row.get('name')), joined(row.get('texts', []), ' / '),
                         joined(row.get('components', [])), code(row['code_ref']) if row.get('code_ref') else '—']
                        for row in sorted(regions.values(), key=lambda row: row.get('order', 0))]))
    return L


def _parts(spec, sid):
    rows = []
    for eid, row in spec.elements.items():
        if row.get('screen_id') != sid:
            continue
        repeat = row.get('repetition')
        repetition = ('—' if repeat in (None, 'none') else f"모름 — {text(repeat.get('unknown'))}" if 'unknown' in repeat
                      else f"{text(spec.name(repeat.get('item_scope', '')))}마다 반복")
        name = ('└ ' if row.get('parent_id') else '') + f"{text(row['name'])} {tag(eid)}"
        rows.append([name, spec.plain(row.get('purpose'), sid), repetition])
    return ['### 구성', ''] + (table(['요소', '역할', '반복'], rows) or ['요소가 없습니다.', ''])


def _states(spec, sid):
    L = ['### 상태', '', '요소마다 독립된 상태 축입니다. 값의 뜻은 여기서만 설명합니다.', '']
    scopes = spec.scopes(sid)
    found = False
    for axis in spec.axes.values():
        if axis.get('scope_id') not in scopes:
            continue
        found = True
        dimension = DIMENSION.get(axis.get('dimension'), text(axis.get('dimension')))
        L += [f"**{text(spec.name(axis['scope_id']))} — {dimension}** {tag(axis['id'])}", '']
        L += table(['값', '뜻'], [[text(row.get('label')), spec.plain(row.get('meaning'), sid)] for row in axis.get('values', [])])
        for row in axis.get('initial_conditions', []):
            L += [f"처음에는 **{text(spec.value(axis['id'], row.get('value_id')))}** — {spec.plain(row.get('condition'), sid)}", '']
    return L if found else L[:2] + ['상태 축이 없습니다.', '']


def _cases(spec, sid):
    L = ['### 재현 사례', '', '와이어프레임은 이 사례마다 한 장씩 그립니다.', '']
    rows, more = [], []
    for cid, case in spec.cases.items():
        if case.get('screen_id') != sid:
            continue
        see = joined(case.get('visible_information', []), ' · ')
        actions = [text(spec.action(ref)) for ref in case.get('available_actions', [])]
        if actions:
            see += ' — 할 수 있는 것: ' + ', '.join(actions)
        if case.get('blocked_actions_with_reasons'):
            see += ' — 막힌 것: ' + ', '.join(spec.plain(row, sid) for row in case['blocked_actions_with_reasons'])
        target, _ = spec.context.capture(cid)
        capture = link('캡처', spec.context.doc_href(SB, WF, slug(cid))) if target else '—'
        rows.append([f"{anchor(cid)}**{text(case['title'])}** {tag(cid)}",
                     spec.assignments(case.get('state_assignments', [])), see, capture])
        extra = []
        for item in case.get('sample_items') or []:
            extra.append(f"  - 표본 항목 {text(item.get('id'))}: {text(spec.name(item.get('template_scope_id', '')))} · "
                         f"{joined(item.get('traits', []))}")
        for group in case.get('sample_groups') or []:
            extra.append(f"  - 표본 집합 {text(group.get('id'))}: {joined(group.get('item_ids', []))} · "
                         f"소속 규칙 {text(group.get('membership_rule_id'))}")
        if case.get('focus_expectation'):
            extra.append(f"  - 포커스: {spec.plain(case['focus_expectation'], sid)}")
        if case.get('equivalence_rationale'):
            extra.append(f"  - 한 사례로 묶은 이유: {spec.plain(case['equivalence_rationale'], sid)}")
        if extra:
            more += [f"- **{text(spec.case_title(cid))}**"] + extra
    L += table(['사례', '상태 조합', '사용자가 보는 것', '캡처'], rows) or ['재현 사례가 없습니다.', '']
    return L + details('사례 상세 — 표본·포커스·묶은 이유', more + [''] if more else [])


def _behavior(spec, sid):
    scopes = spec.scopes(sid)
    case_ids = {cid for cid, row in spec.cases.items() if row.get('screen_id') == sid}
    scenarios = [row for row in _rows(spec.data, 'scenarios')
                 if case_ids & {row.get('initial_case_id'), row.get('expected_case_id')}]
    used = {step.get('transition_id') for row in scenarios for step in row.get('steps', [])}
    loose = [tid for tid, row in spec.transitions.items() if set(row.get('target_scope_ids', [])) & scopes and tid not in used]
    L = ['### 동작', '']
    edges = OrderedDict()
    for scenario in scenarios:
        events = [spec.transitions.get(step.get('transition_id'), {}).get('event', step.get('transition_id'))
                  for step in scenario.get('steps', [])]
        edges.setdefault((scenario.get('initial_case_id'), scenario.get('expected_case_id')), ' → '.join(events))
    if edges:
        L += ['```mermaid', 'flowchart LR']
        nodes = OrderedDict()
        for pair in edges:
            for cid in pair:
                if cid not in nodes:
                    nodes[cid] = f'c{len(nodes)}'
                    L.append(f'  {nodes[cid]}["{mermaid_label(spec.case_title(cid))}"]')
        for (start, end), label in edges.items():
            L.append(f'  {nodes[start]} -->|"{mermaid_label(label)}"| {nodes[end]}')
        L += ['```', '']
    rows = []
    for scenario in scenarios:
        for step in scenario.get('steps', []):
            row = spec.transitions.get(step.get('transition_id'), {})
            rows.append([SCENARIO_KIND.get(scenario.get('kind'), text(scenario.get('kind'))),
                         text(spec.case_title(scenario.get('initial_case_id'))),
                         f"{text(row.get('event', step.get('transition_id')))} {tag(step.get('transition_id'))}",
                         ', '.join(spec.plain(value, sid) for value in row.get('preconditions', [])) or '—',
                         spec.plain(row.get('observable_result'), sid),
                         text(spec.case_title(scenario.get('expected_case_id')))])
    for tid in loose:
        row = spec.transitions[tid]
        rows.append(['—', '—', f"{text(row.get('event'))} {tag(tid)}",
                     ', '.join(spec.plain(value, sid) for value in row.get('preconditions', [])) or '—',
                     spec.plain(row.get('observable_result'), sid), '—'])
    L += table(['종류', '시작', '무엇이 일어나면', '조건', '결과', '도착'], rows) or ['동작이 없습니다.', '']
    more = []
    for tid in [tid for tid in spec.transitions if tid in used or tid in loose]:
        row = spec.transitions[tid]
        lines = [f"- **{text(row.get('event'))}** {tag(tid)}"]
        if row.get('parent_transition_refs'):
            lines.append('  - 사용자 경험의 전이: ' + ', '.join(spec.ux_link(ref) for ref in row['parent_transition_refs']))
        if row.get('before') or row.get('after'):
            lines.append(f"  - 바뀌는 값: {spec.assignments(row.get('before', []))} → {spec.assignments(row.get('after', []))}")
        if row.get('preserved_values'):
            lines.append(f"  - 그대로 남는 값: {spec.assignments(row['preserved_values'])}")
        if row.get('allowed_actions'):
            lines.append(f"  - 다음에 할 수 있는 것: {joined(row['allowed_actions'])}")
        for key, label in (('feedback', '피드백'), ('focus_result', '포커스')):
            if row.get(key):
                lines.append(f"  - {label}: {spec.plain(row[key], sid)}")
        selector = row.get('target_selector') or {}
        if selector.get('kind') not in (None, 'none'):
            lines.append(f"  - 대상: {text(selector.get('kind'))} {text(selector.get('symbol'))} (규칙 {text(selector.get('rule_id'))})")
        for scenario in scenarios:
            for step in scenario.get('steps', []):
                if step.get('transition_id') != tid:
                    continue
                if step.get('expected_observations'):
                    lines.append(f"  - 관찰 ({text(scenario.get('id'))}): " + ', '.join(spec.plain(v, sid) for v in step['expected_observations']))
                for binding in step.get('item_bindings', []):
                    lines.append(f"  - 항목 {text(binding.get('symbol'))} → {joined(binding.get('item_refs', []))}")
        more += lines
    return L + details('동작 상세 — 바뀌는 값·피드백·포커스', more + [''] if more else [])


def _rules(spec, sid):
    scopes = spec.scopes(sid)
    L = []
    for rule in _rows(spec.data, 'interaction_rules'):
        if not set(rule.get('input_scope_ids', []) + rule.get('output_scope_ids', [])) & scopes:
            continue
        L += [f"**연동 규칙** ({text(rule.get('kind'))}) {tag(rule['id'])}", '']
        L += table(['이러면', '이렇게 된다'], [[spec.assignments(row.get('when', [])), spec.assignments(row.get('effects', []))]
                                           for row in rule.get('condition_rows', [])])
    for constraint in _rows(spec.data, 'constraints'):
        if not set(constraint.get('scope_ids', [])) & scopes:
            continue
        L.append(f"- **제약** {spec.plain(constraint.get('condition'), sid)} → {spec.plain(constraint.get('required_outcome'), sid)}"
                 f" {tag(constraint['id'])}")
        if constraint.get('rationale'):
            L.append(f"  - 이유: {spec.plain(constraint['rationale'], sid)}")
        for combination in constraint.get('forbidden_combinations', []):
            L.append(f"  - 허용하지 않는 조합: {spec.assignments(combination)}")
    return ['### 규칙과 제약', ''] + L + [''] if L else []


def _handoff(spec, sid, gaps):
    L = []
    for handoff in _rows(spec.data, 'design_handoffs'):
        if handoff.get('screen_id') != sid:
            continue
        L += ['### 디자인 인계', '', spec.plain(handoff.get('semantic_pattern'), sid), '']
        L += [f"- {spec.plain(value, sid)}" for value in handoff.get('accessibility_expectations', [])]
        status = MAPPING_STATUS.get(handoff.get('mapping_status'), text(handoff.get('mapping_status')))
        ref = handoff.get('candidate_design_system_ref')
        L += ['', (f"디자인 시스템: {code(ref)} — {status}" if ref else f"디자인 시스템: {status}")
              + (f" · 담당: {text(handoff['owner'])}" if handoff.get('owner') else ''), '']
        if handoff.get('gap'):
            gaps.append((sid, spec.plain(handoff['gap'], sid)))
    return L


def _render(data, context):
    spec = _Spec(data, context)
    order = [sid for sid in context.journey_order(list(spec.screens.values())) if sid in spec.screens]
    gaps = []
    L = [f"# {text(data.get('title', '화면 동작 명세'))}", ''] + notice(JSON_NAME, context.review_name(SB))
    L += _summary(spec, order) + _screen_index(spec, order)
    for sid in order:
        screen = spec.screens[sid]
        L += [f"## {text(screen['name'])} {tag(sid)}{anchor(sid)}", '',
              f"**{ORIGIN.get(screen.get('origin'), '미표시')}** · {spec.plain(screen.get('purpose'), sid)}", '']
        ways = []
        if screen.get('entry_refs'):
            ways.append('들어오는 길: ' + ', '.join(spec.ux_link(ref) for ref in screen['entry_refs']))
        if screen.get('exit_refs'):
            ways.append('나가는 길: ' + ', '.join(spec.ux_link(ref) for ref in screen['exit_refs']))
        if ways:
            L += [' · '.join(ways), '']
        L += _changes(spec, sid) + _parts(spec, sid) + _states(spec, sid) + _cases(spec, sid)
        L += _behavior(spec, sid) + _rules(spec, sid) + _handoff(spec, sid, gaps)

    L += ['## 이 단계의 결정', '']
    decisions = _rows(data, 'decisions')
    L += table(['결정', '상태', ''], [[spec.plain(row.get('statement'), COMMON), DECISION_STATUS.get(row.get('status'), text(row.get('status'))),
                                    f"`{row['id']}`"] for row in decisions]) or ['이 단계에서 기록한 결정이 없습니다.', '']
    for packet in _rows(data, 'decision_packets'):
        options = {row.get('id'): row for row in packet.get('options') or []}
        selection = packet.get('selection') or {}
        chosen = options.get(selection.get('option_id'), {}).get('label') or selection.get('custom_text') or '미정'
        L.append(f"- **{text(packet.get('topic'))}** {tag(packet.get('id'))} — {text(chosen)}")
    L += ['', '<a id="open"></a>', '## 미결 사항과 범위 밖', '']
    items = [f"- **{text(spec.screens[sid]['name'])}** — {gap}" for sid, gap in gaps]
    items += [f"- **확인 필요** {text(row.get('question'))} — {text(row.get('reason'))} {tag(row.get('id'))}"
              for row in _rows(data, 'issues') if not row.get('resolution')]
    items += [f"- **미룸** {text(row.get('input_ref'))} — {spec.plain(row.get('reason'), COMMON)}"
              for row in _rows(data, 'inventory_links') if row.get('disposition') == 'deferred']
    items += [f"- **한계** {spec.plain(row, COMMON)}" for row in (data.get('evidence_status') or {}).get('coverage_limits') or []]
    items += [f"- **흐릿함** {text(row.get('note'))} — {text(row.get('why_not_ticket'))}" for row in _rows(data, 'fog')]
    items += [f"- **범위 밖** {text(row.get('note'))} — {text(row.get('reason'))}" for row in _rows(data, 'out_of_scope')]
    L += (items or ['- 없음']) + ['']
    return '\n'.join(L), spec


def render_body(data, context):
    return _render(data, context)[0]


def render_review(data, report, context):
    _, spec = _render(data, context)  # the codes the body moved out of its prose
    moved = {owner: sorted(set(codes)) for owner, codes in spec.codes.items()}
    L = [f"# {text(data.get('title', '화면 동작 명세'))} — 검토 기록", ''] + review_notice(JSON_NAME.replace('.json', '.md'))
    L += report_lines(report)
    L += ['## 상위 단계 추적', '', '본문 문장에서 뺀 상위 코드(PRD 규칙·결정, 기준선 영역 등)를 화면별로 모았습니다.', '']
    L += table(['화면', '문장에 붙어 있던 코드'], [[text(spec.name(owner)), joined(codes)] for owner, codes in moved.items()]) or ['없음', '']
    reviews = _rows(data, 'reviews') + [row for row in (data.get('review') or {}).values() if isinstance(row, dict)]
    if reviews:
        L += ['## 단계 검토 (S1–S8)', '']
        L += table(['기준', '대상', '판정', '근거', '예시'], [[text(row.get('criterion_id')), joined(row.get('target_refs', [])),
                                                      text(row.get('verdict')), text(row.get('rationale')),
                                                      joined(row.get('example_ids', []))] for row in reviews])
    if data.get('decision_inventory'):
        L += ['## 결정 목록 분류', '']
        L += table(['항목', '대상', '분류', '상태', '근거'],
                   [[text(row.get('id')), joined(row.get('target_refs', [])), text(row.get('classification')),
                     text(row.get('status')), text(row.get('rationale'))] for row in _rows(data, 'decision_inventory')])
    L += ['## 결정 근거', '']
    L += table(['결정', '출처', '상위', '근거'], [[text(row['id']), text(row.get('origin')), joined(row.get('parent_refs', [])),
                                             text(row.get('rationale'))] for row in _rows(data, 'decisions')]) or ['없음', '']
    checks = _rows(data, 'coverage_checks')
    if checks:
        L += ['## 커버리지 점검', '', f'{len(checks)}건', '']
        L += table(['범위', '차원', '상태', '사유'], [[text(row.get('scope_id')), text(row.get('dimension')), text(row.get('status')),
                                                 text(row.get('rationale'))] for row in checks])
    links = _rows(data, 'inventory_links')
    if links:
        L += ['## 상위 입력 처리', '', f'{len(links)}건', '']
        L += table(['입력', '처리', '화면·요소', '사유'], [[text(row.get('input_ref')), text(row.get('disposition')),
                                                    joined(row.get('screen_ids', []) + row.get('element_ids', [])),
                                                    text(row.get('reason'))] for row in links])
    elements = _rows(data, 'elements')
    if elements:
        L += ['## 요소 분류', '']
        L += table(['요소', '의미 유형', '반복', '정보·행동 참조'],
                   [[text(row['id']), text(row.get('semantic_type')), text(json.dumps(row.get('repetition'), ensure_ascii=False)),
                     joined(row.get('information_refs', []) + row.get('action_refs', []))] for row in elements])
    initial = [[text(axis['id']), text(row.get('condition')), text(row.get('value_id')), text(row.get('rationale'))]
               for axis in _rows(data, 'state_axes') for row in axis.get('initial_conditions', []) if isinstance(row, dict)]
    if initial:
        L += ['## 초기값 근거', ''] + table(['축', '조건', '값', '근거'], initial)
    cases = [[text(row['id']), joined(row.get('scenario_ids', []))] for row in _rows(data, 'render_cases')]
    if cases:
        L += ['## 사례·시나리오 연결', ''] + table(['사례', '시나리오'], cases)
    for key, title in (('interaction_rules', '연동 규칙 원문'), ('design_handoffs', '디자인 인계 원문'), ('issues', '확인 사항 (해결 포함)')):
        L += json_rows(title, _rows(data, key))
    L += ['## 출처', '']
    L += table(['ID', '종류', '참조', '발췌'], [[text(row['id']), text(row.get('kind')), text(row.get('reference')),
                                            text(row.get('excerpt'))] for row in _rows(data, 'sources')]) or ['없음', '']
    for key, title in (('state_profiles', '상태 프로필'), ('history', '변경 이력')):
        L += json_rows(title, data.get(key) or [])
    L += ['## 입력과 확정', '', '```json',
          json.dumps({key: data.get(key) for key in ('input_binding', 'knowledge_binding', 'evidence_status', 'confirmation')},
                     ensure_ascii=False, indent=1), '```', '']
    return '\n'.join(L)
