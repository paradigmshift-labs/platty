import type { SemanticIndex } from '../../../types.js'
import { extractAwsMessagingCandidates } from './aws_messaging.js'
import { extractBullQueueCandidates } from './bull_queue.js'
import { extractGenericRealtimeCandidates, detectBrowserWebSocketBroker } from './generic_realtime.js'
import { extractKafkaCandidates } from './kafka.js'
import { extractNestCqrsCandidates } from './nest_cqrs.js'
import { extractNestDecoratorCandidates } from './nest_decorators.js'
import { extractRabbitCandidates } from './rabbitmq.js'
import type { BuildRelationsInputs, EventBrokerExtractionContext, EventBrokerExtractionFamily } from './types.js'
import { collectPackageImportsForNode, decoratorsWithParentClass } from './utils.js'

const EVENT_BROKER_EXTRACTION_FAMILIES: readonly EventBrokerExtractionFamily[] = [
  { name: 'nestjs_cqrs', extract: extractNestCqrsCandidates },
  { name: 'bull_queue', extract: extractBullQueueCandidates },
  { name: 'kafka', extract: extractKafkaCandidates },
  { name: 'rabbitmq', extract: extractRabbitCandidates },
  { name: 'aws_messaging', extract: extractAwsMessagingCandidates },
  { name: 'generic_realtime', extract: extractGenericRealtimeCandidates },
  { name: 'nest_decorators', extract: extractNestDecoratorCandidates },
]

export { detectBrowserWebSocketBroker }

export function extractEventBrokerFamilyCandidates(args: {
  inputs: BuildRelationsInputs
  index: SemanticIndex
  node: EventBrokerExtractionContext['node']
  broker: string
}): ReturnType<EventBrokerExtractionFamily['extract']> {
  const { inputs, index, node, broker } = args
  const decorators = decoratorsWithParentClass(node.id, index)
  const context: EventBrokerExtractionContext = {
    inputs,
    index,
    node,
    broker,
    calls: index.callsBySource.get(node.id) ?? [],
    decorators,
    processor: decorators.find((d) => d.targetSymbol === 'Processor'),
    rabbit: decorators.find((d) => d.targetSymbol === 'RabbitMQ'),
    packageImports: collectPackageImportsForNode(node.id, index),
  }

  return EVENT_BROKER_EXTRACTION_FAMILIES.flatMap((family) => family.extract(context))
}
