"""Places where two parts of the BA tooling disagreed and a real run had to work around them.

Each was hit by the newuser-welcome-event run (2026-09-27): the controller bound a leftover test
pack, the validator and the engine read the same image review with different path bases, a
flow decision could not be recorded with flow criteria, an issue the status named could not be
cited, and the skill pointed at a script that was not there.
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE))

import ba_audit  # noqa: E402
import ba_session  # noqa: E402
import design_system_wireframe  # noqa: E402


def write_pack(root, pack_id, version):
    folder = root / 'design-knowledge' / pack_id / version
    folder.mkdir(parents=True)
    (folder / 'pack.json').write_text(json.dumps({'version': f'{pack_id}/{version}'}), encoding='utf-8')
    (folder / 'upstream-manifest.json').write_text('{}', encoding='utf-8')


class KnowledgePackChoiceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.patch = mock.patch.object(ba_session, 'WORKSPACE_ROOT', self.root)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def test_an_explicit_pack_wins(self):
        write_pack(self.root, 'heroines', '2026-09-09')
        write_pack(self.root, 'zz-test-pack', 'v1')
        self.assertEqual(ba_session.latest_knowledge_pack('heroines/2026-09-09')['pack_id'], 'heroines')

    def test_the_only_pack_is_taken_at_its_latest_version(self):
        write_pack(self.root, 'heroines', '2026-09-01')
        write_pack(self.root, 'heroines', '2026-09-09')
        binding = ba_session.latest_knowledge_pack()
        self.assertEqual((binding['pack_id'], binding['version']), ('heroines', '2026-09-09'))

    def test_several_packs_and_no_choice_stops_instead_of_guessing(self):
        write_pack(self.root, 'heroines', '2026-09-09')
        write_pack(self.root, 'zz-test-pack', 'v1')
        with self.assertRaisesRegex(ValueError, r'heroines.*zz-test-pack.*--knowledge-pack'):
            ba_session.latest_knowledge_pack()

    def test_a_restarted_screen_behavior_keeps_its_pack_at_the_latest_version(self):
        write_pack(self.root, 'heroines', '2026-09-01')
        write_pack(self.root, 'heroines', '2026-09-09')
        write_pack(self.root, 'zz-test-pack', 'v1')
        data = {'knowledge_binding': {'pack_id': 'heroines', 'version': '2026-09-01', 'content_hash': ''}}
        binding = ba_session.bind_screen_knowledge(data)
        self.assertEqual((binding['pack_id'], binding['version']), ('heroines', '2026-09-09'))

    def test_the_wireframe_takes_exactly_the_pack_its_screen_behavior_used(self):
        write_pack(self.root, 'heroines', '2026-09-01')
        write_pack(self.root, 'heroines', '2026-09-09')
        write_pack(self.root, 'zz-test-pack', 'v1')
        binding = ba_session.latest_knowledge_pack(inherit={'pack_id': 'heroines', 'version': '2026-09-01'}, exact=True)
        self.assertEqual((binding['pack_id'], binding['version']), ('heroines', '2026-09-01'))

    def test_a_cited_pack_that_is_gone_says_so(self):
        write_pack(self.root, 'heroines', '2026-09-09')
        with self.assertRaisesRegex(ValueError, 'heroines/2026-09-01'):
            ba_session.latest_knowledge_pack(inherit={'pack_id': 'heroines', 'version': '2026-09-01'}, exact=True)


class GateReviewCapturePathTest(unittest.TestCase):
    """The engine reads an image review with run-relative paths; so must the validator."""

    def check(self, viewed):
        target = {'run_id': 'run-1', 'artifact_hashes': {'spec': 's', 'renderer': 'r'},
                  'captures': [{'id': 'CASE-A-mobile', 'path': 'evidence/design-runs/run-1/captures/CASE-A-mobile.png',
                                'image_hash': 'h1'}]}
        review = {'verdict': 'accept_ai', 'input_hash': 'i', 'knowledge_hash': 'k', 'spec_hash': 's',
                  'renderer_hash': 'r', 'capture_hashes': ['h1'], 'viewed_captures': viewed}
        gaps = []
        design_system_wireframe._check_gate_review(review, target, 'i', 'k', ['h1'], '$.targets[0]', gaps)
        return [gap for gap in gaps if 'viewed_captures' in gap]

    def test_a_run_relative_path_is_the_same_capture(self):
        self.assertEqual(self.check([{'path': 'captures/CASE-A-mobile.png', 'hash': 'h1', 'observations': ['보인다']}]), [])

    def test_a_case_relative_path_and_an_id_still_work(self):
        self.assertEqual(self.check([{'path': 'evidence/design-runs/run-1/captures/CASE-A-mobile.png', 'hash': 'h1',
                                      'observations': ['보인다']}]), [])
        self.assertEqual(self.check([{'id': 'CASE-A-mobile', 'hash': 'h1', 'observations': ['보인다']}]), [])

    def test_an_unknown_capture_is_still_refused(self):
        self.assertTrue(self.check([{'path': 'captures/OTHER-mobile.png', 'hash': 'h1', 'observations': ['보인다']}]))


def decision(**overrides):
    value = {'stage': 'recovery', 'outcome': 'continue', 'reason': '상위 입력이 바뀌어 다시 연결한다',
             'criteria': ['input_ready'], 'example_ids': [], 'evidence_ids': [], 'issue_ids': [],
             'next_action': {'kind': 'handoff', 'prompt': '상위 단계를 다시 연다'}}
    value.update(overrides)
    return value


WIREFRAME = {'model_profile': 'design_system_wireframe_v1', 'targets': [], 'issues': [], 'sources': []}


class FlowDecisionTest(unittest.TestCase):
    def test_a_recovery_decision_may_cite_only_flow_criteria(self):
        ba_audit.validate_decision(decision(), WIREFRAME)

    def test_a_baseline_decision_may_cite_only_flow_criteria(self):
        ba_audit.validate_decision(decision(stage='baseline', criteria=['baseline_ready']), WIREFRAME)

    def test_a_content_decision_still_needs_a_stage_criterion(self):
        with self.assertRaisesRegex(ValueError, 'W1-W7'):
            ba_audit.validate_decision(decision(stage='evaluate', criteria=['current_content']), WIREFRAME)


class ControllerIssueCitationTest(unittest.TestCase):
    def test_an_issue_the_controller_reported_can_be_cited(self):
        ba_audit.validate_decision(decision(issue_ids=['input-binding']), WIREFRAME, extra_issue_ids={'input-binding'})

    def test_an_issue_nobody_reported_is_still_refused(self):
        with self.assertRaisesRegex(ValueError, 'issue_ids'):
            ba_audit.validate_decision(decision(issue_ids=['made-up']), WIREFRAME, extra_issue_ids={'input-binding'})


class SkillScriptPathTest(unittest.TestCase):
    def test_the_token_script_the_wireframe_skill_names_exists(self):
        skill = (ENGINE.parents[1] / 'platty-mcp-ba-design-system-wireframe/SKILL.md').read_text(encoding='utf-8')
        self.assertIn('scripts/pack_tokens_css.py', skill)
        self.assertTrue((ENGINE.parent / 'scripts/pack_tokens_css.py').is_file())


if __name__ == '__main__':
    unittest.main()
