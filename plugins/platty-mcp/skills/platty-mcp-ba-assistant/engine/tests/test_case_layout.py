"""Every path inside a BA case comes from one place, for the flat v1 layout and the staged v2 one."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE))

from case_layout import CaseLayout  # noqa: E402


class LayoutCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = (Path(self.tmp.name) / 'case').resolve()
        self.root.mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def session(self, **fields):
        (self.root / 'session.json').write_text(json.dumps({'version': 1, 'stage': 'jtbd', **fields}), encoding='utf-8')


class StagedLayoutTest(LayoutCase):
    def setUp(self):
        super().setUp()
        self.session(layout=2)
        self.layout = CaseLayout.of(self.root)

    def rel(self, path):
        return path.relative_to(self.root).as_posix()

    def test_stage_artifacts_live_in_numbered_folders(self):
        self.assertEqual(self.layout.version, 2)
        expected = {'jtbd': '01-jtbd/jtbd.json', 'prd': '02-prd/prd.json',
                    'user_experience': '03-user-experience/user-experience.json',
                    'screen_behavior': '04-screen-behavior/screen-behavior.json',
                    'design_system_wireframe': '05-wireframe/design-system-wireframe.json'}
        for stage, path in expected.items():
            with self.subTest(stage=stage):
                self.assertEqual(self.rel(self.layout.artifact(stage)), path)
                self.assertEqual(self.rel(self.layout.render(stage)), path.replace('.json', '.md'))

    def test_intermediate_outputs_stay_with_their_stage(self):
        self.assertEqual(self.rel(self.layout.progress('user_experience')), '03-user-experience/user-experience-progress.md')
        self.assertEqual(self.rel(self.layout.progress('prd')), '02-prd/prd-progress.md')
        self.assertEqual(self.rel(self.layout.details('screen_behavior')), '04-screen-behavior/screen-behavior-details.md')
        self.assertEqual(self.rel(self.layout.review('screen_behavior')), '04-screen-behavior/screen-behavior-review.md')
        self.assertEqual(self.rel(self.layout.review('design_system_wireframe')), '05-wireframe/design-system-wireframe-review.md')
        self.assertEqual(self.rel(self.layout.snapshot('prd', 7)), '02-prd/snapshots/00007.json')
        self.assertEqual(self.rel(self.layout.progress_snapshot('screen_behavior', 12)), '04-screen-behavior/progress/00012.json')
        self.assertEqual(self.rel(self.layout.decision_frames('screen_behavior')), '04-screen-behavior/decision-frames')
        self.assertEqual(self.rel(self.layout.runs_root()), '05-wireframe/runs')
        self.assertEqual(self.rel(self.layout.canonical_details()), '05-wireframe/canonical-details')
        self.assertEqual(self.rel(self.layout.screen_dir('SCR-HOME')), '05-wireframe/screens/SCR-HOME')
        self.assertEqual(self.rel(self.layout.figma_bundle()), '05-wireframe/figma/bundle.json')
        self.assertEqual(self.rel(self.layout.figma_receipts()), '05-wireframe/figma/receipts.json')

    def test_audit_records_handoff_and_input_have_their_own_places(self):
        self.assertEqual(self.rel(self.layout.audit('trace.jsonl')), 'evidence/trace.jsonl')
        self.assertEqual(self.rel(self.layout.handoff()), 'handoffs/handoff.md')
        self.assertEqual(self.rel(self.layout.input_dir()), '00-input')
        self.assertEqual(self.rel(self.layout.index()), 'INDEX.md')

    def test_root_is_found_from_any_path_inside_the_case(self):
        deep = self.layout.runs_root() / 'run-1' / 'captures'
        deep.mkdir(parents=True)
        self.assertEqual(CaseLayout.root_of(deep), self.root.resolve())
        self.assertEqual(CaseLayout.root_of(self.layout.artifact('prd')), self.root.resolve())
        self.assertEqual(CaseLayout.of_path(self.layout.artifact('prd')).version, 2)

    def test_stored_paths_are_case_relative_and_resolve_back(self):
        artifact = self.layout.artifact('jtbd')
        self.assertEqual(self.layout.relative(artifact), '01-jtbd/jtbd.json')
        self.assertEqual(self.layout.resolve('01-jtbd/jtbd.json'), artifact.resolve())
        # An absolute path from an older artifact is still honoured.
        self.assertEqual(self.layout.resolve(str(artifact.resolve())), artifact.resolve())
        self.assertEqual(self.layout.resolve(''), None)


class FlatLayoutTest(LayoutCase):
    """A case written before stage folders keeps working exactly where its files are."""

    def setUp(self):
        super().setUp()
        self.session()
        self.layout = CaseLayout.of(self.root)

    def rel(self, path):
        return path.relative_to(self.root).as_posix()

    def test_flat_paths_are_unchanged(self):
        self.assertEqual(self.layout.version, 1)
        self.assertEqual(self.rel(self.layout.artifact('prd')), 'prd.json')
        self.assertEqual(self.rel(self.layout.render('design_system_wireframe')), 'design-system-wireframe.md')
        self.assertEqual(self.rel(self.layout.progress('jtbd')), 'jtbd-progress.md')
        self.assertEqual(self.rel(self.layout.progress('screen_behavior')), 'screen-behavior-progress.md')
        self.assertEqual(self.rel(self.layout.progress('prd')), 'user-experience-progress.md')
        self.assertEqual(self.rel(self.layout.details('screen_behavior')), 'screen-behavior-details.md')
        self.assertEqual(self.rel(self.layout.review('user_experience')), 'user-experience-review.md')
        self.assertEqual(self.rel(self.layout.snapshot('prd', 7)), 'evidence/snapshots/00007.json')
        self.assertEqual(self.rel(self.layout.progress_snapshot('user_experience', 3)), 'evidence/progress/00003.json')
        self.assertEqual(self.rel(self.layout.decision_frames('screen_behavior')), 'evidence/decision-frames')
        self.assertEqual(self.rel(self.layout.runs_root()), 'evidence/design-runs')
        self.assertEqual(self.rel(self.layout.canonical_details()), 'evidence/canonical-details')
        self.assertEqual(self.rel(self.layout.screen_dir('SCR-HOME')), 'wireframes/SCR-HOME')
        self.assertEqual(self.rel(self.layout.figma_bundle()), 'figma-export/bundle.json')
        self.assertEqual(self.rel(self.layout.figma_receipts()), 'figma-export.json')
        self.assertEqual(self.rel(self.layout.handoff()), 'handoff.md')

    def test_artifact_outside_any_session_uses_its_own_folder(self):
        loose = Path(self.tmp.name) / 'loose' / 'screen-behavior.json'
        loose.parent.mkdir()
        self.assertEqual(CaseLayout.root_of(loose), loose.parent.resolve())
        self.assertEqual(CaseLayout.of_path(loose).version, 1)


class IndexAndRootTest(LayoutCase):
    def setUp(self):
        super().setUp()
        self.session(layout=2)

    def test_a_stage_folder_resolves_to_its_case(self):
        stage = self.root / '05-wireframe'
        stage.mkdir()
        layout = CaseLayout.of(stage)
        self.assertEqual(layout.root, self.root)
        self.assertEqual(layout.version, 2)

    def test_index_survives_malformed_files(self):
        from case_index import write_index
        (self.root / '02-prd').mkdir()
        (self.root / '02-prd/prd.json').write_text('[]', encoding='utf-8')
        (self.root / '05-wireframe/figma').mkdir(parents=True)
        (self.root / '05-wireframe/figma/receipts.json').write_text('null', encoding='utf-8')
        write_index(self.root, {'layout': 2, 'stage': 'prd'})
        index = (self.root / 'INDEX.md').read_text(encoding='utf-8')
        self.assertIn('| PRD | 읽을 수 없음 |', index)

    def test_index_shows_the_latest_figma_export(self):
        from case_index import write_index
        (self.root / '05-wireframe/figma').mkdir(parents=True)
        (self.root / '05-wireframe/figma/receipts.json').write_text(json.dumps({'exports': [
            {'export_id': 'x001', 'status': 'exported', 'canonical_url': 'https://www.figma.com/design/A'},
            {'export_id': 'x002', 'status': 'gap'}]}), encoding='utf-8')
        write_index(self.root)
        self.assertIn('https://www.figma.com/design/A (x001)', (self.root / 'INDEX.md').read_text(encoding='utf-8'))

    def test_flat_case_gets_no_index(self):
        from case_index import write_index
        self.session()
        write_index(self.root)
        self.assertFalse((self.root / 'INDEX.md').exists())


if __name__ == '__main__':
    unittest.main()
