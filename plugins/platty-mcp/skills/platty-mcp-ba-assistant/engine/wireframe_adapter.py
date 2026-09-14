"""Convert completed screen-behavior records into wireframe target briefs."""

import copy
from pathlib import Path

import screen_behavior


def adapt_screen_behavior(data, source_path=None, knowledge_binding=None):
    if data.get('schema_version') != 3:
        raise ValueError('screen behavior input must use schema v3')
    report = screen_behavior.validate(data)
    if not report['complete']:
        raise ValueError('screen behavior input must be complete and current')

    screens = {row['id']: row for row in data['screens']}
    elements = {row['id']: row for row in data['elements']}
    axes = {row['id']: row for row in data['state_axes']}

    def screen_for_scope(scope_id):
        if scope_id in screens:
            return scope_id
        if scope_id in elements:
            return elements[scope_id]['screen_id']
        return None

    def row_decision_ids(rows):
        return sorted({did for row in rows for did in row.get('decision_ids', [])})

    def assignment_state(row):
        axis = axes[row['axis_id']]
        return {
            'scope_id': row['scope_id'],
            'item_ref': row['item_ref'],
            'axis_id': row['axis_id'],
            'dimension': axis['dimension'],
            'value_id': row['value_id'],
        }

    def transition_brief(transition):
        contract = interaction_contract(transition)
        return {
            'transition_id': transition['id'],
            'target_scope_ids': list(transition['target_scope_ids']),
            'target_selector': copy.deepcopy(transition['target_selector']),
            'event': transition['event'],
            'preconditions': list(transition['preconditions']),
            'before': [assignment_state(row) for row in transition['before']],
            'after': [assignment_state(row) for row in transition['after']],
            'observable_result': transition['observable_result'],
            'allowed_actions': list(transition['allowed_actions']),
            'preserved_values': [assignment_state(row) for row in transition['preserved_values']],
            'feedback': transition['feedback'],
            'focus_result': transition['focus_result'],
            'parent_transition_refs': list(transition['parent_transition_refs']),
            'scenario_ids': sorted(
                row['id'] for row in data['scenarios']
                if any(step['transition_id'] == transition['id'] for step in row['steps'])
            ),
            'source_ids': list(transition['source_ids']),
            'decision_ids': list(transition['decision_ids']),
            'interaction_contract': contract,
        }

    def constraint_brief(row):
        return {
            'constraint_id': row['id'],
            'scope_ids': list(row['scope_ids']),
            'condition': row['condition'],
            'required_outcome': row['required_outcome'],
            'forbidden_combinations': [
                [assignment_state(assignment) for assignment in combination]
                for combination in row['forbidden_combinations']
            ],
            'rationale': row['rationale'],
            'source_ids': list(row['source_ids']),
            'decision_ids': list(row['decision_ids']),
        }

    def rule_brief(row):
        return {
            'rule_id': row['id'],
            'kind': row['kind'],
            'input_scope_ids': list(row['input_scope_ids']),
            'output_scope_ids': list(row['output_scope_ids']),
            'condition_rows': [{
                'id': condition['id'],
                'when': [assignment_state(assignment) for assignment in condition['when']],
                'effects': [assignment_state(assignment) for assignment in condition['effects']],
                'transition_ids': list(condition['transition_ids']),
                'scenario_ids': list(condition['scenario_ids']),
            } for condition in row['condition_rows']],
            'source_ids': list(row['source_ids']),
            'decision_ids': list(row['decision_ids']),
        }

    def inventory_brief(row):
        return {
            'input_ref': row['input_ref'],
            'disposition': row['disposition'],
            'screen_ids': list(row['screen_ids']),
            'element_ids': list(row['element_ids']),
            'reason': row['reason'],
            'source_ids': list(row['source_ids']),
        }

    def interaction_contract(transition):
        selector = transition.get('target_selector') or {}
        event = str(transition.get('event', '')).lower()
        subject = {
            '나중에 처리': 'deal-close', '계속 기다리기': 'confirm-cancel',
            '계속 편집': 'confirm-cancel', '버리고 닫기': 'confirm-accept',
            '닫기 확인': 'confirm-accept', '이력 확인 후 반영': 'confirm-accept',
            '재반영 취소': 'confirm-cancel', '재시도 선택': 'preview-retry',
            '다시 확인': 'preview-retry', '목록 복귀': 'deal-close',
        }.get(event, '') or next((scope for token, scope in (
            ('키보드로 기준 미션', 'criterion-selector'), ('키보드로 최초 딜', 'deal-link'),
            ('키보드로 선정산', 'deal-mode'), ('키보드로 차액 딜 이름', 'deal-name'),
            ('키보드로 반영 실행', 'deal-apply'), ('키보드로 창 닫기', 'deal-close'),
            ('키보드로 실행·닫기 확인', 'deal-confirm'), ('키보드로 현재 연결 구조', 'deal-tabs'),
            ('키보드로 설정 저장', 'settings-save'), ('키보드로 설정 취소', 'settings-cancel'),
            ('키보드로 설정 보완', 'settings-correct'), ('키보드로 계산 다시', 'preview-retry'),
            ('키보드로 반영 결과', 'result-check'), ('키보드로 확인하고', 'confirm-accept'),
            ('키보드로 취소하고', 'confirm-cancel'), ('딜 관리', 'list-entry'),
            ('체험단 설정 열기', 'list-entry'), ('deal-link', 'deal-link'), ('deal-mode', 'deal-mode'),
            ('이름', 'deal-name'), ('회차 a', 'round-details'), ('기준 미션', 'criterion-selector'),
            ('설정 저장', 'settings-save'), ('설정 수정', 'deal-tabs'),
            ('결과 다시', 'result-check'), ('결과 재확인', 'result-check'),
            ('다시 계산', 'preview-retry'), ('딜 업데이트 열기', 'deal-tabs'),
            ('반영', 'deal-apply'), ('닫기', 'deal-close'),
        ) if token in event and scope in elements), '')
        if not subject and selector.get('kind') == 'element' and selector.get('symbol') in elements:
            subject = selector.get('symbol')
        if not subject:
            subject = next((scope for scope in transition.get('target_scope_ids', []) if scope in elements), '')
        element = elements.get(subject, {})
        semantic_type = element.get('semantic_type', '')
        item_ref = next(
            (row.get('item_ref') for row in list(transition.get('after', [])) + list(transition.get('before', []))
             if row.get('scope_id') == subject and row.get('item_ref') not in (None, '')),
            None,
        )
        if event == '설정 수정':
            item_ref = 'structure'
        elif event == '딜 업데이트 열기':
            item_ref = 'update'
        action = infer_user_action(transition, semantic_type)
        before_state = {(row.get('scope_id'), row.get('item_ref'), row.get('axis_id'), row.get('value_id')) for row in transition.get('before', [])}
        after_state = {(row.get('scope_id'), row.get('item_ref'), row.get('axis_id'), row.get('value_id')) for row in transition.get('after', [])}
        if before_state == after_state:
            action = ''
        return {
            'origin': 'user_action' if action else 'system_result',
            'action': action or 'external-state',
            'subject_scope_id': subject,
            'item_ref': item_ref,
            'source': 'target_selector:' + str(selector.get('kind', 'none')),
        }

    # 사용자 조작 전이가 시스템 결과로 강등되던 자리다. 예전에는 **이전 케이스의 한국어
    # 이벤트 문자열 14개를 표로 들고** 있었다(「딜 관리 열기」·「회차 a만 펼치」…). 새 도메인의
    # 조작 이름은 하나도 걸리지 않아 전부 `''`를 돌려줬고, `origin`이 `system_result`가 됐다.
    # `validation.md`가 **「external-state는 사용자 조작 전이를 대신 증명할 수 없다」**고 금지한
    # 바로 그 상태를 기계가 만들어 내고 게이트는 통과시켰다(7차 실측: SBT-retry).
    #
    # 낱말을 늘리는 것은 답이 아니다 — 도메인마다 새 낱말이 나온다. 구조는 이미 있다:
    # 시스템 전이는 `event: "external-state"`로 **스스로 그렇게 말하고**, 사용자 전이는
    # 조작 가능한 요소를 타깃에 갖는다. 조작의 종류는 그 요소가 무엇인지가 정한다.
    CONTROL_ACTIONS = (
        (('checkbox', 'checkbox_group', 'selection', 'selection_group'), 'check'),
        (('input', 'text_input', 'field', 'editor'), 'fill'),
        (('select', 'combobox'), 'select'),
        (('command', 'button', 'action', 'action_button', 'action_group',
          'link', 'navigation', 'navigation_row', 'control', 'disclosure',
          'exit_actions', 'listitem', 'row'), 'click'),
    )
    SYSTEM_EVENTS = ('external-state', 'external_state', 'async', 'system')

    def infer_user_action(transition, semantic_type):
        """The action this transition needs, read from the artifact rather than its wording."""
        event = str(transition.get('event', '')).strip().lower()
        # 산출물이 스스로 「이것은 시스템이 한 일」이라고 적은 경우.
        if event in SYSTEM_EVENTS:
            return ''
        for types, action in CONTROL_ACTIONS:
            if semantic_type in types:
                return action
        # 조작 가능한 요소가 타깃에 하나라도 있으면 사용자 전이다.
        for scope in transition.get('target_scope_ids', []):
            kind = elements.get(scope, {}).get('semantic_type', '')
            for types, action in CONTROL_ACTIONS:
                if kind in types:
                    return action
        return ''

    def navigation_links():
        by_ref = {}
        for screen in data['screens']:
            for ref in screen['exit_refs']:
                by_ref.setdefault(ref, {'source_screen_ids': set(), 'destination_screen_ids': set()})
                by_ref[ref]['source_screen_ids'].add(screen['id'])
            for ref in screen['entry_refs']:
                by_ref.setdefault(ref, {'source_screen_ids': set(), 'destination_screen_ids': set()})
                by_ref[ref]['destination_screen_ids'].add(screen['id'])
        links = []
        for ref, sides in sorted(by_ref.items()):
            if not sides['source_screen_ids'] or not sides['destination_screen_ids']:
                continue
            source_ids = sorted(sides['source_screen_ids'])
            destination_ids = sorted(sides['destination_screen_ids'])
            links.append({
                'transition_id': ref,
                'screen_ids': sorted(set(source_ids) | set(destination_ids)),
                'source_screen_ids': source_ids,
                'destination_screen_ids': destination_ids,
                'semantics': {
                    'source_exit_refs': {
                        screen_id: [ref] for screen_id in source_ids
                    },
                    'destination_entry_refs': {
                        screen_id: [ref] for screen_id in destination_ids
                    },
                },
                'navigation_coverage': {
                    'status': 'cross_screen_link',
                    'covered_as_target_flow': False,
                    'source_screen_ids': source_ids,
                    'destination_screen_ids': destination_ids,
                },
            })
        return links

    def keep_one_user_action_per_observed_event(flows):
        groups = {}
        for flow in flows:
            contract = flow['interaction_contract']
            if contract['origin'] != 'user_action':
                continue
            key = (flow['event'], tuple(flow['scenario_ids']), tuple(flow['parent_transition_refs']))
            groups.setdefault(key, []).append(flow)
        for candidates in groups.values():
            candidates.sort(key=lambda flow: (
                flow['interaction_contract']['subject_scope_id'] not in flow['target_scope_ids'],
                flow['transition_id'],
            ))
            for consequence in candidates[1:]:
                consequence['interaction_contract'] = {
                    'origin': 'system_result',
                    'action': 'external-state',
                    'subject_scope_id': consequence['interaction_contract']['subject_scope_id'],
                    'item_ref': consequence['interaction_contract']['item_ref'],
                    'source': 'same_event_consequence',
                }

    targets = []
    linked_transitions = set()
    cross_screen_links = navigation_links()
    for screen_id in sorted(screens):
        screen = screens[screen_id]
        screen_elements = sorted(
            (row for row in data['elements'] if row['screen_id'] == screen_id),
            key=lambda row: row['id'],
        )
        scope_ids = {screen_id} | {row['id'] for row in screen_elements}
        screen_cases = sorted(
            (row for row in data['render_cases'] if row['screen_id'] == screen_id),
            key=lambda row: row['id'],
        )
        screen_handoffs = sorted(
            (row for row in data['design_handoffs'] if row['screen_id'] == screen_id),
            key=lambda row: row['id'],
        )
        handoff_case_ids = {case_id for row in screen_handoffs for case_id in row['render_case_ids']}
        missing_case_ids = sorted({row['id'] for row in screen_cases} - handoff_case_ids)
        if missing_case_ids:
            raise ValueError('missing render case coverage: ' + ', '.join(missing_case_ids))

        flows = []
        for transition in sorted(data['transitions'], key=lambda row: row['id']):
            transition_screens = sorted({screen_for_scope(scope) for scope in transition['target_scope_ids']})
            transition_screens = [sid for sid in transition_screens if sid]
            if transition_screens == [screen_id]:
                flows.append(transition_brief(transition))
                linked_transitions.add(transition['id'])
            elif screen_id in transition_screens and transition['id'] not in linked_transitions:
                link = transition_brief(transition)
                link.update({
                    'screen_ids': transition_screens,
                    'navigation_coverage': {
                        'status': 'cross_screen_link',
                        'covered_as_target_flow': False,
                        'source_screen_ids': transition_screens,
                        'destination_screen_ids': transition_screens,
                    },
                    'semantics': {'transition': transition_brief(transition)},
                })
                cross_screen_links.append(link)
                linked_transitions.add(transition['id'])

        keep_one_user_action_per_observed_event(flows)

        related_rows = [screen] + screen_elements + screen_cases + screen_handoffs
        related_rows.extend(row for row in data['state_axes'] if row['scope_id'] in scope_ids)
        related_rows.extend(row for row in data['constraints'] if set(row['scope_ids']) & scope_ids)
        related_rows.extend(row for row in data['interaction_rules']
            if set(row['input_scope_ids'] + row['output_scope_ids']) & scope_ids)
        related_rows.extend(row for row in data['transitions']
            if any(screen_for_scope(scope) == screen_id for scope in row['target_scope_ids']))

        targets.append({
            'target_id': screen_id,
            'screen_id': screen_id,
            'task': 'Wireframe ' + screen['name'],
            'purpose': screen['purpose'],
            'audience': list(screen['actor_ids']),
            'nodes': [{
                'element_id': row['id'],
                'parent_id': row['parent_id'],
                'name': row['name'],
                'semantic_type': row['semantic_type'],
                'purpose': row['purpose'],
                'information_refs': row['information_refs'],
                'action_refs': row['action_refs'],
                'repetition': row['repetition'],
                'source_ids': row['source_ids'],
                'decision_ids': row['decision_ids'],
            } for row in screen_elements],
            'states': [{
                'render_case_id': row['id'],
                'title': row['title'],
                'scenario_ids': row['scenario_ids'],
                'sample_items': row['sample_items'],
                'sample_groups': row['sample_groups'],
                'state_assignments': [assignment_state(assignment) for assignment in row['state_assignments']],
                'visible_information': row['visible_information'],
                'available_actions': row['available_actions'],
                'blocked_actions_with_reasons': row['blocked_actions_with_reasons'],
                'focus_expectation': row['focus_expectation'],
                'equivalence_rationale': row['equivalence_rationale'],
            } for row in screen_cases],
            'flows': flows,
            'constraints': [
                constraint_brief(row) for row in sorted(data['constraints'], key=lambda row: row['id'])
                if set(row['scope_ids']) & scope_ids
            ],
            'interaction_rules': [
                rule_brief(row) for row in sorted(data['interaction_rules'], key=lambda row: row['id'])
                if set(row['input_scope_ids'] + row['output_scope_ids']) & scope_ids
            ],
            'inventory_links': [
                inventory_brief(row) for row in sorted(data['inventory_links'], key=lambda row: row['input_ref'])
                if set(row['screen_ids']) & {screen_id} or set(row['element_ids']) & scope_ids
            ],
            'design_handoffs': [{
                'handoff_id': row['id'],
                'element_ids': row['element_ids'],
                'semantic_pattern': row['semantic_pattern'],
                'required_state_refs': row['required_state_refs'],
                'render_case_ids': row['render_case_ids'],
                'interaction_refs': row['interaction_refs'],
                'accessibility_expectations': row['accessibility_expectations'],
                'candidate_design_system_ref': row['candidate_design_system_ref'],
                'mapping_status': row['mapping_status'],
                'gap': row['gap'],
                'owner': row['owner'],
            } for row in screen_handoffs],
            'traceability': {
                'source_ids': sorted(row['id'] for row in data['sources']),
                'decision_ids': row_decision_ids(related_rows),
            },
        })

    manifest = _coverage_manifest(data, linked_transitions, cross_screen_links)
    return {
        'schema_version': 1,
        'source': _source_trace(data, report, source_path, knowledge_binding),
        'knowledge_binding': copy.deepcopy(knowledge_binding),
        'targets': targets,
        'cross_screen_links': sorted(cross_screen_links, key=lambda row: row['transition_id']),
        'inventory_links': [
            inventory_brief(row) for row in sorted(data['inventory_links'], key=lambda row: row['input_ref'])
        ],
        'coverage_manifest': manifest,
    }


def _source_trace(data, report, source_path, knowledge_binding):
    path = str(Path(source_path).resolve()) if source_path is not None else ''
    return {
        'path': path,
        'case_id': data['case_id'],
        'project_id': data['evidence_status']['project_id'],
        'observed_revision': data['evidence_status']['observed_revision'],
        'content_hash': report['content_hash'],
        'review_hash': report['review_hash'],
        'confirmation_turn_id': data['confirmation']['turn_id'],
        'input_hashes': report['input_hashes'],
        'knowledge_binding': copy.deepcopy(knowledge_binding),
        'source_ids': sorted(row['id'] for row in data['sources']),
        'decision_ids': sorted(row['id'] for row in data['decisions']),
    }


def _coverage_manifest(data, linked_transitions, cross_screen_links):
    transition_ids = sorted(row['id'] for row in data['transitions'])
    missing_transitions = sorted(set(transition_ids) - linked_transitions)
    if missing_transitions:
        raise ValueError('missing transition coverage: ' + ', '.join(missing_transitions))
    return {
        'screens': sorted(row['id'] for row in data['screens']),
        'elements': sorted(row['id'] for row in data['elements']),
        'render_cases': sorted(row['id'] for row in data['render_cases']),
        'transitions': transition_ids,
        'flow_transitions': sorted(linked_transitions),
        'cross_screen_links': sorted(row['transition_id'] for row in cross_screen_links),
        'design_handoffs': sorted(row['id'] for row in data['design_handoffs']),
        'source_ids': sorted(row['id'] for row in data['sources']),
        'decision_ids': sorted(row['id'] for row in data['decisions']),
    }
