#!/usr/bin/env python3
"""Validate and render JTBD records. Does not perform LLM or MCP calls."""
import argparse
from datetime import datetime
import hashlib
import html
import json
from pathlib import Path
import re
import sys

from planning_context import (MAP_FIELDS, TICKET_FIELDS, Optional, check_shape, closed,
                              invalid_report, load_json, map_gaps, markdown, shape_errors)

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / 'schemas/jtbd.template.json'
DIMENSIONS = ('function', 'social', 'emotion')
PHASES = ('adopt', 'use')
CELLS = tuple(f'{dimension}_{phase}' for dimension in DIMENSIONS for phase in PHASES)
CELL_LABELS = {'function_adopt': '기능 × 채택', 'function_use': '기능 × 사용',
               'social_adopt': '사회 × 채택', 'social_use': '사회 × 사용',
               'emotion_adopt': '감정 × 채택', 'emotion_use': '감정 × 사용'}
JOB_ELEMENTS = ('subject', 'situation', 'motivation', 'expected_outcome', 'success_criteria')
JOB_LABELS = {'subject': '주체', 'situation': '상황', 'motivation': '동기',
              'expected_outcome': '기대 결과', 'success_criteria': '성공 판정'}
# 기준은 여섯인데 슬롯이 넷이었다. J5(사건성)와 J6(해결 분리)는 **집이 없었고**, 검증기는
# 각 슬롯의 verdict가 pending이 아닌지만 본다. 서른 건 주행에서 따로 측정된 네 가지가
# 전부 이것으로 설명됐다 — 빈 격자가 오류 0건, 대표 발언 위의 job, 자기 숫자가 서로 맞지 않는
# 문서, 네 job을 하나로 합친 것. 넷 다 `valid: true`였다.
# 슬롯이 넷이고 기준이 여섯이라 J5(사건성)·J6(해결 분리)에 집이 없었다. `unjudged_criteria`가
# 그 사실을 알려 주기만 하고 요구하지는 못했고, 그 사이로 **PRD를 먼저 쓰고 역산한 문서**가
# 그대로 통과했다. 역산은 정확히 그 둘을 깬다 — PRD에는 사건이 없고(J5), PRD §4는 해결책이므로
# 거기서 뽑은 경험은 곧 해결책이다(J6). 여섯 기준에 여섯 슬롯을 준다.
REVIEW_LABELS = {'ten_year_test': '10년 전 테스트', 'persona_separation': '페르소나 혼입',
                 'evidence_grounding': '근거 적절성', 'handoff_readiness': '인계 가능성',
                 'event_grounding': '사건성', 'solution_separation': '해결 분리'}
CRITERIA = ('J1', 'J2', 'J3', 'J4', 'J5', 'J6')
# What each id actually asks. Reviewers cited these in every assessment and no table said
# what they meant, so the definitions live beside the list they are checked against.
# 비교 예시 — 기준 id와 1:1로 짝지어 있다(코퍼스 20건의 인용이 그렇게 쓰고 있었다).
# 아래는 기준을 설명하는 가상 사례이며 실제 히로인스 정책·기능 근거가 아니다.
EXAMPLE_DEFINITIONS = {
    'JB01': {'criterion': 'J1', 'topic': '10년 전 테스트',
              'unsuitable': '「앱에서 알림을 받고 리뷰를 쓴다」 — 앱과 알림을 빼면 남는 일이 없다.',
              'suitable': '「받은 상품에 대해 남에게 보여줄 만한 후기를 남긴다」 — 수단을 다 빼도 성립한다.',
              'edge': '수단이 job의 일부인 경우가 있다(예: 「모바일로만 가능한 현장 인증」). 그때는 왜 수단이 본질인지를 근거로 적는다.'},
    'JB02': {'criterion': 'J2', 'topic': '페르소나 분리',
              'unsuitable': '「20~30대 여성 사용자」 — 연령과 성별은 처한 자리가 아니다.',
              'suitable': '「체험단에 처음 선정돼 참고할 기준을 한 번도 본 적이 없는 사람」 — 속성이 아니라 지금 놓인 자리다.',
              'edge': '속성이 자리를 실제로 바꾸는 경우가 있다(예: 「사업자 등록이 없어 정산을 못 받는 사람」). 그때는 속성이 아니라 그 결과로 적는다.'},
    'JB03': {'criterion': 'J3', 'topic': '근거 등급',
              'unsuitable': 'CS 문의 한 건을 보고 「참여자 대부분이 겪는다」를 `observed`로 적었다.',
              'suitable': '같은 한 건을 `observed`(그 한 건) + `hypothesis`(규모)로 나누고, 규모 쪽에 확인 방법을 달았다.',
              'edge': '출처를 아직 못 구한 관찰은 `observed` + `source_pending`이다. 등급을 낮추는 것이 아니라 출처가 비었다고 적는 자리다.'},
    'JB04': {'criterion': 'J4', 'topic': '인계 가능성',
              'unsuitable': '페인포인트가 `open`인 채로 「다음 단계에서 판단」이라고 적혔다.',
              'suitable': '`address`/`rejected`/`deferred`로 판정하고 사유를 적었다. 미룬 것은 미뤘다고 적혀 하위가 기각과 구별한다.',
              'edge': '판정할 근거가 없으면 판정을 지어내지 말고 이슈로 남긴다. 다만 1a가 확정되려면 `open`이 남아 있으면 안 된다.'},
    'JB05': {'criterion': 'J5', 'topic': '사건성',
              'unsuitable': '「다들 마감을 자주 놓쳐요」 — 빈도 주장이고 일어난 일이 아니다.',
              'suitable': '「지난달 A 브랜드 건에서 참여자가 배송이 늦어 기한을 넘겼고 CS로 들어왔다」 — 한 번 일어난 일이다.',
              'edge': '빈도를 부인하는 말(「얼마나 자주인지는 세어본 적이 없다」)은 일반화가 아니라 한계다. 그대로 한계로 적는다.'},
    'JB06': {'criterion': 'J6', 'topic': '해결 분리',
              'unsuitable': '필요한 경험에 「푸시 알림을 보낸다」라고 적었다 — 채널이 답으로 박혔다.',
              'suitable': '「기한이 정해지는 순간 그 기한을 알 수 있어야 한다」 — 무엇이 있어야 하는지만 적혀 있고 수단은 열려 있다.',
              'edge': '지금 제품이 이미 그렇게 돼 있다는 **묘사**는 해결책 선행이 아니다. 「지금은 알림이 없다」는 현황이고, 「알림을 주면 된다」가 제안이다.'},
}

CRITERION_DEFINITIONS = {
    'J1': '10년 전 테스트 — 수단을 빼고 나면 10년 전에도 같은 일이 성립하는가',
    'J2': '페르소나 분리 — 주체가 연령·직업 같은 속성이 아니라 처한 자리로 적혔는가',
    'J3': '근거 등급 — 각 행의 관찰·추론·가설 등급이 실제로 가진 근거와 일치하는가',
    'J4': '인계 가능성 — 페인포인트 판정과 한계가 하위 단계로 그대로 넘어갈 수 있는가',
    'J5': '사건성 — 행이 의견이나 빈도가 아니라 일어난 일로 적혔는가',
    'J6': '해결 분리 — 필요한 경험이 채널이나 화면 요소로 적히지 않았는가',
}
EXAMPLES = tuple(f'JB{number:02}' for number in range(1, 7))
GRADES = ('observed', 'inferred', 'hypothesis')
GRADE_LABELS = {'observed': '관찰', 'inferred': '추론', 'hypothesis': '가설'}
# 칸의 `reason` 은 「상태가 왜 그 상태인가」를 적는 자리인데 라벨이 네 상태 모두에
# 「기각 사유」로 찍히고 있었다. 기각은 `not_applicable` 한 경우뿐이다 — 실제 문서에서
# **근거가 확실해 `filled` 이 된 칸에 「기각 사유: 게시판 질문이 실재하며 건수를
# 확인했다」**가 붙었다. 읽는 사람은 채워진 칸을 기각된 칸으로 읽고 넘어간다.
# 데이터는 그대로 두고 표시만 상태에 맞춘다.
REASON_LABELS = {'filled': '근거', 'hypothesis': '가설로 둔 이유',
                 'not_applicable': '기각 사유', 'unexamined': '미조사 사유'}
# grilling-rules.md rule 2: detected as strings, so applied mechanically.
# Two lists, because the two channels can afford different mistakes. These words block, so
# they must not fire on a legitimate sentence: 「누가 자주 교류하는 사람인지」 is a noun
# phrase, not a claim about how often something happens, and a check that refuses it teaches
# people to work around the check.
# 유보(「할 것 같다」·「아마」·「듯하다」)가 여기 섞여 있었다. 빈도 주장이 아니라 **기획자가
# 자기 판단에 붙인 정확한 표시**이고, 6차가 그것을 신고하는 것을 오탐으로 쟀다. HEDGE로 옮긴다.
GENERALIZATION = ('보통', '대부분', '대체로', '일반적으로', '흔히', '흔한', '흔하다', '하는 편',
                  '하는 경향', '대개', '종종', '다들', '많이들')
# These only report, so they can afford to be wrong: a look costs nothing. Ten QA runs had
# planners say 원래 and 자주 where the tight list stayed silent.
# 실주행이 놓쳤다고 적은 말들을 더한다. 보고 전용 목록이라 기존 산출물을 깨지 않는다.
# 6차가 수치로 쟀다: 정밀도 0/3 · 재현율 0/2. 두 가지를 섞어 놓았기 때문이다.
#   ① **빈도 주장** — 「보통」·「대부분」. 사건 하나로 되물어야 하는 것.
#   ② **유보** — 「인 것 같」·「아마」. 기획자가 자기 판단에 **정확히** 붙인 표시다.
# 유보를 일반화로 신고하면 **이 워크플로우가 장려하려는 답변을 벌준다.** 갈라 놓는다.
#
# 빠진 활용도 채운다 — 「많아요」만 있고 「많다」가 없어 전언 일반화를 놓쳤다.
# 그리고 「원래」·「매번」은 뺀다: 5·6차에서 **여섯 번 전부 오탐**이었다.
# 「원래」는 「제가 원래 풀려던」(의도)·「원래 등록된 이름」(관형사)·「원래 뭘 정하고 싶었는지」
# (시점 부사)로 쓰이고, 「매번」은 기획자가 **직접 센 횟수**를 가리켰다.
LOOSE_GENERALIZATION = GENERALIZATION + ('자주', '꽤', '거의 다', '늘 ', '항상',
                                         '흔해', '많아진', '많아졌', '누구나', '누구한테나',
                                         '많다', '많아요', '많습니다', '많은 것 같')
# 유보는 일반화가 아니다. 보고도 하지 않는다 — 정확한 인식론적 표시이고, 그것을 벌주면
# 기획자가 확신 없는 것을 확신 있게 말하게 된다.
HEDGE = ('인 것 같', '아마', '듯하다', '할 것 같다', '것 같아', '보여요', '보입니다')
# 「해결책부터 말했다」의 신호는 낱말이 아니라 **제안하는 어법**이다. 낱말만 보면 기획자가
# 「지금 제품이 이렇다」를 말할 때마다 걸린다 — 워크플로우가 요구하는 바로 그 진술인데도.
# 재주행 10건에서 이 검사가 39번 울렸고 실행기들이 판정한 것은 전부 오탐이었다.
# 어미까지 포함한다. 「면 되」만 있었을 때 「…만들면 됩니다」·「…넣으면 됩니다」가 빠져나갔다
# (한 실행기가 대조 주행으로 재서 알려줬다). 활용형은 어간이 아니라 「~면 + 되/됩」으로 잡는다.
PROPOSAL = ('면 되', '면 됩', '면 돼', '주면', '해주', '해 주', '추가하', '있으면 좋', '하면 좋',
            '개선하', '바꾸면', '도입', '제공하면', '보여주면', '띄우', '달아',
            # 어간만 두면 「배송 전제로 만들어진 화면」 같은 **현재 제품 묘사**가 걸린다.
            # 제안형 어미까지 봐야 만드는 말과 만들어진 것을 가른다.
            '만들면', '만들어주', '만들어 주', '만들자', '만들어야',
            '넣으면', '넣어주', '넣어 주', '넣자')
# 빈도어의 *부인*은 일반화가 아니다 — 「얼마나 자주 일어나는지 세어본 적이 없습니다」.
# 「모르-」의 활용이 전부 빠져나갔다 — 몰라/모릅/몰랐. 그리고 「확인해봐야 안다」는 부정이
# 아니라 유보인데, 기획자 브리프가 바로 그 말투를 쓰라고 시킨다. 내가 심은 말버릇을 내 검사가
# 오탐하고 있었다.
NEGATION = ('없', '안 ', '못 ', '모르', '몰라', '몰랐', '모릅', '모를', '아니', '않',
            '세보지', '세어보지', '확인해봐야', '확인해야', '확인 안', '본 적 없')
# 그중 「모른다」에 해당하는 것만. 빈도 주장은 어떤 부정에도 서지 않지만, 제안은 결과를
# 부정하면서도 제안일 수 있다.
UNKNOWN = ('모르', '몰라', '몰랐', '모릅', '모를', '확인해봐야', '확인해야', '확인 안',
           '본 적 없', '세보지', '세어보지', '안 세', '없어요', '없습니다')
# 「넘기셔도 됩니다」는 제안이 아니라 승인이다.
APPROVAL_WORDS = ('넘기셔도', '넘어가셔도', '확정해', '진행하셔도', '그렇게 정리', '맞습니다',
                  '동의합니다', '승인')
SENTENCE = re.compile(r'[.!?\n]|(?<=요)\s|(?<=다)\s')
# 문장 분리기가 **쉼표로 안 쪼갠다.** 그래서 뒷절의 부정 하나가 앞절의 일반화까지 면제했다 —
# 「인기 캠페인은 원래 100명 넘게 들어와요, …건 아니에요」가 조용히 통과했다(5차, 직접 재서 확인).
# 부정이 무엇에 붙었는지는 **절 단위**로만 판단할 수 있다.
CLAUSE = re.compile(r'[,;·]|\s(?=그런데|그리고|근데|하지만|다만)')
# 제안의 **철회**는 제안이 아니다. 5차에서 실행기가 예산을 써서 받아낸
# 「…만들자는 얘기는 아니었어요」가 「해결책부터 말했다」로 잡혔다.
# 결과에 붙은 부정(「…그런 일이 안 생기죠」)과 다르다 — 이쪽은 **말한 행위 자체**를 부정한다.
RETRACTION = ('얘기는 아니', '얘기가 아니', '말은 아니', '말이 아니', '뜻은 아니', '뜻이 아니',
              '건 아니', '것은 아니', '것이 아니', '거는 아니', '게 아니', '자는 것', '자는 게')


def sentences(text):
    parts = [part.strip() for part in SENTENCE.split(text or '') if part and part.strip()]
    return parts or [text or '']


def clauses(text):
    """Sentences cut again at commas, because a negation only binds inside its own clause."""
    return [part.strip() for sentence in sentences(text)
            for part in CLAUSE.split(sentence) if part and part.strip()] or [text or '']
# linkage-check.md leak check: a channel word in a required experience is a leaked solution.
SOLUTION_WORDS = ('알림', '버튼', '화면', '팝업', '배너', '대시보드', '탭', '모달', '토스트',
                  '드롭다운', '체크박스', '아이콘')
# 목록·정렬·카드는 요구 문장에서 정당하게 쓰일 수 있어 보고만 한다.
# 같은 제안인데 채널 이름이 다르면 빠져나갔다 — 「푸시로 알려주면」·「문자로 보내주면」.
LOOSE_SOLUTION = SOLUTION_WORDS + ('목록', '정렬', '상세 페이지', '카드', '필터', '검색창', '뱃지',
                                   '푸시', '문자', '이메일', '메일', '카톡', '링크', '위젯')
# linkage-check.md persona check: a situation that opens on an attribute is a persona, not a job.
PERSONA_OPENERS = ('연령', '나이', '세대', '직업', '성별', '남성', '여성', '주부', '학생', '직장인')

# 화면 위치. 컴포넌트 목록(SOLUTION_WORDS)은 「홈 왼쪽 상단의 누적 지원금을 본다」를 잡지
# 못했다 — 「상단」·「왼쪽」은 부품이 아니라 자리이기 때문이다. 성공 판정이나 필요 경험에서
# 화면의 자리를 가리키면 job이 이뤄졌는지가 아니라 **어디를 봤는지**를 재게 된다.
# 차단 목록은 실주행으로 다듬어진 것이라 늘리지 않는다. 이 목록은 **보고 전용**이므로 틀려도
# 비용이 없다 — 이 파일이 LOOSE_* 목록들에 이미 적어 둔 기준 그대로다.
SCREEN_LOCATIONS = ('상단', '하단', '좌측', '우측', '왼쪽', '오른쪽', '가운데', '중앙',
                    '첫 번째 줄', '맨 위', '맨 아래', '헤더', '푸터')

# 무지·불능 종결. 회피 동기(「~싶지 않다」)와 결과 서술(「~남지 않는다」)은 제외한다.
INABILITY = re.compile(r'(모른다|모릅니다|모르겠다|모르겠습니다|못한다|못합니다|못 한다|'
                       r'못 합니다|어렵다|어렵습니다)\s*[.。]?\s*$')

ASSESSMENT = {'verdict': ('pending', 'suitable', 'needs_work', 'insufficient_evidence'),
              'rationale': str, 'criteria': [str], 'example_ids': [str], 'evidence_ids': [str],
              'issue_ids': [str], 'content_hash': str}
SOURCE = {'id': str, 'kind': ('user', 'document', 'code'), 'provider': ('user', 'platty', 'web'),
          'reference': str, 'excerpt': str, 'project_id': str, 'revision': str, 'retrieved_at': str}
ROW = {'id': str, 'situation': str, 'workaround': str, 'blocker': str, 'required_experience': str,
       'current_product': str, 'current_product_source_ids': [str], 'grade': GRADES,
       'source_ids': [str], 'source_pending': bool, 'verification_method': str,
       'pain_point_ids': [str]}
CELL = {'status': ('unexamined', 'filled', 'hypothesis', 'not_applicable'), 'reason': str,
        'rows': [ROW], 'next_checks': [str]}
DISPROOF = {'overturned_by': str, 'wrong_belief': str, 'replacement_case_id': str,
            'affected_specs': [{'reference': str, 'state': str}]}
SHAPE = {
    'schema_version': (1,), 'case_id': str, 'title': str,
    'status': ('in_progress', 'awaiting_confirmation', 'waiting', 'paused', 'complete'),
    # provisional: 「진행은 하되 이 답이 오면 job이 바뀐다」. 4차의 한 케이스가 그 말을
    # 적을 자리를 넷 다 시도해 전부 실패했다 — `disproof`는 **이미 뒤집힌 job의 부검**이고,
    # `fog`는 티켓이 아닌 이유를 요구하는데 그 답은 티켓이며, `related_jobs`는 통과하지만
    # 두 갈래가 같은 일인지 기획자도 모른다. 미정이 「영영 멈춤」 아니면 「안 막힘」 둘뿐이면
    # 정직한 쪽이 멈춘다.
    'job_status': ('active', 'provisional', 'superseded', 'retired'),
    # 이 답이 오면 job이 바뀐다 — 그 티켓들. provisional일 때만 채운다.
    'provisional_on': Optional([str]),
    'job': {key: str for key in JOB_ELEMENTS},
    # 기획자가 말한 문장인지, 실행기가 지어서 승인받은 문장인지. 3단계 decisions[].origin의
    # 1a판이다. 기계로 판정할 수 없어(실측: 10건 전부 실행기 합성문이고, 답이 질문을 베낀
    # 흔적은 최대 23자) 막지 않는다 — 대신 여기 적히면 1b carried로 그대로 넘어간다.
    'job_origin': Optional({key: ('planner_stated', 'assistant_drafted') for key in JOB_ELEMENTS}),
    # 기획자가 **명시적으로** 「성공 판정은 아직 안 정했어요」라고 답하는데 이 다섯 칸이 전부
    # nonempty를 요구했다. 30건 중 **10건**이 같은 자리에서 같은 산문을 지어냈고, 그 산문이
    # 1b `carried.hypotheses[].measure`(무엇으로 잴 것인가)로 기계 복사돼 「잴 방법이 없다」가
    # 잴 방법으로 앉았다. 「모른다」가 하류에서 주장으로 바뀐 것이다.
    # 미정은 빈 칸이 아니라 **선언**이다 — 어느 요소가, 왜 아직 없는지를 적는다.
    'job_undecided': Optional([{'element': JOB_ELEMENTS, 'why': str}]),
    # 주체는 하나다 — JTBD가 하나인 이유가 그것이다. 그런데 **상황에 등장하는 사람**은 여럿이고,
    # 담을 칸이 `related_jobs`뿐이었다. 주체가 셋인 케이스에서 나머지 둘이 「일이 아니다」로
    # 밀려났고, 2단계 `actors`로 되돌아온 것은 브랜드 하나뿐이었다. 단계마다 주체를 담는
    # 그릇이 다르면 사람은 단계 사이에서 사라진다.
    'other_actors': Optional([{'name': str, 'part': str, 'why_not_subject': str}]),
    'related_jobs': [{'name': str, 'why_deferred': str}],
    'cells': {key: CELL for key in CELLS},
    # deferred: 이번 범위에서 미룬다. rejected(근거를 들어 기각)와 다르며, 하류가
    # 「미룬 것」과 「기각한 것」을 구별할 수 있어야 한다.
    # `undecidable`: **아무도 판정하지 않았다.** `deferred`(우리가 이번에 미루기로 정했다)와
    # 다르다 — 기획자가 「제가 다룬다/기각한다를 정할 수 있는 게 아니에요」라고 답한 자리다.
    # 5차에서 네 번 나왔고, 값이 없어 `deferred`로 저장했다: 기계가 읽는 값은 「기획자가
    # 미뤘다」인데 사실은 「아무도 판정하지 않았다」였고, 그대로 1b로 내려갔다.
    'pain_points': [{'id': str, 'name': str,
                     'decision': ('open', 'address', 'rejected', 'deferred', 'undecidable'),
                     'reason': str, 'origin_cell': str, 'origin_row_id': str}],
    'disproof': Optional(DISPROOF),
    'sources': [SOURCE],
    'issues': [{'id': str, 'question': str, 'target': ('jtbd', 'prd', 'external'),
                'blocking': bool, 'reason': str, 'areas': [str],
                'action': {'kind': ('ask_user', 'platty', 'web', 'handoff', 'wait'), 'prompt': str},
                'probe_count': int, **TICKET_FIELDS}],
    **MAP_FIELDS,
    'service_context': {'project_id': str, 'status': ('missing', 'ready', 'stale', 'unavailable'),
                        'checked_at': str, 'baseline_revision': str, 'observed_revision': str,
                        'coverage_limits': [str]},
    'review': {key: ASSESSMENT for key in REVIEW_LABELS},
    'confirmation': {'confirmed': bool, 'turn_id': str, 'statement': str, 'content_hash': str,
                     'review_hash': str},
    'history': [{'change': str, 'reason': str}],
}
PROBE_LIMIT = 3


def digest(value):
    canonical = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def fingerprints(data):
    payload = {key: data[key] for key in ('schema_version', 'case_id', 'title', 'job_status', 'job',
                                          'related_jobs', 'cells', 'pain_points', 'sources',
                                          'service_context')}
    # probe_count is session bookkeeping, not content. Asking a question must not invalidate
    # the qualitative assessments of what the document says.
    payload['issues'] = [{key: value for key, value in row.items() if key != 'probe_count'}
                         for row in data['issues']]
    # Only a used ruling joins the hash, so artifacts written before it keep their approval.
    # `history`가 해시 밖이라 **조건부 승인의 조건도, 모순의 정정 경위도 확정이 덮지 않았다.**
    # 5차에서 세 실행기가 조건을 `history`에 적었고 하나는 「1b는 R-01이 정정된 값 위에 선 줄
    # 모른다」고 적었다. 무엇이 왜 바뀌었는지는 산출물의 내용이다.
    for key in ('out_of_scope', 'disproof', 'job_origin', 'provisional_on', 'job_undecided',
                'history'):
        if data.get(key):
            payload[key] = data[key]
    content = digest(payload)
    return content, digest({'content_hash': content, 'review': data['review']})


def found_words(text, words):
    return sorted({word for word in words if word in text})


def unjudged_criteria(data):
    """Which of the six criteria no assessment even cited.

    Slots are four and criteria are six, so J5(사건성) and J6(해결 분리) had no home — and the
    validator only checks that each slot's verdict is not `pending`. Thirty fresh cases measured
    four separate failures that all reduce to this: an empty grid, a job built on a remark from
    the CEO, a document whose own numbers cannot all be true, and four jobs merged into one —
    every one of them `valid: true`.

    Reported, never blocked, and the reason matters: 27 of 65 recorded artifacts cite neither J5
    nor J6, and the `criteria` field is only checked for membership in a list. Demanding the id
    would buy pasted ids, not judgments. What the machine can honestly do is say which of the six
    nobody wrote about, where the person doing the judging will see it.
    """
    cited = {name for row in data.get('review', {}).values()
             for name in (row.get('criteria') or [])}
    missing = [name for name in CRITERIA if name not in cited]
    if not missing:
        return []
    table = CRITERION_DEFINITIONS
    return [f'$.review: 여섯 기준 중 {", ".join(missing)}을 어느 판정도 인용하지 않았다 — '
            + ' / '.join(f'{name}: {table[name]}' for name in missing)]


def subject_words(data):
    """Solution words this job is itself about, so naming the topic is not leaking it."""
    job = data.get('job') or {}
    spoken = ' '.join(str(job.get(key, '')) for key in JOB_ELEMENTS) + ' ' + str(data.get('title', ''))
    return {word for word in LOOSE_SOLUTION if word in spoken}


def planner_language_findings(data):
    """What the planner actually said, read for the things the grilling rules are about.

    The field checks read `job.situation` and `required_experience` — the transcript, tidied
    by whoever is being checked. Ten QA runs had planners generalize, lead with a solution
    and leak a channel word, and the machine caught none of it because the planner's words
    live in `sources[].excerpt` and nothing looked there.

    Reported, never blocking. A generalization in a quote is not a defect in the document; it
    is a question the interviewer did not follow up, and the document's job is to show it.

    Re-running the ten cases measured this check rather than assuming it: it fired 51 times and
    the executors judged 39 of those wrong, every one of them a bare noun in a sentence
    describing the product as it is today. Reading the modality instead of the noun, and
    skipping a sentence that denies the frequency it names, takes the corpus from 51 findings
    to 7 while still firing on 「그냥 알림을 하나 주면 되죠」.
    """
    findings = []
    for row in data.get('sources', []):
        if row.get('provider') != 'user':
            continue
        excerpt = row.get('excerpt', '')
        if found_words(excerpt, APPROVAL_WORDS):
            # 승인·확인 답변은 근거가 아니다. 한 실행기가 받은 유일한 지적이 조건부 승인
            # 문장의 「거의 다」였고, 정작 그 주행의 진짜 일반화는 놓쳤다.
            continue
        # 부정은 **자기 절 안에서만** 면제한다. 문장 단위로 보면 조각 안 아무 데나 있는
        # 무관한 부정(「안내 **안** 해도요」·「**모르**는」) 하나가 검사를 통째로 껐고,
        # 5차에서 진짜 일반화 셋(늘 ×1, 다들 ×2)이 그렇게 빠져나갔다.
        # 면제를 **보고만 하는 검사에만** 붙여 놓고 이쪽에는 안 붙였다(6차). 이 job의 주제어를
        # 기획자가 말할 때마다 걸리는 것은 여기서도 똑같다.
        own = subject_words(data)
        general = sorted({word for part in clauses(excerpt)
                          if not any(mark in part for mark in NEGATION)
                          for word in found_words(part, LOOSE_GENERALIZATION)
                          if word not in own})
        # 부정 필터를 일반화 쪽에만 붙여 둬서 「알림 주면 그 전에 쓰는지는 몰라요」가
        # 해결책 선행으로 걸렸다. 모른다는 말은 제안이 아니다 — 두 검사가 같은 문장 단위를 본다.
        # 해결책 쪽이 걸러야 하는 것은 **모른다는 말**이지 아무 부정이 아니다 —
        # 「푸시로 알려주면 그런 일이 안 생기죠」의 「안」은 결과에 붙은 것이고 제안은 제안이다.
        # 제안의 철회는 제안이 아니다. 그리고 **이 job 자신이 그 낱말에 대한 job이면**
        # 기획자는 주제를 말할 때마다 걸린다 — 5차에서 초대 링크 job의 「링크」가 그랬고,
        # 그 소견이 인계장 「다음 후보」 첫 줄을 차지했다. 도구 자신의 JB06 경계가
        # 「현황 묘사는 해결책 선행이 아니다」라고 적어 둔 그 경우다.
        leaked = sorted({word for part in clauses(excerpt)
                         if not any(mark in part for mark in UNKNOWN)
                         and not any(mark in part for mark in RETRACTION)
                         and any(mark in part for mark in PROPOSAL)
                         for word in found_words(part, LOOSE_SOLUTION)
                         if word not in own})
        if general:
            findings.append(f"$.sources[{row['id']}]: 기획자가 일반화했다 — "
                            f"{', '.join(general)}. 사건 하나를 되묻거나 그 행을 가설로 표기한다")
        if leaked:
            findings.append(f"$.sources[{row['id']}]: 기획자가 해결책부터 말했다 — "
                            f"{', '.join(leaked)}. 그것이 없는 지금은 어떻게 하는지로 되돌린다")
    return findings


def coverage(data):
    """linkage-check.md coverage block. Evidence shortage is reported, never blocked.

    `source_pending` 은 「출처를 받기로 하고 아직 못 받았다」는 정직한 표시였는데, 만료가 없어
    영구히 관찰로 세어졌다. 출처 없는 관찰은 **근거 부족이 아니라 틀린 주장**이다 — 모른다고
    적은 것이 아니라 안다고 적은 것이므로, 세는 자리에서 가설로 내린다. 행의 등급은 기획자가
    쓴 그대로 두고 집계만 진실을 말한다. 막지 않되 거짓말이 소용없게 만드는 쪽이다.
    """
    cells = data['cells']
    states = {name: sum(1 for cell in cells.values() if cell['status'] == name)
              for name in ('filled', 'hypothesis', 'not_applicable', 'unexamined')}
    rows = [row for cell in cells.values() for row in cell['rows']]
    grades = {name: sum(1 for row in rows if row['grade'] == name) for name in GRADES}
    demoted = sum(1 for row in rows if row['grade'] == 'observed' and row['source_pending'])
    grades['observed'] -= demoted
    grades['hypothesis'] += demoted
    return {'cells': states, 'grades': grades, 'demoted': demoted,
            'source_pending': demoted,
            'rows': len(rows)}


def linkage_findings(data):
    """linkage-check.md link integrity, split the way its failure table splits.

    Structural problems are fixable without research, so they are required. An experience the
    planner has not yet asserted is a research shortage, so it is reported and never blocked.
    """
    structural, reported = [], []
    pains = {pain['id']: pain for pain in data['pain_points']}
    served = {name for cell in data['cells'].values() for row in cell['rows']
              for name in row['pain_point_ids']}
    for key, cell in data['cells'].items():
        for number, row in enumerate(cell['rows']):
            path = f'$.cells.{key}.rows[{number}]'
            if not row['required_experience'].strip():
                reported.append(f'{path}: undetermined experience; the planner has not asserted one')
            elif not row['pain_point_ids']:
                structural.append(f'{path}: orphan experience; no pain point reaches it')
    for number, pain in enumerate(data['pain_points']):
        path = f'$.pain_points[{number}]'
        if pain['id'] not in served and pain['decision'] not in ('rejected', 'deferred'):
            structural.append(f'{path}: neglected pain; give it an experience or reject it in §3')
    return structural, reported


def validate(data):
    errors, readiness, contradictions = [], [], []
    # 모르는 칸 하나가 내용 검사를 통째로 끄던 자리다 — 덜어낸 사본으로 끝까지 검사하고
    # 그 칸은 오류로 남는다.
    errors, pruned = shape_errors(data, SHAPE)
    if errors and pruned is None:
        return invalid_report(errors)
    data = pruned if pruned is not None else data
    content_hash, review_hash = fingerprints(data)

    def require(condition, path, message, destination=errors):
        if not condition:
            destination.append(f'{path}: {message}')

    def nonblank(value, path, destination=errors):
        require(bool(value.strip()), path, 'nonempty text required', destination)

    def refs(ids, lookup, path):
        require(len(ids) == len(set(ids)), path, 'duplicate references')
        for key in ids:
            require(key in lookup, path,
                    f'unknown reference {key!r}'
                    + (f'; expected one of {tuple(lookup)}' if len(lookup) <= 20 else ''))

    def timestamp(value, path):
        try:
            valid = datetime.fromisoformat(value.replace('Z', '+00:00')).utcoffset() is not None
        except ValueError:
            valid = False
        require(valid, path, 'ISO 8601 timestamp with timezone required')

    # A title before the first question is a draft anchor the skill forbids and the tool used
    # to demand: the first save died on it. It is owed before confirmation, not before the
    # interview, so it reports as readiness.
    nonblank(data['title'], '$.title', readiness)
    require(bool(re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', data['case_id'])), '$.case_id',
            'lowercase letters, numbers, and hyphens required')
    sources, issues = {}, {}
    for collection, index, keys in (('sources', sources, ('reference', 'excerpt')),
                                   ('issues', issues, ('question', 'reason'))):
        for number, item in enumerate(data[collection]):
            path = f'$.{collection}[{number}]'
            nonblank(item['id'], path + '.id')
            require(item['id'] not in index, path + '.id', 'duplicate id')
            index[item['id']] = item
            for key in keys:
                nonblank(item[key], path + '.' + key)
    for number, source in enumerate(data['sources']):
        path = f'$.sources[{number}]'
        require((source['provider'] == 'user') == (source['kind'] == 'user'), path,
                'user kind/provider must agree')
        require(source['provider'] != 'web' or source['kind'] == 'document', path,
                'web sources must be documents')
        timestamp(source['retrieved_at'], path + '.retrieved_at')
        if source['provider'] == 'platty':
            nonblank(source['project_id'], path + '.project_id')
            nonblank(source['revision'], path + '.revision')
        else:
            require(source['project_id'] == '', path + '.project_id',
                    "only Platty sources carry a project_id; leave it as '' here")
    errors.extend(map_gaps(data, set(sources)))

    # Job — situation first, motivation free of solutions (jtbd-shape.md writing rules).
    undecided = {row['element']: row['why'] for row in (data.get('job_undecided') or [])}
    for number, row in enumerate(data.get('job_undecided') or []):
        nonblank(row['why'], f'$.job_undecided[{number}].why')
        require(not data['job'][row['element']].strip(), f'$.job_undecided[{number}]',
                f"{row['element']} is declared undecided but $.job.{row['element']} has text — "
                '둘 중 하나만이다. 적을 것이 있으면 적고, 아직 없으면 비운다')
    for key in JOB_ELEMENTS:
        if key in undecided:
            # 주체·상황·동기가 없으면 job이 아니다. 미정을 선언할 수 있는 것은 **결과 쪽**뿐이다.
            require(key in ('expected_outcome', 'success_criteria'), '$.job_undecided',
                    f'{key} cannot be undecided — 주체·상황·동기가 없으면 job이 성립하지 않는다')
            continue
        nonblank(data['job'][key], '$.job.' + key, readiness)
    situation = data['job']['situation']
    # J2 is about the subject, and the check read only the situation. A fresh run put
    # 「20~30대 여성 운영자」 in `job.subject` and the validator said nothing; the same words in
    # `situation` were caught. Twenty earlier cases could not show it — every one of their
    # subjects was already written as a position rather than a set of attributes.
    for key in ('subject', 'situation'):
        opener = found_words(data['job'][key], PERSONA_OPENERS)
        require(not opener, '$.job.' + key,
                'persona attribute in ' + key + ': ' + ', '.join(opener), readiness)
    leak = found_words(data['job']['motivation'], SOLUTION_WORDS)
    require(not leak, '$.job.motivation', 'solution leaked into motivation: ' + ', '.join(leak),
            readiness)
    # 동기가 「무엇을 눌러야 하는지 모른다」로 끝나면 job이 아니라 pain을 적은 것이다. job은
    # 사람이 **하려는 일**이고 pain은 그것이 막힌 상태다. 둘을 바꿔 적으면 job 전체가 제품
    # 안쪽으로 끌려 들어가 10년 전 테스트도 같이 깨진다.
    # 「~하고 싶지 않다」·「미안함이 남지 않는다」는 정당한 회피 동기이므로 부정 일반이 아니라
    # **무지·불능 종결만** 본다.
    require(not INABILITY.search(data['job']['motivation'].strip()), '$.job.motivation',
            'motivation states an inability, not a wanted progress — '
            'pain을 동기 칸에 적었다. 「무엇을 하고 싶은가」로 다시 적는다', readiness)
    # 성공 판정에 화면 위치가 들어가면 job 달성이 아니라 UI 확인 동작을 재게 된다.
    # motivation 쪽에만 있던 검사를 여기에도 둔다 — 「홈 왼쪽 상단의 누적 지원금을 본다」가
    # 판정으로 적힌 실제 문서가 있었다.
    if 'success_criteria' not in undecided:
        spoiled = found_words(data['job']['success_criteria'], SOLUTION_WORDS)
        require(not spoiled, '$.job.success_criteria',
                'solution leaked into success criteria: ' + ', '.join(spoiled) +
                ' — job이 이뤄졌는지가 아니라 화면을 봤는지를 재고 있다', readiness)
        placed = found_words(data['job']['success_criteria'], SCREEN_LOCATIONS)
        if placed:
            contradictions.append(
                '$.job.success_criteria: 화면의 자리를 판정 기준으로 삼았다 — '
                + ', '.join(placed) + '. job이 이뤄졌는지로 다시 적는다')
    for number, related in enumerate(data['related_jobs']):
        for key in ('name', 'why_deferred'):
            nonblank(related[key], f'$.related_jobs[{number}].{key}')

    # Cells — rows carry the grilling rules; an empty cell is an output, not a failure.
    pains = {pain['id']: pain for pain in data['pain_points']}
    row_ids = {}
    for key, cell in data['cells'].items():
        path = f'$.cells.{key}'
        if cell['status'] == 'not_applicable':
            nonblank(cell['reason'], path + '.reason', readiness)
            require(not cell['rows'], path + '.rows', 'an explicitly excluded cell carries no rows')
        require(cell['status'] != 'unexamined' or not cell['rows'], path,
                'an unexamined cell carries no rows')
        for number, check in enumerate(cell['next_checks']):
            nonblank(check, f'{path}.next_checks[{number}]')
        for number, row in enumerate(cell['rows']):
            here = f'{path}.rows[{number}]'
            nonblank(row['id'], here + '.id')
            require(row['id'] not in row_ids, here + '.id', 'duplicate row id')
            row_ids[row['id']] = key
            for field in ('situation', 'blocker'):
                nonblank(row[field], f'{here}.{field}')
            # "지금 뭘로 때우나는 비우지 않는다" — the workaround is the job's proof of existence.
            # 관찰한 적 없는 행동의 우회책은 알 수 없다. 확인 방법을 적었다면 비워도 된다 —
            # 존재 증명을 요구하면 콜드스타트는 지어낸다(C-5).
            if row['grade'] != 'hypothesis' or not row['verification_method'].strip():
                nonblank(row['workaround'], here + '.workaround', readiness)
            words = found_words(row['required_experience'], SOLUTION_WORDS)
            require(not words, here + '.required_experience',
                    'solution leaked into required experience: ' + ', '.join(words), readiness)
            placed = found_words(row['required_experience'], SCREEN_LOCATIONS)
            if placed:
                contradictions.append(f'{here}.required_experience: 화면의 자리가 경험으로 '
                                      f'적혔다 — {", ".join(placed)}')
            for field in ('situation', 'workaround', 'blocker'):
                general = found_words(row[field], GENERALIZATION)
                require(not general, f'{here}.{field}',
                        'generalization instead of an event: ' + ', '.join(general), readiness)
            refs(row['source_ids'], sources, here + '.source_ids')
            refs(row['pain_point_ids'], pains, here + '.pain_point_ids')
            refs(row['current_product_source_ids'], sources, here + '.current_product_source_ids')
            # A hypothesis without a promotion path never improves; the row is not accepted.
            if row['grade'] == 'hypothesis':
                nonblank(row['verification_method'], here + '.verification_method')
            elif not row['source_pending']:
                require(bool(row['source_ids']), here + '.source_ids',
                        f"{GRADE_LABELS[row['grade']]} requires evidence")
            if row['grade'] == 'observed' and not row['source_pending']:
                require(any(sources.get(name, {}).get('kind') != 'user' or
                            sources.get(name, {}).get('reference', '').strip()
                            for name in row['source_ids']), here + '.source_ids',
                        'observed evidence requires an identified source')
            require(not row['source_pending'] or row['grade'] == 'observed',
                    here + '.source_pending', 'only observed evidence can await its source')
            # 약속한 출처는 확정 전에 도착하거나, 등급이 내려가야 한다. 만료가 없으면
            # `source_pending` 이 출처 없는 관찰의 영구 통로가 된다.
            require(not row['source_pending'], here + '.source_pending',
                    '관찰이라 적고 출처를 받지 못했다 — 출처를 적거나 등급을 가설로 내린다',
                    readiness)
            # 확인했다면서 확인 방법을 적어 둔 행. 한 번 본 것과 규모를 아는 것은 다르므로
            # 오류는 아니지만, 「실제로 확인된 어려움」이 곧 「검증이 더 필요한 가정」이기도 한
            # 문서가 실제로 있었다. 판정하는 사람이 보게 남긴다.
            if row['grade'] == 'observed' and row['verification_method'].strip():
                contradictions.append(
                    f'{here}: 관찰이라 적고 확인 방법도 적었다 — 무엇이 이미 확인됐고 무엇이 '
                    f'남았는지 나누거나, 등급을 내린다')
            # 예전 주석: 「이 칸은 스킬이 조회로 채운다, 기획자는 주장하지 않는다」.
            # 그런데 기획자가 **직접 앱을 열어 보고** 말하는 일이 실제로 일어난다 —
            # 6·7차에서 여러 번 나왔고, 7차 기획자는 「제가 지금 눌러 볼게요… 아무 일도
            # 안 일어나요」라고 답했다. 그것은 주장이 아니라 **관찰**이다.
            # 조회만 받으면 실서비스 주행에서는 그 관찰을 **버리고 「확인 안 됨」으로 적게 된다**
            # — 이 워크플로우가 틀렸다고 부르는 바로 그 기록이다.
            #
            # 근거의 종류는 남긴다. platty 조회면 그렇게, 기획자가 본 것이면 그렇게 적힌다.
            if row['current_product'].strip():
                grounded = [sources.get(name, {}) for name in row['current_product_source_ids']]
                require(any(src.get('provider') in ('platty', 'user') for src in grounded),
                        here + '.current_product_source_ids',
                        'current-product claims need either Platty evidence or the planner '
                        '보고 말한 원문(provider: user) — 지어낸 것은 여기 들어갈 수 없다')

    # §3 — the planner selects and rejects; every candidate gets a ruling.
    for number, pain in enumerate(data['pain_points']):
        path = f'$.pain_points[{number}]'
        nonblank(pain['name'], path + '.name')
        require(pain['origin_cell'] in CELLS, path + '.origin_cell', 'unknown cell')
        require(row_ids.get(pain['origin_row_id']) == pain['origin_cell'], path + '.origin_row_id',
                'origin row must live in the origin cell')
        require(pain['decision'] != 'open', path + '.decision',
                'unruled pain point; the planner selects or rejects it', readiness)
        if pain['decision'] != 'open':
            nonblank(pain['reason'], path + '.reason', readiness)
    structural, reported = linkage_findings(data)
    readiness.extend(structural)

    for number, issue in enumerate(data['issues']):
        path = f'$.issues[{number}]'
        refs(issue['areas'], dict.fromkeys(CELLS + JOB_ELEMENTS), path + '.areas')
        require(bool(issue['areas']), path + '.areas', 'affected areas required')
        nonblank(issue['action']['prompt'], path + '.action.prompt')
        # 상한은 **더 묻는 것**을 막는 규칙이지 **센 것을 적는 것**을 막는 규칙이 아니었다.
        # 한 케이스는 같은 자리를 여섯 번 물었는데 그 사실이 결론(job이 성립하지 않는다)의
        # 근거였고, 3으로 낮춰 적어야 통과했다. 기록을 깎게 만들면 기록하지 않는 쪽이 쉬워진다.
        require(0 <= issue['probe_count'], path + '.probe_count', 'probe count cannot be negative')
        handoff = issue['action']['kind'] == 'handoff'
        require(handoff == (issue['target'] == 'prd'), path, 'handoff must target prd')
        require(not handoff or not issue['blocking'], path, 'blocking issues cannot be handed off')
        # 한 항목을 세 번 파고 멈추는 것이 규칙이다. 그 기록이 미완료를 만들면 기록하지
        # 않는 쪽이 통과하기 쉬워진다 — 실제로 열 번의 실주행이 그 방향으로 기울었다.
        #
        # 다만 **탐침 수가 티켓의 생사를 정해서는 안 된다.** 서른 건 주행에서 한 번 물어
        # 「모르겠어요」라는 명확한 답을 받은 티켓이 미해결로 남고, 답을 못 받아도 3이라 적으면
        # 해결이 됐다. 닫는 것은 답(`resolution`)이고, 탐침 상한은 **더 물어도 안 나온다**는
        # 별개의 출구다. 어느 쪽이든 **무엇이 닫았는지가 기록에 남아야** 한다.
        spent = issue['probe_count'] >= PROBE_LIMIT and not issue['blocking']
        # 잠정 job이 이름 댄 티켓은 열린 채로 통과한다. 그것이 「진행은 하되 이 답이 오면
        # 바뀐다」의 실제 내용이다 — 등급만 만들고 완료를 막으면 아무것도 달라지지 않는다.
        provisional = issue['id'] in (data.get('provisional_on') or [])
        if (not closed(issue) and not spent and not provisional
                and (issue['blocking'] or issue['target'] == 'jtbd')):
            # 「닫는 법」을 둘러싼 소견이 서른 건 주행에서 **다섯 형태**로 나왔다 — 배열에서
            # 지우기, 탐침을 3으로 적기, 인계 조합, resolution 키 삭제, 그리고 ask/save의
            # 닭과 달걀. 어느 것도 문서에 없었고 이 문구도 말하지 않았다. 문구가 말한다.
            readiness.append(
                path + ': unresolved jtbd or blocking issue — 기획자가 답했으면 '
                'resolution{answer, turn_id}을 적고, 파생이 스스로 판정했으면 '
                'resolution{answer, decision_id}을 적는다. 아직 아무것도 없으면 그대로 둔다')
    if data['status'] == 'waiting':
        # 역류도 기다림이다. 상위에 판단을 되돌린 단계는 실패한 것이 아니라 기다리는 것이고,
        # 그렇게 적을 수 없으면 아무도 역류하지 않는다 — 열 번의 실주행에서 역류는 0건이었다.
        require(any(issue['blocking'] and issue['action']['kind'] in ('wait', 'handoff')
                    for issue in data['issues']),
                '$.status', 'waiting requires a blocking dependency or backflow with a resume action')

    context = data['service_context']
    context_gap_start = len(readiness)
    require(context['status'] == 'ready', '$.service_context.status', 'baseline not ready', readiness)
    for key in ('project_id', 'baseline_revision', 'observed_revision', 'checked_at'):
        nonblank(context[key], '$.service_context.' + key, readiness)
    if context['checked_at']:
        timestamp(context['checked_at'], '$.service_context.checked_at')
    require(context['baseline_revision'] == context['observed_revision'], '$.service_context',
            'baseline_revision differs from observed_revision; refresh required', readiness)
    for number, limit in enumerate(context['coverage_limits']):
        nonblank(limit, f'$.service_context.coverage_limits[{number}]')
    baseline_ready = not errors and len(readiness) == context_gap_start

    for key, assessment in data['review'].items():
        path = '$.review.' + key
        refs(assessment['criteria'], dict.fromkeys(CRITERIA), path + '.criteria')
        refs(assessment['example_ids'], dict.fromkeys(EXAMPLES), path + '.example_ids')
        refs(assessment['evidence_ids'], sources, path + '.evidence_ids')
        refs(assessment['issue_ids'], issues, path + '.issue_ids')
        verdict = assessment['verdict']
        if verdict != 'pending':
            nonblank(assessment['rationale'], path + '.rationale')
            require(bool(assessment['criteria']), path + '.criteria', 'criteria required')
            require(bool(assessment['example_ids']), path + '.example_ids',
                    'comparison examples required')
            require(bool(re.fullmatch(r'[a-f0-9]{64}', assessment['content_hash'])),
                    path + '.content_hash', 'SHA-256 content hash required')
            require(assessment['content_hash'] == content_hash, path + '.content_hash',
                    'stale assessment; re-evaluate current content', readiness)
        require(verdict == 'suitable', path + '.verdict', 'qualitative review not suitable', readiness)
        if verdict == 'suitable':
            # 여섯 케이스가 같은 논증을 폈다 — JB04는 판정 근거가 없으면 이슈로 남기라 하고
            # J3·J4는 그 정직함을 적합으로 본다. 그런데 이 검사는 평가가 그 이슈를 **가리켰다는
            # 이유만으로** 적합을 막았고, 감추면 통과했다. 인계 티켓과 역류 티켓은 정의상 열려
            # 있다. 「여기까지 적합하고 이 미결 위에 섰다」는 이 워크플로우가 시키는 말이다.
            #
            # 막는 것은 **이 단계가 스스로 답해야 하는데 안 답한 것**뿐이다.
            unanswered = [name for name in assessment['issue_ids']
                          if not closed(issues.get(name, {}))
                          and issues.get(name, {}).get('target') == 'jtbd'
                          and (issues.get(name, {}).get('action') or {}).get('kind') != 'wait']
            require(not unanswered, path + '.issue_ids',
                    'passing assessment rests on an unanswered question this stage owns: '
                    + ', '.join(unanswered))
        elif verdict in ('needs_work', 'insufficient_evidence'):
            require(bool(assessment['issue_ids']), path + '.issue_ids',
                    'unresolved issue and next action required')

    disproof = data.get('disproof')
    require((data['job_status'] in ('active', 'provisional')) == (disproof is None), '$.disproof',
            'superseded or retired requires a disproof record; active and provisional forbid one')
    waiting = data.get('provisional_on') or []
    require((data['job_status'] == 'provisional') == bool(waiting), '$.provisional_on',
            'a provisional job names the open tickets whose answers would change it, and only '
            'a provisional job may name them')
    for number, name in enumerate(waiting):
        row = next((row for row in data['issues'] if row['id'] == name), None)
        require(row is not None and not closed(row), f'$.provisional_on[{number}]',
                f'{name} is not an open issue on this job')
    if disproof is not None:
        for key in ('overturned_by', 'wrong_belief'):
            nonblank(disproof[key], '$.disproof.' + key)
        require(bool(disproof['replacement_case_id'].strip()) == (data['job_status'] == 'superseded'),
                '$.disproof.replacement_case_id', 'only a superseded job names its replacement')
        for number, spec in enumerate(disproof['affected_specs']):
            for key in ('reference', 'state'):
                nonblank(spec[key], f'$.disproof.affected_specs[{number}].{key}')
    for number, entry in enumerate(data['history']):
        for key in ('change', 'reason'):
            nonblank(entry[key], f'$.history[{number}].{key}')

    ready = not errors and not readiness
    completion = list(readiness)
    confirmation = data['confirmation']
    require(confirmation['confirmed'], '$.confirmation', 'user confirmation missing', completion)
    if confirmation['confirmed']:
        nonblank(confirmation['turn_id'], '$.confirmation.turn_id', completion)
        nonblank(confirmation['statement'], '$.confirmation.statement', completion)
        require(confirmation['content_hash'] == content_hash, '$.confirmation.content_hash',
                'confirmation does not cover current content', completion)
        require(confirmation['review_hash'] == review_hash, '$.confirmation.review_hash',
                'confirmation does not cover current reviews', completion)
    require(data['status'] == 'complete', '$.status', 'not complete', completion)
    complete = ready and not completion
    if data['status'] == 'complete' and not complete:
        errors.append('$.status: declared complete but completion requirements are unmet')
    return {'valid': not errors, 'baseline_ready': baseline_ready, 'ready_for_confirmation': ready,
            'complete': complete, 'errors': errors, 'completion_errors': completion,
            'content_hash': content_hash, 'review_hash': review_hash,
            'coverage': coverage(data), 'linkage_findings': structural,
            'unjudged_criteria': unjudged_criteria(data),
            'linkage_reports': reported,
            'planner_language': planner_language_findings(data),
            'self_contradictions': contradictions,
            'next_actions': [{'id': issue['id'], 'areas': issue['areas'], 'action': issue['action']}
                             for issue in data['issues'] if not closed(issue)]}


def subject_particle(word):
    """주체 뒤에 붙일 는/은. 받침이 있으면 은, 없으면 는."""
    text = word.strip()
    if not text:
        return '는'
    last = text[-1]
    if '가' <= last <= '힣':
        return '은' if (ord(last) - 0xAC00) % 28 else '는'
    return '는'


def render(data, report=None):
    report = report or validate(data)
    job = data['job']
    lines = [f"# {markdown(data['title'] or '(제목 미정)')}", '',
             f"사례: {markdown(data['case_id'])} · 상태: {data['status']} · job: {data['job_status']}", '',
             'JSON 원본에서 생성한 읽기용 문서입니다. 수정은 원본에 반영하세요.', '',
             '구조·버전 검증은 내용의 진실성이나 실제 조회·확인 수행을 보증하지 않습니다.', '',
             '## 1. Job', '', '| 요소 | 내용 |', '| --- | --- |']
    origin = data.get('job_origin') or {}
    mark = {'planner_stated': '', 'assistant_drafted': ' _(실행기 작성 · 기획자 승인)_'}
    lines += [f'| {JOB_LABELS[key]} | {markdown(job[key])}{mark.get(origin.get(key), "")} |'
              for key in JOB_ELEMENTS]
    # 상황이 먼저다. 이 파일과 스킬이 「주체를 먼저 물으면 페르소나 서술이 나온다」고 적어
    # 놓고, 정작 찍는 문장은 주체로 열고 있었다 — 묻는 순서와 읽는 순서가 반대였다.
    # 도구가 주체를 앞에 박아 두면 규칙을 배운 사람이 출력을 손으로 고치거나 규칙을 버린다.
    # 내용은 한 글자도 바뀌지 않고 읽는 눈이 닿는 자리만 바뀐다. 부수 효과가 하나 더 있다 —
    # **상황 칸이 부실하면 문장이 곧바로 어색해져 티가 난다.** 주체가 앞에 있으면 상황이
    # 빈약해도 문장이 그럴듯하게 굴러갔다.
    lines += ['', f"> **한 문장**: {markdown(job['situation'])}, "
              f"{markdown(job['subject'])}{subject_particle(job['subject'])} "
              f"{markdown(job['motivation'])}. 그래서 {markdown(job['expected_outcome'])}.", '',
              '### 관련 job', '', '| 이름 | 왜 이번에 다루지 않나 |', '| --- | --- |']
    lines += [f"| {markdown(row['name'])} | {markdown(row['why_deferred'])} |"
              for row in data['related_jobs']] or ['| (없음) | |']
    lines += ['', '## 2. 경험 매트릭스', '']
    for number, key in enumerate(CELLS, start=1):
        cell = data['cells'][key]
        lines += [f"### 2-{number}. {CELL_LABELS[key]} — 상태: {cell['status']}", '']
        if cell['reason'].strip():
            lines += [f"{REASON_LABELS[cell['status']]}: {markdown(cell['reason'])}", '']
        if cell['rows']:
            lines += ['| 상황 | 지금 뭘로 때우나 | 뭐가 안 되나 | 필요 경험 | 지금 제품에서 | 근거 |',
                      '| --- | --- | --- | --- | --- | --- |']
            for row in cell['rows']:
                grade = GRADE_LABELS[row['grade']]
                if row['grade'] == 'observed' and row['source_pending']:
                    grade += '(출처 미수집)'
                if row['grade'] == 'hypothesis':
                    grade += ' · 확인: ' + markdown(row['verification_method'])
                lines.append('| ' + ' | '.join([
                    markdown(row['situation']), markdown(row['workaround']), markdown(row['blocker']),
                    markdown(row['required_experience']), markdown(row['current_product']) or '—',
                    grade]) + ' |')
            lines.append('')
        for check in cell['next_checks']:
            lines += [f'- 다음 확인: {markdown(check)}']
        if cell['next_checks']:
            lines.append('')
    lines += ['## 3. 이번에 다룰 것', '', '| 페인포인트 | 다룬다 / 기각 | 사유 |', '| --- | --- | --- |']
    lines += [f"| {markdown(pain['name'])} | {pain['decision']} | {markdown(pain['reason'])} |"
              for pain in data['pain_points']] or ['| (없음) | | |']
    disproof = data.get('disproof')
    lines += ['', '## 4. 반증 기록', '']
    if disproof is None:
        waiting = data.get('provisional_on') or []
        lines += ['해당 없음 (job_status: ' + data['job_status'] + ').', '']
        if waiting:
            lines += ['이 job은 잠정이다. 다음 답이 오면 바뀐다: ' + ', '.join(waiting), '']
    else:
        lines += ['| 항목 | 내용 |', '| --- | --- |',
                  f"| 무엇이 뒤집었나 | {markdown(disproof['overturned_by'])} |",
                  f"| 무엇을 잘못 믿었나 | {markdown(disproof['wrong_belief'])} |",
                  f"| 대체 문서 | {markdown(disproof['replacement_case_id']) or '—'} |",
                  '| 영향받은 PRD | ' + '; '.join(
                      f"{markdown(spec['reference'])}({markdown(spec['state'])})"
                      for spec in disproof['affected_specs']) + ' |', '']
    # A shape-invalid report carries no appendix, so recompute what is pure in the data.
    report_coverage = report.get('coverage') or coverage(data)
    if 'linkage_findings' in report:
        findings = report['linkage_findings'] + report.get('linkage_reports', [])
    else:
        structural, reported = linkage_findings(data)
        findings = structural + reported
    counts, grades = report_coverage['cells'], report_coverage['grades']
    lines += ['---', '', '## 5. 검사 및 조사 기록', '',
              '> 이 부록은 스킬이 작성·갱신한다. §1~§4의 기획 판단을 다시 쓰지 않는다.', '',
              '### 5-1. 커버리지', '', '```text',
              f"채워짐 {counts['filled']} / 가설 {counts['hypothesis']} / "
              f"해당없음 {counts['not_applicable']} / 미조사 {counts['unexamined']}  (합 {len(CELLS)})",
              f"근거 등급: 관찰 {grades['observed']} / 추론 {grades['inferred']} / 가설 {grades['hypothesis']}",
              f"출처 미수집 관찰: {report_coverage['source_pending']}", '```', '',
              '### 5-2. 연결 검사 결과', '']
    lines += ['- ' + markdown(finding) for finding in findings] or ['문제 없음.']
    context = data['service_context']
    lines += ['', '### 5-3. 현황 대조 근거 (MCP 조회)', '',
              f"프로젝트: {markdown(context['project_id'])} · 상태: {context['status']} · "
              f"확인 시각: {markdown(context['checked_at'])}", '',
              f"기준 버전: {markdown(context['baseline_revision'])} · "
              f"관찰 버전: {markdown(context['observed_revision'])}", '']
    for source in data['sources']:
        lines += [f"- **{markdown(source['id'])}** ({source['provider']}/{source['kind']}) "
                  f"{markdown(source['reference'])} — {markdown(source['excerpt'])}"]
    lines += ['', '### 5-4. 다음 확인', '']
    lines += ['- ' + markdown(limit) for limit in context['coverage_limits']]
    lines += [f"- {markdown(check)}" for key in CELLS for check in data['cells'][key]['next_checks']]
    lines += ['', '### 5-5. 정성 검토', '']
    for key, assessment in data['review'].items():
        lines += [f'#### {REVIEW_LABELS[key]}', '', f"판정: {assessment['verdict']}", '',
                  markdown(assessment['rationale']) or '(미작성)', '',
                  '기준: ' + ', '.join(assessment['criteria']), '',
                  '비교 예시: ' + ', '.join(assessment['example_ids']), '',
                  '검토 근거: ' + ', '.join(map(markdown, assessment['evidence_ids'])), '',
                  '연결 이슈: ' + ', '.join(map(markdown, assessment['issue_ids'])), '',
                  '평가 대상 해시: ' + assessment['content_hash'], '']
    lines += ['### 5-6. 남은 질문', '']
    for issue in data['issues']:
        lines += [f"- **{markdown(issue['id'])}** ({issue['target']}, 차단 {issue['blocking']}, "
                  f"파기 {issue['probe_count']}/{PROBE_LIMIT}) {markdown(issue['question'])} "
                  f"— {markdown(issue['action']['kind'])}: {markdown(issue['action']['prompt'])}"]
    confirmation = data['confirmation']
    lines += ['', '### 5-7. 사용자 최종 확인', '', f"확인: {confirmation['confirmed']}", '',
              '턴: ' + markdown(confirmation['turn_id']), '', markdown(confirmation['statement']), '',
              '내용 해시: ' + confirmation['content_hash'], '',
              '검토 해시: ' + confirmation['review_hash'], '', '### 5-8. 자동 검증 결과', '',
              f"구조 유효: {report['valid']} · 확인 준비: {report['ready_for_confirmation']} · "
              f"완료: {report['complete']}", '']
    lines += ['- ' + markdown(error) for error in report['errors'] + report['completion_errors']]
    lines += ['', '### 5-9. 결정 변경 이력', '']
    lines += ['- ' + markdown(entry['change']) + ' — ' + markdown(entry['reason'])
              for entry in data['history']]
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for command in ('init', 'validate', 'render', 'fingerprint'):
        sub = commands.add_parser(command)
        sub.add_argument('path', type=Path)
        if command == 'validate':
            gate = sub.add_mutually_exclusive_group()
            gate.add_argument('--require-complete', action='store_true')
            gate.add_argument('--require-ready', action='store_true')
        if command == 'render':
            sub.add_argument('-o', '--output', type=Path)
    args = parser.parse_args()
    try:
        if args.command == 'init':
            data = load_json(TEMPLATE)
            data['case_id'] = re.sub(r'[^a-z0-9]+', '-', args.path.parent.name.lower()).strip('-') or 'untitled'
            args.path.parent.mkdir(parents=True, exist_ok=True)
            with args.path.open('x', encoding='utf-8') as out:
                json.dump(data, out, ensure_ascii=False, indent=2)
                out.write('\n')
            print(str(args.path))
            return 0
        data = load_json(args.path)
        if args.command == 'fingerprint':
            errors = []
            check_shape(data, SHAPE, '$', errors)
            if errors:
                print(json.dumps(invalid_report(errors), ensure_ascii=False, indent=2))
                return 1
            content, review = fingerprints(data)
            print(json.dumps({'content_hash': content, 'review_hash': review}, indent=2))
            return 0
        report = validate(data)
        if args.command == 'validate':
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 0 if report['valid'] and (not args.require_complete or report['complete']) and (
                not args.require_ready or report['ready_for_confirmation']) else 1
        if not report['valid']:
            print(json.dumps(report, ensure_ascii=False, indent=2), file=sys.stderr)
            return 1
        content = render(data, report)
        if args.output:
            if args.output.resolve() == args.path.resolve() or (
                    args.output.exists() and args.output.samefile(args.path)):
                raise ValueError('render output must differ from JSON input')
            args.output.write_text(content, encoding='utf-8')
        else:
            print(content, end='')
        return 0
    except (OSError, UnicodeError, ValueError, RecursionError) as exc:
        print(json.dumps(invalid_report([str(exc)]), ensure_ascii=False, indent=2),
              file=sys.stdout if args.command in ('validate', 'fingerprint') else sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
