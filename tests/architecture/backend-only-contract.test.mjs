import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'))
}

describe('backend-only anonymous auth analytics contract', () => {
  it('declares apps/backend as a Nest Prisma workspace', () => {
    const manifest = readJson('apps/backend/package.json')
    assert.equal(manifest.name, '@platty/backend')
    assert.equal(manifest.private, true)
    assert.equal(manifest.type, 'commonjs')
    assert.equal(manifest.scripts.build, 'nest build')
    assert.equal(manifest.scripts.test, 'jest')
    assert.equal(manifest.dependencies['@nestjs/common'], '^11.0.0')
    assert.equal(manifest.dependencies['@prisma/client'], '^6.19.0')
  })

  it('does not introduce SDK or contracts workspaces in this phase', () => {
    assert.equal(existsSync(join(root, 'packages/contracts/package.json')), false)
    const sdkManifest = readJson('packages/sdk/package.json')
    assert.equal(sdkManifest.dependencies?.['@platty/contracts'], undefined)
  })

  it('documents the backend-only auth analytics architecture', () => {
    const readmePath = join(root, 'apps/backend/README.md')
    assert.equal(existsSync(readmePath), true)

    const readme = readFileSync(readmePath, 'utf8')
    assert.match(readme, /anonymous auth/i)
    assert.match(readme, /AnalyticsModule/)
    assert.match(readme, /UsersModule/)
    assert.match(readme, /mermaid/)
    assert.match(readme, /Future Scope/)
    assert.doesNotMatch(readme, /model Workspace/)
    assert.doesNotMatch(readme, /model License/)
  })
})
