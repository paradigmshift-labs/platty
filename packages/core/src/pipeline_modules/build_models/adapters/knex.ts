import type {
  BuildModelsAdapter,
  ModelField,
  ModelRaw,
  ParseContext,
  SchemaChunk,
  SchemaFile,
} from '../types.js'

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

function toPascalCase(name: string): string {
  return name
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

const COLUMN_BUILDERS = new Set([
  'bigIncrements',
  'bigInteger',
  'bigint',
  'binary',
  'boolean',
  'date',
  'dateTime',
  'datetime',
  'decimal',
  'double',
  'enu',
  'enum',
  'float',
  'increments',
  'integer',
  'json',
  'jsonb',
  'mediumint',
  'smallint',
  'specificType',
  'string',
  'text',
  'time',
  'timestamp',
  'timestamps',
  'tinyint',
  'uuid',
])

function mapKnexType(typeName: string): string {
  if ([
    'increments',
    'bigIncrements',
    'integer',
    'bigInteger',
    'bigint',
    'tinyint',
    'smallint',
    'mediumint',
  ].includes(typeName)) return 'Int'
  if (typeName === 'boolean') return 'Boolean'
  if (typeName === 'date' || typeName === 'dateTime' || typeName === 'datetime' || typeName === 'timestamp' || typeName === 'timestamps') return 'DateTime'
  if (typeName === 'json' || typeName === 'jsonb' || typeName === 'enu' || typeName === 'enum') return 'Json'
  if (typeName === 'decimal' || typeName === 'float' || typeName === 'double') return 'Float'
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

function parseKnexMigrationModels(file: SchemaFile): ModelRaw[] {
  const models: ModelRaw[] = []
  const createRe = /createTable\s*\(\s*['"]([^'"]+)['"]\s*,\s*(?:\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>|function\s*\(\s*([A-Za-z_$][\w$]*)\s*\))\s*\{/g
  for (const match of file.content.matchAll(createRe)) {
    const tableName = match[1]
    const tableVar = match[2] ?? match[3]
    const openBrace = file.content.indexOf('{', match.index)
    const closeBrace = findMatchingBrace(file.content, openBrace)
    if (closeBrace < 0) continue
    const body = file.content.slice(openBrace + 1, closeBrace)
    const fieldRe = new RegExp(`${tableVar}\\.([A-Za-z_$][\\w$]*)\\s*\\(\\s*['"]([^'"]+)['"][^)]*\\)([^\\n;]*)`, 'g')
    const fields: ModelField[] = []
    for (const fieldMatch of body.matchAll(fieldRe)) {
      const knexType = fieldMatch[1]
      if (!COLUMN_BUILDERS.has(knexType)) continue
      const name = fieldMatch[2]
      const chain = fieldMatch[3] ?? ''
      fields.push(makeField(name, mapKnexType(knexType), lineOf(file.content, openBrace + fieldMatch.index), {
        nullable: !chain.includes('notNullable') && !chain.includes('notNull'),
        primary: knexType === 'increments' || knexType === 'bigIncrements' || chain.includes('primary'),
        unique: chain.includes('unique'),
      }))
    }
    models.push({
      name: toPascalCase(tableName),
      table_name: tableName,
      comment: '',
      fields,
      relations: [],
      source_file: file.path,
      line_start: lineOf(file.content, match.index),
      line_end: lineOf(file.content, closeBrace),
      is_deprecated: false,
    })
  }
  return models
}

export class KnexAdapter implements BuildModelsAdapter {
  readonly orm = 'knex'
  readonly strategy = 'dsl-parse' as const

  async ensureReady(): Promise<void> {}

  collectNames(files: SchemaFile[]): ParseContext {
    const modelNames = new Set<string>()
    for (const file of files) {
      for (const model of parseKnexMigrationModels(file)) modelNames.add(model.name)
    }
    return { enumNames: new Set(), modelNames, compositeTypeNames: new Set() }
  }

  prepareChunks(files: SchemaFile[]): SchemaChunk[] {
    return [{ files, orm: this.orm }]
  }

  async parseChunk(chunk: SchemaChunk): Promise<ModelRaw[]> {
    return chunk.files.flatMap((file) => parseKnexMigrationModels(file))
  }
}
