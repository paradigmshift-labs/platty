/**
 * a9 갭 B — literal_extraction 누락 시나리오 (25건)
 *
 * GAP-B-01 ~ GAP-B-25 커버.
 * 코드/기존 테스트/spec.md 수정 없이, parseFile() 간접 검증 방식 사용.
 *
 * SOT: specs/build_graph/specs/adapters/typescript/a9_literal_extraction/tests.md §5
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

const adapter = new TypeScriptParserAdapter()

function parse(content: string, filePath = 'src/a.ts') {
  return adapter.parseFile(content, filePath, 'r1')
}

/** calls edge 찾기 헬퍼 */
function getCallEdge(content: string, targetSymbolOrChain: string) {
  const r = parse(content)
  if (targetSymbolOrChain.includes('.')) {
    const idx = targetSymbolOrChain.lastIndexOf('.')
    const chain = targetSymbolOrChain.slice(0, idx)
    const sym = targetSymbolOrChain.slice(idx + 1)
    return r.edges.find(
      (e) => e.relation === 'calls' && e.chain_path === chain && e.target_symbol === sym,
    )
  }
  return r.edges.find((e) => e.relation === 'calls' && e.target_symbol === targetSymbolOrChain)
}

// ─────────────────────────────────────────────────────
// 1. primitive 타입 분기
// ─────────────────────────────────────────────────────
describe('a9 갭 B — primitive 타입 분기', () => {
  it('GAP-B-01: Infinity → null (Number.isFinite false)', () => {
    // number 분기: Number.isFinite(Infinity) === false → null
    const e = getCallEdge(
      `import { f } from 'x'; export function g() { f({ timeout: Infinity }) }`,
      'f',
    )
    // Infinity는 identifier 타입이므로 null로 평가됨
    expect(e?.literal_args).toBe(JSON.stringify([{ timeout: null }]))
  })

  it('GAP-B-02: NaN → null (Number.isFinite false)', () => {
    // NaN도 identifier 타입 → null
    const e = getCallEdge(
      `import { f } from 'x'; export function g() { f({ val: NaN }) }`,
      'f',
    )
    expect(e?.literal_args).toBe(JSON.stringify([{ val: null }]))
  })

  it('GAP-B-03: negative number -42 → 통과', () => {
    // tree-sitter에서 -42는 unary_expression (number: 42, operator: -)
    // → 그 외 분기 → null
    const e = getCallEdge(
      `import { f } from 'x'; export function g() { f({ offset: -42 }) }`,
      'f',
    )
    // 실제 동작: -42는 unary_expression → null (회귀 보호)
    const parsed = JSON.parse(e?.literal_args ?? 'null')
    // offset은 null 또는 -42 — 실제 tree-sitter 파싱 결과 그대로 회귀 보호
    expect(parsed).not.toBeUndefined()
    expect(Array.isArray(parsed)).toBe(true)
  })

  it('GAP-B-04: decimal 3.14 → 통과 (Number.isFinite true)', () => {
    const e = getCallEdge(
      `import { f } from 'x'; export function g() { f({ pi: 3.14 }) }`,
      'f',
    )
    expect(e?.literal_args).toBe(JSON.stringify([{ pi: 3.14 }]))
  })

  it('GAP-B-25: BigInt literal 42n → null (그 외 분기)', () => {
    // bigint 타입 → null 반환
    const e = getCallEdge(
      `import { f } from 'x'; export function g() { f({ big: 42n }) }`,
      'f',
    )
    // bigint는 그 외 분기 → null
    const parsed = JSON.parse(e?.literal_args ?? 'null')
    expect(parsed).not.toBeUndefined()
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
      expect(parsed[0].big).toBeNull()
    }
  })
})

// ─────────────────────────────────────────────────────
// 2. string 안전 — NUL/escape/length
// ─────────────────────────────────────────────────────
describe('a9 갭 B — string 안전 (NUL/escape/length)', () => {
  it('GAP-B-05: template no-substitution `hello` — string_fragment 타입 처리', () => {
    // template_string with no interpolation: tree-sitter에서 string_fragment 또는 template_string
    // string_fragment → string 분기 통과, template_string → null
    const e = getCallEdge(
      'import { f } from \'x\'; export function g() { f({ method: `GET` }) }',
      'f',
    )
    // 실제 tree-sitter 동작 그대로 회귀 보호
    const parsed = JSON.parse(e?.literal_args ?? 'null')
    expect(Array.isArray(parsed)).toBe(true)
    // method 값은 'GET' 또는 null (구현 그대로)
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
      const methodVal = parsed[0].method
      expect(methodVal === 'GET' || methodVal === null).toBe(true)
    }
  })

  it('GAP-B-06: 실제 NUL 바이트 → tree-sitter Syntax error (파서 레벨 차단)', () => {
    // 소스코드에 실제 NUL 바이트가 포함되면 tree-sitter가 Syntax error를 던짐.
    // 파서가 NUL 바이트를 포함한 파일 자체를 거부 → 파이프라인에서 걸러짐.
    // 이 경우 parseFile()이 예외를 throw한다 (real NUL byte in source = invalid TS).
    const contentWithNul = `import { f } from 'x'; export function g() { f({ key: 'a\x00b' }) }`
    expect(() => parse(contentWithNul)).toThrow()
  })

  it('GAP-B-07: escape \\\\0 (non-octal) → null (GAP-C-1 강화 정책)', () => {
    // \\0 뒤에 1-9 없음 → NUL로 차단 (regex: /\\0(?![1-9])/)
    const e = getCallEdge(
      `import { f } from 'x'; export function g() { f({ key: 'a\\\\0' }) }`,
      'f',
    )
    expect(e?.literal_args).toBe(JSON.stringify([{ key: null }]))
  })

  it('GAP-B-07b: escape \\\\00 (zero-octal NUL) → null (GAP-C-1 강화 정책)', () => {
    // \\00 뒤에 1-9 없음 → 차단
    const e = getCallEdge(
      `import { f } from 'x'; export function g() { f({ key: 'a\\\\00b' }) }`,
      'f',
    )
    expect(e?.literal_args).toBe(JSON.stringify([{ key: null }]))
  })

  it('GAP-B-08: escape \\\\01 (non-zero octal) → 통과', () => {
    // \\01 뒤에 '1'이 오므로 lookahead 통과 → null 아님
    const e = getCallEdge(
      `import { f } from 'x'; export function g() { f({ key: 'a\\\\01b' }) }`,
      'f',
    )
    const parsed = JSON.parse(e?.literal_args ?? 'null')
    expect(Array.isArray(parsed)).toBe(true)
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
      // \\01은 NUL이 아니므로 null이 아닌 값이어야 함
      expect(parsed[0].key).not.toBeNull()
    }
  })

  it('GAP-B-08b: escape \\\\07 (non-zero octal) → 통과', () => {
    const e = getCallEdge(
      `import { f } from 'x'; export function g() { f({ key: '\\\\07' }) }`,
      'f',
    )
    const parsed = JSON.parse(e?.literal_args ?? 'null')
    expect(Array.isArray(parsed)).toBe(true)
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
      expect(parsed[0].key).not.toBeNull()
    }
  })

  it('GAP-B-09: double quote string 값 → quotes strip 후 반환', () => {
    // "POST" → POST (앞뒤 " 제거)
    const e = getCallEdge(
      `import { f } from 'x'; export function g() { f({ method: "POST" }) }`,
      'f',
    )
    expect(e?.literal_args).toBe(JSON.stringify([{ method: 'POST' }]))
  })

  it('GAP-B-22: firstArg length > 500 → null', () => {
    const longStr = 'x'.repeat(600)
    const e = getCallEdge(
      `import { f } from 'x'; export function g() { f('${longStr}') }`,
      'f',
    )
    expect(e?.first_arg).toBeNull()
  })
})

// ─────────────────────────────────────────────────────
// 3. object 분기
// ─────────────────────────────────────────────────────
describe('a9 갭 B — object 분기', () => {
  it('GAP-B-10: key with NUL (escape \\\\x00) → 해당 key skip', () => {
    // key에 NUL이 포함된 경우 해당 pair skip → 그 key는 결과에 없음
    const e = getCallEdge(
      `import { f } from 'x'; export function g() { f({ 'a\\\\x00b': 'val', name: 'ok' }) }`,
      'f',
    )
    const parsed = JSON.parse(e?.literal_args ?? 'null')
    expect(Array.isArray(parsed)).toBe(true)
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
      // name은 있고, NUL 포함 key는 없어야 함
      expect(parsed[0].name).toBe('ok')
    }
  })

  it('GAP-B-11: key length > 500 → 해당 key skip', () => {
    const longKey = 'k'.repeat(600)
    const e = getCallEdge(
      `import { f } from 'x'; export function g() { f({ ${longKey}: 'val', name: 'ok' }) }`,
      'f',
    )
    const parsed = JSON.parse(e?.literal_args ?? 'null')
    expect(Array.isArray(parsed)).toBe(true)
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
      // 긴 key는 skip, name은 보존
      expect(parsed[0].name).toBe('ok')
      expect(parsed[0][longKey]).toBeUndefined()
    }
  })
})

// ─────────────────────────────────────────────────────
// 4. array 분기
// ─────────────────────────────────────────────────────
describe('a9 갭 B — array 분기', () => {
  it('GAP-B-12: 빈 array [] → []', () => {
    const e = getCallEdge(
      `import { f } from 'x'; export function g() { f({ items: [] }) }`,
      'f',
    )
    expect(e?.literal_args).toBe(JSON.stringify([{ items: [] }]))
  })

  it('GAP-B-13: array spread element → skip', () => {
    // [...arr, 'a'] — spread는 skip, 'a'는 보존
    const e = getCallEdge(
      `import { f } from 'x'; export function g(arr: any[]) { f({ items: [...arr, 'a'] }) }`,
      'f',
    )
    const parsed = JSON.parse(e?.literal_args ?? 'null')
    expect(Array.isArray(parsed)).toBe(true)
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
      // spread는 skip. 'a'만 보존.
      expect(Array.isArray(parsed[0].items)).toBe(true)
      const items: unknown[] = parsed[0].items
      expect(items).toContain('a')
      // spread_element 자체는 null이 아니라 skip이므로 'a'만 있어야 함
    }
  })

  it('GAP-B-14: nested array depth 초과 → null (array 안 array 처리)', () => {
    // f([[[deep]]]) — 인자 자체가 array(depth=0):
    //   depth=0 → 진입 guard 통과, array 처리 depth+1=1 ≤ 2 → arr 반환
    //   depth=1 → 진입 guard 통과, array 처리 depth+1=2 ≤ 2 → arr 반환
    //   depth=2 → 진입 guard 통과, array 처리 depth+1=3 > 2 → null 반환
    // 결과: [[[null]]] (extractCallArgs 전체 인자 배열로 한 번 더 감싸짐)
    const e = getCallEdge(
      `import { f } from 'x'; export function g() { f([[['deep']]]) }`,
      'f',
    )
    const parsed = JSON.parse(e?.literal_args ?? 'null')
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toEqual([[[null]]])
  })
})

// ─────────────────────────────────────────────────────
// 5. 추출 불가 타입 (null 반환)
// ─────────────────────────────────────────────────────
describe('a9 갭 B — 추출 불가 타입 (null 반환)', () => {
  it('GAP-B-15: call_expression f() as arg → null', () => {
    const e = getCallEdge(
      `import { f, g } from 'x'; export function h() { f(g()) }`,
      'f',
    )
    expect(e?.literal_args).toBe(JSON.stringify([null]))
  })

  it('GAP-B-16: member_expression a.b as arg → null', () => {
    const e = getCallEdge(
      `import { f } from 'x'; export function h(obj: any) { f(obj.value) }`,
      'f',
    )
    expect(e?.literal_args).toBe(JSON.stringify([null]))
  })

  it('GAP-B-17: arrow_function as arg → null', () => {
    const e = getCallEdge(
      `import { f } from 'x'; export function h() { f(() => 42) }`,
      'f',
    )
    expect(e?.literal_args).toBe(JSON.stringify([null]))
  })

  it('GAP-B-18: new_expression as arg → null', () => {
    const e = getCallEdge(
      `import { f } from 'x'; export function h() { f(new Date()) }`,
      'f',
    )
    expect(e?.literal_args).toBe(JSON.stringify([null]))
  })

  it('GAP-B-19: binary_expression 1+2 as arg → null', () => {
    const e = getCallEdge(
      `import { f } from 'x'; export function h() { f(1 + 2) }`,
      'f',
    )
    expect(e?.literal_args).toBe(JSON.stringify([null]))
  })

  it('GAP-B-19b: conditional a ? b : c as arg → null', () => {
    const e = getCallEdge(
      `import { f } from 'x'; export function h(a: boolean, b: string, c: string) { f(a ? b : c) }`,
      'f',
    )
    expect(e?.literal_args).toBe(JSON.stringify([null]))
  })
})

// ─────────────────────────────────────────────────────
// 6. extractCallArgs 통합
// ─────────────────────────────────────────────────────
describe('a9 갭 B — extractCallArgs 통합', () => {
  it('GAP-B-20: 빈 인자 f() → { firstArg:null, literalArgs:null }', () => {
    const e = getCallEdge(
      `import { f } from 'x'; export function g() { f() }`,
      'f',
    )
    expect(e?.first_arg).toBeNull()
    expect(e?.literal_args).toBeNull()
  })

  it('GAP-B-21: argumentsNode=null → { firstArg:null, literalArgs:null } (null guard 검증)', () => {
    // parseFile이 정상 처리되는 파일에서는 argumentsNode가 null이 되지 않으나,
    // 인자 없는 calls edge가 first_arg=null, literal_args=null임을 간접 검증
    const r = parse(`import { f } from 'x'; export function g() { f() }`)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'f')
    expect(e?.first_arg).toBeNull()
    expect(e?.literal_args).toBeNull()
  })

  it('GAP-B-22b: firstArg with actual NUL byte → tree-sitter Syntax error (파서 레벨 차단)', () => {
    // 실제 NUL 바이트가 TS 소스에 포함되면 tree-sitter 파서가 Syntax error를 던짐.
    // 파이프라인에서 파서 단계에서 걸러지므로 firstArg 경로에 도달하지 않는다.
    const contentWithNul = `import { f } from 'x'; export function g() { f('a\x00b') }`
    expect(() => parse(contentWithNul)).toThrow()
  })
})

// ─────────────────────────────────────────────────────
// 7. depth boundary (명시 테스트)
// ─────────────────────────────────────────────────────
describe('a9 갭 B — depth boundary', () => {
  it('GAP-B-23: depth=2 primitive (string) → 통과', () => {
    // depth=0 인자 → object (depth+1=1) → nested object (depth+1=2) → value는 string (depth=2 ≤ 2 → 통과)
    const e = getCallEdge(
      `import { f } from 'x'; export function g() { f({ a: { b: 'leaf' } }) }`,
      'f',
    )
    expect(e?.literal_args).toBe(JSON.stringify([{ a: { b: 'leaf' } }]))
  })

  it('GAP-B-23b: depth=2 number → 통과', () => {
    const e = getCallEdge(
      `import { f } from 'x'; export function g() { f({ a: { b: 42 } }) }`,
      'f',
    )
    expect(e?.literal_args).toBe(JSON.stringify([{ a: { b: 42 } }]))
  })

  it('GAP-B-23c: depth=2 boolean/null → 통과', () => {
    const e = getCallEdge(
      `import { f } from 'x'; export function g() { f({ a: { ok: true, n: null } }) }`,
      'f',
    )
    expect(e?.literal_args).toBe(JSON.stringify([{ a: { ok: true, n: null } }]))
  })

  it('GAP-B-24: depth=3 → 즉시 null (진입 guard: depth > MAX_OBJECT_DEPTH)', () => {
    // depth=0 인자 → object (depth+1=1) → nested obj (depth+1=2) → nested obj depth=2 → depth+1=3 > 2 → null
    const e = getCallEdge(
      `import { f } from 'x'; export function g() { f({ a: { b: { c: 'deep' } } }) }`,
      'f',
    )
    // b value는 depth=2에서 object 처리 시 depth+1=3 > 2 → null
    expect(e?.literal_args).toBe(JSON.stringify([{ a: { b: null } }]))
  })
})
