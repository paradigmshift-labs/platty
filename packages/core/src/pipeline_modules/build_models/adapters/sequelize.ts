import type {
  BuildModelsAdapter,
  ModelRaw, ModelField, ModelRelation,
  SchemaFile, SchemaChunk, ParseContext,
} from '../types.js'
import { PipelineError } from '@/infra/errors.js'

// ─── native tree-sitter 인터페이스 (CJS interop) ─────────────────────────────

interface TSNode {
  type: string
  text: string
  childCount: number
  namedChildCount: number
  startPosition: { row: number; column: number }
  endPosition: { row: number; column: number }
  parent: TSNode | null
  child(i: number): TSNode | null
  namedChild(i: number): TSNode | null
  childForFieldName(field: string): TSNode | null
}

interface TSTree {
  rootNode: TSNode
}

interface NativeParser {
  parse(input: string): TSTree
  setLanguage(lang: unknown): void
}

// ─── 상수 ────────────────────────────────────────────────────────────────────

/**
 * DataTypes.XXX → 정규화 타입 매핑
 */
const DATATYPE_MAP: Record<string, string> = {
  // String
  STRING: 'String',
  TEXT: 'String',
  CITEXT: 'String',
  CHAR: 'String',
  TSVECTOR: 'String',
  UUID: 'String',
  BLOB: 'String',
  // Int
  INTEGER: 'Int',
  BIGINT: 'Int',
  SMALLINT: 'Int',
  MEDIUMINT: 'Int',
  TINYINT: 'Int',
  // Float
  FLOAT: 'Float',
  DOUBLE: 'Float',
  DECIMAL: 'Float',
  REAL: 'Float',
  NUMERIC: 'Float',
  NUMBER: 'Float',
  // Boolean
  BOOLEAN: 'Boolean',
  // DateTime
  DATE: 'DateTime',
  DATEONLY: 'DateTime',
  TIME: 'DateTime',
  // Json
  JSON: 'Json',
  JSONB: 'Json',
  // Special — simplified
  ENUM: 'String',
  ARRAY: 'String',
}

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/**
 * PascalCase 모델명을 소문자 snake_case 테이블명으로 변환
 * 'User' → 'user', 'UserProfile' → 'user_profile'
 */
function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase()
}

function stripQuotes(text: string): string {
  if ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1)
  }
  return text
}

// ─── AST walker ──────────────────────────────────────────────────────────────

function walkNode(node: TSNode, visitor: (n: TSNode) => void): void {
  visitor(node)
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child) walkNode(child, visitor)
  }
}

// ─── DataTypes 타입 추출 ──────────────────────────────────────────────────────

/**
 * DataTypes.STRING / DataTypes.STRING(100) / DataTypes.ARRAY(DataTypes.STRING) 등
 * 노드에서 DataTypes 타입명 추출
 *
 * 지원 패턴:
 * - member_expression: DataTypes.STRING
 * - call_expression: DataTypes.STRING(100) or DataTypes.ARRAY(DataTypes.STRING)
 */
function extractDataType(valueNode: TSNode): string {
  if (valueNode.type === 'member_expression') {
    // DataTypes.STRING
    const prop = valueNode.childForFieldName('property')
    if (prop) {
      const dtKey = prop.text.toUpperCase()
      return DATATYPE_MAP[dtKey] ?? 'unknown'
    }
  }

  if (valueNode.type === 'call_expression') {
    const fn = valueNode.childForFieldName('function')
    if (fn && fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) {
        const dtKey = prop.text.toUpperCase()
        return DATATYPE_MAP[dtKey] ?? 'unknown'
      }
    }
  }

  return 'unknown'
}

// ─── 필드 객체 파싱 ──────────────────────────────────────────────────────────

/**
 * Sequelize 필드 정의 object를 파싱하여 ModelField[] 반환
 *
 * 패턴:
 *   name: DataTypes.STRING                 (member_expression)
 *   name: DataTypes.STRING(100)            (call_expression)
 *   name: { type: DataTypes.STRING, ... }  (object)
 */
function parseFieldsObject(objNode: TSNode): ModelField[] {
  const fields: ModelField[] = []

  for (let i = 0; i < objNode.namedChildCount; i++) {
    const pairNode = objNode.namedChild(i)
    if (!pairNode || pairNode.type !== 'pair') continue

    const keyNode = pairNode.childForFieldName('key')
    const valueNode = pairNode.childForFieldName('value')
    if (!keyNode || !valueNode) continue

    const fieldName = stripQuotes(keyNode.text)

    // 단순 DataTypes: name: DataTypes.STRING or name: DataTypes.STRING(100)
    if (valueNode.type === 'member_expression' || valueNode.type === 'call_expression') {
      const fieldType = extractDataType(valueNode)
      if (fieldType === 'unknown') continue

      fields.push({
        name: fieldName,
        type: fieldType,
        nullable: true,
        primary: false,
        unique: false,
        line: keyNode.startPosition.row + 1,
      })
      continue
    }

    // 객체 형식: { type: DataTypes.STRING, allowNull: false, ... }
    if (valueNode.type === 'object') {
      const field = parseFieldObjectLiteral(fieldName, valueNode, keyNode.startPosition.row + 1)
      if (field) fields.push(field)
      continue
    }
  }

  return fields
}

/**
 * { type: DataTypes.STRING, allowNull: false, primaryKey: true, ... } 파싱
 */
function parseFieldObjectLiteral(
  fieldName: string,
  objNode: TSNode,
  line: number,
): ModelField | null {
  let fieldType = 'unknown'
  let nullable = true
  let primary = false
  let unique = false
  let defaultVal: string | undefined

  for (let i = 0; i < objNode.namedChildCount; i++) {
    const pairNode = objNode.namedChild(i)
    if (!pairNode || pairNode.type !== 'pair') continue

    const keyNode = pairNode.childForFieldName('key')
    const valNode = pairNode.childForFieldName('value')
    if (!keyNode || !valNode) continue

    const key = stripQuotes(keyNode.text)

    switch (key) {
      case 'type': {
        fieldType = extractDataType(valNode)
        break
      }
      case 'allowNull': {
        // allowNull: false → nullable: false
        if (valNode.text === 'false') nullable = false
        break
      }
      case 'primaryKey': {
        if (valNode.text === 'true') {
          primary = true
          nullable = false
        }
        break
      }
      case 'autoIncrement': {
        if (valNode.text === 'true') {
          primary = true
          nullable = false
        }
        break
      }
      case 'unique': {
        if (valNode.text === 'true') unique = true
        break
      }
      case 'defaultValue': {
        defaultVal = stripQuotes(valNode.text)
        break
      }
    }
  }

  if (fieldType === 'unknown') return null

  const field: ModelField = {
    name: fieldName,
    type: fieldType,
    nullable,
    primary,
    unique,
    line,
  }
  if (defaultVal !== undefined) field.default = defaultVal
  return field
}

// ─── tableName 옵션 추출 ──────────────────────────────────────────────────────

/**
 * options 객체에서 tableName 값 추출
 * { tableName: 'users', ... } → 'users'
 */
function extractTableNameFromOptions(optionsNode: TSNode): string | null {
  if (optionsNode.type !== 'object') return null

  for (let i = 0; i < optionsNode.namedChildCount; i++) {
    const pairNode = optionsNode.namedChild(i)
    if (!pairNode || pairNode.type !== 'pair') continue

    const keyNode = pairNode.childForFieldName('key')
    const valNode = pairNode.childForFieldName('value')
    if (!keyNode || !valNode) continue

    if (stripQuotes(keyNode.text) === 'tableName') {
      return stripQuotes(valNode.text)
    }
  }

  return null
}

function extractTableNameFromTextOptions(optionsText: string): string | null {
  const match = optionsText.match(/\btableName\s*:\s*(['"`])([^'"`]+)\1/)
  return match?.[2] ?? null
}

function lineNumberAt(content: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset; i++) {
    if (content.charCodeAt(i) === 10) line++
  }
  return line
}

function extractOptionString(optionsText: string, key: string): string | undefined {
  const re = new RegExp(`\\b${key}\\s*:\\s*(['"\`])([^'"\`]+)\\1`)
  return re.exec(optionsText)?.[2]
}

function associationType(method: string): ModelRelation['type'] {
  switch (method) {
    case 'hasMany':
      return 'oneToMany'
    case 'belongsTo':
      return 'manyToOne'
    case 'belongsToMany':
      return 'manyToMany'
    case 'hasOne':
    default:
      return 'oneToOne'
  }
}

function findMatchingBrace(content: string, openBrace: number): number {
  let depth = 0
  for (let i = openBrace; i < content.length; i++) {
    const ch = content[i]
    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function resolveTextDataType(text: string): string {
  const match = text.match(/\bDataTypes?\s*\.\s*([A-Za-z_][\w]*)/)
  if (match) {
    return DATATYPE_MAP[match[1].toUpperCase()] ?? 'unknown'
  }
  return 'unknown'
}

function resolveTsFieldType(tsType: string): string {
  const clean = tsType.replace(/\[\]$/, '').replace(/^Array<(.+)>$/, '$1').trim()
  if (clean === 'string') return 'String'
  if (clean === 'number') return 'Float'
  if (clean === 'boolean') return 'Boolean'
  if (clean === 'Date') return 'DateTime'
  return 'unknown'
}

function parseColumnDecoratorField(
  content: string,
  fieldName: string,
  tsType: string,
  decoratorArg: string,
  offset: number,
): ModelField | null {
  const fieldType = resolveTextDataType(decoratorArg) !== 'unknown'
    ? resolveTextDataType(decoratorArg)
    : resolveTsFieldType(tsType)
  if (fieldType === 'unknown') return null

  let nullable = true
  let primary = false
  const unique = /\bunique\s*:\s*true\b/.test(decoratorArg)
  let defaultVal: string | undefined

  if (/\ballowNull\s*:\s*false\b/.test(decoratorArg)) nullable = false
  if (/\bprimaryKey\s*:\s*true\b/.test(decoratorArg) || /\bautoIncrement\s*:\s*true\b/.test(decoratorArg)) {
    primary = true
    nullable = false
  }
  const defaultMatch = decoratorArg.match(/\bdefaultValue\s*:\s*([^,}\n]+)/)
  if (defaultMatch) defaultVal = stripQuotes(defaultMatch[1].trim())

  const field: ModelField = {
    name: fieldName,
    type: fieldType,
    nullable,
    primary,
    unique,
    line: lineNumberAt(content, offset),
  }
  if (defaultVal !== undefined) field.default = defaultVal
  return field
}

function parseSequelizeTypescriptModels(content: string, filePath: string): ModelRaw[] {
  const models: ModelRaw[] = []
  const classRe = /@Table(?:\s*\(([\s\S]*?)\))?\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)[^{]*{/g
  let match: RegExpExecArray | null

  while ((match = classRe.exec(content)) !== null) {
    const optionsText = match[1] ?? ''
    const modelName = match[2]
    const openBrace = match.index + match[0].length - 1
    const closeBrace = findMatchingBrace(content, openBrace)
    if (closeBrace < 0) continue

    const body = content.slice(openBrace + 1, closeBrace)
    const bodyOffset = openBrace + 1
    const fields: ModelField[] = []
    const columnRe = /@Column(?:\s*\(([\s\S]*?)\))?\s*(?:public\s+|private\s+|protected\s+|readonly\s+)*([A-Za-z_$][\w$]*)[!?]?\s*:\s*([^;=\n]+)/g
    let columnMatch: RegExpExecArray | null
    while ((columnMatch = columnRe.exec(body)) !== null) {
      const field = parseColumnDecoratorField(
        content,
        columnMatch[2],
        columnMatch[3].trim(),
        columnMatch[1] ?? '',
        bodyOffset + columnMatch.index,
      )
      if (field) fields.push(field)
    }

    models.push({
      name: modelName,
      table_name: extractTableNameFromTextOptions(optionsText) ?? toSnakeCase(modelName),
      comment: '',
      fields,
      relations: [],
      source_file: filePath,
      line_start: lineNumberAt(content, match.index),
      line_end: lineNumberAt(content, closeBrace),
      is_deprecated: false,
    })
  }

  return models
}

// ─── 패턴 A: sequelize.define() ──────────────────────────────────────────────

/**
 * sequelize.define('ModelName', { fields }, { options }) 패턴 파싱
 */
function parseDefineCall(
  callNode: TSNode,
  filePath: string,
): ModelRaw | null {
  const fnNode = callNode.childForFieldName('function')
  if (!fnNode || fnNode.type !== 'member_expression') return null

  const methodProp = fnNode.childForFieldName('property')
  if (!methodProp || methodProp.text !== 'define') return null

  const argsNode = callNode.childForFieldName('arguments')
  if (!argsNode) return null

  // 첫 번째 인자: string literal → 모델명
  let modelName: string | null = null
  let fieldsNode: TSNode | null = null
  let optionsNode: TSNode | null = null

  let argIdx = 0
  for (let i = 0; i < argsNode.namedChildCount; i++) {
    const arg = argsNode.namedChild(i)
    if (!arg) continue

    if (argIdx === 0) {
      if (arg.type === 'string') {
        modelName = stripQuotes(arg.text)
      } else {
        return null // 첫 인자가 string이 아니면 패턴 불일치
      }
    } else if (argIdx === 1) {
      if (arg.type === 'object') {
        fieldsNode = arg
      }
    } else if (argIdx === 2) {
      if (arg.type === 'object') {
        optionsNode = arg
      }
    }
    argIdx++
  }

  if (!modelName) return null

  const tableName = optionsNode ? (extractTableNameFromOptions(optionsNode) ?? toSnakeCase(modelName)) : toSnakeCase(modelName)
  const fields = fieldsNode ? parseFieldsObject(fieldsNode) : []

  const declNode = callNode.parent?.parent ?? callNode.parent ?? callNode
  return {
    name: modelName,
    table_name: tableName,
    comment: '',
    fields,
    relations: [],
    source_file: filePath,
    line_start: declNode.startPosition.row + 1,
    line_end: declNode.endPosition.row + 1,
    is_deprecated: false,
  }
}

// ─── 패턴 B: ModelClass.init() ───────────────────────────────────────────────

/**
 * ClassName.init({ fields }, { options }) 패턴 파싱
 *
 * call_expressionの function が member_expression で、
 * property が 'init' かつ object が identifier (クラス名) である
 */
function parseInitCall(
  callNode: TSNode,
  filePath: string,
): ModelRaw | null {
  const fnNode = callNode.childForFieldName('function')
  if (!fnNode || fnNode.type !== 'member_expression') return null

  const methodProp = fnNode.childForFieldName('property')
  if (!methodProp || methodProp.text !== 'init') return null

  const objectNode = fnNode.childForFieldName('object')
  if (!objectNode || objectNode.type !== 'identifier') return null

  const modelName = objectNode.text

  const argsNode = callNode.childForFieldName('arguments')
  if (!argsNode) return null

  let fieldsNode: TSNode | null = null
  let optionsNode: TSNode | null = null

  let argIdx = 0
  for (let i = 0; i < argsNode.namedChildCount; i++) {
    const arg = argsNode.namedChild(i)
    if (!arg) continue

    if (argIdx === 0) {
      if (arg.type === 'object') fieldsNode = arg
    } else if (argIdx === 1) {
      if (arg.type === 'object') optionsNode = arg
    }
    argIdx++
  }

  const tableName = optionsNode ? (extractTableNameFromOptions(optionsNode) ?? toSnakeCase(modelName)) : toSnakeCase(modelName)
  const fields = fieldsNode ? parseFieldsObject(fieldsNode) : []

  const declNode = callNode.parent?.parent ?? callNode.parent ?? callNode
  return {
    name: modelName,
    table_name: tableName,
    comment: '',
    fields,
    relations: [],
    source_file: filePath,
    line_start: declNode.startPosition.row + 1,
    line_end: declNode.endPosition.row + 1,
    is_deprecated: false,
  }
}

// ─── 전체 파일 파싱 ───────────────────────────────────────────────────────────

function parseSequelizeModels(rootNode: TSNode, filePath: string): ModelRaw[] {
  const models: ModelRaw[] = []
  // 모델명 중복 방지 (define과 init 양쪽에서 같은 모델이 두 번 감지될 경우 대비)
  const seenNames = new Set<string>()

  walkNode(rootNode, node => {
    if (node.type !== 'call_expression') return

    // 패턴 A: sequelize.define()
    const defineModel = parseDefineCall(node, filePath)
    if (defineModel && !seenNames.has(defineModel.name)) {
      seenNames.add(defineModel.name)
      models.push(defineModel)
      return
    }

    // 패턴 B: ClassName.init()
    const initModel = parseInitCall(node, filePath)
    if (initModel && !seenNames.has(initModel.name)) {
      seenNames.add(initModel.name)
      models.push(initModel)
    }
  })

  return models
}

function parseAllSequelizeModels(rootNode: TSNode, content: string, filePath: string): ModelRaw[] {
  const modelMap = new Map<string, ModelRaw>()
  for (const model of parseSequelizeModels(rootNode, filePath)) {
    modelMap.set(model.name, model)
  }
  for (const model of parseSequelizeTypescriptModels(content, filePath)) {
    if (!modelMap.has(model.name)) modelMap.set(model.name, model)
  }
  return [...modelMap.values()]
}

function collectSequelizeAssociations(files: SchemaFile[]): Map<string, ModelRelation[]> {
  const out = new Map<string, ModelRelation[]>()
  const associationRe = /\b([A-Za-z_$][\w$]*)\s*\.\s*(hasMany|belongsTo|hasOne|belongsToMany)\s*\(\s*([A-Za-z_$][\w$]*)(?:\s*,\s*(\{[\s\S]*?\}))?\s*\)/g

  for (const file of files) {
    let match: RegExpExecArray | null
    while ((match = associationRe.exec(file.content)) !== null) {
      const sourceModel = match[1]
      const method = match[2]
      const targetModel = match[3]
      const optionsText = match[4] ?? ''
      const name = extractOptionString(optionsText, 'as') ?? targetModel
      const foreignKey = extractOptionString(optionsText, 'foreignKey')
      const relation: ModelRelation = {
        name,
        target_model: targetModel,
        type: associationType(method),
        line: lineNumberAt(file.content, match.index),
      }
      if (foreignKey) relation.fk_fields = [foreignKey]

      const current = out.get(sourceModel) ?? []
      current.push(relation)
      out.set(sourceModel, current)
    }
  }

  return out
}

// ─── SequelizeAdapter ─────────────────────────────────────────────────────────

export class SequelizeAdapter implements BuildModelsAdapter {
  readonly orm = 'sequelize'
  readonly strategy = 'dsl-parse' as const

  private static _parser: NativeParser | null = null

  static async ensureParser(): Promise<NativeParser> {
    if (SequelizeAdapter._parser) return SequelizeAdapter._parser
    try {
      const { createRequire } = await import('module')
      const req = createRequire(import.meta.url)
      const TreeSitter = req('tree-sitter') as new () => NativeParser
      const tsLangs = req('tree-sitter-typescript') as { typescript: unknown; tsx: unknown }
      const parser = new TreeSitter()
      parser.setLanguage(tsLangs.typescript)
      SequelizeAdapter._parser = parser
      return parser
    } catch (err) {
      throw new PipelineError('Failed to initialize tree-sitter-typescript parser', 'ANALYSIS_FAILED', { cause: err })
    }
  }

  async ensureReady(): Promise<void> {
    await SequelizeAdapter.ensureParser()
  }

  collectNames(files: SchemaFile[]): ParseContext {
    const modelNames = new Set<string>()
    const parser = SequelizeAdapter._parser
    if (!parser) return { enumNames: new Set(), modelNames, compositeTypeNames: new Set() }

    for (const file of files) {
      const tree = parser.parse(file.content)
      for (const model of parseAllSequelizeModels(tree.rootNode, file.content, file.path)) {
        modelNames.add(model.name)
      }
    }
    return { enumNames: new Set(), modelNames, compositeTypeNames: new Set() }
  }

  prepareChunks(files: SchemaFile[]): SchemaChunk[] {
    return [{ files, orm: this.orm }]
  }

  async parseChunk(chunk: SchemaChunk, _ctx: ParseContext): Promise<ModelRaw[]> {
    const parser = await SequelizeAdapter.ensureParser()
    const modelMap = new Map<string, ModelRaw>()

    for (const file of chunk.files) {
      const tree = parser.parse(file.content)
      for (const model of parseAllSequelizeModels(tree.rootNode, file.content, file.path)) {
        // 파일 순서대로 처리, 같은 모델명은 첫 번째 선언 우선
        if (!modelMap.has(model.name)) {
          modelMap.set(model.name, model)
        }
      }
    }

    const relations = collectSequelizeAssociations(chunk.files)
    for (const [modelName, modelRelations] of relations.entries()) {
      const model = modelMap.get(modelName)
      if (!model) continue
      const seen = new Set(model.relations.map((relation) => `${relation.type}:${relation.target_model}:${relation.name}`))
      for (const relation of modelRelations) {
        const key = `${relation.type}:${relation.target_model}:${relation.name}`
        if (seen.has(key)) continue
        seen.add(key)
        model.relations.push(relation)
      }
    }

    return [...modelMap.values()]
  }
}
