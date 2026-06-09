// common_engine/decorator_type_fn_ops — 파서-무관 decorator lazy-type fn edge 빌더 (A2-1 추출).
// @Resolver(()=>User) / @Field(()=>ID) / @ApiProperty({ type: ()=>U }) 같은 lazy-type 화살표 함수의
// body 안 type 식별자를 type_ref(decorator_type_fn) edge 로 발화한다 (type-graphql / Swagger / TypeORM).
// 언어 어댑터는 EngineNode(decorator) + repoId + sourceId + importSymbolMap + spec 을 넘긴다.
// 엔진은 CodeEdgeRaw[] 를 반환, 어댑터가 ctx.edges 에 push. emit 정책은 TS 원본과 canonical-동일.

import type { CodeEdgeRaw } from '../../types.js'
import type { EngineNode, LanguageSpec } from './types.js'
import { makeEdge } from './edge_ops.js'
import { collectTypeIdentifiers } from './shared_utils.js'

/**
 * A2-1 헬퍼 — 노드가 arrow_function이면 body에서 type identifier 수집.
 * 객체 리터럴이면 prop value가 arrow_function인지 재귀 진입(@ApiProperty).
 */
function collectTypeFnRefs(node: EngineNode, out: Set<string>, spec: LanguageSpec): void {
  if (node.type === spec.arrowFunctionType) {
    const body = node.childForFieldName(spec.bodyField)
    if (body) collectTypeIdentifiers(body, out, spec)
    return
  }
  if (node.type === spec.objectType) {
    for (const child of node.children) {
      if (!child) continue
      if (child.type !== spec.pairType) continue
      const value = child.childForFieldName(spec.valueField)
      if (value) collectTypeFnRefs(value, out, spec)
    }
  }
}

/**
 * A2-1 — decorator 인자가 화살표 함수일 때 그 body 안 type 식별자를 type_ref edge로 발화.
 * 어댑터는 반환 배열을 ctx.edges 에 push 한다 (emit 호출부 유지).
 *
 * relation='type_ref', subtype='decorator_type_fn'.
 * 객체 prop 안 type fn(@ApiProperty 패턴)은 객체 walk + arrow_function value 진입.
 */
export function buildDecoratorTypeFnEdges(
  decoratorNode: EngineNode,
  repoId: string,
  sourceId: string,
  importSymbolMap: Map<string, string>,
  spec: LanguageSpec,
): CodeEdgeRaw[] {
  const out: CodeEdgeRaw[] = []
  const callExpr = decoratorNode.children.find((c) => c?.type === spec.callType)
  if (!callExpr) return out
  const args = callExpr.childForFieldName(spec.argumentsField)
  if (!args) return out

  const seen = new Set<string>()
  for (const arg of args.children) {
    if (!arg) continue
    collectTypeFnRefs(arg, seen, spec)
  }

  for (const typeName of seen) {
    out.push(makeEdge(repoId, {
      source_id: sourceId,
      target_id: null,
      relation: 'type_ref',
      target_specifier: importSymbolMap.get(typeName) ?? null,
      target_symbol: typeName,
      resolve_status: 'pending',
      first_arg: null,
      literal_args: null,
      type_ref_subtype: 'decorator_type_fn',
    }))
  }
  return out
}
