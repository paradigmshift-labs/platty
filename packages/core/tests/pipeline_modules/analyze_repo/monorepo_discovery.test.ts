import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { discoverMonorepoUnits } from '@/pipeline_modules/analyze_repo/monorepo_discovery.js'

describe('discoverMonorepoUnits', () => {
  it('discovers high-confidence app units from package workspaces', () => {
    const root = mkdtempSync(join(tmpdir(), 'platty-mono-'))
    mkdirSync(join(root, 'apps/api/src'), { recursive: true })
    mkdirSync(join(root, 'apps/web/src'), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, workspaces: ['apps/*'] }))
    writeFileSync(join(root, 'apps/api/package.json'), JSON.stringify({ dependencies: { '@nestjs/core': '^10.0.0' } }))
    writeFileSync(join(root, 'apps/api/src/main.ts'), '')
    writeFileSync(join(root, 'apps/api/src/app.module.ts'), '')
    writeFileSync(join(root, 'apps/web/package.json'), JSON.stringify({ dependencies: { next: '^15.0.0', react: '^19.0.0' } }))
    writeFileSync(join(root, 'apps/web/next.config.js'), 'module.exports = {}\n')

    const units = discoverMonorepoUnits(root)

    expect(units).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceRoot: 'apps/api', role: 'backend', framework: 'nestjs', confidence: 'high', autoRegister: true }),
      expect.objectContaining({ sourceRoot: 'apps/web', role: 'frontend', framework: 'nextjs', confidence: 'high', autoRegister: true }),
    ]))
  })

  it('does not auto-register shared libraries without runtime entrypoints', () => {
    const root = mkdtempSync(join(tmpdir(), 'platty-mono-'))
    mkdirSync(join(root, 'packages/ui/src'), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, workspaces: ['packages/*'] }))
    writeFileSync(join(root, 'packages/ui/package.json'), JSON.stringify({ name: '@acme/ui', dependencies: { react: '^19.0.0' } }))

    const units = discoverMonorepoUnits(root)

    expect(units).toContainEqual(expect.objectContaining({
      sourceRoot: 'packages/ui',
      role: 'library',
      autoRegister: false,
    }))
  })
})
