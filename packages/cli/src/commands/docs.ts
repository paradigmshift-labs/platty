import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { and, asc, eq, inArray } from 'drizzle-orm'
import {
  BuildDocsCliRuntime,
  BuildDocsGenerationRuntimeError,
  listDocsTargets,
  normalizeDocsTargetKind,
  parseDraftJsonWithRepair,
  projectPointer,
  rebuildSharedCodeSegmentsForProject,
  resolveDocsTargetSelectors,
  resolveProjectSelector,
  runBuildDocsWorkerQueue,
  schema,
  upsertAnalysisReviewDecision,
  type BuildDocsRunnerPreset,
  type BuildDocsRunnerProvider,
  type BuildDocsTaskInvoker,
  type DB,
  type DocsTargetKind,
  type DocsTargetSelector,
  type DocsTargetStatus,
  type OpenPlattyDbResult,
} from '@platty/core'
import { plattyDir, readProjectConfig } from '../config-store.js'
import { openCliDb } from '../db.js'
import { failure, success, type PlattyCommandResponse } from '../output.js'
import { requirePlattyRoot } from '../project-root.js'

export interface DocsCommandOptions {
  cwd: string
  db?: DB
  openDb?: () => OpenPlattyDbResult
  project?: string
  docsTaskInvoker?: BuildDocsTaskInvoker
}

type ProjectRow = typeof schema.projects.$inferSelect
type DocumentRow = typeof schema.documents.$inferSelect
type DocumentItemRow = typeof schema.documentItems.$inferSelect
type CodeNodeRow = typeof schema.codeNodes.$inferSelect
type TechnicalDocumentType = 'api_spec' | 'screen_spec' | 'event_spec' | 'schedule_spec'

const {
  codeBundles,
  codeNodes,
  documentItemModelLinks,
  documentItemDocumentLinks,
  documentItems,
  documentLinks,
  documents,
  entryPoints,
  models,
  sharedCodeSegments,
} = schema

function value(argv: string[], flag: string) {
  const index = argv.indexOf(flag)
  if (index === -1) return undefined
  return argv[index + 1]
}

function optionValue(argv: string[], flag: string) {
  const option = value(argv, flag)?.trim()
  if (!option || option.startsWith('--')) return undefined
  return option
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag)
}

function positional(argv: string[]) {
  const values: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index]
    if (part === '--json') continue
    if (
      part === '--project' ||
      part === '--out' ||
      part === '--format' ||
      part === '--type' ||
      part === '--track' ||
      part === '--scope' ||
      part === '--validity' ||
      part === '--limit' ||
      part === '--document' ||
      part === '--kind' ||
      part === '--path' ||
      part === '--method' ||
      part === '--repo' ||
      part === '--ids' ||
      part === '--input' ||
      part === '--status' ||
      part === '--note' ||
      part === '--decided-by' ||
      part === '--requested-by'
    ) {
      index += 1
      continue
    }
    if (part === '--compact') continue
    values.push(part)
  }
  return values
}

async function requireProjectRoot(
  cwd: string,
): Promise<{ projectRoot: string; config: Awaited<ReturnType<typeof readProjectConfig>> } | PlattyCommandResponse> {
  const projectRoot = await requirePlattyRoot(cwd)
  if (!projectRoot) {
    const result = failure('PROJECT_ROOT_NOT_FOUND', 'Platty project root was not found', {
      nextAction: {
        type: 'init_required',
        command: ['platty', 'init'],
      },
    })
    return { exitCode: 2, result, stdout: '', stderr: '' }
  }
  return { projectRoot, config: await readProjectConfig(projectRoot) }
}

function projectNotSelected(): PlattyCommandResponse {
  const result = failure('PROJECT_NOT_SELECTED', 'No Platty project is selected', {
    nextAction: {
      type: 'select_project',
      command: ['platty', 'project', 'list'],
    },
  })
  return { exitCode: 2, result, stdout: '', stderr: '' }
}

function missingProject(): PlattyCommandResponse {
  const result = failure('PROJECT_NOT_FOUND', 'Platty project was not found', {
    nextAction: {
      type: 'list_projects',
      command: ['platty', 'project', 'list'],
      message: 'List available Platty projects.',
    },
  })
  return { exitCode: 2, result, stdout: '', stderr: '' }
}

function ambiguousProject(selector: string): PlattyCommandResponse {
  const result = failure('PROJECT_AMBIGUOUS', `Project selector matched multiple projects: ${selector}`, {
    nextAction: {
      type: 'list_projects',
      command: ['platty', 'project', 'list'],
      message: 'Use a project id to disambiguate.',
    },
  })
  return { exitCode: 2, result, stdout: '', stderr: '' }
}

function ok(data: unknown): PlattyCommandResponse {
  return { exitCode: 0, result: success(data), stdout: '', stderr: '' }
}

function required(argv: string[], flag: string): string {
  const option = optionValue(argv, flag)
  if (!option) throw new Error(`${flag} is required`)
  return option
}

function numberValue(argv: string[], flag: string, fallback: number): number {
  const option = optionValue(argv, flag)
  return option ? Number(option) : fallback
}

function languageValue(argv: string[]): 'ko' | 'en' {
  return optionValue(argv, '--language') === 'ko' ? 'ko' : 'en'
}

function documentTypesValue(argv: string[]): TechnicalDocumentType[] | undefined {
  const option = optionValue(argv, '--document-types')
  if (!option) return undefined
  return option.split(',').map((item) => item.trim()).filter(isTechnicalDocumentType)
}

function isTechnicalDocumentType(value: string): value is TechnicalDocumentType {
  return value === 'api_spec' || value === 'screen_spec' || value === 'event_spec' || value === 'schedule_spec'
}

function providerValue(argv: string[]): BuildDocsRunnerProvider {
  const provider = optionValue(argv, '--provider') ?? 'codex_cli'
  if (provider !== 'codex_cli' && provider !== 'claude_code') throw new Error(`Unsupported --provider: ${provider}`)
  return provider
}

function presetValue(argv: string[]): BuildDocsRunnerPreset | undefined {
  const preset = optionValue(argv, '--preset')
  if (preset === undefined) return undefined
  if (preset !== 'final-mixed' && preset !== 'balanced') throw new Error(`Unsupported --preset: ${preset}`)
  return preset
}

function idsValue(argv: string[]): string[] {
  const option = optionValue(argv, '--ids')
  if (!option) return []
  return option.split(',').map((id) => id.trim()).filter(Boolean)
}

function limitValue(argv: string[]): number {
  return numberValue(argv, '--limit', 200)
}

function offsetValue(argv: string[]): number {
  return numberValue(argv, '--offset', 0)
}

function docsTargetKindValue(argv: string[]): DocsTargetKind | 'all' | null | undefined {
  const option = optionValue(argv, '--kind')
  if (!option) return undefined
  if (option === 'all') return 'all'
  return normalizeDocsTargetKind(option)
}

function listDocsTargetKindValue(argv: string[]): DocsTargetKind | null | undefined {
  const kind = docsTargetKindValue(argv)
  if (kind === 'all') return undefined
  return kind
}

function mutationDocsTargetKindValue(argv: string[]): DocsTargetKind | null | undefined {
  const kind = docsTargetKindValue(argv)
  if (kind === 'all') return null
  return kind
}

function docsTargetStatusValue(argv: string[]): DocsTargetStatus | null | undefined {
  const option = optionValue(argv, '--status')
  if (!option) return undefined
  if (option === 'active' || option === 'deprecated' || option === 'all') return option
  return null
}

function emptyTargetKindCounts(): Record<DocsTargetKind, number> {
  return { api: 0, screen: 0, job: 0, event: 0 }
}

function countTargetsByKind(targets: Array<{ kind: DocsTargetKind }>): Record<DocsTargetKind, number> {
  const counts = emptyTargetKindCounts()
  for (const target of targets) counts[target.kind] += 1
  return counts
}

function targetSelectorFromValue(value: unknown): DocsTargetSelector | { error: string; message: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'TARGET_SELECTOR_INCOMPLETE', message: 'Target selector must be an object.' }
  }
  const item = value as Record<string, unknown>
  if (typeof item.id === 'string' && item.id.trim()) return { id: item.id.trim() }
  if (typeof item.kind !== 'string' || typeof item.path !== 'string' || !item.path.trim()) {
    return { error: 'TARGET_SELECTOR_INCOMPLETE', message: 'Target selector requires id or kind and path.' }
  }
  const kind = normalizeDocsTargetKind(item.kind)
  if (!kind) return { error: 'TARGET_SELECTOR_INCOMPLETE', message: `Invalid docs target kind: ${item.kind}` }
  if (item.method !== undefined && typeof item.method !== 'string') {
    return { error: 'TARGET_SELECTOR_INCOMPLETE', message: 'Target selector method must be a string.' }
  }
  if (item.repo !== undefined && typeof item.repo !== 'string') {
    return { error: 'TARGET_SELECTOR_INCOMPLETE', message: 'Target selector repo must be a string.' }
  }
  return {
    kind,
    path: item.path.trim(),
    ...(typeof item.method === 'string' && item.method.trim() ? { method: item.method.trim() } : {}),
    ...(typeof item.repo === 'string' && item.repo.trim() ? { repo: item.repo.trim() } : {}),
  }
}

async function targetSelectorsValue(argv: string[]): Promise<DocsTargetSelector[] | { error: string; message: string }> {
  const selectors: DocsTargetSelector[] = idsValue(argv).map((id) => ({ id }))
  const kind = mutationDocsTargetKindValue(argv)
  if (kind === null) {
    return { error: 'INVALID_TARGET_KIND', message: `Invalid docs target kind: ${optionValue(argv, '--kind') ?? ''}` }
  }

  const path = optionValue(argv, '--path')
  if (path && kind) {
    selectors.push({
      kind,
      path,
      ...(optionValue(argv, '--method') ? { method: optionValue(argv, '--method') } : {}),
      ...(optionValue(argv, '--repo') ? { repo: optionValue(argv, '--repo') } : {}),
    })
  }

  const inputPath = optionValue(argv, '--input')
  if (inputPath) {
    const input = await readJsonFile(inputPath)
    if (!Array.isArray(input)) {
      return { error: 'TARGET_SELECTOR_INCOMPLETE', message: '--input must contain a JSON array of target selectors' }
    }
    for (const item of input) {
      const selector = targetSelectorFromValue(item)
      if (!selector) {
        return { error: 'TARGET_SELECTOR_INCOMPLETE', message: 'Target selector requires id or kind and path.' }
      }
      if ('error' in selector) return selector
      selectors.push(selector)
    }
  }

  return selectors
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function readDraftJsonFile(path: string): Promise<unknown> {
  return parseDraftJsonWithRepair(await readFile(path, 'utf8'))
}

async function writePacketIfRequested(argv: string[], cwd: string, packet: unknown): Promise<unknown> {
  const outPath = optionValue(argv, '--out')
  if (!outPath) return packet
  const resolved = resolve(cwd, outPath)
  await mkdir(dirname(resolved), { recursive: true })
  await writeFile(resolved, `${JSON.stringify(packet, null, 2)}\n`, 'utf8')
  return typeof packet === 'object' && packet !== null && !Array.isArray(packet)
    ? { ...packet, packetPath: resolved }
    : { type: 'packet', packetPath: resolved }
}

function requireSelectedProject(
  db: DB,
  options: DocsCommandOptions,
  config: Awaited<ReturnType<typeof readProjectConfig>>,
): { project: ProjectRow } | PlattyCommandResponse {
  const selector = options.project?.trim() || config.currentProject?.id
  if (!selector) return projectNotSelected()

  const resolvedProject = resolveProjectSelector(db, selector, config.currentProject)
  if (resolvedProject.kind === 'missing') return missingProject()
  if (resolvedProject.kind === 'ambiguous') return ambiguousProject(selector)
  return { project: resolvedProject.project }
}

function activeDocuments(db: DB, projectId: string) {
  return db
    .select()
    .from(documents)
    .where(and(eq(documents.projectId, projectId), inArray(documents.status, ['active', 'passed'])))
    .orderBy(asc(documents.type), asc(documents.scope), asc(documents.scopeId), asc(documents.id))
    .all()
}

function activeItems(db: DB, projectId: string) {
  return db
    .select()
    .from(documentItems)
    .where(and(eq(documentItems.projectId, projectId), eq(documentItems.status, 'active')))
    .orderBy(asc(documentItems.documentId), asc(documentItems.ordinal), asc(documentItems.id))
    .all()
}

function documentView(doc: DocumentRow, itemCount: number) {
  return {
    id: doc.id,
    projectId: doc.projectId,
    type: doc.type,
    track: doc.track,
    scope: doc.scope,
    scopeId: doc.scopeId,
    status: doc.status,
    validity: doc.validity,
    summary: doc.summary,
    sourceRunId: doc.sourceRunId,
    sourceCommit: doc.sourceCommit,
    updatedAt: doc.updatedAt,
    freshness: documentFreshness(doc),
    itemCount,
  }
}

function compactDocumentView(doc: DocumentRow, itemCount: number) {
  return {
    id: doc.id,
    type: doc.type,
    track: doc.track,
    scope: doc.scope,
    scopeId: doc.scopeId,
    status: doc.status,
    title: contentTitle(doc.content),
    summary: doc.summary,
    itemCount,
    freshness: documentFreshness(doc),
  }
}

function filteredDocuments(docs: DocumentRow[], argv: string[]) {
  const type = optionValue(argv, '--type')
  const track = optionValue(argv, '--track')
  const scope = optionValue(argv, '--scope')
  const validity = optionValue(argv, '--validity')
  const limit = optionValue(argv, '--limit')
  const parsedLimit = limit ? Number(limit) : undefined

  const filtered = docs.filter((doc) => {
    if (type && doc.type !== type) return false
    if (track && doc.track !== track) return false
    if (scope && doc.scope !== scope) return false
    if (validity && doc.validity !== validity) return false
    return true
  })

  if (Number.isInteger(parsedLimit) && parsedLimit! >= 0) return filtered.slice(0, parsedLimit)
  return filtered
}

function itemView(item: DocumentItemRow) {
  return {
    id: item.id,
    documentId: item.documentId,
    projectId: item.projectId,
    itemType: item.itemType,
    stableKey: item.stableKey,
    ordinal: item.ordinal,
    title: item.title,
    summary: item.summary,
    content: item.content,
    contentHash: item.contentHash,
    status: item.status,
    updatedAt: item.updatedAt,
  }
}

function stringField(value: unknown) {
  return typeof value === 'string' ? value : null
}

function contentTitle(content: Record<string, unknown> | null) {
  return stringField(content?.title)
}

function contentPath(content: Record<string, unknown> | null) {
  return stringField(content?.path)
}

function documentFreshness(doc: DocumentRow) {
  return {
    validity: doc.validity,
    isStale: doc.validity !== 'fresh',
    sourceCommit: doc.sourceCommit ?? null,
    sourceRunId: doc.sourceRunId ?? null,
    staticSnapshotId: doc.staticSnapshotId ?? null,
    documentSourceHash: doc.documentSourceHash ?? null,
    updatedAt: doc.updatedAt,
  }
}

function searchableText(values: unknown[]) {
  return values
    .map((field) => {
      if (field === null || field === undefined) return ''
      if (typeof field === 'string') return field
      return JSON.stringify(field)
    })
    .join('\n')
    .toLowerCase()
}

function documentMatches(doc: DocumentRow, query: string) {
  return searchableText([
    doc.id,
    doc.type,
    doc.track,
    doc.scope,
    doc.scopeId,
    doc.summary,
    contentTitle(doc.content),
    contentPath(doc.content),
    doc.content,
  ]).includes(query)
}

function itemMatches(item: DocumentItemRow, query: string) {
  return searchableText([
    item.id,
    item.itemType,
    item.stableKey,
    item.title,
    item.summary,
    contentPath(item.content),
    item.content,
  ]).includes(query)
}

function searchDocs(db: DB, project: ProjectRow, query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  const docs = activeDocuments(db, project.id)
  const activeDocIds = new Set(docs.map((doc) => doc.id))
  const docById = new Map(docs.map((doc) => [doc.id, doc]))
  const items = activeItems(db, project.id).filter((item) => activeDocIds.has(item.documentId))

  return [
    ...docs
      .filter((doc) => documentMatches(doc, normalizedQuery))
      .map((doc) => ({
        kind: 'document' as const,
        documentId: doc.id,
        itemId: null,
        title: contentTitle(doc.content),
        type: doc.type,
        path: contentPath(doc.content),
        summary: doc.summary,
        freshness: documentFreshness(doc),
        evidenceRefs: [{ label: 'document', path: doc.id }],
      })),
    ...items
      .filter((item) => itemMatches(item, normalizedQuery))
      .map((item) => {
        const doc = docById.get(item.documentId)
        return {
          kind: 'item' as const,
          documentId: item.documentId,
          itemId: item.id,
          title: item.title,
          type: item.itemType,
          path: contentPath(item.content) ?? contentPath(doc?.content ?? null),
          summary: item.summary,
          freshness: doc ? documentFreshness(doc) : null,
          evidenceRefs: [
            { label: 'document', path: item.documentId },
            { label: 'document-item', path: item.id },
          ],
        }
      }),
  ]
}

function isVisibleDocument(doc: DocumentRow): boolean {
  return (doc.status === 'active' || doc.status === 'passed') && doc.validity !== 'orphaned'
}

function documentMiniView(doc: DocumentRow) {
  return {
    id: doc.id,
    type: doc.type,
    track: doc.track,
    scope: doc.scope,
    scopeId: doc.scopeId,
    status: doc.status,
    validity: doc.validity,
    title: contentTitle(doc.content),
    summary: doc.summary,
    freshness: documentFreshness(doc),
  }
}

function documentNotFound(documentId: string): PlattyCommandResponse {
  const result = failure('DOCS_DOCUMENT_NOT_FOUND', `Document was not found: ${documentId}`)
  return { exitCode: 2, result, stdout: '', stderr: '' }
}

function showDocument(db: DB, project: ProjectRow, documentId: string) {
  const doc = activeDocuments(db, project.id).find((candidate) => candidate.id === documentId && isVisibleDocument(candidate))
  if (!doc) return null
  const items = activeItems(db, project.id).filter((item) => item.documentId === documentId)
  const related = relatedDocuments(db, project, documentId)
  const modelLinks = modelLinksForItems(db, project.id, items.map((item) => item.id))
  return {
    project: projectPointer(project),
    document: {
      ...documentView(doc, items.length),
      content: doc.content,
    },
    items: items.map((item) => ({
      ...itemView(item),
      targetDocumentLinks: (related?.itemDocumentLinks ?? [])
        .filter((link) => link.fromItemId === item.id)
        .map((link) => ({
          documentId: link.documentId,
          linkType: link.linkType,
          role: link.role,
          createdBy: link.createdBy,
          target: link.target,
        })),
      relatedItems: [],
      modelLinks: modelLinks.get(item.id) ?? [],
    })),
    code: codeEvidenceForDocument(db, doc),
    relatedDocuments: {
      outgoing: related?.outgoingDocumentLinks ?? [],
      incoming: related?.incomingDocumentLinks ?? [],
      itemDocumentLinks: related?.itemDocumentLinks ?? [],
    },
  }
}

function modelLinksForItems(db: DB, projectId: string, itemIds: string[]) {
  const result = new Map<string, Array<Record<string, unknown>>>()
  if (itemIds.length === 0) return result
  const modelRows = db.select().from(models).all()
  const modelById = new Map(modelRows.map((model) => [model.id, model]))
  const links = db.select().from(documentItemModelLinks)
    .where(and(eq(documentItemModelLinks.projectId, projectId), inArray(documentItemModelLinks.itemId, itemIds)))
    .all()
  for (const link of links) {
    const model = modelById.get(link.modelId)
    const field = model?.fields.find((candidate) => candidate.name === link.fieldName) ?? null
    const rows = result.get(link.itemId) ?? []
    rows.push({
      modelId: link.modelId,
      modelName: model?.name ?? null,
      tableName: model?.tableName ?? null,
      fieldName: link.fieldName,
      linkType: link.linkType,
      role: link.role,
      evidence: link.evidenceJson ?? null,
      field,
      model: model
        ? {
            id: model.id,
            name: model.name,
            tableName: model.tableName,
            description: model.description,
            sourceFile: model.sourceFile,
            lineStart: model.lineStart,
            lineEnd: model.lineEnd,
            orm: model.orm,
            validity: model.validity,
          }
        : null,
    })
    result.set(link.itemId, rows)
  }
  return result
}

function codeEvidenceForDocument(db: DB, doc: DocumentRow) {
  if (doc.type !== 'api_spec' && doc.type !== 'screen_spec' && doc.type !== 'event_spec' && doc.type !== 'schedule_spec') return null
  if (!doc.scopeId) return null
  const entryPoint = db.select().from(entryPoints).where(eq(entryPoints.id, doc.scopeId)).get()
  if (!entryPoint) return null
  const nodeRows = db.select().from(codeNodes).all()
  const nodeById = new Map(nodeRows.map((node) => [node.id, node]))
  const primaryNode = nodeById.get(entryPoint.handlerNodeId)
  const bundleRows = db.select().from(codeBundles)
    .where(eq(codeBundles.entryPointId, entryPoint.id))
    .all()
    .sort((left, right) => left.depth - right.depth || left.nodeId.localeCompare(right.nodeId))
  return {
    entryPoint: {
      id: entryPoint.id,
      kind: entryPoint.kind,
      framework: entryPoint.framework,
      method: entryPoint.httpMethod,
      path: entryPoint.fullPath ?? entryPoint.path,
      confidence: entryPoint.confidence,
      detectionSource: entryPoint.detectionSource,
    },
    primaryNode: primaryNode ? codeNodeView(primaryNode, 'primary') : null,
    relatedNodes: bundleRows
      .filter((bundle) => bundle.nodeId !== entryPoint.handlerNodeId)
      .flatMap((bundle) => {
        const node = nodeById.get(bundle.nodeId)
        return node ? [{ ...codeNodeView(node, 'reachable'), depth: bundle.depth, edgePath: bundle.edgePath ?? [] }] : []
      }),
  }
}

function codeNodeView(node: CodeNodeRow, role: 'primary' | 'reachable') {
  return {
    nodeId: node.id,
    role,
    kind: node.type,
    symbol: node.name,
    signature: node.signature,
    filePath: node.filePath,
    startLine: node.lineStart,
    endLine: node.lineEnd,
    missingLocationReason: node.lineStart === null ? 'line_start_missing' : null,
  }
}

function relatedDocuments(db: DB, project: ProjectRow, documentId: string) {
  const docs = activeDocuments(db, project.id).filter(isVisibleDocument)
  const docById = new Map(docs.map((doc) => [doc.id, doc]))
  const sourceDoc = docById.get(documentId)
  if (!sourceDoc) return null

  const outgoingDocumentLinks = db.select().from(documentLinks)
    .where(eq(documentLinks.fromDocumentId, documentId))
    .all()
    .flatMap((link) => {
      const target = docById.get(link.toDocumentId)
      if (!target) return []
      return [{
        fromDocumentId: link.fromDocumentId,
        documentId: link.toDocumentId,
        linkType: link.linkType,
        createdBy: link.createdBy,
        target: documentMiniView(target),
      }]
    })
  const incomingDocumentLinks = db.select().from(documentLinks)
    .where(eq(documentLinks.toDocumentId, documentId))
    .all()
    .flatMap((link) => {
      const source = docById.get(link.fromDocumentId)
      if (!source) return []
      return [{
        fromDocumentId: link.fromDocumentId,
        documentId: link.toDocumentId,
        linkType: link.linkType,
        createdBy: link.createdBy,
        source: documentMiniView(source),
      }]
    })

  const items = activeItems(db, project.id).filter((item) => item.documentId === documentId)
  const itemIds = items.map((item) => item.id)
  const itemDocumentLinks = itemIds.length === 0
    ? []
    : db.select().from(documentItemDocumentLinks)
      .where(inArray(documentItemDocumentLinks.fromItemId, itemIds))
      .all()
      .flatMap((link) => {
        const target = docById.get(link.toDocumentId)
        if (!target) return []
        return [{
          fromItemId: link.fromItemId,
          documentId: link.toDocumentId,
          linkType: link.linkType,
          role: link.role,
          createdBy: link.createdBy,
          target: documentMiniView(target),
        }]
      })

  return {
    project: projectPointer(project),
    documentId,
    source: documentMiniView(sourceDoc),
    outgoingDocumentLinks,
    incomingDocumentLinks,
    itemDocumentLinks,
  }
}

function docsForExport(db: DB, project: ProjectRow) {
  const docs = activeDocuments(db, project.id)
  const itemsByDocument = new Map<string, DocumentItemRow[]>()
  for (const item of activeItems(db, project.id)) {
    const items = itemsByDocument.get(item.documentId) ?? []
    items.push(item)
    itemsByDocument.set(item.documentId, items)
  }

  return {
    project: projectPointer(project),
    documents: docs.map((doc) => ({
      id: doc.id,
      projectId: doc.projectId,
      type: doc.type,
      track: doc.track,
      scope: doc.scope,
      scopeId: doc.scopeId,
      status: doc.status,
      validity: doc.validity,
      summary: doc.summary,
      content: doc.content,
      sourceRunId: doc.sourceRunId,
      sourceCommit: doc.sourceCommit,
      updatedAt: doc.updatedAt,
      items: (itemsByDocument.get(doc.id) ?? []).map(itemView),
    })),
  }
}

function renderMarkdownExport(exportData: ReturnType<typeof docsForExport>) {
  const lines = [`# ${exportData.project.name}`, '']
  for (const doc of exportData.documents) {
    lines.push(`## ${doc.id}`, '')
    lines.push(`- Type: ${doc.type}`)
    lines.push(`- Track: ${doc.track}`)
    lines.push(`- Scope: ${doc.scope}${doc.scopeId ? `:${doc.scopeId}` : ''}`)
    if (doc.summary) lines.push(`- Summary: ${doc.summary}`)
    lines.push('', '```json', JSON.stringify(doc.content ?? {}, null, 2), '```', '')
    for (const item of doc.items) {
      lines.push(`### ${item.title ?? item.id}`, '')
      if (item.summary) lines.push(item.summary, '')
      lines.push('```json', JSON.stringify(item.content, null, 2), '```', '')
    }
  }
  return `${lines.join('\n')}\n`
}

function exportFormat(argv: string[], outPath: string) {
  const requested = value(argv, '--format')?.trim().toLowerCase()
  if (requested === 'markdown' || requested === 'md') return 'markdown'
  return outPath.endsWith('.md') || outPath.endsWith('.markdown') ? 'markdown' : 'json'
}

const DOCS_HELP = `\
Usage: platty docs <command> [options]

Run and inspect technical-document generation workflows.

Commands:
  list                              List all active documents
  search <query>                    Search documents by content
  show --document <id>              Show document details and items
  related --document <id>           Show related documents
  export --out <path>               Export documents to JSON or Markdown
  targets list                      List documentation generation targets
  targets deprecate                 Mark targets as deprecated
  targets include                   Restore deprecated targets
  shared-segments list              List shared code segments
  shared-segments rebuild           Rebuild shared code segments
  start                             Start a docs generation run
  run                               Run the docs worker queue
  preview --run-id <id>             Preview a run's planned tasks
  approve --run-id <id>             Approve pending tasks
  status --run-id <id>              Check run status
  cancel --run-id <id>              Cancel an active run
  tasks lease --run-id <id>         Lease tasks for a worker
  tasks submit                      Submit task results
  worker next --run-id <id>         Get next work packet for a worker
  context get                       Get task context bundle
  leases release --run-id <id>      Release active leases

Targets:
  Targets are build_route entry points: api, screen, job, and event.
  --kind api|screen|job|event|all    Filter target kind for targets list
  --status active|deprecated|all     Filter review status for targets list
  --ids <id,id>                      Select targets for deprecate/include
  --kind <kind> --path <path>        Select one target for deprecate/include

Options:
  --json                            Machine-readable JSON output
  --project <selector>              Target project (id, name, or current)
  -h, --help                        Display help for command
`

export async function runDocsCommand(argv: string[], options: DocsCommandOptions): Promise<PlattyCommandResponse> {
  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    return { exitCode: 0, result: success(), stdout: DOCS_HELP, stderr: '', skipDefaultRender: true }
  }

  const root = await requireProjectRoot(options.cwd)
  if ('exitCode' in root) return root

  const openedDb = options.db ? null : (options.openDb?.() ?? openCliDb())
  const db = options.db ?? openedDb!.db

  try {
    const [subcommand, ...rest] = positional(argv)
    if (!subcommand) {
      const result = failure('DOCS_COMMAND_REQUIRED', 'Docs command requires a subcommand.', {
        nextAction: {
          type: 'choose_command',
          commands: [
            ['platty', 'docs', 'list', '--json'],
            ['platty', 'docs', 'search', '<query>', '--json'],
            ['platty', 'docs', 'targets', 'list', '--json'],
          ],
        },
      })
      return { exitCode: 2, result, stdout: '', stderr: '' }
    }
    const runtime = new BuildDocsCliRuntime({ db })

    if (subcommand === 'shared-segments') {
      const selected = requireSelectedProject(db, options, root.config)
      if ('exitCode' in selected) return selected
      if (rest[0] === 'rebuild') {
        const rebuilt = await rebuildSharedCodeSegmentsForProject({
          db,
          projectId: selected.project.id,
        })
        return ok({
          command: 'docs shared-segments rebuild',
          project_id: selected.project.id,
          rebuilt_repo_count: rebuilt.rebuilt_repo_count,
          segment_count: rebuilt.segment_count,
          detector_version: rebuilt.detector_version,
        })
      }
      if (rest[0] === 'list') {
        const rows = db.select()
          .from(sharedCodeSegments)
          .where(and(eq(sharedCodeSegments.projectId, selected.project.id), eq(sharedCodeSegments.validity, 'fresh')))
          .orderBy(asc(sharedCodeSegments.usedByEntryPointCount), asc(sharedCodeSegments.rootFilePath), asc(sharedCodeSegments.rootSymbol))
          .all()
        return ok({
          command: 'docs shared-segments list',
          project_id: selected.project.id,
          segments: rows.map((row) => ({
            segment_id: row.id,
            root_node_id: row.rootNodeId,
            root_symbol: row.rootSymbol,
            root_file_path: row.rootFilePath,
            used_by_entrypoint_count: row.usedByEntryPointCount,
            covered_node_count: row.coveredNodeIdsJson.length,
            summary_status: row.summaryStatus,
          })),
        })
      }
      const result = failure('UNKNOWN_COMMAND', `Unknown docs shared-segments command: ${rest[0] ?? ''}`)
      return { exitCode: 2, result, stdout: '', stderr: '' }
    }

    if (subcommand === 'targets' && rest[0] === 'list') {
      const selected = requireSelectedProject(db, options, root.config)
      if ('exitCode' in selected) return selected

      const kind = listDocsTargetKindValue(argv)
      if (kind === null) {
        const result = failure('INVALID_TARGET_KIND', `Invalid docs target kind: ${optionValue(argv, '--kind') ?? ''}`)
        return { exitCode: 2, result, stdout: '', stderr: '' }
      }
      const status = docsTargetStatusValue(argv)
      if (status === null) {
        const result = failure('INVALID_TARGET_STATUS', `Invalid docs target status: ${optionValue(argv, '--status') ?? ''}`)
        return { exitCode: 2, result, stdout: '', stderr: '' }
      }

      const listed = listDocsTargets(db, {
        projectId: selected.project.id,
        kind,
        status,
        repo: optionValue(argv, '--repo'),
        method: optionValue(argv, '--method'),
        search: optionValue(argv, '--search'),
        limit: limitValue(argv),
        offset: offsetValue(argv),
      })
      if ('code' in listed) {
        const result = failure(listed.code, listed.message)
        return { exitCode: 2, result, stdout: '', stderr: '' }
      }

      return ok({
        project: projectPointer(selected.project),
        summary: listed.summary,
        pagination: listed.pagination,
        targets: listed.targets,
      })
    }

    if (subcommand === 'targets' && (rest[0] === 'deprecate' || rest[0] === 'include')) {
      const selected = requireSelectedProject(db, options, root.config)
      if ('exitCode' in selected) return selected

      const selectors = await targetSelectorsValue(argv)
      if (!Array.isArray(selectors)) {
        const result = failure(selectors.error, selectors.message)
        return { exitCode: 2, result, stdout: '', stderr: '' }
      }
      if (selectors.length === 0) {
        const result = failure('TARGET_SELECTOR_REQUIRED', 'docs targets mutation requires --ids, --kind/--path, or --input')
        return { exitCode: 2, result, stdout: '', stderr: '' }
      }

      const resolved = resolveDocsTargetSelectors(db, {
        projectId: selected.project.id,
        selectors,
      })
      if ('code' in resolved) {
        const result = failure(resolved.code, resolved.message, {
          ...('candidates' in resolved ? { data: { candidates: resolved.candidates } } : {}),
        })
        return { exitCode: 2, result, stdout: '', stderr: '' }
      }

      const decision = rest[0] === 'deprecate' ? 'deprecated' : 'include'
      const reason = decision === 'deprecated' ? 'user_manual' : 'restored'
      const decidedBy = optionValue(argv, '--decided-by') ?? optionValue(argv, '--requested-by') ?? 'cli'
      for (const target of resolved.targets) {
        upsertAnalysisReviewDecision(db, {
          projectId: selected.project.id,
          repoId: target.repoId,
          targetType: target.targetType,
          targetId: target.id,
          targetSource: 'entry_point',
          decision,
          reason,
          note: optionValue(argv, '--note') ?? null,
          decidedBy,
        })
      }

      const updatedByKind = countTargetsByKind(resolved.targets)
      return ok({
        project: projectPointer(selected.project),
        decision,
        updated: resolved.targets.map((target) => ({
          id: target.id,
          kind: target.kind,
          targetType: target.targetType,
          repoId: target.repoId,
          path: target.path,
          method: target.method,
        })),
        updatedByKind,
        updated_by_kind: updatedByKind,
        skipped: [],
      })
    }

    if (subcommand === 'start') {
      const selected = requireSelectedProject(db, options, root.config)
      if ('exitCode' in selected) return selected
      return ok(await runtime.start({
        projectId: selected.project.id,
        outputLanguage: languageValue(argv),
        requestedBy: optionValue(argv, '--requested-by') ?? 'user',
        mode: hasFlag(argv, '--full') ? 'full' : undefined,
        syncPlanId: optionValue(argv, '--sync-plan'),
        includeStaleCandidates: hasFlag(argv, '--include-stale-candidates'),
      }))
    }

    if (subcommand === 'run') {
      const selected = requireSelectedProject(db, options, root.config)
      if ('exitCode' in selected) return selected
      const provider = providerValue(argv)
      if (provider !== 'codex_cli' && !options.docsTaskInvoker) {
        return {
          exitCode: 2,
          result: failure('CLAUDE_CODE_HEADLESS_UNSUPPORTED', 'Claude Code is not available as a headless build_docs worker runner. Use codex_cli for docs run.'),
          stdout: '',
          stderr: '',
        }
      }
      const workDir = optionValue(argv, '--work-dir') ?? resolve(plattyDir(root.projectRoot), 'tmp', 'build_docs_runs')
      const workers = numberValue(argv, '--workers', 20)
      return ok(await runBuildDocsWorkerQueue({
        runtime,
        projectId: selected.project.id,
        runId: optionValue(argv, '--run-id'),
        provider,
        preset: presetValue(argv),
        workers,
        maxConcurrentTasks: numberValue(argv, '--max-concurrent-tasks', workers),
        requestedBy: optionValue(argv, '--requested-by') ?? 'user',
        approvedBy: optionValue(argv, '--approved-by') ?? optionValue(argv, '--requested-by') ?? 'user',
        outputLanguage: languageValue(argv),
        mode: hasFlag(argv, '--full') ? 'full' : undefined,
        syncPlanId: optionValue(argv, '--sync-plan'),
        includeStaleCandidates: hasFlag(argv, '--include-stale-candidates'),
        documentTypes: documentTypesValue(argv),
        workDir: resolve(options.cwd, workDir),
        taskInvoker: options.docsTaskInvoker,
      }))
    }

    if (subcommand === 'preview') {
      return ok(await runtime.preview({ runId: required(argv, '--run-id') }))
    }

    if (subcommand === 'approve') {
      return ok(await runtime.approve({
        runId: required(argv, '--run-id'),
        maxConcurrentTasks: numberValue(argv, '--max-concurrent-tasks', 1),
        approvedBy: optionValue(argv, '--approved-by') ?? 'user',
      }))
    }

    if (subcommand === 'tasks' && rest[0] === 'lease') {
      const limit = numberValue(argv, '--limit', 1)
      if (limit <= 1) {
        return ok(await runtime.leaseTask({
          runId: required(argv, '--run-id'),
          workerId: optionValue(argv, '--worker-id') ?? 'worker:cli',
          documentTypes: documentTypesValue(argv),
        }))
      }
      return ok(await runtime.leaseTasks({
        runId: required(argv, '--run-id'),
        workerGroupId: optionValue(argv, '--worker-group-id') ?? optionValue(argv, '--worker-id') ?? 'worker:cli',
        limit,
        documentTypes: documentTypesValue(argv),
      }))
    }

    if (subcommand === 'worker' && rest[0] === 'next') {
      const packet = await runtime.workerNext({
        runId: required(argv, '--run-id'),
        workerId: optionValue(argv, '--worker-id') ?? 'worker:docs:cli',
        documentTypes: documentTypesValue(argv),
      })
      return ok(await writePacketIfRequested(argv, options.cwd, packet))
    }

    if (subcommand === 'context' && rest[0] === 'get') {
      return ok(await runtime.getContext({ taskId: required(argv, '--task-id'), leaseToken: required(argv, '--lease-token') }))
    }

    if (subcommand === 'context' && rest[0] === 'page') {
      return ok(await runtime.getContextPage({
        contextHandle: required(argv, '--context-handle'),
        pageToken: required(argv, '--page-token'),
        leaseToken: required(argv, '--lease-token'),
      }))
    }

    if (subcommand === 'tasks' && rest[0] === 'submit') {
      return ok(await runtime.submitTask({
        taskId: required(argv, '--task-id'),
        leaseToken: required(argv, '--lease-token'),
        document: await readDraftJsonFile(required(argv, '--input')),
        workerNotes: optionValue(argv, '--worker-notes'),
      }))
    }

    if (subcommand === 'status') {
      return ok(await runtime.status({ runId: required(argv, '--run-id') }))
    }

    if (subcommand === 'cancel') {
      return ok(await runtime.cancel({ runId: required(argv, '--run-id'), reason: optionValue(argv, '--reason') }))
    }

    if (subcommand === 'leases' && rest[0] === 'release') {
      return ok(await runtime.releaseActiveLeases({
        runId: required(argv, '--run-id'),
        reason: optionValue(argv, '--reason') || 'manual_release',
      }))
    }

    const selected = requireSelectedProject(db, options, root.config)
    if ('exitCode' in selected) return selected
    const project = selected.project

    if (subcommand === 'list') {
      const items = activeItems(db, project.id)
      const itemCounts = new Map<string, number>()
      for (const item of items) {
        itemCounts.set(item.documentId, (itemCounts.get(item.documentId) ?? 0) + 1)
      }
      const docs = filteredDocuments(activeDocuments(db, project.id), argv)
      const compact = hasFlag(argv, '--compact')
      return ok({
        project: projectPointer(project),
        documents: docs.map((doc) => compact
          ? compactDocumentView(doc, itemCounts.get(doc.id) ?? 0)
          : documentView(doc, itemCounts.get(doc.id) ?? 0)),
      })
    }

    if (subcommand === 'search') {
      const query = rest.join(' ').trim()
      if (!query) {
        const result = failure('DOCS_SEARCH_QUERY_REQUIRED', 'docs search requires a query')
        return { exitCode: 2, result, stdout: '', stderr: '' }
      }
      const result = success({
        project: projectPointer(project),
        query,
        results: searchDocs(db, project, query),
      }, {
        evidenceRefs: [{ label: 'documents', path: `project:${project.name}` }],
      })
      return { exitCode: 0, result, stdout: '', stderr: '' }
    }

    if (subcommand === 'show' || subcommand === 'related') {
      const documentId = optionValue(argv, '--document')
      if (!documentId) {
        const result = failure('DOCS_DOCUMENT_REQUIRED', 'docs show/related requires --document')
        return { exitCode: 2, result, stdout: '', stderr: '' }
      }
      if (subcommand === 'show') {
        const shown = showDocument(db, project, documentId)
        if (!shown) return documentNotFound(documentId)
        return ok(shown)
      }
      const related = relatedDocuments(db, project, documentId)
      if (!related) return documentNotFound(documentId)
      return ok(related)
    }

    if (subcommand === 'export') {
      const outPath = optionValue(argv, '--out')
      if (!outPath) {
        const result = failure('DOCS_EXPORT_OUT_REQUIRED', 'docs export requires an explicit --out path')
        return { exitCode: 2, result, stdout: '', stderr: '' }
      }

      const absoluteOutPath = resolve(options.cwd, outPath)
      const exportData = docsForExport(db, project)
      const format = exportFormat(argv, absoluteOutPath)
      const content = format === 'markdown'
        ? renderMarkdownExport(exportData)
        : `${JSON.stringify(exportData, null, 2)}\n`
      await mkdir(dirname(absoluteOutPath), { recursive: true })
      await writeFile(absoluteOutPath, content, 'utf8')

      const result = success({
        project: projectPointer(project),
        outPath: absoluteOutPath,
        format,
        documentCount: exportData.documents.length,
        itemCount: exportData.documents.reduce((count, doc) => count + doc.items.length, 0),
      }, {
        evidenceRefs: [{ label: 'docs-export', path: absoluteOutPath }],
      })
      return { exitCode: 0, result, stdout: '', stderr: '' }
    }

    const result = failure('UNKNOWN_COMMAND', `Unknown docs command: ${subcommand ?? ''}`)
    return { exitCode: 2, result, stdout: '', stderr: '' }
  } catch (error) {
    if (error instanceof BuildDocsGenerationRuntimeError) {
      return {
        exitCode: error.code === 'BUILD_DOCS_PRECONDITION_FAILED' ? 2 : 1,
        result: failure(error.code, error.message, {
          ...(error.details ? { data: { details: error.details } } : {}),
          ...(error.nextAction ? { nextAction: error.nextAction } : {}),
        }),
        stdout: '',
        stderr: '',
      }
    }
    const message = error instanceof Error ? error.message : 'docs command failed'
    return { exitCode: 1, result: failure('DOCS_COMMAND_FAILED', message), stdout: '', stderr: '' }
  } finally {
    openedDb?.close()
  }
}
