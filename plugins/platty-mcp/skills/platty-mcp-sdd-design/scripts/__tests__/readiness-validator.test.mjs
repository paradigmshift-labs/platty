import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))
const skillRoot = resolve(here, '../..')
const validator = resolve(skillRoot, 'scripts/readiness-validator.mjs')

function validate(designMarkdown, tasksMarkdown) {
  const directory = mkdtempSync(resolve(tmpdir(), 'sdd-readiness-'))
  const designPath = resolve(directory, 'system_design.md')
  const tasksPath = resolve(directory, 'tasks.md')
  writeFileSync(designPath, designMarkdown)
  writeFileSync(tasksPath, tasksMarkdown)
  const run = spawnSync(process.execPath, [validator, '--design', designPath, '--tasks', tasksPath, '--json'], {
    encoding: 'utf8',
  })
  return { run, report: JSON.parse(run.stdout) }
}

const requestRevision = 'sha256:request'
const storiesRevision = 'sha256:stories'
const evidenceFingerprint = 'sha256:evidence'
const canonical = (value) => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value
const digest = (value) => `sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`
const productInputFingerprint = digest({ requestRevision, requestStatus: 'approved', storiesRevision, storiesStatus: 'approved' })

function validDesign(
  commandResult = 'EXPECTED_RED',
  commandEvidence = 'Jest started and reported no tests found before the approved-new test target',
  sliceVerifications = 'VER-01',
  responseFieldRow = '| API-01 | response | data.total | number/non-null | derived | Query count result | SCREEN-01 | CONFIRMED |',
) {
  const commandExit = commandResult === 'PASS' ? 0 : commandResult === 'SOURCE_CONFIRMED' ? 'N/A' : 1
  const additionalVerificationRows = sliceVerifications === 'VER-01/02/03'
    ? '| VER-02 | 오류 검증 |\n| VER-03 | 회귀 검증 |\n'
    : ''
  const body = `# 설계
| CHG ID | 결과 |
| --- | --- |
| CHG-01 | 조회 추가 |
| VER ID | 결과 |
| --- | --- |
| VER-01 | 계약 검증 |
${additionalVerificationRows}
## 8. 기능별 구현 패킷
| 슬라이스 | 완성할 사용자 결과 | 영향 표면 ID | 선행 조건 | Primary CHG | 관련 CHG | VER | 병렬화·출시 경계 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SLICE-01 | 조회 결과 | API-01 | 없음 | CHG-01 | — | ${sliceVerifications} | backend 독립 |
#### A-10-1. Source checkout 일치
| repo | evidence commit | implementation baseline | read proof | status |
| --- | --- | --- | --- | --- |
| api | 0123456789abcdef0123456789abcdef01234567 | 0123456789abcdef0123456789abcdef01234567 | git grep at exact commit | MATCHED |
#### A-10-2. API 필드 근거 원장
| API | direction | field | type/null | value origin | source/formula | consumer | status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| API-01 | request | query.from | date/required | constant | Controller LocalDate parser | SCREEN-01 | APPROVED |
${responseFieldRow}
| API-01 | error | INVALID_RANGE | string/non-null | constant | Controller validateRange | SCREEN-01 | CONFIRMED |
#### A-10-3. 소스 상태 전체 분류
| symbol | discovered | mapped | excluded | target dispositions | disposition map | invariant | evidence | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Status | A,B,C | A,B | C | OPEN,CLOSED,EXCLUDED | A->OPEN,B->CLOSED,C->EXCLUDED | discovered equals mapped plus excluded and every value has one valid target | File Status enum | COMPLETE |
#### A-10-4. 프론트엔드 구현 연결
| screen | route | server entry | client component | API hook/client | type | test | evidence | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SCREEN-01 | /x | app/x/page.tsx | app/x/XClient.tsx | libs/api/useX.ts | libs/api/X.ts | app/x/XClient.test.tsx | ParentPage auth pattern | APPROVED |
#### A-10-5. 검증 명령 Preflight
| id | cwd | command | observed at | exit | result | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| CMD-01 | repo | npm test -- XClient.test.tsx | 2026-07-14T00:00:00Z | ${commandExit} | ${commandResult} | ${commandEvidence} |
`
  const stableFrontmatter = {
    derivedFrom: ['prd.md', 'user_stories.md'],
    evidenceFingerprint,
    id: 'SPEC-test',
    outputLanguage: 'ko',
    productInputFingerprint,
    projectId: 'P',
    requestRevision,
    requestStatus: 'approved',
    review: { readiness: 'ready', verdict: 'PASS' },
    storiesRevision,
    storiesStatus: 'approved',
    type: 'sdd-design',
  }
  const designRevision = digest({ body, frontmatter: stableFrontmatter })
  return `---
schemaVersion: "sdd-design.v2"
id: "SPEC-test"
type: "sdd-design"
projectId: "P"
outputLanguage: "ko"
derivedFrom: ["prd.md", "user_stories.md"]
requestRevision: "${requestRevision}"
requestStatus: "approved"
storiesRevision: "${storiesRevision}"
storiesStatus: "approved"
designRevision: "${designRevision}"
productInputFingerprint: "${productInputFingerprint}"
evidenceFingerprint: "${evidenceFingerprint}"
review:
  verdict: "PASS"
  readiness: "ready"
---
${body}`
}

function validTasks(designMarkdown = validDesign()) {
  const value = (key) => designMarkdown.match(new RegExp(`^${key}:\\s*"([^"]+)"`, 'm'))[1]
  return `---
schemaVersion: "sdd-tasks.v3"
designSchemaVersion: "sdd-design.v2"
designRevision: "${value('designRevision')}"
approvedRevision: "${value('designRevision')}"
productInputFingerprint: "${value('productInputFingerprint')}"
evidenceFingerprint: "${value('evidenceFingerprint')}"
---
# 구현 계획
## 0. 실행 계약과 작업 순서
| Wave | 작업 |
| --- | --- |
| 1 | TASK-01-01 |
## 2. 계약·화면 빠른 참조
| ID | 사람이 이해할 이름 | Method / Path 또는 Screen route | 계약 원본 | 소비 TASK |
| --- | --- | --- | --- | --- |
| API-01 | 조회 API | GET /x | system_design.md §6 API-01, Appendix A-10 | TASK-01-01 |
### TASK-01-01. 조회 구현
- **완료 결과**: 사용자가 조회 결과를 받는다.
- **담당 구역**: backend/API
- **제품 연결**: R-01 / AC-01 / US-01-S01
- **설계 연결**: SLICE-01 / CHG-01 / VER-01
- **계약 참조**: system_design §6 API-01와 Appendix A-10 field/state 행
- **검증 참조**: system_design Appendix A-10 CMD-01과 §10 VER-01
- **영향 표면**: 조회 API API-01과 조회 화면 SCREEN-01
- **선행 작업**: 없음
- **편집 대상**: EDIT-01 — api@0123456789abcdef0123456789abcdef01234567 / src/X.ts / X
- **함께 읽을 대상**: src/X.test.ts / X suite
- **구현 단계**:
  1. 요청과 응답 타입을 정의한다.
  2. 전체 상태 분기와 오류를 구현한다.
  3. controller 소비자를 연결한다.
- **입출력·상태 변화**: GET /x, read-only response.
- **예외·실패 처리**: 범위 오류 400, 빈 결과 200.
- **do-not-touch 경계**: NOEDIT-01 command service는 변경하지 않는다.
- **검증 루프**:
  - test file·symbol: src/X.test.ts / returnsX
  - exact test command: npm test -- X.test.ts
  - expected RED failure: GET /x가 없어 404 assertion으로 실패한다.
  - 구현: endpoint와 mapper를 최소 추가한다.
  - expected GREEN result: 같은 명령에서 200과 schema assertion이 통과한다.
  - regression command: npm test -- Existing.test.ts
  - regression expectation: 기존 응답이 유지된다.
- **completion criteria**: VER-01 통과, GET /x 200/400 계약 일치.
- **인계 결과**: API-01 타입과 green receipt.
- **근거**: system_design Appendix A-10.
`
}

function validV4Tasks(designMarkdown = validDesign()) {
  const value = (key) => designMarkdown.match(new RegExp(`^${key}:\\s*"([^"]+)"`, 'm'))[1]
  return `---
schemaVersion: "sdd-tasks.v4"
designSchemaVersion: "sdd-design.v2"
designRevision: "${value('designRevision')}"
approvedRevision: "${value('designRevision')}"
productInputFingerprint: "${value('productInputFingerprint')}"
evidenceFingerprint: "${value('evidenceFingerprint')}"
---
# 구현 계획
## 0. 변경 범위와 실행 순서
| 순서 | 모듈 | 변경 결과 | 변경 유형 | 구현 섹션 | 선행 작업 | 완료 검증 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | backend API | 조회 API 제공 | MODIFY | §2 | 없음 | VER-01 |
| 2 | DB·데이터 | 기존 테이블 SELECT 재사용 | NO-CHANGE | §3 | §2 | VER-01 |

## 1. 실행 전 확인
- [ ] Source baseline: api@0123456789abcdef0123456789abcdef01234567
- [ ] 승인된 designRevision과 approvedRevision이 일치하는지 확인한다.

## 2. backend API — 조회 기능
### 2.1 응답 DTO 생성
- [ ] Create: \`src/XResponse.ts\` — \`XResponse\`
- [ ] \`XResponse { total: number }\`를 정의한다.

### 2.2 조회 함수와 API 연결
- [ ] Modify: \`src/X.ts\` — \`getX(): Promise<XResponse>\`
- [ ] API-01 조회 API — \`GET /x\`를 연결한다.

#### API-01 요청
\`\`\`text
query.from: LocalDate (required)
\`\`\`

#### API-01 응답
\`\`\`text
200 { data: { total: number } }
\`\`\`

#### API-01 오류
- 400 \`INVALID_RANGE\`: from 형식이 잘못됨
- 401 \`UNAUTHORIZED\`: 인증 없음

### 2.3 backend 검증
- [ ] Test: \`src/X.test.ts\` — \`returnsX\`
- [ ] RED: \`npm test -- X.test.ts\` — endpoint가 없어 404 assertion 실패를 확인한다.
- [ ] GREEN: \`npm test -- X.test.ts\` — 200과 response schema가 통과한다.
- [ ] Regression: \`npm test -- Existing.test.ts\` — 기존 조회 계약이 통과한다.

설계 근거: CHG-01 / VER-01 / API-01 / EDIT-01 / NOEDIT-01

## 3. DB·데이터
- [ ] Migration: NONE — migration 파일을 생성하지 않는다.
- [ ] Write: SELECT_ONLY — INSERT/UPDATE/DELETE를 실행하지 않는다.
- [ ] Modify: \`src/X.ts\` — 기존 조회 adapter만 호출한다.

## 4. Frontend
N/A — 이번 변경에는 사용자 화면이 없다.

## 5. Job·Event·외부 연동
N/A — 신규 비동기 처리와 외부 호출이 없다.

## 6. 완료 체크
- [ ] CHG-01과 VER-01이 구현·검증됐다.
- [ ] exact test와 regression command가 모두 통과했다.
- [ ] NOEDIT-01 production diff가 0이다.
`
}

test('rejects a stale v2 task artifact after the design revision changed', () => {
  const design = validDesign()
  const staleTasks = validTasks(design)
    .replace('schemaVersion: "sdd-tasks.v3"', 'schemaVersion: "sdd-tasks.v2"')
    .replace('designSchemaVersion: "sdd-design.v2"', 'designSchemaVersion: "sdd-design.v1"')
    .replace(/^designRevision:.*$/m, 'designRevision: "sha256:stale"')
  const { run, report } = validate(design, staleTasks)
  assert.equal(run.status, 1, run.stderr)
  assert.equal(report.verdict, 'NEEDS_WORK')
  assert.ok(report.criticalFindings.some((finding) => finding.code === 'TASK_SCHEMA_VERSION_UNSUPPORTED'))
})

test('does not accept headings without complete evidence rows', () => {
  const broken = validDesign().replace('0123456789abcdef0123456789abcdef01234567 | 0123456789abcdef0123456789abcdef01234567', 'aaa | bbb')
    .replace('Query count result', 'TBD')
    .replace('A,B | C', 'A | -')
    .replace('app/x/XClient.tsx', 'TBD')
  const { run, report } = validate(broken, validTasks())
  assert.equal(run.status, 1)
  const codes = new Set(report.criticalFindings.map((finding) => finding.code))
  assert.ok(codes.has('SOURCE_HEAD_MISMATCH'))
  assert.ok(codes.has('API_FIELD_PROVENANCE_INCOMPLETE'))
  assert.ok(codes.has('SOURCE_STATE_COVERAGE_INCOMPLETE'))
  assert.ok(codes.has('FRONTEND_TOPOLOGY_INCOMPLETE'))
})

test('rejects a user-visible reason that directly exposes an untrusted raw message branch', () => {
  const design = validDesign(
    undefined,
    undefined,
    undefined,
    '| API-01 | response | data.reason | string/non-null | derived | errorMessage != null ? errorMessage : DisabledCode.defaultReason mapping | SCREEN-01 | CONFIRMED |',
  )
  const { run, report } = validate(design, validTasks(design))
  assert.equal(run.status, 1)
  assert.ok(report.criticalFindings.some((finding) => finding.code === 'USER_VISIBLE_VALUE_SAFETY_UNPROVEN'))
})

test('accepts a user-visible reason derived only from an exact safe mapping', () => {
  const design = validDesign(
    undefined,
    undefined,
    undefined,
    '| API-01 | response | data.reason | string/non-null | derived | DisabledCode.defaultReason enum allowlist mapping | SCREEN-01 | CONFIRMED |',
  )
  const { run, report } = validate(design, validTasks(design))
  assert.equal(run.status, 0, JSON.stringify(report.criticalFindings))
})

test('rejects EXPECTED_RED caused by a broken runtime instead of missing behavior', () => {
  const design = validDesign('EXPECTED_RED', 'pnpm command not found because Corepack cache is absent')
  const { run, report } = validate(design, validTasks(design))
  assert.equal(run.status, 1)
  assert.ok(report.criticalFindings.some((finding) => finding.code === 'COMMAND_EXPECTED_RED_INVALID'))
})

test('accepts a source-confirmed command when a read-only design session proves the exact harness', () => {
  const design = validDesign(
    'SOURCE_CONFIRMED',
    'wrapper=package.json#scripts.test; module=repo; runner=jest.config.js; selector=XClient.test.tsx; adjacentTest=app/x/ExistingClient.test.tsx; sourceCommit=0123456789abcdef0123456789abcdef01234567; executionDeferred=task-preflight',
  )
  const tasks = validV4Tasks(design).replace(
    '- [ ] Source baseline: api@0123456789abcdef0123456789abcdef01234567',
    '- [ ] Source baseline: api@0123456789abcdef0123456789abcdef01234567\n- [ ] CMD-01: `npm test -- XClient.test.tsx`를 실제 실행하여 `PASS` 또는 기능 부재 `EXPECTED_RED` receipt를 기록한다.',
  )
  const { run, report } = validate(design, tasks)
  assert.equal(run.status, 0, JSON.stringify(report.criticalFindings))
  assert.equal(report.verdict, 'PASS')
})

test('rejects a vague source-confirmed command without exact source harness proof', () => {
  const design = validDesign('SOURCE_CONFIRMED', 'package.json을 읽어 보니 이 명령이 맞아 보인다')
  const { run, report } = validate(design, validV4Tasks(design))
  assert.equal(run.status, 1)
  assert.ok(report.criticalFindings.some((finding) => finding.code === 'COMMAND_SOURCE_CONFIRMATION_INVALID'))
})

test('rejects source-confirmed design commands omitted from task execution preflight', () => {
  const design = validDesign(
    'SOURCE_CONFIRMED',
    'wrapper=package.json#scripts.test; module=repo; runner=jest.config.js; selector=XClient.test.tsx; adjacentTest=app/x/ExistingClient.test.tsx; sourceCommit=0123456789abcdef0123456789abcdef01234567; executionDeferred=task-preflight',
  )
  const { run, report } = validate(design, validV4Tasks(design))
  assert.equal(run.status, 1)
  assert.ok(report.criticalFindings.some((finding) => finding.code === 'TASK_EXECUTION_PREFLIGHT_INCOMPLETE'))
})

test('rejects task metadata that is not bound to the current design inputs', () => {
  const design = validDesign()
  const { run, report } = validate(design, validTasks(design).replace(/^designRevision:.*$/m, 'designRevision: "sha256:stale"'))
  assert.equal(run.status, 1)
  assert.ok(report.criticalFindings.some((finding) => finding.code === 'TASK_REVISION_BINDING_MISMATCH'))
})

test('rejects a task card that omits executable implementation packet fields', () => {
  const design = validDesign()
  const broken = validTasks(design).replace('- **구현 단계**:', '- **구현 단계**: TODO').replace('  - expected GREEN result:', '  - green result:')
  const { run, report } = validate(design, broken)
  assert.equal(run.status, 1)
  const codes = new Set(report.criticalFindings.map((finding) => finding.code))
  assert.ok(codes.has('TASK_PLACEHOLDER_FOUND'))
  assert.ok(codes.has('TASK_IMPLEMENTATION_PACKET_INCOMPLETE'))
})

test('rejects CHG or VER ids that are absent from all task cards', () => {
  const design = validDesign()
  const { run, report } = validate(design, validTasks(design).replace('SLICE-01 / CHG-01 / VER-01', 'SLICE-01'))
  assert.equal(run.status, 1)
  assert.ok(report.criticalFindings.some((finding) => finding.code === 'TASK_TRACEABILITY_INCOMPLETE'))
})

test('rejects a source state mapped to an undefined response disposition', () => {
  const design = validDesign().replace('B->CLOSED', 'B->UNKNOWN_BUCKET')
  const { run, report } = validate(design, validTasks(design))
  assert.equal(run.status, 1)
  assert.ok(report.criticalFindings.some((finding) => finding.code === 'SOURCE_STATE_COVERAGE_INCOMPLETE'))
})

test('rejects paginated response fields without a deterministic pagination contract', () => {
  const design = validDesign()
    .replace('data.total | number/non-null', 'data.page,data.hasNext | number,boolean/non-null')
  const { run, report } = validate(design, validTasks(design))
  assert.equal(run.status, 1)
  assert.ok(report.criticalFindings.some((finding) => finding.code === 'PAGINATION_CONTRACT_MISSING'))
})

test('rejects CHG and VER ids without exactly one owning slice', () => {
  const design = validDesign()
    .replace('| CHG-01 | 조회 추가 |', '| CHG-01 | 조회 추가 |\n| CHG-02 | 공통 기반 |')
    .replace('| VER-01 | 계약 검증 |', '| VER-01 | 계약 검증 |\n| VER-02 | 회귀 검증 |')
  const { run, report } = validate(design, validTasks(design))
  assert.equal(run.status, 1)
  assert.ok(report.criticalFindings.some((finding) => finding.code === 'SLICE_OWNERSHIP_INCOMPLETE'))
})

test('accepts compact same-prefix VER ownership such as VER-01/02/03', () => {
  const design = validDesign(
    'EXPECTED_RED',
    'Jest started and reported no tests found before the approved-new test target',
    'VER-01/02/03',
  )
  const tasks = validTasks(design).replace(
    'SLICE-01 / CHG-01 / VER-01',
    'SLICE-01 / CHG-01 / VER-01, VER-02, VER-03',
  )
  const { run, report } = validate(design, tasks)
  assert.equal(run.status, 0, JSON.stringify(report.criticalFindings))
  assert.equal(report.verdict, 'PASS')
})

test('accepts compact VER ownership when every suffix repeats the prefix', () => {
  const design = validDesign(
    'EXPECTED_RED',
    'Jest started and reported no tests found before the approved-new test target',
    'VER-01/VER-02/VER-03',
  )
  const tasks = validTasks(design).replace(
    'SLICE-01 / CHG-01 / VER-01',
    'SLICE-01 / CHG-01 / VER-01, VER-02, VER-03',
  )
  const { run, report } = validate(design, tasks)
  assert.equal(run.status, 0, JSON.stringify(report.criticalFindings))
  assert.equal(report.verdict, 'PASS')
})

test('rejects an independent slice that declares a predecessor', () => {
  const design = validDesign().replace('| API-01 | 없음 | CHG-01', '| API-01 | SLICE-00 | CHG-01')
  const { run, report } = validate(design, validTasks(design))
  assert.equal(run.status, 1)
  assert.ok(report.criticalFindings.some((finding) => finding.code === 'SLICE_DEPENDENCY_CONTRADICTION'))
})

test('does not mistake Java or TypeScript generic types for task placeholders', () => {
  const design = validDesign()
  const tasks = validTasks(design).replace('GET /x, read-only response.', 'GET /x returns ApiResponseDtoV2<FunnelResponse> and List<FunnelRow>.')
  const { run, report } = validate(design, tasks)
  assert.equal(run.status, 0, JSON.stringify(report.criticalFindings))
})

test('accepts a fully evidenced design and implementation-complete v3 task projection', () => {
  const design = validDesign()
  const { run, report } = validate(design, validTasks(design))
  assert.equal(run.status, 0, run.stderr)
  assert.equal(report.verdict, 'PASS')
  assert.equal(report.readiness, 'ready')
  assert.ok(report.score >= 95)
  assert.deepEqual(report.criticalFindings, [])
})

test('accepts a standalone module-oriented sdd-tasks.v4 checklist', () => {
  const design = validDesign()
  const { run, report } = validate(design, validV4Tasks(design))
  assert.equal(run.status, 0, JSON.stringify(report.criticalFindings))
  assert.equal(report.verdict, 'PASS')
  assert.equal(report.readiness, 'ready')
})

test('accepts code-formatted v4 migration and write values emitted by the template', () => {
  const design = validDesign()
  const tasks = validV4Tasks(design)
    .replace('Migration: NONE', 'Migration: `NONE`')
    .replace('Write: SELECT_ONLY', 'Write: `SELECT_ONLY`')
  const { run, report } = validate(design, tasks)
  assert.equal(run.status, 0, JSON.stringify(report.criticalFindings))
  assert.equal(report.verdict, 'PASS')
})

test('rejects a v4 changed module without an exact file action', () => {
  const design = validDesign()
  const broken = validV4Tasks(design)
    .replace('- [ ] Create: `src/XResponse.ts`', '- [ ] 응답 DTO를 생성한다: `src/XResponse.ts`')
    .replace('- [ ] Modify: `src/X.ts` — `getX()', '- [ ] 조회 함수를 수정한다: `src/X.ts` — `getX()')
  const { run, report } = validate(design, broken)
  assert.equal(run.status, 1)
  assert.ok(report.criticalFindings.some((finding) => finding.code === 'TASK_MODULE_CHECKLIST_INCOMPLETE'))
})

test('rejects a v4 API without request response and error contracts', () => {
  const design = validDesign()
  const broken = validV4Tasks(design).replace('#### API-01 응답', '#### 조회 결과')
  const { run, report } = validate(design, broken)
  assert.equal(run.status, 1)
  assert.ok(report.criticalFindings.some((finding) => finding.code === 'TASK_API_CONTRACT_INCOMPLETE'))
})

test('rejects a v4 data section without explicit migration and write behavior', () => {
  const design = validDesign()
  const broken = validV4Tasks(design).replace('Migration: NONE', 'DB 변경 없음').replace('Write: SELECT_ONLY', '조회만 사용')
  const { run, report } = validate(design, broken)
  assert.equal(run.status, 1)
  assert.ok(report.criticalFindings.some((finding) => finding.code === 'TASK_DATA_PLAN_INCOMPLETE'))
})

test('rejects a v4 checklist without exact RED GREEN and regression commands', () => {
  const design = validDesign()
  const broken = validV4Tasks(design).replace('- [ ] RED: `npm test -- X.test.ts`', '- [ ] RED 결과를 확인한다')
  const { run, report } = validate(design, broken)
  assert.equal(run.status, 1)
  assert.ok(report.criticalFindings.some((finding) => finding.code === 'TASK_VERIFICATION_CHECKLIST_INCOMPLETE'))
})

test('rejects a design body changed without a new canonical designRevision', () => {
  const original = validDesign()
  const changed = original.replace('조회 추가', '조회 계약 추가')
  const { run, report } = validate(changed, validTasks(changed))
  assert.equal(run.status, 1)
  assert.ok(report.criticalFindings.some((finding) => finding.code === 'DESIGN_REVISION_MISMATCH'))
})

test('rejects a non-canonical product input fingerprint', () => {
  const design = validDesign().replace(/^productInputFingerprint:.*$/m, 'productInputFingerprint: "sha256:wrong"')
  const { run, report } = validate(design, validTasks(design))
  assert.equal(run.status, 1)
  assert.ok(report.criticalFindings.some((finding) => finding.code === 'PRODUCT_INPUT_FINGERPRINT_MISMATCH'))
})
