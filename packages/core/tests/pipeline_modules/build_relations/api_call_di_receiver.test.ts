import { describe, it, expect } from 'vitest'
import type { BuildRelationsInputs, CodeNodeLike, CodeEdgeLike } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { extractCandidates } from '@/pipeline_modules/build_relations/candidates/index.js'
import { resolveCandidates } from '@/pipeline_modules/build_relations/resolvers/index.js'
import { normalizeRelations } from '@/pipeline_modules/build_relations/normalize_relations.js'

// R1 — api_call receiver-resolution for a DI-injected class field (NestJS `this.httpService.post(...)`). The
// receiver `httpService` is not imported and not a wrapper node — it is a constructor-DI field typed
// `HttpService` (@nestjs/axios). The api anchor must resolve it via classFieldOrigins (its declared type/package),
// the same way db resolves `this.prismaService`. See specs/refactor/r1-api-call-di-receiver.md.

const REPO = 'repo_di'
let edgeId = 9000
function node(p: Partial<CodeNodeLike> & Pick<CodeNodeLike, 'id'>): CodeNodeLike {
  return { repoId: REPO, type: 'method', name: p.id.split(':').pop() ?? p.id, filePath: 'src/svc.ts', lineStart: 1, lineEnd: 10, isTest: false, parseStatus: 'ok', ...p } as CodeNodeLike
}
function edge(sourceId: string, relation: CodeEdgeLike['relation'], p: Partial<CodeEdgeLike> = {}): CodeEdgeLike {
  return { id: edgeId++, repoId: REPO, sourceId, targetId: null, relation, targetSpecifier: null, targetSymbol: null,
    typeRefSubtype: null, chainPath: null, firstArg: null, literalArgs: null, argExpressions: null, resolveStatus: 'resolved', confidence: null, source: 'static', ...p } as CodeEdgeLike
}

// The REAL build_graph shape for `constructor(private readonly httpService: <Type>) {}` (TS parameter-property):
// a `property` node `Svc.httpService` carrying a `type_ref` edge → <Type>[<pkg>] (NOT a constructor uses_type;
// verified against heroines_back/src/apiv1/external/external.service.ts where classFieldOrigins is empty and the
// field's type lives on a type_ref off the property node). m() { this.httpService.post('/api/data') }.
function nestServiceRepo(opts: { typeName: string; pkg: string | null }) {
  edgeId = 9000
  const cls = node({ id: `${REPO}:src/svc.ts:Svc`, type: 'class', name: 'Svc' })
  const field = node({ id: `${REPO}:src/svc.ts:Svc.httpService`, type: 'property', name: 'Svc.httpService' })
  const m = node({ id: `${REPO}:src/svc.ts:Svc.m`, name: 'm' })
  const edges: CodeEdgeLike[] = [
    edge(cls.id, 'contains', { targetId: field.id }),
    edge(cls.id, 'contains', { targetId: m.id }),
    // parameter-property field type → a type_ref off the FIELD node (the real shape; classFieldOrigins misses it)
    edge(field.id, 'type_ref', { targetSymbol: opts.typeName, targetSpecifier: opts.pkg }),
    // the call: this.httpService.post('/api/data')
    edge(m.id, 'calls', { targetSymbol: 'post', chainPath: 'this.httpService', firstArg: '/api/data' }),
  ]
  const inputs: BuildRelationsInputs = { repoId: REPO, repoPath: null, includeTestSources: false, nodes: [cls, field, m], edges, models: [] }
  return inputs
}

function runPipeline(inputs: BuildRelationsInputs) {
  const index = buildSemanticIndex(inputs)
  return normalizeRelations(resolveCandidates(extractCandidates(inputs, index), index, { resolveConstant: () => null }))
}

describe('R1 — api_call from a DI-injected HttpService field (this.httpService.post)', () => {
  it('resolves the receiver via classFieldOrigins type+package → api_call POST /api/data', () => {
    const out = runPipeline(nestServiceRepo({ typeName: 'HttpService', pkg: '@nestjs/axios' }))
    const api = out.filter((r) => r.kind === 'api_call')
    expect(api).toHaveLength(1)
    expect(api[0].operation).toBe('POST')
    expect(api[0].target).toBe('/api/data')
    expect(api[0].canonicalTarget).toBe('POST /api/data')
  })

  it('falls back to the api-client TYPE name when build_graph did not resolve the import package', () => {
    const out = runPipeline(nestServiceRepo({ typeName: 'HttpService', pkg: null }))
    expect(out.filter((r) => r.kind === 'api_call')).toHaveLength(1)
  })

  it('NEGATIVE: a DI field of a NON-api type emits no api_call (resolution is by type, not receiver name)', () => {
    const out = runPipeline(nestServiceRepo({ typeName: 'UserService', pkg: '@app/services' }))
    expect(out.filter((r) => r.kind === 'api_call')).toHaveLength(0)
  })
})
