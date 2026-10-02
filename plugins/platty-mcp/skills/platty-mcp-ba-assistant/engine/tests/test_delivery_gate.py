"""The UX stage must deliver storyboard and Notion outputs before screens start."""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE))

import ba_session  # noqa: E402


def ready_report(**overrides):
    report = {'valid': True, 'baseline_ready': True, 'ready_for_confirmation': True,
              'complete': True, 'input_ready': True, 'knowledge_ready': True,
              'content_hash': 'c' * 64, 'review_hash': 'r' * 64,
              'completion_errors': [], 'metrics': []}
    report.update(overrides)
    return report


def confirmed_ux():
    data = json.loads((ENGINE.parent / 'schemas/user-experience.template.json').read_text(encoding='utf-8'))
    data.update(case_id='welcome-event', title='Welcome event UX', status='complete')
    data['input_binding'] = {'prd_path': '', 'content_hash': 'p' * 64, 'review_hash': 'q' * 64,
                             'confirmation_turn_id': 't-prd', 'service_context_project_id': 'heroines',
                             'service_context_revision': 'rev-1', 'claim_ids': [], 'handoff_issue_ids': []}
    data['evidence_status'].update(project_id='heroines', status='ready', checked_at='2026-10-02T00:00:00+00:00',
                                   baseline_revision='rev-1', observed_revision='rev-1')
    data['confirmation'] = {'confirmed': True, 'turn_id': 't-ux', 'statement': '좋습니다',
                            'content_hash': 'c' * 64, 'review_hash': 'r' * 64}
    return data


class DeliveryGateCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name) / 'case'
        self.folder.mkdir()
        self.session = {'version': 1, 'layout': 2, 'stage': 'user_experience', 'mode': 'live',
                        'model': 'test', 'created_at': '', 'updated_at': '', 'paused': False,
                        'refresh_required': False, 'refresh_after': '', 'needs_processing': False,
                        'pending': None, 'answered_question': None, 'entries': [],
                        'ux_delivery_required': True}
        (self.folder / 'session.json').write_text(json.dumps(self.session), encoding='utf-8')
        (self.folder / '03-user-experience').mkdir()
        (self.folder / '01-jtbd').mkdir()
        (self.folder / '02-prd').mkdir()
        (self.folder / '01-jtbd/jtbd.json').write_text(json.dumps({'confirmation': {'turn_id': 't-jtbd'}}), encoding='utf-8')
        (self.folder / '02-prd/prd.json').write_text(json.dumps({'confirmation': {'turn_id': 't-prd'}}), encoding='utf-8')
        (self.folder / '03-user-experience/user-experience.json').write_text(json.dumps(confirmed_ux()), encoding='utf-8')
        self.patches = [
            mock.patch.object(ba_session, 'validate_case_artifact', return_value=ready_report()),
            mock.patch.object(ba_session, 'input_binding_current', return_value=True),
            mock.patch.object(ba_session, 'artifact_fingerprints', return_value=('c' * 64, 'r' * 64)),
        ]
        for patch in self.patches:
            patch.start()

    def tearDown(self):
        for patch in self.patches:
            patch.stop()
        self.tmp.cleanup()

    def load(self):
        return ba_session.load_case(self.folder)

    def view(self):
        session, data = self.load()
        return ba_session.view(self.folder, session, data)

    def record(self, **fields):
        defaults = {'command': 'delivery-record', 'path': self.folder, 'step': 'storyboard',
                    'status': 'complete', 'input_hash': self.view()['delivery']['input_hash'],
                    'spec': None, 'html': None, 'reason': '', 'checkpoint': [], 'url': None,
                    'parent_page_id': None}
        defaults.update(fields)
        return ba_session.run(argparse.Namespace(**defaults))

    def test_confirmed_ux_enters_storyboard_delivery_before_screen_behavior(self):
        status = self.view()
        self.assertEqual(status['phase'], 'deliver_storyboard')
        self.assertEqual(status['next_stage'], 'storyboard_delivery')
        self.assertFalse(status['can_yield'])
        self.assertEqual(status['required_actions'][0]['kind'], 'delivery')
        self.assertIn('input_hash', status['delivery'])

    def test_delivery_receipts_advance_to_screen_behavior_after_results_are_presented(self):
        html = self.folder / 'storyboard.html'
        html.write_text('<html>done</html>', encoding='utf-8')
        self.record(step='storyboard', html=html)
        self.assertEqual(self.view()['phase'], 'publish_notion')
        self.record(step='notion', checkpoint=[
            'bundle:bundle-page:https://notion.test/bundle',
            'jtbd:jtbd-page:https://notion.test/jtbd',
            'prd:prd-page:https://notion.test/prd',
            'user_experience:ux-page:https://notion.test/ux',
        ])
        self.assertEqual(self.view()['phase'], 'deliver_results')
        self.record(step='results', html=html, url='https://notion.test/bundle')
        status = self.view()
        self.assertEqual(status['phase'], 'start_screen_behavior')
        self.assertEqual(status['next_stage'], 'screen_behavior_ready')

    def test_partial_notion_checkpoint_is_preserved_for_later_completion(self):
        html = self.folder / 'storyboard.html'
        html.write_text('<html>done</html>', encoding='utf-8')
        self.record(step='storyboard', html=html)
        self.record(step='notion', status='waiting', reason='continuing in this turn',
                    checkpoint=['bundle:bundle-page:https://notion.test/bundle'])
        waiting = self.view()
        self.assertEqual(waiting['phase'], 'waiting')
        self.assertEqual(waiting['delivery']['receipts']['notion']['checkpoints']['bundle']['page_id'], 'bundle-page')
        self.record(step='notion', checkpoint=[
            'jtbd:jtbd-page:https://notion.test/jtbd',
            'prd:prd-page:https://notion.test/prd',
            'user_experience:ux-page:https://notion.test/ux',
        ])
        receipt = self.view()['delivery']['receipts']['notion']
        self.assertEqual(receipt['status'], 'complete')
        self.assertEqual(receipt['checkpoints']['bundle']['url'], 'https://notion.test/bundle')
        self.assertEqual(self.view()['phase'], 'deliver_results')

    def test_notion_gap_still_requires_results_delivery_before_screens(self):
        html = self.folder / 'storyboard.html'
        html.write_text('<html>local only</html>', encoding='utf-8')
        self.record(step='storyboard', html=html)
        self.record(step='notion', status='gap', reason='NOTION_TOKEN missing')
        self.assertEqual(self.view()['phase'], 'deliver_results')
        self.record(step='results', html=html, reason='Published locally; Notion skipped')
        self.assertEqual(self.view()['phase'], 'start_screen_behavior')

    def test_storyboard_gap_does_not_advance_without_html(self):
        with self.assertRaisesRegex(ValueError, 'waiting'):
            self.record(step='storyboard', status='gap', reason='image generation failed')
        self.assertEqual(self.view()['phase'], 'deliver_storyboard')

    def test_results_receipt_is_stale_when_the_html_changes_after_delivery(self):
        html = self.folder / 'storyboard.html'
        html.write_text('<html>first</html>', encoding='utf-8')
        self.record(step='storyboard', html=html)
        self.record(step='notion', status='gap', reason='NOTION_TOKEN missing')
        self.record(step='results', html=html)
        self.assertEqual(self.view()['phase'], 'start_screen_behavior')
        html.write_text('<html>changed</html>', encoding='utf-8')
        self.assertEqual(self.view()['phase'], 'deliver_results')

    def test_delivery_record_fails_closed_when_upstream_documents_are_missing(self):
        (self.folder / '01-jtbd/jtbd.json').unlink()
        html = self.folder / 'storyboard.html'
        html.write_text('<html>done</html>', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'jtbd'):
            ba_session.run(argparse.Namespace(command='delivery-record', path=self.folder, step='storyboard',
                                              status='complete', input_hash='x' * 64, spec=None, html=html,
                                              reason='', checkpoint=[], url=None, parent_page_id=None))

    def test_delivery_record_fails_when_prd_is_not_bound_to_current_jtbd(self):
        html = self.folder / 'storyboard.html'
        html.write_text('<html>done</html>', encoding='utf-8')
        prd_data = {'kind': 'prd', 'confirmation': {'turn_id': 't-prd'}}
        (self.folder / '02-prd/prd.json').write_text(json.dumps(prd_data), encoding='utf-8')
        original = ba_session.input_binding_current
        with mock.patch.object(ba_session, 'input_binding_current',
                               side_effect=lambda folder, data: False if data.get('kind') == 'prd' else original(folder, data)):
            with self.assertRaisesRegex(ValueError, 'prd'):
                ba_session.run(argparse.Namespace(command='delivery-record', path=self.folder, step='storyboard',
                                                  status='complete', input_hash='x' * 64, spec=None, html=html,
                                                  reason='', checkpoint=[], url=None, parent_page_id=None))

    def test_draft_ux_with_delivery_flag_reports_inactive_delivery_without_hashing_inputs(self):
        data = confirmed_ux()
        data['status'] = 'in_progress'
        data['confirmation'] = dict(ba_session.EMPTY_CONFIRMATION)
        (self.folder / '03-user-experience/user-experience.json').write_text(json.dumps(data), encoding='utf-8')
        with mock.patch.object(ba_session, 'validate_case_artifact',
                               return_value=ready_report(complete=False, ready_for_confirmation=False)), \
             mock.patch.object(ba_session, 'delivery_input_hashes') as hashes:
            status = self.view()
        hashes.assert_not_called()
        self.assertEqual(status['phase'], 'interviewing')
        self.assertFalse(status['delivery']['active'])

    def test_missing_upstream_on_stale_ux_status_does_not_throw(self):
        (self.folder / '01-jtbd/jtbd.json').unlink()
        with mock.patch.object(ba_session, 'delivery_input_hashes') as hashes:
            status = self.view()
        hashes.assert_not_called()
        self.assertEqual(status['phase'], 'input_stale')
        self.assertFalse(status['delivery']['active'])

    def test_direct_screen_start_refuses_pending_or_unprocessed_ux(self):
        for key, value in (('pending', {'kind': 'decision'}), ('needs_processing', True)):
            with self.subTest(key=key):
                session = json.loads((self.folder / 'session.json').read_text(encoding='utf-8'))
                original = session[key]
                session[key] = value
                (self.folder / 'session.json').write_text(json.dumps(session), encoding='utf-8')
                with self.assertRaisesRegex(ValueError, 'pending UX question|answer'):
                    ba_session.run(argparse.Namespace(command='start-screen-behavior', path=self.folder,
                                                      knowledge_pack=None))
                session[key] = original
                (self.folder / 'session.json').write_text(json.dumps(session), encoding='utf-8')

    def test_legacy_already_confirmed_ux_does_not_gain_delivery_on_status(self):
        session = json.loads((self.folder / 'session.json').read_text(encoding='utf-8'))
        session.pop('ux_delivery_required')
        (self.folder / 'session.json').write_text(json.dumps(session), encoding='utf-8')
        self.assertEqual(self.view()['phase'], 'start_screen_behavior')

    def test_delivery_start_opts_a_legacy_case_into_the_gate(self):
        session = json.loads((self.folder / 'session.json').read_text(encoding='utf-8'))
        session.pop('ux_delivery_required')
        (self.folder / 'session.json').write_text(json.dumps(session), encoding='utf-8')
        result = ba_session.run(argparse.Namespace(command='delivery-start', path=self.folder))
        self.assertEqual(result['phase'], 'deliver_storyboard')

    def test_auto_completed_unfinished_ux_gets_delivery_gate(self):
        session = json.loads((self.folder / 'session.json').read_text(encoding='utf-8'))
        session.pop('ux_delivery_required')
        (self.folder / 'session.json').write_text(json.dumps(session), encoding='utf-8')
        data = confirmed_ux()
        data['status'] = 'awaiting_confirmation'
        data['confirmation'] = dict(ba_session.EMPTY_CONFIRMATION)
        (self.folder / '03-user-experience/user-experience.json').write_text(json.dumps(data), encoding='utf-8')
        result = ba_session.complete_derived_stage(self.folder, expected_stage='user_experience')
        self.assertTrue(result['completed'])
        self.assertTrue(json.loads((self.folder / 'session.json').read_text(encoding='utf-8'))['ux_delivery_required'])
        self.assertEqual(self.view()['phase'], 'deliver_storyboard')

    def test_auto_completed_legacy_ux_without_jtbd_prd_does_not_enable_delivery(self):
        (self.folder / '01-jtbd/jtbd.json').unlink()
        (self.folder / '02-prd/prd.json').unlink()
        session = json.loads((self.folder / 'session.json').read_text(encoding='utf-8'))
        session.pop('ux_delivery_required')
        (self.folder / 'session.json').write_text(json.dumps(session), encoding='utf-8')
        data = confirmed_ux()
        data['status'] = 'awaiting_confirmation'
        data['confirmation'] = dict(ba_session.EMPTY_CONFIRMATION)
        (self.folder / '03-user-experience/user-experience.json').write_text(json.dumps(data), encoding='utf-8')
        result = ba_session.complete_derived_stage(self.folder, expected_stage='user_experience')
        self.assertTrue(result['completed'])
        self.assertNotIn('ux_delivery_required', json.loads((self.folder / 'session.json').read_text(encoding='utf-8')))


class DeliveryCliTest(unittest.TestCase):
    def test_delivery_record_help_exposes_receipt_contract(self):
        session_script = ENGINE.parent / 'scripts/session.py'
        result = subprocess.run([sys.executable, str(session_script), 'delivery-record', '--help'],
                                cwd=ENGINE, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'},
                                capture_output=True, text=True, check=True)
        self.assertIn('--step {storyboard,notion,results}', result.stdout)
        self.assertIn('--input-hash', result.stdout)
        self.assertIn('--checkpoint CHECKPOINT', result.stdout)


if __name__ == '__main__':
    unittest.main()
