/**
 * build_relations — JVM/Spring schedule_trigger recognition (G3 schedule)
 * SOT: specs/build_relations/jvm_recognition.md §5
 *
 * Spring scheduling is annotation-driven: `@Scheduled(cron = "...")` / `@Scheduled(fixedRate = 5000)`.
 * The JVM adapter captures named args as literal_args {positional, named}; recognition keys off the
 * @Scheduled decorator gated by a Spring scheduling import.
 */

import { describe, it, expect } from 'vitest'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { extractCandidates } from '@/pipeline_modules/build_relations/candidates/index.js'
import { resolveCandidates } from '@/pipeline_modules/build_relations/resolvers/index.js'
import { normalizeRelations } from '@/pipeline_modules/build_relations/normalize_relations.js'
import type { BuildRelationsInputs, CodeEdgeLike, CodeNodeLike, SourceFallback } from '@/pipeline_modules/build_relations/types.js'

const REPO_ID = 'repo_jvm_sched'
const JAVA_FILE = 'src/main/java/x/Jobs.java'
const SCHEDULED_IMPORT = 'org.springframework.scheduling.annotation.Scheduled'

function makeNode(id: string, opts: Partial<CodeNodeLike> = {}): CodeNodeLike {
  return { id, repoId: REPO_ID, type: 'method', name: id, filePath: JAVA_FILE, lineStart: 1, lineEnd: 5, isTest: false, parseStatus: 'ok', ...opts }
}
let edgeId = 90_000
function makeEdge(sourceId: string, relation: string, opts: Partial<CodeEdgeLike> = {}): CodeEdgeLike {
  return {
    id: edgeId++, repoId: REPO_ID, sourceId, targetId: null, relation,
    targetSpecifier: null, targetSymbol: null, typeRefSubtype: null, chainPath: null,
    firstArg: null, literalArgs: null, argExpressions: null, resolveStatus: 'resolved', confidence: null, source: 'static',
    ...opts,
  }
}
function makeInputs(nodes: CodeNodeLike[], edges: CodeEdgeLike[]): BuildRelationsInputs {
  return { repoId: REPO_ID, repoPath: null, includeTestSources: false, nodes, edges, models: [] }
}
function runPipeline(inputs: BuildRelationsInputs, sf?: Partial<SourceFallback>) {
  const index = buildSemanticIndex(inputs)
  const candidates = extractCandidates(inputs, index)
  const relations = resolveCandidates(candidates, index, { resolveConstant: () => null, ...sf })
  return normalizeRelations(relations)
}

function scheduledJob(opts: { method: string; named: Record<string, string>; firstArg: string }): { nodes: CodeNodeLike[]; edges: CodeEdgeLike[] } {
  const m = makeNode(`r:${JAVA_FILE}:Jobs.${opts.method}`)
  const edges = [
    makeEdge(m.id, 'imports', { targetSymbol: 'Scheduled', targetSpecifier: SCHEDULED_IMPORT }),
    makeEdge(m.id, 'decorates', {
      targetSymbol: 'Scheduled',
      firstArg: opts.firstArg,
      literalArgs: JSON.stringify({ positional: [], named: opts.named }),
    }),
  ]
  return { nodes: [m], edges }
}

describe('G3 — JVM/Spring schedule_trigger recognition', () => {
  it('S-cron: @Scheduled(cron = "0 0 * * *") → schedule_trigger cron', () => {
    const { nodes, edges } = scheduledJob({ method: 'nightly', named: { cron: '0 0 * * *' }, firstArg: '0 0 * * *' })
    const relations = runPipeline(makeInputs(nodes, edges))
    expect(relations).toHaveLength(1)
    expect(relations[0]).toMatchObject({
      kind: 'schedule_trigger',
      target: null,
      operation: 'trigger',
      payload: { schedule_type: 'cron', cron: '0 0 * * *', adapter: 'spring_scheduled' },
    })
  })

  it('S-rate: @Scheduled(fixedRate = 5000) → schedule_trigger interval (5000ms)', () => {
    const { nodes, edges } = scheduledJob({ method: 'poll', named: { fixedRate: '5000' }, firstArg: 'fixedRate = 5000' })
    const relations = runPipeline(makeInputs(nodes, edges))
    expect(relations).toHaveLength(1)
    expect(relations[0]).toMatchObject({
      kind: 'schedule_trigger',
      payload: { schedule_type: 'interval', interval_ms: 5000, adapter: 'spring_scheduled' },
    })
  })

  it('S-delay: @Scheduled(fixedDelayString = "${app.delay}") → schedule_trigger interval (string)', () => {
    const { nodes, edges } = scheduledJob({ method: 'delayed', named: { fixedDelayString: '${app.delay}' }, firstArg: 'fixedDelayString = ...' })
    const relations = runPipeline(makeInputs(nodes, edges))
    expect(relations.filter((r) => r.kind === 'schedule_trigger')).toHaveLength(1)
    expect(relations[0].payload).toMatchObject({ schedule_type: 'interval', adapter: 'spring_scheduled' })
  })

  it('N (PRECISION): @Scheduled WITHOUT a Spring scheduling import → no schedule_trigger', () => {
    const m = makeNode('r:src/main/java/x/Jobs.java:Jobs.orphan')
    const edges = [makeEdge(m.id, 'decorates', { targetSymbol: 'Scheduled', firstArg: '0 0 * * *', literalArgs: JSON.stringify({ positional: [], named: { cron: '0 0 * * *' } }) })]
    const relations = runPipeline(makeInputs([m], edges))
    expect(relations.filter((r) => r.kind === 'schedule_trigger')).toHaveLength(0)
  })
})
