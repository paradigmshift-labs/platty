import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { extractStandardSlots, shouldCallAmbiguousLLM } from '@/pipeline_modules/analyze_repo/f2b_extract_standard_slots.js'
import type { ManifestSet, IdentitySignal, StandardSlots } from '@/pipeline_modules/analyze_repo/types.js'

const TMP = resolve(process.cwd(), '.tmp-test-standard-slots')

function mkRepo(name: string, files: Record<string, string> = {}): string {
  const repoPath = join(TMP, name)
  mkdirSync(repoPath, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const full = join(repoPath, rel)
    mkdirSync(resolve(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return repoPath
}

const baseIdentity = (overrides: Partial<IdentitySignal> = {}): IdentitySignal => ({
  language: 'typescript', language_raw: null,
  framework: 'nestjs', framework_raw: null,
  type: 'backend', orm: null, build_tool: null,
  confidence: 'high', reasoning: '', ambiguous: false,
  ...overrides,
})

beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
})
afterAll(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('extractStandardSlots — 통합', () => {
  it('공통 정적 + nestjs adapter 통합 (path_aliases + entrypoint + controller)', async () => {
    const repo = mkRepo('s1', {
      'src/main.ts': '',
      'src/app.module.ts': '',
      'src/orders/orders.controller.ts': '',
    })
    const manifests: ManifestSet = {
      packageJson: {
        dependencies: { '@nestjs/core': '^10', 'firebase-admin': '^12', stripe: '^10' },
      },
      pubspecYaml: null,
      tsconfig: { compilerOptions: { baseUrl: 'src', paths: { '@/*': ['*'] } } },
      otherManifests: [],
    }
    const r = await extractStandardSlots(manifests, baseIdentity(), repo)
    expect(r.path_aliases).toEqual({ '@/*': '*' })
    expect(r.base_url).toBe('src')
    expect(r.entrypoint_files).toContain('src/main.ts')
    expect(r.routing_libs).toEqual([])
  })

  it('flutter + go_router → routing_libs + routing_files 정적', async () => {
    const repo = mkRepo('s2', {
      'lib/main.dart': "import 'package:go_router/go_router.dart';\nfinal r = GoRouter(routes: []);",
      'lib/screens/home.dart': '',
    })
    const manifests: ManifestSet = {
      packageJson: null,
      pubspecYaml: { dependencies: { flutter: {}, go_router: '^12.0.0', flutter_bloc: '^8' } },
      tsconfig: null,
      otherManifests: [],
    }
    const r = await extractStandardSlots(manifests, baseIdentity({ framework: 'flutter', language: 'dart', type: 'mobile' }), repo)
    expect(r.routing_libs).toEqual(['go_router'])
    expect((r.routing_files ?? []).length).toBeGreaterThan(0)
  })

  it('flutter + GoRouter source without manifest dependency → routing_libs inferred from source', async () => {
    const repo = mkRepo('s2b', {
      'lib/main.dart': "final r = GoRouter(routes: [GoRoute(path: '/home')]);",
    })
    const manifests: ManifestSet = {
      packageJson: null,
      pubspecYaml: { dependencies: { flutter: {} } },
      tsconfig: null,
      otherManifests: [],
    }
    const r = await extractStandardSlots(manifests, baseIdentity({ framework: 'flutter', language: 'dart', type: 'mobile' }), repo)
    expect(r.routing_libs).toEqual(['go_router'])
    expect(r.routing_files).toEqual(['lib/main.dart'])
  })

  it('react no_router (router lib 없음) → 모든 needsLLM=false (★ A1 자격)', async () => {
    const repo = mkRepo('s3', { 'src/main.tsx': '', 'src/pages/Home.tsx': '' })
    const manifests: ManifestSet = {
      packageJson: { dependencies: { react: '^18' } },
      pubspecYaml: null,
      tsconfig: {},
      otherManifests: [],
    }
    const r = await extractStandardSlots(manifests, baseIdentity({ framework: 'react', type: 'frontend' }), repo)
    expect(shouldCallAmbiguousLLM(r)).toBe(false)
  })

  it('nextjs proxy.ts → routing_files 정적, entrypoint_files 제외', async () => {
    const repo = resolve(process.cwd(), 'tests/fixtures/static_analysis/next-proxy-fullcycle')
    const manifests: ManifestSet = {
      packageJson: { dependencies: { next: '^16', react: '^19', 'react-dom': '^19' } },
      pubspecYaml: null,
      tsconfig: {},
      otherManifests: [],
    }
    const r = await extractStandardSlots(
      manifests,
      baseIdentity({ framework: 'nextjs', type: 'frontend' }),
      repo,
    )
    expect(r.routing_files).toContain('proxy.ts')
    expect(r.entrypoint_files).not.toContain('proxy.ts')
  })

  it('nestjs 표준 → shouldCallAmbiguousLLM=true', async () => {
    const repo = mkRepo('s4', {
      'src/main.ts': '',
      'src/x/x.controller.ts': '',
      'src/common/decorators/api-get.ts': "import { applyDecorators, Get } from '@nestjs/common'\nexport const ApiGet = applyDecorators(Get)",
    })
    const manifests: ManifestSet = {
      packageJson: { dependencies: { '@nestjs/core': '^10' } },
      pubspecYaml: null,
      tsconfig: {},
      otherManifests: [],
    }
    const r = await extractStandardSlots(manifests, baseIdentity(), repo)
    expect(shouldCallAmbiguousLLM(r)).toBe(true)
  })

  // static-core: framework='other'/null이어도 throw하지 않고 공통 슬롯(path_aliases/base_url)만 반환
  it('framework=other → 공통 슬롯만 반환 (no throw, framework adapter 미호출)', async () => {
    const repo = mkRepo('s5', { 'tsconfig.json': '{"compilerOptions":{"baseUrl":"src","paths":{"@/*":["./*"]}}}' })
    const r = await extractStandardSlots(
      { packageJson: null, pubspecYaml: null, tsconfig: { compilerOptions: { baseUrl: 'src', paths: { '@/*': ['./*'] } } }, otherManifests: ['go.mod'] },
      baseIdentity({ framework: 'other' }),
      repo,
    )
    expect(r.base_url).toBe('src')
    expect(Object.keys(r.path_aliases).length).toBeGreaterThan(0)
    expect(r.entrypoint_files).toEqual([])
    expect(r.routing_files).toEqual([])
    expect(r.schema_sources).toEqual([])
    expect(r.needsLLMRouting).toBe(false)
    expect(r.needsLLMCustomDecorators).toBe(false)
  })

  it('framework=null → 공통 슬롯만 반환 (no throw)', async () => {
    const repo = mkRepo('s6', {})
    const r = await extractStandardSlots(
      { packageJson: null, pubspecYaml: null, tsconfig: null, otherManifests: [] },
      baseIdentity({ framework: null }),
      repo,
    )
    expect(r.entrypoint_files).toEqual([])
    expect(r.routing_libs).toEqual([])
    expect(r.schema_sources).toEqual([])
  })

  it('pre-aborted signal → AbortError before adapter work', async () => {
    const repo = mkRepo('s7', {})
    const controller = new AbortController()
    controller.abort()

    await expect(
      extractStandardSlots(
        { packageJson: null, pubspecYaml: null, tsconfig: null, otherManifests: [] },
        baseIdentity(),
        repo,
        { signal: controller.signal },
      ),
    ).rejects.toThrow(/Aborted/)
  })

  it('unknown framework with no registered adapter → throw', async () => {
    const repo = mkRepo('s8', {})

    await expect(
      extractStandardSlots(
        { packageJson: null, pubspecYaml: null, tsconfig: null, otherManifests: [] },
        baseIdentity({ framework: 'angular' as never }),
        repo,
      ),
    ).rejects.toThrow(/No adapter/)
  })

  it('non-aborted signal is passed through to adapter extraction', async () => {
    const repo = mkRepo('s9', { 'src/index.ts': '' })
    const controller = new AbortController()

    const r = await extractStandardSlots(
      { packageJson: { dependencies: { express: '^4' } }, pubspecYaml: null, tsconfig: null, otherManifests: [] },
      baseIdentity({ framework: 'express' }),
      repo,
      { signal: controller.signal },
    )

    expect(r.entrypoint_files).toEqual(['src/index.ts'])
  })

  it('shouldCallAmbiguousLLM — 모든 false면 false', () => {
    const slots: StandardSlots = {
      path_aliases: {}, base_url: null, entrypoint_files: [],
      routing_files: [], routing_libs: [], schema_sources: [],
      needsLLMRouting: false, needsLLMCustomDecorators: false,
    }
    expect(shouldCallAmbiguousLLM(slots)).toBe(false)
  })

  it('shouldCallAmbiguousLLM — 하나라도 true면 true', () => {
    const slots: StandardSlots = {
      path_aliases: {}, base_url: null, entrypoint_files: [],
      routing_files: [], routing_libs: [], schema_sources: [],
      needsLLMRouting: true, needsLLMCustomDecorators: false,
    }
    expect(shouldCallAmbiguousLLM(slots)).toBe(true)
  })

  it('spring adapter: entrypoint/routing/schema_sources 추출', async () => {
    const repo = mkRepo('s10', {
      'src/main/kotlin/com/acme/App.kt': '@SpringBootApplication class App',
      'src/main/kotlin/com/acme/UserController.kt': '@RestController @GetMapping(\"/users\") class UserController',
      'src/main/resources/application.yml': 'spring:\\n  datasource:\\n    url: jdbc:postgresql://localhost:5432/app',
    })
    const manifests: ManifestSet = {
      packageJson: null,
      pubspecYaml: null,
      tsconfig: null,
      otherManifests: ['build.gradle.kts'],
    }
    const r = await extractStandardSlots(
      manifests,
      baseIdentity({ framework: 'spring', language: 'kotlin', type: 'backend' }),
      repo,
    )
    expect(r.entrypoint_files).toEqual(['src/main/kotlin/com/acme/App.kt'])
    expect(r.routing_files).toContain('src/main/kotlin/com/acme/UserController.kt')
    expect(r.schema_sources.length).toBeGreaterThan(0)
  })

  it('spring adapter: scheduled jobs and event listeners are routing files', async () => {
    const repo = mkRepo('s11', {
      'src/main/java/com/acme/App.java': '@SpringBootApplication class App {}',
      'src/main/java/com/acme/jobs/BillingJob.java': 'class BillingJob { @Scheduled(cron = "0 0 * * * *") void reconcile() {} }',
      'src/main/java/com/acme/events/OrderListener.java': 'class OrderListener { @EventListener(OrderPaidEvent.class) void onOrderPaid() {} }',
    })
    const manifests: ManifestSet = {
      packageJson: null,
      pubspecYaml: null,
      tsconfig: null,
      otherManifests: ['pom.xml'],
    }
    const r = await extractStandardSlots(
      manifests,
      baseIdentity({ framework: 'spring', language: 'java', type: 'backend' }),
      repo,
    )
    expect(r.routing_files).toEqual(expect.arrayContaining([
      'src/main/java/com/acme/jobs/BillingJob.java',
      'src/main/java/com/acme/events/OrderListener.java',
    ]))
  })

  it('spring adapter: messaging and websocket handlers are routing files', async () => {
    const repo = mkRepo('s11b', {
      'src/main/java/com/acme/App.java': '@SpringBootApplication class App {}',
      'src/main/java/com/acme/ws/ChatSocket.java': 'class ChatSocket { @MessageMapping("/chat.send") void send(ChatMessage message) {} }',
      'src/main/java/com/acme/ws/PresenceSocket.java': 'class PresenceSocket { @SubscribeMapping("/presence") Presence state() { return new Presence(); } }',
    })
    const manifests: ManifestSet = {
      packageJson: null,
      pubspecYaml: null,
      tsconfig: null,
      otherManifests: ['pom.xml'],
    }
    const r = await extractStandardSlots(
      manifests,
      baseIdentity({ framework: 'spring', language: 'java', type: 'backend' }),
      repo,
    )
    expect(r.routing_files).toEqual(expect.arrayContaining([
      'src/main/java/com/acme/ws/ChatSocket.java',
      'src/main/java/com/acme/ws/PresenceSocket.java',
    ]))
  })

  it('spring adapter: WebFlux functional router files are routing files', async () => {
    const repo = mkRepo('s12', {
      'src/main/kotlin/com/acme/App.kt': '@SpringBootApplication class App',
      'src/main/kotlin/com/acme/Routes.kt': 'class Routes { fun route(handler: Handler) = coRouter { GET("/orders", handler::list) } }',
    })
    const manifests: ManifestSet = {
      packageJson: null,
      pubspecYaml: null,
      tsconfig: null,
      otherManifests: ['build.gradle.kts'],
    }
    const r = await extractStandardSlots(
      manifests,
      baseIdentity({ framework: 'spring', language: 'kotlin', type: 'backend' }),
      repo,
    )
    expect(r.routing_files).toContain('src/main/kotlin/com/acme/Routes.kt')
  })

  it('spring adapter: controller advice exception handlers are routing files', async () => {
    const repo = mkRepo('s13', {
      'src/main/java/com/acme/App.java': '@SpringBootApplication class App {}',
      'src/main/java/com/acme/errors/ApiErrorAdvice.java': '@RestControllerAdvice class ApiErrorAdvice { @ExceptionHandler(IllegalArgumentException.class) ErrorDto handle() { return new ErrorDto(); } }',
    })
    const manifests: ManifestSet = {
      packageJson: null,
      pubspecYaml: null,
      tsconfig: null,
      otherManifests: ['pom.xml'],
    }
    const r = await extractStandardSlots(
      manifests,
      baseIdentity({ framework: 'spring', language: 'java', type: 'backend' }),
      repo,
    )
    expect(r.routing_files).toContain('src/main/java/com/acme/errors/ApiErrorAdvice.java')
  })
})
