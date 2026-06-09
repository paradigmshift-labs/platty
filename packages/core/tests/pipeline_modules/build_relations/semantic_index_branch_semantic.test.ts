/**
 * build_relations semantic index branch tests
 * SOT: specs/build_relations/architecture.md §4 F2
 */

import { describe, it, expect } from 'vitest'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import type { BuildRelationsInputs, CodeEdgeLike, CodeNodeLike } from '@/pipeline_modules/build_relations/types.js'

const REPO_ID = 'repo_semantic_index'

function makeNode(id: string, opts: Partial<CodeNodeLike> = {}): CodeNodeLike {
  return {
    id,
    repoId: REPO_ID,
    type: 'method',
    name: id,
    filePath: 'src/service.ts',
    lineStart: 1,
    lineEnd: 10,
    isTest: false,
    parseStatus: 'ok',
    ...opts,
  }
}

let edgeId = 20_000
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

describe('buildSemanticIndex branch behavior', () => {
  it('indexes implements edges separately from other edge kinds', () => {
    const node = makeNode('service')
    const edge = makeEdge(node.id, 'implements', { targetSymbol: 'RepositoryPort' })

    const index = buildSemanticIndex(makeInputs([node], [edge]))

    expect(index.implementsBySource.get(node.id)).toEqual([edge])
  })

  it('skips field-origin extraction when type refs lack parent or type symbol', () => {
    const looseNode = makeNode('loose')
    const service = makeNode('service', { type: 'class' })
    const method = makeNode('method')
    const edges = [
      makeEdge(looseNode.id, 'uses_type', { targetSymbol: 'LooseService' }),
      makeEdge(service.id, 'contains', { targetId: method.id }),
      makeEdge(method.id, 'uses_type'),
    ]

    const index = buildSemanticIndex(makeInputs([looseNode, service, method], edges))

    expect(index.classFieldOrigins.size).toBe(0)
  })

  it('classifies DI, constructor, and class-field origins', () => {
    const service = makeNode('service', { type: 'class' })
    const diMethod = makeNode('diMethod')
    const ctorMethod = makeNode('ctorMethod')
    const fieldMethod = makeNode('fieldMethod')
    const edges = [
      makeEdge(service.id, 'contains', { targetId: diMethod.id }),
      makeEdge(service.id, 'contains', { targetId: ctorMethod.id }),
      makeEdge(service.id, 'contains', { targetId: fieldMethod.id }),
      makeEdge(diMethod.id, 'decorates', { targetSymbol: 'InjectRepository' }),
      makeEdge(diMethod.id, 'uses_type', { targetSymbol: 'UserRepository' }),
      makeEdge(ctorMethod.id, 'type_resolved', { targetSymbol: 'DataSource', targetSpecifier: 'typeorm' }),
      makeEdge(fieldMethod.id, 'uses_type', { targetSymbol: 'CacheService' }),
    ]

    const index = buildSemanticIndex(makeInputs([service, diMethod, ctorMethod, fieldMethod], edges))
    const origins = index.classFieldOrigins.get(service.id)

    expect(origins?.get('userRepository')).toMatchObject({
      fieldName: 'userRepository',
      originKind: 'di',
      typeName: 'UserRepository',
      packageName: null,
    })
    expect(origins?.get('dataSource')).toMatchObject({
      fieldName: 'dataSource',
      originKind: 'constructor',
      typeName: 'DataSource',
      packageName: 'typeorm',
    })
    expect(origins?.get('cacheService')).toMatchObject({
      fieldName: 'cacheService',
      originKind: 'class_field',
      typeName: 'CacheService',
      packageName: null,
    })
  })

  it('JVM: field type_ref (subtype null) on a .java property node → class_field origin keyed by REAL field name', () => {
    // PREREQ-2: JVM fields arrive as type_ref (subtype null) with source = the property node,
    // and the bare name lives in node.name ('OrderClient.rt'). The TS guess-from-type path would
    // mis-key this as 'restTemplate'; build_relations must key it by the real 'rt'.
    const cls = makeNode('r:OrderClient.java:OrderClient', { type: 'class', name: 'OrderClient', filePath: 'src/main/java/x/OrderClient.java' })
    const field = makeNode('r:OrderClient.java:OrderClient.rt', { type: 'property', name: 'OrderClient.rt', filePath: 'src/main/java/x/OrderClient.java' })
    const edges = [
      makeEdge(cls.id, 'contains', { targetId: field.id, targetSymbol: 'rt' }),
      makeEdge(field.id, 'type_ref', { targetSymbol: 'RestTemplate', targetSpecifier: 'org.springframework.web.client', typeRefSubtype: null }),
    ]

    const index = buildSemanticIndex(makeInputs([cls, field], edges))
    const origins = index.classFieldOrigins.get(cls.id)

    expect(origins?.get('rt'), 'JVM field keyed by real bare name').toMatchObject({
      fieldName: 'rt',
      originKind: 'class_field',
      typeName: 'RestTemplate',
    })
    // must NOT also create a wrong guessed-from-type entry
    expect(origins?.get('restTemplate'), 'no type-guessed key for JVM').toBeUndefined()
  })

  it('Kotlin: field type_ref on a .kt property node → class_field origin (real field name)', () => {
    const cls = makeNode('r:Inv.kt:InvoiceClient', { type: 'class', name: 'InvoiceClient', filePath: 'src/main/kotlin/x/Inv.kt' })
    const field = makeNode('r:Inv.kt:InvoiceClient.client', { type: 'property', name: 'InvoiceClient.client', filePath: 'src/main/kotlin/x/Inv.kt' })
    const edges = [
      makeEdge(cls.id, 'contains', { targetId: field.id, targetSymbol: 'client' }),
      makeEdge(field.id, 'type_ref', { targetSymbol: 'WebClient', targetSpecifier: 'org.springframework.web.reactive.function.client', typeRefSubtype: null }),
    ]
    const index = buildSemanticIndex(makeInputs([cls, field], edges))
    expect(index.classFieldOrigins.get(cls.id)?.get('client')).toMatchObject({ fieldName: 'client', originKind: 'class_field', typeName: 'WebClient' })
  })

  it('BYTE-IDENTITY GUARD: a TS/.ts property field type_ref must NOT create a class_field origin (preserves TS/Dart behavior)', () => {
    // TS also emits type_ref(subtype null) for class fields with a property-node source.
    // The JVM branch is extension-gated, so a .ts field must remain unprocessed (TS DI uses uses_type).
    const cls = makeNode('r:svc.ts:UserService', { type: 'class', name: 'UserService', filePath: 'src/user.service.ts' })
    const field = makeNode('r:svc.ts:UserService.repo', { type: 'property', name: 'UserService.repo', filePath: 'src/user.service.ts' })
    const edges = [
      makeEdge(cls.id, 'contains', { targetId: field.id, targetSymbol: 'repo' }),
      makeEdge(field.id, 'type_ref', { targetSymbol: 'UserRepository', typeRefSubtype: null }),
    ]
    const index = buildSemanticIndex(makeInputs([cls, field], edges))
    // No entry from the type_ref field path; classFieldOrigins stays empty for TS field type_refs.
    expect(index.classFieldOrigins.get(cls.id)?.get('repo')).toBeUndefined()
    expect(index.classFieldOrigins.get(cls.id)?.get('userRepository')).toBeUndefined()
  })

  it('Dart byte-identity guard: a .dart property field type_ref must NOT create a class_field origin', () => {
    const cls = makeNode('r:svc.dart:ApiService', { type: 'class', name: 'ApiService', filePath: 'lib/api_service.dart' })
    const field = makeNode('r:svc.dart:ApiService.dio', { type: 'property', name: 'ApiService.dio', filePath: 'lib/api_service.dart' })
    const edges = [
      makeEdge(cls.id, 'contains', { targetId: field.id, targetSymbol: 'dio' }),
      makeEdge(field.id, 'type_ref', { targetSymbol: 'Dio', typeRefSubtype: null }),
    ]
    const index = buildSemanticIndex(makeInputs([cls, field], edges))
    expect(index.classFieldOrigins.get(cls.id)?.get('dio')).toBeUndefined()
  })

  it('classifies Inject and InjectModel decorators as DI origins', () => {
    const service = makeNode('service', { type: 'class' })
    const injectMethod = makeNode('injectMethod')
    const modelMethod = makeNode('modelMethod')
    const edges = [
      makeEdge(service.id, 'contains', { targetId: injectMethod.id }),
      makeEdge(service.id, 'contains', { targetId: modelMethod.id }),
      makeEdge(injectMethod.id, 'decorates', { targetSymbol: 'Inject' }),
      makeEdge(modelMethod.id, 'decorates', { targetSymbol: 'InjectModel' }),
      makeEdge(injectMethod.id, 'uses_type', { targetSymbol: 'CacheService' }),
      makeEdge(modelMethod.id, 'uses_type', { targetSymbol: 'UserModel' }),
    ]

    const index = buildSemanticIndex(makeInputs([service, injectMethod, modelMethod], edges))
    const origins = index.classFieldOrigins.get(service.id)

    expect(origins?.get('cacheService')?.originKind).toBe('di')
    expect(origins?.get('userModel')?.originKind).toBe('di')
  })
})
