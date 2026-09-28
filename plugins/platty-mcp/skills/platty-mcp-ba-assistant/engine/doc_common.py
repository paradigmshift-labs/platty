"""Building blocks shared by the reading documents of the later stages.

The stage `.json` is the record; the `.md` beside it is what a person reads. These helpers
keep the three documents (user experience, screen behavior, wireframe) written the same way:
an explicit summary first, names before ids, one definition per value, and everything a
reviewer or an agent needs — but a reader does not — in a separate review file.
"""

import html
import re

ORIGIN = {'current': '현행 유지', 'changed': '변경', 'new': '신규', 'unverified': '확인 안 됨'}
CHANGE = {'keep': '유지', 'modify': '변경', 'add': '추가', 'remove': '제거'}
DIMENSION = {'visibility': '표시 여부', 'content': '내용', 'interaction': '조작',
             'availability': '사용 가능 여부', 'loading': '불러오기', 'selection': '선택',
             'validation': '입력 검증', 'progress': '진행', 'permission': '권한', 'focus': '포커스'}
SCENARIO_KIND = {'happy': '정상', 'normal': '정상', 'alternative': '대안', 'exception': '예외',
                 'recovery': '복구', 'error': '오류', 'boundary': '경계'}
MAPPING_STATUS = {'candidate': '후보(승인 대기)', 'verified': '검증됨', 'mapped': '매핑됨', 'approved': '승인됨',
                  'gap': '매핑 없음', 'unmapped': '매핑 없음'}
DECISION_STATUS = {'accepted': '확정', 'proposed': '제안', 'superseded': '대체됨', 'rejected': '기각',
                   'open': '미정', 'selected': '선택됨', 'revised': '수정됨'}

# Upstream codes a stage writes in parentheses: (R-01·D-07), (SD-02). Only groups whose every
# token is a real id of the case are removed — 「종료 3일 전 (D-3)」 is prose, not a code.
_CODE = r'(?:[A-Z]{1,5}-[A-Z0-9][A-Z0-9-]*|[A-Z]{2,5}\d{1,3})'
_CODE_GROUP = re.compile(r'\s*\((' + _CODE + r'(?:\s*[·,/~]\s*' + _CODE + r')*)\)')
_CODE_SPLIT = re.compile(r'\s*[·,/~]\s*')


def text(value):
    """Prose from the record, safe to place in Markdown with inline HTML."""
    return html.escape(str(value if value is not None else ''), quote=False).replace('\n', ' ')


def cell(value):
    """Already-rendered Markdown made safe for one table cell (GFM reads `\\|` even in code)."""
    return str(value).replace('|', '\\|').replace('\n', ' ')


def code(value):
    """An identifier or code reference as inline code; code spans show text as it is."""
    return '`' + str(value if value is not None else '').replace('`', "'").replace('\n', ' ') + '`'


def record_ids(*records):
    """Every id a record defines — what an upstream code in prose may refer to."""
    found = set()

    def walk(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if key in ('id', 'region_id') and isinstance(item, str):
                    found.add(item)
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)
    for record in records:
        walk(record)
    return found


def strip_codes(value, sink=None, known=frozenset()):
    """Prose without parenthesised upstream codes; the codes go to `sink` for the review file."""
    def replace(match):
        tokens = _CODE_SPLIT.split(match.group(1))
        if not all(token in known for token in tokens):
            return match.group(0)
        if sink is not None:
            sink.extend(tokens)
        return ''
    return _CODE_GROUP.sub(replace, str(value or '')).strip()


def slug(ident):
    return re.sub(r'[^a-z0-9_-]+', '-', str(ident).lower()).strip('-')


def anchor(ident):
    return f'<a id="{slug(ident)}"></a>'


def tag(ident):
    """An id shown small after the name it belongs to."""
    return f'<sub>`{ident}`</sub>' if ident else ''


def link(label, href):
    if not href:
        return label
    return '[' + str(label).replace('[', '\\[').replace(']', '\\]') + f']({href})'


def table(header, rows):
    """A table of pre-rendered cells, or nothing when there are no rows."""
    if not rows:
        return []
    lines = ['| ' + ' | '.join(header) + ' |', '|' + '---|' * len(header)]
    lines += ['| ' + ' | '.join(cell(value) for value in row) + ' |' for row in rows]
    return lines + ['']


def details(summary, body):
    if not body:
        return []
    return [f'<details><summary>{summary}</summary>', ''] + body + ['</details>', '']


def mermaid_label(value):
    """A label a Mermaid state or flowchart node accepts."""
    return (html.escape(str(value)).replace('"', '&quot;').replace(':', '∶').replace(';', '·')
            .replace('`', '&#96;').replace('\n', ' '))


def joined(values, separator=', ', empty='—'):
    return separator.join(text(value) for value in values if value) or empty


def notice(json_name, review_name):
    return [f'> 이 문서는 `{json_name}`에서 생성한 읽기용 문서입니다. 검증·추적 기록은 '
            f'[{review_name}]({review_name})에 있습니다.', '']


def review_notice(doc_name):
    return [f'> 본문 [{doc_name}]({doc_name})에서 뺀 검증·추적 기록입니다. 본문에서 옮긴 것이지 '
            '버린 것이 아닙니다.', '']


def json_rows(title, rows):
    """A record list kept whole for the review file, one row per line."""
    import json
    if not rows:
        return []
    return [f'## {title}', '', f'{len(rows)}건', '', '```json'] + [
        json.dumps(row, ensure_ascii=False) for row in rows] + ['```', '']


def report_lines(report):
    """The validation report, as it stood when the document was written."""
    if not report:
        return []
    yes = lambda flag: '예' if flag else '아니오'  # noqa: E731
    lines = ['## 검증', '',
             f"- 구조 유효: {yes(report.get('valid'))} · 확인 준비: "
             f"{yes(report.get('ready_for_confirmation'))} · 완료: {yes(report.get('complete'))}"]
    for key in ('metrics', 'coverage'):
        for metric in report.get(key) or []:
            if isinstance(metric, dict) and 'numerator' in metric:
                missing = ', '.join(metric.get('missing_ids', []) or [])
                lines.append(f"- {metric['id']}: {metric['numerator']}/{metric['denominator']} · "
                             f"{metric.get('status', '')}" + (f' · 누락 {missing}' if missing else ''))
    for error in (report.get('errors') or []) + (report.get('completion_errors') or []):
        lines.append('- ' + text(error))
    return lines + ['']
