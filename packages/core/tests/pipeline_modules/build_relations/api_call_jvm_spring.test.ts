/**
 * build_relations — JVM/Spring api_call recognition (G1)
 * SOT: specs/build_relations/jvm_recognition.md §4 + §10c
 *
 * Spring RestTemplate is a DI'd field: `private RestTemplate rt; ... this.rt.getForObject(url, ...)`.
 * Recognition is receiver-TYPE based (field `rt` typed `RestTemplate`), NOT coarse file-import presence,
 * and maps Spring verbs (getForObject → GET) which are NOT bare HTTP method names.
 */

import { beforeAll, describe, it, expect } from 'vitest'
import { JvmAstParserAdapter } from '@/pipeline_modules/build_graph/adapters/jvm_ast.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { extractCandidates } from '@/pipeline_modules/build_relations/candidates/index.js'
import { resolveCandidates } from '@/pipeline_modules/build_relations/resolvers/index.js'
import { normalizeRelations } from '@/pipeline_modules/build_relations/normalize_relations.js'
import type {
  BuildRelationsInputs,
  CodeEdgeLike,
  CodeNodeLike,
  SourceFallback,
} from '@/pipeline_modules/build_relations/types.js'

const REPO_ID = 'repo_jvm_api'
const JAVA_FILE = 'src/main/java/x/OrderClient.java'

function makeNode(id: string, opts: Partial<CodeNodeLike> = {}): CodeNodeLike {
  return {
    id,
    repoId: REPO_ID,
    type: 'method',
    name: id,
    filePath: JAVA_FILE,
    lineStart: 1,
    lineEnd: 10,
    isTest: false,
    parseStatus: 'ok',
    ...opts,
  }
}

let edgeId = 70_000
function makeEdge(sourceId: string, relation: string, opts: Partial<CodeEdgeLike> = {}): CodeEdgeLike {
  return {
    id: edgeId++,
    repoId: REPO_ID,
    sourceId,
    targetId: null,
    relation,
    targetSpecifier: null,
    targetSymbol: null,
    typeRefSubtype: null,
    chainPath: null,
    firstArg: null,
    literalArgs: null,
    argExpressions: null,
    resolveStatus: 'pending',
    confidence: null,
    source: 'static',
    ...opts,
  }
}

function makeInputs(nodes: CodeNodeLike[], edges: CodeEdgeLike[]): BuildRelationsInputs {
  return { repoId: REPO_ID, repoPath: null, includeTestSources: false, nodes, edges, models: [] }
}

function runPipeline(inputs: BuildRelationsInputs, sourceFallback?: Partial<SourceFallback>) {
  const index = buildSemanticIndex(inputs)
  const candidates = extractCandidates(inputs, index)
  const relations = resolveCandidates(candidates, index, { resolveConstant: () => null, ...sourceFallback })
  return normalizeRelations(relations)
}

/**
 * Build a JVM-shaped graph for one controller class with a DI'd HTTP/DB field and one call.
 * Mirrors exactly what JvmAstParserAdapter emits (property field node 'Class.field', class→field
 * contains, field type_ref subtype null, this.field.<verb> calls edge with chain_path 'this.field').
 */
function jvmClass(opts: {
  className: string
  fieldName: string
  fieldType: string
  fieldPackage?: string | null
  callVerb: string
  callArg: string | null
}): { nodes: CodeNodeLike[]; edges: CodeEdgeLike[] } {
  const clsId = `r:${JAVA_FILE}:${opts.className}`
  const fieldId = `r:${JAVA_FILE}:${opts.className}.${opts.fieldName}`
  const methodId = `r:${JAVA_FILE}:${opts.className}.handle`
  const nodes = [
    makeNode(clsId, { type: 'class', name: opts.className }),
    makeNode(fieldId, { type: 'property', name: `${opts.className}.${opts.fieldName}` }),
    makeNode(methodId, { type: 'method', name: `${opts.className}.handle` }),
  ]
  const edges = [
    makeEdge(clsId, 'contains', { targetId: fieldId, targetSymbol: opts.fieldName }),
    makeEdge(clsId, 'contains', { targetId: methodId, targetSymbol: 'handle' }),
    makeEdge(fieldId, 'type_ref', { targetSymbol: opts.fieldType, targetSpecifier: opts.fieldPackage ?? null, typeRefSubtype: null }),
    makeEdge(methodId, 'calls', {
      targetSymbol: opts.callVerb,
      chainPath: `this.${opts.fieldName}`,
      firstArg: opts.callArg,
      resolveStatus: 'pending',
    }),
  ]
  return { nodes, edges }
}

describe('G1 — JVM/Spring api_call recognition (synthetic graph)', () => {
  it('S1: this.rt.getForObject("/api/orders") on a RestTemplate field → api_call GET', () => {
    const { nodes, edges } = jvmClass({
      className: 'OrderClient',
      fieldName: 'rt',
      fieldType: 'RestTemplate',
      fieldPackage: 'org.springframework.web.client',
      callVerb: 'getForObject',
      callArg: '/api/orders',
    })
    const relations = runPipeline(makeInputs(nodes, edges))
    const apiCalls = relations.filter((r) => r.kind === 'api_call')
    expect(apiCalls).toHaveLength(1)
    expect(apiCalls[0].operation).toBe('GET')
    expect(apiCalls[0].target).toBe('/api/orders')
  })

  it('S2: this.client.postForEntity("/api/orders", body) → api_call POST', () => {
    const { nodes, edges } = jvmClass({
      className: 'OrderClient',
      fieldName: 'client',
      fieldType: 'RestTemplate',
      fieldPackage: 'org.springframework.web.client',
      callVerb: 'postForEntity',
      callArg: '/api/orders',
    })
    const relations = runPipeline(makeInputs(nodes, edges))
    const apiCalls = relations.filter((r) => r.kind === 'api_call')
    expect(apiCalls).toHaveLength(1)
    expect(apiCalls[0].operation).toBe('POST')
  })

  it('N1 (PRECISION): this.repo.findById(id) on an OrderRepository field → NOT api_call, even if the file imports RestTemplate', () => {
    // This is the regression a coarse file-import mirror would cause; the receiver-type anchor must reject it.
    const { nodes, edges } = jvmClass({
      className: 'OrderService',
      fieldName: 'repo',
      fieldType: 'OrderRepository',
      fieldPackage: 'com.acme.repo',
      callVerb: 'findById',
      callArg: null,
    })
    // file also imports RestTemplate (the trap)
    const fileNode = makeNode(`r:${JAVA_FILE}`, { type: 'file', name: 'OrderClient.java' })
    edges.push(makeEdge(fileNode.id, 'imports', { targetSymbol: 'RestTemplate', targetSpecifier: 'org.springframework.web.client.RestTemplate' }))
    const relations = runPipeline(makeInputs([...nodes, fileNode], edges))
    expect(relations.filter((r) => r.kind === 'api_call')).toHaveLength(0)
  })

  it('N2 (PRECISION): RestTemplate verb on a non-JVM (.ts) file is ignored (adapter is JVM-only)', () => {
    const clsId = 'r:svc.ts:Client'
    const fieldId = 'r:svc.ts:Client.rt'
    const methodId = 'r:svc.ts:Client.handle'
    const tsFile = 'src/client.service.ts'
    const nodes = [
      makeNode(clsId, { type: 'class', name: 'Client', filePath: tsFile }),
      makeNode(fieldId, { type: 'property', name: 'Client.rt', filePath: tsFile }),
      makeNode(methodId, { type: 'method', name: 'Client.handle', filePath: tsFile }),
    ]
    const edges = [
      makeEdge(clsId, 'contains', { targetId: fieldId, targetSymbol: 'rt' }),
      makeEdge(clsId, 'contains', { targetId: methodId, targetSymbol: 'handle' }),
      // TS DI path: uses_type (so classFieldOrigins would carry typeName 'RestTemplate' via the TS branch)
      makeEdge(fieldId, 'uses_type', { targetSymbol: 'RestTemplate' }),
      makeEdge(methodId, 'calls', { targetSymbol: 'getForObject', chainPath: 'this.rt', firstArg: '/api/x', resolveStatus: 'pending' }),
    ]
    const relations = runPipeline(makeInputs(nodes, edges))
    expect(relations.filter((r) => r.kind === 'api_call')).toHaveLength(0)
  })
})

describe('G1 — JVM/Spring api_call recognition (real JvmAstParserAdapter parse)', () => {
  let adapter: JvmAstParserAdapter
  beforeAll(async () => { adapter = await JvmAstParserAdapter.create() })

  it('parses a real Spring RestTemplate client and emits api_call GET (end-to-end build_graph → build_relations)', () => {
    const parsed = adapter.parseFile(
      `package com.acme;
import org.springframework.web.client.RestTemplate;

class OrderClient {
  private final RestTemplate restTemplate;
  OrderClient(RestTemplate restTemplate) { this.restTemplate = restTemplate; }
  OrderDto fetch(Long id) {
    return this.restTemplate.getForObject("/api/orders", OrderDto.class);
  }
}`,
      'src/main/java/com/acme/OrderClient.java',
      REPO_ID,
    )

    const nodes: CodeNodeLike[] = parsed.nodes.map((n) => ({
      id: n.id,
      repoId: n.repo_id,
      type: n.type,
      name: n.name,
      filePath: n.file_path,
      lineStart: n.line_start,
      lineEnd: n.line_end,
      isTest: n.is_test,
      parseStatus: n.parse_status,
    }))
    let i = 80_000
    const edges: CodeEdgeLike[] = parsed.edges.map((e) => ({
      id: i++,
      repoId: e.repo_id,
      sourceId: e.source_id,
      targetId: e.target_id,
      relation: e.relation,
      targetSpecifier: e.target_specifier,
      targetSymbol: e.target_symbol,
      typeRefSubtype: e.type_ref_subtype ?? null,
      chainPath: e.chain_path ?? null,
      firstArg: e.first_arg ?? null,
      literalArgs: e.literal_args ?? null,
      argExpressions: e.arg_expressions ?? null,
      resolveStatus: e.resolve_status === 'n/a' ? 'pending' : e.resolve_status,
      confidence: e.confidence ?? null,
      source: e.source ?? 'static',
    }))

    const relations = runPipeline(makeInputs(nodes, edges))
    const apiCalls = relations.filter((r) => r.kind === 'api_call')
    expect(apiCalls, 'one api_call from the real Spring parse').toHaveLength(1)
    expect(apiCalls[0].operation).toBe('GET')
    expect(apiCalls[0].target).toBe('/api/orders')
  })
})
