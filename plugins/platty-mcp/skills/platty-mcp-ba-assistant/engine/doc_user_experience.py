"""The user experience as a planner and a designer read it (schema 2).

Order: summary → who and where → the journey at a glance → each journey in detail → states →
what each screen must show → decisions → open questions. Coverage obligations, assessments,
sources and bindings go to the review file.
"""

import json

from doc_common import (DECISION_STATUS, ORIGIN, SCENARIO_KIND, anchor, joined, json_rows, link, mermaid_label,
                        notice, report_lines, review_notice, slug, table, tag, text)

UX, SB = 'user_experience', 'screen_behavior'
JSON_NAME = 'user-experience.json'


def _rows(data, key):
    return [row for row in data.get(key) or [] if isinstance(row, dict)]


def _screen_link(data, context, view_id):
    screen = context.screen_for_view(view_id)
    href = context.doc_href(UX, SB, slug(screen['id'])) if screen else None
    return link(text(screen['name']), href) if screen and href else None


def render_body(data, context):
    states = {row['id']: row for row in _rows(data, 'experience_states')}
    transitions = {row['id']: row for row in _rows(data, 'experience_transitions')}
    touchpoints = {row['id']: row for row in _rows(data, 'touchpoints')}
    views = _rows(data, 'view_requirements')
    view_by_touchpoint = {row['touchpoint_id']: row['id'] for row in views}
    scenarios = _rows(data, 'scenarios')
    claims = _rows(data, 'claims')
    decisions = [row for row in claims if row.get('kind') == 'decision']
    unknowns = [row for row in claims if row.get('kind') == 'unknown']
    assumptions = [row for row in claims if row.get('kind') == 'assumption']
    packets = _rows(data, 'decision_packets')
    limits = (data.get('evidence_status') or {}).get('coverage_limits') or []
    issues = [row for row in _rows(data, 'issues') if not row.get('resolution')]
    happy = next((row for row in scenarios if row.get('kind') == 'happy'), scenarios[0] if scenarios else None)
    screens = [row for row in touchpoints.values() if row.get('kind') == 'screen']
    open_count = len(unknowns) + len(issues) + len(limits)

    L = [f"# {text(data.get('title', '사용자 경험'))}", ''] + notice(JSON_NAME, context.review_name(UX))
    L += ['## 요약', '']
    if happy:
        L.append(f"- **이 경험이 끝나는 곳**: {joined(happy.get('postconditions', []))}")
    L += [f"- **누가**: {joined(row.get('name') for row in _rows(data, 'actors'))}",
          f"- **어디서**: " + (' → '.join(f"{text(row['name'])}({ORIGIN.get(row.get('status'), row.get('status', ''))})"
                                         for row in screens) or '—'),
          f"- **여정**: 시나리오 {len(scenarios)}개 — 상태 {len(states)}개, 전이 {len(transitions)}개"]
    if decisions or packets:
        top = [text(row['text']) for row in decisions[:3]]
        rest = len(decisions) + len(packets) - len(top)
        L.append('- **핵심 결정**: ' + ' / '.join(top) + (f' 외 {rest}건' if rest > 0 else '') + ' → [결정](#decisions)')
    L += [f"- **미결·한계**: {open_count}건 → [미결 사항](#open)", '',
          '> 읽는 순서 — 기획: 요약·2·6·7절 · 디자인: 2–5절 · 다음 단계(화면 동작 명세): 5절', '']

    L += ['## 1. 사용자와 접점', '']
    L += table(['사용자', '바라는 것', '하는 일', '할 수 있는 것'],
               [[text(row['name']), text(row.get('goal')), joined(row.get('responsibilities', [])),
                 joined(row.get('permissions', []))] for row in _rows(data, 'actors')])
    for row in _rows(data, 'actors'):
        if row.get('happy_path_exclusion'):
            L += [f"{text(row['name'])}은(는) 정상 여정에서 뺐다 — {text(row['happy_path_exclusion'])}", '']
    L += table(['접점', '상태', '목적', '들어오는 곳'],
               [[f"{text(row['name'])} {tag(row['id'])}", ORIGIN.get(row.get('status'), text(row.get('status'))),
                 text(row.get('purpose')), joined(row.get('entry_points', []))] for row in touchpoints.values()])

    L += ['## 2. 여정 한눈에', '']
    if states:
        L += ['상태 사이 화살표는 사용자가 하는 일입니다.', '', '```mermaid', 'stateDiagram-v2']
        node = {sid: 's' + str(n) for n, sid in enumerate(states)}
        for sid, row in states.items():
            L.append(f'  state "{mermaid_label(row["name"])}" as {node[sid]}')
        for sid, row in states.items():
            if row.get('kind') == 'initial':
                L.append(f'  [*] --> {node[sid]}')
        for row in transitions.values():
            if row.get('from_state') in node and row.get('to_state') in node:
                L.append(f"  {node[row['from_state']]} --> {node[row['to_state']]} : {mermaid_label(row['trigger'])}")
        L += ['```', '']
    if happy:
        L += ['정상 여정을 단계별로 보면:', '']
        rows = []
        for number, step in enumerate(_rows(happy, 'steps'), 1):
            transition = transitions.get(step.get('transition_id')) or {}
            view_id = view_by_touchpoint.get(transition.get('touchpoint_id'))
            where = (_screen_link(data, context, view_id) if view_id else None) or \
                text((touchpoints.get(transition.get('touchpoint_id')) or {}).get('name', '—'))
            rows.append([str(number), text(step.get('actor_action')), where,
                         joined(step.get('information_shown', [])), text(transition.get('feedback', ''))])
        L += table(['#', '사용자 행동', '어디서', '보이는 것', '사용자가 얻는 것'], rows)

    L += ['## 3. 여정 상세', '']
    for scenario in scenarios:
        kind = SCENARIO_KIND.get(scenario.get('kind'), text(scenario.get('kind')))
        L += [f"### {kind} · {text(scenario['title'])} {tag(scenario['id'])}{anchor(scenario['id'])}", '',
              f"**시작**: {text(scenario.get('trigger'))}"
              + (f" (전제: {joined(scenario.get('preconditions', []))})" if scenario.get('preconditions') else ''), '']
        for number, step in enumerate(_rows(scenario, 'steps'), 1):
            transition = transitions.get(step.get('transition_id'))
            line = f"{number}. {text(step.get('actor_action'))}"
            if transition:
                line += f" → {text(transition.get('feedback'))} ([{text(transition['id'])}](#{slug(transition['id'])}))"
            if step.get('choices'):
                line += f" · 고를 수 있는 것: {joined(step['choices'])}"
            L.append(line)
        L += ['', f"**끝**: {joined(scenario.get('postconditions', []))}", '']
    if transitions:
        L += ['### 전이별 기다림·실패·복구', '', '각 전이에서 화면이 무엇을 보여야 하는지입니다.', '']
        L += table(['전이 (조건)', '보이는 결과', '기다리는 동안', '실패하면', '다시 올 때'],
                   [[f"{anchor(tid)}**{text(row['trigger'])}** {tag(tid)}<br><sub>{text(row.get('user_visible_condition'))}</sub>",
                     text(row.get('feedback')), text(row.get('waiting_experience')),
                     text(row.get('recovery_experience')), text(row.get('repeat_experience'))]
                    for tid, row in transitions.items()])
        access = [row for row in transitions.values() if row.get('accessibility_requirements')]
        if access:
            L += ['접근성:', ''] + [f"- {text(row['trigger'])} — {joined(row['accessibility_requirements'], ' / ')}"
                                  for row in access] + ['']
        impact = [row for row in transitions.values() if row.get('impact_and_reversibility')]
        if impact:
            L += ['되돌릴 수 있는지:', ''] + [f"- {text(row['trigger'])} — {text(row['impact_and_reversibility'])}"
                                         for row in impact] + ['']
    for matrix in _rows(data, 'decision_matrices'):
        L += [f"### 판단표 · {text(matrix['question'])} {tag(matrix['id'])}", '']
        if matrix.get('conditions'):
            L += [f"따지는 것: {joined(matrix['conditions'])}", '']
        L += table(['경우', '보여줄 것'], [[text(row.split(' → ', 1)[0]), text(row.split(' → ', 1)[1] if ' → ' in row else '')]
                                        for row in matrix.get('rows', [])])
        if matrix.get('outcome_experience'):
            L += [f"어느 경우든: {text(matrix['outcome_experience'])}", '']
    for flow in _rows(data, 'handoff_flows'):
        L += [f"### 상대에게 넘어가는 흐름 · {text(flow['trigger'])} {tag(flow['id'])}", '',
              f"- **넘어가는 것**: {joined(flow.get('handoffs', []), ' → ')}",
              f"- **기다리는 동안**: {text(flow.get('waiting_experience'))}",
              f"- **응답이 없으면**: {text(flow.get('failure_experience'))}",
              f"- **대신 할 수 있는 것**: {text(flow.get('manual_fallback'))}", '']

    L += ['## 4. 경험 상태', '']
    for sid, row in states.items():
        L += [f"#### {text(row['name'])} {tag(sid)}{anchor(sid)}", '', text(row.get('user_meaning')), '',
              f"- 보이는 것: {joined(row.get('information_shown', []))}",
              f"- 할 수 있는 것: {joined(row.get('available_actions', []))}",
              f"- 들어오는 조건: {joined(row.get('entry_conditions', []))}",
              f"- 나가는 조건: {joined(row.get('exit_conditions', []))}"]
        if row.get('resume_experience'):
            L.append(f"- 다시 돌아오면: {text(row['resume_experience'])}")
        L.append('')

    L += ['## 5. 화면·접점 요구', '', '다음 단계(화면 동작 명세)가 화면으로 만드는 요구입니다.', '']
    for view in views:
        name = (touchpoints.get(view.get('touchpoint_id')) or {}).get('name', view['id'])
        screen = _screen_link(data, context, view['id'])
        L += [f"#### {text(name)} {tag(view['id'])}{anchor(view['id'])}" + (f" → {screen}" if screen else ''), '',
              text(view.get('purpose')), '',
              f"- 보여줄 정보: {joined(view.get('information', []))}",
              f"- 할 수 있는 행동: {joined(view.get('actions', []))}",
              f"- 들어오는 길: {joined(view.get('entry_paths', []))} · 나가는 길: {joined(view.get('exit_paths', []))}",
              '- 보이는 상태: ' + (', '.join(link(text(states[s]['name']), f'#{slug(s)}') if s in states else text(s)
                                        for s in view.get('states', [])) or '—'), '']

    L += ['<a id="decisions"></a>', '## 6. 결정', '']
    if decisions:
        L += ['상위 확정에서 이어받아 이 경험의 바탕이 된 결정입니다.', '']
        L += table(['결정', ''], [[text(row['text']), f"`{row['id']}`"] for row in decisions])
    for packet in packets:
        options = {row.get('id'): row for row in packet.get('options') or []}
        selection = packet.get('selection') or {}
        chosen = options.get(selection.get('option_id'), {}).get('label') or selection.get('custom_text') or '미정'
        L += [f"- **{text(packet['topic'])}** {tag(packet['id'])} — {text(chosen)} "
              f"({DECISION_STATUS.get(packet.get('status'), text(packet.get('status')))})"]
    if packets:
        L.append('')
    facts = [row for row in claims if row.get('kind') == 'fact']
    if facts or assumptions:
        L += ['사실과 가정:', ''] + [f"- {'사실' if row['kind'] == 'fact' else '가정'} — {text(row['text'])} {tag(row['id'])}"
                                  for row in facts + assumptions] + ['']
    if not (decisions or packets or facts or assumptions):
        L += ['이 단계에서 기록한 결정이 없습니다.', '']

    L += ['<a id="open"></a>', '## 7. 미결 사항과 한계', '']
    items = [f"- **미결** {text(row['text'])} {tag(row['id'])}" for row in unknowns]
    items += [f"- **확인 필요** {text(row.get('question'))} — {text(row.get('reason'))} {tag(row.get('id'))}" for row in issues]
    items += [f"- **한계** {text(row)}" for row in limits]
    items += [f"- **흐릿함** {text(row.get('note'))} — {text(row.get('why_not_ticket'))}" for row in data.get('fog') or []
              if isinstance(row, dict)]
    items += [f"- **범위 밖** {text(row.get('note'))} — {text(row.get('reason'))}" for row in data.get('out_of_scope') or []
              if isinstance(row, dict)]
    L += (items or ['- 없음']) + ['']
    return '\n'.join(L)


def render_review(data, report, context):
    L = [f"# {text(data.get('title', '사용자 경험'))} — 검토 기록", ''] + review_notice(JSON_NAME.replace('.json', '.md'))
    L += report_lines(report)
    review = data.get('review') or {}
    if review:
        L += ['## 단계 검토', '']
        L += table(['기준', '판정', '근거'], [[text(key), text(row.get('verdict')), text(row.get('rationale'))]
                                          for key, row in review.items() if isinstance(row, dict)])
    assessed = [(row['id'], row['assessment']) for key in ('scenarios', 'view_requirements')
                for row in _rows(data, key) if isinstance(row.get('assessment'), dict)]
    if assessed:
        L += ['## 시나리오·화면 요구 검토', '']
        L += table(['대상', '판정', '근거'], [[text(ident), text(row.get('verdict')), text(row.get('rationale'))]
                                          for ident, row in assessed])
    obligations = _rows(data, 'coverage_obligations')
    if obligations:
        L += ['## 커버리지 의무', '', f'{len(obligations)}건', '']
        L += table(['의무', '전이', '차원', '조건', '상태', '근거 종류', '사유'],
                   [[text(row['id']), text(row.get('transition_id')), text(row.get('dimension')), text(row.get('condition')),
                     text(row.get('status')), text(row.get('basis_type')), text(row.get('rationale'))] for row in obligations])
    trace = [[text(row['id']), text(row.get('kind')), joined(row.get('source_ids', []))] for row in _rows(data, 'claims')]
    trace += [[text(row['id']), '전이', joined(row.get('rule_claim_ids', []) + row.get('source_ids', []))]
              for row in _rows(data, 'experience_transitions')]
    if trace:
        L += ['## 근거 추적', '']
        L += table(['항목', '종류', '근거'], trace)
    L += ['## 출처', '']
    L += table(['ID', '종류', '참조', '발췌'], [[text(row['id']), text(row.get('kind')), text(row.get('reference')),
                                            text(row.get('excerpt'))] for row in _rows(data, 'sources')]) or ['없음', '']
    for key, title in (('coverage_checks', '커버리지 점검'), ('path_reviews', '경로 검토'), ('policy_checks', '정책 점검'),
                       ('history', '변경 이력')):
        L += json_rows(title, data.get(key) or [])
    L += ['## 입력과 확정', '', '```json',
          json.dumps({key: data.get(key) for key in ('input_binding', 'evidence_status', 'confirmation')},
                     ensure_ascii=False, indent=1), '```', '']
    return '\n'.join(L)
