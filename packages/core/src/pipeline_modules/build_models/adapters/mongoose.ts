import type {
  BuildModelsAdapter,
  ModelRaw, ModelField,
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

// ─── 타입 매핑 ───────────────────────────────────────────────────────────────

const TYPE_MAP: Record<string, string> = {
  String: 'String',
  Number: 'Float',
  Boolean: 'Boolean',
  Date: 'DateTime',
  Buffer: 'String',
  Mixed: 'Json',
  Map: 'Json',
  Decimal128: 'Float',
  ObjectId: 'String',
}

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function stripQuotes(text: string): string {
  if ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1)
  }
  return text
}

function walkNode(node: TSNode, visitor: (n: TSNode) => void): void {
  visitor(node)
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child) walkNode(child, visitor)
  }
}

/**
 * Mongoose 타입 identifier → 정규화 타입 문자열 반환
 * - `String` → 'String'
 * - `Schema.Types.ObjectId` → 'String'
 * - `mongoose.Types.ObjectId` → 'String'
 * - `mongoose.Schema.Types.Mixed` → 'Json'
 * - `Schema.Types.Mixed` → 'Json'
 * - `Schema.Types.Decimal128` → 'Float'
 */
function resolveTypeIdentifier(node: TSNode): string | null {
  if (node.type === 'identifier') {
    return TYPE_MAP[node.text] ?? null
  }
  if (node.type === 'member_expression') {
    // Schema.Types.ObjectId, Schema.Types.Mixed, Schema.Types.Decimal128
    // mongoose.Schema.Types.ObjectId, mongoose.Types.ObjectId
    const text = node.text
    if (text.includes('ObjectId')) return 'String'
    if (text.includes('Mixed')) return 'Json'
    if (text.includes('Decimal128')) return 'Float'
    if (text.includes('Buffer')) return 'String'
    if (text.includes('String')) return 'String'
    if (text.includes('Number')) return 'Float'
    if (text.includes('Boolean')) return 'Boolean'
    if (text.includes('Date')) return 'DateTime'
  }
  return null
}

/**
 * 배열 노드([...])에서 요소 타입 추출
 * [String] → 'String', [{ type: String }] → 'String'
 */
function resolveArrayType(arrayNode: TSNode): string | null {
  if (arrayNode.type !== 'array') return null
  for (let i = 0; i < arrayNode.namedChildCount; i++) {
    const elem = arrayNode.namedChild(i)
    if (!elem) continue
    if (elem.type === 'identifier' || elem.type === 'member_expression') {
      return resolveTypeIdentifier(elem)
    }
    if (elem.type === 'object') {
      return resolveTypeFromObject(elem)
    }
  }
  return null
}

/**
 * { type: X, required: true, unique: true, default: Y, ref: Z } 파싱
 */
interface FieldOptions {
  type?: string
  nullable?: boolean
  unique?: boolean
  default?: string
}

function resolveTypeFromObject(objNode: TSNode): string | null {
  const opts = parseFieldObject(objNode)
  return opts.type ?? null
}

function parseFieldObject(objNode: TSNode): FieldOptions {
  const result: FieldOptions = {}

  for (let i = 0; i < objNode.namedChildCount; i++) {
    const pair = objNode.namedChild(i)
    if (!pair || pair.type !== 'pair') continue
    const keyNode = pair.childForFieldName('key')
    const valNode = pair.childForFieldName('value')
    if (!keyNode || !valNode) continue

    const key = keyNode.text === 'type' ? 'type'
      : keyNode.text === 'required' ? 'required'
      : keyNode.text === 'unique' ? 'unique'
      : keyNode.text === 'default' ? 'default'
      : null

    if (!key) continue

    if (key === 'type') {
      // type: String | type: [String] | type: Schema.Types.ObjectId
      if (valNode.type === 'identifier' || valNode.type === 'member_expression') {
        const t = resolveTypeIdentifier(valNode)
        if (t) result.type = t
      } else if (valNode.type === 'array') {
        const t = resolveArrayType(valNode)
        if (t) result.type = t
      }
    } else if (key === 'required') {
      // required: true → nullable: false
      if (valNode.text === 'true') result.nullable = false
    } else if (key === 'unique') {
      if (valNode.text === 'true') result.unique = true
    } else if (key === 'default') {
      if (valNode.type === 'string') {
        result.default = stripQuotes(valNode.text)
      } else if (valNode.type !== 'member_expression' && valNode.type !== 'call_expression') {
        // number, boolean literal, identifier (e.g. Date.now is call/member — skip)
        result.default = valNode.text
      }
    }
  }

  return result
}

// ─── pass 1: new Schema({...}) 변수명 수집 ────────────────────────────────────

interface SchemaEntry {
  fieldsNode: TSNode
  lineStart: number
  lineEnd: number
  exported: boolean
}

interface TextModelEntry {
  name: string
  fields: ModelField[]
  lineStart: number
  lineEnd: number
}

function collectSchemaVars(rootNode: TSNode, out: Map<string, SchemaEntry>): void {
  walkNode(rootNode, node => {
    if (node.type !== 'variable_declarator') return

    const nameNode = node.childForFieldName('name')
    const valueNode = node.childForFieldName('value')
    if (!nameNode || !valueNode) return
    if (valueNode.type !== 'new_expression') return

    // new Schema({...}) or new mongoose.Schema({...})
    const constructorNode = valueNode.childForFieldName('constructor')
    if (!constructorNode) return

    const isSchemaCall = (
      (constructorNode.type === 'identifier' && constructorNode.text === 'Schema') ||
      (constructorNode.type === 'member_expression' && constructorNode.text.endsWith('.Schema'))
    )
    if (!isSchemaCall) return

    // 생성자 arguments 찾기
    const argsNode = valueNode.childForFieldName('arguments')
    if (!argsNode) return

    // 첫 번째 object argument가 fields 정의
    let fieldsNode: TSNode | null = null
    for (let i = 0; i < argsNode.namedChildCount; i++) {
      const child = argsNode.namedChild(i)
      if (child?.type === 'object') {
        fieldsNode = child
        break
      }
    }
    if (!fieldsNode) return

    const declNode = node.parent
    out.set(nameNode.text, {
      fieldsNode,
      lineStart: (declNode ?? node).startPosition.row + 1,
      lineEnd: (declNode ?? node).endPosition.row + 1,
      exported: isExportedDeclaration(node),
    })
  })
}

function isExportedDeclaration(node: TSNode): boolean {
  let current: TSNode | null = node.parent
  while (current) {
    if (current.type === 'export_statement') return true
    if (current.type === 'program') return false
    current = current.parent
  }
  return false
}

// ─── pass 2: model('Name', schemaVar) 수집 ────────────────────────────────────

function collectModelBindings(rootNode: TSNode, out: Map<string, string>): void {
  walkNode(rootNode, node => {
    // call_expression: model(...) or mongoose.model(...)
    if (node.type !== 'call_expression') return

    const fnNode = node.childForFieldName('function')
    if (!fnNode) return

    const isModelCall = (
      (fnNode.type === 'identifier' && fnNode.text === 'model') ||
      (fnNode.type === 'member_expression' && fnNode.childForFieldName('property')?.text === 'model')
    )
    if (!isModelCall) return

    const argsNode = node.childForFieldName('arguments')
    if (!argsNode) return

    // 첫 번째 인자: 모델명 문자열
    // 두 번째 인자: schema 변수 identifier
    let modelName: string | null = null
    let schemaVarName: string | null = null

    for (let i = 0; i < argsNode.namedChildCount; i++) {
      const child = argsNode.namedChild(i)
      if (!child) continue

      if (i === 0 && child.type === 'string') {
        modelName = stripQuotes(child.text)
      } else if (i === 1 && child.type === 'identifier') {
        schemaVarName = child.text
      }
    }

    if (modelName && schemaVarName) {
      out.set(schemaVarName, modelName)
    }
  })
}

// ─── pass 3: fields Object 파싱 ───────────────────────────────────────────────

function parseSchemaFields(fieldsNode: TSNode): ModelField[] {
  const fields: ModelField[] = []

  for (let i = 0; i < fieldsNode.namedChildCount; i++) {
    const pair = fieldsNode.namedChild(i)
    if (!pair || pair.type !== 'pair') continue

    const keyNode = pair.childForFieldName('key')
    const valNode = pair.childForFieldName('value')
    if (!keyNode || !valNode) continue

    const fieldName = stripQuotes(keyNode.text)
    const line = keyNode.startPosition.row + 1

    let fieldType: string | null = null
    let nullable = true
    let unique = false
    let defaultVal: string | undefined

    if (valNode.type === 'identifier' || valNode.type === 'member_expression') {
      // name: String  /  createdAt: Date  /  ref: Schema.Types.ObjectId
      fieldType = resolveTypeIdentifier(valNode)
    } else if (valNode.type === 'array') {
      // tags: [String]  /  items: [{ type: String }]
      fieldType = resolveArrayType(valNode)
    } else if (valNode.type === 'object') {
      // { type: String, required: true, default: 'admin' }
      const opts = parseFieldObject(valNode)
      fieldType = opts.type ?? null
      if (opts.nullable !== undefined) nullable = opts.nullable
      if (opts.unique !== undefined) unique = opts.unique
      if (opts.default !== undefined) defaultVal = opts.default
    }

    if (!fieldType) continue

    const field: ModelField = {
      name: fieldName,
      type: fieldType,
      nullable,
      primary: false,
      unique,
      line,
    }
    if (defaultVal !== undefined) field.default = defaultVal

    fields.push(field)
  }

  return fields
}

function collectNestSchemaFactoryNames(content: string): Set<string> {
  const out = new Set<string>()
  const re = /SchemaFactory\s*\.\s*createForClass\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    out.add(match[1])
  }
  return out
}

function parseNestMongooseModels(content: string): TextModelEntry[] {
  const factoryNames = collectNestSchemaFactoryNames(content)
  const out: TextModelEntry[] = []
  const classRe = /@Schema(?:\s*\([^)]*\))?\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)[^{]*{/g
  let match: RegExpExecArray | null

  while ((match = classRe.exec(content)) !== null) {
    const name = match[1]
    if (factoryNames.size > 0 && !factoryNames.has(name)) continue

    const openBrace = match.index + match[0].length - 1
    if (openBrace < 0) continue
    const closeBrace = findMatchingBrace(content, openBrace)
    if (closeBrace < 0) continue

    const body = content.slice(openBrace + 1, closeBrace)
    const fields = parseNestPropFields(content, body, openBrace + 1)
    out.push({
      name,
      fields,
      lineStart: lineNumberAt(content, match.index),
      lineEnd: lineNumberAt(content, closeBrace),
    })
  }

  return out
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

function parseNestPropFields(content: string, body: string, bodyOffset: number): ModelField[] {
  const fields: ModelField[] = []
  const propRe = /@Prop(?:\s*\(([\s\S]*?)\))?\s*(?:public\s+|private\s+|protected\s+|readonly\s+)*([A-Za-z_$][\w$]*)[!?]?\s*:\s*([^;=\n]+)/g
  let match: RegExpExecArray | null

  while ((match = propRe.exec(body)) !== null) {
    const optsText = match[1] ?? ''
    const fieldName = match[2]
    const tsType = match[3].trim()
    const fieldType = resolveNestPropType(optsText, tsType)
    if (!fieldType) continue

    const field: ModelField = {
      name: fieldName,
      type: fieldType,
      nullable: !/\brequired\s*:\s*true\b/.test(optsText),
      primary: false,
      unique: /\bunique\s*:\s*true\b/.test(optsText),
      line: lineNumberAt(content, bodyOffset + match.index),
    }
    const defaultVal = extractNestPropDefault(optsText)
    if (defaultVal !== undefined) field.default = defaultVal
    fields.push(field)
  }

  return fields
}

function resolveNestPropType(optsText: string, tsType: string): string | null {
  const typeMatch = optsText.match(/\btype\s*:\s*(?:\[\s*)?(?:\{\s*type\s*:\s*)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/)
  if (typeMatch) {
    const mapped = resolveTypeName(typeMatch[1])
    if (mapped) return mapped
  }

  return resolveTypeName(tsType.replace(/\[\]$/, '').replace(/^Array<(.+)>$/, '$1').trim())
}

function resolveTypeName(typeName: string): string | null {
  if (typeName === 'string') return 'String'
  if (typeName === 'number') return 'Float'
  if (typeName === 'boolean') return 'Boolean'
  if (typeName.includes('ObjectId')) return 'String'
  return TYPE_MAP[typeName] ?? null
}

function extractNestPropDefault(optsText: string): string | undefined {
  const match = optsText.match(/\bdefault\s*:\s*([^,}\n]+)/)
  if (!match) return undefined
  return stripQuotes(match[1].trim())
}

function lineNumberAt(content: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset; i++) {
    if (content.charCodeAt(i) === 10) line++
  }
  return line
}

// ─── MongooseAdapter ──────────────────────────────────────────────────────────

export class MongooseAdapter implements BuildModelsAdapter {
  readonly orm = 'mongoose'
  readonly strategy = 'dsl-parse' as const

  private static _parser: NativeParser | null = null

  static async ensureParser(): Promise<NativeParser> {
    if (MongooseAdapter._parser) return MongooseAdapter._parser
    try {
      const { createRequire } = await import('module')
      const req = createRequire(import.meta.url)
      const TreeSitter = req('tree-sitter') as new () => NativeParser
      const tsLangs = req('tree-sitter-typescript') as { typescript: unknown; tsx: unknown }
      const parser = new TreeSitter()
      parser.setLanguage(tsLangs.typescript)
      MongooseAdapter._parser = parser
      return parser
    } catch (err) {
      throw new PipelineError('Failed to initialize tree-sitter-typescript parser', 'ANALYSIS_FAILED', { cause: err })
    }
  }

  async ensureReady(): Promise<void> {
    await MongooseAdapter.ensureParser()
  }

  collectNames(files: SchemaFile[]): ParseContext {
    const modelNames = new Set<string>()
    const parser = MongooseAdapter._parser
    if (!parser) return { enumNames: new Set(), modelNames, compositeTypeNames: new Set() }

    for (const file of files) {
      const tree = parser.parse(file.content)
      const schemaVars = new Map<string, SchemaEntry>()
      const modelBindings = new Map<string, string>()
      collectSchemaVars(tree.rootNode, schemaVars)
      collectModelBindings(tree.rootNode, modelBindings)
      for (const [schemaVar, modelName] of modelBindings) {
        if (schemaVars.has(schemaVar)) modelNames.add(modelName)
      }
      for (const model of parseNestMongooseModels(file.content)) {
        modelNames.add(model.name)
      }
    }

    return { enumNames: new Set(), modelNames, compositeTypeNames: new Set() }
  }

  prepareChunks(files: SchemaFile[]): SchemaChunk[] {
    return [{ files, orm: this.orm }]
  }

  async parseChunk(chunk: SchemaChunk, _ctx: ParseContext): Promise<ModelRaw[]> {
    const parser = await MongooseAdapter.ensureParser()

    // pass 1 + pass 2: 전체 파일에서 schema vars / model bindings 수집
    const schemaVarMap = new Map<string, SchemaEntry & { filePath: string }>()
    const modelBindingMap = new Map<string, string>() // schemaVarName → modelName
    const nestModels: Array<TextModelEntry & { filePath: string }> = []

    for (const file of chunk.files) {
      const tree = parser.parse(file.content)
      const schemaVars = new Map<string, SchemaEntry>()
      const modelBindings = new Map<string, string>()
      collectSchemaVars(tree.rootNode, schemaVars)
      collectModelBindings(tree.rootNode, modelBindings)

      for (const [varName, entry] of schemaVars) {
        schemaVarMap.set(varName, { ...entry, filePath: file.path })
      }
      for (const [varName, modelName] of modelBindings) {
        modelBindingMap.set(varName, modelName)
      }
      for (const model of parseNestMongooseModels(file.content)) {
        nestModels.push({ ...model, filePath: file.path })
      }
    }

    // pass 3: join → ModelRaw 생성
    const models: ModelRaw[] = []

    for (const [schemaVar, modelName] of modelBindingMap) {
      const entry = schemaVarMap.get(schemaVar)
      if (!entry) continue // schema 없이 model만 있는 경우 건너뜀

      const fields = parseSchemaFields(entry.fieldsNode)
      const tableName = modelName.toLowerCase() + 's'

      models.push({
        name: modelName,
        table_name: tableName,
        comment: '',
        fields,
        relations: [],
        source_file: entry.filePath,
        line_start: entry.lineStart,
        line_end: entry.lineEnd,
        is_deprecated: false,
      })
    }

    for (const [schemaVar, entry] of schemaVarMap) {
      if (modelBindingMap.has(schemaVar)) continue
      if (!/Schema$/.test(schemaVar)) continue
      if (!entry.exported) continue

      const modelName = schemaVar.replace(/Schema$/, '')
      if (!modelName) continue
      const fields = parseSchemaFields(entry.fieldsNode)
      models.push({
        name: modelName,
        table_name: modelName.toLowerCase() + 's',
        comment: '',
        fields,
        relations: [],
        source_file: entry.filePath,
        line_start: entry.lineStart,
        line_end: entry.lineEnd,
        is_deprecated: false,
      })
    }

    for (const model of nestModels) {
      models.push({
        name: model.name,
        table_name: model.name.toLowerCase() + 's',
        comment: '',
        fields: model.fields,
        relations: [],
        source_file: model.filePath,
        line_start: model.lineStart,
        line_end: model.lineEnd,
        is_deprecated: false,
      })
    }

    return models
  }
}
