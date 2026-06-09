// dart_hooks — Dart call argument / literal 추출 (TS call_extractor 대응, Dart-specific).
// Dart node types(named_argument/argument/string_literal/set_or_map_literal/list_literal 등)는
// TS와 달라 common_engine call_extractor를 재사용하지 않는다. dart.ts에서 추출, 동작 동일.
import type { EngineNode } from '../common_engine/types.js'
import { findChild, findDescendant, stripQuotes } from './dart_node_utils.js'

const MAX_DART_DEPTH = 2

/**
 * E4 — Dart call args의 literal_args 추출.
 *   - positional: literal value
 *   - named: { key: value } 객체로 묶음
 *   - 식별자/call_expression → null
 */
export function extractDartCallLiteralArgs(args: EngineNode | null): string | null {
  if (!args) return null
  const positional: unknown[] = []
  const named: Record<string, unknown> = {}
  let hasNamed = false
  let hasAny = false
  for (const c of args.children) {
    if (!c || !c.isNamed) continue
    if (c.type === 'named_argument') {
      hasAny = true
      hasNamed = true
      const label = findChild(c, 'label')
      const labelIdent = label ? findChild(label, 'identifier') : null
      if (!labelIdent) continue
      const valueNode = c.children.find((x) => !!x && x.isNamed && x.type !== 'label') ?? null
      named[labelIdent.text] = extractDartLiteralValue(valueNode, 0)
    } else if (c.type === 'argument') {
      hasAny = true
      const inner = c.children.find((x) => !!x && x.isNamed) ?? null
      positional.push(extractDartLiteralValue(inner, 0))
    } else if (c.type === 'string_literal') {
      hasAny = true
      positional.push(extractDartLiteralValue(c, 0))
    }
  }
  if (!hasAny) return null
  const allArgs: unknown[] = [...positional]
  if (hasNamed) allArgs.push(named)
  try {
    const s = JSON.stringify(allArgs)
    return s.length <= 2000 ? s : null
  } catch {
    return null
  }
}

export function extractDartLiteralValue(node: EngineNode | null, depth: number): unknown {
  if (!node || depth > MAX_DART_DEPTH) return null
  const t = node.type
  if (t === 'string_literal') {
    const v = stripQuotes(node.text)
    // eslint-disable-next-line no-control-regex
    if (/\x00/.test(v) || v.length > 500) return null
    return v
  }
  if (t === 'decimal_integer_literal' || t === 'hex_integer_literal') {
    const n = Number(node.text)
    return Number.isFinite(n) ? n : null
  }
  if (t === 'decimal_floating_point_literal') {
    const n = Number(node.text)
    return Number.isFinite(n) ? n : null
  }
  if (node.text === 'true') return true
  if (node.text === 'false') return false
  if (t === 'null_literal' || node.text === 'null') return null
  if (t === 'set_or_map_literal') {
    if (depth + 1 > MAX_DART_DEPTH) return null
    const obj: Record<string, unknown> = {}
    for (const c of node.children) {
      if (!c || !c.isNamed) continue
      if (c.type === 'pair') {
        const namedChildren = c.children.filter((x): x is EngineNode => !!x && x.isNamed)
        if (namedChildren.length >= 2) {
          const keyNode = namedChildren[0]!
          const valueNode = namedChildren[1]!
          const keyText = keyNode.text.replace(/^['"`]|['"`]$/g, '')
          obj[keyText] = extractDartLiteralValue(valueNode, depth + 1)
        }
      }
    }
    return obj
  }
  if (t === 'list_literal') {
    if (depth + 1 > MAX_DART_DEPTH) return null
    const arr: unknown[] = []
    for (const c of node.children) {
      if (!c || !c.isNamed) continue
      arr.push(extractDartLiteralValue(c, depth + 1))
    }
    return arr
  }
  return null
}

/**
 * argument_list(arguments) 에서 특정 named argument 의 string literal 값을 추출한다.
 * named_argument → label (identifier + ':') + value expression
 */
export function extractNamedArg(args: EngineNode, argName: string): string | null {
  for (const child of args.children) {
    if (!child || !child.isNamed || child.type !== 'named_argument') continue
    const label = findChild(child, 'label')
    if (!label) continue
    const labelIdent = findChild(label, 'identifier')
    if (!labelIdent || labelIdent.text !== argName) continue
    const strLit = findDescendant(child, 'string_literal')
    if (!strLit) return null
    return stripQuotes(strLit.text)
  }
  return null
}
