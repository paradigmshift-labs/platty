/**
 * build_relations candidate guard branch tests
 * SOT: specs/build_relations/architecture.md §5
 */

import { describe, it, expect } from 'vitest'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { extractApiCallCandidates } from '@/pipeline_modules/build_relations/candidates/api_call.js'
import { extractDbAccessCandidates } from '@/pipeline_modules/build_relations/candidates/db_access.js'
import { extractEventCandidates } from '@/pipeline_modules/build_relations/candidates/event.js'
import { extractNavigationCandidates } from '@/pipeline_modules/build_relations/candidates/navigation.js'
import { extractExternalLinkCandidates } from '@/pipeline_modules/build_relations/candidates/external_link.js'
import { extractExternalServiceCandidates } from '@/pipeline_modules/build_relations/candidates/external_service.js'
import { extractScheduleTriggerCandidates } from '@/pipeline_modules/build_relations/candidates/schedule_trigger.js'
import type { BuildRelationsInputs, CodeEdgeLike, CodeNodeLike } from '@/pipeline_modules/build_relations/types.js'

const REPO_ID = 'repo_candidate_guard'

function makeNode(id: string, opts: Partial<CodeNodeLike> = {}): CodeNodeLike {
  return {
    id,
    repoId: REPO_ID,
    type: 'method',
    name: id,
    filePath: 'src/page.tsx',
    lineStart: 1,
    lineEnd: 10,
    isTest: false,
    parseStatus: 'ok',
    ...opts,
  }
}

let edgeId = 10_000
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
    resolveStatus: 'resolved',
    confidence: null,
    source: 'static',
    ...opts,
  }
}

function makeInputs(nodes: CodeNodeLike[], edges: CodeEdgeLike[]): BuildRelationsInputs {
  return {
    repoId: REPO_ID,
    repoPath: null,
    includeTestSources: false,
    nodes,
    edges,
    models: [],
  }
}

describe('api_call candidate guards', () => {
  it('skips unsupported, anchorless, targetless, form-external, and dynamic API calls while keeping fetch external URLs', () => {
    const node = makeNode('handler')
    const edges = [
      makeEdge(node.id, 'imports', { targetSpecifier: 'axios' }),
      makeEdge(node.id, 'calls'),
      makeEdge(node.id, 'calls', { targetSymbol: 'post', firstArg: '/api/orders' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'get', chainPath: 'axios' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'get', chainPath: 'axios', firstArg: 'https://api.example.com/orders' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'fetch' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'fetch', firstArg: 'https://api.example.com/orders' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'fetch', firstArg: '`/api/${id}`' }),
      makeEdge(node.id, 'renders', { targetSymbol: 'form', firstArg: 'https://api.example.com/orders' }),
      makeEdge(node.id, 'renders', { targetSymbol: 'form', firstArg: 'orders', literalArgs: '[' }),
    ]
    const inputs = makeInputs([node], edges)

    const candidates = extractApiCallCandidates(inputs, buildSemanticIndex(inputs))

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      kind: 'api_call',
      rawTarget: 'https://api.example.com/orders',
      payload: { method: 'GET', anchor: 'global_fetch' },
    })
  })

  it('falls back to POST when form literal args are malformed', () => {
    const node = makeNode('form')
    const edges = [
      makeEdge(node.id, 'renders', {
        targetSymbol: 'form',
        firstArg: '/api/orders',
        literalArgs: '[',
      }),
    ]
    const inputs = makeInputs([node], edges)

    const candidates = extractApiCallCandidates(inputs, buildSemanticIndex(inputs))

    expect(candidates).toHaveLength(1)
    expect(candidates[0].payload).toMatchObject({ method: 'POST', protocol: 'form_action' })
  })

  it('skips file-level API anchor lookup when same-file node list is missing', () => {
    const importNode = makeNode('imports')
    const node = makeNode('handler')
    const edges = [
      makeEdge(importNode.id, 'imports', { targetSpecifier: 'axios' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'get', chainPath: 'axios', firstArg: '/api/orders' }),
    ]
    const inputs = makeInputs([importNode, node], edges)
    const index = buildSemanticIndex(inputs)
    index.nodesByFile.delete(node.filePath)

    const candidates = extractApiCallCandidates(inputs, index)

    expect(candidates).toHaveLength(0)
  })

  it('uses unknown when a wrapper API client has no target package metadata', () => {
    const wrapper = makeNode('client', { name: 'client', type: 'function' })
    const node = makeNode('handler')
    const edges = [
      makeEdge(node.id, 'calls', { targetSymbol: 'get', chainPath: 'client', firstArg: '/api/orders' }),
    ]
    const inputs = makeInputs([wrapper, node], edges)
    const index = buildSemanticIndex(inputs)
    index.wrapperFunctions.set(wrapper.id, {
      nodeId: wrapper.id,
      kind: 'api_client',
      targetPackage: null,
      receiver: 'client',
    })

    const candidates = extractApiCallCandidates(inputs, index)

    expect(candidates).toHaveLength(1)
    expect(candidates[0].payload).toMatchObject({ anchor: 'unknown' })
  })
})

describe('db_access candidate guards and fallback anchors', () => {
  it('skips calls without method or chain path even when DB imports exist', () => {
    const node = makeNode('db')
    const edges = [
      makeEdge(node.id, 'imports', { targetSpecifier: 'drizzle-orm' }),
      makeEdge(node.id, 'calls'),
      makeEdge(node.id, 'calls', { targetSymbol: 'insert' }),
    ]
    const inputs = makeInputs([node], edges)

    const candidates = extractDbAccessCandidates(inputs, buildSemanticIndex(inputs))

    expect(candidates).toHaveLength(0)
  })

  it('skips tx aliases without direct or parent ORM imports', () => {
    const service = makeNode('service', { type: 'class' })
    const method = makeNode('method')
    const edges = [
      makeEdge(service.id, 'contains', { targetId: method.id }),
      makeEdge(method.id, 'calls', { targetSymbol: 'insert', chainPath: 'tx', firstArg: 'orders' }),
    ]
    const inputs = makeInputs([service, method], edges)

    const candidates = extractDbAccessCandidates(inputs, buildSemanticIndex(inputs))

    expect(candidates).toHaveLength(0)
  })

  it('skips malformed this chains that do not contain a field name', () => {
    const node = makeNode('db')
    const edges = [
      makeEdge(node.id, 'imports', { targetSpecifier: '@prisma/client' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'findMany', chainPath: 'this.' }),
    ]
    const inputs = makeInputs([node], edges)

    const candidates = extractDbAccessCandidates(inputs, buildSemanticIndex(inputs))

    expect(candidates).toHaveLength(0)
  })

  it('keeps null model name when DI decorator lacks arguments and ORM import is direct', () => {
    const node = makeNode('users')
    const edges = [
      makeEdge(node.id, 'imports', { targetSpecifier: 'mongoose' }),
      makeEdge(node.id, 'decorates', { targetSymbol: 'InjectModel' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'find', chainPath: 'this.userModel' }),
    ]
    const inputs = makeInputs([node], edges)

    const candidates = extractDbAccessCandidates(inputs, buildSemanticIndex(inputs))

    expect(candidates).toHaveLength(1)
    expect(candidates[0].payload).toMatchObject({ orm: 'mongoose' })
    expect(candidates[0].payload).not.toHaveProperty('modelName')
  })

  it('uses parent imports for DI-decorated this chains', () => {
    const service = makeNode('service', { type: 'class' })
    const method = makeNode('users')
    const edges = [
      makeEdge(service.id, 'imports', { targetSpecifier: 'typeorm' }),
      makeEdge(service.id, 'contains', { targetId: method.id }),
      makeEdge(method.id, 'decorates', { targetSymbol: 'InjectRepository', firstArg: 'User' }),
      makeEdge(method.id, 'calls', { targetSymbol: 'find', chainPath: 'this.userRepository' }),
    ]
    const inputs = makeInputs([service, method], edges)

    const candidates = extractDbAccessCandidates(inputs, buildSemanticIndex(inputs))

    expect(candidates).toHaveLength(1)
    expect(candidates[0].payload).toMatchObject({ orm: 'typeorm', modelName: 'User' })
  })

  it('returns no file-level ORM anchor when the node is missing from the index', () => {
    const node = makeNode('db')
    const edges = [
      makeEdge(node.id, 'imports', { targetSpecifier: '@prisma/client' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'findMany', chainPath: 'this.prisma.user' }),
    ]
    const inputs = makeInputs([node], edges)
    const index = buildSemanticIndex(inputs)
    index.nodesById.delete(node.id)

    const candidates = extractDbAccessCandidates(inputs, index)

    expect(candidates).toHaveLength(0)
  })

  it('returns no file-level ORM anchor when same-file nodes have no ORM imports', () => {
    const node = makeNode('db')
    const edges = [
      makeEdge(node.id, 'calls', { targetSymbol: 'findMany', chainPath: 'this.prisma.user' }),
    ]
    const inputs = makeInputs([node], edges)

    const candidates = extractDbAccessCandidates(inputs, buildSemanticIndex(inputs))

    expect(candidates).toHaveLength(0)
  })

  it('skips file-level ORM anchor lookup when same-file node list is missing', () => {
    const importNode = makeNode('imports')
    const node = makeNode('db')
    const edges = [
      makeEdge(importNode.id, 'imports', { targetSpecifier: '@prisma/client' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'findMany', chainPath: 'this.prisma.user' }),
    ]
    const inputs = makeInputs([importNode, node], edges)
    const index = buildSemanticIndex(inputs)
    index.nodesByFile.delete(node.filePath)

    const candidates = extractDbAccessCandidates(inputs, index)

    expect(candidates).toHaveLength(0)
  })

  it('classifies ORM type-ref anchors without package metadata', () => {
    const cases = [
      ['prisma', 'PrismaClient'],
      ['typeorm', 'Repository<User>'],
      ['mongoose', 'Model<User>'],
      ['sequelize', 'Sequelize'],
      ['drizzle', 'NodePgDatabase'],
      ['redis', 'IORedis'],
      ['unknown', 'Connection'],
    ] as const

    for (const [orm, typeName] of cases) {
      const node = makeNode(`db-${orm}`)
      const edges = [
        makeEdge(node.id, 'uses_type', { targetSymbol: typeName }),
        makeEdge(node.id, 'calls', { targetSymbol: 'findMany', chainPath: 'this.client.user' }),
      ]
      const inputs = makeInputs([node], edges)

      const candidates = extractDbAccessCandidates(inputs, buildSemanticIndex(inputs))

      expect(candidates).toHaveLength(1)
      expect(candidates[0].payload).toMatchObject({ orm })
    }
  })

  it('falls back to unknown ORM when class field origin has no type metadata', () => {
    const service = makeNode('service', { type: 'class' })
    const node = makeNode('db')
    const edges = [
      makeEdge(service.id, 'contains', { targetId: node.id }),
      makeEdge(node.id, 'calls', { targetSymbol: 'findMany', chainPath: 'this.store.user' }),
    ]
    const inputs = makeInputs([service, node], edges)
    const index = buildSemanticIndex(inputs)
    index.classFieldOrigins.set(service.id, new Map([
      ['store', {
        fieldName: 'store',
        originKind: 'constructor',
        typeName: null,
        packageName: null,
        evidenceNodeIds: [],
      }],
    ]))

    const candidates = extractDbAccessCandidates(inputs, index)

    expect(candidates).toHaveLength(1)
    expect(candidates[0].payload).toMatchObject({ orm: 'unknown' })
  })

  it('skips non-ORM wrapper-looking direct receivers without import evidence', () => {
    const node = makeNode('service')
    const edges = [
      makeEdge(node.id, 'calls', { targetSymbol: 'findMany', chainPath: 'helper.user' }),
    ]
    const inputs = makeInputs([node], edges)

    const candidates = extractDbAccessCandidates(inputs, buildSemanticIndex(inputs))

    expect(candidates).toHaveLength(0)
  })

  it('skips direct receiver anchor lookup when the source node is missing from the index', () => {
    const node = makeNode('direct-missing-node')
    const edges = [
      makeEdge(node.id, 'calls', { targetSymbol: 'findMany', chainPath: 'db.user' }),
    ]
    const inputs = makeInputs([node], edges)
    const index = buildSemanticIndex(inputs)
    index.nodesById.delete(node.id)

    const candidates = extractDbAccessCandidates(inputs, index)

    expect(candidates).toHaveLength(0)
  })

  it('skips direct receiver anchor lookup when same-file nodes are missing', () => {
    const importNode = makeNode('direct-import', { filePath: 'src/direct.ts' })
    const node = makeNode('direct-same-file-missing', { filePath: 'src/direct.ts' })
    const edges = [
      makeEdge(importNode.id, 'imports', { targetSymbol: 'db', targetId: 'db-client' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'findMany', chainPath: 'db.user' }),
    ]
    const inputs = makeInputs([importNode, node], edges)
    const index = buildSemanticIndex(inputs)
    index.nodesByFile.delete(node.filePath)

    const candidates = extractDbAccessCandidates(inputs, index)

    expect(candidates).toHaveLength(0)
  })

  it('direct imported DB client receiver resolves by imported node name or imported file evidence', () => {
    const byNameHandler = makeNode('byNameHandler', { filePath: 'src/by-name.ts' })
    const prismaClient = makeNode('prismaClientNode', { name: 'PrismaClient', filePath: 'src/prisma.ts' })
    const byImportHandler = makeNode('byImportHandler', { filePath: 'src/by-import.ts' })
    const makeClient = makeNode('makeClient', { name: 'makeClient', filePath: 'src/db.ts' })
    const dbFile = makeNode('dbFile', { filePath: 'src/db.ts' })
    const byTypeHandler = makeNode('byTypeHandler', { filePath: 'src/by-type.ts' })
    const typedClient = makeNode('typedClient', { name: 'typedClient', filePath: 'src/typed-db.ts' })
    const byCallHandler = makeNode('byCallHandler', { filePath: 'src/by-call.ts' })
    const callClient = makeNode('callClient', { name: 'callClient', filePath: 'src/call-db.ts' })
    const missingTargetHandler = makeNode('missingTargetHandler', { filePath: 'src/missing-target.ts' })

    const edges = [
      makeEdge(byNameHandler.id, 'imports', { targetSymbol: 'prisma', targetId: prismaClient.id }),
      makeEdge(byNameHandler.id, 'calls', { targetSymbol: 'findMany', chainPath: 'prisma.user' }),
      makeEdge(byImportHandler.id, 'imports', { targetSymbol: 'db', targetId: makeClient.id }),
      makeEdge(byImportHandler.id, 'calls', { targetSymbol: 'findMany', chainPath: 'db.user' }),
      makeEdge(dbFile.id, 'imports', { targetSpecifier: '@prisma/client' }),
      makeEdge(byTypeHandler.id, 'imports', { targetSymbol: 'db', targetId: typedClient.id }),
      makeEdge(byTypeHandler.id, 'calls', { targetSymbol: 'findMany', chainPath: 'db.user' }),
      makeEdge(typedClient.id, 'uses_type', { targetSymbol: 'DataSource' }),
      makeEdge(byCallHandler.id, 'imports', { targetSymbol: 'db', targetId: callClient.id }),
      makeEdge(byCallHandler.id, 'calls', { targetSymbol: 'findMany', chainPath: 'db.user' }),
      makeEdge(callClient.id, 'calls', { targetSymbol: 'PrismaClient' }),
      makeEdge(missingTargetHandler.id, 'imports', { targetSymbol: 'db', targetId: 'missing-db' }),
      makeEdge(missingTargetHandler.id, 'calls', { targetSymbol: 'findMany', chainPath: 'db.user' }),
    ]
    const inputs = makeInputs([
      byNameHandler,
      prismaClient,
      byImportHandler,
      makeClient,
      dbFile,
      byTypeHandler,
      typedClient,
      byCallHandler,
      callClient,
      missingTargetHandler,
    ], edges)

    const candidates = extractDbAccessCandidates(inputs, buildSemanticIndex(inputs))

    expect(candidates.map((candidate) => [candidate.sourceNodeId, candidate.payload.orm])).toEqual(
      expect.arrayContaining([
        [byNameHandler.id, 'prisma'],
        [byImportHandler.id, 'prisma'],
        [byTypeHandler.id, 'typeorm'],
        [byCallHandler.id, 'prisma'],
      ]),
    )
    expect(candidates.some((candidate) => candidate.sourceNodeId === missingTargetHandler.id)).toBe(false)
  })
})

describe('navigation candidate guards', () => {
  it('skips call and render edges without enough navigation evidence', () => {
    const node = makeNode('page')
    const edges = [
      makeEdge(node.id, 'imports', { targetSpecifier: 'next/navigation' }),
      makeEdge(node.id, 'calls'),
      makeEdge(node.id, 'calls', { targetSymbol: 'reload', chainPath: 'router', firstArg: '/orders' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'push', chainPath: 'router' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'push', chainPath: 'router', firstArg: 'https://example.com' }),
      makeEdge(node.id, 'renders'),
      makeEdge(node.id, 'renders', { targetSymbol: 'a' }),
      makeEdge(node.id, 'renders', { targetSymbol: 'a', firstArg: '/internal' }),
      makeEdge(node.id, 'renders', { targetSymbol: 'Link' }),
    ]
    const inputs = makeInputs([node], edges)

    const candidates = extractNavigationCandidates(inputs, buildSemanticIndex(inputs))

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      kind: 'external_link',
      rawTarget: 'https://example.com',
    })
  })

  it('skips internal Link navigation when no router anchor exists', () => {
    const node = makeNode('page')
    const edges = [
      makeEdge(node.id, 'renders', { targetSymbol: 'Link', firstArg: '/orders' }),
    ]
    const inputs = makeInputs([node], edges)

    const candidates = extractNavigationCandidates(inputs, buildSemanticIndex(inputs))

    expect(candidates).toHaveLength(0)
  })

  it('ignores imports without target specifiers during router detection', () => {
    const node = makeNode('page')
    const edges = [
      makeEdge(node.id, 'imports'),
      makeEdge(node.id, 'calls', { targetSymbol: 'push', chainPath: 'router', firstArg: '/orders' }),
    ]
    const inputs = makeInputs([node], edges)

    const candidates = extractNavigationCandidates(inputs, buildSemanticIndex(inputs))

    expect(candidates).toHaveLength(0)
  })

  it('skips file-level router lookup when same-file node list is missing', () => {
    const importNode = makeNode('imports')
    const node = makeNode('page')
    const edges = [
      makeEdge(importNode.id, 'imports', { targetSpecifier: 'next/navigation' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'push', chainPath: 'router', firstArg: '/orders' }),
    ]
    const inputs = makeInputs([importNode, node], edges)
    const index = buildSemanticIndex(inputs)
    index.nodesByFile.delete(node.filePath)

    const candidates = extractNavigationCandidates(inputs, index)

    expect(candidates).toHaveLength(0)
  })

  it('detects external schemes that do not have URL-style schemes', () => {
    const node = makeNode('page')
    const edges = [
      makeEdge(node.id, 'imports', { targetSpecifier: 'url_launcher' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'launchUrl', firstArg: 'mailto:support@example.com' }),
    ]
    const inputs = makeInputs([node], edges)

    const candidates = extractExternalLinkCandidates(inputs, buildSemanticIndex(inputs))

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      kind: 'external_link',
      rawTarget: 'mailto:support@example.com',
      payload: { scheme: 'mailto', method: 'launchUrl' },
    })
  })
})

describe('event candidate fallback branches', () => {
  it('handles missing node/file-node maps and decorator candidates without matching arguments', () => {
    const node = makeNode('events')
    const edges = [
      makeEdge(node.id, 'imports', { targetSpecifier: 'bull' }),
      makeEdge(node.id, 'decorates', { targetSymbol: 'Processor' }),
      makeEdge(node.id, 'decorates', { targetSymbol: 'Process' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'add', firstArg: 'created' }),
    ]
    const inputs = makeInputs([node], edges)
    const missingNodeIndex = buildSemanticIndex(inputs)
    missingNodeIndex.nodesById.delete(node.id)
    const missingFileNodesIndex = buildSemanticIndex(inputs)
    missingFileNodesIndex.nodesByFile.delete(node.filePath)

    expect(extractEventCandidates(inputs, missingNodeIndex)).toHaveLength(0)
    expect(extractEventCandidates(inputs, missingFileNodesIndex)).toHaveLength(0)
    expect(extractEventCandidates(inputs, buildSemanticIndex(inputs))).toHaveLength(0)
  })

  it('uses null queue metadata for Bull publish calls without InjectQueue decorator', () => {
    const node = makeNode('events')
    const edges = [
      makeEdge(node.id, 'imports', { targetSpecifier: 'bull' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'add', firstArg: 'created' }),
    ]
    const inputs = makeInputs([node], edges)

    const candidates = extractEventCandidates(inputs, buildSemanticIndex(inputs))

    expect(candidates).toHaveLength(1)
    expect(candidates[0].payload).toMatchObject({ broker: 'bull', queue: null })
  })
})

describe('external_link candidate guards', () => {
  it('skips calls without launch method or URL', () => {
    const node = makeNode('links', { filePath: 'lib/links.dart' })
    const edges = [
      makeEdge(node.id, 'imports', { targetSpecifier: 'url_launcher' }),
      makeEdge(node.id, 'calls'),
      makeEdge(node.id, 'calls', { targetSymbol: 'parse', firstArg: 'tel:+15551234567' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'launchUrl' }),
    ]
    const inputs = makeInputs([node], edges)

    const candidates = extractExternalLinkCandidates(inputs, buildSemanticIndex(inputs))

    expect(candidates).toHaveLength(0)
  })

  it('records unknown scheme when launcher URL has no scheme prefix', () => {
    const node = makeNode('links', { filePath: 'lib/links.dart' })
    const edges = [
      makeEdge(node.id, 'imports', { targetSpecifier: 'url_launcher' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'launchUrl', firstArg: 'www.example.com' }),
    ]
    const inputs = makeInputs([node], edges)

    const candidates = extractExternalLinkCandidates(inputs, buildSemanticIndex(inputs))

    expect(candidates).toHaveLength(1)
    expect(candidates[0].payload).toMatchObject({ scheme: 'unknown' })
  })

  it('skips launch anchor lookup when same-file node list is missing', () => {
    const importNode = makeNode('imports', { filePath: 'lib/links.dart' })
    const node = makeNode('links', { filePath: 'lib/links.dart' })
    const edges = [
      makeEdge(importNode.id, 'imports', { targetSpecifier: 'url_launcher' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'launchUrl', firstArg: 'tel:+15551234567' }),
    ]
    const inputs = makeInputs([importNode, node], edges)
    const index = buildSemanticIndex(inputs)
    index.nodesByFile.delete(node.filePath)

    const candidates = extractExternalLinkCandidates(inputs, index)

    expect(candidates).toHaveLength(0)
  })
})

describe('external_service candidate guards', () => {
  it('skips unknown packages, missing methods, and unsupported service methods', () => {
    const node = makeNode('service')
    const unsupportedPackage = makeNode('unknownService', { filePath: 'src/unknown.ts' })
    const edges = [
      makeEdge(unsupportedPackage.id, 'imports', { targetSpecifier: 'unknown-sdk' }),
      makeEdge(unsupportedPackage.id, 'calls', { targetSymbol: 'upload', firstArg: 'avatars' }),
      makeEdge(node.id, 'imports', { targetSpecifier: '@aws-sdk/client-s3' }),
      makeEdge(node.id, 'calls'),
      makeEdge(node.id, 'calls', { targetSymbol: 'listBuckets' }),
    ]
    const inputs = makeInputs([node, unsupportedPackage], edges)

    const candidates = extractExternalServiceCandidates(inputs, buildSemanticIndex(inputs))

    expect(candidates).toHaveLength(0)
  })

  it('skips service detection when node or same-file nodes are missing from the index', () => {
    const node = makeNode('service')
    const edges = [
      makeEdge(node.id, 'imports', { targetSpecifier: '@aws-sdk/client-s3' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'putObject', firstArg: 'avatars' }),
    ]
    const inputs = makeInputs([node], edges)
    const missingNodeIndex = buildSemanticIndex(inputs)
    missingNodeIndex.nodesById.delete(node.id)
    const missingFileNodesIndex = buildSemanticIndex(inputs)
    missingFileNodesIndex.nodesByFile.delete(node.filePath)

    expect(extractExternalServiceCandidates(inputs, missingNodeIndex)).toHaveLength(0)
    expect(extractExternalServiceCandidates(inputs, missingFileNodesIndex)).toHaveLength(0)
  })

  it('ignores imports without package specifiers and unsupported firebase methods', () => {
    const node = makeNode('service')
    const edges = [
      makeEdge(node.id, 'imports'),
      makeEdge(node.id, 'imports', { targetSpecifier: 'firebase/app' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'initializeApp' }),
    ]
    const inputs = makeInputs([node], edges)

    const candidates = extractExternalServiceCandidates(inputs, buildSemanticIndex(inputs))

    expect(candidates).toHaveLength(0)
  })

  it('uses an empty call list when a service anchor exists without call index entries', () => {
    const node = makeNode('service')
    const edges = [
      makeEdge(node.id, 'imports', { targetSpecifier: '@aws-sdk/client-s3' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'putObject', firstArg: 'avatars' }),
    ]
    const inputs = makeInputs([node], edges)
    const index = buildSemanticIndex(inputs)
    index.callsBySource.delete(node.id)

    const candidates = extractExternalServiceCandidates(inputs, index)

    expect(candidates).toHaveLength(0)
  })
})

describe('schedule_trigger candidate guards', () => {
  it('skips unsupported decorators and non-scheduler method calls', () => {
    const node = makeNode('job', { filePath: 'src/job.ts' })
    const edges = [
      makeEdge(node.id, 'imports', { targetSpecifier: '@nestjs/schedule' }),
      makeEdge(node.id, 'decorates', { targetSymbol: 'Every', firstArg: '1s' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'addInterval', firstArg: 'job' }),
    ]
    const inputs = makeInputs([node], edges)

    const candidates = extractScheduleTriggerCandidates(inputs, buildSemanticIndex(inputs))

    expect(candidates).toHaveLength(0)
  })

  it('skips schedule anchor lookup when node or same-file nodes are missing', () => {
    const node = makeNode('job', { filePath: 'src/job.ts' })
    const edges = [
      makeEdge(node.id, 'imports', { targetSpecifier: '@nestjs/schedule' }),
      makeEdge(node.id, 'decorates', { targetSymbol: 'Cron', firstArg: '* * * * *' }),
    ]
    const inputs = makeInputs([node], edges)
    const missingNodeIndex = buildSemanticIndex(inputs)
    missingNodeIndex.nodesById.delete(node.id)
    const missingFileNodesIndex = buildSemanticIndex(inputs)
    missingFileNodesIndex.nodesByFile.delete(node.filePath)

    expect(extractScheduleTriggerCandidates(inputs, missingNodeIndex)).toHaveLength(0)
    expect(extractScheduleTriggerCandidates(inputs, missingFileNodesIndex)).toHaveLength(0)
  })
})
