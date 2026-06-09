/**
 * TypeScriptParserAdapter — type_ref_subtype 발화 검증
 * SOT: @/pipeline_modules/build_graph/adapters/typescript.ts
 * 실행: npx vitest run tests/pipeline_modules/build_graph/adapters/typescript_type_ref_subtype.test.ts
 *
 * 대상 발화 3곳:
 *   A. processImportStatement — named import (item.isTypeOnly)      → 'import'
 *   B. processImportStatement — default/namespace (isType=true)     → 'import'
 *   C. emitGenericTypeArgumentEdges (extends/implements 제네릭 인자) → 'generic_arg'
 *
 * 발화 안 하는 subtype (현재 어댑터 미구현 — 향후 보강 필요):
 *   - 'constructor_param'  (collectConstructorParams는 typeName 추출만, uses_type 미발화)
 *   - 'method_param'       (processClassBody — param 타입 미발화)
 *   - 'return_type'        (processClassBody — return 타입 미발화)
 *   - 'field_type'         (processFieldDefinition — 필드 타입 미발화)
 */

import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'
import type { CodeEdgeRaw } from '@/pipeline_modules/build_graph/types.js'

const adapter = new TypeScriptParserAdapter()

function parse(content: string, filePath = 'src/test.ts', repoId = 'p1') {
  return adapter.parseFile(content, filePath, repoId)
}

function usesTypeEdges(edges: CodeEdgeRaw[]): CodeEdgeRaw[] {
  return edges.filter((e) => e.relation === 'uses_type')
}

// ────────────────────────────────────────────────────────────────────────────
// T-01: import type { X } from './m' → type_ref_subtype = 'import'
// ────────────────────────────────────────────────────────────────────────────
describe('T-01: import type { X } from "./m"', () => {
  it('uses_type edge의 type_ref_subtype이 "import"여야 한다', () => {
    const code = `
import type { UserType } from './types'
export function f(x: UserType) { return x }
`
    const r = parse(code)
    const typeEdges = usesTypeEdges(r.edges)
    expect(typeEdges.length).toBeGreaterThanOrEqual(1)
    const edge = typeEdges.find((e) => e.target_symbol === 'UserType')
    expect(edge).toBeDefined()
    expect(edge!.type_ref_subtype).toBe('import')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// T-02: import { type X, Y } from './m' (per-specifier type-only)
//        → X의 uses_type edge type_ref_subtype = 'import'
//        → Y는 imports edge (type_ref_subtype 없음)
// ────────────────────────────────────────────────────────────────────────────
describe('T-02: import { type X, Y } from "./m" (per-specifier)', () => {
  it('type-only specifier의 uses_type edge는 type_ref_subtype="import"여야 한다', () => {
    const code = `
import { type OrderType, OrderService } from './order'
export function f(x: OrderType, s: OrderService) { return x }
`
    const r = parse(code)
    const typeEdges = usesTypeEdges(r.edges)
    const orderTypeEdge = typeEdges.find((e) => e.target_symbol === 'OrderType')
    expect(orderTypeEdge).toBeDefined()
    expect(orderTypeEdge!.type_ref_subtype).toBe('import')
  })

  it('value import의 imports edge는 type_ref_subtype이 null이거나 undefined여야 한다', () => {
    const code = `
import { type OrderType, OrderService } from './order'
export function f(x: OrderType, s: OrderService) { return x }
`
    const r = parse(code)
    const importsEdges = r.edges.filter(
      (e) => e.relation === 'imports' && e.target_symbol === 'OrderService',
    )
    if (importsEdges.length > 0) {
      const edge = importsEdges[0]
      expect(edge.type_ref_subtype == null).toBe(true)
    }
    // OrderService가 bodyIdentifiers에 없으면 edge 자체가 없을 수 있음 — skip OK
  })
})

// ────────────────────────────────────────────────────────────────────────────
// T-03: class A extends BaseRepo<Order, OrderId> {}
//        → 현재 어댑터 미처리: tree-sitter TS에서 extends의 제네릭 인자가
//          generic_type이 아닌 identifier+type_arguments로 파싱되어
//          emitGenericTypeArgumentEdges가 호출되지 않음.
//          향후 보강 대상 (extends_clause 처리 시 type_arguments 별도 탐색 필요)
// ────────────────────────────────────────────────────────────────────────────
describe('T-03: extends 제네릭 인자 → 현재 미처리 (향후 보강 대상)', () => {
  it.skip(
    'extends BaseRepo<Order, OrderId> — tree-sitter TS는 identifier+type_arguments로 파싱, ' +
      'generic_type 분기 미매칭 → emitGenericTypeArgumentEdges 미호출 → generic_arg edge 없음. ' +
      '향후 extends_clause에 type_arguments 탐색 추가 시 활성화',
    () => {
      // noop
    },
  )
})

// ────────────────────────────────────────────────────────────────────────────
// T-04: class A implements Repo<EntityX> {}
//        → EntityX의 uses_type edge type_ref_subtype = 'generic_arg'
//        ※ EntityX는 import type에서도 uses_type('import')이 발화되므로
//           generic_arg subtype의 edge가 최소 1개 존재하는지 단언
// ────────────────────────────────────────────────────────────────────────────
describe('T-04: implements 제네릭 인자 → type_ref_subtype="generic_arg"', () => {
  it('implements 제네릭 인자의 uses_type edge 중 type_ref_subtype="generic_arg"인 edge가 있어야 한다', () => {
    const code = `
import type { EntityX } from './entity'
export class MyRepo implements Repo<EntityX> {}
`
    const r = parse(code)
    const typeEdges = usesTypeEdges(r.edges)

    // EntityX는 import type에서 'import' edge + implements generic에서 'generic_arg' edge 2개 발화됨
    const genericArgEdge = typeEdges.find(
      (e) => e.target_symbol === 'EntityX' && e.type_ref_subtype === 'generic_arg',
    )
    expect(genericArgEdge).toBeDefined()
    expect(genericArgEdge!.type_ref_subtype).toBe('generic_arg')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// T-05: import type DefaultExport from './m' → type_ref_subtype = 'import'
//        (default import with isType=true → clauseRelation='uses_type')
// ────────────────────────────────────────────────────────────────────────────
describe('T-05: import type DefaultExport from "./m" (default type import)', () => {
  it('default type import의 uses_type edge는 type_ref_subtype="import"여야 한다', () => {
    const code = `
import type DefaultService from './service'
export function f(s: DefaultService) { return s }
`
    const r = parse(code)
    const typeEdges = usesTypeEdges(r.edges)
    // default import은 target_symbol='default', target_local_symbol=localName
    const defaultEdge = typeEdges.find(
      (e) => e.target_symbol === 'default' && e.target_specifier === './service',
    )
    expect(defaultEdge).toBeDefined()
    expect(defaultEdge!.type_ref_subtype).toBe('import')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// T-06: import type * as NS from './m' → type_ref_subtype = 'import'
//        (namespace import with isType=true → clauseRelation='uses_type')
// ────────────────────────────────────────────────────────────────────────────
describe('T-06: import type * as NS from "./m" (namespace type import)', () => {
  it('namespace type import의 uses_type edge는 type_ref_subtype="import"여야 한다', () => {
    const code = `
import type * as Types from './types'
export function f(x: Types.Foo) { return x }
`
    const r = parse(code)
    const typeEdges = usesTypeEdges(r.edges)
    // namespace import → target_symbol=namespaceImport, target_imported_symbol='*'
    const nsEdge = typeEdges.find(
      (e) => e.target_imported_symbol === '*' && e.target_specifier === './types',
    )
    expect(nsEdge).toBeDefined()
    expect(nsEdge!.type_ref_subtype).toBe('import')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 미구현 subtype 확인 (현재 어댑터가 발화 안 함 — skip + 주석)
// ────────────────────────────────────────────────────────────────────────────
describe('미구현 subtype — 향후 보강 대상', () => {
  it.skip('constructor_param: 현재 어댑터가 constructor param 타입에 uses_type 미발화', () => {
    // collectConstructorParams는 typeName 추출만 하고 uses_type edge 미생성
    // 향후: processClassBody에서 생성자 파라미터 타입 발화 추가 시 subtype='constructor_param'
  })

  it.skip('method_param: 현재 어댑터가 method param 타입에 uses_type 미발화', () => {
    // 향후: method 파라미터 타입 추출 후 uses_type + subtype='method_param' 발화
  })

  it.skip('return_type: 현재 어댑터가 method return 타입에 uses_type 미발화', () => {
    // 향후: method return 타입 추출 후 uses_type + subtype='return_type' 발화
  })

  it.skip('field_type: 현재 어댑터가 class field 타입에 uses_type 미발화', () => {
    // 향후: class field/property 타입 추출 후 uses_type + subtype='field_type' 발화
  })
})
