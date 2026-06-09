import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { projects, repositories } from '@/db/schema/core.js'
import { loadInputs } from '@/pipeline_modules/build_relations/load_inputs.js'
import { createTestDb } from '../../server/helpers.js'

describe('build_relations sourceRoot', () => {
  it('uses analysisRoot as the source fallback repoPath', async () => {
    const db = createTestDb()
    db.insert(projects).values({ id: 'p1', name: 'P' }).run()
    const root = mkdtempSync(join(tmpdir(), 'platty-rel-mono-'))
    db.insert(repositories).values({
      id: 'r1',
      projectId: 'p1',
      name: 'api',
      repoPath: root,
      sourceRoot: 'apps/api',
    }).run()

    const inputs = await loadInputs({ db, repoId: 'r1' })

    expect(inputs.repoPath).toBe(join(root, 'apps/api'))
  })
})
