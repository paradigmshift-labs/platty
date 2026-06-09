// common_engine/render_ops — 파서-무관 JSX/render-target 판정 헬퍼 (S2 추출).
// AST 무의존(문자열 기반). render relation 추출 시 어떤 element를 기록할지 결정한다.

import type { LanguageSpec } from './types.js'

// 대문자 시작 컴포넌트 또는 관계 추출에 의미 있는 HTML element(a/area/form)만 render edge로 기록한다.
//   componentName: JSX name node의 text (예: 'Foo', 'a', 'Namespace.Comp').
//   true → render edge 기록 대상 / false → 무시 (소문자 일반 HTML element 등)
export function shouldRecordRenderTarget(
  componentName: string,
  spec: Pick<LanguageSpec, 'semanticRenderElements'>,
): boolean {
  const firstChar = componentName[0]
  const isComponent =
    !!firstChar && firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase()
  return isComponent || spec.semanticRenderElements.includes(componentName)
}
