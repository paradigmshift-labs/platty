import type {
  BuildModelsAdapter,
  ModelRaw,
  ModelField,
  SchemaChunk,
  ParseContext,
  SchemaFile,
} from '../types.js'

interface InterfaceBlock {
  name: string
  body: string
  filePath: string
  startLine: number
  endLine: number
}

const TYPE_MAP: Array<[RegExp, string]> = [
  [/\bGenerated\s*<\s*number\s*>|\bnumber\b/, 'Int'],
  [/\bGenerated\s*<\s*string\s*>|\bstring\b/, 'String'],
  [/\bGeneratedAlways\s*<\s*number\s*>/, 'Int'],
  [/\bGeneratedAlways\s*<\s*string\s*>/, 'String'],
  [/\bGenerated\s*<\s*SqlBool\s*>|\bSqlBool\b/, 'Boolean'],
  [/\bGenerated\s*<\s*['"`][^'"`]+['"`]\s*\|/, 'String'],
  [/^['"`][^'"`]+['"`](?:\s*\|)/, 'String'],
  [/\bboolean\b/, 'Boolean'],
  [/\bArrayType\s*</, 'Json'],
  [/\bTemporal\.Duration\b|\bInterval\b/, 'String'],
  [/\bTemporal\.(?:PlainDate|Instant)\b|\bInstant\b|\bTimestamp\b/, 'DateTime'],
  [/\bDate\b/, 'DateTime'],
  [/^[A-Z][A-Za-z0-9_$]*(?:\s*\|\s*null)?$/, 'String'],
  [/\bJSONColumnType\s*<|\bJson\b|\bunknown\b|\bRecord\s*<|^\{|\[\]\s*(?:\|\s*null)?$/, 'Json'],
]

function toPascalCase(name: string): string {
  return name
    .split(/[_\-\s.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
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

function parseInterfaces(file: SchemaFile): Map<string, InterfaceBlock> {
  const out = new Map<string, InterfaceBlock>()
  const re = /\b(?:export\s+)?(?:interface\s+([A-Za-z_$][\w$]*)|type\s+([A-Za-z_$][\w$]*)\s*=\s*)\s*\{/g
  for (const match of file.content.matchAll(re)) {
    const openBrace = file.content.indexOf('{', match.index)
    const closeBrace = findMatchingBrace(file.content, openBrace)
    if (closeBrace < 0) continue
    const name = match[1] ?? match[2]
    out.set(name, {
      name,
      body: file.content.slice(openBrace + 1, closeBrace),
      filePath: file.path,
      startLine: lineOf(file.content, match.index),
      endLine: lineOf(file.content, closeBrace),
    })
  }
  return out
}

function collectInterfaces(files: SchemaFile[]): Map<string, InterfaceBlock> {
  const out = new Map<string, InterfaceBlock>()
  for (const file of files) {
    for (const [name, block] of parseInterfaces(file)) {
      if (!out.has(name)) out.set(name, block)
    }
  }
  return out
}

function mapKyselyType(typeText: string): string {
  const columnTypeMatch = /(?:ColumnType|JSONColumnType|Generated|GeneratedAlways)\s*<\s*([^,>]+)/.exec(typeText)
  const selectType = columnTypeMatch?.[1] ?? typeText
  for (const [re, mapped] of TYPE_MAP) {
    if (re.test(selectType)) return mapped
  }
  return 'unknown'
}

function angleBalance(text: string): number {
  let balance = 0
  for (const ch of text) {
    if (ch === '<') balance++
    else if (ch === '>') balance--
  }
  return balance
}

function parseFields(block: InterfaceBlock): ModelField[] {
  const fields: ModelField[] = []
  const lines = block.body.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!line || line.startsWith('//') || line.startsWith('*')) continue
    const match = /^([A-Za-z_$][\w$]*)(\?)?\s*:\s*(.+)$/.exec(line)
    if (!match) continue
    const name = match[1]
    const optional = Boolean(match[2])
    let typeText = match[3]
    while (angleBalance(typeText) > 0 && i + 1 < lines.length) {
      i += 1
      typeText += ` ${lines[i].trim()}`
    }
    typeText = typeText.replace(/[;,]\s*$/, '')
    fields.push({
      name,
      type: mapKyselyType(typeText),
      nullable: optional || /\|\s*null\b/.test(typeText),
      primary: name === 'id',
      unique: false,
      line: block.startLine + i + 1,
    })
  }
  return fields
}

function parseDatabaseTables(
  database: InterfaceBlock,
  interfaces: Map<string, InterfaceBlock>,
): Array<{ tableName: string; interfaceName: string; line: number }> {
  const out: Array<{ tableName: string; interfaceName: string; line: number }> = []
  const lines = database.body.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    const match = /^(?:([A-Za-z_$][\w$]*)|['"`]([^'"`]+)['"`])\??\s*:\s*([A-Za-z_$][\w$]*)\b/.exec(line)
    if (!match) continue
    if (!interfaces.has(match[3])) continue
    out.push({ tableName: match[1] ?? match[2], interfaceName: match[3], line: database.startLine + i + 1 })
  }
  return out
}

function findDatabaseInterface(interfaces: Map<string, InterfaceBlock>): InterfaceBlock | undefined {
  return interfaces.get('Database') ?? interfaces.get('DB')
}

export class KyselyAdapter implements BuildModelsAdapter {
  readonly orm = 'kysely'
  readonly strategy = 'dsl-parse' as const

  async ensureReady(): Promise<void> {}

  collectNames(files: SchemaFile[]): ParseContext {
    const modelNames = new Set<string>()
    const interfaces = collectInterfaces(files)
    for (const file of files) {
      const database = findDatabaseInterface(parseInterfaces(file))
      if (!database) continue
      for (const table of parseDatabaseTables(database, interfaces)) {
        modelNames.add(toPascalCase(table.tableName))
      }
    }
    return { enumNames: new Set(), modelNames, compositeTypeNames: new Set() }
  }

  prepareChunks(files: SchemaFile[]): SchemaChunk[] {
    return [{ files, orm: this.orm }]
  }

  async parseChunk(chunk: SchemaChunk): Promise<ModelRaw[]> {
    const models: ModelRaw[] = []
    const allInterfaces = collectInterfaces(chunk.files)
    for (const file of chunk.files) {
      const interfaces = parseInterfaces(file)
      const database = findDatabaseInterface(interfaces)
      if (!database) continue
      for (const table of parseDatabaseTables(database, allInterfaces)) {
        const tableInterface = allInterfaces.get(table.interfaceName)
        if (!tableInterface) continue
        models.push({
          name: toPascalCase(table.tableName),
          table_name: table.tableName,
          comment: '',
          fields: parseFields(tableInterface),
          relations: [],
          source_file: tableInterface.filePath,
          line_start: table.line,
          line_end: tableInterface.endLine,
          is_deprecated: false,
        })
      }
    }
    return models
  }
}
