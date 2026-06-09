// canonical target 정규화 유틸리티

// path parameter 표기 변환: /users/${id}, /users/[id], /users/{id}, /users/:id → /users/:param
export function normalizePathParams(path: string): string {
  return path
    .replace(/\/\$\{[^}]+\}/g, '/:param')
    .replace(/\/\[[^\]]+\]/g, '/:param')
    .replace(/\/\{[^}]+\}/g, '/:param')
    .replace(/\/:[^/?]+/g, '/:param')
}

// path 정규화: lowercase, trailing slash 제거, query string 제거
export function normalizePath(path: string): string {
  return normalizePathParams(path)
    .replace(/\?.*$/, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

// API canonical target 정규화: "METHOD /path" 형식
// "/users/:id" 같은 형식에서 path params을 :param으로 정규화
export function normalizeApiCanonicalTarget(raw: string): string {
  const parts = raw.split(' ')
  if (parts.length < 2) return raw.toLowerCase()
  const method = parts[0].toUpperCase()
  const path = normalizePath(parts.slice(1).join(' '))
  return `${method} ${path}`
}

// screen canonical target: "screen:/path" 형식
export function normalizeScreenCanonicalTarget(raw: string): string {
  const path = raw.startsWith('screen:') ? raw.slice('screen:'.length) : raw
  return `screen:${normalizePath(path)}`
}

// entry point path를 정규화해서 비교용으로 사용
export function normalizeEntryPath(path: string): string {
  return normalizePath(path)
}

// file path를 segment 배열로 분해 (proximity 계산용)
export function splitPathSegments(filePath: string): string[] {
  return filePath.split('/').filter(Boolean)
}

// 두 file path의 공통 선행 segment 수 계산 (prefix proximity)
export function countSharedPrefixSegments(a: string, b: string): number {
  const segsA = splitPathSegments(a)
  const segsB = splitPathSegments(b)
  let count = 0
  for (let i = 0; i < Math.min(segsA.length, segsB.length); i++) {
    if (segsA[i] === segsB[i]) count++
    else break
  }
  return count
}

// db canonical_target에서 table 이름 추출: "db:orders:insert" → "orders"
export function extractDbTable(canonicalTarget: string): string {
  const parts = canonicalTarget.split(':')
  return parts[1] ?? canonicalTarget
}

// event canonical_target에서 event node id 생성
// "node_event:order.created" → "event:node_event:order.created"
export function eventNodeId(canonicalTarget: string): string {
  return `event:${canonicalTarget}`
}
