import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codeNodes } from '@/db/schema/code_graph.js'
import { projects, repositories } from '@/db/schema/core.js'
import { runBuildRoute } from '@/pipeline_modules/build_route/index.js'
import { createTestDb } from '../../server/helpers.js'

describe('build_route sourceRoot', () => {
  it('reads source fallback files from the repository analysisRoot', async () => {
    const db = createTestDb()
    db.insert(projects).values({ id: 'p1', name: 'P' }).run()
    const root = mkdtempSync(join(tmpdir(), 'platty-route-mono-'))
    const routeFile = 'app/api/health/route.ts'
    mkdirSync(join(root, 'apps/web/app/api/health'), { recursive: true })
    writeFileSync(join(root, 'apps/web', routeFile), 'export function GET() { return Response.json({ ok: true }) }\n')

    db.insert(repositories).values({
      id: 'r1',
      projectId: 'p1',
      name: 'web',
      repoPath: root,
      sourceRoot: 'apps/web',
      framework: 'nextjs',
      routingFiles: [routeFile],
      routingLibs: [],
    }).run()
    db.insert(codeNodes).values({
      id: `r1:${routeFile}`,
      repoId: 'r1',
      type: 'file',
      filePath: routeFile,
      name: 'route.ts',
      parseStatus: 'ok',
    }).run()

    const result = await runBuildRoute({ db, repoId: 'r1' })

    expect(result.entryPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        httpMethod: 'GET',
        fullPath: '/api/health',
        metadata: expect.objectContaining({ sourceFallback: 'next_app_route_named_export' }),
      }),
    ]))
  })
})
