"""The reading documents of the later stages: summary first, names before ids, links that land.

A small synthetic case — one journey across two screens, one wireframe run, one Figma export —
is enough to pin what the documents must do: put the summary first, keep review material in
the review file, follow the journey's order, and link a journey step to its screen, a render
case to its capture, and the capture back to its case.
"""

import hashlib
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE))

import ba_session  # noqa: E402
import case_docs  # noqa: E402
from case_layout import CaseLayout  # noqa: E402

REPORT = {'valid': True, 'ready_for_confirmation': True, 'complete': True, 'errors': [], 'completion_errors': []}
PNG = bytes.fromhex('89504e470d0a1a0a0000000d4948445200000001000000010806000000'
                    '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082')


def user_experience():
    return {
        'schema_version': 2, 'title': '환영 이벤트 사용자 경험', 'status': 'complete',
        'claims': [{'id': 'CL-D01', 'kind': 'decision', 'text': '보상을 적립보다 크게 둔다', 'source_ids': []},
                   {'id': 'CL-O01', 'kind': 'unknown', 'text': '상한 운영값은 아직 정하지 않았다', 'source_ids': []}],
        'actors': [{'id': 'AC-USER', 'name': '신규 유저', 'goal': '적립 방법을 안다', 'responsibilities': [],
                    'permissions': ['조회'], 'source_claim_ids': [], 'happy_path_exclusion': ''}],
        'touchpoints': [{'id': 'TP-HOME', 'name': '홈 배너', 'kind': 'screen', 'status': 'current', 'purpose': '진입',
                         'entry_points': ['가입 직후'], 'source_ids': []},
                        {'id': 'TP-EVENT', 'name': '이벤트 화면', 'kind': 'screen', 'status': 'changed', 'purpose': '설명',
                         'entry_points': ['배너'], 'source_ids': []}],
        'experience_states': [
            {'id': 'ES-01', 'name': '홈 도착', 'kind': 'initial', 'user_meaning': '무엇이 쌓이는지 모른다',
             'information_shown': ['누적 지원금'], 'available_actions': ['배너를 연다'], 'entry_conditions': ['가입'],
             'exit_conditions': ['배너를 눌렀다'], 'resume_experience': ''},
            {'id': 'ES-02', 'name': '이벤트 읽는 중', 'kind': 'stable', 'user_meaning': '방법을 읽는다',
             'information_shown': ['보상'], 'available_actions': ['닫기'], 'entry_conditions': ['배너'],
             'exit_conditions': [], 'resume_experience': ''}],
        'experience_transitions': [
            {'id': 'TR-01', 'from_state': 'ES-01', 'to_state': 'ES-01', 'trigger': '홈에 도착한다',
             'user_visible_condition': '보상을 받지 않았다', 'touchpoint_id': 'TP-HOME', 'system_response': '진행률을 그린다',
             'feedback': '모인 값이 보인다', 'waiting_experience': '숫자를 늦게 채운다', 'repeat_experience': '갱신된 값을 본다',
             'impact_and_reversibility': '', 'recovery_experience': '진행률을 비워 둔다',
             'accessibility_requirements': ['숫자로도 말한다'], 'rule_claim_ids': [], 'source_ids': []},
            {'id': 'TR-02', 'from_state': 'ES-01', 'to_state': 'ES-02', 'trigger': '배너를 누른다',
             'user_visible_condition': '배너가 보인다', 'touchpoint_id': 'TP-EVENT', 'system_response': '화면을 연다',
             'feedback': '본 것이 이어진다', 'waiting_experience': '보상을 먼저 보여준다', 'repeat_experience': '같은 화면',
             'impact_and_reversibility': '', 'recovery_experience': '현황 자리를 비워 둔다',
             'accessibility_requirements': [], 'rule_claim_ids': [], 'source_ids': []}],
        'scenarios': [{'id': 'SC-HAPPY', 'title': '첫날 적립 방법을 안다', 'kind': 'happy', 'trigger': '홈 도착',
                       'preconditions': [], 'postconditions': ['적립 방법을 안다'],
                       'steps': [{'id': 'ST-01', 'actor_action': '홈에서 값을 본다', 'transition_id': 'TR-01',
                                  'information_shown': ['지원금'], 'choices': []},
                                 {'id': 'ST-02', 'actor_action': '배너를 누른다', 'transition_id': 'TR-02',
                                  'information_shown': ['보상'], 'choices': []}]}],
        'view_requirements': [
            {'id': 'VR-HOME', 'touchpoint_id': 'TP-HOME', 'purpose': '거리를 보여준다', 'information': ['지원금'],
             'actions': ['이벤트 화면 열기'], 'states': ['ES-01'], 'entry_paths': [], 'exit_paths': [], 'scenario_ids': []},
            {'id': 'VR-EVENT', 'touchpoint_id': 'TP-EVENT', 'purpose': '방법을 설명한다', 'information': ['보상'],
             'actions': ['새 친구 찾기'], 'states': ['ES-02'], 'entry_paths': [], 'exit_paths': [], 'scenario_ids': []}],
        'decision_packets': [], 'decision_matrices': [], 'handoff_flows': [],
        'coverage_obligations': [{'id': 'OB-TR-01-precondition', 'transition_id': 'TR-01', 'dimension': 'precondition',
                                  'condition': '드러나야 한다', 'status': 'covered', 'scenario_ids': ['SC-HAPPY'],
                                  'rationale': '보인다', 'basis_type': '', 'source_ids': []}],
        'issues': [], 'sources': [], 'review': {}, 'evidence_status': {'coverage_limits': ['유입량은 모른다']},
        'input_binding': {}, 'confirmation': {'confirmed': True}}


def screen_behavior():
    # The record lists the event screen first; the journey reaches the home screen first.
    return {
        'schema_version': 3, 'title': '환영 이벤트 화면 동작 명세', 'status': 'complete',
        'screens': [
            {'id': 'SCR-EVENT', 'name': '이벤트 화면', 'origin': 'changed', 'view_requirement_refs': ['VR-EVENT'],
             'touchpoint_refs': ['TP-EVENT'], 'purpose': '카드를 위로 올린다(R-01·D-07)', 'entry_refs': ['TR-02'],
             'exit_refs': [], 'current_baseline': {
                 'status': 'observed', 'source_ids': [], 'code_refs': [], 'reason': '',
                 'regions': [{'id': 'E-01', 'name': '히어로', 'order': 1, 'texts': ['스타벅스 받기'], 'components': [],
                              'code_ref': 'web src/Hero.tsx:1'}],
                 'changes': [{'region_id': 'E-01', 'change': 'modify', 'what': '보상을 60으로 둔다(R-01·D-07). 종료 3일 전 (D-3) 알린다',
                              'source_ids': []}]}},
            {'id': 'SCR-HOME', 'name': '홈 배너', 'origin': 'current', 'view_requirement_refs': ['VR-HOME'],
             'touchpoint_refs': ['TP-HOME'], 'purpose': '배너를 그대로 둔다', 'entry_refs': ['TR-01'], 'exit_refs': ['TR-02']}],
        'elements': [{'id': 'EL-HOME', 'screen_id': 'SCR-HOME', 'parent_id': None, 'name': '배너', 'semantic_type': 'reward_summary',
                      'purpose': '모인 값을 보여준다', 'repetition': 'none'},
                     {'id': 'EL-EVENT', 'screen_id': 'SCR-EVENT', 'parent_id': None, 'name': '히어로', 'semantic_type': 'hero',
                      'purpose': '보상을 보여준다', 'repetition': 'none'}],
        'state_axes': [{'id': 'AX-HOME', 'scope_id': 'EL-HOME', 'dimension': 'visibility',
                        'values': [{'id': 'hidden', 'label': '배너 없음', 'meaning': '참여 상태를 아직 받지 못했다'},
                                   {'id': 'shown', 'label': '배너 표시', 'meaning': '진행도가 보인다'}],
                        'initial_conditions': [{'condition': '조회 전', 'value_id': 'hidden', 'rationale': ''}]}],
        'transitions': [{'id': 'SB-TR-HOME', 'target_scope_ids': ['EL-HOME'], 'event': '참여 상태가 도착한다',
                         'preconditions': ['참여 중'], 'before': [], 'after': [], 'observable_result': '배너가 그려진다',
                         'allowed_actions': [], 'preserved_values': [], 'feedback': '', 'focus_result': '',
                         'parent_transition_refs': ['TR-01'], 'target_selector': {'kind': 'none'}}],
        'scenarios': [{'id': 'SB-SC-HOME', 'kind': 'normal', 'initial_case_id': 'CASE-HOME-HIDDEN',
                       'expected_case_id': 'CASE-HOME', 'steps': [{'transition_id': 'SB-TR-HOME', 'item_bindings': [],
                                                                   'expected_observations': []}]}],
        'render_cases': [
            {'id': 'CASE-HOME-HIDDEN', 'screen_id': 'SCR-HOME', 'title': '배너 없음 — 조회 중',
             'state_assignments': [{'scope_id': 'EL-HOME', 'item_ref': None, 'axis_id': 'AX-HOME', 'value_id': 'hidden'}],
             'visible_information': ['운동 카드'], 'available_actions': [], 'blocked_actions_with_reasons': []},
            {'id': 'CASE-HOME', 'screen_id': 'SCR-HOME', 'title': '배너 표시',
             'state_assignments': [{'scope_id': 'EL-HOME', 'item_ref': None, 'axis_id': 'AX-HOME', 'value_id': 'shown'}],
             'visible_information': ['진행도'], 'available_actions': ['view:VR-HOME:action:0'], 'blocked_actions_with_reasons': []},
            {'id': 'CASE-EVENT', 'screen_id': 'SCR-EVENT', 'title': '보상이 보인다', 'state_assignments': [],
             'visible_information': ['보상'], 'available_actions': [], 'blocked_actions_with_reasons': []}],
        'design_handoffs': [{'id': 'DH-HOME', 'screen_id': 'SCR-HOME', 'semantic_pattern': '현행 배너를 쓴다',
                             'accessibility_expectations': [], 'candidate_design_system_ref': 'role:reward',
                             'mapping_status': 'candidate', 'gap': '종료 안내 문구가 없다', 'owner': '앱'}],
        'decisions': [{'id': 'DEC-01', 'statement': '경험을 따른다', 'status': 'accepted', 'origin': 'inherited',
                       'parent_refs': [], 'rationale': ''}],
        'coverage_checks': [{'scope_id': 'SCR-HOME', 'dimension': 'visibility', 'status': 'applicable', 'rationale': '보인다'}],
        'inventory_links': [], 'reviews': [], 'review': {}, 'sources': [], 'issues': [], 'interaction_rules': [],
        'constraints': [], 'decision_packets': [], 'out_of_scope': [{'note': 'TP-BATCH', 'reason': '백그라운드 결과'}],
        'evidence_status': {'coverage_limits': []}, 'input_binding': {}, 'confirmation': {'confirmed': True}}


def prd():
    # The ids the later stages cite in their prose.
    return {'schema_version': 1, 'status': 'complete', 'rules': [{'id': 'R-01'}], 'decisions': [{'id': 'D-07'}]}


def wireframe(run, runs):
    def capture(case_id):
        return {'id': case_id + '-mobile', 'render_case_id': case_id, 'viewport': 'mobile', 'state': case_id,
                'path': f'{runs}/{run}/captures/{case_id}-mobile.png', 'image_hash': 'a' * 64}
    return {
        'schema_version': 1, 'title': '환영 이벤트 화면 동작 명세 Design System Wireframes', 'status': 'complete',
        'knowledge_binding': {'pack_id': 'pack', 'version': 'v1'},
        'targets': [{'id': 'target-SCR-HOME', 'screen_id': 'SCR-HOME', 'status': 'accept_ai', 'run_id': run,
                     'parent_run_id': '', 'detail_mode': 'inline', 'component_mappings': [], 'token_mappings': [],
                     'design_decisions': {'layout': {'status': 'verified', 'rationale': '기준선 순서를 따랐다'}},
                     # Captured in a different order than the spec lists the cases.
                     'captures': [capture('CASE-HOME'), capture('CASE-HOME-HIDDEN')],
                     'gate': {'verdict': 'accept_ai', 'rationale': 'ok', 'capture_hashes': ['b' * 64],
                              'artifacts': {'review': {'path': f'{runs}/{run}/ai-review.json'}}},
                     'runtime_checks': [{'id': 'runtime-playwright', 'status': 'pass'}]}],
        'navigation_links': [], 'coverage': [], 'issues': [], 'review': {'verdict': 'suitable', 'rationale': 'W1'},
        'input_binding': {'screen_behavior': {'content_hash': 'c' * 64}}, 'confirmation': {'confirmed': True}}


class StagedCase(unittest.TestCase):
    RUN = 'run-1'
    LAYOUT = 2

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = (Path(self.tmp.name) / 'case').resolve()
        self.root.mkdir()
        self.session = {'version': 1, 'stage': 'design_system_wireframe', 'mode': 'live', 'entries': []}
        if self.LAYOUT == 2:
            self.session['layout'] = 2
        (self.root / 'session.json').write_text(json.dumps(self.session), encoding='utf-8')
        self.layout = CaseLayout.of(self.root)
        runs = self.layout.relative(self.layout.runs_root())
        self.artifacts = {'user_experience': user_experience(), 'screen_behavior': screen_behavior(),
                          'design_system_wireframe': wireframe(self.RUN, runs)}
        path = self.layout.artifact('prd')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(prd()), encoding='utf-8')
        for stage, data in self.artifacts.items():
            path = self.layout.artifact(stage)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        captures = self.layout.runs_root() / self.RUN / 'captures'
        captures.mkdir(parents=True)
        for case_id in ('CASE-HOME', 'CASE-HOME-HIDDEN'):
            (captures / f'{case_id}-mobile.png').write_bytes(PNG)
        (self.layout.runs_root() / self.RUN / 'ai-review.json').write_text(json.dumps({
            'criteria': [{'id': 'W1', 'observation': '배너가 헤드라인부터 읽힌다'}], 'findings': [],
            'limitations': ['실제 날짜는 재현하지 못했다']}, ensure_ascii=False), encoding='utf-8')
        self.receipts = self.layout.figma_receipts()
        self.receipts.parent.mkdir(parents=True, exist_ok=True)
        self.receipts.write_text(json.dumps({'exports': [{
            'export_id': 'x001', 'status': 'exported', 'canonical_url': 'https://www.figma.com/design/KEY',
            'file_name': '환영 이벤트', 'exported_at': '2026-09-27T00:00:00', 'stats': {'unresolved': 3},
            'frames': [{'render_case_id': 'CASE-HOME', 'node_id': '4:120'}]}]}), encoding='utf-8')

    def tearDown(self):
        self.tmp.cleanup()

    def write_all(self):
        for stage, data in self.artifacts.items():
            ba_session.write_stage_docs(self.root, self.session, stage, data, REPORT)

    def body(self, stage):
        return self.layout.render(stage).read_text(encoding='utf-8')

    def review(self, stage):
        return self.layout.review(stage).read_text(encoding='utf-8')


class SummaryFirstTest(StagedCase):
    def test_every_document_opens_with_its_summary_and_names_its_review_file(self):
        self.write_all()
        for stage in case_docs.DOC_STAGES:
            with self.subTest(stage=stage):
                body = self.body(stage)
                self.assertEqual(re.findall(r'^## .*$', body, re.M)[0], '## 요약')
                self.assertIn(f'[{self.layout.review(stage).name}]({self.layout.review(stage).name})', body)
                self.assertTrue(self.layout.review(stage).exists())

    def test_review_material_leaves_the_body_but_stays_in_the_review_file(self):
        self.write_all()
        ux, ux_review = self.body('user_experience'), self.review('user_experience')
        self.assertNotIn('OB-TR-01-precondition', ux)
        self.assertIn('OB-TR-01-precondition', ux_review)
        sb, sb_review = self.body('screen_behavior'), self.review('screen_behavior')
        self.assertNotIn('## 검증', sb)
        self.assertIn('## 검증', sb_review)
        wf, wf_review = self.body('design_system_wireframe'), self.review('design_system_wireframe')
        self.assertIsNone(re.search(r'\b[0-9a-f]{64}\b', wf), 'hashes belong in the review file')
        self.assertIn(self.RUN, wf_review)


class UserExperienceTest(StagedCase):
    def test_transitions_are_one_table_and_decisions_and_unknowns_are_shown(self):
        self.write_all()
        body = self.body('user_experience')
        rows = [line for line in body.splitlines() if line.startswith('| <a id="tr-')]
        self.assertEqual(len(rows), 2)
        self.assertIn('숫자를 늦게 채운다', rows[0])
        self.assertIn('보상을 적립보다 크게 둔다', body)
        self.assertIn('상한 운영값은 아직 정하지 않았다', body.split('## 7.')[1])

    def test_a_journey_step_links_to_the_screen_that_shows_it(self):
        self.write_all()
        self.assertIn('(../04-screen-behavior/screen-behavior.md#scr-home)', self.body('user_experience'))


class ScreenBehaviorTest(StagedCase):
    def test_screens_follow_the_journey_not_the_record_order(self):
        self.write_all()
        headings = re.findall(r'^## (.+?) <sub>', self.body('screen_behavior'), re.M)
        self.assertEqual(headings, ['홈 배너', '이벤트 화면'])

    def test_upstream_codes_move_from_the_prose_to_the_review_trace(self):
        self.write_all()
        body, review = self.body('screen_behavior'), self.review('screen_behavior')
        self.assertIn('보상을 60으로 둔다', body)
        self.assertNotIn('(R-01·D-07)', body)
        self.assertIn('종료 3일 전 (D-3) 알린다', body, 'a parenthesis that names no id is prose')
        self.assertRegex(review, r'\| 이벤트 화면 \| D-07, R-01 \|')

    def test_internal_keys_become_words_and_a_value_is_explained_once(self):
        self.write_all()
        body = self.body('screen_behavior')
        self.assertNotIn('view:VR-HOME', body)
        self.assertIn('이벤트 화면 열기', body)
        self.assertEqual(body.count('참여 상태를 아직 받지 못했다'), 1)

    def test_one_behavior_diagram_per_screen_at_most(self):
        self.write_all()
        for section in self.body('screen_behavior').split('\n## ')[1:]:
            self.assertLessEqual(section.count('```mermaid'), 1)

    def test_render_cases_link_to_their_captures_and_back_to_the_journey(self):
        self.write_all()
        body = self.body('screen_behavior')
        self.assertIn('(../05-wireframe/design-system-wireframe.md#case-home)', body)
        self.assertIn('[홈에 도착한다](../03-user-experience/user-experience.md#tr-01)', body)

    def test_a_record_read_on_its_own_renders_without_links(self):
        import screen_behavior as module
        body = module.render(screen_behavior(), REPORT)
        self.assertIn('## 요약', body)
        self.assertNotIn('.md#', body)


class WireframeTest(StagedCase):
    def test_captures_follow_the_spec_order_and_link_to_figma_and_back(self):
        self.write_all()
        body = self.body('design_system_wireframe')
        self.assertLess(body.index('id="case-home-hidden"'), body.index('id="case-home"'))
        self.assertIn('src="runs/run-1/captures/CASE-HOME-mobile.png"', body)
        self.assertIn('https://www.figma.com/design/KEY?node-id=4-120', body)
        self.assertIn('href="../04-screen-behavior/screen-behavior.md#case-home"', body)
        self.assertIn('배너가 헤드라인부터 읽힌다', body)
        self.assertIn('실제 날짜는 재현하지 못했다', body.split('## 미결 사항')[1])
        self.assertIn('요소 3개를 라이브러리 컴포넌트로 잇지 못해', body)

    def test_recording_a_receipt_rewrites_the_wireframe_document(self):
        import figma_export
        self.write_all()
        figma_export.record_receipt(self.root, {'status': 'gap', 'record_content_hash': '',
                                                'gap': {'reason': 'Figma 연결이 끊겼다'}})
        self.assertIn('Figma 내보내기 공백** Figma 연결이 끊겼다', self.body('design_system_wireframe'))

    def test_a_new_receipt_rewrites_the_wireframe_document(self):
        self.write_all()
        receipts = json.loads(self.receipts.read_text(encoding='utf-8'))
        receipts['exports'].append({'export_id': 'x002', 'status': 'exported', 'canonical_url': 'https://www.figma.com/design/NEW',
                                    'frames': [{'render_case_id': 'CASE-HOME', 'node_id': '9:1'}]})
        self.receipts.write_text(json.dumps(receipts), encoding='utf-8')
        case_docs.refresh(self.root)
        self.assertIn('https://www.figma.com/design/NEW?node-id=9-1', self.body('design_system_wireframe'))


class CrossLinkTest(StagedCase):
    LINK = re.compile(r'\]\(([^)#\s]+\.md)#([^)\s]+)\)|href="([^"#]+\.md)#([^"]+)"')

    def test_every_link_between_documents_lands_on_an_anchor(self):
        self.write_all()
        checked = 0
        for stage in case_docs.DOC_STAGES:
            source = self.layout.render(stage)
            for match in self.LINK.finditer(source.read_text(encoding='utf-8')):
                target, fragment = (match.group(1), match.group(2)) if match.group(1) else (match.group(3), match.group(4))
                path = (source.parent / target).resolve()
                with self.subTest(source=source.name, target=target, fragment=fragment):
                    self.assertTrue(path.exists())
                    self.assertIn(f'id="{fragment}"', path.read_text(encoding='utf-8'))
                checked += 1
        self.assertGreater(checked, 5)

    def test_an_earlier_document_gains_its_links_when_a_later_stage_completes(self):
        # The controller writes the documents before it persists the completed record, so on disk
        # the stage is still awaiting completion while its documents are written.
        waiting = dict(self.artifacts['screen_behavior'], status='awaiting_confirmation')
        self.layout.artifact('screen_behavior').write_text(json.dumps(waiting), encoding='utf-8')
        ba_session.write_stage_docs(self.root, self.session, 'user_experience', self.artifacts['user_experience'], REPORT)
        self.assertNotIn('screen-behavior.md#', self.body('user_experience'))
        self.assertFalse(self.layout.render('screen_behavior').exists(), 'an unfinished stage gets no document')
        ba_session.write_stage_docs(self.root, self.session, 'screen_behavior', self.artifacts['screen_behavior'], REPORT)
        self.assertIn('screen-behavior.md#scr-home', self.body('user_experience'))

    def test_a_document_that_fails_to_refresh_does_not_stop_the_save(self):
        self.write_all()
        with mock.patch.object(case_docs, 'render_body', side_effect=RuntimeError('boom')), \
                mock.patch('sys.stderr'):
            result = case_docs.refresh(self.root)
        self.assertEqual(result['written'], [])
        self.assertEqual(len(result['errors']), 3)


class FlatCrossLinkTest(CrossLinkTest):
    """A case written before stage folders gets the same documents, links and captures."""
    LAYOUT = 1

    def test_documents_sit_beside_the_flat_artifacts(self):
        self.write_all()
        self.assertTrue((self.root / 'screen-behavior-review.md').exists())
        self.assertIn('src="evidence/design-runs/run-1/captures/CASE-HOME-mobile.png"', self.body('design_system_wireframe'))


class LegacySchemaTest(unittest.TestCase):
    def test_old_schemas_keep_their_renderer_and_get_no_review_file(self):
        import screen_behavior as sb_module
        import user_experience as ux_module
        self.assertIsNone(sb_module.render_review({'schema_version': 2}))
        self.assertIsNone(sb_module.render_review({'schema_version': 1}))
        self.assertIsNone(ux_module.render_review({'schema_version': 1}))
        self.assertIsNone(case_docs.render_review('prd', {}, REPORT, None))


class RenderDocsCommandTest(StagedCase):
    def test_render_docs_rewrites_documents_and_leaves_artifacts_alone(self):
        before = {stage: hashlib.sha256(self.layout.artifact(stage).read_bytes()).hexdigest() for stage in case_docs.DOC_STAGES}
        with mock.patch.object(ba_session, 'validate_case_artifact', return_value=REPORT):
            result = ba_session.render_docs(self.root, self.session)
        self.assertEqual(result['rendered'], list(case_docs.DOC_STAGES))
        for stage in case_docs.DOC_STAGES:
            self.assertEqual(hashlib.sha256(self.layout.artifact(stage).read_bytes()).hexdigest(), before[stage])
            self.assertTrue(self.layout.review(stage).exists())

    def test_index_links_the_review_files(self):
        with mock.patch.object(ba_session, 'validate_case_artifact', return_value=REPORT):
            ba_session.render_docs(self.root, self.session)
        self.assertIn('[검토 기록](04-screen-behavior/screen-behavior-review.md)',
                      (self.root / 'INDEX.md').read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
