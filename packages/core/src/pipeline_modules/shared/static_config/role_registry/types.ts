export type StaticAnalysisEcosystem =
  | 'typescript'
  | 'dart'
  | 'java'
  | 'kotlin'
  | 'swift'

export type StaticAnalysisPackageRole =
  | 'backend_route'
  | 'frontend_route'
  | 'mobile_navigation'
  | 'db_client'
  | 'api_client'
  | 'service_sdk'

export type StaticAnalysisRoleCuration = 'official' | 'community' | 'heuristic'

export type StaticAnalysisRoleConfidence = 'high' | 'medium' | 'low'

export interface StaticAnalysisRoleRegistryEntry {
  ecosystem: StaticAnalysisEcosystem
  packageName: string
  role: StaticAnalysisPackageRole
  curation: StaticAnalysisRoleCuration
  confidence: StaticAnalysisRoleConfidence
  defaultRuleIds?: string[]
  notes?: string
}

export interface StaticAnalysisRoleLookupInput {
  ecosystem: StaticAnalysisEcosystem | string | null | undefined
  packageName: string | null | undefined
}
