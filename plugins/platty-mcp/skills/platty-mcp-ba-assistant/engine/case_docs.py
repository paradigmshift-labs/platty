"""The reading documents of a case, and what each of them needs to know about the others.

A stage document links forward and back: a journey step names the screen that shows it, a
screen's render case points at its wireframe capture, and the capture points back at the case.
Those links only exist once the other stage is complete, so when a stage completes (or a Figma
export is recorded) the documents of the other completed stages are written again.
"""

import importlib
import json
import os
import sys
from pathlib import Path

from case_layout import CaseLayout

UX, SB, WF = 'user_experience', 'screen_behavior', 'design_system_wireframe'
DOC_STAGES = (UX, SB, WF)
# Read for the ids a later stage cites in its prose; they get no restructured document.
UPSTREAM_STAGES = ('jtbd', 'prd')
SIMULATION_HEADING = '> 모의 실행 (simulation). 실제 서비스 조회 결과가 아닙니다.\n\n'


def _load(path):
    try:
        value = json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def _rows(value):
    return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []


class DocContext:
    """The case around the document being written. Standalone when there is no case folder."""

    def __init__(self, layout=None, artifacts=None, receipts=None):
        self.layout = layout
        self.artifacts = {stage: data for stage, data in (artifacts or {}).items() if isinstance(data, dict)}
        self.receipts = receipts if isinstance(receipts, dict) else {}

    @classmethod
    def load(cls, root, current=None):
        layout = CaseLayout.of(root)
        artifacts = {stage: _load(layout.artifact(stage)) for stage in UPSTREAM_STAGES + DOC_STAGES}
        artifacts.update(current or {})
        return cls(layout, artifacts, _load(layout.figma_receipts()))

    @classmethod
    def standalone(cls, stage, data):
        return cls(None, {stage: data})

    def get(self, stage):
        return self.artifacts.get(stage) or {}

    def complete(self, stage):
        return self.get(stage).get('status') == 'complete'

    def known_ids(self):
        """Ids defined anywhere in the case: only these are upstream codes, not prose."""
        if not hasattr(self, '_known_ids'):
            from doc_common import record_ids
            self._known_ids = record_ids(*self.artifacts.values())
        return self._known_ids

    # ---- where things are, relative to the document being written -------------------------
    def doc_href(self, from_stage, to_stage, anchor=''):
        """A link to another stage's document, only when that document is there to read."""
        fragment = f'#{anchor}' if anchor else ''
        if to_stage == from_stage:
            return fragment or None
        if self.layout is None or not self.complete(to_stage):
            return None
        target = os.path.relpath(self.layout.render(to_stage), self.layout.render(from_stage).parent)
        return Path(target).as_posix() + fragment

    @staticmethod
    def review_name(stage):
        """The review file sits beside the document in either layout, so its name is the link."""
        return CaseLayout(Path('.')).review(stage).name

    def file_href(self, from_stage, stored):
        """A case file (a capture) as the document sees it; None when the file is not there."""
        if self.layout is None or not stored:
            return None
        path = self.layout.resolve(stored)
        if path is None or not path.exists():
            return None
        return Path(os.path.relpath(path, self.layout.render(from_stage).parent)).as_posix()

    # ---- the user experience, seen from later stages ---------------------------------------
    def ux_transition(self, tid):
        return next((row for row in _rows(self.get(UX).get('experience_transitions')) if row.get('id') == tid), None)

    def view_item(self, ref):
        """`view:VR-X:action:0` → the words the user experience wrote for it."""
        parts = str(ref).split(':')
        if len(parts) != 4 or parts[0] != 'view':
            return None
        view = next((row for row in _rows(self.get(UX).get('view_requirements')) if row.get('id') == parts[1]), None)
        field = {'action': 'actions', 'information': 'information'}.get(parts[2])
        try:
            return view[field][int(parts[3])] if view and field else None
        except (IndexError, ValueError, TypeError):
            return None

    def screen_for_view(self, view_id):
        return next((row for row in _rows(self.get(SB).get('screens'))
                     if view_id in (row.get('view_requirement_refs') or [])), None)

    def journey_order(self, screens):
        """Screen ids in the order the user experience first reaches them, then the rest."""
        ux = self.get(UX)
        views = {row.get('touchpoint_id'): row.get('id') for row in _rows(ux.get('view_requirements'))}
        by_view = {ref: row['id'] for row in screens for ref in (row.get('view_requirement_refs') or [])}
        by_touchpoint = {ref: row['id'] for row in screens for ref in (row.get('touchpoint_refs') or [])}
        transitions = {row.get('id'): row for row in _rows(ux.get('experience_transitions'))}
        scenarios = sorted(_rows(ux.get('scenarios')), key=lambda row: row.get('kind') != 'happy')
        order = []
        for scenario in scenarios:
            for step in _rows(scenario.get('steps')):
                touchpoint = (transitions.get(step.get('transition_id')) or {}).get('touchpoint_id')
                sid = by_view.get(views.get(touchpoint)) or by_touchpoint.get(touchpoint)
                if sid and sid not in order:
                    order.append(sid)
        return order + [row['id'] for row in screens if row['id'] not in order]

    # ---- the wireframe, seen from the screen behavior ---------------------------------------
    def capture(self, case_id):
        """The capture that draws a render case, and the target it belongs to."""
        for target in _rows(self.get(WF).get('targets')):
            for capture in _rows(target.get('captures')):
                if capture.get('render_case_id') == case_id:
                    return target, capture
        return None, None

    def latest_export(self):
        exports = _rows(self.receipts.get('exports'))
        return next((row for row in reversed(exports) if row.get('status') == 'exported'), None)

    def figma_frame(self, case_id):
        export = self.latest_export()
        if not export or not export.get('canonical_url'):
            return None
        frame = next((row for row in _rows(export.get('frames'))
                      if row.get('render_case_id') == case_id and row.get('node_id')), None)
        return f"{export['canonical_url']}?node-id={frame['node_id'].replace(':', '-')}" if frame else None


def stage_module(stage):
    return importlib.import_module(stage)


def render_body(stage, data, report, context):
    module = stage_module(stage)
    return module.render(data, report, context=context) if stage in DOC_STAGES else module.render(data, report)


def render_review(stage, data, report, context):
    """The review file of a stage, or None for a stage (or an old schema) that has none."""
    if stage not in DOC_STAGES:
        return None
    return stage_module(stage).render_review(data, report, context=context)


def heading(root):
    session = _load(Path(root) / 'session.json') or {}
    return SIMULATION_HEADING if session.get('mode') == 'simulation' else ''


def refresh(root, skip=(), current=None):
    """Write again the documents of the other completed stages, so their links are current.

    `current` is the record a caller has just completed but not yet persisted; without it the
    other documents would still see it unfinished and leave out the links it now provides.
    Only documents that already exist are rewritten: a stage that has not completed has no
    document yet, and this must not give it one. The documents are derived from the records, so
    a failure here is reported, never raised — it must not undo the save that called it.
    """
    written, errors = [], []
    try:
        root = CaseLayout.root_of(root)
        context = DocContext.load(root, current)
    except Exception as exc:  # noqa: BLE001 — see the docstring
        return {'written': written, 'errors': [f'case: {exc}']}
    for stage in DOC_STAGES:
        path = context.layout.render(stage)
        data = context.artifacts.get(stage)
        if stage in skip or not data or not path.exists() or data.get('status') != 'complete':
            continue
        try:
            path.write_text(heading(root) + render_body(stage, data, None, context), encoding='utf-8')
            written.append(stage)
        except Exception as exc:  # noqa: BLE001 — see the docstring
            errors.append(f'{stage}: {exc!r}')
    if errors:
        print(json.dumps({'warning': 'stage documents not refreshed', 'errors': errors}, ensure_ascii=False),
              file=sys.stderr)
    return {'written': written, 'errors': errors}
