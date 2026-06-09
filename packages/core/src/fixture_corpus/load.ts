import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { discoverFixtureCorpus, type CorpusStageId, type FixtureCorpusEntry } from './registry.js'

let cachedRootDir: string | null = null
let cachedById: Map<string, FixtureCorpusEntry> | null = null

export function loadFixture(id: string): FixtureCorpusEntry | null {
  const { byId } = getIndex()
  return byId.get(id) ?? null
}

export function loadFixtureSource(id: string, relativePath: string): string {
  const entry = mustLoad(id)
  const { rootDir } = getIndex()
  return readFileSync(join(rootDir, entry.sourcePath, relativePath), 'utf-8')
}

export function loadFixtureExpected(id: string, stage: CorpusStageId): unknown {
  const entry = mustLoad(id)
  if (entry.stageExpected[stage] !== 'present') return null
  const { rootDir } = getIndex()
  return readFixtureExpectedFile(join(rootDir, entry.sourcePath), stage).value
}

export function loadFixtureRepoSource(id: string, repoId: string, relativePath: string): string {
  const entry = mustLoad(id)
  if (entry.layout.scope !== 'service') {
    throw new Error(`loadFixtureRepoSource called on non-service fixture ${id} (scope=${entry.layout.scope})`)
  }
  const { rootDir } = getIndex()
  return readFileSync(join(rootDir, entry.sourcePath, 'repos', repoId, relativePath), 'utf-8')
}

export function readFixtureExpectedFileForTest(
  fixtureDir: string,
  stage: CorpusStageId,
): { path: string; value: unknown | null } {
  return readFixtureExpectedFile(fixtureDir, stage)
}

export function _resetLoadCache(): void {
  cachedById = null
  cachedRootDir = null
}

function getIndex(): { rootDir: string; byId: Map<string, FixtureCorpusEntry> } {
  if (cachedById !== null && cachedRootDir !== null) {
    return { rootDir: cachedRootDir, byId: cachedById }
  }

  const corpus = discoverFixtureCorpus()
  const byId = new Map(corpus.entries.map((entry) => [entry.id, entry]))
  cachedRootDir = corpus.rootDir
  cachedById = byId
  return { rootDir: corpus.rootDir, byId }
}

function readFixtureExpectedFile(
  fixtureDir: string,
  stage: CorpusStageId,
): { path: string; value: unknown | null } {
  const expectedName = stage === 'build_graph' ? 'build_graph.lsp.json' : `${stage}.json`
  const path = join(fixtureDir, 'expected', expectedName)
  if (!existsSync(path)) return { path, value: null }
  return { path, value: JSON.parse(readFileSync(path, 'utf-8')) }
}

function mustLoad(id: string): FixtureCorpusEntry {
  const entry = loadFixture(id)
  if (entry === null) throw new Error(`fixture not found: ${id}`)
  return entry
}
