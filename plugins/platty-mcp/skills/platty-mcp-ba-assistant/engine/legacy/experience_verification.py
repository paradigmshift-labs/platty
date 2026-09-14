"""Evidence-backed outcome inventory and separate path-review readiness checks."""
import copy
import re


def example_citation_gaps(review, prefix):
    cited = set(re.findall(r'(?<![A-Za-z0-9])UX\d{2}(?!\d)', review['rationale']))
    missing = cited - set(review['example_ids'])
    return [prefix + ': cited comparison examples missing from example_ids: ' + ', '.join(sorted(missing))] if missing else []

CHECK_SHAPE={'transition_id':str,'dimension':str,'status':('open','applicable','not_applicable'),
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
