// react-router/react-router-dom — Type B (JSX <Route> + nested)
// architecture.md §4.4

import type { Adapter } from '../types.js'

export const react_router_v6: Adapter = {
  name: 'react_router_v6',
  version: '1.0.0',
  type: 'B',
  language: 'typescript',

  detection: {
    manifestRoutingLibMatch: ['react-router-dom@^4', 'react-router-dom@^5', 'react-router-dom@^6', 'react-router-dom@^7', 'react-router@^0', 'react-router@^4', 'react-router@^6', 'react-router@^7', 'react-router', 'wouter', '@tanstack/react-router@^1', '@tanstack/react-router'],
    importSpecifiers: ['react-router-dom', 'react-router', 'wouter', '@tanstack/react-router'],
  },
  minEvidence: 'manifest_only',
  priority: 30,
  exclusiveWith: ['nextjs'],

  entrypointRules: [
    {
      id: 'route_jsx',
      kind: 'page',
      select: {
        relation: 'renders',
        callee: { symbol: 'Route' },
        first_arg: { kind: 'string_literal' },
      },
      extract: {
        path: '${first_arg}',
        full_path: '${parent_path}/${path}',
        handler_node_id: '${self}',
      },
      nested: {
        parentField: 'jsx_children',
        childRuleRef: 'route_jsx',
      },
    },
  ],
}
