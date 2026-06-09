// Spring MVC/WebFlux annotation controllers — Type C.

import type { Adapter, EntrypointRule } from '../types.js'

const CONTROLLER_DECORATORS = ['RestController', 'Controller'] as const
const HTTP_MAPPINGS = [
  ['GetMapping', 'GET'],
  ['PostMapping', 'POST'],
  ['PutMapping', 'PUT'],
  ['DeleteMapping', 'DELETE'],
  ['PatchMapping', 'PATCH'],
] as const

const WEBFLUX_PREDICATES = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const
const MAPPING_ARRAY_FIELDS = ['value', 'path'] as const
const EVENT_LISTENERS = ['EventListener', 'KafkaListener', 'RabbitListener', 'JmsListener', 'SqsListener', 'ExceptionHandler'] as const
const MESSAGE_LISTENERS = ['MessageMapping', 'SubscribeMapping'] as const

const apiRules: EntrypointRule[] = CONTROLLER_DECORATORS.flatMap((controllerDecorator) =>
  [
    ...HTTP_MAPPINGS.map(([decorator, method]) => ({
      id: `api_handler_${controllerDecorator}_${decorator}`,
      kind: 'api' as const,
      select: {
        node_type: 'method' as const,
        decorated_by: decorator,
        enclosing_class_decorated_by: controllerDecorator,
      },
      extract: {
        http_method: method,
        path: '${decorator.first_arg}',
        parent_path: '${enclosing_class.RequestMapping.first_arg}',
        handler_node_id: '${self}',
      },
    })),
    ...HTTP_MAPPINGS.flatMap(([decorator, method]) =>
      MAPPING_ARRAY_FIELDS.map((field) => ({
        id: `api_handler_${controllerDecorator}_${decorator}_${field}_array`,
        kind: 'api' as const,
        select: {
          node_type: 'method' as const,
          decorated_by: decorator,
          enclosing_class_decorated_by: controllerDecorator,
        },
        walk: {
          iterate: 'array_element' as const,
          field,
        },
        extract: {
          http_method: method,
          path: '${entry.value}',
          parent_path: '${enclosing_class.RequestMapping.first_arg}',
          handler_node_id: '${self}',
        },
      })),
    ),
    {
      id: `api_handler_${controllerDecorator}_RequestMapping_method`,
      kind: 'api' as const,
      select: {
        node_type: 'method' as const,
        decorated_by: 'RequestMapping',
        enclosing_class_decorated_by: controllerDecorator,
      },
      extract: {
        http_method: '${decorator.arg.method → after_last_dot → uppercase}',
        path: '${decorator.first_arg}',
        parent_path: '${enclosing_class.RequestMapping.first_arg}',
        handler_node_id: '${self}',
      },
    },
    ...MAPPING_ARRAY_FIELDS.map((field) => ({
      id: `api_handler_${controllerDecorator}_RequestMapping_method_${field}_array`,
      kind: 'api' as const,
      select: {
        node_type: 'method' as const,
        decorated_by: 'RequestMapping',
        enclosing_class_decorated_by: controllerDecorator,
      },
      walk: {
        iterate: 'array_element' as const,
        field,
      },
      extract: {
        http_method: '${decorator.arg.method → after_last_dot → uppercase}',
        path: '${entry.value}',
        parent_path: '${enclosing_class.RequestMapping.first_arg}',
        handler_node_id: '${self}',
      },
    })),
  ],
)

export const spring: Adapter = {
  name: 'spring',
  version: '1.0.0',
  type: 'C',
  language: ['java', 'kotlin'],

  detection: {
    manifestFrameworkMatch: ['spring'],
    importSpecifiers: [
      'org.springframework.web.bind.annotation',
      'org.springframework.stereotype',
      'org.springframework.messaging.handler.annotation',
      'org.springframework.messaging.simp.annotation',
    ],
  },
  minEvidence: 'manifest_only',
  priority: 50,
  supportsGlobalPrefix: true,

  entrypointRules: [
    ...apiRules,
    ...WEBFLUX_PREDICATES.map((method) => ({
      id: `webflux_functional_${method}`,
      kind: 'api' as const,
      select: {
        node_type: 'method' as const,
        callee: {
          chain_path_root_in: ['RequestPredicates'],
          method,
        },
      },
      extract: {
        http_method: '${callee.method}',
        path: '${first_arg}',
        handler_node_id: '${self}',
      },
    })),
    ...WEBFLUX_PREDICATES.map((method) => ({
      id: `webflux_functional_static_import_${method}`,
      kind: 'api' as const,
      select: {
        node_type: 'method' as const,
        callee: {
          symbol: method,
        },
      },
      extract: {
        http_method: '${callee.method}',
        path: '${first_arg}',
        handler_node_id: '${self}',
      },
    })),
    {
      id: 'scheduled_job',
      kind: 'job',
      select: {
        node_type: 'method',
        decorated_by: 'Scheduled',
      },
      extract: {
        handler_node_id: '${self}',
      },
    },
    ...EVENT_LISTENERS.map((decorator) => ({
      id: `event_listener_${decorator}`,
      kind: 'event' as const,
      select: {
        node_type: 'method' as const,
        decorated_by: decorator,
      },
      extract: {
        path: '${decorator.first_arg}',
        handler_node_id: '${self}',
      },
    })),
    ...MESSAGE_LISTENERS.map((decorator) => ({
      id: `message_listener_${decorator}`,
      kind: 'event' as const,
      select: {
        node_type: 'method' as const,
        decorated_by: decorator,
      },
      extract: {
        path: '${decorator.first_arg}',
        handler_node_id: '${self}',
      },
    })),
  ],

  aliasResolution: {
    via: ['composed_annotation'],
    standardDecorators: [
      'RestController',
      'Controller',
      'RequestMapping',
      'GetMapping',
      'PostMapping',
      'PutMapping',
      'DeleteMapping',
      'PatchMapping',
      'Scheduled',
      ...EVENT_LISTENERS,
      ...MESSAGE_LISTENERS,
    ],
    aliasDepth: 3,
  },
}
