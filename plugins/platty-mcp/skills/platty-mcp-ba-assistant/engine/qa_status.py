#!/usr/bin/env python3
"""Read a QA run's real state off the disk, because thirty cases cannot be tracked by memory.

The ledger says what was launched. This says what actually exists. The difference is the
answer to 「누락 없나」, and it is the only form of that answer that cannot drift.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import jtbd, prd, screen_behavior, user_experience  # noqa: E402

STAGES = (('jtbd.json', jtbd, '1a'), ('prd.json', prd, '1b'),
          ('user-experience.json', user_experience, '2'), ('screen-behavior.json', screen_behavior, '3'))


def case_state(folder):
    """(per-stage marks, how far it got, whether the executor left a record)."""
    marks, reached = [], '—'
    for name, module, label in STAGES:
        path = folder / name
        if not path.exists():
            marks.append('—')
            continue
        try:
            report = module.validate(json.loads(path.read_text()))
        except (ValueError, KeyError, TypeError):
            marks.append('깨짐')
            continue
        marks.append('완료' if report['complete'] else ('유효' if report['valid'] else '무효'))
        reached = label
    record = next((name.name for name in folder.glob('RUN*.md')), '')
    return marks, reached, record


def main(run_dir):
    run = Path(run_dir)
    ledger = json.loads((run / '_ledger.json').read_text()) if (run / '_ledger.json').exists() else {}
    launched = {row['slug']: row for row in ledger.get('cases', [])}
    found = {f.name: f for f in sorted(run.iterdir())
             if f.is_dir() and not f.name.startswith('_')}
    lines = ['| 케이스 | 묶음 | 1a | 1b | 2 | 3 | 기록 |', '| --- | --- | --- | --- | --- | --- | --- |']
    done = missing = []
    done, missing, landed = [], [], 0
    for slug in sorted(set(launched) | set(found)):
        row = launched.get(slug, {})
        if slug not in found:
            missing.append(slug)
            lines.append(f"| **{slug}** | {row.get('group', '?')} | — | — | — | — | **실종** |")
            continue
        marks, reached, record = case_state(found[slug])
        landed += record != ''
        done.append((slug, reached))
        lines.append(f"| {slug} | {row.get('group', '?')} | " + ' | '.join(marks)
                     + f" | {record or '**없음**'} |")
    body = '\n'.join(lines)
    reached3 = sum(1 for _, r in done if r == '3')
    summary = (f'\n\n원장 {len(launched)}건 · 디스크 {len(found)}건 · **실종 {len(missing)}건**'
               f'\n기록(RUN*.md) {landed}건 · 3단계 도달 {reached3}건\n')
    if missing:
        summary += '\n실종: ' + ', '.join(missing) + '\n'
    print('# 4차 QA 현황 (파일에서 계산)\n\n' + body + summary)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'artifacts/qa-runs-4')
