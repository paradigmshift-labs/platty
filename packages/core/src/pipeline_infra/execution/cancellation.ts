type ActivePipelineRun = {
  abort(reason?: string): void
}

const activeRuns = new Map<string, ActivePipelineRun>()

export function registerActivePipelineRun(runId: string, run: ActivePipelineRun): () => void {
  if (activeRuns.has(runId)) throw new Error(`Pipeline run is already active: ${runId}`)
  activeRuns.set(runId, run)
  return () => {
    if (activeRuns.get(runId) === run) activeRuns.delete(runId)
  }
}

export function cancelActivePipelineRun(runId: string, reason?: string): boolean {
  const run = activeRuns.get(runId)
  if (!run) return false
  run.abort(reason)
  return true
}

export function isPipelineRunActive(runId: string): boolean {
  return activeRuns.has(runId)
}
