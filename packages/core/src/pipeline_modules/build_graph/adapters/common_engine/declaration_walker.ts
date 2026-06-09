// common_engine/declaration_walker — shared declaration (class-body member) walk (P3, the S7 reversal).
// SOT: specs/build_graph/codegraph-unification-plan.md §3 (P3) + the P3 blueprint (workflow
// wf_a53cfa26-791, adversarial verdict "sound-with-fixes"). Owns the language-agnostic member loop +
// node/contains/decorator/signature/body emission so TS + Dart + JVM stop duplicating processClassBody.
//
// Divergence is injected via the DeclarationHooks slots on LanguageHooks (walk_engine.ts). TS uses the
// engine default loop (method body = child field); Dart uses the iterateMembers escape hatch
// (method_signature + function_body siblings) routing only through the shared emission leaves.
//
// Output contract (CodeNodeRaw/CodeEdgeRaw) unchanged — this is a refactor, gated byte-identical on TS
// (golden:verify:ts) + the emission-count histogram oracle (silent-drop detector).
//
// FIRST LANDED SLICE (P3 STEP 2): emitMemberDecorators — collapses the 4 duplicated TS decorator-edge
// blocks (typescript.ts 1277-1303 / 1391-1407 / 2056-2074 / 2099-2113) into ONE leaf parameterized by
// emitCalls / emitDepsAndTypeFn flags. Byte-identical: engine makeEdge(repoId,opts) is field-for-field
// identical to the TS-local makeEdge(ctx,opts), and the deps/type_fn ops are the same engine ops the TS
// wrappers already delegate to.

import type { CodeNodeRaw, ConstructorParam } from '../../types.js'
import type { EngineNode, LanguageSpec } from './types.js'
import type { WalkEngineCtx } from './walk_engine.js'
import type { NormalizedDecorator } from './normalized.js'
import { makeEdge, makeDependsOnEdges, buildContainsEdge } from './edge_ops.js'
import { addNode } from './node_factory_ops.js'
import { nodeId } from './node_ops.js'
import { getDecoratorDependencyIdents } from './decorator_deps_ops.js'
import { buildDecoratorTypeFnEdges } from './decorator_type_fn_ops.js'

/** Member classification for the shared class-body loop. */
export type MemberKind = 'method' | 'field' | 'constructor' | 'skip'

/**
 * Per-language declaration-walk hooks consumed by the shared processClassBody loop.
 * The engine owns the loop frame (member iteration + currentClassKey scope + constructor-param
 * buffering); the language supplies classification + per-member processing (which itself routes
 * through the shared leaves emitMemberNodeAndContains / emitMemberDecorators).
 */
export interface DeclarationHooks<N extends EngineNode> {
  /** class declaration node → its body node (TS: findChildOfType 'class_body'). */
  resolveClassBody: (node: N) => N | null
  /** classify a class-body child (method/field/constructor/skip). */
  classifyMember: (member: N, members: N[], index: number) => MemberKind
  /** constructor → buffered DI params (engine returns them for the caller to flush). */
  collectConstructorParams: (member: N) => ConstructorParam[]
  /** kind='method' per-member processing (node+contains+decorators+sig-type-refs+body). Closes over the adapter ctx. */
  processMethod: (member: N, members: N[], index: number, className: string, classExported: boolean, classNodeId: string) => void
  /** kind='field' per-member processing. Closes over the adapter ctx. */
  processField: (member: N, className: string, classExported: boolean) => void
}

/**
 * Shared class-body member loop (P3 S4, the S7 reversal). Owns: resolve body, save/set/restore
 * ctx.currentClassKey (= `${repoId}:${filePath}:${className}`, P15-Lite field-origin scope), iterate
 * body.children, classify+dispatch each member, buffer constructor params. Returns the buffered
 * constructor params for the caller to flush (engine stays free of the adapter ParseContext).
 *
 * Byte-identical to the TS inline loop: same iteration order, same classify→continue (skip)/ctor/
 * method/field dispatch, same currentClassKey scope, same constructor-param flush outcome.
 */
export function processClassBody<N extends EngineNode>(
  node: N,
  ctx: WalkEngineCtx,
  className: string,
  classExported: boolean,
  hooks: DeclarationHooks<N>,
): { constructorParams: ConstructorParam[] } {
  const constructorParams: ConstructorParam[] = []
  const body = hooks.resolveClassBody(node)
  if (!body) return { constructorParams }

  const children = body.children as N[]
  const classNodeId = nodeId(ctx.repoId, ctx.filePath, className)
  const prevClassKey = ctx.currentClassKey
  ctx.currentClassKey = `${ctx.repoId}:${ctx.filePath}:${className}`

  for (let i = 0; i < children.length; i++) {
    const member = children[i]
    const kind = hooks.classifyMember(member, children, i)
    if (kind === 'constructor') {
      constructorParams.push(...hooks.collectConstructorParams(member))
      continue
    }
    if (kind === 'method') hooks.processMethod(member, children, i, className, classExported, classNodeId)
    else if (kind === 'field') hooks.processField(member, className, classExported)
    // kind === 'skip' → no-op (non-member children: decorators/comments/punctuation)
  }

  ctx.currentClassKey = prevClassKey
  return { constructorParams }
}

/**
 * Emit a member node + its class→member `contains` edge — the shared leaf both the TS method and
 * field paths use (and, later, Dart). The caller builds the node (language-specific makeNode) and
 * passes the decorator-aware lineStart override; the engine owns addNode (dedup/export-promotion +
 * normalizedCodeHash from line_start/line_end) and the contains edge (buildContainsEdge =
 * target_specifier:null, resolve_status:'resolved', target_id=nodeId(...fullName), target_symbol=bareSymbol).
 *
 * Byte-identical: engineAddNode(nodes, {...node,line_start}, sourceLines) == the TS-local addNode wrapper,
 * and buildContainsEdge == the inline TS contains makeEdge (verified field-for-field).
 */
export function emitMemberNodeAndContains(
  node: CodeNodeRaw,
  lineStart: number,
  classNodeId: string,
  fullName: string,
  bareSymbol: string,
  ctx: WalkEngineCtx,
): void {
  addNode(ctx.nodes, { ...node, line_start: lineStart }, ctx.sourceLines)
  ctx.edges.push(buildContainsEdge(ctx.repoId, ctx.filePath, classNodeId, fullName, bareSymbol))
}

/**
 * One decorator's normalized info + the per-site emission flags.
 * - emitCalls: also push a parallel `calls` edge (TS class-METHOD decorators only; NOT field/class/param).
 * - emitDepsAndTypeFn: push decorator dependency `depends_on` + decorator-type-fn `type_ref` edges
 *   (TS method/field/class-export; NOT param decorators). Requires `node` to be present.
 */
export interface DecoratorDescriptor<N extends EngineNode> {
  node: N | null
  info: NormalizedDecorator
  emitCalls: boolean
  emitDepsAndTypeFn: boolean
}

/**
 * Emit the decorator edge cluster for a member/class node — the single shared leaf the 4 TS blocks
 * (and, later, Dart annotation loops) collapse into.
 *
 * Per descriptor with a non-null decorator name:
 *   1. `decorates` edge (target_specifier = importSymbolMap.get(name) ?? null, resolve_status 'pending').
 *   2. if emitCalls → a `calls` edge with the SAME payload (method-decorator parity).
 *   3. if emitDepsAndTypeFn → decorator dependency `depends_on` edges + decorator-type-fn `type_ref` edges.
 */
export function emitMemberDecorators<N extends EngineNode>(
  decorators: DecoratorDescriptor<N>[],
  sourceId: string,
  ctx: WalkEngineCtx,
  spec: LanguageSpec,
): void {
  for (const d of decorators) {
    const decName = d.info.name
    if (!decName) continue
    const targetSpecifier = ctx.importSymbolMap.get(decName) ?? null
    ctx.edges.push(
      makeEdge(ctx.repoId, {
        source_id: sourceId,
        target_id: null,
        relation: 'decorates',
        target_specifier: targetSpecifier,
        target_symbol: decName,
        resolve_status: 'pending',
        first_arg: d.info.firstArg,
        literal_args: d.info.literalArgs,
      }),
    )
    if (d.emitCalls) {
      ctx.edges.push(
        makeEdge(ctx.repoId, {
          source_id: sourceId,
          target_id: null,
          relation: 'calls',
          target_specifier: targetSpecifier,
          target_symbol: decName,
          resolve_status: 'pending',
          first_arg: d.info.firstArg,
          literal_args: d.info.literalArgs,
        }),
      )
    }
    if (d.emitDepsAndTypeFn && d.node) {
      ctx.edges.push(...makeDependsOnEdges(getDecoratorDependencyIdents(d.node, spec), ctx.repoId, ctx.importSymbolMap, sourceId))
      ctx.edges.push(...buildDecoratorTypeFnEdges(d.node, ctx.repoId, sourceId, ctx.importSymbolMap, spec))
    }
  }
}
