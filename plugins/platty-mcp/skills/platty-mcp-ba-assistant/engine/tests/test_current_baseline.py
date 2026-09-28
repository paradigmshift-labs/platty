"""An existing screen is specified against what the code draws today, not recomposed from roles.

A real run specified the home banner, the event detail it was meant to change, and the community
feed without ever reading their current code. Stage 4 then assembled new screens from pack roles,
and the result looked nothing like the app it was supposed to modify.
"""

import sys
import unittest
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE))

import screen_behavior  # noqa: E402

SOURCES = {
    'SRC-CODE': {'id': 'SRC-CODE', 'provider': 'platty', 'kind': 'code'},
    'SRC-PRD': {'id': 'SRC-PRD', 'provider': 'prd', 'kind': 'imported'},
}


def region(region_id='R-1', order=1):
    return {'id': region_id, 'name': '보상 카드', 'order': order, 'texts': ['6,000P'],
            'components': ['RewardCard'], 'code_ref': 'lib/pages/event/widgets/reward_card.dart:12-40'}


def baseline(**overrides):
    value = {'status': 'observed', 'source_ids': ['SRC-CODE'], 'code_refs': ['lib/pages/event/event_page.dart'],
             'regions': [region()], 'changes': [], 'reason': ''}
    value.update(overrides)
    return value


def gaps(screen):
    return screen_behavior.baseline_gaps(screen, SOURCES)


class CurrentBaselineTest(unittest.TestCase):
    def test_new_screen_needs_no_baseline(self):
        self.assertEqual(gaps({'id': 'S', 'origin': 'new'}), [])

    def test_existing_screen_without_baseline_is_a_gap(self):
        for origin in ('current', 'changed'):
            with self.subTest(origin=origin):
                self.assertTrue(any('current_baseline' in gap for gap in gaps({'id': 'S', 'origin': origin})))

    def test_observed_baseline_must_rest_on_code_evidence(self):
        found = '\n'.join(gaps({'id': 'S', 'origin': 'current', 'current_baseline': baseline(source_ids=['SRC-PRD'])}))
        self.assertIn('platty', found)

    def test_observed_baseline_needs_regions_with_code_refs(self):
        found = '\n'.join(gaps({'id': 'S', 'origin': 'current',
                                'current_baseline': baseline(regions=[{**region(), 'code_ref': ''}])}))
        self.assertIn('code_ref', found)
        self.assertTrue(gaps({'id': 'S', 'origin': 'current', 'current_baseline': baseline(regions=[])}))

    def test_changed_screen_says_what_changes(self):
        self.assertTrue(any('changes' in gap for gap in gaps(
            {'id': 'S', 'origin': 'changed', 'current_baseline': baseline()})))
        ok = baseline(changes=[{'region_id': 'R-1', 'change': 'modify', 'what': '목표치를 6,000P로', 'source_ids': ['SRC-PRD']}])
        self.assertEqual(gaps({'id': 'S', 'origin': 'changed', 'current_baseline': ok}), [])

    def test_change_to_an_unknown_region_is_a_gap_unless_it_adds_one(self):
        wrong = baseline(changes=[{'region_id': 'R-9', 'change': 'modify', 'what': 'x', 'source_ids': ['SRC-PRD']}])
        self.assertTrue(gaps({'id': 'S', 'origin': 'changed', 'current_baseline': wrong}))
        added = baseline(changes=[{'region_id': 'R-NEW', 'change': 'add', 'what': '응원친구 설명', 'source_ids': ['SRC-PRD']}])
        self.assertEqual(gaps({'id': 'S', 'origin': 'changed', 'current_baseline': added}), [])

    def test_unavailable_baseline_is_allowed_with_a_reason(self):
        # The workflow must not stop because the code could not be read; it says so instead.
        self.assertEqual(gaps({'id': 'S', 'origin': 'current', 'current_baseline': baseline(
            status='unavailable', source_ids=[], regions=[], reason='Platty capability gap: not authorized')}), [])
        self.assertTrue(gaps({'id': 'S', 'origin': 'current', 'current_baseline': baseline(
            status='unavailable', source_ids=[], regions=[], reason='')}))

    def test_shape_accepts_the_baseline_on_a_screen(self):
        screen = screen_behavior.SHAPE['screens'][0]
        self.assertIn('current_baseline', screen)


if __name__ == '__main__':
    unittest.main()
