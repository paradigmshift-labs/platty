/**
 * 카테고리 D — React Hook + JSX 고급
 *
 * 시나리오:
 *   - useState/useEffect/useQuery — 객체 인자
 *   - JSX ternary: cond ? <A /> : <B />
 *   - JSX in map callback: arr.map(x => <Foo key={x.id} />)
 *   - JSX with spread: <Foo {...props} />
 *   - JSX conditional rendering: {cond && <A />}
 *   - <Component>{children}</Component> children
 *   - 동일 컴포넌트 여러 번 사용 — 여러 edge
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

function parse(content: string, filePath = 'src/p.tsx') {
  const adapter = new TypeScriptParserAdapter()
  return adapter.parseFile(content, filePath, 'r1')
}

describe('D. React Hook + JSX 고급', () => {
  it('D-01: useState(initialValue) — 단순 호출', () => {
    const r = parse(`
      import { useState } from 'react'
      export function C() { const [v, set] = useState(0); return null }
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'useState')
    expect(e).toBeDefined()
    expect(e!.target_specifier).toBe('react')
  })

  it('D-02: useEffect(() => {...}, [dep]) — 객체/배열 인자', () => {
    const r = parse(`
      import { useEffect } from 'react'
      export function C(dep: any) { useEffect(() => {}, [dep]); return null }
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'useEffect')
    expect(e).toBeDefined()
    // 첫 인자 arrow function → null, 두 번째 [dep] 배열 → [null]
    expect(e!.literal_args).toBe(JSON.stringify([null, [null]]))
  })

  it('D-03: useQuery({ queryKey, queryFn, staleTime }) — 객체 config', () => {
    const r = parse(`
      import { useQuery } from '@tanstack/react-query'
      export function C() {
        useQuery({ queryKey: ['orders'], queryFn: fetchOrders, staleTime: 5000 })
        return null
      }
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'useQuery')
    expect(e).toBeDefined()
    // queryKey: ['orders'] string 보존, queryFn: 식별자 → null, staleTime: 5000 숫자
    expect(e!.literal_args).toBe(
      JSON.stringify([{ queryKey: ['orders'], queryFn: null, staleTime: 5000 }]),
    )
  })

  it('D-04: JSX ternary — cond ? <A /> : <B /> → 두 renders edge', () => {
    const r = parse(`
      import { A, B } from './c'
      export function Page({ cond }: any) { return cond ? <A /> : <B /> }
    `)
    const renders = r.edges.filter((e) => e.relation === 'renders')
    const symbols = renders.map((e) => e.target_symbol).sort()
    expect(symbols).toEqual(['A', 'B'])
  })

  it('D-05: JSX in map callback — arr.map(x => <Foo />)', () => {
    const r = parse(`
      import { Foo } from './c'
      export function List({ items }: any) {
        return <ul>{items.map((x: any) => <Foo key={x.id} value={x.name} />)}</ul>
      }
    `)
    const e = r.edges.find((edge) => edge.relation === 'renders' && edge.target_symbol === 'Foo')
    expect(e).toBeDefined()
    expect(e!.source_id.endsWith(':List')).toBe(true)
  })

  it('D-06: JSX prop spread <Foo {...props} /> — spread는 props 객체에서 무시 (E5 spec)', () => {
    const r = parse(`
      import { Foo } from './c'
      export function P(props: any) { return <Foo {...props} title="x" /> }
    `)
    const e = r.edges.find((edge) => edge.relation === 'renders' && edge.target_symbol === 'Foo')
    expect(e).toBeDefined()
    // spread 무시, title만 보존
    expect(e!.literal_args).toBe(JSON.stringify([{ title: 'x' }]))
  })

  it('D-07: JSX conditional rendering — {cond && <A />} → renders edge', () => {
    const r = parse(`
      import { A } from './c'
      export function P({ cond }: any) { return <div>{cond && <A />}</div> }
    `)
    const e = r.edges.find((edge) => edge.relation === 'renders' && edge.target_symbol === 'A')
    expect(e).toBeDefined()
  })

  it('D-08: 같은 컴포넌트 여러 번 사용 — 각각 별 edge', () => {
    const r = parse(`
      import { Item } from './c'
      export function P() { return <div><Item /><Item /><Item /></div> }
    `)
    const edges = r.edges.filter((e) => e.relation === 'renders' && e.target_symbol === 'Item')
    expect(edges).toHaveLength(3)
  })

  it('D-09: <Component>{children}</Component> — children content는 ignore, render edge만', () => {
    const r = parse(`
      import { Wrapper } from './c'
      export function P() { return <Wrapper>Hello, world</Wrapper> }
    `)
    const e = r.edges.find((edge) => edge.relation === 'renders' && edge.target_symbol === 'Wrapper')
    expect(e).toBeDefined()
  })

  it('D-10: nested 컴포넌트 트리 — <Layout><Header /><Main /></Layout>', () => {
    const r = parse(`
      import { Layout, Header, Main } from './c'
      export function Page() {
        return <Layout><Header /><Main /></Layout>
      }
    `)
    const symbols = r.edges
      .filter((e) => e.relation === 'renders')
      .map((e) => e.target_symbol)
      .sort()
    expect(symbols).toEqual(['Header', 'Layout', 'Main'])
  })

  it('D-11: useReducer + useContext — 다중 hook 호출', () => {
    const r = parse(`
      import { useReducer, useContext } from 'react'
      import { AppContext } from './ctx'
      export function P() {
        const [state, dispatch] = useReducer((s: any, a: any) => s, {})
        const ctx = useContext(AppContext)
        return null
      }
    `)
    const reducer = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'useReducer')
    const context = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'useContext')
    expect(reducer).toBeDefined()
    expect(context).toBeDefined()
  })

  it('D-12: arrow function component → renders edge에 source_id가 const 변수 노드', () => {
    const r = parse(`
      import { Foo } from './c'
      export const Page = () => <Foo />
    `)
    const e = r.edges.find((edge) => edge.relation === 'renders' && edge.target_symbol === 'Foo')
    expect(e).toBeDefined()
    expect(e!.source_id.endsWith(':Page')).toBe(true)
  })
})
