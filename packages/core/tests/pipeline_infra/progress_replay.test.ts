import { describe, expect, it, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from '@/db/schema/index.js'
import { projects } from '@/db/schema/core.js'
import { PipelineExecution, replayPipelineProgressEvents } from '@/pipeline_infra/index.js'

type DB = ReturnType<typeof drizzle<typeof schema>>

function createTestDb(): DB {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './src/db/migrations' })
  return db
}

describe('pipeline progress replay', () => {
  let db: DB

  beforeEach(() => {
    db = createTestDb()
    db.insert(projects).values({ id: 'p1', name: 'Test Project' }).run()
  })

  it('replays only user-visible events in insertion order for web reconnect', async () => {
    const pipeline = new PipelineExecution({ db })
    const result = await pipeline.runStage(
      { projectId: 'p1', kind: 'build_docs', phase: null },
      async (ctx) => {
        ctx.emit('progress', 'visible 1')
        ctx.emitAdmin('log', 'hidden debug')
        ctx.emit('warning', 'visible 2')
        ctx.commitOutcome(ctx.markWaitingForUser({
          action: {
            kind: 'review_decisions',
            title: 'Review candidates',
            decisionRef: { kind: 'artifact', id: 'candidates' },
          },
          resumeToken: 'resume:1',
        }))
      },
    )

    const replay = replayPipelineProgressEvents(db, result.runId)

    expect(replay.map((event) => event.message)).toEqual([
      'visible 1',
      'visible 2',
      'Review candidates',
      '사용자 확인 대기 중',
    ])
    expect(replay.map((event) => event.kind)).toEqual([
      'progress',
      'warning',
      'requires_user_action',
      'milestone',
    ])
  })
})
