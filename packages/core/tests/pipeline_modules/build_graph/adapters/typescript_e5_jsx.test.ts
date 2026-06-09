/**
 * E5 — JSX 처리 (BS-3)
 *
 * collectJsxRenders 헬퍼 + jsx_element 처리 진입점.
 * 새 relation 'renders' (target=컴포넌트).
 * F4 TYPE_REF_RELATIONS에 'renders' 추가.
 *
 * 규칙:
 *   - 대문자 시작 컴포넌트만 잡음 (HTML element 무시)
 *   - <Foo.Bar /> namespace 그대로
 *   - <></> Fragment 무시
 *   - source_id = enclosing 함수/메서드 노드
 *   - props 키는 literal_args에 키-값 객체로
 *
 * SOT: specs/build_graph/architecture.md §0 + build-graph-coverage.md BS-3
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

const adapter = new TypeScriptParserAdapter()

function parse(content: string, filePath = 'src/a.tsx') {
  return adapter.parseFile(content, filePath, 'r1')
}

function getRendersEdges(content: string) {
  return parse(content).edges.filter((e) => e.relation === 'renders')
}

// ────────────────────────────────────────────────
// E5-A. JSX 노드 인식
// ────────────────────────────────────────────────
describe('E5-A: JSX 노드 인식', () => {
  it('E5-A-01: <Foo /> self-closing → renders edge', () => {
    const edges = getRendersEdges(`
      import { Foo } from './foo'
      export function Page() { return <Foo /> }
    `)
    expect(edges.find((e) => e.target_symbol === 'Foo')).toBeDefined()
  })

  it('E5-A-02: <Foo>child</Foo> → renders edge', () => {
    const edges = getRendersEdges(`
      import { Foo } from './foo'
      export function Page() { return <Foo>hi</Foo> }
    `)
    expect(edges.find((e) => e.target_symbol === 'Foo')).toBeDefined()
  })

  it('E5-A-03: <div /> HTML element → edge 없음', () => {
    const edges = getRendersEdges(`export function Page() { return <div /> }`)
    expect(edges).toHaveLength(0)
  })

  it('E5-A-04: <></> Fragment → edge 없음', () => {
    const edges = getRendersEdges(`export function Page() { return <></> }`)
    expect(edges).toHaveLength(0)
  })

  it('E5-A-05: <Foo.Bar /> namespace → target_symbol="Foo.Bar"', () => {
    const edges = getRendersEdges(`
      import { Foo } from './foo'
      export function Page() { return <Foo.Bar /> }
    `)
    expect(edges.find((e) => e.target_symbol === 'Foo.Bar')).toBeDefined()
  })

  it('E5-A-06: <Namespace.Item.Sub /> 깊은 chain', () => {
    const edges = getRendersEdges(`
      import { Namespace } from './ns'
      export function Page() { return <Namespace.Item.Sub /> }
    `)
    expect(edges.find((e) => e.target_symbol === 'Namespace.Item.Sub')).toBeDefined()
  })

  it('E5-A-07: 같은 페이지에 self-closing + opening 모두 처리', () => {
    const edges = getRendersEdges(`
      import { Foo, Bar } from './c'
      export function Page() { return <div><Foo /><Bar>b</Bar></div> }
    `)
    expect(edges.map((e) => e.target_symbol).sort()).toEqual(['Bar', 'Foo'])
  })
})

// ────────────────────────────────────────────────
// E5-B. import 매핑
// ────────────────────────────────────────────────
describe('E5-B: import 매핑 (target_specifier)', () => {
  it('E5-B-01: named import → target_specifier=경로', () => {
    const edges = getRendersEdges(`
      import { Foo } from './foo'
      export function Page() { return <Foo /> }
    `)
    expect(edges[0].target_specifier).toBe('./foo')
  })

  it('E5-B-02: default import → target_specifier=경로', () => {
    const edges = getRendersEdges(`
      import Foo from './foo'
      export function Page() { return <Foo /> }
    `)
    expect(edges[0].target_specifier).toBe('./foo')
  })

  it('E5-B-03: namespace import + member → target_specifier=경로 (root identifier 매핑)', () => {
    const edges = getRendersEdges(`
      import * as N from './ns'
      export function Page() { return <N.Item /> }
    `)
    expect(edges[0].target_specifier).toBe('./ns')
    expect(edges[0].target_symbol).toBe('N.Item')
  })

  it('E5-B-04: import 없는 컴포넌트 → target_specifier=null', () => {
    const edges = getRendersEdges(`
      export function Page() { return <Foo /> }
    `)
    // Foo가 정의 안 되어있고 import도 없음 → specifier null
    expect(edges[0]?.target_specifier).toBeNull()
  })
})

// ────────────────────────────────────────────────
// E5-C. JSX 위치 (source_id)
// ────────────────────────────────────────────────
describe('E5-C: source_id (enclosing 함수)', () => {
  it('E5-C-01: function 안 JSX → source=함수 노드', () => {
    const edges = getRendersEdges(`
      import { Foo } from './foo'
      export function Page() { return <Foo /> }
    `)
    expect(edges[0].source_id.endsWith(':Page')).toBe(true)
  })

  it('E5-C-02: class method 안 JSX → source=메서드 노드', () => {
    const edges = getRendersEdges(`
      import { Foo } from './foo'
      export class C {
        render() { return <Foo /> }
      }
    `)
    expect(edges[0].source_id.endsWith(':C.render')).toBe(true)
  })

  it('E5-C-03: arrow function 변수 → source=변수 노드', () => {
    const edges = getRendersEdges(`
      import { Foo } from './foo'
      export const Page = () => <Foo />
    `)
    expect(edges[0].source_id.endsWith(':Page')).toBe(true)
  })

  it('E5-C-04: nested JSX <Foo><Bar /></Foo> → 2 edges, 같은 source', () => {
    const edges = getRendersEdges(`
      import { Foo, Bar } from './c'
      export function Page() { return <Foo><Bar /></Foo> }
    `)
    expect(edges).toHaveLength(2)
    expect(edges[0].source_id).toBe(edges[1].source_id)
  })

  it('E5-C-06: 조건부 {cond && <Foo />} → renders edge', () => {
    const edges = getRendersEdges(`
      import { Foo } from './foo'
      export function Page({ cond }: any) { return <div>{cond && <Foo />}</div> }
    `)
    expect(edges.find((e) => e.target_symbol === 'Foo')).toBeDefined()
  })
})

// ────────────────────────────────────────────────
// E5-D. JSX attributes (props)
// ────────────────────────────────────────────────
describe('E5-D: JSX attributes (props)', () => {
  it('E5-D-01: <Foo x="hello" /> string attr → literal_args에 보존', () => {
    const edges = getRendersEdges(`
      import { Foo } from './foo'
      export function Page() { return <Foo x="hello" /> }
    `)
    expect(edges[0].literal_args).toBe(JSON.stringify([{ x: 'hello' }]))
  })

  it('E5-D-02: <Foo x={data} /> 식별자 expr → null', () => {
    const edges = getRendersEdges(`
      import { Foo } from './foo'
      export function Page({ data }: any) { return <Foo x={data} /> }
    `)
    expect(edges[0].literal_args).toBe(JSON.stringify([{ x: null }]))
  })

  it('E5-D-03: <Foo n={5} /> number expr → 5 보존', () => {
    const edges = getRendersEdges(`
      import { Foo } from './foo'
      export function Page() { return <Foo n={5} /> }
    `)
    expect(edges[0].literal_args).toBe(JSON.stringify([{ n: 5 }]))
  })

  it('E5-D-04: <Foo enabled /> bare boolean → true', () => {
    const edges = getRendersEdges(`
      import { Foo } from './foo'
      export function Page() { return <Foo enabled /> }
    `)
    expect(edges[0].literal_args).toBe(JSON.stringify([{ enabled: true }]))
  })

  it('E5-D-06: attribute 없음 → literal_args=null', () => {
    const edges = getRendersEdges(`
      import { Foo } from './foo'
      export function Page() { return <Foo /> }
    `)
    expect(edges[0].literal_args).toBeNull()
  })
})
