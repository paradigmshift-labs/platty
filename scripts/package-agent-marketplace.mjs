import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')
const marketplaceRoot = join(root, 'agent-marketplace')
const pluginName = 'platty'
const pluginRoot = join(marketplaceRoot, 'plugins', pluginName)

const codexMarketplace = {
  name: 'platty',
  interface: {
    displayName: 'Platty Marketplace',
  },
  plugins: [
    {
      name: pluginName,
      source: {
        source: 'local',
        path: `./plugins/${pluginName}`,
      },
      policy: {
        installation: 'AVAILABLE',
        authentication: 'ON_INSTALL',
      },
      category: 'Developer Tools',
    },
  ],
}

const claudeMarketplace = {
  $schema: 'https://anthropic.com/claude-code/marketplace.schema.json',
  name: 'platty',
  description: 'Platty CLI and documentation workflow skills for Claude Code.',
  owner: {
    name: 'Paradigm Shift Labs',
  },
  plugins: [
    {
      name: pluginName,
      description: 'Shared Platty CLI, analysis, retrieval, and documentation workflow skills.',
      author: {
        name: 'Paradigm Shift Labs',
      },
      category: 'development',
      source: `./plugins/${pluginName}`,
      homepage: 'https://github.com/paradigmshift-labs/platty',
    },
  ],
}

const requiredPluginEntries = [
  '.codex-plugin',
  '.claude-plugin',
  'hooks',
  'README.md',
]

const expectedSkills = [
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

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function listFiles(dir, prefix = '') {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry)
    const relativePath = prefix === '' ? entry : join(prefix, entry)
    const stats = statSync(fullPath)
    if (stats.isDirectory()) return listFiles(fullPath, relativePath)
    if (stats.isFile()) return [relativePath]
    return []
  }).sort()
}

function assertPackagedEntryExists(entry) {
  const target = join(pluginRoot, entry)
  assert.equal(existsSync(target), true, `Missing packaged entry: ${relative(root, target)}`)

  if (statSync(target).isDirectory()) assert.ok(listFiles(target).length > 0, `Packaged ${entry} should not be empty`)
}

function assertPackageMatches() {
  const marketplacePath = join(marketplaceRoot, '.agents', 'plugins', 'marketplace.json')
  assert.equal(existsSync(marketplacePath), true, 'agent marketplace manifest should exist')
  assert.deepEqual(JSON.parse(read(marketplacePath)), codexMarketplace)

  const claudeMarketplacePath = join(marketplaceRoot, '.claude-plugin', 'marketplace.json')
  assert.equal(existsSync(claudeMarketplacePath), true, 'Claude marketplace manifest should exist')
  assert.deepEqual(JSON.parse(read(claudeMarketplacePath)), claudeMarketplace)

  for (const entry of requiredPluginEntries) assertPackagedEntryExists(entry)

  const skillsDir = join(pluginRoot, 'skills')
  assert.equal(existsSync(skillsDir), true, 'plugin skills directory should exist')
  const packagedSkills = readdirSync(skillsDir).filter((entry) => statSync(join(skillsDir, entry)).isDirectory()).sort()
  assert.deepEqual(packagedSkills, [...expectedSkills].sort(), 'plugin skills directory should contain exactly the expected skills')
  for (const name of expectedSkills) {
    assert.equal(existsSync(join(skillsDir, name, 'SKILL.md')), true, `Missing packaged skill: ${name}`)
  }

  const codexManifest = JSON.parse(read(join(pluginRoot, '.codex-plugin', 'plugin.json')))
  assert.equal(codexManifest.name, pluginName)
  assert.equal(codexManifest.skills, './skills/')
  assert.equal(Object.hasOwn(codexManifest, 'hooks'), false)

  const claudeManifest = JSON.parse(read(join(pluginRoot, '.claude-plugin', 'plugin.json')))
  assert.equal(claudeManifest.name, pluginName)
}

if (!checkOnly) {
  rmSync(join(marketplaceRoot, 'plugins', 'platty-agent-skills'), { recursive: true, force: true })
  mkdirSync(join(marketplaceRoot, '.agents', 'plugins'), { recursive: true })
  mkdirSync(join(marketplaceRoot, '.claude-plugin'), { recursive: true })
  mkdirSync(pluginRoot, { recursive: true })
  writeJson(join(marketplaceRoot, '.agents', 'plugins', 'marketplace.json'), codexMarketplace)
  writeJson(join(marketplaceRoot, '.claude-plugin', 'marketplace.json'), claudeMarketplace)
}

assertPackageMatches()
