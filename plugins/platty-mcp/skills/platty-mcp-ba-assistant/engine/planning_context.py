#!/usr/bin/env python3
"""Validate and render planning-context records. Does not perform LLM or MCP calls."""
import argparse
import difflib
from legacy import interview1 as _legacy
from datetime import datetime
import hashlib
import html
import json
from pathlib import Path
import re
import sys

AREA_LABELS = {'problem':'문제와 현재 업무', 'business_goal':'비즈니스 목적', 'users':'사용자와 목표',
               'solution':'해결책의 의도', 'scope':'범위', 'service_context':'기존 서비스와 관계',
               'rules':'업무 규칙과 제약', 'success':'성공 판단'}
REVIEW_LABELS = {'alignment':'목적과 해결책 연결','conflicts':'충돌 해소','grounding':'근거 적절성','handoff':'인계 가능성'}
BASELINE_KEYS = ('purpose','actors','journeys','concepts','rules','integrations','evidence')
CRITERIA = ('C1','C2','C3','C4','C5','C6','C7')
EXAMPLES = tuple(f'E{number:02}' for number in range(1,15))
TEMPLATE = Path(__file__).resolve().parents[1] / 'schemas/planning-context.template.json'
ASSESSMENT = {'verdict':('pending','suitable','needs_work','insufficient_evidence','not_applicable'),
              'rationale':str,'criteria':[str],'example_ids':[str],'evidence_ids':[str],
              'issue_ids':[str],'content_hash':str}
AREA = {'status':('missing','partial','satisfied','conflict','not_applicable'),
        'summary':str,'claim_ids':[str],'assessment':ASSESSMENT}
class Optional:
    """A field that may be absent. Absent stays absent, so stored hashes do not move."""
    def __init__(self, shape):
        self.shape = shape


FOG = [{'note': str, 'why_not_ticket': str, 'revisit_after': [str]}]
# 「근거를 들어 기각했다」와 「일인지 아닌지 판정할 수 없다」는 다른 일인데 한 칸에 눌렸다.
# 4차가 비대칭을 실측했다 — job 없는 화면 요청은 1a 문턱에서 멈추고, 화면 없는 job은
# 파생으로 밀려 내려가 3단계에서 화면을 얻는다. 같은 종류의 결손인데 한쪽만 시작을 막았다.
# 판정 불가는 판정이 아니다: 아래로 흘려보내되 판정하지 않았다는 사실이 함께 간다.
OUT_OF_SCOPE = [{'note': str, 'reason': str, 'closed_issue_id': str,
                 'kind': Optional(('ruled_out', 'undecidable'))}]
RESOLUTION = {'answer': str, 'evidence_ids': [str], 'decision_id': str, 'turn_id': str}
MAP_FIELDS = {'fog': Optional(FOG), 'out_of_scope': Optional(OUT_OF_SCOPE)}
# 「이 티켓을 누구에게 보내야 하는지 모른다」·「이 세션에서 답받을 수 없는 사람이다」를 적을
# 칸이 `issues`에 없었다(1b `open_questions`에는 있다). 담당이 기계값이 아니면 하류는
# 「기획자가 아직 안 정한 것」과 「기획자가 정하면 안 되는 것」을 구별하지 못한다.
TICKET_FIELDS = {'blocked_by': Optional([str]), 'resolution': Optional(RESOLUTION),
                 'owner': Optional(str)}


SHAPE = {
    'schema_version':(3,), 'case_id':str, 'title':str,
    'status':('in_progress','awaiting_confirmation','waiting','paused','complete'),
    'sources':[{'id':str,'kind':('user','document','code'),'provider':('user','platty','web'),
                'reference':str,'excerpt':str,'project_id':str,'revision':str,'retrieved_at':str}],
    'claims':[{'id':str,'text':str,'kind':('fact','decision','assumption','unknown'),'source_ids':[str]}],
    'areas':{key:AREA for key in AREA_LABELS},
    'review':{key:ASSESSMENT for key in REVIEW_LABELS},
    'issues':[{'id':str,'question':str,'target':('planning_context','user_experience','external'),
               'blocking':bool,'reason':str,'areas':[str],
               'action':{'kind':('ask_user','platty','web','handoff','wait'),'prompt':str},
               **TICKET_FIELDS}],
    **MAP_FIELDS,
    'service_context':{'project_id':str,'status':('missing','ready','stale','unavailable'),
                       'checked_at':str,'baseline_revision':str,'observed_revision':str,
                       'baseline':{key:{'summary':str,'source_ids':[str]} for key in BASELINE_KEYS},
                       'coverage_limits':[str]},
    'confirmation':{'confirmed':bool,'turn_id':str,'statement':str,'content_hash':str,'review_hash':str},
    'history':[{'change':str,'reason':str}],
}


def final_consonant(text):
    """Does the last spoken Korean syllable end in a consonant? None when there is no Korean.

    Korean particles split on that, and a phrase routinely ends in a parenthetical note —
    「…한 사람 (참여 이력 0회)」 — so the syllable that decides is the last one actually read,
    inside the note. Latin or digits at the end mean the reading is unknown: say nothing rather
    than guess, which is worse than leaving the particle off.
    """
    for char in reversed((text or '').rstrip()):
        if '가' <= char <= '힣':
            return bool((ord(char) - 0xAC00) % 28)
        if char.isalnum():
            return None
    return None


def object_particle(text):
    """을 or 를. The error messages carry Korean; 「실패」을 reads as badly as 「사람가」."""
    final = final_consonant(text)
    return '' if final is None else ('을' if final else '를')


def closed(issue):
    """A ticket is closed once it carries the answer that resolved it."""
    return bool(issue.get('resolution'))


# 「기록되지 않은 검수 소견 — <본문>」에서 coverage_limits에 들어갈 것은 <본문>뿐인데, 메시지는
# 앞머리까지 함께 보여줬다. 4차의 일곱 건이 같은 자리에서 넘어졌다 — 통째로 붙여넣으면 소견이
# 닫히지 않고, 소견이 닫히지 않으니 같은 메시지가 다시 나오고, 그래서 또 붙여넣었다.
# 소견의 본문은 따옴표로 묶어 보여주고, 앞머리째 붙여넣은 기록도 닫힌 것으로 읽는다.
FINDING_PREFIX = '기록되지 않은 검수 소견 — '
FINDING_TAIL = '「」 안 문장만 그대로 넣는다'
FINDING_NOTE = re.compile(FINDING_PREFIX + '「(?P<text>.*)」 — ' + FINDING_TAIL + r'\s*$', re.S)


def finding_note(path, text):
    """The message for an unrecorded review finding, with the part to copy delimited."""
    return f'{path}: {FINDING_PREFIX}「{text}」 — {FINDING_TAIL}'


def recorded_finding(row):
    """Read a recorded limit, whether it is the finding or the whole message about it.

    앞머리를 알아보는 데서 멈춘다. 기록된 한계는 원래 「」로 시작하거나 안에 「」를 품는 문장이
    흔해서, 따옴표를 무조건 벗기면 멀쩡한 기록을 망가뜨린다 — 실제로 코퍼스의 두 줄이 그랬다.
    """
    found = FINDING_NOTE.search(row)
    return found.group('text') if found else row


def map_gaps(data, source_ids):
    """Validate the wayfinding fields every stage shares."""
    errors = []
    issues = {row['id']: row for row in data.get('issues', []) or []}
    for number, patch in enumerate(data.get('fog', []) or []):
        path = f'$.fog[{number}]'
        for key in ('note', 'why_not_ticket'):
            if not patch[key].strip():
                errors.append(f'{path}.{key}: nonempty text required')
        for name in patch['revisit_after']:
            if name not in issues:
                errors.append(f'{path}.revisit_after: unknown issue {name!r}')
    for number, row in enumerate(data.get('out_of_scope', []) or []):
        path = f'$.out_of_scope[{number}]'
        for key in ('note', 'reason'):
            if not row[key].strip():
                errors.append(f'{path}.{key}: nonempty text required')
        name = row['closed_issue_id']
        # 이 규칙이 `kind`를 보지 않았다. 나는 바로 위에 `undecidable`을 넣어 놓고 옆 규칙을
        # 안 봤고, **판정 불가는 정의상 티켓이 열려 있다**(법무 회신 대기). 5차에서 그 때문에
        # 기계로 따라갈 수 있던 연결이 산문으로 밀려났고, 그 산문이 1b로 복사돼 PRD에 오류
        # 문구가 실려 갔다. 근거를 들어 기각한 것만 닫힌 티켓을 요구한다.
        if (name and name in issues and not closed(issues[name])
                and row.get('kind') != 'undecidable'):
            errors.append(f'{path}.closed_issue_id: a ruled-out ticket must be closed, not open '
                          '— 아직 판정할 수 없는 것이면 kind: undecidable로 적는다')
    for number, issue in enumerate(data.get('issues', []) or []):
        path = f'$.issues[{number}]'
        for name in issue.get('blocked_by', []) or []:
            if name == issue['id']:
                errors.append(f'{path}.blocked_by: an issue cannot block itself')
            elif name not in issues:
                errors.append(f'{path}.blocked_by: unknown issue {name!r}')
        resolution = issue.get('resolution')
        if resolution is None:
            continue
        if not resolution['answer'].strip():
            errors.append(f'{path}.resolution.answer: 답이 없으면 resolution 키를 통째로 '
                          '빼서 열린 티켓으로 둔다. 빈 객체는 「닫혔는데 내용이 없다」는 뜻이다')
        # 닫은 것이 누구인지가 남아야 한다 — 기획자가 답했으면 그 턴, 파생이 스스로 판정했으면
        # 그 결정. 둘 다 비면 그 티켓은 아무것도 아닌 것 위에서 닫힌다. 실측 137건 중 4건이
        # 그 상태였고, 넷 다 「상위로 되묻지 못했다」처럼 실행기가 스스로 닫은 것이었다.
        if not (resolution['turn_id'].strip() or resolution['decision_id'].strip()):
            errors.append(f'{path}.resolution: 무엇이 이 티켓을 닫았는지가 비어 있다 — '
                          '기획자가 답한 turn_id이거나 파생이 내린 decision_id 중 하나는 있어야 한다')
        for name in resolution['evidence_ids']:
            if name not in source_ids:
                errors.append(f'{path}.resolution.evidence_ids: unknown source {name!r}')
    errors.extend(blocking_cycles(issues))
    return errors


def blocking_cycles(issues):
    """A cycle would leave every ticket in it permanently unreachable."""
    state, found = {}, []
    def walk(name, trail):
        if state.get(name) == 'done':
            return
        if state.get(name) == 'open':
            found.append('$.issues: blocking cycle ' + ' -> '.join(trail[trail.index(name):] + [name]))
            return
        state[name] = 'open'
        for other in issues[name].get('blocked_by', []) or []:
            if other in issues:
                walk(other, trail + [name])
        state[name] = 'done'
    for name in issues:
        walk(name, [])
    return sorted(set(found))


def check_shape(value, shape, path, errors):
    if isinstance(shape,dict):
        if not isinstance(value,dict):
            errors.append(f'{path}: object required')
            return
        for key in sorted(value.keys()-shape.keys()):
            near = difflib.get_close_matches(key, list(shape), n=1, cutoff=0.6)
            errors.append(f'{path}.{key}: unknown field'
                          + (f" — 「{near[0]}」를 쓰려던 것인가" if near else ''))
        for key,child in shape.items():
            if isinstance(child,Optional):
                if key in value:
                    check_shape(value[key],child.shape,f'{path}.{key}',errors)
            elif key not in value:
                errors.append(f'{path}.{key}: required field missing')
            else:
                check_shape(value[key],child,f'{path}.{key}',errors)
    elif isinstance(shape,list):
        if not isinstance(value,list):
            errors.append(f'{path}: array required')
            return
        for index,item in enumerate(value):
            check_shape(item,shape[0],f'{path}[{index}]',errors)
    elif isinstance(shape,tuple):
        if not any(type(value) is type(option) and value == option for option in shape):
            errors.append(f'{path}: expected one of {shape}')
    elif type(value) is not shape:
        errors.append(f'{path}: {shape.__name__} required')


UNKNOWN_FIELD = ': unknown field'


def _pruned(value, shape):
    """A copy with the keys this schema does not know taken out."""
    if isinstance(shape, dict) and isinstance(value, dict):
        out = {}
        for key, child in shape.items():
            if key not in value:
                continue
            out[key] = _pruned(value[key], child.shape if isinstance(child, Optional) else child)
        return out
    if isinstance(shape, list) and isinstance(value, list):
        return [_pruned(item, shape[0]) for item in value]
    return value


def shape_errors(data, shape, check=None):
    """Check the shape, and say whether the content checks can still read this document.

    4차의 한 실행기가 `issues[].resolved`를 넣었더니 오류가 **사라진 것처럼** 보였다.
    실제로는 그 낯선 낱말 하나가 구조 오류가 되어 내용 검사가 통째로 안 돈 것이다 —
    오류 목록을 문자열로 훑는 사람에게는 「고쳐졌다」와 구별되지 않는다. 3차 T-30이 보고서에
    `checks_not_run`을 적게 만들었지만, 보고서를 읽지 않으면 그대로다.

    모르는 칸 하나는 내용 검사를 막을 이유가 없다. 어떤 내용 검사도 그 칸을 읽지 않기 때문이다.
    그래서 모르는 칸만 문제인 문서는 그 칸을 덜어낸 사본으로 **끝까지 검사하고**, 모르는 칸은
    오류로 그대로 남는다. 구조가 진짜로 어긋난 문서는 예전처럼 거기서 멈춘다.
    """
    errors = []
    (check or check_shape)(data, shape, '$', errors)
    if not errors or any(UNKNOWN_FIELD not in row for row in errors):
        return errors, None
    return errors, _pruned(data, shape)


def fingerprints(data):
    if isinstance(data, dict) and type(data.get("schema_version")) is int and data["schema_version"] == 2:
        return _legacy.fingerprints(data)
    def digest(value):
        canonical=json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))
        return hashlib.sha256(canonical.encode('utf-8')).hexdigest()
    payload={key:data[key] for key in ('schema_version','case_id','title','sources','claims','issues','service_context')}
    # Only a used scope ruling joins the hash, so artifacts written before it keep their approval.
    if data.get('out_of_scope'):
        payload['out_of_scope']=data['out_of_scope']
    payload['areas']={key:{'summary':area['summary'],'claim_ids':area['claim_ids']}
                      for key,area in data['areas'].items()}
    content=digest(payload)
    review=digest({'content_hash':content,
                   'areas':{key:area['assessment'] for key,area in data['areas'].items()},'review':data['review']})
    return content,review


def invalid_report(errors):
    """Shape is wrong, so nothing below it ran — and that silence used to read as a pass.

    A run reported that inventory and review findings went quiet whenever one field was
    malformed, which looks exactly like a document with no findings. The report says so now.
    """
    return {'valid':False,'baseline_ready':False,'ready_for_confirmation':False,'complete':False,'errors':errors,
            'completion_errors':[],'content_hash':'','review_hash':'','next_actions':[],
            'checks_not_run': '구조 오류 때문에 내용 검사는 하나도 돌지 않았다 — '
                              '아래가 비어 있는 것은 문제가 없다는 뜻이 아니다'}


def validate(data):
    if isinstance(data, dict) and type(data.get("schema_version")) is int and data["schema_version"] == 2:
        return _legacy.validate(data)
    errors,readiness=[],[]
    # 모르는 칸 하나가 내용 검사를 통째로 끄던 자리다 — 덜어낸 사본으로 끝까지 검사하고
    # 그 칸은 오류로 남는다.
    errors, pruned = shape_errors(data, SHAPE)
    if errors and pruned is None:
        if isinstance(data,dict) and data.get('schema_version') == 1:
            errors.insert(0,'$.schema_version: v1 unsupported; preserve original and re-evaluate using v3')
        return invalid_report(errors)
    data = pruned if pruned is not None else data
    content_hash,review_hash=fingerprints(data)

    def require(condition,path,message,destination=errors):
        if not condition:
            destination.append(f'{path}: {message}')

    def nonblank(value,path,destination=errors):
        require(bool(value.strip()),path,'nonempty text required',destination)

    def refs(ids,lookup,path):
        require(len(ids)==len(set(ids)),path,'duplicate references')
        for key in ids:
            require(key in lookup,path,f'unknown reference {key!r}')

    def timestamp(value,path):
        try:
            valid=datetime.fromisoformat(value.replace('Z','+00:00')).utcoffset() is not None
        except ValueError:
            valid=False
        require(valid,path,'ISO 8601 timestamp with timezone required')

    # Owed before confirmation, not before the first question — see jtbd.validate.
    nonblank(data['title'],'$.title',readiness)
    require(bool(re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*',data['case_id'])),'$.case_id',
            'lowercase letters, numbers, and hyphens required')
    indexes={}
    for collection in ('sources','claims','issues'):
        index={}
        for number,item in enumerate(data[collection]):
            path=f'$.{collection}[{number}]'
            nonblank(item['id'],path+'.id')
            require(item['id'] not in index,path+'.id','duplicate id')
            index[item['id']]=item
            for key in {'sources':('reference','excerpt'),'claims':('text',),'issues':('question','reason')}[collection]:
                nonblank(item[key],path+'.'+key)
        indexes[collection]=index
    sources,claims,issues=(indexes[key] for key in ('sources','claims','issues'))
    for number,source in enumerate(data['sources']):
        path=f'$.sources[{number}]'
        require((source['provider']=='user')==(source['kind']=='user'),path,'user kind/provider must agree')
        require(source['provider']!='web' or source['kind']=='document',path,'web sources must be documents')
        timestamp(source['retrieved_at'],path+'.retrieved_at')
        if source['provider']=='platty':
            nonblank(source['project_id'],path+'.project_id')
            nonblank(source['revision'],path+'.revision')
        else:
            require(source['project_id']=='',path+'.project_id',
                    "only Platty sources carry a project_id; leave it as '' here")
    errors.extend(map_gaps(data,set(sources)))
    for number,claim in enumerate(data['claims']):
        refs(claim['source_ids'],sources,f'$.claims[{number}].source_ids')
    for number,issue in enumerate(data['issues']):
        path=f'$.issues[{number}]'
        refs(issue['areas'],AREA_LABELS,path+'.areas')
        require(bool(issue['areas']),path+'.areas','affected areas required')
        nonblank(issue['action']['prompt'],path+'.action.prompt')
        handoff=issue['action']['kind']=='handoff'
        require(handoff==(issue['target']=='user_experience'),path,'handoff must target user_experience')
        require(not handoff or not issue['blocking'],path,'blocking issues cannot be handed off')
        if not closed(issue) and (issue['blocking'] or issue['target']=='planning_context'):
            readiness.append(path+': unresolved planning context or blocking issue')
    if data['status']=='waiting':
        require(any(issue['blocking'] and issue['target']=='external'
                    and issue['action']['kind'] in ('wait','handoff') for issue in data['issues']),
                '$.status','waiting requires a blocking external dependency with resume action')
        require(not any(issue['action']['kind'] in ('ask_user','platty','web')
                        or issue['target'] in ('planning_context','user_experience')
                        for issue in data['issues']),
                '$.status','waiting cannot mask executable internal work or upstream return')
    context=data['service_context']
    context_gap_start = len(readiness)
    require(context['status']=='ready','$.service_context.status','baseline not ready',readiness)
    for key in ('project_id','baseline_revision','observed_revision','checked_at'):
        nonblank(context[key],'$.service_context.'+key,readiness)
    if context['checked_at']:
        timestamp(context['checked_at'],'$.service_context.checked_at')
    require(context['baseline_revision']==context['observed_revision'],'$.service_context',
            'baseline_revision differs from observed_revision; refresh required',readiness)
    for key,entry in context['baseline'].items():
        path='$.service_context.baseline.'+key
        nonblank(entry['summary'],path+'.summary',readiness)
        refs(entry['source_ids'],sources,path+'.source_ids')
        require(bool(entry['source_ids']),path+'.source_ids','Platty evidence required',readiness)
        for sid in entry['source_ids']:
            source=sources.get(sid,{})
            require(source.get('provider')=='platty' and source.get('project_id')==context['project_id'],
                    path,'baseline source must be Platty evidence for selected project',readiness)
    for number,limit in enumerate(context['coverage_limits']):
        nonblank(limit,f'$.service_context.coverage_limits[{number}]')

    baseline_ready = not errors and len(readiness) == context_gap_start

    def check_assessment(assessment,path,allow_na=False):
        verdict=assessment['verdict']
        refs(assessment['criteria'],CRITERIA,path+'.criteria')
        refs(assessment['example_ids'],EXAMPLES,path+'.example_ids')
        refs(assessment['evidence_ids'],sources,path+'.evidence_ids')
        refs(assessment['issue_ids'],issues,path+'.issue_ids')
        if verdict!='pending':
            nonblank(assessment['rationale'],path+'.rationale')
            require(bool(assessment['criteria']),path+'.criteria','criteria required')
            require(bool(assessment['example_ids']),path+'.example_ids','comparison examples required')
            require(bool(re.fullmatch(r'[a-f0-9]{64}',assessment['content_hash'])),path+'.content_hash',
                    'SHA-256 content hash required')
            require(assessment['content_hash']==content_hash,path+'.content_hash',
                    'stale assessment; re-evaluate current content',readiness)
        passing=verdict=='suitable' or (allow_na and verdict=='not_applicable')
        require(passing,path+'.verdict','qualitative review not suitable',readiness)
        if verdict in ('suitable','not_applicable'):
            require(bool(assessment['evidence_ids']),path+'.evidence_ids','reviewed evidence required')
            open_ids=[name for name in assessment['issue_ids'] if not closed(issues.get(name,{}))]
            require(not open_ids,path+'.issue_ids',
                    'passing assessment retains unresolved issues: '+', '.join(open_ids))
        elif verdict in ('needs_work','insufficient_evidence'):
            require(bool(assessment['issue_ids']),path+'.issue_ids','unresolved issue and next action required')

    for key,area in data['areas'].items():
        path='$.areas.'+key
        refs(area['claim_ids'],claims,path+'.claim_ids')
        allow_na=key=='rules' and area['status']=='not_applicable'
        require(area['status']=='satisfied' or allow_na,path+'.status',
                'mandatory area not satisfied (only rules permits not_applicable)',readiness)
        check_assessment(area['assessment'],path+'.assessment',allow_na)
        if key == 'success':
            require(
                'C7' in area['assessment']['criteria'],
                path + '.assessment.criteria',
                'C7 primary outcome verification review required',
                readiness,
            )
        if area['status']=='satisfied':
            require(area['assessment']['verdict']=='suitable',path,'satisfied requires suitable assessment')
        elif area['status']=='not_applicable':
            require(key=='rules' and area['assessment']['verdict']=='not_applicable',path,
                    'only rules with not_applicable assessment may be excluded')
        else:
            require(area['assessment']['verdict'] not in ('suitable','not_applicable'),path,
                    'incomplete area cannot retain passing assessment')
        if allow_na:
            continue
        nonblank(area['summary'],path+'.summary',readiness)
        require(bool(area['claim_ids']),path+'.claim_ids','supporting claims required',readiness)
        for cid in area['claim_ids']:
            claim=claims.get(cid)
            if not claim:
                continue
            require(claim['kind'] in ('fact','decision'),path,f'{cid} is assumption/unknown',readiness)
            require(bool(claim['source_ids']),path,f'{cid} has no source',readiness)
            if claim['kind']=='decision':
                require(any(sources.get(sid,{}).get('provider')=='user' for sid in claim['source_ids']),
                        path,f'{cid} requires user decision evidence',readiness)
            if area['assessment']['verdict']=='suitable':
                require(set(claim['source_ids']).issubset(area['assessment']['evidence_ids']),path,
                        f'{cid} sources absent from assessment evidence',readiness)
        if key=='service_context':
            require(any(claims.get(cid,{}).get('kind')=='fact' and any(
                sources.get(sid,{}).get('provider')=='platty' and
                sources.get(sid,{}).get('project_id')==context['project_id']
                for sid in claims.get(cid,{}).get('source_ids',[])) for cid in area['claim_ids']),
                path,'direct Platty fact required',readiness)
    for key,assessment in data['review'].items():
        check_assessment(assessment,'$.review.'+key)
    for number,entry in enumerate(data['history']):
        for key in ('change','reason'):
            nonblank(entry[key],f'$.history[{number}].{key}')
    ready=not errors and not readiness
    completion=list(readiness)
    confirmation=data['confirmation']
    require(confirmation['confirmed'],'$.confirmation','user confirmation missing',completion)
    if confirmation['confirmed']:
        nonblank(confirmation['turn_id'],'$.confirmation.turn_id',completion)
        nonblank(confirmation['statement'],'$.confirmation.statement',completion)
        require(confirmation['content_hash']==content_hash,'$.confirmation.content_hash',
                'confirmation does not cover current content',completion)
        require(confirmation['review_hash']==review_hash,'$.confirmation.review_hash',
                'confirmation does not cover current reviews',completion)
    require(data['status']=='complete','$.status','not complete',completion)
    complete=ready and not completion
    if data['status']=='complete' and not complete:
        errors.append('$.status: declared complete but completion requirements are unmet')
    return {'valid':not errors,'baseline_ready':baseline_ready,'ready_for_confirmation':ready,'complete':complete,'errors':errors,
            'completion_errors':completion,'content_hash':content_hash,'review_hash':review_hash,
            'next_actions':[{'id':issue['id'],'areas':issue['areas'],'action':issue['action']}
                            for issue in data['issues'] if not closed(issue)]}


def load_json(path):
    def pairs(items):
        result={}
        for key,value in items:
            if key in result:
                raise ValueError(f'duplicate JSON key: {key}')
            result[key]=value
        return result
    def reject_constant(value):
        raise ValueError(f'invalid JSON constant: {value}')
    return json.loads(path.read_text(encoding='utf-8'),object_pairs_hook=pairs,parse_constant=reject_constant)


def markdown(value):
    return re.sub(r'([\\`*_{}\[\]()#+.!|>~-])',r'\\\1',html.escape(value,quote=False))


def render(data,report=None):
    report = report or validate(data)
    if isinstance(data, dict) and type(data.get("schema_version")) is int and data["schema_version"] == 2:
        return _legacy.render(data, report)
    lines=[f"# 기획 맥락 — {markdown(data['title'] or '(제목 미정)')}",'',
           f"사례: {markdown(data['case_id'])} · 상태: {data['status']} · schema: 3",'',
           'JSON 원본에서 생성한 읽기용 문서입니다. 수정은 원본에 반영하세요.','',
           '구조·버전 검증은 내용의 진실성이나 실제 조회·확인 수행을 보증하지 않습니다.','']
    def assessment_lines(assessment):
        return [f"판정: {assessment['verdict']}",'',markdown(assessment['rationale']),'',
                '기준: '+', '.join(assessment['criteria']),'',
                '비교 예시: '+', '.join(assessment['example_ids']),'',
                '검토 근거: '+', '.join(map(markdown,assessment['evidence_ids'])),'',
                '연결 이슈: '+', '.join(map(markdown,assessment['issue_ids'])),'',
                '평가 대상 해시: '+assessment['content_hash'],'']
    context=data['service_context']
    lines+=['## 서비스 기본 맥락','',f"프로젝트: {markdown(context['project_id'])}",'',
            f"상태: {context['status']} · 확인 시각: {markdown(context['checked_at'])}",'',
            '기준 버전: '+markdown(context['baseline_revision']),'',
            '관찰 버전: '+markdown(context['observed_revision']),'']
    for key,entry in context['baseline'].items():
        lines += [f'### {key}','',markdown(entry['summary']) or '(미작성)','',
                  '출처: '+', '.join(map(markdown,entry['source_ids'])),'']
    lines += ['조회 한계: '+'; '.join(map(markdown,context['coverage_limits'])),'']
    for key,area in data['areas'].items():
        lines += [f'## {AREA_LABELS[key]} ({key})','',f"상태: {area['status']}",'',
                  markdown(area['summary']) or '(미작성)','',
                  '근거 claim: '+', '.join(map(markdown,area['claim_ids'])),'']
        lines += assessment_lines(area['assessment'])
    lines += ['## 정보와 출처','']
    for claim in data['claims']:
        lines += [f"### {markdown(claim['id'])} ({claim['kind']})",'',markdown(claim['text']),'',
                  '출처 ID: '+', '.join(map(markdown,claim['source_ids'])),'']
    for source in data['sources']:
        lines += [f"### {markdown(source['id'])} ({source['provider']}/{source['kind']})",'',
                  markdown(source['reference']),'',markdown(source['excerpt']),'',
                  '프로젝트: '+markdown(source['project_id']),'',
                  '근거 버전: '+markdown(source['revision']),'',
                  '조회 시각: '+markdown(source['retrieved_at']),'']
    lines += ['## 남은 질문과 다음 행동','']
    for issue in data['issues']:
        lines += [f"### {markdown(issue['id'])}",'',markdown(issue['question']),'',
                  f"대상: {issue['target']} · 차단: {issue['blocking']}",'',
                  '영역: '+', '.join(issue['areas']),'',markdown(issue['reason']),'',
                  f"다음 행동: {issue['action']['kind']}",'',markdown(issue['action']['prompt']),'']
    lines += ['## 종합 정성 검토','']
    for key,assessment in data['review'].items():
        lines += [f'### {REVIEW_LABELS[key]}','']+assessment_lines(assessment)
    confirmation=data['confirmation']
    lines += ['## 사용자 최종 확인','',f"확인: {confirmation['confirmed']}",'',
              '턴: '+markdown(confirmation['turn_id']),'',markdown(confirmation['statement']),'',
              '내용 해시: '+confirmation['content_hash'],'','검토 해시: '+confirmation['review_hash'],'',
              '## 자동 검증 결과','',
              f"구조 유효: {report['valid']} · 확인 준비: {report['ready_for_confirmation']} · 완료: {report['complete']}",'']
    lines += ['- '+markdown(error) for error in report['errors']+report['completion_errors']]
    lines += ['','## 결정 변경 이력','']
    for entry in data['history']:
        lines += ['- '+markdown(entry['change'])+' — '+markdown(entry['reason'])]
    return '\n'.join(lines)+'\n'


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    commands=parser.add_subparsers(dest='command',required=True)
    for command in ('init','validate','render','fingerprint'):
        sub=commands.add_parser(command)
        sub.add_argument('path',type=Path)
        if command=='validate':
            gate=sub.add_mutually_exclusive_group()
            gate.add_argument('--require-complete',action='store_true')
            gate.add_argument('--require-ready',action='store_true')
        if command=='render':
            sub.add_argument('-o','--output',type=Path)
    args=parser.parse_args()
    try:
        if args.command=='init':
            data=load_json(TEMPLATE)
            data['case_id']=re.sub(r'[^a-z0-9]+','-',args.path.parent.name.lower()).strip('-') or 'untitled'
            args.path.parent.mkdir(parents=True,exist_ok=True)
            with args.path.open('x',encoding='utf-8') as out:
                json.dump(data,out,ensure_ascii=False,indent=2)
                out.write('\n')
            print(str(args.path))
            return 0
        data=load_json(args.path)
        if args.command=='fingerprint':
            errors=[]
            check_shape(data,SHAPE,'$',errors)
            if errors:
                print(json.dumps(invalid_report(errors),ensure_ascii=False,indent=2))
                return 1
            content,review=fingerprints(data)
            print(json.dumps({'content_hash':content,'review_hash':review},indent=2))
            return 0
        report=validate(data)
        if args.command=='validate':
            print(json.dumps(report,ensure_ascii=False,indent=2))
            return 0 if report['valid'] and (not args.require_complete or report['complete']) and (
                not args.require_ready or report['ready_for_confirmation']) else 1
        if not report['valid']:
            print(json.dumps(report,ensure_ascii=False,indent=2),file=sys.stderr)
            return 1
        content=render(data,report)
        if args.output:
            if args.output.resolve()==args.path.resolve() or (args.output.exists() and args.output.samefile(args.path)):
                raise ValueError('render output must differ from JSON input')
            args.output.write_text(content,encoding='utf-8')
        else:
            print(content,end='')
        return 0
    except (OSError,UnicodeError,ValueError,RecursionError) as exc:
        print(json.dumps(invalid_report([str(exc)]),ensure_ascii=False,indent=2),
              file=sys.stdout if args.command in ('validate','fingerprint') else sys.stderr)
        return 1


if __name__=='__main__':
    sys.exit(main())
