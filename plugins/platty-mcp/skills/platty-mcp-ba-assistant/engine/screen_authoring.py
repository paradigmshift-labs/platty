"""Lossless, editable authoring form for canonical and legacy screen models.

Only render-case states and repeated coverage evidence lists use envelopes.
All other fields, including assessment hashes and confirmation, remain verbatim.
Assignment keys are JSON arrays [scope_id, axis_id, item_ref]; omitting item_ref
uses a two-entry key, which is deliberately distinct from an explicit null.
"""
import copy
import json
from pathlib import Path
from collections import Counter

FORMAT = 'screen-authoring-v1'
EVIDENCE_FIELDS = ('transition_ids', 'scenario_ids', 'source_ids')


class AuthoringError(ValueError):
    """The authoring document cannot be expanded without ambiguity."""


def load_strict(path):
    """Load an authoring input without accepting duplicate JSON object keys."""
    def unique(pairs):
        result = {}
        for key, value in pairs:
            _require(key not in result, 'duplicate JSON key: ' + key)
            result[key] = value
        return result
    return json.loads(Path(path).read_text(encoding='utf-8'), object_pairs_hook=unique)


def _require(condition, message):
    if not condition:
        raise AuthoringError(message)


def _object(value, fields, label):
    _require(isinstance(value, dict) and set(value) == set(fields),
             label + ': expected fields ' + ', '.join(fields))


def _key(row):
    _require(isinstance(row, dict), 'state assignment must be an object')
    _require(all(isinstance(row.get(k), str) for k in ('scope_id', 'axis_id')),
             'state assignment requires scope_id and axis_id strings')
    _require('value_id' in row, 'state assignment requires value_id')
    _require('item_ref' not in row or row['item_ref'] is None or isinstance(row['item_ref'], str),
             'item_ref must be a string or null')
    parts = [row['scope_id'], row['axis_id']]
    if 'item_ref' in row:
        parts.append(row['item_ref'])
    return json.dumps(parts, ensure_ascii=False, separators=(',', ':'))


def _assignments(rows):
    _require(isinstance(rows, list), 'state assignments must be a list')
    indexed = {}
    for row in rows:
        key = _key(row)
        _require(key not in indexed, 'duplicate or contradictory assignment: ' + key)
        indexed[key] = row
    return indexed


def _keys(values, label):
    _require(isinstance(values, list) and all(isinstance(v, str) for v in values),
             label + ' must be a list of assignment keys')
    _require(len(set(values)) == len(values), label + ' contains duplicate keys')
    return values


def _rows(model, field):
    rows = model.get(field, [])
    _require(isinstance(rows, list) and all(isinstance(row, dict) for row in rows),
             field + ' must be a list of objects')
    return rows


def compact(data):
    """Return an independent authoring document, without refreshing any evidence."""
    _require(isinstance(data, dict), 'screen model must be an object')
    model = copy.deepcopy(data)
    bases = {}
    for case in _rows(model, 'render_cases'):
        states = case.get('state_assignments')
        if states is None:
            continue
        current = _assignments(states)
        screen = case.get('screen_id')
        _require(isinstance(screen, str), 'render case requires a screen_id')
        if screen not in bases:
            bases[screen] = copy.deepcopy(states)
        base = _assignments(bases[screen])
        case['state_assignments'] = {'$state_delta': {
            'base': screen,
            'set': [row for key, row in current.items() if key not in base
                    or json.dumps(row, sort_keys=True) != json.dumps(base[key], sort_keys=True)],
            'delete': [key for key in base if key not in current],
            'order': list(current),
        }}
    coverage = _rows(model, 'coverage_checks')
    evidence_sets = {}
    for field in EVIDENCE_FIELDS:
        counts = Counter(tuple(row[field]) for row in coverage
                         if isinstance(row.get(field), list)
                         and all(isinstance(v, str) for v in row[field]))
        names = {}
        for row in coverage:
            values = row.get(field)
            if not isinstance(values, list) or not all(isinstance(v, str) for v in values):
                _require(not isinstance(values, dict), 'coverage evidence must be a list or null')
                continue
            signature = tuple(values)
            # Empty arrays are already clearer and smaller than a reference.
            if not values or counts[signature] < 2:
                continue
            if signature not in names:
                name = field + '_' + str(len(names) + 1)
                names[signature] = name
                evidence_sets[name] = values
            row[field] = {'$evidence': names[signature]}
    return {'authoring_format': FORMAT, 'model': model,
            'state_bases': bases, 'evidence_sets': evidence_sets}


def expand(document):
    """Expand scoped envelopes; reject ambiguity rather than overwriting it."""
    _object(document, ('authoring_format', 'model', 'state_bases', 'evidence_sets'), 'authoring document')
    _require(document['authoring_format'] == FORMAT, 'unsupported authoring format')
    _require(isinstance(document['model'], dict), 'model must be an object')
    _require(isinstance(document['state_bases'], dict), 'state_bases must be an object')
    _require(isinstance(document['evidence_sets'], dict), 'evidence_sets must be an object')
    model = copy.deepcopy(document['model'])
    bases = {}
    for name, rows in document['state_bases'].items():
        _require(isinstance(name, str), 'state base name must be a string')
        bases[name] = _assignments(rows)
    for name, values in document['evidence_sets'].items():
        _require(isinstance(name, str) and isinstance(values, list)
                 and all(isinstance(v, str) for v in values), 'evidence set must be a named list of strings')
    for case in _rows(model, 'render_cases'):
        states = case.get('state_assignments')
        if states is None:
            continue
        if isinstance(states, list):
            _assignments(states)
            continue
        _object(states, ('$state_delta',), 'state assignment envelope')
        delta = states['$state_delta']
        _object(delta, ('base', 'set', 'delete', 'order'), 'state delta')
        name = delta['base']
        _require(isinstance(name, str) and name in bases, 'unknown state base')
        _require(name == case.get('screen_id'), 'state base must belong to the render case screen')
        indexed = dict(bases[name])
        overrides = _assignments(delta['set'])
        deleted = _keys(delta['delete'], 'delete')
        order = _keys(delta['order'], 'order')
        for key in deleted:
            _require(key in indexed, 'deleted assignment is absent from base: ' + key)
            _require(key not in overrides, 'assignment cannot be both deleted and set: ' + key)
            del indexed[key]
        indexed.update(overrides)
        _require(set(order) == set(indexed), 'order must contain every resulting assignment exactly once')
        case['state_assignments'] = [copy.deepcopy(indexed[key]) for key in order]
    for row in _rows(model, 'coverage_checks'):
        for field in EVIDENCE_FIELDS:
            value = row.get(field)
            if not isinstance(value, dict):
                continue
            _object(value, ('$evidence',), 'coverage evidence envelope')
            name = value['$evidence']
            _require(isinstance(name, str) and name in document['evidence_sets'], 'unknown evidence set')
            row[field] = copy.deepcopy(document['evidence_sets'][name])
    return model
