#!/usr/bin/env python3
"""Figma export of a completed design-system wireframe.

The engine cannot call Figma: the tools that write Figma belong to the agent. So the engine does
the two deterministic halves and the agent does the middle:

1. `build_bundle` turns the completed record, each capture's layout snapshot, and the component
   and token mappings into one bundle: what to draw, where, and with which library component.
2. The wireframe skill draws the bundle into a new Figma file with the Figma tools.
3. `record_receipt` checks what the agent says it drew against the current bundle and appends it
   to the receipts file (`CaseLayout.figma_receipts`), the only file this export writes beside the stage artifacts.

The stage artifact is never changed, so its schema and readers stay as they are.
"""

import json
import os
from pathlib import Path
import tempfile

import design_system_wireframe
from case_layout import CaseLayout
from case_index import write_index
import case_docs
from paths import WORKSPACE_ROOT

# The same pack root the wireframe engine reads; the mapping travels in the pack the case was
# built with, so an export can never pair a record with another pack's components.
PACK_ROOT = WORKSPACE_ROOT / 'design-knowledge'
RECEIPT_NAME = 'figma receipts'


def record_path(case_root):
    return CaseLayout.of(case_root).artifact('design_system_wireframe')


def bundle_path(case_root):
    return CaseLayout.of(case_root).figma_bundle()


def receipt_path(case_root):
    return CaseLayout.of(case_root).figma_receipts()
MAP_STATUSES = ('mapped', 'primitive', 'unmapped')
EXPORT_STATUSES = ('exported', 'gap')
FIGMA_URL_PREFIX = 'https://www.figma.com/'


def load_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temp = tempfile.mkstemp(dir=path.parent, prefix='.' + path.name, suffix='.tmp')
    with os.fdopen(handle, 'w', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    os.replace(temp, path)


def entry_problem(name, entry):
    """Why this map entry cannot be used as written, or '' when it can."""
    status = entry.get('status') if isinstance(entry, dict) else None
    if status not in MAP_STATUSES:
        return f'{name}: status must be one of {", ".join(MAP_STATUSES)}'
    for field in ('variant_props', 'state_props'):
        if not isinstance(entry.get(field) or {}, dict):
            return f'{name}: {field} must be an object'
    if status == 'mapped':
        if not (entry.get('component_key') or entry.get('component_set_key')):
            return f'{name}: mapped needs component_key or component_set_key'
        for prop, rule in (entry.get('variant_props') or {}).items():
            if not isinstance(rule, dict) or not rule.get('property') or not isinstance(rule.get('values'), dict):
                return f'{name}: variant_props.{prop} needs property and values'
        for state, rule in (entry.get('state_props') or {}).items():
            if not isinstance(rule, dict) or not rule.get('property') or not rule.get('value'):
                return f'{name}: state_props.{state} needs property and value'
    return ''


def validate_component_map(mapping):
    """Problems in a Figma map. They are reported, never fatal: a bad entry is drawn unresolved."""
    components = mapping.get('components')
    if not isinstance(components, dict):
        return ['components must be an object keyed by component name']
    problems = [problem for name, entry in components.items() if (problem := entry_problem(name, entry))]
    if any(isinstance(entry, dict) and entry.get('status') == 'mapped' for entry in components.values()) and \
            not str((mapping.get('library') or {}).get('file_key', '')).strip():
        problems.append('library.file_key: mapped components do not say which library they come from')
    tokens = mapping.get('tokens') or {}
    if not isinstance(tokens, dict):
        return problems + ['tokens must be an object keyed by token name; every value is painted']
    for token, entry in tokens.items():
        if not isinstance(entry, dict) or not str(entry.get('variable_key', '')).strip():
            problems.append(f'tokens.{token}: variable_key is empty; the value is painted instead')
    return problems


def usable_mapping(mapping):
    """The parts of a map that have the right shape; the rest is reported, not trusted."""
    def section(key):
        value = mapping.get(key) if isinstance(mapping, dict) else None
        return value if isinstance(value, dict) else {}
    tokens = {name: entry for name, entry in section('tokens').items() if isinstance(entry, dict)}
    return {'library': section('library'), 'components': section('components'), 'tokens': tokens}


def pack_mapping(record):
    """The Figma map in the pack this record was built with, and why it may be missing."""
    binding = record['knowledge_binding']
    path = PACK_ROOT / binding['pack_id'] / binding['version'] / 'pack.json'
    source = {'pack_id': binding['pack_id'], 'version': binding['version'], 'has_figma_map': False}
    empty = {'library': {}, 'components': {}, 'tokens': {}}
    try:
        pack = load_json(path)
    except (OSError, ValueError) as exc:
        # The error class, not its text: the text carries this machine's path, and the bundle
        # hash must not depend on where the workspace lives.
        return empty, source, [f'pack.json for {binding["pack_id"]}/{binding["version"]} is unreadable '
                               f'({type(exc).__name__}); every component is drawn unresolved']
    figma = pack.get('figma')
    if not isinstance(figma, dict):
        return empty, source, [f'pack {binding["pack_id"]}/{binding["version"]} has no Figma map; '
                               'every component is drawn unresolved']
    return ({key: figma.get(key) or {} for key in ('library', 'components', 'tokens')},
            {**source, 'has_figma_map': True}, [])


def resolve_component(component_row, node, mapping):
    """Which Figma thing draws this element; never guessed from a name."""
    if not component_row:
        return {'kind': 'unresolved', 'reason': 'no component mapping for this element'}
    name = component_row['hds_component']
    entry = (mapping.get('components') or {}).get(name)
    if entry is None:
        return {'kind': 'unresolved', 'reason': f'{name} has no Figma mapping'}
    problem = entry_problem(name, entry)
    if problem:
        return {'kind': 'unresolved', 'reason': problem}
    if entry['status'] == 'unmapped':
        return {'kind': 'unresolved', 'reason': entry.get('reason') or f'{name} is not mapped yet'}
    if entry['status'] == 'primitive':
        return {'kind': 'primitive', 'reason': entry.get('reason', '')}
    variant, unmapped = {}, []
    for prop, value in sorted((component_row.get('props') or {}).items()):
        rule = (entry.get('variant_props') or {}).get(prop)
        if rule is None:
            continue
        figma_value = rule['values'].get(str(value))
        if figma_value is None:
            unmapped.append(f'{prop}={value}')
        else:
            variant[rule['property']] = figma_value
    for state, rule in sorted((entry.get('state_props') or {}).items()):
        if (node.get('state') or {}).get(state):
            variant[rule['property']] = rule['value']
    return {'kind': 'instance',
            'component_key': entry.get('component_key', ''),
            'component_set_key': entry.get('component_set_key', ''),
            'variant': variant, 'unmapped_props': unmapped,
            'text_property': entry.get('text_property', '')}


def record_complete(case_root, record):
    return design_system_wireframe.validate(record, record_path(case_root)).get('complete', False)


def target_details(case_root, target):
    if target.get('detail_mode') == 'artifact':
        return load_json(Path(case_root) / target['detail_artifact']['path'])
    return {'component_mappings': target.get('component_mappings', []),
            'token_mappings': target.get('token_mappings', [])}


def packet_target(case_root, target):
    packet = load_json(Path(case_root) / target['packet_path'])
    exact = [row for row in packet['targets'] if row['target_id'] == target['id']]
    screen = [row for row in packet['targets'] if row['screen_id'] == target['screen_id']]
    if exact or screen:
        return (exact or screen)[0]
    raise ValueError(f"packet has no target for {target['id']}")


def build_frame(case_root, run_dir, capture, meta, components, mapping):
    frame = {'render_case_id': capture['renderCaseId'], 'viewport': capture['viewport'],
             'capture': {'path': os.path.relpath(run_dir / capture['path'], case_root),
                         'image_hash': capture['imageHash']},
             'layout': None, 'width': 0, 'height': 0, 'elements': []}
    layout_path = capture.get('layoutPath')
    if not layout_path or not (run_dir / layout_path).exists():
        frame['layout_missing'] = True
        return frame
    if capture.get('layoutHash') and \
            design_system_wireframe.file_hash(run_dir / layout_path) != capture['layoutHash']:
        raise ValueError(f'layout {layout_path} changed since runtime recorded it — rerun runtime')
    layout = load_json(run_dir / layout_path)
    frame['layout'] = {'path': os.path.relpath(run_dir / layout_path, case_root),
                       'hash': design_system_wireframe.file_hash(run_dir / layout_path)}
    frame['width'] = layout['viewport']['width']
    frame['height'] = max(layout['viewport']['height'], layout['viewport']['scrollHeight'])
    for node in layout['nodes']:
        info = meta.get(node['nodeId'], {})
        component = components.get(node['nodeId'])
        frame['elements'].append({
            'node_id': node['nodeId'], 'occurrence': node['occurrence'],
            'parent_node_id': node['parentNodeId'], 'parent_occurrence': node.get('parentOccurrence'),
            'box': node['box'], 'visible': node['visible'],
            'text': node['text'], 'text_runs': node.get('textRuns', []),
            'label': node.get('label', ''), 'state': node['state'],
            'style': node.get('style', {}),
            'name': info.get('name', ''), 'semantic_type': info.get('semantic_type', ''),
            'decision_ids': info.get('decision_ids', []), 'source_ids': info.get('source_ids', []),
            'hds_component': (component or {}).get('hds_component', ''),
            'props': (component or {}).get('props', {}),
            'figma': resolve_component(component, node, mapping),
        })
    # Renderer details no node id names (a page title, a label inside a region). They carry no
    # decision and no component, but leaving them out exports a screen emptier than its capture.
    for row in layout.get('decorations', []):
        frame['elements'].append({
            'node_id': f"{row['parentNodeId'] or 'page'}::{row.get('className') or row['tag']}",
            'occurrence': row['index'], 'decoration': True,
            'parent_node_id': row['parentNodeId'], 'parent_occurrence': row.get('parentOccurrence'),
            'box': row['box'], 'visible': row['visible'],
            'text': row['text'], 'text_runs': row.get('textRuns', []), 'label': '', 'state': {},
            'style': row.get('style', {}),
            'name': '', 'semantic_type': '', 'decision_ids': [], 'source_ids': [],
            'hds_component': '', 'props': {},
            'figma': {'kind': 'primitive', 'reason': 'renderer detail without a node id'},
        })
    return frame


def load_screen_source(case_root, record):
    """The confirmed screen-behavior artifact: where each render case's meaning is written."""
    path = ((record.get('input_binding') or {}).get('screen_behavior') or {}).get('path', '')
    try:
        return load_json(Path(case_root) / path), []
    except (OSError, ValueError, TypeError) as exc:
        return None, [f'screen-behavior source is unreadable ({type(exc).__name__}); '
                      'frames are not labelled or grouped by condition']


def case_semantics(source, screen_id):
    """Each render case of a screen: its title, the state values that define it, how it is reached."""
    names = {row['id']: row.get('name', row['id']) for row in source.get('elements', [])}
    names.update({row['id']: row.get('name', row['id']) for row in source.get('screens', [])})
    axes = {row['id']: row for row in source.get('state_axes', [])}
    cases = {}
    for case in source.get('render_cases', []):
        if case.get('screen_id') != screen_id:
            continue
        conditions, seen = [], set()
        for assignment in case.get('state_assignments', []):
            if assignment['axis_id'] in seen:
                continue
            seen.add(assignment['axis_id'])
            axis = axes.get(assignment['axis_id'], {})
            value = next((row for row in axis.get('values', []) if row['id'] == assignment['value_id']), {})
            conditions.append({'element': names.get(assignment['scope_id'], assignment['scope_id']),
                               'axis_id': assignment['axis_id'], 'dimension': axis.get('dimension', ''),
                               'value_id': assignment['value_id'], 'value_label': value.get('label', assignment['value_id']),
                               'meaning': value.get('meaning', '')})
        reached_by = [{'scenario_id': row['id'], 'kind': row.get('kind', ''), 'from_case_id': row.get('initial_case_id', ''),
                       'transition_ids': [step['transition_id'] for step in row.get('steps', [])],
                       'observations': [text for step in row.get('steps', [])
                                        for text in step.get('expected_observations', [])]}
                      for row in source.get('scenarios', []) if row.get('expected_case_id') == case['id']]
        cases[case['id']] = {'title': case.get('title', case['id']), 'conditions': conditions, 'reached_by': reached_by}
    return cases


def group_frames(screen_id, frames, cases, axes):
    """Group a screen's variants by the state axis that varies most across them.

    Scattered variants hide why each exists. The axis with the most distinct values is the one a
    reader sorts by; each group is one of its values, in the order the axis declares them.
    """
    ids = [frame['render_case_id'] for frame in frames]
    order, values = [], {}
    for case_id in ids:
        for condition in (cases.get(case_id) or {}).get('conditions', []):
            if condition['axis_id'] not in values:
                order.append(condition['axis_id'])
                values[condition['axis_id']] = []
            if condition['value_id'] not in values[condition['axis_id']]:
                values[condition['axis_id']].append(condition['value_id'])
    varying = [axis for axis in order if len(values[axis]) > 1]
    if not varying:
        return [{'id': f'{screen_id}:G1', 'axis_id': '', 'label': '모든 상태', 'render_case_ids': ids}]
    primary = max(varying, key=lambda axis: (len(values[axis]), -order.index(axis)))
    declared = [row['id'] for row in axes.get(primary, {}).get('values', [])]
    ranked = [value for value in declared if value in values[primary]] + \
             [value for value in values[primary] if value not in declared]
    groups = []
    for value in ranked:
        members = [case_id for case_id in ids if any(
            condition['axis_id'] == primary and condition['value_id'] == value
            for condition in (cases.get(case_id) or {}).get('conditions', []))]
        condition = next(condition for case_id in members for condition in cases[case_id]['conditions']
                         if condition['axis_id'] == primary)
        groups.append({'id': f'{screen_id}:G{len(groups) + 1}', 'axis_id': primary,
                       'label': f"{condition['element']} · {condition['value_label']}", 'render_case_ids': members})
    rest = [case_id for case_id in ids if not any(case_id in group['render_case_ids'] for group in groups)]
    if rest:
        groups.append({'id': f'{screen_id}:G{len(groups) + 1}', 'axis_id': '', 'label': '분류 없음', 'render_case_ids': rest})
    return groups


def build_bundle(case_root, mapping=None):
    """The whole export as data. Deterministic: the same inputs give the same bundle hash.

    Nothing about the Figma map stops it. A missing pack, a pack without a map, or a malformed
    entry each draw the affected components unresolved and leave a warning in the bundle.
    """
    case_root = Path(case_root).resolve()
    record = load_json(record_path(case_root))
    if record.get('status') != 'complete' or not record['confirmation'].get('confirmed') \
            or not record_complete(case_root, record):
        raise ValueError('export needs a completed, current design-system wireframe')
    if mapping is None:
        mapping, mapping_source, warnings = pack_mapping(record)
    else:
        mapping_source, warnings = {'pack_id': '', 'version': '', 'has_figma_map': True}, []
    warnings = warnings + validate_component_map(mapping if isinstance(mapping, dict) else {})
    mapping = usable_mapping(mapping)
    source, source_warnings = load_screen_source(case_root, record)
    warnings = warnings + source_warnings
    screens, tokens = [], {}
    for target in record['targets']:
        run_dir = CaseLayout.of(case_root).runs_root() / target['run_id']
        runtime = load_json(run_dir / 'runtime.json')
        details = target_details(case_root, target)
        packet = packet_target(case_root, target)
        meta = {row['element_id']: row for row in packet['nodes']}
        components = {row['element_id']: row for row in details['component_mappings']}
        for row in details['token_mappings']:
            entry = tokens.setdefault(row['semantic_token'], {
                'token': row['semantic_token'], 'value': row['value'],
                'variable_key': (mapping.get('tokens') or {}).get(row['semantic_token'], {}).get('variable_key', ''),
                'applied_to': []})
            entry['applied_to'] = sorted(set(entry['applied_to']) | set(row['applied_to']))
        frames = [build_frame(case_root, run_dir, capture, meta, components, mapping)
                  for capture in runtime.get('captures', [])]
        cases = case_semantics(source, target['screen_id']) if source else {}
        for frame in frames:
            described = cases.get(frame['render_case_id'], {})
            frame['title'] = described.get('title', frame['render_case_id'])
            frame['conditions'] = described.get('conditions', [])
            frame['reached_by'] = described.get('reached_by', [])
        axes = {row['id']: row for row in (source or {}).get('state_axes', [])}
        groups = group_frames(target['screen_id'], frames, cases, axes)
        for frame in frames:
            frame['group_id'] = next(group['id'] for group in groups
                                     if frame['render_case_id'] in group['render_case_ids'])
        screens.append({
            'target_id': target['id'], 'screen_id': target['screen_id'],
            'name': packet.get('task', target['screen_id']), 'purpose': packet.get('purpose', ''),
            'origin': packet.get('origin') or next(
                (row.get('origin', '') for row in (source or {}).get('screens', []) if row['id'] == target['screen_id']), ''),
            'groups': groups,
            'frames': frames,
        })
    elements = [element for screen in screens for frame in screen['frames'] for element in frame['elements']]
    kinds = [element['figma']['kind'] for element in elements if not element.get('decoration')]
    bundle = {
        'schema_version': 1,
        'case_id': record['case_id'], 'title': record['title'],
        'record_content_hash': record['confirmation']['content_hash'],
        'record_review_hash': record['confirmation']['review_hash'],
        'knowledge_binding': {key: record['knowledge_binding'][key] for key in ('pack_id', 'version', 'content_hash')},
        'library': mapping.get('library', {}),
        'mapping_source': mapping_source,
        'warnings': warnings,
        'screens': screens,
        'tokens': [tokens[name] for name in sorted(tokens)],
        'stats': {
            'frames': sum(len(screen['frames']) for screen in screens),
            'instances': kinds.count('instance'),
            'primitives': kinds.count('primitive'),
            'unresolved': kinds.count('unresolved'),
            'decorations': sum(1 for element in elements if element.get('decoration')),
            'unbound_tokens': sum(1 for row in tokens.values() if not row['variable_key']),
            'layout_missing': sum(1 for screen in screens for frame in screen['frames'] if frame.get('layout_missing')),
        },
    }
    bundle['bundle_hash'] = design_system_wireframe.digest(bundle)
    atomic_json(bundle_path(case_root), bundle)
    return bundle


def bundle_frames(bundle):
    return {(screen['target_id'], frame['render_case_id'], frame['viewport'])
            for screen in bundle['screens'] for frame in screen['frames']}


def receipts_problem(value):
    """Why a receipts file cannot be read as a history of exports, or '' when it can."""
    if not isinstance(value, dict) or not isinstance(value.get('exports'), list):
        return 'expected an object with an exports list'
    for number, row in enumerate(value['exports']):
        if not isinstance(row, dict) or not isinstance(row.get('export_id'), str) \
                or row.get('status') not in EXPORT_STATUSES \
                or not isinstance(row.get('record_content_hash'), str):
            return f'exports[{number}] is not a recorded receipt'
    return ''


def load_receipts(case_root):
    path = receipt_path(case_root)
    if not path.exists():
        return {'schema_version': 1, 'exports': []}
    value = load_json(path)
    problem = receipts_problem(value)
    if problem:
        raise ValueError(problem)
    return value


def current_bundle(case_root, record_hash):
    """The bundle on disk, only if it is intact and was built from the current record."""
    bundle = load_json(bundle_path(case_root))
    if design_system_wireframe.digest({k: v for k, v in bundle.items() if k != 'bundle_hash'}) != bundle['bundle_hash']:
        raise ValueError('the Figma export bundle was edited after it was built — rebuild it')
    if bundle['record_content_hash'] != record_hash:
        raise ValueError('the Figma export bundle was built from an older wireframe — rebuild it')
    return bundle


def validate_exported(entry, bundle):
    errors = []
    if entry.get('bundle_hash') != bundle['bundle_hash']:
        errors.append('bundle_hash does not match the current bundle — rebuild and export again')
    file_key = str(entry.get('file_key', '')).strip()
    url = str(entry.get('canonical_url', ''))
    if not file_key:
        errors.append('file_key is required')
    if not url.startswith(FIGMA_URL_PREFIX):
        errors.append('canonical_url must be a figma.com link')
    elif file_key and f'/{file_key}' not in url:
        errors.append('file_key does not match canonical_url')
    rows = entry.get('frames') if isinstance(entry.get('frames'), list) else []
    drawn = {(row.get('target_id'), row.get('render_case_id'), row.get('viewport'))
             for row in rows if isinstance(row, dict) and str(row.get('node_id', '')).strip()}
    expected = bundle_frames(bundle)
    missing, extra = sorted(expected - drawn), sorted(drawn - expected, key=str)
    if missing:
        errors.append('frames missing a Figma node: ' + ', '.join('/'.join(row) for row in missing))
    if extra:
        errors.append('frames not in the bundle: ' + ', '.join('/'.join(map(str, row)) for row in extra))
    stats = entry.get('stats') if isinstance(entry.get('stats'), dict) else {}
    for key in ('instances', 'primitives', 'unresolved', 'unbound_tokens'):
        value = stats.get(key)
        if type(value) is not int or value < 0:
            errors.append(f'stats.{key} must be an integer count of what was drawn')
    return errors


def readable_receipts(case_root):
    """Existing receipts; an unreadable file is set aside, never deleted, so a new receipt can land."""
    path = receipt_path(case_root)
    try:
        return load_receipts(case_root)
    except (OSError, ValueError, KeyError, TypeError):
        number = 1
        while path.with_name(f'{path.name}.unreadable-{number}').exists():
            number += 1
        path.rename(path.with_name(f'{path.name}.unreadable-{number}'))
        return {'schema_version': 1, 'exports': []}


def record_receipt(case_root, entry):
    """Append what the agent drew, after checking it against the current record and bundle.

    A gap needs no bundle: building the bundle may be exactly what failed, and the session must
    still be able to say so and end.
    """
    case_root = Path(case_root).resolve()
    if not isinstance(entry, dict):
        raise ValueError('receipt must be a JSON object')
    if entry.get('status') not in EXPORT_STATUSES:
        raise ValueError(f'status must be one of {", ".join(EXPORT_STATUSES)}')
    record = load_json(record_path(case_root))
    record_hash = record['confirmation'].get('content_hash', '')
    if not record['confirmation'].get('confirmed') or entry.get('record_content_hash') != record_hash:
        raise ValueError('record_content_hash does not match the completed wireframe')
    if entry['status'] == 'gap':
        errors = [] if str((entry.get('gap') or {}).get('reason', '')).strip() else \
            ['gap.reason: say what stopped the export']
    else:
        errors = validate_exported(entry, current_bundle(case_root, record_hash))
    if errors:
        raise ValueError('; '.join(errors))
    receipts = readable_receipts(case_root)
    stored = {**entry, 'export_id': f"x{len(receipts['exports']) + 1:03}"}
    receipts['exports'].append(stored)
    atomic_json(receipt_path(case_root), receipts)
    write_index(case_root)
    # The wireframe document shows the latest Figma file and frames; it was written before this.
    case_docs.refresh(case_root)
    return stored


def export_status(case_root, record):
    """Whether the completed wireframe still owes a Figma export."""
    if record.get('status') != 'complete' or not record['confirmation'].get('confirmed'):
        return {'state': 'not_required'}
    current = record['confirmation']['content_hash']
    try:
        exports = load_receipts(case_root)['exports']
    except (OSError, ValueError, KeyError, TypeError) as exc:
        return {'state': 'pending', 'error': f'{RECEIPT_NAME} file is unreadable ({exc}); record a new receipt'}
    matching = [row for row in exports if row.get('record_content_hash') == current]
    if matching:
        latest = matching[-1]
        return {'state': latest['status'], 'export_id': latest['export_id'],
                'canonical_url': latest.get('canonical_url', ''), 'gap': latest.get('gap')}
    return {'state': 'stale' if exports else 'pending'}
