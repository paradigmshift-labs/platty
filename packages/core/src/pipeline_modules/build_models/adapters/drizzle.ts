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

const TABLE_FUNCTIONS = new Set([
  'pgTable', 'mysqlTable', 'sqliteTable',
  'pgView', 'mysqlView', 'sqliteView',
  'gelTable', 'gelView',
  'singlestoreTable', 'singlestoreView',
])

const TYPE_MAP: Record<string, string> = {
  // String
  text: 'String', varchar: 'String', char: 'String', uuid: 'String',
  inet: 'String', cidr: 'String', macaddr: 'String', macaddr8: 'String',
  bytea: 'String', interval: 'String', point: 'String', line: 'String',
  geometry: 'Json',
  blob: 'String', mysqlVarchar: 'String', pgUuid: 'String',
  binary: 'String', customBinary: 'String', prefixedUlid: 'String',
  varbinary: 'String',
  vector: 'String', bit: 'String', halfvec: 'String', sparsevec: 'String',
  // Int
  integer: 'Int', int: 'Int', int4: 'Int', int2: 'Int',
  smallint: 'Int', bigint: 'Int', int8: 'Int',
  serial: 'Int', serial4: 'Int', bigserial: 'Int', serial8: 'Int',
  smallserial: 'Int', mediumint: 'Int', tinyint: 'Int',
  // Float
  real: 'Float', float: 'Float', float4: 'Float', float8: 'Float',
  doublePrecision: 'Float', numeric: 'Float', decimal: 'Float',
  double: 'Float',
  // Boolean
  boolean: 'Boolean', bool: 'Boolean',
  // DateTime
  timestamp: 'DateTime', timestamptz: 'DateTime',
  date: 'DateTime', time: 'DateTime', timetz: 'DateTime',
  mysqlTimestamp: 'DateTime', datetime: 'DateTime', year: 'DateTime',
  // Json
  json: 'Json', jsonb: 'Json',
}

function inferTypeFromBuilderName(baseFn: string): string | null {
  const lower = baseFn.toLowerCase()
  if (lower.includes('enum')) return 'String'
  if (lower.includes('uuid') || lower.includes('ulid')) return 'String'
  if (lower.includes('serial') || lower.includes('integer') || lower.includes('int')) return 'Int'
  if (lower.includes('float') || lower.includes('double') || lower.includes('decimal') || lower.includes('numeric')) return 'Float'
  if (lower.includes('bool')) return 'Boolean'
  if (lower.includes('timestamp') || lower.includes('datetime') || lower === 'date' || lower.includes('date')) return 'DateTime'
  if (lower.includes('json')) return 'Json'
  if (lower.includes('text') || lower.includes('char') || lower.includes('string')) return 'String'
  return null
}

function resolveColumnType(baseFn: string, columnFactoryTypes: Map<string, string>): string {
  return TYPE_MAP[baseFn]
    ?? inferTypeFromBuilderName(baseFn)
    ?? columnFactoryTypes.get(baseFn)
    ?? (isLikelyEnumColumn(baseFn) ? 'String' : 'unknown')
}

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function toPascalCase(name: string): string {
  if (name.includes('_')) {
    return name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')
  }
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function stripQuotes(text: string): string {
  if ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1)
  }
  return text
}

function extractFirstStringArg(argsNode: TSNode | null): string {
  if (!argsNode) return ''
  for (let i = 0; i < argsNode.namedChildCount; i++) {
    const child = argsNode.namedChild(i)
    if (child?.type === 'string') return child.text.slice(1, -1)
  }
  return ''
}

// ─── 컬럼 체인 언래핑 ─────────────────────────────────────────────────────────

interface ColumnChain {
  baseFn: string
  colName: string
  notNull: boolean
  primary: boolean
  unique: boolean
  defaultVal?: string
}

function unwrapChain(node: TSNode): ColumnChain | null {
  if (node.type !== 'call_expression') return null

  const fn = node.childForFieldName('function')
  const args = node.childForFieldName('arguments')

  if (!fn) return null

  if (fn.type === 'identifier') {
    return {
      baseFn: fn.text,
      colName: extractFirstStringArg(args),
      notNull: false, primary: false, unique: false,
    }
  }

  if (fn.type === 'instantiation_expression') {
    const baseFn = fn.text.match(/^[A-Za-z_$][\w$]*/)?.[0] ?? ''
    if (!baseFn) return null
    return {
      baseFn,
      colName: extractFirstStringArg(args),
      notNull: false, primary: false, unique: false,
    }
  }

  if (fn.type === 'member_expression') {
    const innerExpr = fn.childForFieldName('object')
    const methodName = fn.childForFieldName('property')?.text ?? ''
    if (!innerExpr) return null

    if (innerExpr.type !== 'call_expression') {
      return {
        baseFn: methodName,
        colName: extractFirstStringArg(args),
        notNull: false, primary: false, unique: false,
      }
    }

    const inner = unwrapChain(innerExpr)
    if (!inner) return null

    switch (methodName) {
      case 'notNull': inner.notNull = true; break
      case 'primaryKey': inner.primary = true; inner.notNull = true; break
      case 'unique': inner.unique = true; break
      case 'array': break
      case 'defaultNow': inner.defaultVal = 'now()'; break
      case 'default': {
        const firstArg = args?.namedChild(0)
        if (firstArg) inner.defaultVal = stripQuotes(firstArg.text)
        break
      }
    }
    return inner
  }

  return null
}

function isLikelyEnumColumn(baseFn: string): boolean {
  return /enum$/i.test(baseFn) || /^[a-z][A-Za-z0-9_$]*Enum$/.test(baseFn)
}

// ─── AST walker ──────────────────────────────────────────────────────────────

function walkNode(node: TSNode, visitor: (n: TSNode) => void): void {
  visitor(node)
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child) walkNode(child, visitor)
  }
}

// ─── pass 1: table var 수집 ───────────────────────────────────────────────────

function collectTableVars(rootNode: TSNode, out: Map<string, string>): void {
  walkNode(rootNode, node => {
    if (node.type !== 'variable_declarator') return
    const nameNode = node.childForFieldName('name')
    const valueNode = node.childForFieldName('value')
    if (!nameNode || !valueNode || valueNode.type !== 'call_expression') return
    const fn = valueNode.childForFieldName('function')
    if (!fn || fn.type !== 'identifier' || !TABLE_FUNCTIONS.has(fn.text)) return
    out.set(nameNode.text, toPascalCase(nameNode.text))
  })
}

function collectColumnFactoryTypes(rootNode: TSNode, out: Map<string, string>): void {
  walkNode(rootNode, node => {
    if (node.type !== 'variable_declarator') return
    const nameNode = node.childForFieldName('name')
    const valueNode = node.childForFieldName('value')
    if (!nameNode || !valueNode || valueNode.type !== 'call_expression') return

    const fn = valueNode.childForFieldName('function')
    if (fn?.type === 'identifier' && /enum$/i.test(fn.text)) {
      out.set(nameNode.text, 'String')
    } else if (fn?.type === 'identifier' && fn.text === 'customType') {
      const text = valueNode.text
      if (/\bdata\s*:\s*string\b/.test(text)) out.set(nameNode.text, 'String')
      else if (/\bdata\s*:\s*boolean\b/.test(text)) out.set(nameNode.text, 'Boolean')
      else if (/\bdata\s*:\s*number\b/.test(text)) out.set(nameNode.text, 'Float')
      else if (/\bdata\s*:\s*Date\b/.test(text)) out.set(nameNode.text, 'DateTime')
      else if (/\bdata\s*:\s*any\b/.test(text)) out.set(nameNode.text, 'Json')
    }
  })
}

// ─── pass 2: 테이블 파싱 ─────────────────────────────────────────────────────

function parseTableDeclarations(
  rootNode: TSNode,
  filePath: string,
  tableVarToName: Map<string, string>,
  columnFactoryTypes: Map<string, string>,
): ModelRaw[] {
  const models: ModelRaw[] = []

  walkNode(rootNode, node => {
    if (node.type !== 'variable_declarator') return
    const nameNode = node.childForFieldName('name')
    const valueNode = node.childForFieldName('value')
    if (!nameNode || !valueNode || valueNode.type !== 'call_expression') return
    const fnNode = valueNode.childForFieldName('function')
    if (!fnNode || fnNode.type !== 'identifier' || !TABLE_FUNCTIONS.has(fnNode.text)) return

    const varName = nameNode.text
    const modelName = tableVarToName.get(varName) ?? toPascalCase(varName)
    const argsNode = valueNode.childForFieldName('arguments')
    const tableName = extractFirstStringArg(argsNode)
    const fieldsObj = argsNode?.namedChild(1)
    const fields = fieldsObj?.type === 'object' ? parseColumnsObject(fieldsObj, columnFactoryTypes) : []

    const declNode = node.parent
    models.push({
      name: modelName,
      table_name: tableName || toPascalCase(varName).toLowerCase(),
      comment: '',
      fields,
      relations: [],
      source_file: filePath,
      line_start: (declNode ?? node).startPosition.row + 1,
      line_end: (declNode ?? node).endPosition.row + 1,
      is_deprecated: false,
    })
  })

  return models
}

function parseColumnsObject(objNode: TSNode, columnFactoryTypes: Map<string, string>): ModelField[] {
  const fields: ModelField[] = []

  for (let i = 0; i < objNode.namedChildCount; i++) {
    const child = objNode.namedChild(i)
    if (!child || child.type !== 'pair') continue

    const keyNode = child.childForFieldName('key')
    const valueNode = child.childForFieldName('value')
    if (!keyNode || !valueNode) continue

    const chain = unwrapChain(valueNode)
    if (!chain) continue

    const field: ModelField = {
      name: keyNode.text,
      type: resolveColumnType(chain.baseFn, columnFactoryTypes),
      nullable: !chain.notNull && !chain.primary,
      primary: chain.primary,
      unique: chain.unique,
      line: keyNode.startPosition.row + 1,
    }
    if (chain.defaultVal !== undefined) field.default = chain.defaultVal
    fields.push(field)
  }

  return fields
}

// ─── pass 3: relations 파싱 ──────────────────────────────────────────────────

function parseRelationsDeclarations(
  rootNode: TSNode,
  tableVarToName: Map<string, string>,
): Map<string, ModelRelation[]> {
  const result = new Map<string, ModelRelation[]>()

  walkNode(rootNode, node => {
    if (node.type !== 'variable_declarator') return
    const valueNode = node.childForFieldName('value')
    if (!valueNode || valueNode.type !== 'call_expression') return
    const fnNode = valueNode.childForFieldName('function')
    if (!fnNode || fnNode.type !== 'identifier' || fnNode.text !== 'relations') return

    const argsNode = valueNode.childForFieldName('arguments')
    if (!argsNode) return

    const tableVarNode = argsNode.namedChild(0)
    if (!tableVarNode || tableVarNode.type !== 'identifier') return

    const modelName = tableVarToName.get(tableVarNode.text)
    if (!modelName) return

    const arrowFn = argsNode.namedChild(1)
    if (!arrowFn) return

    const relObj = findRelationsBody(arrowFn)
    if (!relObj) return

    const rels = parseRelationsBody(relObj, tableVarToName)
    const existing = result.get(modelName) ?? []
    existing.push(...rels)
    result.set(modelName, existing)
  })

  return result
}

function findRelationsBody(arrowFn: TSNode): TSNode | null {
  const body = arrowFn.childForFieldName('body')
  if (!body) return null

  if (body.type === 'object') return body

  if (body.type === 'parenthesized_expression') {
    for (let i = 0; i < body.namedChildCount; i++) {
      const child = body.namedChild(i)
      if (child?.type === 'object') return child
    }
  }

  if (body.type === 'statement_block') {
    for (let i = 0; i < body.namedChildCount; i++) {
      const stmt = body.namedChild(i)
      if (stmt?.type !== 'return_statement') continue
      for (let j = 0; j < stmt.namedChildCount; j++) {
        const expr = stmt.namedChild(j)
        if (expr?.type === 'object') return expr
        if (expr?.type === 'parenthesized_expression') {
          for (let k = 0; k < expr.namedChildCount; k++) {
            const obj = expr.namedChild(k)
            if (obj?.type === 'object') return obj
          }
        }
      }
    }
  }

  return null
}

function parseRelationsBody(
  objNode: TSNode,
  tableVarToName: Map<string, string>,
): ModelRelation[] {
  const rels: ModelRelation[] = []

  for (let i = 0; i < objNode.namedChildCount; i++) {
    const child = objNode.namedChild(i)
    if (!child || child.type !== 'pair') continue

    const keyNode = child.childForFieldName('key')
    const valueNode = child.childForFieldName('value')
    if (!keyNode || !valueNode || valueNode.type !== 'call_expression') continue

    const relName = keyNode.text
    const line = keyNode.startPosition.row + 1
    const fnNode = valueNode.childForFieldName('function')
    if (!fnNode || fnNode.type !== 'identifier') continue

    const kind = fnNode.text
    if (kind !== 'one' && kind !== 'many') continue

    const relArgs = valueNode.childForFieldName('arguments')
    if (!relArgs) continue

    const targetVarNode = relArgs.namedChild(0)
    if (!targetVarNode) continue

    const targetVar = targetVarNode.text
    const targetModel = tableVarToName.get(targetVar) ?? toPascalCase(targetVar)

    if (kind === 'many') {
      rels.push({ name: relName, target_model: targetModel, type: 'oneToMany', line })
      continue
    }

    // one() — config 객체 유무로 manyToOne vs oneToOne 판단
    const configArg = relArgs.namedChild(1)
    let fkFields: string[] | undefined
    let references: string[] | undefined
    let type: ModelRelation['type'] = 'oneToOne'

    if (configArg?.type === 'object') {
      const fieldsProp = findObjPropValue(configArg, 'fields')
      const refsProp = findObjPropValue(configArg, 'references')
      if (fieldsProp) {
        type = 'manyToOne'
        fkFields = extractMemberNames(fieldsProp)
      }
      if (refsProp) references = extractMemberNames(refsProp)
    }

    const rel: ModelRelation = { name: relName, target_model: targetModel, type, line }
    if (fkFields) rel.fk_fields = fkFields
    if (references) rel.references = references
    rels.push(rel)
  }

  return rels
}

function findObjPropValue(objNode: TSNode, propName: string): TSNode | null {
  for (let i = 0; i < objNode.namedChildCount; i++) {
    const child = objNode.namedChild(i)
    if (!child || child.type !== 'pair') continue
    const key = child.childForFieldName('key')
    if (key?.text === propName) return child.childForFieldName('value')
  }
  return null
}

function extractMemberNames(arrayNode: TSNode): string[] {
  if (arrayNode.type !== 'array') return []
  const names: string[] = []
  for (let i = 0; i < arrayNode.namedChildCount; i++) {
    const child = arrayNode.namedChild(i)
    if (child?.type === 'member_expression') {
      const prop = child.childForFieldName('property')
      if (prop) names.push(prop.text)
    }
  }
  return names
}

// ─── DrizzleAdapter ──────────────────────────────────────────────────────────

export class DrizzleAdapter implements BuildModelsAdapter {
  readonly orm = 'drizzle'
  readonly strategy = 'dsl-parse' as const

  private static _parser: NativeParser | null = null

  static async ensureParser(): Promise<NativeParser> {
    if (DrizzleAdapter._parser) return DrizzleAdapter._parser
    try {
      const { createRequire } = await import('module')
      const req = createRequire(import.meta.url)
      const TreeSitter = req('tree-sitter') as new () => NativeParser
      const tsLangs = req('tree-sitter-typescript') as { typescript: unknown; tsx: unknown }
      const parser = new TreeSitter()
      parser.setLanguage(tsLangs.typescript)
      DrizzleAdapter._parser = parser
      return parser
    } catch (err) {
      throw new PipelineError('Failed to initialize tree-sitter-typescript parser', 'ANALYSIS_FAILED', { cause: err })
    }
  }

  async ensureReady(): Promise<void> {
    await DrizzleAdapter.ensureParser()
  }

  collectNames(files: SchemaFile[]): ParseContext {
    const modelNames = new Set<string>()
    const parser = DrizzleAdapter._parser
    if (!parser) return { enumNames: new Set(), modelNames, compositeTypeNames: new Set() }
    for (const file of files) {
      const tree = parser.parse(file.content)
      const tmp = new Map<string, string>()
      collectTableVars(tree.rootNode, tmp)
      for (const name of tmp.values()) modelNames.add(name)
    }
    return { enumNames: new Set(), modelNames, compositeTypeNames: new Set() }
  }

  prepareChunks(files: SchemaFile[]): SchemaChunk[] {
    return [{ files, orm: this.orm }]
  }

  async parseChunk(chunk: SchemaChunk, _ctx: ParseContext): Promise<ModelRaw[]> {
    const parser = await DrizzleAdapter.ensureParser()

    // pass 1: 전체 파일에서 table var → model name 수집
    const tableVarToName = new Map<string, string>()
    const columnFactoryTypes = new Map<string, string>()
    for (const file of chunk.files) {
      const tree = parser.parse(file.content)
      collectTableVars(tree.rootNode, tableVarToName)
      collectColumnFactoryTypes(tree.rootNode, columnFactoryTypes)
    }

    // pass 2: 테이블 파싱
    const modelMap = new Map<string, ModelRaw>()
    for (const file of chunk.files) {
      const tree = parser.parse(file.content)
      for (const model of parseTableDeclarations(tree.rootNode, file.path, tableVarToName, columnFactoryTypes)) {
        modelMap.set(model.name, model)
      }
    }

    // pass 3: relations 파싱 후 모델에 부착
    for (const file of chunk.files) {
      const tree = parser.parse(file.content)
      for (const [modelName, rels] of parseRelationsDeclarations(tree.rootNode, tableVarToName)) {
        const model = modelMap.get(modelName)
        if (model) model.relations.push(...rels)
      }
    }

    return [...modelMap.values()]
  }
}
