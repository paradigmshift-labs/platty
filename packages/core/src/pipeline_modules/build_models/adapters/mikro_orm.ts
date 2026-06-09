import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import fg from 'fast-glob'
import { eq, inArray, and } from 'drizzle-orm'
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
  uuid: 'String',
  enum: 'String',
  string: 'String',
  int: 'Int',
  integer: 'Int',
  bigint: 'Int',
  smallint: 'Int',
  number: 'Float',
  float: 'Float',
  double: 'Float',
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
  jsontype: 'Json',
  dictionary: 'Json',
  arraytype: 'Json',
  objectid: 'String',
  buffer: 'String',
  uint8array: 'String',
}

const COLUMN_DECORATORS = [
  'PrimaryKey',
  'Property',
  'Enum',
  'SerializedPrimaryKey',
] as const

const RELATION_DECORATORS = [
  'OneToMany',
  'ManyToOne',
  'OneToOne',
  'ManyToMany',
] as const

// ─── 헬퍼 ───────────────────────────────────────────────────────────────────

function toSnakeCasePlural(name: string): string {
  const snake = name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase()

  if (/[^aeiou]y$/.test(snake)) return snake.slice(0, -1) + 'ies'
  if (/(s|x|z|sh|ch)$/.test(snake)) return snake + 'es'
  return snake + 's'
}

/**
 * @Entity first_arg에서 table_name 결정
 * 1. JSON 파싱 가능 객체 + tableName 또는 collection 키 → 해당 값
 * 2. fallback → toSnakeCasePlural(className)
 */
function resolveTableName(entityTableArg: string | null, className: string): string {
  if (!entityTableArg) return toSnakeCasePlural(className)

  // JSON 파싱 가능 객체 → tableName 또는 collection 키
  try {
    const normalized = entityTableArg.replace(/(\w+):/g, '"$1":').replace(/'/g, '"')
    const parsed = JSON.parse(normalized) as Record<string, unknown>
    if (typeof parsed.tableName === 'string' && parsed.tableName.length > 0) {
      return parsed.tableName
    }
    if (typeof parsed.collection === 'string' && parsed.collection.length > 0) {
      return parsed.collection
    }
  } catch {
    // ignore
  }

  return toSnakeCasePlural(className)
}

/**
 * 람다 표현식 `() => ClassName` 에서 ClassName 추출
 */
function extractLambdaTarget(firstArg: string | null, typeRefTarget: string | null = null): string {
  if (!firstArg) return typeRefTarget ?? 'unknown'
  const m = firstArg.match(/=>\s*([A-Za-z_$][A-Za-z0-9_$]*)/)
  if (m) return m[1]
  const typeProp = firstArg.match(/\b(?:entity|type)\s*:\s*['"]([A-Za-z_$][A-Za-z0-9_$]*)['"]/)
  if (typeProp) return typeProp[1]
  if (typeRefTarget) return typeRefTarget
  return 'unknown'
}

function extractRelationTarget(firstArg: string | null, typeRefTarget: string | null, signature: string | null, sourceLine: string | null): string {
  const direct = extractLambdaTarget(firstArg, typeRefTarget ?? inferRelationTargetFromSignature(signature))
  if (direct !== 'unknown') return direct
  return extractLambdaTarget(sourceLine, inferRelationTargetFromSignature(sourceLine))
}

function normalizeTsType(typeText: string | null): string | null {
  if (!typeText) return null
  let cleaned = typeText
    .replace(/^:\s*/, '')
    .replace(/\[\]$/, '')
    .replace(/\s*&\s*Opt\b/g, '')
    .replace(/^Opt<(.+)>$/, '$1')
    .replace(/^Collection<(.+)>$/, '$1')
    .replace(/^Ref<(.+)>$/, '$1')
    .trim()

  if (cleaned.includes('|')) {
    const candidate = cleaned
      .split('|')
      .map(part => part.trim())
      .find(part => !['null', 'undefined', 'any'].includes(part))
    cleaned = candidate ?? cleaned
  }

  const generic = cleaned.match(/^([A-Za-z_$][A-Za-z0-9_$]*)<.+>$/)
  if (generic) {
    const mapped = TYPE_MAP[generic[1].toLowerCase()]
    if (mapped) return mapped
  }

  if (/^\[[^\]]+\]$/.test(cleaned)) return 'Json'
  if (/^\{.+\}$/.test(cleaned)) return 'Json'

  const mapped = TYPE_MAP[cleaned.toLowerCase()]
  if (mapped) return mapped
  if (/^[A-Z][A-Za-z0-9_$]*$/.test(cleaned)) return 'Json'

  switch (cleaned) {
    case 'string': return 'String'
    case 'number': return 'Float'
    case 'boolean': return 'Boolean'
    case 'Date': return 'DateTime'
    case 'ObjectId': return 'String'
    case 'Buffer': return 'String'
    case 'Uint8Array': return 'String'
    case 'any': return 'Json'
    case 'object': return 'Json'
    default: return null
  }
}

function inferRelationTargetFromSignature(signature: string | null): string | null {
  if (!signature) return null
  const generic = signature.match(/\b(?:Collection|Ref|Promise)<\s*([A-Z][A-Za-z0-9_$]*)/)
  if (generic) return generic[1]
  const direct = signature.match(/^:\s*([A-Z][A-Za-z0-9_$]*)\b/)
  return direct?.[1] ?? null
}

function inferInitializerType(signature: string | null): string | null {
  if (!signature) return null
  const initializer = signature.split('=').slice(1).join('=').trim()
  if (!initializer) return null
  if (/^new Date\b/.test(initializer)) return 'DateTime'
  if (/^v4\s*\(/.test(initializer)) return 'String'
  if (/^Date\.now\s*\(/.test(initializer)) return 'Float'
  if (/^(true|false)\b/.test(initializer)) return 'Boolean'
  if (/^['"`]/.test(initializer)) return 'String'
  if (/^-?\d+(\.\d+)?\b/.test(initializer)) return 'Float'
  return null
}

function inferSourceLineType(sourceLine: string | null): string | null {
  if (!sourceLine) return null
  const typeNamespace = sourceLine.match(/\btype\s*:\s*t\.([A-Za-z_$][A-Za-z0-9_$]*)/)
  if (typeNamespace) return TYPE_MAP[typeNamespace[1].toLowerCase()] ?? null
  const quotedType = sourceLine.match(/\btype\s*:\s*['"]([A-Za-z_$][A-Za-z0-9_$]*)['"]/)
  if (quotedType) return TYPE_MAP[quotedType[1].toLowerCase()] ?? null
  const annotation = sourceLine.match(/\b[A-Za-z_$][A-Za-z0-9_$]*\??\s*:\s*([^=;]+)/)
  if (annotation) {
    const normalized = normalizeTsType(annotation[1].trim())
    if (normalized) return normalized
    if (/^[A-Z][A-Za-z0-9_$]*$/.test(annotation[1].trim())) return 'Json'
  }
  return inferInitializerType(sourceLine)
}

/**
 * decorator first_arg에서 type 문자열 추출
 */
function extractColumnType(decoratorName: string, firstArg: string | null, signature: string | null): string {
  // @Enum → String
  if (decoratorName === 'Enum') return 'String'
  // @SerializedPrimaryKey → String (내부 직렬화용 ObjectId)
  if (decoratorName === 'SerializedPrimaryKey') return 'String'

  if (!firstArg) return normalizeTsType(signature) ?? inferSourceLineType(signature) ?? 'unknown'

  // @Property('text') 또는 @PrimaryKey('int') — string literal first_arg
  const quotedType = firstArg.match(/^['"]([a-zA-Z]+)['"]$/)
  if (quotedType) {
    return TYPE_MAP[quotedType[1].toLowerCase()] ?? 'unknown'
  }

  // @Property({ type: 'varchar' }) — JSON-like object
  try {
    const normalized = firstArg.replace(/(\w+):/g, '"$1":').replace(/'/g, '"')
    const parsed = JSON.parse(normalized) as Record<string, unknown>
    if (typeof parsed.type === 'string') {
      return TYPE_MAP[parsed.type.toLowerCase()] ?? normalizeTsType(signature) ?? inferSourceLineType(signature) ?? 'unknown'
    }
  } catch {
    // ignore
  }

  const typeNamespace = firstArg.match(/\btype\s*:\s*t\.([A-Za-z_$][A-Za-z0-9_$]*)/)
  if (typeNamespace) return TYPE_MAP[typeNamespace[1].toLowerCase()] ?? normalizeTsType(signature) ?? inferSourceLineType(signature) ?? 'unknown'
  const typeIdentifier = firstArg.match(/\btype\s*:\s*([A-Za-z_$][A-Za-z0-9_$]*)/)
  if (typeIdentifier) return TYPE_MAP[typeIdentifier[1].toLowerCase()] ?? normalizeTsType(signature) ?? inferSourceLineType(signature) ?? 'unknown'

  return normalizeTsType(signature) ?? inferSourceLineType(signature) ?? 'unknown'
}

function isNullableColumn(_decoratorName: string, firstArg: string | null): boolean {
  // @SerializedPrimaryKey는 nullable로 취급하지 않음
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

function hasDefaultValue(firstArg: string | null): string | undefined {
  if (!firstArg) return undefined
  try {
    const normalized = firstArg.replace(/(\w+):/g, '"$1":').replace(/'/g, '"')
    const parsed = JSON.parse(normalized) as Record<string, unknown>
    if (parsed.default !== undefined) return String(parsed.default)
  } catch {
    // ignore
  }
  return undefined
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
  sourceLine: string | null
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
  typeRefTarget: string | null
  signature: string | null
  sourceLine: string | null
}

// ─── MikroOrmGraphAdapter ────────────────────────────────────────────────────

export class MikroOrmGraphAdapter implements BuildModelsAdapter {
  readonly orm = 'mikro-orm'
  readonly strategy = 'graph-query' as const

  async queryFromGraph(db: DB, repoId: string): Promise<ModelRaw[]> {
    const repo = db
      .select({ repoPath: repositories.repoPath })
      .from(repositories)
      .where(eq(repositories.id, repoId))
      .get()
    const entityNodes = await queryEntityClasses(db, repoId)
    if (entityNodes.length === 0) return queryDefineEntitySchemas(db, repoId)

    const entityNodeIds = entityNodes.map(e => e.nodeId)
    const propertyMap = await queryEntityProperties(db, repoId, entityNodeIds, repo?.repoPath ?? null)
    const relationMap = await queryEntityRelations(db, repoId, entityNodeIds, repo?.repoPath ?? null)

    return buildModelRaws(entityNodes, propertyMap, relationMap)
  }
}

async function queryDefineEntitySchemas(db: DB, repoId: string): Promise<ModelRaw[]> {
  const repo = db
    .select({ repoPath: repositories.repoPath })
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .get()
  if (!repo?.repoPath) return []

  const files = fg.sync([
    '**/*.{ts,js}',
    'src/**/*.entity.{ts,js}',
    'src/entities/**/*.{ts,js}',
    'app/entities/**/*.{ts,js}',
  ], {
    cwd: repo.repoPath,
    onlyFiles: true,
    unique: true,
    dot: false,
    ignore: ['node_modules/**', 'dist/**', 'build/**', 'stages/**'],
  })

  const models: ModelRaw[] = []
  for (const file of files) {
    const content = readFileSync(resolve(repo.repoPath, file), 'utf-8')
    models.push(...parseDefineEntityFile(file, content))
  }

  return models
}

function parseDefineEntityFile(filePath: string, content: string): ModelRaw[] {
  const models: ModelRaw[] = []
  const defineRe = /\bdefineEntity\s*\(/g
  for (const match of content.matchAll(defineRe)) {
    const openParen = content.indexOf('(', match.index)
    const objectStart = content.indexOf('{', openParen)
    if (objectStart === -1) continue
    const objectEnd = findMatchingBrace(content, objectStart)
    if (objectEnd === -1) continue
    const objectSource = content.slice(objectStart, objectEnd + 1)
    if (/\babstract\s*:\s*true\b/.test(objectSource)) continue

    const name = extractStringProperty(objectSource, 'name')
    if (!name) continue

    const propertiesSource = extractObjectProperty(objectSource, 'properties')
    const { fields, relations } = propertiesSource
      ? parseDefineEntityProperties(content, propertiesSource.source, objectStart + propertiesSource.start)
      : { fields: [] as ModelField[], relations: [] as ModelRelation[] }

    models.push({
      name,
      table_name: toSnakeCasePlural(name),
      comment: '',
      fields,
      relations,
      source_file: filePath,
      line_start: lineNumberAt(content, match.index ?? 0),
      line_end: lineNumberAt(content, objectEnd),
      is_deprecated: false,
    })
  }
  return models
}

function parseDefineEntityProperties(
  fullSource: string,
  propertiesSource: string,
  propertiesStart: number,
): { fields: ModelField[]; relations: ModelRelation[] } {
  const fields: ModelField[] = []
  const relations: ModelRelation[] = []
  const propRe = /([A-Za-z_$][\w$]*)\s*:\s*([^,\n]+(?:\([^)]*\)[^,\n]*)?)/g

  for (const match of propertiesSource.matchAll(propRe)) {
    const name = match[1]
    const expr = match[2].trim()
    const line = lineNumberAt(fullSource, propertiesStart + (match.index ?? 0))
    const relationMatch = expr.match(/p\.(oneToMany|manyToOne|oneToOne|manyToMany)\s*\(\s*([A-Za-z_$][\w$]*)/)
    if (relationMatch) {
      relations.push({
        name,
        target_model: relationMatch[2],
        type: relationMatch[1] as ModelRelation['type'],
        line,
      })
      continue
    }

    const fieldType = expr.match(/p\.([A-Za-z_$][\w$]*)\s*\(/)?.[1]
    if (!fieldType) continue
    fields.push({
      name,
      type: mapDefineEntityType(fieldType),
      nullable: /\.nullable\s*\(/.test(expr),
      primary: /\.primary\s*\(/.test(expr),
      unique: /\.unique\s*\(/.test(expr),
      line,
    })
  }

  return { fields, relations }
}

function mapDefineEntityType(type: string): string {
  switch (type) {
    case 'string': return 'String'
    case 'integer': return 'Int'
    case 'boolean': return 'Boolean'
    case 'datetime': return 'DateTime'
    case 'array': return 'Json'
    default: return TYPE_MAP[type.toLowerCase()] ?? 'Json'
  }
}

function extractStringProperty(source: string, key: string): string | null {
  const match = source.match(new RegExp(`\\b${key}\\s*:\\s*(['"])(.*?)\\1`))
  return match?.[2] ?? null
}

function extractObjectProperty(source: string, key: string): { source: string; start: number } | null {
  const keyMatch = new RegExp(`\\b${key}\\s*:`).exec(source)
  if (!keyMatch) return null
  const objectStart = source.indexOf('{', keyMatch.index)
  if (objectStart === -1) return null
  const objectEnd = findMatchingBrace(source, objectStart)
  if (objectEnd === -1) return null
  return {
    source: source.slice(objectStart + 1, objectEnd),
    start: objectStart + 1,
  }
}

function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i]
    const prev = source[i - 1]
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

// ─── 쿼리 함수들 ─────────────────────────────────────────────────────────────

async function queryEntityClasses(db: DB, repoId: string): Promise<EntityRow[]> {
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
        inArray(codeEdges.targetSymbol as Parameters<typeof inArray>[0], ['Entity']),
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

async function queryEntityProperties(
  db: DB,
  repoId: string,
  entityNodeIds: string[],
  repoPath: string | null,
): Promise<Map<string, PropertyRow[]>> {
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

  const columnPropIds = [...new Set(decEdges.map(e => e.sourceId))]

  const propNodes = db
    .select({
      id: codeNodes.id,
      name: codeNodes.name,
      filePath: codeNodes.filePath,
      signature: codeNodes.signature,
      lineStart: codeNodes.lineStart,
    })
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
      sourceLine: readSourceLine(repoPath, propNode.filePath, propNode.lineStart),
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

function readSourceLine(repoPath: string | null, filePath: string | null, lineStart: number | null): string | null {
  if (!repoPath || !filePath || !lineStart) return null
  try {
    return readFileSync(resolve(repoPath, filePath), 'utf-8')
      .split(/\r?\n/)
      .slice(lineStart - 1, lineStart + 3)
      .map(line => line.trim())
      .join(' ')
  } catch {
    return null
  }
}

async function queryEntityRelations(
  db: DB,
  repoId: string,
  entityNodeIds: string[],
  repoPath: string | null,
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

  const propNodes = db
    .select({
      id: codeNodes.id,
      name: codeNodes.name,
      filePath: codeNodes.filePath,
      lineStart: codeNodes.lineStart,
      signature: codeNodes.signature,
    })
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
  const typeRefEdges = db
    .select({
      sourceId: codeEdges.sourceId,
      targetId: codeEdges.targetId,
      targetSymbol: codeEdges.targetSymbol,
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

  const typeRefTargetByProp = new Map<string, string>()
  for (const edge of typeRefEdges) {
    if (!edge.targetSymbol) continue
    if (!/^[A-Z][A-Za-z0-9_$]*$/.test(edge.targetSymbol)) continue
    if (['Array', 'Collection', 'Ref', 'Promise'].includes(edge.targetSymbol)) continue
    if (!typeRefTargetByProp.has(edge.sourceId)) {
      typeRefTargetByProp.set(edge.sourceId, edge.targetSymbol)
    }
  }

  const result = new Map<string, RelationRow[]>()

  for (const relEdge of relDecEdges) {
    const propNode = propNodeMap.get(relEdge.sourceId)
    if (!propNode) continue

    const entityNodeId = entityForProp.get(relEdge.sourceId)
    if (!entityNodeId) continue

    const row: RelationRow = {
      propName: nameForProp.get(relEdge.sourceId) ?? propNode.name,
      lineStart: propNode.lineStart,
      entityNodeId,
      decoratorName: relEdge.targetSymbol ?? '',
      firstArg: relEdge.firstArg,
      typeRefTarget: typeRefTargetByProp.get(relEdge.sourceId) ?? null,
      signature: propNode.signature,
      sourceLine: readSourceLine(repoPath, propNode.filePath, propNode.lineStart),
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

function buildFields(rows: PropertyRow[]): ModelField[] {
  const seen = new Set<string>()
  const fields: ModelField[] = []

  for (const row of rows) {
    if (seen.has(row.propId)) continue
    seen.add(row.propId)

    // @PrimaryKey → primary=true
    // @SerializedPrimaryKey → primary=false (내부용 직렬화 키)
    const isPrimary = row.decoratorName === 'PrimaryKey'

    const field: ModelField = {
      name: row.fieldName,
      type: extractColumnType(row.decoratorName, row.firstArg, row.signature ?? row.sourceLine),
      nullable: isNullableColumn(row.decoratorName, row.firstArg),
      primary: isPrimary,
      unique: isUniqueColumn(row.firstArg),
      line: row.lineStart ?? 0,
    }

    const defaultVal = hasDefaultValue(row.firstArg)
    if (defaultVal !== undefined) field.default = defaultVal

    fields.push(field)
  }

  return fields
}

function buildRelations(rows: RelationRow[]): ModelRelation[] {
  return rows.map(row => {
    const targetModel = extractRelationTarget(row.firstArg, row.typeRefTarget, row.signature, row.sourceLine)
    if (targetModel === 'unknown') {
      console.warn(`MikroOrmGraphAdapter: failed to parse lambda target for '${row.propName}', defaulting to 'unknown'`)
    }

    const relType = resolveRelationType(row.decoratorName)

    const relation: ModelRelation = {
      name: row.propName,
      target_model: targetModel,
      type: relType,
      line: row.lineStart ?? 0,
    }

    return relation
  })
}

function resolveRelationType(decoratorName: string): ModelRelation['type'] {
  switch (decoratorName) {
    case 'ManyToOne': return 'manyToOne'
    case 'OneToMany': return 'oneToMany'
    case 'OneToOne': return 'oneToOne'
    case 'ManyToMany': return 'manyToMany'
    default: return 'manyToOne'
  }
}
