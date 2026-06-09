import type {
  ConfiguredCustomDecorator,
  ResolvedConfigSource,
  StaticAnalysisPatternRule,
  StaticAnalysisPatternRuleMatch,
} from './types.js'

/**
 * HTTP verb decorator names (NestJS-style) → uppercase method.
 * A custom route decorator declares `resolvesTo` as a standard decorator name
 * (e.g. 'Post'); we translate that to the HTTP operation the route emits.
 */
const HTTP_VERB_BY_DECORATOR: Record<string, string> = {
  get: 'GET',
  post: 'POST',
  put: 'PUT',
  patch: 'PATCH',
  delete: 'DELETE',
  options: 'OPTIONS',
  head: 'HEAD',
  all: 'ALL',
}

/**
 * Compose user-declared custom route decorators into DSL `route.entrypoint`
 * rules matched by `decoratorName`.
 *
 * PURE: this function only transforms config data into rules. It is intentionally
 * NOT wired into live profile composition yet — the legacy build_route path still
 * consumes the same `customDecorators` slot, so emitting these rules live would
 * risk a double-emit. See specs/static_analysis_strategy/dsl_increment_2026-05-31.md.
 */
export function composeCustomDecoratorRules(
  customDecorators: Record<string, ConfiguredCustomDecorator>,
  source: ResolvedConfigSource = 'user',
): StaticAnalysisPatternRule[] {
  return Object.entries(customDecorators).map(([name, decorator]) => {
    const match: StaticAnalysisPatternRuleMatch = {
      relation: 'decorates',
      decoratorName: name,
    }
    const packageName = decorator.source?.trim()
    if (packageName) match.importsContain = { packageName }

    return {
      id: `route.custom.${name}`,
      state: 'active',
      source,
      target: 'route.entrypoint',
      match,
      emit: {
        targetFrom: 'firstArg',
        operationValue: httpMethodFor(decorator.resolvesTo),
      },
    }
  })
}

function httpMethodFor(resolvesTo: string | null | undefined): string {
  const key = (resolvesTo ?? '').trim().toLowerCase()
  return HTTP_VERB_BY_DECORATOR[key] ?? 'GET'
}
