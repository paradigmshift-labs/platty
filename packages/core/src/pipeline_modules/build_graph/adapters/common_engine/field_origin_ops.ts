// common_engine/field_origin_ops — 파서-무관 field-origin / type-origin 헬퍼 (S1.2 추출).
// AST 무의존(문자열·맵 기반). 언어 어댑터는 ctx 필드를 풀어 넘긴다.

import type { FieldOrigin, FieldOriginsMap } from '../../types.js'
import type { EngineNode, LanguageSpec } from './types.js'
import { getRootObject } from './chain_extractor.js'

// 패키지(node_modules) import만 external. 상대경로(./ ../ src/) + 흔한 alias(@/) = 내부 파일이므로
// internal로 두고 cross-file 해석(F5 tryFieldOriginDispatch)에 위임한다.
export function isLocalImportSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier.startsWith('src/') ||
    specifier.startsWith('@/')
  )
}

export const BUILTIN_TYPE_NAMES = new Set<string>([
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Date', 'RegExp', 'Promise', 'Array',
  'Number', 'String', 'Boolean', 'Symbol', 'Error', 'TypeError', 'RangeError',
  'ArrayBuffer', 'Int8Array', 'Uint8Array', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array',
])

// codegraph-style 룰북: type-origin 판정에 필요한 언어별 데이터.
// 알고리즘(아래 resolveTypeOriginWith)은 공유, 데이터(builtin/primitive 집합 + local-import 판정)만 언어별.
export interface TypeOriginRules {
  builtinTypeNames: ReadonlySet<string>
  primitiveTypeNames?: ReadonlySet<string> // 선택 — TS는 primitive를 inferOriginFromExpression에서 처리(미사용)
  isLocalImport: (specifier: string) => boolean
}

/** 공유 알고리즘: localClass → import(local?internal:external) → builtin(external) → primitive → unknown. */
export function resolveTypeOriginWith(
  typeName: string,
  localClassNames: Set<string>,
  importSymbolMap: Map<string, string>,
  rules: TypeOriginRules,
): FieldOrigin {
  if (localClassNames.has(typeName)) {
    return { kind: 'internal', typeName }
  }
  if (importSymbolMap.has(typeName)) {
    return rules.isLocalImport(importSymbolMap.get(typeName)!)
      ? { kind: 'internal', typeName }
      : { kind: 'external' }
  }
  if (rules.builtinTypeNames.has(typeName)) {
    return { kind: 'external' }
  }
  if (rules.primitiveTypeNames?.has(typeName)) {
    return { kind: 'primitive' }
  }
  return { kind: 'unknown' }
}

// TS 어댑터용 thin wrapper — TS 데이터(JS builtins + isLocalImportSpecifier, primitive 없음)로 고정.
// primitiveTypeNames 미지정 → primitive 분기 skip → 기존 TS 동작과 byte-identical.
export function resolveTypeOrigin(
  typeName: string,
  localClassNames: Set<string>,
  importSymbolMap: Map<string, string>,
): FieldOrigin {
  return resolveTypeOriginWith(typeName, localClassNames, importSymbolMap, {
    builtinTypeNames: BUILTIN_TYPE_NAMES,
    isLocalImport: isLocalImportSpecifier,
  })
}

export function recordFieldOrigin(
  fieldOrigins: FieldOriginsMap,
  classKey: string,
  fieldName: string,
  origin: FieldOrigin,
): void {
  let m = fieldOrigins.get(classKey)
  if (!m) {
    m = new Map()
    fieldOrigins.set(classKey, m)
  }
  m.set(fieldName, origin)
}

// type_annotation 노드에서 첫 type_identifier / predefined_type 를 DFS 추출 (S2 추출).
//   예: ': InnerCache' → 'InnerCache', ': Map<string, V>' → 'Map'
// children 가 WASM 에서 null 일 수 있으므로 재귀 전 `if (child)` 가드 (native 는 항상 non-null → no-op).
export function extractTypeIdentifierName(typeAnn: EngineNode, spec: LanguageSpec): string | null {
  function walk(n: EngineNode): string | null {
    if (spec.typeIdentifierTypes.includes(n.type)) return n.text
    for (const c of n.children) {
      if (!c) continue
      const r = walk(c)
      if (r) return r
    }
    return null
  }
  return walk(typeAnn)
}

// ── P15-Lite field-origin 추론 (S5 추출) ──
// 어댑터 ctx에서 푼 4개 입력(localClassNames/importSymbolMap/fieldOrigins/currentClassKey) 묶음.
// 이건 build_graph 어댑터 내부 타입이지 출력 계약(CodeNodeRaw/CodeEdgeRaw)이 아니다.
export interface FieldOriginCtx {
  localClassNames: Set<string>
  importSymbolMap: Map<string, string>
  fieldOrigins: FieldOriginsMap
  currentClassKey: string | null
}

/** `this.X.Y.Z` member_expression에서 첫 field segment 'X' (this 바로 다음) 추출. */
function extractFirstThisFieldSegment(memberExpr: EngineNode, spec: LanguageSpec): string | null {
  let cur: EngineNode = memberExpr
  while (cur.type === spec.memberType) {
    const obj = cur.childForFieldName(spec.objectField)
    if (obj?.type === spec.thisType) {
      return cur.childForFieldName(spec.propertyField)?.text ?? null
    }
    if (obj?.type !== spec.memberType) return null
    cur = obj
  }
  return null
}

/**
 * field 선언의 origin 추론: ① type annotation 우선(resolveTypeOrigin), 없으면 ② RHS initializer 분석.
 */
export function inferFieldOrigin(
  typeAnn: EngineNode | null,
  initializer: EngineNode | null,
  fctx: FieldOriginCtx,
  spec: LanguageSpec,
): FieldOrigin {
  // 1. type annotation 우선
  if (typeAnn) {
    const typeName = extractTypeIdentifierName(typeAnn, spec)
    if (typeName) {
      return resolveTypeOrigin(typeName, fctx.localClassNames, fctx.importSymbolMap)
    }
  }
  // 2. RHS 분석
  if (initializer) {
    return inferOriginFromExpression(initializer, fctx, spec)
  }
  return { kind: 'unknown' }
}

export function inferOriginFromExpression(expr: EngineNode, fctx: FieldOriginCtx, spec: LanguageSpec): FieldOrigin {
  // arrow fn / function expression
  if (spec.functionOriginTypes.includes(expr.type)) {
    return { kind: 'function' }
  }
  // primitive literal
  if (spec.primitiveOriginTypes.includes(expr.type)) {
    return { kind: 'primitive' }
  }
  // new X(...) — X identifier resolve
  if (expr.type === spec.newType) {
    const ctorNode = expr.childForFieldName(spec.constructorField)
    if (ctorNode?.type === spec.identifierType) {
      return resolveTypeOrigin(ctorNode.text, fctx.localClassNames, fctx.importSymbolMap)
    }
    if (ctorNode?.type === spec.memberType) {
      // new SomeNs.SomeClass() — 보수적 unknown
      return { kind: 'unknown' }
    }
  }
  // member_expression: SGlobal.prismaPrimary (cross-file ref) 또는 this.prismaClient (self ref)
  if (expr.type === spec.memberType) {
    const root = getRootObject(expr, spec)
    const prop = expr.childForFieldName(spec.propertyField)
    if (root?.type === spec.identifierType && prop) {
      return { kind: 'reference', rootName: root.text, memberName: prop.text }
    }
    // this.X — 같은 class field origin lookup
    if (root?.type === spec.thisType && fctx.currentClassKey) {
      const firstField = extractFirstThisFieldSegment(expr, spec)
      if (firstField) {
        const selfFields = fctx.fieldOrigins.get(fctx.currentClassKey)
        const selfOrigin = selfFields?.get(firstField)
        if (selfOrigin) {
          if (selfOrigin.kind === 'external') return { kind: 'external' }
          if (selfOrigin.kind === 'internal') return selfOrigin
          if (selfOrigin.kind === 'reference') return selfOrigin
        }
      }
    }
    return { kind: 'unknown' }
  }
  // call_expression: SomeFn() / new X(...).chain() / this.X.Y() / SomeNs.method()
  if (expr.type === spec.callType) {
    return inferOriginFromCallExpression(expr, fctx, spec)
  }
  return { kind: 'unknown' }
}

// call_expression의 chain base까지 unwrap → origin 결정
export function inferOriginFromCallExpression(callExpr: EngineNode, fctx: FieldOriginCtx, spec: LanguageSpec): FieldOrigin {
  // chain의 가장 안쪽 base 노드 찾기 (call_expression / member_expression 다중 unwrap)
  let cur: EngineNode | null = callExpr.childForFieldName(spec.functionField)
  while (cur && (cur.type === spec.memberType || cur.type === spec.callType)) {
    cur = cur.type === spec.memberType
      ? cur.childForFieldName(spec.objectField)
      : cur.childForFieldName(spec.functionField)
  }
  if (!cur) return { kind: 'unknown' }

  // base가 this — 같은 class field self lookup (this.X.Y... chain의 첫 field 'X')
  if (cur.type === spec.thisType && fctx.currentClassKey) {
    const fnNode = callExpr.childForFieldName(spec.functionField)
    if (fnNode?.type === spec.memberType) {
      const firstField = extractFirstThisFieldSegment(fnNode, spec)
      if (firstField) {
        const selfOrigin = fctx.fieldOrigins.get(fctx.currentClassKey)?.get(firstField)
        if (selfOrigin) {
          if (selfOrigin.kind === 'external') return { kind: 'external' }
          if (selfOrigin.kind === 'internal') return selfOrigin
          if (selfOrigin.kind === 'reference') return selfOrigin
        }
      }
    }
  }

  // base가 new_expression — constructor identifier 분석
  if (cur.type === spec.newType) {
    const ctor = cur.childForFieldName(spec.constructorField)
    if (ctor?.type === spec.identifierType) {
      return resolveTypeOrigin(ctor.text, fctx.localClassNames, fctx.importSymbolMap)
    }
  }

  // base가 identifier — import-bound 외부 / builtin이면 external
  if (cur.type === spec.identifierType) {
    const rootName = cur.text
    if (fctx.importSymbolMap.has(rootName)) {
      if (!isLocalImportSpecifier(fctx.importSymbolMap.get(rootName)!)) {
        return { kind: 'external' }
      }
    }
    if (BUILTIN_TYPE_NAMES.has(rootName)) return { kind: 'external' }
  }

  return { kind: 'unknown' }
}
