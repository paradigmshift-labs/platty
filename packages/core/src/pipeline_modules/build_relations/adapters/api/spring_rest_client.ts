// Spring RestTemplate api_call adapter (JVM/Java + Kotlin)
// SOT: specs/build_relations/jvm_recognition.md §4 + §10c
//
// Spring's classic HTTP client is a DI'd field used as `this.rt.getForObject(url, ...)`. Two things make
// the generic httpClientApiAdapter unable to see it:
//   1. its verbs (getForObject/postForEntity/exchange/…) are NOT bare HTTP method names, so the
//      HTTP_METHODS gate drops them before any anchor is consulted;
//   2. the receiver is the field name `rt`, not the imported symbol `RestTemplate`, so import-symbol
//      anchoring never matches.
// This dedicated adapter maps the verb and resolves the anchor by the field's resolved TYPE
// (classFieldOrigins, populated for JVM fields by buildSemanticIndex), exactly like detectDbAnchor's
// receiver-type tail — keeping httpClientApiAdapter byte-identical for TS/Dart.

import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../types.js'
import type { RelationAdapterContext, RelationCandidateAdapter } from '../types.js'
import { isJvmApiClientType } from './packages.js'

const INTERNAL_PATH_RE = /^\/[^/]/
const EXTERNAL_URL_RE = /^https?:\/\//
const IDENTIFIER_RE = /^[A-Za-z_$][\w.$]*$/

// RestTemplate verb → HTTP method. Verbs whose HTTP method is carried in an `HttpMethod.X` argument
// (`exchange`, `execute`) are intentionally omitted for this increment (would require arg-type resolution).
const SPRING_REST_VERB_MAP: Record<string, string> = {
  getforobject: 'GET',
  getforentity: 'GET',
  postforobject: 'POST',
  postforentity: 'POST',
  postforlocation: 'POST',
  put: 'PUT',
  delete: 'DELETE',
  patchforobject: 'PATCH',
  headforheaders: 'HEAD',
  optionsforallow: 'OPTIONS',
}

function isJvmSourceFile(filePath: string): boolean {
  return filePath.endsWith('.java') || filePath.endsWith('.kt') || filePath.endsWith('.kts')
}

// receiver field (`this.rt` → `rt`) → its DI'd field type → matched against JVM_API_CLIENT_TYPES.
// No originKind requirement (JVM emits no field-origin decorator) — mirrors detectDbAnchor's typeName tail.
function resolveJvmHttpClientType(nodeId: string, chainPath: string, index: SemanticIndex): string | null {
  const fieldName = chainPath.replace(/^this\./, '').split('.')[0]
  if (!fieldName) return null
  const parentClassId = index.containsParentByChild.get(nodeId)
  if (!parentClassId) return null
  const origin = index.classFieldOrigins.get(parentClassId)?.get(fieldName)
  if (origin?.typeName && isJvmApiClientType(origin.typeName)) return origin.typeName
  return null
}

export const springRestClientApiAdapter: RelationCandidateAdapter = {
  name: 'spring_rest_client',
  relationKind: 'api_call',
  matchCall(edge: CodeEdgeLike, sourceNodeId: string, context: RelationAdapterContext): RelationCandidate | null {
    const method = edge.targetSymbol
    if (!method) return null
    const httpMethod = SPRING_REST_VERB_MAP[method.toLowerCase()]
    if (!httpMethod) return null

    const chainPath = edge.chainPath
    if (!chainPath) return null

    // JVM-only: the type anchor could theoretically collide with a TS field also named RestTemplate.
    const node = context.index.nodesById.get(sourceNodeId)
    if (!node || !isJvmSourceFile(node.filePath)) return null

    const anchorType = resolveJvmHttpClientType(sourceNodeId, chainPath, context.index)
    if (!anchorType) return null

    const rawTarget = edge.firstArg
    if (!rawTarget) return null
    if (!EXTERNAL_URL_RE.test(rawTarget) && !INTERNAL_PATH_RE.test(rawTarget) && !IDENTIFIER_RE.test(rawTarget)) return null

    return {
      kind: 'api_call',
      sourceNodeId,
      evidenceNodeIds: [`edge:${edge.id}`],
      chainPath,
      firstArg: rawTarget,
      rawTarget,
      payload: { method: httpMethod, protocol: 'rest', anchor: anchorType, adapter: 'spring_rest_client' },
    }
  },
}
