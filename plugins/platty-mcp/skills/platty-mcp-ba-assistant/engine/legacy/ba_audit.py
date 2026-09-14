"""Append-only observation records for BA sessions; never changes interview judgments."""
import hashlib
import json
import os
from pathlib import Path
import re
import uuid
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from legacy.interview1 import CRITERIA as I1_CRITERIA, EXAMPLES as I1_EXAMPLES, check_shape, markdown
from legacy.interview2 import CRITERIA as I2_CRITERIA, EXAMPLES as I2_EXAMPLES

ROOT = Path(__file__).resolve().parents[2]
SECRET_KEYS = {'authorization', 'proxy_authorization', 'cookie', 'set_cookie', 'access_token',
               'refresh_token', 'id_token', 'client_secret', 'password', 'passwd', 'api_key',
               'x_api_key', 'secret', 'token', 'code_verifier'}
SECRET_NAMES = {re.sub(r'[^a-z0-9]', '', key.lower()) for key in SECRET_KEYS}


def sensitive_key(key):
    return re.sub(r'[^a-z0-9]', '', key.lower()) in SECRET_NAMES


CRITERIA = I1_CRITERIA + I2_CRITERIA
EXAMPLES = I1_EXAMPLES + I2_EXAMPLES
FLOW_CRITERIA = ('baseline_ready', 'input_ready', 'current_content', 'current_review',
                 'user_confirmation', 'no_pending_question')
DECISION_LINKED_ACTIONS = frozenset(('save', 'ask', 'revise-decision-question', 'record-tool',
                                     'acknowledge-inventory', 'confirm'))
DECISION_SHAPE = {
    'stage': ('baseline', 'interpret', 'retrieve', 'evaluate', 'question', 'confirmation', 'recovery'),
    'outcome': ('continue', 'ask_user', 'lookup', 'needs_work', 'ready', 'wait', 'complete'),
    'reason': str, 'criteria': [str], 'example_ids': [str], 'evidence_ids': [str], 'issue_ids': [str],
    'next_action': {'kind': ('ask_user', 'platty', 'web', 'handoff', 'wait', 'finish'), 'prompt': str},
}


def redact(value):
    if isinstance(value, dict):
        return {key: '[REDACTED]' if sensitive_key(key) else redact(item)
                for key, item in value.items()}
    if isinstance(value, list):
        return [redact(item) for item in value]
    if not isinstance(value, str):
        return value
    value = re.sub(r'(?i)\bBearer\s+[^\s,"\'}]+', 'Bearer [REDACTED]', value)
    value = re.sub(r'(?i)([a-z][a-z0-9+.-]*://)[^/\s@]+@', r'\1[REDACTED]@', value)

    def safe_url(match):
        try:
            parts = urlsplit(match.group(0))
            query = [(key, '[REDACTED]' if sensitive_key(key) or key.lower() in {'code', 'state'} else item)
                     for key, item in parse_qsl(parts.query, keep_blank_values=True)]
            return urlunsplit(parts._replace(query=urlencode(query)))
        except ValueError:
            return '[INVALID URL]'

    return re.sub(r'https?://[^\s<>"\']+', safe_url, value)


def read_journal(path):
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]


def append_journal(path, record):
    path.parent.mkdir(parents=True, exist_ok=True)
    needs_newline = False
    if path.exists() and path.stat().st_size:
        with path.open('rb') as stream:
            stream.seek(-1, os.SEEK_END)
            needs_newline = stream.read(1) != b'\n'
    with path.open('a', encoding='utf-8') as stream:
        if needs_newline:
            stream.write('\n')
        stream.write(json.dumps(redact(record), ensure_ascii=False) + '\n')
        stream.flush()
        os.fsync(stream.fileno())


def recover_trace_tail(folder):
    """Preserve a torn final append before restoring the valid journal prefix."""
    path = folder / 'evidence/trace.jsonl'
    if not path.exists():
        return None
    body = path.read_bytes()
    rows = body.splitlines(keepends=True)
    for index, row in enumerate(rows):
        if not row.strip():
            continue
        try:
            json.loads(row)
        except (ValueError, UnicodeDecodeError):
            if index != len(rows) - 1:
                raise ValueError('trace corruption is not limited to the final append; preserve and inspect the journal')
            archive = folder / 'evidence/recovery'
            archive.mkdir(parents=True, exist_ok=True)
            backup = archive / ('trace-' + uuid.uuid4().hex + '.jsonl')
            with backup.open('xb') as stream:
                stream.write(body)
            repaired = path.with_name('.trace-repair-' + uuid.uuid4().hex)
            with repaired.open('xb') as stream:
                stream.write(b''.join(rows[:index]))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(repaired, path)
            return str(backup.relative_to(folder))
    return None


def validate_decision(value, data):
    errors = []
    shape = dict(DECISION_SHAPE)
    if data.get('model_profile') == 'screen_element_behavior_v1' and 'target_refs' in value:
        shape['target_refs'] = [str]
    check_shape(value, shape, '$.decision', errors)
    if errors:
        raise ValueError('; '.join(errors))
    for key, text in [('reason', value['reason']), ('next_action.prompt', value['next_action']['prompt'])]:
        if not text.strip() or len(text) > 2000:
            errors.append(f'$.decision.{key}: concise nonempty explanation required (max 2000 characters)')
    if not value['criteria']:
        errors.append('$.decision.criteria: at least one criterion required')
    interview_3 = data.get('model_profile') == 'screen_element_behavior_v1'
    interview_2 = data.get('model_profile') == 'ux_statechart_viewflow_v1'
    if interview_2 and not set(value['criteria']).intersection(I2_CRITERIA):
        errors.append('$.decision.criteria: interview 2 requires at least one X1-X11 criterion')
    stage_criteria = I2_CRITERIA if interview_2 else I1_CRITERIA
    stage_examples = I2_EXAMPLES if interview_2 else I1_EXAMPLES
    if interview_3:
        from legacy.interview3 import CRITERIA, EXAMPLES
        stage_criteria, stage_examples = CRITERIA, EXAMPLES
        targets = {'model'} | {row['id'] for rows in data.values() if isinstance(rows, list)
                                 for row in rows if isinstance(row, dict) and 'id' in row}
        targets |= {row['scope_id'] + ':' + row['dimension'] for row in data.get('coverage_checks', [])}
        given = value.get('target_refs', [])
        if len(given) != len(set(given)) or any(target not in targets for target in given):
            errors.append('$.decision.target_refs: duplicate or unknown target')
        if not set(value['criteria']).intersection(CRITERIA):
            errors.append('$.decision.criteria: interview 3 requires at least one S1-S8 criterion')
    for key, known in [('criteria', set(stage_criteria) | set(FLOW_CRITERIA)), ('example_ids', set(stage_examples)),
                       ('evidence_ids', {s['id'] for s in data['sources']}),
                       ('issue_ids', {s['id'] for s in data['issues']})]:
        ids = value[key]
        if len(ids) != len(set(ids)) or any(item not in known for item in ids):
            errors.append(f'$.decision.{key}: duplicate or unknown references')
    if errors:
        raise ValueError('; '.join(errors))


def changed_paths(before, after, prefix=''):
    if before == after:
        return []
    if isinstance(before, dict) and isinstance(after, dict):
        changes = []
        for key in sorted(before.keys() | after.keys()):
            path = f'{prefix}.{key}' if prefix else key
            if key not in before or key not in after:
                changes.append(path)
            else:
                changes.extend(changed_paths(before[key], after[key], path))
        return changes
    return [prefix or '$']


def versions(folder):
    files = {'public_router': 'scripts/legacy/routing.py', 'public_controller': 'scripts/ba_session.py',
             'controller': 'scripts/legacy/ba_session.py', 'audit': 'scripts/legacy/ba_audit.py',
             'validator_interview_1': 'scripts/legacy/interview1.py',
             'validator_interview_2': 'scripts/legacy/interview2.py',
             'validator_interview_3': 'scripts/legacy/interview3.py',
             'validator_screen_behavior_v2': 'scripts/legacy/screen_behavior_v2.py',
             'screen_authoring': 'scripts/screen_authoring.py',
             'screen_review_planner': 'scripts/screen_review.py',
             'interview_1_procedure': 'docs/design/stages/planning-context/workflow.md',
             'interview_3_procedure': 'docs/design/stages/screen-behavior/workflow.md',
             'criteria_interview_3': 'docs/design/stages/screen-behavior/qualitative-review.md',
             'examples_interview_3': 'docs/design/stages/screen-behavior/qualitative-examples.md',
             'coverage_interview_3': 'docs/design/stages/screen-behavior/coverage-model.md',
             'performance_screen_behavior': 'docs/design/stages/screen-behavior/performance.md',
             'experience_graph': 'scripts/legacy/experience_graph.py',
             'experience_verification': 'scripts/legacy/experience_verification.py',
             'interview_2_procedure': 'docs/design/stages/user-experience/workflow.md',
             'skill': 'platty-mcp-ba-assistant',
             'criteria': 'docs/design/stages/planning-context/qualitative-review.md',
             'examples': 'docs/design/stages/planning-context/qualitative-examples.md',
             'criteria_interview_2': 'docs/design/stages/user-experience/qualitative-review.md',
             'examples_interview_2': 'docs/design/stages/user-experience/qualitative-examples.md'}
    recorded = {}
    archive = folder / 'evidence/versions'
    archive.mkdir(parents=True, exist_ok=True)
    for key, relative in files.items():
        path = ROOT / relative
        if not path.exists():
            recorded[key] = None
            continue
        body = path.read_bytes()
        checksum = hashlib.sha256(body).hexdigest()
        target = archive / (checksum + '.txt')
        if target.exists():
            if hashlib.sha256(target.read_bytes()).hexdigest() != checksum:
                raise ValueError('existing version snapshot checksum mismatch')
        else:
            with target.open('xb') as stream:
                stream.write(body)
        recorded[key] = checksum
    return recorded


def record_operation(folder, args, before, after, result, error, started_at, duration_ms):
    if after['session'] is None and before['session'] is None:
        return None  # No valid case to associate an operation with.
    path = folder / 'evidence/trace.jsonl'
    previous = read_journal(path)
    session = after['session'] or before['session']
    details = {}
    if args.command in ('new', 'save', 'confirm', 'start-3') and error is None and after['data'] is not None:
        data = after['data']
        if session['stage'] == 'interview_3':
            assessments = {'reviews': data.get('reviews', []), 'review': data.get('review', {})}
        elif session['stage'] == 'interview_2':
            assessments = {
                'scenarios': {row['id']: row['assessment'] for row in data.get('scenarios', [])},
                'view_requirements': {row['id']: row['assessment'] for row in data.get('view_requirements', [])},
                'review': data.get('review', {}),
            }
        else:
            assessments = {'areas': {key: area['assessment'] for key, area in data['areas'].items()},
                           'review': data['review']}
        details = {
            'snapshot': f"evidence/snapshots/{len(session['entries']):05}.json",
            'changed_paths': changed_paths(before['data'], data),
            'assessments': assessments,
        }
    if args.command == 'record-decision' and error is None:
        records = read_journal(folder / 'evidence/decisions.jsonl')
        details['decision'] = next(row for row in reversed(records) if row['id'] == result['decision_id'])
    if args.command == 'record-tool' and error is None:
        row = read_journal(folder / 'evidence/tool-events.jsonl')[-1]
        receipt = row['receipt']
        body = receipt.get('result')
        flag = receipt.get('is_error', body.get('isError') if isinstance(body, dict) else None)
        details.update(tool=receipt['tool'], tool_outcome='error' if flag is True else 'success' if flag is False else 'unknown',
                       receipt_ref='evidence/tool-events.jsonl#' + row['id'])
    event = {
        'schema_version': 1, 'id': 'e-' + uuid.uuid4().hex,
        'operation_id': getattr(args, 'operation_id', None),
        'sequence': previous[-1]['sequence'] + 1 if previous else 1,
        'previous_event_id': previous[-1]['id'] if previous else None,
        'started_at': started_at, 'duration_ms': round(duration_ms, 3),
        'case_id': (after['data'] or before['data'] or {}).get('case_id'),
        'stage': session['stage'], 'mode': session['mode'], 'model': session.get('model', 'unrecorded'),
        'command': args.command, 'outcome': 'error' if error is not None else 'success',
        'decision_id': getattr(args, 'decision_id', None),
        'before': before['summary'], 'after': after['summary'], 'error': error,
        'details': details, 'versions': versions(folder),
        'prior_session_entries': len(before['session']['entries']) if before['session'] else 0,
    }
    if session['stage'] == 'interview_3' or (before.get('session') or {}).get('stage') == 'interview_3':
        report = result.get('validation') or after.get('validation') or before.get('validation')
        if report is not None:
            report_path = folder / 'evidence/validations' / (event['id'] + '.json')
            report_path.parent.mkdir(parents=True, exist_ok=True)
            payload = {'run_id': event['id'], 'interview_stage': session['stage'],
                       'at': started_at, 'command': args.command, 'decision_id': event['decision_id'],
                       'model': session.get('model', 'unrecorded'), 'versions': event['versions'],
                       'operation_error': error, **report,
                       'input_hashes': (after.get('data') or before.get('data') or {}).get('input_binding', {}),
                       'structural': {'valid': report['valid'], 'errors': report['errors']}}
            if 'draft_validation' in result:
                payload['rejected_candidate'] = result['draft_validation']
            with report_path.open('x', encoding='utf-8') as stream:
                json.dump(redact(payload), stream, ensure_ascii=False, indent=2)
                stream.write('\n')
            event['details']['validation_report'] = str(report_path.relative_to(folder))
    append_journal(path, event)
    return event['id']


def trace_view(folder):
    events = read_journal(folder / 'evidence/trace.jsonl')
    return {'case_path': str(folder.resolve()), 'events': events, 'summary': {
        'events': len(events), 'errors': sum(row['outcome'] == 'error' for row in events),
        'decisions': sum(row['command'] == 'record-decision' and row['outcome'] == 'success' for row in events),
        'tool_errors': sum(row['details'].get('tool_outcome') == 'error' for row in events),
        'unlinked_actions': sum(row['command'] in DECISION_LINKED_ACTIONS and
                                row['outcome'] == 'success' and not row['decision_id'] for row in events),
    }}


def trace_markdown(report):
    lines = ['# BA 실행 추적', '', '사례 폴더: ' + markdown(report['case_path']), '', '기록된 기준·근거·선택 결과이며 모델의 비공개 사고 과정이 아닙니다.', '',
             '도구 상세 응답은 receipt_ref, 영역별 평가 원본은 snapshot 경로에서 확인합니다.', '']
    for row in report['events']:
        before = (row['before'] or {}).get('phase', 'none')
        after = (row['after'] or {}).get('phase', 'unknown')
        lines += [f"## {row['sequence']}. {markdown(row['command'])} — {row['outcome']}", '',
                  f"{markdown(before)} → {markdown(after)} · {row['duration_ms']} ms · {row['mode']}", '',
                  '이벤트: ' + row['id'], '', '연결 판단: ' + str(row['decision_id']), '']
        if row['error']:
            lines += [markdown(row['error']), '']
        decision = row['details'].get('decision')
        if decision:
            lines += [markdown(decision['reason']), '', '기준: ' + ', '.join(decision['criteria']), '',
                      '비교 예시: ' + ', '.join(decision['example_ids']), '',
                      '근거: ' + ', '.join(map(markdown, decision['evidence_ids'])), '',
                      '다음 행동: ' + markdown(decision['next_action']['prompt']), '']
        if 'tool' in row['details']:
            lines += ['도구: ' + markdown(row['details']['tool']), '',
                      '결과: ' + row['details']['tool_outcome'], '',
                      '응답 위치: ' + markdown(row['details']['receipt_ref']), '']
        if 'snapshot' in row['details']:
            lines += ['스냅샷: ' + markdown(row['details']['snapshot']), '',
                      '변경 위치: ' + ', '.join(map(markdown, row['details']['changed_paths'])), '']
    return '\n'.join(lines) + '\n'
