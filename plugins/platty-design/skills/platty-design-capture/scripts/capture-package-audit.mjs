import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CAPTURE_MATRIX_SCHEMA,
  CAPTURE_SOURCE_INVENTORY_SCHEMA,
  MATRIX_STRING_FIELDS,
  SOURCE_INVENTORY_ROW_FIELDS,
  PRESENTATION_STRING_FIELDS,
  IA_STRING_FIELDS,
  PRODUCT_EVIDENCE_FIELDS,
  BROWSER_REGION_FIELDS,
  SELLER_SHELL_VARIANTS,
  REVIEW_HANDOFF_SCHEMA,
  REVIEW_PRESENTATION_SCHEMA,
} from './capture-schemas.mjs'
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function issue(errors, code, message, context = {}) {
  errors.push({ code, ...context, message })
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function readJson(path, errors, code) {
  if (!existsSync(path)) {
    issue(errors, code, `Missing ${path}.`)
    return null
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    issue(errors, code, `${path} is not valid JSON.`, { details: error.message })
    return null
  }
}

function safeArtifactPath(directory, relativePath) {
  if (!nonEmptyString(relativePath) || isAbsolute(relativePath)) return null
  const path = resolve(directory, relativePath)
  return path.startsWith(`${directory}${sep}`) ? path : null
}

function fileHash(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`
}

function completeSourceRevisions(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length > 0 && Object.values(value).every(nonEmptyString)
}

function sameStringRecord(left, right) {
  if (!completeSourceRevisions(left) || !completeSourceRevisions(right)) return false
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return JSON.stringify(leftKeys) === JSON.stringify(rightKeys)
    && leftKeys.every(key => left[key] === right[key])
}

function completeProductEvidence(value, sellerShell) {
  if (!value || typeof value !== 'object'
    || !PRODUCT_EVIDENCE_FIELDS.every(field => typeof value[field] === 'boolean')
    || value.contentVisible !== true || value.reviewUiAbsent !== true) return false
  return !sellerShell || ['sellerHeaderVisible', 'sellerNavigationVisible', 'activeNavigationVisible'].every(field => value[field] === true)
}

function isPng(path) {
  const bytes = readFileSync(path)
  return bytes.length >= PNG_SIGNATURE.length && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
}

function pngDimensions(path) {
  const bytes = readFileSync(path)
  if (bytes.length < 24 || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function completeRegionEvidence(region, imageWidth, imageHeight) {
  const box = region?.boundingBox
  return nonEmptyString(region?.selector) && region?.visible === true
    && box && [box.x, box.y, box.width, box.height].every(Number.isFinite)
    && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0
    && box.x + box.width <= imageWidth && box.y + box.height <= imageHeight
}

function viewportDimensions(viewport) {
  const match = typeof viewport === 'string' ? viewport.match(/(?:^|[-_])(\d{2,5})x(\d{2,5})$/u) : null
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null
}

function completeBrowserEvidence(value, dimensions, sellerShell, viewport) {
  const declaredViewport = viewportDimensions(viewport)
  if (!value || !dimensions || !nonEmptyString(value.captureMethod)
    || !['product-element', 'viewport'].includes(value.captureSurface)
    || value.viewportId !== viewport || !declaredViewport
    || value.viewportWidth !== declaredViewport.width || value.viewportHeight !== declaredViewport.height
    || !Number.isInteger(value.imageWidth) || !Number.isInteger(value.imageHeight)
    || value.imageWidth !== dimensions.width || value.imageHeight !== dimensions.height
    || value.imageWidth < 32 || value.imageHeight < 32
    || (value.captureSurface === 'viewport' && (value.imageWidth !== value.viewportWidth || value.imageHeight !== value.viewportHeight))
    || (value.captureSurface === 'product-element' && value.imageWidth > value.viewportWidth)
    || value.reviewUiMatchCount !== 0) return false
  const requiredRegions = sellerShell ? BROWSER_REGION_FIELDS : ['content']
  return requiredRegions.every(field => completeRegionEvidence(value.regions?.[field], value.imageWidth, value.imageHeight))
}

export function auditCapturePackage(captureDir) {
  const errors = []
  if (!nonEmptyString(captureDir) || !isAbsolute(captureDir)) {
    issue(errors, 'CAPTURE_DIR_ABSOLUTE_REQUIRED', 'Capture package path must be absolute.')
    return { status: 'failed', summary: { matrixRowCount: 0, presentationRowCount: 0 }, errors }
  }
  const directory = resolve(captureDir)
  const inventory = readJson(resolve(directory, 'source_inventory.json'), errors, 'CAPTURE_SOURCE_INVENTORY_INVALID')
  const matrix = readJson(resolve(directory, 'capture_matrix.json'), errors, 'CAPTURE_MATRIX_INVALID')
  const presentation = readJson(resolve(directory, 'review_presentation.json'), errors, 'REVIEW_PRESENTATION_INVALID')
  const handoff = readJson(resolve(directory, 'review_handoff.json'), errors, 'REVIEW_HANDOFF_INVALID')

  if (inventory && inventory.schema !== CAPTURE_SOURCE_INVENTORY_SCHEMA) issue(errors, 'CAPTURE_SOURCE_INVENTORY_INVALID', `Expected ${CAPTURE_SOURCE_INVENTORY_SCHEMA}.`)
  if (matrix && matrix.schema !== CAPTURE_MATRIX_SCHEMA) issue(errors, 'CAPTURE_MATRIX_INVALID', `Expected ${CAPTURE_MATRIX_SCHEMA}.`)
  if (presentation && presentation.schema !== REVIEW_PRESENTATION_SCHEMA) issue(errors, 'REVIEW_PRESENTATION_INVALID', `Expected ${REVIEW_PRESENTATION_SCHEMA}.`)
  if (handoff && handoff.schema !== REVIEW_HANDOFF_SCHEMA) issue(errors, 'REVIEW_HANDOFF_INVALID', `Expected ${REVIEW_HANDOFF_SCHEMA}.`)

  const matrixRows = Array.isArray(matrix?.rows) ? matrix.rows : []
  const inventoryRows = Array.isArray(inventory?.rows) ? inventory.rows : []
  const presentationRows = Array.isArray(presentation?.rows) ? presentation.rows : []
  if (inventoryRows.length === 0 || !completeSourceRevisions(inventory?.sourceRevisions)) {
    issue(errors, 'CAPTURE_SOURCE_INVENTORY_INVALID', 'Source inventory must contain revision-bound expected rows.')
  }
  if (matrixRows.length === 0) issue(errors, 'CAPTURE_MATRIX_INCOMPLETE', 'Capture matrix must contain at least one row.')

  const passedIds = new Set()
  const matrixById = new Map()
  for (const row of matrixRows) {
    const missingFields = MATRIX_STRING_FIELDS.filter(field => !nonEmptyString(row?.[field]))
    if (missingFields.length > 0
      || !Array.isArray(row?.sourceIds) || row.sourceIds.length === 0 || row.sourceIds.some(id => !nonEmptyString(id))
      || !completeSourceRevisions(row?.sourceRevisions)
      || !completeProductEvidence(row?.productEvidence, SELLER_SHELL_VARIANTS.has(row?.shellVariant))) {
      issue(errors, 'CAPTURE_MATRIX_INCOMPLETE', 'Every matrix row needs complete source, product, state, viewport, result, and screenshot evidence.', { rowId: row?.id, missingFields })
      continue
    }
    if (matrixById.has(row.id)) issue(errors, 'CAPTURE_MATRIX_DUPLICATE', 'Matrix row IDs must be unique.', { rowId: row.id })
    matrixById.set(row.id, row)
    if (row.status !== 'passed') issue(errors, 'CAPTURE_MATRIX_ROW_FAILED', 'Every matrix row must pass before presentation.', { rowId: row.id })
    else passedIds.add(row.id)
    const screenshotPath = safeArtifactPath(directory, row.screenshotPath)
    if (!screenshotPath || !existsSync(screenshotPath)) {
      issue(errors, 'CAPTURE_SCREENSHOT_MISSING', 'Matrix screenshot must exist inside the capture package.', { rowId: row.id, screenshotPath: row.screenshotPath })
    } else if (!isPng(screenshotPath)) {
      issue(errors, 'CAPTURE_SCREENSHOT_INVALID', 'Matrix screenshot must be a PNG image.', { rowId: row.id })
    } else if (fileHash(screenshotPath) !== row.screenshotHash) {
      issue(errors, 'CAPTURE_SCREENSHOT_HASH_MISMATCH', 'Matrix screenshot hash must match the captured file.', { rowId: row.id })
    } else if (!completeBrowserEvidence(row.browserEvidence, pngDimensions(screenshotPath), SELLER_SHELL_VARIANTS.has(row.shellVariant), row.viewport)) {
      issue(errors, 'CAPTURE_BROWSER_EVIDENCE_INVALID', 'Browser evidence must bind real image dimensions, visible product regions, and zero review-only UI matches.', { rowId: row.id })
    }
  }
  const requiredRowIds = Array.isArray(matrix?.requiredRowIds) ? matrix.requiredRowIds : []
  const requiredSet = new Set(requiredRowIds.filter(nonEmptyString))
  const missingRequiredIds = [...requiredSet].filter(id => !matrixById.has(id))
  const unexpectedMatrixIds = [...matrixById.keys()].filter(id => !requiredSet.has(id))
  if (requiredRowIds.length === 0 || requiredSet.size !== requiredRowIds.length || missingRequiredIds.length > 0 || unexpectedMatrixIds.length > 0) {
    issue(errors, 'CAPTURE_MATRIX_INCOMPLETE', 'requiredRowIds must account for every unique matrix row exactly once.', { missingRequiredIds, unexpectedMatrixIds })
  }

  const inventoryById = new Map()
  for (const row of inventoryRows) {
    const missingFields = SOURCE_INVENTORY_ROW_FIELDS.filter(field => !nonEmptyString(row?.[field]))
    if (missingFields.length > 0 || !Array.isArray(row?.sourceIds) || row.sourceIds.length === 0 || row.sourceIds.some(id => !nonEmptyString(id))) {
      issue(errors, 'CAPTURE_SOURCE_INVENTORY_INVALID', 'Every source inventory row needs complete identity, route, shell, viewport, and source IDs.', { rowId: row?.id, missingFields })
      continue
    }
    if (inventoryById.has(row.id)) issue(errors, 'CAPTURE_SOURCE_INVENTORY_INVALID', 'Source inventory row IDs must be unique.', { rowId: row.id })
    inventoryById.set(row.id, row)
    const matrixRow = matrixById.get(row.id)
    if (!matrixRow || SOURCE_INVENTORY_ROW_FIELDS.some(field => matrixRow[field] !== row[field])
      || JSON.stringify(matrixRow?.sourceIds) !== JSON.stringify(row.sourceIds)) {
      issue(errors, 'CAPTURE_SOURCE_INVENTORY_MISMATCH', 'Every source-required row must map exactly to one matrix row.', { rowId: row.id })
    }
    if (matrixRow && !sameStringRecord(matrixRow.sourceRevisions, inventory.sourceRevisions)) {
      issue(errors, 'CAPTURE_SOURCE_REVISION_MISMATCH', 'Matrix source revisions must match the source inventory exactly.', { rowId: row.id })
    }
  }
  const unexpectedInventoryMatrixIds = [...matrixById.keys()].filter(id => !inventoryById.has(id))
  if (unexpectedInventoryMatrixIds.length > 0 || inventoryById.size !== matrixById.size) {
    issue(errors, 'CAPTURE_SOURCE_INVENTORY_MISMATCH', 'Matrix rows must match the independent source inventory exactly.', { unexpectedMatrixIds: unexpectedInventoryMatrixIds })
  }
  if (handoff?.decision && !sameStringRecord(handoff.decision.sourceRevisions, inventory?.sourceRevisions)) {
    issue(errors, 'CAPTURE_SOURCE_REVISION_MISMATCH', 'Decision source revisions must match the audited source inventory.')
  }

  if (!Array.isArray(presentation?.ia) || presentation.ia.length === 0
    || presentation.ia.some(item => IA_STRING_FIELDS.some(field => !nonEmptyString(item?.[field])))
    || presentation?.display?.status !== 'passed') {
    issue(errors, 'REVIEW_PRESENTATION_INCOMPLETE', 'Presentation needs compact IA and passed display status.')
  }
  const iaScreenIds = new Set((presentation?.ia ?? []).flatMap(item => [item?.fromScreenId, item?.toScreenId]).filter(nonEmptyString))
  const missingIaScreenIds = [...new Set(inventoryRows.map(row => row?.screenId).filter(nonEmptyString))].filter(screenId => !iaScreenIds.has(screenId))
  if (missingIaScreenIds.length > 0) {
    issue(errors, 'REVIEW_PRESENTATION_INCOMPLETE', 'Compact IA must include every source-inventory screen destination.', { missingIaScreenIds })
  }
  const presentedIds = new Set()
  for (const row of presentationRows) {
    const missingFields = PRESENTATION_STRING_FIELDS.filter(field => !nonEmptyString(row?.[field]))
    if (missingFields.length > 0
      || row.displayStatus !== 'shown'
      || !Array.isArray(row?.sourceIds) || row.sourceIds.length === 0 || row.sourceIds.some(id => !nonEmptyString(id))
      || !Number.isInteger(row?.order) || row.order < 1
      || !Number.isInteger(row?.memoRevision) || row.memoRevision < 0) {
      issue(errors, 'REVIEW_PRESENTATION_INCOMPLETE', 'Every presentation row needs screenshot, caption, result, function specification, memo identity, and shown status.', { matrixRowId: row?.matrixRowId, missingFields })
      continue
    }
    if (presentedIds.has(row.matrixRowId)) issue(errors, 'REVIEW_PRESENTATION_DUPLICATE', 'Each matrix row appears once in the presentation.', { matrixRowId: row.matrixRowId })
    presentedIds.add(row.matrixRowId)
    const matrixRow = matrixById.get(row.matrixRowId)
    if (matrixRow && (row.screenshotPath !== matrixRow.screenshotPath
      || row.screenId !== matrixRow.screenId
      || row.state !== matrixRow.state
      || row.viewport !== matrixRow.viewport
      || row.memoScreenId !== matrixRow.memoScreenId
      || row.observableResult !== matrixRow.observableResult
      || JSON.stringify(row.sourceIds) !== JSON.stringify(matrixRow.sourceIds))) {
      issue(errors, 'REVIEW_PRESENTATION_MISMATCH', 'Presentation evidence must match its matrix row.', { matrixRowId: row.matrixRowId })
    }
    const memo = handoff?.memos?.[row.memoScreenId]
    const currentMemoRevision = memo?.revision ?? 0
    if (row.memoRevision !== currentMemoRevision || (row.memoRevision > 0 && !nonEmptyString(memo?.content))) {
      issue(errors, 'REVIEW_MEMO_MISMATCH', 'Presentation memo revision must match the current durable screen memo.', { matrixRowId: row.matrixRowId, memoScreenId: row.memoScreenId })
    }
    if (!safeArtifactPath(directory, row.screenshotPath) || !existsSync(resolve(directory, row.screenshotPath))) {
      issue(errors, 'CAPTURE_SCREENSHOT_MISSING', 'Presentation screenshot must exist inside the capture package.', { matrixRowId: row.matrixRowId })
    }
  }
  const missingPresentationIds = [...passedIds].filter(id => !presentedIds.has(id))
  const unexpectedPresentationIds = [...presentedIds].filter(id => !passedIds.has(id))
  if (missingPresentationIds.length > 0 || unexpectedPresentationIds.length > 0 || presentationRows.length !== passedIds.size) {
    issue(errors, 'REVIEW_PRESENTATION_INCOMPLETE', 'Presentation must account for every passed matrix row exactly once.', { missingPresentationIds, unexpectedPresentationIds })
  }
  const orders = presentationRows.map(row => row?.order).filter(Number.isInteger).sort((a, b) => a - b)
  if (orders.length !== presentationRows.length || orders.some((order, index) => order !== index + 1)) {
    issue(errors, 'REVIEW_PRESENTATION_INCOMPLETE', 'Presentation order must be unique and contiguous from 1.')
  }

  return {
    status: errors.length === 0 ? 'passed' : 'failed',
    summary: { matrixRowCount: matrixRows.length, presentationRowCount: presentationRows.length },
    errors,
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  const captureDir = process.argv[2]
  try {
    const result = auditCapturePackage(captureDir)
    process.stdout.write(`${JSON.stringify(result)}\n`)
    if (result.status === 'failed') process.exitCode = 1
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'failed', code: 'CAPTURE_PACKAGE_AUDIT_INTERNAL_ERROR', message: error.message })}\n`)
    process.exitCode = 1
  }
}
