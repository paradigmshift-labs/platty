// Flutter auto_route — Type B (AutoRoute list)

import type { Adapter } from '../types.js'

export const flutter_auto_route: Adapter = {
  name: 'flutter_auto_route',
  version: '1.0.0',
  type: 'B',
  language: 'dart',

  detection: {
    manifestFrameworkMatch: ['flutter'],
    manifestRoutingLibMatch: ['auto_route'],
  },
  minEvidence: 'manifest_only',
  priority: 30,

  entrypointRules: [],
}
