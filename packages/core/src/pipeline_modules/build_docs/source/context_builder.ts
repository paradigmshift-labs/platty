import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq, inArray } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { codeRelations, type CodeRelation } from '@/db/schema/build_relations.js'
import { codeNodes } from '@/db/schema/code_graph.js'
import type { DocumentTarget, GenerationTargetContext, RelationFactContext, SourceContext } from '../runtime/types.js'
import { collectSourceClosure } from './source_closure.js'

type CodeNodeRow = typeof codeNodes.$inferSelect

export function documentTargetForTask(input: {
  targetJson: Record<string, unknown>
  targetDocumentId: string
  documentType: DocumentTarget['documentType']
  primaryEntryPointId: string
  targetKey: string
}): DocumentTarget {
  const target = input.targetJson as Partial<DocumentTarget>
  const metadata: Record<string, unknown> = isRecord(target.metadata) ? target.metadata : {}

  return {
    documentId: input.targetDocumentId,
    documentType: input.documentType,
    seedNodeIds: Array.isArray(target.seedNodeIds) ? target.seedNodeIds.filter(isString) : [],
    entryPointIds: Array.isArray(target.entryPointIds) ? target.entryPointIds.filter(isString) : [],
    primaryEntryPointId: typeof target.primaryEntryPointId === 'string' ? target.primaryEntryPointId : input.primaryEntryPointId,
    targetKey: typeof target.targetKey === 'string' ? target.targetKey : input.targetKey,
    metadata: {
      framework_hint: typeof metadata.framework_hint === 'string' ? metadata.framework_hint : null,
      file_path: typeof metadata.file_path === 'string' ? metadata.file_path : '',
    },
  }
}

export function normalizeTarget(input: {
  targetJson: Record<string, unknown>
  targetDocumentId: string
  documentType: DocumentTarget['documentType']
  primaryEntryPointId: string
  targetKey: string
  repositoryId: string
}): GenerationTargetContext {
  const target = input.targetJson as Partial<DocumentTarget> & { repository_id?: unknown }
  const metadata: Record<string, unknown> = isRecord(target.metadata) ? target.metadata : {}
  const identity = parseTargetKey(input.documentType, input.targetKey)

  return {
    document_id: input.targetDocumentId,
    document_type: input.documentType,
    target_key: input.targetKey,
    primary_entry_point_id: input.primaryEntryPointId,
    seed_node_ids: Array.isArray(target.seedNodeIds) ? target.seedNodeIds.filter(isString) : [],
    entry_point_ids: Array.isArray(target.entryPointIds) ? target.entryPointIds.filter(isString) : [],
    repository_id: typeof target.repository_id === 'string' ? target.repository_id : input.repositoryId,
    method: identity.method,
    path: identity.path,
    handler: identity.handler,
    file_path: typeof metadata.file_path === 'string' ? metadata.file_path : '',
    framework_hint: typeof metadata.framework_hint === 'string' ? metadata.framework_hint : null,
  }
}

export function buildCodeRelationFacts(input: {
  db: DB
  repoId: string
  seedNodeIds: string[]
  relatedNodeIds?: string[]
  namespace: string
}): RelationFactContext[] {
  const nodeIds = uniqueStrings([...input.seedNodeIds, ...(input.relatedNodeIds ?? [])])
  if (nodeIds.length === 0) return []
  const rows = input.db.select()
    .from(codeRelations)
    .where(and(eq(codeRelations.repoId, input.repoId), inArray(codeRelations.sourceNodeId, nodeIds)))
    .all()
    .sort((a, b) => a.id.localeCompare(b.id))

  return rows.map((relation, index) => toRelationFactContext(relation, `${input.namespace}:code_relation:${index + 1}`))
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))]
}

export function buildSourceContext(input: {
  db: DB
  repoId: string
  seedNodeIds: string[]
  entryPointIds?: string[]
  codeRelationFacts: RelationFactContext[]
  namespace: string
  repoPath?: string | null
}): { sourceContext: SourceContext[]; evidenceGaps: string[] } {
  const closure = collectSourceClosure({
    db: input.db,
    repoId: input.repoId,
    seedNodeIds: input.seedNodeIds,
    entryPointIds: input.entryPointIds ?? [],
    codeRelationFacts: input.codeRelationFacts,
    repoPath: input.repoPath,
  })
  const nodeHops = new Map(closure.map((node) => [node.nodeId, node.hop]))
  const nodeIds = closure.map((node) => node.nodeId)

  if (nodeIds.length === 0) return { sourceContext: [], evidenceGaps: ['target has no seed code nodes'] }

  const rows = input.db.select()
    .from(codeNodes)
    .where(and(eq(codeNodes.repoId, input.repoId), inArray(codeNodes.id, nodeIds)))
    .all()
  const rowById = new Map(rows.map((row) => [row.id, row]))
  const sourceContext = nodeIds.flatMap((id, index): SourceContext[] => {
    const row = rowById.get(id)
    if (!row) return []
    const isSeed = input.seedNodeIds.includes(row.id)
    return [{
      evidence_id: `${input.namespace}:source:${index + 1}`,
      node_id: row.id,
      node_type: row.type,
      dep_type: isSeed ? 'entrypoint' : 'dependency',
      hop: isSeed ? 0 : nodeHops.get(row.id) ?? 1,
      file_path: row.filePath,
      symbol: row.name,
      line_start: row.lineStart,
      line_end: row.lineEnd,
      signature: row.signature,
      source_missing: sourceSliceFor(row, input.repoPath ?? undefined).missing,
      source_excerpt: sourceExcerptFor(row, input.repoPath ?? undefined),
    }]
  })

  const foundIds = new Set(sourceContext.map((source) => source.node_id))
  const evidenceGaps = nodeIds
    .filter((id) => !foundIds.has(id))
    .map((id) => `source context missing for code node ${id}`)
  return { sourceContext, evidenceGaps }
}

function toRelationFactContext(relation: CodeRelation, evidenceId: string): RelationFactContext {
  return {
    evidence_id: evidenceId,
    relation_id: relation.id,
    repo_id: relation.repoId,
    source_node_id: relation.sourceNodeId,
    kind: relation.kind,
    target: relation.target,
    canonical_target: relation.canonicalTarget,
    operation: relation.operation,
    confidence: relation.confidence,
    source: 'deterministic',
    evidence_node_ids: relation.evidenceNodeIds,
    payload: relation.payload,
    unresolved_reason: relation.unresolvedReason,
  }
}

function parseTargetKey(documentType: DocumentTarget['documentType'], targetKey: string): { method: string; path: string; handler: string } {
  if (documentType === 'api_spec') {
    const match = /^api:([^:]+):(.+)$/.exec(targetKey)
    return {
      method: match?.[1] ?? 'UNKNOWN',
      path: match?.[2] ?? targetKey,
      handler: targetKey,
    }
  }
  if (documentType === 'screen_spec') {
    const match = /^screen:(.+):([^:]+)$/.exec(targetKey)
    return {
      method: 'SCREEN',
      path: match?.[1] ?? targetKey,
      handler: match?.[2] ?? targetKey,
    }
  }
  if (documentType === 'event_spec') return { method: 'EVENT', path: targetKey, handler: targetKey }
  return { method: 'SCHEDULE', path: targetKey, handler: targetKey }
}

function sourceExcerptFor(source: CodeNodeRow, repoPath?: string): string {
  const slice = sourceSliceFor(source, repoPath)
  if (!slice.missing && slice.code.length > 0) return slice.code
  const parts = [
    source.signature,
    source.docComment,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
  if (parts.length > 0) return [...new Set(parts)].join('\n')
  return `${source.name} (${source.type}) at ${source.filePath}`
}

function sourceSliceFor(source: CodeNodeRow, repoPath?: string): { code: string; missing: boolean } {
  if (!repoPath) return { code: '', missing: true }
  const content = readRepoFile(repoPath, source.filePath)
  if (content == null) return { code: '', missing: true }
  if (!source.lineStart || !source.lineEnd || source.lineStart < 1 || source.lineEnd < source.lineStart) {
    return { code: content, missing: false }
  }

  const lines = content.split(/\r?\n/)
  const code = lines.slice(source.lineStart - 1, source.lineEnd).join('\n')
  const imports = collectRelevantLeadingImports(lines, code, source.lineStart)
  return {
    code: imports.length > 0 ? [...imports, code].join('\n') : code,
    missing: false,
  }
}

function readRepoFile(repoPath: string, filePath: string): string | null {
  const abs = join(repoPath, filePath)
  if (!existsSync(abs)) return null
  return readFileSync(abs, 'utf-8')
}

function collectRelevantLeadingImports(lines: string[], sourceCode: string, lineStart: number): string[] {
  if (lineStart <= 1) return []
  const sourceTokens = extractIdentifierTokens(sourceCode)
  const imports: string[] = []
  let index = 0

  while (index < lines.length && index < lineStart - 1) {
    const line = lines[index]!
    if (!line.trim()) {
      index++
      continue
    }
    if (!line.trimStart().startsWith('import ')) break

    const statement: string[] = []
    let depth = 0
    while (index < lines.length && index < lineStart - 1) {
      const current = lines[index]!
      statement.push(current)
      const withoutStrings = stripQuotedText(current)
      for (const char of withoutStrings) {
        if (char === '{' || char === '(' || char === '[') depth++
        if (char === '}' || char === ')' || char === ']') depth--
      }
      index++
      if (depth <= 0 && /(?:;|\bfrom\b\s*['"][^'"]+['"];?)\s*$/.test(current.trim())) break
    }

    const importSource = statement.join('\n')
    const importTokens = extractIdentifierTokens(stripImportSpecifierText(importSource))
    if ([...importTokens].some((token) => sourceTokens.has(token))) imports.push(importSource)
  }

  return imports
}

function extractIdentifierTokens(sourceCode: string): Set<string> {
  return new Set([...sourceCode.matchAll(/\b[A-Za-z_$][\w$]*\b/g)].map((match) => match[0]))
}

function stripImportSpecifierText(sourceCode: string): string {
  return sourceCode.replace(/\bfrom\s*['"][^'"]+['"]/g, 'from')
    .replace(/\bimport\s*['"][^'"]+['"]/g, 'import')
}

function stripQuotedText(sourceCode: string): string {
  return sourceCode.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}
