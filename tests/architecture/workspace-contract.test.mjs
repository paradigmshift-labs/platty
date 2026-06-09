import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'))
}

function assertWorkspaceDeps(manifestPath, requiredDeps, forbiddenDeps = []) {
  const manifest = readJson(manifestPath)
  const dependencies = manifest.dependencies ?? {}
  for (const [name, version] of Object.entries(requiredDeps)) {
    assert.equal(dependencies[name], version, `${manifestPath} should depend on ${name}@${version}`)
  }
  const dependencySections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
  for (const section of dependencySections) {
    const sectionDeps = manifest[section] ?? {}
    for (const name of forbiddenDeps) {
      assert.equal(sectionDeps[name], undefined, `${manifestPath} should not list ${name} in ${section}`)
    }
  }
}

describe('Platty monorepo workspace contract', () => {
  it('declares root npm workspaces for packages and apps', () => {
    const rootPackage = readJson('package.json')
    const scripts = rootPackage.scripts ?? {}

    assert.equal(rootPackage.name, 'platty-monorepo')
    assert.equal(rootPackage.private, true)
    assert.equal(rootPackage.type, 'module')
    assert.deepEqual(rootPackage.workspaces, ['packages/*', 'apps/*'])
    assert.deepEqual(rootPackage.engines, { node: '>=20' })
    assert.equal(scripts.build, 'node "$npm_execpath" run build --workspaces --if-present')
    assert.equal(scripts.test, 'node --test tests/**/*.test.mjs && node "$npm_execpath" run check:architecture')
    assert.equal(scripts['check:architecture'], 'node scripts/check-architecture.mjs')
    assert.equal(scripts.typecheck, 'tsc -b')
  })

  it('declares TypeScript project references for every workspace', () => {
    assert.equal(existsSync(join(root, 'tsconfig.base.json')), true, 'tsconfig.base.json should exist')
    assert.deepEqual(readJson('tsconfig.json'), {
      files: [],
      references: [
        { path: './packages/core' },
        { path: './packages/sdk' },
        { path: './packages/cli' },
        { path: './apps/backend' },
        { path: './apps/web' },
        { path: './apps/desktop' },
      ],
    })

    const workspaceTsconfigs = [
      'packages/core/tsconfig.json',
      'packages/sdk/tsconfig.json',
      'packages/cli/tsconfig.json',
      'apps/backend/tsconfig.json',
      'apps/web/tsconfig.json',
      'apps/desktop/tsconfig.json',
    ]
    for (const tsconfigPath of workspaceTsconfigs) {
      assert.equal(existsSync(join(root, tsconfigPath)), true, `${tsconfigPath} should exist`)
    }

    assert.deepEqual(readJson('packages/core/tsconfig.json').references ?? [], [])
    assert.deepEqual(readJson('packages/sdk/tsconfig.json').references ?? [], [])
    assert.deepEqual(readJson('packages/cli/tsconfig.json').references, [
      { path: '../core' },
      { path: '../sdk' },
    ])
    assert.deepEqual(readJson('apps/backend/tsconfig.json').references, [
      { path: '../../packages/core' },
    ])
    assert.deepEqual(readJson('apps/web/tsconfig.json').references, [
      { path: '../../packages/sdk' },
    ])
    assert.deepEqual(readJson('apps/desktop/tsconfig.json').references, [
      { path: '../../packages/sdk' },
    ])
  })

  it('defines the expected workspace package manifests', () => {
    const expected = [
      ['packages/core/package.json', '@platty/core', true],
      ['packages/sdk/package.json', '@platty/sdk', true],
      ['packages/cli/package.json', '@pshift/platty', false],
      ['apps/backend/package.json', '@platty/backend', true],
      ['apps/web/package.json', '@platty/web', true],
      ['apps/desktop/package.json', '@platty/desktop', true],
    ]

    for (const [manifestPath, expectedName, expectedPrivate] of expected) {
      assert.equal(existsSync(join(root, manifestPath)), true, `${manifestPath} should exist`)
      const manifest = readJson(manifestPath)
      assert.equal(manifest.name, expectedName)
      assert.equal(manifest.private, expectedPrivate)
      assert.equal(manifest.type, 'module')
      const expectedBuildScript = manifestPath === 'packages/core/package.json'
        ? 'tsc -b && node ../../scripts/resolve-core-dist-aliases.mjs dist'
        : 'tsc -b'
      assert.equal(manifest.scripts.build, expectedBuildScript)
      const expectedTestScript = manifestPath === 'packages/core/package.json' || manifestPath === 'packages/cli/package.json'
        ? 'vitest run'
        : 'node --test'
      assert.equal(manifest.scripts.test, expectedTestScript)
    }
  })

  it('keeps the CLI as the only publishable npm package', () => {
    const cliPackage = readJson('packages/cli/package.json')

    assert.equal(cliPackage.private, false)
    assert.deepEqual(cliPackage.bin, { platty: 'dist/main.js' })
    assert.deepEqual(cliPackage.files, ['dist', 'package.json', 'README.md'])
    assert.deepEqual(cliPackage.publishConfig, { access: 'public' })
  })

  it('keeps workspace dependency directions explicit', () => {
    assertWorkspaceDeps('packages/core/package.json', {
      'better-sqlite3': '11.10.0',
      'drizzle-orm': '0.45.2',
      nanoid: '5.1.11',
      zod: '4.3.6',
    }, [
      '@platty/sdk',
      '@pshift/platty',
      '@platty/backend',
      '@platty/web',
      '@platty/desktop',
    ])
    assertWorkspaceDeps('packages/sdk/package.json', {}, [
      '@platty/core',
      '@pshift/platty',
      '@platty/backend',
      '@platty/web',
      '@platty/desktop',
    ])
    assertWorkspaceDeps('packages/cli/package.json', {
      '@platty/core': '0.1.0',
      commander: '14.0.3',
    }, ['@platty/sdk', '@platty/backend', '@platty/web', '@platty/desktop'])
    assertWorkspaceDeps('apps/backend/package.json', {
      '@platty/core': '0.1.0',
    }, ['@platty/sdk', '@pshift/platty', '@platty/web', '@platty/desktop'])
    assertWorkspaceDeps('apps/web/package.json', {
      '@platty/sdk': '0.1.0',
    }, ['@platty/core', '@pshift/platty', '@platty/backend', '@platty/desktop'])
    assertWorkspaceDeps('apps/desktop/package.json', {
      '@platty/sdk': '0.1.0',
    }, ['@platty/core', '@pshift/platty', '@platty/backend', '@platty/web'])
  })

  // Internal workspace dependencies intentionally use exact 0.1.0 versions for npm
  // compatibility. npm 10.8.2 fails with EUNSUPPORTEDPROTOCOL for workspace protocol specifiers here.

  it('has TypeScript source entrypoints for every workspace', () => {
    const entrypoints = [
      'packages/core/src/index.ts',
      'packages/sdk/src/index.ts',
      'packages/cli/src/main.ts',
      'apps/backend/src/main.ts',
      'apps/web/src/index.ts',
      'apps/desktop/src/index.ts',
    ]

    for (const entrypoint of entrypoints) {
      assert.equal(existsSync(join(root, entrypoint)), true, `${entrypoint} should exist`)
    }
  })

  it('exposes package-local core DB infrastructure', () => {
    const requiredCoreFiles = [
      'packages/core/src/db/client.ts',
      'packages/core/src/db/index.ts',
      'packages/core/src/db/migrate.ts',
      'packages/core/src/db/paths.ts',
      'packages/core/src/db/testing.ts',
      'packages/core/src/db/schema/index.ts',
      'packages/core/src/db/migrations/meta/_journal.json',
      'packages/core/src/pipeline_infra/index.ts',
    ]

    for (const path of requiredCoreFiles) {
      assert.equal(existsSync(join(root, path)), true, `${path} should exist`)
    }

    const dbPathsSource = readFileSync(join(root, 'packages/core/src/db/paths.ts'), 'utf8')
    assert.equal(dbPathsSource.includes('sdd_v2.db'), false, 'core must not default to the legacy sdd_v2.db')
    assert.equal(dbPathsSource.includes("process.cwd(), 'data"), false, 'core DB path must not default under cwd data/')
    assert.equal(dbPathsSource.includes('PLATTY_HOME'), true, 'core should support a global Platty home')
    assert.equal(dbPathsSource.includes("'.platty'"), true, 'core should default to the user-global .platty directory')
    assert.equal(dbPathsSource.includes("'platty.db'"), true, 'core should create/use the global platty.db')

    const dbClientSource = readFileSync(join(root, 'packages/core/src/db/client.ts'), 'utf8')
    assert.equal(dbClientSource.includes('export const db ='), false, 'core must not open a DB singleton at import time')
    assert.equal(dbClientSource.includes('openPlattyDb'), true, 'core should expose an explicit DB open helper')

    const coreEntrypointSource = readFileSync(join(root, 'packages/core/src/index.ts'), 'utf8')
    assert.equal(coreEntrypointSource.includes('createTestPlattyDb'), true, 'core should export a test DB helper')
    assert.equal(coreEntrypointSource.includes('createPipelineRuntime'), true, 'core should export the Phase 1 pipeline runtime base')
  })
})
