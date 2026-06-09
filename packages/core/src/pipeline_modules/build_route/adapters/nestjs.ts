// NestJS — Type C (controller class + method decorator)
// architecture.md §4.4 룰 스케치 따라.

import type { Adapter } from '../types.js'

export const nestjs: Adapter = {
  name: 'nestjs',
  version: '1.0.0',
  type: 'C',
  language: 'typescript',

  detection: {
    manifestFrameworkMatch: ['nestjs'],
    importSpecifiers: ['@nestjs/core', '@nestjs/common'],
  },
  minEvidence: 'manifest_only',
  priority: 50,
  supportsGlobalPrefix: true,

  entrypointRules: [
    {
      // 표준 NestJS HTTP decorator + Nestia @TypedRoute.{Method} chain decorator.
      // build_graph는 chain decorator(@TypedRoute.Get)를 target_symbol="TypedRoute.Get"로 저장.
      // extract의 after_last_dot transform이 'TypedRoute.Get' → 'Get' → 'GET'으로 정규화.
      id: 'api_handler',
      kind: 'api',
      select: {
        node_type: 'method',
        decorated_by: [
          'Get', 'Post', 'Put', 'Delete', 'Patch', 'All', 'Options', 'Head',
          'TypedRoute.Get', 'TypedRoute.Post', 'TypedRoute.Put',
          'TypedRoute.Delete', 'TypedRoute.Patch', 'TypedRoute.Options', 'TypedRoute.Head',
        ],
        enclosing_class_decorated_by: 'Controller',
      },
      extract: {
        http_method: '${decorator_name → after_last_dot → uppercase}',
        path: '${decorator.first_arg}',
        parent_path: '${enclosing_class.Controller.first_arg}',
        handler_node_id: '${self}',
      },
    },
    {
      id: 'schedule_job',
      kind: 'job',
      select: {
        node_type: 'method',
        decorated_by: ['Cron', 'Interval', 'Timeout'],
      },
      extract: {
        handler_node_id: '${self}',
      },
    },
    {
      id: 'sse_handler',
      kind: 'api',
      select: {
        node_type: 'method',
        decorated_by: 'Sse',
        enclosing_class_decorated_by: 'Controller',
      },
      extract: {
        http_method: 'GET',
        path: '${decorator.first_arg}',
        parent_path: '${enclosing_class.Controller.first_arg}',
        handler_node_id: '${self}',
      },
    },
  ],

  aliasResolution: {
    via: ['applyDecorators', 'function_returning_decorator'],
    standardDecorators: [
      'Get',
      'Post',
      'Put',
      'Delete',
      'Patch',
      'All',
      'Options',
      'Head',
      'Cron',
      'Interval',
      'Timeout',
      'Sse',
    ],
    aliasDepth: 3,
  },
}
