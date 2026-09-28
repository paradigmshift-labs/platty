"""A handoff may point at a transition that lands on another screen; stage 4 must not die on it.

Stage 3 accepts any transition in the artifact as a handoff's interaction ref. The adapter builds
one packet per screen, and the engine only knows that screen's flows and rules — so a confirmed
stage-3 artifact whose CTA leads to another screen failed `prepare` with a stack trace.
"""

import sys
import unittest
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE))

import wireframe_adapter  # noqa: E402


class SplitInteractionRefsTest(unittest.TestCase):
    def test_refs_outside_this_screen_are_kept_apart_not_dropped(self):
        local, elsewhere = wireframe_adapter.split_interaction_refs(
            ['SB-TR-JOIN', 'SB-TR-FEED', 'IR-CAP'], {'SB-TR-JOIN', 'IR-CAP'})
        self.assertEqual(local, ['SB-TR-JOIN', 'IR-CAP'])
        self.assertEqual(elsewhere, ['SB-TR-FEED'])

    def test_all_local_refs_stay(self):
        self.assertEqual(wireframe_adapter.split_interaction_refs(['A'], {'A'}), (['A'], []))


if __name__ == '__main__':
    unittest.main()
