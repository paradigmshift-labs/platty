import type { StaticAnalysisRoleRegistryEntry } from '../types.js'

export const dartRoleRegistryEntries: StaticAnalysisRoleRegistryEntry[] = [
  {
    ecosystem: 'dart',
    packageName: 'go_router',
    role: 'mobile_navigation',
    curation: 'official',
    confidence: 'high',
    defaultRuleIds: ['route.flutter.go-router'],
  },
]
