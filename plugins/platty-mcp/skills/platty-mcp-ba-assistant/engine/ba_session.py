#!/usr/bin/env python3
"""BA interview session controller. Codex supplies questions, evidence and LLM reviews."""
import argparse
import copy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time

# Resolve the shared module even when this script is invoked through the skill symlink.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from planning_context import TEMPLATE as CONTEXT_TEMPLATE
from planning_context import fingerprints as context_fingerprints
from planning_context import load_json, render as context_render, validate as context_validate
import planning_context
import user_experience
import jtbd
import prd
import visual_decision_frame
from experience_progress import render_progress, render_full_model
from legacy.routing import normalize_args, is_legacy_case, invoke as invoke_legacy, read_status as legacy_status
from ba_audit import (append_journal, read_journal, record_operation, redact,
                      trace_markdown, trace_view, validate_decision, recover_trace_tail)
from paths import PLUGIN_ROOT, WORKSPACE_ROOT

ROOT = PLUGIN_ROOT
_ACTIVE_OPERATION = False
EMPTY_CONFIRMATION = {'confirmed': False, 'turn_id': '', 'statement': '',
                      'content_hash': '', 'review_hash': ''}
WIREFRAME_EMPTY_CONFIRMATION = {**EMPTY_CONFIRMATION, 'input_hash': '', 'knowledge_hash': ''}


ARTIFACT_NAMES = {'jtbd': 'jtbd.json', 'prd': 'prd.json',
                  'planning_context': 'planning-context.json', 'user_experience': 'user-experience.json',
                  'screen_behavior': 'screen-behavior.json', 'design_system_wireframe': 'design-system-wireframe.json'}
PROGRESS_NAMES = {'jtbd': 'jtbd-progress.md', 'screen_behavior': 'screen-behavior-progress.md'}
STAGE_TEMPLATES = {'jtbd': jtbd.TEMPLATE, 'planning_context': CONTEXT_TEMPLATE}
# The chain the contract fixes; see docs/design/stage-contracts.md.
STAGE_ORDER = ('jtbd', 'prd', 'user_experience', 'screen_behavior', 'design_system_wireframe')
# Interview questions per stage. None is uncapped; a derived stage asks nothing.
QUESTION_BUDGET = {'jtbd': None, 'prd': 2, 'planning_context': None,
                   'user_experience': 0, 'screen_behavior': 0, 'design_system_wireframe': 0}
DERIVED_STAGES = ('user_experience', 'screen_behavior', 'design_system_wireframe')
# Closed to new work. A case already here still finishes; only the entrance is shut.
RETIRED_STAGES = ('planning_context',)
NEW_STAGES = tuple(stage for stage in STAGE_TEMPLATES if stage not in RETIRED_STAGES)
REOPEN_STAGES = ('jtbd', 'prd', 'planning_context', 'user_experience', 'screen_behavior')


def interview_allowed(stage):
    """C-1: a derived stage carries no interview; only a confirmation ends it."""
    return QUESTION_BUDGET.get(stage, 0) != 0


# Which stage a derived one reads. planning_context keeps its own legacy binding.
UPSTREAM_ARTIFACT = {stage: ARTIFACT_NAMES[STAGE_ORDER[index]]
                     for index, stage in enumerate(STAGE_ORDER[1:])}
START_STAGES = STAGE_ORDER[1:]


def next_stage(stage):
    """The successor in the fixed chain, or None at the end."""
    if stage not in STAGE_ORDER:
        return None
    index = STAGE_ORDER.index(stage) + 1
    return STAGE_ORDER[index] if index < len(STAGE_ORDER) else None


# Asking no interview question and waiting for an approval are separate things. The
# wireframe derives without questions, but its captures are the last thing a person sees.
PLANNER_CONFIRMS = ('jtbd', 'prd', 'planning_context', 'design_system_wireframe')


def awaits_planner(stage):
    """Which stages stop for a person."""
    return stage in PLANNER_CONFIRMS


def derived_confirmation(turn_id, content_hash, review_hash):
    """A completion record for a stage nobody was asked to approve.

    It fills the same slot a planner confirmation fills, so the downstream binding is
    unchanged, and it says in its own statement that no planner saw it.
    """
    return {'confirmed': True, 'turn_id': turn_id,
            'statement': '파생 단계 자동 확정 — 상위 확정본에서 도출했으며 기획자 확인은 받지 않았다.',
            'content_hash': content_hash, 'review_hash': review_hash}


def should_auto_complete(session, report, confirmed):
    """A derived stage that is ready has nothing left to wait for."""
    return (not awaits_planner(session['stage']) and not confirmed
            and report.get('ready_for_confirmation', False))


def counts_against_budget(kind):
    """Only an interview question spends a budget. A confirmation is not an interview."""
    return kind == 'interview'


def probe_room(issue):
    """grilling-rules.md rule 3: three probes on one item, then mark it a hypothesis."""
    return issue.get('probe_count', 0) < jtbd.PROBE_LIMIT


def spend_question(stage, data, manifest, answering=()):
    """Count the question the way the rule that bounds it assumes someone counts.

    Both numbers were validated against a limit and incremented by nothing, so a stage
    could ask freely and still pass its own check.
    """
    if stage == 'jtbd':
        if not manifest:
            return
        issue = next((row for row in data['issues'] if row['id'] == manifest['issue_id']), None)
        if issue is None:
            return
        if not probe_room(issue):
            raise ValueError(
                f"{issue['id']}: 한 항목에 {jtbd.PROBE_LIMIT}번 파고도 나오지 않았다. "
                '더 묻지 않고 가설로 표기하고 확인 방법을 적는다')
        issue['probe_count'] = issue.get('probe_count', 0) + 1
    elif stage == 'prd':
        if answering:
            # 이 질문은 탐색이 아니라 열린 역류를 닫는 일이다. 예산을 쓰지 않는다.
            return
        asked = data['discovery']['questions_asked']
        if asked >= prd.DISCOVERY_BUDGET:
            raise ValueError(
                f'product discovery budget spent ({asked}/{prd.DISCOVERY_BUDGET}); '
                'answer it from the carry, from retrieval, or leave it open in §7. '
                '열린 차단 역류에 답하는 질문은 예산을 쓰지 않는다 — 지금 열린 역류가 없다면 '
                '이것은 탐색이고, 탐색은 여기까지다')
        data['discovery']['questions_asked'] = asked + 1


def upstream_stages(stage):
    """Every stage strictly above this one. A backflow may target only these."""
    if stage not in STAGE_ORDER:
        return ()
    return STAGE_ORDER[:STAGE_ORDER.index(stage)]


def open_backflows_to(folder, stage):
    """Backflows a downstream stage raised that this stage has been reopened to answer.

    30건 중 **8건**이 같은 벽에 부딪혔고, 셋은 여기서 멈췄다. 역류해서 1b로 돌아오면
    `discovery.questions_asked`가 2에 남아 있어 `ask`가 거부되고, 오류 문구는 **파생에게
    스스로 답하라**고 시킨다 — 역류가 막으려는 바로 그 일이다. 빠져나간 길 넷이 전부
    기록을 오염시켰다: 확인 질문에 실질 질문을 얹기, `--unsolicited`로 「먼저 말한 것」,
    역류 티켓 삭제, 결정으로 우회.

    예산이 재는 것은 **탐색**이다. 파생이 정식으로 되돌린 질문에 답하는 것은 탐색이 아니라
    그 역류를 닫는 일이고, 그것을 예산으로 막으면 규칙 셋(파생=0 · 1b=2 · 역류=blocking)이
    각각 옳은 채로 합쳐져 큰 케이스가 2단계를 못 넘는다.

    면제는 스스로 좁다 — 열린 차단 역류가 이 단계를 가리키는 동안에만이다.
    """
    found = []
    for other in STAGE_ORDER[STAGE_ORDER.index(stage) + 1:] if stage in STAGE_ORDER else ():
        path = artifact_path(folder, other)
        if not path.exists():
            continue
        try:
            rows = load_json(path).get('issues') or []
        except (OSError, UnicodeError, ValueError):
            continue
        found += [row['id'] for row in rows
                  if row.get('target') == stage and row.get('blocking')
                  and not planning_context.closed(row)
                  and (row.get('action') or {}).get('kind') == 'wait']
    return found


def bind_screen_knowledge(data, spec=None):
    """Pin the pack revision a screen-behavior case derives from."""
    pack = latest_knowledge_pack(spec)
    data['knowledge_binding'] = {key: pack[key] for key in ('pack_id', 'version', 'content_hash')}
    return data['knowledge_binding']


def next_backflow_id(data):
    used = {row['id'] for row in data.get('issues', []) or []}
    for number in range(1, 1000):
        name = f'BF-{number:02}'
        if name not in used:
            return name
    raise ValueError('too many backflows on one artifact')


def blank_for(shape):
    """An empty value of the shape's type, for a field a backflow has nothing to say about.

    An Optional field is simply absent — declaring an empty one would assert a ticket or a
    resolution the backflow does not have.
    """
    if isinstance(shape, list):
        return []
    if isinstance(shape, dict):
        return {key: blank_for(child) for key, child in shape.items()
                if not isinstance(child, planning_context.Optional)}
    if isinstance(shape, tuple):
        return shape[0]
    return {str: '', bool: False, int: 0}.get(shape, '')


def backflow_issue(stage, issue_id, question, reason, areas):
    """A backflow in the issue shape of the stage that records it.

    Every stage declares its own issue fields, and an issue missing them makes the whole
    artifact invalid — which would stop the derivation this command exists to let continue.
    """
    shape = getattr(stage_module(stage), 'SHAPE', {}).get('issues', [{}])[0]
    issue = blank_for(shape)
    issue.update(id=issue_id, question=question, blocking=True, reason=reason,
                 action={'kind': 'wait', 'prompt': ''})
    if 'areas' in shape:
        issue['areas'] = list(areas)
    return issue


def example_table(stage):
    """What the comparison example ids cited beside the criteria actually are."""
    return dict(getattr(stage_module(stage), 'EXAMPLE_DEFINITIONS', {}))


def criterion_table(stage):
    """What each qualitative criterion id asks, for the stage that uses it.

    Reviewers cite these in every assessment and the validator checks the ids are in the list.
    For four of five stages no table said what the ids meant, so a reviewer could cite a
    criterion nobody could read. The definitions live next to the list they are checked
    against so the two cannot drift.
    """
    return dict(getattr(stage_module(stage), 'CRITERION_DEFINITIONS', {}))


def handoff_due(session, stage):
    """Two triggers: a blocking ticket was closed, or an interview moved too many bytes.

    It used to fire on any closed ticket, and closing tickets is what grilling does — probe
    three times, mark it a hypothesis, close it. One eleven-question case wrote twelve handoff
    notes and eleven handed nothing to anyone, which leaves the signal permanently on and
    indistinguishable from a real one.

    The byte budget applies everywhere — a long session is long whatever stage it is in — but
    the number had not moved since artifacts were small. A derived artifact is written whole
    and the smallest stage-2 document in this repo is 60KB, so at 30,000 the signal was on
    from the first save and said nothing about the session.
    """
    if session.get('handed_off'):
        return False
    if session.get('closed_blocking_since_handoff'):
        return True
    return session.get('work_bytes', 0) >= HANDOFF_BUDGET


def refresh_blocks_exit(stage):
    """Must a context refresh precede leaving this stage?

    The guard exists so a fresh service check comes before the next interview question. A
    derived stage asks none, so it has nothing to guard there — and demanding one was
    expensive: clearing it means bumping `checked_at`, which lives inside the fingerprint, so
    a finished and confirmed stage had to be broken and re-confirmed to move on.
    """
    return stage not in DERIVED_STAGES


def carry_question_counts(stage, stored, draft):
    """Keep the counts of questions actually spent, whichever stage is counting.

    `ask` writes the count into the artifact and `save --draft` replaces the artifact whole,
    so the prescribed way of saving erased it — ten QA runs found probe counts sitting at one
    after three questions. A count is session bookkeeping, never content (it is already
    excluded from the fingerprint), so the stored value always wins: a draft can neither
    forget a question that was asked nor claim one that was not.

    That was fixed for the job stage's `probe_count` and not for the prd's
    `discovery.questions_asked`, which counts the same thing one stage down — and a test was
    written asserting the second one stayed broken. A fresh run found a case whose two-question
    budget read zero after thirteen turns. The rule is the same for both; so is the code now.
    """
    if stage == 'jtbd' and isinstance(draft.get('issues'), list):
        counts = {row['id']: row.get('probe_count', 0)
                  for row in stored.get('issues', []) or [] if isinstance(row, dict)}
        for row in draft['issues']:
            if isinstance(row, dict) and row.get('id') in counts:
                row['probe_count'] = counts[row['id']]
    if stage == 'prd' and isinstance(draft.get('discovery'), dict):
        spent = (stored.get('discovery') or {}).get('questions_asked')
        if isinstance(spent, int):
            draft['discovery']['questions_asked'] = spent
    return draft


# The old name, kept because the class it names is the point: any counter the controller
# writes and a draft replaces.
carry_probe_counts = carry_question_counts


def require_recorded_decision(folder, manifest):
    """The decision a question manifest names has to exist, like every other reference in it."""
    decisions = read_journal(folder / 'evidence/decisions.jsonl')
    decision = next((row for row in decisions if row['id'] == manifest['decision_id']), None)
    if decision is None:
        raise ValueError(f"question manifest names decision {manifest['decision_id']!r}, "
                         'which has not been recorded; run record-decision first')
    return decision


def apply_derived_ownership(report, stage, data):
    """Record whether a derived stage kept its hands off the planner's decisions.

    A `recommended` or `planner_required` row is not wrong on its own; it means this
    case was not derived, and the plan's backflow never happened.
    """
    if stage not in DERIVED_STAGES:
        return report
    import screen_behavior
    gaps = screen_behavior.derived_ownership_gaps(data)
    report['derived_ownership_gaps'] = gaps
    report['derived'] = not gaps
    return report

MAP_BUDGET = 9000
# p93 of 72 patch emissions replayed from four stored cases; a backstop, not the main boundary.
# Measured against the ten QA runs: one derived-stage save is 60-96KB, so a budget below
# that fires before any work is done. This lets a session finish one stage's worth and asks
# for a handoff when it starts on a second.
HANDOFF_BUDGET = 200000
EXCERPT_LIMIT = 1000
PATCH_FORBIDDEN = ('schema_version', 'case_id', 'status', 'confirmation', 'input_binding')
# 3단계의 큰 것은 전부 배열이라 `[0]`을 못 가리키면 바이트 예산용 patch가 실효가 없다 —
# 한 주행이 565KB를 재전송하면서 세 번 같은 자리에서 막혔다. 자리를 세는 걸음을 더한다.
POINTER_STEP = re.compile(r'\.([A-Za-z_][A-Za-z0-9_]*)|\[id=([^\[\]]+)\]|\[(\d+)\]')

QUESTION_INTENTS = {
    'jtbd': {'situation', 'motivation', 'outcome', 'success', 'subject', 'cell'},
    'prd': {'solution', 'scope', 'rules'},
    'planning_context': {'problem', 'goal', 'users', 'solution', 'scope', 'rules', 'success'},
    'user_experience': {'journey', 'state', 'branch', 'exception', 'recovery', 'view_requirement'},
    'screen_behavior': {'screen', 'element', 'interaction', 'focus', 'async', 'error', 'recovery'},
    'design_system_wireframe': {'visual_hierarchy', 'component', 'token', 'visual_exception'},
}


def stage_module(stage):
    if stage == 'screen_behavior':
        import screen_behavior
        return screen_behavior
    if stage == 'design_system_wireframe':
        import design_system_wireframe
        return design_system_wireframe
    return {'jtbd': jtbd, 'prd': prd, 'planning_context': planning_context,
            'user_experience': user_experience}[stage]


def artifact_path(folder, stage):
    return folder / ARTIFACT_NAMES[stage]


def validate_artifact(stage, data, path=None):
    if stage == 'design_system_wireframe':
        return stage_module(stage).validate(data, path)
    return stage_module(stage).validate(data)


def validate_case_artifact(folder, stage, data):
    return validate_artifact(stage, data, artifact_path(folder, stage))


def artifact_fingerprints(stage, data):
    return stage_module(stage).fingerprints(data)


def render_artifact(stage, data, report):
    return stage_module(stage).render(data, report)


def checked_at(stage, data):
    if stage == 'design_system_wireframe':
        return ''
    if stage == 'prd':
        # The prd binds the job it derived from, so the job's check time is its own. It used
        # to report observed_revision here, which is an epic id — newer_context then parsed a
        # revision as ISO 8601 and every save after a resume died on it.
        return data['input_binding'].get('checked_at', '')
    return data['service_context' if stage in ('jtbd', 'planning_context')
                else 'evidence_status']['checked_at']


def empty_confirmation(stage):
    return dict(WIREFRAME_EMPTY_CONFIRMATION if stage == 'design_system_wireframe' else EMPTY_CONFIRMATION)


def file_hash(path):
    import hashlib
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def latest_knowledge_pack(spec=None):
    import design_system_wireframe
    if spec:
        raw = Path(spec)
        pack_path = raw if raw.suffix == '.json' else WORKSPACE_ROOT / 'design-knowledge' / raw / 'pack.json'
        if not pack_path.is_absolute():
            pack_path = (WORKSPACE_ROOT / pack_path).resolve()
    else:
        candidates = sorted((WORKSPACE_ROOT / 'design-knowledge').glob('*/*/pack.json'))
        if not candidates:
            raise ValueError('no design knowledge pack found')
        pack_path = candidates[-1]
    pack = load_json(pack_path)
    try:
        relative = pack_path.relative_to(WORKSPACE_ROOT / 'design-knowledge')
    except ValueError as exc:
        raise ValueError('knowledge pack must live under design-knowledge') from exc
    if len(relative.parts) != 3 or relative.name != 'pack.json':
        raise ValueError('knowledge pack path must be design-knowledge/<pack-id>/<version>/pack.json')
    return {
        'pack_id': relative.parts[0],
        'version': relative.parts[1],
        'content_hash': design_system_wireframe.knowledge_pack_fingerprint(pack_path),
        'source_revisions': [pack.get('version', '/'.join(relative.parts[:2]))],
    }


def next_wireframe_run_id(folder, target_id):
    base = 'run-' + re.sub(r'[^a-z0-9]+', '-', target_id.lower()).strip('-')
    runs = folder / 'evidence/design-runs'
    for index in range(1, 10000):
        run_id = f'{base}-{index:04}'
        if not (runs / run_id).exists():
            return run_id
    raise ValueError('too many wireframe runs for target ' + target_id)


def write_wireframe_stage_inputs(folder, source_path, source, knowledge_binding, previous_targets=None):
    import wireframe_run
    return wireframe_run.prepare_stage_inputs(folder, source_path, source, knowledge_binding, previous_targets)


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


def question_manifest(path, stage, data, question_text=None, decision_id=None):
    manifest = load_json(path)
    expected = {'stage', 'intent', 'issue_id', 'evidence_ids', 'decision_id', 'question_text'}
    if not isinstance(manifest, dict) or set(manifest) != expected:
        raise ValueError('question manifest requires stage, intent, issue_id, evidence_ids, decision_id and question_text')
    if manifest['stage'] != stage:
        raise ValueError(f'question stage {manifest["stage"]} does not match session stage {stage}')
    if manifest['intent'] not in QUESTION_INTENTS[stage]:
        raise ValueError(f'question intent {manifest["intent"]} is not allowed for stage '
                         f'{stage}; expected one of {QUESTION_INTENTS[stage]}')
    if not isinstance(manifest['issue_id'], str) or not manifest['issue_id'].strip():
        raise ValueError('question manifest requires a nonempty issue_id')
    if not isinstance(manifest['evidence_ids'], list) or len(manifest['evidence_ids']) != len(set(manifest['evidence_ids'])):
        raise ValueError('question manifest requires unique evidence_ids')
    issues = {issue['id'] for issue in data.get('issues', [])}
    if manifest['issue_id'] not in issues:
        raise ValueError('question manifest contains unknown issue_id')
    sources = {source['id'] for source in data.get('sources', [])}
    if any(not isinstance(source_id, str) or source_id not in sources for source_id in manifest['evidence_ids']):
        raise ValueError('question manifest contains unknown evidence_ids')
    if not isinstance(manifest['decision_id'], str) or not manifest['decision_id'].strip():
        raise ValueError('question manifest requires a nonempty decision_id')
    if not isinstance(manifest['question_text'], str) or not manifest['question_text'].strip():
        raise ValueError('question manifest requires a nonempty question_text')
    if decision_id and manifest['decision_id'] != decision_id:
        raise ValueError('question manifest decision_id does not match --decision-id')
    if question_text is not None and manifest['question_text'] != question_text:
        raise ValueError('question manifest question_text does not match --text-file')
    return manifest


def excerpt_gaps(previous, candidate):
    """New or changed sources must cite the facts, not paste the raw material."""
    previous_excerpts = {row['id']: row.get('excerpt', '')
                         for row in previous.get('sources', []) or [] if isinstance(row, dict)}
    gaps = []
    for row in candidate.get('sources', []) or []:
        if not isinstance(row, dict):
            continue
        excerpt = row.get('excerpt', '') or ''
        if len(excerpt) <= EXCERPT_LIMIT or previous_excerpts.get(row.get('id')) == excerpt:
            continue
        gaps.append(f"$.sources[id={row.get('id')}].excerpt: {len(excerpt)} characters exceed the "
                    f'{EXCERPT_LIMIT} character limit; cite the facts needed by this stage and '
                    'reference the original by path and revision')
    return gaps


def pointer_steps(pointer, writable=True):
    """Parse the small pointer grammar: $.key, $.key.other, $.key[id=VALUE]."""
    if not isinstance(pointer, str) or not pointer.startswith('$'):
        raise ValueError('pointer must start with $')
    steps, position = [], 1
    for match in POINTER_STEP.finditer(pointer):
        if match.start() != position:
            break
        if match.group(1) is not None:
            steps.append(('key', match.group(1)))
        elif match.group(2) is not None:
            steps.append(('id', match.group(2)))
        else:
            steps.append(('index', int(match.group(3))))
        position = match.end()
    if position != len(pointer) or not steps:
        raise ValueError(f'pointer has unsupported syntax at {pointer[position:]!r}')
    if steps[0][0] != 'key':
        raise ValueError('pointer must start at a named field')
    if writable and steps[0][1] in PATCH_FORBIDDEN:
        raise ValueError(f'patch may not write $.{steps[0][1]}; '
                         'approval, binding and format changes use their own commands')
    return steps


def pointer_parent(data, steps):
    """Walk to the container holding the final step; never create missing nodes."""
    node = data
    for kind, name in steps[:-1]:
        if kind == 'key':
            if not isinstance(node, dict) or name not in node:
                raise ValueError(f'pointer does not resolve: no field {name!r}')
            node = node[name]
        elif kind == 'index':
            if not isinstance(node, list):
                raise ValueError(f'index selector [{name}] requires a list')
            if name >= len(node):
                raise ValueError(f'index selector [{name}] is past the end ({len(node)} rows)')
            node = node[name]
        else:
            if not isinstance(node, list):
                raise ValueError(f'id selector {name!r} requires a list')
            matches = [row for row in node if isinstance(row, dict) and row.get('id') == name]
            if len(matches) != 1:
                raise ValueError(f'id selector {name!r} matched {len(matches)} rows')
            node = matches[0]
    return node


def optional_roots(stage):
    """Top-level fields the stage schema already declares but an artifact may lack."""
    shape = getattr(stage_module(stage), 'SHAPE', None) or {}
    return {key for key, child in shape.items() if isinstance(child, planning_context.Optional)}


def apply_pointer(data, pointer, value=None, append=False, delete=False, creatable=()):
    """Return the candidate with one scoped change applied."""
    candidate = json.loads(json.dumps(data))
    steps = pointer_steps(pointer)
    parent = pointer_parent(candidate, steps)
    kind, name = steps[-1]
    if kind == 'key':
        if not isinstance(parent, dict):
            raise ValueError(f'field selector {name!r} requires an object')
        if name not in parent:
            if len(steps) != 1 or name not in creatable:
                raise ValueError(f'patch cannot create the new field {name!r}')
            parent[name] = [] if append else None
        if delete:
            raise ValueError('patch deletes list elements, not declared fields')
        if append:
            if not isinstance(parent[name], list):
                raise ValueError(f'append requires a list at {name!r}')
            parent[name].extend(value if isinstance(value, list) else [value])
        else:
            parent[name] = value
    elif kind == 'index':
        if not isinstance(parent, list):
            raise ValueError(f'index selector [{name}] requires a list')
        if name >= len(parent):
            raise ValueError(f'index selector [{name}] is past the end ({len(parent)} rows)')
        if append:
            raise ValueError('append targets a list, not a single element')
        if delete:
            parent.pop(name)
        else:
            parent[name] = value
    else:
        if not isinstance(parent, list):
            raise ValueError(f'id selector {name!r} requires a list')
        positions = [n for n, row in enumerate(parent)
                     if isinstance(row, dict) and row.get('id') == name]
        if len(positions) != 1:
            raise ValueError(f'id selector {name!r} matched {len(positions)} rows')
        if append:
            raise ValueError('append targets a list, not a single element')
        if delete:
            parent.pop(positions[0])
        else:
            parent[positions[0]] = value
    return candidate


def read_pointer(data, pointer):
    """Resolve a pointer for reading; reads may reach fields writes may not."""
    steps = pointer_steps(pointer, writable=False)
    parent = pointer_parent(data, steps)
    kind, name = steps[-1]
    if kind == 'key':
        if not isinstance(parent, dict) or name not in parent:
            raise ValueError(f'pointer does not resolve: no field {name!r}')
        return parent[name]
    if not isinstance(parent, list):
        raise ValueError(f'selector {name!r} requires a list')
    if kind == 'index':
        if name >= len(parent):
            raise ValueError(f'index selector [{name}] is past the end ({len(parent)} rows)')
        return parent[name]
    matches = [row for row in parent if isinstance(row, dict) and row.get('id') == name]
    if len(matches) != 1:
        raise ValueError(f'id selector {name!r} matched {len(matches)} rows')
    return matches[0]


def row_index(data):
    """Map every id-bearing row to its collection, so references can be followed."""
    index = {}
    for field, rows in data.items():
        if isinstance(rows, list):
            for row in rows:
                if isinstance(row, dict) and isinstance(row.get('id'), str):
                    index.setdefault(row['id'], (field, row))
        elif isinstance(rows, dict) and rows and all(isinstance(v, dict) for v in rows.values()):
            # Named containers such as planning areas key their rows instead of carrying an id.
            for name, row in rows.items():
                index.setdefault(name, (field, row))
    return index


def referenced_ids(value):
    """Collect the id-like strings a row cites, without guessing at field names."""
    found = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key == 'id':
                continue
            found.extend(referenced_ids(item))
    elif isinstance(value, list):
        for item in value:
            found.extend(referenced_ids(item))
    elif isinstance(value, str):
        found.append(value)
    return found


def evidence_for(data, seed, hops=3):
    """Follow references out of a seed row and return what they reach, by collection."""
    index = row_index(data)
    seen, frontier, reached = set(), [seed], {}
    for _ in range(max(hops, 0)):
        nxt = []
        for row in frontier:
            for name in referenced_ids(row):
                if name in seen or name not in index:
                    continue
                seen.add(name)
                field, found = index[name]
                reached.setdefault(field, []).append(found)
                nxt.append(found)
        frontier = nxt
        if not frontier:
            break
    return reached


def coverage_cell(data, cell):
    """Return one coverage slot and the obligations it points at."""
    if ':' not in cell:
        raise ValueError('cell selector is SCOPE:DIMENSION, e.g. open:actor_permission')
    scope, dimension = cell.split(':', 1)
    checks = [row for row in data.get('coverage_checks', []) or []
              if row.get('dimension') == dimension
              and row.get('transition_id', row.get('scope_id')) == scope]
    if len(checks) != 1:
        raise ValueError(f'cell {cell!r} matched {len(checks)} coverage checks')
    wanted = set(checks[0].get('obligation_ids') or [])
    return {'check': checks[0],
            'obligations': [row for row in data.get('coverage_obligations', []) or []
                            if row.get('id') in wanted]}


def show(folder, session, data, args):
    """Read one slice instead of the whole artifact."""
    selectors = [name for name in ('pointer', 'issue', 'cell', 'frontier', 'decisions')
                 if getattr(args, name, None)]
    if len(selectors) != 1:
        raise ValueError('show takes exactly one of --pointer, --issue, --cell, --frontier, --decisions')
    result = {'case_path': str(folder), 'stage': session['stage'], 'selector': selectors[0]}
    if args.pointer:
        result.update(pointer=args.pointer, value=read_pointer(data, args.pointer))
    elif args.issue:
        issues = {row['id']: row for row in data.get('issues', []) or []}
        if args.issue not in issues:
            raise ValueError(f'unknown issue {args.issue!r}')
        result['issue'] = issues[args.issue]
        if args.with_evidence:
            result['evidence'] = evidence_for(data, issues[args.issue])
    elif args.cell:
        result.update(cell=args.cell, **coverage_cell(data, args.cell))
    elif args.frontier:
        report = view(folder, session, data)
        issues = {row['id']: row for row in data.get('issues', []) or []}
        result.update(phase=report['phase'], can_yield=report['can_yield'],
                      frontier=report['required_actions'], blocked=report['blocked'])
    else:
        rows = read_journal(folder / 'evidence/decisions.jsonl')
        result['decisions'] = [{key: row.get(key) for key in
                                ('id', 'at', 'interview_stage', 'stage', 'outcome', 'reason')}
                               for row in rows]
    result['bytes'] = len(json.dumps(result, ensure_ascii=False))
    return result


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
    evidence = data.get('evidence_status')
    if evidence is not None and not any(
        sources[source_id]['provider'] == 'platty'
        and sources[source_id].get('project_id') == evidence.get('project_id')
        and sources[source_id].get('revision') == evidence.get('observed_revision')
        for source_id in source_ids
    ):
        raise ValueError('decision context requires current Platty evidence for the observed project revision')
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
    if full and session['stage'] == 'screen_behavior':
        details = folder / 'screen-behavior-details.md'
        details.write_text(stage_module(session['stage']).render(data), encoding='utf-8')
        body = stage_module(session['stage']).render_confirmation(data, str(details.resolve()))
    elif full:
        body = render_full_model(data)
    else:
        body = render_progress(data, packet_id, previous,
            situation=context.get('diagram_situation', ''), question=context.get('diagram_question', ''))
    reference = f"evidence/progress/{len(session['entries']) + 1:05}.json"
    atomic_json(folder / reference, data)
    (folder / PROGRESS_NAMES.get(session['stage'], 'user-experience-progress.md')).write_text(body, encoding='utf-8')
    return body, reference


SESSION_DEFAULTS = {'work_bytes': 0, 'closed_since_handoff': [],
                    'closed_blocking_since_handoff': [], 'handed_off': False,
                    'confirmation_voided_by': ''}


def load_case(folder):
    session = load_json(folder / 'session.json')
    if session.get('version') != 1 or session.get('stage') not in ARTIFACT_NAMES:
        raise ValueError('unsupported session version or interview stage')
    for key, default in SESSION_DEFAULTS.items():
        session.setdefault(key, copy.deepcopy(default))
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


def unrecorded_interview_gaps(session, data):
    """An interview that asked and answered, and an artifact carrying none of the answers.

    The grilling reads `sources[].excerpt` where the provider is the planner. Nothing ever
    required such a source to exist, so the check is silently inert whenever the executor
    summarised instead of quoting. Counted across thirty recorded runs: four artifacts carry
    zero planner quotes after eight to fifteen answered turns, and many of the rest carry two
    or three of fifteen.

    Zero is the only case with no defensible reading — the job was built on words nobody can
    read back — so that is where the line is, and no ratio is invented above it.
    """
    if not interview_allowed(session.get('stage')):
        return []
    # 세는 쪽은 세션 전체, 보는 쪽은 현 단계 산출물이었다. 그래서 1b에 들어가는 거의 모든
    # 케이스에서 「n번 답했는데 하나도 안 남았다」가 떴고 — 서른 건 중 스무 건 — 한 실행기가
    # 「1a 답변을 1b에 복사하도록 유도한다」고 적었다. 오탐을 넘어 중복을 만들라고 미는 검사였다.
    stage = session.get('stage')
    answered = [entry for entry in session.get('entries', [])
                if entry.get('role') == 'user' and entry.get('kind') == 'answer'
                and entry.get('interview_stage', stage) == stage]
    if not answered:
        return []
    if any(row.get('provider') == 'user' for row in data.get('sources', []) or []):
        return []
    return [f'$.sources: 이 단계에서 기획자가 {len(answered)}번 답했는데 그 말이 이 단계의 '
            'provider: user 출처로 하나도 남지 않았다 — 그릴링 검사가 읽을 원문이 없고, '
            '여기서 내린 판단이 무엇 위에 섰는지 되읽을 수 없다']


def receipt_reference_gaps(folder, session, data):
    """Make `simulated-receipt:<id>` and `--mode simulation` mean something.

    The runbook told executors to point a simulated Platty source at the receipt `record-tool`
    stamped. Nothing checked it: a replayed run swapped in an entry id that does not exist and
    still went `valid/ready/complete`.

    This only reaches sources that say they are simulated. Demanding the same of every
    `provider: platty` source in a simulation session was measured and dropped: it fires on
    seven sources across the ten replays (right) and on ten fixture-built tests (fixture
    convenience, not a finding), and satisfying it would move the fabrication one level down
    into a receipt. G-5 stays open in qa-findings.md with that number.
    """
    sources = data.get('sources') or []
    if not sources:
        return []
    recorded = {row['id']: row for row in read_journal(folder / 'evidence/tool-events.jsonl')}
    simulated = session.get('mode') == 'simulation'
    gaps = []
    for number, source in enumerate(sources):
        reference = (source.get('reference') or '').strip()
        path = f'$.sources[{number}].reference'
        if reference.startswith('simulated-receipt:'):
            # A trailing note (「…에서 이어짐」) is allowed; the id is the first token.
            name = reference.split(':', 1)[1].split()[0] if reference.split(':', 1)[1].split() else ''
            event = recorded.get(name)
            if event is None:
                gaps.append(f'{path}: {name or "(비어 있음)"}는 이 케이스의 record-tool 영수증이 '
                            '아니다 — 모의 조회를 먼저 기록하고 그 entry id를 적는다')
            elif not simulated:
                gaps.append(f'{path}: live 세션이 모의 영수증을 근거로 든다')
            elif not (str(event['receipt'].get('tool', '')).startswith('simulated:')
                      or (event['receipt'].get('result') or {}).get('simulated')):
                gaps.append(f'{path}: {name}는 모의 조회가 아니다 — 실제 호출을 '
                            'simulated-receipt로 인용하면 무엇이 모의인지 사라진다')
    return gaps


def planner_selection_gaps(folder, session, data):
    """Bind selected screen decisions to the actual question and answer in this session."""
    if session['stage'] != 'screen_behavior' or data.get('schema_version') != 3:
        return []
    entries = {entry['id']: entry for entry in session['entries']}
    sources = {source['id']: source for source in data['sources']}
    packets = {packet['id']: packet for packet in data['decision_packets']}
    gaps = []
    for row in data['decision_inventory']:
        if row['classification'] not in ('recommended', 'planner_required') or row['status'] != 'selected':
            continue
        packet = packets.get(row['decision_packet_id'], {})
        source_id = packet.get('selection', {}).get('user_source_id')
        source = sources.get(source_id, {})
        reference = source.get('reference', '')
        prefix = 'session.json#'
        answer_id = reference[len(prefix):] if reference.startswith(prefix) else ''
        answer = entries.get(answer_id, {})
        question = entries.get(answer.get('reply_to'), {})
        asked_packet = None
        snapshot_ref = question.get('progress_snapshot', '')
        try:
            snapshot_path = (folder / snapshot_ref).resolve()
            if not snapshot_path.is_relative_to(folder.resolve()):
                raise ValueError('snapshot outside case')
            snapshot = load_json(snapshot_path)
            asked_packet = next((item for item in snapshot.get('decision_packets', [])
                                 if item.get('id') == packet.get('id')), None)
        except (OSError, ValueError, KeyError, TypeError):
            asked_packet = None
        immutable = ('id', 'topic', 'risk', 'decision_scope', 'context_summary',
                     'recommendation', 'options', 'grouping')
        choices_unchanged = (
            asked_packet is not None
            and all(asked_packet.get(key) == packet.get(key) for key in immutable)
        )
        valid = (
            answer.get('role') == 'user'
            and answer.get('kind') == 'answer'
            and answer.get('interview_stage') == 'screen_behavior'
            and source.get('provider') == 'user'
            and source.get('excerpt') == answer.get('text')
            and question.get('role') == 'assistant'
            and question.get('kind') == 'decision'
            and question.get('interview_stage') == 'screen_behavior'
            and question.get('decision_packet_id') == packet.get('id')
            and choices_unchanged
        )
        if not valid:
            reason = ('choices shown in the saved decision question changed; ask again'
                      if answer.get('role') == 'user' and not choices_unchanged
                      else 'selected planner choice requires the actual answer to its saved decision question')
            gaps.append(f"decision_inventory.{row['id']}: {reason}")
    return gaps


ARTIFACT_STAGES = {name: stage for stage, name in ARTIFACT_NAMES.items()}


def input_binding_current(folder, data):
    """Is the upstream this artifact bound to still the upstream that exists?

    The binding names its own upstream through its single `*_path` key, so a case bound to
    a planning context and one bound to a prd are checked the same way.
    """
    try:
        binding = data['input_binding']
        key = next(name for name in binding if name.endswith('_path'))
        path = Path(binding[key])
        stage = ARTIFACT_STAGES.get(path.name)
        if stage is None or path != (folder / path.name).resolve():
            return False
        source = load_json(path)
        module = stage_module(stage)
        if not module.validate(source)['complete']:
            return False
        content_hash, review_hash = module.fingerprints(source)
        if (binding['content_hash'] != content_hash
                or binding['review_hash'] != review_hash
                or binding['confirmation_turn_id'] != source['confirmation']['turn_id']):
            return False
        # The binding pins the project and revision; where those live depends on the upstream.
        if 'service_context_project_id' in binding:
            context = source.get('service_context') or source['input_binding']
            return (binding['service_context_project_id'] == context['project_id']
                    and binding['service_context_revision'] == context['observed_revision'])
        return True
    except (OSError, ValueError, KeyError, TypeError, StopIteration):
        return False


def inventory_checkpoint_current(folder, session, data):
    if session['stage'] != 'screen_behavior' or data.get('schema_version') != 3:
        return True
    checkpoint=session.get('inventory_checkpoint') or {}
    if checkpoint.get('content_hash') != artifact_fingerprints('screen_behavior',data)[0]:
        return False
    entries={e['id']:e for e in session['entries']}
    answer=entries.get(checkpoint.get('answer_id'),{})
    question=entries.get(checkpoint.get('question_id'),{})
    if not (answer.get('role')=='user' and answer.get('kind')=='answer'
            and answer.get('reply_to')==question.get('id')
            and answer.get('interview_stage')=='screen_behavior'
            and question.get('role')=='assistant' and question.get('kind')=='inventory_confirmation'):
        return False
    try:
        snapshot=load_json(folder/question['progress_snapshot'])
        return artifact_fingerprints('screen_behavior',snapshot)[0]==checkpoint['content_hash']
    except (OSError,ValueError,KeyError,TypeError):
        return False


def view(folder, session, data):
    report = validate_case_artifact(folder, session['stage'], data)
    checkpoint_ready=True
    migration_required=session['stage']=='screen_behavior' and data.get('schema_version')==2
    report['inventory_checkpoint_ready']=checkpoint_ready
    selection_gaps = planner_selection_gaps(folder, session, data) + \
        receipt_reference_gaps(folder, session, data)
    if selection_gaps:
        report['session_decision_gaps'] = selection_gaps
        report['completion_errors'] = list(report['completion_errors']) + selection_gaps
        report['ready_for_confirmation'] = False
        report['complete'] = False
        report['planner_decisions_ready'] = False
    input_current = (
        report.get('input_ready', False) and report.get('knowledge_ready', False)
        if session['stage'] in ('screen_behavior', 'design_system_wireframe') else
        session['stage'] != 'user_experience' or input_binding_current(folder, data)
    )
    open_issues = [issue for issue in data['issues'] if not issue.get('resolution')]
    unresolved = {issue['id'] for issue in open_issues}
    def takeable(issue):
        return not (unresolved & set(issue.get('blocked_by', []) or []))
    required_actions = [
        {
            'issue_id': issue['id'],
            'question': issue['question'],
            'areas': issue.get('areas', issue.get('target_refs', [])),
            'kind': issue['action']['kind'],
            'prompt': issue['action']['prompt'],
            'reason': issue['reason'],
        }
        for issue in open_issues
        if (issue['blocking'] or issue['target'] == session['stage']) and takeable(issue)
    ]
    blocked = [{'issue_id': issue['id'], 'question': issue['question'],
                'blocked_by': sorted(unresolved & set(issue.get('blocked_by', []) or []))}
               for issue in open_issues
               if (issue['blocking'] or issue['target'] == session['stage']) and not takeable(issue)]
    should_handoff = handoff_due(session, session['stage'])
    apply_derived_ownership(report, session['stage'], data)
    if report.get('derived_ownership_gaps'):
        required_actions.insert(0, {
            'issue_id': 'derived-ownership', 'areas': ['decision_inventory'], 'kind': 'handoff',
            'prompt': '기획자 소유 결정을 상위 단계로 역류시키고 이 단계는 파생만 남긴다.',
            'reason': f"{len(report['derived_ownership_gaps'])} planner-owned rows in a derived stage",
        })
    if session['stage'] == 'screen_behavior' and report.get('decision_gaps'):
        required_actions.insert(0, {
            'issue_id': 'planner-decisions', 'areas': ['decision_inventory'],
            'kind': 'ask_user',
            'prompt': '화면별 결정 목록에서 시스템 추천과 기획자 필수 항목을 실제 선택지로 질문하고 답변을 연결한다.',
            'reason': f"{len(report['decision_gaps'])} decision ownership gaps; open={report.get('open_decision_ids', [])}",
        })
    # The grilling findings were computed into the stage report and rendered into the markdown,
    # and never reached the JSON an executor actually drives on. One replayed run concluded the
    # check catches nothing while its own artifact carried four findings; another found out
    # where they live by reading a commit message.
    interview_gaps = unrecorded_interview_gaps(session, data)
    if interview_gaps:
        required_actions.insert(0, {
            'issue_id': 'unrecorded-interview', 'areas': ['sources'], 'kind': 'ask_user',
            'prompt': '기획자가 실제로 한 말을 provider: user 출처로 남긴다. 정리한 문장이 아니라 원문이다.',
            'reason': '; '.join(interview_gaps),
        })
    # `new` 직후 job 5요소가 전부 빈 문자열인 시점부터 「기준을 판정하라」가 떴다.
    # `jtbd.py:348`이 title에 대해 같은 판단을 이미 적어 뒀다 — 「인터뷰 전이 아니라 확인 전에
    # 요구되는 것」. 판정은 판정할 내용이 있을 때 요구한다.
    if report.get('unjudged_criteria') and report.get('baseline_ready'):
        required_actions.insert(0, {
            'issue_id': 'unjudged-criteria', 'areas': ['review'], 'kind': 'review',
            'prompt': '아직 아무 판정도 인용하지 않은 기준을 읽고, 이 산출물에 대해 판단해 적는다.',
            'reason': '; '.join(report['unjudged_criteria']),
        })
    if report.get('planner_language'):
        required_actions.insert(0, {
            'issue_id': 'planner-language', 'areas': ['sources'], 'kind': 'ask_user',
            'prompt': '기획자 원문에서 일반화·해결책 선행이 보인다. 사건 하나를 되묻거나 '
                      '그 행을 가설로 표기한다.',
            'reason': '; '.join(report['planner_language']),
        })
    if session['stage'] in ('user_experience', 'screen_behavior') and report.get('verification_gaps'):
        required_actions.append({
            'issue_id': 'experience-verification', 'areas': ['branch_coverage'],
            'kind': 'review', 'prompt': '검토 슬롯·실제 경로·정책 적용을 검토하고, FACT는 조회·PRODUCT는 질문 이슈로 연결한다.',
            'reason': f"{len(report['verification_gaps'])} verification gaps; see validation.verification_gaps",
        })
    if session['stage'] == 'design_system_wireframe' and not report['ready_for_confirmation']:
        required_actions.append({
            'issue_id': 'wireframe-engine',
            'areas': ['targets', 'wireframes', 'evidence/design-runs'],
            'kind': 'handoff',
            'prompt': '현재 brief/packet/traceability를 기준으로 HTML/CSS/JS를 생성하고 브라우저 검사, 캡처, 이미지 검토를 실행한 뒤 design-system-wireframe.json을 갱신한다.',
            'reason': 'renderer, runtime checks, captures, component/token mappings, qualitative review, or planner confirmation are not complete.',
        })
    closed_now = session.get('closed_since_handoff') or []
    handoff_reason = ('닫은 티켓 ' + ', '.join(closed_now) if closed_now else
                      f"이 세션이 옮긴 {session.get('work_bytes', 0):,} B가 예산 {HANDOFF_BUDGET:,} B를 넘었다"
                      if should_handoff else '')
    if not input_current:
        required_actions.insert(0, {
            'issue_id': 'input-binding', 'areas': ['input_binding'], 'kind': 'handoff',
            'prompt': '선행 인터뷰의 변경 내용을 다시 검토·확인한 뒤 현재 단계를 재시작한다.',
            'reason': '참조한 선행 인터뷰 내용·평가·확인 또는 서비스 revision이 달라졌다.',
        })
    if migration_required:
        phase='migration_required'
        required_actions=[{'issue_id':'migration-required','kind':'migration','areas':['schema_version'],
            'prompt':'schema 2는 읽기 전용입니다. 명시적인 schema 3 마이그레이션이 필요합니다.','reason':'Legacy screen workflow cannot actively progress'}]
    elif (folder / 'evidence/pending-operation.json').exists() and not _ACTIVE_OPERATION:
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
        phase = {'jtbd': 'start_prd', 'prd': 'start_user_experience',
                 'planning_context': 'start_user_experience',
                 'user_experience': 'start_screen_behavior',
                 'screen_behavior': 'start_design_system_wireframe'}.get(session['stage'], 'complete')
    elif session['pending']:
        phase = 'awaiting_confirmation' if session['pending']['kind'] == 'confirmation' else 'awaiting_answer'
    elif should_handoff:
        phase = 'handoff_due'
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
    if phase == 'start_prd':
        required_actions.append({'issue_id': 'stage-transition', 'areas': ['solution'],
                                 'kind': 'start', 'stage': 'prd',
                                 'prompt': '같은 턴에서 start --stage prd를 실행하고 §4 해결 방향부터 이어간다.',
                                 'reason': 'JTBD 확인 완료; 판단은 옮겨졌고 해결 방향만 남았다.'})
    if phase == 'start_user_experience':
        required_actions.append({'issue_id': 'stage-transition', 'areas': ['solution'],
                                 'kind': 'start', 'stage': 'user_experience', 'prompt': '같은 턴에서 start --stage user_experience를 실행하고 사용자 경험 설계 현재 경험 조회와 첫 질문을 진행한다.',
                                 'reason': '기획 맥락 정의 확인 완료; 추가 진행 승인 없이 사용자 경험 설계로 이어간다.'})
    if phase == 'start_screen_behavior':
        required_actions.append({'issue_id': 'stage-transition', 'areas': ['screens'],
                                 'kind': 'start', 'stage': 'screen_behavior', 'prompt': '같은 턴에서 start --stage screen_behavior를 실행하고 화면·요소 근거 조회와 필요한 질문을 진행한다.',
                                 'reason': '사용자 경험 설계 확인 완료; 화면 동작 명세으로 이어간다.'})
    if phase == 'start_design_system_wireframe':
        required_actions.append({'issue_id': 'stage-transition', 'areas': ['wireframes'],
                                 'kind': 'start', 'stage': 'design_system_wireframe',
                                 'prompt': '같은 턴에서 start --stage design_system_wireframe를 실행하고 화면별 brief/packet/traceability를 준비한 뒤 HTML/CSS/JS 생성과 브라우저 검증을 진행한다.',
                                 'reason': '화면 동작 명세 확인 완료; 디자인 시스템 와이어프레임으로 이어간다.'})
    # A recorded handoff ends the session without pretending the remaining work is gone.
    can_yield = bool(session.get('handed_off')) or phase in (
        'awaiting_answer', 'awaiting_confirmation', 'waiting', 'paused', 'complete')
    yield_reason = {
        'awaiting_answer': 'waiting for the user to answer the saved interview question',
        'awaiting_confirmation': 'waiting for the user to confirm the saved final summary',
        'waiting': 'blocked by an external capability or fact with a recorded resume condition',
        'paused': 'paused at the user request',
        'handoff_due': 'a handoff note is required before this session can end; run handoff',
        'complete': session['stage'].replace('_', ' ') + ' is validated and confirmed',
    }.get(phase, 'the workflow still has work it can perform before yielding')
    if session.get('handed_off') and phase not in ('awaiting_answer', 'awaiting_confirmation',
                                                   'waiting', 'paused', 'complete'):
        yield_reason = 'this session recorded a handoff note; the next one re-enters with status --map'
    preparing = ('히로인스 현재 경험 맥락을 확인하고 있습니다.' if session['stage'] == 'user_experience'
                 else '디자인 지식 팩과 화면 동작 입력을 확인하고 있습니다.' if session['stage'] == 'design_system_wireframe'
                 else '히로인스 기본 맥락을 확인하고 있습니다.')
    complete_text = {'jtbd': 'JTBD 정의', 'prd': 'PRD 정의',
                     'planning_context': '기획 맥락 정의',
                     'user_experience': '사용자 경험 설계',
                     'screen_behavior': '화면 동작 명세',
                     'design_system_wireframe': '디자인 시스템 와이어프레임'}[session['stage']] + ' 검증과 사용자 확인이 완료되었습니다.'
    user_status = {
        'migration_required': '기존 화면 명세는 읽기 전용입니다. schema 3 마이그레이션이 필요합니다.',
        'prepare_context': preparing,
        'process_answer': '방금 답변을 분석하고 결과를 갱신해야 합니다.',
        'action_required': '확인해야 할 조회 또는 판단이 남아 있습니다.',
        'interviewing': '다음 질문 또는 조회를 선택해야 합니다.',
        'ready_for_confirmation': '전체 요약을 사용자에게 확인받을 준비가 되었습니다.',
        'awaiting_answer': '저장된 인터뷰 질문에 대한 사용자 답변을 기다리고 있습니다.',
        'awaiting_confirmation': '전체 요약에 대한 사용자 확인을 기다리고 있습니다.',
        'waiting': '외부 확인 또는 접근 조건이 충족될 때까지 보류 중입니다.',
        'paused': '사용자 요청으로 인터뷰가 중단되었습니다.',
        'handoff_due': '이 세션은 여기서 끝내야 합니다. handoff 로 인계장을 남기세요.',
        'complete': complete_text,
        'start_prd': 'JTBD 확인이 완료되어 PRD 정의를 바로 시작해야 합니다.',
        'start_user_experience': '기획 맥락 정의 확인이 완료되어 사용자 경험 설계를 바로 시작해야 합니다.',
        'start_screen_behavior': '사용자 경험 설계 확인이 완료되어 화면 동작 명세을 바로 시작해야 합니다.',
        'start_design_system_wireframe': '화면 동작 명세 확인이 완료되어 디자인 시스템 와이어프레임을 바로 시작해야 합니다.',
        'input_stale': '선행 인터뷰 입력이 변경되어 다시 확인해야 합니다.',
        'logging_failed': '실행 기록 저장을 복구해야 합니다. 이전 동작을 반복 실행하지 않습니다.',
    }[phase]
    return {'case_path': str(folder.resolve()), 'stage': session['stage'], 'mode': session['mode'],
            'phase': phase, 'migration_required':migration_required, 'inventory_checkpoint':session.get('inventory_checkpoint'), 'refresh_required': session['refresh_required'],
            'input_current': input_current,
            'pending': session['pending'], 'last_user': last_user(session),
            'answered_question': session['answered_question'], 'required_actions': required_actions,
            'can_yield': can_yield, 'yield_reason': yield_reason, 'user_status': user_status,
            'blocked': blocked, 'fog': data.get('fog', []), 'out_of_scope': data.get('out_of_scope', []),
            'retired_stage': session['stage'] in RETIRED_STAGES,
            'should_handoff': should_handoff, 'handoff_reason': handoff_reason,
            'handed_off': bool(session.get('handed_off')),
            'work_bytes': session.get('work_bytes', 0),
            'validation': report,
            'next_stage': {'start_prd': 'prd_ready', 'start_user_experience': 'user_experience_ready', 'start_screen_behavior': 'screen_behavior_ready',
                           'start_design_system_wireframe': 'design_system_wireframe_ready',
                           'action_required': 'wireframe_engine_work',
                           'complete': 'complete'}.get(phase)}


STAGE_LABELS = {'jtbd': 'JTBD 정의', 'prd': 'PRD 정의',
                'planning_context': '기획 맥락 정의',
                'user_experience': '사용자 경험 설계',
                'screen_behavior': '화면 동작 명세', 'design_system_wireframe': '디자인 시스템 와이어프레임'}


def destination(folder, data):
    """The whole case's goal, from whichever upstream stage recorded it."""
    title = data.get('title', '') or ''
    sought = (('planning_context', ('areas', 'business_goal', 'summary')),
              ('jtbd', ('job', 'expected_outcome')))
    for stage, keys in sought:
        path = folder / ARTIFACT_NAMES[stage]
        if not path.exists():
            continue
        try:
            found = load_json(path)
            for key in keys:
                found = found[key]
            if found.strip():
                return title, found.strip()
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            continue
    return title, ''


def settled(folder, session, data):
    """One line per decision already made: confirmed stages, then closed tickets."""
    lines = []
    for stage, name in STAGE_LABELS.items():
        path = folder / ARTIFACT_NAMES[stage]
        if stage == session['stage'] or not path.exists():
            continue
        try:
            confirmation = load_json(path).get('confirmation') or {}
        except (OSError, ValueError):
            continue
        if confirmation.get('confirmed'):
            lines.append(f"- [{name}](→ {ARTIFACT_NAMES[stage]}): 확인 완료")
    for issue in data.get('issues', []) or []:
        resolution = issue.get('resolution')
        if resolution:
            lines.append(f"- [{issue['question'].strip()}](→ $.issues[id={issue['id']}]): "
                         f"{resolution['answer'].strip()}")
    return lines


def render_map(folder, session, data, report):
    """The whole case at low resolution, derived from the artifact and held to a budget."""
    title, goal = destination(folder, data)
    decisions = settled(folder, session, data)
    blocks = [
        ['## 목적지', '', title + (f' — {goal}' if goal else ''), ''],
        ['## 현재', '',
         f"{STAGE_LABELS[session['stage']]} · {report['phase']}", report['user_status'], ''],
    ]
    def section(heading, lines, empty):
        blocks.append([heading, ''] + (lines if lines else [empty]) + [''])
    section(f'## 결정된 것 ({len(decisions)})', decisions, '- 아직 없다.')
    frontier = [f"- [{row.get('question', row['prompt']).strip()}] ({row['issue_id']}, {row['kind']})"
                for row in report['required_actions']]
    section(f"## 지금 할 수 있는 것 ({len(frontier)})", frontier, '- 없다.')
    blocked = [f"- [{row['question'].strip()}] ← {', '.join(row['blocked_by'])} 대기"
               for row in report['blocked']]
    if blocked:
        section(f'## 막혀 있는 것 ({len(blocked)})', blocked, '')
    fog = [f"- {row['note'].strip()} — {row['why_not_ticket'].strip()}" for row in report['fog']]
    if fog:
        section('## 안개', fog, '')
    out = [f"- {row['note'].strip()} — {row['reason'].strip()}" for row in report['out_of_scope']]
    if out:
        section('## 범위 밖', out, '')
    path = artifact_path(folder, session['stage'])
    size = path.stat().st_size if path.exists() else 0
    blocks.append(['## 예산', '',
                   f"정본 {size:,} B · 미해결 이슈 {len([i for i in data.get('issues', []) or [] if not i.get('resolution')])}건"
                   f" · 확인 준비 {'예' if report['ready_for_confirmation'] else '아니오'}", ''])
    text = '\n'.join(line for block in blocks for line in block)
    while len(text) > MAP_BUDGET and decisions:
        # Oldest decisions are the least likely to matter to the next ticket.
        decisions.pop(0)
        blocks[2] = [f'## 결정된 것 ({len(decisions)}, 오래된 항목 생략)', ''] + decisions + ['']
        text = '\n'.join(line for block in blocks for line in block)
    return text


def stale_work(folder, data):
    """Scratch directories whose ticket is closed, whenever it closed. Their contents are dead."""
    root = folder / 'work'
    closed_ids = {row['id'] for row in data.get('issues', []) or [] if row.get('resolution')}
    return sorted(name for name in closed_ids if (root / name).is_dir())


def clear_work(folder, names):
    """Remove one ticket's scratch directory, never anything outside it."""
    import shutil
    removed = {}
    root = (folder / 'work').resolve()
    for name in names:
        path = (root / name).resolve()
        if path.parent != root or not path.is_dir():
            continue
        removed[name] = sorted(str(child.relative_to(path)) for child in path.rglob('*')
                               if child.is_file())
        shutil.rmtree(path)
    return removed


def render_handoff(folder, session, data, report, note=''):
    """The controller renders what it can verify; the agent only adds what it alone knows."""
    issues = {row['id']: row for row in data.get('issues', []) or []}
    lines = ['# 다음 세션 진입', '',
             f'케이스: {folder}',
             f'먼저 실행: session.py status {folder} --map', '']
    closed = [issues[name] for name in session.get('closed_since_handoff') or [] if name in issues]
    lines += ['## 방금 끝낸 것', '']
    if closed:
        for issue in closed:
            resolution = issue.get('resolution') or {}
            lines.append(f"[{issue['question'].strip()}] → {resolution.get('answer', '').strip()}")
            evidence = ', '.join(resolution.get('evidence_ids') or []) or '없음'
            lines.append(f"근거: {evidence} / 결정: {resolution.get('decision_id', '')}")
    else:
        lines.append(f"닫은 티켓은 없다. 이 세션이 옮긴 양은 {session.get('work_bytes', 0):,} B다.")
    lines += ['', '## 다음 후보', '']
    candidates = [row for row in report['required_actions'] if row['issue_id'] != 'session-handoff']
    if candidates:
        for row in candidates[:5]:
            lines.append(f"[{row.get('question', row['prompt']).strip()}] ({row['kind']})")
    else:
        lines.append(f"전선이 비어 있다. 현재 상태는 {report['phase']}다.")
    if report['blocked']:
        lines += ['', '막힌 것: ' + ', '.join(
            f"[{row['question'].strip()}] ← {', '.join(row['blocked_by'])}" for row in report['blocked'])]
    if note.strip():
        lines += ['', '## 넘기는 주의', '', note.strip()]
    return '\n'.join(lines) + '\n'


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


def as_timestamp(value):
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except (ValueError, AttributeError):
        return None


def newer_context(data, session):
    current = checked_at(session['stage'], data)
    old = session['refresh_after']
    if not current:
        return False
    if not old:
        return True
    now, before = as_timestamp(current), as_timestamp(old)
    if now is None or before is None:
        # An artifact written before prd recorded a time, or a value that is not one. A
        # different value is a fresh check; refusing to compare would leave the session
        # unable to clear its refresh, which blocks the stage transition outright.
        return current != old
    return now > before


def newly_closed(previous, candidate):
    """Tickets this write closed. Lookups are exempt: their context lives in a subagent."""
    before = {row['id'] for row in previous.get('issues', []) or [] if row.get('resolution')}
    return [row['id'] for row in candidate.get('issues', []) or []
            if row.get('resolution') and row['id'] not in before
            and row.get('action', {}).get('kind') != 'platty']


def changed_bytes(stored, candidate, emitted):
    """What this save actually changed, not what it retransmitted.

    The budget charged the whole draft, and a stage-3 artifact is 150-270 KB. Since every
    question forces a save, the 200 KB budget was spent on the first or second one — four
    separate cases reported it, and the runbook's advice (use `patch`) does not help: `patch`
    cannot address array elements, and any stage-3 edit re-stamps sixteen assessment hashes,
    which costs the same as a full save.

    The budget exists to say 「this session has moved a lot of work」. Retransmitting an
    unchanged document is not work, so only the top-level keys whose content differs are
    charged. A save that fixes one sentence in a 250 KB file costs that sentence.
    """
    if not (isinstance(stored, dict) and isinstance(candidate, dict)):
        return emitted
    cost = 0
    for key in set(stored) | set(candidate):
        before, after = stored.get(key), candidate.get(key)
        if before != after:
            cost += len(json.dumps(after, ensure_ascii=False, sort_keys=True, default=str))
    return cost


def commit_candidate(folder, session, data, candidate, command, emitted=0):
    """Shared write path. Patch narrows what the agent emits, never what is checked."""
    if candidate.get('schema_version') != data.get('schema_version'):
        raise ValueError(f'{command} cannot mix storage formats; use the matching named template')
    if session['stage'] in ('user_experience', 'screen_behavior', 'design_system_wireframe') and candidate.get('input_binding') != data.get('input_binding'):
        raise ValueError(f'{command} cannot change the confirmed planning context input binding')
    report = validate_case_artifact(folder, session['stage'], candidate)
    if not report['valid']:
        raise ValueError(json.dumps(report, ensure_ascii=False))
    selection_gaps = planner_selection_gaps(folder, session, candidate)
    if selection_gaps:
        raise ValueError('; '.join(selection_gaps))
    # Stages 2 and 3 are derived: they finish on `save`, with no confirmation question, so they
    # never passed through the two places this check was wired into. A replayed run put a
    # nonexistent entry id in a stage-2 source and saved it without a word.
    receipts = receipt_reference_gaps(folder, session, candidate)
    if receipts:
        raise ValueError('; '.join(receipts))
    if candidate['status'] == 'complete' or candidate['confirmation']['confirmed']:
        raise ValueError(f'{command} cannot supply approval; use ask confirmation, answer, then confirm')
    excerpts = excerpt_gaps(data, candidate)
    if excerpts:
        raise ValueError('; '.join(excerpts))
    # 5차에서 실제로 잃었다: `ask`는 pause에서 막히는데 `save`는 안 막히고, `backflow`는 정본을
    # 직접 고치는데 초안은 /tmp에 있다. 멈추기 전에 뜬 초안을 저장하자 그 사이 생긴 차단 역류
    # 티켓이 **경고 없이 덮였다**. 스냅샷에서 복구해야 했다.
    # pause만의 문제가 아니다 — 낡은 초안은 언제든 같은 일을 한다. 불변식은 하나다:
    # **저장은 열린 차단 티켓을 조용히 없앨 수 없다.** 닫으려면 `resolution`을 적어야 한다.
    stored_blocking = {row['id']: row for row in (data.get('issues') or [])
                       if row.get('blocking') and not planning_context.closed(row)}
    dropped = sorted(set(stored_blocking) - {row['id'] for row in (candidate.get('issues') or [])})
    if dropped:
        raise ValueError(
            f"{command} would drop open blocking issues that are in the saved artifact: "
            f"{', '.join(dropped)} — 낡은 초안일 가능성이 높다. 최신 산출물을 다시 읽고 그 위에 "
            '고쳐 보내거나, 정말 닫는 것이면 resolution을 적어라')
    old_hashes = artifact_fingerprints(session['stage'], data)
    new_hashes = artifact_fingerprints(session['stage'], candidate)
    if session.get('needs_processing', False) and old_hashes == new_hashes:
        # 조건부 승인의 조건이 **이미 충족돼 있으면** 여기서 막히고, 저장하지 않으면 확인
        # 질문이 「먼저 답을 반영하라」로 막힌다. 양쪽이 막혀서 5차의 한 실행기는
        # **「아무것도 안 고쳤다」를 말하려고 무언가를 고쳐야 했다.**
        # 답을 읽고 고칠 것이 없다는 것도 판정이다 — 그 판정에 id를 주고 넘어간다.
        raise ValueError(
            f'{command} after an answer must update the current stage artifact — '
            '고칠 것이 없다는 판정이면 record-decision으로 그 판정을 남기고 '
            '`confirm --turn-id … --outcome …`으로 바로 선언한다')
    if old_hashes != new_hashes:
        candidate['confirmation'] = empty_confirmation(session['stage'])
        if session['pending'] and session['pending']['kind'] == 'confirmation':
            session['pending'] = None
        # 「X만 고쳐주시면 넘기셔도 됩니다」 is the commonest way a planner approves. Doing the
        # fix voids the approval, which is right — but confirm used to refuse without saying
        # why, and two replayed runs read it as a bug until they read the source.
        if session['answered_question']:
            session['confirmation_voided_by'] = command
        session['answered_question'] = None
    elif session.get('confirmation_voided_by'):
        # 내용을 원래대로 되돌려도 플래그가 켜진 채였다. 「save가 산출물을 바꿨다」가
        # 사실이 아니게 되는 자리이고, 해시가 같아졌다는 것이 되돌렸다는 증거다.
        session['confirmation_voided_by'] = ''
    if report['baseline_ready'] and session['refresh_required'] and newer_context(candidate, session):
        session['refresh_required'] = False
    session['needs_processing'] = False
    session['work_bytes'] = session.get('work_bytes', 0) + changed_bytes(data, candidate, emitted)
    session['handed_off'] = False
    before = {row['id']: row for row in data.get('issues', []) or []}
    for name in newly_closed(data, candidate):
        if name not in session['closed_since_handoff']:
            session['closed_since_handoff'].append(name)
        # Only a blocking ticket is worth a handoff. Closing a probe is the grilling rule
        # being followed, not work handed to someone else.
        if before.get(name, {}).get('blocking'):
            session.setdefault('closed_blocking_since_handoff', [])
            if name not in session['closed_blocking_since_handoff']:
                session['closed_blocking_since_handoff'].append(name)
    append_entry(session, 'system', command,
                 'Validated candidate saved; no review or approval was created.')
    # A derived stage has nobody to wait for: the judgment it rests on was settled upstream.
    if should_auto_complete(session, report, candidate['confirmation']['confirmed']):
        entry = append_entry(session, 'system', 'derived-complete',
                             f"{session['stage']} derived from the confirmed upstream; "
                             'completed without a planner confirmation.')
        content_hash, review_hash = artifact_fingerprints(session['stage'], candidate)
        candidate['confirmation'] = {
            **empty_confirmation(session['stage']),
            **derived_confirmation(entry['id'], content_hash, review_hash)}
        if session['stage'] == 'design_system_wireframe':
            candidate['confirmation'].update(input_hash=report['input_hash'],
                                             knowledge_hash=report['knowledge_hash'])
        candidate['status'] = 'complete'
        final = validate_case_artifact(folder, session['stage'], candidate)
        if not final['complete']:
            raise ValueError(json.dumps(final, ensure_ascii=False))
        heading = ('> 모의 실행 (simulation). 실제 서비스 조회 결과가 아닙니다.\n\n'
                   if session['mode'] == 'simulation' else '')
        output_name = artifact_path(folder, session['stage']).with_suffix('.md').name
        (folder / output_name).write_text(
            heading + render_artifact(session['stage'], candidate, final), encoding='utf-8')
    persist_artifact(folder, session, candidate)
    return view(folder, session, candidate)


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
                    if is_legacy_case(state_path.parent):
                        result = legacy_status(state_path.parent)
                        if args.mode == 'all' or result['mode'] == args.mode:
                            cases.append({key: result[key] for key in ('case_path', 'phase', 'mode', 'stage')})
                        continue
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
        stage = getattr(args, 'stage', 'planning_context')
        data = load_json(STAGE_TEMPLATES[stage])
        slug = re.sub(r'[^a-z0-9]+', '-', folder.name.lower()).strip('-')
        if not slug:
            raise ValueError('case directory needs a lowercase alphanumeric identifier')
        data['case_id'] = slug
        session = {'version': 1, 'stage': stage, 'mode': args.mode, 'model': args.model or 'unrecorded', 'created_at': now(),
                   'updated_at': now(), 'paused': False, 'refresh_required': False,
                   'refresh_after': '', 'needs_processing': initial is not None, 'pending': None, 'answered_question': None, 'entries': []}
        if initial is not None:
            append_entry(session, 'user', 'initial', initial)
        folder.mkdir(parents=True, exist_ok=False)
        persist_artifact(folder, session, data)
        return view(folder, session, data)
    if args.command == 'start-prd':
        session, data = load_case(folder)
        if session['stage'] != 'jtbd':
            raise ValueError('start-prd requires the jtbd stage')
        if not jtbd.validate(data)['complete']:
            raise ValueError('the job must be complete and confirmed before the prd stage')
        path = folder / ARTIFACT_NAMES['prd']
        draft = load_json(path) if path.exists() else load_json(prd.TEMPLATE)
        draft['case_id'] = data['case_id']
        draft['title'] = data['title']
        draft['status'] = 'in_progress'
        draft['confirmation'] = dict(EMPTY_CONFIRMATION)
        # Judgments are copied; the planner answers only the solution side.
        draft['carried'] = prd.carry_from_jtbd(data)
        content_hash, review_hash = jtbd.fingerprints(data)
        draft['input_binding'] = {
            'jtbd_path': str((folder / ARTIFACT_NAMES['jtbd']).resolve()),
            'content_hash': content_hash, 'review_hash': review_hash,
            'confirmation_turn_id': data['confirmation']['turn_id'],
            'project_id': data['service_context']['project_id'],
            'observed_revision': data['service_context']['observed_revision'],
            # The prd reads its upstream check time from here, and this builder — the one every
            # run goes through — never wrote it while `prd.py bind` did. So `reopen --stage prd`
            # left `refresh_required` set with nothing able to clear it. Six of ten fresh cases
            # wedged there; the first round only looked fixed because I migrated the artifacts.
            'checked_at': data['service_context']['checked_at']}
        draft['history'].append({'change': 'JTBD에서 PRD 입력 생성',
                                 'reason': 'job 문장·페인포인트·가설·성공 판정·조사 한계를 기계적으로 옮겼다.'})
        session.update(stage='prd', paused=False, refresh_required=False, refresh_after='',
                       needs_processing=False, pending=None, answered_question=None)
        append_entry(session, 'system', 'start-prd', 'PRD started from the confirmed job.')
        persist_artifact(folder, session, draft)
        # `save`는 `changed_bytes()`로 바뀐 칸만 세는데 `start`는 파일 크기를 통째로 더했다.
        # 4차에 예산을 고칠 때 `save`만 보고 이쪽을 안 봤다. 5차 실측: **2단계 재진입 한 번이
        # +130,333 B로, 2단계 전체를 만든 작업(72KB)보다 비쌌다.** 인계를 부른 것은 일의 양이
        # 아니라 이 비대칭이었다. 진입은 일이 아니다 — 아무것도 안 바꾸면 0이다.
        save_metadata(folder, session)
        return view(folder, session, draft)
    if args.command == 'start-user-experience':
        session, data = load_case(folder)
        if session['stage'] not in ('planning_context', 'prd'):
            # It said 「already started」 whether or not it had been. The real condition is that
            # the upstream is not the stage standing here, and its neighbours say so plainly.
            raise ValueError(
                f'start-user-experience requires the prd or planning_context stage; '
                f'this case is at {session["stage"]}')
        upstream = session['stage']
        if not validate_artifact(upstream, data)['complete']:
            raise ValueError(f'{upstream} must be complete and confirmed before user experience')
        upstream_path = folder / ARTIFACT_NAMES[upstream]
        experience_path = folder / 'user-experience.json'
        if experience_path.exists():
            experience = load_json(experience_path)
            source = (user_experience.bind_prd(experience, upstream_path) if upstream == 'prd'
                      else user_experience.bind_planning_context(experience, upstream_path))
            experience['status'] = 'in_progress'
            experience['confirmation'] = dict(EMPTY_CONFIRMATION)
            evidence = (source['input_binding'] if upstream == 'prd' else source['service_context'])
            experience['evidence_status']['status'] = 'stale'
            experience['evidence_status']['project_id'] = evidence['project_id']
            experience['evidence_status']['baseline_revision'] = evidence['observed_revision']
            experience['history'].append({
                'change': f'{STAGE_LABELS[upstream]} 입력 재연결',
                'reason': '확인된 상위 단계 변경의 영향을 사용자 경험에 다시 반영한다.',
            })
            atomic_json(experience_path, experience)
        elif upstream == 'prd':
            user_experience.init_from_prd(experience_path, upstream_path)
        else:
            user_experience.init_from_planning_context(experience_path, upstream_path)
        session['stage'] = 'user_experience'
        session['paused'] = False
        session['refresh_required'] = False
        session['refresh_after'] = ''
        session['needs_processing'] = False
        session['pending'] = None
        session['answered_question'] = None
        append_entry(session, 'system', 'start-user-experience',
                     f'User experience started from the confirmed {upstream} result.')
        data = load_json(folder / 'user-experience.json')
        save_metadata(folder, session)
        return view(folder, session, data)
    if args.command == 'start-screen-behavior':
        session, data = load_case(folder)
        if session['stage'] != 'user_experience':
            raise ValueError('start-screen-behavior requires the user experience stage')
        if session['paused'] or (session['refresh_required']
                                 and refresh_blocks_exit(session['stage'])):
            raise ValueError('resume and refresh the upstream context before start-screen-behavior')
        if not user_experience.validate(data)['complete'] or not input_binding_current(folder, data):
            raise ValueError('user experience and its input must be complete, confirmed and current')
        module = stage_module('screen_behavior')
        path = folder / 'screen-behavior.json'
        if path.exists():
            draft = load_json(path)
            module.bind_inputs(draft, folder / 'user-experience.json')
            draft['status'] = 'in_progress'
            draft['confirmation'] = dict(EMPTY_CONFIRMATION)
            draft['evidence_status']['status'] = 'stale'
            draft['history'].append({'change': '사용자 경험 설계 입력 재연결',
                                     'reason': '기존 화면 모델을 보존하고 변경 영향을 재검토한다.'})
        else:
            draft = module.init_from_user_experience(path, folder / 'user-experience.json')
        bind_screen_knowledge(draft, getattr(args, 'knowledge_pack', None))
        session.update(stage='screen_behavior', paused=False, refresh_required=False,
                       refresh_after='', needs_processing=False, pending=None, answered_question=None)
        append_entry(session, 'system', 'start-screen-behavior', 'Screen behavior started from confirmed current inputs.')
        persist_artifact(folder, session, draft)
        save_metadata(folder, session)
        return view(folder, session, draft)
    if args.command == 'start-design-system-wireframe':
        session, data = load_case(folder)
        if session['stage'] != 'screen_behavior':
            raise ValueError('start-design-system-wireframe requires the screen behavior stage')
        if session['paused'] or (session['refresh_required']
                                 and refresh_blocks_exit(session['stage'])):
            raise ValueError('resume and refresh the upstream context before start-design-system-wireframe')
        report = validate_artifact('screen_behavior', data)
        if not report['complete']:
            raise ValueError('screen behavior must be complete, confirmed and current')
        module = stage_module('design_system_wireframe')
        path = folder / 'design-system-wireframe.json'
        knowledge_binding = latest_knowledge_pack(getattr(args, 'knowledge_pack', None))
        if path.exists():
            draft = load_json(path)
            draft['status'] = 'in_progress'
            draft['confirmation'] = empty_confirmation('design_system_wireframe')
        else:
            draft = module.init_from_screen_behavior(path, folder / 'screen-behavior.json')
        content_hash, review_hash = artifact_fingerprints('screen_behavior', data)
        draft['title'] = data['title'] + ' Design System Wireframes'
        draft['input_binding']['screen_behavior'] = {
            'path': str((folder / 'screen-behavior.json').resolve()),
            'content_hash': content_hash,
            'review_hash': review_hash,
            'confirmation_turn_id': data['confirmation']['turn_id'],
            'project_id': data['evidence_status']['project_id'],
            'observed_revision': data['evidence_status']['observed_revision'],
        }
        draft['knowledge_binding'] = knowledge_binding
        targets, coverage, navigation_links = write_wireframe_stage_inputs(
            folder, folder / 'screen-behavior.json', data, knowledge_binding, draft.get('targets', []))
        draft.update(targets=targets, coverage=coverage, navigation_links=navigation_links,
                     status='in_progress')
        draft['review'] = {'verdict': 'pending', 'rationale': '', 'criteria': [],
                           'evidence_ids': [], 'issue_ids': [], 'content_hash': '',
                           'knowledge_hash': knowledge_binding['content_hash']}
        draft['confirmation'] = empty_confirmation('design_system_wireframe')
        draft['history'].append({'change': '화면 동작 명세에서 디자인 시스템 와이어프레임 입력 생성',
                                 'reason': '완료된 화면별 상태·전이·요소를 brief, packet, traceability로 분리했다.'})
        session.update(stage='design_system_wireframe', paused=False, refresh_required=False,
                       refresh_after='', needs_processing=False, pending=None, answered_question=None)
        append_entry(session, 'system', 'start-design-system-wireframe',
                     'Design-system wireframe inputs prepared from confirmed screen behavior.')
        persist_artifact(folder, session, draft)
        save_metadata(folder, session)
        return view(folder, session, draft)
    if args.command in ('reopen-jtbd', 'reopen-prd', 'reopen-planning-context',
                        'reopen-user-experience', 'reopen-screen-behavior'):
        session, data = load_case(folder)
        target = {'reopen-jtbd': 'jtbd', 'reopen-prd': 'prd',
                  'reopen-planning-context': 'planning_context',
                  'reopen-user-experience': 'user_experience',
                  'reopen-screen-behavior': 'screen_behavior'}[args.command]
        # `jtbd` and `prd` were in REOPEN_STAGES and in --help and had no branch at all: the
        # command fell through, answered `outcome: success`, and changed not one byte. Backflow
        # tells you to go back to the job and confirm it again, and there was no command that
        # did that — so seven of ten replayed cases either threw the case away or hand-edited
        # a confirmed artifact to get out.
        allowed = (
            STAGE_ORDER[STAGE_ORDER.index(target) + 1:] if target in ('jtbd', 'prd') else
            ('user_experience', 'screen_behavior', 'design_system_wireframe') if target == 'planning_context' else
            ('screen_behavior', 'design_system_wireframe') if target == 'user_experience' else
            ('design_system_wireframe',)
        )
        if session['stage'] == target:
            # Undoing a confirmation on the stage you are standing on had no command: one run
            # had to start the next stage on a bad approval just to earn the right to go back.
            data['status'] = 'in_progress'
            data['confirmation'] = empty_confirmation(target)
            append_entry(session, 'system', args.command,
                         'Approval revoked on the current stage; the draft is kept.')
            persist_artifact(folder, session, data)
            session.update(paused=False, needs_processing=False, pending=None,
                           answered_question=None)
            save_metadata(folder, session)
            return view(folder, session, data)
        if session['stage'] not in allowed:
            raise ValueError(
                f'reopen --stage {target} runs from a stage below it or from {target} itself; '
                f'this case is at {session["stage"]}')
        # Preserve the downstream draft, explicitly revoke its approval before returning upstream.
        data['status'] = 'in_progress'
        data['confirmation'] = empty_confirmation(session['stage'])
        if 'evidence_status' in data:
            data['evidence_status']['status'] = 'stale'
        append_entry(session, 'system', args.command, 'Upstream reopened; downstream draft preserved for rebind.')
        persist_artifact(folder, session, data)
        session.update(stage=target, paused=False, refresh_required=True,
                       refresh_after=checked_at(target, load_json(artifact_path(folder, target))),
                       needs_processing=False, pending=None, answered_question=None)
        save_metadata(folder, session)
        return view(folder, session, load_json(artifact_path(folder, target)))
    session, data = load_case(folder)
    if args.command == 'ask' and args.kind == 'interview' and not interview_allowed(session['stage']):
        raise ValueError(f'{session["stage"]} is a derived stage and asks no interview question; '
                         'derive from the confirmed upstream or record a backflow')
    if args.command in ('ask', 'revise-decision-question', 'confirm'):
        current = (input_binding_current(folder, data) if session['stage'] == 'user_experience' else
                   validate_case_artifact(folder, session['stage'], data).get('input_ready', False)
                   if session['stage'] in ('screen_behavior', 'design_system_wireframe') else True)
        if not current:
            raise ValueError('upstream input is stale; recheck and rebind before questions or confirmation')
    if (
        session['mode'] == 'live'
        and args.command == 'ask'
        and args.kind != 'access'
        and not args.question_manifest
    ):
        raise ValueError('live interview questions require --question-manifest')
    if (
        session['mode'] == 'live'
        and args.command in ('save', 'patch', 'ask', 'revise-decision-question', 'acknowledge-inventory', 'confirm', 'handoff', 'record-tool')
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
        # 답을 읽고 「고칠 것이 없다」고 판정한 것도 답을 처리한 것이다. 그 판정에 id가 붙으면
        # 저장 없이도 다음으로 갈 수 있다 — 없으면 「아무것도 안 고쳤다」를 말하려고 무언가를
        # 고쳐야 하고, 5차의 한 실행기가 실제로 참인 한계 문장을 넣어 해시를 바꿔 빠져나왔다.
        if decision.get('stage') == 'confirmation':
            session['needs_processing'] = False
        content_hash, review_hash = artifact_fingerprints(session['stage'], data)
        append_journal(folder / 'evidence/decisions.jsonl', {**decision, 'id': entry['id'], 'at': entry['at'],
                       'mode': session['mode'], 'interview_stage': session['stage'],
                       'content_hash': content_hash, 'review_hash': review_hash})
        save_metadata(folder, session)
        return {**view(folder, session, data), 'decision_id': entry['id']}
    if args.command == 'status':
        result = view(folder, session, data)
        if getattr(args, 'map', False):
            report = dict(result, **result['validation'])
            return {'case_path': result['case_path'], 'stage': result['stage'],
                    'phase': result['phase'], 'can_yield': result['can_yield'],
                    'map': render_map(folder, session, data, report)}
        return result
    if args.command == 'show':
        return show(folder, session, data, args)
    if args.command == 'revise-decision-question':
        if session['paused'] or session['refresh_required']:
            raise ValueError('resume and refresh context before revising a question')
        if not validate_case_artifact(folder, session['stage'], data)['baseline_ready']:
            raise ValueError('basic service context must be ready before revising a question')
        pending = session['pending']
        if session['stage'] not in ('user_experience', 'screen_behavior') or not pending or pending['kind'] != 'decision':
            raise ValueError('an user experience decision question must be pending')
        packet_id = pending.get('decision_packet_id')
        packets = {packet['id']: packet for packet in data['decision_packets']}
        if packet_id not in packets or packets[packet_id]['status'] != 'open':
            raise ValueError('pending question must reference an open decision packet')
        context = load_decision_context(args.context_file, data)
        report = validate_case_artifact(folder, session['stage'], data)
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
    if args.command in ('save', 'patch'):
        if args.command == 'save':
            candidate = carry_question_counts(session['stage'], data, load_json(args.draft))
        else:
            value = load_json(args.value) if args.value is not None else None
            if args.delete and args.value is not None:
                raise ValueError('delete takes no --value')
            if not args.delete and args.value is None:
                raise ValueError('patch requires --value unless --delete is given')
            # 자리 번호로 쓰는 순간 **틀린 줄을 덮어도 조용하다.** 5차에서 `[70]`을 쓰려다
            # `[72]`를 덮었고 검증기는 0건을 냈다 — `not_applicable` 행이 `deferred` 사유를
            # 든 문서가 통과했다. 기계가 못 보는 것을 사람은 본다: 무엇을 지웠는지 돌려준다.
            try:
                replaced = read_pointer(data, args.pointer)
            except ValueError:
                replaced = None
            candidate = apply_pointer(data, args.pointer, value, args.append, args.delete,
                                      optional_roots(session['stage']))
            if candidate == data:
                raise ValueError('patch changed nothing; check the pointer and the value')
            patched = {'pointer': args.pointer, 'replaced': replaced}
        emitted = args.draft.stat().st_size if args.command == 'save' else (
            args.value.stat().st_size if args.value is not None else 0)
        result = commit_candidate(folder, session, data, candidate, args.command, emitted)
        if args.command == 'patch':
            result['patched'] = patched
        return result
    if args.command == 'acknowledge-inventory':
        question=session.get('answered_question'); user=last_user(session)
        if session['stage']!='screen_behavior' or data.get('schema_version')!=3:
            raise ValueError('inventory checkpoint requires current screen schema 3')
        if not question or question['kind']!='inventory_confirmation' or not user or user['id']!=args.turn_id or user['reply_to']!=question['id']:
            raise ValueError('inventory acknowledgment requires latest actual answer to inventory question')
        if question['content_hash']!=artifact_fingerprints(session['stage'],data)[0]:
            raise ValueError('inventory question is stale; show current inventory again')
        session['inventory_checkpoint']=({'content_hash':question['content_hash'],'question_id':question['id'],'answer_id':user['id']} if args.outcome=='accepted' else None)
        session['answered_question']=None
        session['needs_processing']=args.outcome!='accepted'
        append_entry(session,'system','inventory-acknowledgment','Classification review '+args.outcome+'; no decision packet selected.')
        save_metadata(folder,session)
        return view(folder,session,data)
    if args.command == 'ask':
        if session['paused']:
            raise ValueError('session paused; resume and refresh context first')
        if session['pending']:
            raise ValueError('a question is already pending; record its answer before asking another')
        raw_question = message(args.text_file)
        manifest = question_manifest(
            args.question_manifest, session['stage'], data, raw_question, args.decision_id,
        ) if args.question_manifest else None
        question_stage = manifest['stage'] if manifest else args.question_stage
        if manifest and args.question_stage and args.question_stage != manifest['stage']:
            raise ValueError('question stage flag must match question manifest stage')
        if args.kind != 'access' and not question_stage:
            if session['mode'] == 'live':
                raise ValueError('live interview questions require --question-stage')
            question_stage = session['stage']
        if question_stage and question_stage != session['stage']:
            raise ValueError(f'question stage {question_stage} does not match session stage {session["stage"]}')
        if manifest:
            decision = require_recorded_decision(folder, manifest)
            if manifest['issue_id'] not in decision['issue_ids']:
                raise ValueError('question manifest issue_id is not linked to its decision')
            if decision['next_action']['kind'] != 'ask_user':
                raise ValueError('question manifest decision must select ask_user')
        report = validate_case_artifact(folder, session['stage'], data)
        if args.kind != 'access' and (session['refresh_required'] or not report['baseline_ready']):
            raise ValueError('basic service context must be ready and refreshed before interviewing')
        if args.kind != 'access' and session.get('needs_processing', False):
            # 답을 적기 전에 다음을 묻는 것을 막는 규칙이고, 다섯 실행기가 이 주행에서 가장
            # 값진 지적으로 꼽았다. 다만 **고칠 것이 없을 때** 나갈 문이 없어 교착이 됐다 —
            # 조건이 이미 충족된 조건부 승인이 그 경우다. 그 판정에 id를 주면 나갈 수 있다.
            raise ValueError('process the latest user answer and save a draft before the next '
                             'question — 답을 읽었는데 고칠 것이 없으면 record-decision으로 '
                             '그 판정을 남기고 온다')
        if args.kind == 'inventory_confirmation':
            if session['stage']!='screen_behavior' or data.get('schema_version')!=3:
                raise ValueError('inventory question requires screen schema 3')
            inventory_metric=next((m for m in report['metrics'] if m['id']=='decision_inventory'),{})
            if not inventory_metric.get('denominator') or inventory_metric.get('missing_ids') or inventory_metric.get('duplicate_ids'):
                raise ValueError('inventory checkpoint requires the complete target inventory first')
        if args.kind == 'confirmation' and not report['ready_for_confirmation']:
            raise ValueError('current artifact is not ready for confirmation')
        if args.kind == 'confirmation' and receipt_reference_gaps(folder, session, data):
            raise ValueError('; '.join(receipt_reference_gaps(folder, session, data)))
        if args.kind == 'confirmation' and planner_selection_gaps(folder, session, data):
            raise ValueError('selected planner decisions must cite actual answers to their saved decision questions')
        if args.kind == 'decision':
            if session['stage'] not in ('user_experience', 'screen_behavior') or not args.packet_id:
                raise ValueError('decision questions require an user experience or 3 packet-id')
            packets = {packet['id']: packet for packet in data['decision_packets']}
            if args.packet_id not in packets or packets[args.packet_id]['status'] != 'open':
                raise ValueError('decision question requires an open decision packet')
            decision_context = load_decision_context(args.context_file, data)
            visual_frame = None
            if session['stage'] == 'screen_behavior':
                if args.visual_frame is None:
                    raise ValueError('screen behavior decision questions require a visual frame')
                frame = load_json(args.visual_frame)
                visual_frame = visual_decision_frame.prepare(folder, packets[args.packet_id], frame)
                visual = visual_decision_frame.load_for_packet(folder, visual_frame, packets[args.packet_id])
        elif args.packet_id:
            raise ValueError('packet-id is only valid for decision questions')
        elif args.context_file:
            raise ValueError('context-file is only valid for decision questions')
        elif args.visual_frame:
            raise ValueError('visual-frame is only valid for screen behavior decision questions')
        if not report['valid']:
            raise ValueError('current artifact is invalid; save a valid draft first')
        question = raw_question
        if args.kind == 'decision':
            question = (visual + '\n' if session['stage'] == 'screen_behavior' else '') + render_decision_question(decision_context, question)
        if args.kind=='inventory_confirmation':
            snapshot=f"evidence/progress/{len(session['entries'])+1:05}.json"
            atomic_json(folder/snapshot,data)
            question=stage_module('screen_behavior').render_decision_inventory(data)+'\n분류 목록 검토이며 미결정 추천의 선택 승인이 아닙니다. 수정이 필요하면 답변에 적어 주세요.\n\n'+question
        elif session['stage'] in ('user_experience', 'screen_behavior'):
            progress, snapshot = question_progress(folder, session, data, args.packet_id or '', full=args.kind == 'confirmation', context=decision_context if args.kind == 'decision' else None)
            question = progress + '\n' + question
        spent = counts_against_budget(args.kind)
        if spent:
            spend_question(session['stage'], data, manifest,
                           open_backflows_to(folder, session['stage']))
        entry = append_entry(session, 'assistant', args.kind, question)
        if question_stage:
            entry['question_stage'] = question_stage
        if manifest:
            entry['question_manifest'] = manifest
        if session['stage'] in ('user_experience', 'screen_behavior'):
            entry['progress_snapshot'] = snapshot
        if args.kind == 'decision':
            entry['decision_packet_id'] = args.packet_id
            entry['decision_context'] = decision_context
            if session['stage'] == 'screen_behavior':
                entry['visual_frame'] = visual_frame
        session['pending'] = {**entry, 'content_hash': report['content_hash'], 'review_hash': report['review_hash']}
        session['answered_question'] = None
        if spent:
            # The count lives in the artifact, so it has to be written with the question.
            atomic_json(artifact_path(folder, session['stage']), data)
        save_metadata(folder, session)
    elif args.command == 'answer':
        pending = session['pending']
        if not pending and not args.unsolicited:
            # A refused `ask` leaves nothing pending, and the answer that followed used to land
            # as a stray `input` no one reads — the question's own words never reached the
            # journal. Recording what a planner volunteers is still allowed, but it has to say so.
            raise ValueError('no question is waiting; ask one first, or pass --unsolicited to '
                             'record what the planner said on their own')
        append_entry(session, 'user', 'answer' if pending else 'input', message(args.text_file),
                     pending['id'] if pending else None)
        session['needs_processing'] = True
        session['answered_question'] = pending if pending and pending['kind'] in ('confirmation','inventory_confirmation') else None
        if session['answered_question']:
            session['confirmation_voided_by'] = ''
        session['pending'] = None
        save_metadata(folder, session)
    elif args.command == 'confirm':
        question = session['answered_question']
        user = last_user(session)
        # The controller used to treat any latest answer as approval. A fresh run recorded
        #   t0035 user   「확인부터 하는 게 맞을 것 같아요 … 보고 넘어가주세요」
        #   t0036 system 「Current content confirmed; prd completed.」
        # — a refusal stamped as approval, its own words sitting in `confirmation.statement`.
        # Three more runs had a condition accepted the same way. The hash cannot read the
        # sentence, but the executor did: it declares what it read, the way
        # `acknowledge-inventory --outcome` already does, and the declaration sits next to the
        # answer for a person to check.
        if args.outcome != 'approved':
            # 선언하면 `outcome: error`로 저널에 박혀 **실행기의 실수와 구별되지 않았다.**
            # 기획자가 조건을 달거나 거절한 것은 정상적인 사건이지 오류가 아니다 —
            # 두 실행기가 「조건부는 거부가 아니라 기록이어야 한다」고 같은 말을 적었다.
            entry = append_entry(session, 'user', args.outcome, user['text'], question['id']) \
                if question and user and user['id'] == args.turn_id else None
            append_entry(session, 'system', 'confirmation-outcome',
                         f"Planner answer read as {args.outcome}; approval not taken.")
            session['answered_question'] = None
            session['needs_processing'] = True
            session['confirmation_voided_by'] = args.outcome
            # 세션 깃발만 세우고 산출물은 건드리지 않았다. 파생 단계는 `save`가 스스로 확정하므로
            # 거절이 저널에만 남고 파일은 `confirmed: true`로 남았다 — 4차 F-33이 고치려던 바로 그
            # 「거절이 승인으로 박힌다」를 한 단계 옆에서 다시 만든 것이다. 5차가 실측했다:
            # `reopen`을 부르지 않았다면 「확정됨」인 채로 4단계에 넘어갔다.
            # 거절은 승인의 철회다. 어느 단계든 똑같이 철회한다.
            withdrawn = bool(data.get('confirmation', {}).get('confirmed'))
            if withdrawn:
                data['status'] = 'in_progress'
                data['confirmation'] = empty_confirmation(session['stage'])
                append_entry(session, 'system', 'confirmation-withdrawn',
                             f"{session['stage']}: approval withdrawn because the planner "
                             f'answer was read as {args.outcome}.')
                persist_artifact(folder, session, data)
            save_metadata(folder, session)
            result = view(folder, session, data)
            result['confirmation_withdrawn'] = withdrawn
            result['confirmation_outcome'] = args.outcome
            # 거절 뒤 확인을 다시 보내려면 그때 연 이슈를 닫아야 하는데, 닫으려면 기획자
            # `turn_id`가 필요하다 — 그래서 한 주행이 **거절을 받아들이느라 1b 질문 예산 둘 중
            # 하나를 우회에 썼다.** 필요 없는 지출이었다: 거절 자체가 기획자의 답이고 그 턴이
            # 여기 있다. 문구가 그 턴 번호를 그대로 준다.
            turn = (user or {}).get('id', '')
            closer = (f' 이 답의 턴은 `{turn}`이다 — 여기서 연 이슈는 '
                      f'`resolution{{answer, turn_id: "{turn}"}}`으로 닫는다. '
                      '인터뷰 질문을 새로 쓸 필요가 없다.' if turn else '')
            result['next_step'] = (
                ('이미 서 있던 확정을 철회했다. ' if withdrawn else '')
                + ('조건을 반영한 뒤 확인 질문을 다시 보낸다.' if args.outcome == 'conditional'
                   else '무엇을 왜 거절했는지 기록한다. 여기서 확정되는 것은 없다.')) + closer
            return result
        report = validate_case_artifact(folder, session['stage'], data)
        if session['paused'] or session['refresh_required']:
            raise ValueError('resume and refresh context before confirmation')
        receipts = receipt_reference_gaps(folder, session, data)
        if receipts:
            raise ValueError('; '.join(receipts))
        if planner_selection_gaps(folder, session, data):
            raise ValueError('selected planner decisions must cite actual answers to their saved decision questions')
        if not question or not user or user['id'] != args.turn_id or user['reply_to'] != question['id']:
            if not question and session.get('confirmation_voided_by'):
                raise ValueError(
                    f"the approval was answered and then {session['confirmation_voided_by']} changed "
                    'the artifact, so it no longer covers what is here. A conditional approval '
                    '(「고쳐주시면 넘기셔도 됩니다」) costs one more round trip on purpose: ask the '
                    'confirmation question again on the revised artifact.')
            raise ValueError('confirmation requires the latest actual answer to a confirmation question')
        if not report['ready_for_confirmation'] or (question['content_hash'], question['review_hash']) != artifact_fingerprints(session['stage'], data):
            raise ValueError('confirmation question is stale or current result is not ready')
        data['confirmation'] = {'confirmed': True, 'turn_id': user['id'], 'statement': user['text'],
                                'content_hash': report['content_hash'], 'review_hash': report['review_hash']}
        if session['stage'] == 'design_system_wireframe':
            data['confirmation'].update(input_hash=report['input_hash'], knowledge_hash=report['knowledge_hash'])
        data['status'] = 'complete'
        final = validate_case_artifact(folder, session['stage'], data)
        if not final['complete']:
            raise ValueError(json.dumps(final, ensure_ascii=False))
        heading = '> 모의 실행 (simulation). 실제 서비스 조회 결과가 아닙니다.\n\n' if session['mode'] == 'simulation' else ''
        output_name = artifact_path(folder, session['stage']).with_suffix('.md').name
        (folder / output_name).write_text(heading + render_artifact(session['stage'], data, final), encoding='utf-8')
        session['answered_question'] = None
        session['needs_processing'] = False
        append_entry(session, 'system', 'complete', f"Current content confirmed; {session['stage']} completed.")
        persist_artifact(folder, session, data)
    elif args.command == 'backflow':
        # A derived stage records what it cannot derive and keeps deriving the rest.
        allowed = upstream_stages(session['stage'])
        if args.to not in allowed:
            raise ValueError(f'{args.to} is not upstream of {session["stage"]}; '
                             f'a backflow may target {", ".join(allowed) or "nothing"}')
        question = args.question.strip()
        if not question:
            raise ValueError('a backflow names the question the upstream must answer')
        reason = message(args.reason).strip()
        if not reason:
            raise ValueError('a backflow records why this stage cannot derive the answer')
        issue = backflow_issue(
            session['stage'], next_backflow_id(data), question, reason,
            args.area or [sorted(QUESTION_INTENTS.get(session['stage'], {'scope'}))[0]])
        issue['target'] = args.to
        issue['action']['prompt'] = f'{args.to} 단계가 이 판단을 확정한 뒤 이 단계를 다시 파생한다.'
        data['issues'].append(issue)
        # A stage with a blocking backflow is not complete, and saying so here keeps the
        # artifact self-consistent instead of leaving the validator to contradict its status.
        if data.get('status') == 'complete':
            data['status'] = 'in_progress'
        append_entry(session, 'system', 'backflow',
                     f'{session["stage"]} -> {args.to}: {question}')
        persist_artifact(folder, session, data)
    elif args.command == 'handoff':
        if view(folder, session, data)['phase'] in ('logging_failed', 'migration_required'):
            raise ValueError('resolve the recorded blocker before handing off')
        note = message(args.note) if getattr(args, 'note', None) else ''
        finished = dict(session)
        stale = stale_work(folder, data)
        removed = clear_work(folder, stale) if args.clean else {}
        session.update(handed_off=True, work_bytes=0, closed_since_handoff=[],
                       closed_blocking_since_handoff=[])
        # Render against the settled session so the note names the work left, not the boundary.
        (folder / 'handoff.md').write_text(
            render_handoff(folder, finished, data, view(folder, session, data), note),
            encoding='utf-8')
        append_entry(session, 'system', 'handoff',
                     'Handoff note recorded; the next session re-enters through status --map.')
        save_metadata(folder, session)
        result = view(folder, session, data)
        result['stale_work'] = [f'work/{name}' for name in stale]
        result['removed_work'] = {f'work/{name}': files for name, files in removed.items()}
        return result
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
    for command in ('new', 'start', 'reopen', 'backflow', 'list', 'status', 'show', 'save', 'patch', 'ask', 'revise-decision-question', 'answer', 'acknowledge-inventory', 'confirm', 'handoff', 'pause', 'resume', 'record-tool', 'record-decision', 'trace', 'assert-yield', 'recover-log'):
        sub = commands.add_parser(command)
        sub.add_argument('path', type=Path, nargs='?' if command == 'list' else None,
                         default=WORKSPACE_ROOT / 'artifacts/interviews' if command == 'list' else None)
        if command in ('start', 'reopen'):
            sub.add_argument('--stage', required=True,
                             choices=START_STAGES if command == 'start' else REOPEN_STAGES)
            if command == 'start':
                sub.add_argument('--knowledge-pack')
        elif command == 'new':
            sub.add_argument('--stage', choices=NEW_STAGES, default=STAGE_ORDER[0])
            sub.add_argument('--input-file', type=Path)
            sub.add_argument('--mode', choices=('live', 'simulation'), default='live')
            sub.add_argument('--model', help='Observed runtime model identifier, if available')
        elif command == 'backflow':
            sub.add_argument('--to', required=True, choices=STAGE_ORDER,
                             help='the stage that owns the judgment this one cannot derive')
            sub.add_argument('--question', required=True,
                             help='what the upstream stage must answer')
            sub.add_argument('--reason', type=Path, required=True,
                             help='why this stage cannot derive it')
            sub.add_argument('--area', action='append',
                             help='the area this gap blocks; repeatable')
        elif command == 'list':
            sub.add_argument('--mode', choices=('live', 'simulation', 'all'), default='live')
        elif command == 'save':
            sub.add_argument('--draft', type=Path, required=True)
        elif command == 'status':
            sub.add_argument('--map', action='store_true',
                             help='the whole case at low resolution, within a fixed budget')
        elif command == 'show':
            sub.add_argument('--pointer', help='$.field, $.field.nested or $.collection[id=VALUE]')
            sub.add_argument('--issue', help='one issue by id')
            sub.add_argument('--with-evidence', action='store_true',
                             help='also return the rows and sources that issue reaches')
            sub.add_argument('--cell', help='one coverage slot as SCOPE:DIMENSION')
            sub.add_argument('--frontier', action='store_true', help='what is takeable now')
            sub.add_argument('--decisions', action='store_true', help='recorded decisions, compact')
        elif command == 'patch':
            sub.add_argument('--pointer', required=True,
                             help='$.field, $.field.nested or $.collection[id=VALUE]')
            sub.add_argument('--value', type=Path, help='JSON file holding only the changed slice')
            sub.add_argument('--append', action='store_true', help='append --value to the pointed list')
            sub.add_argument('--delete', action='store_true', help='remove the pointed list element')
        elif command in ('ask', 'answer'):
            sub.add_argument('--text-file', type=Path, required=True)
            if command == 'answer':
                sub.add_argument('--unsolicited', action='store_true',
                                 help='record what the planner said with no question waiting')
            if command == 'ask':
                sub.add_argument('--kind', choices=('interview', 'decision', 'confirmation', 'inventory_confirmation', 'access'), default='interview')
                sub.add_argument('--question-stage', choices=('jtbd', 'prd', 'planning_context', 'user_experience', 'screen_behavior', 'design_system_wireframe'))
                sub.add_argument('--question-manifest', type=Path)
                sub.add_argument('--packet-id')
                sub.add_argument('--context-file', type=Path)
                sub.add_argument('--visual-frame', type=Path)
        elif command == 'revise-decision-question':
            sub.add_argument('--text-file', type=Path, required=True)
            sub.add_argument('--context-file', type=Path, required=True)
        elif command == 'acknowledge-inventory':
            sub.add_argument('--turn-id',required=True)
            sub.add_argument('--outcome',choices=('accepted','corrections'),required=True)
        elif command == 'confirm':
            sub.add_argument('--turn-id', required=True)
            # Required, not defaulted. A default of `approved` reproduces the bug for anyone
            # who does not know the flag exists, and not knowing is exactly the state the four
            # runs were in when they stamped a condition — and once a flat refusal — as approval.
            sub.add_argument('--outcome', choices=('approved', 'conditional', 'refused'),
                             required=True,
                             help="how the planner's answer read: plain approval, approval with "
                                  'a condition to do first, or a refusal')
        elif command == 'handoff':
            sub.add_argument('--note', type=Path,
                             help='FILE holding what only this session knows and the next needs')
            sub.add_argument('--clean', action='store_true',
                             help="remove closed tickets' work/<issue-id>/ directories")
        elif command == 'record-tool':
            sub.add_argument('--receipt', type=Path, required=True)
        elif command == 'record-decision':
            sub.add_argument('--decision', type=Path, required=True)
        elif command == 'trace':
            sub.add_argument('--format', choices=('json', 'markdown'), default='json')
        if command in ('ask', 'revise-decision-question', 'save', 'patch', 'record-tool', 'acknowledge-inventory', 'confirm', 'handoff', 'pause', 'resume'):
            sub.add_argument('--decision-id', help='Recorded decision that selected this operation')
    args = parser.parse_args(normalize_args(sys.argv[1:]))
    if args.command != 'list' and is_legacy_case(args.path):
        if args.command in ('show', 'patch') or getattr(args, 'map', False):
            what = 'status --map' if args.command == 'status' else args.command
            print(json.dumps({'error': f'{what} is not available for a legacy case; '
                                       'scoped reads, scoped writes and the map need a current schema'},
                             ensure_ascii=False))
            return 1
        return invoke_legacy(args)
    if args.command in ('start', 'reopen'):
        args.command += '-' + args.stage.replace('_', '-')
    global _ACTIVE_OPERATION
    if args.command not in ('status','show','list','trace'):
        screen_path=args.path.resolve()/'screen-behavior.json'
        if screen_path.exists():
            try:
                old_screen=load_json(screen_path)
                current_session=load_json(args.path.resolve()/'session.json')
                blocked=old_screen.get('schema_version')==2 and (current_session.get('stage')=='screen_behavior' or args.command=='start-screen-behavior')
            except (OSError,ValueError,TypeError):
                blocked=False
            if blocked:
                print(json.dumps({'error':'migration_required: schema 2 screen behavior is read-only; explicit schema 3 migration required','migration_required':True},ensure_ascii=False))
                return 1
    observed = args.command not in ('status', 'show', 'list', 'trace', 'recover-log')
    pending_path = args.path.resolve() / 'evidence/pending-operation.json'
    if pending_path.exists() and observed:
        print(json.dumps({'error': 'audit recovery required; use recover-log before further operations'}, ensure_ascii=False))
        return 1
    before = capture(args.path.resolve()) if observed else None
    started_at, started = now(), time.perf_counter()
    error = None
    durable = observed and (args.command in ('start-screen-behavior', 'start-design-system-wireframe') or
                            ((before or {}).get('session') or {}).get('stage') in ('screen_behavior', 'design_system_wireframe'))
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
        if args.command == 'save' and getattr(args, 'draft', None) is not None:
            try:
                session, _ = load_case(args.path.resolve())
                result['draft_validation'] = validate_case_artifact(args.path.resolve(), session['stage'], load_json(args.draft))
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
    elif args.command == 'status' and getattr(args, 'map', False) and code == 0:
        print(result['map'])
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return code


if __name__ == '__main__':
    sys.exit(main())
