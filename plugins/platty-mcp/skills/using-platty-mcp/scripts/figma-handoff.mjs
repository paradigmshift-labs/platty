import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { canonicalJson } from './sdd-artifacts.mjs'

export const FIGMA_HANDOFF_FILENAME = 'figma_handoff.json'

const REVISION_PATTERN = /^sha256:[0-9a-f]{64}$/
const DIGEST_PATTERN = /^[0-9a-f]{64}$/
const NODE_ID_PATTERN = /^\d+:\d+$/
const DISPOSITIONS = new Set([
  'MATCHED',
  'DESIGN_DETAIL',
  'FIGMA_GAP',
  'PRODUCT_CONFLICT',
  'STALE',
  'BLOCKED',
])
const EVIDENCE_CLASSES = new Set(['direct', 'inferred', 'missing'])

function failure(code, message = code) {
  const error = new Error(message)
  error.code = code
  return error
}

function requireObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw failure('INVALID_FIGMA_HANDOFF', `${label} must be an object`)
  }
  return value
}

function requireString(value, label, pattern) {
  if (typeof value !== 'string' || value.length === 0 || (pattern && !pattern.test(value))) {
    throw failure('INVALID_FIGMA_HANDOFF', `${label} is invalid`)
  }
  return value
}

function requireStringArray(value, label, pattern) {
  if (!Array.isArray(value) || value.length === 0) {
    throw failure('INVALID_FIGMA_HANDOFF', `${label} must be a non-empty array`)
  }
  value.forEach((entry, index) => requireString(entry, `${label}[${index}]`, pattern))
  return value
}

function requireCanonicalFigmaUrl(value) {
  requireString(value, 'source.canonicalUrl')
  let url
  try {
    url = new URL(value)
  } catch {
    throw failure('INVALID_FIGMA_HANDOFF', 'source.canonicalUrl must be a valid URL')
  }
  if (
    url.protocol !== 'https:'
    || !['figma.com', 'www.figma.com'].includes(url.hostname)
    || !/^\/(?:design|file)\//.test(url.pathname)
    || !url.searchParams.get('node-id')
  ) {
    throw failure('INVALID_FIGMA_HANDOFF', 'source.canonicalUrl must identify a Figma design node')
  }
  return value
}

export function parseFigmaHandoff(source, expected = {}) {
  let handoff
  try {
    handoff = typeof source === 'string' ? JSON.parse(source) : source
  } catch {
    throw failure('INVALID_FIGMA_HANDOFF', 'figma_handoff.json is not valid JSON')
  }

  requireObject(handoff, 'handoff')
  if (handoff.schemaVersion !== 'figma-handoff.v1') {
    throw failure('INVALID_FIGMA_HANDOFF', 'unsupported figma_handoff.json schemaVersion')
  }
  requireString(handoff.projectId, 'projectId')
  requireString(handoff.specId, 'specId')

  const productInput = requireObject(handoff.productInput, 'productInput')
  requireString(productInput.requestRevision, 'productInput.requestRevision', REVISION_PATTERN)
  requireString(productInput.storiesRevision, 'productInput.storiesRevision', REVISION_PATTERN)

  const figmaSource = requireObject(handoff.source, 'source')
  requireCanonicalFigmaUrl(figmaSource.canonicalUrl)
  requireString(figmaSource.fileKey, 'source.fileKey')
  requireString(figmaSource.nodeId, 'source.nodeId', NODE_ID_PATTERN)
  requireString(figmaSource.targetId, 'source.targetId')
  requireString(figmaSource.targetType, 'source.targetType')
  requireString(figmaSource.targetName, 'source.targetName')
  requireString(figmaSource.reportId, 'source.reportId', DIGEST_PATTERN)
  requireString(figmaSource.sourceRevision, 'source.sourceRevision', DIGEST_PATTERN)

  if (handoff.coverageStatus !== 'complete') {
    throw failure('INVALID_FIGMA_HANDOFF', 'coverageStatus must be complete')
  }
  if (!Array.isArray(handoff.mappings) || handoff.mappings.length === 0) {
    throw failure('INVALID_FIGMA_HANDOFF', 'mappings must be a non-empty array')
  }
  handoff.mappings.forEach((mapping, index) => {
    requireObject(mapping, `mappings[${index}]`)
    requireStringArray(mapping.figmaNodeIds, `mappings[${index}].figmaNodeIds`, NODE_ID_PATTERN)
    requireStringArray(mapping.productIds, `mappings[${index}].productIds`)
    requireStringArray(mapping.storyScenarioIds, `mappings[${index}].storyScenarioIds`)
    if (!EVIDENCE_CLASSES.has(mapping.evidenceClass)) {
      throw failure('INVALID_FIGMA_HANDOFF', `mappings[${index}].evidenceClass is invalid`)
    }
    if (!DISPOSITIONS.has(mapping.disposition)) {
      throw failure('INVALID_FIGMA_HANDOFF', `mappings[${index}].disposition is invalid`)
    }
  })

  if (
    (expected.projectId && expected.projectId !== handoff.projectId)
    || (expected.specId && expected.specId !== handoff.specId)
  ) {
    throw failure('FIGMA_HANDOFF_MISMATCH', 'figma_handoff.json belongs to a different project or spec')
  }
  if (
    (expected.requestRevision && expected.requestRevision !== productInput.requestRevision)
    || (expected.storiesRevision && expected.storiesRevision !== productInput.storiesRevision)
  ) {
    throw failure('STALE_FIGMA_HANDOFF', 'figma_handoff.json does not match the current product revisions')
  }

  return handoff
}

export function serializeFigmaHandoff(value) {
  return `${canonicalJson(parseFigmaHandoff(value))}\n`
}

export function loadOptionalFigmaHandoff(specDirectory, expected = {}) {
  const path = join(resolve(specDirectory), FIGMA_HANDOFF_FILENAME)
  if (!existsSync(path)) return null
  return parseFigmaHandoff(readFileSync(path, 'utf8'), expected)
}

export function persistFigmaHandoff(specDirectory, value) {
  const root = resolve(specDirectory)
  const path = join(root, FIGMA_HANDOFF_FILENAME)
  const temporaryPath = join(root, `.${FIGMA_HANDOFF_FILENAME}.${process.pid}.tmp`)
  writeFileSync(temporaryPath, serializeFigmaHandoff(value), { encoding: 'utf8', mode: 0o600 })
  renameSync(temporaryPath, path)
  return loadOptionalFigmaHandoff(root, {
    projectId: value.projectId,
    specId: value.specId,
    requestRevision: value.productInput.requestRevision,
    storiesRevision: value.productInput.storiesRevision,
  })
}

function cli() {
  const [, , command, path, projectId, specId, requestRevision, storiesRevision] = process.argv
  if (command !== 'validate' || !path || basename(path) !== FIGMA_HANDOFF_FILENAME) {
    throw failure(
      'INVALID_ARGUMENT',
      `usage: node ${basename(process.argv[1])} validate <.../${FIGMA_HANDOFF_FILENAME}> [projectId] [specId] [requestRevision] [storiesRevision]`,
    )
  }
  const handoff = loadOptionalFigmaHandoff(dirname(resolve(path)), {
    projectId,
    specId,
    requestRevision,
    storiesRevision,
  })
  if (!handoff) throw failure('MISSING_FIGMA_HANDOFF', `${path} does not exist`)
  process.stdout.write(`${canonicalJson({ ok: true, handoff })}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    cli()
  } catch (error) {
    process.stderr.write(`${canonicalJson({
      error: error.message,
      errorCode: error.code ?? 'FIGMA_HANDOFF_ERROR',
      ok: false,
    })}\n`)
    process.exitCode = 1
  }
}
