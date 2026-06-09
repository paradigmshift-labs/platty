/**
 * D9: F5 Dart cross-file symbol resolution
 *
 * Dart show 없는 `import 'package:X/svc.dart';`은 어댑터가 어떤 symbol 가져오는지 모름.
 * (TS는 `import { X } from './svc'`라 symbol 명시 → import map 어댑터에서 빌드 가능)
 *
 * F5에서 cross-file resolve:
 * - imports edge resolved + target_id=file 노드 → 그 file의 export node들 (top-level: function/class/variable)
 * - calls/type_ref edge target_symbol과 매칭 → target_id 채움 + resolved
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls'
import type { CodeNodeRaw, CodeEdgeRaw, ConstructorDIMap, FieldOriginsMap } from '@/pipeline_modules/build_graph/types'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

interface FileSpec { filePath: string; source: string }

async function runE2E(opts: { files: FileSpec[] }) {
  const allNodes: CodeNodeRaw[] = []
  const allEdges: CodeEdgeRaw[] = []
  const diMap: ConstructorDIMap = new Map()
  const allOrigins: FieldOriginsMap = new Map()

  for (const f of opts.files) {
    const r = await adapter.parseFile(f.source, f.filePath, 'r1')
    allNodes.push(...r.nodes)
    allEdges.push(...r.edges)
    if (r.fieldOrigins) for (const [k, v] of r.fieldOrigins) allOrigins.set(k, v)
  }

  // F3a 시뮬레이션: 'package:heroines/X.dart' → 'lib/X.dart' file 노드 ID
  for (const e of allEdges) {
    if (e.relation !== 'imports') continue
    if (e.target_id) continue
    const spec = e.target_specifier
    if (!spec) continue
    const PKG = 'package:heroines/'
    if (spec.startsWith(PKG)) {
      const libPath = 'lib/' + spec.slice(PKG.length)
      const f = allNodes.find((n) => n.type === 'file' && n.file_path === libPath)
      if (f) {
        e.target_id = f.id
        e.resolve_status = 'resolved'
      }
    }
  }

  const edges = await resolveCalls(allEdges, allNodes, diMap, new Map(), allOrigins)
  return { nodes: allNodes, edges }
}

function findCall(edges: CodeEdgeRaw[], symbol: string, sourceEnds: string) {
  return edges.find(
    (e) => e.relation === 'calls' && e.target_symbol === symbol && e.source_id.endsWith(sourceEnds),
  )
}

describe('D9: F5 Dart cross-file symbol resolution', () => {
  it('DR-1 — top-level function call (svcFn) imported via file-level import → resolved', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'lib/svc.dart',
          source: `void svcFn() {}`,
        },
        {
          filePath: 'lib/x.dart',
          source: `
            import 'package:heroines/svc.dart';
            void caller() {
              svcFn();
            }
          `,
        },
      ],
    })
    const e = findCall(edges, 'svcFn', ':caller')
    expect(e?.resolve_status).toBe('resolved')
    expect(e?.target_id).toMatch(/lib\/svc\.dart:svcFn$/)
  })

  it('DR-2 — top-level class constructor call (Svc()) → resolved (target=class node)', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'lib/svc.dart',
          source: `class Svc { void method() {} }`,
        },
        {
          filePath: 'lib/x.dart',
          source: `
            import 'package:heroines/svc.dart';
            void caller() {
              final s = Svc();
            }
          `,
        },
      ],
    })
    const e = findCall(edges, 'Svc', ':caller')
    expect(e?.resolve_status).toBe('resolved')
    expect(e?.target_id).toMatch(/lib\/svc\.dart:Svc$/)
  })

  it('DR-3 — top-level variable reference (.method() chain) → cross-file resolve', async () => {
    // 단순 reference (final v = myProvider)는 어댑터가 발화 X — known limitation.
    // 대신 method chain (myProvider.X)이면 selector chain으로 발화 → cross-file resolve 가능.
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'lib/state.dart',
          source: `
            class Provider {
              T watch<T>() { throw 0; }
            }
            final myStateProvider = Provider();
          `,
        },
        {
          filePath: 'lib/x.dart',
          source: `
            import 'package:heroines/state.dart';
            void caller() {
              myStateProvider.watch();
            }
          `,
        },
      ],
    })
    // myStateProvider chain root → calls edge에 chain_path='myStateProvider'로 발화.
    // 단 cross-file로 myStateProvider variable 노드 매칭은 D9의 file-level import resolution 영역.
    // 우선 발화는 되어야:
    const cl = edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'watch' && e.source_id.endsWith(':caller'),
    )
    expect(cl).toBeDefined()
  })

  it('DR-4 — symbol이 어느 import file에도 없음 → 기존 fallback (failed/external)', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'lib/svc.dart',
          source: `void svcFn() {}`,
        },
        {
          filePath: 'lib/x.dart',
          source: `
            import 'package:heroines/svc.dart';
            void caller() {
              unknownFn();
            }
          `,
        },
      ],
    })
    const e = findCall(edges, 'unknownFn', ':caller')
    // unknownFn이 svc.dart에 없음 → resolved 안 됨
    expect(e?.resolve_status).not.toBe('resolved')
  })

  it('DR-5 — 다중 import file 중 정확한 file의 export로 매칭', async () => {
    const { edges } = await runE2E({
      files: [
        {
          filePath: 'lib/a.dart',
          source: `void aFn() {}`,
        },
        {
          filePath: 'lib/b.dart',
          source: `void bFn() {}`,
        },
        {
          filePath: 'lib/x.dart',
          source: `
            import 'package:heroines/a.dart';
            import 'package:heroines/b.dart';
            void caller() {
              aFn();
              bFn();
            }
          `,
        },
      ],
    })
    expect(findCall(edges, 'aFn', ':caller')?.target_id).toMatch(/lib\/a\.dart:aFn$/)
    expect(findCall(edges, 'bFn', ':caller')?.target_id).toMatch(/lib\/b\.dart:bFn$/)
  })
})
