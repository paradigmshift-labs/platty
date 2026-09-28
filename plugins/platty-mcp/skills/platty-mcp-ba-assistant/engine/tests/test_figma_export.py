"""Figma export: component map, bundle, receipt, and whether an export is still owed."""

import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE))

import figma_export  # noqa: E402

TEMPLATE = ENGINE.parent / 'schemas/design-system-wireframe.template.json'
RUN_ID = 'run-0001-abcdef'


def component_map(**button):
    entry = {'status': 'mapped', 'component_set_key': 'set-button',
             'variant_props': {'size': {'property': 'Size', 'values': {'m': 'Medium'}}},
             'state_props': {'disabled': {'property': 'State', 'value': 'Disabled'}},
             'text_property': 'Label'}
    entry.update(button)
    return {'schema_version': 1, 'library': {'file_key': 'LIB', 'name': 'HDS'},
            'components': {'Surface': {'status': 'primitive', 'reason': 'container'},
                           'Button': entry,
                           'Text': {'status': 'unmapped', 'reason': 'not checked'}},
            'tokens': {'color.semantic.primary': {'variable_key': 'var-primary'}}}


def layout(nodes, height=844, decorations=()):
    return {'schemaVersion': 1, 'viewport': {'width': 390, 'height': 844, 'scrollWidth': 390, 'scrollHeight': height},
            'nodes': nodes, 'decorations': list(decorations)}


def decoration(index, class_name, parent, text):
    return {'index': index, 'className': class_name, 'tag': 'p', 'parentNodeId': parent, 'parentOccurrence': 0 if parent else None,
            'box': {'x': 16, 'y': 8, 'width': 200, 'height': 24}, 'visible': True, 'text': text,
            'textRuns': [{'text': text, 'box': {'x': 16, 'y': 8, 'width': 60, 'height': 24}}], 'style': {'fontSize': 24}}


def node(node_id, parent=None, occurrence=0, disabled=False, text=''):
    return {'nodeId': node_id, 'occurrence': occurrence, 'parentNodeId': parent, 'tag': 'div', 'role': '',
            'box': {'x': 0, 'y': 0, 'width': 390, 'height': 40}, 'visible': True, 'text': text,
            'state': {'disabled': disabled, 'checked': False, 'selected': False, 'expanded': False,
                      'busy': False, 'value': ''},
            'style': {'color': 'rgb(74, 74, 74)', 'fontSize': 14, 'borderRadius': 8}}


class Case(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        run = self.root / 'evidence/design-runs' / RUN_ID
        (run / 'layout').mkdir(parents=True)
        (run / 'captures').mkdir()
        (run / 'captures/default-mobile.png').write_bytes(b'png')
        (run / 'captures/empty-mobile.png').write_bytes(b'png')
        self.write(run / 'layout/default-mobile.json', layout([
            node('list'), node('submit', 'list', text='보내기'),
            node('submit', 'list', occurrence=1, disabled=True, text='보내기'), node('title', 'list', text='제목')],
            decorations=[decoration(0, 'title', None, '적립금 내역'), decoration(1, 'bal-label', 'list', '모인 적립금')]))
        layout_hash = hashlib.sha256((run / 'layout/default-mobile.json').read_bytes()).hexdigest()
        self.write(run / 'runtime.json', {'captures': [
            {'renderCaseId': 'default', 'viewport': 'mobile', 'path': 'captures/default-mobile.png',
             'imageHash': 'h1', 'layoutPath': 'layout/default-mobile.json', 'layoutHash': layout_hash},
            {'renderCaseId': 'empty', 'viewport': 'mobile', 'path': 'captures/empty-mobile.png',
             'imageHash': 'h2'}]})
        self.write(self.root / 'evidence/canonical-details' / f'{RUN_ID}.json', {
            'component_mappings': [
                {'element_id': 'list', 'hds_component': 'Surface', 'props': {}},
                {'element_id': 'submit', 'hds_component': 'Button', 'props': {'size': 'm', 'variant': 'primary'}},
                {'element_id': 'title', 'hds_component': 'Text', 'props': {}}],
            'token_mappings': [
                {'semantic_token': 'color.semantic.primary', 'value': '#7256e9', 'applied_to': ['submit']},
                {'semantic_token': 'spacing.400', 'value': '16px', 'applied_to': ['list']}]})
        self.write(self.root / 'packet.json', {'targets': [{
            'target_id': 'screen-1', 'screen_id': 'screen-1', 'task': 'Wireframe 보상 내역', 'purpose': '받은 보상 확인',
            'nodes': [{'element_id': 'submit', 'name': '보내기', 'semantic_type': 'action',
                       'decision_ids': ['D-02'], 'source_ids': ['S-1']}]}]})
        record = json.loads(TEMPLATE.read_text(encoding='utf-8'))
        record.update(case_id='case', title='보상 내역', status='complete')
        record['knowledge_binding'].update(pack_id='heroines', version='v1', content_hash='k' * 64)
        record['confirmation'].update(confirmed=True, turn_id='t0001', statement='derived',
                                      content_hash='c' * 64, review_hash='r' * 64)
        record['targets'] = [{'id': 'screen-1', 'screen_id': 'screen-1', 'run_id': RUN_ID,
                              'packet_path': 'packet.json', 'detail_mode': 'artifact',
                              'detail_artifact': {'path': f'evidence/canonical-details/{RUN_ID}.json'}}]
        record['input_binding']['screen_behavior']['path'] = 'screen-behavior.json'
        self.write(self.root / 'design-system-wireframe.json', record)
        self.write(self.root / 'screen-behavior.json', {
            'screens': [{'id': 'screen-1', 'name': '보상 내역', 'origin': 'current', 'purpose': '받은 보상 확인'}],
            'elements': [{'id': 'list', 'name': '보상 목록'}, {'id': 'submit', 'name': '보내기'}],
            'state_axes': [
                {'id': 'AX-LIST', 'scope_id': 'list', 'dimension': 'content', 'values': [
                    {'id': 'rows', 'label': '항목 있음', 'meaning': '받은 보상이 한 건 이상 보인다'},
                    {'id': 'empty', 'label': '빈 목록', 'meaning': '받은 보상이 없다'}]},
                {'id': 'AX-SEND', 'scope_id': 'submit', 'dimension': 'availability', 'values': [
                    {'id': 'on', 'label': '보낼 수 있음', 'meaning': ''}]}],
            'render_cases': [
                {'id': 'default', 'screen_id': 'screen-1', 'title': '보상이 보이는 경우', 'state_assignments': [
                    {'scope_id': 'list', 'item_ref': None, 'axis_id': 'AX-LIST', 'value_id': 'rows'},
                    {'scope_id': 'submit', 'item_ref': None, 'axis_id': 'AX-SEND', 'value_id': 'on'}]},
                {'id': 'empty', 'screen_id': 'screen-1', 'title': '보상이 하나도 없는 경우', 'state_assignments': [
                    {'scope_id': 'list', 'item_ref': None, 'axis_id': 'AX-LIST', 'value_id': 'empty'},
                    {'scope_id': 'submit', 'item_ref': None, 'axis_id': 'AX-SEND', 'value_id': 'on'}]}],
            'scenarios': [{'id': 'SC-CLEAR', 'kind': 'alternate', 'initial_case_id': 'default',
                           'steps': [{'transition_id': 'TR-CLEAR', 'expected_observations': ['목록이 비었다고 읽는다']}],
                           'expected_case_id': 'empty'}],
        })
        self.complete = mock.patch.object(figma_export, 'record_complete', return_value=True)
        self.complete.start()

    def tearDown(self):
        self.complete.stop()
        self.tmp.cleanup()

    def write(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')

    def record(self):
        return json.loads((self.root / 'design-system-wireframe.json').read_text(encoding='utf-8'))

    def bundle(self, mapping=None):
        return figma_export.build_bundle(self.root, mapping or component_map())

    def receipt(self, bundle, **overrides):
        entry = {'status': 'exported', 'bundle_hash': bundle['bundle_hash'],
                 'record_content_hash': bundle['record_content_hash'],
                 'file_key': 'NEWFILE', 'canonical_url': 'https://www.figma.com/design/NEWFILE/x',
                 'created_in': 'drafts', 'exported_at': '2026-09-27T00:00:00Z',
                 'frames': [{'target_id': 'screen-1', 'render_case_id': rc, 'viewport': 'mobile', 'node_id': f'1:{i}'}
                            for i, rc in enumerate(('default', 'empty'))],
                 'stats': {'instances': 2, 'primitives': 1, 'unresolved': 1, 'unbound_tokens': 1},
                 'observations': []}
        entry.update(overrides)
        return entry


class MappingProblemsTest(unittest.TestCase):
    def test_valid_mapping_has_no_problems(self):
        self.assertEqual(figma_export.validate_component_map(component_map()), [])

    def test_problems_are_reported_per_entry(self):
        mapping = component_map(component_set_key='')
        mapping['components']['Text'] = {'status': 'maybe'}
        mapping['library']['file_key'] = ''
        problems = '\n'.join(figma_export.validate_component_map(mapping))
        self.assertIn('Button: mapped needs component_key or component_set_key', problems)
        self.assertIn('Text: status must be one of', problems)
        self.assertIn('library.file_key', problems)


class BundleTest(Case):
    def test_bundle_places_each_node_with_its_figma_counterpart(self):
        bundle = self.bundle()
        frames = bundle['screens'][0]['frames']
        self.assertEqual([frame['render_case_id'] for frame in frames], ['default', 'empty'])
        elements = {(row['node_id'], row['occurrence']): row for row in frames[0]['elements']}
        first, second = elements[('submit', 0)], elements[('submit', 1)]
        self.assertEqual(first['figma']['kind'], 'instance')
        self.assertEqual(first['figma']['component_set_key'], 'set-button')
        self.assertEqual(first['figma']['variant'], {'Size': 'Medium'})
        self.assertEqual(second['figma']['variant'], {'Size': 'Medium', 'State': 'Disabled'})
        self.assertEqual(first['decision_ids'], ['D-02'])
        self.assertEqual(first['parent_node_id'], 'list')
        self.assertEqual(first['style'], {'color': 'rgb(74, 74, 74)', 'fontSize': 14, 'borderRadius': 8})
        self.assertEqual(elements[('list', 0)]['figma']['kind'], 'primitive')
        self.assertEqual(elements[('title', 0)]['figma']['kind'], 'unresolved')
        self.assertEqual(frames[0]['capture']['path'], f'evidence/design-runs/{RUN_ID}/captures/default-mobile.png')

    def test_bundle_counts_what_it_could_not_resolve(self):
        bundle = self.bundle()
        self.assertEqual(bundle['stats'], {'frames': 2, 'instances': 2, 'primitives': 1, 'unresolved': 1,
                                           'decorations': 2, 'unbound_tokens': 1, 'layout_missing': 1})
        tokens = {row['token']: row for row in bundle['tokens']}
        self.assertEqual(tokens['color.semantic.primary']['variable_key'], 'var-primary')
        self.assertEqual(tokens['spacing.400']['variable_key'], '')
        self.assertTrue(bundle['screens'][0]['frames'][1]['layout_missing'])

    def test_renderer_details_without_a_node_id_are_drawn_as_decorations(self):
        elements = self.bundle()['screens'][0]['frames'][0]['elements']
        decorations = [row for row in elements if row.get('decoration')]
        self.assertEqual([row['node_id'] for row in decorations], ['page::title', 'list::bal-label'])
        self.assertEqual(decorations[0]['figma']['kind'], 'primitive')
        self.assertEqual(decorations[0]['text_runs'][0]['text'], '적립금 내역')
        self.assertEqual(decorations[1]['parent_node_id'], 'list')
        self.assertTrue(all(not row.get('decoration') for row in elements[:4]))

    def test_unmapped_prop_value_is_reported_not_guessed(self):
        mapping = component_map()
        mapping['components']['Button']['variant_props']['size']['values'] = {'s': 'Small'}
        element = self.bundle(mapping)['screens'][0]['frames'][0]['elements'][1]
        self.assertEqual(element['figma']['variant'], {})
        self.assertEqual(element['figma']['unmapped_props'], ['size=m'])

    def test_bundle_is_deterministic_and_written(self):
        first, second = self.bundle(), self.bundle()
        self.assertEqual(first['bundle_hash'], second['bundle_hash'])
        stored = figma_export.load_json(figma_export.bundle_path(self.root))
        self.assertEqual(stored['bundle_hash'], first['bundle_hash'])

    def test_incomplete_record_is_refused(self):
        record = self.record()
        record['status'] = 'in_progress'
        self.write(self.root / 'design-system-wireframe.json', record)
        with self.assertRaisesRegex(ValueError, 'completed'):
            self.bundle()

    def test_layout_edited_after_capture_is_refused(self):
        path = self.root / 'evidence/design-runs' / RUN_ID / 'layout/default-mobile.json'
        self.write(path, layout([node('list')]))
        with self.assertRaisesRegex(ValueError, 'layout .* changed since runtime'):
            self.bundle()

    def test_exact_packet_target_wins_over_a_screen_match(self):
        packet = json.loads((self.root / 'packet.json').read_text(encoding='utf-8'))
        exact = copy.deepcopy(packet['targets'][0])
        other = {**copy.deepcopy(exact), 'target_id': 'other', 'task': 'Wireframe 다른 화면'}
        packet['targets'] = [other, exact]
        self.write(self.root / 'packet.json', packet)
        self.assertEqual(self.bundle()['screens'][0]['name'], 'Wireframe 보상 내역')

    def test_wrongly_typed_map_is_drawn_unresolved_not_crashed(self):
        mapping = component_map(variant_props=['size'], state_props=['disabled'])
        mapping['tokens'] = ['color.semantic.primary']
        bundle = self.bundle(mapping)
        submit = [row for row in bundle['screens'][0]['frames'][0]['elements'] if row['node_id'] == 'submit']
        self.assertTrue(all(row['figma']['kind'] == 'unresolved' for row in submit))
        self.assertTrue(any('tokens' in warning for warning in bundle['warnings']))
        for broken in ({'components': ['Button']}, {'components': {'Button': None}, 'tokens': {'x': None}}):
            with self.subTest(broken=broken):
                bundle = self.bundle({'library': {}, **broken})
                self.assertEqual(bundle['stats']['instances'], 0)
                self.assertTrue(bundle['warnings'])

    def test_malformed_entry_is_drawn_unresolved_not_refused(self):
        bundle = self.bundle(component_map(component_set_key=''))
        submit = [row for row in bundle['screens'][0]['frames'][0]['elements'] if row['node_id'] == 'submit']
        self.assertTrue(all(row['figma']['kind'] == 'unresolved' for row in submit))
        self.assertIn('component_set_key', submit[0]['figma']['reason'])
        self.assertTrue(any('Button' in warning for warning in bundle['warnings']))


class PackSourceTest(Case):
    """The mapping comes from the design knowledge pack the case was built with."""

    def setUp(self):
        super().setUp()
        self.packs = self.root / 'design-knowledge'
        self.pack_root = mock.patch.object(figma_export, 'PACK_ROOT', self.packs)
        self.pack_root.start()

    def tearDown(self):
        self.pack_root.stop()
        super().tearDown()

    def write_pack(self, figma=None):
        pack = {'version': 'heroines/v1'}
        if figma is not None:
            pack['figma'] = figma
        self.write(self.packs / 'heroines/v1/pack.json', pack)

    def submit(self, bundle):
        return next(row for row in bundle['screens'][0]['frames'][0]['elements'] if row['node_id'] == 'submit')

    def test_pack_mapping_is_used(self):
        mapping = component_map()
        self.write_pack({key: mapping[key] for key in ('library', 'components', 'tokens')})
        bundle = figma_export.build_bundle(self.root)
        self.assertEqual(self.submit(bundle)['figma']['component_set_key'], 'set-button')
        self.assertEqual(bundle['mapping_source'], {'pack_id': 'heroines', 'version': 'v1', 'has_figma_map': True})
        self.assertEqual(bundle['warnings'], [])

    def test_pack_without_a_map_draws_everything_unresolved(self):
        self.write_pack()
        bundle = figma_export.build_bundle(self.root)
        self.assertEqual(self.submit(bundle)['figma']['kind'], 'unresolved')
        self.assertEqual(bundle['stats']['instances'], 0)
        self.assertTrue(any('no Figma map' in warning for warning in bundle['warnings']))

    def test_missing_pack_still_builds(self):
        bundle = figma_export.build_bundle(self.root)
        self.assertEqual(self.submit(bundle)['figma']['kind'], 'unresolved')
        self.assertTrue(any('pack.json' in warning for warning in bundle['warnings']))
        self.assertFalse(any(str(self.root) in warning for warning in bundle['warnings']),
                         'a machine path in the bundle makes its hash depend on the workspace location')


class FrameGroupingTest(Case):
    """Variants are grouped and labelled by the condition that produces them, not scattered."""

    def test_each_frame_says_what_state_it_is_and_how_you_get_there(self):
        empty = self.bundle()['screens'][0]['frames'][1]
        self.assertEqual(empty['title'], '보상이 하나도 없는 경우')
        self.assertIn({'element': '보상 목록', 'axis_id': 'AX-LIST', 'dimension': 'content', 'value_id': 'empty',
                       'value_label': '빈 목록', 'meaning': '받은 보상이 없다'}, empty['conditions'])
        self.assertEqual(empty['reached_by'], [{'scenario_id': 'SC-CLEAR', 'kind': 'alternate', 'from_case_id': 'default',
                                                'transition_ids': ['TR-CLEAR'], 'observations': ['목록이 비었다고 읽는다']}])

    def test_frames_are_grouped_by_the_axis_that_varies(self):
        screen = self.bundle()['screens'][0]
        self.assertEqual(screen['origin'], 'current')
        self.assertEqual([(group['axis_id'], group['label'], group['render_case_ids']) for group in screen['groups']],
                         [('AX-LIST', '보상 목록 · 항목 있음', ['default']), ('AX-LIST', '보상 목록 · 빈 목록', ['empty'])])
        self.assertEqual([frame['group_id'] for frame in screen['frames']],
                         [group['id'] for group in screen['groups']])

    def test_missing_screen_behavior_still_builds_one_group(self):
        (self.root / 'screen-behavior.json').unlink()
        bundle = self.bundle()
        screen = bundle['screens'][0]
        self.assertEqual(len(screen['groups']), 1)
        self.assertEqual(sorted(screen['groups'][0]['render_case_ids']), ['default', 'empty'])
        self.assertEqual(screen['frames'][0]['conditions'], [])
        self.assertTrue(any('screen-behavior' in warning for warning in bundle['warnings']))


class ReceiptTest(Case):
    def test_exported_receipt_is_appended_and_clears_the_obligation(self):
        bundle = self.bundle()
        self.assertEqual(figma_export.export_status(self.root, self.record())['state'], 'pending')
        stored = figma_export.record_receipt(self.root, self.receipt(bundle))
        self.assertEqual(stored['export_id'], 'x001')
        status = figma_export.export_status(self.root, self.record())
        self.assertEqual(status['state'], 'exported')
        self.assertEqual(status['canonical_url'], 'https://www.figma.com/design/NEWFILE/x')

    def test_every_export_is_kept(self):
        bundle = self.bundle()
        figma_export.record_receipt(self.root, self.receipt(bundle))
        second = figma_export.record_receipt(self.root, self.receipt(
            bundle, file_key='SECOND', canonical_url='https://www.figma.com/design/SECOND/x'))
        self.assertEqual(second['export_id'], 'x002')
        self.assertEqual(len(figma_export.load_receipts(self.root)['exports']), 2)

    def test_receipt_missing_a_frame_is_refused(self):
        bundle = self.bundle()
        entry = self.receipt(bundle)
        entry['frames'] = entry['frames'][:1]
        with self.assertRaisesRegex(ValueError, 'screen-1/empty/mobile'):
            figma_export.record_receipt(self.root, entry)

    def test_receipt_for_another_bundle_is_refused(self):
        bundle = self.bundle()
        with self.assertRaisesRegex(ValueError, 'bundle_hash'):
            figma_export.record_receipt(self.root, self.receipt(bundle, bundle_hash='0' * 64))

    def test_edited_bundle_is_refused(self):
        bundle = self.bundle()
        edited = copy.deepcopy(bundle)
        edited['stats']['unresolved'] = 0
        self.write(figma_export.bundle_path(self.root), edited)
        with self.assertRaisesRegex(ValueError, 'edited after it was built'):
            figma_export.record_receipt(self.root, self.receipt(bundle))

    def test_gap_receipt_needs_no_bundle(self):
        # The bundle may be exactly what failed; the way out must not depend on it.
        stored = figma_export.record_receipt(self.root, {
            'status': 'gap', 'record_content_hash': 'c' * 64,
            'gap': {'reason': 'figma component map invalid'}})
        self.assertEqual(stored['status'], 'gap')
        self.assertEqual(figma_export.export_status(self.root, self.record())['state'], 'gap')

    def test_receipt_from_a_bundle_of_older_content_is_refused(self):
        bundle = self.bundle()
        record = self.record()
        record['confirmation']['content_hash'] = 'd' * 64
        self.write(self.root / 'design-system-wireframe.json', record)
        with self.assertRaisesRegex(ValueError, 'record_content_hash'):
            figma_export.record_receipt(self.root, self.receipt(bundle))
        with self.assertRaisesRegex(ValueError, 'older wireframe'):
            figma_export.record_receipt(self.root, self.receipt(bundle, record_content_hash='d' * 64))
        self.assertFalse((figma_export.receipt_path(self.root)).exists())

    def test_malformed_receipts_are_refused(self):
        bundle = self.bundle()
        extra = self.receipt(bundle)
        extra['frames'].append({'target_id': 'ghost', 'render_case_id': 'x', 'viewport': 'mobile', 'node_id': '9:9'})
        cases = {
            'not in the bundle': extra,
            'stats.instances must be an integer': self.receipt(bundle, stats={
                'instances': True, 'primitives': 1, 'unresolved': 1, 'unbound_tokens': 1}),
            'file_key does not match': self.receipt(bundle, file_key='OTHER'),
        }
        for message, entry in cases.items():
            with self.subTest(message=message):
                with self.assertRaisesRegex(ValueError, message):
                    figma_export.record_receipt(self.root, entry)
        with self.assertRaisesRegex(ValueError, 'JSON object'):
            figma_export.record_receipt(self.root, ['not', 'an', 'object'])

    def test_structurally_broken_receipt_files_never_trap_the_session(self):
        bundle = self.bundle()
        shapes = [{}, [], None, {'exports': {}}, {'exports': ['x']},
                  {'exports': [{'status': 'exported', 'record_content_hash': 'c' * 64}]}]
        for number, shape in enumerate(shapes, 1):
            with self.subTest(shape=shape):
                self.write(figma_export.receipt_path(self.root), shape)
                status = figma_export.export_status(self.root, self.record())
                self.assertEqual(status['state'], 'pending')
                self.assertIn('error', status)
                figma_export.record_receipt(self.root, {'status': 'gap', 'record_content_hash': 'c' * 64,
                                                        'gap': {'reason': 'retry'}})
                self.assertEqual(figma_export.export_status(self.root, self.record())['state'], 'gap')
                self.assertTrue((self.root / f'figma-export.json.unreadable-{number}').exists())
        figma_export.record_receipt(self.root, self.receipt(bundle))
        self.assertEqual(figma_export.export_status(self.root, self.record())['state'], 'exported')

    def test_corrupt_receipt_file_still_reports_the_export_as_owed(self):
        (figma_export.receipt_path(self.root)).write_text('{not json', encoding='utf-8')
        status = figma_export.export_status(self.root, self.record())
        self.assertEqual(status['state'], 'pending')
        self.assertIn("receipts file is unreadable", status["error"])
        figma_export.record_receipt(self.root, self.receipt(self.bundle()))
        self.assertEqual((self.root / 'figma-export.json.unreadable-1').read_text(encoding='utf-8'), '{not json')
        self.assertEqual(figma_export.export_status(self.root, self.record())['state'], 'exported')

    def test_gap_receipt_needs_a_reason_and_settles_the_export(self):
        bundle = self.bundle()
        with self.assertRaisesRegex(ValueError, 'gap.reason'):
            figma_export.record_receipt(self.root, {'status': 'gap', 'bundle_hash': bundle['bundle_hash'],
                                                    'record_content_hash': bundle['record_content_hash'], 'gap': {}})
        figma_export.record_receipt(self.root, {'status': 'gap', 'bundle_hash': bundle['bundle_hash'],
                                                'record_content_hash': bundle['record_content_hash'],
                                                'gap': {'reason': 'Figma MCP is not authorized'}})
        self.assertEqual(figma_export.export_status(self.root, self.record())['state'], 'gap')

    def test_export_of_older_content_is_stale(self):
        figma_export.record_receipt(self.root, self.receipt(self.bundle()))
        record = self.record()
        record['confirmation']['content_hash'] = 'd' * 64
        self.assertEqual(figma_export.export_status(self.root, record)['state'], 'stale')

    def test_incomplete_record_owes_nothing(self):
        record = self.record()
        record['status'] = 'in_progress'
        self.assertEqual(figma_export.export_status(self.root, record)['state'], 'not_required')


if __name__ == '__main__':
    unittest.main()
