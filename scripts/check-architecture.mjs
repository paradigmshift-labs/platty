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

  const cliMainSource = readFileSync(join(root, 'packages/cli/src/main.ts'), 'utf8')
  assert.equal(cliMainSource.includes('docsTaskInvoker'), true, 'CLI run options must expose docsTaskInvoker for testable docs worker execution')

  const cliProgramSource = readFileSync(join(root, 'packages/cli/src/program.ts'), 'utf8')
  assert.equal(cliProgramSource.includes("'docs'"), true, 'CLI public command roots must include docs')
  assert.equal(cliProgramSource.includes('./commands/docs.js'), true, 'CLI program must route docs through commands/docs.ts')

  const docsCommandPath = join(root, 'packages/cli/src/commands/docs.ts')
  assert.equal(existsSync(docsCommandPath), true, 'CLI must expose docs command surface')
  const docsCommandSource = readFileSync(docsCommandPath, 'utf8')
  assert.equal(docsCommandSource.includes('@platty/core'), true, 'CLI docs command must use @platty/core public API')
  assert.equal(docsCommandSource.includes('@/'), false, 'CLI docs command must not import core internals through @/')
  assert.equal(docsCommandSource.includes('openCliDb'), true, 'CLI docs command must use global Platty DB opener')
  assert.equal(docsCommandSource.includes('sdd_v2.db'), false, 'CLI docs command must not reference legacy sdd_v2.db')
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

function assertCorePhaseFiveSharedSegments() {
  for (const path of [
    'packages/core/src/db/schema/shared_code_segments.ts',
    'packages/core/src/db/migrations/0034_shared_code_segments.sql',
    'packages/core/src/pipeline_modules/build_docs/source/shared_segments.ts',
    'packages/core/tests/pipeline_modules/build_docs/source/shared_segments.test.ts',
  ]) {
    assert.equal(existsSync(join(root, path)), true, `core shared segment phase must include ${path}`)
  }

  const coreEntrypointSource = readFileSync(join(root, 'packages/core/src/index.ts'), 'utf8')
  assert.equal(
    coreEntrypointSource.includes("pipeline_modules/build_docs/source/index"),
    true,
    'core must export shared code segment helpers for later docs runtime/CLI use',
  )

  const sharedSegmentsSource = readFileSync(join(root, 'packages/core/src/pipeline_modules/build_docs/source/shared_segments.ts'), 'utf8')
  assert.equal(sharedSegmentsSource.includes('rebuildSharedCodeSegmentsForProject'), true, 'shared segments must expose project rebuild helper')
  assert.equal(sharedSegmentsSource.includes('loadSharedCodeSegmentsForEntryPoints'), true, 'shared segments must expose entry-point context loader')
}

function assertCorePhaseSixGenerationRuns() {
  for (const path of [
    'packages/core/src/pipeline_modules/build_docs/runtime/cli_runtime.ts',
    'packages/core/src/pipeline_modules/build_docs/runtime/draft_contract.ts',
    'packages/core/src/pipeline_modules/build_docs/runtime/draft_json_repair.ts',
    'packages/core/src/pipeline_modules/build_docs/runtime/index.ts',
    'packages/core/src/pipeline_modules/build_docs/runtime/materialize_document_graph.ts',
    'packages/core/src/pipeline_modules/build_docs/runtime/persist_helpers.ts',
    'packages/core/src/pipeline_modules/build_docs/runtime/quality_audit.ts',
    'packages/core/src/pipeline_modules/build_docs/runtime/runtime.ts',
    'packages/core/src/pipeline_modules/build_docs/runtime/types.ts',
    'packages/core/src/pipeline_modules/build_docs/source/agent_packet.ts',
    'packages/core/src/pipeline_modules/build_docs/source/context_builder.ts',
    'packages/core/src/pipeline_modules/build_docs/source/index.ts',
    'packages/core/src/pipeline_modules/build_docs/source/pre_llm_context.ts',
    'packages/core/src/pipeline_modules/build_docs/source/relation_compactor.ts',
    'packages/core/src/pipeline_modules/build_docs/source/service_map_facts.ts',
    'packages/core/src/pipeline_modules/build_docs/source/shared_segments.ts',
    'packages/core/src/pipeline_modules/build_docs/source/source_closure.ts',
    'packages/core/src/pipeline_modules/build_docs/source/source_links.ts',
    'packages/core/src/pipeline_modules/build_docs/source/static_envelope.ts',
    'packages/core/src/pipeline_modules/build_docs/source/system_merge.ts',
    'packages/core/src/pipeline_modules/build_docs/source/target_selector.ts',
    'packages/core/src/pipeline_modules/build_docs/worker/index.ts',
    'packages/core/src/pipeline_modules/build_docs/worker/worker_runner.ts',
    'packages/core/src/pipeline_modules/build_docs_cli_runtime/index.ts',
    'packages/core/src/pipeline_modules/build_docs_generation/index.ts',
    'packages/core/src/pipeline_modules/generation_runs/build_docs_adapter.ts',
    'packages/core/src/pipeline_modules/generation_runs/index.ts',
    'packages/core/src/pipeline_modules/generation_runs/lease_engine.ts',
    'packages/core/src/pipeline_modules/generation_runs/resumable_run_resolver.ts',
    'packages/core/src/pipeline_modules/generation_runs/shared_generation_adapter.ts',
    'packages/core/src/pipeline_modules/generation_runs/types.ts',
    'packages/core/src/pipeline_modules/cli_agent_runner/codex_cli.ts',
    'packages/core/tests/pipeline_modules/build_docs/worker/worker_runner.test.ts',
    'packages/core/tests/pipeline_modules/build_docs/source/agent_packet.test.ts',
    'packages/core/tests/pipeline_modules/build_docs/source/context_builder.test.ts',
    'packages/core/tests/pipeline_modules/build_docs/runtime/draft_contract.test.ts',
    'packages/core/tests/pipeline_modules/build_docs/runtime/draft_json_repair.test.ts',
    'packages/core/tests/pipeline_modules/build_docs/runtime/quality_audit.test.ts',
    'packages/core/tests/pipeline_modules/build_docs/runtime/runtime.test.ts',
    'packages/core/tests/pipeline_modules/build_docs/source/source_closure.test.ts',
    'packages/core/tests/pipeline_modules/build_docs/source/source_links.test.ts',
    'packages/core/tests/pipeline_modules/build_docs/source/static_envelope.test.ts',
    'packages/core/tests/pipeline_modules/build_docs/source/system_merge.test.ts',
    'packages/core/tests/pipeline_modules/generation_runs/build_docs_adapter.test.ts',
    'packages/core/tests/pipeline_modules/generation_runs/lease_engine.test.ts',
    'packages/core/tests/pipeline_modules/generation_runs/shared_generation_adapter.test.ts',
  ]) {
    assert.equal(existsSync(join(root, path)), true, `core build-docs runtime phase must include ${path}`)
  }

  const coreEntrypointSource = readFileSync(join(root, 'packages/core/src/index.ts'), 'utf8')
  assert.equal(
    coreEntrypointSource.includes("pipeline_modules/build_docs/runtime/index"),
    true,
    'core must export build docs generation runtime for CLI use',
  )
  assert.equal(
    coreEntrypointSource.includes("pipeline_modules/build_docs/worker/index"),
    true,
    'core must export build docs CLI runtime for CLI package use',
  )
  assert.equal(
    coreEntrypointSource.includes("pipeline_modules/generation_runs/index"),
    true,
    'core must export generation run lifecycle helpers for later docs runtime/CLI use',
  )

  for (const sourceDir of [
    'packages/core/src/pipeline_modules/build_docs/runtime',
    'packages/core/src/pipeline_modules/build_docs/source',
    'packages/core/src/pipeline_modules/build_docs/worker',
  ]) {
    for (const absPath of sourceFiles(sourceDir)) {
      const source = readFileSync(absPath, 'utf8')
      const relPath = relative(root, absPath).split(sep).join('/')
      assert.equal(source.includes('build_business_docs_cli'), false, `${relPath} must not import Phase 8 business docs runtime yet`)
      assert.equal(source.includes('sync_v2'), false, `${relPath} must use sync naming, not sync_v2`)
    }
  }

  const adapterSource = readFileSync(join(root, 'packages/core/src/pipeline_modules/generation_runs/index.ts'), 'utf8')
  assert.equal(adapterSource.includes('resolveUnifiedRunAdapter'), true, 'generation run index must expose adapter resolver')
  assert.equal(adapterSource.includes("stage === 'build_docs'"), true, 'generation run resolver must dispatch build_docs runs')
}

function assertCorePhaseSevenBuildEpics() {
  for (const path of [
    'packages/core/src/pipeline_modules/build_epics_cli_runtime/index.ts',
    'packages/core/src/pipeline_modules/build_epics_core/index.ts',
    'packages/core/src/pipeline_modules/build_epics_sync/index.ts',
    'packages/core/src/pipeline_modules/build_epics/runtime/index.ts',
    'packages/core/src/pipeline_modules/build_epics/runtime/runtime.ts',
    'packages/core/src/pipeline_modules/build_epics/source/index.ts',
    'packages/core/src/pipeline_modules/build_epics/source/cards.ts',
    'packages/core/src/pipeline_modules/build_epics/worker/index.ts',
    'packages/core/src/pipeline_modules/build_epics/worker/worker_runner.ts',
    'packages/core/src/pipeline_modules/build_epics/core/index.ts',
    'packages/core/src/pipeline_modules/build_epics/core/f0_assert_docs_complete.ts',
    'packages/core/src/pipeline_modules/build_epics/core/f1_load_doc_index.ts',
    'packages/core/src/pipeline_modules/build_epics/core/f9_validate_plan.ts',
    'packages/core/src/pipeline_modules/build_epics/core/f10_persist_confirmed_epics.ts',
    'packages/core/src/pipeline_modules/build_epics/sync/index.ts',
    'packages/core/src/pipeline_modules/build_epics/sync/runtime.ts',
    'packages/core/src/pipeline_modules/build_epics/sync/worker_runner.ts',
    'packages/core/src/pipeline_modules/generation_runs/build_epics_adapter.ts',
    'packages/core/tests/pipeline_modules/build_epics/runtime/runtime.test.ts',
    'packages/core/tests/pipeline_modules/build_epics/worker/worker_runner.test.ts',
    'packages/core/tests/pipeline_modules/build_epics/core/f0_assert_docs_complete.test.ts',
    'packages/core/tests/pipeline_modules/build_epics/core/f1_load_doc_index_review_decisions.test.ts',
    'packages/core/tests/pipeline_modules/build_epics/sync/runtime.test.ts',
    'packages/core/tests/pipeline_modules/build_epics/sync/worker_runner.test.ts',
    'packages/core/tests/pipeline_modules/generation_runs/build_epics_adapter.test.ts',
    'packages/cli/src/commands/epics.ts',
    'packages/cli/tests/epics-command.test.ts',
  ]) {
    assert.equal(existsSync(join(root, path)), true, `Phase 7 build epics runtime must include ${path}`)
  }

  const coreEntrypointSource = readFileSync(join(root, 'packages/core/src/index.ts'), 'utf8')
  for (const token of [
    'pipeline_modules/build_epics/runtime/index',
    'pipeline_modules/build_epics/source/index',
    'pipeline_modules/build_epics/worker/index',
    'buildEpicsCore',
    'pipeline_modules/build_epics/sync/index',
  ]) {
    assert.equal(coreEntrypointSource.includes(token), true, `core must export Phase 7 build epics surface: ${token}`)
  }

  const legacyRuntimeShim = readFileSync(join(root, 'packages/core/src/pipeline_modules/build_epics_cli_runtime/index.ts'), 'utf8').trim()
  assert.equal(
    legacyRuntimeShim,
    [
      "export * from '@/pipeline_modules/build_epics/runtime/index.js'",
      "export * from '@/pipeline_modules/build_epics/source/index.js'",
      "export * from '@/pipeline_modules/build_epics/worker/index.js'",
    ].join('\n'),
    'legacy build_epics_cli_runtime entrypoint must be a temporary shim only',
  )

  const legacyCoreShim = readFileSync(join(root, 'packages/core/src/pipeline_modules/build_epics_core/index.ts'), 'utf8').trim()
  assert.equal(
    legacyCoreShim,
    "export * from '@/pipeline_modules/build_epics/core/index.js'",
    'legacy build_epics_core entrypoint must be a temporary shim only',
  )

  const legacySyncShim = readFileSync(join(root, 'packages/core/src/pipeline_modules/build_epics_sync/index.ts'), 'utf8').trim()
  assert.equal(
    legacySyncShim,
    "export * from '@/pipeline_modules/build_epics/sync/index.js'",
    'legacy build_epics_sync entrypoint must be a temporary shim only',
  )

  const generationRunIndexSource = readFileSync(join(root, 'packages/core/src/pipeline_modules/generation_runs/index.ts'), 'utf8')
  assert.equal(generationRunIndexSource.includes("stage === 'build_epics'"), true, 'generation run resolver must dispatch build_epics runs')

  for (const sourceDir of [
    'packages/core/src/pipeline_modules/build_epics/runtime',
    'packages/core/src/pipeline_modules/build_epics/source',
    'packages/core/src/pipeline_modules/build_epics/worker',
    'packages/core/src/pipeline_modules/build_epics/core',
    'packages/core/src/pipeline_modules/build_epics/sync',
  ]) {
    for (const absPath of sourceFiles(sourceDir)) {
      const source = readFileSync(absPath, 'utf8')
      const relPath = relative(root, absPath).split(sep).join('/')
      assert.equal(source.includes('legacy_generation/build_epics'), false, `${relPath} must not import legacy build_epics`)
      assert.equal(source.includes('build_business_docs_cli'), false, `${relPath} must not import Phase 8 business docs runtime yet`)
      assert.equal(source.includes('sync_v2'), false, `${relPath} must use sync naming, not sync_v2`)
    }
  }

  const cliEpicsSource = readFileSync(join(root, 'packages/cli/src/commands/epics.ts'), 'utf8')
  assert.equal(cliEpicsSource.includes('@platty/core'), true, 'CLI epics command must use @platty/core public API')
  assert.equal(cliEpicsSource.includes('@/'), false, 'CLI epics command must not import core internals via @/')
  assert.equal(cliEpicsSource.includes('localDbPath'), false, 'CLI epics command must not use project-local DB config')
  assert.equal(cliEpicsSource.includes('openLocalPlattyDb'), false, 'CLI epics command must use global CLI DB opener')
}

function assertCorePhaseEightBusinessDocs() {
  for (const path of [
    'packages/core/src/pipeline_modules/build_business_docs_cli/index.ts',
    'packages/core/src/pipeline_modules/build_business_docs_cli/lease.ts',
    'packages/core/src/pipeline_modules/build_business_docs_cli/lifecycle.ts',
    'packages/core/src/pipeline_modules/build_business_docs_cli/preview.ts',
    'packages/core/src/pipeline_modules/build_business_docs_cli/quality.ts',
    'packages/core/src/pipeline_modules/build_business_docs_cli/review.ts',
    'packages/core/src/pipeline_modules/build_business_docs_cli/source_refs.ts',
    'packages/core/src/pipeline_modules/build_business_docs_cli/start.ts',
    'packages/core/src/pipeline_modules/build_business_docs_cli/submit.ts',
    'packages/core/src/pipeline_modules/build_business_docs_cli/types.ts',
    'packages/core/src/pipeline_modules/build_business_docs_cli/worker_runner.ts',
    'packages/core/src/pipeline_modules/build_business_docs_cli/sot/f2_load_epic_sources.ts',
    'packages/core/src/pipeline_modules/build_business_docs_cli/sot/persist_graph.ts',
    'packages/core/src/pipeline_modules/build_business_docs/sync/index.ts',
    'packages/core/src/pipeline_modules/build_business_docs/sync/preview.ts',
    'packages/core/src/pipeline_modules/build_business_docs/sync/source_hashes.ts',
    'packages/core/src/pipeline_modules/build_business_docs/sync/start.ts',
    'packages/core/src/pipeline_modules/build_business_docs_sync/index.ts',
    'packages/core/src/pipeline_modules/generation_runs/business_docs_adapter.ts',
    'packages/core/tests/pipeline_modules/build_business_docs_cli/lease.test.ts',
    'packages/core/tests/pipeline_modules/build_business_docs_cli/submit.test.ts',
    'packages/core/tests/pipeline_modules/build_business_docs_cli/fake_worker_e2e.test.ts',
    'packages/core/tests/pipeline_modules/build_business_docs/sync/start.test.ts',
    'packages/core/tests/pipeline_modules/generation_runs/business_docs_adapter.test.ts',
    'packages/cli/src/commands/business-docs.ts',
    'packages/cli/tests/business-docs-command.test.ts',
  ]) {
    assert.equal(existsSync(join(root, path)), true, `Phase 8 business-docs runtime must include ${path}`)
  }

  const coreEntrypointSource = readFileSync(join(root, 'packages/core/src/index.ts'), 'utf8')
  for (const token of [
    'pipeline_modules/build_business_docs_cli/index',
    'pipeline_modules/build_business_docs/sync/index',
  ]) {
    assert.equal(coreEntrypointSource.includes(token), true, `core must export Phase 8 business-docs surface: ${token}`)
  }

  const legacySyncShim = readFileSync(join(root, 'packages/core/src/pipeline_modules/build_business_docs_sync/index.ts'), 'utf8').trim()
  assert.equal(
    legacySyncShim,
    "export * from '@/pipeline_modules/build_business_docs/sync/index.js'",
    'legacy build_business_docs_sync entrypoint must be a temporary shim only',
  )

  const generationRunIndexSource = readFileSync(join(root, 'packages/core/src/pipeline_modules/generation_runs/index.ts'), 'utf8')
  assert.equal(generationRunIndexSource.includes('business_docs_adapter'), true, 'generation run resolver must import Phase 8 business docs adapter')
  assert.equal(generationRunIndexSource.includes('businessDocGenerationRuns'), true, 'generation run resolver must inspect business-doc generation table')
  assert.equal(generationRunIndexSource.includes("kind: 'build_business_docs'"), true, 'generation run resolver must dispatch build_business_docs runs')

  for (const sourceDir of [
    'packages/core/src/pipeline_modules/build_business_docs_cli',
    'packages/core/src/pipeline_modules/build_business_docs/sync',
    'packages/core/src/pipeline_modules/generation_runs',
  ]) {
    for (const absPath of sourceFiles(sourceDir)) {
      const source = readFileSync(absPath, 'utf8')
      const relPath = relative(root, absPath).split(sep).join('/')
      assert.equal(source.includes('sync_v2'), false, `${relPath} must use sync naming, not sync_v2`)
      assert.equal(source.includes('@/pipeline_modules/legacy_generation/'), false, `${relPath} must not import legacy generation modules`)
      assert.equal(source.includes('@/pipeline_modules/build_business_docs/index.js'), false, `${relPath} must not import legacy build_business_docs monolith`)
    }
  }

  const cliBusinessDocsSource = readFileSync(join(root, 'packages/cli/src/commands/business-docs.ts'), 'utf8')
  assert.equal(cliBusinessDocsSource.includes('@platty/core'), true, 'CLI business-docs command must use @platty/core public API')
  assert.equal(cliBusinessDocsSource.includes('@/'), false, 'CLI business-docs command must not import core internals via @/')
  assert.equal(cliBusinessDocsSource.includes('localDbPath'), false, 'CLI business-docs command must not use project-local DB config')
  assert.equal(cliBusinessDocsSource.includes('openLocalPlattyDb'), false, 'CLI business-docs command must use global CLI DB opener')
}

function assertCorePhaseNineCodexWorkerExecution() {
  for (const path of [
    'packages/core/src/pipeline_modules/cli_agent_runner/codex_cli.ts',
    'packages/core/tests/pipeline_modules/cli_agent_runner/codex_cli.test.ts',
    'packages/core/tests/pipeline_modules/build_docs/worker/worker_runner.test.ts',
    'packages/core/tests/pipeline_modules/build_epics/worker/worker_runner.test.ts',
    'packages/core/tests/pipeline_modules/build_business_docs_cli/fake_worker_e2e.test.ts',
  ]) {
    assert.equal(existsSync(join(root, path)), true, `Phase 9 Codex worker execution must include ${path}`)
  }

  const codexCliSource = readFileSync(join(root, 'packages/core/src/pipeline_modules/cli_agent_runner/codex_cli.ts'), 'utf8')
  for (const token of [
    'normalizeCodexOutputSchema',
    '--output-schema',
    'resultPath',
    'logPath',
    'model_reasoning_effort',
    '--skip-git-repo-check',
    '--ephemeral',
  ]) {
    assert.equal(codexCliSource.includes(token), true, `Codex CLI wrapper must preserve ${token}`)
  }

  for (const sourceDir of [
    'packages/core/src/pipeline_modules/build_docs/worker',
    'packages/core/src/pipeline_modules/build_epics/worker',
    'packages/core/src/pipeline_modules/build_business_docs_cli',
  ]) {
    for (const absPath of sourceFiles(sourceDir)) {
      const source = readFileSync(absPath, 'utf8')
      const relPath = relative(root, absPath).split(sep).join('/')
      if (!relPath.endsWith('worker_runner.ts')) continue
      assert.equal(source.includes('invokeCodexCliJson'), true, `${relPath} must call the shared Codex CLI wrapper`)
      assert.equal(source.includes('taskInvoker'), true, `${relPath} must keep fake/injected task invoker test seam`)
    }
  }
}

function assertCorePhaseTenFixtureCorpusBase() {
  for (const path of [
    'packages/core/src/fixture_corpus/index.ts',
    'packages/core/src/fixture_corpus/registry.ts',
    'packages/core/src/fixture_corpus/load.ts',
    'packages/core/src/fixture_corpus/execution.ts',
    'packages/core/src/fixture_corpus/run_log.ts',
    'packages/core/src/fixture_corpus/runners/static_stages.ts',
    'packages/core/tests/fixture_corpus/load.test.ts',
    'packages/core/tests/fixture_corpus/execution_smoke.test.ts',
    'packages/core/tests/fixture_corpus/run_log.test.ts',
    'packages/core/tests/fixture_corpus/runners/static_stages.test.ts',
    'packages/cli/src/commands/corpus.ts',
    'packages/cli/tests/fixture_corpus/cli/corpus-command.test.ts',
  ]) {
    assert.equal(existsSync(join(root, path)), true, `Phase 10 fixture corpus base must include ${path}`)
  }

  const staticStagesSource = readFileSync(join(root, 'packages/core/src/fixture_corpus/runners/static_stages.ts'), 'utf8')
  assert.equal(
    staticStagesSource.includes('build_pattern_profile'),
    true,
    'fixture corpus static stages must include build_pattern_profile',
  )
  assert.equal(
    staticStagesSource.indexOf('build_graph') < staticStagesSource.indexOf('build_pattern_profile')
      && staticStagesSource.indexOf('build_pattern_profile') < staticStagesSource.indexOf('build_models'),
    true,
    'fixture corpus static stages must run build_pattern_profile between build_graph and build_models',
  )

  const coreEntrypointSource = readFileSync(join(root, 'packages/core/src/index.ts'), 'utf8')
  assert.equal(
    coreEntrypointSource.includes("fixture_corpus/index"),
    true,
    'core must export fixture corpus helpers for CLI use',
  )

  const cliCorpusSource = readFileSync(join(root, 'packages/cli/src/commands/corpus.ts'), 'utf8')
  assert.equal(cliCorpusSource.includes('@platty/core'), true, 'CLI corpus command must use @platty/core public API')
  assert.equal(cliCorpusSource.includes('@/'), false, 'CLI corpus command must not import core internals via @/')
  assert.equal(cliCorpusSource.includes('openLocalPlattyDb'), false, 'CLI corpus command must not use project-local DB config')
  assert.equal(cliCorpusSource.includes('sdd_v2.db'), false, 'CLI corpus command must not reference legacy DB paths')

  for (const forbiddenPath of [
    'packages/cli/src/commands/self-improve-once.ts',
  ]) {
    assert.equal(existsSync(join(root, forbiddenPath)), false, `Phase 10 must keep self-improve for Phase 11: ${forbiddenPath}`)
  }

  const fixtureFiles = sourceFiles('packages/core/src/fixture_corpus')
  for (const absPath of fixtureFiles) {
    const source = readFileSync(absPath, 'utf8')
    const relPath = relative(root, absPath).split(sep).join('/')
    assert.equal(source.includes('schema-diversity/prisma/relations-basic'), false, `${relPath} must not hard-code source real-project corpus ids`)
    assert.equal(source.includes('service/multi-repo/heroines-poc'), false, `${relPath} must not import source service fixture corpus ids`)
  }
}

function assertCorePhaseElevenFixtureSelfImprove() {
  for (const path of [
    'packages/core/src/fixture_corpus/self_improve/index.ts',
    'packages/core/src/fixture_corpus/self_improve/types.ts',
    'packages/core/src/fixture_corpus/self_improve/decision.ts',
    'packages/core/src/fixture_corpus/self_improve/oracle.ts',
    'packages/core/src/fixture_corpus/self_improve/reports.ts',
    'packages/core/src/fixture_corpus/self_improve/stage_order.ts',
    'packages/core/src/fixture_corpus/self_improve/codex_oracle_provider.ts',
    'packages/core/src/fixture_corpus/self_improve/run_once.ts',
    'packages/core/src/fixture_corpus/self_improve/prompts/fixture-self-improve-goal.md',
    'packages/core/tests/fixture_corpus/self_improve/decision.test.ts',
    'packages/core/tests/fixture_corpus/self_improve/oracle.test.ts',
    'packages/core/tests/fixture_corpus/self_improve/reports.test.ts',
    'packages/core/tests/fixture_corpus/self_improve/stage_order.test.ts',
    'packages/core/tests/fixture_corpus/self_improve/codex_oracle_provider.test.ts',
    'packages/core/tests/fixture_corpus/self_improve/run_once.test.ts',
    'packages/cli/tests/fixture_corpus/cli/self-improve-command.test.ts',
  ]) {
    assert.equal(existsSync(join(root, path)), true, `Phase 11 fixture self-improve must include ${path}`)
  }

  const stageOrderSource = readFileSync(join(root, 'packages/core/src/fixture_corpus/self_improve/stage_order.ts'), 'utf8')
  assert.equal(stageOrderSource.includes('build_pattern_profile'), true, 'self-improve stage order must include build_pattern_profile')
  assert.equal(stageOrderSource.indexOf('build_graph') < stageOrderSource.indexOf('build_pattern_profile'), true, 'self-improve stage order must run build_pattern_profile after build_graph')

  const codexOracleSource = readFileSync(join(root, 'packages/core/src/fixture_corpus/self_improve/codex_oracle_provider.ts'), 'utf8')
  assert.equal(codexOracleSource.includes('Do not copy actual pipeline output'), true, 'Codex oracle prompt must prohibit copying actual output')
  assert.equal(codexOracleSource.includes('getLlmAdapter'), true, 'Codex oracle must keep real LLM behind adapter injection/registry')

  const cliCorpusSource = readFileSync(join(root, 'packages/cli/src/commands/corpus.ts'), 'utf8')
  assert.equal(cliCorpusSource.includes('self-improve-once'), true, 'CLI corpus command must expose self-improve-once')
  assert.equal(cliCorpusSource.includes('--dry-run'), true, 'CLI self-improve command must support dry-run mode')
  assert.equal(cliCorpusSource.includes('@platty/core'), true, 'CLI self-improve command must use @platty/core public API')
  assert.equal(cliCorpusSource.includes('@/'), false, 'CLI self-improve command must not import core internals via @/')

  for (const absPath of sourceFiles('packages/core/src/fixture_corpus/self_improve')) {
    const source = readFileSync(absPath, 'utf8')
    const relPath = relative(root, absPath).split(sep).join('/')
    assert.equal(source.includes('schema-diversity/prisma/relations-basic'), false, `${relPath} must not hard-code source real-project corpus ids`)
    assert.equal(source.includes('service/multi-repo/heroines-poc'), false, `${relPath} must not hard-code source service PoC ids`)
  }
}

assertRootManifest()
assertTsconfigReferences()
assertEntrypointsExist()
assertCorePhaseOneInfrastructure()
assertCorePhaseTwoStaticPipeline()
assertCliPhaseThreeFoundation()
assertCorePhaseFourSync()
assertCorePhaseFiveSharedSegments()
assertCorePhaseSixGenerationRuns()
assertCorePhaseSevenBuildEpics()
assertCorePhaseEightBusinessDocs()
assertCorePhaseNineCodexWorkerExecution()
assertCorePhaseTenFixtureCorpusBase()
assertCorePhaseElevenFixtureSelfImprove()

for (const workspace of workspaces) {
  assertWorkspaceManifest(workspace)
  assertNoForbiddenImports(workspace)
}

console.log('Architecture check passed')
