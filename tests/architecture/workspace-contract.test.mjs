import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const root = process.cwd()

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'))
}

describe('Platty monorepo workspace contract', () => {
  it('declares root npm workspaces for packages and apps', () => {
    const rootPackage = readJson('package.json')

    assert.equal(rootPackage.name, 'platty-monorepo')
    assert.equal(rootPackage.private, true)
    assert.equal(rootPackage.type, 'module')
    assert.deepEqual(rootPackage.workspaces, ['packages/*', 'apps/*'])
    assert.deepEqual(rootPackage.engines, { node: '>=20' })
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
    assert.deepEqual(readJson('packages/core/package.json').dependencies ?? {}, {})
    assert.deepEqual(readJson('packages/sdk/package.json').dependencies ?? {}, {})
    assert.deepEqual(readJson('packages/cli/package.json').dependencies, {
      '@platty/core': '0.1.0',
      '@platty/sdk': '0.1.0',
    })
    assert.deepEqual(readJson('apps/backend/package.json').dependencies, {
      '@platty/core': '0.1.0',
    })
    assert.deepEqual(readJson('apps/web/package.json').dependencies, {
      '@platty/sdk': '0.1.0',
    })
    assert.deepEqual(readJson('apps/desktop/package.json').dependencies, {
      '@platty/sdk': '0.1.0',
    })
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
