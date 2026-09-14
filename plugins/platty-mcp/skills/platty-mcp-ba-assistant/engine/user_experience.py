#!/usr/bin/env python3
"""Validate and render User experience user-experience records."""
import argparse
from legacy import interview2 as _legacy
from datetime import datetime
import hashlib
import html
import json
from pathlib import Path
import re
import sys

from planning_context import MAP_FIELDS, Optional, TICKET_FIELDS, check_shape, closed, finding_note, map_gaps, fingerprints as planning_context_fingerprints, load_json, recorded_finding, shape_errors, validate as validate_planning_context
from experience_verification import CHECK_SHAPE, PATH_REVIEW_SHAPE, POLICY_CHECK_SHAPE, seed_checks, verification_gaps, policy_gaps, example_citation_gaps
from experience_graph import graph_gaps
from experience_progress import render_full_model


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / 'schemas/user-experience.template.json'
CRITERIA = tuple(f'X{i}' for i in range(1, 12))
EXAMPLES = tuple(f'UX{i:02}' for i in range(1, 14))
REVIEW_KEYS = ('goal_alignment', 'state_completeness', 'branch_coverage', 'feedback_recovery',
               'grounding', 'handoff_readiness', 'decision_quality')
COVERAGE_DIMENSIONS = (
    'actor_permission', 'precondition', 'input_or_choice', 'success', 'empty_or_no_change',
    'repeat_or_duplicate', 'progress_or_delay', 'partial_success', 'external_wait_or_failure',
    'recovery', 'freshness_or_concurrency', 'post_completion_change', 'other_actor_or_touchpoint',
    'interrupt_and_resume', 'high_risk_confirmation', 'error_understanding', 'state_announcement',
)
ASSESSMENT = {
    'verdict': ('pending', 'suitable', 'needs_work', 'insufficient_evidence', 'not_applicable'),
    'rationale': str, 'criteria': [str], 'example_ids': [str], 'evidence_ids': [str],
    'issue_ids': [str], 'content_hash': str,
}
# A derived stage cites the stage above it, so every upstream document is an import.
IMPORTED_PROVIDERS = ('planning_context', 'jtbd', 'prd')
SOURCE = {'id': str, 'kind': ('user', 'document', 'code', 'imported'),
          'provider': ('user', 'platty', 'web') + IMPORTED_PROVIDERS, 'reference': str,
          'excerpt': str, 'project_id': str, 'revision': str, 'retrieved_at': str}
SHAPE = {
    'schema_version':(2,), 'model_profile': ('ux_statechart_viewflow_v1',),
    'case_id': str, 'title': str,
    'status': ('in_progress', 'awaiting_confirmation', 'waiting', 'paused', 'complete'),
    # The binding names its own upstream; exactly one *_path key is present.
    'input_binding': {
        'planning_context_path': Optional(str), 'prd_path': Optional(str),
        'content_hash': str, 'review_hash': str,
        'confirmation_turn_id': str, 'service_context_project_id': str,
        'service_context_revision': str, 'claim_ids': [str], 'handoff_issue_ids': [str],
    },
    'evidence_status': {
        'project_id': str, 'status': ('missing', 'ready', 'stale', 'unavailable'),
        'checked_at': str, 'baseline_revision': str, 'observed_revision': str,
        'coverage_limits': [str],
        # Optional so artifacts written before it existed still load. A rehearsal cannot have
        # queried a live service, and must not have to pretend it did.
        'mode': Optional(('live', 'simulation')),
    },
    'sources': [SOURCE],
    'claims': [{'id': str, 'text': str, 'kind': ('fact', 'decision', 'assumption', 'unknown'),
                'source_ids': [str]}],
    # UX07은 다른 역할을 「별도 시나리오 **또는 적용 제외 근거**」로 정리하라고 하는데
    # 검증기는 시나리오만 받았다. 규정 없는 중재자(운영)처럼 정상 경로를 적을 수 없는 역할은
    # actors에서 빼는 것 말고는 길이 없었고, 빼면 그 역할은 파생에서 사라졌다.
    # 네 주행이 같은 자리에서 갈렸다 — 한쪽은 오탐으로, 한쪽은 최고의 지적으로 적었다.
    'actors': [{'id': str, 'name': str, 'goal': str, 'responsibilities': [str],
                'permissions': [str], 'source_claim_ids': [str],
                'happy_path_exclusion': Optional(str)}],
    'touchpoints': [{'id': str, 'name': str,
                     'kind': ('screen', 'notification', 'external_service', 'background_result'),
                     # unverified: 이 접점이 지금 제품에 있는지 확인된 적이 없다. new(새로 만든다)와 다르다 —
    # 한 케이스는 기획자 본인도 그 자리가 히로인스 화면인지 몰랐는데 적을 값이 없었다.
    'status': ('current', 'changed', 'new', 'unverified'), 'purpose': str,
                     'entry_points': [str], 'source_ids': [str]}],
    'experience_states': [{'id': str, 'subject': str, 'name': str,
                           # undecided: 나가는 길을 상위가 아직 정하지 않았다. 이것이 없어서 한 케이스가
    # `final`(여기서 끝난다)로 바꿔야 통과했는데 그것은 다른 주장이다.
    'kind': ('initial', 'stable', 'waiting', 'success', 'failure', 'final', 'undecided'),
                           'user_meaning': str, 'visible_to': [str], 'information_shown': [str],
                           'available_actions': [str], 'entry_conditions': [str],
                           'exit_conditions': [str], 'parent_state_id': str, 'parallel_region': str,
                           'resume_experience': str, 'source_ids': [str]}],
    'experience_transitions': [{'id': str, 'from_state': str, 'to_state': str, 'trigger': str,
                                'user_visible_condition': str, 'actor_id': str, 'touchpoint_id': str,
                                'system_response': str, 'feedback': str, 'waiting_experience': str,
                                'repeat_experience': str, 'impact_and_reversibility': str,
                                'recovery_experience': str, 'accessibility_requirements': [str],
                                'rule_claim_ids': [str], 'source_ids': [str]}],
    'scenarios': [{'id': str, 'title': str,
                   'kind': ('happy', 'alternative', 'exception', 'recovery'), 'actor_id': str,
                   'goal_claim_ids': [str], 'trigger': str, 'preconditions': [str],
                   'steps': [{'id': str, 'actor_action': str, 'transition_id': str,
                              'information_shown': [str], 'choices': [str]}],
                   'postconditions': [str], 'related_scenario_ids': [str], 'assessment': ASSESSMENT}],
    'view_requirements': [{'id': str, 'touchpoint_id': str, 'actor_ids': [str], 'purpose': str,
                           'information': [str], 'actions': [str], 'states': [str],
                           'entry_paths': [str], 'exit_paths': [str], 'scenario_ids': [str],
                           'assessment': ASSESSMENT}],
    'decision_packets': [{'id': str, 'topic': str, 'status': ('open', 'selected', 'revised'),
                          'risk': ('routine', 'high_impact'),
                          'decision_scope': {'state_ids': [str], 'transition_ids': [str],
                                             'scenario_ids': [str], 'obligation_ids': [str]},
                          'context_summary': str,
                          'recommendation': {'option_id': str, 'rationale': str,
                                             'evidence_ids': [str],
                                             'confidence': ('low', 'medium', 'high'),
                                             'unknowns': [str]},
                          'options': [{'id': str, 'label': str, 'user_experience': str,
                                       'tradeoffs': [str], 'derived_changes': [str]}],
                          'grouping': {'mode': ('single', 'bundle'), 'shared_principle': str,
                                       'independent_decision_ids': [str]},
                          'selection': {'option_id': str, 'custom_text': str, 'user_source_id': str}}],
    'decision_matrices': [{'id': str, 'question': str, 'conditions': [str], 'rows': [str],
                           'outcome_experience': str, 'source_ids': [str]}],
    'handoff_flows': [{'id': str, 'participants': [str], 'trigger': str, 'handoffs': [str],
                       'waiting_experience': str, 'failure_experience': str, 'manual_fallback': str,
                       'scenario_ids': [str], 'source_ids': [str]}],
    'coverage_obligations': [{'id': str, 'transition_id': str, 'dimension': COVERAGE_DIMENSIONS,
                              'condition': str, 'status': ('open', 'covered', 'not_applicable', 'handoff'),
                              'scenario_ids': [str], 'rationale': str,
                              'basis_type': ('', 'platty_fact', 'external_fact', 'planner_decision',
                                             'standard_obligation'), 'source_ids': [str]}],
    'issues': [{'id': str, 'question': str,
               # 3단계는 `screen_behavior|wireframe|development`를 다 갖는데 2단계만 하류를
               # 가리키지 못했다. 1b 인계를 3단계로 다시 넘기려던 실행기가 칸이 없어
               # exit_conditions 산문에 흘려 적었다.
               'target': ('jtbd', 'prd', 'planning_context', 'user_experience',
                          'screen_behavior', 'external'),
                'blocking': bool, 'reason': str, 'areas': [str],
                'action': {'kind': ('ask_user', 'platty', 'web', 'handoff', 'wait'), 'prompt': str},
                'experience_state_ids': [str], 'experience_transition_ids': [str],
                'scenario_ids': [str], **TICKET_FIELDS}],
    **MAP_FIELDS,
    'review': {key: ASSESSMENT for key in REVIEW_KEYS},
    'coverage_checks': [CHECK_SHAPE],
    'path_reviews': [PATH_REVIEW_SHAPE],
    'policy_checks': [POLICY_CHECK_SHAPE],
    'confirmation': {'confirmed': bool, 'turn_id': str, 'statement': str,
                     'content_hash': str, 'review_hash': str},
    'history': [{'change': str, 'reason': str}],
}


def digest(value):
    canonical = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def fingerprints(data):
    if isinstance(data, dict) and type(data.get("schema_version")) is int and data["schema_version"] == 1:
        return _legacy.fingerprints(data)
    content_fields = (
        'schema_version', 'model_profile', 'case_id', 'title', 'input_binding', 'evidence_status',
        'sources', 'claims', 'actors', 'touchpoints', 'experience_states', 'experience_transitions',
        'scenarios', 'view_requirements', 'decision_packets', 'decision_matrices', 'handoff_flows',
        'coverage_obligations', 'issues',
    )
    payload = {key: data[key] for key in content_fields}
    if data.get('out_of_scope'):
        payload['out_of_scope'] = data['out_of_scope']
    payload['coverage_checks'] = data.get('coverage_checks', [])
    payload['policy_checks'] = data.get('policy_checks', [])
    payload['scenarios'] = [
        {key: value for key, value in scenario.items() if key != 'assessment'}
        for scenario in data['scenarios']
    ]
    payload['view_requirements'] = [
        {key: value for key, value in view.items() if key != 'assessment'}
        for view in data['view_requirements']
    ]
    content = digest(payload)
    review = digest({
        'content_hash': content,
        'scenario_assessments': {item['id']: item['assessment'] for item in data['scenarios']},
        'view_assessments': {item['id']: item['assessment'] for item in data['view_requirements']},
        'review': data['review'],
        'path_reviews': data.get('path_reviews', []),
    })
    return content, review


def load_upstream(data):
    """The prd this artifact binds to, or None. The binding names its own upstream."""
    binding = data.get('input_binding') or {}
    path = binding.get('prd_path')
    if not path:
        return None
    try:
        return load_json(Path(path))
    except (OSError, UnicodeError, ValueError):
        # Staleness is already reported by the binding check; do not invent a coverage gap.
        return None


def validate(data):
    if isinstance(data, dict) and type(data.get("schema_version")) is int and data["schema_version"] == 1:
        return _legacy.validate(data)
    # Existing drafts remain readable; missing review inventories block readiness.
    data = {**data, 'coverage_checks': data.get('coverage_checks', []),
            'path_reviews': data.get('path_reviews', []),
            'policy_checks': data.get('policy_checks', [])} if isinstance(data, dict) else data
    errors, readiness = [], []
    # 모르는 칸 하나가 내용 검사를 통째로 끄던 자리다 — 덜어낸 사본으로 끝까지 검사하고
    # 그 칸은 오류로 남는다.
    errors, pruned = shape_errors(data, SHAPE)
    empty = {'valid': False, 'input_ready': False, 'baseline_ready': False,
             'ready_for_confirmation': False, 'complete': False, 'errors': errors,
             'completion_errors': [], 'content_hash': '', 'review_hash': '', 'next_actions': [],
             'inherited_limits': [],
             'checks_not_run': '구조 오류 때문에 내용 검사는 하나도 돌지 않았다 — '
                               '아래가 비어 있는 것은 문제가 없다는 뜻이 아니다'}
    if errors and pruned is None:
        return empty
    data = pruned if pruned is not None else data
    content_hash, review_hash = fingerprints(data)

    def require(condition, path, message, dest=errors):
        if not condition:
            dest.append(f'{path}: {message}')

    def nonblank(value, path, dest=errors):
        require(bool(value.strip()), path, 'nonempty text required', dest)

    def timestamp(value, path, dest=errors):
        try:
            valid = datetime.fromisoformat(value.replace('Z', '+00:00')).utcoffset() is not None
        except ValueError:
            valid = False
        require(valid, path, 'ISO 8601 timestamp with timezone required', dest)

    def index(name):
        result = {}
        for n, item in enumerate(data[name]):
            path = f'$.{name}[{n}]'
            nonblank(item['id'], path + '.id')
            require(item['id'] not in result, path + '.id', 'duplicate id')
            result[item['id']] = item
        return result

    def refs(ids, known, path, dest=errors):
        require(len(ids) == len(set(ids)), path, 'duplicate references', dest)
        for item in ids:
            require(item in known, path, f'unknown reference {item!r}', dest)

    nonblank(data['title'], '$.title')
    require(bool(re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', data['case_id'])), '$.case_id',
            'lowercase letters, numbers, and hyphens required')

    sources = index('sources'); claims = index('claims'); actors = index('actors')
    touchpoints = index('touchpoints'); states = index('experience_states')
    transitions = index('experience_transitions'); scenarios = index('scenarios')
    views = index('view_requirements'); packets = index('decision_packets')
    matrices = index('decision_matrices'); handoffs = index('handoff_flows')
    obligations = index('coverage_obligations'); issues = index('issues')

    errors.extend(map_gaps(data, {row['id'] for row in data['sources']}))
    for n, source in enumerate(data['sources']):
        path = f'$.sources[{n}]'
        for key in ('reference', 'excerpt'):
            nonblank(source[key], path + '.' + key)
        timestamp(source['retrieved_at'], path + '.retrieved_at')
        require((source['kind'] == 'user') == (source['provider'] == 'user'), path,
                'user kind/provider must agree')
        require((source['kind'] == 'imported') == (source['provider'] in IMPORTED_PROVIDERS), path,
                'imported sources must come from planning_context')
        if source['provider'] == 'platty':
            nonblank(source['project_id'], path + '.project_id')
            nonblank(source['revision'], path + '.revision')
    for n, claim in enumerate(data['claims']):
        nonblank(claim['text'], f'$.claims[{n}].text')
        refs(claim['source_ids'], sources, f'$.claims[{n}].source_ids')
        if claim['kind'] == 'decision':
            require(any(sources.get(sid, {}).get('provider') in ('user',) + IMPORTED_PROVIDERS
                        for sid in claim['source_ids']), f'$.claims[{n}]',
                    'decision requires user or imported decision evidence', readiness)

    binding = data['input_binding']
    input_start = len(readiness)
    paths = [key for key in ('planning_context_path', 'prd_path') if key in binding]
    require(len(paths) == 1, '$.input_binding',
            'exactly one upstream path names the stage above', readiness)
    for key in paths + ['content_hash', 'review_hash', 'confirmation_turn_id',
                        'service_context_project_id', 'service_context_revision']:
        nonblank(binding[key], '$.input_binding.' + key, readiness)
    for key in ('content_hash', 'review_hash'):
        require(bool(re.fullmatch(r'[a-f0-9]{64}', binding[key])), '$.input_binding.' + key,
                'SHA-256 hash required', readiness)
    input_ready = len(readiness) == input_start

    evidence = data['evidence_status']
    baseline_start = len(readiness)
    require(evidence['status'] == 'ready', '$.evidence_status.status', 'current Platty evidence not ready', readiness)
    for key in ('project_id', 'checked_at', 'baseline_revision', 'observed_revision'):
        nonblank(evidence[key], '$.evidence_status.' + key, readiness)
    if evidence['checked_at']:
        timestamp(evidence['checked_at'], '$.evidence_status.checked_at', readiness)
    require(evidence['project_id'] == binding['service_context_project_id'], '$.evidence_status.project_id',
            'project differs from planning context binding', readiness)
    require(evidence['baseline_revision'] == evidence['observed_revision'], '$.evidence_status',
            'baseline revision differs from observed revision', readiness)
    # A simulation has no service to query, so demanding evidence of one only teaches people
    # to write a source they never retrieved — the failure C-5 exists to prevent. It records
    # the shortage instead, and saying nothing about it still blocks.
    if evidence.get('mode') == 'simulation':
        recorded = {recorded_finding(row) for row in evidence['coverage_limits']}
        for text in simulation_limits(data):
            require(text in recorded, '$.evidence_status.coverage_limits',
                    finding_note('$.evidence_status.coverage_limits', text).split(': ', 1)[1],
                    readiness)
    else:
        require(any(s['provider'] == 'platty' and s['project_id'] == evidence['project_id']
                    and s['revision'] == evidence['observed_revision'] for s in data['sources']),
                '$.evidence_status', 'matching Platty evidence required', readiness)
    baseline_ready = input_ready and len(readiness) == baseline_start

    for n, actor in enumerate(data['actors']):
        path = f'$.actors[{n}]'
        for key in ('name', 'goal'):
            nonblank(actor[key], path + '.' + key)
        refs(actor['source_claim_ids'], claims, path + '.source_claim_ids')
    for n, point in enumerate(data['touchpoints']):
        path = f'$.touchpoints[{n}]'
        for key in ('name', 'purpose'):
            nonblank(point[key], path + '.' + key)
        refs(point['source_ids'], sources, path + '.source_ids')
    for n, state in enumerate(data['experience_states']):
        path = f'$.experience_states[{n}]'
        for key in ('subject', 'name', 'user_meaning', 'resume_experience'):
            # `undecided`는 「나가는 길을 상위가 아직 정하지 않았다」이다. 그런 상태의
            # 「돌아왔을 때」를 알 방법이 없는데 이 칸만 빈 값을 거부했다 — 같은 행의
            # `information_shown`·`exit_conditions`는 빈 배열이 허용된다.
            # 값을 만들고 **옆 칸이 지어내기를 강요하면** 값이 없는 것과 같다.
            if key == 'resume_experience' and state.get('kind') == 'undecided':
                continue
            nonblank(state[key], path + '.' + key)
        refs(state['visible_to'], actors, path + '.visible_to')
        refs(state['source_ids'], sources, path + '.source_ids')
        if state['parent_state_id']:
            refs([state['parent_state_id']], states, path + '.parent_state_id')
    for n, transition in enumerate(data['experience_transitions']):
        path = f'$.experience_transitions[{n}]'
        refs([transition['from_state']], states, path + '.from_state')
        refs([transition['to_state']], states, path + '.to_state')
        refs([transition['actor_id']], actors, path + '.actor_id')
        refs([transition['touchpoint_id']], touchpoints, path + '.touchpoint_id')
        refs(transition['rule_claim_ids'], claims, path + '.rule_claim_ids')
        refs(transition['source_ids'], sources, path + '.source_ids')
        for key in ('trigger', 'user_visible_condition', 'system_response', 'feedback',
                    'waiting_experience', 'repeat_experience', 'impact_and_reversibility',
                    'recovery_experience'):
            nonblank(transition[key], path + '.' + key, readiness)
        require(bool(transition['accessibility_requirements']), path + '.accessibility_requirements',
                'accessibility requirements required', readiness)
        for a, item in enumerate(transition['accessibility_requirements']):
            nonblank(item, f'{path}.accessibility_requirements[{a}]', readiness)
    for n, scenario in enumerate(data['scenarios']):
        path = f'$.scenarios[{n}]'
        for key in ('title', 'trigger'):
            nonblank(scenario[key], path + '.' + key)
        refs([scenario['actor_id']], actors, path + '.actor_id')
        refs(scenario['goal_claim_ids'], claims, path + '.goal_claim_ids')
        refs(scenario['related_scenario_ids'], scenarios, path + '.related_scenario_ids')
        require(bool(scenario['steps']), path + '.steps', 'at least one user step required', readiness)
        for s, step in enumerate(scenario['steps']):
            nonblank(step['id'], f'{path}.steps[{s}].id')
            nonblank(step['actor_action'], f'{path}.steps[{s}].actor_action', readiness)
            refs([step['transition_id']], transitions, f'{path}.steps[{s}].transition_id')
    for actor_id in actors:
        excused = (actors[actor_id].get('happy_path_exclusion') or '').strip()
        require(bool(excused)
                or any(s['actor_id'] == actor_id and s['kind'] == 'happy'
                       for s in data['scenarios']),
                '$.scenarios',
                f'happy scenario required for actor {actor_id} — 이 역할의 정상 경로를 적을 수 '
                f'없다면 $.actors[{actor_id}].happy_path_exclusion에 적용 제외 근거를 적는다 '
                '(UX07이 허용하는 나머지 한쪽이다)', readiness)
    for n, view in enumerate(data['view_requirements']):
        path = f'$.view_requirements[{n}]'
        refs([view['touchpoint_id']], touchpoints, path + '.touchpoint_id')
        refs(view['actor_ids'], actors, path + '.actor_ids')
        refs(view['states'], states, path + '.states')
        refs(view['scenario_ids'], scenarios, path + '.scenario_ids')
        nonblank(view['purpose'], path + '.purpose')
        require(bool(view['states']), path + '.states', 'visible states required', readiness)
    for n, packet in enumerate(data['decision_packets']):
        path = f'$.decision_packets[{n}]'
        nonblank(packet['topic'], path + '.topic')
        refs(packet['decision_scope']['state_ids'], states, path + '.decision_scope.state_ids')
        refs(packet['decision_scope']['transition_ids'], transitions, path + '.decision_scope.transition_ids')
        refs(packet['decision_scope']['scenario_ids'], scenarios, path + '.decision_scope.scenario_ids')
        refs(packet['decision_scope']['obligation_ids'], obligations, path + '.decision_scope.obligation_ids')
        refs(packet['recommendation']['evidence_ids'], sources, path + '.recommendation.evidence_ids')
        option_ids = {option['id'] for option in packet['options']}
        require(len(option_ids) == len(packet['options']) and 2 <= len(option_ids) <= 3,
                path + '.options', 'two or three unique options required')
        require(packet['recommendation']['option_id'] in option_ids, path + '.recommendation.option_id',
                'recommended option must exist')
        if packet['status'] == 'open':
            readiness.append(path + ': open decision packet')
        else:
            refs([packet['selection']['user_source_id']], sources, path + '.selection.user_source_id')
            source = sources.get(packet['selection']['user_source_id'], {})
            require(source.get('provider') == 'user', path + '.selection.user_source_id',
                    'selection requires actual user source', readiness)
            if packet['status'] == 'selected':
                require(packet['selection']['option_id'] in option_ids, path + '.selection.option_id',
                        'selected option must exist', readiness)
            else:
                nonblank(packet['selection']['custom_text'], path + '.selection.custom_text', readiness)
        require(not (packet['risk'] == 'high_impact' and packet['grouping']['mode'] == 'bundle'), path,
                'high impact decision cannot be bundled', readiness)
    for n, matrix in enumerate(data['decision_matrices']):
        refs(matrix['source_ids'], sources, f'$.decision_matrices[{n}].source_ids')
    for n, flow in enumerate(data['handoff_flows']):
        refs(flow['scenario_ids'], scenarios, f'$.handoff_flows[{n}].scenario_ids')
        refs(flow['source_ids'], sources, f'$.handoff_flows[{n}].source_ids')
    for n, obligation in enumerate(data['coverage_obligations']):
        path = f'$.coverage_obligations[{n}]'
        refs([obligation['transition_id']], transitions, path + '.transition_id')
        refs(obligation['scenario_ids'], scenarios, path + '.scenario_ids')
        refs(obligation['source_ids'], sources, path + '.source_ids')
        nonblank(obligation['condition'], path + '.condition')
        if obligation['status'] == 'open':
            readiness.append(path + ': open coverage obligation')
        elif obligation['status'] == 'covered':
            require(bool(obligation['scenario_ids']), path + '.scenario_ids',
                    'covered obligation needs scenario', readiness)
        elif obligation['status'] == 'not_applicable':
            nonblank(obligation['rationale'], path + '.rationale', readiness)
            require(obligation['basis_type'] != '', path + '.basis_type',
                    'not_applicable needs evidence basis', readiness)
            require(bool(obligation['source_ids']), path + '.source_ids',
                    'not_applicable needs source', readiness)
    for n, issue in enumerate(data['issues']):
        path = f'$.issues[{n}]'
        for key in ('question', 'reason'):
            nonblank(issue[key], path + '.' + key)
        refs(issue['experience_state_ids'], states, path + '.experience_state_ids')
        refs(issue['experience_transition_ids'], transitions, path + '.experience_transition_ids')
        refs(issue['scenario_ids'], scenarios, path + '.scenario_ids')
        if not closed(issue) and (issue['blocking'] or issue['target'] in ('planning_context', 'user_experience')):
            readiness.append(path + ': unresolved issue')
    if data['status'] == 'waiting':
        # 역류도 기다림이다 — 상위에 판단을 되돌린 단계는 실패한 것이 아니라 기다리는 것이다.
        require(any(issue['blocking'] and issue['action']['kind'] in ('wait', 'handoff')
                    for issue in data['issues']),
                '$.status', 'waiting requires a blocking dependency or backflow with a resume action')
        require(not any(issue['action']['kind'] in ('ask_user', 'platty', 'web')
                        or issue['target'] in ('planning_context', 'user_experience')
                        for issue in data['issues']),
                '$.status', 'waiting cannot mask executable internal work or upstream return')

    def check_assessment(value, path):
        readiness.extend(example_citation_gaps(value, path))
        refs(value['criteria'], set(CRITERIA), path + '.criteria')
        refs(value['example_ids'], set(EXAMPLES), path + '.example_ids')
        refs(value['evidence_ids'], sources, path + '.evidence_ids')
        refs(value['issue_ids'], issues, path + '.issue_ids')
        if value['verdict'] != 'pending':
            nonblank(value['rationale'], path + '.rationale')
            require(value['content_hash'] == content_hash, path + '.content_hash',
                    'stale assessment hash', readiness)
        require(value['verdict'] == 'suitable', path + '.verdict',
                'qualitative review not suitable', readiness)
        if value['verdict'] == 'suitable':
            require(bool(value['criteria']) and bool(value['example_ids']) and bool(value['evidence_ids']),
                    path, 'passing review needs criteria, examples and evidence', readiness)
            # 파생 단계가 스스로 답할 수 있는 질문은 없다 — 여기서 열린 것은 전부 상위를
            # 기다리거나 넘기는 것이고, 그것을 가리키는 것이 인계다. jtbd.validate 참고.
            #
            # 1a는 4차에 **「이 단계가 소유한 질문인가」**로 고쳤는데 여기는 행동 종류로만 좁게
            # 고쳤다. 그래서 이 단계가 답할 수 없는 `platty` 조회 티켓을 가리키면 막히고 지우면
            # 통과했고, 5차의 한 실행기가 **지웠다** — 정직한 쪽이 벌을 받았다. 기준은 소유다.
            unanswered = [name for name in value['issue_ids']
                          if not closed(issues.get(name, {}))
                          and issues.get(name, {}).get('target') == 'user_experience'
                          and (issues.get(name, {}).get('action') or {}).get('kind')
                          not in ('wait', 'handoff')]
            require(not unanswered, path + '.issue_ids',
                    'passing review rests on an unanswered question: ' + ', '.join(unanswered),
                    readiness)

    for n, scenario in enumerate(data['scenarios']):
        check_assessment(scenario['assessment'], f'$.scenarios[{n}].assessment')
    for n, view in enumerate(data['view_requirements']):
        check_assessment(view['assessment'], f'$.view_requirements[{n}].assessment')
    for key, value in data['review'].items():
        check_assessment(value, '$.review.' + key)

    verification_errors = verification_gaps(data, COVERAGE_DIMENSIONS, content_hash) + graph_gaps(data) + policy_gaps(data)
    upstream = load_upstream(data)
    verification_errors += upstream_coverage_gaps(data, upstream)
    verification_errors += terminal_state_gaps(data)
    readiness.extend(verification_errors)
    # 승계 누락은 보고만 한다 — 막으면 F-83처럼 문장을 글자 그대로 베끼는 일이 된다.
    inherited = inherited_limit_gaps(data, upstream)
    global_criteria = {c for row in data['review'].values() for c in row['criteria']}
    require(set(CRITERIA).issubset(global_criteria), '$.review',
            'all X1-X11 criteria must be reviewed', readiness)
    ready = not errors and not readiness
    completion = list(readiness)
    confirmation = data['confirmation']
    require(confirmation['confirmed'], '$.confirmation', 'user confirmation missing', completion)
    if confirmation['confirmed']:
        nonblank(confirmation['turn_id'], '$.confirmation.turn_id', completion)
        nonblank(confirmation['statement'], '$.confirmation.statement', completion)
        require(confirmation['content_hash'] == content_hash, '$.confirmation.content_hash',
                'confirmation content hash is stale', completion)
        require(confirmation['review_hash'] == review_hash, '$.confirmation.review_hash',
                'confirmation review hash is stale', completion)
    require(data['status'] == 'complete', '$.status', 'not complete', completion)
    complete = ready and not completion
    if data['status'] == 'complete' and not complete:
        errors.append('$.status: complete is inconsistent with current validation')
    next_actions = [{'id': item['id'], 'kind': item['action']['kind'],
                     'prompt': item['action']['prompt']} for item in data['issues'] if not closed(item)]
    return {'valid': not errors, 'input_ready': input_ready, 'baseline_ready': baseline_ready,
            'ready_for_confirmation': ready, 'complete': complete, 'errors': errors,
            'completion_errors': completion, 'content_hash': content_hash,
            'review_hash': review_hash, 'next_actions': next_actions,
            'verification_gaps': verification_errors,
            'inherited_limits': inherited}


def esc(value):
    return html.escape(str(value)).replace('-', '\\-')


def render(data, report=None):
    if isinstance(data, dict) and type(data.get("schema_version")) is int and data["schema_version"] == 1:
        return _legacy.render(data, report)
    report = report or validate(data)
    lines = [f"# {esc(data['title'])}", '', f"상태: {data['status']}", '', render_full_model(data), '',
             '## 사용자와 목표', '']
    for actor in data['actors']:
        lines += [f"- **{esc(actor['name'])}**: {esc(actor['goal'])}"]
    lines += ['', '## 사용자 관찰 상태', '']
    for state in data['experience_states']:
        lines += [f"### {esc(state['id'])} · {esc(state['name'])}", '', esc(state['user_meaning']), '']
    lines += ['## 상태 전이', '']
    for transition in data['experience_transitions']:
        lines += [f"- **{esc(transition['id'])}**: {esc(transition['from_state'])} → {esc(transition['to_state'])} — {esc(transition['feedback'])}"]
    lines += ['', '## 시나리오', '']
    for scenario in data['scenarios']:
        lines += [f"### {esc(scenario['title'])}", '', f"종류: {scenario['kind']}", '']
        for step in scenario['steps']:
            lines += [f"- {esc(step['actor_action'])} ({esc(step['transition_id'])})"]
        lines.append('')
    lines += ['## 화면·접점 요구', '']
    for view in data['view_requirements']:
        lines += [f"- **{esc(view['id'])}**: {esc(view['purpose'])}"]
    lines += ['', '## 결정 기록', '']
    for packet in data['decision_packets']:
        lines += [f"- **{esc(packet['topic'])}**: {packet['status']} · {esc(packet['selection']['option_id'] or packet['selection']['custom_text'])}"]
    lines += ['', '## 커버리지', '']
    for item in data['coverage_obligations']:
        lines += [f"- **{esc(item['id'])}**: {item['status']} — {esc(item['condition'])}"]
    lines += ['', '## 검증', '', f"구조 유효: {'예' if report['valid'] else '아니오'}  ",
              f"최종 확인 준비: {'예' if report['ready_for_confirmation'] else '아니오'}  ",
              f"완료: {'예' if report['complete'] else '아니오'}", '']
    return '\n'.join(lines)


def planning_context_path(data):
    """Read an upstream reference without migrating or hashing a rewritten record."""
    binding = data['input_binding']
    if data.get('schema_version') == 1:
        return binding['interview_1_path']
    return next(binding[key] for key in ('planning_context_path', 'prd_path') if key in binding)


def bind_planning_context(data, input_path):
    source = load_json(input_path)
    report = validate_planning_context(source)
    if not report['complete']:
        raise ValueError('planning context must be complete and confirmed before user experience')
    content_hash, review_hash = planning_context_fingerprints(source)
    data['input_binding'] = {
            'planning_context_path': str(input_path.resolve()),
            'content_hash': content_hash,
            'review_hash': review_hash,
            'confirmation_turn_id': source['confirmation']['turn_id'],
            'service_context_project_id': source['service_context']['project_id'],
            'service_context_revision': source['service_context']['observed_revision'],
            'claim_ids': [claim['id'] for claim in source['claims']],
            'handoff_issue_ids': [issue['id'] for issue in source['issues']
                                  if issue['target'] == ('interview_2' if source['schema_version'] == 2 else 'user_experience')],
    }
    return source


SIMULATION_LIMIT = ('서비스 근거가 없다 — 모의 실행이라 실제 조회를 하지 않았고, '
                    '제품 사정은 기획자 진술이 유일한 출처다')


def simulation_limits(data):
    """What a rehearsal is missing, said plainly so it can be recorded rather than faked."""
    return [SIMULATION_LIMIT] if (data.get('evidence_status') or {}).get('mode') == 'simulation' else []


def terminal_state_limits(data):
    """A state the experience ends in with nothing the person can do next.

    Promoted from the one real stage-4 image review, which caught an empty result with no
    way out while every machine check passed. It was written against a render case, but a
    terminal state with no exit propagates into every render case built from it — catching
    it here catches it once.

    A stable state's exit is its outgoing transition and the graph check already owns that,
    so only `final` and `failure` are in scope. Within that scope there are two ways out is
    missing: the state names none, or it names one no screen offers — an exit that exists
    only in words, which is what produced the dead-end screens the stage-4 render showed.

    A non-terminal state's actions routinely lead out of this job's scope, so naming one no
    view offers is normal there and is not reported.
    """
    offered = {text.strip() for view in data.get('view_requirements', [])
               for text in view.get('actions', []) if text.strip()}
    limits = []
    # `undecided`를 범위에서 빼 둔 것이 5차에서 측정됐다: 런북이 시키는 대로 `undecided`를 쓰면
    # **바로 그 구멍을 잡아 줄 검사가 꺼졌다**(실측 — `final`로 바꾸면 바로 운다).
    # 출구를 상위가 정하지 않은 상태야말로 이 검사가 존재하는 이유다. 값이 검사를 끄면
    # 정직하게 적을수록 조용해지고, 그것은 4차 F-60(모르는 칸 하나가 내용 검사를 끈다)의 재발이다.
    # 막지는 않는다 — 결손이지 잘못이 아니다. 다만 그 결손이 산출물에 기록되게 한다.
    for row in data.get('experience_states', []):
        if row.get('kind') == 'undecided':
            limits.append(f"{row['id']} ({row['name']}): 나가는 길을 상위가 정하지 않았다 — "
                          '이 상태에 도달한 사람이 어디로 가는지 이 산출물은 말하지 않는다')
            continue
        if row.get('kind') not in ('final', 'failure'):
            continue
        actions = [text.strip() for text in row.get('available_actions', []) if text.strip()]
        if not actions:
            limits.append(f"{row['id']} ({row['name']}): 종료 상태에 다음 행동이 없다 — "
                          '이 상태에 도달한 사람은 나갈 곳이 없다')
            continue
        for action in actions:
            if action not in offered:
                limits.append(f"{row['id']} ({row['name']}): 종료 상태의 출구 「{action}」를 "
                              '어느 화면 요구도 제공하지 않는다 — 말로만 있는 출구다')
    return limits


def terminal_state_gaps(data):
    """C-5, extended: the shortage is displayed; saying nothing about it is the defect.

    What the exit should be is a planner judgment, so a derivation that does not know it
    records the limit or backflows — and a backflow is a record.
    """
    recorded = {recorded_finding(row)
                for row in data.get('evidence_status', {}).get('coverage_limits', [])}
    waiting = ' '.join(row.get('question', '') + ' ' + row.get('reason', '') + ' '
                       + ' '.join(row.get('experience_state_ids', []) or [])
                       for row in data.get('issues', [])
                       if row.get('blocking') and not closed(row))
    gaps = []
    for text in terminal_state_limits(data):
        if text in recorded or text.split(' ')[0] in waiting:
            continue
        gaps.append(finding_note('$.evidence_status.coverage_limits', text))
    return gaps


def inherited_limit_gaps(data, upstream):
    """Limits the prd already recorded that this stage dropped on the way down.

    5차: 같은 한계(모의 실행·전언·번복)를 **네 파일에 손으로 네 번** 적어야 했다. 승계가
    없으니 한 번이라도 빠뜨리면 하류는 그 한계 위에 선 줄 모르고, 빠뜨렸다고 우는 것도 없다.
    한계는 올라온 자리에서 끝나지 않는다 — 그 위에 서는 모든 단계의 한계다.

    보고만 한다. 문장을 그대로 베끼라고 요구하면 F-83이 재발한다.
    """
    if not upstream:
        return []
    mine = ' '.join(data.get('evidence_status', {}).get('coverage_limits', []))
    return [f"$.evidence_status.coverage_limits: 상위가 기록한 한계가 여기 없다 — "
            f"「{row['text']}」. 이 파생은 그 한계 위에 서 있다"
            for row in (upstream.get('carried', {}).get('coverage_limits') or [])
            if row.get('text') and row['text'] not in mine]


def upstream_coverage_gaps(data, upstream):
    """Which of the prd's rules this derivation never reached.

    A derived stage that quietly drops a rule produces a result that validates and does not
    do what the planner asked. Two shapes count: a rule nothing cites, and a rule cited by a
    source no row uses — the second is worse, because it looks covered.
    """
    binding = data.get('input_binding') or {}
    if 'prd_path' not in binding or not upstream:
        return []
    # A rule an open backflow names is deferred, not dropped. Refusing to invent a judgment
    # the upstream never made is the behavior this design asks for; losing one is the failure
    # this check exists to catch. Reporting them the same way teaches people to stop reading.
    deferred = [row for row in data.get('issues', [])
                if row.get('blocking') and row.get('target') == 'prd'
                and (row.get('action') or {}).get('kind') == 'wait']
    used = set()
    for name, rows in data.items():
        if name in ('sources', 'input_binding') or not isinstance(rows, list):
            continue
        for row in rows:
            if isinstance(row, dict):
                used.update(row.get('source_ids', []) or [])
                for assessment in (row.get('assessment'),):
                    if isinstance(assessment, dict):
                        used.update(assessment.get('evidence_ids', []) or [])
    gaps = []
    for rule in upstream.get('rules', []):
        names = [rule['id'], rule.get('acceptance_id', '')]
        # 앞 경계가 없어 `R-1`이 `TR-1` 안에서 매칭됐다. 전이를 `TR-n`으로 이름 짓는 것이
        # 기본 관례라 재현이 쉽고, **조용한 쪽으로 틀린다** — 나와야 할 「규칙을 떨어뜨렸다」가
        # 「역류를 기다린다」로 바뀐다. 같은 파일 `names_transition`은 이미 양쪽을 막고 있었다.
        pattern = re.compile(r'(?<![0-9A-Za-z-])(?:'
                             + '|'.join(re.escape(name) for name in names if name)
                             + r')(?![0-9A-Za-z-])')
        citing = [row['id'] for row in data.get('sources', [])
                  if row.get('provider') == 'prd' and pattern.search(row.get('reference', ''))]
        if not citing:
            waiting = [row['id'] for row in deferred
                       if pattern.search(row.get('question', '') + ' ' + row.get('reason', ''))]
            gaps.append(
                f"$.sources: {rule['id']} is deferred to {', '.join(waiting)}; this derivation "
                'is not finished until the upstream answers' if waiting else
                f"$.sources: {rule['id']} is not cited; the derivation dropped an "
                'upstream rule or owes a backflow')
        elif not (set(citing) & used):
            gaps.append(f"$.sources: {rule['id']} is cited by {', '.join(citing)} but no row "
                        'reaches that source; a citation nothing uses looks covered and is not')
    return gaps


def bind_prd(data, input_path):
    """Bind to a confirmed prd. The judgments arrive as text; the evidence stays referenced."""
    import prd as prd_module
    source = load_json(input_path)
    if not prd_module.validate(source)['complete']:
        raise ValueError('prd must be complete and confirmed before user experience')
    content_hash, review_hash = prd_module.fingerprints(source)
    data['input_binding'] = {
        'prd_path': str(input_path.resolve()),
        'content_hash': content_hash,
        'review_hash': review_hash,
        'confirmation_turn_id': source['confirmation']['turn_id'],
        'service_context_project_id': source['input_binding']['project_id'],
        'service_context_revision': source['input_binding']['observed_revision'],
        'claim_ids': [],
        'handoff_issue_ids': [issue['id'] for issue in source['issues']
                              if issue['target'] == 'user_experience'],
    }
    return source


def init_from_prd(output, input_path):
    data = load_json(TEMPLATE)
    data['case_id'] = re.sub(r'[^a-z0-9]+', '-', output.parent.name.lower()).strip('-') or 'untitled'
    source = bind_prd(data, input_path)
    data['title'] = source['title'] + ' 사용자 경험'
    data['evidence_status']['project_id'] = source['input_binding']['project_id']
    data['evidence_status']['baseline_revision'] = source['input_binding']['observed_revision']
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x', encoding='utf-8') as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    return data


def init_from_planning_context(output, input_path=None):
    data = load_json(TEMPLATE)
    data['case_id'] = re.sub(r'[^a-z0-9]+', '-', output.parent.name.lower()).strip('-') or 'untitled'
    data['title'] = data['title'] or '제목 미정'
    if input_path is not None:
        source = bind_planning_context(data, input_path)
        data['title'] = source['title'] + ' 사용자 경험'
        data['evidence_status']['project_id'] = source['service_context']['project_id']
        data['evidence_status']['baseline_revision'] = source['service_context']['observed_revision']
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x', encoding='utf-8') as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    init = commands.add_parser('init'); init.add_argument('path', type=Path); init.add_argument('--input', type=Path)
    validate_parser = commands.add_parser('validate'); validate_parser.add_argument('path', type=Path)
    validate_parser.add_argument('--require-ready', action='store_true')
    validate_parser.add_argument('--require-complete', action='store_true')
    render_parser = commands.add_parser('render'); render_parser.add_argument('path', type=Path)
    render_parser.add_argument('-o', '--output', type=Path)
    fingerprint_parser = commands.add_parser('fingerprint'); fingerprint_parser.add_argument('path', type=Path)
    prepare_parser = commands.add_parser('prepare-review'); prepare_parser.add_argument('path', type=Path)
    prepare_parser.add_argument('-o', '--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == 'init':
            init_from_planning_context(args.path, args.input)
            result, code = {'path': str(args.path.resolve()), 'created': True}, 0
        elif args.command == 'validate':
            result = validate(load_json(args.path))
            failed = not result['valid'] or (args.require_ready and not result['ready_for_confirmation']) \
                or (args.require_complete and not result['complete'])
            code = 1 if failed else 0
        elif args.command == 'fingerprint':
            content_hash, review_hash = fingerprints(load_json(args.path))
            result, code = {'content_hash': content_hash, 'review_hash': review_hash}, 0
        elif args.command == 'prepare-review':
            data = load_json(args.path)
            if args.path.resolve() == args.output.resolve():
                raise ValueError('write review preparation to a separate draft')
            data['coverage_checks'] = seed_checks(data, COVERAGE_DIMENSIONS)
            data.setdefault('path_reviews', [])
            existing = {r['claim_id']: r for r in data.get('policy_checks', [])}
            data['policy_checks'] = [existing.get(c['id'], {'claim_id': c['id'], 'status': 'open', 'transition_ids': [], 'excluded_transition_ids': [], 'rationale': '', 'source_ids': []}) for c in data['claims'] if c['kind'] == 'decision']
            data['status'] = 'in_progress'
            data['confirmation'] = {'confirmed': False, 'turn_id': '', 'statement': '', 'content_hash': '', 'review_hash': ''}
            args.output.parent.mkdir(parents=True, exist_ok=True)
            with args.output.open('x', encoding='utf-8') as stream:
                json.dump(data, stream, ensure_ascii=False, indent=2)
                stream.write('\n')
            result, code = {'path': str(args.output.resolve()), 'review_slots': len(data['coverage_checks']),
                            'note': 'No applicability or qualitative verdict was inferred.'}, 0
        else:
            data = load_json(args.path)
            if args.output and args.output.resolve() == args.path.resolve():
                raise ValueError('render output must differ from JSON input')
            body = render(data)
            if args.output:
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(body, encoding='utf-8')
                result = {'path': str(args.output.resolve())}
            else:
                print(body, end='')
                return 0
            code = 0
    except (OSError, ValueError, KeyError, TypeError, RecursionError) as exc:
        result, code = {'error': str(exc)}, 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return code


if __name__ == '__main__':
    sys.exit(main())
