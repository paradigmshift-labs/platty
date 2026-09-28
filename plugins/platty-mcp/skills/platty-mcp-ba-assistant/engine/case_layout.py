"""Where every file of a BA case lives.

Paths used to be assembled as strings in some forty places, all assuming one flat folder. This
module is the only place that knows the layout:

- layout 1 (a session without `layout`): the flat folder older cases were written in. Kept
  exactly as it was so those cases keep working where their files already are.
- layout 2: one numbered folder per stage, so a stage's artifact and its intermediate outputs
  sit together; cross-stage audit records stay in `evidence/`.

Upstream bindings inside artifacts stay absolute paths, as before. Paths the wireframe stage
stores (runs, captures, details) are case-relative (`relative`) and read back from the case root.
"""

import json
from pathlib import Path

CURRENT_LAYOUT = 2
ARTIFACT_NAMES = {'jtbd': 'jtbd.json', 'prd': 'prd.json',
                  'planning_context': 'planning-context.json', 'user_experience': 'user-experience.json',
                  'screen_behavior': 'screen-behavior.json', 'design_system_wireframe': 'design-system-wireframe.json'}
STAGE_FOLDERS = {'planning_context': '00-planning-context', 'jtbd': '01-jtbd', 'prd': '02-prd',
                 'user_experience': '03-user-experience', 'screen_behavior': '04-screen-behavior',
                 'design_system_wireframe': '05-wireframe'}
# Layout 1 names, kept as they were: only jtbd and screen behavior had their own progress file.
FLAT_PROGRESS_NAMES = {'jtbd': 'jtbd-progress.md', 'screen_behavior': 'screen-behavior-progress.md'}
WIREFRAME = 'design_system_wireframe'


def _read_layout(root):
    try:
        session = json.loads((Path(root) / 'session.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return 1
    value = session.get('layout') if isinstance(session, dict) else None
    return value if value in (1, 2) else 1


class CaseLayout:
    def __init__(self, root, version=1):
        self.root = Path(root).resolve()
        self.version = version

    @classmethod
    def of(cls, root):
        """The layout of the case `root` belongs to — the case folder or any folder inside it."""
        root = cls.root_of(root)
        return cls(root, _read_layout(root))

    @classmethod
    def of_path(cls, path):
        """The layout of the case any path belongs to."""
        return cls.of(cls.root_of(path))

    @staticmethod
    def root_of(path):
        """The case folder: the nearest folder upwards that holds session.json.

        An artifact read on its own, outside any case, is its own folder's — the flat reading.
        """
        path = Path(path).resolve()
        start = path if path.is_dir() else path.parent
        for folder in (start, *start.parents):
            if (folder / 'session.json').is_file():
                return folder
        return start

    def stage_dir(self, stage):
        return self.root if self.version == 1 else self.root / STAGE_FOLDERS[stage]

    def artifact(self, stage):
        return self.stage_dir(stage) / ARTIFACT_NAMES[stage]

    def render(self, stage):
        return self.artifact(stage).with_suffix('.md')

    def progress(self, stage):
        if self.version == 1:
            return self.root / FLAT_PROGRESS_NAMES.get(stage, 'user-experience-progress.md')
        return self.stage_dir(stage) / (ARTIFACT_NAMES[stage].replace('.json', '') + '-progress.md')

    def review(self, stage):
        """The review file beside a stage's reading document: what a reviewer needs, not a reader."""
        return self.stage_dir(stage) / (ARTIFACT_NAMES[stage].replace('.json', '') + '-review.md')

    def details(self, stage):
        return self.stage_dir(stage) / (ARTIFACT_NAMES[stage].replace('.json', '') + '-details.md')

    def snapshot(self, stage, number):
        folder = self.root / 'evidence/snapshots' if self.version == 1 else self.stage_dir(stage) / 'snapshots'
        return folder / f'{number:05}.json'

    def progress_snapshot(self, stage, number):
        folder = self.root / 'evidence/progress' if self.version == 1 else self.stage_dir(stage) / 'progress'
        return folder / f'{number:05}.json'

    def decision_frames(self, stage):
        return self.root / 'evidence/decision-frames' if self.version == 1 else self.stage_dir(stage) / 'decision-frames'

    def runs_root(self):
        return self.root / 'evidence/design-runs' if self.version == 1 else self.stage_dir(WIREFRAME) / 'runs'

    def canonical_details(self):
        return self.root / 'evidence/canonical-details' if self.version == 1 else self.stage_dir(WIREFRAME) / 'canonical-details'

    def screen_dir(self, screen_id):
        return (self.root / 'wireframes' if self.version == 1 else self.stage_dir(WIREFRAME) / 'screens') / screen_id

    def figma_bundle(self):
        return self.root / 'figma-export/bundle.json' if self.version == 1 else self.stage_dir(WIREFRAME) / 'figma/bundle.json'

    def figma_receipts(self):
        return self.root / 'figma-export.json' if self.version == 1 else self.stage_dir(WIREFRAME) / 'figma/receipts.json'

    def audit(self, name):
        return self.root / 'evidence' / name

    def handoff(self):
        return self.root / 'handoff.md' if self.version == 1 else self.root / 'handoffs/handoff.md'

    def input_dir(self):
        return self.root if self.version == 1 else self.root / '00-input'

    def index(self):
        return self.root / 'INDEX.md'

    def relative(self, path):
        """How a path is stored inside an artifact: case-relative when it is in the case."""
        path = Path(path).resolve()
        try:
            return path.relative_to(self.root).as_posix()
        except ValueError:
            return str(path)

    def resolve(self, stored):
        """The file a stored path names. Older artifacts stored absolute paths; both are read."""
        if not stored:
            return None
        path = Path(stored)
        return (path if path.is_absolute() else self.root / path).resolve()
