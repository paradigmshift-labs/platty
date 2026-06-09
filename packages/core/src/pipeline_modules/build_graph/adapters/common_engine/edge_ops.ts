// common_engine/edge_ops — 파서-무관 CodeEdgeRaw 빌더 (S1 추출).
// 언어 어댑터는 repoId를 넘겨 호출한다. 모든 edge는 source='static'.

import type { CodeEdgeRaw, EdgeRelation, CallArgExpression } from '../../types.js'
import type { EngineNode, LanguageSpec } from './types.js'
import { nodeId } from './node_ops.js'
import { getRootObject } from './chain_extractor.js'

export interface MakeEdgeOpts {
  source_id: string
  target_id: string | null
  relation: EdgeRelation
  target_specifier: string | null
  target_symbol: string | null
  target_imported_symbol?: string | null
  target_local_symbol?: string | null
  resolve_status: CodeEdgeRaw['resolve_status']
  first_arg: string | null
  literal_args: string | null
  arg_expressions?: CodeEdgeRaw['arg_expressions']
  chain_path?: string | null
  type_ref_subtype?: CodeEdgeRaw['type_ref_subtype']
  destructured_alias_root?: string | null
  destructured_alias_property?: string | null
}

export function makeEdge(repoId: string, opts: MakeEdgeOpts): CodeEdgeRaw {
  return {
    repo_id: repoId,
    source_id: opts.source_id,
    target_id: opts.target_id,
    relation: opts.relation,
    target_specifier: opts.target_specifier,
    target_symbol: opts.target_symbol,
    target_imported_symbol: opts.target_imported_symbol,
    target_local_symbol: opts.target_local_symbol,
    source: 'static',
    resolve_status: opts.resolve_status,
    first_arg: opts.first_arg,
    literal_args: opts.literal_args,
    arg_expressions: opts.arg_expressions ?? null,
    chain_path: opts.chain_path ?? null,
    type_ref_subtype: opts.type_ref_subtype ?? null,
    destructured_alias_root: opts.destructured_alias_root ?? null,
    destructured_alias_property: opts.destructured_alias_property ?? null,
  }
}

// parent→child 'contains' edge 빌더 (S2 추출). AST 무의존 — 호출부가 fullName/target_symbol을 계산해 넘긴다.
// child target_id는 nodeId(repoId, filePath, childFullName)로 결정론적 생성. 항상 resolve_status='resolved'.
// targetSymbol: TS/JVM 멤버=bare 이름, Dart method/ctor=null (GAP-2: nullable 로 Dart 가 이 leaf 를 공유).
export function buildContainsEdge(
  repoId: string,
  filePath: string,
  parentNsId: string,
  childFullName: string,
  targetSymbol: string | null,
): CodeEdgeRaw {
  return makeEdge(repoId, {
    source_id: parentNsId,
    target_id: nodeId(repoId, filePath, childFullName),
    relation: 'contains',
    target_specifier: null,
    target_symbol: targetSymbol,
    resolve_status: 'resolved',
    first_arg: null,
    literal_args: null,
  })
}

// type_ref edge 빌더 (GAP-3 추출). field/param/return 타입 참조의 공통 발화 leaf — JVM(emitJvmTypeRef)·
// Dart(emitTypeRefEdges) 가 공유한다. target_specifier=importSymbolMap.get(typeName)??null (전 언어 동일);
// type_ref_subtype 은 JVM 이 field=null/return_type/method_param, Dart 는 항상 null(미지정). 타입 이름 수집·
// primitive skip·generic unwrap 은 호출부(언어별)가 한다 — 이 leaf 는 edge 발화만.
export function buildTypeRefEdge(
  repoId: string,
  importSymbolMap: Map<string, string>,
  sourceId: string,
  typeName: string,
  subtype: CodeEdgeRaw['type_ref_subtype'],
): CodeEdgeRaw {
  return makeEdge(repoId, {
    source_id: sourceId,
    target_id: null,
    relation: 'type_ref',
    target_specifier: importSymbolMap.get(typeName) ?? null,
    target_symbol: typeName,
    resolve_status: 'pending',
    first_arg: null,
    literal_args: null,
    type_ref_subtype: subtype,
  })
}

// heritage generic 타입 인자 → uses_type(generic_arg) edge 빌더 (GAP-4 추출). extends/implements 의
// generic 인자(JpaRepository<Order,Long> 의 Order/Long 등)를 공통 발화. heritage_ops(TS)·jvm_ast(Java/Kotlin
// heritage) 가 공유. target_specifier=importSymbolMap.get??null, relation 'uses_type', subtype 'generic_arg'.
export function buildGenericArgEdge(
  repoId: string,
  importSymbolMap: Map<string, string>,
  sourceId: string,
  typeName: string,
): CodeEdgeRaw {
  return makeEdge(repoId, {
    source_id: sourceId,
    target_id: null,
    relation: 'uses_type',
    target_specifier: importSymbolMap.get(typeName) ?? null,
    target_symbol: typeName,
    resolve_status: 'pending',
    first_arg: null,
    literal_args: null,
    type_ref_subtype: 'generic_arg',
  })
}

// ── depends_on edge machine (S2 추출) ──
// 정책(불변): importSymbolMap에 있는 identifier만 발화(local var false positive 차단),
// seen으로 동일 source 안 중복 차단. member_expression은 root 한 번만. property_identifier(객체 key) skip.

/**
 * 단일 import-bound identifier → depends_on edge (seen dedup + importSymbolMap 필터).
 * `chainPath`(옵션)은 member 접근(`NS.member`)의 전체 경로를 *additive*로 싣는다 — target_symbol은
 * 기존대로 import-bound 루트(`NS`)를 유지(기존 resolution/소비자 불변)하고, chain_path에 `NS.member`를
 * 담아 build_relations 2-hop이 반환 wrapper의 멤버 값노드를 db-client로 추적하게 한다.
 */
export function emitDependsOnIfImportBound(
  name: string,
  repoId: string,
  importSymbolMap: Map<string, string>,
  sourceId: string,
  seen: Set<string>,
  out: CodeEdgeRaw[],
  chainPath: string | null = null,
): void {
  if (seen.has(name)) return
  const specifier = importSymbolMap.get(name)
  if (!specifier) return
  seen.add(name)
  out.push(makeEdge(repoId, {
    source_id: sourceId,
    target_id: null,
    relation: 'depends_on',
    target_specifier: specifier,
    target_symbol: name,
    chain_path: chainPath,
    resolve_status: 'pending',
    first_arg: null,
    literal_args: null,
  }))
}

/**
 * 노드 트리에서 import-bound identifier를 찾아 depends_on 발화 (재귀 walk).
 * identifier/shorthand→발화, property_identifier(key)→skip, pair→value만, member→root만, call→args만, 그 외→children 재귀.
 */
export function walkIdentifiersForDependsOn(
  node: EngineNode,
  repoId: string,
  importSymbolMap: Map<string, string>,
  spec: LanguageSpec,
  sourceId: string,
  seen: Set<string>,
  out: CodeEdgeRaw[],
): void {
  if (node.type === spec.identifierType) {
    emitDependsOnIfImportBound(node.text, repoId, importSymbolMap, sourceId, seen, out)
    return
  }
  if (node.type === spec.shorthandPropertyType) {
    emitDependsOnIfImportBound(node.text, repoId, importSymbolMap, sourceId, seen, out)
    return
  }
  if (node.type === spec.propertyIdentifierType) return
  if (node.type === spec.pairType) {
    const valueNode = node.childForFieldName(spec.valueField)
    if (valueNode) walkIdentifiersForDependsOn(valueNode, repoId, importSymbolMap, spec, sourceId, seen, out)
    return
  }
  if (node.type === spec.memberType) {
    const root = getRootObject(node, spec)
    if (root?.type === spec.identifierType) {
      // import-bound 루트(`SGlobal`)로 gate + target_symbol은 루트 유지(기존 resolution 보존),
      // 전체 멤버경로(`SGlobal.prismaPrimary`)는 chain_path에 additive로 실어 build_relations가
      // 그 멤버 값노드를 db-client로 추적하게 한다. (no-whitespace 정규화)
      const memberPath = node.text.replace(/\s+/g, '')
      emitDependsOnIfImportBound(root.text, repoId, importSymbolMap, sourceId, seen, out, memberPath)
    }
    return
  }
  if (node.type === spec.callType) {
    const argsNode = node.childForFieldName(spec.argumentsField)
    if (argsNode) walkIdentifiersForDependsOn(argsNode, repoId, importSymbolMap, spec, sourceId, seen, out)
    return
  }
  for (const c of node.children) {
    if (c) walkIdentifiersForDependsOn(c, repoId, importSymbolMap, spec, sourceId, seen, out)
  }
}

/** 이미 추출된 의존성 식별자 배열 → depends_on edges (식별자 추출 walk는 어댑터에 남음). */
export function makeDependsOnEdges(
  idents: readonly string[],
  repoId: string,
  importSymbolMap: Map<string, string>,
  sourceId: string,
): CodeEdgeRaw[] {
  const out: CodeEdgeRaw[] = []
  for (const ident of idents) {
    out.push(makeEdge(repoId, {
      source_id: sourceId,
      target_id: null,
      relation: 'depends_on',
      target_specifier: importSymbolMap.get(ident) ?? null,
      target_symbol: ident,
      resolve_status: 'pending',
      first_arg: null,
      literal_args: null,
    }))
  }
  return out
}

// ── React Query / SWR data-callback reference calls (engine_a) ──
// useQuery/useMutation/useSWR 등의 queryFn/mutationFn/fetcher(또는 useSWR 2번째 인자)가
// identifier/member 참조이면 calls edge로 발화. 입력은 이미 추출된 CallArgExpression[]
// (파서 무의존). makeEdge 사용. importSymbolMap으로 specifier 조회.

const DATA_CALLBACK_CALLS = new Set([
  'useQuery',
  'useInfiniteQuery',
  'useSuspenseQuery',
  'useMutation',
  'useSWR',
  'useSWRImmutable',
])

export function emitDataCallbackReferenceCalls(
  calleeName: string | null,
  argExpressions: CallArgExpression[] | null,
  repoId: string,
  importSymbolMap: Map<string, string>,
  sourceId: string,
  out: CodeEdgeRaw[],
): void {
  if (!calleeName || !DATA_CALLBACK_CALLS.has(calleeName) || !argExpressions) return

  const refs: CallArgExpression[] = []
  for (const arg of argExpressions) {
    if (arg.kind === 'object') {
      for (const key of ['queryFn', 'mutationFn', 'fetcher']) {
        const ref = arg.properties?.[key]
        if (isDataCallbackReference(ref)) refs.push(ref)
      }
      continue
    }
    if ((calleeName === 'useSWR' || calleeName === 'useSWRImmutable') && arg.index === 1 && isDataCallbackReference(arg)) {
      refs.push(arg)
    }
  }

  const seen = new Set<string>()
  for (const ref of refs) {
    const target = dataCallbackTarget(ref)
    if (!target || seen.has(`${target.chainPath ?? ''}|${target.symbol}`)) continue
    seen.add(`${target.chainPath ?? ''}|${target.symbol}`)
    out.push(makeEdge(repoId, {
      source_id: sourceId,
      target_id: null,
      relation: 'calls',
      target_specifier: importSymbolMap.get(target.importLookupSymbol) ?? null,
      target_symbol: target.symbol,
      resolve_status: 'pending',
      first_arg: null,
      literal_args: null,
      arg_expressions: null,
      chain_path: target.chainPath,
    }))
  }
}

export function isDataCallbackReference(ref: CallArgExpression | undefined): ref is CallArgExpression {
  return ref?.kind === 'identifier' || ref?.kind === 'member'
}

export function dataCallbackTarget(
  ref: CallArgExpression,
): { symbol: string; importLookupSymbol: string; chainPath: string | null } | null {
  if (ref.kind === 'identifier') {
    return { symbol: ref.raw, importLookupSymbol: ref.raw, chainPath: null }
  }
  if (ref.kind !== 'member') return null

  const parts = ref.raw.split('.').map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2) return null
  const symbol = parts[parts.length - 1]
  const chainPath = parts.slice(0, -1).join('.')
  const importLookupSymbol = parts[0]
  if (!symbol || !chainPath || !importLookupSymbol) return null
  return { symbol, importLookupSymbol, chainPath }
}
