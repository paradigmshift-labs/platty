// common_engine/heritage_ops — 파서-무관 class extends/implements/generic-arg edge 빌더 (S3 추출).
// 언어 어댑터는 EngineNode(class 선언) + repoId/filePath + importSymbolMap + spec 을 넘긴다.
// 엔진은 CodeEdgeRaw[] 를 반환, 어댑터가 ctx.edges 에 push. emit 정책은 TS 원본과 canonical-동일.

import type { CodeEdgeRaw } from '../../types.js'
import type { EngineNode, LanguageSpec } from './types.js'
import { makeEdge, buildGenericArgEdge } from './edge_ops.js'
import { collectTypeIdentifiers, firstChildOfType } from './shared_utils.js'

/** generic_type 노드에서 base 타입 이름 자식: type_identifier 우선, 없으면 identifier. */
function findTypeNameChild(node: EngineNode, spec: LanguageSpec): EngineNode | null {
  return firstChildOfType(node, spec.typeIdentifierType) ?? firstChildOfType(node, spec.identifierType)
}


/** generic_type 의 인자 타입들을 uses_type(generic_arg) edge 로 (base 이름 제외, importSymbolMap 으로 specifier 조회). */
function emitGenericTypeArgumentEdges(
  genericNode: EngineNode,
  repoId: string,
  importSymbolMap: Map<string, string>,
  sourceId: string,
  baseTypeName: string,
  spec: LanguageSpec,
  out: CodeEdgeRaw[],
): void {
  const seen = new Set<string>()
  for (const child of genericNode.children) {
    if (!child) continue
    collectTypeIdentifiers(child, seen, spec)
  }
  seen.delete(baseTypeName)
  for (const typeName of seen) {
    out.push(buildGenericArgEdge(repoId, importSymbolMap, sourceId, typeName))
  }
}

/**
 * class 선언 노드의 class_heritage 를 걸어 extends/implements/generic-arg edges 를 만든다.
 * 어댑터는 반환 배열을 ctx.edges 에 push 한다 (emit 호출부 유지).
 */
export function buildClassHeritageEdges(
  classNode: EngineNode,
  repoId: string,
  _filePath: string,
  sourceId: string,
  importSymbolMap: Map<string, string>,
  spec: LanguageSpec,
): CodeEdgeRaw[] {
  const out: CodeEdgeRaw[] = []
  const classHeritage = firstChildOfType(classNode, spec.classHeritageType)
  if (!classHeritage) return out

  for (const child of classHeritage.children) {
    if (!child) continue
    if (child.type === spec.extendsClauseType) {
      for (const c of child.children) {
        if (!c) continue
        if (c.type === spec.identifierType || c.type === spec.typeIdentifierType || c.type === spec.memberType) {
          out.push(makeEdge(repoId, {
            source_id: sourceId, target_id: null, relation: 'extends',
            target_specifier: null, target_symbol: c.text,
            resolve_status: 'pending', first_arg: null, literal_args: null,
          }))
          break
        } else if (c.type === spec.genericType) {
          const base = findTypeNameChild(c, spec)
          if (base?.text) {
            out.push(makeEdge(repoId, {
              source_id: sourceId, target_id: null, relation: 'extends',
              target_specifier: null, target_symbol: base.text,
              resolve_status: 'pending', first_arg: null, literal_args: null,
            }))
            emitGenericTypeArgumentEdges(c, repoId, importSymbolMap, sourceId, base.text, spec, out)
          }
          break
        }
      }
    } else if (child.type === spec.implementsClauseType) {
      for (const typeRef of child.children) {
        if (!typeRef) continue
        if (typeRef.type === spec.typeIdentifierType || typeRef.type === spec.identifierType) {
          if (typeRef.text !== spec.implementsKeyword) {
            out.push(makeEdge(repoId, {
              source_id: sourceId, target_id: null, relation: 'implements',
              target_specifier: null, target_symbol: typeRef.text,
              resolve_status: 'pending', first_arg: null, literal_args: null,
            }))
          }
        } else if (typeRef.type === spec.genericType) {
          const inner = findTypeNameChild(typeRef, spec)
          if (inner?.text) {
            out.push(makeEdge(repoId, {
              source_id: sourceId, target_id: null, relation: 'implements',
              target_specifier: null, target_symbol: inner.text,
              resolve_status: 'pending', first_arg: null, literal_args: null,
            }))
            emitGenericTypeArgumentEdges(typeRef, repoId, importSymbolMap, sourceId, inner.text, spec, out)
          }
        }
      }
    }
  }
  return out
}
