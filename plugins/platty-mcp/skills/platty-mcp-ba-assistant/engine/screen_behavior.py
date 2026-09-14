#!/usr/bin/env python3
"""Validate and render grounded Screen behavior screen and element behavior records."""
import argparse
from legacy import interview3 as _legacy
from legacy import screen_behavior_v2 as _v2
import copy
import difflib
from collections import Counter
from datetime import datetime
import html
import json
from pathlib import Path
import re
import sys

import planning_context
import user_experience
from experience_verification import settled_upstream
from planning_context import (MAP_FIELDS, TICKET_FIELDS, Optional, closed, finding_note,
                              load_json, map_gaps, object_particle, recorded_finding,
                              shape_errors)
from user_experience import digest
from paths import PLUGIN_ROOT, WORKSPACE_ROOT

ROOT = PLUGIN_ROOT
TEMPLATE = ROOT / 'schemas/screen-behavior.template.json'
CRITERIA = tuple(f'S{i}' for i in range(1, 9))
CRITERION_DEFINITIONS = {
    'S1': '목적 연속성 — 화면과 요소의 목적이 상위 화면 요구에서 나왔고 새 목적을 만들지 않았는가',
    'S2': '정보·행동 도달 — 상위가 선언한 정보와 행동이 실제 요소에 닿았는가',
    'S3': '상태 표현 — 상태가 있는 요소가 축을 갖고, 없는 요소는 왜 없는지 적혔는가',
    'S4': '상호작용 규칙 — 반복 항목과 집계·의존 규칙이 조건 행으로 표현됐는가',
    'S5': '전이 재현성 — 전이의 전후 상태가 렌더 케이스로 실제 재현되는가',
    'S6': '상태 구분 — 렌더 케이스가 서로 다른 화면을 내고 종료마다 다음 걸음이 있는가',
    'S7': '근거와 소유 — 결정 소유가 파생 범위 안에 있고 출처가 실제를 가리키는가',
    'S8': '인계 준비 — 화면마다 인계가 있고 참조 전이와 미결이 명시됐는가',
}
EXAMPLES = tuple(f'SB{i:02}' for i in range(1, 13))
CRITERION_EXAMPLES = {
    'S1':{'SB01'}, 'S2':{'SB01','SB02','SB11'}, 'S3':{'SB03','SB07','SB11'},
    'S4':{'SB03','SB04','SB06','SB10'}, 'S5':{'SB05','SB06','SB08'},
    'S6':{'SB02','SB07','SB08'}, 'S7':{'SB04','SB09','SB12'}, 'S8':{'SB09','SB10'},
}
COVERAGE_DIMENSIONS = ('visibility', 'availability', 'value_selection', 'disclosure',
    'interaction', 'validation', 'operation', 'content', 'freshness', 'continuity', 'feedback_access')
VALIDATOR_VERSION = 'screen-behavior-3'
RUBRIC_VERSION = 'S1-S8-v1'
EXAMPLE_VERSION = 'SB01-SB12-v1'


class OneOf:
    """A closed union for nullable references and repeat-template declarations."""
    def __init__(self, *shapes):
        self.shapes = shapes


def check_shape(value, shape, path, errors):
    if isinstance(shape, OneOf):
        for choice in shape.shapes:
            candidate = []
            check_shape(value, choice, path, candidate)
            if not candidate:
                return
        errors.append(path + ': no matching closed union shape')
    elif isinstance(shape, dict):
        if not isinstance(value, dict):
            errors.append(path + ': object required'); return
        for key in sorted(value.keys() - shape.keys()):
            near = difflib.get_close_matches(key, list(shape), n=1, cutoff=0.6)
            errors.append(f'{path}.{key}: unknown field'
                          + (f" — 「{near[0]}」를 쓰려던 것인가" if near else ''))
        for key, child in shape.items():
            if isinstance(child, Optional):
                if key in value:
                    check_shape(value[key], child.shape, f'{path}.{key}', errors)
            elif key not in value:
                errors.append(f'{path}.{key}: required field missing')
            else:
                check_shape(value[key], child, f'{path}.{key}', errors)
    elif isinstance(shape, list):
        if not isinstance(value, list):
            errors.append(path + ': array required'); return
        for i, child in enumerate(value):
            check_shape(child, shape[0], f'{path}[{i}]', errors)
    else:
        planning_context.check_shape(value, shape, path, errors)


NULL_REF = OneOf(str, type(None))
ASSIGNMENT = {'scope_id':str, 'item_ref':NULL_REF, 'axis_id':str, 'value_id':str}
# 「전이해도 이 값은 그대로 남는다」를 축 배정으로만 적을 수 있었다. 그래서 축이 없는 요소 —
# 브랜드가 적어 넣은 사유 원문 같은 것 — 은 보존을 **선언할 자리가 없었고**, 한 주행에서
# 보존으로 적을 수 있었던 것은 참여자가 직접 입력한 값뿐이었다. 제3자가 채운 값이야말로
# 그 칸이 필요한 자리다: 참여자는 그것을 고칠 수 없으므로 바뀌면 바로 사고다.
PRESERVED_CONTENT = {'scope_id':str, 'item_ref':NULL_REF, 'content':str,
                     'filled_by':('participant','third_party','system')}
PRESERVED = OneOf(ASSIGNMENT, PRESERVED_CONTENT)
SOURCE = copy.deepcopy(user_experience.SOURCE)
IMPORTED_PROVIDERS = user_experience.IMPORTED_PROVIDERS + ('user_experience',)
# The pack is an authority the planner never asserts, so it is its own provider.
SOURCE['provider'] += ('user_experience', 'design_knowledge')
REVIEW = {'id':str, 'criterion_id':CRITERIA, 'target_refs':[str],
    'verdict':('pending','suitable','needs_work','insufficient_evidence'),
    'rationale':str, 'example_ids':[str], 'source_ids':[str], 'issue_ids':[str], 'content_hash':str}
BINDING = {'path':str,'content_hash':str,'review_hash':str,'confirmation_turn_id':str}
PACKET = copy.deepcopy(user_experience.SHAPE['decision_packets'][0])
PACKET['decision_scope'] = {'target_refs':[str]}
SHAPE = {
    'schema_version':(3,), 'model_profile':('screen_element_behavior_v1',),
    'case_id':str,'title':str,'status':user_experience.SHAPE['status'],
    'input_binding':{'planning_context':Optional(BINDING),'prd':Optional(BINDING),'user_experience':BINDING},
    'evidence_status':copy.deepcopy(user_experience.SHAPE['evidence_status']),
    # Optional so pre-derivation cases stay valid; required once the pack is cited.
    'knowledge_binding': Optional({'pack_id': str, 'version': str, 'content_hash': str}),
    'sources':[SOURCE],
    'decision_inventory':[{'id':str,'target_refs':[str],
        'classification':('inherited','current_service','standard_derived','recommended','planner_required'),
        'ux_difference':('none','meaningful'),'alternatives':[str],
        'status':('documented','open','selected'),'decision_id':NULL_REF,'decision_packet_id':NULL_REF,
        'source_ids':[str],'rationale':str}],
    'decisions':[{'id':str,'statement':str,'origin':('inherited','derived','planner_decided','proposed'),
        'source_ids':[str],'parent_refs':[str],'rationale':str,'status':('proposed','accepted','superseded')}],
    'inventory_links':[{'input_ref':str,# deferred: 상위가 이 항목을 아직 정하지 않아 연결할 수 없다. 2단계 coverage_checks에는
        # 있는데 여기에는 없어서 실행기가 external_handoff로 우회했다.
        'disposition':('mapped','external_handoff','not_applicable','deferred'),
        'screen_ids':[str],'element_ids':[str],'reason':str,'source_ids':[str]}],
    # 2단계는 「기존 화면을 고친다(changed)」와 「새로 만든다(new)」를 접점에 적는데, 그 구분이
    # 3단계 화면까지 내려오지 않았다. 7차 실측: 산출물이 「잔액 자리가 바뀐다」고 적어 놓고
    # **무엇이 어떻게 바뀌는지는 아무 데도 없었고**, 와이어프레임은 새 화면 하나만 그렸다.
    # 인계받는 디자이너는 「기존 컴포넌트 수정」과 「새 화면」을 구별할 수 없다.
    #
    # `origin`은 2단계 접점의 `status`에서 온다 — 화면이 스스로 고르는 값이 아니다.
    'screens':[{'id':str,'name':str,'actor_ids':[str],'touchpoint_refs':[str],
                'origin':Optional(('current','changed','new','unverified')),
        'view_requirement_refs':[str],'purpose':str,'entry_refs':[str],'exit_refs':[str],'source_ids':[str]}],
    'elements':[{'id':str,'screen_id':str,'parent_id':NULL_REF,'name':str,'semantic_type':str,
        'purpose':str,'information_refs':[str],'action_refs':[str],
        # C-5의 여섯 번째 자리. 「반복 없음」과 「반복은 있는데 구조를 모른다」가 같은
        # `none`으로 눌렸다 — 상위가 집합 규칙을 안 정한 화면에서 실행기가 거짓을 적어야 했다.
        # `undetermined`에 **왜 모르는지**를 적을 자리가 없었다. 4차에 값만 만들고 이유 칸을
        # 안 만들었고, 5차의 한 실행기는 「반복이 있는지조차 모른다」에 이 값을 썼다 —
        # 가장 가까운 값이었지 맞는 값은 아니었다. 무엇을 모르는지가 적히면 구별된다.
        'repetition':OneOf(('none',), {'unknown': str},
                           {'item_scope':str,'membership_rule_id':str,'aggregate_rule_ids':[str]}),
        'profile_ids':[str],'source_ids':[str],'decision_ids':[str]}],
    'state_profiles':[{'id':str,'version':str,'semantic_types':[str],
        'axis_candidates':[str],'event_candidates':[str],'source_ids':[str],'overrides':[str]}],
    'state_axes':[{'id':str,'scope_id':str,'dimension':COVERAGE_DIMENSIONS,
        'values':[{'id':str,'label':str,'meaning':str}],
        'initial_conditions':[{'condition':str,'value_id':str,'rationale':str}],
        'source_ids':[str],'decision_ids':[str]}],
    'transitions':[{'id':str,'target_scope_ids':[str],
        'target_selector':{'kind':('none','item','group'),'symbol':str,'rule_id':str},
        'event':str,'preconditions':[str],'before':[ASSIGNMENT],'after':[ASSIGNMENT],
        'observable_result':str,'allowed_actions':[str],'preserved_values':[PRESERVED],
        'feedback':str,'focus_result':str,'parent_transition_refs':[str],
        'source_ids':[str],'decision_ids':[str]}],
    'constraints':[{'id':str,'scope_ids':[str],'condition':str,'required_outcome':str,
        'forbidden_combinations':[[ASSIGNMENT]],'rationale':str,'source_ids':[str],'decision_ids':[str]}],
    'interaction_rules':[{'id':str,'kind':('aggregate','dependency','priority','preservation'),
        'input_scope_ids':[str],'output_scope_ids':[str],
        'condition_rows':[{'id':str,'when':[ASSIGNMENT],'effects':[ASSIGNMENT],
            'transition_ids':[str],'scenario_ids':[str]}], 'source_ids':[str],'decision_ids':[str]}],
    'coverage_checks':[{'scope_id':str,'dimension':COVERAGE_DIMENSIONS,
        'status':('open','applicable','not_applicable','deferred'),'rationale':str,'source_ids':[str],
        'axis_ids':[str],'transition_ids':[str],'rule_ids':[str],'scenario_ids':[str],'issue_ids':[str]}],
    'scenarios':[{'id':str,'kind':('normal','alternative','error','recovery','boundary'),
        'parent_scenario_refs':[str],'initial_case_id':str,
        'steps':[{'transition_id':str,'item_bindings':[{'symbol':str,'item_refs':[str]}],
            'condition_row_ids':[str],'expected_observations':[str]}],
        'expected_case_id':str,'source_ids':[str]}],
    'render_cases':[{'id':str,'screen_id':str,'title':str,
        'sample_items':[{'id':str,'template_scope_id':str,'traits':[str]}],
        'sample_groups':[{'id':str,'item_ids':[str],'membership_rule_id':str}],
        'state_assignments':[ASSIGNMENT],'visible_information':[str],
        'available_actions':[str],'blocked_actions_with_reasons':[str],
        'focus_expectation':str,'scenario_ids':[str],'equivalence_rationale':str}],
    'design_handoffs':[{'id':str,'screen_id':str,'element_ids':[str],'semantic_pattern':str,
        'required_state_refs':[str],'render_case_ids':[str],'interaction_refs':[str],
        'accessibility_expectations':[str],'candidate_design_system_ref':str,
        'mapping_status':('unmapped','candidate','verified'),'gap':str,'owner':str}],
    'decision_packets':[PACKET],
    'issues':[{'id':str,'question':str,'target':('jtbd','prd','planning_context','user_experience','screen_behavior','wireframe','development'),
        'blocking':bool,'reason':str,'areas':[str], 'target_refs':[str],
        'action':copy.deepcopy(user_experience.SHAPE['issues'][0]['action']), **TICKET_FIELDS}],
    **MAP_FIELDS,
    'reviews':[REVIEW],'review':{key:REVIEW for key in CRITERIA},
    'confirmation':copy.deepcopy(user_experience.SHAPE['confirmation']),
    'history':copy.deepcopy(user_experience.SHAPE['history']),
}


def fingerprints(data):
    if isinstance(data,dict) and type(data.get("schema_version")) is int and data["schema_version"]==2:
        return _v2.fingerprints(data)
    if isinstance(data, dict) and type(data.get("schema_version")) is int and data["schema_version"] == 1:
        return _legacy.fingerprints(data)
    content = digest({key:value for key,value in data.items()
        if key not in ('status','reviews','review','confirmation','history','fog')})
    return content, digest({'content_hash':content,'reviews':data['reviews'],'review':data['review']})


def input_inventory(source):
    """Independent, stable references for every declared input display and action."""
    result = {f'touchpoint:{row["id"]}' for row in source['touchpoints']}
    for row in source['view_requirements']:
        result.add(f'view:{row["id"]}')
        for field, name in (('information','information'),('actions','action')):
            result.update(f'view:{row["id"]}:{name}:{i}' for i in range(len(row[field])))
    for row in source['scenarios']:
        for step in row['steps']:
            prefix = f'scenario:{row["id"]}:step:{step["id"]}'
            result.add(prefix + ':action')
            for field, name in (('information_shown','information'),('choices','choice')):
                result.update(f'{prefix}:{name}:{i}' for i in range(len(step[field])))
    return result


# The user experience names its own upstream, so stage 3 reads whichever one it was built on.
UPSTREAM_MODULES = {'planning_context': planning_context, 'prd': None}


def _upstream_module(stage):
    if stage == 'prd':
        import prd
        return prd
    return planning_context


def _upstream_ids(one, stage):
    """What a screen decision may name as its premise, per upstream stage."""
    if stage != 'prd':
        return {row['id'] for row in one['claims']}
    carried = one['carried']
    return ({row['id'] for field in ('solution_directions', 'rules', 'decisions', 'open_questions')
             for row in one[field]}
            | {row['id'] for field in ('pain_points', 'assumptions', 'hypotheses')
               for row in carried[field]})


def _inputs(input_path):
    path2 = Path(input_path).resolve()
    two = load_json(path2)
    if not user_experience.validate(two)['complete']:
        raise ValueError('user experience must be complete and currently confirmed')
    binding = two['input_binding']
    stage = 'prd' if 'prd_path' in binding else 'planning_context'
    module = _upstream_module(stage)
    path1 = Path(user_experience.planning_context_path(two)).resolve()
    if path1.parent != path2.parent:
        raise ValueError(f'{stage} must be adjacent to its bound user experience')
    one = load_json(path1)
    if not module.validate(one)['complete']:
        raise ValueError(f'{stage} and user experience must be complete and currently confirmed')
    h1, r1 = module.fingerprints(one)
    evidence = one['input_binding'] if stage == 'prd' else one['service_context']
    if (binding['content_hash'] != h1 or binding['review_hash'] != r1
            or binding['confirmation_turn_id'] != one['confirmation']['turn_id']
            or binding['service_context_project_id'] != evidence['project_id']
            or binding['service_context_revision'] != evidence['observed_revision']):
        raise ValueError(f'input user experience is not mutually bound to current adjacent {stage}')
    return one, two, path1, path2, stage


def bind_inputs(data, input_path):
    one, two, path1, path2, stage = _inputs(input_path)
    # The grandparent is recorded under whichever stage actually produced it.
    for name, source, path, module in ((stage, one, path1, _upstream_module(stage)),
                                       ('user_experience', two, path2, user_experience)):
        content, review = module.fingerprints(source)
        data['input_binding'][name] = {'path':str(path),'content_hash':content,
            'review_hash':review,'confirmation_turn_id':source['confirmation']['turn_id']}
    data['input_binding'].pop('prd' if stage == 'planning_context' else 'planning_context', None)
    return two


def required_reviews(data):
    targets = {(criterion,row['id']) for row in data['screens'] + data['elements']
        for criterion in ('S1','S2','S3','S6')}
    targets.update(('S4',row['id']) for row in data['interaction_rules'])
    # All transitions are reviewed: natural-language event parsing cannot safely omit S5 targets.
    targets.update(('S5',row['id']) for row in data['transitions'])
    targets.update(('S7',row['id']) for row in data['sources'] + data['decisions'])
    if data.get('schema_version') == 3:
        targets.update(('S7', row['id']) for row in data['decision_inventory'])
    targets.update(('S8',row['id']) for row in data['screens'] + data['design_handoffs'])
    return targets


DECISION_TARGET_FIELDS = ('screens','elements','state_axes','transitions','constraints','interaction_rules','design_handoffs')


def expected_decision_targets(data):
    return {row['id'] for field in DECISION_TARGET_FIELDS for row in data[field]}


def pack_rows_cited(data):
    """The pack rows this case derives from, named the way the approval names them."""
    return [row.get('reference', '') for row in data.get('sources', [])
            if row.get('provider') == 'design_knowledge']


def _pack_decisions(data, pack_dir=None):
    """(known item ids, recorded decisions, stale?) for the pack this case derives from."""
    import pack_approval
    binding = data.get('knowledge_binding')
    if binding is None:
        return None
    if pack_dir is None:
        pack_dir = WORKSPACE_ROOT / 'design-knowledge' / binding['pack_id'] / binding['version']
    pack_path = Path(pack_dir) / 'pack.json'
    state = pack_approval.status(pack_path)
    known = {item['id'] for item in pack_approval.items(pack_approval.load_json(pack_path))}
    record_path = pack_approval.record_path(pack_path)
    record = pack_approval.load_json(record_path) if record_path.exists() else {}
    return known, (record.get('decisions') or {}), state['stale']


# What the one real stage-4 image review caught while every machine check passed. Both
# findings were facts about this document, so both are read here rather than in a picture —
# and reading them at stage 3 means the empty wireframe is never rendered at all.
# The state words come from the roles' own stateContract prose, matched as strings the way
# the job stage matches its grilling rules.
ACTION_REF = re.compile(r'^(?:view:.+:action:\d+|scenario:.+:step:.+:action)$')


def available_action_gaps(data, upstream, upstream_stage):
    """Can a person reach the action this render case offers?

    The field was prose, so nothing could ask which element carries it: a terminal screen
    could declare an exit, render a dead end, and pass every check. On the derived chain it
    carries inventory references instead, which makes the question answerable — and the first
    case to be converted turned out to declare exits the upstream never offered.

    Legacy planning-context cases keep prose. Their artifacts are frozen records of runs that
    are over, and re-reading them against a newer contract would report thousands of things
    nobody can act on; `upstream_coverage_gaps` draws the same line for the same reason.
    """
    if upstream_stage != 'prd' or not upstream:
        return []
    inventory = input_inventory(upstream)
    carried = {}
    for row in data.get('elements', []):
        for ref in row.get('action_refs', []) or []:
            carried.setdefault(ref, set()).add(row.get('screen_id'))
    gaps = []
    for number, case in enumerate(data.get('render_cases', [])):
        prefix = f"render_cases[{number}] {case.get('id', '')}"
        for ref in case.get('available_actions', []):
            if not ACTION_REF.match(ref):
                gaps.append(f'{prefix}: {ref!r}는 참조가 아니다 — 가능한 행동은 상위 인벤토리의 '
                            '행동 참조로 적는다')
            elif ref not in inventory:
                gaps.append(f'{prefix}: {ref}를 상위가 제공하지 않는다 — 파생이 상위에 없는 '
                            '행동을 만들었거나 역류를 빚졌다')
            elif case.get('screen_id') not in carried.get(ref, set()):
                gaps.append(f'{prefix}: {ref}를 이 화면의 어느 요소도 표현하지 않는다 — '
                            '제공한다고 적은 행동에 도달할 수 없다')
    return gaps


# 계약 쪽과 축 쪽에 같은 동의어 집합을 준다. 예전에는 계약을 단어 하나로만 읽어서
# 「검증 오류」나 「반려」라고 적은 역할은 아예 검사 대상이 되지 않았다.
STATE_CONTRACT_TERMS = (
    ('로딩', ('로딩', '불러', 'loading', 'busy', 'pending')),
    ('빈 결과', ('빈', '없', 'empty', 'none')),
    ('실패', ('실패', '오류', '에러', 'error', 'fail')),
    ('반려', ('반려', '거부', '재요청', 'reject')),
    ('접근 제한', ('제한', '권한', '거절', 'denied', 'forbidden')),
    ('대기', ('대기', '기다', 'waiting')),
)


def contract_mentions(contract, term, hints):
    """Does the contract ask for this state, in any of the words it might use for it?"""
    return term in contract or any(hint in contract for hint in hints)


def dead_end_render_cases(data):
    """W-02: a screen with nothing to press and no reason given is a wall.

    A case that offers no action but says why is an answer, not a dead end — that is the
    difference this check turns on. The run that produced the rule rendered an empty result
    with neither, and the reviewer had to see the picture to notice.
    """
    limits = []
    for case in data.get('render_cases', []):
        actions = [text for text in case.get('available_actions', []) if text.strip()]
        blocked = [text for text in case.get('blocked_actions_with_reasons', []) if text.strip()]
        if not actions and not blocked:
            limits.append(f"{case.get('id', '')}: 렌더 케이스에 가능한 행동도 막힌 이유도 없다 — "
                          '이 화면에 도달한 사람은 나갈 곳이 없다')
    return limits


def role_scoped_words(data, screen, role_id, sources):
    """The words that came from this role, when a screen cites more than one.

    5차가 실측했다: 한 화면이 역할 둘을 인용하면 **한 역할의 계약이 다른 역할의 요소로
    충족된다.** 보상 역할만 인용해도 결과가 `[]`였다 — 그 계약에서 낱말 검사가 읽어내는 것은
    「빈 결과」와 「실패」뿐이고 그 둘을 **목록 쪽** 요소가 이미 만족시켰다. 그래서
    「보상 역할의 상태 계약을 하나도 안 지켰다」는 사실이 실행기가 손으로 적었기 때문에만
    문서에 있었다.

    귀속은 이미 있다 — 요소가 `source_ids`로 역할을 가리킨다. 검사가 그것을 안 읽었을 뿐이다.
    역할을 하나만 인용한 화면에서는 화면 전체와 같다.
    """
    cited = [name for name in screen.get('source_ids', [])
             if sources.get(name, {}).get('reference') == role_id]
    if not cited:
        return state_words_on_screen(data, screen)
    scoped = [row for row in data.get('elements', [])
              if row.get('screen_id') == screen['id']
              and (set(row.get('source_ids', [])) & set(cited)
                   or not any(sources.get(other, {}).get('reference', '').startswith('role:')
                              for other in row.get('source_ids', [])))]
    narrowed = dict(data, elements=scoped)
    return state_words_on_screen(narrowed, screen)


def state_words_on_screen(data, screen):
    """Every word this screen uses that could name a state, wherever it put it.

    4차의 여섯 런이 같은 것을 증명했다: 이 검사는 **축 값의 라벨 문자열**만 읽었다.
    `shown/hidden`을 `로딩중/로딩완료`로 고쳐 쓰자 모델은 하나도 안 바뀌었는데 소견 네 건이
    사라졌고, 반대로 상태를 제대로 모델링한 화면이 라벨에 「실패」라는 낱말만 없다는 이유로
    울었다 — 「지금은 확인할 수 없음」처럼 사람이 읽을 문구를 잘 쓸수록 더 울었다.

    상태가 화면에 표현되는 자리는 라벨만이 아니다. 렌더 케이스의 제목과 보이는 정보, 막힌
    행동의 이유, 요소의 이름과 목적 — 사람이 그 상태를 보는 자리는 전부 여기다. 읽는 자리를
    넓히면 코퍼스 76건 중 11건이 사라진다. 그 11건은 전부 상태가 실제로 있는 화면이었다.
    """
    elements = [row for row in data.get('elements', []) if row.get('screen_id') == screen['id']]
    scopes = {screen['id']} | {row['id'] for row in elements}
    words = []
    for axis in data.get('state_axes', []):
        if axis.get('scope_id') not in scopes:
            continue
        words.append(axis.get('id', ''))
        for value in axis.get('values', []):
            words += [value.get('id', ''), value.get('label', ''), value.get('meaning', '')]
        for row in axis.get('initial_conditions', []):
            words += [row.get('condition', ''), row.get('rationale', '')]
    for case in data.get('render_cases', []):
        if case.get('screen_id') != screen['id']:
            continue
        words += [case.get('title', ''), case.get('focus_expectation', '')]
        words += (case.get('visible_information', []) + case.get('available_actions', [])
                  + case.get('blocked_actions_with_reasons', []))
    for row in elements:
        words += [row.get('name', ''), row.get('purpose', '')]
    return ' '.join(text for text in words if text)


CONTRACT_CLAUSE = re.compile(r'[·,、/]|을 구분한다|를 구분한다|을 정의한다|를 정의한다')


def unreadable_contract_clauses(contract):
    """The clauses of a role's state contract this word-level check says nothing about.

    5차: `role:type-reward`의 계약은 「미참여·진행 중·달성·이미 수령·자격 없음·실패」인데
    검사가 읽어내는 낱말은 그중 **둘뿐**이고(「없」·「실패」), 그 둘은 같은 화면의 다른 요소가
    쉽게 만족시킨다. 그래서 **보상 역할의 계약을 하나도 안 지켰다는 사실이 실행기가 손으로
    적었기 때문에만 문서에 있었다.**

    낱말 목록을 늘려 쫓아가는 것은 답이 아니다 — 계약은 산문이고 역할마다 다르다.
    검사가 할 수 있는 정직한 일은 **자기가 읽지 못한 조항을 이름 대는 것**이다.
    """
    known = {hint for _, hints in STATE_CONTRACT_TERMS for hint in hints}
    known |= {term for term, _ in STATE_CONTRACT_TERMS}
    unread = []
    for clause in CONTRACT_CLAUSE.split(contract or ''):
        clause = clause.strip(' .。')
        if len(clause) < 2 or any(word in clause for word in known):
            continue
        unread.append(clause)
    return unread


def state_contract_gaps(data, pack_dir=None, unreadable=False):
    """W-01: a state the screen's role requires, whose words appear nowhere on the screen.

    The role's stateContract is prose and the artifact is prose too, so both sides are read
    as words — and a word-level reading cannot tell a modelled state from a well-named one.
    That is why this is a display, never a block, and why the message says which words it
    looked for: a reader who renames a label changes this finding, and should know it.
    """
    binding = data.get('knowledge_binding')
    if binding is None:
        return []
    try:
        import pack_approval
        if pack_dir is None:
            pack_dir = WORKSPACE_ROOT / 'design-knowledge' / binding['pack_id'] / binding['version']
        pack = pack_approval.load_json(Path(pack_dir) / 'pack.json')
    except (OSError, UnicodeError, ValueError, KeyError):
        return []
    roles = {'role:' + row['id']: row for row in pack.get('roles', [])}
    sources = {row['id']: row for row in data.get('sources', [])}
    limits = []
    for screen in data.get('screens', []):
        for name in screen.get('source_ids', []):
            reference = sources.get(name, {}).get('reference', '')
            role = roles.get(reference)
            if not role:
                continue
            # 역할마다 그 역할에서 나온 요소의 말만 읽는다. 한 역할만 인용한 화면에서는
            # 화면 전체와 같고, 둘 이상이면 섞이지 않는다.
            expressed = role_scoped_words(data, screen, reference, sources)
            contract = role.get('stateContract', '')
            for term, hints in STATE_CONTRACT_TERMS:
                if contract_mentions(contract, term, hints) and not any(
                        hint in expressed for hint in hints):
                    limits.append(
                        f"{screen['id']} / role:{role['id']}: 역할의 상태 계약이 「{term}」"
                        f"{object_particle(term)} 요구하는데, 이 화면의 축·렌더 케이스·요소 문구 "
                        f"어디에도 그 상태를 가리키는 낱말({'·'.join(hints)})이 없다 — "
                        '낱말로 읽은 소견이므로 상태를 다른 말로 적었다면 그렇다고 기록하면 '
                        '된다. 상위가 이 상태를 정한 적이 없다면 조건을 지어내지 말고 '
                        'coverage_checks를 deferred로 두고 역류를 건다 — 역할을 인용했다는 '
                        '이유로 파생이 상위 판단을 대신하지는 않는다')
            unread = unreadable_contract_clauses(contract) if unreadable else []
            if unread:
                limits.append(
                    f"{screen['id']} / role:{role['id']}: 이 검사가 읽지 못한 상태 계약 조항 — "
                    f"{'·'.join(unread)}. 낱말 목록에 없는 상태라 **이 검사는 그것에 대해 "
                    '아무 말도 하지 않았다.** 지켰는지 아닌지는 사람이 판단해 기록한다')
    return limits


def undetermined_repetition_limits(data):
    """Elements that repeat by something nobody upstream has decided.

    `none`은 「반복이 없다」이고, 이 값은 「반복은 있는데 무엇으로 묶이는지 아직 모른다」다.
    둘을 한 값으로 눌러 두면 실행기가 거짓을 적는 것 말고는 통과할 길이 없다. 표시는 하고
    막지는 않는다 — 모르는 것은 결손이지 잘못이 아니다.
    """
    return [f"{row['id']} ({row['name']}): 반복에 대해 모르는 것이 있다 — "
            f"{row['repetition']['unknown']}. 그것이 정해지면 이 요소의 항목·집계 검사가 "
            '비로소 걸린다'
            for row in data.get('elements', [])
            if isinstance(row.get('repetition'), dict) and 'unknown' in row['repetition']]


def profileless_element_limits(data):
    """An element with no state profile is an element nothing checks.

    The axis and event candidates live on the profile, so the checks that would ask whether
    this element's states were modelled simply do not run — emptying state_profiles silences
    all of them at once.

    Reported and never blocked. Having no profile is not wrong, it is unexamined, and seven
    artifacts here are in that state; blocking would make the tool refuse records of work
    that is already done. The report says which elements no check reached.
    """
    return [f"{row['id']} ({row['name']}): 상태 프로필이 없어 축·이벤트 검사가 이 요소에 "
            '걸리지 않는다'
            for row in data.get('elements', []) if not row.get('profile_ids')]


# A subject the design knowledge pack was never shown to cover.
NON_PARTICIPANT_SUBJECTS = ('브랜드', '담당자', '어드민', '운영자', '관리자', '판매자', '입점')
# Korean puts the head noun last, so 「브랜드 체험단에 선정된 참여자」 is about a participant and
# 「…정해야 하는 브랜드 담당자」 is not. Scanning the whole string reported the first one as
# brand-side — and since the finding has to be recorded verbatim, the check was writing a false
# sentence into the artifact. Whichever side's word comes last is the head.
PARTICIPANT_SUBJECTS = ('참여자', '사용자', '사람', '지원자', '신청자', '회원')
# 「참여자가 아니라 모집하는 쪽」 names the participant in order to exclude them.
SUBJECT_NEGATION = re.compile(r'(?:이|가)?\s*아니')


def subject_is_participant(subject):
    """Whose side is this job's subject on, by the last word that actually claims one?"""
    def last(words, negated_ok):
        found = -1
        for word in words:
            start = 0
            while (index := subject.find(word, start)) >= 0:
                start = index + len(word)
                if negated_ok or not SUBJECT_NEGATION.match(subject[start:start + 6]):
                    found = max(found, index)
        return found

    other = last(NON_PARTICIPANT_SUBJECTS, True)
    return other < 0 or last(PARTICIPANT_SUBJECTS, False) > other


def role_audience_limits(data):
    """A job whose subject is not the participant, matched against participant-app roles.

    The heroines pack's 23 roles are all written from the participant's own side, and a
    brand-side case cleared stages 1a–2 and then matched one of them at stage 3. What makes
    that bad is that it *succeeded*: the record says 「fits this role well」 rather than
    「no role fits this subject」, so nothing — not the backflow condition, not a machine
    check — ever asked whether the vocabulary underneath was the right one.

    Nothing in the pipeline ever establishes which audience a pack covers, so the limit is
    written as what is actually known: unverified, not wrong. A pack that declares its
    audience could narrow this to a real mismatch.
    """
    subject = _bound_job_subject(data)
    found = [] if subject_is_participant(subject) else [
        word for word in NON_PARTICIPANT_SUBJECTS if word in subject]
    if not found or not data.get('knowledge_binding'):
        return []
    binding = data['knowledge_binding']
    return [f"{binding['pack_id']}/{binding['version']}: 주체가 참여자가 아닌데"
            f"({', '.join(found)}) 이 팩이 그 주체의 화면을 담고 있는지는 확인된 적이 없다 — "
            '매칭된 역할의 어휘가 이 job의 것인지 사람이 판단해야 한다']


def _bound_job_subject(data):
    """Who this job is about, read from the job itself rather than the sentence built from it.

    This used to scan the whole composed `job_statement`, and a job about a participant that
    happened to say 「브랜드 체험단에 선정돼 … 하는 참여자가」 was reported as brand-side. The
    finding has to be recorded verbatim to pass, so the check was writing a false sentence into
    the artifact — worse than staying quiet.
    """
    prd_path = ((data.get('input_binding') or {}).get('prd') or {}).get('path')
    if not prd_path:
        return ''
    try:
        binding = load_json(Path(prd_path))['input_binding']
        return load_json(Path(binding['jtbd_path']))['job']['subject']
    except (OSError, UnicodeError, ValueError, KeyError, TypeError):
        return ''


def one_sentence_coverage_limits(data):
    """A `not_applicable` reason that answers more than one dimension answered none of them.

    The eleven dimensions are eleven different questions about a scope. A reason may repeat
    across scopes — the same fact can hold for many screens — but a reason that covers
    visibility and freshness and continuity at once was not a judgment about any of them, and
    `not_applicable` is where upstream silence goes to look considered.

    Measured across the sixteen recorded stage-3 artifacts before shipping: eleven keep every
    reason inside one dimension, five write a single sentence across all eleven. No case sits
    between, so this needs no threshold. Recorded rather than blocked — the alternative is
    demanding ninety-five judgments that were never made, which is how invention starts.
    """
    spans = {}
    for row in data.get('coverage_checks', []):
        if row.get('status') != 'not_applicable':
            continue
        spans.setdefault(row['rationale'].strip(), set()).add(row['dimension'])
    limits = []
    for text, dimensions in spans.items():
        if len(dimensions) > 1:
            limits.append(f'커버리지 사유 하나가 {len(dimensions)}개 차원을 한 번에 답한다 — '
                          f"차원별 판단이 아니다: 「{text[:40]}」")
    return limits


def review_finding_limits(data, pack_dir=None):
    """The stage-4 review axes this stage can already read off its own document."""
    return (dead_end_render_cases(data) + state_contract_gaps(data, pack_dir)
            + role_audience_limits(data) + one_sentence_coverage_limits(data))


def unread_contract_limits(data, pack_dir=None):
    """What this check said nothing about. Reported, never required verbatim.

    축자 기록을 요구하면 코퍼스에서 86건이 188건이 되어 **진짜 소견이 묻힌다.** 검사가
    자기 침묵을 드러내는 것과, 그 침묵을 사람이 한 줄씩 베끼게 하는 것은 다른 일이다.
    """
    return [row for row in state_contract_gaps(data, pack_dir, unreadable=True)
            if '읽지 못한 상태 계약' in row]


def review_finding_gaps(data, pack_dir=None):
    """C-5, extended: the shortage is displayed; saying nothing about it is the defect.

    A recorded limit closes one, and so does an open blocking issue that names it — the run
    that produced these rules answered one of the two with a backflow, and a backflow is a
    record. Forcing both would only teach people to write the second one twice.
    """
    recorded = {recorded_finding(row)
                for row in data.get('evidence_status', {}).get('coverage_limits', [])}
    waiting = ' '.join(row.get('question', '') + ' ' + row.get('reason', '')
                       for row in data.get('issues', [])
                       if row.get('blocking') and not closed(row))
    gaps = []
    for text in review_finding_limits(data, pack_dir):
        token = text.split(':')[0].strip()
        if text in recorded or (token and token in waiting):
            continue
        gaps.append(finding_note('$.evidence_status.coverage_limits', text))
    return gaps


def pack_approval_limits(data, pack_dir=None):
    """What this derivation rests on that nobody has reviewed.

    An unreviewed or held pack row is an evidence shortage, so it is reported and carried
    into the artifact rather than blocked. Blocking a shortage makes people route around
    the tool, which is the failure the job stage refuses for the same reason.
    """
    cited = pack_rows_cited(data)
    if not cited:
        return []
    try:
        resolved = _pack_decisions(data, pack_dir)
    except (OSError, UnicodeError, ValueError):
        return []
    if resolved is None:
        return []
    known, decisions, stale = resolved
    if stale:
        return ['팩 승인이 stale이다. 승인 기록 이후 팩이 바뀌었으므로 이 파생은 '
                '재검토되지 않은 행에 근거한다']
    if known and not decisions:
        # Nobody has ruled on a single row, so naming each cited one as its own shortage
        # says the same thing three times and reads as background noise — it sits on the
        # worked example too. One line, with the number, is the finding: the pack itself
        # has never been reviewed. Per-row lines mean something again once approvals exist.
        return [f'이 팩은 {len(known)}행 중 승인 기록이 0행이다. 인용한 '
                f'{len(set(cited) & known)}행을 포함해 이 파생 전체가 미승인 합성에 근거한다']
    limits = []
    for reference in sorted(set(cited)):
        if reference not in known:
            continue
        decision = decisions.get(reference)
        if decision is None:
            limits.append(f'{reference}은 아직 검토되지 않았다. 이 파생은 미승인 합성에 근거한다')
        elif decision['status'] == 'held':
            note = decision.get('note', '')
            limits.append(f'{reference}은 보류 상태다{f" ({note})" if note else ""}. '
                          f'이 파생은 보류된 행에 근거한다')
    return limits


def pack_approval_gaps(data, pack_dir=None):
    """Structural problems only: a malformed citation, a row a reviewer ruled wrong, and a
    limitation this case failed to record. Each is fixable without further research."""
    cited = pack_rows_cited(data)
    if not cited:
        return []
    try:
        resolved = _pack_decisions(data, pack_dir)
    except (OSError, UnicodeError, ValueError) as exc:
        return ['$.sources: cannot read pack approval: ' + str(exc)]
    if resolved is None:
        return []
    known, decisions, _ = resolved
    gaps = []
    for reference in sorted(set(cited)):
        if reference not in known:
            gaps.append(f'$.sources: {reference!r} is not a pack approval item id; '
                        'cite a design_knowledge row by its item id')
            continue
        decision = decisions.get(reference)
        if decision and decision['status'] == 'rejected':
            gaps.append(f'$.sources: {reference} is rejected '
                        f'({decision.get("note", "")}); a row a reviewer ruled wrong '
                        f'cannot ground a derivation')
    recorded = {recorded_finding(text)
                for text in data.get('evidence_status', {}).get('coverage_limits', [])}
    for text in pack_approval_limits(data, pack_dir):
        if text not in recorded:
            gaps.append(finding_note('$.evidence_status.coverage_limits', text))
    return gaps


def knowledge_binding_gaps(data):
    """A case that derives from the pack must name the pack revision it derived from.

    Stage 3 takes its screens, states and layout from the pack, so a pack swap invalidates
    the derivation. Without a binding the swap is invisible.
    """
    import design_system_wireframe
    cites_pack = any(row.get('provider') == 'design_knowledge' for row in data.get('sources', []))
    binding = data.get('knowledge_binding')
    if binding is None:
        return ([] if not cites_pack else
                ['$.knowledge_binding: a case citing design_knowledge must bind the pack version'])
    path = (WORKSPACE_ROOT / 'design-knowledge' / binding['pack_id'] / binding['version'] / 'pack.json')
    try:
        current = design_system_wireframe.knowledge_pack_fingerprint(path)
    except (OSError, UnicodeError, ValueError) as exc:
        return ['$.knowledge_binding: cannot load knowledge pack: ' + str(exc)]
    if current != binding['content_hash']:
        return ['$.knowledge_binding.content_hash: knowledge pack hash mismatch']
    return []


def state_expression_gaps(data):
    """S-2: a state nobody can see is not specified.

    Deriving a state from the role's stateContract is only half the job. The run that
    produced this rule showed a first-load case whose only element was the title: the
    machine checks passed and the capture showed an empty screen.
    """
    gaps = []
    elements = {row['id'] for row in data.get('elements', [])}
    for number, case in enumerate(data.get('render_cases', [])):
        seen = [row for row in case.get('state_assignments', [])
                if row.get('scope_id') in elements]
        if not seen and not [text for text in case.get('visible_information', []) if text.strip()]:
            gaps.append(f"render_cases[{number}] {case.get('id', '')}: "
                        'no element expresses this state')
    return gaps


LEAF_INPUT_REF = re.compile(r'^view:.+:(?:information|action):\d+$')


def view_requirement_gaps(data):
    """S-3: a requirement no element carries never reached a screen.

    The inventory forces every declared display and action to be linked, and S-2 forces
    every state to be visible. Neither asks whether the element actually carries the thing.
    The run that produced this rule mapped all 1174 inventory refs onto the same three
    elements, not one of which declared a single ref, and passed.

    A link's `element_ids` and an element's `information_refs` are two records of the same
    landing. The question here is only whether the requirement reached a screen at all, so
    any element carrying it counts — a disagreement about which one is not this check's
    business. A documented exclusion is left alone (C-5): it is already recorded, and
    blocking it only teaches people to write a link nothing backs.
    """
    carried = set()
    for row in data.get('elements', []):
        carried.update(row.get('information_refs', []) or [])
        carried.update(row.get('action_refs', []) or [])
    gaps = []
    for number, row in enumerate(data.get('inventory_links', [])):
        ref = row.get('input_ref', '')
        if row.get('disposition') != 'mapped' or not LEAF_INPUT_REF.match(ref):
            continue
        if ref not in carried:
            named = ', '.join(row.get('element_ids', []) or []) or 'no element'
            gaps.append(f'inventory_links[{number}] {ref}: mapped to {named}, '
                        'but no element declares it; the requirement never reached a screen')
    return gaps


def derived_ownership_gaps(data):
    """A derived case owns no planner decision; a planner-owned row means it leaked."""
    return [f"decision_inventory[{number}] {row['id']}: "
            f"{row['classification']} needs a planner, so this case is not derived"
            for number, row in enumerate(data.get('decision_inventory', []))
            if row['classification'] in ('recommended', 'planner_required')]


def decision_inventory_gaps(data):
    """Mechanical ownership evidence; semantic classification remains subject to S7 review."""
    gaps=[]
    def need(condition,message):
        if not condition:gaps.append('decision_inventory: '+message)
    targets=expected_decision_targets(data)
    target_rows={row['id']:row for field in DECISION_TARGET_FIELDS for row in data[field]}
    sources={row['id']:row for row in data['sources']}
    decisions={row['id']:row for row in data['decisions']}
    packets={row['id']:row for row in data['decision_packets']}
    rows=data['decision_inventory']; counts=Counter(t for row in rows for t in row['target_refs'])
    missing=sorted(targets-set(counts));duplicates=sorted(t for t,n in counts.items() if n>1)
    need(not missing,'missing targets '+', '.join(missing))
    need(not duplicates,'duplicate targets '+', '.join(duplicates))
    need(not(set(counts)-targets),'unknown targets '+', '.join(sorted(set(counts)-targets)))
    need(len({r['id'] for r in rows})==len(rows),'duplicate inventory ids')
    decision_counts=Counter(row['decision_id'] for row in rows if row['decision_id'] is not None)
    need(set(decision_counts)==set(decisions),'every decision must belong to exactly one inventory record')
    need(all(n==1 for n in decision_counts.values()),'decision assigned more than once')
    open_ids=[]
    for row in rows:
        label=row['id'];classification=row['classification']; selected=row['status']=='selected'
        need(bool(label.strip()) and bool(row['target_refs']),label+' requires id and target scope')
        need(bool(row['rationale'].strip()) and bool(row['source_ids']),label+' requires rationale and sources')
        need(len(row['source_ids'])==len(set(row['source_ids'])) and set(row['source_ids'])<=set(sources),label+' invalid sources')
        evidence=[sources[s] for s in row['source_ids'] if s in sources]
        did=row['decision_id'];pid=row['decision_packet_id'];decision=decisions.get(did,{})
        if did is not None:need(did in decisions,label+' unknown decision')
        if pid is not None:need(pid in packets,label+' unknown decision packet')
        if classification in ('inherited','current_service','standard_derived'):
            # 「검토했고 사용자 결과가 같아 이쪽을 골랐다」를 적을 자리가 없었다. 대안을 적으면
            # 막히고 지우면 통과했으니, 정직한 쪽이 벌을 받는 자리였다. 실제로 금지해야 하는
            # 것은 대안을 **적는 일**이 아니라 파생이 기획자 몫의 판단을 대신하는 일이다 —
            # 그것은 `ux_difference`와 결정 패킷으로 이미 드러난다.
            need(row['status']=='documented' and row['ux_difference']=='none' and pid is None,
                label+' documented derivation may not own a planner decision — status는 '
                'documented, ux_difference는 none, decision_packet_id는 비어 있어야 한다. '
                '사용자 결과가 갈리면 이것은 파생이 아니라 기획자 판단이다')
            if classification=='current_service':
                current=data['evidence_status']
                need(any(s['provider']=='platty' and s['project_id']==current['project_id'] and s['revision']==current['observed_revision'] for s in evidence),label+' current_service requires current Platty evidence')
            elif classification=='standard_derived':
                # The design knowledge pack is the standard this stage derives from, and it is
                # gated harder than a URL: a citation must name a real pack item and its
                # approval state is carried into coverage_limits.
                usable=[s for s in evidence if s['provider']=='design_knowledge'
                        or (s['provider']=='web' and s['reference'].startswith(('https://','http://')))]
                # 문구가 「진짜 외부 표준 문서를 대라」고만 말해서, 실제 원인이 kind인데도
                # 한 실행기가 「조회한 적 없는 외부 표준을 지어낼 뻔했다」고 적었다.
                # 지어내라고 읽히는 오류 문구는 이 프로젝트가 막으려는 바로 그 일을 시킨다.
                if usable:
                    need(any(s['kind']=='document' for s in usable),
                        label+' standard_derived cites '
                        + ', '.join(sorted({f"{s['id']}(kind={s['kind']})" for s in usable}))
                        + " — the pack and a URL are standards, but the citation's kind must be"
                          " 'document'")
                else:
                    need(False,label+' standard_derived needs a design_knowledge pack row or an'
                        ' http(s) reference; cite what you actually read, and pick another'
                        ' classification if there is none')
            else:
                need(did is not None and decision.get('origin')=='inherited' and decision.get('status')=='accepted'
                    and bool(decision.get('parent_refs')),label+' inherited needs accepted upstream decision')
            if did is not None:
                need(decision.get('origin') in ('inherited','derived') and decision.get('status')=='accepted',label+' documented fact cannot masquerade as planner approval')
        else:
            need(row['ux_difference']=='meaningful',label+' planner choice must disclose meaningful UX difference')
            need(len(row['alternatives'])>=2 and len(row['alternatives'])==len(set(row['alternatives']))
                and all(a.strip() for a in row['alternatives']),label+' requires distinct alternatives')
            if not selected:
                open_ids.append(label);need(False,label+' open planner decision requires actual answer')
            packet=packets.get(pid,{})
            if selected:
                need(packet.get('status') in ('selected','revised'),label+' requires selected/revised packet')
                need(set(packet.get('decision_scope',{}).get('target_refs',[]))==set(row['target_refs']),label+' packet target scope mismatch')
                need(set(row['alternatives'])=={o['id'] for o in packet.get('options',[])},label+' alternatives must match packet options')
                user=packet.get('selection',{}).get('user_source_id')
                need(sources.get(user,{}).get('provider')=='user' and user in row['source_ids'],label+' actual user selection source required')
                need(decision.get('origin')=='planner_decided' and decision.get('status')=='accepted'
                    and user in decision.get('source_ids',[]),label+' accepted planner_decided decision must cite same user answer')
        if did in decisions:
            linked={target for target,value in target_rows.items() if did in value.get('decision_ids',[])}
            need(linked<=set(row['target_refs']),label+' decision links outside inventory target scope')
            for target in row['target_refs']:
                if 'decision_ids' in target_rows.get(target,{}):
                    need(did in target_rows[target]['decision_ids'],label+' target missing corresponding decision link '+target)
    metric={'id':'decision_inventory','numerator':len(targets & set(counts)), 'denominator':len(targets),
        'missing_ids':missing,'duplicate_ids':duplicates,'open_ids':open_ids,
        'status':'not_applicable' if not targets else 'incomplete' if gaps else 'covered'}
    return gaps,metric,open_ids


def render_decision_inventory(data):
    if data.get('schema_version')!=3:return ''
    screens={r['id']:r['name'] for r in data['screens']}
    elements={r['id']:r['screen_id'] for r in data['elements']}
    rows={r['id']:r for field in DECISION_TARGET_FIELDS for r in data[field]}
    transitions={r['id']:r for r in data.get('transitions', [])}
    def mermaid_label(value):
        return html.escape(str(value)).replace('|', '&#124;').replace('\n', ' ').replace('"', '&quot;').replace('`', '&#96;')
    def screen_ids(target):
        if target in screens:return {target}
        if target in elements:return {elements[target]}
        row=rows.get(target,{})
        if 'screen_id' in row:return {row['screen_id']}
        refs=([row['scope_id']] if 'scope_id' in row else row.get('target_scope_ids',row.get('scope_ids',row.get('input_scope_ids',[])+row.get('output_scope_ids',[]))))
        return {s for ref in refs for s in screen_ids(ref)}
    lines=['### 화면 동작 결정 목록','']
    scenario_edges=[]
    for scenario in data.get('scenarios', []):
        if not scenario.get('steps'):
            continue
        transition=transitions.get(scenario['steps'][-1]['transition_id'], {})
        edge_screen_ids={elements.get(scope, scope) for scope in transition.get('target_scope_ids', [])}
        screen_id=next((sid for sid in edge_screen_ids if sid in screens), '')
        if screen_id:
            scenario_edges.append((screen_id, transition.get('event', scenario['id']), transition.get('observable_result', scenario['expected_case_id'])))
    if scenario_edges:
        nodes={sid:f's{index}' for index,sid in enumerate(sorted({edge[0] for edge in scenario_edges}))}
        lines += ['```mermaid', 'flowchart LR']
        for sid,node in nodes.items():
            lines.append(f'  {node}["{mermaid_label(screens[sid])}"]')
        for index,(sid,event,result) in enumerate(scenario_edges):
            outcome=f'o{index}'
            lines.append(f'  {nodes[sid]} -->|"{mermaid_label(event)}"| {outcome}["{mermaid_label(result)}"]')
        lines += ['```', '']
    for row in data.get('decision_inventory',[]):
        names=sorted({screens.get(s,s) for target in row['target_refs'] for s in screen_ids(target)})
        label=html.escape(' / '.join(names) or '공통')
        lines.append(f"- **{label} · {html.escape(row['id'])}** — {row['classification']} / {row['status']}")
        lines.append('  대상: '+', '.join(html.escape(t) for t in row['target_refs']))
        lines.append('  이유: '+html.escape(row['rationale']))
        if row['classification'] in ('recommended','planner_required'):
            lines.append('  대안: '+', '.join(html.escape(a) for a in row['alternatives']))
            packet=next((p for p in data['decision_packets'] if p['id']==row['decision_packet_id']),{})
            if packet.get('topic'):
                lines.append('  결정 주제: '+html.escape(packet['topic']))
            choice=packet.get('selection',{})
            lines.append('  기획자 선택: '+html.escape(choice.get('custom_text') or choice.get('option_id') or '미응답 (open)'))
        else:lines.append('  근거에 따른 문서화 · 별도 기획자 선택 승인으로 간주하지 않음')
    return '\n'.join(lines)+'\n'


def validate(data):
    if isinstance(data,dict) and type(data.get("schema_version")) is int and data["schema_version"]==2:
        return _v2.validate(data)
    if isinstance(data, dict) and type(data.get("schema_version")) is int and data["schema_version"] == 1:
        return _legacy.validate(data)
    errors, gaps, metrics = [], [], []
    # 모르는 칸 하나가 내용 검사를 통째로 끄던 자리다 — 덜어낸 사본으로 끝까지 검사하고
    # 그 칸은 오류로 남는다.
    errors, pruned = shape_errors(data, SHAPE, check_shape)
    report = {'valid':False,'input_ready':False,'baseline_ready':False,
        'ready_for_confirmation':False,'complete':False,'errors':errors,
        'completion_errors':gaps,'content_hash':'','review_hash':'','next_actions':[],
        'verification_gaps':[], 'metrics':metrics, 'qualitative':{}, 'knowledge_ready':False,
        'decision_gaps':[], 'open_decision_ids':[], 'planner_decisions_ready':False,
        'validator_version':VALIDATOR_VERSION,'rubric_version':RUBRIC_VERSION,'example_version':EXAMPLE_VERSION}
    if errors and pruned is None:
        report['checks_not_run'] = ('구조 오류 때문에 내용 검사는 하나도 돌지 않았다 — '
                                    '아래가 비어 있는 것은 문제가 없다는 뜻이 아니다')
        return report
    data = pruned if pruned is not None else data
    content_hash, review_hash = fingerprints(data)
    report.update(content_hash=content_hash, review_hash=review_hash)

    def require(condition, path, message, dest=errors):
        if not condition:
            dest.append(f'{path}: {message}')

    def text(value, path, dest=errors):
        require(bool(value.strip()), path, 'nonempty text required', dest)

    def refs(values, known, path):
        require(len(values) == len(set(values)), path, 'duplicate references')
        for value in values:
            require(value in known, path, f'unknown reference {value!r}')

    def metric(name, expected, observed):
        counts = Counter(observed); missing = sorted(expected - set(counts)); duplicates = sorted(k for k,v in counts.items() if v > 1)
        row = {'id':name,'numerator':len(expected & set(counts)), 'denominator':len(expected),
            'missing_ids':missing,'duplicate_ids':duplicates,
            'status':'not_applicable' if not expected else ('incomplete' if missing or duplicates else 'covered')}
        if not expected:
            row['reason'] = 'No declared targets in this category; this is not full coverage.'
        metrics.append(row)
        require(not missing, name, 'missing coverage/review targets ' + ', '.join(missing), gaps)
        require(not duplicates, name, 'duplicate ' + ', '.join(duplicates))
        return row

    names = ('sources','decision_inventory','decisions','screens','elements','state_profiles','state_axes','transitions',
        'constraints','interaction_rules','scenarios','render_cases','design_handoffs','decision_packets','issues','reviews')
    indices = {}; all_ids = set()
    for name in names:
        indices[name] = {}
        for row in data[name]:
            text(row['id'], name + '.id')
            require(row['id'] not in all_ids, name, 'duplicate id ' + row['id'])
            all_ids.add(row['id']); indices[name][row['id']] = row
    sources = indices['sources']; elements = indices['elements']; screens = indices['screens']
    axes = indices['state_axes']; transitions = indices['transitions']; rules = indices['interaction_rules']
    cases = indices['render_cases']; scenarios = indices['scenarios']; decisions = indices['decisions']
    scopes = {**screens, **elements}
    coverage_ids = {scope + ':' + dim for scope in scopes for dim in COVERAGE_DIMENSIONS}
    all_targets = all_ids | coverage_ids | {'model'}
    text(data['title'], '$.title')
    require(bool(re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', data['case_id'])), '$.case_id', 'invalid case id')
    require(bool(screens), '$.screens', 'at least one screen required', gaps)
    require(bool(elements), '$.elements', 'at least one element required', gaps)

    one = two = None
    upstream_stage = 'planning_context'
    try:
        binding = data['input_binding']
        one, two, path1, path2, upstream_stage = _inputs(binding['user_experience']['path'])
        require(upstream_stage in binding, '$.input_binding.' + upstream_stage,
                'the bound user experience came from a different upstream', gaps)
        for stage, source, path, module in ((upstream_stage,one,path1,_upstream_module(upstream_stage)),('user_experience',two,path2,user_experience)):
            ch, rh = module.fingerprints(source); b = binding.get(stage)
            require(b == {'path':str(path),'content_hash':ch,'review_hash':rh,
                'confirmation_turn_id':source['confirmation']['turn_id']}, '$.input_binding.'+stage, 'stale input binding', gaps)
        report['input_ready'] = not gaps or all(not x.startswith('$.input') for x in gaps)
    except (OSError, ValueError, KeyError, TypeError, RecursionError) as exc:
        gaps.append('$.input_binding: ' + str(exc))
    evidence = data['evidence_status']; before = len(gaps)
    require(evidence['status'] == 'ready', '$.evidence_status', 'current evidence not ready', gaps)
    for key in ('project_id','checked_at','baseline_revision','observed_revision'):
        text(evidence[key], '$.evidence_status.' + key, gaps)
    require(evidence['baseline_revision'] == evidence['observed_revision'], '$.evidence_status', 'evidence revision mismatch', gaps)
    if two:
        require(evidence['project_id'] == two['evidence_status']['project_id']
            and evidence['baseline_revision'] == two['evidence_status']['observed_revision'],
            '$.evidence_status', 'evidence differs from confirmed user experience grounding', gaps)
    # 2단계는 `evidence_status.mode == 'simulation'`이면 platty 출처 요구를 끄고 한계 기록을
    # 받는데, 3단계는 같은 칸을 **갖고 있으면서 읽지 않았다**(`grep -c simulation` = 2단계 6 · 3단계 0).
    # 그래서 「2단계에서 시킨 정직한 기록이 3단계에서 벌을 받는」다고 다섯 실행기가 적었고,
    # 런북을 믿은 쪽은 조회한 적 없는 출처를 지어냈다 — 이 워크플로우가 막으려는 바로 그 일이다.
    if evidence.get('mode') == 'simulation':
        recorded = {recorded_finding(row) for row in evidence.get('coverage_limits', [])}
        for limit in user_experience.simulation_limits(data):
            require(limit in recorded, '$.evidence_status.coverage_limits',
                    finding_note('$.evidence_status.coverage_limits', limit).split(': ', 1)[1], gaps)
    else:
        require(any(s['provider']=='platty' and s['project_id']==evidence['project_id']
            and s['revision']==evidence['observed_revision'] for s in sources.values()),
            '$.evidence_status', 'matching Platty source required', gaps)
    report['baseline_ready'] = report['input_ready'] and len(gaps)==before

    errors.extend(map_gaps(data, set(sources)))
    for source in sources.values():
        path = 'sources.' + source['id']
        for key in ('reference','excerpt','retrieved_at'):
            text(source[key], path+'.'+key)
        try:
            require(datetime.fromisoformat(source['retrieved_at'].replace('Z','+00:00')).utcoffset() is not None,
                path, 'timezone required')
        except ValueError:
            errors.append(path + ': invalid source timestamp')
        require((source['provider']=='user') == (source['kind']=='user'), path, 'user kind and provider must agree')
        require((source['provider'] in IMPORTED_PROVIDERS) == (source['kind']=='imported'), path, 'imported kind and provider must agree')
        if source['provider']=='platty':
            text(source['project_id'],path+'.project_id'); text(source['revision'],path+'.revision')
    if evidence['checked_at']:
        try:
            require(datetime.fromisoformat(evidence['checked_at'].replace('Z','+00:00')).utcoffset() is not None,
                '$.evidence_status.checked_at','timezone required',gaps)
        except ValueError:
            gaps.append('$.evidence_status.checked_at: invalid timestamp')

    # Shared provenance references are strict even in incomplete drafts.
    for name in names:
        for row in data[name]:
            for field, known in (('source_ids',sources),('decision_ids',decisions),('issue_ids',indices['issues'])):
                if field in row:
                    refs(row[field], known, name+'.'+row['id']+'.'+field)
            if name in ('screens','elements','state_axes','transitions','constraints','interaction_rules','state_profiles'):
                require(bool(row['source_ids']) or bool(row.get('decision_ids')), name+'.'+row['id'], 'grounding required', gaps)
    upstream_ids = set()
    if one and two:
        upstream_ids.update(_upstream_ids(one, upstream_stage))
        upstream_ids.update(row['id'] for field in ('claims','actors','touchpoints','experience_states','experience_transitions','scenarios','view_requirements') for row in two[field])
    for decision in decisions.values():
        path='decisions.'+decision['id']
        text(decision['statement'],path+'.statement'); text(decision['rationale'],path+'.rationale',gaps)
        refs(decision['parent_refs'],upstream_ids | set(decisions),path+'.parent_refs')
        if decision['status']=='proposed' or decision['origin']=='proposed':
            gaps.append(path+': unresolved proposed decision')
        if decision['origin']=='inherited':
            require(bool(decision['parent_refs']) and set(decision['parent_refs']) <= upstream_ids,
                path,'inherited decision requires actual upstream refs',gaps)
        if decision['origin']=='planner_decided':
            require(any(sources.get(s,{}).get('provider')=='user' for s in decision['source_ids']),
                path,'actual user source required for planner decision',gaps)
        if decision['origin']=='derived':
            require(bool(decision['parent_refs']) and bool(decision['source_ids']), path, 'derived decision needs parent_refs and source_ids',gaps)
            require(all(p in upstream_ids or decisions.get(p,{}).get('status')=='accepted'
                for p in decision['parent_refs']),path,'every parent_ref of a derived decision must be an accepted upstream ruling',gaps)

    inventory = input_inventory(two) if two else set()
    gaps.extend(available_action_gaps(data, two, upstream_stage))
    links = data['inventory_links']
    metric('input_inventory', inventory, [r['input_ref'] for r in links])
    for link in links:
        path='inventory_links.'+link['input_ref']
        if two: refs([link['input_ref']],inventory,path)
        refs(link['screen_ids'],screens,path); refs(link['element_ids'],elements,path); refs(link['source_ids'],sources,path)
        if link['disposition']=='mapped':
            require(bool(link['screen_ids'] or link['element_ids']),path,'mapped inventory needs a target',gaps)
        else:
            text(link['reason'],path+'.reason',gaps)
            require(bool(link['source_ids']),path,'inventory exclusion needs evidence',gaps)
    for row in screens.values():
        path='screens.'+row['id']; text(row['name'],path+'.name'); text(row['purpose'],path+'.purpose')
        if two:
            for key, field in (('actor_ids','actors'),('touchpoint_refs','touchpoints'),('view_requirement_refs','view_requirements')):
                refs(row[key],{x['id'] for x in two[field]},path+'.'+key)
            refs(row['entry_refs'],upstream_ids,path+'.entry_refs'); refs(row['exit_refs'],upstream_ids,path+'.exit_refs')
        require(any(row['id'] in l['screen_ids'] for l in links),path,'screen has no inventory purpose link',gaps)
        # 기존 화면을 고치는 것과 새로 만드는 것은 인계받는 사람에게 완전히 다른 일이다.
        # 화면이 스스로 고르지 않는다 — 상위 접점이 이미 말했다.
        if two and row.get('origin'):
            declared = {t['id']: t['status'] for t in two['touchpoints']}
            upstream_status = {declared[name] for name in row['touchpoint_refs'] if name in declared}
            require(not upstream_status or row['origin'] in upstream_status, path + '.origin',
                    f"origin {row['origin']} differs from the upstream touchpoint status "
                    f"({', '.join(sorted(upstream_status))}) — 기존을 고치는지 새로 만드는지는 "
                    '2단계가 정했다', gaps)
    if two:
        # 7차: 2단계가 「이 기존 화면이 바뀐다」고 적었는데 3단계가 그 접점에 화면을 하나도
        # 안 그렸고, **아무도 그것을 묻지 않았다.** 그래서 산출물이 기존 화면을 참고하지 않고
        # 독립된 기능을 새로 만든 것처럼 읽혔다.
        # 화면인 접점은 화면을 받아야 한다. 받을 수 없으면 왜인지 적는다 — 막지는 않는다.
        drawn = {name for row in screens.values() for name in row['touchpoint_refs']}
        # 요구만 하고 「이번엔 안 그린다」를 적을 자리를 안 주면 지어내게 된다 — 이 저장소가
        # 여섯 라운드 내내 고쳐 온 병이다. 범위 밖으로 **이름을 대고** 적으면 답한 것이다.
        ruled = ' '.join(row.get('note', '') + ' ' + row.get('reason', '')
                         for row in (data.get('out_of_scope') or []))
        for point in two['touchpoints']:
            if point['kind'] != 'screen' or point['id'] in drawn or point['id'] in ruled:
                continue
            gaps.append(
                f"screens: 접점 {point['id']}({point['name']}) 는 status가 {point['status']}인 "
                '화면인데 이 단계가 화면을 그리지 않았다 — 기존 화면을 고치는 일이면 무엇이 '
                '어떻게 바뀌는지가 여기 있어야 하고, 이번 범위가 아니면 '
                f"$.out_of_scope에 {point['id']}를 이름 대고 적는다")
    for row in elements.values():
        path='elements.'+row['id']; refs([row['screen_id']],screens,path+'.screen_id')
        for key in ('name','purpose','semantic_type'): text(row[key],path+'.'+key)
        refs(row['profile_ids'],indices['state_profiles'],path+'.profile_ids')
        if two:
            refs(row['information_refs']+row['action_refs'],inventory,path+'.input_refs')
        require(any(row['id'] in l['element_ids'] for l in links) or bool(row['decision_ids']),
            path,'element has no inventory or grounded decision purpose',gaps)
        seen={row['id']}; parent=row['parent_id']
        while parent is not None:
            if parent in seen:
                errors.append(path+': parent cycle'); break
            seen.add(parent)
            if parent not in elements:
                errors.append(path+': unknown parent reference '+parent); break
            require(elements[parent]['screen_id']==row['screen_id'],path,'parent crosses screen boundary')
            parent=elements[parent]['parent_id']
        if isinstance(row['repetition'],dict) and 'unknown' in row['repetition']:
            text(row['repetition']['unknown'],path+'.repetition.unknown',gaps)
        elif isinstance(row['repetition'],dict):
            repeat=row['repetition']; text(repeat['item_scope'],path+'.repetition.item_scope')
            refs([repeat['membership_rule_id']]+repeat['aggregate_rule_ids'],rules,path+'.repetition.rules')

    def repeat_root(scope):
        seen=set()
        while scope in elements and scope not in seen:
            seen.add(scope); row=elements[scope]
            if isinstance(row['repetition'],dict) and 'unknown' not in row['repetition']: return scope
            scope=row['parent_id']
        return None

    values={}
    for axis in axes.values():
        path='state_axes.'+axis['id']; refs([axis['scope_id']],scopes,path)
        ids=[v['id'] for v in axis['values']]
        require(bool(ids),path,'state values required',gaps); require(len(ids)==len(set(ids)),path,'duplicate value id')
        values[axis['id']]=set(ids)
        for value in axis['values']:
            for key in ('id','label','meaning'): text(value[key],path+'.values.'+key)
        require(bool(axis['initial_conditions']),path,'initial conditions required',gaps)
        for initial in axis['initial_conditions']:
            refs([initial['value_id']],set(ids),path+'.initial_conditions')
            text(initial['condition'],path+'.initial.condition',gaps); text(initial['rationale'],path+'.initial.rationale',gaps)

    def assignments(rows,path,case=None):
        mapped={}; items={i['id']:i for i in case['sample_items']} if case else {}
        for a in rows:
            refs([a['scope_id']],scopes,path+'.scope'); refs([a['axis_id']],axes,path+'.axis')
            refs([a['value_id']],values.get(a['axis_id'],set()),path+'.value')
            axis=axes.get(a['axis_id'],{})
            require(axis.get('scope_id')==a['scope_id'],path,'axis belongs to another scope')
            key=(a['scope_id'],a['item_ref'],a['axis_id'])
            require(key not in mapped,path,'conflicting or duplicate assignment for same item axis')
            mapped[key]=a['value_id']
            root=repeat_root(a['scope_id'])
            require((a['item_ref'] is not None)==bool(root),path,'repeated item_ref required; non-repeated item_ref must be null')
            if case:
                screen=a['scope_id'] if a['scope_id'] in screens else elements.get(a['scope_id'],{}).get('screen_id')
                require(screen==case['screen_id'],path,'assignment crosses screen boundary')
                if root:
                    require(a['item_ref'] in items,path,'unknown repeated item reference')
                    require(items.get(a['item_ref'],{}).get('template_scope_id')==root,path,'item repetition template mismatch')
        return mapped

    case_states={}; observed_values=[]
    for case in cases.values():
        path='render_cases.'+case['id']; refs([case['screen_id']],screens,path)
        text(case['title'],path+'.title'); text(case['focus_expectation'],path+'.focus_expectation',gaps)
        refs(case['scenario_ids'],scenarios,path+'.scenario_ids')
        item_ids=[i['id'] for i in case['sample_items']]; group_ids=[g['id'] for g in case['sample_groups']]
        require(len(item_ids+group_ids)==len(set(item_ids+group_ids)),path,'duplicate sample item/group id')
        for item in case['sample_items']:
            require(repeat_root(item['template_scope_id'])==item['template_scope_id'],path,'sample must bind repetition template')
        for group in case['sample_groups']:
            refs(group['item_ids'],set(item_ids),path+'.sample_groups'); refs([group['membership_rule_id']],rules,path+'.membership_rule_id')
        case_states[case['id']]=assignments(case['state_assignments'],path,case)
        observed_values.extend(a['axis_id']+':'+a['value_id'] for a in case['state_assignments'])
        expected={(scope, item['id'] if repeat_root(scope) else None, axis['id'])
            for axis in axes.values() for scope in [axis['scope_id']]
            if (scope==case['screen_id'] or elements.get(scope,{}).get('screen_id')==case['screen_id'])
            for item in (case['sample_items'] if repeat_root(scope) else [{'id':None}])
            if not repeat_root(scope) or item['template_scope_id']==repeat_root(scope)}
        require(expected<=set(case_states[case['id']]),path,'render case missing declared axis assignments',gaps)
    metric('state_values',{axis+':'+value for axis,vs in values.items() for value in vs},set(observed_values))

    row_index={}
    for rule in rules.values():
        path='interaction_rules.'+rule['id']
        refs(rule['input_scope_ids'],scopes,path+'.input_scope_ids'); refs(rule['output_scope_ids'],scopes,path+'.output_scope_ids')
        require(bool(rule['condition_rows']),path,'condition rows required',gaps)
        for row in rule['condition_rows']:
            require(row['id'] not in row_index and row['id'] not in all_ids,path,'duplicate condition row id')
            row_index[row['id']]=row
            assignments(row['when'],path+'.when'); assignments(row['effects'],path+'.effects')
            refs(row['transition_ids'],transitions,path+'.transition_ids'); refs(row['scenario_ids'],scenarios,path+'.scenario_ids')
            require(bool(row['scenario_ids']),path,'condition row needs scenario',gaps)

    for transition in transitions.values():
        path='transitions.'+transition['id']; refs(transition['target_scope_ids'],scopes,path+'.target_scope_ids')
        require(bool(transition['target_scope_ids']),path,'target scopes required',gaps)
        for key in ('event','observable_result','feedback','focus_result'): text(transition[key],path+'.'+key,gaps)
        for key in ('before','after','preserved_values'):
            rows = [a for a in transition[key] if 'axis_id' in a]
            assignments(rows,path+'.'+key)
            require(all(a['scope_id'] in transition['target_scope_ids'] for a in transition[key]),path,'assignment outside target scopes')
        for number, row in enumerate(a for a in transition['preserved_values'] if 'content' in a):
            text(row['content'],f"{path}.preserved_values[{number}].content",gaps)
        selector=transition['target_selector']
        repeated=any(repeat_root(s) for s in transition['target_scope_ids'])
        require((selector['kind']!='none')==repeated,path,'target selector does not match repetition')
        if repeated: text(selector['symbol'],path+'.target_selector.symbol')
        if selector['rule_id']: refs([selector['rule_id']],rules,path+'.target_selector.rule_id')
        if selector['kind']=='group': require(bool(selector['rule_id']),path,'group selector needs membership rule',gaps)
        if two: refs(transition['parent_transition_refs'],{x['id'] for x in two['experience_transitions']},path+'.parent_transition_refs')

    # Literal predicates are checked mechanically. Natural-language conditions stay under S3/S4/S5 review.
    forbidden_patterns=[]
    for constraint in data['constraints']:
        path='constraints.'+constraint['id']; refs(constraint['scope_ids'],scopes,path+'.scope_ids')
        for key in ('condition','required_outcome','rationale'): text(constraint[key],path+'.'+key,gaps)
        for combination in constraint['forbidden_combinations']:
            pattern=assignments(combination,path+'.forbidden_combinations')
            require(bool(pattern),path,'empty forbidden combination is ambiguous')
            forbidden_patterns.append((constraint['id'],pattern))
            for case_id, state in case_states.items():
                require(not pattern or not all(state.get(k)==v for k,v in pattern.items()),path,'forbidden combination in '+case_id,gaps)

    used_transitions=set(); used_rows=set(); trajectory_states={}
    for scenario in scenarios.values():
        path='scenarios.'+scenario['id']; refs([scenario['initial_case_id'],scenario['expected_case_id']],cases,path+'.cases') if scenario['initial_case_id']!=scenario['expected_case_id'] else refs([scenario['initial_case_id']],cases,path+'.cases')
        if two: refs(scenario['parent_scenario_refs'],{x['id'] for x in two['scenarios']},path+'.parent_scenario_refs')
        require(bool(scenario['steps']),path,'steps required',gaps)
        initial=cases.get(scenario['initial_case_id']); final=cases.get(scenario['expected_case_id'])
        if not initial or not final: continue
        state=dict(case_states[initial['id']]); item_ids={i['id'] for i in initial['sample_items']}
        groups={g['id']:g for g in initial['sample_groups']}
        trajectory_states[scenario['id']]=[dict(state)]
        for step in scenario['steps']:
            refs([step['transition_id']],transitions,path+'.transition_id'); refs(step['condition_row_ids'],row_index,path+'.condition_row_ids')
            require(bool(step['expected_observations']),path,'expected observations required',gaps)
            transition=transitions.get(step['transition_id'])
            if not transition: continue
            used_transitions.add(transition['id']); used_rows.update(step['condition_row_ids'])
            bindings={b['symbol']:b['item_refs'] for b in step['item_bindings']}
            require(len(bindings)==len(step['item_bindings']),path,'duplicate binding symbol')
            expanded={}
            for symbol,targets in bindings.items():
                refs(targets,item_ids | set(groups),path+'.item_bindings')
                expanded[symbol]=[]
                for target in targets:
                    expanded[symbol].extend(groups[target]['item_ids'] if target in groups else [target])
                require(bool(expanded[symbol]),path,'empty item binding',gaps)
                require(len(expanded[symbol])==len(set(expanded[symbol])),path,'overlapping item binding targets')
            selector=transition['target_selector']
            if selector['kind']!='none':
                targets=bindings.get(selector['symbol'],[])
                require(bool(targets),path,'missing target selector binding',gaps)
                if selector['kind']=='item': require(len(expanded.get(selector['symbol'],[]))==1,path,'item selector must bind one item',gaps)
                if selector['kind']=='group':
                    require(len(targets)==1 and targets[0] in groups,path,'group selector requires group binding',gaps)
                    if len(targets)==1 and targets[0] in groups:
                        require(groups[targets[0]]['membership_rule_id']==selector['rule_id'],path,'group binding membership rule mismatch',gaps)

            def expand(rows):
                result={}
                for a in rows:
                    refs_for_item=[None] if a['item_ref'] is None else expanded.get(a['item_ref'],[])
                    if a['item_ref'] is not None:
                        require(bool(refs_for_item),path,'missing item binding for '+a['item_ref'],gaps)
                        require(a['item_ref']==selector['symbol'],path,'assignment symbol differs from target selector',gaps)
                    for item in refs_for_item:
                        key=(a['scope_id'],item,a['axis_id'])
                        require(key in state,path,'bound item axis absent from initial state',gaps)
                        require(key not in result,path,'conflicting expanded assignment')
                        result[key]=a['value_id']
                return result
            before=expand(transition['before']); after=expand(transition['after']); preserved=expand([a for a in transition['preserved_values'] if 'axis_id' in a])
            require(all(state.get(k)==v for k,v in before.items()),path,'trajectory before state mismatch',gaps)
            require(all(state.get(k)==v for k,v in preserved.items()),path,'preserved value differs before transition',gaps)
            old=dict(state); state.update(after)
            trajectory_states[scenario['id']].append(dict(state))
            for constraint_id, pattern in forbidden_patterns:
                require(not pattern or not all(state.get(k)==v for k,v in pattern.items()),
                    path,'forbidden intermediate combination '+constraint_id,gaps)
            require(all(state.get(k)==v for k,v in preserved.items()),path,'preserved value changed',gaps)
            for rid in step['condition_row_ids']:
                row=row_index.get(rid)
                if not row: continue
                require(transition['id'] in row['transition_ids'] and scenario['id'] in row['scenario_ids'],path,'condition row links disagree with scenario',gaps)
                when=expand(row['when']); effects=expand(row['effects'])
                require(all(old.get(k)==v for k,v in when.items()),path,'condition row does not match before state',gaps)
                require(all(state.get(k)==v for k,v in effects.items()),path,'condition row effects disagree with transition',gaps)
        require(state==case_states[final['id']],path,'expected final state differs from trajectory',gaps)
    for case in cases.values():
        require(bool(case['scenario_ids']), 'render_cases.'+case['id'], 'reproduce case in a scenario',gaps)
        for scenario_id in case['scenario_ids']:
            require(case_states[case['id']] in trajectory_states.get(scenario_id,[]),
                'render_cases.'+case['id'],'scenario does not reproduce this case '+scenario_id,gaps)
    metric('transitions',set(transitions),used_transitions)
    metric('condition_rows',set(row_index),used_rows)

    coverage_metric=metric('scope_dimensions',coverage_ids,[r['scope_id']+':'+r['dimension'] for r in data['coverage_checks']])
    open_ids={r['scope_id']+':'+r['dimension'] for r in data['coverage_checks'] if r['status']=='open'}
    coverage_metric['open_ids']=sorted(open_ids)
    coverage_metric['numerator']-=len(open_ids & coverage_ids)
    if open_ids:
        coverage_metric['status']='incomplete'
    checks={}
    for row in data['coverage_checks']:
        path='coverage.'+row['scope_id']+':'+row['dimension']; checks[(row['scope_id'],row['dimension'])]=row
        refs([row['scope_id']],scopes,path)
        for key, known in (('source_ids',sources),('axis_ids',axes),('transition_ids',transitions),
                ('rule_ids',rules),('scenario_ids',scenarios),('issue_ids',indices['issues'])):
            refs(row[key],known,path+'.'+key)
        text(row['rationale'],path+'.rationale',gaps)
        if row['status']=='deferred':
            # 왜 판정할 수 없는지를 이름 대야 쓸 수 있다. 그 이유는 둘 중 하나다.
            #   ① 상위가 아직 말하지 않았다 → 그 사실을 기다리는 열린 blocking 역류
            #   ② 상위가 「이번에는 안 한다」고 이미 정했다 → 그 미결·결정을 가리키는 출처
            # 처음엔 ①만 받았는데, 실주행 두 건이 **상위가 이미 답하고 기획자 승인까지 받은**
            # 자리에 역류를 올렸다가 그 자리에서 닫아야 했다. 역류는 모르는 것을 묻는 통로이지
            # 이미 아는 것을 다시 묻는 통로가 아니다.
            waits = [name for name in row['issue_ids']
                     if (indices['issues'].get(name, {}).get('blocking')
                         and (indices['issues'].get(name, {}).get('action') or {}).get('kind') == 'wait')]
            ruled = settled_upstream(data, row['source_ids'])
            require(bool(waits) or bool(ruled), path,
                    'deferred coverage names neither an open blocking backflow (upstream has not '
                    'said) nor the upstream open_questions/decisions entry it defers to', gaps)
            require(not row['issue_ids'] or waits, path,
                    'deferred coverage needs an open blocking backflow', gaps)
            # 문구가 동작과 반대였다 — 「아직 안 갖고 있다」로 읽히는데 실제로는
            # **갖고 있어서** 우는 규칙이다. 한 실행기가 셋으로 갈라 확인하고서야 알았다.
            require(not row['axis_ids'] and not row['transition_ids'], path,
                    'deferred coverage must leave axis_ids and transition_ids empty — '
                    '미룬 칸에 축·전이가 달려 있다. 판정을 미뤘다면 그 축은 이 칸의 답이 '
                    '아니고, 축이 답이라면 미룬 것이 아니다', gaps)
        elif row['status']=='open':
            gaps.append(path+': open coverage'); require(bool(row['issue_ids']),path,'open coverage needs next-action issue',gaps)
        elif row['status']=='not_applicable':
            require(bool(row['source_ids']),path,'not applicable requires sources',gaps)
            require(not row['axis_ids'] and not any(a['scope_id']==row['scope_id'] and a['dimension']==row['dimension'] for a in axes.values()),path,'excluded dimension has active state axes',gaps)
        else:
            require(bool(row['axis_ids']),path,'applicable coverage needs axes',gaps)
            require(bool(row['scenario_ids']),path,'applicable coverage needs scenarios',gaps)
            for aid in row['axis_ids']:
                axis=axes.get(aid,{})
                require(axis.get('scope_id')==row['scope_id'] and axis.get('dimension')==row['dimension'],path,'coverage axis scope/dimension mismatch')
    for axis in axes.values():
        row=checks.get((axis['scope_id'],axis['dimension']),{})
        require(axis['id'] in row.get('axis_ids',[]), 'coverage', 'axis not linked '+axis['id'],gaps)
    for profile in data['state_profiles']:
        refs(profile['axis_candidates'],set(COVERAGE_DIMENSIONS),'state_profiles.axis_candidates')
        text(profile['version'],'state_profiles.version',gaps)
    for element in elements.values():
        for pid in element['profile_ids']:
            profile=indices['state_profiles'].get(pid,{})
            require(element['semantic_type'] in profile.get('semantic_types',[]),'profile','semantic type mismatch',gaps)
            for dim in profile.get('axis_candidates',[]):
                check=checks.get((element['id'],dim),{})
                require(check.get('status')=='applicable' or dim in profile.get('overrides',[]),
                    'profile','candidate excluded without explicit override '+element['id']+':'+dim,gaps)
            for event in profile.get('event_candidates',[]):
                require(any(t['event']==event and element['id'] in t['target_scope_ids'] for t in transitions.values())
                    or event in profile.get('overrides',[]),'profile','event candidate omitted '+event,gaps)

    for packet in data['decision_packets']:
        path='decision_packets.'+packet['id']; refs(packet['decision_scope']['target_refs'],all_targets,path+'.scope')
        option_ids=[o['id'] for o in packet['options']]
        require(2<=len(option_ids)<=3 and len(option_ids)==len(set(option_ids)),path,'two or three unique options required')
        refs([packet['recommendation']['option_id']],set(option_ids),path+'.recommendation')
        refs(packet['recommendation']['evidence_ids'],sources,path+'.evidence')
        if packet['status']=='open': gaps.append(path+': unresolved decision packet')
        else:
            user=packet['selection']['user_source_id']; refs([user],sources,path+'.selection')
            require(sources.get(user,{}).get('provider')=='user',path,'actual user selection required',gaps)
            if packet['status']=='selected': refs([packet['selection']['option_id']],set(option_ids),path+'.selection.option_id')
            else: text(packet['selection']['custom_text'],path+'.custom_text',gaps)
        require(not(packet['risk']=='high_impact' and packet['grouping']['mode']=='bundle'),path,'high impact cannot be bundled',gaps)
    for issue in data['issues']:
        path='issues.'+issue['id']; refs(issue['target_refs'],all_targets,path+'.target_refs')
        for key in ('question','reason'): text(issue[key],path+'.'+key)
        text(issue['action']['prompt'],path+'.action.prompt')
        if not closed(issue) and (issue['blocking'] or issue['target'] in ('planning_context','user_experience','screen_behavior')):
            gaps.append(path+': unresolved issue')
    if data['status']=='waiting':
        # 상위로 되돌린 역류도 기다림이다. 대상을 아래쪽 단계로 한정하면 역류한 케이스가
        # waiting을 쓸 수 없고, 그러면 아무도 역류하지 않는다.
        require(any(i['blocking'] and i['action']['kind'] in ('wait','handoff')
                    for i in data['issues']),
            '$.status','waiting requires a blocking dependency or backflow with a resume action')
        require(not any(i['action']['kind'] in ('ask_user','platty','web')
            or i['target'] in ('planning_context','user_experience') for i in data['issues']),
            '$.status','waiting cannot mask executable internal work or upstream return')
    for handoff in data['design_handoffs']:
        path='design_handoffs.'+handoff['id']; refs([handoff['screen_id']],screens,path)
        refs(handoff['element_ids'],elements,path+'.element_ids'); refs(handoff['required_state_refs'],axes,path+'.required_state_refs')
        refs(handoff['render_case_ids'],cases,path+'.render_case_ids'); refs(handoff['interaction_refs'],set(transitions)|set(rules),path+'.interaction_refs')
        require(all(elements.get(e,{}).get('screen_id')==handoff['screen_id'] for e in handoff['element_ids']),path,'element differs from handoff screen')
        require(all(cases.get(c,{}).get('screen_id')==handoff['screen_id'] for c in handoff['render_case_ids']),path,'render case differs from handoff screen')
        for key in ('semantic_pattern','owner'): text(handoff[key],path+'.'+key,gaps)
        require(bool(handoff['accessibility_expectations']) and bool(handoff['render_case_ids']),path,'accessibility and render cases required',gaps)
        if handoff['mapping_status']=='verified':
            source=sources.get(handoff['candidate_design_system_ref'],{})
            require(bool(source.get('reference')) and bool(source.get('revision')),path,'verified DS mapping needs actual versioned source',gaps)
        elif handoff['mapping_status']=='unmapped': text(handoff['gap'],path+'.gap',gaps)
    metric('screen_handoffs',set(screens),set(h['screen_id'] for h in data['design_handoffs']))

    expected_reviews=required_reviews(data); observed=[]; stale=[]; counts=Counter()
    for row in data['reviews'] + list(data['review'].values()):
        path='review.'+row['id']; counts[row['verdict']]+=1
        refs(row['target_refs'],all_targets,path+'.target_refs'); refs(row['example_ids'],set(EXAMPLES),path+'.example_ids')
        refs(row['source_ids'],sources,path+'.source_ids'); refs(row['issue_ids'],indices['issues'],path+'.issue_ids')
        require(row['verdict']=='suitable',path,'qualitative review not suitable',gaps)
        if row['verdict']!='pending':
            text(row['rationale'],path+'.rationale',gaps)
            if row['content_hash']!=content_hash: stale.append(row['id']); gaps.append(path+': stale review content hash')
        if row['verdict']=='suitable':
            require(bool(set(row['example_ids']) & CRITERION_EXAMPLES[row['criterion_id']]),path,'criterion requires relevant comparison example',gaps)
            require(bool(row['target_refs']) and bool(row['example_ids']) and bool(row['source_ids']),path,'suitable review requires targets, examples and actual evidence',gaps)
            # 1a는 4차에 「이 단계가 소유한 질문인가」로 고쳤고 2단계도 이제 그렇다. 여기만
            # **열림·닫힘조차 보지 않고** 티켓을 가리키기만 하면 거부했다 — 5차의 한 실행기가
            # 이미 `resolution`이 적힌 닫힌 티켓에서 막혔고, 같은 문서 안에서
            # `view_requirements[].assessment`는 같은 티켓으로 통과했다. 기준은 소유다.
            owed = [name for name in row['issue_ids']
                    if not closed(indices['issues'].get(name, {}))
                    and indices['issues'].get(name, {}).get('target') == 'screen_behavior'
                    and (indices['issues'].get(name, {}).get('action') or {}).get('kind')
                    not in ('wait', 'handoff')]
            require(not owed, path,
                    'suitable review rests on an unanswered question this stage owns: '
                    + ', '.join(owed), gaps)
        elif row['verdict'] in ('needs_work','insufficient_evidence'):
            require(bool(row['issue_ids']),path,'failed review needs actionable issue',gaps)
    for row in data['reviews']:
        observed.extend(row['criterion_id']+':'+target for target in row['target_refs'])
    qualitative_metric=metric('qualitative_targets',{c+':'+target for c,target in expected_reviews},observed)
    for criterion,row in data['review'].items():
        require(row['criterion_id']==criterion and row['target_refs']==['model'], 'review.'+criterion,'overall criterion must review model',gaps)
    report['qualitative']={'review_ids':[r['id'] for r in data['reviews']],
        'missing_targets':qualitative_metric['missing_ids'],'stale_review_ids':stale,'verdict_counts':dict(counts)}
    ownership_gaps,ownership_metric,open_decisions=decision_inventory_gaps(data)
    gaps.extend(ownership_gaps);metrics.append(ownership_metric)
    report.update(decision_gaps=ownership_gaps,open_decision_ids=open_decisions,planner_decisions_ready=not ownership_gaps)
    gaps.extend(state_expression_gaps(data))
    gaps.extend(view_requirement_gaps(data))
    knowledge_gaps = knowledge_binding_gaps(data) + pack_approval_gaps(data)
    gaps.extend(knowledge_gaps)
    report['knowledge_ready'] = not knowledge_gaps
    review_limits = review_finding_limits(data)
    gaps.extend(review_finding_gaps(data))
    report['review_findings'] = review_limits
    # 막지 않는다. 어느 요소에 검사가 닿지 않았는지를 보이게만 한다.
    report['unexamined_elements'] = (profileless_element_limits(data)
                                    + undetermined_repetition_limits(data)
                                    + unread_contract_limits(data))
    report['verification_gaps']=list(gaps)
    ready=not errors and not gaps
    completion=list(gaps); confirmation=data['confirmation']
    require(confirmation['confirmed'],'$.confirmation','user confirmation missing',completion)
    if confirmation['confirmed']:
        text(confirmation['turn_id'],'$.confirmation.turn_id',completion)
        text(confirmation['statement'],'$.confirmation.statement',completion)
        require(confirmation['content_hash']==content_hash,'$.confirmation','stale confirmation content hash',completion)
        require(confirmation['review_hash']==review_hash,'$.confirmation','stale confirmation review hash',completion)
    require(data['status']=='complete','$.status','not complete',completion)
    complete=ready and not completion
    if data['status']=='complete' and not complete: errors.append('$.status: complete is inconsistent with current validation')
    report.update(valid=not errors,ready_for_confirmation=ready,complete=complete,completion_errors=completion,
        next_actions=[{'id':i['id'],'kind':i['action']['kind'],'prompt':i['action']['prompt']} for i in data['issues'] if not closed(i)],
        blocking_issue_ids=[i['id'] for i in data['issues'] if i['blocking'] or i['target'] in ('planning_context','user_experience','screen_behavior')],
        input_hashes={key:value['content_hash'] for key,value in data['input_binding'].items()})
    return report


def render(data, report=None):
    if isinstance(data,dict) and type(data.get("schema_version")) is int and data["schema_version"]==2:
        return _v2.render(data,report)
    if isinstance(data, dict) and type(data.get("schema_version")) is int and data["schema_version"] == 1:
        return _legacy.render(data, report)
    """Human review view with traceable IDs, independent state axes and local flows."""
    report = report or validate(data)
    def esc(value):
        return html.escape(str(value)).replace('|', '&#124;').replace('\n', ' ')
    def words(values, empty='없음'):
        return '; '.join(esc(value) for value in values) or empty
    scopes = {row['id']: row for row in data['screens'] + data['elements']}
    axes = {row['id']: row for row in data['state_axes']}
    transitions = {row['id']: row for row in data['transitions']}
    def scope_name(sid):
        return scopes.get(sid, {}).get('name', sid) + ' (' + sid + ')'
    def value_name(axis_id, value_id):
        value = next((v for v in axes.get(axis_id, {}).get('values', []) if v['id'] == value_id), {})
        return value.get('label', value_id) + (' · ' + value['meaning'] if value.get('meaning') else '')
    def assignment_text(rows):
        parts = []
        for row in rows:
            item = ' · 항목 ' + row['item_ref'] if row['item_ref'] is not None else ''
            if 'content' in row:
                parts.append(scope_name(row['scope_id']) + item + ' / 내용: ' + row['content']
                             + f" (채운 쪽: {row['filled_by']})")
                continue
            parts.append(scope_name(row['scope_id']) + item + ' / ' + row['axis_id'] + ': ' + value_name(row['axis_id'], row['value_id']))
        return words(parts, '변경 없음 또는 해당 없음')
    def mermaid_label(value):
        return esc(value).replace('"', '&quot;').replace('`', '&#96;')
    lines = [f"# {esc(data['title'])}", '', f"상태: {data['status']}", '',
             '## 화면 인덱스', '']
    lines += [f"- {esc(scope_name(s['id']))}" for s in data['screens']]
    for screen in data['screens']:
        sid = screen['id']
        elements = [e for e in data['elements'] if e['screen_id'] == sid]
        scope_ids = {sid} | {e['id'] for e in elements}
        lines += ['', f"## {esc(scope_name(sid))}", '', esc(screen['purpose']), '', '### 구성과 역할', '']
        nodes = {scope: 'scope' + str(n) for n, scope in enumerate([sid] + [e['id'] for e in elements])}
        lines += ['```mermaid', 'flowchart LR']
        for scope, node in nodes.items():
            lines.append(f'  {node}["{mermaid_label(scope_name(scope))}"]')
        for element in elements:
            parent = element['parent_id'] or sid
            if parent in nodes:
                lines.append(f"  {nodes[parent]} --> {nodes[element['id']]}")
        lines += ['```', '', '| 요소 | 의미·목적 | 반복 대상 |', '|---|---|---|']
        for element in elements:
            repeat = element['repetition']
            repetition = ('없음' if repeat == 'none'
                          else '모름 — ' + repeat['unknown'] if 'unknown' in repeat
                          else repeat['item_scope'] + ' · 집합 규칙 ' + repeat['membership_rule_id'])
            lines.append(f"| {esc(scope_name(element['id']))} | {esc(element['semantic_type'])}: {esc(element['purpose'])} | {esc(repetition)} |")
        lines += ['', '### 상태 축', '', '| 대상 | 축 | 차원 | 값과 의미 | 초기 조건 |', '|---|---|---|---|---|']
        for axis in data['state_axes']:
            if axis['scope_id'] not in scope_ids:
                continue
            initial = [r['condition'] + ' → ' + value_name(axis['id'], r['value_id']) + ' (' + r['rationale'] + ')' for r in axis['initial_conditions']]
            labels = [v['id'] + ' · ' + v['label'] + ': ' + v['meaning'] for v in axis['values']]
            lines.append(f"| {esc(scope_name(axis['scope_id']))} | {esc(axis['id'])} | {esc(axis['dimension'])} | {words(labels)} | {words(initial)} |")
        lines += ['', '### 조작·연동 흐름', '']
        for n, t in enumerate(data['transitions']):
            if not set(t['target_scope_ids']) & scope_ids:
                continue
            lines += [f"#### {esc(t['event'])} ({esc(t['id'])})", '', '```mermaid', 'flowchart LR',
                f'  before{n}["{mermaid_label(t["event"])}"] --> result{n}["{mermaid_label(t["observable_result"])}"]', '```', '',
                f"조건: {words(t['preconditions'])}", f"변경 전: {assignment_text(t['before'])}",
                f"변경 후: {assignment_text(t['after'])}", f"유지되는 값: {assignment_text(t['preserved_values'])}",
                f"다음 행동: {words(t['allowed_actions'])}", f"피드백: {esc(t['feedback'])}",
                f"포커스: {esc(t['focus_result'])}", '']
        for rule in data['interaction_rules']:
            if not set(rule['input_scope_ids'] + rule['output_scope_ids']) & scope_ids:
                continue
            lines += [f"#### 연동 규칙 {esc(rule['id'])} ({rule['kind']})", '',
                      '| 조건 | 결과 | 연결 시나리오 |', '|---|---|---|']
            for row in rule['condition_rows']:
                lines.append(f"| {assignment_text(row['when'])} | {assignment_text(row['effects'])} | {words(row['scenario_ids'])} |")
            lines.append('')
        for constraint in data['constraints']:
            if set(constraint['scope_ids']) & scope_ids:
                lines += [f"- 제약 {esc(constraint['id'])}: {esc(constraint['condition'])} → {esc(constraint['required_outcome'])}. {esc(constraint['rationale'])}"]
                for combination in constraint['forbidden_combinations']:
                    lines.append(f"  금지 조합: {assignment_text(combination)}")
        lines += ['', '### 재현 사례 · 정상·예외·복구', '']
        screen_cases = [c for c in data['render_cases'] if c['screen_id'] == sid]
        for case in screen_cases:
            lines += [f"#### {esc(case['title'])} ({esc(case['id'])})", '']
            for item in case['sample_items']:
                lines.append(f"- 항목 {esc(item['id'])}: {esc(scope_name(item['template_scope_id']))} · {words(item['traits'])}")
            for group in case['sample_groups']:
                lines.append(f"- 집합 {esc(group['id'])}: {words(group['item_ids'])} · 소속 규칙 {esc(group['membership_rule_id'])}")
            lines += ['', '| 대상 | 항목 | 독립 축 | 값과 의미 |', '|---|---|---|---|']
            for row in case['state_assignments']:
                lines.append(f"| {esc(scope_name(row['scope_id']))} | {esc(row['item_ref'] or '공통')} | {esc(row['axis_id'])} | {esc(value_name(row['axis_id'], row['value_id']))} |")
            lines += ['', f"보이는 정보: {words(case['visible_information'])}",
                f"가능 행동: {words(case['available_actions'])}",
                f"차단 행동과 이유: {words(case['blocked_actions_with_reasons'])}",
                f"포커스: {esc(case['focus_expectation'])}",
                f"연결 시나리오: {words(case['scenario_ids'])}",
                f"동등 사례로 묶은 이유: {esc(case['equivalence_rationale'])}", '']
        case_ids = {c['id'] for c in screen_cases}
        for scenario in data['scenarios']:
            if not case_ids & {scenario['initial_case_id'], scenario['expected_case_id']}:
                continue
            lines += [f"#### 시나리오 {esc(scenario['id'])} ({scenario['kind']})", '',
                      f"시작: {esc(scenario['initial_case_id'])}", '']
            for number, step in enumerate(scenario['steps'], 1):
                t = transitions.get(step['transition_id'], {})
                bindings = [b['symbol'] + ' → ' + ', '.join(b['item_refs']) for b in step['item_bindings']]
                lines += [f"{number}. {esc(t.get('event', step['transition_id']))} ({esc(step['transition_id'])})", '',
                    f"   대상: {words(bindings, '공통 요소')}",
                    f"   조건: {words(t.get('preconditions', []))}",
                    f"   관찰 결과: {words(step['expected_observations'])}",
                    f"   피드백: {esc(t.get('feedback', ''))} · 포커스: {esc(t.get('focus_result', ''))}", '']
            lines += [f"종료: {esc(scenario['expected_case_id'])}", '']
        lines += ['### 디자인 시스템 인계', '']
        for h in data['design_handoffs']:
            if h['screen_id'] == sid:
                lines += [f"- {esc(h['id'])}: {esc(h['semantic_pattern'])} · {h['mapping_status']}",
                    f"  재현 사례: {words(h['render_case_ids'])} · 접근성: {words(h['accessibility_expectations'])}",
                    f"  지원 공백: {esc(h['gap'])} · 담당: {esc(h['owner'])}"]
    lines += ['', '## 적용성·검토', '', '| 지표 | 검토 / 분모 | 상태 | 누락 |', '|---|---|---|---|']
    for m in report['metrics']:
        lines.append(f"| {m['id']} | {m['numerator']} / {m['denominator']} | {m['status']} | {words(m['missing_ids'])} |")
    for row in data['coverage_checks']:
        lines.append(f"- {esc(scope_name(row['scope_id']))} / {row['dimension']}: {row['status']} · {esc(row['rationale'])}")
    for row in data['reviews'] + list(data['review'].values()):
        lines.append(f"- {row['criterion_id']} {words(row['target_refs'])}: {row['verdict']} — {esc(row['rationale'])} ({words(row['example_ids'])})")
    lines += ['', '## 결정·미해결 사항', '']
    for row in data['decisions']:
        lines.append(f"- {esc(row['id'])}: {esc(row['statement'])} · {row['origin']} · {row['status']} · {esc(row['rationale'])}")
    for row in data['issues']:
        lines.append(f"- {esc(row['id'])}: {esc(row['question'])} → {esc(row['action']['prompt'])}")
    lines += ['', '## 검증', '',
        f"구조 유효: {report['valid']} · 최종 확인 준비: {report['ready_for_confirmation']} · 완료: {report['complete']}", '',
        '수치는 선언된 인벤토리·상태·시나리오의 연결 검사입니다. 자연어 의미와 근거의 타당성은 위 정성 검토에서 판단합니다.', '']
    return '\n'.join(lines)


def render_confirmation(data, details_path='screen-behavior-details.md'):
    """Concise final-review index; the full machine-expanded specification stays linked."""
    report = validate(data)
    scenarios = {row['id']: row for row in data['scenarios']}
    def mermaid_label(value):
        return html.escape(str(value)).replace('|', '&#124;').replace('\n', ' ').replace('"', '&quot;').replace('`', '&#96;')
    lines = [f"# {data['title']}", '', '화면 동작 명세 · 최종 확인 요약', '',
             f"전체 상세 명세: [{details_path}]({details_path})", '',
             '## 화면별 검토 범위', '']
    for screen in data['screens']:
        sid = screen['id']
        elements = {row['id'] for row in data['elements'] if row['screen_id'] == sid}
        scopes = elements | {sid}
        transitions = [row for row in data['transitions'] if set(row['target_scope_ids']) & scopes]
        cases = [row for row in data['render_cases'] if row['screen_id'] == sid]
        case_ids = {row['id'] for row in cases}
        related = [row for row in data['scenarios']
                   if case_ids & {row['initial_case_id'], row['expected_case_id']}]
        kinds = Counter(row['kind'] for row in related)
        lines += [f"### {screen['name']} ({sid})", '', screen['purpose'], '',
                  f"요소 {len(elements)}개 · 상태축 {sum(row['scope_id'] in scopes for row in data['state_axes'])}개 · "
                  f"전이 {len(transitions)}개 · 재현 사례 {len(cases)}개", '',
                  '시나리오: ' + ', '.join(f"{kind} {count}개" for kind, count in sorted(kinds.items())), '']
        if related:
            case_titles = {row['id']: row['title'] for row in cases}
            lines += ['```mermaid', 'flowchart LR']
            for index, scenario in enumerate(related):
                start = f's{index}'
                end = f'e{index}'
                lines.append(f'  {start}["{mermaid_label(case_titles.get(scenario["initial_case_id"], scenario["initial_case_id"]))}"]')
                previous = start
                for step_index, step in enumerate(scenario['steps']):
                    transition = next((row for row in transitions if row['id'] == step['transition_id']), {})
                    current = f't{index}_{step_index}'
                    lines.append(f'  {previous} -->|"{mermaid_label(transition.get("event", step["transition_id"]))}"| {current}["{mermaid_label(transition.get("observable_result", step["transition_id"]))}"]')
                    previous = current
                lines.append(f'  {previous} --> {end}["{mermaid_label(case_titles.get(scenario["expected_case_id"], scenario["expected_case_id"]))}"]')
            lines += ['```', '']
        for case in cases[:4]:
            lines.append(f"- 대표 상태: {case['title']} — {'; '.join(case['visible_information'][:2])}")
        for kind in sorted(kinds):
            example = next(row for row in related if row['kind'] == kind)
            step = example['steps'][-1] if example['steps'] else None
            transition = next((row for row in transitions if step and row['id'] == step['transition_id']), None)
            result = transition['observable_result'] if transition else example['expected_case_id']
            lines.append(f"- {kind}: {example['id']} — {result}")
        lines.append('')
    if data.get('schema_version') == 3 and data['decision_packets']:
        lines += ['## 화면에서 확정한 결정', '']
        for packet in data['decision_packets']:
            selection=packet.get('selection', {})
            if packet.get('status') in ('selected','revised'):
                chosen=selection.get('custom_text') or selection.get('option_id')
                lines.append(f"- {packet['topic']}: {chosen}")
        lines.append('')
    lines += ['## 확정 결정과 남은 인계', '']
    for row in data['decisions']:
        lines.append(f"- {row['statement']} ({row['origin']} · {row['status']})")
    for row in data['issues']:
        lines.append(f"- 남은 항목: {row['question']} → {row['action']['prompt']}")
    lines += ['', '## 검증', '']
    for metric in report['metrics']:
        lines.append(f"- {metric['id']}: {metric['numerator']}/{metric['denominator']} · {metric['status']}")
    verdicts = report.get('qualitative', {}).get('verdict_counts', {})
    lines += [f"- 정성 검토: " + ', '.join(f"{key} {value}개" for key, value in sorted(verdicts.items())),
              f"- 최종 확인 준비: {report['ready_for_confirmation']}", '',
              '위 요약은 전체 범위를 줄인 것이 아니라 검토 인덱스입니다. 상태·조건·예외·복구·근거의 전체 내용은 상세 명세에 보존됩니다.', '']
    return '\n'.join(lines)


def init_from_user_experience(output, input_path=None):
    output=Path(output); data=load_json(TEMPLATE)
    data['case_id']=re.sub(r'[^a-z0-9]+','-',output.parent.name.lower()).strip('-') or 'untitled'
    if input_path is not None:
        source=bind_inputs(data,Path(input_path)); data['title']=source['title']+' 화면 동작'
        data['evidence_status']['project_id']=source['evidence_status']['project_id']
        data['evidence_status']['baseline_revision']=source['evidence_status']['observed_revision']
    output.parent.mkdir(parents=True,exist_ok=True)
    with output.open('x',encoding='utf-8') as stream:
        json.dump(data,stream,ensure_ascii=False,indent=2); stream.write('\n')
    return data


def prepare_review(data):
    """Seed missing review slots; preserve evidence and existing verdict hashes verbatim."""
    if isinstance(data,dict) and data.get('schema_version')==2:
        return _v2.prepare_review(data)
    draft=copy.deepcopy(data)
    draft.setdefault('coverage_checks',[])
    draft.setdefault('reviews',[])
    draft.setdefault('review',{})
    covered={(row['scope_id'],row['dimension']) for row in draft['coverage_checks']}
    for scope in draft['screens']+draft['elements']:
        for dimension in COVERAGE_DIMENSIONS:
            if (scope['id'],dimension) not in covered:
                draft['coverage_checks'].append({'scope_id':scope['id'],'dimension':dimension,
                    'status':'open','rationale':'','source_ids':[],'axis_ids':[],
                    'transition_ids':[],'rule_ids':[],'scenario_ids':[],'issue_ids':[]})
    existing={(row['criterion_id'],target) for row in draft['reviews'] for target in row['target_refs']}
    used_ids=set()
    def collect_ids(value):
        if isinstance(value,dict):
            if isinstance(value.get('id'),str):used_ids.add(value['id'])
            for child in value.values():collect_ids(child)
        elif isinstance(value,list):
            for child in value:collect_ids(child)
    collect_ids(draft)
    def pending(criterion,target):
        prefix='pending-'+criterion+'-'+re.sub(r'[^a-zA-Z0-9-]+','-',target)
        rid=prefix; number=1
        while rid in used_ids:
            rid=prefix+'-'+str(number); number+=1
        used_ids.add(rid)
        return {'id':rid,'criterion_id':criterion,'target_refs':[target],
            'verdict':'pending','rationale':'','example_ids':[],'source_ids':[],
            'issue_ids':[],'content_hash':''}
    for criterion,target in sorted(required_reviews(draft)-existing):
        draft['reviews'].append(pending(criterion,target))
    for criterion in CRITERIA:
        if criterion not in draft['review']:
            draft['review'][criterion]=pending(criterion,'model')
    draft['status']='in_progress'
    draft['confirmation']={'confirmed':False,'turn_id':'','statement':'','content_hash':'','review_hash':''}
    errors=[]
    check_shape(draft,SHAPE,'$',errors)
    if errors:
        raise ValueError('cannot prepare structurally malformed draft: '+'; '.join(errors))
    return draft


def main():
    parser=argparse.ArgumentParser(description=__doc__); commands=parser.add_subparsers(dest='command',required=True)
    init=commands.add_parser('init'); init.add_argument('path',type=Path); init.add_argument('--input',type=Path)
    val=commands.add_parser('validate'); val.add_argument('path',type=Path)
    val.add_argument('--require-ready',action='store_true'); val.add_argument('--require-complete',action='store_true')
    ren=commands.add_parser('render'); ren.add_argument('path',type=Path); ren.add_argument('-o','--output',type=Path)
    fp=commands.add_parser('fingerprint'); fp.add_argument('path',type=Path)
    prep=commands.add_parser('prepare-review'); prep.add_argument('path',type=Path)
    prep.add_argument('-o','--output',type=Path,required=True)
    compact_parser=commands.add_parser('compact'); compact_parser.add_argument('path',type=Path)
    compact_parser.add_argument('-o','--output',type=Path,required=True)
    expand_parser=commands.add_parser('expand'); expand_parser.add_argument('path',type=Path)
    expand_parser.add_argument('-o','--output',type=Path,required=True)
    plan_parser=commands.add_parser('plan-review'); plan_parser.add_argument('path',type=Path)
    plan_parser.add_argument('-o','--output',type=Path,required=True)
    merge_parser=commands.add_parser('merge-reviews'); merge_parser.add_argument('path',type=Path)
    merge_parser.add_argument('--plan',type=Path,required=True); merge_parser.add_argument('--packets',type=Path,required=True)
    merge_parser.add_argument('-o','--output',type=Path,required=True)
    args=parser.parse_args()
    try:
        if args.command=='init':
            init_from_user_experience(args.path,args.input); result={'created':True,'path':str(args.path.resolve())}; code=0
        elif args.command=='validate':
            result=validate(load_json(args.path)); code=int(not result['valid'] or args.require_ready and not result['ready_for_confirmation'] or args.require_complete and not result['complete'])
        elif args.command=='prepare-review':
            if args.output.resolve()==args.path.resolve():
                raise ValueError('write review preparation to a separate draft')
            draft=prepare_review(load_json(args.path))
            args.output.parent.mkdir(parents=True,exist_ok=True)
            with args.output.open('x',encoding='utf-8') as stream:
                json.dump(draft,stream,ensure_ascii=False,indent=2); stream.write('\n')
            result={'path':str(args.output.resolve()),'coverage_slots':len(draft['coverage_checks']),
                'review_slots':len(draft['reviews'])+len(draft['review']),
                'note':'Only missing open/pending slots were added; existing verdicts and hashes were preserved.'}
            code=0
        elif args.command=='fingerprint':
            ch,rh=fingerprints(load_json(args.path)); result={'content_hash':ch,'review_hash':rh}; code=0
        elif args.command in ('compact','expand','plan-review','merge-reviews'):
            from screen_authoring import compact, expand, load_strict
            from screen_review import build_plan, merge_reviews
            if args.output.resolve()==args.path.resolve():
                raise ValueError('authoring/review output must differ from input')
            source=load_strict(args.path)
            if args.command=='compact': output=compact(source)
            elif args.command=='expand': output=expand(source)
            elif args.command=='plan-review': output=build_plan(source)
            else: output=merge_reviews(source,load_strict(args.plan),load_strict(args.packets))
            args.output.parent.mkdir(parents=True,exist_ok=True)
            with args.output.open('x',encoding='utf-8') as stream:
                json.dump(output,stream,ensure_ascii=False,indent=2); stream.write('\n')
            result={'path':str(args.output.resolve()),'command':args.command,
                    'input_bytes':args.path.stat().st_size,'output_bytes':args.output.stat().st_size}
            if args.command=='compact':
                result.update(state_bases=len(output['state_bases']),evidence_sets=len(output['evidence_sets']))
            elif args.command=='plan-review':
                result.update(tasks=len(output['tasks']),targets=output['target_count'],content_hash=output['content_hash'])
            elif args.command=='expand':
                check=validate(output); result.update(valid=check['valid'],ready_for_confirmation=check['ready_for_confirmation'])
            code=0
        else:
            body=render(load_json(args.path))
            if not args.output: print(body,end=''); return 0
            if args.output.resolve()==args.path.resolve(): raise ValueError('render output must differ from canonical input')
            args.output.parent.mkdir(parents=True,exist_ok=True); args.output.write_text(body,encoding='utf-8')
            result={'path':str(args.output.resolve())}; code=0
    except (OSError,ValueError,KeyError,TypeError,RecursionError) as exc:
        result={'error':str(exc)}; code=1
    print(json.dumps(result,ensure_ascii=False,indent=2)); return code


if __name__=='__main__':
    sys.exit(main())
