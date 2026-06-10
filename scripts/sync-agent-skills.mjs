import assert from 'node:assert/strict'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')
const marketplaceSkillsLinkTarget = 'agent-marketplace/plugins/platty/skills'

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

function read(path) {
  return readFileSync(path, 'utf8')
}

function listDirectories(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((entry) => statSync(join(dir, entry)).isDirectory()).sort()
}

function listFiles(dir, prefix = '') {
  return readdirSync(dir).flatMap((entry) => {
    const relativePath = prefix === '' ? entry : join(prefix, entry)
    const fullPath = join(dir, entry)
    const stats = statSync(fullPath)
    if (stats.isDirectory()) return listFiles(fullPath, relativePath)
    if (stats.isFile()) return [relativePath]
    return []
  }).sort()
}

function assertDirectorySet(dir, label) {
  assert.deepEqual(listDirectories(dir), [...expectedSkills].sort(), `${label} should contain exactly the expected skills`)
}

function assertSkillSourceExists(name) {
  const source = pathFor(marketplaceSkillsLinkTarget, name, 'SKILL.md')
  assert.equal(existsSync(source), true, `Missing marketplace skill: ${marketplaceSkillsLinkTarget}/${name}/SKILL.md`)
}

function assertRootSkillsLink() {
  const linkPath = pathFor('skills')
  assert.equal(existsSync(linkPath), true, 'Missing root skills symlink: skills')
  assert.equal(lstatSync(linkPath).isSymbolicLink(), true, 'skills should be a symlink')
  assert.equal(readlinkSync(linkPath), marketplaceSkillsLinkTarget, `skills should point at ${marketplaceSkillsLinkTarget}`)
}

function assertCodexSkillsLink() {
  const linkPath = pathFor('.codex', 'skills')
  assert.equal(existsSync(linkPath), true, 'Missing Codex skills symlink: .codex/skills')
  assert.equal(lstatSync(linkPath).isSymbolicLink(), true, '.codex/skills should be a symlink')
  assert.equal(readlinkSync(linkPath), '../skills', '.codex/skills should point at ../skills')
}

function assertLinkedSkillMatches(name) {
  const sourceDir = pathFor(marketplaceSkillsLinkTarget, name)
  const linkedDir = pathFor('.codex', 'skills', name)
  assert.equal(existsSync(linkedDir), true, `Missing Codex linked skill: .codex/skills/${name}`)

  const sourceFiles = listFiles(sourceDir)
  const linkedFiles = listFiles(linkedDir)
  const missingLinkedFiles = sourceFiles.filter((file) => !linkedFiles.includes(file))
  const extraLinkedFiles = linkedFiles.filter((file) => !sourceFiles.includes(file))
  assert.deepEqual(missingLinkedFiles, [], `Missing Codex linked files for ${name}: ${missingLinkedFiles.join(', ')}`)
  assert.deepEqual(extraLinkedFiles, [], `Extra Codex linked files for ${name}: ${extraLinkedFiles.join(', ')}`)

  for (const file of sourceFiles) {
    assert.equal(read(join(pathFor('skills', name), file)), read(join(sourceDir, file)), `Root linked skill drifted: ${name}/${file}`)
    assert.equal(read(join(linkedDir, file)), read(join(sourceDir, file)), `Codex linked skill drifted: ${name}/${file}`)
  }
}

function syncSkillLinks() {
  const codexDir = pathFor('.codex')
  const rootSkillsLink = pathFor('skills')
  const codexSkillsLink = pathFor('.codex', 'skills')
  assertDirectorySet(pathFor(marketplaceSkillsLinkTarget), 'Marketplace skills directory')
  rmSync(rootSkillsLink, { recursive: true, force: true })
  symlinkSync(marketplaceSkillsLinkTarget, rootSkillsLink, 'dir')
  mkdirSync(codexDir, { recursive: true })
  rmSync(codexSkillsLink, { recursive: true, force: true })
  symlinkSync('../skills', codexSkillsLink, 'dir')
}

assertDirectorySet(pathFor(marketplaceSkillsLinkTarget), 'Marketplace skills directory')

if (!checkOnly) {
  syncSkillLinks()
}

assertRootSkillsLink()
assertCodexSkillsLink()

for (const name of expectedSkills) {
  assertSkillSourceExists(name)
  assertLinkedSkillMatches(name)
}

assertDirectorySet(pathFor('skills'), 'Root linked skills')
assertDirectorySet(pathFor('.codex', 'skills'), 'Codex linked skills')
