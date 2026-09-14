"""Re-carry and re-stamp a case chain after a fix to a machine-copied field.

`carry_from_jtbd` used to glue 「가」 to every subject. Fixing it changes `carried`, which is
by definition not a place a human edits — so the copy is re-run and every downstream binding
and confirmation is recomputed from it. Nothing here supplies an approval that was not already
given; the statements and turn ids are the planner's own and are left alone.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, 'scripts')
import jtbd, prd, screen_behavior, user_experience  # noqa: E402


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write(path, data, module):
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    Path(str(path).replace('.json', '.md')).write_text(module.render(data), encoding='utf-8')


def restamp(data, module):
    """Re-point every recorded assessment and the confirmation at the content that is here.

    Stages 2 and 3 stamp each scenario, view requirement and path review with the hash it was
    judged against, so the whole set has to move together.
    """
    content, _ = module.fingerprints(data)
    rows = (list(data.get('path_reviews', []))
            + [row['assessment'] for row in data.get('scenarios', []) if 'assessment' in row]
            + [row['assessment'] for row in data.get('view_requirements', [])
               if 'assessment' in row]
            + list(data.get('reviews', []))
            + list(data['review'].values()))
    for row in rows:
        row['content_hash'] = content
    content, review = module.fingerprints(data)
    for row in rows:
        row['content_hash'] = content
    content, review = module.fingerprints(data)
    data['confirmation'].update(content_hash=content, review_hash=review)
    if 'input_hash' in data['confirmation']:
        report = module.validate(data)
        data['confirmation'].update(input_hash=report.get('input_hash', ''),
                                    knowledge_hash=report.get('knowledge_hash', ''))
    return module.validate(data)


def main(case):
    case = Path(case)
    job = read(case / 'jtbd.json')
    one = read(case / 'prd.json')
    fresh = prd.carry_from_jtbd(job)
    if one['carried'] == fresh:
        print(f'{case.name}: carried already current')
        return
    one['carried'] = {**fresh, 'hypotheses': one['carried']['hypotheses']}
    report = restamp(one, prd)
    print(f'{case.name}  prd complete={report["complete"]} {report["errors"][:1]}')
    write(case / 'prd.json', one, prd)

    two_path = case / 'user-experience.json'
    if not two_path.exists():
        return
    two = read(two_path)
    content, review = prd.fingerprints(one)
    two['input_binding'].update(content_hash=content, review_hash=review)
    report = restamp(two, user_experience)
    print(f'{case.name}  ux  complete={report["complete"]} {report["errors"][:1]}')
    write(two_path, two, user_experience)

    three_path = case / 'screen-behavior.json'
    if not three_path.exists():
        return
    three = read(three_path)
    three['input_binding']['prd'].update(content_hash=content, review_hash=review)
    c2, r2 = user_experience.fingerprints(two)
    three['input_binding']['user_experience'].update(content_hash=c2, review_hash=r2)
    report = restamp(three, screen_behavior)
    print(f'{case.name}  sb  complete={report["complete"]} '
          f'{report["errors"][:1]} {report["completion_errors"][:1]}')
    write(three_path, three, screen_behavior)


for path in sys.argv[1:]:
    main(path)
