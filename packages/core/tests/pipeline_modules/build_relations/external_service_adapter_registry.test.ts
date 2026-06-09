import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EXTERNAL_SERVICE_DEFINITIONS,
  EXTERNAL_SERVICE_PACKAGE_SET,
  isExternalServiceMethod,
  serviceForPackage,
} from '@/pipeline_modules/build_relations/adapters/external/definitions.js'
import { BILLING_SERVICE_DEFINITIONS } from '@/pipeline_modules/build_relations/adapters/external/families/billing.js'
import { COMMUNICATION_SERVICE_DEFINITIONS } from '@/pipeline_modules/build_relations/adapters/external/families/communication.js'
import { IDENTITY_SERVICE_DEFINITIONS } from '@/pipeline_modules/build_relations/adapters/external/families/identity.js'
import { PLATFORM_SERVICE_DEFINITIONS } from '@/pipeline_modules/build_relations/adapters/external/families/platform.js'
import { AMPLITUDE_SERVICE_DEFINITION } from '@/pipeline_modules/build_relations/adapters/external/families/product_analytics_amplitude.js'
import { MIXPANEL_SERVICE_DEFINITION } from '@/pipeline_modules/build_relations/adapters/external/families/product_analytics_mixpanel.js'
import { POSTHOG_SERVICE_DEFINITION } from '@/pipeline_modules/build_relations/adapters/external/families/product_analytics_posthog.js'
import { PRODUCT_ANALYTICS_SERVICE_DEFINITIONS } from '@/pipeline_modules/build_relations/adapters/external/families/product_analytics.js'
import { SEGMENT_SERVICE_DEFINITION } from '@/pipeline_modules/build_relations/adapters/external/families/product_analytics_segment.js'
import { SEARCH_SERVICE_DEFINITIONS } from '@/pipeline_modules/build_relations/adapters/external/families/search.js'
import { STORAGE_SERVICE_DEFINITIONS } from '@/pipeline_modules/build_relations/adapters/external/families/storage.js'
import { EXTERNAL_SERVICE_FAMILY_DEFINITIONS } from '@/pipeline_modules/build_relations/adapters/external/families/index.js'
import { PRODUCT_ANALYTICS_SERVICE_EXTRACTION } from '@/pipeline_modules/build_relations/adapters/external/families/product_analytics_extraction.js'
import { SERVICE_RESOLVER_REGISTRY } from '@/pipeline_modules/build_relations/resolvers/external_service.js'
import {
  BILLING_SERVICE_RESOLVERS,
} from '@/pipeline_modules/build_relations/resolvers/external_service_families/billing.js'
import {
  COMMUNICATION_SERVICE_RESOLVERS,
} from '@/pipeline_modules/build_relations/resolvers/external_service_families/communication.js'
import {
  IDENTITY_SERVICE_RESOLVERS,
} from '@/pipeline_modules/build_relations/resolvers/external_service_families/identity.js'
import {
  PLATFORM_SERVICE_RESOLVERS,
} from '@/pipeline_modules/build_relations/resolvers/external_service_families/platform.js'
import {
  SEARCH_SERVICE_RESOLVERS,
} from '@/pipeline_modules/build_relations/resolvers/external_service_families/search.js'
import {
  STORAGE_SERVICE_RESOLVERS,
} from '@/pipeline_modules/build_relations/resolvers/external_service_families/storage.js'
import {
  EXTERNAL_SERVICE_FAMILY_RESOLVERS,
} from '@/pipeline_modules/build_relations/resolvers/external_service_families/index.js'
import {
  PRODUCT_ANALYTICS_SERVICE_RESOLVERS,
} from '@/pipeline_modules/build_relations/resolvers/external_service_families/product_analytics.js'
import { AMPLITUDE_SERVICE_RESOLVER } from '@/pipeline_modules/build_relations/resolvers/external_service_families/product_analytics_amplitude.js'
import { MIXPANEL_SERVICE_RESOLVER } from '@/pipeline_modules/build_relations/resolvers/external_service_families/product_analytics_mixpanel.js'
import { POSTHOG_SERVICE_RESOLVER } from '@/pipeline_modules/build_relations/resolvers/external_service_families/product_analytics_posthog.js'
import { SEGMENT_SERVICE_RESOLVER } from '@/pipeline_modules/build_relations/resolvers/external_service_families/product_analytics_segment.js'
import { EXTERNAL_SERVICE_FAMILY_EXTRACTIONS } from '@/pipeline_modules/build_relations/adapters/external/families/extraction_index.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { extractExternalServiceCandidates } from '@/pipeline_modules/build_relations/candidates/external_service.js'
import type { BuildRelationsInputs, CodeEdgeLike, CodeNodeLike } from '@/pipeline_modules/build_relations/types.js'

const REPO_ID = 'repo_external_service_registry'
const SOURCE_ROOT = resolve(process.cwd(), 'src/pipeline_modules/build_relations')

function makeNode(id: string, opts: Partial<CodeNodeLike> = {}): CodeNodeLike {
  return {
    id,
    repoId: REPO_ID,
    type: 'function',
    name: id,
    filePath: 'src/analytics.ts',
    lineStart: 1,
    lineEnd: 20,
    isTest: false,
    parseStatus: 'ok',
    ...opts,
  }
}

let edgeId = 1
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

describe('external service adapter registry', () => {
  it('keeps top-level definition and resolver files as family registry facades', () => {
    const definitionsSource = readFileSync(
      resolve(SOURCE_ROOT, 'adapters/external/definitions.ts'),
      'utf-8',
    )
    const resolverSource = readFileSync(
      resolve(SOURCE_ROOT, 'resolvers/external_service.ts'),
      'utf-8',
    )
    const extractorSource = readFileSync(
      resolve(SOURCE_ROOT, 'adapters/external/services.ts'),
      'utf-8',
    )

    expect(definitionsSource).toContain('EXTERNAL_SERVICE_DEFINITIONS = {\n  ...EXTERNAL_SERVICE_FAMILY_DEFINITIONS,\n} satisfies Record<string, ExternalServiceDefinition>')
    expect(definitionsSource).toContain('export type ExternalService = keyof typeof EXTERNAL_SERVICE_DEFINITIONS')
    expect(resolverSource).toContain('SERVICE_RESOLVER_REGISTRY: Record<string, ServiceResolver> = {\n  ...EXTERNAL_SERVICE_FAMILY_RESOLVERS,\n}')
    expect(extractorSource).toContain('EXTERNAL_SERVICE_FAMILY_EXTRACTIONS')
    expect(definitionsSource).not.toMatch(/export type ExternalService =\s*\|/)
    expect(definitionsSource).not.toMatch(/\n  [a-zA-Z_][\w]*:\s*\{\n\s+packages:/)
    expect(definitionsSource).not.toContain('FIREBASE_PACKAGE_ALIASES')
    expect(definitionsSource).not.toContain('isFirebasePackage')
    expect(resolverSource).not.toMatch(/const [A-Z_]+_SERVICE_RESOLVERS:/)
    expect(extractorSource).not.toMatch(/service === ['"][\w_]+['"]/)
    expect(extractorSource).not.toContain('extractS3CommandCandidates')
    expect(extractorSource).not.toContain('extractFirebaseMessagingStreamCandidates')
  })

  it('keeps every external service definition backed by a resolver', () => {
    expect(Object.keys(SERVICE_RESOLVER_REGISTRY).sort()).toEqual(Object.keys(EXTERNAL_SERVICE_DEFINITIONS).sort())
  })

  it('keeps service-specific extraction hooks behind family adapters', () => {
    expect(EXTERNAL_SERVICE_FAMILY_EXTRACTIONS.length).toBeGreaterThanOrEqual(5)
    expect(EXTERNAL_SERVICE_FAMILY_EXTRACTIONS.some((family) => family.extractCandidates)).toBe(true)
    expect(EXTERNAL_SERVICE_FAMILY_EXTRACTIONS.some((family) => family.targetArgs)).toBe(true)
    expect(EXTERNAL_SERVICE_FAMILY_EXTRACTIONS.some((family) => family.detectServicesForCall)).toBe(true)
    expect(EXTERNAL_SERVICE_FAMILY_EXTRACTIONS.every((family) => Array.isArray(family.services) && family.services.length > 0)).toBe(true)
    expect(EXTERNAL_SERVICE_FAMILY_EXTRACTIONS.some((family) =>
      family.services?.includes('amplitude') && family.services.includes('mixpanel'),
    )).toBe(true)
  })

  it('keeps package ownership unique across external service definitions', () => {
    const owners = new Map<string, string>()

    for (const [service, definition] of Object.entries(EXTERNAL_SERVICE_DEFINITIONS)) {
      for (const pkg of definition.packages) {
        expect(owners.get(pkg)).toBeUndefined()
        owners.set(pkg, service)
      }
    }
  })

  it('uses one package definition source for newer SaaS SDK families', () => {
    expect(serviceForPackage('@amplitude/analytics-browser')).toBe('amplitude')
    expect(serviceForPackage('resend')).toBe('email')
    expect(serviceForPackage('@hubspot/api-client')).toBe('hubspot')
    expect(serviceForPackage('firebase/app')).toBe('firebase')
    expect(serviceForPackage('@firebase/messaging')).toBe('firebase')
    expect(serviceForPackage('firebase/firestore')).toBe('firebase')
    expect(EXTERNAL_SERVICE_PACKAGE_SET.has('@amplitude/analytics-browser')).toBe(true)
    expect(EXTERNAL_SERVICE_PACKAGE_SET.has('resend')).toBe(true)
    expect(EXTERNAL_SERVICE_PACKAGE_SET.has('firebase/app')).toBe(true)
    expect(isExternalServiceMethod('amplitude', 'track')).toBe(true)
    expect(isExternalServiceMethod('amplitude', 'init')).toBe(false)
  })

  it('semantic index wrapper detection stays in sync with external service definitions', () => {
    const node = makeNode('recordActivation')
    const edges = [
      makeEdge(node.id, 'imports', { targetSpecifier: '@amplitude/analytics-browser', targetSymbol: 'track' }),
    ]

    const index = buildSemanticIndex(makeInputs([node], edges))

    expect(index.wrapperFunctions.get(node.id)).toMatchObject({
      kind: 'external_service',
      targetPackage: '@amplitude/analytics-browser',
    })
  })

  it('legacy candidate entry point delegates to the shared adapter instead of a stale service list', () => {
    const node = makeNode('recordActivation')
    const edges = [
      makeEdge(node.id, 'imports', { targetSpecifier: '@amplitude/analytics-browser', targetSymbol: 'track' }),
      makeEdge(node.id, 'calls', { targetSymbol: 'track', chainPath: 'track' }),
    ]
    const inputs = makeInputs([node], edges)

    const candidates = extractExternalServiceCandidates(inputs, buildSemanticIndex(inputs))

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      kind: 'external_service',
      payload: { service: 'amplitude', adapter: 'external_service' },
    })
  })

  it('keeps product analytics resolver behavior behind a dedicated family registry', () => {
    expect(Object.keys(EXTERNAL_SERVICE_FAMILY_DEFINITIONS).sort()).toEqual(Object.keys(EXTERNAL_SERVICE_FAMILY_RESOLVERS).sort())
    expect(Object.keys(PRODUCT_ANALYTICS_SERVICE_DEFINITIONS).sort()).toEqual([
      'amplitude',
      'mixpanel',
      'posthog',
      'segment',
    ])
    expect(Object.keys(PRODUCT_ANALYTICS_SERVICE_RESOLVERS).sort()).toEqual([
      'amplitude',
      'mixpanel',
      'posthog',
      'segment',
    ])
    for (const service of Object.keys(PRODUCT_ANALYTICS_SERVICE_DEFINITIONS)) {
      expect(EXTERNAL_SERVICE_FAMILY_DEFINITIONS[service]).toBe(PRODUCT_ANALYTICS_SERVICE_DEFINITIONS[service])
      expect(EXTERNAL_SERVICE_FAMILY_RESOLVERS[service]).toBe(PRODUCT_ANALYTICS_SERVICE_RESOLVERS[service])
    }
    expect(PRODUCT_ANALYTICS_SERVICE_DEFINITIONS.posthog).toBe(POSTHOG_SERVICE_DEFINITION)
    expect(PRODUCT_ANALYTICS_SERVICE_DEFINITIONS.segment).toBe(SEGMENT_SERVICE_DEFINITION)
    expect(PRODUCT_ANALYTICS_SERVICE_DEFINITIONS.mixpanel).toBe(MIXPANEL_SERVICE_DEFINITION)
    expect(PRODUCT_ANALYTICS_SERVICE_DEFINITIONS.amplitude).toBe(AMPLITUDE_SERVICE_DEFINITION)
    expect(PRODUCT_ANALYTICS_SERVICE_RESOLVERS.posthog).toBe(POSTHOG_SERVICE_RESOLVER)
    expect(PRODUCT_ANALYTICS_SERVICE_RESOLVERS.segment).toBe(SEGMENT_SERVICE_RESOLVER)
    expect(PRODUCT_ANALYTICS_SERVICE_RESOLVERS.mixpanel).toBe(MIXPANEL_SERVICE_RESOLVER)
    expect(PRODUCT_ANALYTICS_SERVICE_RESOLVERS.amplitude).toBe(AMPLITUDE_SERVICE_RESOLVER)
    expect(PRODUCT_ANALYTICS_SERVICE_DEFINITIONS.amplitude.packages).toContain('@amplitude/analytics-browser')
    expect(PRODUCT_ANALYTICS_SERVICE_RESOLVERS.amplitude.resourceFor({
      kind: 'external_service',
      sourceNodeId: 'recordActivation',
      evidenceNodeIds: [],
      targetSymbol: 'track',
      payload: { service: 'amplitude' },
    })).toBe('events')
    expect(PRODUCT_ANALYTICS_SERVICE_RESOLVERS.segment.operationFor({
      kind: 'external_service',
      sourceNodeId: 'recordPage',
      evidenceNodeIds: [],
      targetSymbol: 'page',
      payload: { service: 'segment' },
    })).toBe('page_view')
    expect(PRODUCT_ANALYTICS_SERVICE_EXTRACTION.services?.slice().sort()).toEqual(
      Object.keys(PRODUCT_ANALYTICS_SERVICE_DEFINITIONS).sort(),
    )
  })

  it('keeps product analytics central files as SDK provider registries only', () => {
    const definitionRegistrySource = readFileSync(
      resolve(SOURCE_ROOT, 'adapters/external/families/product_analytics.ts'),
      'utf-8',
    )
    const resolverRegistrySource = readFileSync(
      resolve(SOURCE_ROOT, 'resolvers/external_service_families/product_analytics.ts'),
      'utf-8',
    )
    const providerSources = [
      'adapters/external/families/product_analytics_posthog.ts',
      'adapters/external/families/product_analytics_segment.ts',
      'adapters/external/families/product_analytics_mixpanel.ts',
      'adapters/external/families/product_analytics_amplitude.ts',
      'resolvers/external_service_families/product_analytics_posthog.ts',
      'resolvers/external_service_families/product_analytics_segment.ts',
      'resolvers/external_service_families/product_analytics_mixpanel.ts',
      'resolvers/external_service_families/product_analytics_amplitude.ts',
    ].map((path) => readFileSync(resolve(SOURCE_ROOT, path), 'utf-8')).join('\n')

    expect(definitionRegistrySource).toContain('POSTHOG_SERVICE_DEFINITION')
    expect(definitionRegistrySource).toContain('SEGMENT_SERVICE_DEFINITION')
    expect(definitionRegistrySource).toContain('MIXPANEL_SERVICE_DEFINITION')
    expect(definitionRegistrySource).toContain('AMPLITUDE_SERVICE_DEFINITION')
    expect(resolverRegistrySource).toContain('POSTHOG_SERVICE_RESOLVER')
    expect(resolverRegistrySource).toContain('SEGMENT_SERVICE_RESOLVER')
    expect(resolverRegistrySource).toContain('MIXPANEL_SERVICE_RESOLVER')
    expect(resolverRegistrySource).toContain('AMPLITUDE_SERVICE_RESOLVER')
    expect(definitionRegistrySource).not.toContain('@amplitude/analytics-browser')
    expect(definitionRegistrySource).not.toContain('@segment/analytics-node')
    expect(definitionRegistrySource).not.toContain('posthog-node')
    expect(definitionRegistrySource).not.toMatch(/packages:\s*\[/)
    expect(definitionRegistrySource).not.toMatch(/methods:\s*\[/)
    expect(resolverRegistrySource).not.toMatch(/candidate\.targetSymbol ===/)
    expect(providerSources).toContain('@amplitude/analytics-browser')
    expect(providerSources).toContain('@segment/analytics-node')
    expect(providerSources).toContain('posthog-node')
    expect(providerSources).toContain('mixpanel')
    expect(providerSources).toMatch(/candidate\.targetSymbol ===/)
  })

  it('keeps communication and notification services behind a dedicated family registry', () => {
    expect(Object.keys(COMMUNICATION_SERVICE_DEFINITIONS).sort()).toEqual([
      'discord',
      'email',
      'novu',
      'onesignal',
      'slack',
      'twilio',
    ])
    expect(Object.keys(COMMUNICATION_SERVICE_RESOLVERS).sort()).toEqual(Object.keys(COMMUNICATION_SERVICE_DEFINITIONS).sort())
    expect(EXTERNAL_SERVICE_FAMILY_DEFINITIONS.email).toBe(COMMUNICATION_SERVICE_DEFINITIONS.email)
    expect(EXTERNAL_SERVICE_FAMILY_RESOLVERS.onesignal).toBe(COMMUNICATION_SERVICE_RESOLVERS.onesignal)
    expect(serviceForPackage('postmark')).toBe('email')
    expect(serviceForPackage('@onesignal/node-onesignal')).toBe('onesignal')
    expect(COMMUNICATION_SERVICE_RESOLVERS.onesignal.operationFor({
      kind: 'external_service',
      sourceNodeId: 'sendPush',
      evidenceNodeIds: [],
      targetSymbol: 'createNotification',
      payload: { service: 'onesignal' },
    })).toBe('send_notification')
  })

  it('keeps billing services behind a dedicated family registry', () => {
    expect(Object.keys(BILLING_SERVICE_DEFINITIONS).sort()).toEqual([
      'lemonsqueezy',
      'paddle',
      'stripe',
    ])
    expect(Object.keys(BILLING_SERVICE_RESOLVERS).sort()).toEqual(Object.keys(BILLING_SERVICE_DEFINITIONS).sort())
    expect(EXTERNAL_SERVICE_FAMILY_DEFINITIONS.stripe).toBe(BILLING_SERVICE_DEFINITIONS.stripe)
    expect(EXTERNAL_SERVICE_FAMILY_RESOLVERS.lemonsqueezy).toBe(BILLING_SERVICE_RESOLVERS.lemonsqueezy)
    expect(serviceForPackage('stripe')).toBe('stripe')
    expect(serviceForPackage('@paddle/paddle-node-sdk')).toBe('paddle')
    expect(BILLING_SERVICE_RESOLVERS.stripe.operationFor({
      kind: 'external_service',
      sourceNodeId: 'verifyWebhook',
      evidenceNodeIds: [],
      targetSymbol: 'constructEvent',
      chainPath: 'stripe.webhooks.constructEvent',
      payload: { service: 'stripe' },
    })).toBe('verify_webhook')
  })

  it('keeps identity services behind a dedicated family registry', () => {
    expect(Object.keys(IDENTITY_SERVICE_DEFINITIONS).sort()).toEqual([
      'auth0',
      'clerk',
    ])
    expect(Object.keys(IDENTITY_SERVICE_RESOLVERS).sort()).toEqual(Object.keys(IDENTITY_SERVICE_DEFINITIONS).sort())
    expect(EXTERNAL_SERVICE_FAMILY_DEFINITIONS.clerk).toBe(IDENTITY_SERVICE_DEFINITIONS.clerk)
    expect(EXTERNAL_SERVICE_FAMILY_RESOLVERS.auth0).toBe(IDENTITY_SERVICE_RESOLVERS.auth0)
    expect(serviceForPackage('@clerk/backend')).toBe('clerk')
    expect(serviceForPackage('auth0')).toBe('auth0')
    expect(IDENTITY_SERVICE_RESOLVERS.clerk.resourceFor({
      kind: 'external_service',
      sourceNodeId: 'inviteMember',
      evidenceNodeIds: [],
      targetSymbol: 'createOrganizationInvitation',
      chainPath: 'clerkClient.organizations.createOrganizationInvitation',
      payload: { service: 'clerk' },
    })).toBe('organization_invitations')
  })

  it('keeps storage services behind a dedicated family registry', () => {
    expect(Object.keys(STORAGE_SERVICE_DEFINITIONS).sort()).toEqual([
      'cloudinary',
      's3',
      'supabase_storage',
      'uploadthing',
    ])
    expect(Object.keys(STORAGE_SERVICE_RESOLVERS).sort()).toEqual(Object.keys(STORAGE_SERVICE_DEFINITIONS).sort())
    expect(EXTERNAL_SERVICE_FAMILY_DEFINITIONS.s3).toBe(STORAGE_SERVICE_DEFINITIONS.s3)
    expect(EXTERNAL_SERVICE_FAMILY_RESOLVERS.uploadthing).toBe(STORAGE_SERVICE_RESOLVERS.uploadthing)
    expect(serviceForPackage('@aws-sdk/client-s3')).toBe('s3')
    expect(serviceForPackage('uploadthing/server')).toBe('uploadthing')
    expect(STORAGE_SERVICE_RESOLVERS.s3.operationFor({
      kind: 'external_service',
      sourceNodeId: 'uploadAvatar',
      evidenceNodeIds: [],
      targetSymbol: 'putObject',
      payload: { service: 's3' },
    })).toBe('upload')
  })

  it('keeps search services behind a dedicated family registry', () => {
    expect(Object.keys(SEARCH_SERVICE_DEFINITIONS).sort()).toEqual([
      'algolia',
      'elasticsearch',
    ])
    expect(Object.keys(SEARCH_SERVICE_RESOLVERS).sort()).toEqual(Object.keys(SEARCH_SERVICE_DEFINITIONS).sort())
    expect(EXTERNAL_SERVICE_FAMILY_DEFINITIONS.algolia).toBe(SEARCH_SERVICE_DEFINITIONS.algolia)
    expect(EXTERNAL_SERVICE_FAMILY_RESOLVERS.elasticsearch).toBe(SEARCH_SERVICE_RESOLVERS.elasticsearch)
    expect(serviceForPackage('algoliasearch')).toBe('algolia')
    expect(serviceForPackage('@elastic/elasticsearch')).toBe('elasticsearch')
    expect(SEARCH_SERVICE_RESOLVERS.elasticsearch.operationFor({
      kind: 'external_service',
      sourceNodeId: 'createIndex',
      evidenceNodeIds: [],
      targetSymbol: 'create',
      chainPath: 'client.indices.create',
      payload: { service: 'elasticsearch' },
    })).toBe('create_index')
  })

  it('keeps platform services behind a dedicated family registry', () => {
    expect(Object.keys(PLATFORM_SERVICE_DEFINITIONS).sort()).toEqual([
      'firebase',
      'hubspot',
      'launchdarkly',
      'mux',
      'openai',
      'sanity',
      'sentry',
    ])
    expect(Object.keys(PLATFORM_SERVICE_RESOLVERS).sort()).toEqual(Object.keys(PLATFORM_SERVICE_DEFINITIONS).sort())
    expect(EXTERNAL_SERVICE_FAMILY_DEFINITIONS.openai).toBe(PLATFORM_SERVICE_DEFINITIONS.openai)
    expect(EXTERNAL_SERVICE_FAMILY_RESOLVERS.firebase).toBe(PLATFORM_SERVICE_RESOLVERS.firebase)
    expect(serviceForPackage('openai')).toBe('openai')
    expect(serviceForPackage('firebase/app')).toBe('firebase')
    expect(PLATFORM_SERVICE_DEFINITIONS.firebase.packages).toContain('package:firebase_messaging/firebase_messaging.dart')
    expect(PLATFORM_SERVICE_DEFINITIONS.firebase.packagePrefixes).toEqual(['firebase/', '@firebase/'])
    expect(PLATFORM_SERVICE_RESOLVERS.firebase.payloadFor?.({
      kind: 'external_service',
      sourceNodeId: 'registerToken',
      evidenceNodeIds: [],
      targetSymbol: 'getToken',
      payload: { service: 'firebase' },
    }, 'firebase')).toEqual({ firebase_product: 'messaging' })
    expect(PLATFORM_SERVICE_RESOLVERS.openai.operationFor({
      kind: 'external_service',
      sourceNodeId: 'moderateInput',
      evidenceNodeIds: [],
      targetSymbol: 'create',
      chainPath: 'openai.moderations.create',
      payload: { service: 'openai' },
    })).toBe('moderate')
  })
})
