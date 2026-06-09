// dart_hooks — Dart constructor parameter 추출 (this.field DI 패턴 포함). Dart-specific.
// dart.ts에서 추출, 동작 동일(byte). 'dynamic' 타입은 제외(현행 보존).
import type { EngineNode } from '../common_engine/types.js'
import type { ConstructorParam } from '../../types.js'
import { findChild } from './dart_node_utils.js'

export function extractConstructorParams(ctorSig: EngineNode, fieldTypes: Map<string, string>): ConstructorParam[] {
  const paramList = findChild(ctorSig, 'formal_parameter_list')
  if (!paramList) return []

  const params: ConstructorParam[] = []
  collectFormalParams(paramList, fieldTypes, params)
  return params
}

function collectFormalParams(node: EngineNode, fieldTypes: Map<string, string>, params: ConstructorParam[]): void {
  for (const child of node.children) {
    if (!child || !child.isNamed) continue

    if (child.type === 'formal_parameter') {
      // this.xxx pattern: constructor_param child
      const ctorParam = findChild(child, 'constructor_param')
      if (ctorParam) {
        const text = ctorParam.text // e.g. 'this._userService'
        const fieldName = text.replace(/^this\./, '')
        const typeName = fieldTypes.get(fieldName)
        if (typeName && typeName !== 'dynamic') {
          params.push({ fieldName, typeName })
        }
      } else {
        // Regular typed parameter: type_identifier + identifier
        const typeId = child.children.find((c) => !!c && c.isNamed && c.type === 'type_identifier')
        const nameId = child.children.find((c) => !!c && c.isNamed && c.type === 'identifier')
        if (typeId && nameId && typeId.text !== 'dynamic') {
          params.push({ fieldName: nameId.text, typeName: typeId.text })
        }
      }
    } else if (child.type === 'optional_formal_parameters') {
      collectFormalParams(child, fieldTypes, params)
    }
  }
}
