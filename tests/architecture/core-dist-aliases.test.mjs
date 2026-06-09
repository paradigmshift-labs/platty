import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { copyCoreWasmAssets, rewriteCoreDistAliases, rewriteCoreDistAliasFiles } from '../../scripts/resolve-core-dist-aliases.mjs'

describe('core dist alias resolver', () => {
  it('rewrites @/ specifiers to runtime-safe relative imports', () => {
    const filePath = '/repo/packages/core/dist/pipeline_infra/index.js'
    const distRoot = '/repo/packages/core/dist'
    const source = [
      "import { PipelineRun } from '@/observability/logger.js'",
      "export { x } from '@/pipeline_modules/shared/phase_status.js'",
      "const lazy = import('@/db/schema/core.js')",
    ].join('\n')

    assert.equal(
      rewriteCoreDistAliases(source, filePath, distRoot),
      [
        "import { PipelineRun } from '../observability/logger.js'",
        "export { x } from '../pipeline_modules/shared/phase_status.js'",
        "const lazy = import('../db/schema/core.js')",
      ].join('\n'),
    )
  })

  it('rewrites emitted js and d.ts files in place', async () => {
    const root = await mkdtemp(join(tmpdir(), 'platty-core-dist-'))
    try {
      await writeFile(join(root, 'index.js'), "export * from '@/db/index.js'\n", 'utf8')
      await writeFile(join(root, 'index.d.ts'), "export type { DB } from '@/db/client.js'\n", 'utf8')

      const result = await rewriteCoreDistAliasFiles(root)

      assert.equal(result.changed, 2)
      assert.equal(await readFile(join(root, 'index.js'), 'utf8'), "export * from './db/index.js'\n")
      assert.equal(await readFile(join(root, 'index.d.ts'), 'utf8'), "export type { DB } from './db/client.js'\n")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('copies parser WASM assets next to emitted adapters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'platty-core-assets-'))
    const sourceRoot = join(root, 'src')
    const distRoot = join(root, 'dist')
    try {
      await mkdir(join(sourceRoot, 'pipeline_modules/build_graph/adapters/wasm'), { recursive: true })
      await mkdir(distRoot, { recursive: true })
      await writeFile(
        join(sourceRoot, 'pipeline_modules/build_graph/adapters/wasm/tree-sitter-typescript.wasm'),
        'wasm',
        'utf8',
      )

      const result = await copyCoreWasmAssets(distRoot, sourceRoot)

      assert.equal(result.copied, 1)
      assert.equal(
        await readFile(join(distRoot, 'pipeline_modules/build_graph/adapters/wasm/tree-sitter-typescript.wasm'), 'utf8'),
        'wasm',
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
