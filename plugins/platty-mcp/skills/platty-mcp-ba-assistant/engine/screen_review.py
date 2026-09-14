"""Assign each full-model review target once; merge only current, explicit judgments."""
import copy
from collections import Counter


def build_plan(data):
    import screen_behavior as core
    screens = {r['id'] for r in data['screens']}
    owners = {sid: sid for sid in screens}
    owners.update({r['id']: r['screen_id'] for r in data['elements']})
    owners.update({r['id']: r['screen_id'] for r in data['design_handoffs']})
    for field, keys in [('transitions', ('target_scope_ids',)),
                        ('interaction_rules', ('input_scope_ids', 'output_scope_ids'))]:
        for row in data[field]:
            scopes = {owners.get(s, 'integration') for key in keys for s in row[key]}
            owners[row['id']] = next(iter(scopes)) if len(scopes) == 1 else 'integration'
    pairs = core.required_reviews(data) | {(c, 'model') for c in core.CRITERIA}
    tasks = {}
    for criterion, target in sorted(pairs):
        owner = owners.get(target, 'integration')
        tasks.setdefault(owner, []).append({'criterion_id': criterion, 'target_id': target})
    return {'plan_version': 1, 'content_hash': core.fingerprints(data)[0],
            'rubric_version': core.RUBRIC_VERSION, 'example_version': core.EXAMPLE_VERSION,
            'tasks': [{'id': owner, 'targets': targets} for owner, targets in sorted(tasks.items())],
            'target_count': len(pairs)}


def merge_reviews(data, plan, packets):
    import screen_behavior as core
    if plan != build_plan(data):
        raise ValueError('review plan is stale or modified; regenerate ownership before reviewing')
    if not isinstance(packets, list):
        raise ValueError('review packets must be an array')
    tasks = {t['id']: {(r['criterion_id'], r['target_id']) for r in t['targets']} for t in plan['tasks']}
    task_counts = Counter(p.get('task_id') for p in packets if isinstance(p, dict))
    if task_counts != Counter(tasks.keys()):
        raise ValueError('each review task must be submitted exactly once')
    collected = {}
    for packet in packets:
        if set(packet) != {'task_id', 'content_hash', 'reviews'} or packet['content_hash'] != plan['content_hash']:
            raise ValueError('invalid or stale review packet')
        seen = set()
        if not isinstance(packet['reviews'], list):
            raise ValueError('packet reviews must be an array')
        for row in packet['reviews']:
            errors = []
            core.check_shape(row, core.REVIEW, '$.review', errors)
            if errors:
                raise ValueError('; '.join(errors))
            if row['content_hash'] != plan['content_hash']:
                raise ValueError('review has stale content hash; hashes are never restamped by merge')
            if not row['target_refs']:
                raise ValueError('review must name its target')
            for target in row['target_refs']:
                pair = (row['criterion_id'], target)
                if pair not in tasks[packet['task_id']] or pair in seen:
                    raise ValueError('duplicate or out-of-scope review target: ' + str(pair))
                seen.add(pair)
                # Keep the original review intact; no synthetic verdict or rationale.
                collected[pair] = row
        if seen != tasks[packet['task_id']]:
            raise ValueError('review task is incomplete')
    draft = copy.deepcopy(data)
    draft['reviews'] = []
    emitted = set()
    for pair in sorted(collected):
        row = collected[pair]
        if pair[1] == 'model':
            if row['target_refs'] != ['model']:
                raise ValueError('global review must be separate from target reviews')
            draft['review'][pair[0]] = copy.deepcopy(row)
        elif id(row) not in emitted:
            emitted.add(id(row)); draft['reviews'].append(copy.deepcopy(row))
    draft['status'] = 'in_progress'
    draft['confirmation'] = {'confirmed': False, 'turn_id': '', 'statement': '', 'content_hash': '', 'review_hash': ''}
    report = core.validate(draft)
    if not report['valid']:
        raise ValueError('merged review failed structural validation: ' + '; '.join(report['errors']))
    return draft
