/**
 * build_relations event / schedule / external_service 시나리오 테스트
 * SOT: specs/build_relations/architecture.md §5.5~§5.7
 * 시나리오: REL-S06, REL-S07, REL-S08, REL-S10~S12, REL-S22~S26
 *           REL-N01, REL-N07, REL-N08, REL-N11, REL-N14, REL-N15
 */

import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BuildRelationsInputs, SourceFallback } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { extractCandidates } from '@/pipeline_modules/build_relations/candidates/index.js'
import { resolveCandidates } from '@/pipeline_modules/build_relations/resolvers/index.js'
import { normalizeRelations } from '@/pipeline_modules/build_relations/normalize_relations.js'
import type { CodeNodeLike, CodeEdgeLike, ModelLookup } from '@/pipeline_modules/build_relations/types.js'

const REPO_ID = 'repo_event'

function makeInputs(partial: {
  nodes: CodeNodeLike[]
  edges: CodeEdgeLike[]
  models?: ModelLookup[]
  repoPath?: string | null
}): BuildRelationsInputs {
  return {
    repoId: REPO_ID,
    repoPath: partial.repoPath ?? null,
    includeTestSources: false,
    nodes: partial.nodes,
    edges: partial.edges,
    models: partial.models ?? [],
  }
}

let edgeId = 3000
function makeNode(id: string, opts: Partial<CodeNodeLike> = {}): CodeNodeLike {
  return {
    id,
    repoId: REPO_ID,
    type: 'method',
    name: id.split(':').pop() ?? id,
    filePath: 'src/worker.ts',
    lineStart: 1,
    lineEnd: 10,
    isTest: false,
    parseStatus: 'ok',
    ...opts,
  }
}

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

function runPipeline(inputs: BuildRelationsInputs, sourceFallback?: Partial<SourceFallback>) {
  const index = buildSemanticIndex(inputs)
  const candidates = extractCandidates(inputs, index)
  const extracted = resolveCandidates(
    candidates,
    index,
    { resolveConstant: () => null, ...sourceFallback },
  )
  return normalizeRelations(extracted)
}

describe('REL-S06: Bull queue publish/listen canonical match', () => {
  it('queue.add + Processor/Process decorators share bull canonical target', () => {
    const publisher = makeNode(`${REPO_ID}:src/mail.ts:sendEmail`)
    const listener = makeNode(`${REPO_ID}:src/mail.processor.ts:handleSend`, { filePath: 'src/mail.processor.ts' })

    const edges = [
      makeEdge(publisher.id, 'imports', { targetSpecifier: 'bull', targetSymbol: 'InjectQueue' }),
      makeEdge(publisher.id, 'decorates', { targetSymbol: 'InjectQueue', firstArg: 'email' }),
      makeEdge(publisher.id, 'calls', { targetSymbol: 'add', chainPath: 'queue', firstArg: 'send' }),
      makeEdge(listener.id, 'imports', { targetSpecifier: 'bull', targetSymbol: 'Processor' }),
      makeEdge(listener.id, 'decorates', { targetSymbol: 'Processor', firstArg: 'email' }),
      makeEdge(listener.id, 'decorates', { targetSymbol: 'Process', firstArg: 'send' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [publisher, listener], edges }))

    expect(result.map((r) => r.kind).sort()).toEqual(['event_listen', 'event_publish'])
    expect(result.every((r) => r.canonicalTarget === 'bull:email/send')).toBe(true)
    expect(result.every((r) => r.payload.adapter === 'event_broker')).toBe(true)
  })

  it('supports Nest standard class Processor plus method Process decorators', () => {
    const processorClass = makeNode(`${REPO_ID}:src/mail.processor.ts:MailProcessor`, {
      type: 'class',
      name: 'MailProcessor',
      filePath: 'src/mail.processor.ts',
    })
    const listener = makeNode(`${REPO_ID}:src/mail.processor.ts:MailProcessor.handleSend`, {
      name: 'MailProcessor.handleSend',
      filePath: 'src/mail.processor.ts',
    })
    const edges = [
      makeEdge(listener.id, 'imports', { targetSpecifier: 'bull', targetSymbol: 'Process' }),
      makeEdge(processorClass.id, 'decorates', { targetSymbol: 'Processor', firstArg: 'email' }),
      makeEdge(listener.id, 'decorates', { targetSymbol: 'Process', firstArg: 'send' }),
      makeEdge(processorClass.id, 'contains', { targetId: listener.id, targetSymbol: 'handleSend' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [processorClass, listener], edges }))

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'event_listen',
        operation: 'process',
        canonicalTarget: 'bull:email/send',
      }),
    ]))
  })

  it('resolves Bull queue names from constructor InjectQueue DI when the publish call is in a method', () => {
    const publisher = makeNode(`${REPO_ID}:src/media-queue.service.ts:MediaQueueService.enqueueTranscode`, {
      name: 'MediaQueueService.enqueueTranscode',
      filePath: 'src/media-queue.service.ts',
    })
    const edges = [
      makeEdge(publisher.id, 'imports', { targetSpecifier: 'bull', targetSymbol: 'Queue' }),
      makeEdge(publisher.id, 'calls', { targetSymbol: 'add', chainPath: 'this.mediaQueue', firstArg: 'transcode' }),
    ]

    const result = runPipeline(makeInputs({
      nodes: [publisher],
      edges,
      repoPath: `${process.cwd()}/tests/fixtures/static_analysis/nest-bull-queue-fullcycle/api`,
    }))

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'event_publish',
        operation: 'publish',
        canonicalTarget: 'bull:media/transcode',
      }),
    ]))
  })
})

describe('NestJS CQRS command dispatch/listen canonical match', () => {
  it('CommandBus.execute(new Command()) publishes to the matching @CommandHandler listener', () => {
    const publisher = makeNode(`${REPO_ID}:src/orders.controller.ts:OrdersController.createInvoice`, {
      name: 'OrdersController.createInvoice',
      filePath: 'src/orders.controller.ts',
    })
    const handler = makeNode(`${REPO_ID}:src/commands/create-invoice.handler.ts:CreateInvoiceHandler.execute`, {
      name: 'CreateInvoiceHandler.execute',
      filePath: 'src/commands/create-invoice.handler.ts',
    })
    const handlerClass = makeNode(`${REPO_ID}:src/commands/create-invoice.handler.ts:CreateInvoiceHandler`, {
      type: 'class',
      name: 'CreateInvoiceHandler',
      filePath: 'src/commands/create-invoice.handler.ts',
    })
    const edges = [
      makeEdge(publisher.id, 'imports', { targetSpecifier: '@nestjs/cqrs', targetSymbol: 'CommandBus' }),
      makeEdge(publisher.id, 'calls', {
        targetSymbol: 'execute',
        chainPath: 'this.commandBus',
        argExpressions: [{ index: 0, kind: 'unknown', raw: 'new CreateInvoiceCommand(body.tenantId)', resolution: 'dynamic' }],
      }),
      makeEdge(handler.id, 'imports', { targetSpecifier: '@nestjs/cqrs', targetSymbol: 'CommandHandler' }),
      makeEdge(handlerClass.id, 'decorates', { targetSymbol: 'CommandHandler', firstArg: 'CreateInvoiceCommand' }),
      makeEdge(handlerClass.id, 'contains', { targetId: handler.id, targetSymbol: 'execute' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [publisher, handlerClass, handler], edges }))

    expect(result.map((r) => r.kind).sort()).toEqual(['event_listen', 'event_publish'])
    expect(result.every((r) => r.canonicalTarget === 'nestjs_cqrs:CreateInvoiceCommand')).toBe(true)
    expect(result.every((r) => r.payload.adapter === 'nestjs_cqrs')).toBe(true)
  })

  it('resolves @CommandHandler(Command) targets from source when decorator args are non-literal graph values', () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'platty-cqrs-'))
    writeFileSync(join(repoPath, 'handler.ts'), `
import { CommandHandler } from '@nestjs/cqrs'

@CommandHandler(CreateInvoiceCommand)
export class CreateInvoiceHandler {
  async execute() {}
}
`)
    const handlerClass = makeNode(`${REPO_ID}:handler.ts:CreateInvoiceHandler`, {
      type: 'class',
      name: 'CreateInvoiceHandler',
      filePath: 'handler.ts',
    })
    const handler = makeNode(`${REPO_ID}:handler.ts:CreateInvoiceHandler.execute`, {
      name: 'CreateInvoiceHandler.execute',
      filePath: 'handler.ts',
    })
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@nestjs/cqrs', targetSymbol: 'CommandHandler' }),
      makeEdge(handlerClass.id, 'decorates', { targetSymbol: 'CommandHandler', firstArg: null }),
      makeEdge(handlerClass.id, 'contains', { targetId: handler.id, targetSymbol: 'execute' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handlerClass, handler], edges, repoPath }))

    expect(result).toEqual([
      expect.objectContaining({
        kind: 'event_listen',
        canonicalTarget: 'nestjs_cqrs:CreateInvoiceCommand',
        payload: expect.objectContaining({ adapter: 'nestjs_cqrs' }),
      }),
    ])
  })
})

describe('BullMQ Queue/Worker split adapter', () => {
  it('Queue constructor plus queue.add emits bullmq publish target with queue/job', () => {
    const publisher = makeNode(`${REPO_ID}:src/mail.queue.ts:enqueueEmail`)
    const edges = [
      makeEdge(publisher.id, 'imports', { targetSpecifier: 'bullmq', targetSymbol: 'Queue' }),
      makeEdge(publisher.id, 'calls', { targetSymbol: 'Queue', chainPath: 'emailQueue', firstArg: 'email' }),
      makeEdge(publisher.id, 'calls', { targetSymbol: 'add', chainPath: 'emailQueue', firstArg: 'send' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [publisher], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'event_publish',
      target: 'email/send',
      canonicalTarget: 'bull:email/send',
      payload: { broker: 'bull', library: 'bullmq', adapter: 'bullmq_queue' },
    })
  })

  it('BullMQ Worker listens to the queue with wildcard job target', () => {
    const worker = makeNode(`${REPO_ID}:src/mail.worker.ts:startWorker`, { filePath: 'src/mail.worker.ts' })
    const edges = [
      makeEdge(worker.id, 'imports', { targetSpecifier: 'bullmq', targetSymbol: 'Worker' }),
      makeEdge(worker.id, 'calls', { targetSymbol: 'Worker', firstArg: 'email' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [worker], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'event_listen',
      target: 'email/*',
      operation: 'process',
      canonicalTarget: 'bull:email/*',
      payload: { broker: 'bull', library: 'bullmq', adapter: 'bullmq_worker' },
    })
  })

  it('Queue.add without Queue constructor binding does not emit an unqualified bull target', () => {
    const publisher = makeNode(`${REPO_ID}:src/mail.queue.ts:enqueueEmail`)
    const edges = [
      makeEdge(publisher.id, 'imports', { targetSpecifier: 'bullmq', targetSymbol: 'Queue' }),
      makeEdge(publisher.id, 'calls', { targetSymbol: 'add', chainPath: 'emailQueue', firstArg: 'send' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [publisher], edges }))
    expect(result.filter((r) => r.kind === 'event_publish')).toHaveLength(0)
  })

  it('Worker without static queue name does not emit listener relation', () => {
    const worker = makeNode(`${REPO_ID}:src/mail.worker.ts:startWorker`, { filePath: 'src/mail.worker.ts' })
    const edges = [
      makeEdge(worker.id, 'imports', { targetSpecifier: 'bullmq', targetSymbol: 'Worker' }),
      makeEdge(worker.id, 'calls', { targetSymbol: 'Worker', firstArg: null }),
    ]

    const result = runPipeline(makeInputs({ nodes: [worker], edges }))
    expect(result.filter((r) => r.kind === 'event_listen')).toHaveLength(0)
  })
})

describe('KafkaJS producer/consumer adapter', () => {
  it('producer.send object topic emits kafka publish relation', () => {
    const publisher = makeNode(`${REPO_ID}:src/orders.producer.ts:publishOrder`)
    const edges = [
      makeEdge(publisher.id, 'imports', { targetSpecifier: 'kafkajs', targetSymbol: 'Kafka' }),
      makeEdge(publisher.id, 'calls', {
        targetSymbol: 'send',
        chainPath: 'producer',
        literalArgs: '[{"topic":"order.created","messages":[]}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [publisher], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'event_publish',
      target: 'order.created',
      canonicalTarget: 'kafka:order.created',
      payload: { broker: 'kafka', adapter: 'event_broker' },
    })
  })

  it('producer.sendBatch emits one kafka publish relation per topicMessage topic', () => {
    const publisher = makeNode(`${REPO_ID}:src/orders.producer.ts:publishBatch`)
    const edges = [
      makeEdge(publisher.id, 'imports', { targetSpecifier: 'kafkajs', targetSymbol: 'Kafka' }),
      makeEdge(publisher.id, 'calls', {
        targetSymbol: 'sendBatch',
        chainPath: 'producer',
        literalArgs: '[{"topicMessages":[{"topic":"order.created"},{"topic":"order.paid"}]}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [publisher], edges }))

    expect(result.map((r) => r.canonicalTarget).sort()).toEqual([
      'kafka:order.created',
      'kafka:order.paid',
    ])
  })

  it('consumer.subscribe topic emits kafka listener relation', () => {
    const consumer = makeNode(`${REPO_ID}:src/orders.consumer.ts:startConsumer`, { filePath: 'src/orders.consumer.ts' })
    const edges = [
      makeEdge(consumer.id, 'imports', { targetSpecifier: 'kafkajs', targetSymbol: 'Kafka' }),
      makeEdge(consumer.id, 'calls', {
        targetSymbol: 'subscribe',
        chainPath: 'consumer',
        literalArgs: '[{"topic":"order.created","fromBeginning":true}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [consumer], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'event_listen',
      operation: 'listen',
      canonicalTarget: 'kafka:order.created',
      payload: { broker: 'kafka' },
    })
  })

  it('producer.send without static topic does not emit kafka publish relation', () => {
    const publisher = makeNode(`${REPO_ID}:src/orders.producer.ts:publishDynamic`)
    const edges = [
      makeEdge(publisher.id, 'imports', { targetSpecifier: 'kafkajs', targetSymbol: 'Kafka' }),
      makeEdge(publisher.id, 'calls', {
        targetSymbol: 'send',
        chainPath: 'producer',
        literalArgs: '[{"topic":null,"messages":[]}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [publisher], edges }))
    expect(result.filter((r) => r.kind === 'event_publish')).toHaveLength(0)
  })
})

describe('RabbitMQ amqplib channel adapter', () => {
  it('channel.publish exchange and routing key emits rabbitmq publish relation', () => {
    const publisher = makeNode(`${REPO_ID}:src/orders.rabbit.ts:publishOrder`)
    const edges = [
      makeEdge(publisher.id, 'imports', { targetSpecifier: 'amqplib', targetSymbol: 'connect' }),
      makeEdge(publisher.id, 'calls', {
        targetSymbol: 'publish',
        chainPath: 'channel',
        firstArg: 'orders',
        literalArgs: '["orders","created"]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [publisher], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'event_publish',
      target: 'orders/created',
      canonicalTarget: 'rabbitmq:orders/created',
      payload: { broker: 'rabbitmq', adapter: 'event_broker' },
    })
  })

  it('channel.sendToQueue emits queue publish relation', () => {
    const publisher = makeNode(`${REPO_ID}:src/mail.rabbit.ts:sendEmail`)
    const edges = [
      makeEdge(publisher.id, 'imports', { targetSpecifier: 'amqplib', targetSymbol: 'connect' }),
      makeEdge(publisher.id, 'calls', {
        targetSymbol: 'sendToQueue',
        chainPath: 'channel',
        firstArg: 'email',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [publisher], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'event_publish',
      canonicalTarget: 'rabbitmq:email',
      payload: { broker: 'rabbitmq' },
    })
  })

  it('channel.consume emits queue listener relation', () => {
    const consumer = makeNode(`${REPO_ID}:src/mail.rabbit.ts:consumeEmail`)
    const edges = [
      makeEdge(consumer.id, 'imports', { targetSpecifier: 'amqplib', targetSymbol: 'connect' }),
      makeEdge(consumer.id, 'calls', {
        targetSymbol: 'consume',
        chainPath: 'channel',
        firstArg: 'email',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [consumer], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'event_listen',
      operation: 'listen',
      canonicalTarget: 'rabbitmq:email',
    })
  })

  it('channel.publish without static exchange does not emit relation', () => {
    const publisher = makeNode(`${REPO_ID}:src/orders.rabbit.ts:publishDynamic`)
    const edges = [
      makeEdge(publisher.id, 'imports', { targetSpecifier: 'amqplib', targetSymbol: 'connect' }),
      makeEdge(publisher.id, 'calls', {
        targetSymbol: 'publish',
        chainPath: 'channel',
        firstArg: null,
        literalArgs: '[null,"created"]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [publisher], edges }))
    expect(result.filter((r) => r.kind === 'event_publish')).toHaveLength(0)
  })
})

describe('AWS SDK v3 event command object adapter', () => {
  it('SendMessageCommand QueueUrl emits sqs publish relation', () => {
    const sender = makeNode(`${REPO_ID}:src/orders.sqs.ts:sendOrder`)
    const edges = [
      makeEdge(sender.id, 'imports', { targetSpecifier: '@aws-sdk/client-sqs', targetSymbol: 'SendMessageCommand' }),
      makeEdge(sender.id, 'calls', {
        targetSymbol: 'SendMessageCommand',
        literalArgs: '[{"QueueUrl":"https://sqs.us-east-1.amazonaws.com/123/orders"}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [sender], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'event_publish',
      operation: 'send',
      canonicalTarget: 'sqs:https://sqs.us-east-1.amazonaws.com/123/orders',
      payload: { broker: 'sqs', adapter: 'event_broker' },
    })
  })

  it('ReceiveMessageCommand QueueUrl emits sqs listener relation', () => {
    const receiver = makeNode(`${REPO_ID}:src/orders.sqs.ts:pollOrders`)
    const edges = [
      makeEdge(receiver.id, 'imports', { targetSpecifier: '@aws-sdk/client-sqs', targetSymbol: 'ReceiveMessageCommand' }),
      makeEdge(receiver.id, 'calls', {
        targetSymbol: 'ReceiveMessageCommand',
        literalArgs: '[{"QueueUrl":"ORDER_QUEUE_URL","MaxNumberOfMessages":10}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [receiver], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'event_listen',
      operation: 'listen',
      canonicalTarget: 'sqs:ORDER_QUEUE_URL',
    })
  })

  it('PublishCommand TopicArn emits sns publish relation', () => {
    const publisher = makeNode(`${REPO_ID}:src/orders.sns.ts:publishOrder`)
    const edges = [
      makeEdge(publisher.id, 'imports', { targetSpecifier: '@aws-sdk/client-sns', targetSymbol: 'PublishCommand' }),
      makeEdge(publisher.id, 'calls', {
        targetSymbol: 'PublishCommand',
        literalArgs: '[{"TopicArn":"arn:aws:sns:us-east-1:123:orders"}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [publisher], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'event_publish',
      canonicalTarget: 'sns:arn:aws:sns:us-east-1:123:orders',
      payload: { broker: 'sns' },
    })
  })

  it('SendMessageCommand without static QueueUrl does not emit sqs relation', () => {
    const sender = makeNode(`${REPO_ID}:src/orders.sqs.ts:sendDynamic`)
    const edges = [
      makeEdge(sender.id, 'imports', { targetSpecifier: '@aws-sdk/client-sqs', targetSymbol: 'SendMessageCommand' }),
      makeEdge(sender.id, 'calls', {
        targetSymbol: 'SendMessageCommand',
        literalArgs: '[{"QueueUrl":null}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [sender], edges }))
    expect(result.filter((r) => r.kind === 'event_publish')).toHaveLength(0)
  })
})

describe('REL-S07/S10/S11: schedule trigger marker decorators', () => {
  it.each([
    ['Cron', '0 * * * *', { schedule_type: 'cron', cron: '0 * * * *' }],
    ['Interval', '60000', { schedule_type: 'interval', interval_ms: 60000 }],
    ['Timeout', '30000', { schedule_type: 'timeout', timeout_ms: 30000 }],
  ])('%s decorator stores marker row only', (decorator, firstArg, payload) => {
    const job = makeNode(`${REPO_ID}:src/jobs.ts:${decorator}`)
    const edges = [
      makeEdge(job.id, 'imports', { targetSpecifier: '@nestjs/schedule', targetSymbol: decorator }),
      makeEdge(job.id, 'decorates', { targetSymbol: decorator, firstArg }),
    ]

    const result = runPipeline(makeInputs({ nodes: [job], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'schedule_trigger',
      target: null,
      operation: 'trigger',
      canonicalTarget: null,
      unresolvedReason: null,
      payload: { ...payload, adapter: 'nest_schedule' },
    })
    expect(result.filter((r) => r.kind === 'event_listen')).toHaveLength(0)
  })
})

describe('node-cron / cron package schedule adapters', () => {
  it('node-cron schedule call stores cron schedule trigger', () => {
    const job = makeNode(`${REPO_ID}:src/jobs.ts:registerCleanup`)
    const edges = [
      makeEdge(job.id, 'imports', { targetSpecifier: 'node-cron', targetSymbol: 'cron' }),
      makeEdge(job.id, 'calls', {
        targetSymbol: 'schedule',
        chainPath: 'cron',
        firstArg: '0 0 * * *',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [job], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'schedule_trigger',
      operation: 'trigger',
      payload: { schedule_type: 'cron', cron: '0 0 * * *', adapter: 'node_cron' },
    })
  })

  it('cron package CronJob constructor stores cron schedule trigger', () => {
    const job = makeNode(`${REPO_ID}:src/jobs.ts:createCronJob`)
    const edges = [
      makeEdge(job.id, 'imports', { targetSpecifier: 'cron', targetSymbol: 'CronJob' }),
      makeEdge(job.id, 'calls', {
        targetSymbol: 'CronJob',
        firstArg: '*/5 * * * *',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [job], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'schedule_trigger',
      payload: { schedule_type: 'cron', cron: '*/5 * * * *', adapter: 'cron_package' },
    })
  })

  it('node-cron schedule without static expression does not emit schedule trigger', () => {
    const job = makeNode(`${REPO_ID}:src/jobs.ts:registerDynamic`)
    const edges = [
      makeEdge(job.id, 'imports', { targetSpecifier: 'node-cron', targetSymbol: 'cron' }),
      makeEdge(job.id, 'calls', {
        targetSymbol: 'schedule',
        chainPath: 'cron',
        firstArg: null,
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [job], edges }))
    expect(result.filter((r) => r.kind === 'schedule_trigger')).toHaveLength(0)
  })
})

describe('Agenda / Bree schedule adapters', () => {
  it('Agenda every call stores schedule trigger with job name', () => {
    const job = makeNode(`${REPO_ID}:src/agenda.ts:registerJobs`)
    const edges = [
      makeEdge(job.id, 'imports', { targetSpecifier: 'agenda', targetSymbol: 'Agenda' }),
      makeEdge(job.id, 'calls', {
        targetSymbol: 'every',
        chainPath: 'agenda',
        firstArg: '0 6 * * *',
        literalArgs: '["0 6 * * *","daily-report"]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [job], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'schedule_trigger',
      payload: { package: 'agenda', schedule_type: 'cron', cron: '0 6 * * *', job_name: 'daily-report' },
    })
  })

  it('Bree jobs config emits cron schedule trigger per static job', () => {
    const job = makeNode(`${REPO_ID}:src/bree.ts:createScheduler`)
    const edges = [
      makeEdge(job.id, 'imports', { targetSpecifier: 'bree', targetSymbol: 'Bree' }),
      makeEdge(job.id, 'calls', {
        targetSymbol: 'Bree',
        literalArgs: '[{"jobs":[{"name":"send-digest","cron":"*/10 * * * *"}]}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [job], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'schedule_trigger',
      payload: { package: 'bree', schedule_type: 'cron', cron: '*/10 * * * *', job_name: 'send-digest' },
    })
  })

  it('Bree job without static schedule does not emit schedule trigger', () => {
    const job = makeNode(`${REPO_ID}:src/bree.ts:createDynamicScheduler`)
    const edges = [
      makeEdge(job.id, 'imports', { targetSpecifier: 'bree', targetSymbol: 'Bree' }),
      makeEdge(job.id, 'calls', {
        targetSymbol: 'Bree',
        literalArgs: '[{"jobs":[{"name":"dynamic"}]}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [job], edges }))
    expect(result.filter((r) => r.kind === 'schedule_trigger')).toHaveLength(0)
  })
})

describe('Bull repeatable job schedule adapter', () => {
  it('Bull queue.add repeat cron stores schedule trigger for job', () => {
    const job = makeNode(`${REPO_ID}:src/bull.ts:scheduleDigest`)
    const edges = [
      makeEdge(job.id, 'imports', { targetSpecifier: 'bull', targetSymbol: 'Queue' }),
      makeEdge(job.id, 'calls', {
        targetSymbol: 'add',
        chainPath: 'queue',
        firstArg: 'send-digest',
        literalArgs: '["send-digest",null,{"repeat":{"cron":"0 7 * * *"}}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [job], edges }))

    expect(result.find((r) => r.kind === 'schedule_trigger')).toMatchObject({
      payload: {
        package: 'bull',
        schedule_type: 'cron',
        cron: '0 7 * * *',
        job_name: 'send-digest',
        adapter: 'bull_repeat',
      },
    })
  })

  it('BullMQ queue.add repeat every stores interval schedule trigger', () => {
    const job = makeNode(`${REPO_ID}:src/bullmq.ts:scheduleHeartbeat`)
    const edges = [
      makeEdge(job.id, 'imports', { targetSpecifier: 'bullmq', targetSymbol: 'Queue' }),
      makeEdge(job.id, 'calls', {
        targetSymbol: 'add',
        chainPath: 'queue',
        firstArg: 'heartbeat',
        literalArgs: '["heartbeat",null,{"repeat":{"every":60000}}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [job], edges }))

    expect(result.find((r) => r.kind === 'schedule_trigger')).toMatchObject({
      payload: {
        package: 'bullmq',
        schedule_type: 'interval',
        interval_ms: 60000,
        job_name: 'heartbeat',
      },
    })
  })

  it('Bull queue.add without repeat options does not emit schedule trigger', () => {
    const job = makeNode(`${REPO_ID}:src/bull.ts:enqueueOnce`)
    const edges = [
      makeEdge(job.id, 'imports', { targetSpecifier: 'bull', targetSymbol: 'Queue' }),
      makeEdge(job.id, 'calls', {
        targetSymbol: 'add',
        chainPath: 'queue',
        firstArg: 'send-once',
        literalArgs: '["send-once",null,{}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [job], edges }))
    expect(result.filter((r) => r.kind === 'schedule_trigger')).toHaveLength(0)
  })
})

describe('REL-S08/S26: external service anchors', () => {
  it('AWS S3 putObject stores external_service upload', () => {
    const handler = makeNode(`${REPO_ID}:src/avatar.ts:uploadAvatar`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@aws-sdk/client-s3', targetSymbol: 'S3Client' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'putObject', chainPath: 's3', firstArg: 'avatars' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 's3:avatars',
      operation: 'upload',
      canonicalTarget: 'external_service:s3:avatars',
      payload: { service: 's3', adapter: 'external_service' },
    })
  })

  it('Supabase storage upload stores bucket-specific target', () => {
    const handler = makeNode(`${REPO_ID}:src/avatar.ts:uploadSupabase`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@supabase/supabase-js', targetSymbol: 'createClient' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'upload', chainPath: "supabase.storage.from('avatars')" }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'supabase_storage:avatars',
      operation: 'upload',
      canonicalTarget: 'external_service:supabase_storage:avatars',
    })
  })
})

describe('architecture §5.7: external service full MVP scope', () => {
  it.each([
    ['getObject', 'download'],
    ['deleteObject', 'delete'],
  ])('AWS S3 %s stores %s operation', (method, operation) => {
    const handler = makeNode(`${REPO_ID}:src/avatar.ts:${method}`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@aws-sdk/client-s3', targetSymbol: 'S3Client' }),
      makeEdge(handler.id, 'calls', { targetSymbol: method, chainPath: 's3', firstArg: 'avatars' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 's3:avatars',
      operation,
    })
  })

  it('Cloudinary upload stores cloudinary target', () => {
    const handler = makeNode(`${REPO_ID}:src/media.ts:uploadImage`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'cloudinary', targetSymbol: 'v2' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'upload', chainPath: 'cloudinary.uploader' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'cloudinary',
      operation: 'upload',
      canonicalTarget: 'external_service:cloudinary',
    })
  })

  it('Email sendMail stores email external_service', () => {
    const handler = makeNode(`${REPO_ID}:src/mail.ts:sendMail`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'nodemailer', targetSymbol: 'createTransport' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'sendMail', chainPath: 'transport' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'email',
      operation: 'send',
      canonicalTarget: 'external_service:email',
    })
  })

  it.each([
    ['getFirestore', 'firebase:firestore', 'firestore', 'firebase/firestore'],
    ['getAuth', 'firebase:auth', 'auth', 'firebase/auth'],
    ['getStorage', 'firebase:storage', 'storage', 'firebase/storage'],
  ])('Firebase %s stores product-specific target', (method, target, firebaseProduct, pkg) => {
    const handler = makeNode(`${REPO_ID}:src/firebase.ts:${method}`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: pkg, targetSymbol: method }),
      makeEdge(handler.id, 'calls', { targetSymbol: method, chainPath: null }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target,
      operation: 'unknown',
      canonicalTarget: `external_service:${target}`,
      payload: { service: 'firebase', firebase_product: firebaseProduct },
    })
  })

  it('unknown method on anchored external service emits operation unknown', () => {
    const handler = makeNode(`${REPO_ID}:src/media.ts:cloudinaryAdmin`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'cloudinary', targetSymbol: 'v2' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'rename', chainPath: 'cloudinary.uploader' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'cloudinary',
      operation: 'unknown',
    })
  })

  it('Firebase SDK call without firebase import stores no external_service', () => {
    const handler = makeNode(`${REPO_ID}:src/local.ts:getFirestore`)
    const edges = [
      makeEdge(handler.id, 'calls', { targetSymbol: 'getFirestore', chainPath: null }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))
    expect(result.filter((r) => r.kind === 'external_service')).toHaveLength(0)
  })
})

describe('Stripe external service adapter', () => {
  it('stripe paymentIntents.create stores payment intent target', () => {
    const handler = makeNode(`${REPO_ID}:src/payments.ts:createIntent`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'stripe', targetSymbol: 'Stripe' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'create', chainPath: 'stripe.paymentIntents' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'stripe:payment_intents',
      operation: 'create',
      canonicalTarget: 'external_service:stripe:payment_intents',
      payload: { service: 'stripe' },
    })
  })

  it('stripe checkout.sessions.create stores checkout session target', () => {
    const handler = makeNode(`${REPO_ID}:src/checkout.ts:createCheckout`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'stripe', targetSymbol: 'Stripe' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'create', chainPath: 'stripe.checkout.sessions' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'stripe:checkout_sessions',
      operation: 'create',
    })
  })

  it('stripe refunds.create stores refund operation', () => {
    const handler = makeNode(`${REPO_ID}:src/refunds.ts:refundPayment`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'stripe', targetSymbol: 'Stripe' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'create', chainPath: 'stripe.refunds' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'stripe:refunds',
      operation: 'refund',
    })
  })

  it('stripe unknown resource does not emit external_service', () => {
    const handler = makeNode(`${REPO_ID}:src/payments.ts:unknownStripe`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'stripe', targetSymbol: 'Stripe' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'create', chainPath: 'stripe.dynamicResource' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))
    expect(result.filter((r) => r.kind === 'external_service')).toHaveLength(0)
  })
})

describe('Twilio external service adapter', () => {
  it('twilio messages.create stores message send target', () => {
    const handler = makeNode(`${REPO_ID}:src/sms.ts:sendSms`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'twilio', targetSymbol: 'twilio' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'create', chainPath: 'client.messages' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'twilio:messages',
      operation: 'send_message',
      canonicalTarget: 'external_service:twilio:messages',
      payload: { service: 'twilio' },
    })
  })

  it('twilio calls.create stores voice call target', () => {
    const handler = makeNode(`${REPO_ID}:src/voice.ts:startCall`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'twilio', targetSymbol: 'twilio' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'create', chainPath: 'twilioClient.calls' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'twilio:calls',
      operation: 'call',
    })
  })

  it('twilio unknown resource does not emit external_service', () => {
    const handler = makeNode(`${REPO_ID}:src/twilio.ts:unknown`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'twilio', targetSymbol: 'twilio' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'create', chainPath: 'client.dynamicResource' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))
    expect(result.filter((r) => r.kind === 'external_service')).toHaveLength(0)
  })
})

describe('Slack / Discord external messaging adapters', () => {
  it('Slack WebClient chat.postMessage stores slack messaging target', () => {
    const handler = makeNode(`${REPO_ID}:src/slack.ts:notifySlack`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@slack/web-api', targetSymbol: 'WebClient' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'postMessage', chainPath: 'client.chat' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'slack:message',
      operation: 'send_message',
      canonicalTarget: 'external_service:slack:message',
      payload: { service: 'slack' },
    })
  })

  it('Discord channel.send stores discord messaging target', () => {
    const handler = makeNode(`${REPO_ID}:src/discord.ts:notifyDiscord`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'discord.js', targetSymbol: 'Client' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'send', chainPath: 'channel' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'discord:message',
      operation: 'send_message',
      payload: { service: 'discord' },
    })
  })

  it('Discord import with non-message method does not emit external_service', () => {
    const handler = makeNode(`${REPO_ID}:src/discord.ts:fetchUser`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'discord.js', targetSymbol: 'Client' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'fetch', chainPath: 'client.users' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))
    expect(result.filter((r) => r.kind === 'external_service')).toHaveLength(0)
  })
})

describe('OpenAI external service adapter', () => {
  it('OpenAI chat completions create stores chat target', () => {
    const handler = makeNode(`${REPO_ID}:src/ai.ts:completeChat`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'openai', targetSymbol: 'OpenAI' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'create', chainPath: 'client.chat.completions' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'openai:chat_completions',
      operation: 'generate',
      canonicalTarget: 'external_service:openai:chat_completions',
      payload: { service: 'openai' },
    })
  })

  it('OpenAI responses create stores responses target', () => {
    const handler = makeNode(`${REPO_ID}:src/ai.ts:createResponse`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'openai', targetSymbol: 'OpenAI' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'create', chainPath: 'openai.responses' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'openai:responses',
      operation: 'generate',
    })
  })

  it('OpenAI embeddings create stores embed operation', () => {
    const handler = makeNode(`${REPO_ID}:src/ai.ts:createEmbedding`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'openai', targetSymbol: 'OpenAI' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'create', chainPath: 'client.embeddings' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'openai:embeddings',
      operation: 'embed',
    })
  })

  it('OpenAI unknown resource does not emit external_service', () => {
    const handler = makeNode(`${REPO_ID}:src/ai.ts:unknownAi`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'openai', targetSymbol: 'OpenAI' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'create', chainPath: 'client.dynamicResource' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))
    expect(result.filter((r) => r.kind === 'external_service')).toHaveLength(0)
  })
})

describe('Sentry external service adapter', () => {
  it('Sentry captureException stores observability error target', () => {
    const handler = makeNode(`${REPO_ID}:src/checkouts.ts:createCheckout`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@sentry/nextjs', targetSymbol: 'Sentry' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'captureException', chainPath: 'Sentry' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'sentry:errors',
      operation: 'capture_exception',
      canonicalTarget: 'external_service:sentry:errors',
      payload: { service: 'sentry' },
    })
  })

  it.each([
    ['captureMessage', 'sentry:messages', 'capture_message'],
    ['captureEvent', 'sentry:events', 'capture_event'],
  ])('Sentry %s stores product-specific target', (method, target, operation) => {
    const handler = makeNode(`${REPO_ID}:src/observability.ts:${method}`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@sentry/node', targetSymbol: 'Sentry' }),
      makeEdge(handler.id, 'calls', { targetSymbol: method, chainPath: 'Sentry' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target,
      operation,
      canonicalTarget: `external_service:${target}`,
    })
  })

  it('Sentry import with non-capture method does not emit external_service', () => {
    const handler = makeNode(`${REPO_ID}:src/observability.ts:configureScope`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@sentry/nextjs', targetSymbol: 'Sentry' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'setUser', chainPath: 'Sentry' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result.filter((relation) => relation.kind === 'external_service')).toHaveLength(0)
  })
})

describe('PostHog external service adapter', () => {
  it('PostHog capture stores product analytics event target', () => {
    const handler = makeNode(`${REPO_ID}:src/analytics.ts:captureSignup`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'posthog-node', targetSymbol: 'PostHog' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'capture', chainPath: 'posthog' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'posthog:events',
      operation: 'capture_event',
      canonicalTarget: 'external_service:posthog:events',
      payload: { service: 'posthog' },
    })
  })

  it.each([
    ['identify', 'posthog:users', 'identify_user'],
    ['group', 'posthog:groups', 'identify_group'],
  ])('PostHog %s stores product-specific target', (method, target, operation) => {
    const handler = makeNode(`${REPO_ID}:src/analytics.ts:${method}`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'posthog-js', targetSymbol: 'posthog' }),
      makeEdge(handler.id, 'calls', { targetSymbol: method, chainPath: 'posthog' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target,
      operation,
      canonicalTarget: `external_service:${target}`,
    })
  })

  it('PostHog import with non-analytics method does not emit external_service', () => {
    const handler = makeNode(`${REPO_ID}:src/analytics.ts:flushEvents`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'posthog-node', targetSymbol: 'PostHog' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'shutdown', chainPath: 'posthog' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result.filter((relation) => relation.kind === 'external_service')).toHaveLength(0)
  })
})

describe('Segment external service adapter', () => {
  it('Segment identify stores customer profile target', () => {
    const handler = makeNode(`${REPO_ID}:src/analytics.ts:identifySignupUser`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@segment/analytics-node', targetSymbol: 'Analytics' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'identify', chainPath: 'analytics' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'segment:users',
      operation: 'identify_user',
      canonicalTarget: 'external_service:segment:users',
      payload: { service: 'segment' },
    })
  })

  it.each([
    ['track', 'segment:events', 'capture_event'],
    ['page', 'segment:pages', 'page_view'],
    ['screen', 'segment:screens', 'screen_view'],
    ['group', 'segment:groups', 'identify_group'],
    ['alias', 'segment:users', 'alias_user'],
    ['flush', 'segment:delivery', 'flush'],
    ['closeAndFlush', 'segment:delivery', 'flush'],
  ])('Segment %s stores product-specific target', (method, target, operation) => {
    const handler = makeNode(`${REPO_ID}:src/analytics.ts:${method}`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'analytics-node', targetSymbol: 'Analytics' }),
      makeEdge(handler.id, 'calls', { targetSymbol: method, chainPath: 'analytics' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target,
      operation,
      canonicalTarget: `external_service:${target}`,
      payload: { service: 'segment' },
    })
  })

  it('Segment constructor does not emit external_service edge', () => {
    const handler = makeNode(`${REPO_ID}:src/segment.ts:analytics`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@segment/analytics-node', targetSymbol: 'Analytics' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'Analytics', chainPath: null }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result.filter((relation) => relation.kind === 'external_service')).toHaveLength(0)
  })
})

describe('LaunchDarkly external service adapter', () => {
  it('LaunchDarkly variation stores feature flag evaluation target', () => {
    const handler = makeNode(`${REPO_ID}:src/flags.ts:resolveCheckoutFlag`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'launchdarkly-node-server-sdk', targetSymbol: 'LaunchDarkly' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'variation', chainPath: 'ldClient' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'launchdarkly:flags',
      operation: 'evaluate_flag',
      canonicalTarget: 'external_service:launchdarkly:flags',
      payload: { service: 'launchdarkly' },
    })
  })

  it.each([
    ['variationDetail', 'launchdarkly:flags', 'evaluate_flag'],
    ['allFlagsState', 'launchdarkly:flags', 'read_flags'],
    ['identify', 'launchdarkly:contexts', 'identify_context'],
    ['track', 'launchdarkly:events', 'track_event'],
    ['flush', 'launchdarkly:delivery', 'flush'],
  ])('LaunchDarkly %s stores product-specific target', (method, target, operation) => {
    const handler = makeNode(`${REPO_ID}:src/flags.ts:${method}`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@launchdarkly/node-server-sdk', targetSymbol: 'LaunchDarkly' }),
      makeEdge(handler.id, 'calls', { targetSymbol: method, chainPath: 'ldClient' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target,
      operation,
      canonicalTarget: `external_service:${target}`,
      payload: { service: 'launchdarkly' },
    })
  })

  it('LaunchDarkly init helper does not emit external_service edge', () => {
    const handler = makeNode(`${REPO_ID}:src/launchdarkly.ts:ldClient`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'launchdarkly-node-server-sdk', targetSymbol: 'LaunchDarkly' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'init', chainPath: 'LaunchDarkly' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result.filter((relation) => relation.kind === 'external_service')).toHaveLength(0)
  })
})

describe('HubSpot external service adapter', () => {
  it('HubSpot contacts basicApi.create stores CRM contact target', () => {
    const handler = makeNode(`${REPO_ID}:src/crm.ts:syncSignupContact`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@hubspot/api-client', targetSymbol: 'hubspot' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'create', chainPath: 'hubspotClient.crm.contacts.basicApi' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'hubspot:contacts',
      operation: 'create_contact',
      canonicalTarget: 'external_service:hubspot:contacts',
      payload: { service: 'hubspot' },
    })
  })

  it.each([
    ['update', 'contacts', 'update'],
    ['getById', 'contacts', 'read'],
    ['getPage', 'companies', 'read'],
    ['archive', 'deals', 'archive'],
    ['merge', 'contacts', 'merge'],
    ['doSearch', 'tickets', 'search'],
  ])('HubSpot %s on %s stores CRM operation', (method, resource, operation) => {
    const handler = makeNode(`${REPO_ID}:src/hubspot.ts:${method}${resource}`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@hubspot/api-client', targetSymbol: 'hubspot' }),
      makeEdge(handler.id, 'calls', { targetSymbol: method, chainPath: `hubspotClient.crm.${resource}.basicApi` }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: `hubspot:${resource}`,
      operation,
      canonicalTarget: `external_service:hubspot:${resource}`,
      payload: { service: 'hubspot' },
    })
  })

  it('HubSpot client constructor does not emit external_service edge', () => {
    const handler = makeNode(`${REPO_ID}:src/hubspot.ts:hubspotClient`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@hubspot/api-client', targetSymbol: 'hubspot' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'Client', chainPath: 'hubspot' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result.filter((relation) => relation.kind === 'external_service')).toHaveLength(0)
  })
})

describe('Mixpanel external service adapter', () => {
  it('Mixpanel track stores product analytics event target', () => {
    const handler = makeNode(`${REPO_ID}:src/analytics.ts:recordOnboardingCompleted`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'mixpanel', targetSymbol: 'Mixpanel' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'track', chainPath: 'mixpanel' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'mixpanel:events',
      operation: 'capture_event',
      canonicalTarget: 'external_service:mixpanel:events',
      payload: { service: 'mixpanel' },
    })
  })

  it.each([
    ['track_batch', 'mixpanel', 'mixpanel:events', 'capture_event'],
    ['set', 'mixpanel.people', 'mixpanel:profiles', 'update_profile'],
    ['set_once', 'mixpanel.people', 'mixpanel:profiles', 'update_profile'],
    ['increment', 'mixpanel.people', 'mixpanel:profiles', 'update_profile'],
    ['append', 'mixpanel.people', 'mixpanel:profiles', 'update_profile'],
    ['union', 'mixpanel.people', 'mixpanel:profiles', 'update_profile'],
    ['track_charge', 'mixpanel.people', 'mixpanel:profiles', 'track_revenue'],
    ['clear_charges', 'mixpanel.people', 'mixpanel:profiles', 'clear_revenue'],
    ['delete_user', 'mixpanel.people', 'mixpanel:profiles', 'delete_profile'],
    ['alias', 'mixpanel', 'mixpanel:users', 'alias_user'],
  ])('Mixpanel %s stores analytics operation', (method, chainPath, target, operation) => {
    const handler = makeNode(`${REPO_ID}:src/mixpanel.ts:${method}`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'mixpanel', targetSymbol: 'Mixpanel' }),
      makeEdge(handler.id, 'calls', { targetSymbol: method, chainPath }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target,
      operation,
      canonicalTarget: `external_service:${target}`,
      payload: { service: 'mixpanel' },
    })
  })

  it('Mixpanel init does not emit external_service edge', () => {
    const handler = makeNode(`${REPO_ID}:src/mixpanel.ts:mixpanel`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'mixpanel', targetSymbol: 'Mixpanel' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'init', chainPath: 'Mixpanel' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result.filter((relation) => relation.kind === 'external_service')).toHaveLength(0)
  })
})

describe('Amplitude external service adapter', () => {
  it('Amplitude track stores product analytics event target', () => {
    const handler = makeNode(`${REPO_ID}:src/analytics.ts:recordWorkspaceActivation`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@amplitude/analytics-node', targetSymbol: 'track' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'track', chainPath: 'track' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'amplitude:events',
      operation: 'capture_event',
      canonicalTarget: 'external_service:amplitude:events',
      payload: { service: 'amplitude' },
    })
  })

  it.each([
    ['identify', 'amplitude:profiles', 'update_profile'],
    ['groupIdentify', 'amplitude:groups', 'update_group'],
    ['revenue', 'amplitude:revenue', 'track_revenue'],
    ['flush', 'amplitude:delivery', 'flush'],
  ])('Amplitude %s stores analytics operation', (method, target, operation) => {
    const handler = makeNode(`${REPO_ID}:src/amplitude.ts:${method}`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@amplitude/analytics-node', targetSymbol: method }),
      makeEdge(handler.id, 'calls', { targetSymbol: method, chainPath: method }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target,
      operation,
      canonicalTarget: `external_service:${target}`,
      payload: { service: 'amplitude' },
    })
  })

  it('Amplitude init and Identify builder calls do not emit external_service edges', () => {
    const handler = makeNode(`${REPO_ID}:src/amplitude.ts:buildIdentify`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@amplitude/analytics-node', targetSymbol: 'Identify' }),
      makeEdge(handler.id, 'imports', { targetSpecifier: '@amplitude/analytics-node', targetSymbol: 'init' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'init', chainPath: 'init' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'set', chainPath: 'identifyObj' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result.filter((relation) => relation.kind === 'external_service')).toHaveLength(0)
  })

  it('Amplitude package import does not turn a local track helper into an external_service edge', () => {
    const handler = makeNode(`${REPO_ID}:src/amplitude.ts:recordLocalAudit`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@amplitude/analytics-node', targetSymbol: 'Identify' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'Identify', chainPath: 'Identify' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'track', chainPath: 'track', firstArg: 'local.audit' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result.filter((relation) => relation.kind === 'external_service')).toHaveLength(0)
  })
})

describe('Novu external service adapter', () => {
  it('Novu trigger stores notification workflow target', () => {
    const handler = makeNode(`${REPO_ID}:src/notifications.ts:sendInvoice`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@novu/node', targetSymbol: 'Novu' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'trigger', chainPath: 'novu', firstArg: 'invoice-created' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'novu:invoice-created',
      operation: 'trigger',
      canonicalTarget: 'external_service:novu:invoice-created',
      payload: { service: 'novu' },
    })
  })

  it.each([
    ['bulkTrigger', 'invoice-created', 'bulk_trigger'],
    ['broadcast', 'system-maintenance', 'broadcast'],
  ])('Novu %s stores notification workflow target', (method, workflow, operation) => {
    const handler = makeNode(`${REPO_ID}:src/notifications.ts:${method}`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@novu/api', targetSymbol: 'Novu' }),
      makeEdge(handler.id, 'calls', { targetSymbol: method, chainPath: 'novu', firstArg: workflow }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: `novu:${workflow}`,
      operation,
      canonicalTarget: `external_service:novu:${workflow}`,
    })
  })

  it('Novu import with non-trigger method does not emit external_service', () => {
    const handler = makeNode(`${REPO_ID}:src/notifications.ts:inspect`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@novu/node', targetSymbol: 'Novu' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'subscribers', chainPath: 'novu' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result.filter((relation) => relation.kind === 'external_service')).toHaveLength(0)
  })
})

describe('Auth0 external service adapter', () => {
  it('Auth0 users.create stores identity provisioning target', () => {
    const handler = makeNode(`${REPO_ID}:src/users.ts:provisionUser`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'auth0', targetSymbol: 'ManagementClient' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'create', chainPath: 'management.users' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'auth0:users',
      operation: 'create_user',
      canonicalTarget: 'external_service:auth0:users',
      payload: { service: 'auth0' },
    })
  })

  it.each([
    ['update', 'update_user'],
    ['delete', 'delete_user'],
    ['getAll', 'read'],
  ])('Auth0 users.%s stores user operation', (method, operation) => {
    const handler = makeNode(`${REPO_ID}:src/users.ts:${method}`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'auth0', targetSymbol: 'ManagementClient' }),
      makeEdge(handler.id, 'calls', { targetSymbol: method, chainPath: 'auth0Management.users' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'auth0:users',
      operation,
      canonicalTarget: 'external_service:auth0:users',
    })
  })

  it('Auth0 import with non-management method does not emit external_service', () => {
    const handler = makeNode(`${REPO_ID}:src/auth.ts:login`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@auth0/nextjs-auth0', targetSymbol: 'handleAuth' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'handleAuth', chainPath: null }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result.filter((relation) => relation.kind === 'external_service')).toHaveLength(0)
  })
})

describe('Clerk external service adapter', () => {
  it('Clerk organization invitation stores identity invitation target', () => {
    const handler = makeNode(`${REPO_ID}:src/invitations.ts:inviteOrganizationMember`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@clerk/nextjs/server', targetSymbol: 'clerkClient' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'createOrganizationInvitation', chainPath: 'client.organizations' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'clerk:organization_invitations',
      operation: 'invite_user',
      canonicalTarget: 'external_service:clerk:organization_invitations',
      payload: { service: 'clerk' },
    })
  })

  it.each([
    ['createUser', 'users', 'create_user'],
    ['updateUser', 'users', 'update_user'],
    ['deleteUser', 'users', 'delete_user'],
    ['getUserList', 'users', 'read'],
    ['createOrganizationMembership', 'organization_memberships', 'create_membership'],
  ])('Clerk %s stores %s operation', (method, resource, operation) => {
    const handler = makeNode(`${REPO_ID}:src/clerk.ts:${method}`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@clerk/backend', targetSymbol: 'createClerkClient' }),
      makeEdge(handler.id, 'calls', { targetSymbol: method, chainPath: `clerk.${resource}` }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: `clerk:${resource}`,
      operation,
      canonicalTarget: `external_service:clerk:${resource}`,
    })
  })

  it('Clerk auth helper without Backend API method does not emit external_service', () => {
    const handler = makeNode(`${REPO_ID}:src/auth.ts:getCurrentUser`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@clerk/nextjs/server', targetSymbol: 'auth' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'auth', chainPath: null }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result.filter((relation) => relation.kind === 'external_service')).toHaveLength(0)
  })
})

describe('Lemon Squeezy external service adapter', () => {
  it('Lemon Squeezy createCheckout stores billing checkout target', () => {
    const handler = makeNode(`${REPO_ID}:src/billing.ts:createTenantCheckout`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@lemonsqueezy/lemonsqueezy.js', targetSymbol: 'createCheckout' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'createCheckout', chainPath: null }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'lemonsqueezy:checkouts',
      operation: 'create_checkout',
      canonicalTarget: 'external_service:lemonsqueezy:checkouts',
      payload: { service: 'lemonsqueezy' },
    })
  })

  it.each([
    ['listCheckouts', 'checkouts', 'read_checkout'],
    ['updateSubscription', 'subscriptions', 'update_subscription'],
    ['cancelSubscription', 'subscriptions', 'cancel_subscription'],
    ['createWebhook', 'webhooks', 'create_webhook'],
    ['validateLicense', 'license_keys', 'validate_license'],
  ])('Lemon Squeezy %s stores %s operation', (method, resource, operation) => {
    const handler = makeNode(`${REPO_ID}:src/lemonsqueezy.ts:${method}`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@lemonsqueezy/lemonsqueezy.js', targetSymbol: method }),
      makeEdge(handler.id, 'calls', { targetSymbol: method, chainPath: null }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: `lemonsqueezy:${resource}`,
      operation,
      canonicalTarget: `external_service:lemonsqueezy:${resource}`,
    })
  })

  it('Lemon Squeezy setup helper does not emit external_service edge', () => {
    const handler = makeNode(`${REPO_ID}:src/lemonsqueezy.ts:configureLemonSqueezy`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@lemonsqueezy/lemonsqueezy.js', targetSymbol: 'lemonSqueezySetup' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'lemonSqueezySetup', chainPath: null }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result.filter((relation) => relation.kind === 'external_service')).toHaveLength(0)
  })
})

describe('Paddle external service adapter', () => {
  it('Paddle transactions.create stores billing transaction target', () => {
    const handler = makeNode(`${REPO_ID}:src/billing.ts:createPaddleCheckout`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@paddle/paddle-node-sdk', targetSymbol: 'Paddle' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'create', chainPath: 'paddle.transactions' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'paddle:transactions',
      operation: 'create_transaction',
      canonicalTarget: 'external_service:paddle:transactions',
      payload: { service: 'paddle' },
    })
  })

  it.each([
    ['get', 'transactions', 'read'],
    ['list', 'customers', 'read'],
    ['update', 'subscriptions', 'update'],
    ['cancel', 'subscriptions', 'cancel'],
    ['pause', 'subscriptions', 'pause'],
    ['resume', 'subscriptions', 'resume'],
    ['preview', 'prices', 'preview'],
    ['archive', 'products', 'archive'],
  ])('Paddle %s on %s stores billing operation', (method, resource, operation) => {
    const handler = makeNode(`${REPO_ID}:src/paddle.ts:${method}${resource}`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'paddle-node-sdk', targetSymbol: 'Paddle' }),
      makeEdge(handler.id, 'calls', { targetSymbol: method, chainPath: `paddle.${resource}` }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: `paddle:${resource}`,
      operation,
      canonicalTarget: `external_service:paddle:${resource}`,
      payload: { service: 'paddle' },
    })
  })

  it('Paddle customer portal session create stores portal-session target', () => {
    const handler = makeNode(`${REPO_ID}:src/paddle.ts:createPortalSession`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@paddle/paddle-node-sdk', targetSymbol: 'Paddle' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'create', chainPath: 'paddle.customers.portalSessions' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'paddle:portal_sessions',
      operation: 'create_portal_session',
      canonicalTarget: 'external_service:paddle:portal_sessions',
    })
  })

  it('Paddle constructor does not emit external_service edge', () => {
    const handler = makeNode(`${REPO_ID}:src/paddle.ts:paddle`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@paddle/paddle-node-sdk', targetSymbol: 'Paddle' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'Paddle', chainPath: null }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result.filter((relation) => relation.kind === 'external_service')).toHaveLength(0)
  })
})

describe('UploadThing external service adapter', () => {
  it('UploadThing uploadFiles stores file upload target', () => {
    const handler = makeNode(`${REPO_ID}:src/assets.ts:uploadTenantAsset`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'uploadthing/server', targetSymbol: 'UTApi' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'uploadFiles', chainPath: 'utapi' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'uploadthing:files',
      operation: 'upload',
      canonicalTarget: 'external_service:uploadthing:files',
      payload: { service: 'uploadthing' },
    })
  })

  it.each([
    ['deleteFiles', 'delete'],
    ['renameFiles', 'rename'],
    ['listFiles', 'read'],
    ['getSignedURL', 'read'],
  ])('UploadThing %s stores file operation', (method, operation) => {
    const handler = makeNode(`${REPO_ID}:src/uploadthing.ts:${method}`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'uploadthing/server', targetSymbol: 'utapi' }),
      makeEdge(handler.id, 'calls', { targetSymbol: method, chainPath: 'utapi' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'uploadthing:files',
      operation,
      canonicalTarget: 'external_service:uploadthing:files',
    })
  })

  it('UploadThing createRouteHandler stores file route configuration target', () => {
    const handler = makeNode(`${REPO_ID}:app/api/uploadthing/route.ts:createUploadthingRoute`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'uploadthing/next', targetSymbol: 'createRouteHandler' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'createRouteHandler', chainPath: null }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'uploadthing:file_routes',
      operation: 'configure_route',
      canonicalTarget: 'external_service:uploadthing:file_routes',
    })
  })
})

describe('Mux external service adapter', () => {
  it('Mux video uploads.create stores direct upload target', () => {
    const handler = makeNode(`${REPO_ID}:src/videos.ts:createTenantVideoUpload`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@mux/mux-node', targetSymbol: 'Mux' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'create', chainPath: 'mux.video.uploads' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'mux:direct_uploads',
      operation: 'create_upload',
      canonicalTarget: 'external_service:mux:direct_uploads',
      payload: { service: 'mux' },
    })
  })

  it.each([
    ['mux.video.assets', 'create', 'assets', 'create_asset'],
    ['mux.video.assets', 'retrieve', 'assets', 'read'],
    ['mux.video.assets', 'delete', 'assets', 'delete'],
    ['mux.video.uploads', 'cancel', 'direct_uploads', 'cancel'],
    ['mux.video.assets', 'createPlaybackId', 'assets', 'create_playback_id'],
  ])('Mux %s.%s stores resource operation', (chainPath, method, resource, operation) => {
    const handler = makeNode(`${REPO_ID}:src/mux.ts:${method}`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@mux/mux-node', targetSymbol: 'Mux' }),
      makeEdge(handler.id, 'calls', { targetSymbol: method, chainPath }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: `mux:${resource}`,
      operation,
      canonicalTarget: `external_service:mux:${resource}`,
    })
  })

  it('Mux constructor without a resource method does not emit external_service edge', () => {
    const handler = makeNode(`${REPO_ID}:src/mux.ts:mux`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@mux/mux-node', targetSymbol: 'Mux' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'Mux', chainPath: null }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result.filter((relation) => relation.kind === 'external_service')).toHaveLength(0)
  })
})

describe('OneSignal external service adapter', () => {
  it('OneSignal createNotification stores notification send target', () => {
    const handler = makeNode(`${REPO_ID}:src/push.ts:sendTenantPushCampaign`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@onesignal/node-onesignal', targetSymbol: 'OneSignal' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'createNotification', chainPath: 'oneSignalClient' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'onesignal:notifications',
      operation: 'send_notification',
      canonicalTarget: 'external_service:onesignal:notifications',
      payload: { service: 'onesignal' },
    })
  })

  it.each([
    ['getNotification', 'notifications', 'read'],
    ['getNotifications', 'notifications', 'read'],
    ['cancelNotification', 'notifications', 'cancel_notification'],
    ['createApp', 'apps', 'create_app'],
    ['updateApp', 'apps', 'update_app'],
    ['deleteApp', 'apps', 'delete_app'],
  ])('OneSignal %s stores resource operation', (method, resource, operation) => {
    const handler = makeNode(`${REPO_ID}:src/onesignal.ts:${method}`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@onesignal/node-onesignal', targetSymbol: 'OneSignal' }),
      makeEdge(handler.id, 'calls', { targetSymbol: method, chainPath: 'oneSignalClient' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: `onesignal:${resource}`,
      operation,
      canonicalTarget: `external_service:onesignal:${resource}`,
    })
  })

  it('OneSignal configuration helper does not emit external_service edge', () => {
    const handler = makeNode(`${REPO_ID}:src/onesignal.ts:oneSignalClient`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@onesignal/node-onesignal', targetSymbol: 'OneSignal' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'createConfiguration', chainPath: 'OneSignal' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result.filter((relation) => relation.kind === 'external_service')).toHaveLength(0)
  })
})

describe('Sanity external service adapter', () => {
  it('Sanity client.fetch stores content query target', () => {
    const handler = makeNode(`${REPO_ID}:src/content.ts:syncTenantContent`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@sanity/client', targetSymbol: 'createClient' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'fetch', chainPath: 'sanityClient' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'sanity:content',
      operation: 'query',
      canonicalTarget: 'external_service:sanity:content',
      payload: { service: 'sanity' },
    })
  })

  it.each([
    ['create', 'write'],
    ['createIfNotExists', 'write'],
    ['createOrReplace', 'write'],
    ['patch', 'mutate'],
    ['mutate', 'mutate'],
    ['delete', 'delete'],
  ])('Sanity %s stores content %s operation', (method, operation) => {
    const handler = makeNode(`${REPO_ID}:src/sanity.ts:${method}`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@sanity/client', targetSymbol: 'createClient' }),
      makeEdge(handler.id, 'calls', { targetSymbol: method, chainPath: 'sanityClient' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'sanity:content',
      operation,
      canonicalTarget: 'external_service:sanity:content',
      payload: { service: 'sanity' },
    })
  })

  it('Sanity createClient helper does not emit external_service edge', () => {
    const handler = makeNode(`${REPO_ID}:src/sanity.ts:sanityClient`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@sanity/client', targetSymbol: 'createClient' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'createClient', chainPath: null }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result.filter((relation) => relation.kind === 'external_service')).toHaveLength(0)
  })

  it('next-sanity imported client fetch is also recognized', () => {
    const handler = makeNode(`${REPO_ID}:src/content.ts:loadPublishedPosts`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'next-sanity', targetSymbol: 'createClient' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'fetch', chainPath: 'client' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'sanity:content',
      operation: 'query',
      canonicalTarget: 'external_service:sanity:content',
    })
  })
})

describe('Algolia external service adapter', () => {
  it('Algolia initIndex binding plus saveObject stores index target', () => {
    const handler = makeNode(`${REPO_ID}:src/search.ts:indexProduct`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'algoliasearch', targetSymbol: 'algoliasearch' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'initIndex', chainPath: 'client', firstArg: 'products' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'saveObject', chainPath: 'productsIndex' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'algolia:products',
      operation: 'index',
      canonicalTarget: 'external_service:algolia:products',
      payload: { service: 'algolia' },
    })
  })

  it('Algolia v5 searchSingleIndex stores search target from indexName option', () => {
    const handler = makeNode(`${REPO_ID}:src/search.ts:searchProducts`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'algoliasearch', targetSymbol: 'algoliasearch' }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'searchSingleIndex',
        chainPath: 'client',
        literalArgs: '[{"indexName":"products","searchParams":{"query":"keyboard"}}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'algolia:products',
      operation: 'search',
    })
  })

  it('Algolia partial update and delete operations keep the same index target', () => {
    const handler = makeNode(`${REPO_ID}:src/search.ts:updateProduct`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'algoliasearch', targetSymbol: 'algoliasearch' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'initIndex', chainPath: 'client', firstArg: 'products' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'partialUpdateObject', chainPath: 'productsIndex' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'deleteObject', chainPath: 'productsIndex' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(2)
    expect(result.map((r) => r.operation).sort()).toEqual(['delete', 'update'])
    expect(result.every((r) => r.target === 'algolia:products')).toBe(true)
  })

  it('Algolia dynamic index does not emit external_service', () => {
    const handler = makeNode(`${REPO_ID}:src/search.ts:dynamicIndex`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'algoliasearch', targetSymbol: 'algoliasearch' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'saveObject', chainPath: 'index' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'search', chainPath: 'index', firstArg: 'keyboard' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))
    expect(result.filter((r) => r.kind === 'external_service')).toHaveLength(0)
  })

  it('Algolia multiple initIndex calls bind operations by receiver name', () => {
    const handler = makeNode(`${REPO_ID}:src/search.ts:indexMultiple`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'algoliasearch', targetSymbol: 'algoliasearch' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'initIndex', chainPath: 'client', firstArg: 'products' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'initIndex', chainPath: 'client', firstArg: 'orders' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'saveObject', chainPath: 'productsIndex' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'search', chainPath: 'ordersIndex' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(2)
    expect(result.map((r) => [r.target, r.operation]).sort()).toEqual([
      ['algolia:orders', 'search'],
      ['algolia:products', 'index'],
    ])
  })

  it('Algolia client.search multi-search emits one relation per indexName', () => {
    const handler = makeNode(`${REPO_ID}:src/search.ts:multiSearch`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'algoliasearch', targetSymbol: 'algoliasearch' }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'search',
        chainPath: 'client',
        literalArgs: '[[{"indexName":"products","query":"keyboard"},{"indexName":"orders","query":"pending"}]]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(2)
    expect(result.map((r) => r.target).sort()).toEqual(['algolia:orders', 'algolia:products'])
    expect(result.every((r) => r.operation === 'search')).toBe(true)
  })
})

describe('Elasticsearch external service adapter', () => {
  it('Elasticsearch client.index stores index target from request object', () => {
    const handler = makeNode(`${REPO_ID}:src/search.ts:indexDocument`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@elastic/elasticsearch', targetSymbol: 'Client' }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'index',
        chainPath: 'client',
        literalArgs: '[{"index":"products","document":{"id":"p1"}}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_service',
      target: 'elasticsearch:products',
      operation: 'index',
      canonicalTarget: 'external_service:elasticsearch:products',
      payload: { service: 'elasticsearch' },
    })
  })

  it('Elasticsearch search and get are read-like search operations', () => {
    const handler = makeNode(`${REPO_ID}:src/search.ts:queryOrders`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@elastic/elasticsearch', targetSymbol: 'Client' }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'search',
        chainPath: 'client',
        literalArgs: '[{"index":"orders","query":{"match_all":{}}}]',
      }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'get',
        chainPath: 'client',
        literalArgs: '[{"index":"order_audit","id":"o1"}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(2)
    expect(result.map((r) => r.target).sort()).toEqual(['elasticsearch:order_audit', 'elasticsearch:orders'])
    expect(result.every((r) => r.operation === 'search')).toBe(true)
  })

  it('Elasticsearch update delete and bulk map to write operations', () => {
    const handler = makeNode(`${REPO_ID}:src/search.ts:mutateProducts`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@elastic/elasticsearch', targetSymbol: 'Client' }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'update',
        chainPath: 'client',
        literalArgs: '[{"index":"products","id":"p1","doc":{"name":"New"}}]',
      }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'delete',
        chainPath: 'client',
        literalArgs: '[{"index":"products","id":"p1"}]',
      }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'bulk',
        chainPath: 'client',
        literalArgs: '[{"index":"products","operations":[]}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(3)
    expect(result.map((r) => r.operation).sort()).toEqual(['delete', 'index', 'update'])
    expect(result.every((r) => r.target === 'elasticsearch:products')).toBe(true)
  })

  it('Elasticsearch dynamic index does not emit external_service', () => {
    const handler = makeNode(`${REPO_ID}:src/search.ts:dynamicElasticIndex`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@elastic/elasticsearch', targetSymbol: 'Client' }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'index',
        chainPath: 'client',
        literalArgs: '[{"index":null,"document":{}}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))
    expect(result.filter((r) => r.kind === 'external_service')).toHaveLength(0)
  })

  it('Elasticsearch indices namespace operations store index administration targets', () => {
    const handler = makeNode(`${REPO_ID}:src/search.ts:manageIndex`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@elastic/elasticsearch', targetSymbol: 'Client' }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'create',
        chainPath: 'client.indices',
        literalArgs: '[{"index":"products","mappings":{"properties":{}}}]',
      }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'putMapping',
        chainPath: 'client.indices',
        literalArgs: '[{"index":"products","properties":{}}]',
      }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'exists',
        chainPath: 'client.indices',
        literalArgs: '[{"index":"products"}]',
      }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'delete',
        chainPath: 'client.indices',
        literalArgs: '[{"index":"products"}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(4)
    expect(result.map((r) => r.operation).sort()).toEqual(['create_index', 'delete', 'read', 'update_mapping'])
    expect(result.every((r) => r.target === 'elasticsearch:products')).toBe(true)
  })

  it('Elasticsearch query and by-query methods map to search update and delete operations', () => {
    const handler = makeNode(`${REPO_ID}:src/search.ts:queryMaintenance`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@elastic/elasticsearch', targetSymbol: 'Client' }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'count',
        chainPath: 'client',
        literalArgs: '[{"index":"orders","query":{"term":{"status":"paid"}}}]',
      }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'updateByQuery',
        chainPath: 'client',
        literalArgs: '[{"index":"orders","script":{"source":"ctx._source.synced=true"}}]',
      }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'deleteByQuery',
        chainPath: 'client',
        literalArgs: '[{"index":"orders","query":{"term":{"expired":true}}}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(3)
    expect(result.map((r) => r.operation).sort()).toEqual(['delete', 'search', 'update'])
    expect(result.every((r) => r.target === 'elasticsearch:orders')).toBe(true)
  })

  it('Elasticsearch bulk extracts target indices from operations metadata', () => {
    const handler = makeNode(`${REPO_ID}:src/search.ts:bulkIndex`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@elastic/elasticsearch', targetSymbol: 'Client' }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'bulk',
        chainPath: 'client',
        literalArgs: '[{"operations":[{"index":{"_index":"products","_id":"p1"}},{"update":{"_index":"orders","_id":"o1"}},{"delete":{"_index":"products","_id":"p2"}}]}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result).toHaveLength(2)
    expect(result.map((r) => r.target).sort()).toEqual(['elasticsearch:orders', 'elasticsearch:products'])
    expect(result.every((r) => r.operation === 'index')).toBe(true)
  })

  it('Elasticsearch string first argument without request object does not emit external_service', () => {
    const handler = makeNode(`${REPO_ID}:src/search.ts:unsafeStringArg`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: '@elastic/elasticsearch', targetSymbol: 'Client' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'search', chainPath: 'client', firstArg: 'keyboard' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))
    expect(result.filter((r) => r.kind === 'external_service')).toHaveLength(0)
  })
})

describe('External service mixed import adapter', () => {
  it('emits separate relations when multiple SDKs are imported in one handler', () => {
    const handler = makeNode(`${REPO_ID}:src/checkout.ts:completeCheckout`)
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'stripe', targetSymbol: 'Stripe' }),
      makeEdge(handler.id, 'imports', { targetSpecifier: 'openai', targetSymbol: 'OpenAI' }),
      makeEdge(handler.id, 'imports', { targetSpecifier: 'algoliasearch', targetSymbol: 'algoliasearch' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'create', chainPath: 'stripe.paymentIntents' }),
      makeEdge(handler.id, 'calls', { targetSymbol: 'create', chainPath: 'openai.responses' }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'searchSingleIndex',
        chainPath: 'searchClient',
        literalArgs: '[{"indexName":"products","searchParams":{"query":"keyboard"}}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))

    expect(result.map((r) => [r.target, r.operation]).sort()).toEqual([
      ['algolia:products', 'search'],
      ['openai:responses', 'generate'],
      ['stripe:payment_intents', 'create'],
    ])
  })
})

describe('REL-S12/S22~S24: event broker variants', () => {
  it('GraphQL pubsub publish/listen share graphql_pubsub canonical target', () => {
    const publisher = makeNode(`${REPO_ID}:src/chat.resolver.ts:send`)
    const listener = makeNode(`${REPO_ID}:src/chat.resolver.ts:messageCreated`)
    const edges = [
      makeEdge(publisher.id, 'imports', { targetSpecifier: 'graphql-subscriptions', targetSymbol: 'PubSub' }),
      makeEdge(publisher.id, 'calls', { targetSymbol: 'publish', chainPath: 'pubsub', firstArg: 'MESSAGE_CREATED' }),
      makeEdge(listener.id, 'imports', { targetSpecifier: 'graphql-subscriptions', targetSymbol: 'PubSub' }),
      makeEdge(listener.id, 'decorates', { targetSymbol: 'Subscription', firstArg: 'Message' }),
      makeEdge(listener.id, 'calls', { targetSymbol: 'asyncIterator', chainPath: 'pubsub', firstArg: 'MESSAGE_CREATED' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [publisher, listener], edges }))

    expect(result.map((r) => r.kind).sort()).toEqual(['event_listen', 'event_publish'])
    expect(result.every((r) => r.canonicalTarget === 'graphql_pubsub:MESSAGE_CREATED')).toBe(true)
  })

  it('Kafka MessagePattern listener and emit publisher use kafka canonical target', () => {
    const publisher = makeNode(`${REPO_ID}:src/orders.ts:publish`)
    const listener = makeNode(`${REPO_ID}:src/orders.consumer.ts:handle`, { filePath: 'src/orders.consumer.ts' })
    const edges = [
      makeEdge(publisher.id, 'imports', { targetSpecifier: '@nestjs/microservices', targetSymbol: 'ClientProxy' }),
      makeEdge(publisher.id, 'calls', { targetSymbol: 'emit', chainPath: 'kafkaClient', firstArg: 'order.created' }),
      makeEdge(listener.id, 'imports', { targetSpecifier: '@nestjs/microservices', targetSymbol: 'MessagePattern' }),
      makeEdge(listener.id, 'decorates', { targetSymbol: 'MessagePattern', firstArg: 'order.created' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [publisher, listener], edges }))

    expect(result.map((r) => r.kind).sort()).toEqual(['event_listen', 'event_publish'])
    expect(result.every((r) => r.canonicalTarget === 'kafka:order.created')).toBe(true)
  })

  it('Kafka MessagePattern object cmd listener uses kafka canonical target', () => {
    const listener = makeNode(`${REPO_ID}:src/orders.consumer.ts:handleReconciled`, { filePath: 'src/orders.consumer.ts' })
    const edges = [
      makeEdge(listener.id, 'imports', { targetSpecifier: '@nestjs/microservices', targetSymbol: 'MessagePattern' }),
      makeEdge(listener.id, 'decorates', {
        targetSymbol: 'MessagePattern',
        literalArgs: JSON.stringify([{ cmd: 'order.reconciled' }]),
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [listener], edges }))

    expect(result[0]).toMatchObject({
      kind: 'event_listen',
      canonicalTarget: 'kafka:order.reconciled',
      payload: { broker: 'kafka' },
    })
  })

  it('SQS sendMessage uses queue constant target', () => {
    const sender = makeNode(`${REPO_ID}:src/orders.ts:sendSqs`)
    const edges = [
      makeEdge(sender.id, 'imports', { targetSpecifier: '@aws-sdk/client-sqs', targetSymbol: 'SQSClient' }),
      makeEdge(sender.id, 'calls', { targetSymbol: 'sendMessage', chainPath: 'sqs', firstArg: 'ORDER_QUEUE_URL' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [sender], edges }))

    expect(result[0]).toMatchObject({
      kind: 'event_publish',
      canonicalTarget: 'sqs:ORDER_QUEUE_URL',
      payload: { broker: 'sqs', adapter: 'event_broker' },
    })
  })

  it('RabbitMQ client emit uses rabbitmq canonical target when transport is marked', () => {
    const publisher = makeNode(`${REPO_ID}:src/orders.ts:publishRabbit`)
    const edges = [
      makeEdge(publisher.id, 'imports', { targetSpecifier: '@nestjs/microservices', targetSymbol: 'ClientProxy' }),
      makeEdge(publisher.id, 'decorates', { targetSymbol: 'RabbitMQ', firstArg: 'orders' }),
      makeEdge(publisher.id, 'calls', { targetSymbol: 'emit', chainPath: 'client', firstArg: 'orders/created' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [publisher], edges }))

    expect(result[0]).toMatchObject({
      kind: 'event_publish',
      canonicalTarget: 'rabbitmq:orders/created',
      payload: { broker: 'rabbitmq' },
    })
  })
})

describe('architecture §5.5: additional event broker surfaces', () => {
  it('Node EventEmitter emit and OnEvent listener share node_event canonical target', () => {
    const publisher = makeNode(`${REPO_ID}:src/events.ts:publishOrder`)
    const listener = makeNode(`${REPO_ID}:src/events.ts:onOrder`)
    const edges = [
      makeEdge(publisher.id, 'imports', { targetSpecifier: '@nestjs/event-emitter', targetSymbol: 'EventEmitter2' }),
      makeEdge(publisher.id, 'calls', { targetSymbol: 'emit', chainPath: 'eventEmitter', firstArg: 'order.created' }),
      makeEdge(listener.id, 'imports', { targetSpecifier: '@nestjs/event-emitter', targetSymbol: 'OnEvent' }),
      makeEdge(listener.id, 'decorates', { targetSymbol: 'OnEvent', firstArg: 'order.created' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [publisher, listener], edges }))

    expect(result.map((r) => r.kind).sort()).toEqual(['event_listen', 'event_publish'])
    expect(result.every((r) => r.canonicalTarget === 'node_event:order.created')).toBe(true)
  })

  it('SNS publish stores sns canonical target', () => {
    const publisher = makeNode(`${REPO_ID}:src/events.ts:publishSns`)
    const edges = [
      makeEdge(publisher.id, 'imports', { targetSpecifier: '@aws-sdk/client-sns', targetSymbol: 'SNSClient' }),
      makeEdge(publisher.id, 'calls', { targetSymbol: 'publish', chainPath: 'sns', firstArg: 'ORDER_TOPIC_ARN' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [publisher], edges }))

    expect(result[0]).toMatchObject({
      kind: 'event_publish',
      operation: 'publish',
      canonicalTarget: 'sns:ORDER_TOPIC_ARN',
      payload: { broker: 'sns' },
    })
  })

  it('NATS publish stores nats canonical target', () => {
    const publisher = makeNode(`${REPO_ID}:src/events.ts:publishNats`)
    const edges = [
      makeEdge(publisher.id, 'imports', { targetSpecifier: 'nats', targetSymbol: 'connect' }),
      makeEdge(publisher.id, 'calls', { targetSymbol: 'publish', chainPath: 'nats', firstArg: 'order.created' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [publisher], edges }))

    expect(result[0]).toMatchObject({
      kind: 'event_publish',
      canonicalTarget: 'nats:order.created',
      payload: { broker: 'nats' },
    })
  })

  it('WebSocket SubscribeMessage stores websocket listener target', () => {
    const listener = makeNode(`${REPO_ID}:src/gateway.ts:join`)
    const edges = [
      makeEdge(listener.id, 'imports', { targetSpecifier: '@nestjs/websockets', targetSymbol: 'SubscribeMessage' }),
      makeEdge(listener.id, 'decorates', { targetSymbol: 'SubscribeMessage', firstArg: 'join' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [listener], edges }))

    expect(result[0]).toMatchObject({
      kind: 'event_listen',
      operation: 'listen',
      canonicalTarget: 'websocket:join',
      payload: { broker: 'websocket' },
    })
  })

  it('socket.io-client emit stores websocket publish target', () => {
    const publisher = makeNode(`${REPO_ID}:src/chat-client.ts:sendChatMessage`, { filePath: 'src/chat-client.ts' })
    const edges = [
      makeEdge(publisher.id, 'imports', { targetSpecifier: 'socket.io-client', targetSymbol: 'io' }),
      makeEdge(publisher.id, 'calls', { targetSymbol: 'emit', chainPath: 'socket', firstArg: 'message.send' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [publisher], edges }))

    expect(result[0]).toMatchObject({
      kind: 'event_publish',
      operation: 'publish',
      canonicalTarget: 'websocket:message.send',
      payload: { broker: 'websocket' },
    })
  })

  it('browser WebSocket constructor stores static URL listen target', () => {
    const listener = makeNode(`${REPO_ID}:src/realtimeSocket.ts:openDashboardSocket`, {
      type: 'function',
      name: 'openDashboardSocket',
      filePath: 'src/realtimeSocket.ts',
    })
    const edges = [
      makeEdge(listener.id, 'calls', {
        targetSymbol: 'WebSocket',
        literalArgs: JSON.stringify([null]),
        argExpressions: [
          {
            index: 0,
            kind: 'identifier',
            raw: 'DASHBOARD_STREAM_URL',
            resolution: 'static',
            resolved: {
              index: 0,
              kind: 'string',
              raw: "'wss://realtime.example.com/dashboard'",
              value: 'wss://realtime.example.com/dashboard',
              resolution: 'static',
            },
          },
        ],
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [listener], edges }))

    expect(result[0]).toMatchObject({
      kind: 'event_listen',
      operation: 'listen',
      canonicalTarget: 'websocket:wss://realtime.example.com/dashboard',
      payload: {
        broker: 'websocket',
        adapter: 'browser_websocket',
        url: 'wss://realtime.example.com/dashboard',
      },
    })
  })

  it('Supabase postgres_changes channel stores realtime listen target', () => {
    const fileNode = makeNode(`${REPO_ID}:src/ordersRealtime.ts`, {
      type: 'file',
      name: 'src/ordersRealtime.ts',
      filePath: 'src/ordersRealtime.ts',
    })
    const clientFileNode = makeNode(`${REPO_ID}:src/supabaseClient.ts`, {
      type: 'file',
      name: 'src/supabaseClient.ts',
      filePath: 'src/supabaseClient.ts',
    })
    const clientNode = makeNode(`${REPO_ID}:src/supabaseClient.ts:supabase`, {
      type: 'variable',
      name: 'supabase',
      filePath: 'src/supabaseClient.ts',
    })
    const listener = makeNode(`${REPO_ID}:src/ordersRealtime.ts:subscribeToOrderInserts`, {
      type: 'function',
      name: 'subscribeToOrderInserts',
      filePath: 'src/ordersRealtime.ts',
    })
    const edges = [
      makeEdge(fileNode.id, 'imports', {
        targetId: clientNode.id,
        targetSpecifier: './supabaseClient',
        targetSymbol: 'supabase',
      }),
      makeEdge(clientFileNode.id, 'imports', { targetSpecifier: '@supabase/supabase-js', targetSymbol: 'createClient' }),
      makeEdge(clientNode.id, 'calls', { targetSpecifier: '@supabase/supabase-js', targetSymbol: 'createClient' }),
      makeEdge(listener.id, 'calls', {
        targetSymbol: 'on',
        chainPath: "supabase\n  .channel('account-orders')",
        firstArg: 'postgres_changes',
        literalArgs: JSON.stringify([
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'orders' },
          null,
        ]),
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [fileNode, clientFileNode, clientNode, listener], edges }))

    expect(result[0]).toMatchObject({
      kind: 'event_listen',
      operation: 'subscribe',
      canonicalTarget: 'supabase_realtime:public.orders#INSERT',
      payload: {
        broker: 'supabase_realtime',
        adapter: 'supabase_realtime',
        channel: 'account-orders',
        schema: 'public',
        table: 'orders',
        event: 'INSERT',
      },
    })
  })

  it('Firebase Firestore onSnapshot stores static collection listen target', () => {
    const listener = makeNode(`${REPO_ID}:src/notificationsRealtime.ts:subscribeToTenantNotifications`, {
      type: 'function',
      name: 'subscribeToTenantNotifications',
      filePath: 'src/notificationsRealtime.ts',
    })
    const edges = [
      makeEdge(listener.id, 'calls', {
        targetSpecifier: 'firebase/firestore',
        targetSymbol: 'collection',
        literalArgs: JSON.stringify([null, 'tenantNotifications']),
        argExpressions: [
          { index: 0, kind: 'identifier', raw: 'db', resolution: 'dynamic' },
          { index: 1, kind: 'string', raw: "'tenantNotifications'", value: 'tenantNotifications', resolution: 'static' },
        ],
      }),
      makeEdge(listener.id, 'calls', {
        targetSpecifier: 'firebase/firestore',
        targetSymbol: 'onSnapshot',
        literalArgs: JSON.stringify([null, null]),
        argExpressions: [
          { index: 0, kind: 'identifier', raw: 'notificationsQuery', resolution: 'dynamic' },
          { index: 1, kind: 'unknown', raw: 'callback', resolution: 'dynamic' },
        ],
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [listener], edges }))

    expect(result[0]).toMatchObject({
      kind: 'event_listen',
      operation: 'subscribe',
      canonicalTarget: 'firebase_firestore:tenantNotifications',
      payload: {
        broker: 'firebase_firestore',
        adapter: 'firebase_firestore',
        collection: 'tenantNotifications',
      },
    })
  })

  it('Ably channel.subscribe stores static channel and event listen target', () => {
    const listener = makeNode(`${REPO_ID}:src/alertsRealtime.ts:subscribeToRiskAlerts`, {
      type: 'function',
      name: 'subscribeToRiskAlerts',
      filePath: 'src/alertsRealtime.ts',
    })
    const edges = [
      makeEdge(listener.id, 'imports', { targetSpecifier: 'ably', targetSymbol: 'Types' }),
      makeEdge(listener.id, 'calls', {
        targetSymbol: 'get',
        chainPath: 'ably.channels',
        literalArgs: JSON.stringify(['risk-alerts']),
        argExpressions: [
          { index: 0, kind: 'string', raw: "'risk-alerts'", value: 'risk-alerts', resolution: 'static' },
        ],
      }),
      makeEdge(listener.id, 'calls', {
        targetSymbol: 'subscribe',
        chainPath: 'channel',
        firstArg: 'alert.created',
        literalArgs: JSON.stringify(['alert.created', null]),
        argExpressions: [
          { index: 0, kind: 'string', raw: "'alert.created'", value: 'alert.created', resolution: 'static' },
          { index: 1, kind: 'identifier', raw: 'onAlert', resolution: 'dynamic' },
        ],
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [listener], edges }))

    expect(result[0]).toMatchObject({
      kind: 'event_listen',
      operation: 'subscribe',
      canonicalTarget: 'ably:risk-alerts/alert.created',
      payload: {
        broker: 'ably',
        adapter: 'ably_realtime',
        channel: 'risk-alerts',
        event: 'alert.created',
      },
    })
  })

  it('Pusher channel.bind stores static channel and event listen target', () => {
    const listener = makeNode(`${REPO_ID}:src/chatRealtime.ts:subscribeToChatMessages`, {
      type: 'function',
      name: 'subscribeToChatMessages',
      filePath: 'src/chatRealtime.ts',
    })
    const edges = [
      makeEdge(listener.id, 'uses_type', { targetSpecifier: 'pusher-js', targetSymbol: 'Channel' }),
      makeEdge(listener.id, 'calls', {
        targetSymbol: 'subscribe',
        chainPath: 'pusher',
        literalArgs: JSON.stringify(['private-chat']),
        argExpressions: [
          { index: 0, kind: 'string', raw: "'private-chat'", value: 'private-chat', resolution: 'static' },
        ],
      }),
      makeEdge(listener.id, 'calls', {
        targetSymbol: 'bind',
        chainPath: 'channel',
        firstArg: 'message:new',
        literalArgs: JSON.stringify(['message:new', null]),
        argExpressions: [
          { index: 0, kind: 'string', raw: "'message:new'", value: 'message:new', resolution: 'static' },
          { index: 1, kind: 'identifier', raw: 'onMessage', resolution: 'dynamic' },
        ],
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [listener], edges }))

    expect(result[0]).toMatchObject({
      kind: 'event_listen',
      operation: 'subscribe',
      canonicalTarget: 'pusher:private-chat/message:new',
      payload: {
        broker: 'pusher',
        adapter: 'pusher_realtime',
        channel: 'private-chat',
        event: 'message:new',
      },
    })
  })

  it('Ably subscribe with multiple static channel bindings does not guess a channel', () => {
    const listener = makeNode(`${REPO_ID}:src/alertsRealtime.ts:subscribeToMixedAlerts`, {
      type: 'function',
      name: 'subscribeToMixedAlerts',
      filePath: 'src/alertsRealtime.ts',
    })
    const edges = [
      makeEdge(listener.id, 'uses_type', { targetSpecifier: 'ably', targetSymbol: 'Types' }),
      makeEdge(listener.id, 'calls', {
        targetSymbol: 'get',
        chainPath: 'ably.channels',
        literalArgs: JSON.stringify(['risk-alerts']),
        argExpressions: [
          { index: 0, kind: 'string', raw: "'risk-alerts'", value: 'risk-alerts', resolution: 'static' },
        ],
      }),
      makeEdge(listener.id, 'calls', {
        targetSymbol: 'get',
        chainPath: 'ably.channels',
        literalArgs: JSON.stringify(['ops-alerts']),
        argExpressions: [
          { index: 0, kind: 'string', raw: "'ops-alerts'", value: 'ops-alerts', resolution: 'static' },
        ],
      }),
      makeEdge(listener.id, 'calls', {
        targetSymbol: 'subscribe',
        chainPath: 'channel',
        firstArg: 'alert.created',
        literalArgs: JSON.stringify(['alert.created', null]),
        argExpressions: [
          { index: 0, kind: 'string', raw: "'alert.created'", value: 'alert.created', resolution: 'static' },
          { index: 1, kind: 'identifier', raw: 'onAlert', resolution: 'dynamic' },
        ],
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [listener], edges }))
    expect(result.filter((relation) => relation.kind === 'event_listen')).toHaveLength(0)
  })

  it('Pusher bind with multiple static channel subscriptions does not guess a channel', () => {
    const listener = makeNode(`${REPO_ID}:src/chatRealtime.ts:subscribeToMixedChannels`, {
      type: 'function',
      name: 'subscribeToMixedChannels',
      filePath: 'src/chatRealtime.ts',
    })
    const edges = [
      makeEdge(listener.id, 'uses_type', { targetSpecifier: 'pusher-js', targetSymbol: 'Channel' }),
      makeEdge(listener.id, 'calls', {
        targetSymbol: 'subscribe',
        chainPath: 'pusher',
        literalArgs: JSON.stringify(['private-chat']),
        argExpressions: [
          { index: 0, kind: 'string', raw: "'private-chat'", value: 'private-chat', resolution: 'static' },
        ],
      }),
      makeEdge(listener.id, 'calls', {
        targetSymbol: 'subscribe',
        chainPath: 'pusher',
        literalArgs: JSON.stringify(['presence-support']),
        argExpressions: [
          { index: 0, kind: 'string', raw: "'presence-support'", value: 'presence-support', resolution: 'static' },
        ],
      }),
      makeEdge(listener.id, 'calls', {
        targetSymbol: 'bind',
        chainPath: 'channel',
        firstArg: 'message:new',
        literalArgs: JSON.stringify(['message:new', null]),
        argExpressions: [
          { index: 0, kind: 'string', raw: "'message:new'", value: 'message:new', resolution: 'static' },
          { index: 1, kind: 'identifier', raw: 'onMessage', resolution: 'dynamic' },
        ],
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [listener], edges }))
    expect(result.filter((relation) => relation.kind === 'event_listen')).toHaveLength(0)
  })

  it('Ably subscribe with tenant-derived channel does not emit a static event target', () => {
    const listener = makeNode(`${REPO_ID}:src/alertsRealtime.ts:subscribeToTenantAlerts`, {
      type: 'function',
      name: 'subscribeToTenantAlerts',
      filePath: 'src/alertsRealtime.ts',
    })
    const edges = [
      makeEdge(listener.id, 'uses_type', { targetSpecifier: 'ably', targetSymbol: 'Types' }),
      makeEdge(listener.id, 'calls', {
        targetSymbol: 'get',
        chainPath: 'ably.channels',
        literalArgs: JSON.stringify([null]),
        argExpressions: [
          { index: 0, kind: 'template', raw: '`tenant:${tenantId}:alerts`', resolution: 'dynamic' },
        ],
      }),
      makeEdge(listener.id, 'calls', {
        targetSymbol: 'subscribe',
        chainPath: 'channel',
        firstArg: 'alert.created',
        literalArgs: JSON.stringify(['alert.created', null]),
        argExpressions: [
          { index: 0, kind: 'string', raw: "'alert.created'", value: 'alert.created', resolution: 'static' },
          { index: 1, kind: 'identifier', raw: 'onAlert', resolution: 'dynamic' },
        ],
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [listener], edges }))
    expect(result.filter((relation) => relation.kind === 'event_listen')).toHaveLength(0)
  })

  it('Pusher bind with tenant-derived channel does not emit a static event target', () => {
    const listener = makeNode(`${REPO_ID}:src/chatRealtime.ts:subscribeToTenantChat`, {
      type: 'function',
      name: 'subscribeToTenantChat',
      filePath: 'src/chatRealtime.ts',
    })
    const edges = [
      makeEdge(listener.id, 'uses_type', { targetSpecifier: 'pusher-js', targetSymbol: 'Channel' }),
      makeEdge(listener.id, 'calls', {
        targetSymbol: 'subscribe',
        chainPath: 'pusher',
        literalArgs: JSON.stringify([null]),
        argExpressions: [
          { index: 0, kind: 'template', raw: '`private-tenant-${tenantId}`', resolution: 'dynamic' },
        ],
      }),
      makeEdge(listener.id, 'calls', {
        targetSymbol: 'bind',
        chainPath: 'channel',
        firstArg: 'message:new',
        literalArgs: JSON.stringify(['message:new', null]),
        argExpressions: [
          { index: 0, kind: 'string', raw: "'message:new'", value: 'message:new', resolution: 'static' },
          { index: 1, kind: 'identifier', raw: 'onMessage', resolution: 'dynamic' },
        ],
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [listener], edges }))
    expect(result.filter((relation) => relation.kind === 'event_listen')).toHaveLength(0)
  })

  it('Nest RPC MessagePattern can store nest_rpc when marked by decorator', () => {
    const listener = makeNode(`${REPO_ID}:src/rpc.ts:createOrder`)
    const edges = [
      makeEdge(listener.id, 'imports', { targetSpecifier: '@nestjs/microservices', targetSymbol: 'MessagePattern' }),
      makeEdge(listener.id, 'decorates', { targetSymbol: 'MessagePattern', firstArg: 'create_order' }),
      makeEdge(listener.id, 'decorates', { targetSymbol: 'RpcPattern', firstArg: 'create_order' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [listener], edges }))

    expect(result[0]).toMatchObject({
      kind: 'event_listen',
      canonicalTarget: 'nest_rpc:create_order',
      payload: { broker: 'nest_rpc' },
    })
  })
})

describe('event/schedule/external_service no-emit guardrails', () => {
  it('REL-N01/REL-N15: upload call without package anchor stores no external_service', () => {
    const handler = makeNode(`${REPO_ID}:src/local.ts:upload`)
    const edges = [
      makeEdge(handler.id, 'calls', { targetSymbol: 'putObject', chainPath: 'S3Client', firstArg: 'avatars' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [handler], edges }))
    expect(result.filter((r) => r.kind === 'external_service')).toHaveLength(0)
  })

  it('REL-N07: programmatic scheduler without @nestjs/schedule anchor stores no marker', () => {
    const job = makeNode(`${REPO_ID}:src/jobs.ts:addJob`)
    const edges = [
      makeEdge(job.id, 'calls', { targetSymbol: 'addCronJob', chainPath: 'schedulerRegistry', firstArg: 'my-job' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [job], edges }))
    expect(result.filter((r) => r.kind === 'schedule_trigger')).toHaveLength(0)
  })

  it('REL-S25: schedulerRegistry.addCronJob with schedule import stores cron marker', () => {
    const job = makeNode(`${REPO_ID}:src/jobs.ts:addJob`)
    const edges = [
      makeEdge(job.id, 'imports', { targetSpecifier: '@nestjs/schedule', targetSymbol: 'SchedulerRegistry' }),
      makeEdge(job.id, 'calls', { targetSymbol: 'addCronJob', chainPath: 'schedulerRegistry', firstArg: 'my-job' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [job], edges }))
    expect(result[0]).toMatchObject({
      kind: 'schedule_trigger',
      operation: 'trigger',
      payload: { schedule_type: 'cron', job_name: 'my-job', adapter: 'nest_schedule' },
    })
  })

  it('REL-N11/N14: dynamic event name without fallback stores no event relation', () => {
    const publisher = makeNode(`${REPO_ID}:src/events.ts:publishDynamic`)
    const edges = [
      makeEdge(publisher.id, 'imports', { targetSpecifier: '@nestjs/event-emitter', targetSymbol: 'EventEmitter2' }),
      makeEdge(publisher.id, 'calls', { targetSymbol: 'emit', chainPath: 'eventEmitter', firstArg: 'eventName' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [publisher], edges }))
    expect(result.filter((r) => r.kind === 'event_publish')).toHaveLength(0)
  })
})
