#!/usr/bin/env python3
"""Per-stage numbers for a completed case, so thresholds can be argued from more than one.

The hardening plan's rule: **1건으로 정한 임계값은 그 1건을 외운 것이다.** This script exists
to make the comparison cheap enough that it actually happens.

Every measure is read from the artifact or computed by the same function the validator uses.
Nothing is recomputed independently here — a measure that can drift from its gate is worse
than no measure, because it reads like corroboration.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

ARTIFACTS = (('jtbd', 'jtbd.json'), ('prd', 'prd.json'),
             ('user_experience', 'user-experience.json'),
             ('screen_behavior', 'screen-behavior.json'),
             ('design_system_wireframe', 'design-system-wireframe.json'))


def ratio(numerator, denominator):
    """Kept alongside its terms; a bare percentage hides how few things it counted."""
    return {'n': numerator, 'of': denominator,
            'rate': round(numerator / denominator, 3) if denominator else None}


def verdicts(data):
    return dict(Counter(row['verdict'] for row in data.get('review', {}).values()))


def measure_jtbd(data):
    import jtbd
    spread = jtbd.coverage(data)
    structural, reported = jtbd.linkage_findings(data)
    rows = [row for cell in data['cells'].values() for row in cell['rows']]
    observed = [row for row in rows if row['grade'] == 'observed']
    return {
        'cells': spread['cells'],
        'grades': spread['grades'],
        'rows': spread['rows'],
        # 「관찰」이라 적었는데 출처를 아직 못 모은 행. 끝까지 안 모이면 그 행은 관찰이 아니다.
        'source_pending': ratio(spread['source_pending'], len(observed)),
        'pain_points': dict(Counter(row['decision'] for row in data['pain_points'])),
        'questions_asked': sum(row.get('probe_count', 0) for row in data['issues']),
        'open_issues': sum(1 for row in data['issues'] if row['action']['kind'] != 'handoff'),
        'rule_violations': {'structural': len(structural), 'reported': len(reported)},
        'coverage_limits': len(data['service_context']['coverage_limits']),
        'review': verdicts(data),
    }


def measure_prd(data):
    import prd
    carried = data['carried']
    return {
        'questions_asked': ratio(data['discovery']['questions_asked'], prd.DISCOVERY_BUDGET),
        'solution_directions': len(data['solution_directions']),
        'rules': len(data['rules']),
        'decisions': len(data['decisions']),
        'open_questions': dict(Counter(row['status'] for row in data['open_questions'])),
        # 상위가 표시한 한계는 여기서 사라지면 안 된다.
        'carried_limits': len(carried.get('coverage_limits', []) or []),
        'carried_hypotheses': len(carried.get('hypotheses', []) or []),
        'review': verdicts(data),
    }


def measure_user_experience(data):
    import user_experience
    upstream = user_experience.load_upstream(data)
    gaps = user_experience.upstream_coverage_gaps(data, upstream)
    rules = len((upstream or {}).get('rules', []))
    providers = Counter(row['provider'] for row in data['sources'])
    return {
        # 파생이 상위를 잃지 않았는가. 상위를 못 읽으면 분모가 0이고 rate는 null이다.
        'upstream_rules_reached': ratio(rules - len(gaps) if rules else 0, rules),
        'upstream_coverage_gaps': gaps,
        'sources_by_provider': dict(providers),
        'states': len(data['experience_states']),
        'transitions': len(data['experience_transitions']),
        'scenarios': len(data['scenarios']),
        'view_requirements': len(data['view_requirements']),
        'coverage_slots': len(data.get('coverage_checks', [])),
        'open_obligations': sum(1 for row in data['coverage_obligations']
                                if row.get('status') == 'open'),
        # 종료 상태에 출구가 없는 것 — 4단계 이미지 검수에서 승격된 소견
        'terminal_state_limits': len(user_experience.terminal_state_limits(data)),
        'review': verdicts(data),
    }


def measure_screen_behavior(data):
    import screen_behavior
    leaves = [row for row in data['inventory_links']
              if screen_behavior.LEAF_INPUT_REF.match(row['input_ref'])]
    mapped = [row for row in leaves if row['disposition'] == 'mapped']
    reach_gaps = screen_behavior.view_requirement_gaps(data)
    pack_rows = screen_behavior.pack_rows_cited(data)
    return {
        # 화면 요구가 실제로 요소에 닿았는가.
        'view_requirements_reached': ratio(len(mapped) - len(reach_gaps), len(mapped)),
        'inventory_dispositions': dict(Counter(row['disposition']
                                               for row in data['inventory_links'])),
        # 파생 케이스는 기획자 소유 결정이 0이어야 한다.
        'decision_ownership': dict(Counter(row['classification']
                                           for row in data['decision_inventory'])),
        'screens': len(data['screens']),
        'elements': len(data['elements']),
        'render_cases': len(data['render_cases']),
        'transitions': len(data['transitions']),
        'state_expression_gaps': len(screen_behavior.state_expression_gaps(data)),
        # 막다른 렌더 케이스 + 역할 상태 계약 미표현 — 4단계 이미지 검수에서 승격된 소견
        'review_findings': len(screen_behavior.review_finding_limits(data)),
        'pack_rows_cited': len(set(pack_rows)),
        'pack_limits_recorded': len(data['evidence_status']['coverage_limits']),
        'review': verdicts(data),
    }


MEASURES = {'jtbd': measure_jtbd, 'prd': measure_prd,
            'user_experience': measure_user_experience,
            'screen_behavior': measure_screen_behavior}


def measure(case):
    """Whatever stages this case reached. A stage that is absent is absent, not zero."""
    case = Path(case)
    result = {'case': case.name, 'stages': {}}
    for stage, name in ARTIFACTS:
        path = case / name
        if not path.exists() or stage not in MEASURES:
            continue
        data = json.loads(path.read_text(encoding='utf-8'))
        row = MEASURES[stage](data)
        row['status'] = data['status']
        result['stages'][stage] = row
    result['reached'] = list(result['stages'])
    return result


def compare(results):
    """Side by side, because a single case's number is not a threshold."""
    lines = []
    for stage in MEASURES:
        present = [row for row in results if stage in row['stages']]
        if not present:
            continue
        keys = []
        for row in present:
            for key in row['stages'][stage]:
                if key not in keys:
                    keys.append(key)
        lines += ['', f'## {stage}', '',
                  '| 측정 | ' + ' | '.join(row['case'] for row in present) + ' |',
                  '| --- |' + ' --- |' * len(present)]
        for key in keys:
            cells = []
            for row in present:
                value = row['stages'][stage].get(key)
                if isinstance(value, dict) and set(value) == {'n', 'of', 'rate'}:
                    cells.append(f"{value['n']}/{value['of']}" +
                                 (f" ({value['rate']:.0%})" if value['rate'] is not None else ''))
                elif isinstance(value, dict):
                    cells.append(', '.join(f'{k} {v}' for k, v in value.items()) or '—')
                elif isinstance(value, list):
                    cells.append(str(len(value)))
                else:
                    cells.append('—' if value is None else str(value))
            lines.append(f'| `{key}` | ' + ' | '.join(cells) + ' |')
    return '\n'.join(lines).lstrip('\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cases', nargs='+', type=Path)
    parser.add_argument('--write', action='store_true',
                        help='write measures.json into each case directory')
    parser.add_argument('--compare', action='store_true', help='markdown table across cases')
    args = parser.parse_args()
    try:
        results = [measure(case) for case in args.cases]
    except (OSError, UnicodeError, ValueError, KeyError) as exc:
        print(json.dumps({'error': str(exc)}, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1
    if args.write:
        for case, result in zip(args.cases, results):
            (Path(case) / 'measures.json').write_text(
                json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(compare(results) if args.compare
          else json.dumps(results if len(results) > 1 else results[0],
                          ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
