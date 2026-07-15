#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const WEIGHTS = new Map([
  ['DESIGN_SCHEMA_VERSION_MISSING', 5],
  ['API_FIELD_PROVENANCE_MISSING', 25],
  ['API_FIELD_PROVENANCE_INCOMPLETE', 25],
  ['USER_VISIBLE_VALUE_SAFETY_UNPROVEN', 25],
  ['SOURCE_STATE_COVERAGE_MISSING', 20],
  ['SOURCE_STATE_COVERAGE_INCOMPLETE', 20],
  ['COMMAND_PREFLIGHT_MISSING', 15],
  ['COMMAND_PREFLIGHT_UNPROVEN', 15],
  ['COMMAND_EXPECTED_RED_INVALID', 15],
  ['COMMAND_SOURCE_CONFIRMATION_INVALID', 15],
  ['SOURCE_HEAD_CHECK_MISSING', 10],
  ['SOURCE_HEAD_MISMATCH', 10],
  ['FRONTEND_TOPOLOGY_MISSING', 15],
  ['FRONTEND_TOPOLOGY_INCOMPLETE', 15],
  ['PAGINATION_CONTRACT_MISSING', 20],
  ['PAGINATION_CONTRACT_INCOMPLETE', 20],
  ['SLICE_OWNERSHIP_INCOMPLETE', 20],
  ['SLICE_DEPENDENCY_CONTRADICTION', 15],
  ['TASK_SCHEMA_VERSION_UNSUPPORTED', 5],
  ['TASK_CONTRACT_REFERENCE_MISSING', 5],
  ['TASK_REVISION_BINDING_MISMATCH', 25],
  ['TASK_PLACEHOLDER_FOUND', 20],
  ['TASK_IMPLEMENTATION_PACKET_INCOMPLETE', 25],
  ['TASK_MODULE_PLAN_MISSING', 25],
  ['TASK_MODULE_CHECKLIST_INCOMPLETE', 25],
  ['TASK_API_CONTRACT_INCOMPLETE', 25],
  ['TASK_DATA_PLAN_INCOMPLETE', 25],
  ['TASK_VERIFICATION_CHECKLIST_INCOMPLETE', 25],
  ['TASK_EXECUTION_PREFLIGHT_INCOMPLETE', 25],
  ['TASK_TRACEABILITY_INCOMPLETE', 20],
  ['DESIGN_REVIEW_NOT_READY', 25],
  ['DESIGN_REVISION_MISMATCH', 25],
  ['PRODUCT_INPUT_FINGERPRINT_MISMATCH', 25],
])

function argument(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function finding(code, message) {
  return { code, severity: 'critical', message }
}

function section(markdown, heading) {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === heading)
  if (start === -1) return undefined
  const collected = []
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,4}\s+/.test(lines[index])) break
    collected.push(lines[index])
  }
  return collected.join('\n')
}

function numberedSection(markdown, sectionNumber) {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex((line) => new RegExp(`^##\\s+${sectionNumber}\\.`).test(line.trim()))
  if (start === -1) return undefined
  const collected = []
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) break
    collected.push(lines[index])
  }
  return collected.join('\n')
}

function tableRows(markdownSection) {
  if (!markdownSection) return []
  const lines = markdownSection.split(/\r?\n/).filter((line) => /^\s*\|.*\|\s*$/.test(line))
  if (lines.length < 3) return []
  const cells = (line) => line.trim().slice(1, -1).split('|').map((cell) => cell.trim())
  const headers = cells(lines[0])
  return lines.slice(2).map((line) => {
    const values = cells(line)
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  })
}

function hasPlaceholder(value) {
  return !value || /(?:TBD|TODO|미정|확인 필요|NOT_RUN|^unavailable$|^-$)/i.test(value.trim())
}

function csvSet(value) {
  if (!value || value.trim() === '-') return new Set()
  return new Set(value.replaceAll('`', '').split(',').map((item) => item.trim()).filter(Boolean))
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

function parseDispositionMap(value) {
  const result = new Map()
  if (!value) return { result, valid: false }
  for (const entry of value.replaceAll('`', '').split(',').map((item) => item.trim()).filter(Boolean)) {
    const parts = entry.split('->').map((item) => item.trim())
    if (parts.length !== 2 || !parts[0] || !parts[1] || result.has(parts[0])) {
      return { result, valid: false }
    }
    result.set(parts[0], parts[1])
  }
  return { result, valid: result.size > 0 }
}

function scalar(markdown, key) {
  return markdown.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)["']?\\s*$`, 'm'))?.[1]?.trim()
}

function nestedScalar(markdown, parent, key) {
  return markdown.match(new RegExp(`^${parent}:\\s*\\n(?:  .*\\n)*?  ${key}:\\s*["']?([^"'\\n]+)["']?\\s*$`, 'm'))?.[1]?.trim()
}

function ids(markdown, prefix) {
  const result = new Set()
  const pattern = new RegExp(`${prefix}-(\\d+(?:/(?:${prefix}-)?\\d+)*)`, 'g')
  for (const match of markdown.matchAll(pattern)) {
    for (const suffix of match[1].split('/')) {
      result.add(`${prefix}-${suffix.replace(new RegExp(`^${prefix}-`), '')}`)
    }
  }
  return result
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort((left, right) =>
      Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
    ).map((key) => [key, canonicalValue(value[key])]))
  }
  return value
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalValue(value)), 'utf8').digest('hex')}`
}

function inlineArray(markdown, key) {
  const encoded = markdown.match(new RegExp(`^${key}:\\s*(\\[[^\\n]*\\])\\s*$`, 'm'))?.[1]
  if (!encoded) return undefined
  try {
    const parsed = JSON.parse(encoded.replaceAll("'", '"'))
    return Array.isArray(parsed) && parsed.every((value) => typeof value === 'string') ? parsed : undefined
  } catch {
    return undefined
  }
}

function documentBody(markdown) {
  const normalized = markdown.replaceAll('\r\n', '\n').replace(/\n*$/, '\n')
  const match = normalized.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/)
  return match?.[1]?.replace(/^\n/, '')
}

const designPath = argument('--design')
const tasksPath = argument('--tasks')

if (!designPath || !tasksPath) {
  process.stderr.write('Usage: readiness-validator.mjs --design <system_design.md> --tasks <tasks.md> --json\n')
  process.exit(2)
}

const design = readFileSync(designPath, 'utf8')
const tasks = readFileSync(tasksPath, 'utf8')
const criticalFindings = []

if (!/^schemaVersion:\s*["']?sdd-design\.v2["']?\s*$/m.test(design)) {
  criticalFindings.push(finding('DESIGN_SCHEMA_VERSION_MISSING', 'system_design.md must declare sdd-design.v2.'))
}
if (nestedScalar(design, 'review', 'verdict') !== 'PASS'
  || nestedScalar(design, 'review', 'readiness') !== 'ready') {
  criticalFindings.push(finding('DESIGN_REVIEW_NOT_READY', 'The design Self Review must be PASS / ready before an executable task projection can pass.'))
}
const expectedProductInputFingerprint = digest({
  requestRevision: scalar(design, 'requestRevision') ?? '',
  requestStatus: scalar(design, 'requestStatus') ?? '',
  storiesRevision: scalar(design, 'storiesRevision') ?? '',
  storiesStatus: scalar(design, 'storiesStatus') ?? '',
})
if (!scalar(design, 'productInputFingerprint')
  || scalar(design, 'productInputFingerprint') !== expectedProductInputFingerprint) {
  criticalFindings.push(finding('PRODUCT_INPUT_FINGERPRINT_MISMATCH', 'productInputFingerprint must be the canonical digest of both current input revisions and statuses.'))
}
const body = documentBody(design)
const derivedFrom = inlineArray(design, 'derivedFrom')
const stableDesignFrontmatter = {
  derivedFrom,
  evidenceFingerprint: scalar(design, 'evidenceFingerprint'),
  id: scalar(design, 'id'),
  outputLanguage: scalar(design, 'outputLanguage'),
  productInputFingerprint: scalar(design, 'productInputFingerprint'),
  projectId: scalar(design, 'projectId'),
  requestRevision: scalar(design, 'requestRevision'),
  requestStatus: scalar(design, 'requestStatus'),
  review: {
    readiness: nestedScalar(design, 'review', 'readiness'),
    verdict: nestedScalar(design, 'review', 'verdict'),
  },
  storiesRevision: scalar(design, 'storiesRevision'),
  storiesStatus: scalar(design, 'storiesStatus'),
  type: scalar(design, 'type'),
}
const missingDesignRevisionInput = !body || Object.values(stableDesignFrontmatter)
  .some((value) => value === undefined || (Array.isArray(value) && value.length === 0))
const expectedDesignRevision = missingDesignRevisionInput
  ? undefined
  : digest({ body, frontmatter: stableDesignFrontmatter })
if (!expectedDesignRevision || scalar(design, 'designRevision') !== expectedDesignRevision) {
  criticalFindings.push(finding('DESIGN_REVISION_MISMATCH', 'designRevision must match the canonical current design body and stable frontmatter.'))
}
const fieldSection = section(design, '#### A-10-2. API 필드 근거 원장')
let fieldRows = []
if (!fieldSection) {
  criticalFindings.push(finding('API_FIELD_PROVENANCE_MISSING', 'The API field provenance ledger is missing.'))
} else {
  const rows = tableRows(fieldSection)
  fieldRows = rows
  const invalid = rows.length === 0 || rows.some((row) =>
    ['API', 'direction', 'field', 'type/null', 'value origin', 'source/formula', 'consumer', 'status']
      .some((key) => hasPlaceholder(row[key]))
    || !/^(stored|derived|constant)$/i.test(row['value origin'])
    || !/^(CONFIRMED|APPROVED)$/i.test(row.status)
  )
  const directionsByApi = new Map()
  for (const row of rows) {
    if (!directionsByApi.has(row.API)) directionsByApi.set(row.API, new Set())
    directionsByApi.get(row.API).add(row.direction?.toLowerCase())
  }
  const missingDirection = [...directionsByApi.values()].some((directions) =>
    !['request', 'response', 'error'].every((direction) => directions.has(direction))
  )
  if (invalid || missingDirection) {
    criticalFindings.push(finding('API_FIELD_PROVENANCE_INCOMPLETE', 'Every API needs proven request, response, and error field rows with an exact source or formula.'))
  }
  const unsafeUserVisibleValue = rows.some((row) => {
    const field = row.field ?? ''
    const direction = row.direction ?? ''
    const consumer = row.consumer ?? ''
    const formula = row['source/formula'] ?? ''
    const userVisibleField = /(?:reason|message|label|description|display|copy|title|notice|error)/i.test(field)
    const outwardDirection = /^(?:response|error|event|notification|output)$/i.test(direction)
    const outwardConsumer = !/^(?:internal|service|repository|job|batch|none|n\/a|—)$/i.test(consumer.trim())
    if (!userVisibleField || !outwardDirection || !outwardConsumer) return false
    const safeDerivation = /(?:allowlist|mapping|mapped|sanitize|sanitization|redact|approved constant|enum|defaultReason|매핑|정제|상수)/i.test(formula)
    const directRawBranch = /(?:^|[?:=]\s*)(?:[\w.]+\.)?(?:errorMessage|rawMessage|exceptionMessage|providerMessage)\b/i.test(formula)
    return !safeDerivation || directRawBranch
  })
  if (unsafeUserVisibleValue) {
    criticalFindings.push(finding('USER_VISIBLE_VALUE_SAFETY_UNPROVEN', 'Every user-visible reason, message, label, or copy branch must come only from an exact safe mapping, approved constant, or sanitization rule; raw message branches are not allowed.'))
  }
}
const stateSection = section(design, '#### A-10-3. 소스 상태 전체 분류')
if (!stateSection) {
  criticalFindings.push(finding('SOURCE_STATE_COVERAGE_MISSING', 'The exhaustive source-state mapping is missing.'))
} else {
  const rows = tableRows(stateSection)
  const invalid = rows.length === 0 || rows.some((row) => {
    const discovered = csvSet(row.discovered)
    const mapped = csvSet(row.mapped)
    const excluded = csvSet(row.excluded)
    const disposition = new Set([...mapped, ...excluded])
    const targetDispositions = csvSet(row['target dispositions'])
    const { result: dispositionMap, valid: dispositionMapValid } = parseDispositionMap(row['disposition map'])
    const overlaps = [...mapped].some((value) => excluded.has(value))
    return hasPlaceholder(row.symbol)
      || discovered.size === 0
      || overlaps
      || !sameSet(discovered, disposition)
      || targetDispositions.size === 0
      || !dispositionMapValid
      || !sameSet(discovered, new Set(dispositionMap.keys()))
      || [...dispositionMap.values()].some((target) => !targetDispositions.has(target))
      || hasPlaceholder(row.invariant)
      || hasPlaceholder(row.evidence)
      || row.status !== 'COMPLETE'
  })
  if (invalid) {
    criticalFindings.push(finding('SOURCE_STATE_COVERAGE_INCOMPLETE', 'Discovered source states must equal mapped plus explicitly excluded states.'))
  }
}
const commandSection = section(design, '#### A-10-5. 검증 명령 Preflight')
let sourceConfirmedCommandRows = []
if (!commandSection) {
  criticalFindings.push(finding('COMMAND_PREFLIGHT_MISSING', 'Command preflight receipts are missing.'))
} else {
  const rows = tableRows(commandSection)
  const matchedSourceCommits = new Set(tableRows(section(design, '#### A-10-1. Source checkout 일치'))
    .filter((row) => row.status === 'MATCHED' && row['evidence commit'] === row['implementation baseline'])
    .map((row) => row['evidence commit']))
  sourceConfirmedCommandRows = rows.filter((row) => row.result === 'SOURCE_CONFIRMED')
  const invalid = rows.length === 0 || rows.some((row) => {
    const exit = Number(row.exit)
    const resultValid = row.result === 'PASS' || row.result === 'EXPECTED_RED' || row.result === 'SOURCE_CONFIRMED'
    const exitValid = row.result === 'SOURCE_CONFIRMED'
      ? row.exit === 'N/A'
      : Number.isInteger(exit)
    return ['id', 'cwd', 'command', 'observed at', 'exit', 'result', 'evidence'].some((key) => hasPlaceholder(row[key]))
      || !exitValid
      || !resultValid
      || (row.result === 'PASS' && exit !== 0)
      || Number.isNaN(Date.parse(row['observed at']))
  })
  if (invalid) {
    criticalFindings.push(finding('COMMAND_PREFLIGHT_UNPROVEN', 'Each exact command needs an observed PASS or explained EXPECTED_RED receipt.'))
  }
  const invalidExpectedRed = rows.some((row) => {
    if (row.result !== 'EXPECTED_RED') return false
    const evidence = row.evidence ?? ''
    const behaviorAbsence = /(?:no tests? found|no matching test|404|not implemented|missing endpoint|assertion|expected red|feature (?:absent|missing)|before (?:implementation|approved-new))/i.test(evidence)
    const infrastructureFailure = /(?:command not found|cannot find binary|package manager|corepack cache|broken runtime|permission denied|cannot find module|module not found|network|timed? out|out of memory|cache is absent|pnpm .*absent)/i.test(evidence)
    return Number(row.exit) === 0 || !behaviorAbsence || infrastructureFailure
  })
  if (invalidExpectedRed) {
    criticalFindings.push(finding('COMMAND_EXPECTED_RED_INVALID', 'EXPECTED_RED is valid only when the runner starts and missing behavior or an approved-new test target causes the failure.'))
  }
  const invalidSourceConfirmation = sourceConfirmedCommandRows.some((row) => {
    const receipt = new Map((row.evidence ?? '').split(';').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
      const separator = entry.indexOf('=')
      return separator === -1 ? [entry, ''] : [entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()]
    }))
    const required = ['wrapper', 'module', 'runner', 'selector', 'adjacentTest', 'sourceCommit', 'executionDeferred']
    return required.some((key) => hasPlaceholder(receipt.get(key)))
      || !/^[0-9a-f]{40}$/.test(receipt.get('sourceCommit') ?? '')
      || receipt.get('executionDeferred') !== 'task-preflight'
      || !matchedSourceCommits.has(receipt.get('sourceCommit'))
      || !row.command.includes(receipt.get('selector') ?? '')
  })
  if (invalidSourceConfirmation) {
    criticalFindings.push(finding('COMMAND_SOURCE_CONFIRMATION_INVALID', 'SOURCE_CONFIRMED requires exact wrapper, module, runner, selector, adjacent test, source commit, and task-preflight execution evidence from the matched source tree.'))
  }
}
const sourceSection = section(design, '#### A-10-1. Source checkout 일치')
if (!sourceSection) {
  criticalFindings.push(finding('SOURCE_HEAD_CHECK_MISSING', 'Analyzed commits are not matched to implementation checkout HEADs.'))
} else {
  const rows = tableRows(sourceSection)
  const oid = /^[0-9a-f]{40}$/
  const invalid = rows.length === 0 || rows.some((row) =>
    !oid.test(row['evidence commit'])
    || !oid.test(row['implementation baseline'])
    || row['evidence commit'] !== row['implementation baseline']
    || hasPlaceholder(row['read proof'])
    || row.status !== 'MATCHED'
  )
  if (invalid) {
    criticalFindings.push(finding('SOURCE_HEAD_MISMATCH', 'Every implementation baseline must equal the exact source tree used for evidence.'))
  }
}
const frontendSection = section(design, '#### A-10-4. 프론트엔드 구현 연결')
if (!frontendSection) {
  criticalFindings.push(finding('FRONTEND_TOPOLOGY_MISSING', 'Changed screens lack a complete implementation topology.'))
} else {
  const rows = tableRows(frontendSection)
  const keys = ['screen', 'route', 'server entry', 'client component', 'API hook/client', 'type', 'test', 'evidence', 'status']
  const invalid = rows.length === 0 || rows.some((row) =>
    keys.some((key) => hasPlaceholder(row[key])) || !/^(CONFIRMED|APPROVED)$/i.test(row.status)
  )
  if (invalid) {
    criticalFindings.push(finding('FRONTEND_TOPOLOGY_INCOMPLETE', 'Each changed screen needs route, server/client boundary, API client, type, test target, and evidence.'))
  }
}

const paginatedApis = new Set(fieldRows
  .filter((row) => /(?:^|[.,`\s])(page|size|hasNext)(?:$|[.,`\s])/i.test(row.field ?? ''))
  .map((row) => row.API)
  .filter(Boolean))
if (paginatedApis.size > 0) {
  const paginationSection = section(design, '#### A-10-6. Pagination 결정 원장')
  if (!paginationSection) {
    criticalFindings.push(finding('PAGINATION_CONTRACT_MISSING', 'Every paginated API needs a deterministic pagination contract.'))
  } else {
    const rows = tableRows(paginationSection)
    const paginationApis = new Set(rows.map((row) => row.API).filter(Boolean))
    const invalid = rows.length === 0
      || [...paginatedApis].some((api) => !paginationApis.has(api))
      || rows.some((row) =>
        ['API', 'strategy', 'total order', 'tie-breaker', 'hasNext rule', 'evidence', 'status']
          .some((key) => hasPlaceholder(row[key]))
        || !/^(CONFIRMED|APPROVED)$/i.test(row.status)
      )
    if (invalid) {
      criticalFindings.push(finding('PAGINATION_CONTRACT_INCOMPLETE', 'Pagination needs strategy, total order, unique tie-breaker, hasNext rule, and evidence for every paginated API.'))
    }
  }
}

const sliceSection = section(design, '## 8. 기능별 구현 패킷')
const sliceRows = tableRows(sliceSection)
if (sliceRows.length === 0) {
  criticalFindings.push(finding('SLICE_OWNERSHIP_INCOMPLETE', 'Implementation slices must assign every CHG and VER to an owning slice.'))
} else {
  const primaryCounts = new Map()
  const ownedVerifications = new Set()
  for (const row of sliceRows) {
    for (const changeId of ids(row['Primary CHG'] ?? '', 'CHG')) {
      primaryCounts.set(changeId, (primaryCounts.get(changeId) ?? 0) + 1)
    }
    for (const verificationId of ids(row.VER ?? '', 'VER')) {
      ownedVerifications.add(verificationId)
    }
  }
  const incompleteOwnership = [...ids(design, 'CHG')].some((changeId) => primaryCounts.get(changeId) !== 1)
    || [...ids(design, 'VER')].some((verificationId) => !ownedVerifications.has(verificationId))
  if (incompleteOwnership) {
    criticalFindings.push(finding('SLICE_OWNERSHIP_INCOMPLETE', 'Every CHG must be Primary in exactly one slice and every VER must belong to at least one slice.'))
  }
  const dependencyContradiction = sliceRows.some((row) =>
    /독립|independent/i.test(row['병렬화·출시 경계'] ?? '')
    && !/^(?:없음|none|—|-)$/i.test((row['선행 조건'] ?? '').trim())
  )
  if (dependencyContradiction) {
    criticalFindings.push(finding('SLICE_DEPENDENCY_CONTRADICTION', 'A slice with predecessors cannot be labeled independent.'))
  }
}

const isTaskV3 = /^schemaVersion:\s*["']?sdd-tasks\.v3["']?\s*$/m.test(tasks)
const isTaskV4 = /^schemaVersion:\s*["']?sdd-tasks\.v4["']?\s*$/m.test(tasks)
if ((!isTaskV3 && !isTaskV4)
  || !/^designSchemaVersion:\s*["']?sdd-design\.v2["']?\s*$/m.test(tasks)) {
  criticalFindings.push(finding('TASK_SCHEMA_VERSION_UNSUPPORTED', 'tasks.md must use supported sdd-tasks.v3 or sdd-tasks.v4 and bind sdd-design.v2.'))
}
const bindingKeys = ['designRevision', 'productInputFingerprint', 'evidenceFingerprint']
const bindingMismatch = bindingKeys.some((key) => !scalar(design, key)
  || !scalar(tasks, key)
  || scalar(design, key) !== scalar(tasks, key))
  || !scalar(tasks, 'approvedRevision')
  || scalar(tasks, 'approvedRevision') !== scalar(tasks, 'designRevision')
if (bindingMismatch) {
  criticalFindings.push(finding('TASK_REVISION_BINDING_MISMATCH', 'Task design, product, evidence, and approved revisions must bind exactly to the current design.'))
}
if (/(?:\bTBD\b|\bTODO\b|미정|확인 필요|경로 미정|적절히|Similar to Task)/i.test(tasks)) {
  criticalFindings.push(finding('TASK_PLACEHOLDER_FOUND', 'Executable tasks cannot contain placeholders or defer implementation decisions.'))
}
if (isTaskV3) {
  const taskCards = tasks.split(/^###\s+(?=TASK-)/m).slice(1)
  if (!tasks.includes('## 2. 계약·화면 빠른 참조')
    || taskCards.length === 0
    || taskCards.some((card) => !card.includes('**계약 참조**:') || !card.includes('**검증 참조**:'))) {
    criticalFindings.push(finding('TASK_CONTRACT_REFERENCE_MISSING', 'Every v3 task must link to approved contract and command evidence.'))
  }
  const requiredPacketMarkers = [
    '**완료 결과**:', '**담당 구역**:', '**제품 연결**:', '**설계 연결**:',
    '**계약 참조**:', '**검증 참조**:', '**영향 표면**:', '**선행 작업**:',
    '**편집 대상**:', '**함께 읽을 대상**:', '**구현 단계**:', '**입출력·상태 변화**:',
    '**예외·실패 처리**:', '**do-not-touch 경계**:', '**검증 루프**:',
    'test file·symbol:', 'exact test command:', 'expected RED failure:',
    'expected GREEN result:', 'regression command:', 'regression expectation:',
    '**completion criteria**:', '**인계 결과**:', '**근거**:',
  ]
  const incompletePacket = taskCards.length === 0 || taskCards.some((card) =>
    requiredPacketMarkers.some((marker) => !card.includes(marker))
    || !/EDIT-\d+/.test(card)
    || !/[0-9a-f]{40}/.test(card)
  )
  if (incompletePacket) {
    criticalFindings.push(finding('TASK_IMPLEMENTATION_PACKET_INCOMPLETE', 'Every v3 task needs a confirmed edit target and complete behavior, failure, RED/GREEN, regression, completion, and handoff fields.'))
  }
}

if (isTaskV4) {
  const moduleSection = section(tasks, '## 0. 변경 범위와 실행 순서')
  const moduleRows = tableRows(moduleSection)
  const moduleKeys = ['순서', '모듈', '변경 결과', '변경 유형', '구현 섹션', '선행 작업', '완료 검증']
  if (!moduleSection || moduleRows.length === 0
    || moduleRows.some((row) => moduleKeys.some((key) => hasPlaceholder(row[key])))) {
    criticalFindings.push(finding('TASK_MODULE_PLAN_MISSING', 'v4 tasks need a complete module execution table with section and verification bindings.'))
  } else {
    const invalidModule = moduleRows.some((row) => {
      const sectionNumber = row['구현 섹션']?.match(/§(\d+)/)?.[1]
      const body = sectionNumber ? numberedSection(tasks, sectionNumber) : undefined
      const changed = !/^(?:NO-CHANGE|REUSE|N\/A)$/i.test(row['변경 유형'] ?? '')
      return !body || (changed && (!/- \[ \]/.test(body)
        || !/(?:Create|Modify|Delete):\s*`[^`]+`/.test(body)))
    })
    if (invalidModule || !/[0-9a-f]{40}/.test(tasks)) {
      criticalFindings.push(finding('TASK_MODULE_CHECKLIST_INCOMPLETE', 'Every changed v4 module needs checkboxes, exact file actions, symbols, and a full source commit.'))
    }
  }

  const apiRequestIds = new Set([...tasks.matchAll(/^####\s+(API-\d+)\s+요청\s*$/gm)].map((match) => match[1]))
  const hasApiMethodPath = /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/[^\s`]+/.test(tasks)
  const invalidApiContract = hasApiMethodPath && (apiRequestIds.size === 0
    || [...apiRequestIds].some((apiId) =>
      !new RegExp(`^####\\s+${apiId}\\s+응답\\s*$`, 'm').test(tasks)
      || !new RegExp(`^####\\s+${apiId}\\s+오류\\s*$`, 'm').test(tasks)
      || !new RegExp(`${apiId}[\\s\\S]{0,240}\\b(?:GET|POST|PUT|PATCH|DELETE)\\s+\\/`).test(tasks)))
  if (invalidApiContract) {
    criticalFindings.push(finding('TASK_API_CONTRACT_INCOMPLETE', 'Every changed v4 API needs exact method/path plus request, response, and error contracts.'))
  }

  const dataSection = [...tasks.matchAll(/^##\s+\d+\.\s+.*(?:DB|데이터).*$/gmi)][0]
  const dataBody = dataSection ? numberedSection(tasks, dataSection[0].match(/^##\s+(\d+)\./)?.[1]) : undefined
  if (!dataBody || !/Migration:\s*`?(?:YES|NONE)`?/i.test(dataBody)
    || !/Write:\s*`?[A-Z_]+`?/i.test(dataBody)) {
    criticalFindings.push(finding('TASK_DATA_PLAN_INCOMPLETE', 'v4 tasks must state DB migration and write behavior even when there is no data change.'))
  }

  const verificationMarkers = ['Test:', 'RED:', 'GREEN:', 'Regression:']
  if (verificationMarkers.some((marker) => !tasks.includes(marker))
    || verificationMarkers.some((marker) => !new RegExp(`- \\[ \\] ${marker.replace(':', '\\:')}\\s*\\x60[^\\x60]+\\x60`).test(tasks))) {
    criticalFindings.push(finding('TASK_VERIFICATION_CHECKLIST_INCOMPLETE', 'v4 tasks need checked-command slots for Test, RED, GREEN, and Regression.'))
  }

  const executionPreflight = numberedSection(tasks, '1') ?? ''
  const missingDeferredExecution = sourceConfirmedCommandRows.some((row) =>
    !executionPreflight.includes(row.id)
    || !executionPreflight.includes(`\`${row.command}\``)
    || !/(?:실제 실행|execute)/i.test(executionPreflight)
    || !executionPreflight.includes('PASS')
    || !executionPreflight.includes('EXPECTED_RED')
  )
  if (missingDeferredExecution) {
    criticalFindings.push(finding('TASK_EXECUTION_PREFLIGHT_INCOMPLETE', 'Every SOURCE_CONFIRMED command must be copied into task Execution Preflight and actually executed before implementation.'))
  }
}
const designChangeIds = ids(design, 'CHG')
const designVerificationIds = ids(design, 'VER')
const taskChangeIds = ids(tasks, 'CHG')
const taskVerificationIds = ids(tasks, 'VER')
const missingTrace = [...designChangeIds].some((id) => !taskChangeIds.has(id))
  || [...designVerificationIds].some((id) => !taskVerificationIds.has(id))
if (missingTrace) {
  criticalFindings.push(finding('TASK_TRACEABILITY_INCOMPLETE', 'Every design CHG and VER id must appear in at least one executable task checklist.'))
}

const score = Math.max(0, 100 - criticalFindings.reduce((sum, item) => sum + (WEIGHTS.get(item.code) ?? 0), 0))
const passes = criticalFindings.length === 0 && score >= 95
const report = {
  verdict: passes ? 'PASS' : 'NEEDS_WORK',
  readiness: passes ? 'ready' : 'blocked',
  score,
  criticalFindings,
  warnings: [],
  artifacts: { design: designPath, tasks: tasksPath },
}

process.stdout.write(`${JSON.stringify(report, null, process.argv.includes('--json') ? 2 : 0)}\n`)
process.exitCode = passes ? 0 : 1
