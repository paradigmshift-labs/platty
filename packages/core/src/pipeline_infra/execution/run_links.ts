import { and, asc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { DB } from '@/db/client.js'
import { repositories } from '@/db/schema/core.js'
import { pipelineRuns } from '@/db/schema/pipeline_runs.js'
import {
  pipelineRunLinks,
  type PipelineRunLink,
  type PipelineRunLinkRelation,
} from '@/db/schema/project_analysis_v2.js'

export type { PipelineRunLink, PipelineRunLinkRelation }

export type PipelineRunLinkErrorCode = 'PARENT_RUN_NOT_FOUND' | 'CHILD_RUN_NOT_FOUND' | 'REPOSITORY_NOT_FOUND'

export class PipelineRunLinkError extends Error {
  constructor(
    readonly code: PipelineRunLinkErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`)
    this.name = 'PipelineRunLinkError'
  }
}

export interface LinkPipelineRunInput {
  parentRunId: string
  childRunId: string
  relation: PipelineRunLinkRelation
  phase?: string | null
  repoId?: string | null
}

export function linkPipelineRun(db: DB, input: LinkPipelineRunInput): PipelineRunLink {
  validateRunLink(db, input)

  const existing = db
    .select()
    .from(pipelineRunLinks)
    .where(and(
      eq(pipelineRunLinks.parentRunId, input.parentRunId),
      eq(pipelineRunLinks.childRunId, input.childRunId),
      eq(pipelineRunLinks.relation, input.relation),
    ))
    .get()

  if (existing) {
    return existing
  }

  const id = nanoid()
  db.insert(pipelineRunLinks)
    .values({
      id,
      parentRunId: input.parentRunId,
      childRunId: input.childRunId,
      relation: input.relation,
      phase: input.phase ?? null,
      repoId: input.repoId ?? null,
    })
    .run()

  return mustGetRunLink(db, id)
}

export function listChildRunLinks(db: DB, parentRunId: string): PipelineRunLink[] {
  return db
    .select()
    .from(pipelineRunLinks)
    .where(eq(pipelineRunLinks.parentRunId, parentRunId))
    .orderBy(asc(pipelineRunLinks.createdAt), asc(pipelineRunLinks.id))
    .all()
}

export function listParentRunLinks(db: DB, childRunId: string): PipelineRunLink[] {
  return db
    .select()
    .from(pipelineRunLinks)
    .where(eq(pipelineRunLinks.childRunId, childRunId))
    .orderBy(asc(pipelineRunLinks.createdAt), asc(pipelineRunLinks.id))
    .all()
}

function validateRunLink(db: DB, input: LinkPipelineRunInput): void {
  const parent = db.select({ id: pipelineRuns.id }).from(pipelineRuns).where(eq(pipelineRuns.id, input.parentRunId)).get()
  if (!parent) {
    throw new PipelineRunLinkError('PARENT_RUN_NOT_FOUND', `Parent run ${input.parentRunId} was not found`)
  }

  const child = db.select({ id: pipelineRuns.id }).from(pipelineRuns).where(eq(pipelineRuns.id, input.childRunId)).get()
  if (!child) {
    throw new PipelineRunLinkError('CHILD_RUN_NOT_FOUND', `Child run ${input.childRunId} was not found`)
  }

  if (input.repoId) {
    const repo = db.select({ id: repositories.id }).from(repositories).where(eq(repositories.id, input.repoId)).get()
    if (!repo) {
      throw new PipelineRunLinkError('REPOSITORY_NOT_FOUND', `Repository ${input.repoId} was not found`)
    }
  }
}

function mustGetRunLink(db: DB, id: string): PipelineRunLink {
  const row = db.select().from(pipelineRunLinks).where(eq(pipelineRunLinks.id, id)).get()
  if (!row) {
    throw new Error(`Pipeline run link ${id} was not persisted`)
  }
  return row
}
