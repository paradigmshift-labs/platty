#!/usr/bin/env python3
"""Validate and render interview v2 records. Does not perform LLM or MCP calls."""
import argparse
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
TEMPLATE = Path(__file__).resolve().parents[2] / 'schemas/interview-1.template.json'
ASSESSMENT = {'verdict':('pending','suitable','needs_work','insufficient_evidence','not_applicable'),
              'rationale':str,'criteria':[str],'example_ids':[str],'evidence_ids':[str],
              'issue_ids':[str],'content_hash':str}
AREA = {'status':('missing','partial','satisfied','conflict','not_applicable'),
        'summary':str,'claim_ids':[str],'assessment':ASSESSMENT}
SHAPE = {
    'schema_version':(2,), 'case_id':str, 'title':str,
    'status':('in_progress','awaiting_confirmation','waiting','paused','complete'),
    'sources':[{'id':str,'kind':('user','document','code'),'provider':('user','platty','web'),
                'reference':str,'excerpt':str,'project_id':str,'revision':str,'retrieved_at':str}],
    'claims':[{'id':str,'text':str,'kind':('fact','decision','assumption','unknown'),'source_ids':[str]}],
    'areas':{key:AREA for key in AREA_LABELS},
    'review':{key:ASSESSMENT for key in REVIEW_LABELS},
    'issues':[{'id':str,'question':str,'target':('interview_1','interview_2','external'),
               'blocking':bool,'reason':str,'areas':[str],
               'action':{'kind':('ask_user','platty','web','handoff'),'prompt':str}}],
    'service_context':{'project_id':str,'status':('missing','ready','stale','unavailable'),
                       'checked_at':str,'baseline_revision':str,'observed_revision':str,
                       'baseline':{key:{'summary':str,'source_ids':[str]} for key in BASELINE_KEYS},
                       'coverage_limits':[str]},
    'confirmation':{'confirmed':bool,'turn_id':str,'statement':str,'content_hash':str,'review_hash':str},
    'history':[{'change':str,'reason':str}],
}


def check_shape(value, shape, path, errors):
    if isinstance(shape,dict):
        if not isinstance(value,dict):
            errors.append(f'{path}: object required')
            return
        for key in sorted(value.keys()-shape.keys()):
            errors.append(f'{path}.{key}: unknown field')
        for key,child in shape.items():
            if key not in value:
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


def fingerprints(data):
    def digest(value):
        canonical=json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))
        return hashlib.sha256(canonical.encode('utf-8')).hexdigest()
    payload={key:data[key] for key in ('schema_version','case_id','title','sources','claims','issues','service_context')}
    payload['areas']={key:{'summary':area['summary'],'claim_ids':area['claim_ids']}
                      for key,area in data['areas'].items()}
    content=digest(payload)
    review=digest({'content_hash':content,
                   'areas':{key:area['assessment'] for key,area in data['areas'].items()},'review':data['review']})
    return content,review


def invalid_report(errors):
    return {'valid':False,'baseline_ready':False,'ready_for_confirmation':False,'complete':False,'errors':errors,
            'completion_errors':[],'content_hash':'','review_hash':'','next_actions':[]}


def validate(data):
    errors,readiness=[],[]
    check_shape(data,SHAPE,'$',errors)
    if errors:
        if isinstance(data,dict) and data.get('schema_version') == 1:
            errors.insert(0,'$.schema_version: v1 unsupported; preserve original and re-evaluate using v2')
        return invalid_report(errors)
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

    nonblank(data['title'],'$.title')
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
            require(source['project_id']=='',path+'.project_id','only Platty has project_id')
    for number,claim in enumerate(data['claims']):
        refs(claim['source_ids'],sources,f'$.claims[{number}].source_ids')
    for number,issue in enumerate(data['issues']):
        path=f'$.issues[{number}]'
        refs(issue['areas'],AREA_LABELS,path+'.areas')
        require(bool(issue['areas']),path+'.areas','affected areas required')
        nonblank(issue['action']['prompt'],path+'.action.prompt')
        handoff=issue['action']['kind']=='handoff'
        require(handoff==(issue['target']=='interview_2'),path,'handoff must target interview_2')
        require(not handoff or not issue['blocking'],path,'blocking issues cannot be handed off')
        if issue['blocking'] or issue['target']=='interview_1':
            readiness.append(path+': unresolved interview 1 or blocking issue')
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
            require(not assessment['issue_ids'],path+'.issue_ids','passing assessment cannot retain issues')
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
                            for issue in data['issues']]}


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


def render(data,report):
    lines=[f"# 인터뷰 1 — {markdown(data['title'])}",'',
           f"사례: {markdown(data['case_id'])} · 상태: {data['status']} · schema: 2",'',
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
