// Flutter Beamer — Type B (BeamLocation pathPatterns)

import type { Adapter } from '../types.js'

export const flutter_beamer: Adapter = {
  name: 'flutter_beamer',
  version: '1.0.0',
  type: 'B',
  language: 'dart',

  detection: {
    manifestFrameworkMatch: ['flutter'],
    manifestRoutingLibMatch: ['beamer'],
  },
  minEvidence: 'manifest_only',
  priority: 30,

  entrypointRules: [],
}
