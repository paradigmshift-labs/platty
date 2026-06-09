// typescript_hooks — decorator 추출 hook (TS-specific).
// 공통 엔진의 LanguageHooks.getDecoratorInfo 슬롯. Dart는 dart_hooks/annotation 으로 대응(Phase C).
// typescript.ts 2678-2696 에서 추출. 동작 동일(golden ① + payload oracle).

import type { EngineNode, LanguageSpec, DecoratorInfo } from '../common_engine/types.js'
import type { CallExtractor } from '../common_engine/call_extractor.js'

export function getDecoratorInfo(
  decoratorNode: EngineNode,
  callExtractor: CallExtractor,
  spec: LanguageSpec,
): DecoratorInfo {
  for (const child of decoratorNode.children) {
    if (!child) continue
    if (child.type === spec.callType) {
      const fn = child.childForFieldName(spec.functionField)
      const name = fn?.text ?? null
      const argsNode = child.childForFieldName(spec.argumentsField)
      if (!argsNode) return { name, firstArg: null, literalArgs: null }

      // E4 보강 — extractCallArgs 재사용 (객체 walk 포함). decorator에는 argExpressions 불필요.
      const { firstArg, literalArgs } = callExtractor.extractCallArgs(argsNode)
      return { name, firstArg, literalArgs }
    }
    if (child.type === spec.identifierType || child.type === spec.memberType) {
      return { name: child.text, firstArg: null, literalArgs: null }
    }
  }
  return { name: null, firstArg: null, literalArgs: null }
}
