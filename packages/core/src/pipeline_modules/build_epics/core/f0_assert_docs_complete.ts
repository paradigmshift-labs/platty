import { and, eq } from 'drizzle-orm'
import { documents } from '@/db/schema/build_docs.js'
import type { DB } from '@/db/client.js'
import { BuildEpicsError } from './types.js'

export interface AssertBuildDocsCompleteInput {
  db: DB
  projectId: string
  allowFailedDocs?: boolean
}

export async function assertBuildDocsComplete(input: AssertBuildDocsCompleteInput): Promise<void> {
  if (!input.projectId) throw new BuildEpicsError('INVALID_INPUT', 'projectId is required')
  const rows = input.db.select({ status: documents.status, validity: documents.validity }).from(documents).where(eq(documents.projectId, input.projectId)).all()
  const passed = rows.filter((row) => row.status === 'passed' && row.validity === 'fresh').length
  const failed = rows.filter((row) => row.status === 'failed').length
  if (passed < 1 || (!input.allowFailedDocs && failed > 0)) {
    throw new BuildEpicsError('DOCS_INCOMPLETE', 'build_docs output is incomplete', { passed, failed })
  }
}
