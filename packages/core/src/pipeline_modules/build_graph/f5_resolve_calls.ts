/**
 * F5: resolveCalls — calls/emits/dispatches/listens edge 해석
 * SOT: specs/build_graph/specs/f5_resolve_calls/spec.md
 *
 * 서브함수 (내부 export):
 *   - buildNodeIndices: nodes → NodeIndices
 *   - buildEdgeIndices: edges → EdgeIndices
 *   - resolveSuperCall: super.method() → CallOutcome
 *   - resolveDICall: this.field.method() → CallOutcome (DI 주입 타입 기반)
 *   - resolveIntraFileCall: null / this.method() → CallOutcome (intra-class)
 *   - resolveImportedCall: cross-file / external → CallOutcome
 *   - resolveCalls: 오케스트레이터 (Pass A)
 *
 * module-private 서브함수:
 *   - dispatchCallsEdge — Pass A 분기 dispatch (specifier=null/super./this. + 점/import)
 *   - resolveImportedObjectCall — §5.2.4 importResolvedMap miss 시 fallback
 *
 * 불변식:
 *   - F5-1: 입력 비변형 (nodes/edges 수정 없음)
 *   - F5-2: 출력 길이/순서 동일 (result.length === edges.length)
 *   - F5-3: calls pending 소거
 *   - F5-5: non-target edge 원본 참조 pass-through
 *   - F5-9: DB/FS/LLM 접근 없음, console.warn 사용 안함
 */
import type { CodeNodeRaw, CodeEdgeRaw, ConstructorDIMap, EnumValueMap, FieldOriginsMap, FieldOrigin } from './types.js'

export interface CallResolutionProgress {
  completed: number
  total: number
  currentLabel?: string
}

// ── 내부 export 타입 ──

export type CallOutcome = {
  target_id: string | null
  resolve_status: 'resolved' | 'external' | 'external_chain' | 'failed'
  // P13: 우리 graph 안 type을 추적해서 도달했지만 method 정의가 누락된 진짜 갭(P12).
  // 화이트리스트 fallback에서 elevate되지 않도록 보존하기 위한 in-memory 표식. DB에는 저장 안 함.
  explicit_gap?: boolean
}

export type NodeIndices = {
  nodeById: Map<string, CodeNodeRaw>                         // id → node
  ownerClassByMethodId: Map<string, string>                  // methodNodeId → 소속 classNodeId
  methodsByClassId: Map<string, Map<string, CodeNodeRaw>>    // classId → (bareMethodName → methodNode, 첫 노드 우선)
  nodesByClass: Map<string, CodeNodeRaw[]>                   // className → class nodes[] (file_path 사전순)
  classesByFile: Map<string, CodeNodeRaw[]>                   // filePath → class nodes[]
  nodesByFileAndName: Map<string, CodeNodeRaw>               // `${filePath}|${name}` → same-file symbol node
  exportsByFileAndName: Map<string, CodeNodeRaw>             // `${filePath}|${exportedName}` → exported node
  classMethodLookupCache: Map<string, CodeNodeRaw | null>     // `${classId}|${methodName}` → resolved method/property/null
  fileClassMethodLookupCache: Map<string, CodeNodeRaw | null> // `${filePath}|${methodName}` → unique class method/null
  fieldOrigins?: FieldOriginsMap                              // cross-file resolved field origins (RHS `=new X()` type), attached by resolveCalls
}

export type EdgeIndices = {
  extendsMap: Map<string, string>                            // childClassId → parentClassId (resolved만)
  externalsByFile: Map<string, Set<string>>                  // sourceFileId → external specifier 집합 (파일별 분리, 전역 오염 방지)
  importResolvedMap: Map<string, string>                     // `${fileId}|${spec}|${sym}` → target_id
  importsByFileId: Map<string, CodeEdgeRaw[]>                // fileId → 전체 imports edges (resolve_status 무관, 소비자가 'resolved' 필터링)
  callsBySourceId: Map<string, CodeEdgeRaw[]>                 // sourceId → calls edges (registry/context fallback)
  containsBySourceId: Map<string, CodeEdgeRaw[]>              // sourceId → contains edges (exported object member aliases)
  implementersByInterface: Map<string, string[]>             // BS-13: interfaceId → [구현체 classId, ...] (resolved만)
  implementersByInterfaceName: Map<string, string[]>         // interface NAME → [구현체 classId, ...] (implements edge의 target_symbol 기반; target_id 미해석이어도 동작)
}

export type CallIndices = NodeIndices & EdgeIndices

// ────────────────────────────────────────────────────────────────
// §4.1 buildNodeIndices
// ────────────────────────────────────────────────────────────────

export function buildNodeIndices(
  nodes: Readonly<CodeNodeRaw>[],
): NodeIndices {
  const nodeById             = new Map<string, CodeNodeRaw>()
  const ownerClassByMethodId = new Map<string, string>()
  const methodsByClassId     = new Map<string, Map<string, CodeNodeRaw>>()
  const nodesByClass         = new Map<string, CodeNodeRaw[]>()
  const classesByFile        = new Map<string, CodeNodeRaw[]>()
  const nodesByFileAndName   = new Map<string, CodeNodeRaw>()
  const exportsByFileAndName = new Map<string, CodeNodeRaw>()

  for (const node of nodes) {
    nodeById.set(node.id, node)
    if (node.type !== 'file') {
      const sameFileKey = node.file_path + '|' + node.name
      if (!nodesByFileAndName.has(sameFileKey)) nodesByFileAndName.set(sameFileKey, node)
    }

    if (node.exported && node.type !== 'file' && node.type !== 'method' && !node.name.includes('.')) {
      const key = node.file_path + '|' + node.name
      if (!exportsByFileAndName.has(key)) exportsByFileAndName.set(key, node)
    }

    if (node.type === 'class') {
      const arr = nodesByClass.get(node.name) ?? []
      arr.push(node)
      nodesByClass.set(node.name, arr)
      const fileClasses = classesByFile.get(node.file_path) ?? []
      fileClasses.push(node)
      classesByFile.set(node.file_path, fileClasses)
      continue
    }

    if (node.type === 'method') {
      const member = classMemberFromNode(node)
      if (!member) continue

      if (!ownerClassByMethodId.has(node.id)) ownerClassByMethodId.set(node.id, member.classId)
      if (!methodsByClassId.has(member.classId)) methodsByClassId.set(member.classId, new Map())
      const m = methodsByClassId.get(member.classId)!
      if (!m.has(member.bareName)) m.set(member.bareName, node)       // 첫 노드 우선 (B5 해소)
    }

    // P15-Lite: arrow fn field (`fn = async () => {...}`) 안 calls source_id가 property 노드라
    // ownerClassByMethodId에 등록 안 됨 → P15 origin lookup 못 함. property 노드도 인덱싱 추가.
    if (node.type === 'property') {
      const member = classMemberFromNode(node)
      if (!member) continue
      if (!ownerClassByMethodId.has(node.id)) ownerClassByMethodId.set(node.id, member.classId)
    }
  }

  // nested callback / nested function 노드는 lexical하게 class method 안에 있으면
  // 그 method의 owner class를 상속한다 (arrow fn 안 `this`는 enclosing class를 가리킴).
  // parent_node_id 체인을 따라 이미 owner class가 정해진 조상을 찾아 같은 class로 매핑.
  for (const node of nodes) {
    if (node.type !== 'function') continue
    if (ownerClassByMethodId.has(node.id)) continue
    let parentId = node.parent_node_id ?? null
    let hops = 0
    while (parentId && hops < 20) {
      const owner = ownerClassByMethodId.get(parentId)
      if (owner) {
        ownerClassByMethodId.set(node.id, owner)
        break
      }
      const parentNode = nodeById.get(parentId)
      if (!parentNode) break
      parentId = parentNode.parent_node_id ?? null
      hops++
    }
  }

  // 동명 class tiebreaker: file_path 사전순 (H4 해소)
  for (const [, arr] of nodesByClass) {
    if (arr.length > 1) arr.sort((a, b) => a.file_path < b.file_path ? -1 : a.file_path > b.file_path ? 1 : 0)
  }

  return {
    nodeById,
    ownerClassByMethodId,
    methodsByClassId,
    nodesByClass,
    classesByFile,
    nodesByFileAndName,
    exportsByFileAndName,
    classMethodLookupCache: new Map(),
    fileClassMethodLookupCache: new Map(),
  }
}

function classMemberFromNode(node: CodeNodeRaw): { classId: string; bareName: string } | null {
  const lastColon = node.id.lastIndexOf(':')
  if (lastColon === -1) return null
  const symbolPath = node.id.slice(lastColon + 1)
  const dotIdx = symbolPath.lastIndexOf('.')
  if (dotIdx === -1) return null

  const className = symbolPath.slice(0, dotIdx)
  const bareName = symbolPath.slice(dotIdx + 1)
  if (!className || !bareName) return null
  if (node.name.includes('.') && !node.name.endsWith(`.${bareName}`)) return null

  const classId = `${node.id.slice(0, lastColon + 1)}${className}`
  return { classId, bareName }
}

// ────────────────────────────────────────────────────────────────
// §4.2 buildEdgeIndices
// ────────────────────────────────────────────────────────────────

export function buildEdgeIndices(
  edges: CodeEdgeRaw[],
): EdgeIndices {
  const extendsMap              = new Map<string, string>()
  const externalsByFile         = new Map<string, Set<string>>()
  const importResolvedMap       = new Map<string, string>()
  const importsByFileId         = new Map<string, CodeEdgeRaw[]>()
  const callsBySourceId         = new Map<string, CodeEdgeRaw[]>()
  const containsBySourceId      = new Map<string, CodeEdgeRaw[]>()
  const implementersByInterface = new Map<string, string[]>()
  const implementersByInterfaceName = new Map<string, string[]>()

  for (const edge of edges) {
    if (edge.relation === 'contains') {
      const arr = containsBySourceId.get(edge.source_id) ?? []
      arr.push(edge)
      containsBySourceId.set(edge.source_id, arr)
    }
    if (edge.relation === 'calls') {
      const arr = callsBySourceId.get(edge.source_id) ?? []
      arr.push(edge)
      callsBySourceId.set(edge.source_id, arr)
    }
    if (edge.relation === 'extends' &&
        edge.resolve_status === 'resolved' &&
        edge.target_id !== null) {
      // BS-17 — 중복 childId WARN (한 클래스가 여러 번 extends 매핑 시)
      if (extendsMap.has(edge.source_id) && extendsMap.get(edge.source_id) !== edge.target_id) {
        // eslint-disable-next-line no-console
        console.warn(
          `[F5/buildEdgeIndices] duplicate extends mapping for ${edge.source_id}: ` +
          `existing=${extendsMap.get(edge.source_id)}, new=${edge.target_id} — keeping first`,
        )
        continue  // 첫 매핑 유지
      }
      extendsMap.set(edge.source_id, edge.target_id)
      continue
    }
    // BS-13 — implements edge → interface → 구현체 역방향 인덱스
    if (edge.relation === 'implements') {
      // NAME 기반 역인덱스: target_id 미해석이어도 동작 (default-export interface 등
      // import 해석이 실패해 implements.target_id=null인 경우에도 interface 이름으로 구현체 추적).
      if (edge.target_symbol) {
        const byName = implementersByInterfaceName.get(edge.target_symbol) ?? []
        if (!byName.includes(edge.source_id)) byName.push(edge.source_id)
        implementersByInterfaceName.set(edge.target_symbol, byName)
      }
      // ID 기반 역인덱스 (resolved만): CHA Pass 2(type_resolved fan-out)에서 사용.
      if (edge.resolve_status === 'resolved' && edge.target_id !== null) {
        const arr = implementersByInterface.get(edge.target_id) ?? []
        arr.push(edge.source_id)
        implementersByInterface.set(edge.target_id, arr)
      }
      continue
    }
    if (edge.relation === 'imports') {
      if (edge.resolve_status === 'external' && edge.target_specifier) {
        // 전역 Set 대신 file별 Map<sourceFileId, Set<string>> 로 관리 (전역 오염 방지)
        const sourceFileId = edge.source_id
        if (!externalsByFile.has(sourceFileId)) externalsByFile.set(sourceFileId, new Set())
        externalsByFile.get(sourceFileId)!.add(edge.target_specifier)
      }
      if (edge.resolve_status === 'resolved' &&
          edge.target_id !== null &&
          edge.target_specifier && edge.target_symbol) {
        const key = edge.source_id + '|' + edge.target_specifier + '|' + edge.target_symbol
        if (!importResolvedMap.has(key)) importResolvedMap.set(key, edge.target_id)
        // A call site references an imported symbol by its LOCAL binding name, which can
        // differ from target_symbol — `import x from './m'` (target_symbol='default',
        // target_local_symbol='x'), `import { a as b }` (target_symbol='a', local='b').
        // Index the resolved import under the local name too so direct calls (`x(...)`)
        // resolve via the same map. (Generalizable AST/symbol-semantics rule.)
        if (edge.target_local_symbol && edge.target_local_symbol !== edge.target_symbol) {
          const localKey = edge.source_id + '|' + edge.target_specifier + '|' + edge.target_local_symbol
          if (!importResolvedMap.has(localKey)) importResolvedMap.set(localKey, edge.target_id)
        }
      }
      const arr = importsByFileId.get(edge.source_id) ?? []
      arr.push(edge)
      importsByFileId.set(edge.source_id, arr)
      continue
    }
  }

  return { extendsMap, externalsByFile, importResolvedMap, importsByFileId, callsBySourceId, containsBySourceId, implementersByInterface, implementersByInterfaceName }
}

// ────────────────────────────────────────────────────────────────
// §4.3 resolveSuperCall
// ────────────────────────────────────────────────────────────────

export function resolveSuperCall(
  edge: CodeEdgeRaw,
  indices: CallIndices,
): CallOutcome {
  // 전제: edge.target_specifier.startsWith('super.')
  const methodName = edge.target_specifier!.slice('super.'.length)
  if (!methodName) return { target_id: null, resolve_status: 'failed' }   // 'super.' 만 있는 이상치

  const ownerClassId = indices.ownerClassByMethodId.get(edge.source_id)
  if (!ownerClassId) return { target_id: null, resolve_status: 'failed' }

  // BS-15: 다단계 상속 + visited Set + depth ≤ 20
  // 부모 → 조부모 → ... 재귀하면서 method 찾기. 순환 상속은 visited로 방지.
  const visited = new Set<string>()
  visited.add(ownerClassId)

  let currentClassId: string | undefined = indices.extendsMap.get(ownerClassId)
  let depth = 0
  while (currentClassId && depth < 20) {
    if (visited.has(currentClassId)) {
      // 순환 상속 감지
      return { target_id: null, resolve_status: 'failed' }
    }
    visited.add(currentClassId)
    const methodMap = indices.methodsByClassId.get(currentClassId)
    const target = methodMap?.get(methodName)
    if (target) return { target_id: target.id, resolve_status: 'resolved' }
    currentClassId = indices.extendsMap.get(currentClassId)
    depth++
  }
  return { target_id: null, resolve_status: 'failed' }
}

// ────────────────────────────────────────────────────────────────
// §4.4 resolveDICall
// ────────────────────────────────────────────────────────────────

// P17 + F5-2: 동명 class 여러 개일 때 owner file의 import path 따라가서 정확한 class 매칭
// imports edge의 target_id 형식은 두 가지: class 노드 ID (`{repo}:{path}:{name}`) 또는 file 노드 ID (`{repo}:{path}`)
// 우선순위: import target → owner file 자체 정의 → method-aware (F5-2: methodName 정의된 class 우선) → 첫 매칭(사전순) fallback
function pickClassNodeByImport(
  classNodes: readonly CodeNodeRaw[],
  ownerClass: CodeNodeRaw,
  typeName: string,
  indices: CallIndices,
  methodName?: string,
): CodeNodeRaw {
  if (classNodes.length <= 1) return classNodes[0]

  const ownerFileId = `${ownerClass.repo_id}:${ownerClass.file_path}`
  const importEdges = indices.importsByFileId.get(ownerFileId) ?? []
  for (const ie of importEdges) {
    if (ie.resolve_status !== 'resolved') continue
    if (ie.target_symbol !== typeName) continue
    if (!ie.target_id) continue

    // Case A: target_id가 class 노드 ID — 직접 매칭
    const targetNode = indices.nodeById.get(ie.target_id)
    if (targetNode?.type === 'class' && targetNode.name === typeName) {
      // classNodes 안에 있는지 확인 (id 동일성)
      const match = classNodes.find((n) => n.id === targetNode.id)
      if (match) return match
    }

    // Case B: target_id가 file 노드 ID — file_path 추출해서 매칭
    if (targetNode?.type === 'file') {
      const match = classNodes.find((n) => n.file_path === targetNode.file_path)
      if (match) return match
    }

    // Case C: target_id 형식만 보고 file_path 추출 (target 노드 nodeById에 없는 경우 fallback)
    const colon = ie.target_id.indexOf(':')
    if (colon !== -1) {
      const rest = ie.target_id.slice(colon + 1)
      // 'src/foo/bar.ts' (file) 또는 'src/foo/bar.ts:Symbol' (class) 둘 다 가능
      const symColon = rest.indexOf(':')
      const importedFilePath = symColon === -1 ? rest : rest.slice(0, symColon)
      const match = classNodes.find((n) => n.file_path === importedFilePath)
      if (match) return match
    }
  }

  // F5-2: method-aware fallback — methodName 정의된 class 우선
  // (import edge가 pending/failed인 동명 class 다중 케이스에 효과적)
  if (methodName) {
    for (const cn of classNodes) {
      const methodMap = indices.methodsByClassId.get(cn.id)
      if (methodMap?.has(methodName)) return cn
      // property로도 정의 가능 (arrow fn field)
      const propId = `${cn.repo_id}:${cn.file_path}:${cn.name}.${methodName}`
      const propNode = indices.nodeById.get(propId)
      if (propNode?.type === 'property') return cn
    }
  }

  // owner file 자체 정의 우선 (IM-04 케이스)
  const sameFile = classNodes.find((n) => n.file_path === ownerClass.file_path)
  if (sameFile) return sameFile

  return classNodes[0]
}

// interface 이름 → graph 안의 concrete 구현체 class 노드들.
// implements edge의 target_symbol(=interface 이름) 기반 역인덱스를 쓰므로 implements
// edge의 target_id가 미해석이어도 동작한다. 단, source가 실제 class 노드인 것만 채택
// (interface가 다른 interface를 extends하는 케이스 등 비-class source 배제).
function implementerClassesForInterface(
  interfaceName: string,
  indices: CallIndices,
): CodeNodeRaw[] {
  const implementerIds = indices.implementersByInterfaceName.get(interfaceName)
  if (!implementerIds || implementerIds.length === 0) return []
  const seen = new Set<string>()
  const classes: CodeNodeRaw[] = []
  for (const id of implementerIds) {
    const node = indices.nodeById.get(id)
    if (node?.type !== 'class') continue
    if (seen.has(node.id)) continue
    seen.add(node.id)
    classes.push(node)
  }
  return classes
}

// depth-1 `this.X.method` 매칭: 대상 class에서 method → property → extends chain(다중 hop)
// 순으로 검색. graph 안 type은 확정됐는데 정의가 없으면 explicit_gap(진짜 갭)으로 표시한다.
function resolveMethodOnClass(
  pickedClass: CodeNodeRaw,
  methodName: string,
  indices: CallIndices,
): CallOutcome {
  const methodMap = indices.methodsByClassId.get(pickedClass.id)
  const target = methodMap?.get(methodName)
  if (target) return { target_id: target.id, resolve_status: 'resolved' }

  const propertyNodeId = `${pickedClass.repo_id}:${pickedClass.file_path}:${pickedClass.name}.${methodName}`
  const propertyNode = indices.nodeById.get(propertyNodeId)
  if (propertyNode && propertyNode.type === 'property') {
    return { target_id: propertyNode.id, resolve_status: 'resolved' }
  }

  // DOC-3: extends chain 따라 부모 class에서 method 검색 (multi-hop)
  let cur: string | undefined = indices.extendsMap.get(pickedClass.id)
  let hops = 0
  while (cur && hops < 10) {
    const parentMethods = indices.methodsByClassId.get(cur)
    const parentTarget = parentMethods?.get(methodName)
    if (parentTarget) return { target_id: parentTarget.id, resolve_status: 'resolved' }
    const parentNode = indices.nodeById.get(cur)
    if (parentNode) {
      const parentPropId = `${parentNode.repo_id}:${parentNode.file_path}:${parentNode.name}.${methodName}`
      const parentPropNode = indices.nodeById.get(parentPropId)
      if (parentPropNode?.type === 'property') {
        return { target_id: parentPropNode.id, resolve_status: 'resolved' }
      }
    }
    cur = indices.extendsMap.get(cur)
    hops++
  }

  // P13: DI param의 우리 graph 안 type 확인됨 + method 정의 누락 (extends chain까지 검색 후) = 진짜 갭
  return { target_id: null, resolve_status: 'failed', explicit_gap: true }
}

export function resolveDICall(
  edge: CodeEdgeRaw,
  indices: CallIndices,
  constructorDIMap: ConstructorDIMap,
): CallOutcome {
  // 전제: edge.target_specifier.startsWith('this.') ∧ 'this.' 이후 점 1개 이상
  const afterThis  = edge.target_specifier!.slice('this.'.length)
  const firstDot   = afterThis.indexOf('.')
  const fieldName  = afterThis.slice(0, firstDot)
  const rest       = afterThis.slice(firstDot + 1)
  const lastDot    = rest.lastIndexOf('.')
  const methodName = lastDot === -1 ? rest : rest.slice(lastDot + 1)
  // 'this.svc.ns.m' → 마지막 세그먼트가 실제 메서드명 (중간 namespace 허용)

  const ownerClassId = indices.ownerClassByMethodId.get(edge.source_id)
  if (!ownerClassId) return { target_id: null, resolve_status: 'failed' }

  const params = constructorDIMap.get(ownerClassId)
  const param = params?.find(p => p.fieldName === fieldName)

  if (param) {
    let classNodes = indices.nodesByClass.get(param.typeName)
    if (!classNodes || classNodes.length === 0) {
      // typeName이 class가 아니라 interface인 경우: 단일 concrete 구현체로 매핑.
      // (`constructor(private x: IFoo)` + `this.x.bar()` + `class Foo implements IFoo`)
      // implements edge target_id가 미해석(default-export interface 등)이어도 interface
      // 이름 기반 역인덱스로 동작한다. 구현체가 정확히 1개일 때만 (다중=모호 → 비해석).
      const implClasses = implementerClassesForInterface(param.typeName, indices)
      if (implClasses.length === 1) {
        classNodes = implClasses
      } else {
        // P11: typeName이 graph 안에 class로 없고 단일 구현체도 없음 = 외부 lib type 또는 모호 → external_chain
        return { target_id: null, resolve_status: 'external_chain' }
      }
    }

    // P17 + F5-2: 동명 class 다중일 때 owner file의 import path + method-aware 정확한 class 매칭
    const ownerClassNode = indices.nodeById.get(ownerClassId)
    const pickedClass = ownerClassNode
      ? pickClassNodeByImport(classNodes, ownerClassNode, param.typeName, indices, methodName)
      : classNodes[0]

    // P12: depth 2+ chain (this.X.Y.Z.method) — middle property type 추적
    if (lastDot !== -1) {
      const middleSegments = rest.slice(0, lastDot).split('.')  // ['Y', 'Z']
      const deep = resolveDeepChainSegments(pickedClass, middleSegments, methodName, indices)
      if (deep) return deep
      // 추적 실패 → external_chain (graph receiver 부분 정보)
      return { target_id: null, resolve_status: 'external_chain' }
    }

    // depth 1 (this.X.method) — class(+extends chain)에서 method/property 매칭
    return resolveMethodOnClass(pickedClass, methodName, indices)
  }

  // P5 fix: field initializer fallback — fieldName이 constructor DI에 없으면 같은 class의 property 노드로 매핑
  // (예: `private readonly prisma = SGlobal.prismaPrimary` → method body의 `this.prisma.x.y()` chain root 매핑)
  const ownerClass = indices.nodeById.get(ownerClassId)
  if (ownerClass) {
    const propertyNodeId = `${ownerClass.repo_id}:${ownerClass.file_path}:${ownerClass.name}.${fieldName}`
    const propertyNode = indices.nodeById.get(propertyNodeId)
    if (propertyNode && propertyNode.type === 'property') {
      return { target_id: propertyNode.id, resolve_status: 'resolved' }
    }
  }

  return { target_id: null, resolve_status: 'failed' }
}

// P12: depth 2+ chain — middle segment를 property로 따라가며 type chain 추적
// 예: this.cache.inner.set
//   currentClass = CacheWrapper
//   middleSegments = ['inner']
//   methodName = 'set'
//   1) CacheWrapper.inner property 노드 lookup
//   2) property의 type_ref edge → InnerCache class 노드 lookup
//   3) currentClass = InnerCache → set method 매칭
function resolveDeepChainSegments(
  startClass: CodeNodeRaw,
  middleSegments: string[],
  methodName: string,
  indices: CallIndices,
): CallOutcome | null {
  let currentClass: CodeNodeRaw | null = startClass
  for (const seg of middleSegments) {
    /* v8 ignore next -- currentClass is never assigned null inside this loop */
    if (!currentClass) return null
    // currentClass.{seg} property 노드 lookup
    const propNodeId = `${currentClass.repo_id}:${currentClass.file_path}:${currentClass.name}.${seg}`
    const propNode = indices.nodeById.get(propNodeId)
    if (!propNode || propNode.type !== 'property') return null

    // property의 type_ref edge(시그니처)로 다음 class 추적;
    // 실패 시 fieldOrigins(무타입 `field = new X()` RHS 추론) fallback — root 필드 해석과 동일 소스 재사용.
    let nextClassNode = findClassFromPropertyTypeRef(propNode, indices)
    if (!nextClassNode) {
      const origin: FieldOrigin | undefined = indices.fieldOrigins?.get(currentClass.id)?.get(seg)
      if (origin?.kind === 'internal') {
        nextClassNode = indices.nodesByClass.get(origin.typeName)?.[0] ?? null
      }
    }
    if (!nextClassNode) return null
    currentClass = nextClassNode
  }

  /* v8 ignore next -- currentClass starts non-null and the loop only assigns concrete class nodes */
  if (!currentClass) return null

  // 마지막 segment를 method/property로 매칭
  const methodMap = indices.methodsByClassId.get(currentClass.id)
  const target = methodMap?.get(methodName)
  if (target) return { target_id: target.id, resolve_status: 'resolved' }

  const propertyNodeId = `${currentClass.repo_id}:${currentClass.file_path}:${currentClass.name}.${methodName}`
  const propertyNode = indices.nodeById.get(propertyNodeId)
  if (propertyNode && propertyNode.type === 'property') {
    return { target_id: propertyNode.id, resolve_status: 'resolved' }
  }

  // middle은 끝까지 추적 성공 + 끝 method 매칭 실패 = 진짜 갭 (우리 class에 정의 누락)
  // P13: explicit_gap=true → 화이트리스트 fallback에서 elevate 방지
  return { target_id: null, resolve_status: 'failed', explicit_gap: true }
}

// property 노드의 type_ref edge에서 class 노드 추적
function findClassFromPropertyTypeRef(
  propNode: CodeNodeRaw,
  indices: CallIndices,
): CodeNodeRaw | null {
  // propNode의 outgoing type_ref edge들을 sweep — 이 함수는 indices에 없는 정보라 nodeById 순회 대신 별도 인덱스 필요
  // 단순화: property의 type_ref edge를 같은 file에서 찾되, 빠른 lookup 위해 nodesByClass 활용
  // 우선 propNode의 file_path 안에서 property 이름과 매칭되는 type_ref edge를 찾아 target_symbol로 class 추적
  // (여기서는 property 노드의 sig 문자열에서 type 이름을 단순 추출 — type annotation 분석)
  const sig = propNode.signature ?? ''
  // sig 형식 예: ': InnerCache' 또는 ': InnerCache<T>'
  const match = sig.match(/:\s*([A-Z]\w*)/)
  if (!match) return null
  const typeName = match[1]
  const classes = indices.nodesByClass.get(typeName)
  return classes?.[0] ?? null
}

// ────────────────────────────────────────────────────────────────
// §4.5 resolveIntraFileCall
// ────────────────────────────────────────────────────────────────

export function resolveIntraFileCall(
  edge: CodeEdgeRaw,
  indices: CallIndices,
): CallOutcome {
  const spec = edge.target_specifier

  // Case A: Dart/Flutter bare same-file symbol call.
  // Example: `createState() => _MyWidgetState()` has no target_specifier but carries target_symbol.
  if (spec === null) {
    return resolveSameFileBareSymbolCall(edge, indices)
  }

  // Case B: 'this.method()' intra-class (오케스트레이터 dispatch 보장)
  const methodName = spec.slice('this.'.length)
  if (!methodName) return { target_id: null, resolve_status: 'failed' }

  const ownerClassId = indices.ownerClassByMethodId.get(edge.source_id)
  if (!ownerClassId) return { target_id: null, resolve_status: 'failed' }

  const methodMap = indices.methodsByClassId.get(ownerClassId)
  const target    = methodMap?.get(methodName)
  if (target) return { target_id: target.id, resolve_status: 'resolved' }

  // P16-B: arrow fn field self call — `private _fn = async () => {}` + `this._fn()` 같은 class
  // method 매칭 실패 시 같은 class의 동명 property 노드 fallback
  const ownerClass = indices.nodeById.get(ownerClassId)
  if (ownerClass) {
    const propertyNodeId = `${ownerClass.repo_id}:${ownerClass.file_path}:${ownerClass.name}.${methodName}`
    const propertyNode = indices.nodeById.get(propertyNodeId)
    if (propertyNode && propertyNode.type === 'property') {
      return { target_id: propertyNode.id, resolve_status: 'resolved' }
    }
  }

  return { target_id: null, resolve_status: 'failed' }
}

function resolveSameFileBareSymbolCall(
  edge: CodeEdgeRaw,
  indices: CallIndices,
): CallOutcome {
  const symbol = edge.target_symbol
  if (!symbol) return { target_id: null, resolve_status: 'failed' }

  const ownerClassId = indices.ownerClassByMethodId.get(edge.source_id)
  if (ownerClassId) {
    const method = indices.methodsByClassId.get(ownerClassId)?.get(symbol)
    if (method) return { target_id: method.id, resolve_status: 'resolved' }

    const ownerClass = indices.nodeById.get(ownerClassId)
    if (ownerClass) {
      const propertyNode = indices.nodeById.get(`${ownerClass.repo_id}:${ownerClass.file_path}:${ownerClass.name}.${symbol}`)
      if (propertyNode?.type === 'property') return { target_id: propertyNode.id, resolve_status: 'resolved' }
    }
  }

  const sourceNode = indices.nodeById.get(edge.source_id)
  if (!sourceNode) return { target_id: null, resolve_status: 'failed' }

  const sameFileNode = indices.nodesByFileAndName.get(`${sourceNode.file_path}|${symbol}`)
  if (sameFileNode) return { target_id: sameFileNode.id, resolve_status: 'resolved' }

  return { target_id: null, resolve_status: 'failed' }
}

// ────────────────────────────────────────────────────────────────
// §4.6 resolveImportedCall
// ────────────────────────────────────────────────────────────────

export function resolveImportedCall(
  edge: CodeEdgeRaw,
  indices: CallIndices,
): CallOutcome {
  // 전제: edge.target_specifier !== null ∧ super./this. 로 시작하지 않음
  const specifier = edge.target_specifier!

  // (b) sourceNode → sourceFileNodeId (external 체크 전에 먼저 — file별 lookup 필요)
  const sourceNode = indices.nodeById.get(edge.source_id)
  if (!sourceNode) return { target_id: null, resolve_status: 'failed' }

  // sourceFileNodeId = node의 repo_id + ':' + file_path (H3 통일 — 모든 서브함수 공통 규약)
  const sourceFileNodeId = sourceNode.repo_id + ':' + sourceNode.file_path

  // (a) external 전파 — 이 파일의 imports edge가 외부 패키지면 calls도 external (파일별 분리, 전역 오염 방지)
  const fileExternals = indices.externalsByFile.get(sourceFileNodeId)
  if (fileExternals?.has(specifier)) {
    return { target_id: null, resolve_status: 'external' }
  }

  // (c) importResolvedMap lookup
  if (!edge.target_symbol) return { target_id: null, resolve_status: 'failed' }
  const key = sourceFileNodeId + '|' + specifier + '|' + edge.target_symbol
  const targetId = indices.importResolvedMap.get(key)
  if (targetId) return { target_id: targetId, resolve_status: 'resolved' }

  // (d) namespace member chain — HB-02 BS-신규 fix (chain_path가 import-bound namespace로 시작)
  //     예: chain_path='userRepository.other', target_symbol='findUserById'
  //         → 같은 파일 안 노드 'userRepository.other.findUserById' 매칭
  const namespaceMember = resolveNamespaceMemberCall(edge, sourceFileNodeId, indices)
  if (namespaceMember) return namespaceMember

  const imported = resolveImportedObjectCall(edge, sourceFileNodeId, indices)
  if (imported.resolve_status === 'resolved') return imported

  const importedObjectMember = resolveImportedObjectMemberAliasCall(edge, sourceFileNodeId, indices)
  if (importedObjectMember) return importedObjectMember

  // (e) P9: external_chain — chain root가 import-bound resolved + 끝 method 외부
  //     예: SGlobal.prisma.user.findMany — SGlobal까지 graph 도달, .findMany는 외부 prisma type
  //         logger.error — logger import-bound, .error는 외부 lib method
  //     의미: graph receiver 도달 + 끝 method는 LLM/type-checker 영역 (정적분석 외)
  if (edge.chain_path) {
    const chainRoot = edge.chain_path.split('.')[0]
    const importsList = indices.importsByFileId.get(sourceFileNodeId) ?? []
    const importMatch = importsList.find(
      (c) =>
        c.resolve_status === 'resolved' &&
        c.target_id !== null &&
        (c.target_symbol === chainRoot || c.target_local_symbol === chainRoot),
    )
    if (importMatch) {
      return { target_id: null, resolve_status: 'external_chain' }
    }
  }

  return imported
}

function resolveImportedObjectMemberAliasCall(
  edge: CodeEdgeRaw,
  sourceFileNodeId: string,
  indices: CallIndices,
): CallOutcome | null {
  if (!edge.chain_path || !edge.target_symbol || !edge.target_specifier) return null
  const chainRoot = edge.chain_path.split('.')[0]
  if (!chainRoot) return null

  const imports = indices.importsByFileId.get(sourceFileNodeId) ?? []
  const importEdge = imports.find(candidate =>
    candidate.resolve_status === 'resolved' &&
    candidate.target_id !== null &&
    candidate.target_specifier === edge.target_specifier &&
    (candidate.target_symbol === chainRoot || candidate.target_local_symbol === chainRoot)
  )
  if (!importEdge?.target_id) return null

  const members = indices.containsBySourceId.get(importEdge.target_id) ?? []
  const matches = members.filter((member) =>
    member.resolve_status === 'resolved' &&
    member.target_id !== null &&
    member.target_symbol === edge.target_symbol
  )
  if (matches.length !== 1) return null
  return { target_id: matches[0].target_id, resolve_status: 'resolved' }
}

function resolveNamespaceMemberCall(
  edge: CodeEdgeRaw,
  sourceFileNodeId: string,
  indices: CallIndices,
): CallOutcome | null {
  if (!edge.chain_path || !edge.target_symbol || !edge.target_specifier) return null
  const chainRoot = edge.chain_path.split('.')[0]
  if (!chainRoot) return null

  const imports = indices.importsByFileId.get(sourceFileNodeId) ?? []
  const importEdge = imports.find(
    (c) =>
      c.resolve_status === 'resolved' &&
      c.target_id !== null &&
      c.target_specifier === edge.target_specifier &&
      (c.target_symbol === chainRoot || c.target_local_symbol === chainRoot),
  )
  if (!importEdge?.target_id) return null

  const importedNode = indices.nodeById.get(importEdge.target_id)
  if (!importedNode) return null

  // `import * as cache from './redis'` 같은 local 모듈 namespace import:
  // chainRoot(cache)이 그 모듈 파일을 직접 가리키고 chain depth 1이면
  // (cache.del) → 파일이 export한 멤버(del)로 매핑.
  const restChainRaw = edge.chain_path.slice(chainRoot.length)
  if (importedNode.type === 'file' && restChainRaw === '') {
    const exportedMember = indices.exportsByFileAndName.get(
      importedNode.file_path + '|' + edge.target_symbol,
    )
    if (exportedMember) {
      return { target_id: exportedMember.id, resolve_status: 'resolved' }
    }
  }

  // namespace fn full name = chain_path + '.' + target_symbol
  // P6 fix: chain_path가 alias로 시작하면(`repo.json` 형태) → 원본 namespace 이름(`userRepository.json`)으로 교체
  // importedNode.name = 실제 namespace 노드 이름 (원본 export name) — alias import에도 안전
  const namespaceName = importedNode.type === 'file' ? chainRoot : importedNode.name
  const restChain = restChainRaw  // '' 또는 '.json' 등
  const fullName = namespaceName + restChain + '.' + edge.target_symbol
  const candidateId = importedNode.repo_id + ':' + importedNode.file_path + ':' + fullName
  const fnNode = indices.nodeById.get(candidateId)
  if (fnNode) {
    return { target_id: fnNode.id, resolve_status: 'resolved' }
  }
  return null
}

function resolveImportedObjectCall(
  edge: CodeEdgeRaw,
  sourceFileNodeId: string,
  indices: CallIndices,
): CallOutcome {
  if (!edge.target_specifier || !edge.target_symbol) return { target_id: null, resolve_status: 'failed' }
  const firstDot = edge.target_symbol.indexOf('.')
  if (firstDot === -1) return { target_id: null, resolve_status: 'failed' }

  const rootSymbol = edge.target_symbol.slice(0, firstDot)
  const memberName = edge.target_symbol.slice(firstDot + 1).split('.').at(-1)
  if (!rootSymbol || !memberName) return { target_id: null, resolve_status: 'failed' }

  const imports = indices.importsByFileId.get(sourceFileNodeId) ?? []
  const importEdge = imports.find(candidate =>
    candidate.resolve_status === 'resolved'
    && candidate.target_id !== null
    && candidate.target_specifier === edge.target_specifier
    && (candidate.target_symbol === rootSymbol || candidate.target_local_symbol === rootSymbol),
  )
  if (!importEdge?.target_id) return { target_id: null, resolve_status: 'failed' }

  const importedNode = indices.nodeById.get(importEdge.target_id)
  if (!importedNode) return { target_id: null, resolve_status: 'failed' }

  if (importedNode.type === 'file') {
    const exportedMember = indices.exportsByFileAndName.get(importedNode.file_path + '|' + memberName)
    return exportedMember
      ? { target_id: exportedMember.id, resolve_status: 'resolved' }
      : { target_id: null, resolve_status: 'failed' }
  }

  const method = indices.methodsByClassId.get(importedNode.id)?.get(memberName)
  if (method) return { target_id: method.id, resolve_status: 'resolved' }

  return { target_id: null, resolve_status: 'failed' }
}

// ────────────────────────────────────────────────────────────────
// dispatchCallsEdge — 모듈 private helper (export 안함)
// ────────────────────────────────────────────────────────────────

// P10: JS builtin globals — import 없이 사용 (globalThis). specifier=null + symbol/chainRoot이 builtin → external
const JS_BUILTIN_GLOBALS = new Set([
  // Constructors
  'Date', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Array',
  'Number', 'String', 'Boolean', 'Symbol', 'RegExp', 'Error', 'BigInt',
  'Proxy', 'Reflect', 'ArrayBuffer', 'Int8Array', 'Uint8Array', 'Float32Array', 'Float64Array',
  'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
  // Namespaces
  'Math', 'JSON', 'Object', 'Function',
  // Functions
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
])

function isBuiltinCall(edge: CodeEdgeRaw): boolean {
  if (edge.target_specifier !== null) return false
  if (!edge.target_symbol) return false
  // Case 1: new Date() / Map() — target_symbol 자체가 builtin
  if (JS_BUILTIN_GLOBALS.has(edge.target_symbol)) return true
  // Case 2: Math.floor / JSON.stringify — chain_path root이 builtin
  if (edge.chain_path) {
    const root = edge.chain_path.split('.')[0]
    if (JS_BUILTIN_GLOBALS.has(root)) return true
  }
  return false
}

// P13: ECMAScript built-in prototype method 화이트리스트
// receiver type 추적 불가능한 호출(arr.map, name.trim 등)을 external로 정직히 분류.
// self/DI/import 모두 실패 시 fallback으로만 적용 (false positive 방지).
const PROTO_METHODS_WHITELIST = new Set<string>([
  // Array.prototype
  'map', 'filter', 'reduce', 'reduceRight', 'push', 'pop', 'shift', 'unshift',
  'slice', 'splice', 'concat', 'includes', 'find', 'findIndex', 'findLast', 'findLastIndex',
  'indexOf', 'lastIndexOf', 'some', 'every', 'forEach', 'sort', 'reverse',
  'flat', 'flatMap', 'join', 'fill', 'at', 'copyWithin', 'entries', 'keys', 'values',
  // String.prototype
  'charAt', 'charCodeAt', 'codePointAt', 'substring', 'substr', 'split',
  'trim', 'trimStart', 'trimEnd', 'padStart', 'padEnd', 'repeat',
  'replace', 'replaceAll', 'startsWith', 'endsWith', 'match', 'matchAll',
  'search', 'normalize', 'toLowerCase', 'toUpperCase', 'localeCompare',
  // Set/Map.prototype (slice/includes/indexOf 등은 Array와 겹침 — 위에서 이미)
  'add', 'has', 'get', 'set', 'delete', 'clear',
  // Date.prototype
  'getTime', 'getDate', 'getMonth', 'getFullYear', 'getHours', 'getMinutes',
  'getSeconds', 'getMilliseconds', 'getDay', 'getTimezoneOffset',
  'getUTCDate', 'getUTCMonth', 'getUTCFullYear', 'getUTCHours', 'getUTCMinutes',
  'getUTCSeconds', 'getUTCDay',
  'setDate', 'setMonth', 'setFullYear', 'setHours', 'setMinutes', 'setSeconds',
  'toISOString', 'toJSON', 'toDateString', 'toTimeString',
  'toLocaleDateString', 'toLocaleString', 'toLocaleTimeString',
  // Promise.prototype
  'then', 'catch', 'finally',
  // Number.prototype
  'toFixed', 'toPrecision', 'toExponential',
  // RegExp.prototype
  'test', 'exec',
  // Object.prototype
  'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
])

function isProtoMethodSymbol(edge: CodeEdgeRaw): boolean {
  if (!edge.target_symbol) return false
  return PROTO_METHODS_WHITELIST.has(edge.target_symbol)
}

// P18: 조건부 ORM 화이트리스트
// - method 이름이 ORM 화이트리스트 + this.X 분기 아님 (this.X는 P15-Lite가 정확히 처리)
// - failed 결과만 elevate (resolved/external_chain 등은 그대로)
const ORM_METHODS_WHITELIST = new Set<string>([
  // Prisma model client
  'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'findMany',
  'create', 'createMany', 'createManyAndReturn',
  'update', 'updateMany', 'updateManyAndReturn', 'upsert',
  'delete', 'deleteMany',
  'count', 'aggregate', 'groupBy',
  '$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe', '$transaction',
  '$primary', '$replica', '$extends', '$on', '$connect', '$disconnect', '$use',
  // Kysely
  'selectFrom', 'insertInto', 'updateTable', 'deleteFrom',
  'selectAll', 'selectAllFrom', 'where', 'andWhere', 'orWhere', 'having', 'orderBy',
  'innerJoin', 'leftJoin', 'rightJoin', 'fullJoin', 'on', 'onRef',
  'returning', 'returningAll', 'execute', 'executeTakeFirst', 'executeTakeFirstOrThrow',
  'withSchema', 'with', 'union', 'unionAll',
  // TypeORM/Mongoose 공통
  'findById', 'findByIdAndUpdate', 'findByIdAndDelete', 'findOne', 'findOneAndUpdate',
  'save', 'remove', 'softRemove', 'restore', 'increment', 'decrement',
  // Drizzle
  'insert', 'select',
])

function isOrmMethodCall(edge: CodeEdgeRaw): boolean {
  if (!edge.target_symbol) return false
  if (!ORM_METHODS_WHITELIST.has(edge.target_symbol)) return false
  // this.X 분기는 P15-Lite가 처리 — 화이트리스트 적용 X (false positive 방지)
  if (edge.target_specifier?.startsWith('this.')) return false
  if (edge.target_specifier?.startsWith('super.')) return false
  return true
}

// DC-flutter: Flutter SDK + 인기 Dart 패키지 widget/class/method 화이트리스트
// dart.dev/flutter API 문서 기반. Dart는 show clause 없는 file-level import가 흔해서
// symbol → 패키지 매핑이 어댑터 단계에서 안 됨 → F5에서 화이트리스트로 external 분류.
const FLUTTER_KNOWN_SYMBOLS = new Set<string>([
  // ── Flutter Material widgets ──
  'Scaffold', 'SafeArea', 'AppBar', 'Drawer', 'BottomNavigationBar', 'BottomAppBar',
  'TabBar', 'Tab', 'TabBarView', 'TabController', 'DefaultTabController',
  'SliverAppBar', 'NestedScrollView', 'CustomScrollView', 'SliverList', 'SliverGrid',
  'SliverToBoxAdapter', 'SliverFillRemaining', 'SliverPersistentHeader',
  'Container', 'Center', 'Padding', 'Align', 'AspectRatio', 'FractionallySizedBox',
  'ConstrainedBox', 'LimitedBox', 'OverflowBox', 'SizedBox', 'Spacer',
  'Column', 'Row', 'Wrap', 'Stack', 'Positioned', 'IndexedStack', 'Flow',
  'Expanded', 'Flexible', 'Visibility', 'Opacity', 'Offstage', 'Transform',
  'ClipRect', 'ClipRRect', 'ClipOval', 'ClipPath', 'CustomPaint', 'CustomClipper',
  'DecoratedBox', 'BoxDecoration', 'BoxShadow', 'BorderRadius', 'Border', 'BorderSide',
  'EdgeInsets', 'EdgeInsetsGeometry',
  'Text', 'RichText', 'SelectableText', 'TextSpan', 'TextStyle', 'TextAlign',
  'TextField', 'TextFormField', 'Form', 'FormField', 'TextEditingController',
  'ElevatedButton', 'OutlinedButton', 'TextButton', 'IconButton', 'FloatingActionButton',
  'FilledButton', 'PopupMenuButton', 'PopupMenuItem', 'DropdownButton', 'DropdownMenuItem',
  'Switch', 'Checkbox', 'Radio', 'Slider', 'CheckboxListTile', 'RadioListTile', 'SwitchListTile',
  'Icon', 'IconData', 'Icons', 'CupertinoIcons',
  'Image', 'AssetImage', 'NetworkImage', 'FadeInImage', 'CircleAvatar',
  'GestureDetector', 'InkWell', 'InkResponse', 'Material', 'Hero', 'Draggable',
  'Card', 'ListTile', 'Divider', 'VerticalDivider', 'ExpansionTile', 'ExpansionPanel',
  'ListView', 'GridView', 'PageView', 'SingleChildScrollView', 'Scrollbar',
  'RefreshIndicator', 'ReorderableListView', 'Dismissible', 'DraggableScrollableSheet',
  'AlertDialog', 'SimpleDialog', 'Dialog', 'BottomSheet',
  'showDialog', 'showAdaptiveDialog', 'showModalBottomSheet', 'showBottomSheet',
  'showMenu', 'showSearch', 'showSnackBar', 'showAboutDialog', 'showLicensePage',
  'SnackBar', 'SnackBarAction', 'Toast',
  'ProgressIndicator', 'CircularProgressIndicator', 'LinearProgressIndicator',
  'ListBody', 'Wrap', 'Table', 'TableRow', 'TableCell', 'DataTable', 'DataColumn', 'DataRow',
  'Stepper', 'Step', 'Chip', 'ChoiceChip', 'FilterChip', 'ActionChip', 'InputChip',
  'Tooltip', 'Banner', 'Badge',
  'Theme', 'ThemeData', 'MediaQuery', 'MediaQueryData', 'Directionality',
  'Builder', 'StatefulBuilder', 'FutureBuilder', 'StreamBuilder', 'AnimatedBuilder',
  'ListenableBuilder', 'ValueListenableBuilder', 'OrientationBuilder', 'LayoutBuilder',
  'Navigator', 'MaterialPageRoute', 'PageRouteBuilder', 'Route', 'ModalRoute',
  'WillPopScope', 'PopScope',
  // ── Flutter widget framework ──
  'Widget', 'StatelessWidget', 'StatefulWidget', 'State', 'BuildContext', 'Key',
  'GlobalKey', 'LocalKey', 'ValueKey', 'ObjectKey', 'UniqueKey',
  'InheritedWidget', 'InheritedNotifier', 'InheritedTheme',
  'ProxyWidget', 'ParentDataWidget', 'RenderObjectWidget',
  // ── Animation ──
  'Animation', 'AnimationController', 'AnimationStatus', 'Animatable',
  'Tween', 'CurvedAnimation', 'Curves', 'Curve', 'TweenSequence', 'TweenSequenceItem',
  'AnimatedOpacity', 'AnimatedContainer', 'AnimatedSwitcher', 'AnimatedAlign',
  'AnimatedSize', 'AnimatedPadding', 'AnimatedPositioned', 'AnimatedScale', 'AnimatedRotation',
  'FadeTransition', 'ScaleTransition', 'RotationTransition', 'SlideTransition', 'SizeTransition',
  // ── Cupertino ──
  'CupertinoApp', 'CupertinoPageScaffold', 'CupertinoTabScaffold', 'CupertinoTabView',
  'CupertinoButton', 'CupertinoTextField', 'CupertinoNavigationBar', 'CupertinoTabBar',
  'CupertinoSlider', 'CupertinoSwitch', 'CupertinoActivityIndicator', 'CupertinoActionSheet',
  'CupertinoAlertDialog', 'CupertinoDialogAction', 'CupertinoColors', 'CupertinoTheme',
  'CupertinoPageRoute', 'CupertinoListTile', 'CupertinoListSection',
  // ── Painting / Rendering ──
  'Color', 'Colors', 'MaterialColor', 'MaterialAccentColor',
  'Offset', 'Size', 'Rect', 'RRect', 'Radius',
  'TextDirection', 'TextOverflow', 'FontWeight', 'FontStyle', 'TextDecoration',
  'Alignment', 'AlignmentDirectional', 'CrossAxisAlignment', 'MainAxisAlignment', 'MainAxisSize',
  'Axis', 'VerticalDirection', 'WrapAlignment', 'WrapCrossAlignment',
  'BoxFit', 'ImageRepeat', 'BlendMode', 'FilterQuality',
  // ── Foundation / Services ──
  'ChangeNotifier', 'ValueNotifier', 'Listenable', 'ValueListenable',
  'WidgetsBinding', 'WidgetsBindingObserver', 'WidgetsFlutterBinding',
  'ServicesBinding', 'SchedulerBinding',
  'HapticFeedback', 'SystemChrome', 'SystemUiOverlayStyle', 'Clipboard', 'ClipboardData',
  'PlatformException', 'MissingPluginException',
  'FocusNode', 'Focus', 'FocusScope', 'FocusManager', 'FocusTraversalGroup',
  'Semantics', 'MergeSemantics', 'ExcludeSemantics',
  'kDebugMode', 'kReleaseMode', 'kProfileMode', 'kIsWeb',
  'debugPrint', 'print',
  'ValueChanged', 'VoidCallback', 'FutureOr',
  // ── Mixins (Flutter 흔한) ──
  'AutomaticKeepAliveClientMixin', 'TickerProviderStateMixin', 'SingleTickerProviderStateMixin',
  'WidgetsBindingObserver', 'WidgetsObserver', 'NavigatorObserver', 'RouteAware',
  'RestorationMixin',
  // ── App ──
  'MaterialApp', 'WidgetsApp', 'runApp',
  // ── Riverpod (flutter_riverpod) ──
  'Provider', 'StateProvider', 'FutureProvider', 'StreamProvider',
  'StateNotifierProvider', 'ChangeNotifierProvider',
  'AsyncNotifier', 'AsyncNotifierProvider', 'Notifier', 'NotifierProvider',
  'AutoDisposeNotifier', 'AutoDisposeAsyncNotifier',
  'ConsumerWidget', 'ConsumerStatefulWidget', 'ConsumerState',
  'WidgetRef', 'Ref', 'ProviderRef',
  'ProviderScope', 'Consumer', 'ProviderListener', 'UncontrolledProviderScope',
  'ProviderObserver', 'ProviderContainer',
  'AsyncValue', 'AsyncData', 'AsyncLoading', 'AsyncError',
  // Riverpod ref methods
  'invalidate', 'refresh', 'exists', 'asData',
  // ── Bloc / Cubit ──
  'Bloc', 'Cubit', 'BlocBase', 'BlocProvider', 'MultiBlocProvider',
  'BlocBuilder', 'BlocListener', 'BlocConsumer', 'BlocSelector',
  'RepositoryProvider', 'MultiRepositoryProvider',
  'BlocObserver', 'Transition', 'Change',
  // ── Dio (HTTP) ──
  'Dio', 'BaseOptions', 'Options', 'RequestOptions', 'Response',
  'DioException', 'DioError', 'DioErrorType', 'DioExceptionType',
  'Interceptor', 'Interceptors', 'InterceptorsWrapper',
  'CancelToken', 'FormData', 'MultipartFile',
  // ── GoRouter / AutoRoute ──
  'GoRouter', 'GoRoute', 'ShellRoute', 'GoRouterState', 'GoRouterRedirect',
  'AutoRoute', 'AutoRouter', 'AutoRouterDelegate', 'PageRouteInfo',
  // ── Freezed / json_serializable ──
  'freezed', 'JsonSerializable', 'JsonKey', 'JsonValue', 'Default',
  // ── DI (get_it / injectable) ──
  'GetIt', 'registerSingleton', 'registerLazySingleton', 'registerFactory',
  'injectable', 'lazySingleton', 'singleton', 'preResolve', 'module',
  // ── Equatable ──
  'Equatable',
  // ── shared_preferences / persistence ──
  'SharedPreferences',
  // ── intl ──
  'DateFormat', 'NumberFormat', 'Intl',
  // ── flutter_svg ──
  'SvgPicture',
  // ── url_launcher ──
  'launchUrl', 'launchUrlString', 'canLaunchUrl', 'canLaunch',
  // ── Firebase 흔한 ──
  'Firebase', 'FirebaseAuth', 'FirebaseAnalytics', 'FirebaseCrashlytics',
  'FirebaseFirestore', 'FirebaseRemoteConfig', 'FirebaseMessaging',
  // ── Mockito / Mocktail (테스트) ──
  'verify', 'any', 'argThat', 'captureAny',
  // ── dartz / fpdart (Either / Option) ──
  'Right', 'Left', 'Either', 'Option', 'Some', 'None', 'Tuple2', 'Tuple3',
  'fold', 'foldLeft', 'foldRight', 'getOrElse', 'isLeft', 'isRight',
  // ── freezed / sealed union ──
  'when', 'maybeWhen', 'whenOrNull', 'map', 'maybeMap', 'mapOrNull',
  'copyWith', 'fromJson', 'toJson', 'fromMap', 'toMap',
  // ── Navigator / Routing ──
  'push', 'pop', 'pushNamed', 'pushReplacement', 'pushReplacementNamed',
  'pushNamedAndRemoveUntil', 'pushAndRemoveUntil', 'popUntil', 'maybePop',
  'canPop', 'replace', 'replaceRouteBelow', 'restorablePush',
  'RouteSettings', 'NavigatorState',
  // ── StatefulWidget / State ──
  'setState', 'createState', 'initState', 'dispose', 'didChangeDependencies',
  'didUpdateWidget', 'deactivate', 'activate', 'reassemble',
  'mounted', 'context', 'widget',
  // ── Riverpod modifiers ──
  'family', 'autoDispose', 'autoDisposeFamily',
  // ── InheritedWidget pattern ──
  'of', 'maybeOf', 'dependOnInheritedWidgetOfExactType',
  // ── BorderRadius / EdgeInsets static factories ──
  'circular', 'only', 'all', 'symmetric', 'fromLTRB', 'horizontal', 'vertical',
  'zero', 'lerp', 'fromBorderSide',
  // ── Color / Colors helpers ──
  'withValues', 'withOpacity', 'withAlpha', 'withRed', 'withGreen', 'withBlue',
  'fromARGB', 'fromRGBO',
  // ── DateTime / Duration ──
  'now', 'parse', 'tryParse', 'fromMicrosecondsSinceEpoch', 'fromMillisecondsSinceEpoch',
  'difference', 'add', 'subtract', 'isBefore', 'isAfter',
  // ── Dio / HTTP methods ──
  'get', 'post', 'put', 'patch', 'head', 'delete', 'request', 'download',
  // ── TabController / PageController ──
  'animateTo', 'jumpTo', 'jumpToPage', 'animateToPage', 'setIndex',
  // ── callable / function ──
  'call',
  // ── Dart core types/exception ──
  'Exception', 'Error', 'StateError', 'ArgumentError', 'RangeError',
  'FormatException', 'TimeoutException', 'TypeError',
  'UnimplementedError', 'UnsupportedError', 'AssertionError',
  // ── Iterable / List / Map / Set / String 추가 ──
  'toList', 'toSet', 'toMap', 'cast', 'whereType', 'expand',
  'asMap', 'putIfAbsent', 'addAll', 'removeWhere',
  // ── Stream method ──
  'asBroadcastStream', 'asyncMap', 'asyncExpand', 'distinct',
  // ── Async helpers ──
  'unawaited', 'scheduleMicrotask', 'runZonedGuarded',
  // ── flutter_svg / image_picker / connectivity ──
  'asset', 'network', 'memory', 'string',
  // ── infinite_scroll_pagination ──
  'PagedChildBuilderDelegate', 'PagedListView', 'PagingController',
  // ── url_launcher ──
  'launchUrl', 'launchUrlString',
  // ── flutter_keyboard_visibility ──
  'KeyboardVisibilityProvider',
])

function isFlutterKnownSymbol(edge: CodeEdgeRaw): boolean {
  if (!edge.target_symbol) return false
  if (!FLUTTER_KNOWN_SYMBOLS.has(edge.target_symbol)) return false
  // this.X / super.X 분기 제외 (false positive 방지 — 우리 class에 동명 method 가능)
  if (edge.target_specifier?.startsWith('this.')) return false
  if (edge.target_specifier?.startsWith('super.')) return false
  return true
}

function dispatchCallsEdge(
  edge: CodeEdgeRaw,
  indices: CallIndices,
  constructorDIMap: ConstructorDIMap,
  fieldOrigins: FieldOriginsMap,
): CallOutcome {
  // P16-A: specifier 멀티라인 공백 정규화 (`this.kysely\n      .selectFrom` → `this.kysely.selectFrom`)
  const normalized = edge.target_specifier?.replace(/\s+/g, '') ?? null
  if (normalized !== edge.target_specifier) {
    edge = { ...edge, target_specifier: normalized }
  }

  // P10: JS builtin globals → external (정적분석 영역 외, 정상 분류)
  if (isBuiltinCall(edge)) {
    return { target_id: null, resolve_status: 'external' }
  }

  // P15-Lite: this.X.method — field origin lookup 우선 (P5 fallback이 method name 무시하는 잘못된 매핑 방지)
  const originResult = tryFieldOriginDispatch(edge, indices, fieldOrigins)
  let result: CallOutcome
  if (originResult) {
    result = originResult
  } else {
    result = dispatchCallsRoute(edge, indices, constructorDIMap)
  }

  // D9: dispatchCallsRoute 실패 시 file-level import resolution fallback
  // Dart `import 'package:X/svc.dart';` (show 없음) — 어댑터가 어떤 symbol 가져오는지 모름
  // 이때 source file의 imports edge resolved + target_id=file → 그 file의 export에서 symbol 매칭
  // F5-1 검토: explicit_gap (graph 안 type 확실 + method 누락 = 진짜 갭) 보존이 정직.
  // cross-file 같은 이름 free function 매핑은 false positive 위험 → explicit_gap 차단 유지.
  if (result.resolve_status === 'failed' && !result.explicit_gap) {
    const fileLevelResult = tryFileLevelImportResolve(edge, indices)
    if (fileLevelResult) result = fileLevelResult
  }

  // Context/repository registries: apps often expose a typed object from a hook
  // (`const repository = useRepository(); repository.user.fetch()`), while the
  // registry object itself owns constructor edges keyed by object property names.
  if (result.resolve_status === 'failed' || result.resolve_status === 'external_chain') {
    const registryMethodResult = tryRepositoryRegistryMethodResolve(edge, indices)
    if (registryMethodResult) result = registryMethodResult
  }

  // Imported module-level singleton: `export const x = new ClassName()` imported and
  // called as `x.method()`. The chain root resolves to the singleton variable node,
  // whose sole constructor edge fixes its type. Resolve `x.method()` to that class's
  // method so controller entrypoints reach the query/service bodies (build_route/docs).
  if (result.resolve_status === 'failed' || result.resolve_status === 'external_chain') {
    const singletonMethodResult = tryImportedSingletonMethodResolve(edge, indices)
    if (singletonMethodResult) result = singletonMethodResult
  }

  // Route/service reachability: local variables often hold imported repository/service
  // instances (`const repo = new Repo()`, `final repo = Repo()`). The parser may only
  // preserve `repo.method()` as a method call with a chain root. Resolve it to a
  // unique imported class method so build_route can traverse into API-calling code.
  if (result.resolve_status === 'failed' && !result.explicit_gap) {
    const importedMethodResult = tryImportedMethodResolve(edge, indices)
    if (importedMethodResult) result = importedMethodResult
  }

  // P13: ECMAScript proto 화이트리스트로 elevate
  // - failed (단, explicit_gap 제외 — 우리 graph 안 type 확인됨 + 정의 누락은 진짜 갭으로 보존)
  // - external_chain (receiver가 외부 추정 + 끝 method가 prototype이면 external 더 정확)
  if (isProtoMethodSymbol(edge)) {
    if (result.resolve_status === 'failed' && !result.explicit_gap) {
      return { target_id: null, resolve_status: 'external' }
    }
    if (result.resolve_status === 'external_chain') {
      return { target_id: null, resolve_status: 'external' }
    }
  }

  // P18: ORM 화이트리스트 (조건부) — this.X 분기는 P15-Lite가 처리하므로 제외
  // failed (explicit_gap 제외)만 external로 elevate
  if (result.resolve_status === 'failed' && !result.explicit_gap && isOrmMethodCall(edge)) {
    return { target_id: null, resolve_status: 'external' }
  }

  // DC-flutter: Flutter SDK + 인기 패키지 widget/method 화이트리스트
  // Dart는 show clause 없는 import가 흔해서 어댑터가 symbol → 패키지 매핑 못함.
  // F5에서 화이트리스트로 external 분류 (false positive 방지: this.X/super.X 분기 제외).
  if (result.resolve_status === 'failed' && !result.explicit_gap && isFlutterKnownSymbol(edge)) {
    return { target_id: null, resolve_status: 'external' }
  }
  return result
}

// D9 + F5-1: file-level import resolution
// (a) show 있는 import edge target_symbol === edge.target_symbol → 직접 매칭
// (b) show 없는 import edge target_symbol === null → 그 file의 exportsByFileAndName lookup
function tryFileLevelImportResolve(
  edge: CodeEdgeRaw,
  indices: CallIndices,
): CallOutcome | null {
  const sym = edge.target_symbol
  if (!sym) return null
  const sourceNode = indices.nodeById.get(edge.source_id)
  if (!sourceNode) return null
  const sourceFileId = `${sourceNode.repo_id}:${sourceNode.file_path}`
  const importEdges = indices.importsByFileId.get(sourceFileId) ?? []
  for (const ie of importEdges) {
    if (ie.resolve_status !== 'resolved') continue
    if (!ie.target_id) continue
    // (a) show clause 직접 매칭
    if (ie.target_symbol === sym) {
      const targetNode = indices.nodeById.get(ie.target_id)
      if (targetNode && targetNode.type !== 'file') {
        return { target_id: targetNode.id, resolve_status: 'resolved' }
      }
      // file 노드면 그 file의 exportsByFileAndName lookup
      if (targetNode?.type === 'file') {
        const exportKey = targetNode.file_path + '|' + sym
        const exportNode = indices.exportsByFileAndName.get(exportKey)
        if (exportNode) return { target_id: exportNode.id, resolve_status: 'resolved' }
      }
      continue
    }
    // (b) show 없음 — file 단위 import의 export lookup
    if (ie.target_symbol === null) {
      const targetFile = indices.nodeById.get(ie.target_id)
      if (!targetFile || targetFile.type !== 'file') continue
      const exportKey = targetFile.file_path + '|' + sym
      const exportNode = indices.exportsByFileAndName.get(exportKey)
      if (exportNode) {
        return { target_id: exportNode.id, resolve_status: 'resolved' }
      }
    }
  }
  return null
}

function tryImportedMethodResolve(
  edge: CodeEdgeRaw,
  indices: CallIndices,
): CallOutcome | null {
  if (!edge.target_symbol || !edge.chain_path) return null
  if (isProtoMethodSymbol(edge) || isOrmMethodCall(edge) || isFlutterKnownSymbol(edge)) return null
  const sourceNode = indices.nodeById.get(edge.source_id)
  if (!sourceNode) return null
  const sourceFileId = `${sourceNode.repo_id}:${sourceNode.file_path}`
  const importEdges = (indices.importsByFileId.get(sourceFileId) ?? [])
    .filter((candidate) =>
      candidate.resolve_status === 'resolved' &&
      candidate.target_id !== null &&
      (!edge.target_specifier || candidate.target_specifier === edge.target_specifier),
    )

  const matches: CodeNodeRaw[] = []
  for (const importEdge of importEdges) {
    const target = indices.nodeById.get(importEdge.target_id!)
    if (!target) continue
    const method = target.type === 'class'
      ? findClassMethod(target, edge.target_symbol, indices)
      : target.type === 'file'
        ? findUniqueFileClassMethod(target.file_path, edge.target_symbol, indices)
        : null
    if (method) matches.push(method)
  }

  const unique = uniqueNodes(matches)
  if (unique.length !== 1) return null
  return { target_id: unique[0].id, resolve_status: 'resolved' }
}

function tryRepositoryRegistryMethodResolve(
  edge: CodeEdgeRaw,
  indices: CallIndices,
): CallOutcome | null {
  if (!edge.target_symbol || !edge.target_specifier || !edge.chain_path) return null
  const chainRoot = firstChainSegment(edge.chain_path)
  if (!chainRoot) return null
  const propertyKey = edge.destructured_alias_property ?? lastChainSegment(edge.chain_path)
  if (!propertyKey) return null

  const sourceNode = indices.nodeById.get(edge.source_id)
  if (!sourceNode) return null
  const sourceFileId = `${sourceNode.repo_id}:${sourceNode.file_path}`
  const sourceImports = indices.importsByFileId.get(sourceFileId) ?? []
  const sameModuleImports = sourceImports
    .filter((candidate) =>
      candidate.resolve_status === 'resolved' &&
      candidate.target_id !== null &&
      candidate.target_specifier === edge.target_specifier,
    )
  const importRoot = edge.destructured_alias_root ?? chainRoot
  const rootMatchedImports = sameModuleImports.filter((candidate) => importMatchesLocalRoot(candidate, importRoot))
  const candidateImports = edge.destructured_alias_root
    ? rootMatchedImports
    : rootMatchedImports.length > 0 ? rootMatchedImports : sameModuleImports
  if (candidateImports.length === 0) return null
  const importedTargets = candidateImports
    .map((candidate) => indices.nodeById.get(candidate.target_id!))
    .filter((node): node is CodeNodeRaw => Boolean(node))

  const classMatches: CodeNodeRaw[] = []
  for (const importedTarget of importedTargets) {
    const registries = registryVariablesVisibleFrom(importedTarget, indices)
    for (const registry of registries) {
      const classNode = registryClassForProperty(registry, propertyKey, indices)
      if (!classNode) continue
      classMatches.push(classNode)
    }
  }

  const uniqueClasses = uniqueNodes(classMatches)
  const matches: CodeNodeRaw[] = []
  for (const classNode of uniqueClasses) {
    const method = findClassMethod(classNode, edge.target_symbol, indices)
    if (method) matches.push(method)
  }

  const unique = uniqueNodes(matches)
  if (unique.length === 1) return { target_id: unique[0].id, resolve_status: 'resolved' }
  if (unique.length === 0 && uniqueClasses.length === 1) {
    return { target_id: null, resolve_status: 'failed', explicit_gap: true }
  }
  return null
}

// Imported module-level singleton instance method resolution.
//   `export const projectQuery = new ProjectQuery()` (definition module)
//   `import { projectQuery } from '...'; projectQuery.getProjects()` (call site)
// The chain root (`projectQuery`) is a single-segment receiver that imports to a
// `variable` node whose only constructor `calls` edge (`new ProjectQuery()`) fixes its
// type. Resolve `projectQuery.getProjects()` to `ProjectQuery.getProjects`. If the class
// is known but the method is missing, surface an explicit gap (no whitelist elevation).
function tryImportedSingletonMethodResolve(
  edge: CodeEdgeRaw,
  indices: CallIndices,
): CallOutcome | null {
  if (!edge.target_symbol || !edge.target_specifier || !edge.chain_path) return null
  // Member access on the receiver (`Repositories.ad.method()`) is the registry shape,
  // handled elsewhere. A singleton receiver is the chain root with no further member.
  const segments = edge.chain_path.split('.').map((part) => part.trim()).filter(Boolean)
  if (segments.length !== 1) return null
  const chainRoot = segments[0]

  const sourceNode = indices.nodeById.get(edge.source_id)
  if (!sourceNode) return null
  const sourceFileId = `${sourceNode.repo_id}:${sourceNode.file_path}`

  const importEdges = (indices.importsByFileId.get(sourceFileId) ?? []).filter(
    (candidate) =>
      candidate.resolve_status === 'resolved' &&
      candidate.target_id !== null &&
      candidate.target_specifier === edge.target_specifier &&
      importMatchesLocalRoot(candidate, chainRoot),
  )

  const classMatches: CodeNodeRaw[] = []
  for (const importEdge of importEdges) {
    const importedNode = indices.nodeById.get(importEdge.target_id!)
    if (!importedNode || importedNode.type !== 'variable') continue
    const classNode = singletonClassForVariable(importedNode, indices)
    if (classNode) classMatches.push(classNode)
  }

  const uniqueClasses = uniqueNodes(classMatches)
  if (uniqueClasses.length !== 1) return null
  const classNode = uniqueClasses[0]

  const method = findClassMethod(classNode, edge.target_symbol, indices)
  if (method) return { target_id: method.id, resolve_status: 'resolved' }
  // Class type is known but the method is undefined here = a real gap. explicit_gap
  // prevents proto/ORM whitelist fallbacks from masking it as `external`.
  return { target_id: null, resolve_status: 'failed', explicit_gap: true }
}

// A singleton variable owns exactly one constructor `calls` edge (`new ClassName()`).
// Returns that class node, or null if the variable is not a single-constructor singleton.
function singletonClassForVariable(
  variable: CodeNodeRaw,
  indices: CallIndices,
): CodeNodeRaw | null {
  const constructorEdges = (indices.callsBySourceId.get(variable.id) ?? []).filter(
    (candidate) => candidate.target_symbol !== null && !candidate.chain_path,
  )
  if (constructorEdges.length !== 1) return null
  const classNode = classNodeForRegistryConstructor(variable, constructorEdges[0], indices)
  return classNode?.type === 'class' ? classNode : null
}

function registryVariablesVisibleFrom(
  node: CodeNodeRaw,
  indices: CallIndices,
): CodeNodeRaw[] {
  if (node.type === 'variable') return [node]
  const fileId = `${node.repo_id}:${node.file_path}`
  const registries: CodeNodeRaw[] = []
  for (const importEdge of indices.importsByFileId.get(fileId) ?? []) {
    if (importEdge.resolve_status !== 'resolved' || !importEdge.target_id) continue
    const target = indices.nodeById.get(importEdge.target_id)
    if (target?.type === 'variable') registries.push(target)
  }
  return uniqueNodes(registries)
}

function registryClassForProperty(
  registry: CodeNodeRaw,
  propertyKey: string,
  indices: CallIndices,
): CodeNodeRaw | null {
  const matches = (indices.callsBySourceId.get(registry.id) ?? [])
    .filter((candidate) =>
      candidate.chain_path === propertyKey,
    )
    .map((candidate) => classNodeForRegistryConstructor(registry, candidate, indices))
    .filter((node): node is CodeNodeRaw => node !== null)
  const unique = uniqueNodes(matches)
  return unique.length === 1 ? unique[0] : null
}

function classNodeForRegistryConstructor(
  registry: CodeNodeRaw,
  edge: CodeEdgeRaw,
  indices: CallIndices,
): CodeNodeRaw | null {
  if (edge.target_id) {
    const target = indices.nodeById.get(edge.target_id)
    if (target?.type === 'class') return target
  }
  if (!edge.target_symbol) return null
  if (!edge.target_specifier) {
    const sameFileClass = indices.nodesByFileAndName.get(`${registry.file_path}|${edge.target_symbol}`)
    return sameFileClass?.type === 'class' ? sameFileClass : null
  }
  const registryFileId = `${registry.repo_id}:${registry.file_path}`
  for (const importEdge of indices.importsByFileId.get(registryFileId) ?? []) {
    if (importEdge.resolve_status !== 'resolved') continue
    if (importEdge.target_specifier !== edge.target_specifier) continue
    if (importEdge.target_symbol !== edge.target_symbol) continue
    if (!importEdge.target_id) continue
    const target = indices.nodeById.get(importEdge.target_id)
    if (target?.type === 'class') return target
  }
  return null
}

function lastChainSegment(chainPath: string): string | null {
  const segments = chainPath.split('.').map((part) => part.trim()).filter(Boolean)
  return segments.length > 0 ? segments[segments.length - 1] : null
}

function firstChainSegment(chainPath: string): string | null {
  const segments = chainPath.split('.').map((part) => part.trim()).filter(Boolean)
  return segments.length > 0 ? segments[0] : null
}

function importMatchesLocalRoot(edge: CodeEdgeRaw, chainRoot: string): boolean {
  return edge.target_symbol === chainRoot || edge.target_local_symbol === chainRoot
}

function findClassMethod(
  classNode: CodeNodeRaw,
  methodName: string,
  indices: CallIndices,
): CodeNodeRaw | null {
  const cacheKey = `${classNode.id}|${methodName}`
  if (indices.classMethodLookupCache.has(cacheKey)) {
    return indices.classMethodLookupCache.get(cacheKey) ?? null
  }

  const own = indices.methodsByClassId.get(classNode.id)?.get(methodName)
  if (own) {
    indices.classMethodLookupCache.set(cacheKey, own)
    return own
  }

  const propertyNode = indices.nodeById.get(`${classNode.repo_id}:${classNode.file_path}:${classNode.name}.${methodName}`)
  if (propertyNode?.type === 'property') {
    indices.classMethodLookupCache.set(cacheKey, propertyNode)
    return propertyNode
  }

  let cur: string | undefined = indices.extendsMap.get(classNode.id)
  let hops = 0
  while (cur && hops < 10) {
    const parent = indices.nodeById.get(cur)
    const inherited = indices.methodsByClassId.get(cur)?.get(methodName)
    if (inherited) {
      indices.classMethodLookupCache.set(cacheKey, inherited)
      return inherited
    }
    if (parent) {
      const inheritedProperty = indices.nodeById.get(`${parent.repo_id}:${parent.file_path}:${parent.name}.${methodName}`)
      if (inheritedProperty?.type === 'property') {
        indices.classMethodLookupCache.set(cacheKey, inheritedProperty)
        return inheritedProperty
      }
    }
    cur = indices.extendsMap.get(cur)
    hops++
  }

  indices.classMethodLookupCache.set(cacheKey, null)
  return null
}

function findUniqueFileClassMethod(
  filePath: string,
  methodName: string,
  indices: CallIndices,
): CodeNodeRaw | null {
  const cacheKey = `${filePath}|${methodName}`
  if (indices.fileClassMethodLookupCache.has(cacheKey)) {
    return indices.fileClassMethodLookupCache.get(cacheKey) ?? null
  }

  const matches: CodeNodeRaw[] = []
  for (const node of indices.classesByFile.get(filePath) ?? []) {
    const method = findClassMethod(node, methodName, indices)
    if (method) matches.push(method)
  }
  const unique = uniqueNodes(matches)
  const result = unique.length === 1 ? unique[0] : null
  indices.fileClassMethodLookupCache.set(cacheKey, result)
  return result
}

function uniqueNodes(nodes: CodeNodeRaw[]): CodeNodeRaw[] {
  const seen = new Set<string>()
  const out: CodeNodeRaw[] = []
  for (const node of nodes) {
    if (seen.has(node.id)) continue
    seen.add(node.id)
    out.push(node)
  }
  return out
}

// P15-Lite: cross-file field origin 해결
// reference origin (RHS=X.Y)을 namespace member origin lookup으로 풀어 external/internal 결정
function resolveFieldOriginsCrossFile(
  fieldOrigins: FieldOriginsMap | undefined,
  _indices: CallIndices,
): FieldOriginsMap {
  if (!fieldOrigins) return new Map()
  // namespace name → memberName → origin (모든 file 통합 인덱스)
  const nsMemberIndex = new Map<string, Map<string, FieldOrigin>>()
  for (const [classKey, fields] of fieldOrigins) {
    const nsName = classKey.split(':').slice(-1)[0]
    let m = nsMemberIndex.get(nsName)
    if (!m) {
      m = new Map()
      nsMemberIndex.set(nsName, m)
    }
    for (const [f, o] of fields) m.set(f, o)
  }
  // reference 풀기 (1-hop만 — 다중 reference 체인 풀이는 P15-Full 영역)
  const resolved: FieldOriginsMap = new Map()
  for (const [classKey, fields] of fieldOrigins) {
    const newFields = new Map<string, FieldOrigin>()
    for (const [fieldName, origin] of fields) {
      if (origin.kind === 'reference') {
        const memberOrigin = nsMemberIndex.get(origin.rootName)?.get(origin.memberName)
        if (memberOrigin && memberOrigin.kind !== 'reference') {
          newFields.set(fieldName, memberOrigin)
        } else {
          newFields.set(fieldName, { kind: 'unknown' })
        }
      } else {
        newFields.set(fieldName, origin)
      }
    }
    resolved.set(classKey, newFields)
  }
  return resolved
}

// P15-Lite: this.X.method 분기에서 field origin 기반 dispatch
// - origin=external → external_chain
// - origin=internal(typeName) → typeName 안 method 매칭 시도 → 실패면 failed(explicit_gap)
// - origin=function/primitive/unknown 또는 없음 → null (기존 dispatchCallsRoute에 위임)
function tryFieldOriginDispatch(
  edge: CodeEdgeRaw,
  indices: CallIndices,
  fieldOrigins: FieldOriginsMap,
): CallOutcome | null {
  const spec = edge.target_specifier
  if (!spec || !spec.startsWith('this.')) return null
  const afterThis = spec.slice('this.'.length)
  const firstDot = afterThis.indexOf('.')
  if (firstDot === -1) return null
  const fieldName = afterThis.slice(0, firstDot)
  const rest = afterThis.slice(firstDot + 1)
  const methodName = rest.includes('.') ? rest.slice(rest.lastIndexOf('.') + 1) : rest

  const ownerClassId = indices.ownerClassByMethodId.get(edge.source_id)
  if (!ownerClassId) return null
  const fields = fieldOrigins.get(ownerClassId)
  const origin: FieldOrigin | undefined = fields?.get(fieldName)
  if (!origin) return null

  if (origin.kind === 'external') {
    return { target_id: null, resolve_status: 'external_chain' }
  }
  if (origin.kind === 'internal') {
    const classNodes = indices.nodesByClass.get(origin.typeName)
    if (!classNodes || classNodes.length === 0) {
      // typeName이 graph 안 없음 (이상 케이스) — 보수적으로 unknown처럼 취급
      return null
    }
    const cls = classNodes[0]
    // multi-segment `this.field.MIDDLE.method` — 해석된 root class에서 중간 멤버를 traverse
    // (resolveDeepChainSegments가 fieldOrigins로 무타입 중간멤버까지 해석; DI-root 경로와 동일).
    if (rest.includes('.')) {
      const middleSegments = rest.slice(0, rest.lastIndexOf('.')).split('.')
      return resolveDeepChainSegments(cls, middleSegments, methodName, indices)
    }
    const methodMap = indices.methodsByClassId.get(cls.id)
    const target = methodMap?.get(methodName)
    if (target) return { target_id: target.id, resolve_status: 'resolved' }
    // 우리 type 안 method 정의 누락 = 진짜 갭
    return { target_id: null, resolve_status: 'failed', explicit_gap: true }
  }
  // function/primitive/unknown — 기존 path
  return null
}

// def-use (resolves_to): resolve a bare name used at a call site (`source_id`) to its declaration node.
// Shared by Pass C (receiver) + Pass D (argument). Precedence (a bare name may shadow):
//  1. function-scoped local `{source_id}.{name}` (v2-2/BG-1 receiver-used locals);
//  2. class field `{ownerClassId}.{name}` (`this.field`, or a bare field with no local shadow);
//  3. module-scoped const `{repoId}:{filePath}:{name}` (top-level const referenced from this file).
// `hadThis` (explicit `this.`) restricts to the field only. Language-agnostic.
function resolveDeclarationForName(
  name: string,
  sourceId: string,
  hadThis: boolean,
  indices: CallIndices,
): string | null {
  if (!hadThis) {
    const localVarId = `${sourceId}.${name}`
    if (indices.nodeById.get(localVarId)?.type === 'variable') return localVarId
  }
  const ownerClassId = indices.ownerClassByMethodId.get(sourceId)
  if (ownerClassId) {
    const fieldNodeId = `${ownerClassId}.${name}`
    if (indices.nodeById.get(fieldNodeId)?.type === 'property') return fieldNodeId
  }
  if (!hadThis) {
    const srcNode = indices.nodeById.get(sourceId)
    const fileBase = srcNode && srcNode.type !== 'file'
      ? `${srcNode.repo_id}:${srcNode.file_path}`
      : sourceId
    const moduleVarId = `${fileBase}:${name}`
    if (moduleVarId !== sourceId && indices.nodeById.get(moduleVarId)?.type === 'variable') return moduleVarId
    // 4. cross-file imported value: `import { http } from './http'; http.get()` — receiver imported
    //    from another file. If a RESOLVED import in this file binds `name` to a value (variable)
    //    declaration, that's the receiver's declaration. Lets build_route reach the wrapper via a
    //    real calls/resolves_to link instead of the coarse `imports` hedge (over-collection 제거).
    for (const imp of indices.importsByFileId.get(fileBase) ?? []) {
      if (imp.resolve_status !== 'resolved' || !imp.target_id || imp.target_symbol !== name) continue
      if (indices.nodeById.get(imp.target_id)?.type === 'variable') return imp.target_id
    }
  }
  return null
}

// BG-3 (def-use-symbol-edge.md): surface a template/dynamic ENDPOINT's already-computed static pattern
// into `first_arg` so the downstream api_call referee (which reads first_arg) stops dropping dynamic
// endpoints (`fetch(`/api/orders/${id}`)` → first_arg '/api/orders/:id'). Only fills a NULL first_arg from
// arg_expressions[0] when it is a template whose staticPattern is ENDPOINT-LIKE (path `/…` or http(s) URL).
// Scoped to endpoint shapes — not arbitrary string-interpolation templates (log/UI text) — since this
// surfacing exists to recover dropped HTTP endpoints; non-endpoint templates have no downstream consumer.
function surfaceTemplateEndpoint(edge: CodeEdgeRaw): CodeEdgeRaw {
  if (edge.relation !== 'calls' || edge.first_arg != null) return edge
  const first = edge.arg_expressions?.[0]
  if (first?.kind === 'template' && first.staticPattern && isEndpointLikePattern(first.staticPattern)) {
    return { ...edge, first_arg: first.staticPattern }
  }
  return edge
}

function isEndpointLikePattern(pattern: string): boolean {
  return pattern.startsWith('/') || /^https?:\/\//.test(pattern)
}

function dispatchCallsRoute(
  edge: CodeEdgeRaw,
  indices: CallIndices,
  constructorDIMap: ConstructorDIMap,
): CallOutcome {
  const spec = edge.target_specifier
  if (spec === null)               return resolveIntraFileCall(edge, indices)
  if (spec.startsWith('super.'))   return resolveSuperCall(edge, indices)
  if (spec.startsWith('this.')) {
    const afterThis = spec.slice('this.'.length)
    return afterThis.indexOf('.') === -1
      ? resolveIntraFileCall(edge, indices)
      : resolveDICall(edge, indices, constructorDIMap)
  }
  return resolveImportedCall(edge, indices)
}

// ────────────────────────────────────────────────────────────────
// §4.8 resolveCalls — 오케스트레이터
// ────────────────────────────────────────────────────────────────

export async function resolveCalls(
  edges: CodeEdgeRaw[],
  nodes: Readonly<CodeNodeRaw>[],
  constructorDIMap: ConstructorDIMap,
  _enumValueMap: EnumValueMap,  // 예약: F3b 제거로 현재 미사용 (messaging edges 없음)
  fieldOrigins?: FieldOriginsMap,  // P15-Lite: receiver type tracking 휴리스틱
  onProgress?: (progress: CallResolutionProgress) => void,
): Promise<CodeEdgeRaw[]> {
  // Early exit 없음 — cross-file calls는 imports 재료만 있어도 해석 필요 (B3 해소)
  const indices: CallIndices = {
    ...buildNodeIndices(nodes),
    ...buildEdgeIndices(edges),
  }
  const fieldOriginsResolved = resolveFieldOriginsCrossFile(fieldOrigins, indices)
  // expose to deep-chain middle-member resolution (untyped `field = new X()` middles)
  indices.fieldOrigins = fieldOriginsResolved

  const resolvedCalls = new Map<number, CallOutcome>()

  // ── Pass A: calls dispatch ──
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]
    if (edge.relation !== 'calls' || edge.resolve_status !== 'pending') continue
    resolvedCalls.set(i, dispatchCallsEdge(edge, indices, constructorDIMap, fieldOriginsResolved))
  }

  // ── Pass B: type_resolved (CHA Pass 2 — BS-13/14) ──
  // 모든 type_ref edge (resolved) 중 target이 interface 노드 → 구현체들에 type_resolved emit
  // fan-out > 50이면 emit X (BS-14)
  const typeResolvedEdges: CodeEdgeRaw[] = []
  const FAN_OUT_LIMIT = 50
  // 중복 방지 (한 (source, impl) 페어가 여러 type_ref로 매칭될 수 있음)
  const emittedKey = new Set<string>()
  for (const edge of edges) {
    if (edge.relation !== 'type_ref') continue
    if (edge.resolve_status !== 'resolved') continue
    if (!edge.target_id) continue
    const targetNode = indices.nodeById.get(edge.target_id)
    if (!targetNode || targetNode.type !== 'interface') continue
    const implementers = indices.implementersByInterface.get(edge.target_id)
    if (!implementers || implementers.length === 0) continue
    if (implementers.length > FAN_OUT_LIMIT) continue   // BS-14
    const confidence: 'high' | 'low' = implementers.length === 1 ? 'high' : 'low'
    for (const implId of implementers) {
      const key = edge.source_id + '|' + implId
      if (emittedKey.has(key)) continue
      emittedKey.add(key)
      typeResolvedEdges.push({
        repo_id: edge.repo_id,
        source_id: edge.source_id,
        target_id: implId,
        relation: 'type_resolved',
        target_specifier: null,
        target_symbol: null,
        resolve_status: 'resolved',
        first_arg: null,
        literal_args: null,
        confidence,
        source: 'static',
      })
    }
  }

  // ── Pass C/D: resolves_to (def-use — receiver + argument variable references → declaration node) ──
  // SOT: docs/build_graph/def-use-symbol-edge.md. Language-uniform, no fieldOrigins dependency.
  //  - Pass C (receiver): `chain_path` first segment (TS `this.repo`, Kotlin/Dart bare `repo`) → its decl.
  //  - Pass D (BG-2, argument): each `arg_expressions` identifier (e.g. `app.use('/api', router)`) → its
  //    decl. Same `resolves_to` edge (source = call site), source position just extends receiver→arg.
  // One edge per (call site, declaration); pure additive.
  const resolvesToEdges: CodeEdgeRaw[] = []
  const resolvesToSeen = new Set<string>()
  const emitResolvesTo = (edge: CodeEdgeRaw, targetId: string, symbol: string): void => {
    const key = edge.source_id + '|' + targetId
    if (resolvesToSeen.has(key)) return
    resolvesToSeen.add(key)
    resolvesToEdges.push({
      repo_id: edge.repo_id,
      source_id: edge.source_id,
      target_id: targetId,
      relation: 'resolves_to',
      target_specifier: null,
      target_symbol: symbol,
      resolve_status: 'resolved',
      first_arg: null,
      literal_args: null,
      confidence: 'high',
      source: 'static',
    })
  }
  for (const edge of edges) {
    if (edge.relation !== 'calls') continue
    // Pass C — receiver
    const chain = edge.chain_path
    if (chain) {
      const hadThis = chain.startsWith('this.')
      const receiver = hadThis ? chain.slice('this.'.length) : chain
      const fieldName = receiver.split('.')[0]
      if (fieldName) {
        const targetId = resolveDeclarationForName(fieldName, edge.source_id, hadThis, indices)
        if (targetId) emitResolvesTo(edge, targetId, fieldName)
      }
    }
    // Pass D — arguments (BG-2): a bare identifier passed as a call argument → its declaration
    for (const arg of edge.arg_expressions ?? []) {
      if (arg.kind !== 'identifier' || !arg.raw) continue
      const targetId = resolveDeclarationForName(arg.raw, edge.source_id, false, indices)
      if (targetId) emitResolvesTo(edge, targetId, arg.raw)
    }
  }

  // ── assembly ──
  const result: CodeEdgeRaw[] = new Array(edges.length)
  const interval = progressInterval(edges.length)
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]

    const callRes = resolvedCalls.get(i)
    if (callRes) {
      const resolvedEdge: CodeEdgeRaw & { explicit_gap?: boolean } = {
        ...edge,
        target_id: callRes.target_id,
        resolve_status: callRes.resolve_status,
      }
      if (callRes.explicit_gap) resolvedEdge.explicit_gap = true
      result[i] = surfaceTemplateEndpoint(resolvedEdge)
      emitProgress(i + 1, edges.length, interval, edge, onProgress)
      continue
    }

    result[i] = surfaceTemplateEndpoint(edge)
    emitProgress(i + 1, edges.length, interval, edge, onProgress)
  }

  // type_resolved + resolves_to edges는 마지막에 append (Pass A 결과 보존)
  return [...result, ...typeResolvedEdges, ...resolvesToEdges]
}

function emitProgress(
  completed: number,
  total: number,
  interval: number,
  edge: CodeEdgeRaw,
  onProgress?: (progress: CallResolutionProgress) => void,
): void {
  if (completed !== total && completed !== 1 && completed % interval !== 0) return
  try {
    onProgress?.({
      completed,
      total,
      currentLabel: edge.target_symbol ?? edge.first_arg ?? edge.relation,
    })
  } catch { /* progress logging must not affect call resolution */ }
}

function progressInterval(total: number): number {
  if (total <= 100) return 10
  if (total <= 1_000) return 50
  if (total <= 10_000) return 250
  return 1_000
}
