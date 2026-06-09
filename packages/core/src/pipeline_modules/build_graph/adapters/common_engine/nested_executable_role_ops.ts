// common_engine/nested_executable_role_ops — 파서-무관 nested-executable role 분류 (computeCallbackRole hook 추출).
//
// 중첩 함수 리터럴(arrow/function expression/function declaration)이 "어떤 역할로 도달 가능한지"를
// 분류한다: returnedFunction / assignedFunction / queryFn / mutationFn / callback / route handler 등.
// typescript.ts 에서 추출, 동작 byte 동일(golden). 하드코딩 노드타입/필드명은 LanguageSpec 값으로 치환.
//
// 보존 불변식:
//  - role 이름 문자열( nestedFunction / returnedFunction / assignedFunction / queryFn / mutationFn /
//    useEffectCallback / transactionCallback / mapCallback / findCallback / filterCallback /
//    forEachCallback / middleware / routeHandler / callback 및 jsx attribute 이름) 그대로.
//  - callee 이름 문자열( useEffect / $transaction / map / find / filter / forEach / use ) 그대로.
//  - 분기 순서·early-return 순서 그대로.
//
// 노드 동일성: 원본 sameSyntaxRange( startIndex + endIndex 비교, type 미포함 ) 의미를 그대로 보존하는
//   private sameSpan 으로 판정한다. shared_utils.sameNode( type 포함 ) 와 다르므로 그것을 쓰면 안 된다.
//   native(===) 경로와 동일 결과이며 WASM(accessor마다 새 wrapper) 경로에서도 안전하다.
// children/namedChildren null guard: native(Phase A)는 null 없음 → no-op. WASM(Phase B)은 null 가능 → 안전.

import type { EngineNode, LanguageSpec } from './types.js'
import type { CallExtractor } from './call_extractor.js'
import { callTargetName, isNestedExecutableNode } from './node_ops.js'
import { unwrapCallFunction } from './chain_extractor.js'
import { sameSpan, findAncestor } from './shared_utils.js'

// Express(및 호환 라우터) route method 이름 — 프레임워크 휴리스틱 상수 (engine 모듈 co-locate).
const EXPRESS_ROUTE_METHODS = new Set([
  'all',
  'checkout',
  'copy',
  'delete',
  'get',
  'head',
  'lock',
  'merge',
  'mkactivity',
  'mkcol',
  'move',
  'm-search',
  'notify',
  'options',
  'patch',
  'post',
  'purge',
  'put',
  'report',
  'search',
  'subscribe',
  'trace',
  'unlock',
  'unsubscribe',
])


export function nestedExecutableRole(
  node: EngineNode,
  spec: LanguageSpec,
  callExtractor: CallExtractor,
): string | null {
  if (node.type === spec.functionDeclarationType) return 'nestedFunction'

  const returnStatement = findAncestor(node, (candidate) => candidate.type === spec.returnStatementType)
  if (returnStatement && isDirectReturnExpression(returnStatement, node, spec)) return 'returnedFunction'

  // A function literal that is the concise (expression) body of an enclosing arrow
  // (`(): T => (a, b) => {...}`) is returned by that arrow the same way a `return <fn>` is.
  if (isConciseBodyOfArrow(node, spec)) return 'returnedFunction'

  // A function literal that is the direct RHS of an assignment (`obj.method = () => {...}`)
  // is a reachable code slice the same way a returned function expression is.
  const assignment = findAncestor(node, (candidate) => candidate.type === spec.assignmentExpressionType)
  if (assignment && isDirectAssignmentValue(assignment, node, spec)) return 'assignedFunction'

  const pair = findAncestor(node, (candidate) => candidate.type === spec.pairType)
  if (pair) {
    const value = pair.childForFieldName(spec.valueField)
    if (value && isDirectCallbackValue(value, node, spec)) {
      const key = pair.childForFieldName(spec.keyField)
      const keyName = key ? callExtractor.normalizeObjectPropertyKey(key.text) : null
      if (keyName === 'queryFn' || keyName === 'mutationFn') return keyName
      // Arrow as an object-property value that is (nestably) inside a call/new argument
      // or a returned object is a reachable callback (e.g. morgan(fmt,{stream:{write:(m)=>...}}),
      // new ApolloServer({formatError:(e)=>...}), `return { asyncIterator:(t)=>... }`).
      // Capture as plain 'callback' so the body's calls aren't mis-attributed to the parent.
      if (isObjectPropertyValueInReachableLiteral(pair, node, spec)) return 'callback'
    }
  }

  const jsxAttribute = findAncestor(node, (candidate) => candidate.type === spec.jsxAttributeType)
  if (jsxAttribute) {
    const attrName = jsxAttribute.children.find(
      (child) => child != null && child.type === spec.propertyIdentifierType,
    )?.text
    if (attrName && isDirectJsxAttributeCallbackValue(jsxAttribute, node, spec)) return attrName
  }

  const call = findAncestor(node, (candidate) =>
    (candidate.type === spec.callType || candidate.type === spec.newType) &&
    Boolean(candidate.childForFieldName(spec.argumentsField)) &&
    containsNode(candidate.childForFieldName(spec.argumentsField)!, node),
  )
  if (!call) return null

  // A function literal passed directly as a constructor argument
  // (`new PerformanceObserver((list) => {...})`) is a reachable callback. Constructors
  // carry no framework-specific role (map/forEach/route), so capture it as plain 'callback'.
  if (call.type === spec.newType) {
    return isDirectCallArgument(call, node, spec) ? 'callback' : null
  }

  const fn = call.childForFieldName(spec.functionField)
  const calleeName = fn ? callTargetName(unwrapCallFunction(fn, spec), spec) : null
  if (!isDirectCallArgument(call, node, spec)) return null
  if (calleeName === 'useEffect') return 'useEffectCallback'
  if (calleeName === '$transaction') return 'transactionCallback'
  if (calleeName === 'map') return 'mapCallback'
  if (calleeName === 'find') return 'findCallback'
  if (calleeName === 'filter') return 'filterCallback'
  if (calleeName === 'forEach') return 'forEachCallback'
  if (calleeName === 'use' && hasRoutePathFirstArg(call, spec, callExtractor)) return 'middleware'
  if (calleeName && EXPRESS_ROUTE_METHODS.has(calleeName)) {
    if (hasRoutePathFirstArg(call, spec, callExtractor)) {
      return isLastCallArgument(call, node, spec) ? 'routeHandler' : 'middleware'
    }
    return 'callback'
  }
  return 'callback'
}

function isDirectReturnExpression(returnStatement: EngineNode, callback: EngineNode, spec: LanguageSpec): boolean {
  const value = returnStatement.namedChildren[0]
  if (!value) return false
  return isDirectCallbackValue(value, callback, spec)
}

function isDirectAssignmentValue(assignment: EngineNode, callback: EngineNode, spec: LanguageSpec): boolean {
  const value = assignment.childForFieldName(spec.rightField) ?? assignment.namedChildren[1]
  if (!value) return false
  return isDirectCallbackValue(value, callback, spec)
}

function isDirectCallbackValue(value: EngineNode, callback: EngineNode, spec: LanguageSpec): boolean {
  if (sameSpan(value, callback)) return true
  if (value.type !== spec.parenthesizedExpressionType) return false
  return value.namedChildren.some((child) => child != null && sameSpan(child, callback))
}

function isDirectCallArgument(call: EngineNode, callback: EngineNode, spec: LanguageSpec): boolean {
  const args = call.childForFieldName(spec.argumentsField)
  if (!args) return false
  return args.namedChildren.some((arg) => arg != null && isDirectCallbackValue(arg, callback, spec))
}

/** `node` is the concise (expression) body of an enclosing arrow (`(): T => (a) => {...}`). */
function isConciseBodyOfArrow(node: EngineNode, spec: LanguageSpec): boolean {
  const parent = node.parent
  return Boolean(parent && parent.type === spec.arrowFunctionType && sameSpan(parent.childForFieldName(spec.bodyField), node))
}

/**
 * `pair`'s callback value is in a "reachable" position via (nested) object literals:
 * the top object is a call/new argument, or returned (incl. arrow concise body).
 * Walks object → pair → object only; any other context → false (conservative).
 */
function isObjectPropertyValueInReachableLiteral(
  pair: EngineNode,
  callback: EngineNode,
  spec: LanguageSpec,
): boolean {
  let object = pair.parent
  while (object && object.type === spec.objectType) {
    const grand = object.parent
    if (!grand) return false
    if (grand.type === spec.argumentsField) {
      const callee = grand.parent
      return Boolean(
        callee &&
        (callee.type === spec.callType || callee.type === spec.newType) &&
        containsNode(grand, callback),
      )
    }
    if (grand.type === spec.returnStatementType && isDirectReturnExpression(grand, object, spec)) {
      return containsNode(object, callback)
    }
    if (isConciseBodyOfArrow(object, spec)) {
      return containsNode(object, callback)
    }
    if (grand.type === spec.pairType && sameSpan(grand.childForFieldName(spec.valueField), object)) {
      object = grand.parent
      continue
    }
    return false
  }
  return false
}

function hasRoutePathFirstArg(call: EngineNode, spec: LanguageSpec, callExtractor: CallExtractor): boolean {
  const args = call.childForFieldName(spec.argumentsField)
  if (!args) return false
  const { firstArg } = callExtractor.extractCallArgs(args)
  return Boolean(firstArg?.startsWith('/'))
}

function isDirectJsxAttributeCallbackValue(
  attribute: EngineNode,
  callback: EngineNode,
  spec: LanguageSpec,
): boolean {
  const value = attribute.children.find((child) =>
    child != null &&
    (child.type === spec.jsxExpressionType ||
      child.type === spec.parenthesizedExpressionType ||
      isNestedExecutableNode(child, spec)),
  )
  if (!value) return false
  return isDirectJsxCallbackValue(value, callback, spec)
}

function isDirectJsxCallbackValue(value: EngineNode, callback: EngineNode, spec: LanguageSpec): boolean {
  if (isDirectCallbackValue(value, callback, spec)) return true
  if (value.type !== spec.jsxExpressionType) return false
  return value.namedChildren.some((child) => child != null && isDirectCallbackValue(child, callback, spec))
}

function isLastCallArgument(call: EngineNode, node: EngineNode, spec: LanguageSpec): boolean {
  const args = call.childForFieldName(spec.argumentsField)
  if (!args) return false
  const expressionArgs = args.namedChildren
  const index = expressionArgs.findIndex((arg) => arg != null && (sameSpan(arg, node) || containsNode(arg, node)))
  return index !== -1 && index === expressionArgs.length - 1
}


function containsNode(parent: EngineNode, child: EngineNode): boolean {
  return parent.startIndex <= child.startIndex && parent.endIndex >= child.endIndex
}
