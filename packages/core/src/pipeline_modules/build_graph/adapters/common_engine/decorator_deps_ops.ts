// common_engine/decorator_deps_ops — 파서-무관 decorator 의존성 식별자 추출 (S4 추출).
// @Module({providers:[X]}) 분해 + GUARD_LIKE_DECORATORS 화이트리스트. canonical-동일.

import type { EngineNode, LanguageSpec } from './types.js'

// Guard B 화이트리스트: 단일/배열 identifier 인자 직접 추출 (NestJS 패턴, repo-무관).
const GUARD_LIKE_DECORATORS = new Set(['UseGuards', 'UseInterceptors', 'UseFilters', 'UsePipes'])

/** decorator 객체 인자에서 의존성 식별자 추출. @Module({controllers:[X],providers:[Y]}) → ['X','Y']. */
export function extractDecoratorDependencies(
  argumentsNode: EngineNode | null,
  decoratorName: string | null,
  spec: LanguageSpec,
): string[] {
  if (!argumentsNode) return []

  if (decoratorName && GUARD_LIKE_DECORATORS.has(decoratorName)) {
    const deps: string[] = []
    const seen = new Set<string>()
    for (const child of argumentsNode.children) {
      if (!child) continue
      if (child.type === spec.identifierType && !seen.has(child.text)) {
        seen.add(child.text)
        deps.push(child.text)
        continue
      }
      if (child.type === spec.arrayType) {
        for (const el of child.children) {
          if (!el) continue
          if (el.type === spec.identifierType && !seen.has(el.text)) {
            seen.add(el.text)
            deps.push(el.text)
          }
        }
      }
    }
    return deps
  }

  const objArg = argumentsNode.children.find((c) => c?.type === spec.objectType)
  if (!objArg) return []

  const deps: string[] = []
  const seen = new Set<string>()
  for (const pair of objArg.children) {
    if (!pair) continue
    if (pair.type !== spec.pairType) continue
    const value = pair.childForFieldName(spec.valueField)
    if (!value) continue
    if (value.type === spec.arrayType) {
      for (const el of value.children) {
        if (!el) continue
        if (el.type === spec.identifierType && !seen.has(el.text)) {
          seen.add(el.text)
          deps.push(el.text)
        }
      }
    } else if (value.type === spec.identifierType && !seen.has(value.text)) {
      seen.add(value.text)
      deps.push(value.text)
    }
  }
  return deps
}

/** decorator 노드 → 객체 인자에서 의존성 식별자 배열 추출. */
export function getDecoratorDependencyIdents(decoratorNode: EngineNode, spec: LanguageSpec): string[] {
  for (const child of decoratorNode.children) {
    if (!child) continue
    if (child.type === spec.callType) {
      const fn = child.childForFieldName(spec.functionField)
      const decoratorName = fn?.text ?? null
      const args = child.childForFieldName(spec.argumentsField)
      return extractDecoratorDependencies(args, decoratorName, spec)
    }
  }
  return []
}
