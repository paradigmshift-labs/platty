import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditPrototypeHtml } from './prototype-audit.mjs'

const REQUIRED_SCENARIO_FIELDS = ['id', 'given', 'when', 'expected', 'actual', 'status']

function issue(errors, code, message, context = {}) {
  errors.push({ code, ...context, message })
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function nonEmptyStrings(value) {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmptyString)
}

function prototypeModel(html, errors) {
  const match = html.match(/<script\b[^>]*data-prototype-model[^>]*>([\s\S]*?)<\/script>/iu)
  if (!match) return null
  try {
    return JSON.parse(match[1])
  } catch (error) {
    issue(errors, 'MODEL_INVALID', 'The embedded prototype model must be valid JSON.', { details: error.message })
    return null
  }
}

function missingValues(required, observed) {
  return [...required].filter(value => !observed.has(value))
}

export function auditPrototypeHandoff(html, handoff) {
  const errors = []
  const staticAudit = auditPrototypeHtml(html)
  if (staticAudit.status !== 'passed') {
    issue(errors, 'STATIC_AUDIT_FAILED', 'The deterministic HTML audit must pass before behavioral acceptance.', { staticErrors: staticAudit.errors })
  }

  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)) {
    issue(errors, 'HANDOFF_INVALID', 'Prototype handoff must be a JSON object.')
    return { status: 'failed', summary: { scenarioCount: 0, viewportCount: 0 }, errors }
  }

  const model = prototypeModel(html, errors)
  const behavioral = handoff.verification?.behavioralAcceptance
  if (!behavioral || typeof behavioral !== 'object' || Array.isArray(behavioral)) {
    issue(errors, 'BEHAVIORAL_VERIFICATION_MISSING', 'Handoff verification must include browser-executed behavioral acceptance evidence.')
    return { status: 'failed', summary: { scenarioCount: 0, viewportCount: 0 }, errors }
  }

  const scenarios = Array.isArray(behavioral.scenarios) ? behavioral.scenarios : []
  const viewportResults = Array.isArray(behavioral.viewportResults) ? behavioral.viewportResults : []
  if (behavioral.status !== 'passed' || scenarios.some(scenario => scenario?.status !== 'passed')) {
    issue(errors, 'BEHAVIORAL_VERIFICATION_FAILED', 'Behavioral acceptance and every recorded scenario must pass.')
  }
  if (!nonEmptyString(behavioral.executedAt) || !nonEmptyString(behavioral.tool)) {
    issue(errors, 'BEHAVIORAL_VERIFICATION_INCOMPLETE', 'Behavioral acceptance must record executedAt and the browser tool used.')
  }

  const observedSourceIds = new Set()
  const observedControlIds = new Set()
  const observedCategories = new Set()
  for (const scenario of scenarios) {
    const complete = scenario && REQUIRED_SCENARIO_FIELDS.every(field => nonEmptyString(scenario[field]))
      && scenario.status === 'passed'
      && nonEmptyStrings(scenario.categories)
      && nonEmptyStrings(scenario.sourceScenarioIds)
      && nonEmptyStrings(scenario.screenIds)
      && nonEmptyStrings(scenario.controlIds)
      && nonEmptyStrings(scenario.evidence)
    if (!complete) issue(errors, 'BEHAVIORAL_SCENARIO_INCOMPLETE', 'Each behavioral scenario must bind source and control IDs to given/when/expected/actual, passing status, and evidence.', { scenarioId: scenario?.id })
    for (const id of scenario?.sourceScenarioIds ?? []) observedSourceIds.add(id)
    for (const id of scenario?.controlIds ?? []) observedControlIds.add(id)
    for (const category of scenario?.categories ?? []) observedCategories.add(category)
  }

  const requiredSourceIds = new Set(handoff.coverage?.coveredScenarioIds ?? [])
  const missingSourceIds = missingValues(requiredSourceIds, observedSourceIds)
  if (requiredSourceIds.size === 0 || missingSourceIds.length > 0) {
    issue(errors, 'SOURCE_SCENARIO_COVERAGE_MISSING', 'Behavioral scenarios must cover every handoff coveredScenarioId.', { missingSourceIds })
  }

  const controls = Array.isArray(model?.controls) ? model.controls : []
  const requiredControlIds = new Set(controls.map(control => control.id).filter(nonEmptyString))
  const missingControlIds = missingValues(requiredControlIds, observedControlIds)
  if (requiredControlIds.size === 0 || missingControlIds.length > 0) {
    issue(errors, 'CONTROL_BEHAVIOR_COVERAGE_MISSING', 'Behavioral scenarios must exercise every modeled review control.', { missingControlIds })
  }

  const screens = Array.isArray(model?.screens) ? model.screens : []
  if (screens.some(screen => Array.isArray(screen.states) && screen.states.length > 1) && !observedCategories.has('state-transition')) {
    issue(errors, 'STATE_BEHAVIOR_COVERAGE_MISSING', 'Multi-state screens require browser evidence categorized as state-transition.')
  }
  if (controls.some(control => nonEmptyString(control.targetScreenId)) && !observedCategories.has('navigation')) {
    issue(errors, 'NAVIGATION_BEHAVIOR_COVERAGE_MISSING', 'Targeted controls require browser evidence categorized as navigation.')
  }
  if (controls.some(control => /(?:download|export)/u.test(control.action)) && !observedCategories.has('export')) {
    issue(errors, 'EXPORT_BEHAVIOR_COVERAGE_MISSING', 'Export or download controls require downloaded-content evidence categorized as export.')
  }
  if (controls.some(control => control.action === 'memo') && !observedCategories.has('memo-persistence')) {
    issue(errors, 'MEMO_BEHAVIOR_COVERAGE_MISSING', 'Review memos require navigation, reload, and isolation evidence categorized as memo-persistence.')
  }

  const supportedViewports = new Set(handoff.verification?.supportedViewports ?? [])
  const passedViewports = new Set(viewportResults
    .filter(result => result?.status === 'passed' && nonEmptyString(result.evidence))
    .map(result => result.viewport))
  const missingViewports = missingValues(supportedViewports, passedViewports)
  if (supportedViewports.size === 0 || missingViewports.length > 0 || !observedCategories.has('responsive')) {
    issue(errors, 'VIEWPORT_BEHAVIOR_COVERAGE_MISSING', 'Every supported viewport requires passing browser evidence and a responsive scenario.', { missingViewports })
  }

  return {
    status: errors.length === 0 ? 'passed' : 'failed',
    summary: { scenarioCount: scenarios.length, viewportCount: viewportResults.length },
    errors,
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  const [htmlPath, handoffPath] = process.argv.slice(2)
  if (!htmlPath || !handoffPath || !isAbsolute(htmlPath) || !isAbsolute(handoffPath)) {
    process.stderr.write('{"status":"failed","code":"PROTOTYPE_PATHS_ABSOLUTE_REQUIRED"}\n')
    process.exitCode = 1
  } else {
    try {
      const result = auditPrototypeHandoff(
        readFileSync(htmlPath, 'utf8'),
        JSON.parse(readFileSync(handoffPath, 'utf8')),
      )
      process.stdout.write(`${JSON.stringify(result)}\n`)
      if (result.status === 'failed') process.exitCode = 1
    } catch (error) {
      process.stderr.write(`${JSON.stringify({ status: 'failed', code: 'PROTOTYPE_HANDOFF_AUDIT_INTERNAL_ERROR', message: error.message })}\n`)
      process.exitCode = 1
    }
  }
}
