// Flutter GetX — Type B (GetMaterialApp + GetPage list)

import type { Adapter } from '../types.js'

export const flutter_getx: Adapter = {
  name: 'flutter_getx',
  version: '1.0.0',
  type: 'B',
  language: 'dart',

  detection: {
    manifestFrameworkMatch: ['flutter'],
    manifestRoutingLibMatch: ['get'],
  },
  minEvidence: 'manifest_only',
  priority: 30,

  entrypointRules: [],
}
