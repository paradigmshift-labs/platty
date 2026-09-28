"""The controller writes a new case in stage folders and still runs a flat, older case."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ENGINE = Path(__file__).resolve().parents[1]
SESSION = ENGINE.parent / 'scripts/session.py'
sys.path.insert(0, str(ENGINE))

import ba_session  # noqa: E402
import figma_export  # noqa: E402
from tests.test_wireframe_auto_confirm import WireframeCase, ready_report  # noqa: E402


def run_session(workspace, *args):
    env = {**os.environ, 'BA_WORKSPACE': str(workspace), 'PYTHONDONTWRITEBYTECODE': '1'}
    result = subprocess.run([sys.executable, str(SESSION), *args], cwd=workspace, env=env,
                            capture_output=True, text=True)
    return json.loads(result.stdout), result


class NewCaseLayoutTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.workspace = Path(self.tmp.name).resolve()
        (self.workspace / 'brief.md').write_text('신규 유저 이벤트를 개선하고 싶다', encoding='utf-8')
        self.case = self.workspace / 'artifacts/interviews/welcome-event'
        self.result, self.process = run_session(self.workspace, 'new', str(self.case), '--stage', 'jtbd',
                                                '--input-file', str(self.workspace / 'brief.md'), '--mode', 'simulation')

    def tearDown(self):
        self.tmp.cleanup()

    def test_new_case_is_written_in_stage_folders(self):
        self.assertNotIn('error', self.result, self.process.stderr)
        session = json.loads((self.case / 'session.json').read_text(encoding='utf-8'))
        self.assertEqual(session['layout'], 2)
        self.assertTrue((self.case / '01-jtbd/jtbd.json').exists())
        self.assertFalse((self.case / 'jtbd.json').exists())
        self.assertTrue(any((self.case / '01-jtbd/snapshots').glob('*.json')))
        self.assertFalse((self.case / 'evidence/snapshots').exists())
        self.assertEqual((self.case / '00-input/brief.md').read_text(encoding='utf-8'), '신규 유저 이벤트를 개선하고 싶다')
        jtbd = json.loads((self.case / '01-jtbd/jtbd.json').read_text(encoding='utf-8'))
        self.assertEqual(jtbd['case_id'], 'welcome-event')

    def test_index_points_to_each_stage(self):
        index = (self.case / 'INDEX.md').read_text(encoding='utf-8')
        self.assertIn('[01-jtbd/jtbd.json](01-jtbd/jtbd.json)', index)
        self.assertIn('| PRD | 시작 전 |', index)

    def test_status_reads_the_staged_case(self):
        status, process = run_session(self.workspace, 'status', str(self.case))
        self.assertEqual(status.get('stage'), 'jtbd', process.stderr)
        listed, _ = run_session(self.workspace, 'list', '--mode', 'all')
        self.assertEqual([row['case_path'] for row in listed['cases']], [str(self.case)])


class StagedWireframeCase(WireframeCase):
    """The wireframe stage completes and exports the same way when its files sit in 05-wireframe/."""

    def setUp(self):
        super().setUp()
        session = self.session()
        session['layout'] = 2
        (self.folder / 'session.json').write_text(json.dumps(session), encoding='utf-8')
        flat = self.folder / 'design-system-wireframe.json'
        staged = self.folder / '05-wireframe/design-system-wireframe.json'
        staged.parent.mkdir()
        flat.rename(staged)

    def write_artifact(self, data):
        target = self.folder / '05-wireframe/design-system-wireframe.json'
        if (self.folder / 'session.json').exists() and target.parent.exists():
            target.write_text(json.dumps(data), encoding='utf-8')
        else:
            super().write_artifact(data)

    def artifact(self):
        return json.loads((self.folder / '05-wireframe/design-system-wireframe.json').read_text(encoding='utf-8'))

    def test_derived_completion_renders_next_to_the_staged_artifact(self):
        with mock.patch.object(ba_session, 'validate_case_artifact', return_value=ready_report()):
            result = ba_session.complete_derived_stage(self.folder)
        self.assertTrue(result['completed'])
        self.assertEqual(self.artifact()['status'], 'complete')
        self.assertTrue((self.folder / '05-wireframe/design-system-wireframe.md').exists())
        self.assertTrue(any((self.folder / '05-wireframe/snapshots').glob('*.json')))
        self.assertTrue((self.folder / 'INDEX.md').exists())

    def test_figma_receipts_live_in_the_wireframe_folder(self):
        self.assertEqual(figma_export.receipt_path(self.folder), (self.folder / '05-wireframe/figma/receipts.json').resolve())
        self.assertEqual(figma_export.bundle_path(self.folder), (self.folder / '05-wireframe/figma/bundle.json').resolve())


if __name__ == '__main__':
    unittest.main()
