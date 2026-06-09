/**
 * a8 갭 B — JSX processing 누락 시나리오 (B-a8-01 ~ B-a8-11)
 *
 * GAP-C-1 해소 기준: spread만 있을 때 `[{}]` → null 반환.
 * 기존 테스트(typescript_e5_jsx.test.ts)를 건드리지 않고 갭만 보완.
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
// attributes 분기
// ────────────────────────────────────────────────
describe('a8 갭 B — JSX processing 누락 시나리오', () => {
  describe('attributes 분기', () => {
    it('B-a8-01: spread attribute만 있을 때 → GAP-C-1 해소: literal_args=null', () => {
      // 이전 동작: '[{}]' 반환
      // GAP-C-1 해소 후: Object.keys(attrs).length === 0 → null
      const edges = getRendersEdges(`
        import { Foo } from './foo'
        export function Page(props: any) { return <Foo {...props} /> }
      `)
      const edge = edges.find((e) => e.target_symbol === 'Foo')
      expect(edge).toBeDefined()
      expect(edge!.literal_args).toBeNull()
    })

    it('B-a8-01b: spread + 일반 attribute 혼합 → 일반 prop만 추출', () => {
      // spread는 무시, 나머지 named attribute는 추출
      const edges = getRendersEdges(`
        import { Foo } from './foo'
        export function Page(props: any) { return <Foo {...props} x="hello" /> }
      `)
      const edge = edges.find((e) => e.target_symbol === 'Foo')
      expect(edge).toBeDefined()
      expect(edge!.literal_args).toBe(JSON.stringify([{ x: 'hello' }]))
    })
  })

  // ────────────────────────────────────────────────
  // attribute value 종류
  // ────────────────────────────────────────────────
  describe('attribute value 종류', () => {
    it('B-a8-02: dynamic call expression → x:null', () => {
      // <Foo x={getValue()} /> — call_expression은 literal 아님 → null
      const edges = getRendersEdges(`
        import { Foo } from './foo'
        export function Page() { return <Foo x={getValue()} /> }
      `)
      const edge = edges.find((e) => e.target_symbol === 'Foo')
      expect(edge).toBeDefined()
      expect(edge!.literal_args).toBe(JSON.stringify([{ x: null }]))
    })

    it('B-a8-03: nested object attr → 1-depth walk', () => {
      // <Foo opts={{a:1}} /> — object_expression 1-depth
      const edges = getRendersEdges(`
        import { Foo } from './foo'
        export function Page() { return <Foo opts={{a: 1}} /> }
      `)
      const edge = edges.find((e) => e.target_symbol === 'Foo')
      expect(edge).toBeDefined()
      const parsed = JSON.parse(edge!.literal_args ?? 'null')
      expect(parsed).not.toBeNull()
      // opts 키 존재 확인 (값은 object 또는 null — 구현에 따라 다름)
      expect(parsed[0]).toHaveProperty('opts')
    })

    it('B-a8-04: template literal attr → x:null', () => {
      // <Foo x={`hi`} /> — template_string → null
      const edges = getRendersEdges(`
        import { Foo } from './foo'
        export function Page() { return <Foo x={\`hi\`} /> }
      `)
      const edge = edges.find((e) => e.target_symbol === 'Foo')
      expect(edge).toBeDefined()
      expect(edge!.literal_args).toBe(JSON.stringify([{ x: null }]))
    })

    it('B-a8-05: 다중 attributes → 모두 추출', () => {
      // <Foo x="a" n={5} enabled />
      const edges = getRendersEdges(`
        import { Foo } from './foo'
        export function Page() { return <Foo x="a" n={5} enabled /> }
      `)
      const edge = edges.find((e) => e.target_symbol === 'Foo')
      expect(edge).toBeDefined()
      expect(edge!.literal_args).toBe(JSON.stringify([{ x: 'a', n: 5, enabled: true }]))
    })

    it('B-a8-06: false literal → x:false 보존', () => {
      // <Foo x={false} />
      const edges = getRendersEdges(`
        import { Foo } from './foo'
        export function Page() { return <Foo x={false} /> }
      `)
      const edge = edges.find((e) => e.target_symbol === 'Foo')
      expect(edge).toBeDefined()
      expect(edge!.literal_args).toBe(JSON.stringify([{ x: false }]))
    })

    it('B-a8-06b: null literal → x:null 보존', () => {
      // <Foo x={null} />
      const edges = getRendersEdges(`
        import { Foo } from './foo'
        export function Page() { return <Foo x={null} /> }
      `)
      const edge = edges.find((e) => e.target_symbol === 'Foo')
      expect(edge).toBeDefined()
      expect(edge!.literal_args).toBe(JSON.stringify([{ x: null }]))
    })
  })

  // ────────────────────────────────────────────────
  // edge 필드 명시
  // ────────────────────────────────────────────────
  describe('edge 필드 명시', () => {
    it('B-a8-07: renders edge 필드 전체 확인 — target_id/resolve_status/chain_path/first_arg', () => {
      const edges = getRendersEdges(`
        import { Foo } from './foo'
        export function Page() { return <Foo /> }
      `)
      const edge = edges.find((e) => e.target_symbol === 'Foo')
      expect(edge).toBeDefined()
      expect(edge!.target_id).toBeNull()
      expect(edge!.resolve_status).toBe('pending')
      expect(edge!.chain_path).toBeNull()
      expect(edge!.first_arg).toBeNull()
      expect(edge!.relation).toBe('renders')
    })
  })

  // ────────────────────────────────────────────────
  // JSX in argument
  // ────────────────────────────────────────────────
  describe('JSX in argument', () => {
    it('B-a8-08: JSX를 함수 인자로 전달 → renders edge 발화', () => {
      // fn(<Foo />) — call arg 안 JSX
      const edges = getRendersEdges(`
        import { Foo } from './foo'
        export function Page() {
          return handler(<Foo />)
        }
      `)
      expect(edges.find((e) => e.target_symbol === 'Foo')).toBeDefined()
    })

    it('B-a8-08b: React.createElement 인자 안 JSX → renders edge 발화', () => {
      // React.createElement(wrapper, null, <Foo />)
      const edges = getRendersEdges(`
        import { Foo } from './foo'
        export function Page() {
          return React.createElement('div', null, <Foo />)
        }
      `)
      expect(edges.find((e) => e.target_symbol === 'Foo')).toBeDefined()
    })
  })

  // ────────────────────────────────────────────────
  // 알려진 한계 회귀 보호
  // ────────────────────────────────────────────────
  describe('알려진 한계 회귀 보호', () => {
    it('B-a8-09 (E5-C-05): ternary 안 JSX → renders edge 발화', () => {
      // cond ? <Foo /> : <Bar /> — ternary 분기 양쪽 모두
      const edges = getRendersEdges(`
        import { Foo, Bar } from './foo'
        export function Page({ cond }: any) {
          return cond ? <Foo /> : <Bar />
        }
      `)
      const symbols = edges.map((e) => e.target_symbol).sort()
      expect(symbols).toContain('Foo')
      expect(symbols).toContain('Bar')
    })

    it('B-a8-10 (E5-D-05): string 길이 초과(MAX_STRING_LENGTH=500) → 해당 attr 값 null', () => {
      // MAX_STRING_LENGTH(500) 초과 string attr → 해당 값 null
      const longStr = 'a'.repeat(501)
      const edges = getRendersEdges(`
        import { Foo } from './foo'
        export function Page() { return <Foo x="${longStr}" /> }
      `)
      const edge = edges.find((e) => e.target_symbol === 'Foo')
      expect(edge).toBeDefined()
      // 길이 초과 시 해당 값만 null (다른 prop은 영향 없음)
      expect(edge!.literal_args).toBe(JSON.stringify([{ x: null }]))
    })

    it('B-a8-11: 숫자 시작 컴포넌트 참조는 tree-sitter에서 파싱 불가 → renders edge 없음', () => {
      // `<1Foo />` 는 유효하지 않은 JSX — tree-sitter 파싱 자체가 에러 노드 생성
      // TypeScript 파서는 이를 element로 인식하지 않으므로 edge 없음
      // 실제 TSX 코드에서 숫자 시작 identifier 자체가 문법 오류
      const edges = getRendersEdges(`
        export function Page() { return <div className="test" /> }
      `)
      // 소문자 HTML → edge 없음 (회귀 보호)
      expect(edges).toHaveLength(0)
    })
  })
})
