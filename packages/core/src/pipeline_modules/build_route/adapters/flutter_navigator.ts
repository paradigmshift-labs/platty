// Flutter Navigator 1.0 — Type B (routes map + onGenerateRoute LLM fallback)
// architecture.md §4.4

import type { Adapter } from '../types.js'

export const flutter_navigator: Adapter = {
  name: 'flutter_navigator',
  version: '1.0.0',
  type: 'B',
  language: 'dart',

  detection: {
    manifestFrameworkMatch: ['flutter'],
    manifestRoutingLibAbsent: true,
  },
  minEvidence: 'manifest_only',
  priority: 10,

  entrypointRules: [
    {
      id: 'routes_map',
      kind: 'page',
      select: {
        relation: 'calls',
        callee: { symbol: ['MaterialApp', 'CupertinoApp'] },
      },
      walk: {
        iterate: 'map_entries',
        // field: orchestrator가 matched edge의 literalArgs에서 추출할 named arg 이름.
        // MaterialApp(routes: {...}) 호출의 'routes' 인자 값(맵)을 walk source로 사용.
        field: 'routes',
      },
      extract: {
        path: '${entry.key}',
        handler_node_id: '${entry.value}',
      },
    },
    {
      id: 'on_generate_route',
      kind: 'page',
      select: {
        relation: 'calls',
        callee: { symbol: ['MaterialApp', 'CupertinoApp'] },
      },
      extract: {},
      delegateTo: 'llm_fallback',
    },
  ],
}
