import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EVENT_BROKER_PACKAGE_DEFINITIONS,
  EVENT_BROKER_PACKAGE_SET,
  eventBrokerForPackage,
} from '@/pipeline_modules/build_relations/adapters/event/families/brokers.js'

const BROKERS_SOURCE_PATH = resolve(
  process.cwd(),
  'src/pipeline_modules/build_relations/adapters/event/brokers.ts',
)
const EXTRACTION_SOURCE_PATH = resolve(
  process.cwd(),
  'src/pipeline_modules/build_relations/adapters/event/families/extraction.ts',
)

describe('event broker adapter registry', () => {
  it('keeps event package ownership in the family registry', () => {
    expect(eventBrokerForPackage('bullmq')).toBe('bull')
    expect(eventBrokerForPackage('bee-queue')).toBe('bull')
    expect(eventBrokerForPackage('kafkajs')).toBe('kafka')
    expect(eventBrokerForPackage('@nestjs/microservices')).toBe('kafka')
    expect(eventBrokerForPackage('amqp-connection-manager')).toBe('rabbitmq')
    expect(eventBrokerForPackage('aws-sdk')).toBe('sqs')
    expect(eventBrokerForPackage('ably/promises')).toBe('ably')
    expect(eventBrokerForPackage('pusher-js')).toBe('pusher')
    expect(eventBrokerForPackage('socket.io-client')).toBe('websocket')
    expect(eventBrokerForPackage('@nestjs/cqrs')).toBe('nestjs_cqrs')
    expect(eventBrokerForPackage('not-a-broker')).toBeNull()
    expect(EVENT_BROKER_PACKAGE_SET.has('ably')).toBe(true)
    expect(EVENT_BROKER_PACKAGE_SET.has('pusher-js')).toBe(true)
  })

  it('keeps broker package ownership unique', () => {
    const owners = new Map<string, string>()

    for (const [broker, definition] of Object.entries(EVENT_BROKER_PACKAGE_DEFINITIONS)) {
      for (const pkg of definition.packages) {
        expect(owners.get(pkg), pkg).toBeUndefined()
        owners.set(pkg, broker)
      }
    }
  })

  it('keeps central broker detection delegated to the registry', () => {
    const source = readFileSync(BROKERS_SOURCE_PATH, 'utf8')
    const detectBrokerSource = source.slice(
      source.indexOf('function detectBroker'),
      source.indexOf('function detectBrowserWebSocketBroker'),
    )

    expect(detectBrokerSource).toContain('eventBrokerForPackage')
    expect(detectBrokerSource).not.toMatch(/pkg\s*===/)
    expect(detectBrokerSource).not.toMatch(/targetSpecifier\s*===/)
    expect(detectBrokerSource).not.toContain('ably/promises')
    expect(detectBrokerSource).not.toContain('pusher-js')
    expect(detectBrokerSource).not.toContain('@nestjs/microservices')
  })

  it('keeps central broker extraction delegated to event family extractors', () => {
    const source = readFileSync(BROKERS_SOURCE_PATH, 'utf8')
    const extractionSource = readFileSync(EXTRACTION_SOURCE_PATH, 'utf8')

    expect(source).toContain('extractEventBrokerFamilyCandidates')
    expect(source).toContain('extractFlutterRealtimeCandidates')
    expect(extractionSource).toContain('EVENT_BROKER_EXTRACTION_FAMILIES')
    expect(extractionSource).toContain("{ name: 'bull_queue', extract: extractBullQueueCandidates }")
    expect(extractionSource).toContain("{ name: 'kafka', extract: extractKafkaCandidates }")
    expect(extractionSource).toContain("{ name: 'rabbitmq', extract: extractRabbitCandidates }")
    expect(extractionSource).toContain("{ name: 'aws_messaging', extract: extractAwsMessagingCandidates }")
    expect(extractionSource).toContain("{ name: 'generic_realtime', extract: extractGenericRealtimeCandidates }")
    expect(extractionSource).toContain('collectPackageImportsForNode')
    expect(extractionSource).not.toContain('bullmq')
    expect(extractionSource).not.toContain('kafkajs')
    expect(extractionSource).not.toContain('amqplib')
    expect(extractionSource).not.toContain('SendMessageCommand')
    expect(extractionSource).not.toContain('sendBatch')
    expect(extractionSource).not.toContain('sendToQueue')
    expect(source).not.toMatch(/hasPackageImport\(node\.id, index, ['"][^'"]+['"]\)/)
    expect(source).not.toContain("call.targetSymbol === 'SendMessageCommand'")
    expect(source).not.toContain("call.targetSymbol === 'PublishCommand'")
    expect(source).not.toContain("call.targetSymbol === 'sendBatch'")
    expect(source).not.toContain("call.targetSymbol === 'sendToQueue'")
    expect(source).not.toContain("broker === 'nestjs_cqrs'")
    expect(source).not.toContain('WebSocketChannel.connect')
    expect(source).not.toContain('socket_io_client')
    expect(source).not.toContain('readFileSync')
  })

  it('keeps semantic wrappers and legacy candidate entry points delegated to event adapters', () => {
    const semanticIndexSource = readFileSync(
      resolve(process.cwd(), 'src/pipeline_modules/build_relations/semantic_index.ts'),
      'utf-8',
    )
    const legacyCandidateSource = readFileSync(
      resolve(process.cwd(), 'src/pipeline_modules/build_relations/candidates/event.ts'),
      'utf-8',
    )

    expect(semanticIndexSource).toContain('EVENT_BROKER_PACKAGE_SET')
    expect(semanticIndexSource).not.toContain('const EVENT_BUS_PACKAGES')
    expect(legacyCandidateSource).toContain('eventBrokerAdapter.extractCandidates')
    expect(legacyCandidateSource).not.toMatch(/pkg === ['"]/)
  })
})
