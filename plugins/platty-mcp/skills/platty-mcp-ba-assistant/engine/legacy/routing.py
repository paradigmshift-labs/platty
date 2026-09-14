"""Compatibility boundary: old command/storage names never rewrite historical data."""
import json
from pathlib import Path
import subprocess
import sys

STAGES = {'interview_1': 'planning_context', 'interview_2': 'user_experience', 'interview_3': 'screen_behavior'}
COMMANDS = {'start-2': ('start', 'user_experience'), 'start-3': ('start', 'screen_behavior'),
            'reopen-1': ('reopen', 'planning_context'), 'reopen-2': ('reopen', 'user_experience')}


def normalize_args(argv):
    if argv and argv[0] in COMMANDS:
        command, stage = COMMANDS[argv[0]]
        return [command, *argv[1:], '--stage', stage]
    return argv


def is_legacy_case(path):
    try:
        return json.loads((path / 'session.json').read_text()).get('stage') in STAGES
    except (OSError, ValueError):
        return False


def display(value):
    if isinstance(value, list):
        return [display(v) for v in value]
    if not isinstance(value, dict):
        return value
    result = {}
    for key, item in value.items():
        if key == 'kind' and isinstance(item, str) and item in COMMANDS:
            result['kind'], result['stage'] = COMMANDS[item]
            continue
        if key in ('stage', 'interview_stage') and isinstance(item, str):
            item = STAGES.get(item, item)
        elif key in ('phase', 'next_stage') and isinstance(item, str):
            for old, new in STAGES.items():
                item = item.replace(old, new)
        elif key in ('user_status', 'prompt', 'reason', 'yield_reason') and isinstance(item, str):
            for old, (command, stage) in COMMANDS.items():
                item = item.replace(old, command + ' --stage ' + stage)
            for old, new in [('인터뷰 1','기획 맥락 정의'), ('인터뷰 2','사용자 경험 설계'), ('인터뷰 3','화면 동작 명세')]:
                item = item.replace(old, new)
        result[key] = display(item)
    return result


def read_status(path):
    result = subprocess.run([sys.executable, '-B', str(Path(__file__).with_name('ba_session.py')),
                             'status', str(path)], capture_output=True, text=True)
    if result.returncode:
        raise ValueError('invalid legacy session: ' + result.stdout)
    return display(json.loads(result.stdout))


def invoke(args):
    command = args.command
    if command in ('start', 'reopen'):
        command = next(old for old, pair in COMMANDS.items() if pair == (command, args.stage))
    argv = [command, str(args.path)]
    for key, value in vars(args).items():
        if key in ('command', 'path', 'stage') or value is None or value is False:
            continue
        argv.append('--' + key.replace('_', '-'))
        if value is not True:
            argv.append(str(value))
    result = subprocess.run([sys.executable, '-B', str(Path(__file__).with_name('ba_session.py')), *argv],
                            capture_output=True, text=True)
    try:
        body = display(json.loads(result.stdout))
        body['storage_format'] = 'legacy'
        print(json.dumps(body, ensure_ascii=False, indent=2))
    except ValueError:
        print(result.stdout, end='')
    if result.stderr:
        print(result.stderr, file=sys.stderr, end='')
    return result.returncode
