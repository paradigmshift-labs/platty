import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { basename, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const evidenceClasses = new Set(['direct', 'inferred', 'missing'])
const packetStatuses = new Set(['complete', 'partial', 'blocked', 'stale'])
const capabilityStates = new Set(['complete', 'partial', 'missing', 'not_applicable'])
const captureStates = new Set(['complete', 'partial', 'missing', 'blocked'])
const capabilityKeys = [
  'overview',
  'metadata',
  'screenshot',
  'designContext',
  'variables',
  'components',
  'assets',
]
const requiredCompleteCapabilities = ['overview', 'metadata', 'screenshot', 'designContext']
const directBases = new Set([
  'explicit_copy',
  'explicit_annotation',
  'prototype_reaction',
  'node_property',
  'component_identity',
  'variable_value',
  'asset_identity',
  'observed_geometry',
])
const inferredBases = new Set([
  'layout',
  'name',
  'proximity',
  'repetition',
  'visual_hierarchy',
  'color',
  'grouping',
  'paraphrase',
  'incomplete_structure',
])
const missingBases = new Set(['absent', 'capability_unavailable'])

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const canonicalize = (value, key = '') => {
  if (key === 'observedAt' || key === 'reportId') return undefined
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item)).filter((item) => item !== undefined)
  }
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((childKey) => [childKey, canonicalize(value[childKey], childKey)])
      .filter(([, child]) => child !== undefined),
  )
}

const hash = (value) => createHash('sha256').update(value).digest('hex')

export const computeReportId = (packet) => hash(JSON.stringify(canonicalize(packet)))
export const computeSourceRevision = (metadataAtlas) =>
  hash(JSON.stringify(canonicalize(metadataAtlas)))

const validArtifactPath = (path) =>
  typeof path === 'string' &&
  path.length > 0 &&
  !path.startsWith('/') &&
  !path.split('/').includes('..') &&
  !path.includes('\\')

function validateMetadataAtlas(atlas, label, errors) {
  const fail = (message) => errors.push(`${label}: ${message}`)
  if (!isRecord(atlas) || !isRecord(atlas.target) || !Array.isArray(atlas.boundaries)) {
    fail('metadata atlas needs target and boundaries')
    return
  }
  for (const field of ['fileKey', 'nodeId', 'type', 'name']) {
    if (typeof atlas.target[field] !== 'string' || atlas.target[field].length === 0) {
      fail(`target.${field} must be a non-empty string`)
    }
  }
  if (atlas.target.type !== 'PAGE') fail('target.type must be PAGE')

  const ids = new Set([atlas.target.nodeId])
  for (const boundary of atlas.boundaries) {
    if (!isRecord(boundary) || !['SECTION', 'FRAME', 'COMPONENT_SET', 'COMPONENT'].includes(boundary.type)) {
      fail('boundary must be a semantic node')
      continue
    }
    if (boundary.parentNodeId !== atlas.target.nodeId) fail(`boundary parent mismatch: ${boundary.nodeId}`)
    if (ids.has(boundary.nodeId)) fail(`duplicate node ID: ${boundary.nodeId}`)
    ids.add(boundary.nodeId)
    if (!Array.isArray(boundary.children)) fail(`boundary children must be an array: ${boundary.nodeId}`)
    for (const child of boundary.children ?? []) {
      if (!isRecord(child) || !['SECTION', 'FRAME', 'COMPONENT_SET', 'COMPONENT'].includes(child.type)) {
        fail(`child must be a semantic node under ${boundary.nodeId}`)
        continue
      }
      if (child.parentNodeId !== boundary.nodeId) fail(`child parent mismatch: ${child.nodeId}`)
      if (ids.has(child.nodeId)) fail(`duplicate node ID: ${child.nodeId}`)
      ids.add(child.nodeId)
    }
  }
}

function derivePageCandidates(packet, errors) {
  const initial = packet.metadata?.initial
  if (!isRecord(initial) || !Array.isArray(initial.boundaries)) return []

  const visibleSections = initial.boundaries.filter(
    (node) => node?.type === 'SECTION' && node.visible !== false,
  )
  const included = Array.isArray(packet.meaningfulSections)
    ? packet.meaningfulSections.map((item) => item?.nodeId)
    : []
  const excluded = Array.isArray(packet.excludedSections)
    ? packet.excludedSections.map((item) => item?.nodeId)
    : []
  const sectionCounts = new Map()
  for (const nodeId of [...included, ...excluded]) {
    sectionCounts.set(nodeId, (sectionCounts.get(nodeId) ?? 0) + 1)
  }
  const sectionIds = new Set(visibleSections.map((node) => node.nodeId))
  const sectionsExactlyOnce =
    sectionIds.size === visibleSections.length &&
    [...sectionIds].every((nodeId) => sectionCounts.get(nodeId) === 1) &&
    [...sectionCounts].every(([nodeId, count]) => sectionIds.has(nodeId) && count === 1)
  if (!sectionsExactlyOnce) errors.push('every visible page Section must be dispositioned exactly once')

  for (const item of packet.excludedSections ?? []) {
    if (!isRecord(item) || typeof item.reason !== 'string' || item.reason.trim() === '') {
      errors.push('every excluded Section needs a non-empty reason')
    }
  }

  const includedSet = new Set(included)
  const candidates = []
  for (const boundary of initial.boundaries) {
    if (boundary?.visible === false) continue
    if (['FRAME', 'COMPONENT_SET'].includes(boundary?.type)) candidates.push(boundary.nodeId)
    if (boundary?.type === 'SECTION' && includedSet.has(boundary.nodeId)) {
      for (const child of boundary.children ?? []) {
        if (child?.visible !== false && ['FRAME', 'COMPONENT_SET'].includes(child?.type)) {
          candidates.push(child.nodeId)
        }
      }
    }
  }
  return candidates
}

function validateCapture(capture, nodeId, packetStatus, errors) {
  if (!isRecord(capture)) {
    errors.push(`State Frame ${nodeId} needs a capture receipt`)
    return
  }
  for (const kind of ['metadata', 'screenshot', 'designContext']) {
    const receipt = capture[kind]
    if (!isRecord(receipt) || !captureStates.has(receipt.status)) {
      errors.push(`State Frame ${nodeId} needs a valid ${kind} receipt`)
      continue
    }
    if (['complete', 'partial'].includes(receipt.status) && !validArtifactPath(receipt.artifact)) {
      errors.push(`State Frame ${nodeId} ${kind} receipt needs a safe artifact path`)
    }
    if (['missing', 'blocked'].includes(receipt.status) &&
      (typeof receipt.reason !== 'string' || receipt.reason.trim() === '')) {
      errors.push(`State Frame ${nodeId} ${kind} receipt needs a missing/blocked reason`)
    }
    if (packetStatus === 'complete' && receipt.status !== 'complete') {
      errors.push(`complete packet requires complete ${kind} for State Frame ${nodeId}`)
    }
  }
}

export function validateFigmaEvidencePacket(packet) {
  const errors = []
  const fail = (message) => errors.push(message)

  if (!isRecord(packet)) return { ok: false, errors: ['packet must be an object'] }
  if (packet.schemaVersion !== 'figma-evidence-packet.v1') {
    fail('schemaVersion must be figma-evidence-packet.v1')
  }
  if (!packetStatuses.has(packet.status)) fail('status must be complete, partial, blocked, or stale')

  const source = packet.sourceIdentity
  if (!isRecord(source)) {
    fail('sourceIdentity must be an object')
  } else {
    for (const field of ['canonicalUrl', 'fileKey', 'nodeId', 'targetId', 'targetType', 'sourceRevision']) {
      if (typeof source[field] !== 'string' || source[field].length === 0) {
        fail(`sourceIdentity.${field} must be a non-empty string`)
      }
    }
    if (source.targetType !== 'PAGE') fail('sourceIdentity.targetType must be PAGE for page coverage')
    if (!source.canonicalUrl?.includes(`/design/${source.fileKey}/`)) {
      fail('canonicalUrl must bind the exact source fileKey')
    }
  }

  if (!isRecord(packet.metadata)) {
    fail('metadata must contain initial and final bounded atlases')
  } else {
    validateMetadataAtlas(packet.metadata.initial, 'initial metadata', errors)
    validateMetadataAtlas(packet.metadata.final, 'final metadata', errors)
    for (const atlas of [packet.metadata.initial, packet.metadata.final]) {
      if (isRecord(atlas?.target) &&
        (atlas.target.fileKey !== source?.fileKey || atlas.target.nodeId !== source?.nodeId)) {
        fail('metadata target must bind the exact source identity')
      }
    }
  }

  if (!isRecord(packet.capabilities)) {
    fail('capabilities must be an object')
  } else {
    const actualKeys = Object.keys(packet.capabilities).sort()
    if (JSON.stringify(actualKeys) !== JSON.stringify([...capabilityKeys].sort())) {
      fail(`required capability keys are: ${capabilityKeys.join(', ')}`)
    }
    for (const [name, status] of Object.entries(packet.capabilities)) {
      if (!capabilityStates.has(status)) fail(`capability ${name} has invalid status`)
    }
    if (packet.status === 'complete') {
      for (const name of requiredCompleteCapabilities) {
        if (packet.capabilities[name] !== 'complete') {
          fail(`complete packet requires complete capability: ${name}`)
        }
      }
    }
  }

  for (const field of [
    'meaningfulSections',
    'excludedSections',
    'semanticCandidates',
    'stateFrames',
    'excluded',
    'annotations',
    'interactions',
    'components',
    'tokens',
    'assets',
    'assertions',
    'warnings',
    'implementationGaps',
  ]) {
    if (!Array.isArray(packet[field])) fail(`${field} must be an array`)
  }

  if (Array.isArray(packet.assertions)) {
    const assertionIds = new Set()
    for (const assertion of packet.assertions) {
      if (!isRecord(assertion) || !evidenceClasses.has(assertion.classification)) {
        fail('every assertion classification must be direct, inferred, or missing')
        continue
      }
      if (typeof assertion.id !== 'string' || assertion.id.length === 0 || assertionIds.has(assertion.id)) {
        fail('assertion IDs must be non-empty and unique')
      }
      assertionIds.add(assertion.id)
      if (typeof assertion.claim !== 'string' || typeof assertion.evidence !== 'string') {
        fail(`assertion ${assertion.id ?? '<unknown>'} needs claim and evidence`)
      }
      const bases = assertion.classification === 'direct'
        ? directBases
        : assertion.classification === 'inferred'
          ? inferredBases
          : missingBases
      if (!bases.has(assertion.basis)) {
        fail(`basis ${assertion.basis ?? '<missing>'} is invalid for ${assertion.classification}`)
      }
      if (assertion.classification === 'direct' &&
        ['explicit_copy', 'explicit_annotation'].includes(assertion.basis) &&
        (typeof assertion.quotedValue !== 'string' || assertion.quotedValue.length === 0)) {
        fail(`direct ${assertion.basis} assertion needs an exact quotedValue`)
      }
      if (!Array.isArray(assertion.nodeIds)) fail(`assertion ${assertion.id ?? '<unknown>'} needs nodeIds`)
    }
  }

  const metadataCandidates = derivePageCandidates(packet, errors)
  const candidates = Array.isArray(packet.semanticCandidates) ? packet.semanticCandidates : []
  if (JSON.stringify([...new Set(candidates)].sort()) !== JSON.stringify([...new Set(metadataCandidates)].sort())) {
    fail('semanticCandidates must equal the metadata-derived candidate set')
  }

  const selected = Array.isArray(packet.stateFrames)
    ? packet.stateFrames.map((item) => item?.nodeId)
    : []
  const excluded = Array.isArray(packet.excluded)
    ? packet.excluded.map((item) => item?.nodeId)
    : []
  for (const frame of packet.stateFrames ?? []) {
    validateCapture(frame?.capture, frame?.nodeId, packet.status, errors)
  }
  const candidateSet = new Set(candidates)
  const dispositionCounts = new Map()
  for (const nodeId of [...selected, ...excluded]) {
    dispositionCounts.set(nodeId, (dispositionCounts.get(nodeId) ?? 0) + 1)
  }
  const exactlyOnce =
    candidateSet.size === candidates.length &&
    candidates.every((nodeId) => dispositionCounts.get(nodeId) === 1) &&
    [...dispositionCounts].every(([nodeId, count]) => candidateSet.has(nodeId) && count === 1)
  if (!exactlyOnce) fail('every semantic candidate must be dispositioned exactly once')

  for (const item of packet.excluded ?? []) {
    if (!isRecord(item) || typeof item.reason !== 'string' || item.reason.trim() === '') {
      fail('every excluded candidate needs a non-empty reason')
    }
  }

  const coverage = packet.coverage
  if (!isRecord(coverage)) {
    fail('coverage must be an object')
  } else if (
    coverage.semanticCandidates !== candidates.length ||
    coverage.stateFrames !== selected.length ||
    coverage.excluded !== excluded.length ||
    coverage.stateFrames + coverage.excluded !== coverage.semanticCandidates ||
    coverage.exactlyOnce !== exactlyOnce
  ) {
    fail('coverage counts must satisfy stateFrames + excluded === semanticCandidates exactly once')
  }

  const initialRevision = isRecord(packet.metadata?.initial)
    ? computeSourceRevision(packet.metadata.initial)
    : null
  const finalRevision = isRecord(packet.metadata?.final)
    ? computeSourceRevision(packet.metadata.final)
    : null
  if (source?.sourceRevision !== initialRevision) fail('sourceRevision must equal initial metadata revision')

  const drift = packet.drift
  if (!isRecord(drift)) {
    fail('drift must be an object')
  } else {
    if (drift.initialSourceRevision !== initialRevision || drift.finalSourceRevision !== finalRevision) {
      fail('drift revisions must equal computed initial and final metadata revisions')
    }
    const revisionsEqual = initialRevision !== null && initialRevision === finalRevision
    if (drift.status === 'stable' && !revisionsEqual) {
      fail('stable drift status requires equal initial and final metadata revisions')
    }
    if (drift.status === 'source_drift' && revisionsEqual) {
      fail('source_drift requires different initial and final metadata revisions')
    }
    if (drift.status !== 'stable' && (coverage?.status !== 'stale' || packet.status !== 'stale')) {
      fail('drift requires stale packet and coverage status')
    }
    if (!['stable', 'source_drift', 'recheck_failed'].includes(drift.status)) {
      fail('drift status must be stable, source_drift, or recheck_failed')
    }
    if (!Array.isArray(drift.driftedNodeIds)) fail('driftedNodeIds must be an array')
  }

  return { ok: errors.length === 0, errors, reportId: computeReportId(packet) }
}

async function listBundleFiles(root, directory = root) {
  const paths = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`bundle contains symbolic link: ${entry.name}`)
    if (entry.isDirectory()) paths.push(...await listBundleFiles(root, path))
    else if (entry.isFile()) paths.push(relative(root, path))
  }
  return paths.sort()
}

function referencedArtifacts(packet) {
  const paths = []
  for (const frame of packet.stateFrames ?? []) {
    for (const receipt of Object.values(frame.capture ?? {})) {
      if (validArtifactPath(receipt?.artifact)) paths.push(receipt.artifact)
    }
  }
  for (const field of ['annotations', 'interactions', 'components', 'tokens', 'assets']) {
    for (const item of packet[field] ?? []) {
      if (validArtifactPath(item?.artifact)) paths.push(item.artifact)
    }
  }
  return paths
}

export async function validateReportBundle(reportDir) {
  const errors = []
  const root = resolve(reportDir)
  let index
  let packet
  try {
    index = JSON.parse(await readFile(resolve(root, 'integrity-index.json'), 'utf8'))
    packet = JSON.parse(await readFile(resolve(root, 'figma-evidence-packet.json'), 'utf8'))
  } catch (error) {
    return { ok: false, errors: [`bundle read failed: ${error.message}`] }
  }

  const packetResult = validateFigmaEvidencePacket(packet)
  errors.push(...packetResult.errors.map((error) => `packet: ${error}`))
  if (index.schemaVersion !== 'figma-evidence-index.v1' || !Array.isArray(index.files)) {
    errors.push('integrity index has invalid schema')
    return { ok: false, errors }
  }
  if (index.reportId !== packetResult.reportId || packet.reportId !== packetResult.reportId) {
    errors.push('reportId does not match canonical packet identity')
  }
  if (basename(root) !== packetResult.reportId) errors.push('report directory name must equal reportId')

  const indexedPaths = index.files.map((item) => item?.path)
  if (new Set(indexedPaths).size !== indexedPaths.length) errors.push('integrity index paths must be unique')
  for (const required of [
    'figma-evidence-packet.json',
    'report.md',
    'metadata/initial.json',
    'metadata/final.json',
    ...referencedArtifacts(packet),
  ]) {
    if (!indexedPaths.includes(required)) errors.push(`integrity index missing required artifact: ${required}`)
  }

  for (const item of index.files) {
    if (!isRecord(item) || !validArtifactPath(item.path)) {
      errors.push('integrity index contains an unsafe path')
      continue
    }
    try {
      const bytes = await readFile(resolve(root, item.path))
      if (bytes.length !== item.bytes) errors.push(`byte length mismatch: ${item.path}`)
      if (hash(bytes) !== item.sha256) errors.push(`sha256 mismatch: ${item.path}`)
    } catch (error) {
      errors.push(`indexed artifact read failed: ${item.path}: ${error.message}`)
    }
  }

  try {
    const actualPaths = (await listBundleFiles(root)).filter((path) => path !== 'integrity-index.json')
    if (JSON.stringify(actualPaths) !== JSON.stringify([...indexedPaths].sort())) {
      errors.push('integrity index does not match the exact report file closure')
    }
  } catch (error) {
    errors.push(error.message)
  }

  return { ok: errors.length === 0, errors, reportId: packetResult.reportId }
}

async function main() {
  const bundleIndex = process.argv.indexOf('--bundle')
  if (bundleIndex !== -1) {
    const result = await validateReportBundle(process.argv[bundleIndex + 1])
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (!result.ok) process.exitCode = 1
    return
  }

  const path = process.argv[2]
  if (!path) throw new Error('usage: validate-figma-evidence.mjs <packet.json> | --bundle <reportDir>')
  const packet = JSON.parse(await readFile(path, 'utf8'))
  const result = validateFigmaEvidencePacket(packet)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (!result.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
