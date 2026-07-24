import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { loadOptionalFigmaHandoff } from './figma-handoff.mjs'
import {
  computeRequestRevision,
  computeStoriesRevision,
  parseSddArtifact,
} from './sdd-artifacts.mjs'

const BLOCKED_STATES = new Set(['BLOCKED', 'NEEDS_WORK', 'TASKS_STALE'])
const SHORT_CONTINUATIONS = new Set(['다음', '다음가자', '진행', '계속', '좋아', '추천대로'])
const SUPPORTED_TASK_SCHEMAS = new Set(['sdd-tasks.v3', 'sdd-tasks.v4'])

function normalizeUtterance(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s.!?]+/g, '')
}

function productApproved(product = {}) {
  return product.requestStatus === 'approved' && product.storiesStatus === 'approved'
}

function designApproved(design = {}) {
  return design.status === 'approved'
    && Boolean(design.designRevision)
    && design.approvedRevision === design.designRevision
    && design.readiness === 'ready'
}

function designProductBindingsCurrent(design = {}, product = {}) {
  if (!product.requestRevision && !product.storiesRevision) return true
  return Boolean(design.requestRevision)
    && design.requestRevision === product.requestRevision
    && Boolean(design.storiesRevision)
    && design.storiesRevision === product.storiesRevision
}

function taskBindingsCurrent(tasks = {}, design = {}) {
  return SUPPORTED_TASK_SCHEMAS.has(tasks.schemaVersion)
    && tasks.designSchemaVersion === 'sdd-design.v2'
    && tasks.status === 'planned'
    && tasks.executionReadiness === 'ready'
    && Boolean(tasks.designRevision)
    && tasks.designRevision === design.designRevision
    && tasks.approvedRevision === tasks.designRevision
    && Boolean(tasks.productInputFingerprint)
    && tasks.productInputFingerprint === design.productInputFingerprint
    && Boolean(tasks.evidenceFingerprint)
    && tasks.evidenceFingerprint === design.evidenceFingerprint
}

export function deriveSddWorkflowState(snapshot = {}) {
  const { product, design, tasks, figmaHandoff } = snapshot
  const designRoute = figmaHandoff?.status === 'current' ? 'FIGMA' : 'PLAIN'

  if (snapshot.blocked || ['BLOCKED', 'NEEDS_WORK'].includes(snapshot.state)) {
    return { state: snapshot.state ?? 'BLOCKED', nextAction: 'RECOVER_BLOCKER', designRoute }
  }
  if (!product || !product.requestStatus || !product.storiesStatus) {
    return { state: 'SPEC_MISSING', nextAction: 'CREATE_PRODUCT', designRoute }
  }
  if (!productApproved(product)) {
    return {
      state: 'PRODUCT_DRAFT',
      nextAction: product.hasOpenProductQuestions ? 'RESOLVE_PRODUCT_DECISION' : 'REQUEST_PRODUCT_APPROVAL',
      pendingGate: product.hasOpenProductQuestions ? 'PRODUCT_DECISION' : 'PRODUCT_APPROVAL',
      designRoute,
    }
  }
  if (!design) return { state: 'PRODUCT_APPROVED', nextAction: 'CREATE_DESIGN', designRoute }

  if (!designProductBindingsCurrent(design, product)) {
    return tasks
      ? { state: 'TASKS_STALE', nextAction: 'MARK_TASKS_STALE', designRoute }
      : { state: 'NEEDS_WORK', nextAction: 'REGENERATE_DESIGN', designRoute }
  }

  if (tasks && !taskBindingsCurrent(tasks, design)) {
    return { state: 'TASKS_STALE', nextAction: 'MARK_TASKS_STALE', designRoute }
  }
  if (design.status !== 'draft' && !designApproved(design)) {
    return { state: 'NEEDS_WORK', nextAction: 'RECOVER_BLOCKER', designRoute }
  }
  if (!designApproved(design)) {
    return {
      state: 'DESIGN_DRAFT',
      nextAction: 'REQUEST_DESIGN_APPROVAL',
      pendingGate: design.readiness === 'ready' ? 'DESIGN_APPROVAL' : undefined,
      designReadiness: design.readiness,
      designRoute,
    }
  }
  if (!tasks) return { state: 'DESIGN_APPROVED', nextAction: 'CREATE_TASKS', designRoute }
  return { state: 'TASKS_READY', nextAction: 'REPORT_IMPLEMENTATION_READY', designRoute }
}

export function routeSddContinuation(workflow, utterance) {
  const normalized = normalizeUtterance(utterance)
  if (BLOCKED_STATES.has(workflow.state)) return { action: 'RECOVER_BLOCKER' }
  if (!SHORT_CONTINUATIONS.has(normalized)) return { action: 'CLARIFY_INTENT' }

  if (workflow.pendingGate === 'PRODUCT_DECISION') {
    return { action: 'ACCEPT_RECOMMENDATION' }
  }
  if (workflow.state === 'PRODUCT_DRAFT'
    && workflow.pendingGate === 'PRODUCT_APPROVAL'
    && !workflow.hasOpenProductQuestions) {
    return { action: 'APPROVE_PRODUCT_THEN_CREATE_DESIGN' }
  }
  if (workflow.state === 'PRODUCT_APPROVED') return { action: 'CREATE_DESIGN' }
  if (workflow.state === 'DESIGN_DRAFT'
    && workflow.pendingGate === 'DESIGN_APPROVAL'
    && workflow.designReadiness === 'ready') {
    return { action: 'APPROVE_DESIGN_THEN_CREATE_TASKS' }
  }
  if (workflow.state === 'DESIGN_APPROVED') return { action: 'CREATE_TASKS' }
  if (workflow.state === 'TASKS_READY') return { action: 'REPORT_IMPLEMENTATION_READY' }
  return { action: 'CLARIFY_INTENT' }
}

function readOptionalArtifact(directory, filename) {
  const path = resolve(directory, filename)
  return existsSync(path) ? parseSddArtifact(filename, readFileSync(path, 'utf8')) : undefined
}

function hasOpenProductQuestions(prd) {
  return prd.body.split(/\r?\n/).some((line) =>
    /^\|\s*O-\d+\s*\|/i.test(line) && /\|\s*(?:open|blocked)\s*\|/i.test(line)
  )
}

export function inspectSddWorkflowDirectory(specDirectory) {
  const directory = resolve(specDirectory)
  try {
    const request = readOptionalArtifact(directory, 'prd.md')
    const stories = readOptionalArtifact(directory, 'user_stories.md')
    if (!request || !stories) return deriveSddWorkflowState({})

    const product = {
      requestStatus: request.metadata.status,
      storiesStatus: stories.metadata.status,
      requestRevision: computeRequestRevision(request),
      storiesRevision: computeStoriesRevision(stories),
      hasOpenProductQuestions: hasOpenProductQuestions(request),
    }
    const designArtifact = readOptionalArtifact(directory, 'system_design.md')
    const taskArtifact = readOptionalArtifact(directory, 'tasks.md')
    const design = designArtifact ? {
      status: designArtifact.metadata.status,
      requestRevision: designArtifact.metadata.requestRevision,
      storiesRevision: designArtifact.metadata.storiesRevision,
      designRevision: designArtifact.metadata.designRevision,
      approvedRevision: designArtifact.metadata.approvedRevision,
      productInputFingerprint: designArtifact.metadata.productInputFingerprint,
      evidenceFingerprint: designArtifact.metadata.evidenceFingerprint,
      readiness: designArtifact.metadata.review?.readiness,
    } : undefined
    const tasks = taskArtifact ? {
      schemaVersion: taskArtifact.metadata.schemaVersion,
      designSchemaVersion: taskArtifact.metadata.designSchemaVersion,
      status: taskArtifact.metadata.status,
      executionReadiness: taskArtifact.metadata.executionReadiness,
      designRevision: taskArtifact.metadata.designRevision,
      approvedRevision: taskArtifact.metadata.approvedRevision,
      productInputFingerprint: taskArtifact.metadata.productInputFingerprint,
      evidenceFingerprint: taskArtifact.metadata.evidenceFingerprint,
    } : undefined
    const figmaHandoff = loadOptionalFigmaHandoff(directory, {
      projectId: request.metadata.projectId,
      specId: request.metadata.id,
      requestRevision: product.requestRevision,
      storiesRevision: product.storiesRevision,
    })
    return deriveSddWorkflowState({
      product,
      design,
      tasks,
      figmaHandoff: figmaHandoff ? { status: 'current' } : undefined,
    })
  } catch (error) {
    return {
      state: 'BLOCKED',
      nextAction: 'RECOVER_BLOCKER',
      designRoute: 'BLOCKED',
      errorCode: error.code ?? 'SDD_WORKFLOW_STATE_ERROR',
      error: error.message,
    }
  }
}

function cli() {
  const [, , command, specDirectory, utterance] = process.argv
  if (command !== 'inspect' || !specDirectory) {
    throw new Error(`usage: node ${basename(process.argv[1])} inspect <SPEC-directory> [continuation]`)
  }
  const workflow = inspectSddWorkflowDirectory(specDirectory)
  const continuation = utterance ? routeSddContinuation(workflow, utterance) : undefined
  process.stdout.write(`${JSON.stringify({ workflow, ...(continuation ? { continuation } : {}) }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    cli()
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: error.message, ok: false })}\n`)
    process.exitCode = 1
  }
}
