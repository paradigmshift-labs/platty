import type { Framework } from '@/db/schema/enums.js'
import type { Adapter } from '../types.js'

export interface HttpCallRouteAdapterOptions {
  name: string
  frameworkMatches: Framework[]
  importSpecifiers: string[]
  roots: string[]
  priority?: number
}

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'all', 'head', 'options'] as const

export function createHttpCallRouteAdapter(options: HttpCallRouteAdapterOptions): Adapter {
  return {
    name: options.name,
    version: '1.0.0',
    type: 'B',
    language: 'typescript',
    detection: {
      manifestFrameworkMatch: options.frameworkMatches,
      importSpecifiers: options.importSpecifiers,
    },
    minEvidence: 'manifest_only',
    priority: options.priority ?? 30,
    supportsGlobalPrefix: true,
    entrypointRules: [
      {
        id: `${options.name}_route_call`,
        kind: 'api',
        select: {
          relation: 'calls',
          callee: {
            chain_path_root_in: options.roots,
            method: [...HTTP_METHODS],
          },
          first_arg: { kind: 'string_literal' },
          // Emergent-mode evidence gate (no-op in default mode): the rule self-gates on the
          // framework import so it doesn't fire on lookalike `app.get` in unrelated frameworks.
          requires_import: options.importSpecifiers,
          // Emergent-mode arity gate: a route registers a handler (≥2 args), so this excludes
          // single-arg settings getters like `app.get('env')` / `app.set('view engine')`.
          min_arg_count: 2,
        },
        extract: {
          http_method: '${callee.method → uppercase}',
          path: '${first_arg}',
          handler_node_id: '${self}',
        },
      },
    ],
  }
}
