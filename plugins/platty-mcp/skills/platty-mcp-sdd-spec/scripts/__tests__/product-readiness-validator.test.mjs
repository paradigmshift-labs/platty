import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))
const validator = resolve(here, '../product-readiness-validator.mjs')

function prd(id = 'SPEC-test', rows = '') {
  return `---
id: "${id}"
type: "sdd-request"
status: "draft"
projectId: "P"
outputLanguage: "ko"
---
# 기획
| 규칙 ID | 조건과 결과 | 수용 기준 ID | 결과 |
| --- | --- | --- | --- |
| R-01 | 원래 규칙 | AC-01 | 원래 결과 |
| D-01 | 원래 결정 | 원래 근거 |
| H-01 | 원래 목표 | 원래 지표 |
${rows}`
}

function stories({
  id = 'SPEC-test',
  type = 'sdd-stories',
  derivedFrom = 'prd.md',
  outputLanguage = 'ko',
  scenario = 'US-01-S01',
} = {}) {
  return `---
id: "${id}"
type: "${type}"
status: "draft"
projectId: "P"
outputLanguage: "${outputLanguage}"
derivedFrom: "${derivedFrom}"
---
# 사용자 스토리
## US-01. 탐색
### ${scenario}. 성공
Given 시작
When 행동
Then 결과
`
}

function validate({ outputPrd = prd(), outputStories = stories(), augmentPrd } = {}) {
  const directory = mkdtempSync(resolve(tmpdir(), 'sdd-product-readiness-'))
  const prdPath = resolve(directory, 'prd.md')
  const storiesPath = resolve(directory, 'user_stories.md')
  writeFileSync(prdPath, outputPrd)
  writeFileSync(storiesPath, outputStories)
  const args = [validator, '--prd', prdPath, '--stories', storiesPath, '--json']
  if (augmentPrd) {
    const augmentPath = resolve(directory, 'augment-prd.md')
    writeFileSync(augmentPath, augmentPrd)
    args.push('--augment-prd', augmentPath)
  }
  const run = spawnSync(process.execPath, args, { encoding: 'utf8' })
  return { run, report: JSON.parse(run.stdout) }
}

test('accepts a canonical product pair', () => {
  const { run, report } = validate()
  assert.equal(run.status, 0, run.stderr)
  assert.equal(report.verdict, 'PASS')
  assert.equal(report.score, 100)
})

test('rejects legacy stories aliases and synthesized stories ids', () => {
  const { run, report } = validate({
    outputStories: stories({
      id: 'SPEC-test-stories',
      type: 'sdd-user-stories',
      derivedFrom: 'SPEC-test',
    }),
  })
  assert.equal(run.status, 1)
  assert.ok(report.criticalFindings.some((finding) => finding.code === 'STORIES_METADATA_INVALID'))
})

test('rejects noncanonical scenario ids', () => {
  const { run, report } = validate({ outputStories: stories({ scenario: 'S-01' }) })
  assert.equal(run.status, 1)
  assert.ok(report.criticalFindings.some((finding) => finding.code === 'STORY_SCENARIO_ID_INVALID'))
})

test('rejects a noncanonical scenario mixed with a canonical scenario', () => {
  const outputStories = stories().concat(`
### S-02. 실패
Given 시작
When 오류
Then 안내
`)
  const { run, report } = validate({ outputStories })
  assert.equal(run.status, 1)
  assert.ok(report.criticalFindings.some((finding) => finding.code === 'STORY_SCENARIO_ID_INVALID'))
})

test('accepts a non-Korean product pair when both artifacts share the requested language', () => {
  const outputPrd = prd().replace('outputLanguage: "ko"', 'outputLanguage: "en"')
  const { run, report } = validate({
    outputPrd,
    outputStories: stories({ outputLanguage: 'en' }),
  })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(report.verdict, 'PASS')
})

test('rejects AUGMENT spec id changes and existing row rewrites', () => {
  const input = prd('SPEC-original')
  const output = prd('SPEC-renamed').replace('원래 결정', '덮어쓴 결정')
  const { run, report } = validate({
    outputPrd: output,
    outputStories: stories({ id: 'SPEC-renamed' }),
    augmentPrd: input,
  })
  assert.equal(run.status, 1)
  const codes = new Set(report.criticalFindings.map((finding) => finding.code))
  assert.ok(codes.has('AUGMENT_SPEC_ID_CHANGED'))
  assert.ok(codes.has('AUGMENT_ROW_CHANGED'))
})

test('allows AUGMENT to append trace columns and new ids without changing original cells', () => {
  const input = prd('SPEC-original')
  const output = prd('SPEC-original')
    .replace('| R-01 | 원래 규칙 | AC-01 | 원래 결과 |', '| R-01 | 원래 규칙 | AC-01 | 원래 결과 | 2384:1 |')
    .replace('| H-01 | 원래 목표 | 원래 지표 |', '| H-01 | 원래 목표 | 원래 지표 | 2384:2 |')
    .concat('| D-02 | 새 결정 | 새 근거 |\n')
  const { run, report } = validate({
    outputPrd: output,
    outputStories: stories({ id: 'SPEC-original' }),
    augmentPrd: input,
  })
  assert.equal(run.status, 0, JSON.stringify(report.criticalFindings))
  assert.equal(report.verdict, 'PASS')
})
