import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const skillPath = join(root, '.codex/skills/platty-docs-generation/SKILL.md')

function readSkill() {
  assert.equal(existsSync(skillPath), true, 'platty-docs-generation skill must exist')
  return readFileSync(skillPath, 'utf8')
}

describe('platty docs generation Codex skill contract', () => {
  it('declares discoverable skill metadata', () => {
    const skill = readSkill()
    assert.match(skill, /^---\nname: platty-docs-generation\n/m)
    assert.match(skill, /^description: Use when /m)
    assert.match(skill, /Platty technical document generation|Platty docs generation/i)
  })

  it('documents the skill-plus-CLI worker flow', () => {
    const skill = readSkill()
    for (const command of [
      'platty docs targets list',
      'platty docs start',
      'platty docs preview',
      'platty docs approve',
      'platty docs worker next',
      'platty docs tasks submit',
      'platty docs status',
    ]) {
      assert.ok(skill.includes(command), `skill must mention ${command}`)
    }
  })

  it('preserves build_docs draft safety rules', () => {
    const skill = readSkill()
    for (const required of [
      'agentInput.context',
      'forbiddenFields',
      'source-backed',
      'repair_requested',
      'api_spec',
      'screen_spec',
      'event_spec',
      'schedule_spec',
    ]) {
      assert.ok(skill.includes(required), `skill must mention ${required}`)
    }
  })
})
