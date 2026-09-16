"""파이프라인을 거치지 않은 JTBD 문서를 뒤늦게 검사한다.

`jtbd.py` 의 검사는 스키마가 있는 산출물에만 걸린다. 그런데 실제로 일어난 실패는 **문서가
엔진에 들어온 적이 없는** 경우였다 — 팀원이 PRD를 먼저 쓰고, 그 PRD를 근거로 JTBD를 노션에
적었다. 스키마 검사는 한 줄도 돌지 않았고 아무 신고도 없었다.

역산은 여섯 기준 중 정확히 J5(사건성)·J6(해결 분리)를 깬다. PRD에는 사건이 없고, PRD의 해결
방향에서 뽑은 경험은 곧 해결책이기 때문이다. 이 검사가 그 둘을 우선한다.

자유 서술을 읽으므로 **판정하지 않고 신고만 한다.** 사람이 볼 자리를 가리키는 것이 목적이고,
그래서 모든 소견은 보고 전용이다 — 틀려도 비용이 한 번의 확인이다.
"""
import re

from jtbd import (CRITERION_DEFINITIONS, GENERALIZATION, INABILITY, LOOSE_GENERALIZATION,
                  SCREEN_LOCATIONS, SOLUTION_WORDS, found_words)

# 문서가 스스로 「관찰」이라고 주장하는 제목. 주장해 놓고 출처가 없으면 근거 부족이 아니라
# 틀린 주장이다 — 모른다고 적은 것이 아니라 안다고 적었다.
OBSERVED_CLAIM = ('실제로 확인된', '확인된 어려움', '관찰된', '실제 사례', '확인 결과',
                  '인터뷰 결과', '검증된')
# 출처가 붙었다는 표시. 티켓 번호·날짜·URL·화자 중 하나는 있어야 사람이 되짚을 수 있다.
SOURCE_MARKS = re.compile(r'(CS[- ]?\d|티켓|#\d{2,}|https?://|\d{4}[-./]\d{1,2}|\d{1,2}월 \d{1,2}일|'
                          r'인터뷰이|응답자|녹취|원문|세션 기록|접수)')
# 「검증이 더 필요한」 쪽 제목. 같은 항목이 확인됨과 여기에 동시에 있으면 문서가 자기와 어긋난다.
PENDING_CLAIM = ('검증이 더 필요', '추가 확인', '미확인', '확인 필요', '가정')
# 여섯 칸이 **전부 적혀 있는지**가 아니라 그 구조를 **쓰고 있는지**를 본다. 발췌본은 한 칸만
# 싣는 것이 정상이고, 그것을 결함으로 부르면 요약을 벌하게 된다. 축 이름이 한 번이라도
# 짝지어 나오면 구조는 쓰인 것이다.
MATRIX_AXIS = re.compile(r'(기능|사회|감정)\s*[×xX✕*]\s*(채택|사용)')
# 역할 명사 + 주격 조사. 「친구가 댓글을 달았을 때」처럼 상황 안에 등장하는 주어를 벌하지
# 않으려고 **역할 명사로 끝나는 말**만 본다 — 사람을 가리키려고 고른 낱말이라는 표시다.
SUBJECT_OPENER = re.compile(r'(자|인|원|객|님|들)(가|는|은|이)[\s,、]')
# 상황이 시작됐다는 표시. 이것이 주격 조사보다 뒤에 나오면 문장이 사람으로 열린 것이다.
SITUATION_MARK = re.compile(r'(때|면|경우|뒤|후|동안|중에|상황)')

JOB_HEADINGS = ('job to be done', 'jtbd', 'job', '과업', '사용자 과업')


def sections(text):
    """`##` 제목 단위로 자른다. 노션·마크다운 어느 쪽이든 제목은 남는다."""
    found, name, body = [], '', []
    for line in text.replace('\r\n', '\n').split('\n'):
        if line.lstrip().startswith('#'):
            if name or body:
                found.append((name, '\n'.join(body)))
            name, body = line.lstrip('#').strip(), []
        else:
            body.append(line)
    if name or body:
        found.append((name, '\n'.join(body)))
    return found


def bullets(body):
    """목록 항목만 뽑는다 — 주장은 거의 언제나 목록으로 적힌다."""
    rows = []
    for line in body.split('\n'):
        stripped = line.strip()
        if re.match(r'^([-*•]|\d+[.)])\s+', stripped):
            rows.append(re.sub(r'^([-*•]|\d+[.)])\s+', '', stripped))
    return rows


def job_text(parts):
    # 문서 제목이 「… JTBD 인터뷰 결과」이면 그 절이 먼저 잡히는데 본문은 비어 있다.
    # 제목이 맞고 **내용이 있는** 첫 절을 쓴다.
    for name, body in parts:
        if any(mark in name.lower() for mark in JOB_HEADINGS) and body.strip():
            return body.strip()
    return ''


# 조사 하나 때문에 「반복 적립 방법을」과 「반복 적립 방법」이 다른 말이 된다. 한국어에서
# 어절 단위 비교를 하려면 이것부터 떼야 한다. 형태소 분석기를 들이지 않고, 두 글자를 넘는
# 어절의 끝 조사 한 글자만 떼는 선에서 멈춘다 — 여기서 필요한 것은 정확한 원형이 아니라
# **두 문장이 같은 것을 말하는지**뿐이다.
PARTICLES = ('을', '를', '이', '가', '은', '는', '에', '의', '로', '과', '와', '도', '만', '서')


def stem(word):
    return word[:-1] if len(word) > 2 and word[-1] in PARTICLES else word


def tokens(text):
    return [stem(word) for word in re.split(r'[\s,·]+', re.sub(r'[^\w가-힣 ,·]', ' ', text))
            if len(word) > 1]


def overlap(left, right):
    """두 문장이 같은 것을 말하는지. 어절 집합의 겹침으로 본다."""
    first, second = set(tokens(left)), set(tokens(right))
    if not first or not second:
        return 0.0
    return len(first & second) / min(len(first), len(second))


def shared_phrase(left, right, length=2):
    """연속 어절이 통째로 겹치는가.

    집합 겹침만으로는 「반복 적립 방법을 모른다」와 「반복 적립 방법 혼란의 규모를 확인한다」가
    0.25로 남는다 — 뒤 문장이 길어 분모가 커지기 때문이다. 그런데 두 문장에는 「반복 적립
    방법」이 **통째로** 들어 있고, 그것이 같은 것을 말한다는 훨씬 강한 증거다.
    """
    right_words = tokens(right)
    left_words = tokens(left)
    for start in range(len(left_words) - length + 1):
        piece = left_words[start:start + length]
        for cursor in range(len(right_words) - length + 1):
            if right_words[cursor:cursor + length] == piece:
                return ' '.join(piece)
    return ''


def related(left, right, ratio=0.3):
    """같은 것을 말하는 두 문장. 겹침이 넉넉하거나 연속 어절이 통째로 같으면 그렇게 본다."""
    return overlap(left, right) >= ratio or bool(shared_phrase(left, right, 3))


def audit(text, prd_text=''):
    """소견을 기준별로 모은다. 판정은 하지 않는다."""
    parts = sections(text)
    findings = {name: [] for name in CRITERION_DEFINITIONS}
    job = job_text(parts)

    # ── J1 10년 전 테스트 ─────────────────────────────────────────────────
    if job:
        first = re.split(r'(?<=[.。])\s+', job.strip())[0]
        if INABILITY.search(first.strip()):
            findings['J1'].append(f'job 문장이 무지 서술로 끝난다 — 「{first[-28:].strip()}」. '
                                  'job은 하려는 일이고 그것이 막힌 상태는 pain이다')
        opener = SUBJECT_OPENER.search(first)
        situation = SITUATION_MARK.search(first)
        if opener and (not situation or opener.start() < situation.start()):
            findings['J2'].append(
                'job 문장이 사람으로 열린다 — 「' + first[:opener.end()].strip() + '…」. '
                'job은 그 사람이 누구냐가 아니라 그 순간 어떤 처지에 있느냐에 붙는다. '
                '상황을 앞으로 돌리면 상황 칸이 부실할 때 문장이 곧바로 어색해져 티가 난다')
        leaked = found_words(job, SOLUTION_WORDS)
        if leaked:
            findings['J1'].append(f'job 문장에 제품 부품이 들어 있다 — {", ".join(leaked)}. '
                                  '수단을 빼고도 10년 전에 성립하는 문장인지 본다')

    # ── J5 사건성 ─────────────────────────────────────────────────────────
    claimed, pending = [], []
    for name, body in parts:
        rows = bullets(body)
        if any(mark in name for mark in OBSERVED_CLAIM) and body.strip():
            claimed.extend(rows or [body.strip()])
            for row in rows:
                if not SOURCE_MARKS.search(row):
                    findings['J5'].append(f'「{name}」인데 출처가 없다 — 「{row[:34]}…」. '
                                          '되짚을 수 있는 티켓·날짜·원문이 없으면 관찰이 아니다')
                general = found_words(row, GENERALIZATION + LOOSE_GENERALIZATION)
                if general:
                    findings['J5'].append(f'사건이 아니라 빈도 주장이다 — {", ".join(general)} '
                                          f'/ 「{row[:30]}…」. 그중 한 명의 한 번으로 되묻는다')
        if any(mark in name for mark in PENDING_CLAIM) and body.strip():
            pending.extend(rows or [body.strip()])
    for left in claimed:
        for right in pending:
            if related(left, right):
                findings['J5'].append(f'확인됐다면서 검증이 필요하다고도 적혀 있다 — '
                                      f'「{left[:26]}…」. 무엇이 확인됐고 무엇이 남았는지 나눈다')

    # ── J6 해결 분리 ──────────────────────────────────────────────────────
    for name, body in parts:
        if '성공' in name or '판정' in name or '기준' in name:
            placed = found_words(body, SCREEN_LOCATIONS)
            if placed:
                findings['J6'].append(f'성공 기준이 화면의 자리를 가리킨다 — {", ".join(placed)}. '
                                      'job이 이뤄졌는지가 아니라 어디를 봤는지를 재고 있다')
    experiences = [row for name, body in parts if '경험' in name or '해결할' in name
                   for row in bullets(body)]
    if prd_text:
        rules = [row for name, body in sections(prd_text)
                 if '수용' in name or '기준' in name or '규칙' in name for row in bullets(body)]
        matched = sum(1 for one in experiences if any(related(one, rule) for rule in rules))
        if experiences and rules and matched >= min(len(experiences), len(rules)) * 0.5:
            findings['J6'].append(
                f'필요 경험 {len(experiences)}개 중 {matched}개가 PRD 수용 기준과 겹친다 — '
                '경험이 해결책에서 역산됐을 때 나오는 모양이다. 정상이라면 경험이 더 넓고 '
                '그중 일부만 이번에 구현된다')

    # ── 구조: 6칸이 있는가 ────────────────────────────────────────────────
    if not MATRIX_AXIS.search(text):
        findings['J4'].append('기능·사회·감정 × 채택·사용 구조가 쓰이지 않았다 — '
                              '평평한 목록은 시간 축과 사회·감정 면을 통째로 비운다')

    # ── J3 근거 등급 ──────────────────────────────────────────────────────
    # 문서 아무 데나 있는 낱말이 아니라 **주장한 행**에 출처가 붙었는지로 본다.
    # 전체 검색은 「검증이 더 필요하다」는 문단의 「원문」 한 마디에 꺼졌다.
    if claimed and not any(SOURCE_MARKS.search(row) for row in claimed):
        findings['J3'].append(f'확인됐다고 적은 {len(claimed)}개 행 어디에도 되짚을 출처가 '
                              '없다 — 모든 행이 가설이며 커버리지는 관찰 0으로 적혀야 한다')
    return findings


def report(findings):
    lines, total = [], sum(len(rows) for rows in findings.values())
    lines.append(f'소견 {total}건' if total else '소견 없음')
    for name, rows in findings.items():
        if not rows:
            continue
        lines.append('')
        lines.append(f'## {name} — {CRITERION_DEFINITIONS[name]}')
        lines.extend(f'- {row}' for row in rows)
    if total:
        lines += ['', '이 검사는 판정하지 않는다. 사람이 볼 자리를 가리킬 뿐이다.']
    return '\n'.join(lines)


def main():
    import argparse
    import json as json_module
    parser = argparse.ArgumentParser(
        description='파이프라인을 거치지 않은 JTBD 문서를 검사한다. 판정하지 않고 신고만 한다.')
    parser.add_argument('document', help='검사할 JTBD 문서 (markdown 또는 plain text)')
    parser.add_argument('--prd', help='같은 건의 PRD. 주면 필요 경험이 수용 기준에서 '
                                      '역산됐는지 함께 본다')
    parser.add_argument('--json', action='store_true', help='소견을 기준별 JSON 으로')
    args = parser.parse_args()
    text = open(args.document, encoding='utf-8').read()
    prd_text = open(args.prd, encoding='utf-8').read() if args.prd else ''
    findings = audit(text, prd_text)
    if args.json:
        print(json_module.dumps({'findings': findings,
                                 'total': sum(len(rows) for rows in findings.values())},
                                ensure_ascii=False, indent=2))
    else:
        print(report(findings))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
