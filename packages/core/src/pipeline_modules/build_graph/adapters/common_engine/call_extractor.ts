// common_engine — call argument 추출 (파서-무관)
// typescript.ts 2291-2722 에서 추출. 동작 byte 동일(golden ①). 하드코딩 노드타입/필드/토큰은 LanguageSpec 값으로 치환.
//
// 보존 불변식:
//  - extractLiteralValue 는 node.children(주석 포함 → array에 null 원소), buildArgExpression array는 namedChildren.
//    → comment-null 버그 그대로 보존 (oracle observed). 고치지 않음.
//  - buildArgExpression string-kind 는 spec.stringType('string')만, extractLiteralValue는 string|string_fragment 둘 다.
//  - depth/length/hop 한도, resolution 계산, cycle detection 모두 원본과 동일.
//
// children/namedChildren null guard: native(Phase A)는 null 없음 → no-op. WASM(Phase B)은 null 가능 → 안전.

import type { CallArgExpression } from '../../types.js'
import type { EngineNode, LanguageSpec } from './types.js'

// ── spec 무관 상수/타입 (외부에서도 참조) ──
export const MAX_OBJECT_DEPTH = 2 // 1-depth nested 객체까지 walk
export const MAX_STRING_LENGTH = 500
export const MAX_LITERAL_ARGS_LENGTH = 2000
export const MAX_ARG_RAW_LENGTH = 500
export const MAX_ARG_EXPRESSION_DEPTH = 4
export const MAX_ARG_OBJECT_PROPERTIES = 20
export const MAX_ARG_RESOLVE_HOPS = 8

export type LiteralValue = string | number | boolean | null | LiteralObject | LiteralArray
export interface LiteralObject {
  [k: string]: LiteralValue
}
export type LiteralArray = LiteralValue[]

export interface CallExtractor {
  extractCallArgs(argumentsNode: EngineNode | null): {
    firstArg: string | null
    literalArgs: string | null
    argExpressions: CallArgExpression[] | null
  }
  extractLiteralValue(node: EngineNode, depth?: number): LiteralValue
  normalizeObjectPropertyKey(raw: string): string | null
}

const QUOTE_RE = /^['"`]|['"`]$/g

export function makeCallExtractor(spec: LanguageSpec): CallExtractor {
  type StaticArgResolver = (node: EngineNode, index: number, depth: number) => CallArgExpression | null

  /**
   * 단일 expression 노드의 정적 값 추출 (재귀).
   * 식별자/template/computed/member_expression/call_expression → null
   * 객체/배열 → 1-depth만 재귀. NUL/길이초과 → null.
   */
  function extractLiteralValue(node: EngineNode, depth = 0): LiteralValue {
    if (depth > MAX_OBJECT_DEPTH) return null

    const t = node.type
    if (t === spec.stringType || t === spec.stringFragmentType) {
      const val = node.text.replace(QUOTE_RE, '')
      // eslint-disable-next-line no-control-regex
      if (/\x00/.test(val)) return null
      if (/\\x00|\\0(?![1-9])/.test(val)) return null
      if (val.length > MAX_STRING_LENGTH) return null
      return val
    }
    if (t === spec.numberType) {
      const n = Number(node.text)
      return Number.isFinite(n) ? n : null
    }
    if (t === spec.trueType) return true
    if (t === spec.falseType) return false
    if (t === spec.nullType) return null

    if (t === spec.objectType) {
      if (depth + 1 > MAX_OBJECT_DEPTH) return null
      const obj: LiteralObject = {}
      for (const child of node.children) {
        if (!child) continue
        if (child.type === spec.pairType) {
          const keyNode = child.childForFieldName(spec.keyField)
          const valueNode = child.childForFieldName(spec.valueField)
          if (!keyNode || !valueNode) continue
          if (keyNode.type === spec.computedPropertyType) continue
          const keyText = keyNode.text.replace(QUOTE_RE, '')
          // eslint-disable-next-line no-control-regex
          if (/\x00/.test(keyText) || keyText.length > MAX_STRING_LENGTH) continue
          obj[keyText] = extractLiteralValue(valueNode, depth + 1)
        } else if (child.type === spec.shorthandPropertyType) {
          obj[child.text] = null
        }
        // spread_element → 무시
      }
      return obj
    }

    if (t === spec.arrayType) {
      if (depth + 1 > MAX_OBJECT_DEPTH) return null
      const arr: LiteralArray = []
      for (const child of node.children) {
        if (!child) continue
        if (child.type === spec.openBracket || child.type === spec.closeBracket || child.type === spec.comma) continue
        if (child.type === spec.spreadType) continue
        arr.push(extractLiteralValue(child, depth + 1))
      }
      return arr
    }

    return null
  }

  /**
   * call_expression 인자에서 first_arg / literal_args / argExpressions 추출 (E4 보강).
   */
  function extractCallArgs(argumentsNode: EngineNode | null): {
    firstArg: string | null
    literalArgs: string | null
    argExpressions: CallArgExpression[] | null
  } {
    if (!argumentsNode) return { firstArg: null, literalArgs: null, argExpressions: null }

    const rawArgNodes = argumentsNode.children.filter(
      (c): c is EngineNode => c !== null && c.type !== spec.openParen && c.type !== spec.closeParen && c.type !== spec.comma,
    )
    // 인자 래퍼(Kotlin value_argument) unwrap → 값 표현식(마지막 자식). 미설정 언어(TS/Java)는 그대로.
    const argNodes = spec.argumentWrapperType
      ? rawArgNodes.map((a) => {
          if (a.type !== spec.argumentWrapperType) return a
          const kids = a.children.filter((c): c is EngineNode => c !== null)
          return kids.length > 0 ? kids[kids.length - 1] : a
        })
      : rawArgNodes
    if (argNodes.length === 0) return { firstArg: null, literalArgs: null, argExpressions: null }

    let firstArg: string | null = null
    const first = argNodes[0]
    if (first && (first.type === spec.stringType || first.type === spec.stringFragmentType)) {
      const val = first.text.replace(QUOTE_RE, '')
      // eslint-disable-next-line no-control-regex
      if (!/\x00/.test(val) && val.length <= MAX_STRING_LENGTH) {
        firstArg = val
      }
    }

    const argValues: LiteralValue[] = argNodes.map((a) => extractLiteralValue(a, 0))

    let literalArgs: string | null = null
    try {
      const serialized = JSON.stringify(argValues)
      literalArgs = serialized.length <= MAX_LITERAL_ARGS_LENGTH ? serialized : null
    } catch {
      literalArgs = null
    }

    const argExpressions = buildArgExpressions(argNodes, 0, makeStaticArgResolver())

    return { firstArg, literalArgs, argExpressions }
  }

  /** template_string → staticPattern + identifiers. 정적 파트=string_fragment, 동적=template_substitution. */
  function extractTemplatePattern(node: EngineNode): { staticPattern: string; identifiers: string[] } {
    let pattern = ''
    const identifiers: string[] = []

    for (const child of node.children) {
      if (!child) continue
      if (child.type === spec.backtick) continue
      if (child.type === spec.stringFragmentType) {
        pattern += child.text
      } else if (child.type === spec.templateSubType) {
        const expr = child.children.find((c) => c !== null && c.type !== spec.templateOpen && c.type !== spec.templateClose)
        if (!expr) {
          pattern += ':val'
        } else if (expr.type === spec.identifierType) {
          pattern += `:${expr.text}`
          identifiers.push(expr.text)
        } else if (expr.type === spec.memberType) {
          const prop = expr.childForFieldName(spec.propertyField)
          const propName = prop?.text ?? 'val'
          pattern += `:${propName}`
          collectMemberIdentifiers(expr, identifiers)
        } else {
          pattern += ':val'
        }
      }
    }

    return { staticPattern: pattern, identifiers }
  }

  /** member_expression의 모든 identifier/property_identifier 수집 */
  function collectMemberIdentifiers(node: EngineNode, out: string[]): void {
    if (node.type === spec.identifierType) {
      out.push(node.text)
    } else if (node.type === spec.memberType) {
      const obj = node.childForFieldName(spec.objectField)
      const prop = node.childForFieldName(spec.propertyField)
      if (obj) collectMemberIdentifiers(obj, out)
      if (prop && prop.type !== spec.computedPropertyType) out.push(prop.text)
    }
  }

  function buildArgExpressions(
    argNodes: EngineNode[],
    depth = 0,
    resolveStatic?: StaticArgResolver,
  ): CallArgExpression[] | null {
    const result: CallArgExpression[] = []
    for (let i = 0; i < argNodes.length; i++) {
      const expression = buildArgExpression(argNodes[i]!, i, depth, resolveStatic)
      if (!expression) return null
      result.push(expression)
    }
    return result.length > 0 ? result : null
  }

  function buildArgExpression(
    node: EngineNode,
    index: number,
    depth: number,
    resolveStatic?: StaticArgResolver,
  ): CallArgExpression | null {
    const raw = node.text
    if (raw.length > MAX_ARG_RAW_LENGTH) return null

    if (node.type === spec.stringType) {
      return { index, kind: 'string', raw, value: raw.replace(QUOTE_RE, ''), resolution: 'static' }
    }
    if (node.type === spec.templateType) {
      const { staticPattern, identifiers } = extractTemplatePattern(node)
      return {
        index,
        kind: 'template',
        raw,
        staticPattern,
        identifiers,
        resolution: identifiers.length > 0 ? 'partial' : 'static',
      }
    }
    if (node.type === spec.identifierType || node.type === spec.shorthandPropertyType) {
      return withResolvedReference({ index, kind: 'identifier', raw, resolution: 'dynamic' }, node, depth, resolveStatic)
    }
    if (node.type === spec.memberType) {
      return withResolvedReference({ index, kind: 'member', raw, resolution: 'dynamic' }, node, depth, resolveStatic)
    }
    if (node.type === spec.callType) return { index, kind: 'call', raw, resolution: 'dynamic' }
    if (node.type === spec.objectType) {
      const properties = depth < MAX_ARG_EXPRESSION_DEPTH ? buildObjectArgProperties(node, depth + 1, resolveStatic) : null
      return withAggregateResolution({
        index,
        kind: 'object',
        raw,
        ...(properties && Object.keys(properties).length > 0 && { properties }),
      })
    }
    if (node.type === spec.arrayType) {
      const elementNodes = node.namedChildren.filter((c): c is EngineNode => c !== null && c.type !== spec.comma)
      const elements = depth < MAX_ARG_EXPRESSION_DEPTH ? buildArgExpressions(elementNodes, depth + 1, resolveStatic) ?? [] : []
      return withAggregateResolution({
        index,
        kind: 'array',
        raw,
        ...(elements.length > 0 && { elements }),
      })
    }

    return { index, kind: 'unknown', raw, resolution: 'dynamic' }
  }

  function buildObjectArgProperties(
    node: EngineNode,
    depth: number,
    resolveStatic?: StaticArgResolver,
  ): Record<string, CallArgExpression> | null {
    const properties: Record<string, CallArgExpression> = {}
    let index = 0

    for (const child of node.namedChildren) {
      if (!child) continue
      if (index >= MAX_ARG_OBJECT_PROPERTIES) break
      if (child.type === spec.pairType) {
        const keyNode = child.childForFieldName(spec.keyField)
        const valueNode = child.childForFieldName(spec.valueField)
        const key = keyNode ? normalizeObjectPropertyKey(keyNode.text) : null
        if (!key || !valueNode) continue
        const expression = buildArgExpression(valueNode, index++, depth, resolveStatic)
        if (expression) properties[key] = expression
        continue
      }

      if (
        child.type === spec.shorthandPropertyType ||
        child.type === spec.propertyIdentifierType ||
        child.type === spec.identifierType
      ) {
        const key = normalizeObjectPropertyKey(child.text)
        if (!key) continue
        const expression = buildArgExpression(child, index++, depth, resolveStatic)
        if (expression) properties[key] = expression
      }
    }

    return Object.keys(properties).length > 0 ? properties : null
  }

  function normalizeObjectPropertyKey(raw: string): string | null {
    const trimmed = raw.trim().replace(QUOTE_RE, '')
    return /^[A-Za-z_$][\w$-]*$/.test(trimmed) ? trimmed : null
  }

  function withAggregateResolution(expression: CallArgExpression): CallArgExpression {
    const children =
      expression.kind === 'array'
        ? expression.elements ?? []
        : expression.kind === 'object'
          ? Object.values(expression.properties ?? {})
          : []
    if (children.length === 0) return { ...expression, resolution: 'dynamic' }
    return {
      ...expression,
      resolution: children.every((child) => child.resolution === 'static') ? 'static' : 'partial',
    }
  }

  function withResolvedReference(
    expression: CallArgExpression,
    node: EngineNode,
    depth: number,
    resolveStatic?: StaticArgResolver,
  ): CallArgExpression {
    if (!resolveStatic || depth >= MAX_ARG_EXPRESSION_DEPTH) return expression
    const resolved = resolveStatic(node, expression.index, depth + 1)
    if (!resolved) return expression
    if (resolved.resolution === 'dynamic') return expression
    return {
      ...expression,
      resolved,
      resolution: resolved.resolution === 'static' ? 'static' : 'partial',
    }
  }

  function makeStaticArgResolver(): StaticArgResolver {
    const resolving = new Set<string>()
    const resolve: StaticArgResolver = (node, index, depth) => {
      if (depth > MAX_ARG_EXPRESSION_DEPTH) return null
      if (node.type === spec.identifierType) {
        const key = `${node.startIndex}:${node.text}`
        if (resolving.has(key) || resolving.size >= MAX_ARG_RESOLVE_HOPS) return null
        resolving.add(key)
        try {
          const initializer = findVisibleConstInitializer(node, node.text)
          return initializer ? buildArgExpression(initializer, index, depth, resolve) : null
        } finally {
          resolving.delete(key)
        }
      }
      if (node.type === spec.memberType) {
        return resolveStaticMemberExpression(node, index, depth)
      }
      return null
    }
    return resolve
  }

  function resolveStaticMemberExpression(node: EngineNode, index: number, depth: number): CallArgExpression | null {
    const path = collectStaticMemberPath(node)
    if (path.length < 2) return null
    const rootName = path[0]!
    const initializer = findVisibleConstInitializer(node, rootName)
    if (!initializer) return null

    let current = buildArgExpression(initializer, index, depth, makeStaticArgResolver())
    for (const property of path.slice(1)) {
      current = current?.properties?.[property] ?? current?.resolved?.properties?.[property] ?? null
      if (!current) return null
    }
    return current
  }

  function collectStaticMemberPath(node: EngineNode): string[] {
    if (node.type === spec.identifierType) return [node.text]
    if (node.type !== spec.memberType) return []
    const obj = node.childForFieldName(spec.objectField)
    const prop = node.childForFieldName(spec.propertyField)
    if (!obj || !prop || prop.type === spec.computedPropertyType) return []
    const path = collectStaticMemberPath(obj)
    return path.length > 0 ? [...path, prop.text] : []
  }

  function findVisibleConstInitializer(refNode: EngineNode, ident: string): EngineNode | null {
    let cur: EngineNode | null = refNode
    while (cur?.parent) {
      const scope: EngineNode = cur.parent
      if (isConstLookupScope(scope)) {
        const found = findConstInitializerBefore(scope, cur, ident)
        if (found) return found
      }
      cur = scope
    }
    return null
  }

  function isConstLookupScope(node: EngineNode): boolean {
    return spec.constScopeTypes.includes(node.type)
  }

  function findConstInitializerBefore(scope: EngineNode, boundaryChild: EngineNode, ident: string): EngineNode | null {
    for (const child of scope.children) {
      if (!child) continue
      if (
        (child.startIndex === boundaryChild.startIndex && child.endIndex === boundaryChild.endIndex) ||
        child.startIndex >= boundaryChild.startIndex
      )
        break
      const initializer = findDeclaredConstInitializer(child, ident)
      if (initializer) return initializer
    }
    return null
  }

  function findDeclaredConstInitializer(node: EngineNode, ident: string): EngineNode | null {
    let target = node
    if (node.type === spec.exportStatementType) {
      target = node.children.find((child): child is EngineNode => child !== null && spec.constDeclTypes.includes(child.type)) ?? node
    }
    if (!spec.constDeclTypes.includes(target.type)) return null
    if (target.text.startsWith('let ') || target.text.startsWith('var ')) return null
    for (const decl of target.children) {
      if (!decl) continue
      if (decl.type !== spec.declaratorType) continue
      const name = decl.childForFieldName(spec.nameField)
      if (!name || name.type !== spec.identifierType || name.text !== ident) continue
      return decl.childForFieldName(spec.valueField) ?? null
    }
    return null
  }

  return { extractCallArgs, extractLiteralValue, normalizeObjectPropertyKey }
}
