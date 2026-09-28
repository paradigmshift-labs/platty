"""The design-system wireframe stage completes itself, like the other derived stages.

`wireframe.py sync` writes design-system-wireframe.json in place, so it never passes through
`commit_candidate` where derived stages complete. These tests pin the completion that `sync`
now reaches, the refusal of a confirmation question, and the way back after completion.
"""

import argparse
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE))

import ba_session  # noqa: E402
import wireframe_run  # noqa: E402

TEMPLATE = ENGINE.parent / 'schemas/design-system-wireframe.template.json'
STAGE = 'design_system_wireframe'


def ready_report(**overrides):
    report = {'valid': True, 'ready_for_confirmation': True, 'complete': True,
              'input_ready': True, 'knowledge_ready': True,
              'input_hash': 'i' * 64, 'knowledge_hash': 'k' * 64,
              'content_hash': 'c' * 64, 'review_hash': 'r' * 64}
    report.update(overrides)
    return report


class WireframeCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name) / 'case'
        self.folder.mkdir()
        session = {'version': 1, 'stage': STAGE, 'mode': 'live', 'model': 'test',
                   'created_at': '', 'updated_at': '', 'paused': False, 'refresh_required': False,
                   'refresh_after': '', 'needs_processing': False, 'pending': None,
                   'answered_question': None, 'entries': []}
        (self.folder / 'session.json').write_text(json.dumps(session), encoding='utf-8')
        data = json.loads(TEMPLATE.read_text(encoding='utf-8'))
        data['status'] = 'awaiting_confirmation'
        self.write_artifact(data)
        self.patches = [
            mock.patch.object(ba_session, 'artifact_fingerprints', return_value=('c' * 64, 'r' * 64)),
            mock.patch.object(ba_session, 'render_artifact', return_value='# rendered\n'),
            mock.patch.object(ba_session, 'planner_selection_gaps', return_value=[]),
            mock.patch.object(ba_session, 'receipt_reference_gaps', return_value=[]),
        ]
        for patch in self.patches:
            patch.start()

    def tearDown(self):
        for patch in self.patches:
            patch.stop()
        self.tmp.cleanup()

    def write_artifact(self, data):
        (self.folder / 'design-system-wireframe.json').write_text(json.dumps(data), encoding='utf-8')

    def artifact(self):
        return json.loads((self.folder / 'design-system-wireframe.json').read_text(encoding='utf-8'))

    def session(self):
        return json.loads((self.folder / 'session.json').read_text(encoding='utf-8'))


class PolicyTest(unittest.TestCase):
    def test_wireframe_no_longer_waits_for_the_planner(self):
        self.assertFalse(ba_session.awaits_planner(STAGE))

    def test_planning_stages_still_wait_for_the_planner(self):
        self.assertTrue(ba_session.awaits_planner('jtbd'))
        self.assertTrue(ba_session.awaits_planner('prd'))

    def test_wireframe_can_be_reopened(self):
        self.assertIn(STAGE, ba_session.REOPEN_STAGES)


class CompleteDerivedStageTest(WireframeCase):
    def test_ready_wireframe_completes_with_derived_confirmation(self):
        with mock.patch.object(ba_session, 'validate_case_artifact', return_value=ready_report()):
            result = ba_session.complete_derived_stage(self.folder)
        self.assertTrue(result['completed'])
        data = self.artifact()
        entry = self.session()['entries'][-1]
        self.assertEqual(data['status'], 'complete')
        self.assertTrue(data['confirmation']['confirmed'])
        self.assertIn('기획자 확인은 받지 않았다', data['confirmation']['statement'])
        self.assertEqual(data['confirmation']['input_hash'], 'i' * 64)
        self.assertEqual(data['confirmation']['knowledge_hash'], 'k' * 64)
        self.assertEqual(entry['kind'], 'derived-complete')
        self.assertEqual(data['confirmation']['turn_id'], entry['id'])
        self.assertTrue((self.folder / 'design-system-wireframe.md').exists())

    def test_not_ready_wireframe_is_left_alone(self):
        before = self.artifact()
        with mock.patch.object(ba_session, 'validate_case_artifact',
                               return_value=ready_report(ready_for_confirmation=False, complete=False)):
            result = ba_session.complete_derived_stage(self.folder)
        self.assertFalse(result['completed'])
        self.assertEqual(self.artifact(), before)
        self.assertEqual(self.session()['entries'], [])

    def test_stale_input_is_left_alone(self):
        with mock.patch.object(ba_session, 'validate_case_artifact',
                               return_value=ready_report(knowledge_ready=False)):
            result = ba_session.complete_derived_stage(self.folder)
        self.assertFalse(result['completed'])
        self.assertEqual(self.artifact()['status'], 'awaiting_confirmation')

    def test_already_complete_is_not_confirmed_twice(self):
        with mock.patch.object(ba_session, 'validate_case_artifact', return_value=ready_report()):
            ba_session.complete_derived_stage(self.folder)
            result = ba_session.complete_derived_stage(self.folder)
        self.assertFalse(result['completed'])
        kinds = [entry['kind'] for entry in self.session()['entries']]
        self.assertEqual(kinds.count('derived-complete'), 1)

    def test_session_guards_block_completion(self):
        for key, value in (('paused', True), ('refresh_required', True),
                           ('needs_processing', True), ('pending', {'kind': 'decision'})):
            with self.subTest(guard=key):
                session = self.session()
                original = session[key]
                session[key] = value
                (self.folder / 'session.json').write_text(json.dumps(session), encoding='utf-8')
                with mock.patch.object(ba_session, 'validate_case_artifact', return_value=ready_report()):
                    result = ba_session.complete_derived_stage(self.folder)
                self.assertFalse(result['completed'])
                self.assertEqual(self.artifact()['status'], 'awaiting_confirmation')
                session[key] = original
                (self.folder / 'session.json').write_text(json.dumps(session), encoding='utf-8')

    def test_pending_audit_recovery_blocks_completion(self):
        (self.folder / 'evidence').mkdir()
        (self.folder / 'evidence/pending-operation.json').write_text('{}', encoding='utf-8')
        with mock.patch.object(ba_session, 'validate_case_artifact', return_value=ready_report()):
            result = ba_session.complete_derived_stage(self.folder)
        self.assertFalse(result['completed'])
        self.assertIn('recover-log', result['reason'])

    def test_expected_stage_mismatch_is_left_alone(self):
        with mock.patch.object(ba_session, 'validate_case_artifact', return_value=ready_report()):
            result = ba_session.complete_derived_stage(self.folder, expected_stage='screen_behavior')
        self.assertFalse(result['completed'])
        self.assertEqual(self.artifact()['status'], 'awaiting_confirmation')

    def test_confirmation_question_left_from_before_is_withdrawn_not_waited_on(self):
        # A case that asked the planner before this stage became derived must not wait forever.
        session = self.session()
        session['pending'] = {'id': 't0001', 'kind': 'confirmation', 'text': '캡처를 확인해 주세요'}
        session['entries'] = [{'id': 't0001', 'role': 'assistant', 'kind': 'confirmation', 'text': 'x'}]
        (self.folder / 'session.json').write_text(json.dumps(session), encoding='utf-8')
        with mock.patch.object(ba_session, 'validate_case_artifact', return_value=ready_report()):
            result = ba_session.complete_derived_stage(self.folder)
        self.assertTrue(result['completed'])
        after = self.session()
        self.assertIsNone(after['pending'])
        self.assertIn('confirmation-withdrawn', [entry['kind'] for entry in after['entries']])

    def test_planner_stage_is_not_completed(self):
        session = self.session()
        session['stage'] = 'prd'
        (self.folder / 'session.json').write_text(json.dumps(session), encoding='utf-8')
        (self.folder / 'prd.json').write_text(json.dumps(self.artifact()), encoding='utf-8')
        with mock.patch.object(ba_session, 'validate_case_artifact', return_value=ready_report()):
            result = ba_session.complete_derived_stage(self.folder)
        self.assertFalse(result['completed'])


class FigmaExportPhaseTest(WireframeCase):
    """A completed wireframe keeps the session open until a Figma receipt covers it."""

    def view(self):
        report = ready_report(completion_errors=[], baseline_ready=True)
        with mock.patch.object(ba_session, 'validate_case_artifact', return_value=report):
            session, data = ba_session.load_case(self.folder)
            return ba_session.view(self.folder, session, data)

    def complete(self):
        with mock.patch.object(ba_session, 'validate_case_artifact', return_value=ready_report()):
            ba_session.complete_derived_stage(self.folder)

    def test_completed_wireframe_owes_an_export(self):
        self.complete()
        result = self.view()
        self.assertEqual(result['phase'], 'export_figma')
        self.assertFalse(result['can_yield'])
        self.assertEqual(result['next_stage'], 'figma_export')
        self.assertEqual(result['required_actions'][-1]['kind'], 'figma_export')

    def test_receipt_for_current_content_lets_the_session_end(self):
        self.complete()
        content_hash = self.artifact()['confirmation']['content_hash']
        for status in ('exported', 'gap'):
            with self.subTest(status=status):
                (self.folder / 'figma-export.json').write_text(json.dumps({'schema_version': 1, 'exports': [
                    {'export_id': 'x001', 'status': status, 'record_content_hash': content_hash}]}), encoding='utf-8')
                result = self.view()
                self.assertEqual(result['phase'], 'complete')
                self.assertTrue(result['can_yield'])

    def test_simulation_owes_no_export(self):
        session = self.session()
        session['mode'] = 'simulation'
        (self.folder / 'session.json').write_text(json.dumps(session), encoding='utf-8')
        self.complete()
        self.assertEqual(self.view()['phase'], 'complete')

    def test_receipt_for_older_content_does_not(self):
        self.complete()
        (self.folder / 'figma-export.json').write_text(json.dumps({'schema_version': 1, 'exports': [
            {'export_id': 'x001', 'status': 'exported', 'record_content_hash': 'old'}]}), encoding='utf-8')
        result = self.view()
        self.assertEqual(result['phase'], 'export_figma')
        self.assertIn('바뀌었다', result['required_actions'][-1]['reason'])


class SyncTriggerTest(WireframeCase):
    def test_sync_reaches_stage_completion(self):
        with mock.patch.object(wireframe_run, '_sync', return_value={'command': 'sync'}), \
             mock.patch.object(ba_session, 'complete_derived_stage',
                               return_value={'completed': True}) as complete:
            result = wireframe_run.sync(self.folder)
        complete.assert_called_once_with(self.folder, expected_stage=STAGE)
        self.assertEqual(result['stage_completion'], {'completed': True})

    def test_sync_without_a_session_does_not_complete(self):
        (self.folder / 'session.json').unlink()
        with mock.patch.object(wireframe_run, '_sync', return_value={'command': 'sync'}), \
             mock.patch.object(ba_session, 'complete_derived_stage') as complete:
            result = wireframe_run.sync(self.folder)
        complete.assert_not_called()
        self.assertFalse(result['stage_completion']['completed'])


class SettleCompletionTest(unittest.TestCase):
    """Re-running sync after completion must not leave status and confirmation disagreeing."""

    def record(self, confirmed_hashes=None):
        record = json.loads(TEMPLATE.read_text(encoding='utf-8'))
        if confirmed_hashes is not None:
            content_hash, review_hash = confirmed_hashes
            record['status'] = 'complete'
            record['confirmation'].update(confirmed=True, turn_id='t0001', statement='derived',
                                          content_hash=content_hash, review_hash=review_hash)
        return record

    def test_current_completion_survives_a_resync(self):
        record = self.record()
        record = self.record(wireframe_run.design_system_wireframe.fingerprints(record))
        wireframe_run.settle_completion(record, accepted=True)
        self.assertEqual(record['status'], 'complete')
        self.assertTrue(record['confirmation']['confirmed'])

    def test_stale_completion_is_withdrawn_for_restamping(self):
        record = self.record(('0' * 64, '0' * 64))
        wireframe_run.settle_completion(record, accepted=True)
        self.assertEqual(record['status'], 'awaiting_confirmation')
        self.assertFalse(record['confirmation']['confirmed'])
        self.assertEqual(set(record['confirmation']),
                         set(ba_session.WIREFRAME_EMPTY_CONFIRMATION))

    def test_revised_target_withdraws_completion(self):
        record = self.record()
        record = self.record(wireframe_run.design_system_wireframe.fingerprints(record))
        wireframe_run.settle_completion(record, accepted=False)
        self.assertEqual(record['status'], 'in_progress')
        self.assertFalse(record['confirmation']['confirmed'])


class ConfirmationAndReopenTest(WireframeCase):
    def test_confirmation_question_is_refused_in_every_derived_stage(self):
        session = self.session()
        session['stage'] = 'user_experience'
        (self.folder / 'session.json').write_text(json.dumps(session), encoding='utf-8')
        (self.folder / 'user-experience.json').write_text(json.dumps(self.artifact()), encoding='utf-8')
        args = argparse.Namespace(command='ask', path=self.folder, kind='confirmation',
                                  question_stage='user_experience', question_manifest=None)
        with self.assertRaisesRegex(ValueError, 'completes itself'):
            ba_session.run(args)

    def test_confirmation_question_is_refused(self):
        args = argparse.Namespace(command='ask', path=self.folder, kind='confirmation',
                                  question_stage=STAGE, question_manifest=None)
        with mock.patch.object(ba_session, 'validate_case_artifact', return_value=ready_report()):
            with self.assertRaisesRegex(ValueError, 'completes itself'):
                ba_session.run(args)

    def test_reopen_revokes_the_derived_completion(self):
        with mock.patch.object(ba_session, 'validate_case_artifact', return_value=ready_report()):
            ba_session.complete_derived_stage(self.folder)
        args = argparse.Namespace(command='reopen-design-system-wireframe', path=self.folder)
        with mock.patch.object(ba_session, 'view', return_value={'phase': 'stub'}):
            ba_session.run(args)
        data = self.artifact()
        self.assertEqual(data['status'], 'in_progress')
        self.assertEqual(data['confirmation'], copy.deepcopy(ba_session.WIREFRAME_EMPTY_CONFIRMATION))
        self.assertEqual(self.session()['entries'][-1]['kind'], 'reopen-design-system-wireframe')


if __name__ == '__main__':
    unittest.main()
