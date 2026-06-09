import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

interface SanitizedSpringFixtureManifest {
  version: number
  target: number
  count: number
  sourcePolicy: {
    source: string
    safety: string[]
    adapterPolicy: string
  }
  aggregateSignals: Record<string, number>
  fixtures: Array<{
    repo: string
    language: 'java' | 'kotlin'
    saved: string
    fileCount: number
    signals: string[]
    sourcePaths: string[]
  }>
}

function readManifest(): SanitizedSpringFixtureManifest {
  return JSON.parse(
    readFileSync(
      join(process.cwd(), 'tests/fixtures/spring_github_sanitized_fixtures/MANIFEST.json'),
      'utf-8',
    ),
  ) as SanitizedSpringFixtureManifest
}

describe('spring github sanitized fixture corpus', () => {
  it('contains 100 prompt-safe GitHub-derived Spring fixtures', () => {
    const manifest = readManifest()
    expect(manifest.version).toBe(1)
    expect(manifest.target).toBe(100)
    expect(manifest.count).toBe(100)
    expect(manifest.fixtures).toHaveLength(100)
    expect(manifest.sourcePolicy.adapterPolicy).toMatch(/general Spring\/JVM patterns/)
    expect(manifest.sourcePolicy.safety.join('\n')).toMatch(/No repository is copied wholesale/)

    const uniqueRepos = new Set(manifest.fixtures.map((fixture) => fixture.repo))
    expect(uniqueRepos.size).toBe(100)
    expect(manifest.fixtures.filter((fixture) => fixture.language === 'java').length).toBeGreaterThanOrEqual(45)
    expect(manifest.fixtures.filter((fixture) => fixture.language === 'kotlin').length).toBeGreaterThanOrEqual(45)
    expect(readdirSync(join(process.cwd(), 'tests/fixtures/spring_github_sanitized_fixtures/repos')).filter((file) => file.endsWith('.json')).length).toBe(100)
  })

  it('stores only sanitized JSON excerpts, not executable copied repositories', () => {
    const manifest = readManifest()
    const promptLike = /(ignore\s+(all\s+)?previous|system\s+prompt|developer\s+message|BEGIN\s+PROMPT|jailbreak)/i

    for (const fixture of manifest.fixtures) {
      expect(fixture.saved).toMatch(/tests\/fixtures\/spring_github_sanitized_fixtures\/repos\/.+\.json$/)
      expect(existsSync(join(process.cwd(), fixture.saved))).toBe(true)
      expect(fixture.fileCount).toBeGreaterThan(0)
      expect(fixture.sourcePaths.some((path) => /\.(java|kt|kts|xml|gradle)$/i.test(path))).toBe(true)
      expect(fixture.signals).toContain('springEvidence')

      const saved = JSON.parse(readFileSync(join(process.cwd(), fixture.saved), 'utf-8')) as {
        safety: { promptScanPassed: boolean; wholeRepoCopied: boolean; storedAsExecutableSource: boolean }
        files: Array<{ excerpts: Array<{ lineCount: number; lines: string[] }> }>
      }
      expect(saved.safety.promptScanPassed).toBe(true)
      expect(saved.safety.wholeRepoCopied).toBe(false)
      expect(saved.safety.storedAsExecutableSource).toBe(false)
      const savedText = JSON.stringify(saved)
      expect(promptLike.test(savedText)).toBe(false)
      for (const file of saved.files) {
        for (const excerpt of file.excerpts) {
          expect(excerpt.lineCount).toBeLessThanOrEqual(80)
          expect(excerpt.lines.length).toBe(excerpt.lineCount)
        }
      }
    }
  })

  it('keeps broad adapter-relevant Spring signal coverage', () => {
    const { aggregateSignals } = readManifest()
    expect(aggregateSignals.manifest).toBeGreaterThanOrEqual(90)
    expect(aggregateSignals.httpAnnotation).toBeGreaterThanOrEqual(35)
    expect(aggregateSignals.jpaModel).toBeGreaterThanOrEqual(15)
    expect((aggregateSignals.asyncEntrypoint ?? 0) + (aggregateSignals.webfluxFunctional ?? 0)).toBeGreaterThanOrEqual(1)
  })
})
