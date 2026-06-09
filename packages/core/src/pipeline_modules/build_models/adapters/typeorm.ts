import { eq, inArray, and } from 'drizzle-orm'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import type { DB } from '@/db/client.js'
import { repositories } from '@/db/schema/core.js'
import { codeNodes, codeEdges } from '@/db/schema/code_graph.js'
import type { BuildModelsAdapter, ModelRaw, ModelField, ModelRelation } from '../types.js'

// ─── 타입 정규화 맵 ──────────────────────────────────────────────────────────

const TYPE_MAP: Record<string, string> = {
  varchar: 'String',
  text: 'String',
  char: 'String',
  character: 'String',
  string: 'String',
  nclob: 'String',
  uuid: 'String',
  enum: 'String',
  int: 'Int',
  integer: 'Int',
  bigint: 'Int',
  smallint: 'Int',
  float: 'Float',
  double: 'Float',
  dec: 'Float',
  decimal: 'Float',
  numeric: 'Float',
  boolean: 'Boolean',
  bool: 'Boolean',
  timestamp: 'DateTime',
  date: 'DateTime',
  datetime: 'DateTime',
  timestamptz: 'DateTime',
  json: 'Json',
  jsonb: 'Json',
  vector: 'Json',
  real_vector: 'Json',
  halfvec: 'Json',
}

const COLUMN_DECORATORS = [
  'Column',
  'PrimaryColumn',
  'PrimaryGeneratedColumn',
  'CreateDateColumn',
  'UpdateDateColumn',
  'DeleteDateColumn',
  'VersionColumn',
] as const

const RELATION_DECORATORS = [
  'OneToMany',
  'ManyToOne',
  'OneToOne',
  'ManyToMany',
] as const

// ─── 헬퍼 ───────────────────────────────────────────────────────────────────

function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase()
}

/**
 * @Entity first_arg에서 table_name 결정 (TA-5)
 * 1. 따옴표 감싼 string literal → 내용 추출
 * 2. JSON 파싱 가능 객체 + name 키 → name 값
 * 3. fallback → TypeORM DefaultNamingStrategy 기준 snake_case(className)
 */
function resolveTableName(entityTableArg: string | null, className: string): string {
  if (!entityTableArg) return toSnakeCase(className)

  // 1. 따옴표 감싼 string literal (single or double)
  const quoted = entityTableArg.match(/^['"](.+)['"]$/)
  if (quoted) {
    const val = quoted[1]
    if (val.length > 0) return val
    return toSnakeCase(className)
  }

  // build_graph normalizes string literal decorator args without quotes.
  if (/^[A-Za-z0-9_.$-]+$/.test(entityTableArg)) {
    return entityTableArg
  }

  // 2. JSON 파싱 가능 객체 + name 키
  try {
    // handle {name:"orders"} without quotes around keys
    const normalized = entityTableArg.replace(/(\w+):/g, '"$1":').replace(/'/g, '"')
    const parsed = JSON.parse(normalized) as Record<string, unknown>
    if (typeof parsed.name === 'string' && parsed.name.length > 0) {
      return parsed.name
    }
  } catch {
    // ignore
  }

  return toSnakeCase(className)
}

/**
 * relation decorator 첫 번째 인자에서 target model 추출.
 * TypeORM은 `() => ClassName`와 `'ClassName'` 문자열 target을 모두 허용한다.
 */
function extractLambdaTarget(firstArg: string | null): string {
  if (!firstArg) return 'unknown'
  const quoted = firstArg.match(/^['"]([A-Za-z_$][A-Za-z0-9_$]*)['"]$/)
  if (quoted) return quoted[1]
  const bareIdentifier = firstArg.match(/^([A-Z][A-Za-z0-9_$]*)$/)
  if (bareIdentifier) return bareIdentifier[1]
  // () => User, ()=>User, () => User<T> 등
  const m = firstArg.match(/=>\s*([A-Za-z_$][A-Za-z0-9_$]*)/)
  if (m) return m[1]
  return 'unknown'
}

function normalizeTsType(typeText: string | null): string | null {
  if (!typeText) return null
  const cleaned = typeText
    .replace(/^:\s*/, '')
    .replace(/\s*\|\s*null/g, '')
    .replace(/\s*\|\s*undefined/g, '')
    .replace(/\[\]$/, '')
    .replace(/^Promise<(.+)>$/, '$1')
    .replace(/^Array<(.+)>$/, '$1')
    .trim()

  switch (cleaned) {
    case 'string': return 'String'
    case 'number': return 'Float'
    case 'boolean': return 'Boolean'
    case 'Date': return 'DateTime'
    case 'object': return 'Json'
    default:
      if (/^[A-Z][A-Za-z0-9_$]*$/.test(cleaned)) return cleaned
      return null
  }
}

/**
 * decorator first_arg에서 TypeORM type 문자열 추출
 * '@Column({ type: "varchar" })' → first_arg = '{"type":"varchar"}' or '"varchar"' or just plain text
 */
function extractColumnType(decoratorName: string, firstArg: string | null, signature: string | null): string {
  // 특수 데코레이터는 고정 타입
  if (decoratorName === 'PrimaryGeneratedColumn') {
    const quoted = firstArg?.match(/^['"](.+)['"]$/)
    if (quoted && quoted[1] === 'uuid') return 'String'
    return 'Int'
  }
  if (decoratorName === 'CreateDateColumn' || decoratorName === 'UpdateDateColumn') return 'DateTime'
  if (decoratorName === 'DeleteDateColumn') return 'DateTime'
  if (decoratorName === 'VersionColumn') return 'Int'

  if (!firstArg) return normalizeTsType(signature) ?? 'unknown'

  if (/^[a-z_]+$/.test(firstArg)) {
    return TYPE_MAP[firstArg.toLowerCase()] ?? 'unknown'
  }

  // @Column('text') 또는 @PrimaryColumn('int') — string literal first_arg
  const quotedType = firstArg.match(/^['"]([a-zA-Z_]+)['"]$/)
  if (quotedType) {
    return TYPE_MAP[quotedType[1].toLowerCase()] ?? 'unknown'
  }

  const lambdaTarget = extractLambdaTarget(firstArg)
  if (lambdaTarget !== 'unknown') return lambdaTarget

  const typeProp = firstArg.match(/\btype\s*:\s*['"]([a-zA-Z_]+)['"]/)
  if (typeProp) {
    return TYPE_MAP[typeProp[1].toLowerCase()] ?? 'unknown'
  }
  if (/\benum\s*:/.test(firstArg)) return 'String'

  // @Column({ type: 'varchar' }) — JSON-like object
  try {
    const normalized = firstArg.replace(/(\w+):/g, '"$1":').replace(/'/g, '"')
    const parsed = JSON.parse(normalized) as Record<string, unknown>
    if (typeof parsed.type === 'string') {
      return TYPE_MAP[parsed.type.toLowerCase()] ?? 'unknown'
    }
  } catch {
    // ignore
  }

  return normalizeTsType(signature) ?? 'unknown'
}

function isNullableColumn(decoratorName: string, firstArg: string | null): boolean {
  if (decoratorName === 'DeleteDateColumn') return true
  if (!firstArg) return false

  try {
    const normalized = firstArg.replace(/(\w+):/g, '"$1":').replace(/'/g, '"')
    const parsed = JSON.parse(normalized) as Record<string, unknown>
    return parsed.nullable === true
  } catch {
    return false
  }
}

function isUniqueColumn(firstArg: string | null): boolean {
  if (!firstArg) return false
  try {
    const normalized = firstArg.replace(/(\w+):/g, '"$1":').replace(/'/g, '"')
    const parsed = JSON.parse(normalized) as Record<string, unknown>
    return parsed.unique === true
  } catch {
    return false
  }
}

/**
 * @JoinColumn first_arg에서 fk_fields 추출
 * '{ name: "userId" }' → ['userId']
 * '[{ name: "a" }, { name: "b" }]' → ['a', 'b']
 */
function extractFkFields(joinColumnFirstArg: string | null): string[] | undefined {
  if (!joinColumnFirstArg) return undefined

  try {
    const normalized = joinColumnFirstArg.replace(/(\w+):/g, '"$1":').replace(/'/g, '"')
    const parsed = JSON.parse(normalized) as unknown

    if (Array.isArray(parsed)) {
      const names = parsed
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .map(item => item['name'])
        .filter((n): n is string => typeof n === 'string')
      return names.length > 0 ? names : undefined
    }

    if (typeof parsed === 'object' && parsed !== null) {
      const obj = parsed as Record<string, unknown>
      if (typeof obj['name'] === 'string') return [obj['name']]
    }
  } catch {
    // ignore
  }

  return undefined
}

function isBuiltinTypeRef(symbol: string): boolean {
  return ['Array', 'Date', 'Promise', 'Relation'].includes(symbol)
}

// ─── 내부 쿼리 타입 ──────────────────────────────────────────────────────────

interface EntityRow {
  nodeId: string
  className: string
  filePath: string
  lineStart: number | null
  lineEnd: number | null
  docComment: string | null
  entityTableArg: string | null
}

interface PropertyRow {
  propId: string
  fieldName: string
  signature: string | null
  lineStart: number | null
  entityNodeId: string
  decoratorName: string
  firstArg: string | null
}

interface RelationRow {
  propName: string
  lineStart: number | null
  entityNodeId: string
  decoratorName: string
  firstArg: string | null
  targetModelHint: string | null
  joinFirstArg: string | null
  hasJoin: boolean
}

interface EntitySchemaVariableRow {
  nodeId: string
  variableName: string
  filePath: string
  lineStart: number | null
  lineEnd: number | null
}

// ─── TypeOrmGraphAdapter ─────────────────────────────────────────────────────

export class TypeOrmGraphAdapter implements BuildModelsAdapter {
  readonly orm = 'typeorm'
  readonly strategy = 'graph-query' as const

  async queryFromGraph(db: DB, repoId: string): Promise<ModelRaw[]> {
    const schemaModels = await queryEntitySchemaModels(db, repoId)
    const entityNodes = await queryEntityClasses(db, repoId)
    if (entityNodes.length === 0) return schemaModels

    const entityNodeIds = entityNodes.map(e => e.nodeId)
    const propertyMap = await queryEntityProperties(db, repoId, entityNodeIds)
    const relationMap = await queryEntityRelations(db, repoId, entityNodeIds)

    return [
      ...buildModelRaws(entityNodes, propertyMap, relationMap),
      ...schemaModels,
    ]
  }
}

// ─── 쿼리 함수들 ─────────────────────────────────────────────────────────────

async function queryEntityClasses(db: DB, repoId: string): Promise<EntityRow[]> {
  // code_nodes (class) JOIN code_edges (decorates, targetSymbol IN @Entity/@ChildEntity)
  // build_graph 컨벤션: decorates edge의 source_id = class node id, target_symbol = 'Entity'
  const rows = db
    .select({
      nodeId: codeNodes.id,
      className: codeNodes.name,
      filePath: codeNodes.filePath,
      lineStart: codeNodes.lineStart,
      lineEnd: codeNodes.lineEnd,
      docComment: codeNodes.docComment,
      entityTableArg: codeEdges.firstArg,
    })
    .from(codeNodes)
    .innerJoin(
      codeEdges,
      and(
        eq(codeEdges.sourceId, codeNodes.id),
        eq(codeEdges.relation, 'decorates'),
        eq(codeEdges.repoId, repoId),
        inArray(codeEdges.targetSymbol as Parameters<typeof inArray>[0], ['Entity', 'ChildEntity']),
      ),
    )
    .where(
      and(
        eq(codeNodes.repoId, repoId),
        eq(codeNodes.type, 'class'),
      ),
    )
    .all()

  return rows as EntityRow[]
}

async function queryEntitySchemaModels(db: DB, repoId: string): Promise<ModelRaw[]> {
  const repo = db
    .select({ repoPath: repositories.repoPath })
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .get()
  if (!repo?.repoPath) return []

  const rows = db
    .select({
      nodeId: codeNodes.id,
      variableName: codeNodes.name,
      filePath: codeNodes.filePath,
      lineStart: codeNodes.lineStart,
      lineEnd: codeNodes.lineEnd,
    })
    .from(codeNodes)
    .innerJoin(
      codeEdges,
      and(
        eq(codeEdges.sourceId, codeNodes.id),
        eq(codeEdges.relation, 'calls'),
        eq(codeEdges.repoId, repoId),
        eq(codeEdges.targetSymbol, 'EntitySchema'),
      ),
    )
    .where(
      and(
        eq(codeNodes.repoId, repoId),
        eq(codeNodes.type, 'variable'),
      ),
    )
    .all() as EntitySchemaVariableRow[]

  const models: ModelRaw[] = []
  for (const row of rows) {
    const model = parseEntitySchemaVariable(repo.repoPath, row)
    if (model) models.push(model)
  }
  return models
}

async function queryEntityProperties(
  db: DB,
  repoId: string,
  entityNodeIds: string[],
): Promise<Map<string, PropertyRow[]>> {
  if (entityNodeIds.length === 0) return new Map()

  // property 노드를 찾는다:
  // 1. code_edges (contains, source=entity, target=prop) 로 property가 entity에 속하는지 확인
  // 2. code_edges (decorates, source=prop, target_symbol IN column decorators) 로 property 데코레이터 확인
  const containsEdges = db
    .select({ targetId: codeEdges.targetId, sourceId: codeEdges.sourceId, targetSymbol: codeEdges.targetSymbol })
    .from(codeEdges)
    .where(
      and(
        eq(codeEdges.repoId, repoId),
        eq(codeEdges.relation, 'contains'),
        inArray(codeEdges.sourceId, entityNodeIds),
      ),
    )
    .all()

  if (containsEdges.length === 0) return new Map()

  const propIds = containsEdges
    .map(e => e.targetId)
    .filter((id): id is string => id !== null)

  if (propIds.length === 0) return new Map()

  // entity → [propIds] 역맵
  const entityForProp = new Map<string, string>()
  const nameForProp = new Map<string, string>()
  for (const edge of containsEdges) {
    if (edge.targetId) {
      entityForProp.set(edge.targetId, edge.sourceId)
      if (edge.targetSymbol) nameForProp.set(edge.targetId, edge.targetSymbol)
    }
  }

  // property 노드들의 decorator edges (column decorators)
  const decEdges = db
    .select({
      sourceId: codeEdges.sourceId,
      targetSymbol: codeEdges.targetSymbol,
      firstArg: codeEdges.firstArg,
    })
    .from(codeEdges)
    .where(
      and(
        eq(codeEdges.repoId, repoId),
        eq(codeEdges.relation, 'decorates'),
        inArray(codeEdges.sourceId, propIds),
        inArray(codeEdges.targetSymbol as Parameters<typeof inArray>[0], [...COLUMN_DECORATORS]),
      ),
    )
    .all()

  if (decEdges.length === 0) return new Map()

  // propId set: only props with column decorators
  const columnPropIds = [...new Set(decEdges.map(e => e.sourceId))]

  // property nodes info
  const propNodes = db
    .select({ id: codeNodes.id, name: codeNodes.name, signature: codeNodes.signature, lineStart: codeNodes.lineStart })
    .from(codeNodes)
    .where(
      and(
        eq(codeNodes.repoId, repoId),
        eq(codeNodes.type, 'property'),
        inArray(codeNodes.id, columnPropIds),
      ),
    )
    .all()

  const propNodeMap = new Map(propNodes.map(p => [p.id, p]))

  const result = new Map<string, PropertyRow[]>()

  for (const decEdge of decEdges) {
    const propNode = propNodeMap.get(decEdge.sourceId)
    if (!propNode) continue

    const entityNodeId = entityForProp.get(decEdge.sourceId)
    if (!entityNodeId) continue

    const row: PropertyRow = {
      propId: decEdge.sourceId,
      fieldName: nameForProp.get(decEdge.sourceId) ?? propNode.name,
      signature: propNode.signature,
      lineStart: propNode.lineStart,
      entityNodeId,
      decoratorName: decEdge.targetSymbol ?? '',
      firstArg: decEdge.firstArg,
    }

    const existing = result.get(entityNodeId) ?? []
    existing.push(row)
    result.set(entityNodeId, existing)
  }

  return result
}

async function queryEntityRelations(
  db: DB,
  repoId: string,
  entityNodeIds: string[],
): Promise<Map<string, RelationRow[]>> {
  if (entityNodeIds.length === 0) return new Map()

  const containsEdges = db
    .select({ targetId: codeEdges.targetId, sourceId: codeEdges.sourceId, targetSymbol: codeEdges.targetSymbol })
    .from(codeEdges)
    .where(
      and(
        eq(codeEdges.repoId, repoId),
        eq(codeEdges.relation, 'contains'),
        inArray(codeEdges.sourceId, entityNodeIds),
      ),
    )
    .all()

  if (containsEdges.length === 0) return new Map()

  const propIds = containsEdges
    .map(e => e.targetId)
    .filter((id): id is string => id !== null)

  if (propIds.length === 0) return new Map()

  const entityForProp = new Map<string, string>()
  const nameForProp = new Map<string, string>()
  for (const edge of containsEdges) {
    if (edge.targetId) {
      entityForProp.set(edge.targetId, edge.sourceId)
      if (edge.targetSymbol) nameForProp.set(edge.targetId, edge.targetSymbol)
    }
  }

  // relation decorator edges
  const relDecEdges = db
    .select({
      sourceId: codeEdges.sourceId,
      targetSymbol: codeEdges.targetSymbol,
      firstArg: codeEdges.firstArg,
    })
    .from(codeEdges)
    .where(
      and(
        eq(codeEdges.repoId, repoId),
        eq(codeEdges.relation, 'decorates'),
        inArray(codeEdges.sourceId, propIds),
        inArray(codeEdges.targetSymbol as Parameters<typeof inArray>[0], [...RELATION_DECORATORS]),
      ),
    )
    .all()

  if (relDecEdges.length === 0) return new Map()

  const relPropIds = [...new Set(relDecEdges.map(e => e.sourceId))]

  // join decorator edges (@JoinColumn, @JoinTable)
  const joinDecEdges = db
    .select({
      sourceId: codeEdges.sourceId,
      targetSymbol: codeEdges.targetSymbol,
      firstArg: codeEdges.firstArg,
    })
    .from(codeEdges)
    .where(
      and(
        eq(codeEdges.repoId, repoId),
        eq(codeEdges.relation, 'decorates'),
        inArray(codeEdges.sourceId, relPropIds),
        inArray(codeEdges.targetSymbol as Parameters<typeof inArray>[0], ['JoinColumn', 'JoinTable']),
      ),
    )
    .all()

  const typeRefEdges = db
    .select({
      sourceId: codeEdges.sourceId,
      targetSymbol: codeEdges.targetSymbol,
      targetId: codeEdges.targetId,
    })
    .from(codeEdges)
    .where(
      and(
        eq(codeEdges.repoId, repoId),
        eq(codeEdges.relation, 'type_ref'),
        inArray(codeEdges.sourceId, relPropIds),
      ),
    )
    .all()

  const targetHintMap = new Map<string, string>()
  for (const edge of typeRefEdges) {
    const symbol = edge.targetSymbol ?? ''
    if (/^[A-Z][A-Za-z0-9_$]*$/.test(symbol) && !isBuiltinTypeRef(symbol) && !targetHintMap.has(edge.sourceId)) {
      targetHintMap.set(edge.sourceId, symbol)
    }
  }

  // propId → join info
  const joinMap = new Map<string, { symbol: string; firstArg: string | null }>()
  for (const j of joinDecEdges) {
    joinMap.set(j.sourceId, { symbol: j.targetSymbol ?? '', firstArg: j.firstArg })
  }

  // property nodes info
  const propNodes = db
    .select({ id: codeNodes.id, name: codeNodes.name, lineStart: codeNodes.lineStart })
    .from(codeNodes)
    .where(
      and(
        eq(codeNodes.repoId, repoId),
        eq(codeNodes.type, 'property'),
        inArray(codeNodes.id, relPropIds),
      ),
    )
    .all()

  const propNodeMap = new Map(propNodes.map(p => [p.id, p]))

  const result = new Map<string, RelationRow[]>()

  for (const relEdge of relDecEdges) {
    const propNode = propNodeMap.get(relEdge.sourceId)
    if (!propNode) continue

    const entityNodeId = entityForProp.get(relEdge.sourceId)
    if (!entityNodeId) continue

    const joinInfo = joinMap.get(relEdge.sourceId)

    const row: RelationRow = {
      propName: nameForProp.get(relEdge.sourceId) ?? propNode.name,
      lineStart: propNode.lineStart,
      entityNodeId,
      decoratorName: relEdge.targetSymbol ?? '',
      firstArg: relEdge.firstArg,
      targetModelHint: targetHintMap.get(relEdge.sourceId) ?? null,
      joinFirstArg: joinInfo?.firstArg ?? null,
      hasJoin: !!joinInfo,
    }

    const existing = result.get(entityNodeId) ?? []
    existing.push(row)
    result.set(entityNodeId, existing)
  }

  return result
}

function buildModelRaws(
  entityNodes: EntityRow[],
  propertyMap: Map<string, PropertyRow[]>,
  relationMap: Map<string, RelationRow[]>,
): ModelRaw[] {
  return entityNodes.map(entity => {
    const fields = buildFields(propertyMap.get(entity.nodeId) ?? [])
    const relations = buildRelations(relationMap.get(entity.nodeId) ?? [])

    return {
      name: entity.className,
      table_name: resolveTableName(entity.entityTableArg, entity.className),
      comment: entity.docComment ?? '',
      fields,
      relations,
      source_file: entity.filePath,
      line_start: entity.lineStart,
      line_end: entity.lineEnd,
      is_deprecated: false,
    }
  })
}

function parseEntitySchemaVariable(repoPath: string, row: EntitySchemaVariableRow): ModelRaw | null {
  if (!row.filePath) return null
  let content: string
  try {
    content = readFileSync(resolve(repoPath, row.filePath), 'utf-8')
  } catch {
    return null
  }

  const objectText = extractEntitySchemaObject(content, row.variableName)
  if (!objectText) return null

  const props = parseObjectProperties(objectText)
  const schemaName = extractStringLike(props.get('name')) ?? row.variableName.replace(/Schema$|Entity$/g, '')
  const tableName = extractStringLike(props.get('tableName')) ?? schemaName
  const fields = parseEntitySchemaFields(props.get('columns') ?? null, content, row.lineStart ?? 0)
  const relations = parseEntitySchemaRelations(props.get('relations') ?? null, content, row.lineStart ?? 0)

  return {
    name: schemaName,
    table_name: tableName,
    comment: '',
    fields,
    relations,
    source_file: row.filePath,
    line_start: row.lineStart,
    line_end: row.lineEnd,
    is_deprecated: false,
  }
}

function extractEntitySchemaObject(content: string, variableName: string): string | null {
  const variableIndex = content.indexOf(variableName)
  const schemaIndex = content.indexOf('EntitySchema', variableIndex >= 0 ? variableIndex : 0)
  if (schemaIndex < 0) return null

  const openParen = content.indexOf('(', schemaIndex)
  if (openParen < 0) return null

  const objectStart = content.indexOf('{', openParen)
  if (objectStart < 0) return null

  const objectEnd = findMatchingDelimiter(content, objectStart, '{', '}')
  if (objectEnd < 0) return null

  return content.slice(objectStart, objectEnd + 1)
}

function parseEntitySchemaFields(columnsText: string | null, content: string, baseLine: number): ModelField[] {
  if (!columnsText) return []
  const columns = parseObjectProperties(columnsText)
  const fields: ModelField[] = []

  for (const [name, configText] of columns) {
    const config = parseObjectProperties(configText)
    fields.push({
      name,
      type: normalizeEntitySchemaType(config.get('type') ?? null),
      nullable: extractBoolean(config.get('nullable')) === true,
      primary: extractBoolean(config.get('primary')) === true,
      unique: extractBoolean(config.get('unique')) === true,
      line: estimateLine(content, name, baseLine),
    })
  }

  return fields
}

function parseEntitySchemaRelations(relationsText: string | null, content: string, baseLine: number): ModelRelation[] {
  if (!relationsText) return []
  const entries = parseObjectProperties(relationsText)
  const relations: ModelRelation[] = []

  for (const [name, configText] of entries) {
    const config = parseObjectProperties(configText)
    const relationType = normalizeEntitySchemaRelationType(extractStringLike(config.get('type')) ?? '')
    const targetModel = extractStringLike(config.get('target')) ?? 'unknown'
    const relation: ModelRelation = {
      name,
      target_model: targetModel,
      type: relationType,
      line: estimateLine(content, name, baseLine),
    }

    const joinColumn = config.get('joinColumn')
    if (joinColumn) {
      const fkFields = extractEntitySchemaJoinColumnFields(joinColumn)
      if (fkFields.length > 0) relation.fk_fields = fkFields
    }

    relations.push(relation)
  }

  return relations
}

function parseObjectProperties(objectText: string): Map<string, string> {
  const out = new Map<string, string>()
  const start = objectText.indexOf('{')
  const end = objectText.lastIndexOf('}')
  if (start < 0 || end <= start) return out

  let i = start + 1
  while (i < end) {
    i = skipWhitespaceAndCommas(objectText, i)
    if (i >= end) break

    const keyResult = readObjectKey(objectText, i)
    if (!keyResult) break
    const { key, next } = keyResult

    i = skipWhitespace(objectText, next)
    if (objectText[i] !== ':') break
    i = skipWhitespace(objectText, i + 1)

    const valueStart = i
    i = findValueEnd(objectText, i, end)
    out.set(key, objectText.slice(valueStart, i).trim())

    i = skipWhitespaceAndCommas(objectText, i)
  }

  return out
}

function readObjectKey(text: string, start: number): { key: string; next: number } | null {
  const quote = text[start]
  if (quote === '"' || quote === "'" || quote === '`') {
    const end = findStringEnd(text, start)
    if (end < 0) return null
    return { key: text.slice(start + 1, end), next: end + 1 }
  }

  const match = text.slice(start).match(/^[$A-Za-z_][\w$-]*/)
  if (!match) return null
  return { key: match[0], next: start + match[0].length }
}

function findValueEnd(text: string, start: number, objectEnd: number): number {
  let i = start
  let depth = 0
  while (i < objectEnd) {
    const char = text[i]
    if (char === '"' || char === "'" || char === '`') {
      const stringEnd = findStringEnd(text, i)
      if (stringEnd < 0) return objectEnd
      i = stringEnd + 1
      continue
    }
    if (char === '/' && text[i + 1] === '/') {
      const lineEnd = text.indexOf('\n', i + 2)
      i = lineEnd < 0 ? objectEnd : lineEnd + 1
      continue
    }
    if (char === '/' && text[i + 1] === '*') {
      const commentEnd = text.indexOf('*/', i + 2)
      i = commentEnd < 0 ? objectEnd : commentEnd + 2
      continue
    }
    if (char === '{' || char === '[' || char === '(') depth++
    else if (char === '}' || char === ']' || char === ')') {
      if (depth === 0) return i
      depth--
    } else if (char === ',' && depth === 0) {
      return i
    }
    i++
  }
  return i
}

function findMatchingDelimiter(text: string, start: number, open: string, close: string): number {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (char === '"' || char === "'" || char === '`') {
      const stringEnd = findStringEnd(text, i)
      if (stringEnd < 0) return -1
      i = stringEnd
      continue
    }
    if (char === '/' && text[i + 1] === '/') {
      const lineEnd = text.indexOf('\n', i + 2)
      i = lineEnd < 0 ? text.length : lineEnd
      continue
    }
    if (char === '/' && text[i + 1] === '*') {
      const commentEnd = text.indexOf('*/', i + 2)
      if (commentEnd < 0) return -1
      i = commentEnd + 1
      continue
    }
    if (char === open) depth++
    else if (char === close) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function findStringEnd(text: string, start: number): number {
  const quote = text[start]
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') {
      i++
      continue
    }
    if (text[i] === quote) return i
  }
  return -1
}

function skipWhitespace(text: string, start: number): number {
  let i = start
  while (i < text.length && /\s/.test(text[i])) i++
  return i
}

function skipWhitespaceAndCommas(text: string, start: number): number {
  let i = start
  while (i < text.length && (/[\s,]/.test(text[i]))) i++
  return i
}

function extractStringLike(valueText: string | null | undefined): string | null {
  if (!valueText) return null
  const trimmed = valueText.trim()
  const quoted = trimmed.match(/^['"`]([^'"`]+)['"`]$/)
  if (quoted) return quoted[1]
  const quotedArrow = trimmed.match(/=>\s*['"`]([^'"`]+)['"`]/)
  if (quotedArrow) return quotedArrow[1]
  const arrow = trimmed.match(/=>\s*([A-Za-z_$][\w$]*)/)
  if (arrow) return arrow[1]
  const identifier = trimmed.match(/^([A-Za-z_$][\w$]*)$/)
  if (identifier) return identifier[1]
  return null
}

function extractBoolean(valueText: string | null | undefined): boolean | null {
  if (!valueText) return null
  const trimmed = valueText.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  return null
}

function normalizeEntitySchemaType(valueText: string | null): string {
  const raw = extractStringLike(valueText)
  if (!raw) return 'unknown'
  switch (raw) {
    case 'String': return 'String'
    case 'Number': return 'Float'
    case 'Boolean': return 'Boolean'
    case 'Date': return 'DateTime'
    default: return TYPE_MAP[raw.toLowerCase()] ?? 'unknown'
  }
}

function normalizeEntitySchemaRelationType(typeText: string): ModelRelation['type'] {
  switch (typeText) {
    case 'one-to-one': return 'oneToOne'
    case 'one-to-many': return 'oneToMany'
    case 'many-to-many': return 'manyToMany'
    case 'many-to-one': return 'manyToOne'
    default: return 'manyToOne'
  }
}

function extractEntitySchemaJoinColumnFields(joinColumnText: string): string[] {
  const trimmed = joinColumnText.trim()
  if (trimmed === 'true' || trimmed === 'false') return []
  const config = parseObjectProperties(trimmed)
  const name = extractStringLike(config.get('name'))
  return name ? [name] : []
}

function estimateLine(content: string, needle: string, fallbackLine: number): number {
  const index = content.indexOf(needle)
  if (index < 0) return fallbackLine
  return content.slice(0, index).split('\n').length
}

function buildFields(rows: PropertyRow[]): ModelField[] {
  // 같은 프로퍼티에 여러 데코레이터가 있을 경우 중복 제거 (propId 기준 첫 번째 우선)
  const seen = new Set<string>()
  const fields: ModelField[] = []

  for (const row of rows) {
    if (seen.has(row.propId)) continue
    seen.add(row.propId)

    const isPrimary = row.decoratorName === 'PrimaryColumn' || row.decoratorName === 'PrimaryGeneratedColumn'

    fields.push({
      name: row.fieldName,
      type: extractColumnType(row.decoratorName, row.firstArg, row.signature),
      nullable: isNullableColumn(row.decoratorName, row.firstArg),
      primary: isPrimary,
      unique: isUniqueColumn(row.firstArg),
      line: row.lineStart ?? 0,
    })
  }

  return fields
}

function buildRelations(rows: RelationRow[]): ModelRelation[] {
  return rows.map(row => {
    const targetModel = extractLambdaTarget(row.firstArg)
    const resolvedTargetModel = targetModel === 'unknown' && row.targetModelHint ? row.targetModelHint : targetModel
    if (targetModel === 'unknown') {
      if (!row.targetModelHint) {
        console.warn(`TypeOrmGraphAdapter: failed to parse lambda target for '${row.propName}', defaulting to 'unknown'`)
      }
    }

    const relType = resolveRelationType(row.decoratorName, row.hasJoin)

    const relation: ModelRelation = {
      name: row.propName,
      target_model: resolvedTargetModel,
      type: relType,
      line: row.lineStart ?? 0,
    }

    // fk_fields from @JoinColumn
    if (row.hasJoin && !row.decoratorName.includes('ManyToMany')) {
      const fkFields = extractFkFields(row.joinFirstArg)
      if (fkFields) relation.fk_fields = fkFields
    }

    return relation
  })
}

function resolveRelationType(
  decoratorName: string,
  _hasJoin: boolean,
): ModelRelation['type'] {
  switch (decoratorName) {
    case 'ManyToOne': return 'manyToOne'
    case 'OneToMany': return 'oneToMany'
    case 'OneToOne': return 'oneToOne'
    case 'ManyToMany': return 'manyToMany'
    default: return 'manyToOne'
  }
}
