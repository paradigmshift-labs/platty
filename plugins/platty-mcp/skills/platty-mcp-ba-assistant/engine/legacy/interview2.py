#!/usr/bin/env python3
"""Validate and render Interview 2 user-experience records."""
import argparse
from datetime import datetime
import hashlib
import html
import json
from pathlib import Path
import re
import sys

from legacy.interview1 import check_shape, fingerprints as interview1_fingerprints, load_json, validate as validate_interview1
from legacy.experience_verification import CHECK_SHAPE, PATH_REVIEW_SHAPE, POLICY_CHECK_SHAPE, seed_checks, verification_gaps, policy_gaps, example_citation_gaps
from legacy.experience_graph import graph_gaps
from legacy.experience_progress import render_full_model


ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = ROOT / 'schemas/interview-2.template.json'
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
SOURCE = {'id': str, 'kind': ('user', 'document', 'code', 'imported'),
          'provider': ('user', 'platty', 'web', 'interview_1'), 'reference': str,
          'excerpt': str, 'project_id': str, 'revision': str, 'retrieved_at': str}
SHAPE = {
    'schema_version': (1,), 'model_profile': ('ux_statechart_viewflow_v1',),
    'case_id': str, 'title': str,
    'status': ('in_progress', 'awaiting_confirmation', 'waiting', 'paused', 'complete'),
    'input_binding': {
        'interview_1_path': str, 'content_hash': str, 'review_hash': str,
        'confirmation_turn_id': str, 'service_context_project_id': str,
        'service_context_revision': str, 'claim_ids': [str], 'handoff_issue_ids': [str],
    },
    'evidence_status': {
        'project_id': str, 'status': ('missing', 'ready', 'stale', 'unavailable'),
        'checked_at': str, 'baseline_revision': str, 'observed_revision': str,
        'coverage_limits': [str],
    },
    'sources': [SOURCE],
    'claims': [{'id': str, 'text': str, 'kind': ('fact', 'decision', 'assumption', 'unknown'),
                'source_ids': [str]}],
    'actors': [{'id': str, 'name': str, 'goal': str, 'responsibilities': [str],
                'permissions': [str], 'source_claim_ids': [str]}],
    'touchpoints': [{'id': str, 'name': str,
                     'kind': ('screen', 'notification', 'external_service', 'background_result'),
                     'status': ('current', 'changed', 'new'), 'purpose': str,
                     'entry_points': [str], 'source_ids': [str]}],
    'experience_states': [{'id': str, 'subject': str, 'name': str,
                           'kind': ('initial', 'stable', 'waiting', 'success', 'failure', 'final'),
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
    'issues': [{'id': str, 'question': str, 'target': ('interview_1', 'interview_2', 'external'),
                'blocking': bool, 'reason': str, 'areas': [str],
                'action': {'kind': ('ask_user', 'platty', 'web', 'handoff', 'wait'), 'prompt': str},
                'experience_state_ids': [str], 'experience_transition_ids': [str],
                'scenario_ids': [str]}],
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
    content_fields = (
        'schema_version', 'model_profile', 'case_id', 'title', 'input_binding', 'evidence_status',
        'sources', 'claims', 'actors', 'touchpoints', 'experience_states', 'experience_transitions',
        'scenarios', 'view_requirements', 'decision_packets', 'decision_matrices', 'handoff_flows',
        'coverage_obligations', 'issues',
    )
    payload = {key: data[key] for key in content_fields}
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


def validate(data):
    # Existing drafts remain readable; missing review inventories block readiness.
    data = {**data, 'coverage_checks': data.get('coverage_checks', []),
            'path_reviews': data.get('path_reviews', []),
            'policy_checks': data.get('policy_checks', [])} if isinstance(data, dict) else data
    errors, readiness = [], []
    check_shape(data, SHAPE, '$', errors)
    empty = {'valid': False, 'input_ready': False, 'baseline_ready': False,
             'ready_for_confirmation': False, 'complete': False, 'errors': errors,
             'completion_errors': [], 'content_hash': '', 'review_hash': '', 'next_actions': []}
    if errors:
        return empty
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

    for n, source in enumerate(data['sources']):
        path = f'$.sources[{n}]'
        for key in ('reference', 'excerpt'):
            nonblank(source[key], path + '.' + key)
        timestamp(source['retrieved_at'], path + '.retrieved_at')
        require((source['kind'] == 'user') == (source['provider'] == 'user'), path,
                'user kind/provider must agree')
        require((source['kind'] == 'imported') == (source['provider'] == 'interview_1'), path,
                'imported sources must come from interview_1')
        if source['provider'] == 'platty':
            nonblank(source['project_id'], path + '.project_id')
            nonblank(source['revision'], path + '.revision')
    for n, claim in enumerate(data['claims']):
        nonblank(claim['text'], f'$.claims[{n}].text')
        refs(claim['source_ids'], sources, f'$.claims[{n}].source_ids')
        if claim['kind'] == 'decision':
            require(any(sources.get(sid, {}).get('provider') in ('user', 'interview_1')
                        for sid in claim['source_ids']), f'$.claims[{n}]',
                    'decision requires user or imported decision evidence', readiness)

    binding = data['input_binding']
    input_start = len(readiness)
    for key in ('interview_1_path', 'content_hash', 'review_hash', 'confirmation_turn_id',
                'service_context_project_id', 'service_context_revision'):
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
            'project differs from interview 1 binding', readiness)
    require(evidence['baseline_revision'] == evidence['observed_revision'], '$.evidence_status',
            'baseline revision differs from observed revision', readiness)
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
        require(any(s['actor_id'] == actor_id and s['kind'] == 'happy' for s in data['scenarios']),
                '$.scenarios', f'happy scenario required for actor {actor_id}', readiness)
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
        if issue['blocking'] or issue['target'] in ('interview_1', 'interview_2'):
            readiness.append(path + ': unresolved issue')

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
            require(not value['issue_ids'], path + '.issue_ids', 'passing review cannot retain issues', readiness)

    for n, scenario in enumerate(data['scenarios']):
        check_assessment(scenario['assessment'], f'$.scenarios[{n}].assessment')
    for n, view in enumerate(data['view_requirements']):
        check_assessment(view['assessment'], f'$.view_requirements[{n}].assessment')
    for key, value in data['review'].items():
        check_assessment(value, '$.review.' + key)

    verification_errors = verification_gaps(data, COVERAGE_DIMENSIONS, content_hash) + graph_gaps(data) + policy_gaps(data)
    readiness.extend(verification_errors)
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
                     'prompt': item['action']['prompt']} for item in data['issues']]
    return {'valid': not errors, 'input_ready': input_ready, 'baseline_ready': baseline_ready,
            'ready_for_confirmation': ready, 'complete': complete, 'errors': errors,
            'completion_errors': completion, 'content_hash': content_hash,
            'review_hash': review_hash, 'next_actions': next_actions,
            'verification_gaps': verification_errors}


def esc(value):
    return html.escape(str(value)).replace('-', '\\-')


def render(data, report=None):
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


def bind_interview1(data, input_path):
    source = load_json(input_path)
    report = validate_interview1(source)
    if not report['complete']:
        raise ValueError('interview 1 must be complete and confirmed before interview 2')
    content_hash, review_hash = interview1_fingerprints(source)
    data['input_binding'] = {
            'interview_1_path': str(input_path.resolve()),
            'content_hash': content_hash,
            'review_hash': review_hash,
            'confirmation_turn_id': source['confirmation']['turn_id'],
            'service_context_project_id': source['service_context']['project_id'],
            'service_context_revision': source['service_context']['observed_revision'],
            'claim_ids': [claim['id'] for claim in source['claims']],
            'handoff_issue_ids': [issue['id'] for issue in source['issues']
                                  if issue['target'] == 'interview_2'],
    }
    return source


def init_from_interview1(output, input_path=None):
    data = load_json(TEMPLATE)
    data['case_id'] = re.sub(r'[^a-z0-9]+', '-', output.parent.name.lower()).strip('-') or 'untitled'
    data['title'] = data['title'] or '제목 미정'
    if input_path is not None:
        source = bind_interview1(data, input_path)
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
            init_from_interview1(args.path, args.input)
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
