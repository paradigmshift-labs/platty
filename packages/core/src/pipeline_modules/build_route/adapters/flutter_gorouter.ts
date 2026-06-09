// Flutter GoRouter — Type B (lambda builder)
// architecture.md §4.4

import type { Adapter } from '../types.js'

export const flutter_gorouter: Adapter = {
  name: 'flutter_gorouter',
  version: '1.0.0',
  type: 'B',
  language: 'dart',

  detection: {
    manifestFrameworkMatch: ['flutter'],
    manifestRoutingLibMatch: ['go_router'],
  },
  minEvidence: 'manifest_only',
  priority: 30,

  entrypointRules: [
    {
      id: 'go_route',
      kind: 'page',
      select: {
        relation: 'calls',
        callee: { symbol: 'GoRoute' },
        first_arg: { kind: 'string_literal' },
      },
      extract: {
        path: '${first_arg}',
        full_path: '${parent_path}/${path}',
        handler_node_id: '${self}',
      },
      nested: {
        parentField: 'named_arg.routes',
        childRuleRef: 'go_route',
      },
    },
  ],
}
