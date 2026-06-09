// jvm_hooks/annotation_args — JVM 어노테이션 인자 파서 (positional / named / array).
//
// 순수 텍스트 유틸 (regex jvm.ts 에서 추출). AST 어댑터(jvm_ast.ts)가 annotation_argument_list(Java)
// / value_arguments(Kotlin) 의 raw 텍스트(괄호 제거)에 적용해 build_models(JpaGraphAdapter) / build_route
// (spring) 가 의존하는 firstArg/literalArgs 계약을 그대로 생성한다:
//   - firstArg  = named.value ?? named.path ?? 첫 string literal ?? raw args
//   - literalArgs = JSON.stringify({ positional: string[], named: Record<string, string|string[]> })
// 예) @RequestMapping(method = RequestMethod.GET, value = {"/a","/b"})
//   → firstArg='/a', literalArgs={positional:[],named:{method:'RequestMethod.GET',value:['/a','/b']}}

/** depth/quote 인식 top-level 콤마 분리. */
export function splitTopLevel(source: string): string[] {
  const out: string[] = []
  let start = 0
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    if (quote) {
      if (ch === quote && source[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth += 1
    if ((ch === ')' || ch === ']' || ch === '}' || ch === '>') && depth > 0) depth -= 1
    if (ch === ',' && depth === 0) {
      const part = source.slice(start, i).trim()
      if (part) out.push(part)
      start = i + 1
    }
  }
  const tail = source.slice(start).trim()
  if (tail) out.push(tail)
  return out
}

function cleanDecoratorScalarArgValue(raw: string): string {
  const trimmed = raw.trim()
  const quoted = /^["']([^"']*)["']$/.exec(trimmed)
  return quoted ? quoted[1] : trimmed
}

function parseDecoratorArgValue(raw: string): string | string[] {
  const trimmed = raw.trim()
  // Java { "a", "b" } / Kotlin [ "a", "b" ] / arrayOf(...) — 배열 리터럴
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return splitTopLevel(trimmed.slice(1, -1)).map((part) => cleanDecoratorScalarArgValue(part))
  }
  const arrayOf = /^arrayOf\s*\(([\s\S]*)\)$/.exec(trimmed)
  if (arrayOf) return splitTopLevel(arrayOf[1]).map((part) => cleanDecoratorScalarArgValue(part))
  return cleanDecoratorScalarArgValue(trimmed)
}

function firstStringLiteral(source: string): string | null {
  const m = /["']([^"']*)["']/.exec(source)
  return m ? m[1] : null
}

/** raw 어노테이션 인자 텍스트(괄호 제외) → { firstArg, literalArgs }. regex jvm.ts 와 동일 계약. */
export function parseDecoratorArgs(args: string): { firstArg: string | null; literalArgs: string | null } {
  if (args.length === 0) return { firstArg: null, literalArgs: null }
  const positional: string[] = []
  const named: Record<string, string | string[]> = {}
  for (const part of splitTopLevel(args)) {
    const m = /^([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(part)
    const value = parseDecoratorArgValue(m ? m[2] : part)
    if (m) named[m[1]] = value
    else positional.push(Array.isArray(value) ? value[0] ?? '' : value)
  }
  const firstValue = named.value ?? named.path
  const firstArg = Array.isArray(firstValue)
    ? firstValue[0] ?? null
    : firstValue ?? firstStringLiteral(args) ?? (args.length > 0 ? args : null)
  return {
    firstArg,
    literalArgs: JSON.stringify({ positional, named }),
  }
}
