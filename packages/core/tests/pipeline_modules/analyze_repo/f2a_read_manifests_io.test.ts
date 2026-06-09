import { describe, it, expect, beforeEach, vi } from 'vitest'
import { basename } from 'node:path'

const fsState = vi.hoisted(() => ({
  files: new Set<string>(),
  statErrors: new Map<string, Error>(),
  readErrors: new Map<string, Error>(),
  sizes: new Map<string, number>(),
  contents: new Map<string, string>(),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn((path: string) => fsState.files.has(basename(path))),
  statSync: vi.fn((path: string) => {
    const name = basename(path)
    const error = fsState.statErrors.get(name)
    if (error) throw error
    return { size: fsState.sizes.get(name) ?? 1 }
  }),
  readFileSync: vi.fn((path: string) => {
    const name = basename(path)
    const error = fsState.readErrors.get(name)
    if (error) throw error
    return fsState.contents.get(name) ?? '{}'
  }),
}))

const { readManifests } = await import('@/pipeline_modules/analyze_repo/f2a_read_manifests.js')

describe('readManifests I/O failure handling', () => {
  beforeEach(() => {
    fsState.files.clear()
    fsState.statErrors.clear()
    fsState.readErrors.clear()
    fsState.sizes.clear()
    fsState.contents.clear()
  })

  it('returns null for package.json stat/read failures', () => {
    fsState.files.add('package.json')
    fsState.statErrors.set('package.json', new Error('stat failed'))
    expect(readManifests('/repo').packageJson).toBeNull()

    fsState.statErrors.clear()
    fsState.readErrors.set('package.json', new Error('read failed'))
    expect(readManifests('/repo').packageJson).toBeNull()
  })

  it('returns null for pubspec.yaml stat/read failures and oversized files', () => {
    fsState.files.add('pubspec.yaml')
    fsState.statErrors.set('pubspec.yaml', new Error('stat failed'))
    expect(readManifests('/repo').pubspecYaml).toBeNull()

    fsState.statErrors.clear()
    fsState.readErrors.set('pubspec.yaml', new Error('read failed'))
    expect(readManifests('/repo').pubspecYaml).toBeNull()

    fsState.readErrors.clear()
    fsState.sizes.set('pubspec.yaml', 256 * 1024 + 1)
    expect(readManifests('/repo').pubspecYaml).toBeNull()
  })

  it('returns null for tsconfig stat/read failures and oversized files', () => {
    fsState.files.add('tsconfig.json')
    fsState.statErrors.set('tsconfig.json', new Error('stat failed'))
    expect(readManifests('/repo').tsconfig).toBeNull()

    fsState.statErrors.clear()
    fsState.readErrors.set('tsconfig.json', new Error('read failed'))
    expect(readManifests('/repo').tsconfig).toBeNull()

    fsState.readErrors.clear()
    fsState.sizes.set('tsconfig.json', 256 * 1024 + 1)
    expect(readManifests('/repo').tsconfig).toBeNull()
  })
})
