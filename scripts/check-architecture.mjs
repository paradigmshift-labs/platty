import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const workspaces = [
  {
    name: '@platty/core',
    manifestPath: 'packages/core/package.json',
    sourceDir: 'packages/core/src',
    allowedWorkspaceDeps: [],
    forbiddenImports: [
      '@platty/sdk',
      '@pshift/platty',
      '@platty/backend',
      '@platty/web',
      '@platty/desktop',
    ],
  },
  {
    name: '@platty/sdk',
    manifestPath: 'packages/sdk/package.json',
    sourceDir: 'packages/sdk/src',
    allowedWorkspaceDeps: [],
    forbiddenImports: [
      '@platty/core',
      '@pshift/platty',
      '@platty/backend',
      '@platty/web',
      '@platty/desktop',
    ],
  },
  {
    name: '@pshift/platty',
    manifestPath: 'packages/cli/package.json',
    sourceDir: 'packages/cli/src',
    allowedWorkspaceDeps: ['@platty/core'],
    forbiddenImports: ['@platty/sdk', '@platty/backend', '@platty/web', '@platty/desktop'],
  },
  {
    name: '@platty/backend',
    manifestPath: 'apps/backend/package.json',
    sourceDir: 'apps/backend/src',
    allowedWorkspaceDeps: ['@platty/core'],
    forbiddenImports: ['@platty/sdk', '@pshift/platty', '@platty/web', '@platty/desktop'],
  },
  {
    name: '@platty/web',
    manifestPath: 'apps/web/package.json',
    sourceDir: 'apps/web/src',
    allowedWorkspaceDeps: ['@platty/sdk'],
    forbiddenImports: ['@platty/core', '@pshift/platty', '@platty/backend', '@platty/desktop'],
  },
  {
    name: '@platty/desktop',
    manifestPath: 'apps/desktop/package.json',
    sourceDir: 'apps/desktop/src',
    allowedWorkspaceDeps: ['@platty/sdk'],
    forbiddenImports: ['@platty/core', '@pshift/platty', '@platty/backend', '@platty/web'],
  },
]

const workspacePackageNames = new Set(workspaces.map((workspace) => workspace.name))

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'))
}

function assertRootManifest() {
  const manifest = readJson('package.json')
  assert.equal(manifest.private, true, 'root package must stay private')
  assert.equal(manifest.type, 'module', 'root package must use ESM')
  assert.deepEqual(manifest.workspaces, ['packages/*', 'apps/*'], 'root workspaces must stay package/app scoped')
}

function assertWorkspaceManifest(workspace) {
  const manifest = readJson(workspace.manifestPath)
  assert.equal(manifest.name, workspace.name, `${workspace.manifestPath} has an unexpected package name`)
  assert.equal(manifest.type, 'module', `${workspace.manifestPath} must use ESM`)
  assert.equal(manifest.scripts?.build, 'tsc -b', `${workspace.manifestPath} must expose a build script`)
  const expectedTestScript = workspace.manifestPath === 'packages/core/package.json' || workspace.manifestPath === 'packages/cli/package.json'
    ? 'vitest run'
    : 'node --test'
  assert.equal(manifest.scripts?.test, expectedTestScript, `${workspace.manifestPath} must expose a test script`)

  const dependencySections = [
    manifest.dependencies ?? {},
    manifest.devDependencies ?? {},
    manifest.peerDependencies ?? {},
    manifest.optionalDependencies ?? {},
  ]
  const declaredWorkspaceDeps = new Set(
    dependencySections.flatMap((section) =>
      Object.keys(section).filter((name) => workspacePackageNames.has(name)),
    ),
  )

  for (const dependencyName of declaredWorkspaceDeps) {
    assert.ok(
      workspace.allowedWorkspaceDeps.includes(dependencyName),
      `${workspace.manifestPath} must not depend on ${dependencyName}`,
    )
  }
}

function assertTsconfigReferences() {
  const rootTsconfig = readJson('tsconfig.json')
  const referencePaths = (rootTsconfig.references ?? []).map((reference) => reference.path).sort()
  assert.deepEqual(referencePaths, [
    './apps/backend',
    './apps/desktop',
    './apps/web',
    './packages/cli',
    './packages/core',
    './packages/sdk',
  ])
}

function sourceFiles(sourceDir) {
  const absSourceDir = join(root, sourceDir)
  if (!existsSync(absSourceDir)) return []
  const files = []
  const stack = [absSourceDir]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absPath = join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'dist' || entry.name === 'node_modules') continue
        stack.push(absPath)
        continue
      }
      if (entry.isFile() && /\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
        files.push(absPath)
      }
    }
  }
  return files.sort()
}

function importedSpecifiers(source) {
  const specifiers = []
  const importExportPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g
  const dynamicImportPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  const requirePattern = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const pattern of [importExportPattern, dynamicImportPattern, requirePattern]) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push(match[1])
    }
  }
  return specifiers
}

function assertNoForbiddenImports(workspace) {
  for (const absPath of sourceFiles(workspace.sourceDir)) {
    const source = readFileSync(absPath, 'utf8')
    const relPath = relative(root, absPath).split(sep).join('/')
    for (const specifier of importedSpecifiers(source)) {
      for (const forbidden of workspace.forbiddenImports) {
        assert.ok(
          specifier !== forbidden && !specifier.startsWith(`${forbidden}/`),
          `${relPath} must not import ${specifier}`,
        )
      }
      assertNoCrossWorkspaceRelativeImport(workspace, relPath, specifier)
    }
  }
}

function assertNoCrossWorkspaceRelativeImport(workspace, relPath, specifier) {
  if (!specifier.startsWith('.')) return
  const fromDir = dirname(join(root, relPath))
  const targetPath = resolve(fromDir, specifier)
  const workspaceRoot = join(root, dirname(workspace.manifestPath))
  if (relative(workspaceRoot, targetPath).startsWith(`..${sep}`)) {
    throw new Error(`${relPath} must not use a relative import outside ${dirname(workspace.manifestPath)}: ${specifier}`)
  }
}

function assertEntrypointsExist() {
  for (const path of [
    'packages/core/src/index.ts',
    'packages/sdk/src/index.ts',
    'packages/cli/src/main.ts',
    'apps/backend/src/main.ts',
    'apps/web/src/index.ts',
    'apps/desktop/src/index.ts',
  ]) {
    assert.equal(existsSync(join(root, path)), true, `${path} must exist`)
    assert.equal(statSync(join(root, path)).isFile(), true, `${path} must be a file`)
  }
}

function assertCorePhaseOneInfrastructure() {
  for (const path of [
    'packages/core/src/db/client.ts',
    'packages/core/src/db/index.ts',
    'packages/core/src/db/migrate.ts',
    'packages/core/src/db/paths.ts',
    'packages/core/src/db/testing.ts',
    'packages/core/src/db/schema/index.ts',
    'packages/core/src/db/migrations/meta/_journal.json',
    'packages/core/src/pipeline_infra/index.ts',
  ]) {
    assert.equal(existsSync(join(root, path)), true, `${path} must exist`)
  }

  const dbPathsSource = readFileSync(join(root, 'packages/core/src/db/paths.ts'), 'utf8')
  assert.equal(dbPathsSource.includes('sdd_v2.db'), false, 'core must not default to legacy sdd_v2.db')
  assert.equal(dbPathsSource.includes("process.cwd(), 'data"), false, 'core DB path must not default under cwd data/')
  assert.equal(dbPathsSource.includes('PLATTY_HOME'), true, 'core must support PLATTY_HOME')
  assert.equal(dbPathsSource.includes("'.platty'"), true, 'core must default under user-global .platty')
  assert.equal(dbPathsSource.includes("'platty.db'"), true, 'core must default to platty.db')

  const dbClientSource = readFileSync(join(root, 'packages/core/src/db/client.ts'), 'utf8')
  assert.equal(dbClientSource.includes('export const db ='), false, 'core must not open a DB singleton at import time')
  assert.equal(dbClientSource.includes('openPlattyDb'), true, 'core must expose explicit DB open helper')

  const coreEntrypointSource = readFileSync(join(root, 'packages/core/src/index.ts'), 'utf8')
  assert.equal(coreEntrypointSource.includes('createTestPlattyDb'), true, 'core must export test DB helper')
  assert.equal(coreEntrypointSource.includes('createPipelineRuntime'), true, 'core must export Phase 1 pipeline runtime base')
}

function assertCorePhaseTwoStaticPipeline() {
  const requiredStaticModules = [
    'analyze_repo',
    'build_graph',
    'build_pattern_profile',
    'build_models',
    'build_route',
    'build_relations',
    'build_service_map',
  ]

  for (const moduleName of requiredStaticModules) {
    assert.equal(
      existsSync(join(root, 'packages/core/src/pipeline_modules', moduleName)),
      true,
      `core static pipeline must include ${moduleName}`,
    )
  }

  const forbiddenPaths = [
    'packages/core/src/server',
    'packages/core/src/artifacts',
    'packages/core/src/legacy',
    'packages/core/src/pipeline_modules/legacy_generation',
  ]

  for (const path of forbiddenPaths) {
    assert.equal(existsSync(join(root, path)), false, `core must not include excluded legacy/PoC path: ${path}`)
  }

  const coreEntrypointSource = readFileSync(join(root, 'packages/core/src/index.ts'), 'utf8')
  for (const symbol of [
    'runAnalyzeRepo',
    'runBuildGraph',
    'runBuildPatternProfile',
    'runBuildModels',
    'runBuildRoute',
    'runBuildRelations',
    'runBuildServiceMap',
  ]) {
    assert.equal(coreEntrypointSource.includes(symbol), true, `core must export ${symbol}`)
  }
}

function assertCliPhaseThreeFoundation() {
  const forbiddenCommandFiles = [
    'packages/cli/src/commands/docs.ts',
    'packages/cli/src/commands/epics.ts',
    'packages/cli/src/commands/business-docs.ts',
    'packages/cli/src/commands/service-map.ts',
    'packages/cli/src/commands/business-map.ts',
    'packages/cli/src/commands/search.ts',
    'packages/cli/src/commands/live-index.ts',
  ]

  for (const path of forbiddenCommandFiles) {
    assert.equal(existsSync(join(root, path)), false, `CLI Phase 3 must not include later command surface: ${path}`)
  }

  for (const absPath of sourceFiles('packages/cli/src')) {
    const source = readFileSync(absPath, 'utf8')
    const relPath = relative(root, absPath).split(sep).join('/')
    assert.equal(source.includes('localDbPath'), false, `${relPath} must not store or read project-local DB paths`)
    assert.equal(source.includes('sdd_v2.db'), false, `${relPath} must not reference legacy sdd_v2.db`)

    for (const specifier of importedSpecifiers(source)) {
      assert.equal(specifier.startsWith('@/'), false, `${relPath} must not import core internals through @/: ${specifier}`)
      assert.equal(specifier.includes('packages/core/src'), false, `${relPath} must not import packages/core/src directly: ${specifier}`)
    }
  }
}

function assertCorePhaseFourSync() {
  for (const path of [
    'packages/core/src/pipeline_modules/sync/hash.ts',
    'packages/core/src/pipeline_modules/sync/static_map.ts',
    'packages/core/src/pipeline_modules/sync/doc_sync.ts',
    'packages/core/src/pipeline_modules/sync/index.ts',
  ]) {
    assert.equal(existsSync(join(root, path)), true, `core sync pipeline must include ${path}`)
  }

  assert.equal(
    existsSync(join(root, 'packages/core/src/pipeline_modules/sync_v2')),
    false,
    'core must expose latest sync under sync, not sync_v2',
  )

  for (const absPath of sourceFiles('packages/core/src/pipeline_modules/sync')) {
    const source = readFileSync(absPath, 'utf8')
    const relPath = relative(root, absPath).split(sep).join('/')
    assert.equal(source.includes('sync_v2'), false, `${relPath} must use sync naming, not sync_v2`)
    assert.equal(source.includes('SyncV2'), false, `${relPath} must use sync naming, not SyncV2`)
    assert.equal(source.includes('SYNC_V2'), false, `${relPath} must use sync naming, not SYNC_V2`)
  }

  const coreEntrypointSource = readFileSync(join(root, 'packages/core/src/index.ts'), 'utf8')
  for (const symbol of [
    'syncStaticMap',
    'SyncStaticMapError',
    'createDocSyncPlan',
    'applyDocSyncPlan',
  ]) {
    assert.equal(coreEntrypointSource.includes(symbol) || coreEntrypointSource.includes("pipeline_modules/sync"), true, `core must export ${symbol}`)
  }
}

assertRootManifest()
assertTsconfigReferences()
assertEntrypointsExist()
assertCorePhaseOneInfrastructure()
assertCorePhaseTwoStaticPipeline()
assertCliPhaseThreeFoundation()
assertCorePhaseFourSync()

for (const workspace of workspaces) {
  assertWorkspaceManifest(workspace)
  assertNoForbiddenImports(workspace)
}

console.log('Architecture check passed')
