/**
 * F4: resolveTypeRefs — extends/implements/mixes/uses_type/decorates 해석
 * SOT: specs/build_graph/specs/f4_resolve_type_refs/spec.md
 *
 * 서브함수:
 *   - buildExportMap: nodes[] → Map<'filePath|symbolName', nodeId> (export 심볼 인덱스)
 *   - buildImportsIndex: edges/nodes → importsByFileAndSymbol + fileNodeIdByPath
 *   - resolveOneTypeRef: 단일 타입 참조 edge → resolved|external|failed
 *
 * 책임:
 *   - extends/implements/mixes → target class/interface/mixin nodeId 해석
 *   - uses_type → target type nodeId 해석
 *   - decorates → target decorator function nodeId 해석
 *   - 외부 타입 → resolve_status='external'
 *   - 해석 실패 → resolve_status='failed'
 *
 * 불변식:
 *   - F4-1: 입력 비변형 (edges/nodes 수정 금지)
 *   - F4-2: 출력 길이/순서 동일
 *   - F4-3: pending 소거 (처리 대상 edge는 출력 시 pending 잔류 금지)
 *   - F4-4: non-target edge는 원본 참조 유지 (얕은 복사 금지)
 */
import type { SourceFile, CodeNodeRaw, CodeEdgeRaw } from './types.js'

export interface TypeRefProgress {
  completed: number
  total: number
  currentLabel?: string
}

// TYPE_REF_RELATIONS: F4가 처리할 edge relation 집합
const TYPE_REF_RELATIONS = new Set<string>([
  'extends', 'implements', 'mixes', 'uses_type', 'decorates', 'generic_arg',
  'depends_on',  // E2 — decorator 객체 인자 분해 (NestJS @Module providers 등)
  'renders',     // E5 — JSX 컴포넌트 사용
  'type_ref',    // 메서드 시그니처 타입 (constructor_param/method_param/return_type/field_type) — HB-01 EmailParam 추적
])

// ── 내보내기 타입 ──

export type TypeRefOutcome = {
  target_id: string | null
  resolve_status: 'resolved' | 'external' | 'failed'
}

export type LookupImportResult =
  | { ok: true; importEdge: CodeEdgeRaw }
  | { ok: false; reason: 'no-source' | 'no-import' }

/**
 * same-file 심볼 인덱스: Map<'filePath|symbolName', nodeId>
 *
 * exported 무관하게 모든 non-file/non-method/non-dotted 노드를 등록.
 * resolveIntraFile에서 exportMap보다 우선 매칭에 사용.
 *
 * 필터 순서:
 *   1. type==='file' → skip
 *   2. type==='method' → skip
 *   3. name.includes('.') → skip (namespace qualified)
 *
 * 중복 시 첫 번째 노드 우선.
 */
export function buildSameFileIndex(
  nodes: Readonly<CodeNodeRaw>[],
): Map<string, string> {
  const idx = new Map<string, string>()
  for (const node of nodes) {
    if (node.type === 'file') continue
    if (node.type === 'method') continue
    if (node.name.includes('.')) continue
    const key = node.file_path + '|' + node.name
    if (!idx.has(key)) idx.set(key, node.id)
  }
  return idx
}

/**
 * exported 심볼 인덱스: Map<'filePath|symbolName', nodeId>
 *
 * 필터 순서 (spec §buildExportMap):
 *   1. type==='file' → skip
 *   2. type==='method' → skip
 *   3. !exported → skip
 *   4. name.includes('.') → skip (namespace qualified)
 *
 * 중복 시 첫 번째 노드 우선.
 */
export function buildExportMap(
  nodes: Readonly<CodeNodeRaw>[],
): Map<string, string> {
  const map = new Map<string, string>()
  for (const node of nodes) {
    // 1. file 노드 제외 (타입 참조 대상 아님)
    if (node.type === 'file') continue
    // 2. method 노드 제외 (타입 참조 대상 아님)
    if (node.type === 'method') continue
    // 3. 미export 심볼 제외
    if (!node.exported) continue
    // 4. 점 포함 이름 제외 (네임스페이스 qualified)
    if (node.name.includes('.')) continue

    const key = node.file_path + '|' + node.name
    // 중복 시 첫 번째 노드 우선 (덮어쓰기 방지)
    if (!map.has(key)) {
      map.set(key, node.id)
    }
  }
  return map
}

interface ImportsIndex {
  importsByFileAndSymbol: Map<string, CodeEdgeRaw>
  fileNodeIdByPath: Map<string, string>
}

/**
 * F3이 이미 해석한 imports/re_exports edge를 조회 가능한 인덱스로 변환.
 *
 * importsByFileAndSymbol key: `${sourceFileNodeId}|${specifier}|${symbol}`
 * fileNodeIdByPath key: file_path → file node id
 *
 * 중복 key는 첫 번째 edge 우선 (덮어쓰기 방지).
 */
export function buildImportsIndex(
  edges: Readonly<CodeEdgeRaw>[],
  nodes: Readonly<CodeNodeRaw>[],
): ImportsIndex {
  const importsByFileAndSymbol = new Map<string, CodeEdgeRaw>()
  const fileNodeIdByPath = new Map<string, string>()

  // file_path → file node id
  for (const node of nodes) {
    if (node.type === 'file') {
      fileNodeIdByPath.set(node.file_path, node.id)
    }
  }

  // imports/re_exports edge → index
  for (const edge of edges) {
    if (edge.relation !== 'imports' && edge.relation !== 're_exports') continue
    if (edge.target_specifier === null) continue

    // source_id는 파일 노드 id (import는 파일 단위)
    const symbol = edge.target_symbol ?? '' // side-effect import는 ''
    const key = edge.source_id + '|' + edge.target_specifier + '|' + symbol
    if (!importsByFileAndSymbol.has(key)) {
      importsByFileAndSymbol.set(key, edge as CodeEdgeRaw)
    }
    for (const bindingSymbol of [edge.target_local_symbol, edge.target_imported_symbol]) {
      if (!bindingSymbol || bindingSymbol === symbol) continue
      const bindingKey = edge.source_id + '|' + edge.target_specifier + '|' + bindingSymbol
      if (!importsByFileAndSymbol.has(bindingKey)) {
        importsByFileAndSymbol.set(bindingKey, edge as CodeEdgeRaw)
      }
    }
  }

  return { importsByFileAndSymbol, fileNodeIdByPath }
}

/**
 * Case 1: intra-file (target_specifier === null) 해석.
 * 전제: edge.target_symbol 존재 (호출자 보장).
 *
 * 우선순위:
 *   1. sameFileIndex (exported 무관 — non-export helper/type 포함)
 *   2. exportMap fallback (하위 호환)
 */
export function resolveIntraFile(
  edge: CodeEdgeRaw,
  exportMap: Map<string, string>,
  nodeById: Map<string, CodeNodeRaw>,
  sameFileIndex?: Map<string, string>,
): TypeRefOutcome {
  const sourceNode = nodeById.get(edge.source_id)
  if (!sourceNode) {
    return { target_id: null, resolve_status: 'failed' }
  }

  const key = sourceNode.file_path + '|' + edge.target_symbol!

  // ★ 신규: same-file 우선 매칭 (exported 무관)
  if (sameFileIndex) {
    const localId = sameFileIndex.get(key)
    if (localId) return { target_id: localId, resolve_status: 'resolved' }
  }

  // fallback: exportMap (하위 호환)
  const exportedId = exportMap.get(key)
  if (exportedId) {
    return { target_id: exportedId, resolve_status: 'resolved' }
  }
  return { target_id: null, resolve_status: 'failed' }
}

/**
 * Case 2: importsByFileAndSymbol에서 대응 import edge 탐색.
 * 전제: edge.target_specifier !== null, edge.target_symbol 존재.
 */
export function lookupImportEdge(
  edge: CodeEdgeRaw,
  importsByFileAndSymbol: Map<string, CodeEdgeRaw>,
  nodeById: Map<string, CodeNodeRaw>,
  fileNodeIdByPath: Map<string, string>,
): LookupImportResult {
  // (a) 심볼 노드 → 소속 파일 노드 id
  const sourceNode = nodeById.get(edge.source_id)
  if (!sourceNode) return { ok: false, reason: 'no-source' }

  const sourceFileId = fileNodeIdByPath.get(sourceNode.file_path)
  if (!sourceFileId) return { ok: false, reason: 'no-source' }

  // (b) importsByFileAndSymbol lookup
  const lookupKey = sourceFileId + '|' + edge.target_specifier + '|' + edge.target_symbol!
  const importEdge = importsByFileAndSymbol.get(lookupKey)
  if (!importEdge) return { ok: false, reason: 'no-import' }

  return { ok: true, importEdge }
}

/**
 * Case 2c: resolved import edge의 target_id로부터 심볼 해석.
 * 전제: importTargetId !== null (호출자 보장).
 */
export function resolveFromResolvedImport(
  importTargetId: string,
  symbol: string,
  exportMap: Map<string, string>,
  nodeById: Map<string, CodeNodeRaw>,
): TypeRefOutcome {
  const importedNode = nodeById.get(importTargetId)

  // Case 2c-0: dangling
  if (!importedNode) {
    return { target_id: null, resolve_status: 'failed' }
  }

  // Case 2c-1: 심볼 노드 직접 hit (file 아닌 노드)
  if (importedNode.type !== 'file') {
    return { target_id: importedNode.id, resolve_status: 'resolved' }
  }

  // Case 2c-2: file 노드 → exportMap 재조회
  const symbolId = exportMap.get(importedNode.file_path + '|' + symbol)
  if (symbolId) {
    return { target_id: symbolId, resolve_status: 'resolved' }
  }

  // Case 2c-2: default fallback
  const defaultId = exportMap.get(importedNode.file_path + '|default')
  if (defaultId) {
    return { target_id: defaultId, resolve_status: 'resolved' }
  }

  // Case 2c-2: miss
  return { target_id: null, resolve_status: 'failed' }
}

/**
 * Case 2: import edge의 상태에 따른 분기 처리.
 * 전제: symbol 존재 (호출자 보장).
 */
export function resolveFromImport(
  importEdge: CodeEdgeRaw,
  symbol: string,
  exportMap: Map<string, string>,
  nodeById: Map<string, CodeNodeRaw>,
): TypeRefOutcome {
  // Case 2a: external
  if (importEdge.resolve_status === 'external') {
    return { target_id: null, resolve_status: 'external' }
  }

  // Case 2b: failed
  if (importEdge.resolve_status === 'failed') {
    return { target_id: null, resolve_status: 'failed' }
  }

  // Case 2c: resolved + target_id 있음 → 하위 함수 위임
  if (importEdge.resolve_status === 'resolved' && importEdge.target_id) {
    const importedSymbol = importEdge.target_imported_symbol ?? symbol
    return resolveFromResolvedImport(importEdge.target_id, importedSymbol, exportMap, nodeById)
  }

  // Case 2d: pending | resolved+target_id=null (F3 계약 위반 방어)
  // JSON.stringify로 제어문자(\n/\r/ANSI) 이스케이프 → log injection 방지
  console.warn(
    '[F4] imports edge still pending (F3 invariant violation):',
    JSON.stringify({
      source_id: importEdge.source_id,
      target_specifier: importEdge.target_specifier,
      target_symbol: importEdge.target_symbol,
    }),
  )
  return { target_id: null, resolve_status: 'failed' }
}

/**
 * 단일 타입 참조 edge (extends/implements/mixes/uses_type/decorates) 해석.
 *
 * Case 0: target_symbol 없음 → failed
 * Case 1: intra-file (target_specifier=null) → resolveIntraFile (sameFileIndex 우선)
 * Case 2: imports edge 참조 → lookupImportEdge → resolveFromImport
 */
export function resolveOneTypeRef(
  edge: CodeEdgeRaw,
  exportMap: Map<string, string>,
  importsByFileAndSymbol: Map<string, CodeEdgeRaw>,
  nodeById: Map<string, CodeNodeRaw>,
  fileNodeIdByPath: Map<string, string>,
  sameFileIndex?: Map<string, string>,
): TypeRefOutcome {
  // Case 0: target_symbol 누락 (F2 이상치 방어)
  if (!edge.target_symbol) {
    return { target_id: null, resolve_status: 'failed' }
  }

  // Case 1: intra-file
  if (edge.target_specifier === null) {
    return resolveIntraFile(edge, exportMap, nodeById, sameFileIndex)
  }

  // Case 2: import 경유
  const lookup = lookupImportEdge(edge, importsByFileAndSymbol, nodeById, fileNodeIdByPath)
  if (!lookup.ok) {
    return { target_id: null, resolve_status: 'failed' }
  }
  return resolveFromImport(lookup.importEdge, edge.target_symbol, exportMap, nodeById)
}

/** F4 오케스트레이터 */
export async function resolveTypeRefs(
  edges: CodeEdgeRaw[],
  nodes: Readonly<CodeNodeRaw>[],
  _files: SourceFile[],
  onProgress?: (progress: TypeRefProgress) => void,
): Promise<CodeEdgeRaw[]> {
  // 1. 인덱스 구축 (O(n))
  const exportMap = buildExportMap(nodes)
  const sameFileIndex = buildSameFileIndex(nodes)
  const { importsByFileAndSymbol, fileNodeIdByPath } = buildImportsIndex(edges, nodes)
  const nodeById = new Map<string, CodeNodeRaw>()
  for (const node of nodes) nodeById.set(node.id, node as CodeNodeRaw)

  // 2. edge별 분류
  const result: CodeEdgeRaw[] = new Array(edges.length)
  const total = edges.length
  const interval = progressInterval(total)
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]

    // non-target edge: 원본 참조 유지 (얕은 복사 금지, 불변식 F4-4)
    if (!TYPE_REF_RELATIONS.has(edge.relation)) {
      result[i] = edge
      emitProgress(i + 1, total, interval, edge, onProgress)
      continue
    }

    // 이미 처리된 edge: 재처리 금지 (F2/F3에서 판정)
    if (edge.resolve_status !== 'pending') {
      result[i] = edge
      emitProgress(i + 1, total, interval, edge, onProgress)
      continue
    }

    const outcome = resolveOneTypeRef(
      edge, exportMap, importsByFileAndSymbol, nodeById, fileNodeIdByPath, sameFileIndex,
    )
    result[i] = { ...edge, target_id: outcome.target_id, resolve_status: outcome.resolve_status }
    emitProgress(i + 1, total, interval, edge, onProgress)
  }

  return result
}

function emitProgress(
  completed: number,
  total: number,
  interval: number,
  edge: CodeEdgeRaw,
  onProgress?: (progress: TypeRefProgress) => void,
): void {
  if (completed !== total && completed !== 1 && completed % interval !== 0) return
  try {
    onProgress?.({
      completed,
      total,
      currentLabel: edge.target_symbol ?? edge.target_specifier ?? edge.relation,
    })
  } catch { /* progress logging must not affect type resolution */ }
}

function progressInterval(total: number): number {
  if (total <= 100) return 10
  if (total <= 1_000) return 50
  if (total <= 10_000) return 250
  return 1_000
}
