import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const feedbackPath = '.github/ISSUE_TEMPLATE/platty-feedback.yml'
const workflowPath = '.github/workflows/validate-issue-intake.yml'
const retiredPaths = [
  '.github/ISSUE_TEMPLATE/static-analysis-bug.yml',
  '.github/ISSUE_TEMPLATE/static-analysis-support.yml',
]
const documentationPaths = [
  'README.md',
  'README.ko.md',
  'guide/en/support-matrix.md',
  'guide/ko/support-matrix.md',
  'guide/en/usage-guide.md',
  'guide/ko/usage-guide.md',
]

assert.ok(existsSync(feedbackPath), `${feedbackPath} must exist`)
for (const retiredPath of retiredPaths) {
  assert.equal(existsSync(retiredPath), false, `${retiredPath} must be removed`)
}

const form = readFileSync(feedbackPath, 'utf8')
for (const topLevelKey of ['name:', 'description:', 'title:', 'body:']) {
  assert.match(form, new RegExp(`^${topLevelKey}`, 'm'))
}
for (const fieldId of ['report_type', 'report_details', 'environment', 'reproduction', 'safe_content']) {
  assert.match(form, new RegExp(`id: ${fieldId}\\b`), `missing field ${fieldId}`)
}

function fieldBlock(fieldId) {
  const start = form.search(new RegExp(`^    id: ${fieldId}\\s*$`, 'm'))
  assert.notEqual(start, -1, `missing field ${fieldId}`)
  const next = form.indexOf('\n  - type:', start)
  return form.slice(start, next === -1 ? undefined : next)
}

for (const requiredField of ['report_details', 'safe_content']) {
  assert.match(fieldBlock(requiredField), /required: true/, `${requiredField} must be required`)
}
for (const optionalField of ['report_type', 'environment', 'reproduction']) {
  assert.doesNotMatch(fieldBlock(optionalField), /required: true/, `${optionalField} must remain optional`)
}
assert.equal((form.match(/required: true/g) ?? []).length, 2, 'no other field may be required')
for (const evidence of [
  "@Controller('/orders')",
  'prisma.order.findUnique',
  'HTTP client',
  'event or job',
  'cross-repository',
  '모든 항목을 작성하지 않아도 됩니다',
]) {
  assert.ok(form.includes(evidence), `missing evidence guidance: ${evidence}`)
}

for (const documentationPath of documentationPaths) {
  const documentation = readFileSync(documentationPath, 'utf8')
  assert.ok(
    documentation.includes('template=platty-feedback.yml'),
    `${documentationPath} must link to the unified form`,
  )
  for (const retiredName of ['static-analysis-bug.yml', 'static-analysis-support.yml']) {
    assert.equal(
      documentation.includes(retiredName),
      false,
      `${documentationPath} still links to ${retiredName}`,
    )
  }
}

assert.ok(existsSync(workflowPath), `${workflowPath} must exist`)
const workflow = readFileSync(workflowPath, 'utf8')
assert.ok(workflow.includes('node scripts/check-issue-intake.mjs'), 'workflow must run the contract check')

console.log('Issue intake contract passed.')
