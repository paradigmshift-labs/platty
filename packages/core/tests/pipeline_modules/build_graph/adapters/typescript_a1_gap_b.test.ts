/**
 * a1 갭 B — parseFile 누락 시나리오 추가 테스트
 * SOT: specs/build_graph/specs/adapters/typescript/a1_parse_file/tests.md §4
 *
 * 커버 대상:
 *   GAP-B-01: ERROR 노드 줄 번호 정확성 독립 검증
 *   GAP-B-02: JSX 자동 수정 후에도 ERROR 잔존 시 throw 명시 검증
 *   GAP-B-03: hasErrorNode의 isMissing 분기 (발굴 시도)
 *   GAP-B-04: fixJsxAmpersandErrors — 비-& ERROR 노드 → 수정 없이 throw
 *
 * 주의: typescript.ts 코드 및 typescript.test.ts 수정 없이 새 파일로만 추가.
 */

import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

const adapter = new TypeScriptParserAdapter()

function parse(content: string, filePath = 'src/test.ts', repoId = 'p1') {
  return adapter.parseFile(content, filePath, repoId)
}

describe('a1 갭 B — parseFile 누락 시나리오', () => {
  // ────────────────────────────────────────────────────────────────────────
  // GAP-B-01: ERROR 노드 줄 번호 정확성 독립 검증
  // ────────────────────────────────────────────────────────────────────────
  it('GAP-B-01 에러가 2번째 줄에 있을 때 "Syntax error at line 2" throw', () => {
    // 첫 줄은 정상 코드, 2번째 줄에 파싱 불가 구문 배치.
    // findFirstErrorLine(root)이 startPosition.row + 1 = 2를 반환해야 함.
    const content = 'export const x = 1\nconst y = !!!'
    expect(() => parse(content)).toThrow('Syntax error at line 2')
  })

  it('GAP-B-01 에러가 3번째 줄에 있을 때 "Syntax error at line 3" throw', () => {
    // 첫 두 줄은 정상, 3번째 줄에 에러.
    const content = 'export const a = 1\nexport const b = 2\nconst z = !!!'
    expect(() => parse(content)).toThrow('Syntax error at line 3')
  })

  it('GAP-B-01 에러가 1번째 줄에 있을 때 "Syntax error at line 1" throw', () => {
    // 단일 줄 에러: row=0 → line=1
    const content = '!!!'
    expect(() => parse(content)).toThrow('Syntax error at line 1')
  })

  // ────────────────────────────────────────────────────────────────────────
  // GAP-B-02: JSX 자동 수정 후에도 ERROR 잔존 시 throw 명시 검증
  // ────────────────────────────────────────────────────────────────────────
  it('GAP-B-02 & 수정 후에도 다른 구문 오류 잔존 → throw', () => {
    // & 포함 + 별도의 문법 오류 (`!!invalid`)도 함께 있음.
    // fixJsxAmpersandErrors가 & → &amp; 로 수정하지만
    // !!invalid 로 인한 ERROR가 여전히 남아 있으므로 throw 경로 진입.
    const content = `export function Comp() {
  return <div>5 & 10 !!invalid</div>
}`
    expect(() => parse(content, 'src/comp.tsx')).toThrow(/^Syntax error at line \d+$/)
  })

  it('GAP-B-02 & 없이 독립 구문 오류만 있는 TSX → throw', () => {
    // & 가 없으므로 fixJsxAmpersandErrors는 content 그대로 반환(ranges.length===0 분기).
    // fixed === content → 6번 경로(throw) 진입.
    const content = `export function Comp() {
  return <div>{ !!! }</div>
}`
    expect(() => parse(content, 'src/comp.tsx')).toThrow(/^Syntax error at line \d+$/)
  })

  // ────────────────────────────────────────────────────────────────────────
  // GAP-B-03: hasErrorNode의 isMissing 분기
  // ────────────────────────────────────────────────────────────────────────
  it.skip('GAP-B-03 isMissing 노드 발생 입력 → throw', () => {
    // tree-sitter 자체에서 isMissing 노드 발생 케이스 발굴 실패 — 별도 조사 필요.
    //
    // 시도한 입력들:
    //   'function f( {'       → tree-sitter가 ERROR 노드로 처리 (isMissing 없음)
    //   'class C extends {'   → ERROR 처리됨
    //   'if (true {'          → ERROR 처리됨
    //   'const f = () =>'     → ERROR 처리됨
    //
    // tree-sitter는 일반적으로 문법 복구 중 isMissing 노드를 삽입하지만,
    // TypeScript/TSX 파서에서 어떤 입력이 isMissing을 유발하는지
    // 파서 grammar 소스 수준의 추가 조사가 필요.
    //
    // isMissing 분기는 hasErrorNode와 findFirstErrorLine 양쪽에 존재하므로
    // dead code 여부 검증을 위해 별도 트리거 케이스 발굴 필요.
    const content = 'function f( {'
    expect(() => parse(content)).toThrow(/^Syntax error at line \d+$/)
  })

  // ────────────────────────────────────────────────────────────────────────
  // GAP-B-04: fixJsxAmpersandErrors — 비-& ERROR 노드 → ranges 미수집 → throw
  // ────────────────────────────────────────────────────────────────────────
  it('GAP-B-04 비-& ERROR 노드만 있을 때 fixJsxAmpersandErrors 수정 없이 throw', () => {
    // < 로 시작하는 잘못된 JSX 텍스트: ERROR 노드가 있지만 text가 & 로 시작하지 않음.
    // fixJsxAmpersandErrors → ranges 비어 있음 → content 그대로 반환.
    // fixed === content → throw 경로.
    const content = `export function Comp() {
  return <div>{ }</div>
const broken = !!!`
    expect(() => parse(content, 'src/comp.tsx')).toThrow(/^Syntax error at line \d+$/)
  })

  it('GAP-B-04 빈 JSX expression + 구문 오류 → 수정 없이 throw', () => {
    // ERROR 노드 text가 & 로 시작하지 않으므로 fixJsxAmpersandErrors는 noop.
    // parseFile의 5번 분기: fixed === content → 6번 throw.
    const content = `export function Comp() {
  return <div class="foo" onClick={!!!}>text</div>
}`
    expect(() => parse(content, 'src/comp.tsx')).toThrow(/^Syntax error at line \d+$/)
  })
})
