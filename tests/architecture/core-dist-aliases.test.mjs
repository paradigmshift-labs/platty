import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { copyCoreWasmAssets, rewriteCoreDistAliases, rewriteCoreDistAliasFiles } from '../../scripts/resolve-core-dist-aliases.mjs'

const execFileAsync = promisify(execFile)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const runtimeUnsafeAliasPattern = /(?:from\s*['"]|import\s*\(\s*['"])@\//

async function listDistRuntimeFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listDistRuntimeFiles(path))
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.d.ts'))) {
      files.push(path)
    }
  }
  return files
}

async function runNpm(args) {
  if (process.env.npm_execpath) {
    return execFileAsync(process.execPath, [process.env.npm_execpath, ...args], { cwd: repoRoot })
  }
  return execFileAsync('npm', args, { cwd: repoRoot })
}

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

  it('keeps core dist runtime-safe after CLI build re-emits referenced projects', async () => {
    const coreDistRoot = join(repoRoot, 'packages/core/dist')
    await rm(join(coreDistRoot, 'tsconfig.tsbuildinfo'), { force: true })

    await runNpm(['--workspace', '@pshift/platty', 'run', 'build'])

    const unsafeFiles = []
    for (const file of await listDistRuntimeFiles(coreDistRoot)) {
      const source = await readFile(file, 'utf8')
      if (runtimeUnsafeAliasPattern.test(source)) unsafeFiles.push(file)
    }

    assert.deepEqual(unsafeFiles, [])
    await import(pathToFileURL(join(coreDistRoot, 'index.js')).href)
  })
})
