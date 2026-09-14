#!/usr/bin/env python3
"""Validate and render PRD records. Does not perform LLM or MCP calls."""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import sys

import jtbd
import planning_context
from planning_context import (MAP_FIELDS, TICKET_FIELDS, Optional, check_shape, closed,
                              invalid_report, load_json, map_gaps, markdown, shape_errors)

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / 'schemas/prd.template.json'
# platty-mcp-sdd-spec caps product discovery; the jtbd stage above is uncapped.
DISCOVERY_BUDGET = 2
REVIEW_LABELS = {'scope_fit': '범위 적합성', 'rule_coverage': '규칙과 수용 기준',
                 'evidence_grounding': '근거 적절성', 'handoff_readiness': '인계 가능성'}
CRITERIA = ('P1', 'P2', 'P3', 'P4', 'P5', 'P6')
# 비교 예시 — 기준 id와 1:1로 짝지어 있다(코퍼스 20건의 인용이 그렇게 쓰고 있었다).
# 아래는 기준을 설명하는 가상 사례이며 실제 히로인스 정책·기능 근거가 아니다.
EXAMPLE_DEFINITIONS = {
    'PR01': {'criterion': 'P1', 'topic': '범위 적합성',
              'unsuitable': '범위가 「리뷰 경험 개선」처럼 job보다 넓고 제외가 비어 있다.',
              'suitable': '범위가 이 job의 시작(작성 폼을 연다)과 끝(제출한다)으로 닫히고, 뺀 것마다 왜 뺐는지가 적혀 있다.',
              'edge': '상위가 `deferred`로 미룬 페인은 범위 밖이지만 **기각이 아니다.** 제외 사유에 그 차이를 적는다.'},
    'PR02': {'criterion': 'P2', 'topic': '규칙과 수용 기준',
              'unsuitable': '규칙이 「안내를 제공한다」로 끝나고 무엇을 보면 됐다고 할지가 없다.',
              'suitable': '규칙마다 수용 기준이 있고, 다루기로 한 페인마다 닿는 규칙이 있다.',
              'edge': '수용 기준이 측정 지표일 필요는 없다. 「그 화면에서 네 항목이 보인다」처럼 확인 가능한 상태면 된다.'},
    'PR03': {'criterion': 'P3', 'topic': '근거 적절성',
              'unsuitable': '가설 위에 선 규칙을 확정 규칙과 같은 자리에 섞어 적었다.',
              'suitable': '검증되지 않은 전제는 `carried.assumptions`에 확인 방법과 함께 남고, 그 위에 선 규칙은 미결로 표시된다.',
              'edge': '1a의 `inferred`·`observed(출처 미확보)` 행도 확인 안 된 것이다. 가설 등급만 가정으로 보면 이번에 다루는 것의 전제가 통째로 빠진다.'},
    'PR04': {'criterion': 'P4', 'topic': '인계 가능성',
              'unsuitable': '미결이 「추후 확인」으로만 적혀 담당도 처리 방침도 없다.',
              'suitable': '미결마다 누가 언제 무엇을 보고 정할지가 적혀 있고, 하위가 인용할 식별자가 있다.',
              'edge': '하위 단계가 인용할 수 없는 산문은 인계가 아니다. 규칙·결정·미결에 id를 준다.'},
    'PR05': {'criterion': 'P5', 'topic': '판단 승계',
              'unsuitable': '상위가 기각한 페인을 해결 방향으로 되살렸다.',
              'suitable': '상위 판정을 그대로 두고, 뒤집어야 한다면 역류로 상위에 되묻는다.',
              'edge': '`carried`는 기계 복사다. 고쳐 쓰면 검사가 잡는다 — 고칠 곳은 상위다.'},
    'PR06': {'criterion': 'P6', 'topic': '미결 처리',
              'unsuitable': '모르는 것을 「일반적으로 그렇다」로 메웠다.',
              'suitable': '모르는 것을 미결로 남기고 무엇을 측정해 어떻게 정할지 적었다.',
              'edge': '상위가 이미 「이번엔 안 한다」고 정한 것은 미결이 아니라 범위 밖이다. 그 결정을 가리켜 적는다.'},
}

CRITERION_DEFINITIONS = {
    'P1': '범위 적합성 — 범위가 이 job의 시작과 끝으로 닫히고 제외가 이유와 함께 적혔는가',
    'P2': '규칙과 수용 기준 — 다루기로 한 페인마다 규칙이 닿고 규칙마다 수용 기준이 있는가',
    'P3': '근거 적절성 — 규칙이 선 근거의 등급을 숨기지 않고 미검증을 미결로 드러냈는가',
    'P4': '인계 가능성 — 하위가 인용할 식별자와, 미결마다 담당과 처리 방침이 있는가',
    'P5': '판단 승계 — 상위가 정하거나 기각한 것을 여기서 뒤집지 않았는가',
    'P6': '미결 처리 — 모르는 것을 미결로 남기고 무엇을 측정해 어떻게 정할지 적었는가',
}
EXAMPLES = tuple(f'PR{number:02}' for number in range(1, 7))
ASSESSMENT = {'verdict': ('pending', 'suitable', 'needs_work', 'insufficient_evidence'),
              'rationale': str, 'criteria': [str], 'example_ids': [str], 'evidence_ids': [str],
              'issue_ids': [str], 'content_hash': str}
SOURCE = {'id': str, 'kind': ('user', 'document', 'code', 'imported'),
          'provider': ('user', 'platty', 'web', 'jtbd'), 'reference': str, 'excerpt': str,
          'project_id': str, 'revision': str, 'retrieved_at': str}
# §1 through §3 and §7 through §9 are copied from the job; only §4 through §6 are answered.
CARRIED = {
    'job_statement': str, 'pain_points': [{'id': str, 'name': str, 'decision': str, 'reason': str}],
    'assumptions': [{'id': str, 'text': str, 'verification': str, 'jtbd_row_id': str}],
    # `undecided`: 1a가 결과 쪽을 아직 못 정했다고 **선언**했다. 이 가설은 문장이 아니라
    # 자리 표시이고, 이것을 뒷받침할 규칙을 요구하면 없는 답을 지어내게 된다.
    'hypotheses': [{'id': str, 'text': str, 'measure': str, 'rule_ids': [str],
                    'undecided': Optional([str])}],
    'excluded': Optional([str]),
    'job_origin': Optional({key: str for key in jtbd.JOB_ELEMENTS}),
    'next_checks': Optional([{'text': str, 'jtbd_cell': str}]),
    'ruled_out': Optional([{'note': str, 'reason': str, 'jtbd_issue_id': str,
                            'kind': Optional(('ruled_out', 'undecidable'))}]),
    'handed_off': Optional([{'id': str, 'question': str, 'reason': str, 'jtbd_issue_id': str}]),
    'unknowable': Optional([{'text': str, 'why_not_ticket': str}]),
    'other_actors': Optional([{'name': str, 'part': str, 'why_not_subject': str}]),
    # 잠정 job이 1a 안에서 죽었다. 세 실행기가 찾았고 셋째는 grep으로 확인했다 —
    # prd·user_experience·screen_behavior에 `provisional`이 0건. carry가 안 옮기고 손으로
    # 넣으면 `carry_fidelity_gaps`가 막아서, 셋 다 `coverage_limits`에 산문 한 줄을 밀어넣어
    # 겨우 내려보냈고 **안 썼어도 아무 검사가 울지 않았다.** 「법무 답이 오면 대상이 바뀐다」가
    # 본체인 케이스에서 3단계만 보면 대상이 확정된 것으로 읽힌다.
    'provisional': Optional({'on': [{'id': str, 'question': str}]}),
    'revisions': Optional([{'change': str, 'reason': str}]),
    'required_experience': Optional([{'id': str, 'text': str, 'jtbd_row_id': str,
                                      'jtbd_cell': str, 'pain_point_ids': [str]}]),
    'coverage_limits': [{'text': str, 'jtbd_cell': str}],
}
SHAPE = {
    'schema_version': (1,), 'case_id': str, 'title': str,
    'status': ('in_progress', 'awaiting_confirmation', 'waiting', 'paused', 'complete'),
    # checked_at is Optional so artifacts written before it existed still load.
    'input_binding': {'jtbd_path': str, 'content_hash': str, 'review_hash': str,
                      'confirmation_turn_id': str, 'project_id': str, 'observed_revision': str,
                      'checked_at': Optional(str)},
    'carried': CARRIED,
    'solution_directions': [{'id': str, 'text': str, 'pain_point_ids': [str]}],
    'rules': [{'id': str, 'condition': str, 'acceptance_id': str, 'acceptance': str,
               'solution_ids': [str]}],
    # origin is Optional so artifacts written before it existed still load. Stage 3 has
    # recorded this since it existed; the stage where the words come from a person did not,
    # so what a planner decided and what a derivation closed looked identical downstream.
    'decisions': [{'id': str, 'statement': str, 'rationale': str, 'source_ids': [str],
                   'origin': Optional(('planner_answered', 'derived', 'inherited'))}],
    'open_questions': [{'id': str, 'question': str, 'affects': [str], 'recommendation': str,
                        'owner': str, 'status': ('open', 'resolved'), 'resolution': str}],
    'scope': {'included': [str], 'excluded': [str]},
    'sources': [SOURCE],
    'issues': [{'id': str, 'question': str, 'target': ('prd', 'jtbd', 'user_experience', 'external'),
                'blocking': bool, 'reason': str, 'areas': [str],
                'action': {'kind': ('ask_user', 'platty', 'web', 'handoff', 'wait'), 'prompt': str},
                **TICKET_FIELDS}],
    **MAP_FIELDS,
    'discovery': {'questions_asked': int},
    'review': {key: ASSESSMENT for key in REVIEW_LABELS},
    'confirmation': {'confirmed': bool, 'turn_id': str, 'statement': str, 'content_hash': str,
                     'review_hash': str},
    'history': [{'change': str, 'reason': str}],
}


def digest(value):
    canonical = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def fingerprints(data):
    payload = {key: data[key] for key in ('schema_version', 'case_id', 'title', 'input_binding',
                                          'carried', 'solution_directions', 'rules', 'decisions',
                                          'open_questions', 'scope', 'sources', 'issues')}
    # When the upstream was checked is session bookkeeping, not content — the binding's
    # identity is the path and the hashes. Keeping it out means recording it does not
    # invalidate a confirmation, the same reason probe_count sits outside the job's hash.
    payload['input_binding'] = {key: value for key, value in payload['input_binding'].items()
                                if key != 'checked_at'}
    if data.get('out_of_scope'):
        payload['out_of_scope'] = data['out_of_scope']
    content = digest(payload)
    return content, digest({'content_hash': content, 'review': data['review']})


def subject_particle(subject):
    """가 or 이, by the final consonant of the last Korean syllable.

    Subjects routinely end in a parenthetical note — 「…한 사람 (참여 이력 0회)」 — and the
    particle follows the last syllable actually spoken, which is inside the note. A subject
    ending in no Korean at all takes neither: guessing there would be worse than saying
    nothing.
    """
    final = planning_context.final_consonant(subject)
    return '' if final is None else ('이' if final else '가')


def carry_from_jtbd(job):
    """The fixed mapping in platty-mcp-jtbd. Judgments are copied; evidence is referenced."""
    element = job['job']
    undecided = {row['element'] for row in (job.get('job_undecided') or [])}
    # 상황·동기는 완결된 절로 적힌다(jtbd-shape.md의 검증 사례). 조사를 덧붙이면 겹친다.
    # 주격 조사는 받침에 따라 갈린다 — 「가」로 고정하면 「사람가」가 나오고, 그 문장이
    # PRD §1의 첫 줄로 기획자 앞에 놓인다.
    subject = element['subject']
    statement = (f"{subject}{subject_particle(subject)} {element['situation']}, "
                 f"{element['motivation']}. 그래서 {element['expected_outcome']}.")
    rows = [(key, row) for key, cell in job['cells'].items() for row in cell['rows']]
    return {
        'job_statement': statement,
        'pain_points': [{'id': pain['id'], 'name': pain['name'], 'decision': pain['decision'],
                         'reason': pain['reason']} for pain in job['pain_points']],
        # 가설 행만 옮기면, 「추론」과 「관찰했지만 출처를 아직 못 구한」 행이 통째로 사라진다.
        # 셋 다 확인되지 않은 것이고, 재주행 세 건이 각각 같은 말을 적었다 — 한 건은 이번에
        # 다루기로 한 페인의 근거 행이 추론이라 **가정이 전부 「안 하는 것」의 가정**이 됐다.
        # 확인 방법이 비어 있으면 비었다고 적는다 — 조용히 떨어뜨리는 것보다 PRD에 보이는 편이 낫다.
        'assumptions': [{'id': f'A-{number:02}', 'text': row['blocker'],
                         'verification': (row['verification_method'].strip()
                                          or '확인 방법 미기재 — 1a가 남기지 않았다'),
                         'jtbd_row_id': row['id']}
                        for number, (_, row) in enumerate(
                            [pair for pair in rows if pair[1]['grade'] in ('hypothesis', 'inferred')
                             or (pair[1]['grade'] == 'observed' and pair[1]['source_pending'])],
                            start=1)],
        # 1a가 결과 쪽을 미정으로 선언하면 그 사실이 그대로 온다. 예전에는 실행기가 지어낸
        # 산문이 `measure`(무엇으로 잴 것인가)로 복사돼 「잴 방법이 없다」가 잴 방법으로 앉았다.
        'hypotheses': [{'id': 'H-01', 'text': element['expected_outcome'],
                        'measure': element['success_criteria'], 'rule_ids': [],
                        **({'undecided': sorted(undecided)} if undecided else {})}],
        # 실행기가 지어서 승인받은 문장인지가 1a에 적혔으면 여기로 넘긴다. 안 넘기면
        # 「기획자가 말한 것」과 구별이 1b에서 사라진다.
        **({'job_origin': dict(job['job_origin'])} if job.get('job_origin') else {}),
        # 이 job 밖으로 밀어둔 이웃은 1a가 유일하게 적을 자리를 갖는다. 안 옮기면 사라진다.
        'excluded': [f"{row['name']} — {row['why_deferred']}"
                     for row in job.get('related_jobs', [])],
        # 기획자가 「무엇이 있어야 하는가」로 적은 문장이 1b로 하나도 넘어가지 않았다. 한
        # 실행에서 1a의 「사진 첨부」가 2단계 화면 요구에 들어가지 않았고, 3단계 화면에
        # 인증 필수 항목을 낼 요소가 없는 채로 4단계 직전까지 갔다. 방향을 쓰는 자리에
        # 원문이 놓여 있어야 떨어뜨린 것을 사람이 본다.
        'required_experience': [
            {'id': f'N-{number:02}', 'text': row['required_experience'],
             'jtbd_row_id': row['id'], 'jtbd_cell': key,
             'pain_point_ids': list(row['pain_point_ids'])}
            for number, (key, row) in enumerate(
                [pair for pair in rows if pair[1]['required_experience'].strip()], start=1)],
        # 1a가 「무엇을 모르는지」를 적는 칸 셋이 전부 하류로 오지 않았다 — 인계 티켓(`issues`),
        # 정정 경위(`history`), 구조적으로 알 수 없는 것(`fog`). 서른 건 주행에서 실행기들이
        # 매번 손으로 다시 옮겨 적었고, 안 적었어도 잡는 검사가 없었다.
        'handed_off': [{'id': row['id'], 'question': row['question'], 'reason': row['reason'],
                        'jtbd_issue_id': row['id']}
                       for row in (job.get('issues') or [])
                       if row.get('target') == 'prd' and not closed(row)],
        'unknowable': [{'text': row.get('note', ''), 'why_not_ticket': row.get('why_not_ticket', '')}
                       for row in (job.get('fog') or [])],
        'revisions': [{'change': row['change'], 'reason': row['reason']}
                      for row in (job.get('history') or [])],

        # 「바꿀 수 없는 것」과 「이번에 안 하는 것」은 1a의 out_of_scope에만 있었고 1b로
        # 오지 않았다. 한 케이스는 기획자가 「법이라 못 바꿔요」라고 못 박은 말을 실행기가
        # coverage_limits 본문에 손으로 적어야 살아남았다.
        'ruled_out': [{'note': row['note'], 'reason': row['reason'],
                       'jtbd_issue_id': row.get('closed_issue_id', ''),
                       # 판정 불가를 기각과 섞으면 1b가 「이미 답이 난 것」으로 읽는다.
                       **({'kind': row['kind']} if row.get('kind') else {})}
                      for row in (job.get('out_of_scope') or [])],
        # 1a가 「어떻게 확인할지」를 적어 두는데 하나도 안 넘어갔다. 확인 방법을 잃으면
        # 1b는 같은 미확인을 처음부터 다시 생각한다.
        'next_checks': [{'text': check, 'jtbd_cell': key}
                        for key, cell in job['cells'].items()
                        for check in cell['next_checks']],
        # 셀 키는 영문 식별자다. 그대로 두면 「social_adopt 미조사」가 사람 읽는 문서로 샌다.
        'coverage_limits': [{'text': limit, 'jtbd_cell': ''}
                            for limit in job['service_context']['coverage_limits']]
                           + [{'text': f'{jtbd.CELL_LABELS[key]} 미조사', 'jtbd_cell': key}
                              for key, cell in job['cells'].items()
                              if cell['status'] == 'unexamined'],
        # 상황에 등장하는 나머지 사람들. 2단계 actors가 여기서 출발한다. 비어 있으면 칸 자체를
        # 만들지 않는다 — 이 칸이 생기기 전에 쓴 산출물이 「복사가 달라졌다」로 울지 않도록.
        **({'other_actors': [dict(row) for row in job['other_actors']]}
           if job.get('other_actors') else {}),
        # 잠정이면 무엇을 기다리는지까지 함께 간다. 잠정이 아니면 칸 자체를 만들지 않는다 —
        # 이 칸이 생기기 전에 쓴 산출물이 「복사가 달라졌다」로 울지 않도록.
        **({'provisional': {'on': [{'id': row['id'], 'question': row['question']}
                                   for row in job['issues']
                                   if row['id'] in (job.get('provisional_on') or [])]}}
           if job.get('job_status') == 'provisional' else {}),
    }


def decision_origin_gaps(data):
    """A decision the planner answered has to name the answer it came from.

    기획자가 **1a에서** 한 말을 1b 결정의 근거로 쓸 때 이 검사가 「이 단계의」 `provider: user`
    출처를 요구했다. `prd.SOURCE`에 `provider: jtbd`가 있는데도. 4차에 `unrecorded_interview_gaps`
    에서 같은 병을 고쳤는데(「1a 답변을 1b에 복사하도록 유도한다」) 여기는 못 받았고, 그래서
    「기획자가 직접 말했다」가 `inherited`로 내려가 **기계가 읽는 값에서 사라졌다.**
    말한 사람이 기획자면 그 말이 어느 단계 파일에 적혀 있든 기획자가 말한 것이다.
    """
    users = {row['id'] for row in data.get('sources', [])
             if row.get('provider') in ('user', 'jtbd')}
    return [f"$.decisions[{row['id']}]: 기획자가 답했다고 적었으면 그 답변을 출처로 가리켜야 한다"
            for row in data.get('decisions', [])
            if row.get('origin') == 'planner_answered'
            and not (set(row.get('source_ids', [])) & users)]


def carry_fidelity_gaps(data, job):
    """Is the carry still what the job said?

    「1b는 기계 복사 — 판단은 복사되고 근거는 참조된다」 is the premise of this stage, and
    nothing checked it. Editing the carry breaks the confirmation hash, but re-confirming
    afterwards passes clean, so a prd could claim a pain point the job never had.

    `hypotheses[].rule_ids` is excluded: the carry arrives with it empty and connecting a
    success hypothesis to the rules that serve it is this stage's own work.
    """
    if not job:
        return []
    try:
        # Only compare against the job this binding actually names. A file that no longer
        # matches the recorded hash is a stale binding, and that already has its own check —
        # reporting it twice would say the carry was edited when the upstream moved instead.
        if jtbd.fingerprints(job)[0] != (data.get('input_binding') or {}).get('content_hash'):
            return []
        fresh = carry_from_jtbd(job)
    except (KeyError, TypeError):
        return []

    def without_rules(value):
        return [{key: cell for key, cell in row.items() if key != 'rule_ids'}
                for row in value]

    gaps = []
    for key in ('job_statement', 'pain_points', 'assumptions', 'coverage_limits', 'job_origin',
                'next_checks', 'required_experience', 'ruled_out',
                'handed_off', 'unknowable', 'revisions', 'other_actors', 'provisional'):
        if data['carried'].get(key) != fresh.get(key):
            gaps.append(f'$.carried.{key}: 상위 job과 다르다 — 이 칸은 기계 복사이고 '
                        '고쳐 쓰는 자리가 아니다')
    if without_rules(data['carried']['hypotheses']) != without_rules(fresh['hypotheses']):
        gaps.append('$.carried.hypotheses: 상위 job과 다르다 — rule_ids 말고는 복사다')
    return gaps


def load_upstream_job(data):
    """The job this prd bound, or None when it cannot be read from here."""
    binding = data.get('input_binding') or {}
    try:
        return load_json(Path(binding['jtbd_path']))
    except (OSError, UnicodeError, ValueError, KeyError):
        return None


def validate(data):
    errors, readiness = [], []
    # 모르는 칸 하나가 내용 검사를 통째로 끄던 자리다 — 덜어낸 사본으로 끝까지 검사하고
    # 그 칸은 오류로 남는다.
    errors, pruned = shape_errors(data, SHAPE)
    if errors and pruned is None:
        return invalid_report(errors)
    data = pruned if pruned is not None else data
    content_hash, review_hash = fingerprints(data)

    def require(condition, path, message, destination=errors):
        if not condition:
            destination.append(f'{path}: {message}')

    def nonblank(value, path, destination=errors):
        require(bool(value.strip()), path, 'nonempty text required', destination)

    def refs(ids, lookup, path):
        require(len(ids) == len(set(ids)), path, 'duplicate references')
        for key in ids:
            require(key in lookup, path, f'unknown reference {key!r}')

    nonblank(data['title'], '$.title')
    require(bool(re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', data['case_id'])), '$.case_id',
            'lowercase letters, numbers, and hyphens required')
    sources, issues = {}, {}
    for collection, index, keys in (('sources', sources, ('reference', 'excerpt')),
                                   ('issues', issues, ('question', 'reason'))):
        for number, item in enumerate(data[collection]):
            path = f'$.{collection}[{number}]'
            nonblank(item['id'], path + '.id')
            require(item['id'] not in index, path + '.id', 'duplicate id')
            index[item['id']] = item
            for key in keys:
                nonblank(item[key], path + '.' + key)
    for number, source in enumerate(data['sources']):
        path = f'$.sources[{number}]'
        require((source['provider'] == 'user') == (source['kind'] == 'user'), path,
                'user kind/provider must agree')
        require((source['provider'] == 'jtbd') == (source['kind'] == 'imported'), path,
                'imported kind and provider must agree')
        try:
            valid = datetime.fromisoformat(
                source['retrieved_at'].replace('Z', '+00:00')).utcoffset() is not None
        except ValueError:
            valid = False
        require(valid, path + '.retrieved_at', 'ISO 8601 timestamp with timezone required')
    errors.extend(map_gaps(data, set(sources)))

    binding = data['input_binding']
    for key in ('jtbd_path', 'content_hash', 'review_hash', 'confirmation_turn_id'):
        nonblank(binding[key], '$.input_binding.' + key, readiness)

    carried = data['carried']
    nonblank(carried['job_statement'], '$.carried.job_statement', readiness)
    pains = {pain['id']: pain for pain in carried['pain_points']}
    require(bool(pains), '$.carried.pain_points', 'the job carries at least one pain point',
            readiness)
    for number, pain in enumerate(carried['pain_points']):
        # deferred는 1a가 내린 판정이다 — 「이번 범위에서 미룬다」. 이 자리가 address/rejected만
        # 받는 바람에, 1a가 통과시킨 값을 carry가 기계 복사해 온 순간 1b의 모든 저장이 죽었다.
        # 열 건을 다시 태워 보니 여섯 건이 여기서 멈췄고, 고칠 수도 되돌릴 수도 없었다.
        require(pain['decision'] != 'open', f'$.carried.pain_points[{number}]',
                'a carried pain point still says open; the job rules it before the prd carries it')
    for number, row in enumerate(carried['assumptions']):
        nonblank(row['verification'], f'$.carried.assumptions[{number}].verification')
    for number, row in enumerate(carried['hypotheses']):
        nonblank(row['measure'], f'$.carried.hypotheses[{number}].measure', readiness)

    # §4: every addressed pain gets a direction, and no direction invents a pain.
    addressed = {name for name, pain in pains.items() if pain['decision'] == 'address'}
    served = set()
    for number, row in enumerate(data['solution_directions']):
        path = f'$.solution_directions[{number}]'
        nonblank(row['text'], path + '.text')
        refs(row['pain_point_ids'], pains, path + '.pain_point_ids')
        require(bool(row['pain_point_ids']), path + '.pain_point_ids',
                'a direction without a pain point invents intent; return to jtbd', readiness)
        served.update(row['pain_point_ids'])
    for name in sorted(addressed - served):
        readiness.append(f'$.solution_directions: addressed pain {name} has no direction')
    # 「이번엔 아무것도 만들지 않고 규모부터 잰다」를 기획자가 고른 자리에서, `address` 페인이
    # 하나도 없으면 가설이 규칙에 닿을 수 없어 1b가 **어떤 방법으로도 끝나지 않았다** —
    # 정직하면 멈추고 지어내면 통과했다. 1a에는 이 상태를 담는 값이 있고(`provisional`)
    # 여기에는 없었다. 아무것도 다루지 않기로 한 것도 판정이고, 그 판정이 적히면 끝난다.
    if not addressed and not data['solution_directions']:
        require(bool(data['open_questions']) or bool(carried.get('provisional')),
                '$.solution_directions',
                '다루기로 한 페인이 하나도 없다 — 이번 범위가 정말 「아무것도 만들지 않는다」면 '
                '그 판정을 $.open_questions에 남기거나 상위를 잠정(provisional)으로 두고 온다',
                readiness)

    directions = {row['id'] for row in data['solution_directions']}
    for number, rule in enumerate(data['rules']):
        path = f'$.rules[{number}]'
        for key in ('condition', 'acceptance_id', 'acceptance'):
            nonblank(rule[key], f'{path}.{key}')
        refs(rule['solution_ids'], dict.fromkeys(directions), path + '.solution_ids')
        require(bool(rule['solution_ids']), path + '.solution_ids',
                'a rule must trace to a solution direction', readiness)
    rules = {rule['id'] for rule in data['rules']}
    by_rule = {rule['id']: rule for rule in data['rules']}
    by_direction = {row['id']: row for row in data['solution_directions']}
    for number, row in enumerate(carried['hypotheses']):
        path = f'$.carried.hypotheses[{number}].rule_ids'
        refs(row['rule_ids'], dict.fromkeys(rules), path)
        # 잠정 job은 결과 쪽이 미정이라서 잠정이다. 그런데 carry가 바로 그 두 칸으로 가설을
        # 만들고, 검증기가 그것을 뒷받침할 규칙을 요구했다 — 「정해진 적 없다」가 본문인 가설에.
        # 5차가 이 모순을 실측했다. 미정으로 **선언된** 가설은 규칙을 요구하지 않는다.
        require(bool(row['rule_ids']) or bool(row.get('undecided')), path,
                'a success hypothesis must reach the rules that serve it — 1a가 결과 쪽을 '
                '아직 못 정했다면 $.job_undecided에 선언하고, 그 선언이 여기로 따라온다',
                readiness)
        # Existence was the whole check, and one replayed run wrote that it invented a link it
        # believed to be near-false just to satisfy it. Follow the link the rest of the way:
        # rule → direction → pain. Whether the rule truly moves the measure stays a human
        # judgment (P4), but a link that reaches nothing the job decided to address is empty.
        reached = {name for rule in row['rule_ids']
                   for direction in by_rule.get(rule, {}).get('solution_ids', [])
                   for name in by_direction.get(direction, {}).get('pain_point_ids', [])}
        # Only when there is a link to follow. On an empty list the line above already says the
        # whole truth, and printing both made one run read two different faults into one field.
        require(not row['rule_ids']
                or any(pains.get(name, {}).get('decision') == 'address' for name in reached),
                path, 'none of the linked rules reaches a pain point this job decided to '
                'address', readiness)
    for number, decision in enumerate(data['decisions']):
        path = f'$.decisions[{number}]'
        for key in ('statement', 'rationale'):
            nonblank(decision[key], f'{path}.{key}')
        refs(decision['source_ids'], sources, path + '.source_ids')
    for number, row in enumerate(data['open_questions']):
        path = f'$.open_questions[{number}]'
        nonblank(row['question'], path + '.question')
        nonblank(row['owner'], path + '.owner')
        require(row['status'] == 'open' or row['resolution'].strip(), path + '.resolution',
                'a resolved question records its resolution')
    for key in ('included', 'excluded'):
        require(bool(data['scope'][key]), '$.scope.' + key, 'scope required', readiness)

    asked = data['discovery']['questions_asked']
    require(0 <= asked <= DISCOVERY_BUDGET, '$.discovery.questions_asked',
            f'product discovery is capped at {DISCOVERY_BUDGET} questions in this stage')

    for number, issue in enumerate(data['issues']):
        path = f'$.issues[{number}]'
        nonblank(issue['action']['prompt'], path + '.action.prompt')
        handoff = issue['action']['kind'] == 'handoff'
        require(handoff == (issue['target'] == 'user_experience'), path,
                'handoff must target user_experience')
        if not closed(issue) and (issue['blocking'] or issue['target'] == 'prd'):
            readiness.append(path + ': unresolved prd or blocking issue')

    for key, assessment in data['review'].items():
        path = '$.review.' + key
        refs(assessment['criteria'], dict.fromkeys(CRITERIA), path + '.criteria')
        refs(assessment['example_ids'], dict.fromkeys(EXAMPLES), path + '.example_ids')
        refs(assessment['evidence_ids'], sources, path + '.evidence_ids')
        refs(assessment['issue_ids'], issues, path + '.issue_ids')
        if assessment['verdict'] != 'pending':
            nonblank(assessment['rationale'], path + '.rationale')
            require(assessment['content_hash'] == content_hash, path + '.content_hash',
                    'stale assessment; re-evaluate current content', readiness)
        require(assessment['verdict'] == 'suitable', path + '.verdict',
                'qualitative review not suitable', readiness)
    for number, entry in enumerate(data['history']):
        for key in ('change', 'reason'):
            nonblank(entry[key], f'$.history[{number}].{key}')

    readiness.extend(carry_fidelity_gaps(data, load_upstream_job(data)))
    readiness.extend(decision_origin_gaps(data))
    ready = not errors and not readiness
    completion = list(readiness)
    confirmation = data['confirmation']
    require(confirmation['confirmed'], '$.confirmation', 'user confirmation missing', completion)
    if confirmation['confirmed']:
        require(confirmation['content_hash'] == content_hash, '$.confirmation.content_hash',
                'confirmation does not cover current content', completion)
        require(confirmation['review_hash'] == review_hash, '$.confirmation.review_hash',
                'confirmation does not cover current reviews', completion)
    require(data['status'] == 'complete', '$.status', 'not complete', completion)
    complete = ready and not completion
    if data['status'] == 'complete' and not complete:
        errors.append('$.status: declared complete but completion requirements are unmet')
    return {'valid': not errors, 'baseline_ready': not errors, 'ready_for_confirmation': ready,
            'complete': complete, 'errors': errors, 'completion_errors': completion,
            'content_hash': content_hash, 'review_hash': review_hash,
            'questions_remaining': max(0, DISCOVERY_BUDGET - asked),
            # 그릴링은 1a에만 살았다. 1b도 기획자에게 묻는 단계인데(예산 2) 그 답을
            # 읽는 검사가 하나도 없어서, 원문을 성실히 남긴 주행일수록 아무것도 얻지 못했다.
            # 규칙은 같은 것을 본다 — 말한 사람이 같기 때문이다. 48개 산출물에 걸어 네 건이
            # 울었고 그중 하나가 그 유명한 「푸시 알림으로 채우면 됩니다」였다.
            'planner_language': jtbd.planner_language_findings(data),
            'next_actions': [{'id': issue['id'], 'areas': issue['areas'], 'action': issue['action']}
                             for issue in data['issues'] if not closed(issue)]}


def render(data, report=None):
    report = report or validate(data)
    carried = data['carried']
    lines = [f"# {markdown(data['title'])}", '',
             f"사례: {markdown(data['case_id'])} · 상태: {data['status']}", '',
             'JSON 원본에서 생성한 읽기용 문서입니다. 수정은 원본에 반영하세요.', '',
             '## 1. 사용자 과업', '', '> ' + markdown(carried['job_statement']), '',
             f"`jtbd.json`({markdown(data['input_binding']['jtbd_path'])})에서 그대로 가져왔다.", '',
             '## 2. 페인포인트', '', '| ID | 페인포인트 | 판정 | 사유 |', '| --- | --- | --- | --- |']
    lines += [f"| {markdown(p['id'])} | {markdown(p['name'])} | {p['decision']} | "
              f"{markdown(p['reason'])} |" for p in carried['pain_points']]
    lines += ['', '## 3. 범위', '', '| 포함 | 제외 |', '| --- | --- |']
    included, excluded = data['scope']['included'], data['scope']['excluded']
    for index in range(max(len(included), len(excluded))):
        left = markdown(included[index]) if index < len(included) else ''
        right = markdown(excluded[index]) if index < len(excluded) else ''
        lines.append(f'| {left} | {right} |')
    lines += ['', '## 4. 제안하는 해결 방향', '']
    for row in data['solution_directions']:
        lines += [f"### {markdown(row['id'])}", '', markdown(row['text']), '',
                  '다루는 페인포인트: ' + ', '.join(map(markdown, row['pain_point_ids'])), '']
    lines += ['## 5. 제품 규칙과 수용 기준', '',
              '| 규칙 | 조건과 결과 | 수용 기준 | 검증 가능한 결과 |', '| --- | --- | --- | --- |']
    lines += [f"| {markdown(r['id'])} | {markdown(r['condition'])} | "
              f"{markdown(r['acceptance_id'])} | {markdown(r['acceptance'])} |"
              for r in data['rules']]
    lines += ['', '## 6. 확정 결정', '', '| ID | 결정 | 근거 |', '| --- | --- | --- |']
    lines += [f"| {markdown(d['id'])} | {markdown(d['statement'])} | {markdown(d['rationale'])} |"
              for d in data['decisions']]
    ruled = carried.get('ruled_out') or []
    lines += ['', '### 1a가 범위 밖으로 정한 것', '']
    lines += ['- ' + markdown(row['note']) + ' — ' + markdown(row['reason'])
              + (' *(판정 불가 — 기각이 아니다)*' if row.get('kind') == 'undecidable' else '')
              for row in ruled] or ['(없음)']
    lines += ['', '### 1a가 말한 필요한 경험', '',
              '| ID | 있어야 하는 것 | 페인포인트 | 출처 행 |', '| --- | --- | --- | --- |']
    lines += [f"| {markdown(row['id'])} | {markdown(row['text'])} | "
              f"{', '.join(map(markdown, row['pain_point_ids'])) or '—'} | "
              f"{markdown(row['jtbd_row_id'])} |"
              for row in (carried.get('required_experience') or [])]
    lines += ['', '## 7. 가정과 미결 질문', '', '### 가정', '',
              '| ID | 가정 | 확인 방법 | 출처 행 |', '| --- | --- | --- | --- |']
    lines += [f"| {markdown(a['id'])} | {markdown(a['text'])} | {markdown(a['verification'])} | "
              f"{markdown(a['jtbd_row_id'])} |" for a in carried['assumptions']]
    lines += ['', '### 미결 질문', '',
              '| ID | 질문 | 영향 | 추천안 | 소유자 | 상태 |', '| --- | --- | --- | --- | --- | --- |']
    lines += [f"| {markdown(q['id'])} | {markdown(q['question'])} | "
              f"{', '.join(map(markdown, q['affects']))} | {markdown(q['recommendation'])} | "
              f"{markdown(q['owner'])} | {q['status']} |" for q in data['open_questions']]
    lines += ['', '## 8. 성공 가설', '', '| ID | 기대 결과 | 지표 | 연결 규칙 |',
              '| --- | --- | --- | --- |']
    lines += [f"| {markdown(h['id'])} | {markdown(h['text'])} | {markdown(h['measure'])} | "
              f"{', '.join(map(markdown, h['rule_ids']))} |" for h in carried['hypotheses']]
    lines += ['', '## 9. 조사 한계', '']
    lines += ['- ' + markdown(row['text'])
              + (f" ({markdown(jtbd.CELL_LABELS.get(row['jtbd_cell'], row['jtbd_cell']))})"
                 if row['jtbd_cell'] and row['jtbd_cell'] not in row['text'] else '')
              for row in carried['coverage_limits']]
    # 1a가 「어떻게 확인할지」까지 적어 둔다. 그걸 여기 두지 않으면 1b가 같은 미확인을
    # 처음부터 다시 생각한다.
    checks = carried.get('next_checks') or []
    lines += ['', '### 1a가 남긴 다음 확인', '']
    lines += ['- ' + markdown(row['text'])
              + (f" ({markdown(jtbd.CELL_LABELS.get(row['jtbd_cell'], row['jtbd_cell']))})"
                 if row['jtbd_cell'] else '')
              for row in checks] or ['(없음)']
    lines += ['', '## 검증', '',
              f"구조 유효: {report['valid']} · 확인 준비: {report['ready_for_confirmation']} · "
              f"완료: {report['complete']} · 남은 질문 예산: {report['questions_remaining']}", '']
    lines += ['- ' + markdown(error) for error in report['errors'] + report['completion_errors']]
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for command in ('init', 'validate', 'render', 'fingerprint', 'carry'):
        sub = commands.add_parser(command)
        sub.add_argument('path', type=Path)
        if command == 'carry':
            sub.add_argument('--jtbd', type=Path, required=True)
        if command == 'validate':
            gate = sub.add_mutually_exclusive_group()
            gate.add_argument('--require-complete', action='store_true')
            gate.add_argument('--require-ready', action='store_true')
        if command == 'render':
            sub.add_argument('-o', '--output', type=Path)
    args = parser.parse_args()
    try:
        if args.command == 'init':
            data = load_json(TEMPLATE)
            data['case_id'] = re.sub(r'[^a-z0-9]+', '-', args.path.parent.name.lower()).strip('-') or 'untitled'
            args.path.parent.mkdir(parents=True, exist_ok=True)
            with args.path.open('x', encoding='utf-8') as out:
                json.dump(data, out, ensure_ascii=False, indent=2)
                out.write('\n')
            print(str(args.path))
            return 0
        if args.command == 'carry':
            job = load_json(args.jtbd)
            report = jtbd.validate(job)
            if not report['complete']:
                raise ValueError('jtbd must be complete and confirmed before the prd stage')
            data = load_json(args.path) if args.path.exists() else load_json(TEMPLATE)
            data['carried'] = carry_from_jtbd(job)
            content, review = jtbd.fingerprints(job)
            data['input_binding'] = {
                'jtbd_path': str(args.jtbd.resolve()), 'content_hash': content,
                'review_hash': review, 'confirmation_turn_id': job['confirmation']['turn_id'],
                'project_id': job['service_context']['project_id'],
                'observed_revision': job['service_context']['observed_revision'],
                'checked_at': job['service_context']['checked_at']}
            with args.path.open('w', encoding='utf-8') as out:
                json.dump(data, out, ensure_ascii=False, indent=2)
                out.write('\n')
            print(str(args.path))
            return 0
        data = load_json(args.path)
        if args.command == 'fingerprint':
            errors = []
            check_shape(data, SHAPE, '$', errors)
            if errors:
                print(json.dumps(invalid_report(errors), ensure_ascii=False, indent=2))
                return 1
            content, review = fingerprints(data)
            print(json.dumps({'content_hash': content, 'review_hash': review}, indent=2))
            return 0
        report = validate(data)
        if args.command == 'validate':
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 0 if report['valid'] and (not args.require_complete or report['complete']) and (
                not args.require_ready or report['ready_for_confirmation']) else 1
        if not report['valid']:
            print(json.dumps(report, ensure_ascii=False, indent=2), file=sys.stderr)
            return 1
        content = render(data, report)
        if args.output:
            args.output.write_text(content, encoding='utf-8')
        else:
            print(content, end='')
        return 0
    except (OSError, UnicodeError, ValueError, RecursionError) as exc:
        print(json.dumps(invalid_report([str(exc)]), ensure_ascii=False, indent=2),
              file=sys.stdout if args.command in ('validate', 'fingerprint') else sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
