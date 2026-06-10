import { asc, eq } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { documentLinks, documents, documentItems } from '@/db/schema/build_docs.js'
import { epicDependencies } from '@/db/schema/build_epics.js'
import { serviceMapEdges, serviceMapNodes } from '@/db/schema/build_service_map.js'
import { epicDomains, epics, repositories } from '@/db/schema/core.js'

export interface BusinessMapArtifact {
  projectId: string
  generatedAt: string
  summary: {
    domainCount: number
    epicCount: number
    businessDocumentCount: number
    ucsCount: number
    documentItemCount: number
    serviceNodeCount: number
    serviceEdgeCount: number
    repoCount: number
    docSourceLinkCount: number
    epicDependencyCount: number
  }
  views: {
    businessContext: {
      domains: BusinessMapDomain[]
      projectDocuments: BusinessMapDocument[]
      epicDependencies: BusinessMapEpicDependency[]
    }
    serviceCore: {
      repoZones: BusinessMapRepoZone[]
      edges: BusinessMapServiceEdge[]
    }
    links: {
      docSource: BusinessMapDocSourceLink[]
    }
  }
}

export interface BusinessMapDomain {
  id: string
  name: string
  summary?: string | null
  epics: BusinessMapEpic[]
}

export interface BusinessMapEpic {
  id: string
  name: string
  summary?: string | null
  domainId?: string | null
  documents: BusinessMapDocument[]
  itemCount: number
}

export interface BusinessMapDocument {
  id: string
  type: string
  scope: string
  scopeId?: string | null
  title: string
  summary?: string | null
  markdown: string
  viewer: BusinessMapDocumentViewer
  items: BusinessMapDocumentItem[]
}

export interface BusinessMapDocumentItem {
  id: string
  itemType: string
  title?: string | null
  summary?: string | null
}

export interface BusinessMapDocumentViewer {
  kind: string
  sequenceDiagrams: BusinessMapSequenceDiagram[]
}

export interface BusinessMapSequenceDiagram {
  title: string
  mermaid: string
}

export interface BusinessMapRepoZone {
  id: string
  label: string
  nodes: BusinessMapServiceNode[]
}

export interface BusinessMapServiceNode {
  id: string
  type: string
  label: string
  repoId?: string | null
  detail?: string | null
}

export interface BusinessMapServiceEdge {
  id: string
  source: string
  target: string
  kind: string
  unresolved?: boolean
}

export interface BusinessMapDocSourceLink {
  documentId: string
  serviceNodeId: string
  technicalDocumentId: string
  linkType: string
}

export interface BusinessMapEpicDependency {
  sourceEpicId: string
  targetEpicId: string
  kind: string
  reason: string
  sourceHasDocuments: boolean
  targetHasDocuments: boolean
}

const BUSINESS_DOC_TYPES = new Set(['br', 'design', 'ucl', 'ucs', 'data_dictionary', 'glossary'])

export function buildBusinessMapArtifact(input: {
  db: DB
  projectId: string
  generatedAt: string
}): BusinessMapArtifact {
  const repoRows = input.db.select().from(repositories).where(eq(repositories.projectId, input.projectId)).all()
    .filter((repo) => !repo.deletedAt)
  const domainRows = input.db.select().from(epicDomains).where(eq(epicDomains.projectId, input.projectId)).orderBy(asc(epicDomains.sortOrder), asc(epicDomains.name)).all()
    .filter((domain) => !domain.deletedAt)
  const epicRows = input.db.select().from(epics).where(eq(epics.projectId, input.projectId)).orderBy(asc(epics.name)).all()
    .filter((epic) => !epic.deletedAt)
  const docRows = input.db.select().from(documents).where(eq(documents.projectId, input.projectId)).all()
  const itemRows = input.db.select().from(documentItems).where(eq(documentItems.projectId, input.projectId)).all()
    .filter((item) => item.status === 'active')
  const linkRows = input.db.select().from(documentLinks).all()
  const serviceRows = input.db.select().from(serviceMapNodes).where(eq(serviceMapNodes.projectId, input.projectId)).all()
  const serviceEdgeRows = input.db.select().from(serviceMapEdges).where(eq(serviceMapEdges.projectId, input.projectId)).all()
  const dependencyRows = input.db.select().from(epicDependencies).all()

  const businessDocs = docRows
    .filter((doc) => doc.track === 'business' && doc.status === 'active' && BUSINESS_DOC_TYPES.has(doc.type))
    .map((doc) => documentNode(doc, itemRows.filter((item) => item.documentId === doc.id)))
  const technicalDocs = docRows.filter((doc) => doc.track === 'technical' && ['active', 'passed'].includes(doc.status))
  const technicalDocById = new Map(technicalDocs.map((doc) => [doc.id, doc]))
  const serviceByScopeId = new Map(serviceRows.flatMap((node) => [
    [node.nodeId, node],
    [node.sourceId, node],
    [node.canonicalKey, node],
  ].filter((entry): entry is [string, typeof node] => Boolean(entry[0]))))

  const ucsDocs = businessDocs.filter((doc) => doc.type === 'ucs')
  const epicDocs = businessDocs.filter((doc) => doc.scope === 'epic' && doc.scopeId)
  const epicDocsByEpicId = new Map<string, BusinessMapDocument[]>()
  for (const doc of epicDocs) append(epicDocsByEpicId, doc.scopeId!, doc)
  for (const doc of ucsDocs) {
    const epicId = inferEpicForUseCase(doc, epicRows, epicDocsByEpicId)
    if (epicId) append(epicDocsByEpicId, epicId, doc)
  }
  const hasDocsByEpicId = new Map<string, boolean>()

  const unassignedDomain: BusinessMapDomain = { id: 'unassigned', name: 'Unassigned', summary: 'EPICs without a domain', epics: [] }
  const domainList: BusinessMapDomain[] = domainRows.map((domain) => ({
    id: domain.id,
    name: domain.name,
    summary: domain.summary,
    epics: [],
  }))
  const domainById = new Map(domainList.map((domain) => [domain.id, domain]))
  for (const epic of epicRows) {
    const docsForEpic = epicDocsByEpicId.get(epic.id) ?? []
    const node: BusinessMapEpic = {
      id: epic.id,
      name: epic.name,
      summary: epic.summary ?? epic.description,
      domainId: epic.domainId,
      documents: docsForEpic,
      itemCount: docsForEpic.reduce((sum, doc) => sum + doc.items.length, 0),
    }
    hasDocsByEpicId.set(epic.id, docsForEpic.length > 0)
    const domain = epic.domainId ? domainById.get(epic.domainId) : undefined
    if (domain) domain.epics.push(node)
    else unassignedDomain.epics.push(node)
  }
  if (unassignedDomain.epics.length) domainList.push(unassignedDomain)

  const repoLabels = new Map(repoRows.map((repo) => [repo.id, displayRepositoryName(repo)]))
  const repoZones: BusinessMapRepoZone[] = repoRows.map((repo) => ({
    id: repo.id,
    label: displayRepositoryName(repo),
    nodes: serviceRows.filter((node) => node.repoId === repo.id).map(serviceNode),
  }))
  const unassignedServiceNodes = serviceRows.filter((node) => !node.repoId)
  if (unassignedServiceNodes.length) {
    repoZones.push({ id: 'unassigned', label: 'Unassigned', nodes: unassignedServiceNodes.map(serviceNode) })
  }

  const docSource: BusinessMapDocSourceLink[] = []
  for (const link of linkRows) {
    if (link.linkType !== 'derives_from') continue
    if (!businessDocs.some((doc) => doc.id === link.fromDocumentId)) continue
    const technicalDoc = technicalDocById.get(link.toDocumentId)
    if (!technicalDoc?.scopeId) continue
    const service = serviceByScopeId.get(technicalDoc.scopeId)
    if (!service) continue
    docSource.push({
      documentId: link.fromDocumentId,
      technicalDocumentId: link.toDocumentId,
      serviceNodeId: service.id,
      linkType: link.linkType,
    })
  }

  return {
    projectId: input.projectId,
    generatedAt: input.generatedAt,
    summary: {
      domainCount: domainList.length,
      epicCount: epicRows.length,
      businessDocumentCount: businessDocs.length,
      ucsCount: ucsDocs.length,
      documentItemCount: itemRows.length,
      serviceNodeCount: serviceRows.length,
      serviceEdgeCount: serviceEdgeRows.length,
      repoCount: repoZones.length,
      docSourceLinkCount: docSource.length,
      epicDependencyCount: dependencyRows.length,
    },
    views: {
      businessContext: {
        domains: domainList,
        projectDocuments: businessDocs.filter((doc) => doc.scope === 'project'),
        epicDependencies: dependencyRows
          .filter((dep) => epicRows.some((epic) => epic.id === dep.sourceEpicId) && epicRows.some((epic) => epic.id === dep.targetEpicId))
          .map((dep) => ({
            sourceEpicId: dep.sourceEpicId,
            targetEpicId: dep.targetEpicId,
            kind: dep.kind,
            reason: dep.reason,
            sourceHasDocuments: hasDocsByEpicId.get(dep.sourceEpicId) ?? false,
            targetHasDocuments: hasDocsByEpicId.get(dep.targetEpicId) ?? false,
          })),
      },
      serviceCore: {
        repoZones,
        edges: serviceEdgeRows.filter((edge) => edge.sourceNodeId && edge.targetNodeId).map((edge) => ({
          id: edge.id,
          source: edge.sourceNodeId!,
          target: edge.targetNodeId!,
          kind: edge.kind,
          unresolved: Boolean(edge.unresolvedReason),
        })),
      },
      links: { docSource },
    },
  }

  function serviceNode(node: typeof serviceRows[number]): BusinessMapServiceNode {
    return {
      id: node.id,
      type: node.type,
      label: humanServiceLabel(node),
      repoId: node.repoId,
      detail: node.nodeId,
    }
  }

  function displayRepositoryName(repo: typeof repoRows[number]) {
    if (repo.name && !looksLikeGeneratedId(repo.name)) return repo.name
    return repo.repoPath.split('/').filter(Boolean).at(-1) || repo.name || repo.id
  }

  function humanServiceLabel(node: typeof serviceRows[number]) {
    const raw = node.nodeId || node.sourceId || node.label || node.id
    const routeMatch = raw.match(/:(GET|POST|PUT|PATCH|DELETE):([^:]+)/)
    if (routeMatch) return `${routeMatch[1]} ${routeMatch[2]}`
    const pageMatch = raw.match(/:page::([^:]+):/)
    if (pageMatch) return pageMatch[1]
    return node.label || raw.replace(/^external_service:/, '')
  }
}

function documentNode(
  doc: typeof documents.$inferSelect,
  items: Array<typeof documentItems.$inferSelect>,
): BusinessMapDocument {
  const content = doc.content ?? {}
  return {
    id: doc.id,
    type: doc.type,
    scope: doc.scope,
    scopeId: doc.scopeId,
    title: stringValue(content.title) ?? doc.summary ?? doc.type,
    summary: stringValue(content.summary) ?? doc.summary,
    markdown: renderDocumentMarkdown(doc, items),
    viewer: buildDocumentViewer(doc),
    items: items.map((item) => ({
      id: item.id,
      itemType: item.itemType,
      title: item.title,
      summary: item.summary,
    })),
  }
}

function buildDocumentViewer(doc: typeof documents.$inferSelect): BusinessMapDocumentViewer {
  const content = doc.content ?? {}
  return {
    kind: doc.type,
    sequenceDiagrams: extractSequenceDiagrams(content),
  }
}

function renderDocumentMarkdown(
  doc: typeof documents.$inferSelect,
  items: Array<typeof documentItems.$inferSelect>,
) {
  const content = doc.content ?? {}
  const title = stringValue(content.title) ?? doc.summary ?? doc.type
  const summary = stringValue(content.summary) ?? doc.summary
  const sections = [`# ${title}`, '', `**Type:** ${doc.type}`, `**Scope:** ${doc.scope}${doc.scopeId ? ` / ${doc.scopeId}` : ''}`]

  if (summary) sections.push('', '## Summary', '', summary)

  const contentEntries = Object.entries(content)
    .filter(([key, value]) => !['schemaVersion', 'documentType', 'title', 'summary', 'scope', 'scopeId'].includes(key) && value != null)
  if (contentEntries.length) {
    sections.push('', sectionTitle(doc.type, 'Content'))
    for (const [key, value] of contentEntries) {
      if (isSequenceDiagramKey(key)) continue
      sections.push('', `### ${humanKey(key)}`, '', markdownValue(value))
    }
  }

  if (items.length) {
    sections.push('', sectionTitle(doc.type, 'Items'))
    for (const item of items) {
      sections.push('', `### ${item.title || item.summary || item.itemType}`, '', `- Type: ${item.itemType}`)
      if (item.summary) sections.push(`- Summary: ${item.summary}`)
      if (item.content && Object.keys(item.content).length) sections.push('', markdownValue(item.content))
    }
  }

  return `${sections.join('\n')}\n`
}

function markdownValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string')) return value.map((item) => `- ${item}`).join('\n')
    if (isObjectTable(value)) return markdownTable(value)
    return value.map((item) => `- ${markdownBlockValue(item, 1)}`).join('\n')
  }
  if (value && typeof value === 'object') {
    return objectBullets(value, 0)
  }
  return String(value ?? '')
}

function markdownInlineValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(markdownInlineValue).join(', ')
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([, nested]) => nested != null)
      .map(([key, nested]) => `${humanKey(key)}: ${markdownInlineValue(nested)}`)
      .join('; ')
  }
  return String(value ?? '')
}

function markdownBlockValue(value: unknown, depth: number): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) return `\n${objectBullets(value, depth)}`
  return markdownInlineValue(value)
}

function objectBullets(value: object, depth: number): string {
  const indent = '  '.repeat(depth)
  return Object.entries(value)
    .filter(([, nested]) => nested != null)
    .map(([key, nested]) => {
      if (isSequenceDiagramKey(key)) return null
      if (Array.isArray(nested) && isObjectTable(nested)) return `${indent}- ${humanKey(key)}:\n${indent}  ${markdownTable(nested).replace(/\n/g, `\n${indent}  `)}`
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) return `${indent}- ${humanKey(key)}:\n${objectBullets(nested, depth + 1)}`
      if (Array.isArray(nested)) return `${indent}- ${humanKey(key)}: ${nested.map(markdownInlineValue).join(', ')}`
      return `${indent}- ${humanKey(key)}: ${markdownInlineValue(nested)}`
    })
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

function isObjectTable(value: unknown[]): value is Array<Record<string, unknown>> {
  return value.length > 0 && value.every((item) => item && typeof item === 'object' && !Array.isArray(item))
}

function markdownTable(rows: Array<Record<string, unknown>>): string {
  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 6)
  if (!keys.length) return ''
  return [
    `| ${keys.map(humanKey).join(' | ')} |`,
    `| ${keys.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${keys.map((key) => markdownInlineValue(row[key]).replace(/\|/g, '\\|')).join(' | ')} |`),
  ].join('\n')
}

function extractSequenceDiagrams(content: Record<string, unknown>): BusinessMapSequenceDiagram[] {
  const diagrams: BusinessMapSequenceDiagram[] = []
  collectSequenceDiagrams(content, diagrams)
  return diagrams
}

function collectSequenceDiagrams(value: unknown, diagrams: BusinessMapSequenceDiagram[]) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) collectSequenceDiagrams(item, diagrams)
    return
  }
  const record = value as Record<string, unknown>
  const candidates = Object.entries(record)
    .filter(([key]) => isSequenceDiagramKey(key))
    .map(([, nested]) => nested)
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (!item || typeof item !== 'object') continue
        const row = item as Record<string, unknown>
        const mermaid = stringValueByKey(row, 'mermaid') ?? stringValueByKey(row, 'diagram')
        if (mermaid && mermaid.includes('sequenceDiagram')) diagrams.push({ title: stringValue(row.title) ?? 'Sequence diagram', mermaid })
      }
    } else if (typeof candidate === 'string' && candidate.includes('sequenceDiagram')) {
      diagrams.push({ title: 'Sequence diagram', mermaid: candidate })
    }
  }
  for (const [key, nested] of Object.entries(record)) {
    if (!isSequenceDiagramKey(key)) collectSequenceDiagrams(nested, diagrams)
  }
}

function isSequenceDiagramKey(key: string) {
  return ['sequence_diagrams', 'sequenceDiagrams', 'sequences', 'diagrams'].includes(key)
}

function stringValueByKey(record: Record<string, unknown>, key: string) {
  const entry = Object.entries(record).find(([candidate]) => candidate.toLowerCase() === key.toLowerCase())
  return stringValue(entry?.[1])
}

function sectionTitle(type: string, fallback: string) {
  if (type === 'br' && fallback === 'Items') return '## Business Rules'
  if (type === 'ucl' && fallback === 'Items') return '## Use Cases'
  if (type === 'ucs' && fallback === 'Items') return '## Use Case Details'
  if (type === 'design' && fallback === 'Content') return '## Design Context'
  if (type === 'data_dictionary' && fallback === 'Items') return '## Data Dictionary'
  if (type === 'glossary' && fallback === 'Items') return '## Glossary Terms'
  return `## ${fallback}`
}

function humanKey(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function inferEpicForUseCase(
  doc: BusinessMapDocument,
  epicRows: Array<typeof epics.$inferSelect>,
  epicDocsByEpicId: Map<string, BusinessMapDocument[]>,
) {
  const searchText = `${doc.scopeId ?? ''} ${doc.title} ${doc.summary ?? ''}`.toLowerCase()
  for (const epic of epicRows) {
    const candidates = [epic.id, epic.stableKey, epic.name]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase())
    if (candidates.some((value) => searchText.includes(value))) return epic.id
  }
  if (doc.scopeId) {
    for (const epicId of epicDocsByEpicId.keys()) {
      if (doc.scopeId.includes(epicId)) return epicId
    }
  }
  const text = `${doc.title} ${doc.summary ?? ''}`
  for (const [epicId, docs] of epicDocsByEpicId.entries()) {
    if (docs.some((epicDoc) => epicDoc.summary && text.includes(epicDoc.summary.slice(0, 30)))) return epicId
  }
  return null
}

function append<T>(map: Map<string, T[]>, key: string, value: T) {
  const existing = map.get(key) ?? []
  existing.push(value)
  map.set(key, existing)
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function looksLikeGeneratedId(value: string) {
  return value.length >= 16 && /[A-Z]/.test(value) && /[_-]/.test(value)
}
