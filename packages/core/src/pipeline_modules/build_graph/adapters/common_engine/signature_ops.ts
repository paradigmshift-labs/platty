// common_engine/signature_ops — 파서-무관 함수 시그니처 텍스트 합성 (S3 추출).
// 언어 어댑터는 EngineNode+LanguageSpec 을 넘겨 호출한다.

import type { EngineNode, LanguageSpec } from './types.js'
import { firstChildOfType } from './shared_utils.js'

/**
 * 함수/메서드 시그니처 텍스트 합성: `(params)` + 옵션 `: returnType`.
 * params 는 field('parameters') → child(formal_parameters) 폴백, return 은 field('return_type') → child(type_annotation) 폴백.
 * returnType 텍스트는 선행 ': ' 를 한 번 벗긴 뒤 `: ` 로 재정규화한다. params 없으면 null.
 */
export function extractFunctionSignature(node: EngineNode, spec: LanguageSpec): string | null {
  const params = node.childForFieldName(spec.paramsField) ??
    firstChildOfType(node, spec.formalParamsType)
  const returnType = node.childForFieldName(spec.returnTypeField) ??
    firstChildOfType(node, spec.typeAnnotationType)
  if (!params) return null
  const paramsText = params.text
  const returnText = returnType ? `: ${returnType.text.replace(/^:\s*/, '')}` : ''
  return `${paramsText}${returnText}`
}
