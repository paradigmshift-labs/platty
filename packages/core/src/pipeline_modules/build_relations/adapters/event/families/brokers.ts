export type EventBroker =
  | 'bull'
  | 'kafka'
  | 'rabbitmq'
  | 'graphql_pubsub'
  | 'sqs'
  | 'sns'
  | 'nats'
  | 'ably'
  | 'pusher'
  | 'websocket'
  | 'node_event'
  | 'nestjs_cqrs'

export type EventBrokerPackageDefinition = {
  packages: readonly string[]
}

export const EVENT_BROKER_PACKAGE_DEFINITIONS = {
  bull: {
    packages: ['bull', 'bullmq', 'bee-queue'],
  },
  kafka: {
    packages: ['kafkajs', '@nestjs/microservices'],
  },
  rabbitmq: {
    packages: ['amqplib', 'amqp-connection-manager'],
  },
  graphql_pubsub: {
    packages: ['graphql-subscriptions'],
  },
  sqs: {
    packages: ['@aws-sdk/client-sqs', 'aws-sdk'],
  },
  sns: {
    packages: ['@aws-sdk/client-sns'],
  },
  nats: {
    packages: ['nats'],
  },
  ably: {
    packages: ['ably', 'ably/promises'],
  },
  pusher: {
    packages: ['pusher-js'],
  },
  websocket: {
    packages: ['@nestjs/websockets', 'socket.io-client'],
  },
  node_event: {
    packages: ['@nestjs/event-emitter', 'eventemitter2'],
  },
  nestjs_cqrs: {
    packages: ['@nestjs/cqrs'],
  },
} satisfies Record<EventBroker, EventBrokerPackageDefinition>

export const EVENT_BROKER_PACKAGE_SET = new Set(
  Object.values(EVENT_BROKER_PACKAGE_DEFINITIONS).flatMap((definition) => definition.packages),
)

export function eventBrokerForPackage(pkg: string | null | undefined): EventBroker | null {
  if (!pkg) return null
  return (Object.entries(EVENT_BROKER_PACKAGE_DEFINITIONS) as Array<[EventBroker, EventBrokerPackageDefinition]>)
    .find(([, definition]) => definition.packages.includes(pkg))
    ?.[0] ?? null
}
