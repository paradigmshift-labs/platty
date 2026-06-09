import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface SpringRepoCatalog {
  target: number
  language: 'java' | 'kotlin'
  githubLanguage: 'Java' | 'Kotlin'
  count: number
  selectionPolicy: {
    excludedNameDescriptionPattern: string
    requiredSignals: string[]
    notes: string
  }
  aggregateSignals: Record<string, number>
  repos: Array<{
    full_name: string
    html_url: string
    default_branch: string
    language: string
    description?: string
    manifest_paths?: string[]
    sampled_source_paths?: string[]
    confirmedSpringUse?: boolean
    signals?: string[]
  }>
}

function readCatalog(file: string): SpringRepoCatalog {
  return JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/spring_jvm_github_catalog', file), 'utf-8')) as SpringRepoCatalog
}

describe('spring real-world fixture catalog sanity', () => {
  it('catalog contains java/kotlin repo pools', () => {
    const javaCatalog = readCatalog('java_top200.json')
    const kotlinCatalog = readCatalog('kotlin_top200.json')
    expect(javaCatalog.repos.length).toBe(200)
    expect(kotlinCatalog.repos.length).toBe(200)
    expect(javaCatalog.selectionPolicy.notes).toMatch(/not repo-specific rules/)
    expect(kotlinCatalog.selectionPolicy.notes).toMatch(/not repo-specific rules/)
  })

  it('catalog entries are unique product repositories with inspectable Spring evidence', () => {
    for (const catalog of [readCatalog('java_top200.json'), readCatalog('kotlin_top200.json')]) {
      expect(catalog.count).toBe(catalog.target)
      expect(catalog.repos).toHaveLength(catalog.target)
      expect(new Set(catalog.repos.map((repo) => repo.full_name)).size).toBe(catalog.repos.length)

      const nonProduct = new RegExp(catalog.selectionPolicy.excludedNameDescriptionPattern, 'i')
      const sourceExt = catalog.language === 'java' ? /\.java$/i : /\.(kt|kts)$/i
      for (const repo of catalog.repos) {
        expect(repo.full_name).toMatch(/^[^/\s]+\/[^/\s]+$/)
        expect(repo.html_url).toBe(`https://github.com/${repo.full_name}`)
        expect(repo.default_branch.length).toBeGreaterThan(0)
        expect(repo.language).toBe(catalog.githubLanguage)
        expect(nonProduct.test(`${repo.full_name}\n${repo.description ?? ''}`)).toBe(false)
        expect(repo.confirmedSpringUse).toBe(true)
        expect((repo.manifest_paths ?? []).length).toBeGreaterThan(0)
        expect((repo.signals ?? []).length).toBeGreaterThan(0)
      }

      const reposWithSampledJvmSource = catalog.repos.filter((repo) =>
        (repo.sampled_source_paths ?? []).some((path) => sourceExt.test(path)),
      )
      expect(reposWithSampledJvmSource.length).toBeGreaterThanOrEqual(190)
    }
  })

  it('catalog keeps broad Spring signal coverage across manifest, source, and config evidence', () => {
    for (const catalog of [readCatalog('java_top200.json'), readCatalog('kotlin_top200.json')]) {
      expect(catalog.aggregateSignals.springBootManifest).toBeGreaterThanOrEqual(170)
      expect(catalog.aggregateSignals.springManifest).toBeGreaterThanOrEqual(180)
      expect(catalog.aggregateSignals.springAnnotation).toBeGreaterThanOrEqual(150)
      expect(catalog.aggregateSignals.springSourceLayout).toBeGreaterThanOrEqual(170)
      expect(catalog.aggregateSignals.springApplicationConfig).toBeGreaterThanOrEqual(150)
    }
  })

  it('downloaded real-world snippets are prompt-safe and spring-related', () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/corpus/unit/spring-snippet/MANIFEST.json'), 'utf-8'))
    expect(manifest.length).toBeGreaterThan(0)
    for (const item of manifest) {
      expect(item.safe_prompt_scan).toBe(true)
      const content = readFileSync(item.saved, 'utf-8')
      expect(/spring|SpringBoot|@SpringBootApplication|build.gradle.kts|pom.xml/i.test(content)).toBe(true)
    }
  })
})
