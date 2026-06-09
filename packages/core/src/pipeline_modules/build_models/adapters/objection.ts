import type {
  BuildModelsAdapter,
  ModelField,
  ModelRaw,
  ParseContext,
  SchemaChunk,
  SchemaFile,
} from '../types.js'

interface ObjectionClass {
  name: string
  tableName: string
  fields: ModelField[]
  sourceFile: string
  lineStart: number
  lineEnd: number
}

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length
}

function findMatchingBrace(content: string, openBrace: number): number {
  let depth = 0
  for (let i = openBrace; i < content.length; i += 1) {
    const ch = content[i]
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function mapTsType(typeText: string): string {
  if (/\bnumber\b/.test(typeText)) return 'Int'
  if (/\bstring\b/.test(typeText)) return 'String'
  if (/\bboolean\b/.test(typeText)) return 'Boolean'
  if (/\bDate\b/.test(typeText)) return 'DateTime'
  if (/\bRecord\b|\bobject\b|\bunknown\b|\bany\b/.test(typeText)) return 'Json'
  return 'unknown'
}

function mapJsonSchemaType(typeText: string): string {
  if (/\binteger\b|\bnumber\b/.test(typeText)) return 'Int'
  if (/\bstring\b/.test(typeText)) return 'String'
  if (/\bboolean\b/.test(typeText)) return 'Boolean'
  if (/\bobject\b|\barray\b/.test(typeText)) return 'Json'
  return 'unknown'
}

function mapKnexType(typeName: string): string {
  if (typeName === 'increments' || typeName === 'integer' || typeName === 'bigInteger') return 'Int'
  if (typeName === 'boolean') return 'Boolean'
  if (typeName === 'date' || typeName === 'dateTime' || typeName === 'timestamp' || typeName === 'timestamps') return 'DateTime'
  if (typeName === 'json' || typeName === 'jsonb') return 'Json'
  if (typeName === 'decimal' || typeName === 'float') return 'Float'
  return 'String'
}

function makeField(
  name: string,
  type: string,
  line: number,
  opts: Partial<Pick<ModelField, 'nullable' | 'primary' | 'unique'>> = {},
): ModelField {
  return {
    name,
    type,
    nullable: opts.nullable ?? true,
    primary: opts.primary ?? false,
    unique: opts.unique ?? false,
    line,
  }
}

function parseClassProperties(body: string, classStartLine: number): ModelField[] {
  const fields: ModelField[] = []
  const lines = body.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (line.startsWith('static ') || line.endsWith(',') || line.includes('{')) continue
    const match = /^([A-Za-z_$][\w$]*)([!?])?\s*:\s*([^=;]+)[;=]?/.exec(line)
    if (!match) continue
    const typeText = match[3].trim()
    const type = mapTsType(typeText)
    if (type === 'unknown') continue
    fields.push(makeField(match[1], type, classStartLine + i + 1, {
      nullable: match[2] === '?' || /\|\s*null\b/.test(typeText),
      primary: match[1] === 'id',
    }))
  }
  return fields
}

function parseJsonSchemaFields(body: string, classStartLine: number): ModelField[] {
  const propsMatch = /properties\s*:\s*\{/.exec(body)
  if (!propsMatch) return []
  const openBrace = body.indexOf('{', propsMatch.index)
  const closeBrace = findMatchingBrace(body, openBrace)
  if (closeBrace < 0) return []

  const required = new Set<string>()
  const requiredMatch = /required\s*:\s*\[([^\]]*)\]/.exec(body)
  if (requiredMatch) {
    for (const item of requiredMatch[1].matchAll(/['"]([^'"]+)['"]/g)) required.add(item[1])
  }

  const propsBody = body.slice(openBrace + 1, closeBrace)
  const fields: ModelField[] = []
  const propRe = /([A-Za-z_$][\w$]*)\s*:\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g
  for (const match of propsBody.matchAll(propRe)) {
    const name = match[1]
    const spec = match[2]
    const typeText = /type\s*:\s*(\[[^\]]+\]|['"][^'"]+['"])/.exec(spec)?.[1] ?? ''
    fields.push(makeField(name, mapJsonSchemaType(typeText), classStartLine + lineOf(body, propsMatch.index + match.index), {
      nullable: !required.has(name) || /\bnull\b/.test(typeText),
      primary: name === 'id',
    }))
  }
  return fields
}

function mergeFields(...fieldSets: ModelField[][]): ModelField[] {
  const byName = new Map<string, ModelField>()
  for (const fields of fieldSets) {
    for (const field of fields) {
      const existing = byName.get(field.name)
      if (!existing || (existing.type === 'unknown' && field.type !== 'unknown')) byName.set(field.name, field)
    }
  }
  return [...byName.values()]
}

function parseObjectionClasses(file: SchemaFile): ObjectionClass[] {
  const classes: ObjectionClass[] = []
  const classRe = /\b(?:export\s+default\s+|export\s+)?class\s+([A-Za-z_$][\w$]*)\s+extends\s+(?:[A-Za-z_$][\w$]*\.)?Model\b/g
  for (const match of file.content.matchAll(classRe)) {
    const openBrace = file.content.indexOf('{', match.index)
    const closeBrace = findMatchingBrace(file.content, openBrace)
    if (openBrace < 0 || closeBrace < 0) continue
    const body = file.content.slice(openBrace + 1, closeBrace)
    const tableName =
      /static\s+get\s+tableName\s*\(\s*\)\s*\{[^}]*return\s+['"]([^'"]+)['"]/.exec(body)?.[1] ??
      /static\s+tableName\s*\(\s*\)\s*\{[^}]*return\s+['"]([^'"]+)['"]/.exec(body)?.[1] ??
      /static\s+tableName\s*=\s*['"]([^'"]+)['"]/.exec(body)?.[1]
    if (!tableName) continue
    const lineStart = lineOf(file.content, match.index)
    classes.push({
      name: match[1],
      tableName,
      fields: mergeFields(parseJsonSchemaFields(body, lineStart), parseClassProperties(body, lineStart)),
      sourceFile: file.path,
      lineStart,
      lineEnd: lineOf(file.content, closeBrace),
    })
  }
  return classes
}

function parseKnexMigrationFields(file: SchemaFile): Map<string, ModelField[]> {
  const byTable = new Map<string, ModelField[]>()
  const createRe = /createTable\s*\(\s*['"]([^'"]+)['"]\s*,\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*\{/g
  for (const match of file.content.matchAll(createRe)) {
    const openBrace = file.content.indexOf('{', match.index)
    const closeBrace = findMatchingBrace(file.content, openBrace)
    if (closeBrace < 0) continue
    const body = file.content.slice(openBrace + 1, closeBrace)
    const fieldRe = new RegExp(`${match[2]}\\.([A-Za-z_$][\\w$]*)\\s*\\(\\s*['"]([^'"]+)['"][^)]*\\)([^\\n;]*)`, 'g')
    const fields: ModelField[] = []
    for (const fieldMatch of body.matchAll(fieldRe)) {
      const knexType = fieldMatch[1]
      const name = fieldMatch[2]
      const chain = fieldMatch[3] ?? ''
      fields.push(makeField(name, mapKnexType(knexType), lineOf(file.content, openBrace + fieldMatch.index), {
        nullable: !chain.includes('notNullable'),
        primary: knexType === 'increments' || chain.includes('primary'),
        unique: chain.includes('unique'),
      }))
    }
    byTable.set(match[1], fields)
  }
  return byTable
}

export class ObjectionAdapter implements BuildModelsAdapter {
  readonly orm = 'objection'
  readonly strategy = 'dsl-parse' as const

  async ensureReady(): Promise<void> {}

  collectNames(files: SchemaFile[]): ParseContext {
    const modelNames = new Set<string>()
    for (const file of files) {
      for (const model of parseObjectionClasses(file)) modelNames.add(model.name)
    }
    return { enumNames: new Set(), modelNames, compositeTypeNames: new Set() }
  }

  prepareChunks(files: SchemaFile[]): SchemaChunk[] {
    return [{ files, orm: this.orm }]
  }

  async parseChunk(chunk: SchemaChunk): Promise<ModelRaw[]> {
    const migrationFields = new Map<string, ModelField[]>()
    for (const file of chunk.files) {
      for (const [tableName, fields] of parseKnexMigrationFields(file)) migrationFields.set(tableName, fields)
    }

    const models: ModelRaw[] = []
    for (const file of chunk.files) {
      for (const model of parseObjectionClasses(file)) {
        models.push({
          name: model.name,
          table_name: model.tableName,
          comment: '',
          fields: mergeFields(model.fields, migrationFields.get(model.tableName) ?? []),
          relations: [],
          source_file: model.sourceFile,
          line_start: model.lineStart,
          line_end: model.lineEnd,
          is_deprecated: false,
        })
      }
    }
    return models
  }
}
