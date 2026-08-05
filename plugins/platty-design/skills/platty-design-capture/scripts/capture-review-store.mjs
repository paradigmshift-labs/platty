import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AUTHORIZATION_QUESTIONS,
  CAPTURE_SOURCE_INVENTORY_SCHEMA,
  REVIEW_HANDOFF_SCHEMA,
  REVIEW_PRESENTATION_SCHEMA,
  decisionResult,
} from './capture-schemas.mjs'

const SCREEN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,127})$/u

function failure(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function requireCaptureDir(captureDir) {
  if (typeof captureDir !== 'string' || !isAbsolute(captureDir)) {
    throw failure('CAPTURE_DIR_ABSOLUTE_REQUIRED', 'captureDir must be an absolute path.')
  }
  return resolve(captureDir)
}

function requireScreenId(screenId) {
  if (typeof screenId !== 'string' || !SCREEN_ID_PATTERN.test(screenId)) {
    throw failure('SCREEN_ID_INVALID', 'screenId must be a safe stable identity.')
  }
  return screenId
}

function readJson(path, missingCode) {
  if (!existsSync(path)) throw failure(missingCode, `Missing ${path}.`)
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw failure('REVIEW_ARTIFACT_INVALID', `${path} is not valid JSON: ${error.message}`)
  }
}

function atomicWriteJson(path, value) {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(tempPath, path)
}

export function initializeReview({ captureDir, captureId, now = () => new Date().toISOString() }) {
  const directory = requireCaptureDir(captureDir)
  if (typeof captureId !== 'string' || captureId.trim().length === 0) {
    throw failure('CAPTURE_ID_REQUIRED', 'captureId is required.')
  }
  const handoffPath = join(directory, 'review_handoff.json')
  const presentationPath = join(directory, 'review_presentation.json')
  if (existsSync(handoffPath) || existsSync(presentationPath)) {
    if (!existsSync(handoffPath) || !existsSync(presentationPath)) {
      throw failure('REVIEW_ARTIFACT_SET_INCOMPLETE', 'Resume requires both review_handoff.json and review_presentation.json.')
    }
    const handoff = readJson(handoffPath, 'REVIEW_HANDOFF_MISSING')
    const presentation = readJson(presentationPath, 'REVIEW_PRESENTATION_MISSING')
    if (handoff.schema !== REVIEW_HANDOFF_SCHEMA || presentation.schema !== REVIEW_PRESENTATION_SCHEMA || handoff.captureId !== captureId || presentation.captureId !== captureId) {
      throw failure('REVIEW_RESUME_IDENTITY_MISMATCH', 'Existing review artifacts do not match the requested capture identity.')
    }
    return { status: 'resumed', captureDir: directory, revision: handoff.revision }
  }
  mkdirSync(join(directory, 'screenshots'), { recursive: true })
  const timestamp = now()
  const handoff = {
    schema: REVIEW_HANDOFF_SCHEMA,
    captureId,
    revision: 0,
    memos: {},
    decision: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const presentation = {
    schema: REVIEW_PRESENTATION_SCHEMA,
    captureId,
    ia: [],
    rows: [],
    display: { status: 'pending' },
    updatedAt: timestamp,
  }
  atomicWriteJson(handoffPath, handoff)
  atomicWriteJson(presentationPath, presentation)
  return { status: 'initialized', captureDir: directory, revision: 0 }
}

function loadHandoff(captureDir) {
  const directory = requireCaptureDir(captureDir)
  const path = join(directory, 'review_handoff.json')
  const handoff = readJson(path, 'REVIEW_HANDOFF_MISSING')
  if (handoff.schema !== REVIEW_HANDOFF_SCHEMA || !Number.isInteger(handoff.revision) || !handoff.memos || typeof handoff.memos !== 'object') {
    throw failure('REVIEW_HANDOFF_INVALID', 'review_handoff.json does not match the supported schema.')
  }
  return { directory, path, handoff }
}

function loadSourceRevisions(directory) {
  const inventory = readJson(join(directory, 'source_inventory.json'), 'CAPTURE_SOURCE_INVENTORY_MISSING')
  const sourceRevisions = inventory?.sourceRevisions
  if (inventory?.schema !== CAPTURE_SOURCE_INVENTORY_SCHEMA
    || !sourceRevisions || typeof sourceRevisions !== 'object' || Array.isArray(sourceRevisions)
    || Object.keys(sourceRevisions).length === 0
    || Object.values(sourceRevisions).some(value => typeof value !== 'string' || value.trim().length === 0)) {
    throw failure('CAPTURE_SOURCE_INVENTORY_INVALID', 'Decision requires a revision-bound source inventory.')
  }
  return sourceRevisions
}

function sameStringRecord(left, right) {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return JSON.stringify(leftKeys) === JSON.stringify(rightKeys)
    && leftKeys.every(key => left[key] === right[key])
}

export function readMemo({ captureDir, screenId }) {
  const id = requireScreenId(screenId)
  const { directory, handoff } = loadHandoff(captureDir)
  const memo = handoff.memos[id]
  return {
    status: 'loaded',
    captureDir: directory,
    screenId: id,
    content: memo?.content ?? '',
    updatedAt: memo?.updatedAt ?? null,
    revision: handoff.revision,
  }
}

export function saveMemo({ captureDir, screenId, content, expectedRevision, now = () => new Date().toISOString() }) {
  const id = requireScreenId(screenId)
  if (typeof content !== 'string') throw failure('MEMO_CONTENT_INVALID', 'Memo content must be a string.')
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw failure('MEMO_EXPECTED_REVISION_REQUIRED', 'expectedRevision must be a non-negative integer.')
  }
  const { directory, path, handoff } = loadHandoff(captureDir)
  if (handoff.revision !== expectedRevision) {
    throw failure('MEMO_REVISION_CONFLICT', `Expected revision ${expectedRevision}, found ${handoff.revision}.`)
  }
  const updatedAt = now()
  const nextRevision = handoff.revision + 1
  const updated = {
    ...handoff,
    revision: nextRevision,
    memos: {
      ...handoff.memos,
      [id]: { content, updatedAt, revision: nextRevision },
    },
    updatedAt,
  }
  atomicWriteJson(path, updated)
  return {
    status: 'saved',
    actionLabel: '메모 저장',
    captureDir: directory,
    storagePath: path,
    screenId: id,
    content,
    updatedAt,
    revision: nextRevision,
  }
}

export function saveDecision({ captureDir, prdAnswer, figmaAnswer, sourceRevisions, expectedRevision, now = () => new Date().toISOString() }) {
  const result = decisionResult(prdAnswer, figmaAnswer)
  if (!result) throw failure('DECISION_ANSWER_INVALID', 'PRD and Figma answers must each be yes or no.')
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw failure('DECISION_EXPECTED_REVISION_REQUIRED', 'expectedRevision must be a non-negative integer.')
  }
  if (!sourceRevisions || typeof sourceRevisions !== 'object' || Array.isArray(sourceRevisions)
    || Object.keys(sourceRevisions).length === 0
    || Object.values(sourceRevisions).some(value => typeof value !== 'string' || value.trim().length === 0)) {
    throw failure('DECISION_SOURCE_REVISIONS_REQUIRED', 'Decision must bind non-empty source revisions.')
  }
  const { directory, path, handoff } = loadHandoff(captureDir)
  const inventorySourceRevisions = loadSourceRevisions(directory)
  if (!sameStringRecord(sourceRevisions, inventorySourceRevisions)) {
    throw failure('DECISION_SOURCE_REVISION_MISMATCH', 'Decision source revisions must match the capture source inventory.')
  }
  if (handoff.revision !== expectedRevision) {
    throw failure('DECISION_REVISION_CONFLICT', `Expected revision ${expectedRevision}, found ${handoff.revision}.`)
  }
  const updatedAt = now()
  const nextRevision = handoff.revision + 1
  const decision = {
    questions: AUTHORIZATION_QUESTIONS,
    prdAnswer,
    figmaAnswer,
    prdAuthorized: prdAnswer === 'yes' || figmaAnswer === 'yes',
    figmaAuthorized: figmaAnswer === 'yes',
    result,
    sourceRevisions,
    decidedAt: updatedAt,
    revision: nextRevision,
  }
  atomicWriteJson(path, { ...handoff, revision: nextRevision, decision, updatedAt })
  return { status: 'decision-saved', captureDir: directory, storagePath: path, revision: nextRevision, ...decision }
}

function cliFailure(error) {
  process.stderr.write(`${JSON.stringify({ status: 'failed', code: error.code ?? 'CAPTURE_REVIEW_STORE_ERROR', message: error.message })}\n`)
  process.exitCode = 1
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2)
  try {
    let result
    if (command === 'init') {
      const [captureDir, captureId] = args
      result = initializeReview({ captureDir, captureId })
    } else if (command === 'read-memo') {
      const [captureDir, screenId] = args
      result = readMemo({ captureDir, screenId })
    }
    else if (command === 'save-memo') {
      const [captureDir, screenId, expectedRevision, ...memoParts] = args
      result = saveMemo({
        captureDir,
        screenId,
        expectedRevision: Number(expectedRevision),
        content: memoParts.join(' '),
      })
    } else if (command === 'save-decision') {
      const [captureDir, expectedRevision, prdAnswer, figmaAnswer, sourceRevisionsJson] = args
      let sourceRevisions
      try { sourceRevisions = JSON.parse(sourceRevisionsJson) } catch { throw failure('DECISION_SOURCE_REVISIONS_REQUIRED', 'Source revisions must be valid JSON.') }
      result = saveDecision({ captureDir, expectedRevision: Number(expectedRevision), prdAnswer, figmaAnswer, sourceRevisions })
    } else throw failure('CAPTURE_REVIEW_STORE_COMMAND_INVALID', 'Use init, read-memo, save-memo, or save-decision.')
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    cliFailure(error)
  }
}
