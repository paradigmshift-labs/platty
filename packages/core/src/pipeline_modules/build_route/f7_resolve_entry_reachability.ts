import type { GraphIndex } from './graph_index.js'
import { resolveReachability } from './f5_resolve_reachability.js'
import type { BundleEntry, EntryPointDraft, ReachabilityCaps } from './types.js'
import { makeEntryPointId } from '@/pipeline_modules/shared/id_builders.js'

export interface ResolveEntryPointReachabilityInput {
  repoId: string
  entryPoints: EntryPointDraft[]
  graph: GraphIndex
  caps?: ReachabilityCaps
  onProgress?: (progress: { completed: number; total: number; currentEntry: string }) => void
}

export function resolveEntryPointReachability(
  input: ResolveEntryPointReachabilityInput,
): BundleEntry[] {
  const out: BundleEntry[] = []
  const total = input.entryPoints.length
  let completed = 0
  for (const ep of input.entryPoints) {
    const id = makeEntryPointId(input.repoId, ep)
    const r = resolveReachability({
      entryPointId: id,
      startNodeId: ep.handlerNodeId,
      seedNodeIds: ep.detectionEvidence.matchedNodeIds,
      graph: input.graph,
      caps: input.caps,
    })
    for (const b of r.bundle) out.push(b)
    completed++
    if (completed === 1 || completed === total || completed % getProgressInterval(total) === 0) {
      input.onProgress?.({
        completed,
        total,
        currentEntry: ep.fullPath ?? ep.path ?? ep.handlerNodeId,
      })
    }
  }
  return out
}

function getProgressInterval(total: number): number {
  if (total <= 50) return 5
  if (total <= 500) return 25
  return 100
}
