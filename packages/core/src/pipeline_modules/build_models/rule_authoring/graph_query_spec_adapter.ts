// build_models/rule_authoring — the fixed engine that executes a ModelAdapterSpec against the code graph.
// Generalizes TypeOrmGraphAdapter/MikroOrmGraphAdapter: same code_nodes/code_edges queries, parameterized
// by the spec's decorator names. The repo's imported packages gate firing (cross-ORM isolation). No
// LLM-generated code runs here — the spec is data.

import { eq, inArray, and } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { codeNodes, codeEdges } from '@/db/schema/code_graph.js'
import type { BuildModelsAdapter, ModelRaw, ModelField, ModelRelation } from '../types.js'
import type { ModelAdapterSpec } from './types.js'

function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase()
}

/** Resolve table_name from the entity decorator's first arg (string literal / {key:'x'} object) else snake_case. */
function resolveTableName(spec: ModelAdapterSpec, entityArg: string | null, className: string): string {
  if (!entityArg) return toSnakeCase(className)
  const quoted = entityArg.match(/^['"](.+)['"]$/)
  if (quoted) return quoted[1].length > 0 ? quoted[1] : toSnakeCase(className)
  // build_graph normalizes bare string-literal args (no quotes)
  if (/^[A-Za-z0-9_.$-]+$/.test(entityArg)) return entityArg
  const key = spec.tableNameArgKey
  if (key) {
    try {
      const normalized = entityArg.replace(/(\w+):/g, '"$1":').replace(/'/g, '"')
      const parsed = JSON.parse(normalized) as Record<string, unknown>
      if (typeof parsed[key] === 'string' && (parsed[key] as string).length > 0) return parsed[key] as string
    } catch {
      // ignore
    }
  }
  return toSnakeCase(className)
}

/** TypeORM/MikroORM allow `() => Class`, `'Class'`, or `Class` relation targets. */
function extractLambdaTarget(firstArg: string | null): string {
  if (!firstArg) return 'unknown'
  const quoted = firstArg.match(/^['"]([A-Za-z_$][A-Za-z0-9_$]*)['"]$/)
  if (quoted) return quoted[1]
  const bare = firstArg.match(/^([A-Z][A-Za-z0-9_$]*)$/)
  if (bare) return bare[1]
  const arrow = firstArg.match(/=>\s*([A-Za-z_$][A-Za-z0-9_$]*)/)
  if (arrow) return arrow[1]
  return 'unknown'
}

function isBuiltinTypeRef(symbol: string): boolean {
  return ['Array', 'Date', 'Promise', 'Relation', 'Collection'].includes(symbol)
}

interface EntityRow { nodeId: string; className: string; filePath: string; lineStart: number | null; lineEnd: number | null; docComment: string | null; entityArg: string | null }
interface ColumnRow { propId: string; fieldName: string; decoratorName: string }
interface RelRow { propName: string; decoratorName: string; firstArg: string | null; targetHint: string | null }

function repoImportsAny(db: DB, repoId: string, packages: string[]): boolean {
  if (packages.length === 0) return false
  const row = db
    .select({ id: codeEdges.id })
    .from(codeEdges)
    .where(and(
      eq(codeEdges.repoId, repoId),
      eq(codeEdges.relation, 'imports'),
      inArray(codeEdges.targetSpecifier as Parameters<typeof inArray>[0], packages),
    ))
    .limit(1)
    .all()
  return row.length > 0
}

function queryEntityClasses(db: DB, repoId: string, entityDecorators: string[]): EntityRow[] {
  if (entityDecorators.length === 0) return []
  const rows = db
    .select({
      nodeId: codeNodes.id, className: codeNodes.name, filePath: codeNodes.filePath,
      lineStart: codeNodes.lineStart, lineEnd: codeNodes.lineEnd, docComment: codeNodes.docComment,
      entityArg: codeEdges.firstArg,
    })
    .from(codeNodes)
    .innerJoin(codeEdges, and(
      eq(codeEdges.sourceId, codeNodes.id),
      eq(codeEdges.relation, 'decorates'),
      eq(codeEdges.repoId, repoId),
      inArray(codeEdges.targetSymbol as Parameters<typeof inArray>[0], entityDecorators),
    ))
    .where(and(eq(codeNodes.repoId, repoId), eq(codeNodes.type, 'class')))
    .all()
  return rows as EntityRow[]
}

/** contains edges (entity → property) keyed by property id, with the property's display name. */
function loadContains(db: DB, repoId: string, entityIds: string[]): { entityForProp: Map<string, string>; nameForProp: Map<string, string>; propIds: string[] } {
  const edges = db
    .select({ targetId: codeEdges.targetId, sourceId: codeEdges.sourceId, targetSymbol: codeEdges.targetSymbol })
    .from(codeEdges)
    .where(and(eq(codeEdges.repoId, repoId), eq(codeEdges.relation, 'contains'), inArray(codeEdges.sourceId, entityIds)))
    .all()
  const entityForProp = new Map<string, string>()
  const nameForProp = new Map<string, string>()
  for (const e of edges) {
    if (!e.targetId) continue
    entityForProp.set(e.targetId, e.sourceId)
    if (e.targetSymbol) nameForProp.set(e.targetId, e.targetSymbol)
  }
  return { entityForProp, nameForProp, propIds: [...entityForProp.keys()] }
}

function queryColumns(db: DB, repoId: string, entityIds: string[], columnDecorators: string[]): Map<string, ColumnRow[]> {
  const result = new Map<string, ColumnRow[]>()
  if (entityIds.length === 0 || columnDecorators.length === 0) return result
  const { entityForProp, nameForProp, propIds } = loadContains(db, repoId, entityIds)
  if (propIds.length === 0) return result
  const decEdges = db
    .select({ sourceId: codeEdges.sourceId, targetSymbol: codeEdges.targetSymbol })
    .from(codeEdges)
    .where(and(
      eq(codeEdges.repoId, repoId), eq(codeEdges.relation, 'decorates'),
      inArray(codeEdges.sourceId, propIds),
      inArray(codeEdges.targetSymbol as Parameters<typeof inArray>[0], columnDecorators),
    ))
    .all()
  if (decEdges.length === 0) return result
  const colPropIds = [...new Set(decEdges.map((e) => e.sourceId))]
  const propNodes = db
    .select({ id: codeNodes.id, name: codeNodes.name })
    .from(codeNodes)
    .where(and(eq(codeNodes.repoId, repoId), eq(codeNodes.type, 'property'), inArray(codeNodes.id, colPropIds)))
    .all()
  const nameNode = new Map(propNodes.map((p) => [p.id, p.name]))
  for (const dec of decEdges) {
    const entityId = entityForProp.get(dec.sourceId)
    if (!entityId || !nameNode.has(dec.sourceId)) continue
    const list = result.get(entityId) ?? []
    list.push({ propId: dec.sourceId, fieldName: nameForProp.get(dec.sourceId) ?? nameNode.get(dec.sourceId)!, decoratorName: dec.targetSymbol ?? '' })
    result.set(entityId, list)
  }
  return result
}

function queryRelations(db: DB, repoId: string, entityIds: string[], relationDecorators: string[]): Map<string, RelRow[]> {
  const result = new Map<string, RelRow[]>()
  if (entityIds.length === 0 || relationDecorators.length === 0) return result
  const { entityForProp, nameForProp, propIds } = loadContains(db, repoId, entityIds)
  if (propIds.length === 0) return result
  const relEdges = db
    .select({ sourceId: codeEdges.sourceId, targetSymbol: codeEdges.targetSymbol, firstArg: codeEdges.firstArg })
    .from(codeEdges)
    .where(and(
      eq(codeEdges.repoId, repoId), eq(codeEdges.relation, 'decorates'),
      inArray(codeEdges.sourceId, propIds),
      inArray(codeEdges.targetSymbol as Parameters<typeof inArray>[0], relationDecorators),
    ))
    .all()
  if (relEdges.length === 0) return result
  const relPropIds = [...new Set(relEdges.map((e) => e.sourceId))]
  const typeRefs = db
    .select({ sourceId: codeEdges.sourceId, targetSymbol: codeEdges.targetSymbol })
    .from(codeEdges)
    .where(and(eq(codeEdges.repoId, repoId), eq(codeEdges.relation, 'type_ref'), inArray(codeEdges.sourceId, relPropIds)))
    .all()
  const targetHint = new Map<string, string>()
  for (const t of typeRefs) {
    const s = t.targetSymbol ?? ''
    if (/^[A-Z][A-Za-z0-9_$]*$/.test(s) && !isBuiltinTypeRef(s) && !targetHint.has(t.sourceId)) targetHint.set(t.sourceId, s)
  }
  const propNodes = db
    .select({ id: codeNodes.id, name: codeNodes.name })
    .from(codeNodes)
    .where(and(eq(codeNodes.repoId, repoId), eq(codeNodes.type, 'property'), inArray(codeNodes.id, relPropIds)))
    .all()
  const nameNode = new Map(propNodes.map((p) => [p.id, p.name]))
  for (const rel of relEdges) {
    const entityId = entityForProp.get(rel.sourceId)
    if (!entityId || !nameNode.has(rel.sourceId)) continue
    const list = result.get(entityId) ?? []
    list.push({
      propName: nameForProp.get(rel.sourceId) ?? nameNode.get(rel.sourceId)!,
      decoratorName: rel.targetSymbol ?? '', firstArg: rel.firstArg, targetHint: targetHint.get(rel.sourceId) ?? null,
    })
    result.set(entityId, list)
  }
  return result
}

function buildModelRaw(spec: ModelAdapterSpec, entity: EntityRow, cols: ColumnRow[], rels: RelRow[]): ModelRaw {
  const seen = new Set<string>()
  const fields: ModelField[] = []
  for (const c of cols) {
    if (seen.has(c.propId)) continue
    seen.add(c.propId)
    fields.push({
      name: c.fieldName,
      type: 'unknown', // type normalization is ORM-specific; the loop grades structure, not type strings
      nullable: false,
      primary: spec.primaryDecorators.includes(c.decoratorName),
      unique: false,
      line: 0,
    })
  }
  const relations: ModelRelation[] = rels.map((r) => {
    const target = extractLambdaTarget(r.firstArg)
    return {
      name: r.propName,
      target_model: target === 'unknown' && r.targetHint ? r.targetHint : target,
      type: spec.relationDecoratorTypes[r.decoratorName] ?? 'manyToOne',
      line: 0,
    }
  })
  return {
    name: entity.className,
    table_name: resolveTableName(spec, entity.entityArg, entity.className),
    comment: entity.docComment ?? '',
    fields,
    relations,
    source_file: entity.filePath,
    line_start: entity.lineStart,
    line_end: entity.lineEnd,
    is_deprecated: false,
  }
}

export class GraphQuerySpecAdapter implements BuildModelsAdapter {
  readonly strategy = 'graph-query' as const
  constructor(private readonly spec: ModelAdapterSpec) {}
  get orm(): string { return this.spec.orm }

  async queryFromGraph(db: DB, repoId: string): Promise<ModelRaw[]> {
    // cross-ORM gate: only fire when the repo imports one of this ORM's packages.
    if (!repoImportsAny(db, repoId, this.spec.clientPackages)) return []
    const entities = queryEntityClasses(db, repoId, this.spec.entityDecorators)
    if (entities.length === 0) return []
    const entityIds = entities.map((e) => e.nodeId)
    const cols = queryColumns(db, repoId, entityIds, this.spec.columnDecorators)
    const rels = queryRelations(db, repoId, entityIds, Object.keys(this.spec.relationDecoratorTypes))
    return entities.map((e) => buildModelRaw(this.spec, e, cols.get(e.nodeId) ?? [], rels.get(e.nodeId) ?? []))
  }
}
