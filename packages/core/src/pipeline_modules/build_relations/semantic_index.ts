// F2: buildSemanticIndex — 그래프 evidence 인덱싱
// SOT: specs/build_relations/architecture.md §4 F2

import type {
  BuildRelationsInputs,
  SemanticIndex,
  CodeNodeLike,
  CodeEdgeLike,
  WrapperSummary,
  FieldOriginSummary,
} from './types.js'
import { serviceForPackage } from './adapters/external/definitions.js'
import { EVENT_BROKER_PACKAGE_SET } from './adapters/event/families/brokers.js'
import { isApiClientPackage } from './adapters/api/packages.js'
import { isDbClientPackage } from './adapters/db/packages.js'

export function buildSemanticIndex(inputs: BuildRelationsInputs): SemanticIndex {
  const { nodes, edges, models } = inputs

  const nodesById = new Map<string, CodeNodeLike>()
  const nodesByFile = new Map<string, CodeNodeLike[]>()

  for (const node of nodes) {
    nodesById.set(node.id, node)
    const list = nodesByFile.get(node.filePath) ?? []
    list.push(node)
    nodesByFile.set(node.filePath, list)
  }

  const edgesBySource = new Map<string, CodeEdgeLike[]>()
  const edgesByTarget = new Map<string, CodeEdgeLike[]>()
  const containsParentByChild = new Map<string, string>()

  const importsBySource = new Map<string, CodeEdgeLike[]>()
  const callsBySource = new Map<string, CodeEdgeLike[]>()
  const rendersBySource = new Map<string, CodeEdgeLike[]>()
  const decoratorsBySource = new Map<string, CodeEdgeLike[]>()
  const typeRefsBySource = new Map<string, CodeEdgeLike[]>()
  const extendsBySource = new Map<string, CodeEdgeLike[]>()
  const implementsBySource = new Map<string, CodeEdgeLike[]>()
  const dependsOnBySource = new Map<string, CodeEdgeLike[]>()

  for (const edge of edges) {
    // edgesBySource
    const bySource = edgesBySource.get(edge.sourceId) ?? []
    bySource.push(edge)
    edgesBySource.set(edge.sourceId, bySource)

    // edgesByTarget
    if (edge.targetId) {
      const byTarget = edgesByTarget.get(edge.targetId) ?? []
      byTarget.push(edge)
      edgesByTarget.set(edge.targetId, byTarget)
    }

    // contains parent tracking
    if (edge.relation === 'contains' && edge.targetId) {
      containsParentByChild.set(edge.targetId, edge.sourceId)
    }

    // relation-specific indexes
    switch (edge.relation) {
      case 'imports':
        appendEdge(importsBySource, edge.sourceId, edge)
        break
      case 'calls':
        appendEdge(callsBySource, edge.sourceId, edge)
        break
      case 'renders':
        appendEdge(rendersBySource, edge.sourceId, edge)
        break
      case 'decorates':
        appendEdge(decoratorsBySource, edge.sourceId, edge)
        break
      case 'uses_type':
      case 'type_ref':
      case 'type_resolved':
        appendEdge(typeRefsBySource, edge.sourceId, edge)
        break
      case 'extends':
        appendEdge(extendsBySource, edge.sourceId, edge)
        break
      case 'implements':
        appendEdge(implementsBySource, edge.sourceId, edge)
        break
      case 'depends_on':
        appendEdge(dependsOnBySource, edge.sourceId, edge)
        break
    }
  }

  // model lookup: modelName.toLowerCase() → tableName
  const modelTablesByModelLower = new Map<string, string>()
  for (const m of models) {
    modelTablesByModelLower.set(m.modelName.toLowerCase(), m.tableName)
  }

  // wrapper functions: DI/extends/type evidence로 api_client, db_client, event_bus, external_service 판별
  const wrapperFunctions = buildWrapperFunctions(nodes, edges, importsBySource, extendsBySource, typeRefsBySource, dependsOnBySource)

  // class field origins: constructor DI, class field type tracking
  const classFieldOrigins = buildClassFieldOrigins(nodes, edges, containsParentByChild, importsBySource, typeRefsBySource, decoratorsBySource)

  return {
    nodesById,
    nodesByFile,
    edgesBySource,
    edgesByTarget,
    containsParentByChild,
    importsBySource,
    callsBySource,
    rendersBySource,
    decoratorsBySource,
    typeRefsBySource,
    extendsBySource,
    implementsBySource,
    modelTablesByModelLower,
    wrapperFunctions,
    classFieldOrigins,
  }
}

function appendEdge(map: Map<string, CodeEdgeLike[]>, key: string, edge: CodeEdgeLike): void {
  const list = map.get(key) ?? []
  list.push(edge)
  map.set(key, list)
}

// ── Package/import anchor 분류 ──────────────────────────

function buildWrapperFunctions(
  nodes: CodeNodeLike[],
  edges: CodeEdgeLike[],
  importsBySource: Map<string, CodeEdgeLike[]>,
  extendsBySource: Map<string, CodeEdgeLike[]>,
  typeRefsBySource: Map<string, CodeEdgeLike[]>,
  dependsOnBySource: Map<string, CodeEdgeLike[]>,
): Map<string, WrapperSummary> {
  const wrappers = new Map<string, WrapperSummary>()
  const nodeIds = new Set(nodes.map((n) => n.id))

  // Pre-pass: names of VALUE nodes (a const/field) that directly hold a db client —
  // e.g. `const prisma = new PrismaClient()` or `const prisma = imported<@prisma/client>`.
  // Used for a bounded 2-hop wrapper trace: `function getDb(){ return prisma }` where the
  // depends_on edge's specifier is the LOCAL re-export ('./client'), so the 1-hop package
  // check misses, but following the returned symbol to its value node recovers the package.
  // Restricted to value-kind nodes so a db-USING method (which also has db edges) is not picked.
  const DB_VALUE_NODE_TYPES = new Set(['variable', 'property', 'field', 'parameter'])
  const dbClientValueByName = new Map<string, string>()
  const nodeTypeById = new Map(nodes.map((n) => [n.id, n.type]))
  const nodeNameById = new Map(nodes.map((n) => [n.id, n.name]))
  for (const e of edges) {
    if (!isDbClientPackage(e.targetSpecifier)) continue
    if (e.relation !== 'imports' && e.relation !== 'calls' && e.relation !== 'depends_on') continue
    if (!DB_VALUE_NODE_TYPES.has(nodeTypeById.get(e.sourceId) ?? '')) continue
    const name = nodeNameById.get(e.sourceId)
    if (name) dbClientValueByName.set(name, e.targetSpecifier as string)
  }

  for (const node of nodes) {
    const imports = importsBySource.get(node.id) ?? []
    const extends_ = extendsBySource.get(node.id) ?? []
    const typeRefs = typeRefsBySource.get(node.id) ?? []
    const dependsOn = dependsOnBySource.get(node.id) ?? []

    // DB wrapper: PrismaService extends PrismaClient, node imports DB package, OR a function
    // that returns/depends-on a db client (e.g. `function getPrismaDB(tx){ return tx ?? prisma }`).
    // build_graph emits a `depends_on` edge from the wrapper fn to the db-client symbol with the
    // resolved package as targetSpecifier — generic over the wrapper's name (no name heuristic).
    const dbImport = imports.find((e) => isDbClientPackage(e.targetSpecifier))
    const dbExtends = extends_.find((e) => e.targetSymbol && /Prisma(Client|Service)|TypeOrmModule|DataSource/.test(e.targetSymbol))
    const dbTypeRef = typeRefs.find((e) => e.targetSymbol && /PrismaClient|PrismaService|DataSource/.test(e.targetSymbol))
    const dbDepends = dependsOn.find((e) => isDbClientPackage(e.targetSpecifier))
    // 2-hop: returns a symbol/member that is itself a db-client value (imported instance, OR a
    // namespace member like `return SGlobal.prismaPrimary`). chain_path (member path) is preferred
    // over targetSymbol (the import-bound root), since the db-client value node is the member.
    const valueKeyOf = (e: CodeEdgeLike): string | undefined => {
      if (e.chainPath != null && dbClientValueByName.has(e.chainPath)) return e.chainPath
      if (e.targetSymbol != null && dbClientValueByName.has(e.targetSymbol)) return e.targetSymbol
      return undefined
    }
    const dbDependsHop2 = dependsOn.find((e) => valueKeyOf(e) !== undefined)

    if (dbImport || dbExtends || dbTypeRef || dbDepends || dbDependsHop2) {
      const hop2Key = dbDependsHop2 ? valueKeyOf(dbDependsHop2) : undefined
      const hop2Pkg = hop2Key != null ? dbClientValueByName.get(hop2Key) : undefined
      wrappers.set(node.id, {
        nodeId: node.id,
        kind: 'db_client',
        targetPackage: dbImport?.targetSpecifier ?? dbDepends?.targetSpecifier ?? hop2Pkg ?? null,
        receiver: node.name,
      })
      continue
    }

    // API client wrapper
    const apiImport = imports.find((e) => isApiClientPackage(e.targetSpecifier))
    if (apiImport) {
      wrappers.set(node.id, {
        nodeId: node.id,
        kind: 'api_client',
        targetPackage: apiImport.targetSpecifier,
        receiver: node.name,
      })
      continue
    }

    // Event bus wrapper
    const eventImport = imports.find((e) => e.targetSpecifier && EVENT_BROKER_PACKAGE_SET.has(e.targetSpecifier))
    if (eventImport) {
      wrappers.set(node.id, {
        nodeId: node.id,
        kind: 'event_bus',
        targetPackage: eventImport.targetSpecifier,
        receiver: node.name,
      })
      continue
    }

    // External service wrapper
    const extImport = imports.find((e) => serviceForPackage(e.targetSpecifier))
    if (extImport) {
      wrappers.set(node.id, {
        nodeId: node.id,
        kind: 'external_service',
        targetPackage: extImport.targetSpecifier,
        receiver: node.name,
      })
    }
  }

  return wrappers
}

function buildClassFieldOrigins(
  nodes: CodeNodeLike[],
  edges: CodeEdgeLike[],
  containsParentByChild: Map<string, string>,
  importsBySource: Map<string, CodeEdgeLike[]>,
  typeRefsBySource: Map<string, CodeEdgeLike[]>,
  decoratorsBySource: Map<string, CodeEdgeLike[]>,
): Map<string, Map<string, FieldOriginSummary>> {
  // classKey → fieldName → FieldOriginSummary
  const result = new Map<string, Map<string, FieldOriginSummary>>()
  const nodesById = new Map<string, CodeNodeLike>(nodes.map((n) => [n.id, n]))

  for (const edge of edges) {
    // Constructor DI / class field injection pattern
    // Nest DI: constructor(private readonly svc: SomeService) → creates a type_ref from constructor param
    if (edge.relation === 'uses_type' || edge.relation === 'type_resolved') {
      const parentClassId = containsParentByChild.get(edge.sourceId)
      if (!parentClassId) continue

      if (!edge.targetSymbol) continue

      const fieldName = guessFieldNameFromTypeRef(edge.targetSymbol)

      const typeName = edge.targetSymbol
      const packageName = resolvePackageForType(edge.targetSpecifier, typeName)

      const originKind: FieldOriginSummary['originKind'] = detectOriginKind(edge, decoratorsBySource)

      const classFields = result.get(parentClassId) ?? new Map<string, FieldOriginSummary>()
      classFields.set(fieldName, {
        fieldName,
        originKind,
        typeName,
        packageName,
        evidenceNodeIds: [`edge:${edge.id}`],
      })
      result.set(parentClassId, classFields)
    }

    // JVM (Java/Kotlin) field declarations arrive as `type_ref` (subtype null) whose SOURCE is the
    // field/property node — not `uses_type`, and the real field name lives in node.name ('Class.field')
    // so guessFieldNameFromTypeRef (type→camelCase) would mis-key it. Extension-gated to .java/.kt:
    // TS *and* Dart also emit type_ref(subtype null) for class fields, and adding entries for them
    // here would change their relation output — the gate keeps TS/Dart byte-identical.
    if (edge.relation === 'type_ref' && edge.typeRefSubtype === null && edge.targetSymbol) {
      const sourceNode = nodesById.get(edge.sourceId)
      if (!sourceNode || sourceNode.type !== 'property' || !isJvmFieldFile(sourceNode.filePath)) continue
      const parentClassId = containsParentByChild.get(edge.sourceId)
      if (!parentClassId) continue
      const dot = sourceNode.name.lastIndexOf('.')
      const fieldName = dot >= 0 ? sourceNode.name.slice(dot + 1) : sourceNode.name
      if (!fieldName) continue
      const typeName = edge.targetSymbol
      const packageName = resolvePackageForType(edge.targetSpecifier, typeName)
      const classFields = result.get(parentClassId) ?? new Map<string, FieldOriginSummary>()
      // do not clobber a TS-style (uses_type) entry that may share the same field name
      if (!classFields.has(fieldName)) {
        classFields.set(fieldName, {
          fieldName,
          originKind: 'class_field',
          typeName,
          packageName,
          evidenceNodeIds: [`edge:${edge.id}`],
        })
        result.set(parentClassId, classFields)
      }
    }
  }

  return result
}

function isJvmFieldFile(filePath: string): boolean {
  return filePath.endsWith('.java') || filePath.endsWith('.kt') || filePath.endsWith('.kts')
}

function guessFieldNameFromTypeRef(typeName: string): string {
  // targetSymbol은 type name (e.g., PrismaService)
  // fieldName은 camelCase로 추정: PrismaService → prismaService
  return typeName.charAt(0).toLowerCase() + typeName.slice(1)
}

function resolvePackageForType(targetSpecifier: string | null, typeName: string | null): string | null {
  if (targetSpecifier) return targetSpecifier
  return null
}

function detectOriginKind(
  edge: CodeEdgeLike,
  decoratorsBySource: Map<string, CodeEdgeLike[]>,
): FieldOriginSummary['originKind'] {
  const decorators = decoratorsBySource.get(edge.sourceId) ?? []
  const hasInjectDecorator = decorators.some((d) =>
    d.targetSymbol === 'Inject' || d.targetSymbol === 'InjectRepository' || d.targetSymbol === 'InjectModel'
  )
  if (hasInjectDecorator) return 'di'
  if (edge.relation === 'type_resolved') return 'constructor'
  return 'class_field'
}
