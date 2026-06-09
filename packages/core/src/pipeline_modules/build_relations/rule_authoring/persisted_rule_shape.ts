// Pure (LLM-free) conversion of promoted AuthoredRelationRule[] into the persisted/consumed emit-rule shapes.
// Extracted from live_runner.ts so consumers (the LLM-free dsl_builder) can import it WITHOUT pulling
// live_runner's top-level `callSynthesizer`/`getLlmAdapter` imports into their module graph. live_runner.ts
// re-exports it for back-compat. All imports here are `import type` (erased) → zero runtime dependency.

import type { AuthoredRelationRule } from './autonomous_loop.js'
import type { DbAccessEmitRule } from './db_access_promote_gate.js'
import type { ApiCallEmitRule } from './api_call_promote_gate.js'
import type { ExternalServiceEmitRule } from './promote_gate.js'

/** Convert the loop's tagged AuthoredRelationRule[] into the persisted/consumed emit-rule shapes. */
export function toPersistedRelationRules(promoted: AuthoredRelationRule[]): {
  dbAccess: DbAccessEmitRule[]; apiCall: ApiCallEmitRule[]; externalService: ExternalServiceEmitRule[]
} {
  const dbAccess: DbAccessEmitRule[] = []
  const apiCall: ApiCallEmitRule[] = []
  const externalService: ExternalServiceEmitRule[] = []
  for (const a of promoted) {
    if (a.kind === 'db_access') {
      dbAccess.push({ ormLabel: a.candidate.ormLabel, clientPackages: a.candidate.clientPackages, operationByMethod: a.candidate.operationByMethod, tableSource: a.candidate.tableSource, modelQuery: a.candidate.modelQuery })
    } else if (a.kind === 'api_call') {
      apiCall.push({ clientLabel: a.candidate.clientLabel, clientPackages: a.candidate.clientPackages, methodBySymbol: a.candidate.methodBySymbol })
    } else {
      externalService.push({ label: a.candidate.label, packages: a.candidate.packages, methods: a.candidate.methods, resolve: a.candidate.resolve })
    }
  }
  return { dbAccess, apiCall, externalService }
}
