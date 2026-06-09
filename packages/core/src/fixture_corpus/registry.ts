import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type FixtureSourceGroup = 'repo' | 'unit'
export type FixtureLane =
  | 'deterministic'
  | 'llm_discovery'
  | 'live_candidate'
  | 'static'
  | 'llm_replay'
  | 'llm_live_candidate'
export type FixtureLlmPolicy = 'none' | 'replay_only' | 'live_candidate_flag_required'
export type FixtureTier = 'accepted' | 'candidate' | 'draft' | 'blocked'
export type FixtureVisibility = 'public' | 'restricted' | 'local_only'
export type StageExpectedStatus = 'present' | 'missing'
export type FixtureExecutionScope = 'repo' | 'unit' | 'service'

export interface FixtureCorpusLayout {
  scope: FixtureExecutionScope
  suite: string
  segments: string[]
}

export const CORPUS_STAGE_IDS = [
  'analyze_repo',
  'build_graph',
  'build_pattern_profile',
  'static_analysis_profile',
  'static_analysis_dsl_discovery',
  'build_models',
  'build_route',
  'build_relations',
  'build_service_map',
  'build_epics',
  'build_docs',
  'build_docs_sql',
  'build_business_docs',
] as const

export type CorpusStageId = typeof CORPUS_STAGE_IDS[number]
export type StageExpectedMap = Record<CorpusStageId, StageExpectedStatus>

export interface FixtureCorpusEntry {
  id: string
  sourcePath: string
  sourceGroup: FixtureSourceGroup
  layout: FixtureCorpusLayout
  framework: string
  language: string | null
  stageExpected: StageExpectedMap
  hasLlmCache: boolean
  lanes: FixtureLane[]
  llmPolicy: FixtureLlmPolicy
  tier: FixtureTier
  visibility: FixtureVisibility
  knownGaps: string[]
}

export interface FixtureCorpus {
  rootDir: string
  entries: FixtureCorpusEntry[]
}

export interface FixtureCorpusSummary {
  total: number
  bySourceGroup: Record<FixtureSourceGroup, number>
  byTier: Record<FixtureTier, number>
  byVisibility: Record<FixtureVisibility, number>
  pipelineStageExpected: Record<CorpusStageId, number>
}

interface RawOrmMeta {
  expectedModelCount?: number
}

const EMPTY_STAGE_MAP = Object.fromEntries(
  CORPUS_STAGE_IDS.map((stageId) => [stageId, 'missing']),
) as StageExpectedMap

export function discoverFixtureCorpus(rootDir = process.cwd()): FixtureCorpus {
  const absoluteRoot = resolveCorpusPackageRoot(rootDir)
  const corpusRoot = join(absoluteRoot, 'tests/fixtures/corpus')
  const entries = [
    ...discoverOrmRepoFixtures(corpusRoot),
    ...discoverAstUnitFixtures(corpusRoot),
  ].sort((a, b) => a.id.localeCompare(b.id))

  return { rootDir: absoluteRoot, entries }
}

export function getFixtureCorpusSummary(corpus: FixtureCorpus): FixtureCorpusSummary {
  const summary: FixtureCorpusSummary = {
    total: corpus.entries.length,
    bySourceGroup: zeroed(['repo', 'unit']),
    byTier: zeroed(['accepted', 'candidate', 'draft', 'blocked']),
    byVisibility: zeroed(['public', 'restricted', 'local_only']),
    pipelineStageExpected: zeroed([...CORPUS_STAGE_IDS]),
  }

  for (const entry of corpus.entries) {
    summary.bySourceGroup[entry.sourceGroup] += 1
    summary.byTier[entry.tier] += 1
    summary.byVisibility[entry.visibility] += 1
    for (const stageId of CORPUS_STAGE_IDS) {
      if (entry.stageExpected[stageId] === 'present') summary.pipelineStageExpected[stageId] += 1
    }
  }

  return summary
}

export function isLiveLlmAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PLATTY_FIXTURE_LLM_LIVE === '1'
}

export function resolveLlmExecution(input: {
  lane: FixtureLane
  hasCacheEntry: boolean
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
}): { allowed: boolean; mode: 'none' | 'replay' | 'replay_cache_miss' | 'live_candidate'; reason: string } {
  const lane = normalizeFixtureLane(input.lane)
  if (lane === 'deterministic') {
    return { allowed: false, mode: 'none', reason: 'deterministic lane forbids LLM calls' }
  }
  if (lane === 'llm_discovery') {
    if (input.hasCacheEntry) {
      return { allowed: true, mode: 'replay', reason: 'llm discovery lane uses an existing cache entry' }
    }
    return {
      allowed: false,
      mode: 'replay_cache_miss',
      reason: 'llm discovery lane requires an existing cache entry and never falls back to live calls',
    }
  }
  if (isLiveLlmAllowed(input.env as NodeJS.ProcessEnv)) {
    return { allowed: true, mode: 'live_candidate', reason: 'live candidate lane was explicitly enabled' }
  }
  return { allowed: false, mode: 'none', reason: 'live candidate lane requires PLATTY_FIXTURE_LLM_LIVE=1' }
}

export function normalizeFixtureLane(lane: FixtureLane): 'deterministic' | 'llm_discovery' | 'live_candidate' {
  if (lane === 'static') return 'deterministic'
  if (lane === 'llm_replay') return 'llm_discovery'
  if (lane === 'llm_live_candidate') return 'live_candidate'
  return lane
}

function discoverOrmRepoFixtures(corpusRoot: string): FixtureCorpusEntry[] {
  const root = join(corpusRoot, 'repo/orm-e2e')
  return listDirs(root).map((fixtureDir) => {
    const name = basename(fixtureDir)
    const meta = readJson<RawOrmMeta>(join(fixtureDir, 'meta.json')) ?? {}
    return createEntry({
      id: `repo/orm-e2e/${name}`,
      sourcePath: `tests/fixtures/corpus/repo/orm-e2e/${name}`,
      sourceGroup: 'repo',
      layout: { scope: 'repo', suite: 'orm-e2e', segments: [name] },
      framework: 'prisma',
      language: 'prisma',
      stageExpected: withPresentStages(['analyze_repo', 'build_graph', 'build_pattern_profile', 'build_models']),
      tier: meta.expectedModelCount === 0 ? 'candidate' : 'accepted',
      knownGaps: [],
    })
  })
}

function discoverAstUnitFixtures(corpusRoot: string): FixtureCorpusEntry[] {
  const root = join(corpusRoot, 'unit/ast-extract')
  return listDirs(root).map((fixtureDir) => {
    const name = basename(fixtureDir)
    return createEntry({
      id: `unit/ast-extract/${name}`,
      sourcePath: `tests/fixtures/corpus/unit/ast-extract/${name}`,
      sourceGroup: 'unit',
      layout: { scope: 'unit', suite: 'ast-extract', segments: [name] },
      framework: name,
      language: languageForUnitFixture(name, fixtureDir),
      stageExpected: withPresentStages(['analyze_repo', 'build_graph', 'build_pattern_profile']),
      tier: name === 'broken' ? 'blocked' : 'accepted',
      knownGaps: name === 'broken' ? ['fixture contains intentionally invalid syntax'] : [],
    })
  })
}

function createEntry(input: {
  id: string
  sourcePath: string
  sourceGroup: FixtureSourceGroup
  layout: FixtureCorpusLayout
  framework: string
  language: string | null
  stageExpected: StageExpectedMap
  tier: FixtureTier
  knownGaps: string[]
}): FixtureCorpusEntry {
  return {
    ...input,
    hasLlmCache: false,
    lanes: ['deterministic', 'static'],
    llmPolicy: 'none',
    visibility: 'public',
  }
}

function withPresentStages(stages: CorpusStageId[]): StageExpectedMap {
  return {
    ...EMPTY_STAGE_MAP,
    ...Object.fromEntries(stages.map((stageId) => [stageId, 'present'])),
  }
}

function listDirs(path: string): string[] {
  if (!existsSync(path)) return []
  return readdirSync(path)
    .map((entry) => join(path, entry))
    .filter((entry) => statSync(entry).isDirectory())
    .sort()
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf-8')) as T
}

function basename(path: string): string {
  return path.split('/').pop() ?? path
}

function languageForUnitFixture(name: string, fixtureDir: string): string | null {
  if (name === 'flutter') return 'dart'
  if (hasFileWithExtension(fixtureDir, '.tsx')) return 'typescript'
  if (hasFileWithExtension(fixtureDir, '.dart')) return 'dart'
  return 'typescript'
}

function hasFileWithExtension(root: string, extension: string): boolean {
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()!
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) stack.push(path)
      if (entry.isFile() && entry.name.endsWith(extension)) return true
    }
  }
  return false
}

function resolveCorpusPackageRoot(startDir: string): string {
  const direct = resolve(startDir)
  const found = findUp(direct, 'tests/fixtures/corpus')
  if (found) return dirname(dirname(dirname(found)))

  const monorepoCoreCorpus = findUp(direct, 'packages/core/tests/fixtures/corpus')
  if (monorepoCoreCorpus) return dirname(dirname(dirname(monorepoCoreCorpus)))

  const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  return moduleRoot
}

function findUp(startDir: string, relativePath: string): string | null {
  let current = startDir
  while (true) {
    const candidate = join(current, relativePath)
    if (existsSync(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function zeroed<const T extends readonly string[]>(keys: T): Record<T[number], number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T[number], number>
}
