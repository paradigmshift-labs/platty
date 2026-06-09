import type {
  BuildModelsAdapter,
  ModelRaw,
  ModelField,
  SchemaFile,
  SchemaChunk,
  ParseContext,
} from '../types.js'

const COLUMN_TYPE_MAP: Record<string, string> = {
  IntColumn: 'Int',
  TextColumn: 'String',
  DateTimeColumn: 'DateTime',
  BoolColumn: 'Boolean',
  RealColumn: 'Float',
  BlobColumn: 'Bytes',
}

const BUILDER_TYPE_MAP: Record<string, string> = {
  integer: 'Int',
  text: 'String',
  dateTime: 'DateTime',
  boolean: 'Boolean',
  real: 'Float',
  blob: 'Bytes',
}

function toSnakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
}

function findMatchingBrace(source: string, open: number): number {
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

function extractDefault(expr: string): string | undefined {
  const defaultMatch = expr.match(/\.(?:withDefault|clientDefault)\s*\(([^)]*)\)/)
  return defaultMatch?.[1]?.trim()
}

function makeField(
  name: string,
  type: string,
  expr: string,
  line: number,
): ModelField {
  return {
    name,
    type,
    nullable: /\.nullable\s*\(/.test(expr),
    default: extractDefault(expr),
    primary: /\.autoIncrement\s*\(/.test(expr) || /PRIMARY\s+KEY/i.test(expr),
    unique: /\.unique\s*\(/.test(expr) || /UNIQUE/i.test(expr),
    line,
  }
}

function parseDriftTables(file: SchemaFile): ModelRaw[] {
  const models: ModelRaw[] = []
  const classRe = /\b(?:abstract\s+|final\s+|base\s+)*class\s+([A-Za-z_]\w*)\s+extends\s+Table\b/g
  let classMatch: RegExpExecArray | null

  while ((classMatch = classRe.exec(file.content)) !== null) {
    const className = classMatch[1]
    const open = file.content.indexOf('{', classMatch.index)
    const end = open >= 0 ? findMatchingBrace(file.content, open) : -1
    if (open < 0 || end < 0) continue

    const body = file.content.slice(open + 1, end)
    const fields: ModelField[] = []
    const seenFields = new Set<string>()
    const fieldRe = /\b(IntColumn|TextColumn|DateTimeColumn|BoolColumn|RealColumn|BlobColumn)\s+get\s+([A-Za-z_]\w*)\s*=>\s*([\s\S]*?);/g
    let fieldMatch: RegExpExecArray | null
    while ((fieldMatch = fieldRe.exec(body)) !== null) {
      const expr = fieldMatch[3]
      const name = fieldMatch[2]
      seenFields.add(name)
      fields.push(makeField(
        name,
        COLUMN_TYPE_MAP[fieldMatch[1]] ?? 'String',
        expr,
        lineOf(file.content, open + 1 + fieldMatch.index),
      ))
    }

    const inferredFieldRe = /\b(?:late\s+)?final\s+([A-Za-z_]\w*)\s*=\s*(integer|text|dateTime|boolean|real|blob)\s*\(\)([\s\S]*?);/g
    while ((fieldMatch = inferredFieldRe.exec(body)) !== null) {
      const name = fieldMatch[1]
      if (seenFields.has(name)) continue
      fields.push(makeField(
        name,
        BUILDER_TYPE_MAP[fieldMatch[2]] ?? 'String',
        fieldMatch[3],
        lineOf(file.content, open + 1 + fieldMatch.index),
      ))
    }

    if (fields.length === 0) continue
    const tableName = body.match(/\bString\s+get\s+tableName\s*=>\s*['"]([^'"]+)['"]/)?.[1] ?? toSnakeCase(className)

    models.push({
      name: className,
      table_name: tableName,
      comment: '',
      fields,
      relations: [],
      source_file: file.path,
      line_start: lineOf(file.content, classMatch.index),
      line_end: lineOf(file.content, end),
      is_deprecated: false,
    })
  }

  return models
}

export class DriftAdapter implements BuildModelsAdapter {
  readonly orm = 'drift'
  readonly strategy = 'dsl-parse' as const

  collectNames(files: SchemaFile[]): ParseContext {
    const modelNames = new Set<string>()
    for (const file of files) {
      for (const match of file.content.matchAll(/\bclass\s+([A-Za-z_]\w*)\s+extends\s+Table\b/g)) {
        modelNames.add(match[1])
      }
    }
    return { enumNames: new Set(), modelNames, compositeTypeNames: new Set() }
  }

  prepareChunks(files: SchemaFile[]): SchemaChunk[] {
    return [{ files, orm: this.orm }]
  }

  parseChunk(chunk: SchemaChunk): ModelRaw[] {
    return chunk.files.flatMap(parseDriftTables)
  }
}
