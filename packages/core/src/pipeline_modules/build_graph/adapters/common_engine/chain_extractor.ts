// common_engine — chain 추출 (파서-무관)
// typescript.ts 에서 추출. 동작 동일(golden ①). 하드코딩 노드타입은 LanguageSpec 값으로 치환.
// 제네릭 <N extends EngineNode>로 호출측 노드 타입(native SyntaxNode / WASM Node)을 투명하게 보존.

import type { EngineNode, LanguageSpec } from './types.js'

/**
 * E6 — member_expression의 object 부분을 chain_path 문자열로 변환.
 * 예: prisma.order → 'prisma.order', this.svc → 'this.svc', super → 'super'
 */
export function extractChainPath(objNode: EngineNode | null): string | null {
  if (!objNode) return null
  // 단순화: obj.text 그대로 (member_expression / identifier / this / super 모두 자연스러운 표현)
  return objNode.text
}

export function unwrapCallFunction<N extends EngineNode>(node: N, spec: LanguageSpec): N {
  let current = node
  let depth = 0
  while (depth < 5) {
    if (current.type !== spec.awaitType) return current
    const inner = current.namedChildren[0]
    if (!inner) return current
    current = inner as N
    depth++
  }
  return current
}

/**
 * 값-동일성 래퍼((...) / await / non-null `!`)를 벗겨 체인 루트를 드러낸다.
 * 정적분석기가 모호함 없이 strip 가능한 transparent wrapper만 대상 — runtime value가 inner와 동일.
 * 동적 subscript(x[k])·캐스트(x as T)·nullish(a ?? b)는 제외(루트가 모호하거나 별 기능).
 * includeAwait=false: callee 위치용 — `(await x)()` 는 awaited value 호출이라 await을 벗기면 안 됨.
 * spec에 해당 노드타입이 없으면(undefined) 매칭 안 됨 → no-op (Dart/JVM/Kotlin 안전).
 */
export function unwrapTransparent<N extends EngineNode>(node: N, spec: LanguageSpec, includeAwait = true): N {
  let cur: N = node
  let depth = 0
  while (depth < 10) {
    const t = cur.type
    const isWrapper =
      t === spec.parenthesizedExpressionType ||
      t === spec.nonNullExpressionType ||
      (includeAwait && t === spec.awaitType)
    if (!isWrapper) return cur
    const inner = cur.namedChildren[0]
    if (!inner) return cur
    cur = inner as N
    depth++
  }
  return cur
}

/**
 * BS-10 — chain method 호출 시 root identifier 탐색.
 * 예: db.select().from(...) → root='db', axios.create().get() → root='axios'
 * 중간에 this/super root면 null 반환 (별 처리). 각 hop 의 value-identity 래퍼는 투과.
 */
export function findChainRootIdentifier<N extends EngineNode>(node: N | null, spec: LanguageSpec): N | null {
  let cur: EngineNode | null = node
  let depth = 0
  while (cur && depth < 20) {
    cur = unwrapTransparent(cur, spec)
    if (cur.type === spec.identifierType) return cur as N
    if (cur.type === spec.thisType || cur.type === spec.superType) return null
    if (cur.type === spec.callType) {
      cur = cur.childForFieldName(spec.functionField)
    } else if (cur.type === spec.newType) {
      cur = cur.childForFieldName(spec.constructorField)
    } else if (cur.type === spec.memberType) {
      cur = cur.childForFieldName(spec.objectField)
    } else {
      return null
    }
    depth++
  }
  return null
}

/** chain root가 this인지 검사 (this.qb.where().andWhere() 같은 경우) */
export function isChainRootedAtThis(node: EngineNode | null, spec: LanguageSpec): boolean {
  let cur: EngineNode | null = node
  let depth = 0
  while (cur && depth < 20) {
    if (cur.type === spec.thisType) return true
    if (cur.type === spec.identifierType || cur.type === spec.superType) return false
    if (cur.type === spec.callType) {
      cur = cur.childForFieldName(spec.functionField)
    } else if (cur.type === spec.memberType) {
      cur = cur.childForFieldName(spec.objectField)
    } else {
      return false
    }
    depth++
  }
  return false
}

export function getRootObject<N extends EngineNode>(node: N, spec: LanguageSpec): N {
  const cur = unwrapTransparent(node, spec)
  if (cur.type === spec.memberType) {
    const obj = cur.childForFieldName(spec.objectField)
    if (obj) return getRootObject(obj as N, spec)
  }
  return cur
}

/**
 * 모듈 top-level `const app = express()` / `new Foo()` / alias 들을 importSymbolMap에 alias로 등록.
 * initializer의 chain-root identifier가 이미 import-bound면 그 specifier를 변수명에도 매핑한다.
 * (S4 추출 — typescript.ts 에서 이동. 노드타입/필드명은 LanguageSpec 치환, EngineNode null-child guard 추가.)
 */
export function addModuleLocalAliases(root: EngineNode, map: Map<string, string>, spec: LanguageSpec): void {
  for (const child of root.children) {
    if (!child) continue
    // export 안에 들어있어도 처리: export const app = express()
    let target = child
    if (child.type === spec.exportStatementType) {
      const inner = child.children.find(
        (c): c is EngineNode => c !== null && spec.constDeclTypes.includes(c.type),
      )
      if (inner) target = inner
    }
    if (!spec.constDeclTypes.includes(target.type)) continue

    for (const decl of target.children) {
      if (!decl || decl.type !== spec.declaratorType) continue
      const nameNode = decl.childForFieldName(spec.nameField)
      const valueNode = decl.childForFieldName(spec.valueField)
      if (!nameNode || !valueNode) continue
      if (nameNode.type !== spec.identifierType) continue // destructure 등 X
      const varName = nameNode.text

      // initializer 분석
      let rootIdent: string | null = null
      if (valueNode.type === spec.callType) {
        const fn = valueNode.childForFieldName(spec.functionField)
        if (fn) {
          const found = findChainRootIdentifier(fn, spec) ?? (fn.type === spec.identifierType ? fn : null)
          if (found?.type === spec.identifierType) rootIdent = found.text
        }
      } else if (valueNode.type === spec.newType) {
        const ctor = valueNode.childForFieldName(spec.constructorField)
        if (ctor?.type === spec.identifierType) rootIdent = ctor.text
      } else if (valueNode.type === spec.identifierType) {
        rootIdent = valueNode.text
      } else if (valueNode.type === spec.memberType) {
        const found = findChainRootIdentifier(valueNode, spec)
        if (found?.type === spec.identifierType) rootIdent = found.text
      }

      if (rootIdent) {
        const specifier = map.get(rootIdent)
        if (specifier && !map.has(varName)) {
          map.set(varName, specifier)
        }
      }
    }
  }
}
