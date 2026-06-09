import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = process.cwd()

function listTypeScriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      return listTypeScriptFiles(fullPath)
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [fullPath] : []
  })
}

describe('build_epics CLI runtime boundary', () => {
  it('uses grouped workflow modules without importing legacy epic generation', () => {
    const files = [
      ...listTypeScriptFiles(join(repoRoot, 'src/pipeline_modules/build_epics/core')),
      ...listTypeScriptFiles(join(repoRoot, 'src/pipeline_modules/build_epics/runtime')),
      ...listTypeScriptFiles(join(repoRoot, 'src/pipeline_modules/build_epics/source')),
      ...listTypeScriptFiles(join(repoRoot, 'src/pipeline_modules/build_epics/worker')),
      ...listTypeScriptFiles(join(repoRoot, 'src/pipeline_modules/build_epics/sync')),
      join(repoRoot, 'src/cli/commands/epics.ts'),
    ].filter((file) => existsSync(file))

    const forbiddenSubstrings = [
      'legacy_generation/build_epics',
      'run_build_epics',
    ]
    const forbiddenPatterns = [/\brunBuildEpics\(/]

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const token of forbiddenSubstrings) {
        expect(source, `${file} must not reference ${token}`).not.toContain(token)
      }
      for (const pattern of forbiddenPatterns) {
        expect(source, `${file} must not match ${pattern}`).not.toMatch(pattern)
      }
    }
  })
})
