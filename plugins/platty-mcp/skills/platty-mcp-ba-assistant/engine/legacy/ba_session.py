#!/usr/bin/env python3
"""BA interview session controller. Codex supplies questions, evidence and LLM reviews."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time

# Resolve the shared module even when this script is invoked through the skill symlink.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from interview1 import TEMPLATE as I1_TEMPLATE
from interview1 import fingerprints as i1_fingerprints
from interview1 import load_json, render as i1_render, validate as i1_validate
import interview1
import interview2
from experience_progress import render_progress, render_full_model
from legacy.ba_audit import (append_journal, read_journal, record_operation, redact,
                      trace_markdown, trace_view, validate_decision, recover_trace_tail)

ROOT = Path(__file__).resolve().parents[2]
_ACTIVE_OPERATION = False
EMPTY_CONFIRMATION = {'confirmed': False, 'turn_id': '', 'statement': '',
                      'content_hash': '', 'review_hash': ''}


ARTIFACT_NAMES = {'interview_1': '01-context.json', 'interview_2': '02-experience.json',
                  'interview_3': '03-screen-behavior.json'}


def stage_module(stage):
    if stage == 'interview_3':
        import interview3
        return interview3
    return {'interview_1': interview1, 'interview_2': interview2}[stage]


def artifact_path(folder, stage):
    return folder / ARTIFACT_NAMES[stage]


def validate_artifact(stage, data):
    return stage_module(stage).validate(data)


def artifact_fingerprints(stage, data):
    return stage_module(stage).fingerprints(data)


def render_artifact(stage, data, report):
    return stage_module(stage).render(data, report)


def checked_at(stage, data):
    return data['service_context' if stage == 'interview_1' else 'evidence_status']['checked_at']


def now():
    return datetime.now(timezone.utc).isoformat()


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                         prefix='.' + path.name, delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def message(path):
    text = path.read_text(encoding='utf-8')
    if not text.strip():
        raise ValueError('message must not be empty')
    return text


def load_decision_context(path, data):
    if path is None:
        raise ValueError('decision question requires --context-file')
    context = load_json(path)
    expected = {'actor', 'touchpoint_id', 'touchpoint', 'situation', 'current_experience',
                'decision_impact', 'source_ids'}
    optional = {'diagram_situation', 'diagram_question'}
    if not isinstance(context, dict) or not expected.issubset(context) or set(context) - expected - optional:
        raise ValueError('decision context requires actor, touchpoint_id, touchpoint, situation, current_experience, decision_impact and source_ids')
    for key in optional & context.keys():
        if not isinstance(context[key], str) or not context[key].strip() or len(context[key]) > 60:
            raise ValueError(f'{key} requires a short label (1-60 characters)')
    for key in expected - {'source_ids'}:
        value = context[key]
        if not isinstance(value, str) or not value.strip() or len(value) > 2000:
            raise ValueError(f'decision context {key} requires concise nonempty text')
    source_ids = context['source_ids']
    if not isinstance(source_ids, list) or not source_ids or len(source_ids) != len(set(source_ids)):
        raise ValueError('decision context requires unique source_ids')
    sources = {source['id']: source for source in data['sources']}
    if any(not isinstance(source_id, str) or source_id not in sources for source_id in source_ids):
        raise ValueError('decision context contains unknown source')
    if not any(sources[source_id]['provider'] == 'platty' for source_id in source_ids):
        raise ValueError('decision context touchpoint requires Platty evidence')
    touchpoints = {touchpoint['id']: touchpoint for touchpoint in data.get('touchpoints', data.get('screens', []))}
    touchpoint = touchpoints.get(context['touchpoint_id'])
    if touchpoint is None:
        raise ValueError('decision context references unknown touchpoint')
    if touchpoint['name'].strip() not in context['touchpoint']:
        raise ValueError('decision context must include the grounded touchpoint name')
    return context


def render_decision_question(context, question):
    return '\n'.join([
        '결정 배경',
        f"- 사용자: {context['actor']}",
        f"- 현재 위치: {context['touchpoint']}",
        f"- 상황: {context['situation']}",
        f"- 현재 경험: {context['current_experience']}",
        f"- 이번 결정의 영향: {context['decision_impact']}",
        '', question.strip(),
    ]) + '\n'


def append_entry(session, role, kind, text, reply_to=None):
    entry = {'id': f"t{len(session['entries']) + 1:04}", 'at': now(), 'role': role,
             'kind': kind, 'text': text, 'reply_to': reply_to,
             'interview_stage': session['stage']}
    session['entries'].append(entry)
    session['updated_at'] = entry['at']
    return entry


def question_progress(folder, session, data, packet_id='', full=False, context=None):
    previous_entry = next((e for e in reversed(session['entries']) if e.get('progress_snapshot')), None)
    previous = load_json(folder / previous_entry['progress_snapshot']) if previous_entry else None
    context = context or {}
    if full and session['stage'] == 'interview_3':
        import screen_behavior
        details = folder / 'screen-behavior-details.md'
        details.write_text(stage_module(session['stage']).render(data), encoding='utf-8')
        body = screen_behavior.render_confirmation(data, str(details.resolve()))
    elif full:
        body = render_full_model(data)
    else:
        body = render_progress(data, packet_id, previous,
            situation=context.get('diagram_situation', ''), question=context.get('diagram_question', ''))
    reference = f"evidence/progress/{len(session['entries']) + 1:05}.json"
    atomic_json(folder / reference, data)
    (folder / ('03-progress.md' if session['stage'] == 'interview_3' else '02-progress.md')).write_text(body, encoding='utf-8')
    return body, reference


def load_case(folder):
    session = load_json(folder / 'session.json')
    if session.get('version') != 1 or session.get('stage') not in ARTIFACT_NAMES:
        raise ValueError('unsupported session version or interview stage')
    return session, load_json(artifact_path(folder, session['stage']))


def save_metadata(folder, session):
    atomic_json(folder / 'session.json', session)


def persist_artifact(folder, session, data):
    snapshot = folder / 'evidence/snapshots' / f"{len(session['entries']):05}.json"
    atomic_json(snapshot, data)
    atomic_json(artifact_path(folder, session['stage']), data)
    save_metadata(folder, session)


def last_user(session):
    return next((entry for entry in reversed(session['entries']) if entry['role'] == 'user'), None)


def input_binding_current(folder, data):
    try:
        source = load_json(folder / '01-context.json')
        report = i1_validate(source)
        content_hash, review_hash = i1_fingerprints(source)
        binding = data['input_binding']
        return (
            report['complete']
            and binding['interview_1_path'] == str((folder / '01-context.json').resolve())
            and binding['content_hash'] == content_hash
            and binding['review_hash'] == review_hash
            and binding['confirmation_turn_id'] == source['confirmation']['turn_id']
            and binding['service_context_project_id'] == source['service_context']['project_id']
            and binding['service_context_revision'] == source['service_context']['observed_revision']
        )
    except (OSError, ValueError, KeyError, TypeError):
        return False


def view(folder, session, data):
    report = validate_artifact(session['stage'], data)
    input_current = (report.get('input_ready', False) if session['stage'] == 'interview_3' else
                     session['stage'] != 'interview_2' or input_binding_current(folder, data))
    required_actions = [
        {
            'issue_id': issue['id'],
            'areas': issue.get('areas', issue.get('target_refs', [])),
            'kind': issue['action']['kind'],
            'prompt': issue['action']['prompt'],
            'reason': issue['reason'],
        }
        for issue in data['issues']
        if issue['blocking'] or issue['target'] == session['stage']
    ]
    if session['stage'] in ('interview_2', 'interview_3') and report.get('verification_gaps'):
        required_actions.append({
            'issue_id': 'experience-verification', 'areas': ['branch_coverage'],
            'kind': 'review', 'prompt': '검토 슬롯·실제 경로·정책 적용을 검토하고, FACT는 조회·PRODUCT는 질문 이슈로 연결한다.',
            'reason': f"{len(report['verification_gaps'])} verification gaps; see validation.verification_gaps",
        })
    if not input_current:
        required_actions.insert(0, {
            'issue_id': 'input-binding', 'areas': ['input_binding'], 'kind': 'handoff',
            'prompt': '선행 인터뷰의 변경 내용을 다시 검토·확인한 뒤 현재 단계를 재시작한다.',
            'reason': '참조한 선행 인터뷰 내용·평가·확인 또는 서비스 revision이 달라졌다.',
        })
    if (folder / 'evidence/pending-operation.json').exists() and not _ACTIVE_OPERATION:
        phase = 'logging_failed'
        required_actions.insert(0, {'issue_id': 'audit-recovery', 'areas': ['logging'],
                                   'kind': 'recover-log', 'prompt': '저장 오류를 해결한 뒤 recover-log로 기록을 복구한다.',
                                   'reason': '이전 작업의 감사 기록이 완료되지 않았다.'})
    elif session['paused']:
        phase = 'paused'
    elif not input_current:
        phase = 'input_stale'
    elif session['refresh_required']:
        phase = 'prepare_context'
    elif report['complete'] and not session.get('needs_processing') and not session['pending']:
        phase = {'interview_1': 'start_interview_2', 'interview_2': 'start_interview_3'}.get(session['stage'], 'complete')
    elif session['pending']:
        phase = 'awaiting_confirmation' if session['pending']['kind'] == 'confirmation' else 'awaiting_answer'
    elif session.get('needs_processing', False) and data['status'] == 'waiting':
        phase = 'process_answer'
    elif data['status'] == 'waiting':
        phase = 'waiting'
    elif not report['baseline_ready']:
        phase = 'prepare_context'
    elif session.get('needs_processing', False):
        phase = 'process_answer'
    elif report['ready_for_confirmation']:
        phase = 'ready_for_confirmation'
    elif required_actions:
        phase = 'action_required'
    else:
        phase = 'interviewing'
    if phase == 'start_interview_2':
        required_actions.append({'issue_id': 'stage-transition', 'areas': ['solution'],
                                 'kind': 'start-2', 'prompt': '같은 턴에서 start-2를 실행하고 인터뷰 2 현재 경험 조회와 첫 질문을 진행한다.',
                                 'reason': '인터뷰 1 확인 완료; 추가 진행 승인 없이 인터뷰 2로 이어간다.'})
    if phase == 'start_interview_3':
        required_actions.append({'issue_id': 'stage-transition', 'areas': ['screens'],
                                 'kind': 'start-3', 'prompt': '같은 턴에서 start-3를 실행하고 화면·요소 근거 조회와 필요한 질문을 진행한다.',
                                 'reason': '인터뷰 2 확인 완료; 인터뷰 3으로 이어간다.'})
    can_yield = phase in ('awaiting_answer', 'awaiting_confirmation', 'waiting', 'paused', 'complete')
    yield_reason = {
        'awaiting_answer': 'waiting for the user to answer the saved interview question',
        'awaiting_confirmation': 'waiting for the user to confirm the saved final summary',
        'waiting': 'blocked by an external capability or fact with a recorded resume condition',
        'paused': 'paused at the user request',
        'complete': session['stage'].replace('_', ' ') + ' is validated and confirmed',
    }.get(phase, 'the workflow still has work it can perform before yielding')
    preparing = ('히로인스 현재 경험 맥락을 확인하고 있습니다.' if session['stage'] == 'interview_2'
                 else '히로인스 기본 맥락을 확인하고 있습니다.')
    complete_text = f"인터뷰 {session['stage'].rsplit('_', 1)[-1]}가 검증되고 사용자 확인까지 완료되었습니다."
    user_status = {
        'prepare_context': preparing,
        'process_answer': '방금 답변을 분석하고 결과를 갱신해야 합니다.',
        'action_required': '확인해야 할 조회 또는 판단이 남아 있습니다.',
        'interviewing': '다음 질문 또는 조회를 선택해야 합니다.',
        'ready_for_confirmation': '전체 요약을 사용자에게 확인받을 준비가 되었습니다.',
        'awaiting_answer': '저장된 인터뷰 질문에 대한 사용자 답변을 기다리고 있습니다.',
        'awaiting_confirmation': '전체 요약에 대한 사용자 확인을 기다리고 있습니다.',
        'waiting': '외부 확인 또는 접근 조건이 충족될 때까지 보류 중입니다.',
        'paused': '사용자 요청으로 인터뷰가 중단되었습니다.',
        'complete': complete_text,
        'start_interview_2': '인터뷰 1 확인이 완료되어 인터뷰 2를 바로 시작해야 합니다.',
        'start_interview_3': '인터뷰 2 확인이 완료되어 인터뷰 3을 바로 시작해야 합니다.',
        'input_stale': '선행 인터뷰 입력이 변경되어 다시 확인해야 합니다.',
        'logging_failed': '실행 기록 저장을 복구해야 합니다. 이전 동작을 반복 실행하지 않습니다.',
    }[phase]
    return {'case_path': str(folder.resolve()), 'stage': session['stage'], 'mode': session['mode'],
            'phase': phase, 'refresh_required': session['refresh_required'],
            'input_current': input_current,
            'pending': session['pending'], 'last_user': last_user(session),
            'answered_question': session['answered_question'], 'required_actions': required_actions,
            'can_yield': can_yield, 'yield_reason': yield_reason, 'user_status': user_status,
            'validation': report,
            'next_stage': {'start_interview_2': 'interview_2_ready', 'start_interview_3': 'interview_3_ready',
                           'complete': 'wireframe_not_implemented'}.get(phase)}


def capture(folder):
    try:
        session, data = load_case(folder)
        result = view(folder, session, data)
        report = result['validation']
        summary = {key: result[key] for key in ('phase', 'refresh_required')}
        summary.update(content_hash=report['content_hash'], review_hash=report['review_hash'],
                       pending_id=session['pending']['id'] if session['pending'] else None,
                       last_user_id=result['last_user']['id'] if result['last_user'] else None,
                       entry_count=len(session['entries']),
                       validation={key: report[key] for key in ('valid', 'baseline_ready', 'ready_for_confirmation',
                                                              'complete', 'errors', 'completion_errors')})
        return {'summary': summary, 'session': session, 'data': data, 'validation': report}
    except (OSError, ValueError, KeyError, TypeError):
        return {'summary': None, 'session': None, 'data': None}


def newer_context(data, session):
    current = checked_at(session['stage'], data)
    old = session['refresh_after']
    if not current:
        return False
    if not old:
        return True
    return datetime.fromisoformat(current.replace('Z', '+00:00')) > datetime.fromisoformat(old.replace('Z', '+00:00'))


def run(args):
    folder = args.path.resolve()
    if args.command == 'recover-log':
        pending_path = folder / 'evidence/pending-operation.json'
        if not pending_path.exists():
            session, data = load_case(folder)
            return view(folder, session, data)
        saved = load_json(pending_path)
        token = saved['operation_id']
        recovered_tail = recover_trace_tail(folder)
        event = next((e for e in read_journal(folder / 'evidence/trace.jsonl')
                      if e.get('operation_id') == token), None)
        if event is None:
            original = argparse.Namespace(**saved['args'])
            original.operation_id = token
            result = saved.get('result', {})
            error = saved.get('error', 'operation interrupted; state inspected during recovery')
            event_id = record_operation(folder, original, saved['before'],
                                        saved.get('after') or capture(folder), result, error,
                                        saved['started_at'], saved.get('duration_ms', 0))
        else:
            event_id = event['id']
        pending_path.unlink()
        session, data = load_case(folder)
        return {**view(folder, session, data), 'recovered_event_id': event_id,
                'preserved_trace': recovered_tail}
    if args.command == 'list':
        cases = []
        if folder.exists():
            for state_path in sorted(folder.glob('*/session.json')):
                try:
                    session, data = load_case(state_path.parent)
                    if args.mode != 'all' and session['mode'] != args.mode:
                        continue
                    result = view(state_path.parent, session, data)
                    cases.append({key: result[key] for key in ('case_path', 'phase', 'mode', 'stage')})
                except (OSError, ValueError, KeyError, TypeError):
                    cases.append({'case_path': str(state_path.parent), 'error': 'invalid session'})
        return {'cases': cases}
    if args.command == 'new':
        # Read inputs before creating anything so failed startup cannot truncate a case.
        initial = message(args.input_file) if args.input_file else None
        data = load_json(I1_TEMPLATE)
        slug = re.sub(r'[^a-z0-9]+', '-', folder.name.lower()).strip('-')
        if not slug:
            raise ValueError('case directory needs a lowercase alphanumeric identifier')
        data['case_id'] = slug
        session = {'version': 1, 'stage': 'interview_1', 'mode': args.mode, 'model': args.model or 'unrecorded', 'created_at': now(),
                   'updated_at': now(), 'paused': False, 'refresh_required': False,
                   'refresh_after': '', 'needs_processing': initial is not None, 'pending': None, 'answered_question': None, 'entries': []}
        if initial is not None:
            append_entry(session, 'user', 'initial', initial)
        folder.mkdir(parents=True, exist_ok=False)
        persist_artifact(folder, session, data)
        return view(folder, session, data)
    if args.command == 'start-2':
        session, data = load_case(folder)
        if session['stage'] != 'interview_1':
            raise ValueError('interview 2 is already started for this case')
        report = i1_validate(data)
        if not report['complete']:
            raise ValueError('interview 1 must be complete and confirmed before interview 2')
        experience_path = folder / '02-experience.json'
        if experience_path.exists():
            experience = load_json(experience_path)
            source = interview2.bind_interview1(experience, folder / '01-context.json')
            experience['status'] = 'in_progress'
            experience['confirmation'] = dict(EMPTY_CONFIRMATION)
            experience['evidence_status']['status'] = 'stale'
            experience['evidence_status']['project_id'] = source['service_context']['project_id']
            experience['evidence_status']['baseline_revision'] = source['service_context']['observed_revision']
            experience['history'].append({
                'change': '인터뷰 1 입력 재연결',
                'reason': '확인된 인터뷰 1 변경의 영향을 사용자 경험에 다시 반영한다.',
            })
            atomic_json(experience_path, experience)
        else:
            interview2.init_from_interview1(experience_path, folder / '01-context.json')
        session['stage'] = 'interview_2'
        session['paused'] = False
        session['refresh_required'] = False
        session['refresh_after'] = ''
        session['needs_processing'] = False
        session['pending'] = None
        session['answered_question'] = None
        append_entry(session, 'system', 'start-2', 'Interview 2 started from the confirmed interview 1 result.')
        data = load_json(folder / '02-experience.json')
        save_metadata(folder, session)
        return view(folder, session, data)
    if args.command == 'start-3':
        session, data = load_case(folder)
        if session['stage'] != 'interview_2':
            raise ValueError('start-3 requires the interview 2 stage')
        if session['paused'] or session['refresh_required']:
            raise ValueError('resume and refresh the upstream context before start-3')
        if not interview2.validate(data)['complete'] or not input_binding_current(folder, data):
            raise ValueError('interview 2 and its input must be complete, confirmed and current')
        module = stage_module('interview_3')
        path = folder / '03-screen-behavior.json'
        if path.exists():
            draft = load_json(path)
            module.bind_inputs(draft, folder / '02-experience.json')
            draft['status'] = 'in_progress'
            draft['confirmation'] = dict(EMPTY_CONFIRMATION)
            draft['evidence_status']['status'] = 'stale'
            draft['history'].append({'change': '인터뷰 2 입력 재연결',
                                     'reason': '기존 화면 모델을 보존하고 변경 영향을 재검토한다.'})
        else:
            draft = module.init_from_interview2(path, folder / '02-experience.json')
        session.update(stage='interview_3', paused=False, refresh_required=False,
                       refresh_after='', needs_processing=False, pending=None, answered_question=None)
        append_entry(session, 'system', 'start-3', 'Interview 3 started from confirmed current inputs.')
        persist_artifact(folder, session, draft)
        return view(folder, session, draft)
    if args.command in ('reopen-1', 'reopen-2'):
        session, data = load_case(folder)
        target = 'interview_1' if args.command == 'reopen-1' else 'interview_2'
        allowed = ('interview_2', 'interview_3') if target == 'interview_1' else ('interview_3',)
        if session['stage'] not in allowed:
            raise ValueError('reopen requires an active downstream interview')
        # Preserve the downstream draft, explicitly revoke its approval before returning upstream.
        data['status'] = 'in_progress'
        data['confirmation'] = dict(EMPTY_CONFIRMATION)
        data['evidence_status']['status'] = 'stale'
        append_entry(session, 'system', args.command, 'Upstream reopened; downstream draft preserved for rebind.')
        persist_artifact(folder, session, data)
        session.update(stage=target, paused=False, refresh_required=True,
                       refresh_after=checked_at(target, load_json(artifact_path(folder, target))),
                       needs_processing=False, pending=None, answered_question=None)
        save_metadata(folder, session)
        return view(folder, session, load_json(artifact_path(folder, target)))
    session, data = load_case(folder)
    if args.command in ('ask', 'revise-decision-question', 'confirm'):
        current = (input_binding_current(folder, data) if session['stage'] == 'interview_2' else
                   validate_artifact(session['stage'], data).get('input_ready', False)
                   if session['stage'] == 'interview_3' else True)
        if not current:
            raise ValueError('upstream input is stale; recheck and rebind before questions or confirmation')
    if (
        session['mode'] == 'live'
        and args.command in ('save', 'ask', 'revise-decision-question', 'confirm', 'record-tool')
        and not getattr(args, 'decision_id', None)
    ):
        raise ValueError(
            'live agent action requires --decision-id from record-decision'
        )
    if getattr(args, 'decision_id', None):
        decisions = read_journal(folder / 'evidence/decisions.jsonl')
        if not any(row['id'] == args.decision_id for row in decisions):
            raise ValueError('decision-id must reference an existing recorded decision in this case')
    if args.command == 'trace':
        return trace_view(folder)
    if args.command == 'assert-yield':
        result = view(folder, session, data)
        if not result['can_yield']:
            raise ValueError(
                'turn cannot end yet: ' + result['yield_reason'] +
                '; phase=' + result['phase'] +
                '; required_actions=' + json.dumps(result['required_actions'], ensure_ascii=False)
            )
        return result
    if args.command == 'record-decision':
        decision = load_json(args.decision)
        validate_decision(decision, data)
        entry = append_entry(session, 'system', 'decision', redact(decision['reason']))
        content_hash, review_hash = artifact_fingerprints(session['stage'], data)
        append_journal(folder / 'evidence/decisions.jsonl', {**decision, 'id': entry['id'], 'at': entry['at'],
                       'mode': session['mode'], 'interview_stage': session['stage'],
                       'content_hash': content_hash, 'review_hash': review_hash})
        save_metadata(folder, session)
        return {**view(folder, session, data), 'decision_id': entry['id']}
    if args.command == 'status':
        return view(folder, session, data)
    if args.command == 'revise-decision-question':
        if session['paused'] or session['refresh_required']:
            raise ValueError('resume and refresh context before revising a question')
        if not validate_artifact(session['stage'], data)['baseline_ready']:
            raise ValueError('basic service context must be ready before revising a question')
        pending = session['pending']
        if session['stage'] not in ('interview_2', 'interview_3') or not pending or pending['kind'] != 'decision':
            raise ValueError('an interview 2 decision question must be pending')
        packet_id = pending.get('decision_packet_id')
        packets = {packet['id']: packet for packet in data['decision_packets']}
        if packet_id not in packets or packets[packet_id]['status'] != 'open':
            raise ValueError('pending question must reference an open decision packet')
        context = load_decision_context(args.context_file, data)
        report = validate_artifact(session['stage'], data)
        progress, snapshot = question_progress(folder, session, data, packet_id, context=context)
        entry = append_entry(
            session, 'assistant', 'decision',
            progress + '\n' + render_decision_question(context, message(args.text_file)),
        )
        entry.update(decision_packet_id=packet_id, decision_context=context,
                     replaces=pending['id'], progress_snapshot=snapshot)
        session['pending'] = {**entry, 'content_hash': report['content_hash'],
                              'review_hash': report['review_hash']}
        session['answered_question'] = None
        save_metadata(folder, session)
        return view(folder, session, data)
    if args.command == 'save':
        candidate = load_json(args.draft)
        if session['stage'] in ('interview_2', 'interview_3') and candidate.get('input_binding') != data.get('input_binding'):
            raise ValueError('save cannot change the confirmed interview 1 input binding')
        report = validate_artifact(session['stage'], candidate)
        if not report['valid']:
            raise ValueError(json.dumps(report, ensure_ascii=False))
        if candidate['status'] == 'complete' or candidate['confirmation']['confirmed']:
            raise ValueError('save cannot supply approval; use ask confirmation, answer, then confirm')
        old_hashes = artifact_fingerprints(session['stage'], data)
        new_hashes = artifact_fingerprints(session['stage'], candidate)
        if old_hashes != new_hashes:
            candidate['confirmation'] = dict(EMPTY_CONFIRMATION)
            if session['pending'] and session['pending']['kind'] == 'confirmation':
                session['pending'] = None
            session['answered_question'] = None
        if report['baseline_ready'] and session['refresh_required'] and newer_context(candidate, session):
            session['refresh_required'] = False
        session['needs_processing'] = False
        append_entry(session, 'system', 'save', 'Validated candidate saved; no review or approval was created.')
        persist_artifact(folder, session, candidate)
        return view(folder, session, candidate)
    if args.command == 'ask':
        if session['paused']:
            raise ValueError('session paused; resume and refresh context first')
        if session['pending']:
            raise ValueError('a question is already pending; record its answer before asking another')
        report = validate_artifact(session['stage'], data)
        if args.kind != 'access' and (session['refresh_required'] or not report['baseline_ready']):
            raise ValueError('basic service context must be ready and refreshed before interviewing')
        if args.kind != 'access' and session.get('needs_processing', False):
            raise ValueError('process the latest user answer and save a draft before the next question')
        if args.kind == 'confirmation' and not report['ready_for_confirmation']:
            raise ValueError('current artifact is not ready for confirmation')
        if args.kind == 'decision':
            if session['stage'] not in ('interview_2', 'interview_3') or not args.packet_id:
                raise ValueError('decision questions require an interview 2 or 3 packet-id')
            packets = {packet['id']: packet for packet in data['decision_packets']}
            if args.packet_id not in packets or packets[args.packet_id]['status'] != 'open':
                raise ValueError('decision question requires an open decision packet')
            decision_context = load_decision_context(args.context_file, data)
        elif args.packet_id:
            raise ValueError('packet-id is only valid for decision questions')
        elif args.context_file:
            raise ValueError('context-file is only valid for decision questions')
        if not report['valid']:
            raise ValueError('current artifact is invalid; save a valid draft first')
        question = message(args.text_file)
        if args.kind == 'decision':
            question = render_decision_question(decision_context, question)
        if session['stage'] in ('interview_2', 'interview_3'):
            progress, snapshot = question_progress(folder, session, data, args.packet_id or '', full=args.kind == 'confirmation', context=decision_context if args.kind == 'decision' else None)
            question = progress + '\n' + question
        entry = append_entry(session, 'assistant', args.kind, question)
        if session['stage'] in ('interview_2', 'interview_3'):
            entry['progress_snapshot'] = snapshot
        if args.kind == 'decision':
            entry['decision_packet_id'] = args.packet_id
            entry['decision_context'] = decision_context
        session['pending'] = {**entry, 'content_hash': report['content_hash'], 'review_hash': report['review_hash']}
        session['answered_question'] = None
        save_metadata(folder, session)
    elif args.command == 'answer':
        pending = session['pending']
        append_entry(session, 'user', 'answer' if pending else 'input', message(args.text_file),
                     pending['id'] if pending else None)
        session['needs_processing'] = True
        session['answered_question'] = pending if pending and pending['kind'] == 'confirmation' else None
        session['pending'] = None
        save_metadata(folder, session)
    elif args.command == 'confirm':
        question = session['answered_question']
        user = last_user(session)
        report = validate_artifact(session['stage'], data)
        if session['paused'] or session['refresh_required']:
            raise ValueError('resume and refresh context before confirmation')
        if not question or not user or user['id'] != args.turn_id or user['reply_to'] != question['id']:
            raise ValueError('confirmation requires the latest actual answer to a confirmation question')
        if not report['ready_for_confirmation'] or (question['content_hash'], question['review_hash']) != artifact_fingerprints(session['stage'], data):
            raise ValueError('confirmation question is stale or current result is not ready')
        data['confirmation'] = {'confirmed': True, 'turn_id': user['id'], 'statement': user['text'],
                                'content_hash': report['content_hash'], 'review_hash': report['review_hash']}
        data['status'] = 'complete'
        final = validate_artifact(session['stage'], data)
        if not final['complete']:
            raise ValueError(json.dumps(final, ensure_ascii=False))
        heading = '> 모의 실행 (simulation). 실제 서비스 조회 결과가 아닙니다.\n\n' if session['mode'] == 'simulation' else ''
        output_name = artifact_path(folder, session['stage']).with_suffix('.md').name
        (folder / output_name).write_text(heading + render_artifact(session['stage'], data, final), encoding='utf-8')
        session['answered_question'] = None
        session['needs_processing'] = False
        append_entry(session, 'system', 'complete', f"Current content confirmed; {session['stage']} completed.")
        persist_artifact(folder, session, data)
    elif args.command == 'pause':
        session['paused'] = True
        append_entry(session, 'system', 'pause', 'Interview paused at user request.')
        save_metadata(folder, session)
    elif args.command == 'resume':
        session['paused'] = False
        session['refresh_required'] = True
        session['refresh_after'] = checked_at(session['stage'], data)
        session['answered_question'] = None
        if session['pending'] and session['pending']['kind'] == 'confirmation':
            session['pending'] = None
        append_entry(session, 'system', 'resume', 'Fresh MCP context check required before next interview question.')
        save_metadata(folder, session)
    elif args.command == 'record-tool':
        receipt = load_json(args.receipt)
        if not isinstance(receipt, dict) or not all(key in receipt for key in ('tool', 'arguments', 'result')):
            raise ValueError('receipt requires tool, arguments and result from an actual call or explicit simulation')
        entry = append_entry(session, 'tool', 'receipt', str(receipt['tool']))
        path = folder / 'evidence/tool-events.jsonl'
        path.parent.mkdir(parents=True, exist_ok=True)
        append_journal(path, {'id': entry['id'], 'mode': session['mode'], 'recorded_at': entry['at'],
                              'interview_stage': session['stage'],
                              'decision_id': args.decision_id, 'receipt': receipt})
        save_metadata(folder, session)
    return view(folder, session, data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for command in ('new', 'start-2', 'start-3', 'reopen-1', 'reopen-2', 'list', 'status', 'save', 'ask', 'revise-decision-question', 'answer', 'confirm', 'pause', 'resume', 'record-tool', 'record-decision', 'trace', 'assert-yield', 'recover-log'):
        sub = commands.add_parser(command)
        sub.add_argument('path', type=Path, nargs='?' if command == 'list' else None,
                         default=ROOT / 'artifacts/interviews' if command == 'list' else None)
        if command == 'new':
            sub.add_argument('--input-file', type=Path)
            sub.add_argument('--mode', choices=('live', 'simulation'), default='live')
            sub.add_argument('--model', help='Observed runtime model identifier, if available')
        elif command == 'list':
            sub.add_argument('--mode', choices=('live', 'simulation', 'all'), default='live')
        elif command == 'save':
            sub.add_argument('--draft', type=Path, required=True)
        elif command in ('ask', 'answer'):
            sub.add_argument('--text-file', type=Path, required=True)
            if command == 'ask':
                sub.add_argument('--kind', choices=('interview', 'decision', 'confirmation', 'access'), default='interview')
                sub.add_argument('--packet-id')
                sub.add_argument('--context-file', type=Path)
        elif command == 'revise-decision-question':
            sub.add_argument('--text-file', type=Path, required=True)
            sub.add_argument('--context-file', type=Path, required=True)
        elif command == 'confirm':
            sub.add_argument('--turn-id', required=True)
            # Accepted and ignored: the legacy schema is frozen, and refusing the flag would
            # make the current call shape fail on an old case for no gain.
            sub.add_argument('--outcome', choices=('approved', 'conditional', 'refused'),
                             default='approved')
        elif command == 'record-tool':
            sub.add_argument('--receipt', type=Path, required=True)
        elif command == 'record-decision':
            sub.add_argument('--decision', type=Path, required=True)
        elif command == 'trace':
            sub.add_argument('--format', choices=('json', 'markdown'), default='json')
        if command in ('ask', 'revise-decision-question', 'save', 'record-tool', 'confirm', 'pause', 'resume'):
            sub.add_argument('--decision-id', help='Recorded decision that selected this operation')
    args = parser.parse_args()
    global _ACTIVE_OPERATION
    observed = args.command not in ('status', 'list', 'trace', 'recover-log')
    pending_path = args.path.resolve() / 'evidence/pending-operation.json'
    if pending_path.exists() and observed:
        print(json.dumps({'error': 'audit recovery required; use recover-log before further operations'}, ensure_ascii=False))
        return 1
    before = capture(args.path.resolve()) if observed else None
    started_at, started = now(), time.perf_counter()
    error = None
    durable = observed and (args.command == 'start-3' or
                            ((before or {}).get('session') or {}).get('stage') == 'interview_3')
    pending_record = None
    try:
        if durable:
            import uuid
            args.operation_id = uuid.uuid4().hex
            pending_record = {'operation_id': args.operation_id,
                              'args': {k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items()},
                              'before': before, 'started_at': started_at}
            atomic_json(pending_path, pending_record)
        _ACTIVE_OPERATION = durable or args.command == 'recover-log'
        result = run(args)
        code = 0
    except (OSError, ValueError, KeyError, TypeError, RecursionError) as exc:
        error = str(exc)
        result, code = {'error': redact(error)}, 1
        if args.command == 'save' and getattr(args, 'draft', None):
            try:
                session, _ = load_case(args.path.resolve())
                result['draft_validation'] = validate_artifact(session['stage'], load_json(args.draft))
            except (OSError, ValueError, KeyError, TypeError):
                pass
    if observed:
        try:
            after = capture(args.path.resolve())
            duration = (time.perf_counter() - started) * 1000
            if pending_record is not None:
                pending_record.update(after=after, result=result, error=error, duration_ms=duration)
                atomic_json(pending_path, pending_record)
            event_id = record_operation(args.path.resolve(), args, before, after,
                                        result, error, started_at, duration)
            result['trace_event_id'] = event_id
            if pending_record is not None:
                pending_path.unlink()
        except (OSError, ValueError, KeyError, TypeError) as exc:
            result['logging_error'] = redact(str(exc))
            result['operation_succeeded'] = code == 0
            code = 1
    _ACTIVE_OPERATION = False
    if args.command == 'trace' and args.format == 'markdown' and code == 0:
        print(trace_markdown(result), end='')
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return code


if __name__ == '__main__':
    sys.exit(main())
