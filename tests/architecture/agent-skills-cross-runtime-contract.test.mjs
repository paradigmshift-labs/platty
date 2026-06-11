import assert from 'node:assert/strict'
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const skillRoot = 'agent-marketplace/plugins/platty/skills'

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

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function readJson(path) {
  return JSON.parse(read(path))
}

function skill(path) {
  const fullPath = join(root, path, 'SKILL.md')
  assert.equal(existsSync(fullPath), true, `${path}/SKILL.md should exist`)
  return readFileSync(fullPath, 'utf8')
}

function frontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/)
  assert.ok(match, 'skill should have YAML frontmatter')
  return match[1]
}

function markdownTableMap(markdown) {
  const entries = new Map()
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    const cells = trimmed.split('|').slice(1, -1).map((cell) => cell.trim())
    if (cells.length !== 2) continue
    const [action, equivalent] = cells
    if (action === 'Platty skill action' || /^-+$/.test(action)) continue
    entries.set(action, equivalent)
  }
  return entries
}

describe('cross-runtime Platty skill catalog', () => {
  it('stores public skills under the marketplace plugin directory', () => {
    for (const name of expectedSkills) {
      const body = skill(`${skillRoot}/${name}`)
      const meta = frontmatter(body)
      assert.match(meta, new RegExp(`^name: ${name}$`, 'm'))
      assert.match(meta, /^description: Use when /m)
    }
  })

  it('keeps repo-local skill paths as symlinks to marketplace skills', () => {
    assert.equal(lstatSync(join(root, 'skills')).isSymbolicLink(), true, 'skills should be a symlink')
    assert.equal(readlinkSync(join(root, 'skills')), 'agent-marketplace/plugins/platty/skills')

    assert.equal(lstatSync(join(root, '.codex', 'skills')).isSymbolicLink(), true, '.codex/skills should be a symlink')
    assert.equal(readlinkSync(join(root, '.codex', 'skills')), '../skills')

    for (const name of expectedSkills) {
      const source = skill(`${skillRoot}/${name}`)
      const mirror = skill(`.codex/skills/${name}`)
      const rootLinked = skill(`skills/${name}`)
      assert.equal(rootLinked, source, `skills/${name}/SKILL.md should resolve to marketplace source`)
      assert.equal(mirror, source, `.codex/skills/${name}/SKILL.md should resolve to marketplace source`)
    }
  })

  it('declares Codex plugin wiring against the shared catalog', () => {
    const manifest = readJson('.codex-plugin/plugin.json')
    assert.equal(manifest.name, 'platty')
    assert.equal(manifest.interface.displayName, 'Platty')
    assert.equal(manifest.skills, './skills/')
    assert.equal(Object.hasOwn(manifest, 'hooks'), false, 'Codex manifest validator rejects a top-level hooks field')
    assert.match(manifest.description, /Platty/)

    const hooks = readJson('hooks/hooks-codex.json')
    assert.ok(hooks.hooks.SessionStart, 'Codex SessionStart hook should be configured')
    const encoded = JSON.stringify(hooks)
    assert.match(encoded, /session-start-codex/)
    assert.match(encoded, /PLUGIN_ROOT/)
  })

  it('declares Claude plugin metadata and bootstrap hook', () => {
    const manifest = readJson('.claude-plugin/plugin.json')
    assert.equal(manifest.name, 'platty')
    assert.match(manifest.description, /Platty/)
    assert.equal(manifest.version, '0.1.0')

    const hooks = readJson('hooks/hooks.json')
    assert.ok(hooks.hooks.SessionStart, 'Claude SessionStart hook should be configured')
    const encoded = JSON.stringify(hooks)
    assert.match(encoded, /session-start/)
    assert.match(encoded, /CLAUDE_PLUGIN_ROOT/)
  })

  it('bootstraps using-platty with runtime-neutral cross-runtime mappings', () => {
    const usingPlatty = skill(`${skillRoot}/using-platty`)
    assert.match(usingPlatty, /runtime-neutral/)
    assert.match(usingPlatty, /equal, first-class execution runtimes/)
    assert.match(usingPlatty, /the runtime you are working in/)
    assert.match(usingPlatty, /claude-code-tools\.md/)
    assert.match(usingPlatty, /codex-tools\.md/)
    assert.match(usingPlatty, /platty-cli-router/)

    const codexTools = read(`${skillRoot}/using-platty/references/codex-tools.md`)
    for (const expected of [
      /apply_patch/,
      /update_plan/,
      /spawn_agent/,
      /wait_agent/,
      /close_agent/,
      /multi_tool_use\.parallel/,
      /Browser plugin/,
      /web tools/,
      /git rev-parse --git-dir/,
      /git rev-parse --git-common-dir/,
      /git branch --show-current/,
      /Codex app git directives/,
    ]) {
      assert.match(codexTools, expected)
    }

    const claudeTools = read(`${skillRoot}/using-platty/references/claude-code-tools.md`)
    for (const expected of [
      /Read/,
      /Grep/,
      /Glob/,
      /Write/,
      /Edit/,
      /Bash/,
      /TodoWrite/,
      /Skill/,
      /Task/,
      /WebFetch/,
      /WebSearch/,
    ]) {
      assert.match(claudeTools, expected)
    }

    const codexMapping = markdownTableMap(codexTools)
    const claudeMapping = markdownTableMap(claudeTools)
    assert.deepEqual(
      [...claudeMapping.keys()],
      [...codexMapping.keys()],
      'Claude and Codex mappings must cover the same set of Platty actions',
    )
    assert.match(claudeMapping.get('Close a completed worker'), /No explicit close step|Task result/)
  })

  it('ships a deterministic sync script for Codex mirror drift', () => {
    const script = read('scripts/sync-agent-skills.mjs')
    assert.match(script, /expectedSkills/)
    assert.match(script, /--check/)
    assert.match(script, /\.codex\/skills/)
    assert.match(script, /symlinkSync/)

    const rootPackage = readJson('package.json')
    assert.equal(rootPackage.scripts['sync:agent-skills'], 'node scripts/sync-agent-skills.mjs')
    assert.equal(rootPackage.scripts['check:agent-skills'], 'node scripts/sync-agent-skills.mjs --check')
    assert.equal(rootPackage.scripts['package:agent-marketplace'], 'node scripts/package-agent-marketplace.mjs')
    assert.equal(rootPackage.scripts['check:agent-marketplace'], 'node scripts/package-agent-marketplace.mjs --check')
    assert.match(rootPackage.scripts.test, /check:agent-skills/)
  })

  it('packages a repo-local marketplace that can later move to a distribution repo', () => {
    const marketplace = readJson('agent-marketplace/.agents/plugins/marketplace.json')
    assert.equal(marketplace.name, 'platty')
    assert.equal(marketplace.interface.displayName, 'Platty Marketplace')
    assert.equal(marketplace.plugins.length, 1)
    assert.deepEqual(marketplace.plugins[0], {
      name: 'platty',
      source: {
        source: 'local',
        path: './plugins/platty',
      },
      policy: {
        installation: 'AVAILABLE',
        authentication: 'ON_INSTALL',
      },
      category: 'Developer Tools',
    })

    const claudeMarketplace = readJson('agent-marketplace/.claude-plugin/marketplace.json')
    assert.equal(claudeMarketplace.$schema, 'https://anthropic.com/claude-code/marketplace.schema.json')
    assert.equal(claudeMarketplace.name, 'platty')
    assert.equal(claudeMarketplace.owner.name, 'Paradigm Shift Labs')
    assert.deepEqual(claudeMarketplace.plugins[0], {
      name: 'platty',
      description: 'Shared Platty CLI, analysis, retrieval, and documentation workflow skills.',
      author: {
        name: 'Paradigm Shift Labs',
      },
      category: 'development',
      source: './plugins/platty',
      homepage: 'https://github.com/paradigmshift-labs/platty',
    })

    const packagedManifest = readJson('agent-marketplace/plugins/platty/.codex-plugin/plugin.json')
    assert.equal(packagedManifest.name, 'platty')
    assert.equal(packagedManifest.skills, './skills/')

    const packagedClaudeManifest = readJson('agent-marketplace/plugins/platty/.claude-plugin/plugin.json')
    assert.equal(packagedClaudeManifest.name, 'platty')
    assert.equal(packagedClaudeManifest.author.name, 'Paradigm Shift Labs')

    for (const name of expectedSkills) {
      const packaged = skill(`agent-marketplace/plugins/platty/skills/${name}`)
      const rootLinked = skill(`skills/${name}`)
      assert.equal(rootLinked, packaged, `root skill link should resolve to marketplace skill: ${name}`)
    }
  })

  it('keeps skill handoffs and docs status lifecycle explicit', () => {
    const usingPlatty = skill(`${skillRoot}/using-platty`)
    assert.match(usingPlatty, /Use `platty-cli-router`/)
    for (const name of expectedSkills.filter((skillName) => skillName !== 'using-platty' && skillName !== 'platty-cli-router')) {
      assert.match(usingPlatty, new RegExp(name), `using-platty should route to ${name}`)
    }

    const router = skill(`${skillRoot}/platty-cli-router`)
    assert.match(router, /init -> project -> repo -> status -> run -> confirm -> status -> docs or epics or business-docs/)
    assert.match(router, /nextAction\.command/)
    assert.match(router, /platty-docs-generation/)

    const staticAnalysis = skill(`${skillRoot}/platty-static-analysis`)
    assert.match(staticAnalysis, /platty status --project <project> --json/)
    assert.match(staticAnalysis, /build_docs/)
    assert.match(staticAnalysis, /platty-docs-target-curation/)
    assert.match(staticAnalysis, /platty-docs-generation/)

    const docsGeneration = skill(`${skillRoot}/platty-docs-generation`)
    assert.match(docsGeneration, /platty docs start --project <project> --json/)
    assert.match(docsGeneration, /platty docs approve --run-id <run-id>/)
    assert.match(docsGeneration, /platty docs worker next --run-id <run-id>/)
    assert.match(docsGeneration, /not_approved/)
    assert.match(docsGeneration, /no_task_available/)
    assert.match(docsGeneration, /repair_requested/)
    assert.match(docsGeneration, /platty docs status --run-id <run-id> --json/)
    assert.match(docsGeneration, /Report completed, pending, repair, and failed counts/)
  })
})
