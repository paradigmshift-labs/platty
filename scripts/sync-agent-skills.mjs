import assert from 'node:assert/strict'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The skills live in exactly one place — the plugin source tree. There is no
// root-level `skills/` or `.codex/skills/` mirror; agents read the skills
// directly from agent-marketplace/plugins/platty/skills.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const marketplaceSkillsDir = 'agent-marketplace/plugins/platty/skills'

export const expectedSkills = [
  'using-platty',
  'platty-cli-router',
  'platty-project-setup',
  'platty-static-analysis',
  'platty-docs-target-curation',
  'platty-docs-generation',
  'platty-retrieval',
  'platty-epics-generation',
  'platty-business-docs-generation',
  'platty-corpus-quality',
]

function pathFor(...parts) {
  return join(root, ...parts)
}

function listDirectories(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((entry) => statSync(join(dir, entry)).isDirectory()).sort()
}

const skillsDir = pathFor(marketplaceSkillsDir)
assert.deepEqual(
  listDirectories(skillsDir),
  [...expectedSkills].sort(),
  `${marketplaceSkillsDir} should contain exactly the expected skills`,
)

for (const name of expectedSkills) {
  const source = join(skillsDir, name, 'SKILL.md')
  assert.equal(existsSync(source), true, `Missing skill: ${marketplaceSkillsDir}/${name}/SKILL.md`)
}
