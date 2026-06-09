import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, posix, relative } from 'node:path'
import fg from 'fast-glob'
import { normalizeSourceRoot } from '@/repo/repository-paths.js'

export type MonorepoUnitRole = 'backend' | 'frontend' | 'library' | 'unknown'
export type MonorepoUnitConfidence = 'high' | 'medium' | 'low'

export interface MonorepoUnitCandidate {
  name: string
  sourceRoot: string
  role: MonorepoUnitRole
  framework: string | null
  confidence: MonorepoUnitConfidence
  autoRegister: boolean
  evidence: string[]
}

export function discoverMonorepoUnits(repoPath: string): MonorepoUnitCandidate[] {
  const workspacePatterns = readWorkspacePatterns(repoPath)
  const packageRoots = expandWorkspacePackageRoots(repoPath, workspacePatterns)
  return packageRoots
    .map((sourceRoot) => inspectPackage(repoPath, sourceRoot))
    .sort((a, b) => a.sourceRoot.localeCompare(b.sourceRoot))
}

function readWorkspacePatterns(repoPath: string): string[] {
  return [
    ...readPackageWorkspacePatterns(repoPath),
    ...readPnpmWorkspacePatterns(repoPath),
  ].filter((pattern) => pattern && !pattern.startsWith('!'))
}

function readPackageWorkspacePatterns(repoPath: string): string[] {
  const manifest = readJson(join(repoPath, 'package.json'))
  const workspaces = manifest?.workspaces
  if (Array.isArray(workspaces)) {
    return workspaces.filter((item): item is string => typeof item === 'string')
  }
  if (workspaces && typeof workspaces === 'object' && Array.isArray((workspaces as { packages?: unknown }).packages)) {
    return (workspaces as { packages: unknown[] }).packages.filter((item): item is string => typeof item === 'string')
  }
  return []
}

function readPnpmWorkspacePatterns(repoPath: string): string[] {
  const workspacePath = join(repoPath, 'pnpm-workspace.yaml')
  if (!existsSync(workspacePath)) return []
  const source = readFileSync(workspacePath, 'utf-8')
  const packages = source.match(/(?:^|\n)\s*-\s*['"]?([^'"\n#]+)['"]?/g) ?? []
  return packages
    .map((line) => line.replace(/^\s*-\s*/, '').replace(/['"]/g, '').trim())
    .filter(Boolean)
}

function expandWorkspacePackageRoots(repoPath: string, patterns: string[]): string[] {
  const packageJsonPatterns = patterns.map((pattern) => {
    const normalized = pattern.replace(/\\/g, '/').replace(/\/+$/, '')
    return normalized.endsWith('package.json') ? normalized : `${normalized}/package.json`
  })
  const matches = fg.sync(packageJsonPatterns, {
    cwd: repoPath,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false,
    unique: true,
  })
  return [...new Set(matches
    .map((match) => normalizeSourceRoot(dirname(match)))
    .filter((sourceRoot): sourceRoot is string => Boolean(sourceRoot)))]
}

function inspectPackage(repoPath: string, sourceRoot: string): MonorepoUnitCandidate {
  const packagePath = join(repoPath, sourceRoot, 'package.json')
  const manifest = readJson(packagePath) ?? {}
  const deps = dependencyNames(manifest)
  const evidence: string[] = []
  const framework = detectFramework(repoPath, sourceRoot, deps, evidence)
  const role = detectRole(repoPath, sourceRoot, framework, deps)
  const hasRuntimeEntrypoint = packageHasRuntimeEntrypoint(repoPath, sourceRoot, framework)
  const confidence = framework && (hasRuntimeEntrypoint || framework === 'nextjs') ? 'high' : framework ? 'medium' : 'low'

  if (framework) evidence.push(`framework:${framework}`)
  if (hasRuntimeEntrypoint) evidence.push('runtime_entrypoint')

  return {
    name: packageName(manifest, sourceRoot),
    sourceRoot,
    role,
    framework,
    confidence,
    autoRegister: confidence === 'high' && role !== 'library',
    evidence,
  }
}

function readJson(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function dependencyNames(manifest: Record<string, unknown>): Set<string> {
  const out = new Set<string>()
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = manifest[field]
    if (!deps || typeof deps !== 'object' || Array.isArray(deps)) continue
    for (const name of Object.keys(deps)) out.add(name)
  }
  return out
}

function detectFramework(repoPath: string, sourceRoot: string, deps: Set<string>, evidence: string[]): string | null {
  if (deps.has('@nestjs/core')) return 'nestjs'
  if (deps.has('next') || existsSync(join(repoPath, sourceRoot, 'next.config.js')) || existsSync(join(repoPath, sourceRoot, 'next.config.mjs'))) return 'nextjs'
  if (deps.has('@angular/core')) return 'angular'
  if (deps.has('vue') || deps.has('nuxt')) return deps.has('nuxt') ? 'nuxt' : 'vue'
  if (deps.has('@sveltejs/kit') || deps.has('svelte')) return deps.has('@sveltejs/kit') ? 'sveltekit' : 'svelte'
  if (deps.has('express')) return 'express'
  if (deps.has('fastify')) return 'fastify'
  if (deps.has('hono')) return 'hono'
  if (deps.has('react')) {
    if (packageHasRuntimeEntrypoint(repoPath, sourceRoot, 'react')) return 'react'
    evidence.push('react_dependency_without_runtime_entrypoint')
  }
  return null
}

function detectRole(repoPath: string, sourceRoot: string, framework: string | null, deps: Set<string>): MonorepoUnitRole {
  if (framework === 'nestjs' || framework === 'express' || framework === 'fastify' || framework === 'hono') return 'backend'
  if (framework === 'nextjs' || framework === 'react' || framework === 'angular' || framework === 'vue' || framework === 'nuxt' || framework === 'svelte' || framework === 'sveltekit') return 'frontend'
  if (deps.has('react') && !packageHasRuntimeEntrypoint(repoPath, sourceRoot, 'react')) return 'library'
  return 'unknown'
}

function packageHasRuntimeEntrypoint(repoPath: string, sourceRoot: string, framework: string | null): boolean {
  const root = join(repoPath, sourceRoot)
  const candidates = [
    'src/main.ts',
    'src/main.tsx',
    'src/index.ts',
    'src/index.tsx',
    'src/server.ts',
    'src/app.module.ts',
    'app/page.tsx',
    'pages/index.tsx',
  ]
  if (framework === 'nextjs') {
    candidates.push('next.config.js', 'next.config.mjs', 'next.config.ts')
  }
  return candidates.some((candidate) => existsSync(join(root, candidate)))
}

function packageName(manifest: Record<string, unknown>, sourceRoot: string): string {
  const name = typeof manifest.name === 'string' ? manifest.name : basename(sourceRoot)
  return name.split('/').pop() || posix.basename(relative('.', sourceRoot)) || sourceRoot
}
