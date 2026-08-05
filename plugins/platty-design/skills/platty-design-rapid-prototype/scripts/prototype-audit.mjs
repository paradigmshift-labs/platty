import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const NATIVE_CONTROLS = new Set(['a', 'button', 'input', 'select', 'textarea'])

function issue(errors, code, message, context = {}) {
  errors.push({ code, ...context, message })
}

function parseAttributes(source = '') {
  const attrs = {}
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu
  for (const match of source.matchAll(pattern)) {
    const name = match[1].toLowerCase()
    attrs[name] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return attrs
}

function maskScriptBodies(html) {
  return html.replace(/(<script\b[^>]*>)[\s\S]*?(<\/script\s*>)/giu, (full, opening, closing) => `${opening}${' '.repeat(Math.max(0, full.length - opening.length - closing.length))}${closing}`)
}

function parseDocument(html) {
  const masked = maskScriptBodies(html)
  const roots = []
  const stack = []
  const elements = []
  const tokenPattern = /<\s*(\/?)\s*([a-z][\w:-]*)([^>]*?)(\/?)\s*>/giu
  for (const match of masked.matchAll(tokenPattern)) {
    const start = match.index
    const end = start + match[0].length
    const name = match[2].toLowerCase()
    const closing = match[1] === '/'
    if (closing) {
      let index = stack.length - 1
      while (index >= 0 && stack[index].name !== name) index -= 1
      if (index >= 0) {
        const element = stack[index]
        element.closeStart = start
        element.end = end
        element.contentEnd = start
        stack.splice(index)
      }
      continue
    }
    const element = {
      name,
      attrs: parseAttributes(match[3]),
      start,
      end,
      contentStart: end,
      contentEnd: end,
      parent: stack.at(-1) ?? null,
      children: [],
    }
    elements.push(element)
    if (element.parent) element.parent.children.push(element)
    else roots.push(element)
    if (!element.parent && !stack.length) roots.push(...[])
    if (VOID_ELEMENTS.has(name) || match[4] === '/') {
      element.contentEnd = end
      continue
    }
    stack.push(element)
  }
  return { masked, roots, elements }
}

function descendants(element, includeSelf = false) {
  const result = []
  const visit = (candidate) => {
    result.push(candidate)
    for (const child of candidate.children) visit(child)
  }
  if (includeSelf) visit(element)
  else for (const child of element.children) visit(child)
  return result
}

function nearestScreen(element) {
  let current = element
  while (current) {
    if (current.attrs['data-screen-id']) return current
    current = current.parent
  }
  return null
}

function nearestAncestor(element, name) {
  let current = element.parent
  while (current) {
    if (current.name === name) return current
    current = current.parent
  }
  return null
}

function elementText(element, html) {
  return html.slice(element.contentStart, element.contentEnd).replace(/<[^>]*>/gu, '').replace(/\s+/gu, ' ').trim()
}

function scriptContent(element, html) {
  return html.slice(element.contentStart, element.contentEnd)
}

function hasMemoPersistenceRuntime(source) {
  return /querySelectorAll\s*\(\s*['"]\[data-review-memo\]['"]\s*\)/u.test(source)
    && /addEventListener\s*\(\s*['"](?:input|change)['"]/u.test(source)
    && /addEventListener\s*\(\s*['"]statechange['"]/u.test(source)
    && /(?:dataset\.storageKey|getAttribute\s*\(\s*['"]data-storage-key['"]\s*\))/u.test(source)
    && /closest\s*\(\s*['"]\[data-screen-id\]['"]\s*\)/u.test(source)
    && /(?:window\.)?location\.(?:pathname|hash)/u.test(source)
    && /dataset\.state/u.test(source)
    && /['"]\{route\}['"]/u.test(source)
    && /['"]\{state\}['"]/u.test(source)
    && /\.value\b/u.test(source)
    && /localStorage\.getItem\s*\(/u.test(source)
    && /localStorage\.setItem\s*\(/u.test(source)
}

function hasNavigationRuntime(source) {
  return /\[data-action-target\]/u.test(source)
    && /\[data-screen-id\]/u.test(source)
    && /addEventListener\s*\(\s*['"]click['"]/u.test(source)
    && /(?:dataset\.actionTarget|getAttribute\s*\(\s*['"]data-action-target['"]\s*\))/u.test(source)
    && /\.hidden\b/u.test(source)
}

function hasStateRuntime(source) {
  return /\[data-action=["'](?:submit|validate)["']\]/u.test(source)
    && /addEventListener\s*\(\s*['"](?:click|submit)['"]/u.test(source)
    && /dataset\.state/u.test(source)
    && /['"]invalid['"]/u.test(source)
    && /['"]success['"]/u.test(source)
}

function jsonMarker(elements, html, marker, errors) {
  const scripts = elements.filter(element => element.name === 'script' && marker in element.attrs)
  if (scripts.length === 0) {
    issue(errors, marker === 'data-prototype-provenance' ? 'PROVENANCE_MISSING' : 'MODEL_MISSING', `Missing ${marker} JSON block.`)
    return null
  }
  try {
    return JSON.parse(scriptContent(scripts[0], html))
  } catch (error) {
    issue(errors, marker === 'data-prototype-provenance' ? 'PROVENANCE_INVALID' : 'MODEL_INVALID', `${marker} must contain valid JSON.`, { details: error.message })
    return null
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function hasSourceRevision(source) {
  return source && typeof source === 'object' && nonEmptyString(source.path) && nonEmptyString(source.revision)
}

function provenanceComplete(provenance) {
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) return false
  if (!hasSourceRevision(provenance.prd) || !hasSourceRevision(provenance.userStories)) return false
  const designSystem = provenance.designSystem
  if (!designSystem || !['ready', 'absent', 'unavailable'].includes(designSystem.status)) return false
  return designSystem.status === 'ready'
    ? nonEmptyString(designSystem.repositoryPath)
      && nonEmptyString(designSystem.revision)
      && Array.isArray(designSystem.evidenceFiles)
      && designSystem.evidenceFiles.length > 0
      && designSystem.evidenceFiles.every(nonEmptyString)
    : nonEmptyString(designSystem.availabilityGap)
}

function hasStringFields(value, fields) {
  return value && typeof value === 'object' && fields.every(field => nonEmptyString(value[field]))
}

function modelComplete(model, screenIds, controlIds) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) return false
  const { actors, screens, flow, controls, functionSpecs } = model
  if (![actors, screens, flow, controls, functionSpecs].every(value => Array.isArray(value) && value.length > 0)) return false
  if (!actors.every(actor => hasStringFields(actor, ['id', 'label']))) return false
  const actorIds = new Set(actors.map(actor => actor.id))
  if (!screens.every(screen => hasStringFields(screen, ['id', 'actorId', 'label', 'purpose', 'route'])
    && actorIds.has(screen.actorId)
    && Array.isArray(screen.states)
    && screen.states.length > 0
    && screen.states.every(nonEmptyString))) return false
  const modelScreenIds = new Set(screens.map(screen => screen.id))
  if (modelScreenIds.size !== screenIds.size || [...screenIds].some(id => !modelScreenIds.has(id))) return false
  if (!flow.every(edge => hasStringFields(edge, ['fromScreenId', 'toScreenId'])
    && modelScreenIds.has(edge.fromScreenId)
    && modelScreenIds.has(edge.toScreenId))) return false
  if (!controls.every(control => hasStringFields(control, ['id', 'screenId', 'number', 'nativeElement', 'action'])
    && Object.hasOwn(control, 'targetScreenId')
    && modelScreenIds.has(control.screenId)
    && (control.targetScreenId === null || modelScreenIds.has(control.targetScreenId)))) return false
  const modelControlIds = new Set(controls.map(control => control.id))
  if (modelControlIds.size !== controlIds.size || [...controlIds].some(id => !modelControlIds.has(id))) return false
  if (!functionSpecs.every(spec => hasStringFields(spec, ['controlId', 'screenId', 'number', 'name', 'behavior', 'validation', 'outcome'])
    && modelControlIds.has(spec.controlId)
    && modelScreenIds.has(spec.screenId))) return false
  const specControlIds = new Set(functionSpecs.map(spec => spec.controlId))
  return specControlIds.size === controlIds.size && [...controlIds].every(id => specControlIds.has(id))
}

function screenSpecFor(screen, elements) {
  return elements.find(element => element.attrs['data-screen-spec'] === screen.attrs['data-screen-id']) ?? null
}

function isAdjacent(screen, spec) {
  if (!screen.parent || !spec || spec.parent !== screen.parent) return false
  const index = screen.parent.children.indexOf(screen)
  return screen.parent.children[index + 1] === spec
}

export function auditPrototypeHtml(html) {
  const errors = []
  if (typeof html !== 'string' || html.trim().length === 0) {
    issue(errors, 'HTML_EMPTY', 'Prototype HTML must be a non-empty string.')
    return { status: 'failed', summary: { pageCount: 0, screenCount: 0, controlCount: 0, functionSpecCount: 0, memoCount: 0 }, errors }
  }

  const { elements } = parseDocument(html)
  const screens = elements.filter(element => element.attrs['data-screen-id'])
  const screenIds = new Set()
  for (const screen of screens) {
    const screenId = screen.attrs['data-screen-id']
    if (screenIds.has(screenId)) issue(errors, 'SCREEN_ID_DUPLICATE', `Duplicate screen id ${screenId}.`, { screenId })
    screenIds.add(screenId)
    if (!screen.attrs['data-role']) issue(errors, 'SCREEN_ROLE_MISSING', `Screen ${screenId} needs a role.`, { screenId })
    const states = (screen.attrs['data-states'] ?? '').split(',').map(state => state.trim()).filter(Boolean)
    if (states.length === 0) issue(errors, 'SCREEN_STATES_MISSING', `Screen ${screenId} needs a non-empty state list.`, { screenId })
  }

  const flowNodes = elements.filter(element => 'data-flow-node' in element.attrs)
  for (const node of flowNodes) {
    if (node.attrs['data-flow-node'] !== 'page') issue(errors, 'FLOW_ACTION_NODE', 'IA flow nodes must represent pages/screens only.', { screenId: node.attrs['data-screen-ref'] })
    if (!screenIds.has(node.attrs['data-screen-ref'])) issue(errors, 'FLOW_TARGET_MISSING', 'IA flow node must reference an existing screen.', { screenId: node.attrs['data-screen-ref'] })
  }
  const connectors = elements.filter(element => 'data-flow-connector' in element.attrs)
  for (const connector of connectors) {
    if (connector.attrs['data-style'] !== 'solid') issue(errors, 'FLOW_DOTTED_CONNECTOR', 'IA connectors must use a solid route style.')
  }

  const controls = elements.filter(element => 'data-control-id' in element.attrs)
  const controlIds = new Set()
  const functionNumbers = new Set()
  const specs = elements.filter(element => 'data-function-id' in element.attrs)
  const specPanels = elements.filter(element => 'data-screen-spec' in element.attrs)
  const badges = elements.filter(element => 'data-control-number' in element.attrs)
  const memos = elements.filter(element => 'data-review-memo' in element.attrs)
  const storageKeys = new Set()

  if ([flowNodes, screens, controls, specs, memos].some(collection => collection.length === 0)) {
    issue(errors, 'PROTOTYPE_STRUCTURE_EMPTY', 'Prototype HTML must include flow nodes, screens, controls, function specs, and review memos.')
  }

  for (const control of controls) {
    const controlId = control.attrs['data-control-id']
    const screen = nearestScreen(control)
    const screenId = screen?.attrs['data-screen-id']
    if (!NATIVE_CONTROLS.has(control.name)) issue(errors, 'CONTROL_NOT_NATIVE', `Control ${controlId} must use a native HTML control.`, { controlId, screenId })
    if (!controlId) issue(errors, 'CONTROL_ID_MISSING', 'Interactive controls need a non-empty data-control-id.', { screenId })
    if (controlIds.has(controlId)) issue(errors, 'CONTROL_ID_DUPLICATE', `Duplicate control id ${controlId}.`, { controlId, screenId })
    controlIds.add(controlId)
    const functionNumber = control.attrs['data-function-number']
    if (!functionNumber) issue(errors, 'CONTROL_NUMBER_MISSING', `Control ${controlId} needs a function number.`, { controlId, screenId })
    if (functionNumbers.has(functionNumber)) issue(errors, 'CONTROL_NUMBER_DUPLICATE', `Duplicate function number ${functionNumber}.`, { controlId, screenId })
    if (functionNumber) functionNumbers.add(functionNumber)
    if (!(control.attrs['data-action'] ?? '').trim()) issue(errors, 'CONTROL_ACTION_MISSING', `Control ${controlId} needs a non-empty action.`, { controlId, screenId })
    const badge = badges.find(candidate => candidate.attrs['data-control-number'] === controlId)
    if (!badge || elementText(badge, html) !== functionNumber) issue(errors, 'CONTROL_NUMBER_BADGE_MISSING', `Control ${controlId} needs one visible matching number badge.`, { controlId, screenId })
    const target = control.attrs['data-action-target']
    if (target && !screenIds.has(target)) issue(errors, 'ACTION_TARGET_MISSING', `Control ${controlId} targets a missing screen.`, { controlId, screenId })
    if (!screen) {
      issue(errors, 'CONTROL_SCREEN_MISSING', `Control ${controlId} must belong to a screen.`, { controlId })
      continue
    }
    const panel = screenSpecFor(screen, elements)
    const sameScreenSpecs = panel ? descendants(panel, true).filter(element => 'data-function-id' in element.attrs && element.attrs['data-function-id'] === controlId) : []
    const matchingSpec = sameScreenSpecs.filter(spec => spec.attrs['data-function-number'] === functionNumber)
    if (matchingSpec.length === 0) {
      issue(errors, sameScreenSpecs.length > 0 ? 'FUNCTION_NUMBER_MISMATCH' : 'FUNCTION_SPEC_MISSING', `Control ${controlId} needs exactly one matching function-spec row.`, { controlId, screenId })
    } else if (matchingSpec.length > 1 || sameScreenSpecs.length > 1) {
      issue(errors, 'FUNCTION_SPEC_DUPLICATE', `Control ${controlId} has duplicate function-spec rows.`, { controlId, screenId })
    }
  }

  for (const screen of screens) {
    const screenId = screen.attrs['data-screen-id']
    const panel = screenSpecFor(screen, elements)
    if (!panel || !isAdjacent(screen, panel)) issue(errors, 'SCREEN_SPEC_NOT_ADJACENT', `Screen ${screenId} must be immediately followed by its function-spec panel.`, { screenId })
    if (!panel) continue
    const summaries = descendants(panel, true).filter(element => 'data-interaction-summary' in element.attrs)
    if (summaries.length !== 1) issue(errors, 'INTERACTION_SUMMARY_MISSING', `Screen ${screenId} needs exactly one interaction summary.`, { screenId })
    const screenMemos = memos.filter(memo => nearestScreen(memo)?.attrs['data-screen-id'] === screenId)
    if (screenMemos.length !== 1) issue(errors, 'MEMO_MISSING', `Screen ${screenId} needs exactly one review memo.`, { screenId })
  }

  for (const memo of memos) {
    const key = memo.attrs['data-storage-key']
    const screenId = nearestScreen(memo)?.attrs['data-screen-id']
    if (!key || storageKeys.has(key)) issue(errors, 'MEMO_STORAGE_KEY_INVALID', 'Review memos need unique non-empty storage keys.', { screenId })
    if (!key?.includes('{route}') || !key?.includes('{state}') || !key?.includes(screenId)) {
      issue(errors, 'MEMO_SCOPE_INVALID', 'Review memo storage keys must be templates scoped to route, screen identity, and selected state.', { screenId })
    }
    const label = nearestAncestor(memo, 'label')
    const labelText = label ? elementText(label, html) : ''
    if (memo.name !== 'textarea' || !labelText.includes('검토 메모') || !labelText.includes('이 브라우저에만 저장됩니다.')) {
      issue(errors, 'MEMO_REVIEW_COPY_MISSING', 'Review memos must be labelled native textareas with visible browser-local-only storage copy.', { screenId })
    }
    if (key) storageKeys.add(key)
  }

  const persistenceScripts = elements.filter(element => 'data-memo-persistence' in element.attrs)
  if (!persistenceScripts.some(script => hasMemoPersistenceRuntime(scriptContent(script, html)))) {
    issue(errors, 'MEMO_PERSISTENCE_MISSING', 'A memo persistence script must bind every review memo to browser-local load and input/change storage updates.')
  }
  const targetedControls = controls.filter(control => (control.attrs['data-action-target'] ?? '').trim())
  const navigationScripts = elements.filter(element => 'data-navigation-runtime' in element.attrs)
  if (targetedControls.length > 0 && !navigationScripts.some(script => hasNavigationRuntime(scriptContent(script, html)))) {
    issue(errors, 'NAVIGATION_RUNTIME_MISSING', 'Controls with action targets require an executable click runtime that switches visible screens.')
  }
  const statefulControls = controls.filter(control => ['submit', 'validate'].includes(control.attrs['data-action']))
  const stateScripts = elements.filter(element => 'data-state-runtime' in element.attrs)
  if (statefulControls.length > 0 && !stateScripts.some(script => hasStateRuntime(scriptContent(script, html)))) {
    issue(errors, 'STATE_RUNTIME_MISSING', 'Submit or validation controls require an executable runtime that reaches invalid and success states.')
  }
  const provenance = jsonMarker(elements, html, 'data-prototype-provenance', errors)
  if (provenance && !provenanceComplete(provenance)) {
    issue(errors, 'PROVENANCE_INCOMPLETE', 'Prototype provenance must include revision-bound PRD, User Stories, and Design System status evidence.')
  }
  const model = jsonMarker(elements, html, 'data-prototype-model', errors)
  if (model && !modelComplete(model, screenIds, controlIds)) {
    issue(errors, 'MODEL_INCOMPLETE', 'Prototype model must include complete actor, screen, flow, control, and function-spec inventories matching the HTML.')
  }

  const viewport = elements.find(element => element.name === 'meta' && element.attrs.name === 'viewport')
  if (!viewport) issue(errors, 'VIEWPORT_META_MISSING', 'Prototype HTML needs a viewport meta element.')
  const supportedViewports = elements.find(element => 'data-supported-viewports' in element.attrs)?.attrs['data-supported-viewports']
  if (!(supportedViewports ?? '').trim()) issue(errors, 'VIEWPORT_COVERAGE_MISSING', 'Prototype HTML needs a non-empty supported viewport declaration.')

  const summary = {
    pageCount: flowNodes.length,
    screenCount: screens.length,
    controlCount: controls.length,
    functionSpecCount: specs.length,
    memoCount: memos.length,
  }
  return { status: errors.length === 0 ? 'passed' : 'failed', summary, errors }
}

export function assertPrototypeHtml(html) {
  const result = auditPrototypeHtml(html)
  if (result.status === 'failed') {
    const error = new Error(result.errors.map(({ code }) => code).join(', '))
    error.audit = result
    throw error
  }
  return result
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  const inputPath = process.argv[2]
  if (!inputPath || !isAbsolute(inputPath)) {
    process.stderr.write('{"status":"failed","code":"PROTOTYPE_HTML_PATH_ABSOLUTE_REQUIRED"}\n')
    process.exitCode = 1
  } else {
    try {
      const result = auditPrototypeHtml(readFileSync(inputPath, 'utf8'))
      process.stdout.write(`${JSON.stringify(result)}\n`)
      if (result.status === 'failed') process.exitCode = 1
    } catch (error) {
      process.stderr.write(`${JSON.stringify({ status: 'failed', code: 'PROTOTYPE_AUDIT_INTERNAL_ERROR', message: error.message })}\n`)
      process.exitCode = 1
    }
  }
}
