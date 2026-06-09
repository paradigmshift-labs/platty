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
  const dependencies = readJson(manifestPath).dependencies ?? {}
  for (const [name, version] of Object.entries(requiredDeps)) {
    assert.equal(dependencies[name], version, `${manifestPath} should depend on ${name}@${version}`)
  }
  for (const name of forbiddenDeps) {
    assert.equal(dependencies[name], undefined, `${manifestPath} should not depend on ${name}`)
  }
}

describe('Platty monorepo workspace contract', () => {
  it('declares root npm workspaces for packages and apps', () => {
    const rootPackage = readJson('package.json')

    assert.equal(rootPackage.name, 'platty-monorepo')
    assert.equal(rootPackage.private, true)
    assert.equal(rootPackage.type, 'module')
    assert.deepEqual(rootPackage.workspaces, ['packages/*', 'apps/*'])
    assert.deepEqual(rootPackage.engines, { node: '>=20' })
    assert.deepEqual(rootPackage.scripts, {
      build: 'npm run build --workspaces --if-present',
      test: 'node --test tests && npm run check:architecture',
      'check:architecture': 'node scripts/check-architecture.mjs',
      typecheck: 'tsc -b',
    })
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
      assert.equal(manifest.scripts.build, 'tsc -b')
      assert.equal(manifest.scripts.test, 'node --test')
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
    assertWorkspaceDeps('packages/core/package.json', {}, [
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
      '@platty/sdk': '0.1.0',
    }, ['@platty/backend', '@platty/web', '@platty/desktop'])
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
})
