/**
 * a4: process_exports — 갭 B 누락 시나리오 테스트
 *
 * 갭 B = tests.md §누락 시나리오 종합
 *   C-24, C-25, C-26, C-27, C-28, C-29, C-30
 *   G-06
 *   H-09, H-10, H-11
 *   I-06, I-07
 *   K-04, K-05, K-06
 *   RE-05
 *   LN-02, LN-03
 *
 * J-03/J-04 (namespace 한계)는 typescript.test.ts J-03~J-12로 이관 (한계 해소).
 *
 * GAP-C 해소 반영:
 *   - GAP-C-1: module.exports = identifier → variable 노드 (K-03 기존 수정 완료)
 *   - GAP-C-2: export { x as y } → name='y' (alias 우선)
 *   - GAP-C-3: decorator 중복 발화 제거
 *
 * 규칙: 코드 수정 금지. 기존 테스트 파일 수정 금지. 현재 코드 동작 기준으로 검증.
 */

import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

const adapter = new TypeScriptParserAdapter()

function parse(content: string, filePath = 'src/test.ts', repoId = 'p1') {
  return adapter.parseFile(content, filePath, repoId)
}

// ────────────────────────────────────────────────────────────────────────────
// export = (CJS interop) — 추가 시나리오
// ────────────────────────────────────────────────────────────────────────────
describe('a4 갭 B — export = (CJS interop) 추가 시나리오', () => {
  it('C-30 export = function foo(){} (function_expression) → function 노드 생성', () => {
    const r = parse('export = function namedFn() { return 1 }')
    const n = r.nodes.find(n => n.name === 'namedFn')
    expect(n?.type).toBe('function')
    expect(n?.exported).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// export default — 추가 시나리오
// ────────────────────────────────────────────────────────────────────────────
describe('a4 갭 B — export default 추가 시나리오', () => {
  it('C-27 export default myVar → 노드 미생성 (expression default, default case skip)', () => {
    // processExportDefault의 switch에서 identifier는 default case → break → 노드 미생성
    const r = parse('const myVar = 42; export default myVar')
    // 'default' 이름의 노드가 없어야 함
    const n = r.nodes.find(n => n.name === 'default')
    expect(n).toBeUndefined()
  })

  it('C-28 export default 42 → 노드 미생성 (literal default, default case skip)', () => {
    // number literal은 processExportDefault switch에서 default case → skip
    const r = parse('export default 42')
    const n = r.nodes.find(n => n.name === 'default')
    expect(n).toBeUndefined()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// re-export (with source) — 추가 시나리오
// ────────────────────────────────────────────────────────────────────────────
describe('a4 갭 B — re-export with source 추가 시나리오', () => {
  it('C-25 / RE-01 export { X as Y } from → target_symbol=공개 이름 Y, target_imported_symbol=원본 X', () => {
    // alias(공개 이름)로 import가 들어오므로 target_symbol=Y(공개), target_imported_symbol=X(source).
    // local named export(LN-02/C-24)의 alias-우선 정책 + import 별칭 정책과 일관 (GAP-C-2).
    // (이전엔 alias를 버려서 `export { default as svc }` barrel 체인이 해석되지 않았음.)
    const r = parse("export { OriginalName as AliasName } from './mod'")
    const e = r.edges.find(e => e.relation === 're_exports')
    expect(e).toBeDefined()
    expect(e!.target_symbol).toBe('AliasName')
    expect(e!.target_imported_symbol).toBe('OriginalName')
    expect(e!.target_specifier).toBe('./mod')
    expect(e!.resolve_status).toBe('resolved')
  })

  it('C-26 / RE-02 export type { X } from → re_exports 엣지 발화 (type-only 구분 없음)', () => {
    // tree-sitter에서 type keyword가 별도 토큰이나 현재 코드에서 특별 처리 없음
    // type-only re-export도 일반 re_exports와 동일하게 처리됨
    const r = parse("export type { SomeType } from './types'")
    const e = r.edges.find(e => e.relation === 're_exports' && e.target_symbol === 'SomeType')
    expect(e).toBeDefined()
    expect(e!.target_specifier).toBe('./types')
    expect(e!.resolve_status).toBe('resolved')
  })

  it('RE-03 re-export source_id = fileNodeId 확인 (repoId:filePath)', () => {
    const r = parse("export { foo } from './utils'", 'src/index.ts', 'myRepo')
    const e = r.edges.find(e => e.relation === 're_exports' && e.target_symbol === 'foo')
    expect(e).toBeDefined()
    // fileNodeId = repoId:filePath
    expect(e!.source_id).toBe('myRepo:src/index.ts')
  })

  it('RE-05 export {} from → export_clause에 specifier 없음 → 엣지 0개', () => {
    // export_clause는 있지만 specifier(export_specifier 자식)가 없으면 엣지 미발화
    const r = parse("export {} from './empty'")
    const reExportEdges = r.edges.filter(e => e.relation === 're_exports')
    expect(reExportEdges.length).toBe(0)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// local named export (no source) — 추가 시나리오
// ────────────────────────────────────────────────────────────────────────────
describe('a4 갭 B — local named export 추가 시나리오', () => {
  it('LN-02 / C-24 export { x as y } → name=alias(y), alias 우선 (GAP-C-2 해소)', () => {
    // spec §5.5: alias가 있으면 alias(공개 이름)로 노드 등록
    const r = parse('export { internalImpl as publicApi }')
    // alias='publicApi'로 등록되어야 함
    const publicNode = r.nodes.find(n => n.name === 'publicApi')
    expect(publicNode).toBeDefined()
    expect(publicNode?.type).toBe('variable')
    expect(publicNode?.exported).toBe(true)
    // 원본 이름 'internalImpl'로는 노드 없음
    const internalNode = r.nodes.find(n => n.name === 'internalImpl')
    expect(internalNode).toBeUndefined()
  })

  it('LN-03 local named export는 원 선언 노드를 exported로 승격하고 위치를 보존', () => {
    const r = parse(`const someVar = 1
export { someVar }`)
    const n = r.nodes.find(n => n.name === 'someVar')
    expect(n).toBeDefined()
    expect(n?.exported).toBe(true)
    expect(n?.line_start).toBe(1)
    expect(n?.line_end).toBe(1)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// declaration — variable (BS-11 chain initializer)
// ────────────────────────────────────────────────────────────────────────────
describe('a4 갭 B — declaration variable BS-11 chain initializer', () => {
  it('C-29 / H-10 export const router = Router() → variable 노드 + calls 엣지', () => {
    // processExportedVariable: call_expression → collectCallsFromBody 위임
    // 변수 노드(type='variable') 발화 + Router() calls 엣지 발화
    const r = parse(`import { Router } from 'express'
export const router = Router()`)
    const n = r.nodes.find(n => n.name === 'router')
    expect(n?.type).toBe('variable')
    expect(n?.exported).toBe(true)
    const callsEdge = r.edges.find(e => e.relation === 'calls' && e.target_symbol === 'Router')
    expect(callsEdge).toBeDefined()
  })

  it('H-09 export const app = new Hono() → variable 노드 + Hono calls edge (A2-4)', () => {
    // A2-4 — collectCallExpressionsRecursive에 new_expression 분기 추가:
    // new X(...)도 calls edge로 발화. Apollo/Hono 등 부트스트랩 패턴 일관 처리.
    const r = parse(`import { Hono } from 'hono'
export const app = new Hono()`)
    const n = r.nodes.find(n => n.name === 'app')
    expect(n?.type).toBe('variable')
    expect(n?.exported).toBe(true)
    const callsEdge = r.edges.find(e => e.relation === 'calls' && e.target_symbol === 'Hono')
    expect(callsEdge).toBeDefined()
    expect(callsEdge?.target_specifier).toBe('hono')
  })

  it('H-11 export let x = 1, y = 2 → 다중 declarator → x, y 각각 variable 노드', () => {
    const r = parse('export let x = 1, y = 2')
    const xNode = r.nodes.find(n => n.name === 'x')
    const yNode = r.nodes.find(n => n.name === 'y')
    expect(xNode?.type).toBe('variable')
    expect(xNode?.exported).toBe(true)
    expect(yNode?.type).toBe('variable')
    expect(yNode?.exported).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// G. processExportedFunction — calls 엣지 위임 검증
// ────────────────────────────────────────────────────────────────────────────
describe('a4 갭 B — processExportedFunction calls 엣지 위임', () => {
  it('G-06 export function body 내 호출 → calls 엣지 발화 (a6 위임)', () => {
    // processExportedFunction → collectCallsFromBody(node, ctx, ...) 위임
    // 함수 본문에서 호출하는 함수에 대한 calls 엣지가 발화되어야 함
    const r = parse(`import { helper } from './helper'
export function doWork() {
  return helper()
}`)
    const n = r.nodes.find(n => n.name === 'doWork')
    expect(n?.type).toBe('function')
    const callsEdge = r.edges.find(e => e.relation === 'calls' && e.target_symbol === 'helper')
    expect(callsEdge).toBeDefined()
    expect(callsEdge!.resolve_status).toBe('pending')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// I. enum — 추가 시나리오
// ────────────────────────────────────────────────────────────────────────────
describe('a4 갭 B — enum 추가 시나리오', () => {
  it('I-06 non-exported const enum → 내부 enum 노드와 enumValues 수집 (string 멤버만)', () => {
    // collectEnumValues(비export enum)는 const enum도 동일하게 처리
    const r = parse(`const enum Foo { A = 'a', B = 'b' }
export const x = Foo.A`, 'src/foo.ts')
    const n = r.nodes.find(n => n.name === 'Foo')
    expect(n?.type).toBe('enum')
    expect(n?.exported).toBe(false)
    expect(r.enumValues.get('p1:src/foo.ts:Foo.A')).toBe('a')
    expect(r.enumValues.get('p1:src/foo.ts:Foo.B')).toBe('b')
  })

  it('I-07 mixed enum (일부 string, 일부 numeric) → string 있는 것만 수집', () => {
    const r = parse(`export enum Mixed {
  StringVal = 'str',
  NumericVal = 1,
  NoVal,
}`, 'src/mixed.ts')
    const n = r.nodes.find(n => n.name === 'Mixed')
    expect(n?.type).toBe('enum')
    // string 멤버만 수집
    expect(r.enumValues.get('p1:src/mixed.ts:Mixed.StringVal')).toBe('str')
    // numeric/no-value는 미수집
    expect(r.enumValues.has('p1:src/mixed.ts:Mixed.NumericVal')).toBe(false)
    expect(r.enumValues.has('p1:src/mixed.ts:Mixed.NoVal')).toBe(false)
  })
})

// J. namespace 한계 시나리오는 typescript.test.ts J-03~J-12로 이관
// (function/class/interface/type/enum/nested ns 멤버 dispatch 지원하면서 한계 해소)

// ────────────────────────────────────────────────────────────────────────────
// K. module.exports — 추가 시나리오
// ────────────────────────────────────────────────────────────────────────────
describe('a4 갭 B — module.exports 추가 시나리오', () => {
  it('K-04 module.exports = class {} → anonymous class → name="default"', () => {
    // processModuleExportsAssignment: class type → processExportedClass
    // anonymous class (이름 없음) → processExportedClass에서 name='default'
    const r = parse('module.exports = class {}')
    const n = r.nodes.find(n => n.name === 'default')
    expect(n).toBeDefined()
    expect(n?.type).toBe('class')
    expect(n?.exported).toBe(true)
  })

  it('K-05 module.exports = function() {} → anonymous function → name="default"', () => {
    // processModuleExportsAssignment: function_expression type
    // nameNode = value.childForFieldName('name') → null (anonymous)
    // name = nameNode?.text ?? 'default' → 'default'
    const r = parse('module.exports = function() { return 1 }')
    const n = r.nodes.find(n => n.name === 'default')
    expect(n).toBeDefined()
    expect(n?.type).toBe('function')
    expect(n?.exported).toBe(true)
  })

  it('K-06 module.exports = { a, b } → object literal → 노드 미생성', () => {
    // processModuleExportsAssignment: object literal은 처리 분기 없음 → 노드 미생성
    const r = parse('module.exports = { a: 1, b: 2 }')
    // 어떤 노드도 발화 안 됨
    expect(r.nodes.filter(n => n.exported)).toHaveLength(0)
  })
})
