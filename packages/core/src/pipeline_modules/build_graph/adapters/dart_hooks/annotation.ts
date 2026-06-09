// dart_hooks — Dart @annotation 추출 hook (TS getDecoratorInfo 대응).
// Dart grammar(identifier/arguments/argument/string_literal)는 TS decorator와 구조가 달라 코드 공유 안 함.
// 반환 shape도 lineStart가 추가된다. dart.ts에서 추출, 동작 동일(golden:verify:dart byte 동일).
import type { EngineNode } from '../common_engine/types.js'
import { findChild, findDescendant, stripQuotes } from './dart_node_utils.js'

export interface AnnotationInfo {
  name: string
  firstArg: string | null
  literalArgs: string | null
  lineStart: number
}

export function extractAnnotationInfo(node: EngineNode): AnnotationInfo {
  const nameNode = node.children.find((c): c is EngineNode => !!c && c.isNamed && c.type === 'identifier')
  const name = nameNode?.text ?? ''
  const lineStart = node.startPosition.row + 1

  const argsNode = findChild(node, 'arguments')
  if (!argsNode || argsNode.text === '()') {
    return { name, firstArg: null, literalArgs: null, lineStart }
  }

  const argNodes = argsNode.children.filter((c): c is EngineNode => !!c && c.isNamed && c.type === 'argument')
  const stringArgs: string[] = []
  for (const arg of argNodes) {
    const strLit = findDescendant(arg, 'string_literal')
    if (strLit) stringArgs.push(stripQuotes(strLit.text))
  }

  const firstArg = stringArgs[0] ?? null
  const literalArgs = stringArgs.length > 0 ? JSON.stringify(stringArgs) : null

  return { name, firstArg, literalArgs, lineStart }
}
