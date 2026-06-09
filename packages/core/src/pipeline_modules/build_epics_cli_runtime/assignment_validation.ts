import type { ValidationIssue } from '@/pipeline_modules/build_epics_core/types.js'
import type { AssignmentSubmission } from './draft.js'
import type { BuildEpicsDocumentCard } from './types.js'

export interface AssignmentValidationInput {
  cards: BuildEpicsDocumentCard[]
  epics: Array<{ stableKey: string }>
  submission: AssignmentSubmission
}

const ASSIGNMENT_REASON_MIN_CHARS = 8
const ASSIGNMENT_REVIEW_COLLAPSE_RATIO = 0.5

export function validateAssignmentSubmission(input: AssignmentValidationInput): ValidationIssue[] {
  const errors: ValidationIssue[] = []
  const cardsById = new Map(input.cards.map((card) => [card.documentId, card]))
  const epicKeys = new Set(input.epics.map((epic) => epic.stableKey))
  const ownerCountByApiDoc = new Map<string, number>()
  const seenAssignments = new Set<string>()
  const totalAssignments = input.submission.assignments.length
  const reviewAssignments = input.submission.assignments.filter((assignment) => assignment.role === 'review').length

  for (const assignment of input.submission.assignments) {
    const card = cardsById.get(assignment.documentId)
    if (!card) {
      errors.push({
        severity: 'fatal',
        code: 'UNKNOWN_ASSIGNMENT_DOCUMENT',
        message: `Assignment references unknown document ${assignment.documentId}`,
        documentId: assignment.documentId,
      })
      continue
    }
    const assignmentKey = `${assignment.documentId}:${assignment.epicKey}:${assignment.role}`
    if (seenAssignments.has(assignmentKey)) {
      errors.push({
        severity: 'fatal',
        code: 'DUPLICATE_ASSIGNMENT',
        message: `Duplicate assignment for ${assignment.documentId}`,
        documentId: assignment.documentId,
      })
      continue
    }
    seenAssignments.add(assignmentKey)
    if (String(assignment.reason ?? '').trim().length < ASSIGNMENT_REASON_MIN_CHARS) {
      errors.push({
        severity: 'fatal',
        code: 'ASSIGNMENT_REASON_REQUIRED',
        message: `Assignment for ${assignment.documentId} must include a reason of at least ${ASSIGNMENT_REASON_MIN_CHARS} characters`,
        documentId: assignment.documentId,
      })
    }
    if (!epicKeys.has(assignment.epicKey)) {
      errors.push({
        severity: 'fatal',
        code: 'UNKNOWN_ASSIGNMENT_EPIC',
        message: `Assignment for ${assignment.documentId} targets unknown EPIC ${assignment.epicKey}`,
        documentId: assignment.documentId,
      })
      continue
    }
    if (card.type === 'api_spec') {
      if (assignment.role !== 'owner') {
        errors.push({
          severity: 'fatal',
          code: 'INVALID_API_ROLE',
          message: `API ${assignment.documentId} must be assigned with owner role`,
          documentId: assignment.documentId,
        })
      } else {
        ownerCountByApiDoc.set(assignment.documentId, (ownerCountByApiDoc.get(assignment.documentId) ?? 0) + 1)
      }
    }
  }

  for (const card of input.cards.filter((candidate) => candidate.type === 'api_spec')) {
    const ownerCount = ownerCountByApiDoc.get(card.documentId) ?? 0
    if (ownerCount === 0) {
      errors.push({
        severity: 'fatal',
        code: 'MISSING_API_ASSIGNMENT',
        message: `API ${card.documentId} must have one owner assignment in this chunk`,
        documentId: card.documentId,
      })
    } else if (ownerCount > 1) {
      errors.push({
        severity: 'fatal',
        code: 'DUPLICATE_API_ASSIGNMENT',
        message: `API ${card.documentId} has multiple owner assignments in this chunk`,
        documentId: card.documentId,
      })
    }
  }

  if (totalAssignments > 0 && reviewAssignments / totalAssignments > ASSIGNMENT_REVIEW_COLLAPSE_RATIO) {
    errors.push({
      severity: 'fatal',
      code: 'ASSIGNMENT_REVIEW_COLLAPSE',
      message: `Assignment sent ${reviewAssignments}/${totalAssignments} submitted assignments to review`,
    })
  }

  return errors
}
