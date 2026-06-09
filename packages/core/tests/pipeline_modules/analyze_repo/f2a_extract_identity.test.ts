import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { extractIdentity } from '@/pipeline_modules/analyze_repo/f2a_extract_identity.js'
import type { ManifestSet } from '@/pipeline_modules/analyze_repo/types.js'

/**
 * f2a_extract_identity 시나리오 (spec §4 — 30 시나리오):
 *
 *  language 결정 (§3.1):       I1, I2, I4, I5, I14, I15, I16, I23, I28
 *  framework 매핑 (§3.2~3.4):  I3, I6, I9, I29, I30, I17, I18
 *  type 분기 (§3.5):           I7, I8, I21
 *  orm 매핑 (§3.6):            I11, I15, I24, I26
 *  build_tool 매핑 (§3.7):     I12, I27
 *  confidence (§3.8):          I10, I22
 *  ambiguous 트리거:           I3, I6, I13, I14, I25, I29
 *  엣지/모노레포:              I20, I30
 */

const TMP_ROOT = resolve(process.cwd(), '.tmp-test-identity')

function mkRepo(name: string, files: Record<string, string> = {}): string {
  const repoPath = join(TMP_ROOT, name)
  mkdirSync(repoPath, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const full = join(repoPath, rel)
    mkdirSync(resolve(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return repoPath
}

function manifests(opts: Partial<ManifestSet>): ManifestSet {
  return {
    packageJson: opts.packageJson ?? null,
    pubspecYaml: opts.pubspecYaml ?? null,
    tsconfig: opts.tsconfig ?? null,
    otherManifests: opts.otherManifests ?? [],
  }
}

describe('extractIdentity', () => {
  beforeAll(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true })
    mkdirSync(TMP_ROOT, { recursive: true })
  })
  afterAll(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true })
  })

  // ─────────────────────────────────────────────────
  // language 결정 (§3.1)
  // ─────────────────────────────────────────────────

  it('I1: nestjs + prisma + tsconfig → typescript / nestjs / backend / prisma / high', () => {
    const repo = mkRepo('i1')
    const r = extractIdentity(
      manifests({
        packageJson: {
          dependencies: { '@nestjs/core': '^10.0.0', prisma: '^5.0.0' },
        },
        tsconfig: { compilerOptions: { baseUrl: 'src' } },
      }),
      repo,
    )
    expect(r.language).toBe('typescript')
    expect(r.framework).toBe('nestjs')
    expect(r.type).toBe('backend')
    expect(r.orm).toBe('prisma')
    expect(r.confidence).toBe('high')
    expect(r.ambiguous).toBe(false)
  })

  it('I2: nextjs (next + react) → 우선순위 nextjs, ambiguous=false', () => {
    const repo = mkRepo('i2')
    const r = extractIdentity(
      manifests({
        packageJson: { dependencies: { next: '^14.0.0', react: '^18.0.0' } },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.framework).toBe('nextjs')
    expect(r.ambiguous).toBe(false)
  })

  it('I2a: nextjs + tsconfig but only js source → javascript', () => {
    const repo = mkRepo('i2a', {
      'app/page.js': 'export default function Page() { return null }',
      'app/api/ping/route.js': 'export function GET() { return Response.json({ ok: true }) }',
    })
    const r = extractIdentity(
      manifests({
        packageJson: { dependencies: { next: '^14.0.0', react: '^18.0.0' } },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.language).toBe('javascript')
    expect(r.framework).toBe('nextjs')
  })

  it('I2a-2: tsconfig with only declaration files keeps TypeScript manifest identity', () => {
    const repo = mkRepo('i2a2', {
      'src/index.d.ts': 'declare const value: string',
    })
    const r = extractIdentity(
      manifests({
        packageJson: { dependencies: { react: '^18.0.0' } },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.language).toBe('typescript')
  })

  it('I2a-3: missing repoPath during source scan falls back to TypeScript manifest identity', () => {
    const r = extractIdentity(
      manifests({
        packageJson: { dependencies: { react: '^18.0.0' } },
        tsconfig: {},
      }),
      '',
    )
    expect(r.language).toBe('typescript')
  })

  it('I2a-4: source scan stops before very deep TypeScript files', () => {
    const repo = mkRepo('i2a4', {
      'src/app.js': 'console.log("js")',
      'a/b/c/d/e/f/g/h/i/hidden.ts': 'export const hidden = true',
    })
    const r = extractIdentity(
      manifests({
        packageJson: { dependencies: { react: '^18.0.0' } },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.language).toBe('javascript')
  })

  it('I2a-5: source scan ignores non-file dirents such as symlinks', () => {
    const repo = mkRepo('i2a5', {
      'target.ts': 'export const target = true',
    })
    symlinkSync(join(repo, 'target.ts'), join(repo, 'linked.ts'))
    rmSync(join(repo, 'target.ts'))
    const r = extractIdentity(
      manifests({
        packageJson: { dependencies: { react: '^18.0.0' } },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.language).toBe('typescript')
  })

  it('I2b: Vite React Router SSR with express server → react, ambiguous=false', () => {
    const repo = mkRepo('i2b', {
      'src/entry.client.tsx': 'hydrateRoot(document.getElementById("app"), <App />)',
      'src/entry.server.tsx': 'export function render() {}',
    })
    const r = extractIdentity(
      manifests({
        packageJson: {
          dependencies: {
            express: '^4.18.2',
            react: '^18.0.0',
            'react-router-dom': '^6.15.0',
          },
          devDependencies: {
            vite: '^4.0.0',
          },
        },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.framework).toBe('react')
    expect(r.type).toBe('frontend')
    expect(r.ambiguous).toBe(false)
  })

  it('I2c: Vite React Router multi-entry with express host → react, ambiguous=false', () => {
    const repo = mkRepo('i2c', {
      'home/main.jsx': 'createRoot(document.getElementById("root")).render(<App />)',
      'inbox/main.jsx': 'createRoot(document.getElementById("root")).render(<App />)',
      'server.js': 'require("express")().use("*", (_req, res) => res.end(""))',
    })
    const r = extractIdentity(
      manifests({
        packageJson: {
          dependencies: {
            express: '^4.18.2',
            react: '^18.0.0',
            'react-router-dom': '^6.15.0',
          },
          devDependencies: {
            vite: '^4.0.0',
          },
        },
      }),
      repo,
    )
    expect(r.framework).toBe('react')
    expect(r.type).toBe('frontend')
    expect(r.ambiguous).toBe(false)
  })

  it('I2c-2: Vite React Router root app entry with express host → react, ambiguous=false', () => {
    const repo = mkRepo('i2c2', {
      'main.tsx': 'createRoot(document.getElementById("root")).render(<App />)',
    })
    const r = extractIdentity(
      manifests({
        packageJson: {
          dependencies: {
            express: '^4.18.2',
            react: '^18.0.0',
            'react-router-dom': '^6.15.0',
          },
          devDependencies: {
            vite: '^4.0.0',
          },
        },
      }),
      repo,
    )
    expect(r.framework).toBe('react')
    expect(r.ambiguous).toBe(false)
  })

  it('I2c-3: Vite React Router deps without hosted entry stay express', () => {
    const repo = mkRepo('i2c3', {
      'docs/readme.md': 'no app entry here',
      'target.txt': 'not an app',
    })
    symlinkSync(join(repo, 'target.txt'), join(repo, 'linked.txt'))
    const r = extractIdentity(
      manifests({
        packageJson: {
          dependencies: {
            express: '^4.18.2',
            react: '^18.0.0',
            'react-router-dom': '^6.15.0',
          },
          devDependencies: {
            vite: '^4.0.0',
          },
        },
      }),
      repo,
    )
    // 화이트리스트 전환: express + react + vite + react-router-dom (entry 없음) → framework=null (B-8)
    expect(r.framework).toBe(null)
    expect(r.ambiguous).toBe(true)
  })

  it('I2c-4: source scan ignores source files that cannot be read', () => {
    const repo = mkRepo('i2c4', {
      'src/app.ts': 'import { PrismaClient } from "@prisma/client"',
    })
    const unreadable = join(repo, 'src/app.ts')
    chmodSync(unreadable, 0o000)
    try {
      const r = extractIdentity(
        manifests({
          packageJson: {
            dependencies: {
              express: '^4.18.2',
            },
          },
          tsconfig: {},
        }),
        repo,
      )
      expect(r.framework).toBe('express')
      expect(['prisma', null]).toContain(r.orm)
    } finally {
      chmodSync(unreadable, 0o644)
    }
  })

  it('I2d: hono dependency → backend/hono', () => {
    const repo = mkRepo('i2d', {
      'src/index.ts': 'import { Hono } from "hono"; new Hono().get("/health", (c) => c.text("ok"))',
    })
    const r = extractIdentity(
      manifests({
        packageJson: { dependencies: { hono: '^4.0.0' } },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.framework).toBe('hono')
    expect(r.type).toBe('backend')
    expect(r.ambiguous).toBe(false)
  })

  it('I2e: elysia dependency → backend/elysia', () => {
    const repo = mkRepo('i2e', {
      'src/index.ts': 'import { Elysia } from "elysia"; new Elysia().get("/health", () => "ok")',
    })
    const r = extractIdentity(
      manifests({
        packageJson: { dependencies: { elysia: '^1.0.0' } },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.framework).toBe('elysia')
    expect(r.type).toBe('backend')
    expect(r.ambiguous).toBe(false)
  })

  it('I2f: nuxt dependency absorbs vue and detects fullstack when server/api exists', () => {
    const repo = mkRepo('i2f-nuxt', {
      'pages/index.vue': '<template />',
      'server/api/orders/[id].get.ts': 'export default defineEventHandler(() => ({}))',
    })
    const r = extractIdentity(
      manifests({
        packageJson: { dependencies: { nuxt: '^3.0.0', vue: '^3.0.0' } },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.framework).toBe('nuxt')
    expect(r.type).toBe('fullstack')
    expect(r.ambiguous).toBe(false)
  })

  it('I2g: sveltekit dependency absorbs svelte and detects +server fullstack', () => {
    const repo = mkRepo('i2g-sveltekit', {
      'src/routes/+page.svelte': '<h1>Home</h1>',
      'src/routes/api/orders/[id]/+server.ts': 'export function GET() {}',
    })
    const r = extractIdentity(
      manifests({
        packageJson: { dependencies: { '@sveltejs/kit': '^2.0.0', svelte: '^5.0.0' } },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.framework).toBe('sveltekit')
    expect(r.type).toBe('fullstack')
    expect(r.ambiguous).toBe(false)
  })

  it('I2h: astro dependency absorbs renderer libraries and detects pages/api fullstack', () => {
    const repo = mkRepo('i2h-astro', {
      'src/pages/index.astro': '---\n---\n<h1>Home</h1>',
      'src/pages/api/orders/[id].ts': 'export function GET() {}',
    })
    const r = extractIdentity(
      manifests({
        packageJson: { dependencies: { astro: '^5.0.0', react: '^19.0.0' } },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.framework).toBe('astro')
    expect(r.type).toBe('fullstack')
    expect(r.ambiguous).toBe(false)
  })

  it('I2d: React Router framework with express adapter → react, ambiguous=false', () => {
    const repo = mkRepo('i2d', {
      'app/routes.ts': 'export default []',
      'react-router.config.ts': 'export default {}',
      'server.ts': 'import express from "express"',
    })
    const r = extractIdentity(
      manifests({
        packageJson: {
          dependencies: {
            '@react-router/express': '^7.0.0',
            '@react-router/node': '^7.0.0',
            express: '^4.18.2',
            react: '^18.0.0',
            'react-router': '^7.0.0',
          },
          devDependencies: {
            '@react-router/dev': '^7.0.0',
            vite: '^6.0.0',
          },
        },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.framework).toBe('react')
    expect(r.type).toBe('frontend')
    expect(r.ambiguous).toBe(false)
  })

  it('I2d-2: React Router framework config file signal → react, ambiguous=false', () => {
    const repo = mkRepo('i2d2', {
      'react-router.config.js': 'export default {}',
    })
    const r = extractIdentity(
      manifests({
        packageJson: {
          dependencies: {
            '@react-router/express': '^7.0.0',
            express: '^4.18.2',
            react: '^18.0.0',
            'react-router': '^7.0.0',
          },
          devDependencies: {
            vite: '^6.0.0',
          },
        },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.framework).toBe('react')
    expect(r.ambiguous).toBe(false)
  })

  it('I2e: Vite React Router RSC with express host → react, ambiguous=false', () => {
    const repo = mkRepo('i2e', {
      'server.js': 'import express from "express"; express().listen(3000)',
      'src/entry.browser.tsx': 'hydrateRoot(document, <App />)',
      'src/entry.ssr.tsx': 'export function render() {}',
      'src/entry.rsc.tsx': 'export async function renderRSC() {}',
      'src/routes.ts': 'export const routes = []',
    })
    const r = extractIdentity(
      manifests({
        packageJson: {
          dependencies: {
            express: '^4.21.2',
            react: '^19.0.0',
            'react-router': 'workspace:*',
          },
          devDependencies: {
            vite: '^6.0.0',
          },
        },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.framework).toBe('react')
    expect(r.type).toBe('frontend')
    expect(r.ambiguous).toBe(false)
  })

  it('I2f: unreadable source subdir is ignored during source language scan', () => {
    const repo = mkRepo('i2f', {
      'src/app.js': 'console.log("js")',
      'blocked/hidden.ts': 'export const hidden = true',
    })
    chmodSync(join(repo, 'blocked'), 0)
    try {
      const r = extractIdentity(
        manifests({
          packageJson: { dependencies: { react: '^18.0.0' } },
          tsconfig: {},
        }),
        repo,
      )
      expect(['javascript', 'typescript']).toContain(r.language)
    } finally {
      chmodSync(join(repo, 'blocked'), 0o755)
    }
  })

  it('I3: nestjs + next 동시 (둘 다 본 framework) → framework=null, ambiguous=true (B-7 화이트리스트)', () => {
    const repo = mkRepo('i3')
    const r = extractIdentity(
      manifests({
        packageJson: { dependencies: { '@nestjs/core': '^10.0.0', next: '^14.0.0' } },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.framework).toBe(null)
    expect(r.ambiguous).toBe(true)
  })

  it('I4: flutter + go_router → dart / flutter / mobile', () => {
    const repo = mkRepo('i4')
    const r = extractIdentity(
      manifests({
        pubspecYaml: { dependencies: { flutter: { sdk: 'flutter' }, go_router: '^12.0.0' } },
      }),
      repo,
    )
    expect(r.language).toBe('dart')
    expect(r.framework).toBe('flutter')
    expect(r.type).toBe('mobile')
  })

  it('I5: go.mod 단독 → language=other, language_raw=go, ambiguous=true', () => {
    const repo = mkRepo('i5')
    const r = extractIdentity(manifests({ otherManifests: ['go.mod'] }), repo)
    expect(r.language).toBe('other')
    expect(r.language_raw).toBe('go')
    expect(r.framework).toBe('other')
    expect(r.ambiguous).toBe(true)
  })

  it('I6: deps={} → framework=other, ambiguous=true', () => {
    const repo = mkRepo('i6')
    const r = extractIdentity(
      manifests({ packageJson: { dependencies: {} }, tsconfig: {} }),
      repo,
    )
    expect(r.framework).toBe('other')
    expect(r.ambiguous).toBe(true)
  })

  it('I6-b: Next pages/app source structure can identify nextjs when root package metadata is missing', () => {
    const repo = mkRepo('i6b', {
      'pages/api/orders/[id].ts': 'export default function handler() {}',
      'pages/orders/[id].tsx': 'export default function OrderPage() { return null }',
      'prisma/schema.prisma': 'model Order { id String @id }',
    })
    const r = extractIdentity(manifests({}), repo)
    expect(r.language).toBe('typescript')
    expect(r.framework).toBe('nextjs')
    expect(r.type).toBe('fullstack')
    expect(r.orm).toBe('prisma')
    expect(r.ambiguous).toBe(true)
  })

  // ─────────────────────────────────────────────────
  // type 분기 (§3.5)
  // ─────────────────────────────────────────────────

  it('I7: nextjs + app/api 디렉토리 없음 → type=frontend', () => {
    const repo = mkRepo('i7')
    const r = extractIdentity(
      manifests({ packageJson: { dependencies: { next: '^14.0.0' } } }),
      repo,
    )
    expect(r.type).toBe('frontend')
  })

  it('I8: nextjs + app/api/ 존재 → type=fullstack', () => {
    const repo = mkRepo('i8', { 'app/api/users/route.ts': '// route' })
    const r = extractIdentity(
      manifests({ packageJson: { dependencies: { next: '^14.0.0' } } }),
      repo,
    )
    expect(r.type).toBe('fullstack')
  })

  it('I9: react 단독 → frontend', () => {
    const repo = mkRepo('i9')
    const r = extractIdentity(
      manifests({ packageJson: { dependencies: { react: '^18.0.0' } } }),
      repo,
    )
    expect(r.framework).toBe('react')
    expect(r.type).toBe('frontend')
  })

  it('I9-b: react + prisma schema → fullstack', () => {
    const repo = mkRepo('i9b', { 'prisma/schema.prisma': 'model Todo { id String @id }' })
    const r = extractIdentity(
      manifests({ packageJson: { dependencies: { react: '^19.0.0', prisma: '^7.0.0' } } }),
      repo,
    )
    expect(r.framework).toBe('react')
    expect(r.orm).toBe('prisma')
    expect(r.type).toBe('fullstack')
  })

  it('I10: nestjs + tsconfig 없음 → confidence=medium', () => {
    const repo = mkRepo('i10')
    const r = extractIdentity(
      manifests({ packageJson: { dependencies: { '@nestjs/core': '^10.0.0' } } }),
      repo,
    )
    expect(r.framework).toBe('nestjs')
    expect(r.confidence).toBe('medium')
    expect(r.language).toBe('javascript')
  })

  // ─────────────────────────────────────────────────
  // orm + build_tool 매핑
  // ─────────────────────────────────────────────────

  it('I11: typeorm dep → orm=typeorm', () => {
    const repo = mkRepo('i11')
    const r = extractIdentity(
      manifests({
        packageJson: { dependencies: { '@nestjs/core': '^10.0.0', typeorm: '^0.3.0' } },
      }),
      repo,
    )
    expect(r.orm).toBe('typeorm')
  })

  it('I12: vite + webpack 동시 → vite (우선순위)', () => {
    const repo = mkRepo('i12')
    const r = extractIdentity(
      manifests({
        packageJson: { dependencies: { react: '^18.0.0' }, devDependencies: { vite: '^5.0.0', webpack: '^5.0.0' } },
      }),
      repo,
    )
    expect(r.build_tool).toBe('vite')
  })

  it('I12-b: devDependencies-only package still drives framework detection', () => {
    const repo = mkRepo('i12b')
    const r = extractIdentity(
      manifests({
        packageJson: { devDependencies: { react: '^18.0.0', vite: '^5.0.0' } },
      }),
      repo,
    )
    expect(r.framework).toBe('react')
    expect(r.build_tool).toBe('vite')
  })

  it('I13: workspaces + 다중 framework → ambiguous=true', () => {
    const repo = mkRepo('i13')
    const r = extractIdentity(
      manifests({
        packageJson: {
          workspaces: ['packages/*'],
          dependencies: { '@nestjs/core': '^10.0.0', next: '^14.0.0' },
        },
      }),
      repo,
    )
    expect(r.ambiguous).toBe(true)
  })

  it('I14: malformed package.json (manifests.packageJson=null) → ambiguous=true, language=null', () => {
    const repo = mkRepo('i14')
    const r = extractIdentity(manifests({}), repo)
    expect(r.language).toBeNull()
    expect(r.framework).toBeNull()
    expect(r.ambiguous).toBe(true)
  })

  it('I15: pubspec only + drift → flutter, orm=drift', () => {
    const repo = mkRepo('i15')
    const r = extractIdentity(
      manifests({ pubspecYaml: { dependencies: { flutter: {}, drift: '^2.0.0' } } }),
      repo,
    )
    expect(r.language).toBe('dart')
    expect(r.framework).toBe('flutter')
    expect(r.orm).toBe('drift')
  })

  it('I15-b: pubspec without dependencies → dart with no ORM', () => {
    const repo = mkRepo('i15b')
    const r = extractIdentity(
      manifests({ pubspecYaml: {} }),
      repo,
    )
    expect(r.language).toBe('dart')
    expect(r.orm).toBeNull()
  })

  it('I16: Cargo.toml → language=other, language_raw=rust', () => {
    const repo = mkRepo('i16')
    const r = extractIdentity(manifests({ otherManifests: ['Cargo.toml'] }), repo)
    expect(r.language).toBe('other')
    expect(r.language_raw).toBe('rust')
  })

  // ─────────────────────────────────────────────────
  // 엣지 / 미지원 framework
  // ─────────────────────────────────────────────────

  it('I17: nuxt deps + vue → framework=nuxt, vue absorbed', () => {
    const repo = mkRepo('i17')
    const r = extractIdentity(
      manifests({
        packageJson: { dependencies: { nuxt: '^3.0.0', vue: '^3.0.0' } },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.framework).toBe('nuxt')
    expect(r.type).toBe('frontend')
    expect(r.ambiguous).toBe(false)
  })

  it('I18: sveltekit + svelte → framework=sveltekit, svelte absorbed', () => {
    const repo = mkRepo('i18')
    const r = extractIdentity(
      manifests({
        packageJson: { dependencies: { '@sveltejs/kit': '^2.0.0', svelte: '^4.0.0' } },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.framework).toBe('sveltekit')
    expect(r.type).toBe('frontend')
    expect(r.ambiguous).toBe(false)
  })

  it('I19: reasoning trace — "deps:..." 형식', () => {
    const repo = mkRepo('i19')
    const r = extractIdentity(
      manifests({
        packageJson: { dependencies: { '@nestjs/core': '^10.0.0' } },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.reasoning).toMatch(/deps|@nestjs/)
  })

  it('I20: nestjs + nest-cli.json 존재 (추가 신호) → high (이미 high)', () => {
    const repo = mkRepo('i20', { 'nest-cli.json': '{}' })
    const r = extractIdentity(
      manifests({
        packageJson: { dependencies: { '@nestjs/core': '^10.0.0' } },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.confidence).toBe('high')
  })

  it('I21: nextjs + src/app/api/ 존재 → fullstack', () => {
    const repo = mkRepo('i21', { 'src/app/api/users/route.ts': '// route' })
    const r = extractIdentity(
      manifests({ packageJson: { dependencies: { next: '^14.0.0' } } }),
      repo,
    )
    expect(r.type).toBe('fullstack')
  })

  it('I22: framework 매핑 0건 → confidence=low, framework=null (B-5 화이트리스트)', () => {
    const repo = mkRepo('i22')
    const r = extractIdentity(
      manifests({
        packageJson: { dependencies: { lodash: '^4.0.0' } },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.confidence).toBe('low')
    expect(r.framework).toBe(null)
    expect(r.ambiguous).toBe(true)
  })

  it('I23: otherManifests 다중 (go + Cargo) → 상위 우선순위', () => {
    const repo = mkRepo('i23')
    const r = extractIdentity(
      manifests({ otherManifests: ['go.mod', 'Cargo.toml'] }),
      repo,
    )
    expect(r.language).toBe('other')
    expect(['go', 'rust']).toContain(r.language_raw) // 둘 중 하나 deterministic
  })

  it('I24: sequelize + mongoose 둘 다 → orm=sequelize (우선순위)', () => {
    const repo = mkRepo('i24')
    const r = extractIdentity(
      manifests({
        packageJson: {
          dependencies: { express: '^4.0.0', sequelize: '^6.0.0', mongoose: '^7.0.0' },
        },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.orm).toBe('sequelize')
  })

  it('I25: pnpm-workspace.yaml 존재 + 다중 framework → ambiguous=true', () => {
    const repo = mkRepo('i25', { 'pnpm-workspace.yaml': 'packages:\n  - "packages/*"\n' })
    const r = extractIdentity(
      manifests({
        packageJson: { dependencies: { '@nestjs/core': '^10.0.0', next: '^14.0.0' } },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.ambiguous).toBe(true)
  })

  it('I26: prisma + drizzle → orm=prisma (우선순위)', () => {
    const repo = mkRepo('i26')
    const r = extractIdentity(
      manifests({
        packageJson: {
          dependencies: { '@nestjs/core': '^10.0.0', prisma: '^5.0.0', 'drizzle-orm': '^0.30.0' },
        },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.orm).toBe('prisma')
  })

  it('I27: turbo + vite → build_tool=turbo (우선순위)', () => {
    const repo = mkRepo('i27')
    const r = extractIdentity(
      manifests({
        packageJson: {
          dependencies: { react: '^18.0.0' },
          devDependencies: { turbo: '^1.0.0', vite: '^5.0.0' },
        },
      }),
      repo,
    )
    expect(r.build_tool).toBe('turbo')
  })

  it('I28: build.gradle.kts → language=kotlin', () => {
    const repo = mkRepo('i28')
    const r = extractIdentity(
      manifests({ otherManifests: ['build.gradle.kts'] }),
      repo,
    )
    expect(r.language).toBe('kotlin')
    expect(r.language_raw).toBeNull()
  })

  it('I28c: build.gradle.kts with Java source → language=java', () => {
    const repo = mkRepo('i28c', {
      'build.gradle.kts': 'plugins { java }',
      'src/main/java/com/acme/App.java': 'class App {}',
    })
    const r = extractIdentity(
      manifests({ otherManifests: ['build.gradle.kts'] }),
      repo,
    )
    expect(r.language).toBe('java')
    expect(r.language_raw).toBeNull()
  })

  it('I28a: manifest 없는 dart snippet → source 기반 dart/drift', () => {
    const repo = mkRepo('i28a', {
      'database.dart': `
        import 'package:drift/drift.dart';
        @DriftDatabase(tables: [Users])
        class AppDb {}
        class Users extends Table {}
      `,
    })
    const r = extractIdentity(manifests({}), repo)
    expect(r.language).toBe('dart')
    expect(r.framework).toBe('other')
    expect(r.orm).toBe('drift')
  })

  it('I28b: manifest 없는 TS ORM snippet → source 기반 language/orm', () => {
    const repo = mkRepo('i28b', {
      'schema.ts': `
        import { pgTable, text } from '~/pg-core';
        export const users = pgTable('users', { name: text('name') });
      `,
    })
    const r = extractIdentity(manifests({}), repo)
    expect(r.language).toBe('typescript')
    expect(r.framework).toBe('other')
    expect(r.orm).toBe('drizzle')
  })

  it('I29: nestjs + next (둘 다 본 framework) → framework=null, ambiguous=true (B-7 화이트리스트)', () => {
    const repo = mkRepo('i29')
    const r = extractIdentity(
      manifests({
        packageJson: { dependencies: { '@nestjs/core': '^10.0.0', next: '^14.0.0' } },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.framework).toBe(null)
    expect(r.ambiguous).toBe(true)
  })

  it('I30: next + react (react는 nextjs dep로 흡수) → nextjs, ambiguous=false', () => {
    const repo = mkRepo('i30')
    const r = extractIdentity(
      manifests({
        packageJson: { dependencies: { next: '^14.0.0', react: '^18.0.0' } },
        tsconfig: {},
      }),
      repo,
    )
    expect(r.framework).toBe('nextjs')
    expect(r.ambiguous).toBe(false)
  })

  // ─────────────────────────────────────────────────
  // 화이트리스트 전환 — A. ambiguous=false 확신 케이스 (improvements §개선1)
  // ─────────────────────────────────────────────────

  it('WL-A1: pubspec.yaml + flutter dep → dart, flutter, ambiguous=false', () => {
    const repo = mkRepo('wl-a1')
    const r = extractIdentity(
      manifests({ pubspecYaml: { dependencies: { flutter: { sdk: 'flutter' } } } }),
      repo,
    )
    expect(r.language).toBe('dart')
    expect(r.framework).toBe('flutter')
    expect(r.ambiguous).toBe(false)
  })

  it('WL-A5: @nestjs/core만 → typescript, nestjs, ambiguous=false', () => {
    const repo = mkRepo('wl-a5', { 'src/main.ts': '' })
    const r = extractIdentity(
      manifests({ packageJson: { dependencies: { '@nestjs/core': '^10' } }, tsconfig: {} }),
      repo,
    )
    expect(r.language).toBe('typescript')
    expect(r.framework).toBe('nestjs')
    expect(r.ambiguous).toBe(false)
  })

  it('WL-A6: next만 → typescript, nextjs, ambiguous=false', () => {
    const repo = mkRepo('wl-a6', { 'src/main.ts': '' })
    const r = extractIdentity(
      manifests({ packageJson: { dependencies: { next: '^14' } }, tsconfig: {} }),
      repo,
    )
    expect(r.language).toBe('typescript')
    expect(r.framework).toBe('nextjs')
    expect(r.ambiguous).toBe(false)
  })

  it('WL-A7: next + react → nextjs, ambiguous=false (react 흡수)', () => {
    const repo = mkRepo('wl-a7', { 'src/main.ts': '' })
    const r = extractIdentity(
      manifests({ packageJson: { dependencies: { next: '^14', react: '^18' } }, tsconfig: {} }),
      repo,
    )
    expect(r.framework).toBe('nextjs')
    expect(r.ambiguous).toBe(false)
  })

  it('WL-A8: fastify만 → typescript, fastify, ambiguous=false', () => {
    const repo = mkRepo('wl-a8', { 'src/main.ts': '' })
    const r = extractIdentity(
      manifests({ packageJson: { dependencies: { fastify: '^4' } }, tsconfig: {} }),
      repo,
    )
    expect(r.language).toBe('typescript')
    expect(r.framework).toBe('fastify')
    expect(r.ambiguous).toBe(false)
  })

  // ─────────────────────────────────────────────────
  // 화이트리스트 전환 — B. ambiguous=true LLM 위임 케이스
  // ─────────────────────────────────────────────────

  it('WL-B1: 매니페스트 0개 → null, null, ambiguous=true', () => {
    const repo = mkRepo('wl-b1')
    const r = extractIdentity(manifests({}), repo)
    expect(r.language).toBe(null)
    expect(r.framework).toBe(null)
    expect(r.ambiguous).toBe(true)
  })

  it('WL-B2: go.mod만 → other(go), other, ambiguous=true', () => {
    const repo = mkRepo('wl-b2')
    const r = extractIdentity(manifests({ otherManifests: ['go.mod'] }), repo)
    expect(r.language).toBe('other')
    expect(r.ambiguous).toBe(true)
  })

  it('WL-B4: package.json + deps={} → javascript, other, ambiguous=true', () => {
    const repo = mkRepo('wl-b4')
    const r = extractIdentity(
      manifests({ packageJson: { dependencies: {} } }),
      repo,
    )
    expect(r.language).toBe('javascript')
    expect(r.framework).toBe('other')
    expect(r.ambiguous).toBe(true)
  })

  it('WL-B5: hono는 지원 backend framework로 식별한다', () => {
    const repo = mkRepo('wl-b5', { 'src/index.ts': '' })
    const r = extractIdentity(
      manifests({ packageJson: { dependencies: { hono: '^3' } }, tsconfig: {} }),
      repo,
    )
    expect(r.language).toBe('typescript')
    expect(r.framework).toBe('hono')
    expect(r.type).toBe('backend')
    expect(r.ambiguous).toBe(false)
  })

  it('WL-B6: @nestjs/core + fastify → typescript, null, ambiguous=true', () => {
    const repo = mkRepo('wl-b6', { 'src/main.ts': '' })
    const r = extractIdentity(
      manifests({ packageJson: { dependencies: { '@nestjs/core': '^10', fastify: '^4' } }, tsconfig: {} }),
      repo,
    )
    expect(r.framework).toBe(null)
    expect(r.ambiguous).toBe(true)
  })

  it('WL-B7: next + @nestjs/core → typescript, null, ambiguous=true', () => {
    const repo = mkRepo('wl-b7', { 'src/main.ts': '' })
    const r = extractIdentity(
      manifests({ packageJson: { dependencies: { next: '^14', '@nestjs/core': '^10' } }, tsconfig: {} }),
      repo,
    )
    expect(r.framework).toBe(null)
    expect(r.ambiguous).toBe(true)
  })

  // ─────────────────────────────────────────────────
  // 화이트리스트 전환 — D. 흡수 규칙 검증
  // ─────────────────────────────────────────────────

  it('WL-D1: next + react → nextjs, ambiguous=false (react 흡수)', () => {
    const repo = mkRepo('wl-d1', { 'src/main.ts': '' })
    const r = extractIdentity(
      manifests({ packageJson: { dependencies: { next: '^14', react: '^18' } }, tsconfig: {} }),
      repo,
    )
    expect(r.framework).toBe('nextjs')
    expect(r.ambiguous).toBe(false)
  })

  it('WL-D2: next + react + react-router-dom → nextjs, ambiguous=false', () => {
    const repo = mkRepo('wl-d2', { 'src/main.ts': '' })
    const r = extractIdentity(
      manifests({ packageJson: { dependencies: { next: '^14', react: '^18', 'react-router-dom': '^6' } }, tsconfig: {} }),
      repo,
    )
    expect(r.framework).toBe('nextjs')
    expect(r.ambiguous).toBe(false)
  })

  it('WL-J1: pom.xml + spring annotations → java + spring backend', () => {
    const repo = mkRepo('wl-j1', {
      'pom.xml': '<project/>',
      'src/main/java/com/acme/App.java': '@SpringBootApplication class App {}',
      'src/main/java/com/acme/UserController.java': '@RestController class UserController {}',
    })
    const r = extractIdentity(manifests({ otherManifests: ['pom.xml'] }), repo)
    expect(r.language).toBe('java')
    expect(r.framework).toBe('spring')
    expect(r.type).toBe('backend')
    expect(r.ambiguous).toBe(false)
  })

  it('WL-J2: build.gradle.kts + spring annotation → kotlin + spring', () => {
    const repo = mkRepo('wl-j2', {
      'build.gradle.kts': 'plugins { kotlin(\"jvm\") }',
      'src/main/kotlin/com/acme/App.kt': '@SpringBootApplication class App',
    })
    const r = extractIdentity(manifests({ otherManifests: ['build.gradle.kts'] }), repo)
    expect(r.language).toBe('kotlin')
    expect(r.framework).toBe('spring')
    expect(r.type).toBe('backend')
  })

  it('WL-J3: Spring manifest dependency without annotation sample → spring backend', () => {
    const repo = mkRepo('wl-j3', {
      'pom.xml': '<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>',
      'src/main/java/com/acme/App.java': 'class App {}',
    })
    const r = extractIdentity(manifests({ otherManifests: ['pom.xml'] }), repo)
    expect(r.language).toBe('java')
    expect(r.framework).toBe('spring')
    expect(r.type).toBe('backend')
    expect(r.ambiguous).toBe(false)
  })

  it('WL-J4: Spring scheduling/listener annotations are Spring source signals', () => {
    const repo = mkRepo('wl-j4', {
      'pom.xml': '<project/>',
      'src/main/java/com/acme/jobs/BillingJob.java': 'class BillingJob { @Scheduled(cron = "0 0 * * * *") void reconcile() {} }',
      'src/main/java/com/acme/events/OrderListener.java': 'class OrderListener { @EventListener(OrderPaidEvent.class) void onOrderPaid() {} }',
    })
    const r = extractIdentity(manifests({ otherManifests: ['pom.xml'] }), repo)
    expect(r.language).toBe('java')
    expect(r.framework).toBe('spring')
    expect(r.type).toBe('backend')
    expect(r.ambiguous).toBe(false)
  })

  it('WL-J5: Spring messaging annotations are Spring source signals', () => {
    const repo = mkRepo('wl-j5', {
      'pom.xml': '<project/>',
      'src/main/java/com/acme/ws/ChatSocket.java': 'class ChatSocket { @MessageMapping("/chat.send") void send(ChatMessage message) {} }',
    })
    const r = extractIdentity(manifests({ otherManifests: ['pom.xml'] }), repo)
    expect(r.language).toBe('java')
    expect(r.framework).toBe('spring')
    expect(r.type).toBe('backend')
    expect(r.ambiguous).toBe(false)
  })

  it('WL-J6: Spring controller advice exception handlers are Spring source signals', () => {
    const repo = mkRepo('wl-j6', {
      'pom.xml': '<project/>',
      'src/main/java/com/acme/errors/ApiErrorAdvice.java': '@RestControllerAdvice class ApiErrorAdvice { @ExceptionHandler(IllegalArgumentException.class) ErrorDto handle() { return new ErrorDto(); } }',
    })
    const r = extractIdentity(manifests({ otherManifests: ['pom.xml'] }), repo)
    expect(r.language).toBe('java')
    expect(r.framework).toBe('spring')
    expect(r.type).toBe('backend')
    expect(r.ambiguous).toBe(false)
  })
})
