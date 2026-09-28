"""A link between screens is verified by the transition that crosses it, wherever it ran.

The adapter puts a transition in the packet of the screen it lands on, so the runtime evidence
for "tap the CTA on HOME and arrive on EVENT" lives in EVENT's run. The link check looked only in
the source screen and left every cross-screen link broken, so the stage could never complete.
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE))

import wireframe_run  # noqa: E402


def target(target_id, run_id, passing, brief):
    return {'id': target_id, 'run_id': run_id, 'status': 'accept_ai', 'brief_path': brief,
            'transition_assertions': [{'transition_id': tid, 'runtime_check_id': f'transition-{tid}'}
                                      for tid in passing]}


class NavigationLinkTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / 'home.json').write_text(json.dumps({'flows': [
            {'transition_id': 'SB-TR-HOME', 'parent_transition_refs': ['TR-01']}]}), encoding='utf-8')
        (self.root / 'event.json').write_text(json.dumps({'flows': [
            {'transition_id': 'SB-TR-EVENT', 'parent_transition_refs': ['TR-02']}]}), encoding='utf-8')

    def tearDown(self):
        self.tmp.cleanup()

    def record(self, event_passing):
        return {'targets': [target('T-HOME', 'run-home', ['SB-TR-HOME'], 'home.json'),
                            target('T-EVENT', 'run-event', event_passing, 'event.json')],
                'navigation_links': [{'from_target_id': 'T-HOME', 'to_target_id': 'T-EVENT',
                                      'trigger_ref': 'TR-02', 'status': 'pending'}]}

    def test_link_is_verified_by_the_crossing_transition_in_the_destination_run(self):
        record = self.record(['SB-TR-EVENT'])
        wireframe_run.sync_navigation_links(record, self.root)
        self.assertEqual(record['navigation_links'][0]['status'], 'verified')

    def test_link_stays_broken_when_no_run_exercised_its_trigger(self):
        record = self.record([])
        wireframe_run.sync_navigation_links(record, self.root)
        self.assertEqual(record['navigation_links'][0]['status'], 'broken')


if __name__ == '__main__':
    unittest.main()
