#!/usr/bin/env python3
"""Validate and render grounded Screen behavior screen and element behavior records."""
import argparse
from legacy import interview3 as _legacy
import copy
from collections import Counter
from datetime import datetime
import html
import json
from pathlib import Path
import re
import sys

import planning_context
import user_experience
from planning_context import load_json
from user_experience import digest

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = ROOT / 'schemas/screen-behavior.template.json'
CRITERIA = tuple(f'S{i}' for i in range(1, 9))
EXAMPLES = tuple(f'SB{i:02}' for i in range(1, 13))
CRITERION_EXAMPLES = {
    'S1':{'SB01'}, 'S2':{'SB01','SB02','SB11'}, 'S3':{'SB03','SB07','SB11'},
    'S4':{'SB03','SB04','SB06','SB10'}, 'S5':{'SB05','SB06','SB08'},
    'S6':{'SB02','SB07','SB08'}, 'S7':{'SB04','SB09','SB12'}, 'S8':{'SB09','SB10'},
}
COVERAGE_DIMENSIONS = ('visibility', 'availability', 'value_selection', 'disclosure',
    'interaction', 'validation', 'operation', 'content', 'freshness', 'continuity', 'feedback_access')
VALIDATOR_VERSION = 'screen-behavior-1'
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
            errors.append(f'{path}.{key}: unknown field')
        for key, child in shape.items():
            # This frozen validator borrows a live shape from user_experience, so it has to
            # understand the shape language — an Optional added upstream was read as required.
            if isinstance(child, planning_context.Optional):
                if key in value:
                    check_shape(value[key], child.shape, f'{path}.{key}', errors)
                continue
            if key not in value:
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
SOURCE = copy.deepcopy(user_experience.SOURCE)
SOURCE['provider'] += ('user_experience',)
REVIEW = {'id':str, 'criterion_id':CRITERIA, 'target_refs':[str],
    'verdict':('pending','suitable','needs_work','insufficient_evidence'),
    'rationale':str, 'example_ids':[str], 'source_ids':[str], 'issue_ids':[str], 'content_hash':str}
BINDING = {'path':str,'content_hash':str,'review_hash':str,'confirmation_turn_id':str}
PACKET = copy.deepcopy(user_experience.SHAPE['decision_packets'][0])
PACKET['decision_scope'] = {'target_refs':[str]}
SHAPE = {
    'schema_version':(2,), 'model_profile':('screen_element_behavior_v1',),
    'case_id':str,'title':str,'status':user_experience.SHAPE['status'],
    'input_binding':{'planning_context':BINDING,'user_experience':BINDING},
    'evidence_status':copy.deepcopy(user_experience.SHAPE['evidence_status']),
    'sources':[SOURCE],
    'decisions':[{'id':str,'statement':str,'origin':('inherited','derived','planner_decided','proposed'),
        'source_ids':[str],'parent_refs':[str],'rationale':str,'status':('proposed','accepted','superseded')}],
    'inventory_links':[{'input_ref':str,'disposition':('mapped','external_handoff','not_applicable'),
        'screen_ids':[str],'element_ids':[str],'reason':str,'source_ids':[str]}],
    'screens':[{'id':str,'name':str,'actor_ids':[str],'touchpoint_refs':[str],
        'view_requirement_refs':[str],'purpose':str,'entry_refs':[str],'exit_refs':[str],'source_ids':[str]}],
    'elements':[{'id':str,'screen_id':str,'parent_id':NULL_REF,'name':str,'semantic_type':str,
        'purpose':str,'information_refs':[str],'action_refs':[str],
        'repetition':OneOf(('none',), {'item_scope':str,'membership_rule_id':str,'aggregate_rule_ids':[str]}),
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
        'observable_result':str,'allowed_actions':[str],'preserved_values':[ASSIGNMENT],
        'feedback':str,'focus_result':str,'parent_transition_refs':[str],
        'source_ids':[str],'decision_ids':[str]}],
    'constraints':[{'id':str,'scope_ids':[str],'condition':str,'required_outcome':str,
        'forbidden_combinations':[[ASSIGNMENT]],'rationale':str,'source_ids':[str],'decision_ids':[str]}],
    'interaction_rules':[{'id':str,'kind':('aggregate','dependency','priority','preservation'),
        'input_scope_ids':[str],'output_scope_ids':[str],
        'condition_rows':[{'id':str,'when':[ASSIGNMENT],'effects':[ASSIGNMENT],
            'transition_ids':[str],'scenario_ids':[str]}], 'source_ids':[str],'decision_ids':[str]}],
    'coverage_checks':[{'scope_id':str,'dimension':COVERAGE_DIMENSIONS,
        'status':('open','applicable','not_applicable'),'rationale':str,'source_ids':[str],
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
    'issues':[{'id':str,'question':str,'target':('planning_context','user_experience','screen_behavior','wireframe','development'),
        'blocking':bool,'reason':str,'areas':[str], 'target_refs':[str],
        'action':copy.deepcopy(user_experience.SHAPE['issues'][0]['action'])}],
    'reviews':[REVIEW],'review':{key:REVIEW for key in CRITERIA},
    'confirmation':copy.deepcopy(user_experience.SHAPE['confirmation']),
    'history':copy.deepcopy(user_experience.SHAPE['history']),
}


def fingerprints(data):
    if isinstance(data, dict) and type(data.get("schema_version")) is int and data["schema_version"] == 1:
        return _legacy.fingerprints(data)
    content = digest({key:value for key,value in data.items()
        if key not in ('status','reviews','review','confirmation','history')})
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


def _inputs(input_path):
    path2 = Path(input_path).resolve()
    two = load_json(path2)
    if not user_experience.validate(two)['complete']:
        raise ValueError('user experience must be complete and currently confirmed')
    path1 = Path(user_experience.planning_context_path(two)).resolve()
    if path1.parent != path2.parent:
        raise ValueError('planning context must be adjacent to its bound user experience')
    one = load_json(path1)
    if not planning_context.validate(one)['complete']:
        raise ValueError('planning context and user experience must be complete and currently confirmed')
    h1, r1 = planning_context.fingerprints(one)
    binding = two['input_binding']
    if (binding['content_hash'] != h1 or binding['review_hash'] != r1
            or binding['confirmation_turn_id'] != one['confirmation']['turn_id']
            or binding['service_context_project_id'] != one['service_context']['project_id']
            or binding['service_context_revision'] != one['service_context']['observed_revision']):
        raise ValueError('input user experience is not mutually bound to current adjacent planning context')
    return one, two, path1, path2


def bind_inputs(data, input_path):
    one, two, path1, path2 = _inputs(input_path)
    for stage, source, path, module in (('planning_context',one,path1,planning_context),('user_experience',two,path2,user_experience)):
        content, review = module.fingerprints(source)
        data['input_binding'][stage] = {'path':str(path),'content_hash':content,
            'review_hash':review,'confirmation_turn_id':source['confirmation']['turn_id']}
    return two


def required_reviews(data):
    targets = {(criterion,row['id']) for row in data['screens'] + data['elements']
        for criterion in ('S1','S2','S3','S6')}
    targets.update(('S4',row['id']) for row in data['interaction_rules'])
    # All transitions are reviewed: natural-language event parsing cannot safely omit S5 targets.
    targets.update(('S5',row['id']) for row in data['transitions'])
    targets.update(('S7',row['id']) for row in data['sources'] + data['decisions'])
    targets.update(('S8',row['id']) for row in data['screens'] + data['design_handoffs'])
    return targets


def validate(data):
    if isinstance(data, dict) and type(data.get("schema_version")) is int and data["schema_version"] == 1:
        return _legacy.validate(data)
    errors, gaps, metrics = [], [], []
    check_shape(data, SHAPE, '$', errors)
    report = {'valid':False,'input_ready':False,'baseline_ready':False,
        'ready_for_confirmation':False,'complete':False,'errors':errors,
        'completion_errors':gaps,'content_hash':'','review_hash':'','next_actions':[],
        'verification_gaps':[], 'metrics':metrics, 'qualitative':{},
        'validator_version':VALIDATOR_VERSION,'rubric_version':RUBRIC_VERSION,'example_version':EXAMPLE_VERSION}
    if errors:
        return report
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

    names = ('sources','decisions','screens','elements','state_profiles','state_axes','transitions',
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
    try:
        binding = data['input_binding']
        one, two, path1, path2 = _inputs(binding['user_experience']['path'])
        for stage, source, path, module in (('planning_context',one,path1,planning_context),('user_experience',two,path2,user_experience)):
            ch, rh = module.fingerprints(source); b = binding[stage]
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
    require(any(s['provider']=='platty' and s['project_id']==evidence['project_id']
        and s['revision']==evidence['observed_revision'] for s in sources.values()),
        '$.evidence_status', 'matching Platty source required', gaps)
    report['baseline_ready'] = report['input_ready'] and len(gaps)==before

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
        require((source['provider'] in ('planning_context','user_experience')) == (source['kind']=='imported'), path, 'imported kind and provider must agree')
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
        upstream_ids.update(row['id'] for row in one['claims'])
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
            require(bool(decision['parent_refs']) and bool(decision['source_ids']), path, 'derived decision needs premises and sources',gaps)
            require(all(p in upstream_ids or decisions.get(p,{}).get('status')=='accepted'
                for p in decision['parent_refs']),path,'derived premises must be accepted',gaps)

    inventory = input_inventory(two) if two else set()
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
        if isinstance(row['repetition'],dict):
            repeat=row['repetition']; text(repeat['item_scope'],path+'.repetition.item_scope')
            refs([repeat['membership_rule_id']]+repeat['aggregate_rule_ids'],rules,path+'.repetition.rules')

    def repeat_root(scope):
        seen=set()
        while scope in elements and scope not in seen:
            seen.add(scope); row=elements[scope]
            if isinstance(row['repetition'],dict): return scope
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
            assignments(transition[key],path+'.'+key)
            require(all(a['scope_id'] in transition['target_scope_ids'] for a in transition[key]),path,'assignment outside target scopes')
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
            before=expand(transition['before']); after=expand(transition['after']); preserved=expand(transition['preserved_values'])
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
        if row['status']=='open':
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
        if issue['blocking'] or issue['target'] in ('planning_context','user_experience','screen_behavior'):
            gaps.append(path+': unresolved issue')
    if data['status']=='waiting':
        require(any(i['blocking'] and i['action']['kind'] in ('wait','handoff')
            and i['target'] in ('screen_behavior','wireframe','development') for i in data['issues']),
            '$.status','waiting requires a blocking external dependency with resume action')
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
            require(not row['issue_ids'],path,'suitable review retains unresolved issue',gaps)
        elif row['verdict'] in ('needs_work','insufficient_evidence'):
            require(bool(row['issue_ids']),path,'failed review needs actionable issue',gaps)
    for row in data['reviews']:
        observed.extend(row['criterion_id']+':'+target for target in row['target_refs'])
    qualitative_metric=metric('qualitative_targets',{c+':'+target for c,target in expected_reviews},observed)
    for criterion,row in data['review'].items():
        require(row['criterion_id']==criterion and row['target_refs']==['model'], 'review.'+criterion,'overall criterion must review model',gaps)
    report['qualitative']={'review_ids':[r['id'] for r in data['reviews']],
        'missing_targets':qualitative_metric['missing_ids'],'stale_review_ids':stale,'verdict_counts':dict(counts)}
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
        next_actions=[{'id':i['id'],'kind':i['action']['kind'],'prompt':i['action']['prompt']} for i in data['issues']],
        blocking_issue_ids=[i['id'] for i in data['issues'] if i['blocking'] or i['target'] in ('planning_context','user_experience','screen_behavior')],
        input_hashes={key:value['content_hash'] for key,value in data['input_binding'].items()})
    return report


def render(data, report=None):
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
            repetition = '없음' if repeat == 'none' else repeat['item_scope'] + ' · 집합 규칙 ' + repeat['membership_rule_id']
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
        for case in cases[:4]:
            lines.append(f"- 대표 상태: {case['title']} — {'; '.join(case['visible_information'][:2])}")
        for kind in sorted(kinds):
            example = next(row for row in related if row['kind'] == kind)
            step = example['steps'][-1] if example['steps'] else None
            transition = next((row for row in transitions if step and row['id'] == step['transition_id']), None)
            result = transition['observable_result'] if transition else example['expected_case_id']
            lines.append(f"- {kind}: {example['id']} — {result}")
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
