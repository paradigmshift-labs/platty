"""INDEX.md — the first file a person opens in a staged (layout 2) case.

It lists each stage's state and files, the latest wireframe runs, and the latest Figma export.
It is rewritten whenever the session or the export receipts change. Writing it must never
break the save that triggered it, so every failure is swallowed: a stale index is better than
a lost save.
"""

import json
from pathlib import Path

from case_layout import CaseLayout

STAGE_ORDER = ('jtbd', 'prd', 'user_experience', 'screen_behavior', 'design_system_wireframe')
STAGE_TITLES = {'jtbd': 'JTBD', 'prd': 'PRD', 'user_experience': '사용자 경험',
                'screen_behavior': '화면 동작 명세', 'design_system_wireframe': '디자인 시스템 와이어프레임'}


def _load(path):
    try:
        value = json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def write_index(folder, session=None):
    try:
        layout = (CaseLayout(folder, session.get('layout', 1)) if isinstance(session, dict)
                  else CaseLayout.of(folder))
        if layout.version < 2:
            return
        session = session if isinstance(session, dict) else (_load(layout.root / 'session.json') or {})
        layout.index().write_text(_render(layout, session), encoding='utf-8')
    except Exception:  # noqa: BLE001 — the index must never break the save that triggered it
        return


def _render(layout, session):
    link = lambda path: f'[{layout.relative(path)}]({layout.relative(path)})'  # noqa: E731
    stage = session.get('stage', '')
    lines = [f'# {layout.root.name}', '', f"현재 단계: **{STAGE_TITLES.get(stage, stage)}**", '',
             '| 단계 | 상태 | 산출물 | 문서 |', '|---|---|---|---|']
    for name in STAGE_ORDER:
        path = layout.artifact(name)
        if not path.exists():
            lines.append(f'| {STAGE_TITLES[name]} | 시작 전 | — | — |')
            continue
        stored = _load(path)
        if stored is None:
            state = '읽을 수 없음'
        else:
            confirmation = stored.get('confirmation') if isinstance(stored.get('confirmation'), dict) else {}
            state = '확정' if confirmation.get('confirmed') else str(stored.get('status', ''))
        render, review = layout.render(name), layout.review(name)
        doc = link(render) if render.exists() else '—'
        if review.exists():
            doc += f' · [검토 기록]({layout.relative(review)})'
        lines.append(f"| {STAGE_TITLES[name]} | {state} | {link(path)} | {doc} |")
    runs_root = layout.runs_root()
    runs = sorted((row for row in runs_root.glob('run-*') if row.is_dir()),
                  key=lambda row: row.stat().st_mtime) if runs_root.exists() else []
    if runs:
        lines += ['', '## 와이어프레임 실행', '']
        lines += [f"- {row.name}: {link(row / 'captures')}" for row in runs[-6:]]
    receipts = _load(layout.figma_receipts()) or {}
    exports = receipts.get('exports') if isinstance(receipts.get('exports'), list) else []
    exported = [row for row in exports if isinstance(row, dict) and row.get('status') == 'exported']
    if exported:
        lines += ['', '## Figma', '', f"- 최신: {exported[-1].get('canonical_url', '')} ({exported[-1].get('export_id', '')})"]
    lines += ['', '## 공통 기록', '', f"- 감사 기록: {link(layout.audit('trace.jsonl'))}",
              f'- 인계장: {link(layout.handoff())}', f'- 입력 원문: {link(layout.input_dir())}', '']
    return '\n'.join(lines)
