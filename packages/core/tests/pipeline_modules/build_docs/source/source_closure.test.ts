import { describe, expect, it } from 'vitest'
import { createTestDb, type DB } from '../../../server/helpers.js'
import { codeBundles, entryPoints } from '@/db/schema/build_route.js'
import { codeEdges, codeNodes } from '@/db/schema/code_graph.js'
import { projects, repositories } from '@/db/schema/core.js'
import { collectSourceClosure } from '@/pipeline_modules/build_docs/source/source_closure.js'

const now = '2026-06-02T00:00:00.000Z'

// build_docs_generation의 소스 클로저는 build_route가 만든 route 단위 번들(code_bundles)만 본다.
// 자체적으로 code_edges를 다시 walk하지 않는다 — 그건 build_route 도달성과 표류했다(renders/DI 누락의 근원).
function setupBundleVsEdge(): DB {
  const db = createTestDb()
  db.insert(projects).values({ id: 'p', name: 'p', createdAt: now, updatedAt: now }).run()
  db.insert(repositories).values({
    id: 'r', projectId: 'p', name: 'r', repoPath: '/tmp/r', framework: 'nestjs',
    analysisBranch: 'main', lastSyncedCommit: 'c', createdAt: now, updatedAt: now,
  }).run()
  const mkNode = (id: string, name: string) => ({
    id, repoId: 'r', type: 'method' as const, filePath: `${id}.ts`, name,
    lineStart: 1, lineEnd: 2, signature: name, docComment: null, exported: true,
    isDefaultExport: false, isAsync: false, isTest: false, parseStatus: 'ok' as const, createdAt: now,
  })
  db.insert(codeNodes).values([
    mkNode('handler', 'Handler.get'),
    mkNode('inBundle', 'Service.get'),
    mkNode('notInBundle', 'Sibling.get'),
  ]).run()
  db.insert(entryPoints).values({
    id: 'ep', repoId: 'r', framework: 'nestjs', kind: 'api', httpMethod: 'GET',
    path: '/x', fullPath: '/x', handlerNodeId: 'handler', metadata: {},
    detectionSource: 'rule:test', confidence: 'high',
    detectionEvidence: { matchedNodeIds: ['handler'] }, createdAt: now,
  }).run()
  // build_route 번들: handler(0) + inBundle(1). notInBundle은 번들에 없음.
  db.insert(codeBundles).values([
    { entryPointId: 'ep', nodeId: 'handler', depth: 0, edgePath: ['handler'] },
    { entryPointId: 'ep', nodeId: 'inBundle', depth: 1, edgePath: ['handler', 'inBundle'] },
  ]).run()
  // inBundle → notInBundle calls 엣지가 있어도, 번들에 없으니 클로저에 들어오면 안 된다.
  const mkEdge = (sourceId: string, targetId: string, sym: string) => ({
    repoId: 'r', sourceId, targetId, relation: 'calls' as const, targetSpecifier: sym,
    targetSymbol: sym, chainPath: sym, resolveStatus: 'resolved' as const,
    confidence: 'high' as const, source: 'static' as const, createdAt: now,
  })
  db.insert(codeEdges).values([
    mkEdge('handler', 'inBundle', 'Service.get'),
    mkEdge('inBundle', 'notInBundle', 'Sibling.get'),
  ]).run()
  return db
}

describe('collectSourceClosure (route bundle only)', () => {
  it('returns exactly the route bundle and does NOT re-walk edges beyond it', () => {
    const db = setupBundleVsEdge()
    const closure = collectSourceClosure({
      db, repoId: 'r', seedNodeIds: ['handler'], entryPointIds: ['ep'],
      codeRelationFacts: [], repoPath: null,
    })
    // notInBundle은 inBundle→notInBundle calls 엣지로 닿지만 번들 밖이라 제외된다.
    expect(closure.map((node) => node.nodeId).sort()).toEqual(['handler', 'inBundle'])
  })

  it('keeps the entry-point seed even when the bundle is empty', () => {
    const db = setupBundleVsEdge()
    const closure = collectSourceClosure({
      db, repoId: 'r', seedNodeIds: ['handler'], entryPointIds: [],
      codeRelationFacts: [], repoPath: null,
    })
    expect(closure.map((node) => node.nodeId)).toEqual(['handler'])
  })
})
