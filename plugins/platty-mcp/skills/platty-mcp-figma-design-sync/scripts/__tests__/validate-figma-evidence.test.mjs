import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  computeReportId,
  computeSourceRevision,
  validateFigmaEvidencePacket,
  validateReportBundle,
} from '../validate-figma-evidence.mjs'

const metadataAtlas = () => ({
  target: { fileKey: 'file', nodeId: '1:2', type: 'PAGE', name: 'Account flow' },
  boundaries: [
    {
      nodeId: '2:1',
      parentNodeId: '1:2',
      type: 'SECTION',
      name: 'Save',
      visible: true,
      children: [
        { nodeId: '3:1', parentNodeId: '2:1', type: 'FRAME', name: 'Default', visible: true },
        { nodeId: '3:2', parentNodeId: '2:1', type: 'FRAME', name: 'Notes', visible: true },
      ],
    },
  ],
})

const packet = () => {
  const initial = metadataAtlas()
  const final = metadataAtlas()
  const revision = computeSourceRevision(initial)
  return {
    schemaVersion: 'figma-evidence-packet.v1',
    status: 'complete',
    sourceIdentity: {
      canonicalUrl: 'https://www.figma.com/design/file/Page?node-id=1-2',
      fileKey: 'file',
      nodeId: '1:2',
      targetId: 'file-1-2',
      targetType: 'PAGE',
      sourceRevision: revision,
    },
    metadata: { initial, final },
    capabilities: {
      overview: 'complete',
      metadata: 'complete',
      screenshot: 'complete',
      designContext: 'complete',
      variables: 'missing',
      components: 'partial',
      assets: 'partial',
    },
    meaningfulSections: [{ nodeId: '2:1', name: 'Save', evidenceClass: 'direct' }],
    excludedSections: [],
    semanticCandidates: ['3:1', '3:2'],
    stateFrames: [
      {
        nodeId: '3:1',
        sectionNodeId: '2:1',
        evidenceClass: 'direct',
        capture: {
          metadata: { status: 'complete', artifact: 'metadata/nodes/3-1.json' },
          screenshot: { status: 'complete', artifact: 'screens/3-1.png' },
          designContext: { status: 'complete', artifact: 'context/3-1.json' },
        },
      },
    ],
    excluded: [{ nodeId: '3:2', reason: 'annotation-only helper' }],
    annotations: [],
    interactions: [],
    components: [],
    tokens: [],
    assets: [],
    assertions: [
      {
        id: 'E-001',
        classification: 'direct',
        basis: 'explicit_copy',
        claim: 'Section title is Save.',
        nodeIds: ['2:1'],
        quotedValue: 'Save',
        evidence: 'exact observed title',
      },
      {
        id: 'E-002',
        classification: 'inferred',
        basis: 'proximity',
        claim: 'Frames may be related states.',
        nodeIds: ['3:1'],
        evidence: 'layout proximity only',
      },
      {
        id: 'E-003',
        classification: 'missing',
        basis: 'absent',
        claim: 'Save persistence scope is unknown.',
        nodeIds: [],
        evidence: 'not present in captured evidence',
      },
    ],
    coverage: {
      semanticCandidates: 2,
      stateFrames: 1,
      excluded: 1,
      exactlyOnce: true,
      status: 'complete',
    },
    drift: {
      initialSourceRevision: revision,
      finalSourceRevision: revision,
      status: 'stable',
      driftedNodeIds: [],
    },
    warnings: ['variables capability missing'],
    implementationGaps: ['Confirm token values before implementation.'],
  }
}

test('accepts exact candidate accounting and assertion classifications', () => {
  const result = validateFigmaEvidencePacket(packet())
  assert.equal(result.ok, true)
  assert.deepEqual(result.errors, [])
})

test('rejects missing, duplicate, and overlapping candidate dispositions', () => {
  const missing = packet()
  missing.excluded = []
  assert.match(validateFigmaEvidencePacket(missing).errors.join('\n'), /exactly once/i)

  const duplicate = packet()
  duplicate.stateFrames.push({
    nodeId: '3:1',
    sectionNodeId: '2:1',
    evidenceClass: 'direct',
  })
  assert.match(validateFigmaEvidencePacket(duplicate).errors.join('\n'), /exactly once/i)

  const overlap = packet()
  overlap.excluded[0].nodeId = '3:1'
  assert.match(validateFigmaEvidencePacket(overlap).errors.join('\n'), /exactly once/i)
})

test('derives the eligible page set from bounded metadata instead of trusting packet counts', () => {
  const omitted = packet()
  omitted.semanticCandidates = ['3:1']
  omitted.excluded = []
  omitted.coverage = {
    semanticCandidates: 1,
    stateFrames: 1,
    excluded: 0,
    exactlyOnce: true,
    status: 'complete',
  }
  assert.match(validateFigmaEvidencePacket(omitted).errors.join('\n'), /metadata-derived candidate/i)

  const missingSection = packet()
  missingSection.meaningfulSections = []
  assert.match(validateFigmaEvidencePacket(missingSection).errors.join('\n'), /section.*exactly once/i)
})

test('requires the closed capability set and per-frame capture receipts', () => {
  const unknownCapabilities = packet()
  unknownCapabilities.capabilities = { foo: 'complete' }
  assert.match(validateFigmaEvidencePacket(unknownCapabilities).errors.join('\n'), /required capability/i)

  const noScreenshot = packet()
  noScreenshot.stateFrames[0].capture.screenshot = { status: 'missing', reason: 'tool unavailable' }
  assert.match(validateFigmaEvidencePacket(noScreenshot).errors.join('\n'), /complete packet.*screenshot/i)
})

test('rejects inferred evidence promoted as direct and unstable complete reports', () => {
  const badDirect = packet()
  badDirect.assertions[0].basis = 'color'
  assert.match(validateFigmaEvidencePacket(badDirect).errors.join('\n'), /basis.*direct/i)

  const drifted = packet()
  drifted.metadata.final.boundaries[0].name = 'Changed section'
  drifted.drift.finalSourceRevision = computeSourceRevision(drifted.metadata.final)
  drifted.drift.status = 'source_drift'
  assert.match(validateFigmaEvidencePacket(drifted).errors.join('\n'), /drift.*stale/i)
})

test('report identity is deterministic and ignores observation timestamps', () => {
  const first = packet()
  first.observedAt = '2026-07-21T01:00:00.000Z'
  const second = packet()
  second.observedAt = '2026-07-21T02:00:00.000Z'

  assert.equal(computeReportId(first), computeReportId(second))
  second.assertions[0].claim = 'Changed claim.'
  assert.notEqual(computeReportId(first), computeReportId(second))
})

test('validates a self-contained report bundle and detects byte collisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'figma-evidence-'))
  try {
    const value = packet()
    value.reportId = computeReportId(value)
    const reportDir = join(root, value.reportId)
    await mkdir(join(reportDir, 'metadata'), { recursive: true })
    await mkdir(join(reportDir, 'metadata/nodes'), { recursive: true })
    await mkdir(join(reportDir, 'screens'), { recursive: true })
    await mkdir(join(reportDir, 'context'), { recursive: true })

    const files = new Map([
      ['figma-evidence-packet.json', `${JSON.stringify(value, null, 2)}\n`],
      ['report.md', '# Report\n'],
      ['metadata/initial.json', `${JSON.stringify(value.metadata.initial)}\n`],
      ['metadata/final.json', `${JSON.stringify(value.metadata.final)}\n`],
      ['metadata/nodes/3-1.json', '{}\n'],
      ['screens/3-1.png', 'png-bytes'],
      ['context/3-1.json', '{}\n'],
    ])
    for (const [path, content] of files) await writeFile(join(reportDir, path), content)

    const index = {
      schemaVersion: 'figma-evidence-index.v1',
      reportId: value.reportId,
      files: [...files].map(([path, content]) => ({
        path,
        bytes: Buffer.byteLength(content),
        sha256: createHash('sha256').update(content).digest('hex'),
      })),
    }
    await writeFile(join(reportDir, 'integrity-index.json'), `${JSON.stringify(index, null, 2)}\n`)

    assert.equal((await validateReportBundle(reportDir)).ok, true)

    await writeFile(join(reportDir, 'report.md'), '# Different bytes\n')
    const collision = await validateReportBundle(reportDir)
    assert.equal(collision.ok, false)
    assert.match(collision.errors.join('\n'), /byte|sha256|integrity/i)

    assert.equal(JSON.parse(await readFile(join(reportDir, 'integrity-index.json'))).reportId, value.reportId)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
