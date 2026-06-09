import { and, eq, inArray } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { codeNodes, codeEdges } from '@/db/schema/code_graph.js'
import type { BuildModelsAdapter, ModelField, ModelRaw, ModelRelation } from '../types.js'

const COLUMN_DECORATORS = [
  'Id',
  'Column',
  'GeneratedValue',
  'Version',
  'CreatedDate',
  'LastModifiedDate',
  'ElementCollection',
  'Enumerated',
  'Lob',
  'Basic',
  'Temporal',
] as const
const RELATION_DECORATORS = ['OneToOne', 'OneToMany', 'ManyToOne', 'ManyToMany', 'Embedded'] as const

interface EntityRow {
  nodeId: string
  className: string
  filePath: string
  lineStart: number | null
  lineEnd: number | null
  docComment: string | null
  tableArg: string | null
}

interface PropertyInfo {
  id: string
  name: string
  signature: string | null
  lineStart: number | null
  entityNodeId: string
  decorators: Array<{ name: string; firstArg: string | null }>
  typeRef: string | null
}

export class JpaGraphAdapter implements BuildModelsAdapter {
  readonly orm = 'jpa'
  readonly strategy = 'graph-query' as const

  async queryFromGraph(db: DB, repoId: string): Promise<ModelRaw[]> {
    const entities = queryModelRoots(db, repoId)
    if (entities.length === 0) return []
    const inheritedOwners = queryMappedSuperclassOwners(db, repoId, entities)
    const propertyOwnerIds = [...new Set([
      ...entities.map((entity) => entity.nodeId),
      ...[...inheritedOwners.values()].flat(),
    ])]
    const properties = queryProperties(db, repoId, propertyOwnerIds)
    return entities.map((entity) => buildModel(entity, [
      ...inheritedOwners.get(entity.nodeId)?.flatMap((ownerId) => properties.get(ownerId) ?? []) ?? [],
      ...properties.get(entity.nodeId) ?? [],
    ]))
  }
}

function queryModelRoots(db: DB, repoId: string): EntityRow[] {
  const entityRows = db
    .select({
      nodeId: codeNodes.id,
      className: codeNodes.name,
      filePath: codeNodes.filePath,
      lineStart: codeNodes.lineStart,
      lineEnd: codeNodes.lineEnd,
      docComment: codeNodes.docComment,
    })
    .from(codeNodes)
    .innerJoin(
      codeEdges,
      and(
        eq(codeEdges.repoId, repoId),
        eq(codeEdges.sourceId, codeNodes.id),
        eq(codeEdges.relation, 'decorates'),
        inArray(codeEdges.targetSymbol as Parameters<typeof inArray>[0], ['Entity', 'Embeddable']),
      ),
    )
    .where(and(eq(codeNodes.repoId, repoId), eq(codeNodes.type, 'class')))
    .all()

  const tableEdges = db
    .select({ sourceId: codeEdges.sourceId, firstArg: codeEdges.firstArg })
    .from(codeEdges)
    .where(
      and(
        eq(codeEdges.repoId, repoId),
        eq(codeEdges.relation, 'decorates'),
        eq(codeEdges.targetSymbol, 'Table'),
      ),
    )
    .all()
  const tableByEntity = new Map(tableEdges.map((edge) => [edge.sourceId, edge.firstArg]))

  const byNodeId = new Map<string, EntityRow>()
  for (const row of entityRows) {
    byNodeId.set(row.nodeId, {
      ...row,
      tableArg: tableByEntity.get(row.nodeId) ?? null,
    } as EntityRow)
  }
  return [...byNodeId.values()]
}

function queryMappedSuperclassOwners(db: DB, repoId: string, entities: EntityRow[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  if (entities.length === 0) return out

  const entityIds = entities.map((entity) => entity.nodeId)
  const extendsEdges = db
    .select({
      sourceId: codeEdges.sourceId,
      targetId: codeEdges.targetId,
      targetSymbol: codeEdges.targetSymbol,
    })
    .from(codeEdges)
    .where(and(eq(codeEdges.repoId, repoId), eq(codeEdges.relation, 'extends'), inArray(codeEdges.sourceId, entityIds)))
    .all()
  if (extendsEdges.length === 0) return out

  const mappedRows = db
    .select({
      nodeId: codeNodes.id,
      className: codeNodes.name,
    })
    .from(codeNodes)
    .innerJoin(
      codeEdges,
      and(
        eq(codeEdges.repoId, repoId),
        eq(codeEdges.sourceId, codeNodes.id),
        eq(codeEdges.relation, 'decorates'),
        eq(codeEdges.targetSymbol, 'MappedSuperclass'),
      ),
    )
    .where(and(eq(codeNodes.repoId, repoId), eq(codeNodes.type, 'class')))
    .all()
  if (mappedRows.length === 0) return out

  const mappedById = new Map(mappedRows.map((row) => [row.nodeId, row]))
  const mappedByName = new Map<string, string[]>()
  for (const row of mappedRows) {
    const list = mappedByName.get(row.className) ?? []
    list.push(row.nodeId)
    mappedByName.set(row.className, list)
  }

  for (const edge of extendsEdges) {
    const inherited = edge.targetId && mappedById.has(edge.targetId)
      ? [edge.targetId]
      : edge.targetSymbol
        ? mappedByName.get(edge.targetSymbol) ?? []
        : []
    if (inherited.length > 0) out.set(edge.sourceId, inherited)
  }

  return out
}

function queryProperties(db: DB, repoId: string, entityNodeIds: string[]): Map<string, PropertyInfo[]> {
  const out = new Map<string, PropertyInfo[]>()
  if (entityNodeIds.length === 0) return out

  const contains = db
    .select({ sourceId: codeEdges.sourceId, targetId: codeEdges.targetId, targetSymbol: codeEdges.targetSymbol })
    .from(codeEdges)
    .where(
      and(
        eq(codeEdges.repoId, repoId),
        eq(codeEdges.relation, 'contains'),
        inArray(codeEdges.sourceId, entityNodeIds),
      ),
    )
    .all()

  const propIds = contains.map((edge) => edge.targetId).filter((id): id is string => id !== null)
  if (propIds.length === 0) return out

  const propNodes = db
    .select({
      id: codeNodes.id,
      name: codeNodes.name,
      signature: codeNodes.signature,
      lineStart: codeNodes.lineStart,
    })
    .from(codeNodes)
    .where(and(eq(codeNodes.repoId, repoId), eq(codeNodes.type, 'property'), inArray(codeNodes.id, propIds)))
    .all()
  const propNodeById = new Map(propNodes.map((node) => [node.id, node]))

  const decorators = db
    .select({ sourceId: codeEdges.sourceId, targetSymbol: codeEdges.targetSymbol, firstArg: codeEdges.firstArg })
    .from(codeEdges)
    .where(
      and(
        eq(codeEdges.repoId, repoId),
        eq(codeEdges.relation, 'decorates'),
        inArray(codeEdges.sourceId, propIds),
        inArray(codeEdges.targetSymbol as Parameters<typeof inArray>[0], [...COLUMN_DECORATORS, ...RELATION_DECORATORS, 'JoinColumn', 'JoinTable']),
      ),
    )
    .all()

  const typeRefs = db
    .select({ sourceId: codeEdges.sourceId, targetSymbol: codeEdges.targetSymbol })
    .from(codeEdges)
    .where(and(eq(codeEdges.repoId, repoId), eq(codeEdges.relation, 'type_ref'), inArray(codeEdges.sourceId, propIds)))
    .all()
  const typeRefByProp = new Map(typeRefs.map((edge) => [edge.sourceId, edge.targetSymbol ?? null]))

  const decoratorsByProp = new Map<string, Array<{ name: string; firstArg: string | null }>>()
  for (const edge of decorators) {
    const list = decoratorsByProp.get(edge.sourceId) ?? []
    if (edge.targetSymbol) list.push({ name: edge.targetSymbol, firstArg: edge.firstArg })
    decoratorsByProp.set(edge.sourceId, list)
  }

  for (const edge of contains) {
    if (!edge.targetId) continue
    const node = propNodeById.get(edge.targetId)
    if (!node) continue
    const info: PropertyInfo = {
      id: edge.targetId,
      name: edge.targetSymbol ?? node.name,
      signature: node.signature,
      lineStart: node.lineStart,
      entityNodeId: edge.sourceId,
      decorators: decoratorsByProp.get(edge.targetId) ?? [],
      typeRef: typeRefByProp.get(edge.targetId) ?? null,
    }
    const list = out.get(edge.sourceId) ?? []
    list.push(info)
    out.set(edge.sourceId, list)
  }

  return out
}

function buildModel(entity: EntityRow, properties: PropertyInfo[]): ModelRaw {
  return {
    name: entity.className,
    table_name: resolveTableName(entity.tableArg, entity.className),
    comment: entity.docComment ?? '',
    fields: properties.flatMap((property) => buildField(property)),
    relations: properties.flatMap((property) => buildRelation(property)),
    source_file: entity.filePath,
    line_start: entity.lineStart,
    line_end: entity.lineEnd,
    is_deprecated: false,
  }
}

function buildField(property: PropertyInfo): ModelField[] {
  const decoratorNames = new Set(property.decorators.map((decorator) => decorator.name))
  if ([...decoratorNames].some((name) => RELATION_DECORATORS.includes(name as never))) return []
  const column = property.decorators.find((decorator) => decorator.name === 'Column')
  const primary = decoratorNames.has('Id')
  return [{
    name: property.name,
    type: normalizeJvmType(property.typeRef ?? property.signature ?? ''),
    nullable: !/nullable\s*[:=]\s*false/.test(column?.firstArg ?? ''),
    primary,
    unique: /unique\s*[:=]\s*true/.test(column?.firstArg ?? ''),
    line: property.lineStart ?? 0,
  }]
}

function buildRelation(property: PropertyInfo): ModelRelation[] {
  const relationDecorator = property.decorators.find((decorator) => RELATION_DECORATORS.includes(decorator.name as never))
  if (!relationDecorator) return []
  const join = property.decorators.find((decorator) => decorator.name === 'JoinColumn' || decorator.name === 'JoinTable')
  const relation: ModelRelation = {
    name: property.name,
    target_model: property.typeRef ?? 'unknown',
    type: relationType(relationDecorator.name),
    line: property.lineStart ?? 0,
  }
  const fkFields = extractNameFields(join?.firstArg ?? null)
  if (fkFields.length > 0) relation.fk_fields = fkFields
  return [relation]
}

function resolveTableName(tableArg: string | null, className: string): string {
  if (!tableArg) return toSnakeCase(className)
  const quoted = /^['"]([^'"]+)['"]$/.exec(tableArg)
  if (quoted) return quoted[1]
  if (/^[A-Za-z0-9_.$-]+$/.test(tableArg)) return tableArg
  const name = /\bname\s*[:=]\s*['"]([^'"]+)['"]/.exec(tableArg)
  return name?.[1] ?? toSnakeCase(className)
}

function normalizeJvmType(type: string): string {
  const cleaned = type.replace(/[?]/g, '').replace(/^List<(.+)>$/, '$1').trim()
  switch (cleaned) {
    case 'String': return 'String'
    case 'Long':
    case 'Integer':
    case 'Int':
    case 'Short':
    case 'BigInteger':
      return 'Int'
    case 'Double':
    case 'Float':
    case 'BigDecimal':
      return 'Float'
    case 'Boolean':
    case 'boolean':
      return 'Boolean'
    case 'Instant':
    case 'LocalDate':
    case 'LocalDateTime':
    case 'Date':
      return 'DateTime'
    default:
      return cleaned || 'unknown'
  }
}

function relationType(name: string): ModelRelation['type'] {
  switch (name) {
    case 'Embedded': return 'embedded'
    case 'OneToOne': return 'oneToOne'
    case 'OneToMany': return 'oneToMany'
    case 'ManyToMany': return 'manyToMany'
    default: return 'manyToOne'
  }
}

function extractNameFields(firstArg: string | null): string[] {
  if (!firstArg) return []
  if (/^[A-Za-z_][\w$-]*$/.test(firstArg)) return [firstArg]
  return [...firstArg.matchAll(/\bname\s*[:=]\s*['"]([^'"]+)['"]/g)].map((match) => match[1])
}

function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase()
}
