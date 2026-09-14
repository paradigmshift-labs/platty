"""Evidence-backed outcome inventory and separate path-review readiness checks."""
import copy
import re

from planning_context import closed


def example_citation_gaps(review, prefix):
    # 같은 파일 49행은 이미 `[A-Za-z0-9-]`로 고쳐져 있었는데 여기만 하이픈이 빠져 있었다.
    # 그래서 이슈 id `I-UX01`이 비교 예시 인용으로 읽혔고, **이 검증기 아래서는 `UX`로 시작하는
    # 이슈 id를 쓸 수 없었다.** 5차가 세 군데서 동시에 울려 진짜 인용 오류로 착각하게 만들었다.
    cited = set(re.findall(r'(?<![A-Za-z0-9-])UX\d{2}(?![0-9A-Za-z-])', review['rationale']))
    missing = cited - set(review['example_ids'])
    return [prefix + ': cited comparison examples missing from example_ids: ' + ', '.join(sorted(missing))] if missing else []

# deferred: 상위가 이 차원을 정하지 않아 판정할 수 없다. not_applicable(여기서 일어나지
# 않는다)과 다르며, 열린 역류가 그 칸을 이름 대야 쓸 수 있다.
CHECK_SHAPE={'transition_id':str,'dimension':str,
             'status':('open','applicable','not_applicable','deferred'),
             'rationale':str,'source_ids':[str],'obligation_ids':[str]}
PATH_REVIEW_SHAPE={'transition_id':str,'condition':str,'scenario_id':str,
                   'expected_end_state':str,'expected_experience':str,
                   'policy_claim_ids':[str],'policy_rationale':str,
                   'verdict':('pending','suitable','needs_work','insufficient_evidence'),
                   'rationale':str,'example_ids':[str],'source_ids':[str],
                   'issue_ids':[str],'content_hash':str}


def seed_checks(data, dimensions):
    existing={(r['transition_id'],r['dimension']):r for r in data.get('coverage_checks',[])}
    return [copy.deepcopy(existing.get((t['id'],dim),
            {'transition_id':t['id'],'dimension':dim,'status':'open','rationale':'',
             'source_ids':[],'obligation_ids':[]}))
            for t in data['experience_transitions'] for dim in dimensions]


def open_backflows(data):
    """Blocking issues that hand a judgment back upstream and wait for it."""
    return [row for row in data.get('issues', []) or []
            if row.get('blocking') and not closed(row)
            and (row.get('action') or {}).get('kind') == 'wait']


def names_transition(issue, transition_id):
    """Does this backflow name that transition, and not merely contain its id as a prefix?

    Stage 3 binds a deferred cell to its backflow by id. Stage 2 has no `issue_ids` field, so it
    matches the text — and a plain `in` let a backflow about `TR-12` answer for `TR-1`, which a
    fresh run caught: one backflow quietly carried two cells it had nothing to do with.
    """
    text = (issue.get('question') or '') + ' ' + (issue.get('reason') or '')
    return re.search(rf'(?<![A-Za-z0-9-]){re.escape(transition_id)}(?![A-Za-z0-9-])', text) is not None


UPSTREAM_RULING = ('open_questions[', 'decisions[')


def settled_upstream(data, source_ids):
    """Do these sources name an upstream question or decision — the thing being deferred to?

    Any derived row cites sources, so accepting `source_ids` at all would make the verdict a
    softer `not_applicable` again. It has to be the ruling itself: `prd.json#open_questions[O-02]`
    or `prd.json#decisions[D-04]`, which is how every recorded case already writes them.
    """
    index = {row['id']: row for row in data.get('sources', [])}
    return [name for name in source_ids
            if any(mark in (index.get(name, {}).get('reference') or '') for mark in UPSTREAM_RULING)]


def deferred_coverage_gaps(data):
    """A deferred slot has to name why it cannot be judged.

    Without that it is only a softer `not_applicable`, which is the thing this verdict exists
    to stop: ten QA runs put upstream silence into `not_applicable`, where the next reader
    takes it to mean considered and irrelevant.

    Two reasons count, and the rule first accepted only the first:

    1. the upstream has not said — an open blocking backflow naming this transition;
    2. the upstream decided not to, this time — the question or decision it defers to, cited.

    Re-running the ten cases showed why the second is needed. One case's slot was already
    answered upstream (`O-02`, ruled by `D-04`, approved by the planner), and the executor had
    to raise a backflow for a settled question and close it in the same breath. Another asked
    the planner and got 「정한 바가 없어요」 — there was nothing to wait for. A backflow is the
    channel for what nobody knows, not a toll on what is already known.
    """
    waiting = open_backflows(data)
    gaps = []
    for row in data.get('coverage_checks', []):
        if row.get('status') != 'deferred':
            continue
        key = f"{row['transition_id']}:{row['dimension']}"
        if row.get('obligation_ids'):
            gaps.append(f'inventory {key}: 미룬 칸은 이행 의무를 갖지 않는다')
        named = [issue['id'] for issue in waiting if names_transition(issue, row['transition_id'])]
        if not named and not settled_upstream(data, row.get('source_ids') or []):
            gaps.append(f'inventory {key}: 왜 판정할 수 없는지를 이름 대지 않았다 — 이 전이를 '
                        '가리키는 열린 역류(상위가 말하지 않았다)나, 미루기로 한 근거인 상위 '
                        'open_questions·decisions를 가리키는 출처 중 하나가 있어야 한다')
    return gaps


def verification_gaps(data, dimensions, content_hash):
    gaps=[]
    transitions={r['id']:r for r in data['experience_transitions']}
    sources={r['id'] for r in data['sources']}
    obligations={r['id']:r for r in data['coverage_obligations']}
    claims={r['id']:r for r in data['claims']}
    scenarios={r['id']:r for r in data['scenarios']}
    states={r['id'] for r in data['experience_states']}
    issues={r['id'] for r in data['issues']}
    seen=set()
    for row in data['coverage_checks']:
        key=(row['transition_id'],row['dimension'])
        prefix=f'inventory {key}'
        if key in seen or key[0] not in transitions or key[1] not in dimensions:
            gaps.append(prefix+': duplicate or unknown review slot')
        seen.add(key)
        if row['status']=='open':gaps.append(prefix+': applicability not reviewed')
        elif not row['rationale'].strip() or not row['source_ids']:
            gaps.append(prefix+': applicability requires rationale and evidence')
        if any(s not in sources for s in row['source_ids']):gaps.append(prefix+': unknown evidence')
        if row['status']=='applicable':
            if not row['obligation_ids']:gaps.append(prefix+': applicable outcome needs obligations')
            for oid in row['obligation_ids']:
                ob=obligations.get(oid)
                if not ob or (ob['transition_id'],ob['dimension']) != key:
                    gaps.append(prefix+': obligation does not cover this slot')
                elif ob['status'] not in ('covered', 'handoff'):
                    gaps.append(prefix+': applicable slot requires resolved applicable obligation')
                elif not set(ob['source_ids']).issubset(row['source_ids']):
                    gaps.append(prefix+': obligation cites evidence its slot does not carry')
        elif row['status']=='deferred':
            # `sources` used to be left out here, so `settled_upstream` always looked at an
            # empty list and the second reason could never be satisfied — the one the runbook
            # tells people to use. Seven of ten fresh cases hit it and four stopped there.
            gaps.extend(deferred_coverage_gaps(
                {'coverage_checks': [row], 'issues': data.get('issues', []),
                 'sources': data.get('sources', [])}))
        elif row['obligation_ids']:gaps.append(prefix+': only applicable slots reference obligations')
        if row['status'] == 'not_applicable' and any(
                (o['transition_id'], o['dimension']) == key and o['status'] != 'not_applicable'
                for o in obligations.values()):
            gaps.append(prefix+': excluded slot conflicts with an applicable obligation')
    for t in transitions:
        for dim in dimensions:
            if (t,dim) not in seen:gaps.append(f'inventory {(t,dim)}: missing outcome review')
    reviewed=set()
    for row in data['path_reviews']:
        tid=row['transition_id']; prefix=f'path review {tid}'
        gaps.extend(example_citation_gaps(row, prefix))
        reviewed.add(tid)
        if tid not in transitions:gaps.append(prefix+': unknown transition')
        if row['verdict']!='suitable':gaps.append(prefix+': not suitable')
        if row['content_hash']!=content_hash:gaps.append(prefix+': stale review')
        for key in ('condition','expected_experience','policy_rationale','rationale'):
            if not row[key].strip():gaps.append(prefix+f': {key} required')
        if not row['source_ids'] or any(s not in sources for s in row['source_ids']):gaps.append(prefix+': valid evidence required')
        if not row['example_ids'] or any(e not in {f'UX{i:02}' for i in range(1,14)} for e in row['example_ids']):gaps.append(prefix+': comparison example required')
        if any(i not in issues for i in row['issue_ids']):gaps.append(prefix+': unknown issue')
        if row['verdict']=='suitable' and row['issue_ids']:gaps.append(prefix+': passing review retains issues')
        if row['verdict'] in ('needs_work','insufficient_evidence') and not row['issue_ids']:gaps.append(prefix+': failed review needs actionable issue')
        if any(c not in claims for c in row['policy_claim_ids']):gaps.append(prefix+': unknown policy')
        required=set(transitions.get(tid,{}).get('rule_claim_ids',[]))
        if not required.issubset(row['policy_claim_ids']):gaps.append(prefix+': referenced policies not reviewed')
        scenario=scenarios.get(row['scenario_id'])
        path=[s['transition_id'] for s in scenario['steps']] if scenario else []
        if tid not in path:gaps.append(prefix+': reviewed scenario does not traverse transition')
        last=transitions.get(path[-1],{}) if path else {}
        if row['expected_end_state'] not in states or last.get('to_state')!=row['expected_end_state']:
            gaps.append(prefix+': expected end state differs from path')
    for tid in transitions:
        if tid not in reviewed:gaps.append(f'path review {tid}: missing separate review')
    if not transitions or not data['scenarios'] or not states:gaps.append('experience graph is empty')
    return gaps

POLICY_CHECK_SHAPE={'claim_id':str,'status':('open','reviewed'),'transition_ids':[str],
                    'excluded_transition_ids':[str],'rationale':str,'source_ids':[str]}


def policy_gaps(data):
    transitions={t['id'] for t in data['experience_transitions']}
    policies={c['id'] for c in data['claims'] if c['kind']=='decision'}
    sources={s['id'] for s in data['sources']}
    seen=set();gaps=[]
    paths=data.get('path_reviews',[])
    for row in data.get('policy_checks',[]):
        cid=row['claim_id'];prefix=f'policy applicability {cid}'
        if cid in seen or cid not in policies:gaps.append(prefix+': duplicate or unknown policy')
        seen.add(cid)
        included=set(row['transition_ids']);excluded=set(row['excluded_transition_ids'])
        if row['status']!='reviewed':gaps.append(prefix+': not reviewed')
        if included & excluded or included | excluded != transitions:gaps.append(prefix+': all transitions must be considered exactly once')
        if not row['rationale'].strip() or not row['source_ids'] or any(s not in sources for s in row['source_ids']):gaps.append(prefix+': applicability evidence required')
        for tid in included:
            if not any(p['transition_id']==tid and cid in p['policy_claim_ids'] for p in paths):gaps.append(prefix+f': no path review applies policy to {tid}')
    for cid in policies-seen:gaps.append(f'policy applicability {cid}: missing policy review')
    return gaps
