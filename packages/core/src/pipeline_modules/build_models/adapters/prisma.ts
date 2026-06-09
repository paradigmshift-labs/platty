/**
 * PrismaAdapter: BuildModelsAdapter 구현체 (tree-sitter native binding)
 *
 * web-tree-sitter(WASM) 대신 native tree-sitter Node.js binding을 사용.
 * API는 web-tree-sitter와 유사하나 WASM 로드 없이 동기 초기화.
 */

import type { BuildModelsAdapter, SchemaFile, SchemaChunk, ParseContext, ModelRaw, ModelField, ModelRelation } from '../types.js'
import { PipelineError } from '@/infra/errors.js'

// ─── 내부 타입 (native tree-sitter 노드) ─────────────────────────────────────

interface TSNode {
  type: string
  text: string
  childCount: number
  startPosition: { row: number; column: number }
  endPosition: { row: number; column: number }
  child(index: number): TSNode | null
  children: TSNode[]
  previousSibling: TSNode | null
  nextSibling: TSNode | null
}

interface TSTree {
  rootNode: TSNode
}

interface NativeParser {
  parse(input: string): TSTree
  setLanguage(lang: unknown): void
}

// ─── 헬퍼 함수들 ─────────────────────────────────────────────────────────────


function stripCommentPrefix(text: string): string {
  if (text.startsWith('/// ')) return text.slice(4)
  if (text.startsWith('///')) return text.slice(3)
  if (text.startsWith('// ')) return text.slice(3)
  if (text.startsWith('//')) return text.slice(2)
  return text
}

function collectDocComment(node: TSNode): string {
  const parts: string[] = []

  const preceding: string[] = []
  let prev = node.previousSibling
  let expectedRow = node.startPosition.row - 1

  while (prev !== null && (prev.type === 'comment' || prev.type === 'developer_comment')) {
    if (prev.startPosition.row !== expectedRow) {
      break
    }
    preceding.unshift(stripCommentPrefix(prev.text))
    expectedRow = prev.startPosition.row - 1
    prev = prev.previousSibling
  }
  parts.push(...preceding)

  const nodeRow = node.startPosition.row
  let blockNode: TSNode | null = null
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && child.type === 'statement_block') {
      blockNode = child
      break
    }
  }
  if (blockNode) {
    for (let i = 0; i < blockNode.childCount; i++) {
      const child = blockNode.child(i)
      if (!child) continue
      if ((child.type === 'comment' || child.type === 'developer_comment') &&
          child.startPosition.row === nodeRow) {
        parts.push(stripCommentPrefix(child.text))
        break
      } else if (child.startPosition.row > nodeRow) {
        break
      }
    }
  }

  return parts.join('\n')
}

function collectFieldDocComment(node: TSNode): string | undefined {
  const parts: string[] = []
  const nodeRow = node.startPosition.row

  const preceding: string[] = []
  let prev = node.previousSibling
  let expectedRow = nodeRow - 1

  while (prev !== null) {
    if (prev.type === 'comment' || prev.type === 'developer_comment') {
      const commentRow = prev.startPosition.row
      if (commentRow !== expectedRow) {
        break
      }
      const prevOfComment = prev.previousSibling
      if (prevOfComment !== null &&
          prevOfComment.type === 'column_declaration' &&
          prevOfComment.startPosition.row === commentRow) {
        break
      }
      preceding.unshift(stripCommentPrefix(prev.text))
      expectedRow = commentRow - 1
      prev = prev.previousSibling
    } else {
      break
    }
  }
  parts.push(...preceding)

  let next = node.nextSibling
  while (next !== null) {
    if ((next.type === 'comment' || next.type === 'developer_comment') &&
        next.startPosition.row === nodeRow) {
      parts.push(stripCommentPrefix(next.text))
      break
    } else if (next.startPosition.row > nodeRow) {
      break
    }
    next = next.nextSibling
  }

  if (parts.length === 0) return undefined
  return parts.join('\n')
}

function parseRelationAttribute(attrNode: TSNode): {
  relation_name?: string
  fk_fields?: string[]
  references?: string[]
} {
  let callExpr: TSNode | null = null
  for (let i = 0; i < attrNode.childCount; i++) {
    const child = attrNode.child(i)
    if (child && child.type === 'call_expression') {
      callExpr = child
      break
    }
  }
  if (!callExpr) return {}

  let argsNode: TSNode | null = null
  for (let i = 0; i < callExpr.childCount; i++) {
    const child = callExpr.child(i)
    if (child && child.type === 'arguments') {
      argsNode = child
      break
    }
  }
  if (!argsNode) return {}

  let relation_name: string | undefined
  let fk_fields: string[] | undefined
  let references: string[] | undefined

  for (let i = 0; i < argsNode.childCount; i++) {
    const arg = argsNode.child(i)
    if (!arg) continue

    if (arg.type === 'string') {
      if (relation_name === undefined) {
        relation_name = arg.text.slice(1, -1)
      }
    } else if (arg.type === 'type_expression') {
      const keyNode = arg.child(0)
      const valueNode = arg.child(2)
      if (!keyNode || !valueNode) continue

      const key = keyNode.text
      if (key === 'fields' && valueNode.type === 'array') {
        fk_fields = extractArrayIdentifiers(valueNode)
      } else if (key === 'references' && valueNode.type === 'array') {
        references = extractArrayIdentifiers(valueNode)
      }
    }
  }

  return { relation_name, fk_fields, references }
}

function extractArrayIdentifiers(arrayNode: TSNode): string[] {
  const result: string[] = []
  for (let i = 0; i < arrayNode.childCount; i++) {
    const child = arrayNode.child(i)
    if (child && child.type === 'identifier') {
      result.push(child.text)
    }
  }
  return result
}

function parseDefaultValue(attrNode: TSNode): string | undefined {
  let callExpr: TSNode | null = null
  for (let i = 0; i < attrNode.childCount; i++) {
    const child = attrNode.child(i)
    if (child && child.type === 'call_expression') {
      callExpr = child
      break
    }
  }
  if (!callExpr) return undefined

  let argsNode: TSNode | null = null
  for (let i = 0; i < callExpr.childCount; i++) {
    const child = callExpr.child(i)
    if (child && child.type === 'arguments') {
      argsNode = child
      break
    }
  }
  if (!argsNode) return undefined

  const inner = argsNode.text.slice(1, -1).trim()
  if (!inner) return undefined
  // Strip outer quotes from string literal defaults: @default("hello") → "hello"
  if ((inner.startsWith('"') && inner.endsWith('"')) ||
      (inner.startsWith("'") && inner.endsWith("'"))) {
    return inner.slice(1, -1)
  }
  return inner
}


function parseCompositeId(blockNode: TSNode): string[] {
  for (let i = 0; i < blockNode.childCount; i++) {
    const child = blockNode.child(i)
    if (child && child.type === 'call_expression') {
      const nameNode = child.child(0)
      if (!nameNode || nameNode.text !== 'id') return []

      const argsNode = child.child(1)
      if (!argsNode) return []

      for (let j = 0; j < argsNode.childCount; j++) {
        const arg = argsNode.child(j)
        if (arg && arg.type === 'array') {
          return extractArrayIdentifiers(arg)
        }
      }
    }
  }
  return []
}

function parseBlockUniques(blockNode: TSNode): Set<string> {
  const result = new Set<string>()

  for (let i = 0; i < blockNode.childCount; i++) {
    const child = blockNode.child(i)
    if (!child) continue

    if (child.type === 'block_attribute_declaration') {
      for (let j = 0; j < child.childCount; j++) {
        const sub = child.child(j)
        if (sub && sub.type === 'call_expression') {
          const nameNode = sub.child(0)
          if (!nameNode || nameNode.text !== 'unique') break

          const argsNode = sub.child(1)
          if (!argsNode) break

          for (let k = 0; k < argsNode.childCount; k++) {
            const arg = argsNode.child(k)
            if (arg && arg.type === 'array') {
              const fields = extractArrayIdentifiers(arg)
              if (fields.length === 1) {
                result.add(fields[0])
              }
            }
          }
        }
      }
    }
  }

  return result
}

function parseFieldType(typeText: string): { baseType: string; isList: boolean } {
  const isList = typeText.endsWith('[]')
  const baseType = isList ? typeText.slice(0, -2) : typeText
  return { baseType, isList }
}

function isDeprecatedModel(comment: string): boolean {
  return comment.includes('@deprecated')
}

function extractColumnType(colTypeNode: TSNode): string {
  let baseName = ''
  let isList = false

  for (let i = 0; i < colTypeNode.childCount; i++) {
    const child = colTypeNode.child(i)
    if (!child) continue

    if (child.type === 'identifier') {
      baseName = child.text
    } else if (child.type === 'call_expression') {
      const nameNode = child.child(0)
      if (nameNode && nameNode.text === 'Unsupported') {
        const argsNode = child.child(1)
        let innerType = ''
        if (argsNode) {
          for (let j = 0; j < argsNode.childCount; j++) {
            const arg = argsNode.child(j)
            if (arg && arg.type === 'string') {
              innerType = arg.text.slice(1, -1)
              break
            }
          }
        }
        baseName = innerType ? `Unsupported(${innerType})` : 'Unsupported'
      } else if (nameNode) {
        baseName = nameNode.text
      }
    } else if (child.type === 'array') {
      isList = true
    }
  }

  if (isList) return baseName + '[]'
  return baseName
}

// ─── PrismaAdapter ────────────────────────────────────────────────────────────

export class PrismaAdapter implements BuildModelsAdapter {
  readonly orm = 'prisma'
  readonly strategy = 'dsl-parse' as const

  private static _parser: NativeParser | null = null

  static async ensureParser(): Promise<NativeParser> {
    if (PrismaAdapter._parser) {
      return PrismaAdapter._parser
    }

    try {
      const { createRequire } = await import('module')
      const req = createRequire(import.meta.url)
      const TreeSitter = req('tree-sitter') as new () => NativeParser
      const PrismaLanguage = req('tree-sitter-prisma') as unknown

      const parser = new TreeSitter()
      parser.setLanguage(PrismaLanguage)
      PrismaAdapter._parser = parser
      return parser
    } catch (err) {
      throw new PipelineError('Failed to initialize tree-sitter parser', 'ANALYSIS_FAILED', { cause: err })
    }
  }

  async ensureReady(): Promise<void> {
    await PrismaAdapter.ensureParser()
  }

  collectNames(files: SchemaFile[]): ParseContext {
    const parser = PrismaAdapter._parser
    if (!parser) {
      throw new PipelineError('PrismaAdapter: parser not initialized. Call ensureReady() first.')
    }

    const enumNames = new Set<string>()
    const modelNames = new Set<string>()
    const compositeTypeNames = new Set<string>()

    for (const file of files) {
      const tree = parser.parse(file.content)
      const root = tree.rootNode

      for (let i = 0; i < root.childCount; i++) {
        const node = root.child(i)
        if (!node) continue

        const name = getFirstIdentifierText(node)
        if (!name) continue

        switch (node.type) {
          case 'model_declaration':
            modelNames.add(name)
            break
          case 'view_declaration':
            modelNames.add(name)
            break
          case 'enum_declaration':
            enumNames.add(name)
            break
          case 'type_declaration':
            if (hasStatementBlock(node)) {
              compositeTypeNames.add(name)
              console.warn(`Warning: composite type '${name}' found, skipping in parseChunk`)
            }
            break
        }
      }
    }

    return { enumNames, modelNames, compositeTypeNames }
  }

  prepareChunks(files: SchemaFile[]): SchemaChunk[] {
    return files.map(f => ({ files: [f], orm: this.orm }))
  }

  parseChunk(chunk: SchemaChunk, ctx: ParseContext): ModelRaw[] {
    const parser = PrismaAdapter._parser
    if (!parser) {
      throw new PipelineError('PrismaAdapter: parser not initialized. Call ensureReady() first.')
    }

    const file = chunk.files[0]
    const tree = parser.parse(file.content)
    const root = tree.rootNode
    const models: ModelRaw[] = []

    for (let i = 0; i < root.childCount; i++) {
      const node = root.child(i)
      if (!node) continue

      if (node.type === 'model_declaration' || node.type === 'view_declaration') {
        const model = parseModelBlock(node, ctx, file.path)
        if (model) models.push(model)
      } else if (node.type === 'type_declaration' && hasStatementBlock(node)) {
        const name = getFirstIdentifierText(node) ?? '?'
        console.warn(`Warning: composite type '${name}' found, skipping in parseChunk`)
      }
    }

    // Post-process: detect implicit many-to-many (both sides are lists with no FK)
    const modelMap = new Map(models.map(m => [m.name, m]))
    for (const model of models) {
      for (const rel of model.relations) {
        if (rel.type !== 'oneToMany' || rel.fk_fields !== undefined) continue
        const targetModel = modelMap.get(rel.target_model)
        if (!targetModel) continue
        const backRel = targetModel.relations.find(r => {
          if (r === rel) return false
          if (r.target_model !== model.name) return false
          if (r.fk_fields !== undefined) return false
          if (r.type !== 'oneToMany' && r.type !== 'manyToMany') return false
          if (rel.relation_name !== undefined && r.relation_name !== undefined) {
            return rel.relation_name === r.relation_name
          }
          return rel.relation_name === undefined && r.relation_name === undefined
        })
        if (backRel) {
          rel.type = 'manyToMany'
          backRel.type = 'manyToMany'
        }
      }
    }

    return models
  }
}

// ─── 내부 파싱 헬퍼 ───────────────────────────────────────────────────────────

function getFirstIdentifierText(node: TSNode): string | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && child.type === 'identifier') {
      return child.text
    }
  }
  return null
}

function hasStatementBlock(node: TSNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && child.type === 'statement_block') return true
  }
  return false
}

function parseModelBlock(
  node: TSNode,
  ctx: ParseContext,
  sourcePath: string,
): ModelRaw | null {
  const name = getFirstIdentifierText(node)
  if (!name) return null

  const modelComment = collectDocComment(node)

  const lineStart = node.startPosition.row + 1
  const lineEnd = node.endPosition.row + 1

  let blockNode: TSNode | null = null
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && child.type === 'statement_block') {
      blockNode = child
      break
    }
  }
  if (!blockNode) return null

  // @@ignore → exclude entire model from Prisma client output
  for (let i = 0; i < blockNode.childCount; i++) {
    const child = blockNode.child(i)
    if (!child || child.type !== 'block_attribute_declaration') continue
    const attrName = getCallExprIdentifier(child)
    if (attrName && attrName.text === 'ignore') return null
  }

  const blockUniqueFields = parseBlockUniques(blockNode)

  let compositeIdFields: string[] = []

  for (let i = 0; i < blockNode.childCount; i++) {
    const child = blockNode.child(i)
    if (!child || child.type !== 'block_attribute_declaration') continue

    const attrNameNode = getCallExprIdentifier(child)
    if (!attrNameNode) continue

    if (attrNameNode.text === 'id') {
      compositeIdFields = parseCompositeId(child)
    }
  }

  const fields: ModelField[] = []
  const relations: ModelRelation[] = []

  const fieldUniqueSet = new Set<string>()

  for (let i = 0; i < blockNode.childCount; i++) {
    const child = blockNode.child(i)
    if (!child || child.type !== 'column_declaration') continue

    const fieldNameNode = child.child(0)
    if (!fieldNameNode) continue
    const fieldName = fieldNameNode.text

    for (let j = 0; j < child.childCount; j++) {
      const attrNode = child.child(j)
      if (!attrNode || attrNode.type !== 'attribute') continue
      const attrIdentifier = getAttrIdentifier(attrNode)
      if (attrIdentifier === 'unique') {
        fieldUniqueSet.add(fieldName)
      }
    }
  }

  for (let i = 0; i < blockNode.childCount; i++) {
    const child = blockNode.child(i)
    if (!child || child.type !== 'column_declaration') continue

    const fieldNameNode = child.child(0)
    if (!fieldNameNode) continue
    const fieldName = fieldNameNode.text

    const colTypeNode = getColumnType(child)
    if (!colTypeNode) continue
    const typeText = extractColumnType(colTypeNode)
    const { baseType, isList } = parseFieldType(typeText)

    let hasIgnore = false
    let hasPrimary = false
    let hasUnique = false
    let defaultValue: string | undefined
    let hasRelation = false
    let relationAttrNode: TSNode | null = null

    for (let j = 0; j < child.childCount; j++) {
      const attrNode = child.child(j)
      if (!attrNode || attrNode.type !== 'attribute') continue

      const attrIdentifier = getAttrIdentifier(attrNode)
      if (attrIdentifier === 'ignore') {
        hasIgnore = true
        break
      } else if (attrIdentifier === 'id') {
        hasPrimary = true
      } else if (attrIdentifier === 'unique') {
        hasUnique = true
      } else if (attrIdentifier === 'default') {
        defaultValue = parseDefaultValue(attrNode)
      } else if (attrIdentifier === 'relation') {
        hasRelation = true
        relationAttrNode = attrNode
      }
    }

    if (hasIgnore) continue

    const isNullable = hasNullable(colTypeNode)

    if (ctx.modelNames.has(baseType)) {
      const relParsed = hasRelation && relationAttrNode
        ? parseRelationAttribute(relationAttrNode)
        : {}

      let relType: 'oneToOne' | 'oneToMany' | 'manyToOne' | 'manyToMany'
      const fk = relParsed.fk_fields

      if (fk !== undefined) {
        const fkHasUnique = fk.some(f => fieldUniqueSet.has(f) || blockUniqueFields.has(f))
        relType = fkHasUnique ? 'oneToOne' : 'manyToOne'
      } else {
        relType = isList ? 'oneToMany' : 'oneToOne'
      }

      const relation: ModelRelation = {
        name: fieldName,
        target_model: baseType,
        type: relType,
        line: child.startPosition.row + 1,
      }
      if (relParsed.relation_name !== undefined) relation.relation_name = relParsed.relation_name
      if (relParsed.fk_fields !== undefined) relation.fk_fields = relParsed.fk_fields
      if (relParsed.references !== undefined) relation.references = relParsed.references

      relations.push(relation)
    } else {
      let finalType: string
      if (ctx.enumNames.has(baseType)) {
        finalType = isList ? `${baseType}(enum)[]` : `${baseType}(enum)`
      } else if (ctx.compositeTypeNames.has(baseType)) {
        finalType = isList ? `${baseType}(composite)[]` : `${baseType}(composite)`
        console.warn(`Warning: composite type field '${fieldName}' references '${baseType}'`)
      } else {
        finalType = typeText
      }

      const field: ModelField = {
        name: fieldName,
        type: finalType,
        nullable: isNullable,
        primary: hasPrimary,
        unique: hasUnique,
        line: child.startPosition.row + 1,
      }

      const fieldComment = collectFieldDocComment(child)
      if (fieldComment !== undefined) field.comment = fieldComment

      if (defaultValue !== undefined) field.default = defaultValue

      fields.push(field)
    }
  }

  for (const idField of compositeIdFields) {
    const f = fields.find(field => field.name === idField)
    if (f) f.primary = true
  }

  const tableName = name
  const deprecated = isDeprecatedModel(modelComment)

  return {
    name,
    table_name: tableName,
    comment: modelComment,
    fields,
    relations,
    source_file: sourcePath,
    line_start: lineStart,
    line_end: lineEnd,
    is_deprecated: deprecated,
  }
}

function getCallExprIdentifier(blockAttrNode: TSNode): TSNode | null {
  for (let i = 0; i < blockAttrNode.childCount; i++) {
    const child = blockAttrNode.child(i)
    if (child && child.type === 'call_expression') {
      const nameNode = child.child(0)
      return nameNode
    }
    if (child && child.type === 'identifier') {
      return child
    }
  }
  return null
}

function getAttrIdentifier(attrNode: TSNode): string | null {
  for (let i = 0; i < attrNode.childCount; i++) {
    const child = attrNode.child(i)
    if (!child) continue
    if (child.type === 'identifier') return child.text
    if (child.type === 'call_expression') {
      const nameNode = child.child(0)
      if (nameNode && nameNode.type === 'identifier') return nameNode.text
      if (nameNode && nameNode.type === 'member_expression') {
        const firstIdent = nameNode.child(0)
        if (firstIdent && firstIdent.type === 'identifier') return firstIdent.text
      }
    }
    if (child.type === 'member_expression') {
      const firstIdent = child.child(0)
      if (firstIdent && firstIdent.type === 'identifier') return firstIdent.text
    }
  }
  return null
}

function getColumnType(colDeclNode: TSNode): TSNode | null {
  for (let i = 0; i < colDeclNode.childCount; i++) {
    const child = colDeclNode.child(i)
    if (child && child.type === 'column_type') return child
  }
  return null
}

function hasNullable(colTypeNode: TSNode): boolean {
  for (let i = 0; i < colTypeNode.childCount; i++) {
    const child = colTypeNode.child(i)
    if (child && child.type === 'maybe') return true
  }
  return false
}
