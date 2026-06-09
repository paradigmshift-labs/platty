import type {
  AnalyzerContext,
  AnalyzerResult,
  BuildRouteAnalyzerAdapter,
  EntryPointDraft,
  SemanticEntryMetadata,
  SourceFileContext,
  SuspectedNode,
} from '../../../types.js'

export const flutterSemanticAnalyzer: BuildRouteAnalyzerAdapter = {
  name: 'flutter_semantic',
  kind: 'semantic_page',
  framework: 'flutter',
  appliesTo: (ctx) => ctx.stackInfo.framework === 'flutter' || ctx.detections.some((d) => d.active && d.framework.startsWith('flutter')),
  candidateFiles: (ctx) => {
    const seen = new Set<string>()
    const out: string[] = []
    const add = (filePath: string) => {
      if (isFlutterCandidatePath(filePath) && !seen.has(filePath)) {
        seen.add(filePath)
        out.push(filePath)
      }
    }
    for (const filePath of [...(ctx.stackInfo.routingFiles ?? []), ...(ctx.stackInfo.entrypointFiles ?? [])]) {
      add(filePath)
    }
    for (const node of ctx.graphNodes) {
      if ((!isFlutterRouteCandidatePath(node.filePath) && !isFlutterSemanticCandidatePath(node.filePath)) || seen.has(node.filePath)) continue
      seen.add(node.filePath)
      out.push(node.filePath)
    }
    for (const filePath of filesWithFlutterNavigationCallEdges(ctx)) {
      add(filePath)
    }
    return out
  },
  analyzeFile: (file, ctx) => analyzeFlutterSemanticFile(file, ctx),
}

function analyzeFlutterSemanticFile(file: SourceFileContext, ctx: AnalyzerContext): AnalyzerResult {
  const entryPoints: EntryPointDraft[] = []
  const suspected: SuspectedNode[] = []
  const source = stripDartComments(file.source)

  if (!hasFlutterSemanticSignal(source)) {
    return { entryPoints, suspected, diagnostics: { analyzedFiles: 1, semanticEntries: 0, semanticSuspected: 0 } }
  }

  if (/\b(?:final|const|var)\s+\w+\s*=\s*buildPagesFromConfig\s*\(/.test(source) || /\bwidget\.children\s*\[\s*(?:currentIndex|selectedIndex|index)\s*\]/.test(source)) {
    suspected.push(makeSuspected(file))
    return { entryPoints, suspected, diagnostics: { analyzedFiles: 1, semanticEntries: 0, semanticSuspected: 1 } }
  }

  const parentPage = findParentPage(source)
  entryPoints.push(...extractFlutterInteractionEntries(source, file, ctx, parentPage, suspected))
  const labels = extractBottomNavLabels(source)
  const components = (extractIndexedStackComponents(source)
    ?? extractSelectedBodyComponents(source)
    ?? extractWidgetChildrenComponents(source, 'TabBarView')
    ?? extractWidgetChildrenComponents(source, 'PageView')
    ?? [])

  if (components.length === 1) {
    return {
      entryPoints,
      suspected,
      diagnostics: { analyzedFiles: 1, semanticEntries: entryPoints.length, semanticSuspected: suspected.length },
    }
  }
  if (components.length === 0) {
    return {
      entryPoints,
      suspected,
      diagnostics: { analyzedFiles: 1, semanticEntries: entryPoints.length, semanticSuspected: suspected.length },
    }
  }
  if (labels.length > 0 && labels.length !== components.length) {
    suspected.push(makeSuspected(file))
    return { entryPoints, suspected, diagnostics: { analyzedFiles: 1, semanticEntries: 0, semanticSuspected: 1 } }
  }

  const navigationKind = source.includes('BottomNavigationBar')
    ? 'bottom_nav'
    : source.includes('BottomAppBar')
      ? 'bottom_nav'
      : source.includes('NavigationBar')
        ? 'bottom_nav'
        : source.includes('TabBarView')
          ? 'tab_bar_view'
          : 'page_view'

  for (let index = 0; index < components.length; index += 1) {
    const component = components[index]
    const label = labels[index] ?? labelFromComponent(component)
    const handlerNodeId = findComponentNodeId(ctx, component)
    if (!handlerNodeId) {
      suspected.push(makeSuspected(file))
      continue
    }
    const metadata: SemanticEntryMetadata = {
      externalRoute: false,
      semanticEntry: true,
      parentPage,
      navigationKind,
      index,
      label,
      routeResolution: 'constructor_inferred',
      evidence: [
        navigationKind === 'bottom_nav' ? 'bottom_nav_like_control' : 'tab_like_control',
        'single_child_by_index',
        'component_array',
        ...(labels.length > 0 ? ['label_list' as const] : []),
      ],
    }
    entryPoints.push({
      framework: 'flutter',
      kind: 'page',
      fullPath: `internal://${slug(labelFromComponent(parentPage ?? 'home'))}/${slug(label)}`,
      handlerNodeId,
      metadata: { ...metadata },
      detectionSource: 'semantic:flutter',
      confidence: 'high',
      detectionEvidence: {
        matchedRuleId: `semantic:flutter:${navigationKind}`,
        matchedNodeIds: [file.fileNodeId, handlerNodeId],
        matchedEdgeIds: [],
      },
    })
  }

  return {
    entryPoints,
    suspected,
    diagnostics: {
      analyzedFiles: 1,
      semanticEntries: entryPoints.length,
      semanticSuspected: suspected.length,
    },
  }
}

function isFlutterCandidatePath(filePath: string): boolean {
  return filePath.endsWith('.dart') && !/(^|\/)test\//.test(filePath)
}

function isFlutterRouteCandidatePath(filePath: string): boolean {
  return isFlutterCandidatePath(filePath) && /(^|\/)(main|router|routes|navigation|app)\.dart$/.test(filePath)
}

function isFlutterSemanticCandidatePath(filePath: string): boolean {
  return isFlutterCandidatePath(filePath)
    && !/[._](?:g|freezed)\.dart$/.test(filePath)
    && /(^|\/)lib\//.test(filePath)
    && (
      /(^|\/)(?:main|app|home|index|tabs?|navigation|navigator|routes?|router)\.dart$/.test(filePath)
      || /(^|\/|_)(?:page|screen|view|shell|navigation|navigator|route|router|tab|tabs|flow|step)(?:_|\.)/.test(filePath)
    )
}

function filesWithFlutterNavigationCallEdges(ctx: AnalyzerContext): string[] {
  const symbols = new Set([
    'Navigator',
    'push',
    'pushReplacement',
    'pushAndRemoveUntil',
    'MaterialPageRoute',
    'CupertinoPageRoute',
    'PageRouteBuilder',
    'context.push',
    'context.go',
    'context.pushNamed',
    'context.goNamed',
    'Get.to',
    'Get.off',
    'Get.offAll',
    'AutoRouter',
    'showDialog',
    'showAdaptiveDialog',
    'showCupertinoDialog',
    'showModalBottomSheet',
    'showBottomSheet',
  ])
  const out = new Set<string>()
  for (const edge of ctx.graph.getAllEdges()) {
    if (edge.relation !== 'calls' || !edge.targetSymbol || !symbols.has(edge.targetSymbol)) continue
    const source = ctx.graph.getNode(edge.sourceId)
    if (source?.filePath) out.add(source.filePath)
  }
  return [...out]
}

function hasFlutterSemanticSignal(source: string): boolean {
  return /\b(BottomNavigationBar|BottomAppBar|NavigationBar|CupertinoTabScaffold|IndexedStack|PageView|TabBarView|selectedIndex|currentIndex|Navigator|MaterialPageRoute|CupertinoPageRoute|PageRouteBuilder|showDialog|showAdaptiveDialog|showCupertinoDialog|showModalBottomSheet|showBottomSheet|Get|AutoRouter|router|goNamed|pushNamed|routeFactories|remoteConfig)\b|context\.(?:push|go|pushNamed|goNamed)\s*\(/.test(source)
}

function extractBottomNavLabels(source: string): string[] {
  if (!/\b(BottomNavigationBar|NavigationBar)\s*\(/.test(source)) return []
  return [...source.matchAll(/\blabel\s*:\s*['"]([^'"]+)['"]/g)].map((match) => match[1])
}

function extractIndexedStackComponents(source: string): string[] | null {
  const inline = source.match(/\bIndexedStack\s*\([\s\S]*?children\s*:\s*\[([\s\S]*?)\]/)
  if (inline) return extractConstructors(inline[1])
  const variable = source.match(/\bIndexedStack\s*\([\s\S]*?children\s*:\s*(\w+)/)
  if (!variable) return null
  return extractVariableListComponents(source, variable[1])
}

function extractSelectedBodyComponents(source: string): string[] | null {
  const selected = source.match(/\bbody\s*:\s*(\w+)\s*\[\s*(?:selectedIndex|currentIndex|index)\s*\]/)
  if (!selected) return null
  return extractVariableListComponents(source, selected[1])
}

function extractWidgetChildrenComponents(source: string, widget: string): string[] | null {
  const variable = source.match(new RegExp(`\\b${widget}\\s*\\([\\s\\S]*?children\\s*:\\s*(\\w+)`))
  if (variable) return extractVariableListComponents(source, variable[1])
  const match = source.match(new RegExp(`\\b${widget}\\s*\\([\\s\\S]*?children\\s*:\\s*\\[([\\s\\S]*?)\\]`))
  return match ? extractConstructors(match[1]) : null
}

function extractVariableListComponents(source: string, variableName: string): string[] {
  const match = source.match(new RegExp(`\\b(?:final|const|var)\\s+(?:(?:[\\w<>?,]+)\\s+)*${variableName}\\s*=\\s*\\[([\\s\\S]*?)\\];`))
  return match ? extractConstructors(match[1]) : []
}

function extractConstructors(source: string): string[] {
  const out: string[] = []
  for (const item of splitTopLevelDartListItems(source)) {
    const match = /^\s*(?:if\s*\([^)]*\)\s*)?(?:const\s+)?([A-Z]\w*)\s*(?:\(|\.)/.exec(item)
    if (!match) continue
    const name = match[1]
    if (!isIgnoredFlutterChildConstructor(name)) out.push(name)
  }
  return out
}

function splitTopLevelDartListItems(source: string): string[] {
  const out: string[] = []
  let start = 0
  let depth = 0
  let quote: string | null = null
  for (let index = 0; index < source.length; index += 1) {
    const ch = source[index]
    const prev = source[index - 1]
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === ',' && depth === 0) {
      out.push(source.slice(start, index))
      start = index + 1
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1
    if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1)
  }
  out.push(source.slice(start))
  return out
}

function isIgnoredFlutterChildConstructor(name: string): boolean {
  if (['Icon', 'Text', 'Scaffold', 'IndexedStack', 'ListView', 'GridView', 'CustomScrollView', 'SingleChildScrollView'].includes(name)) return true
  return false
}

interface FlutterInteractionRoute {
  target: string
  navigationKind: 'navigator_push' | 'dialog' | 'bottom_sheet'
  evidence: SemanticEntryMetadata['evidence']
}

function extractFlutterInteractionEntries(
  source: string,
  file: SourceFileContext,
  ctx: AnalyzerContext,
  parentPage: string | undefined,
  suspected: SuspectedNode[],
): EntryPointDraft[] {
  const routes = [
    ...extractNavigatorPushRoutes(source),
    ...extractPackageNavigationRoutes(source),
    ...extractModalBuilderRoutes(source, 'dialog'),
    ...extractModalBuilderRoutes(source, 'bottom_sheet'),
  ]
  const out: EntryPointDraft[] = []
  const seen = new Set<string>()
  for (const route of routes) {
    const handlerNodeId = findComponentNodeId(ctx, route.target)
    if (!handlerNodeId) {
      suspected.push(makeSuspected(file))
      continue
    }
    const fullPath = buildInternalInteractionPath(route.navigationKind, parentPage, route.target)
    if (seen.has(fullPath)) continue
    seen.add(fullPath)
    const label = labelFromComponent(route.target)
    const metadata: SemanticEntryMetadata = {
      externalRoute: false,
      semanticEntry: true,
      parentPage,
      navigationKind: route.navigationKind,
      label,
      routeResolution: 'constructor_inferred',
      evidence: route.evidence,
    }
    out.push({
      framework: 'flutter',
      kind: 'page',
      fullPath,
      handlerNodeId,
      metadata: { ...metadata },
      detectionSource: 'semantic:flutter',
      confidence: 'high',
      detectionEvidence: {
        matchedRuleId: `semantic:flutter:${route.navigationKind}`,
        matchedNodeIds: [file.fileNodeId, handlerNodeId],
        matchedEdgeIds: [],
      },
    })
  }
  if (routes.length === 0 && hasAmbiguousFlutterNavigationSignal(source)) {
    suspected.push(makeSuspected(file))
  }
  return out
}

function extractNavigatorPushRoutes(source: string): FlutterInteractionRoute[] {
  const out: FlutterInteractionRoute[] = []
  const routeCtorRe = /\b(?:CupertinoPageRoute|MaterialPageRoute|PageRouteBuilder)(?:<[^>]+>)?\s*\(/g
  let match: RegExpExecArray | null
  while ((match = routeCtorRe.exec(source)) !== null) {
    const before = source.slice(Math.max(0, match.index - 220), match.index)
    if (!/\b(?:Navigator(?:\s*\.\s*of\s*\([^)]*\))?|[A-Za-z_]\w*(?:Key)?\.currentState\??)\s*\.\s*(?:push|pushReplacement|pushAndRemoveUntil)\s*\(/.test(before)) continue
    const openParen = source.indexOf('(', match.index)
    const closeParen = findMatchingParen(source, openParen)
    if (closeParen < 0) continue
    const body = source.slice(openParen + 1, closeParen)
    const target = extractFlutterBuilderTarget(body)
    if (!target) continue
    out.push({
      target,
      navigationKind: 'navigator_push',
      evidence: ['navigator_push', 'route_builder'],
    })
  }
  return out
}

function extractPackageNavigationRoutes(source: string): FlutterInteractionRoute[] {
  const out: FlutterInteractionRoute[] = []
  const patterns: Array<{ re: RegExp; evidence: SemanticEntryMetadata['evidence'] }> = [
    {
      re: /\bcontext\.(?:push|go)\s*\(\s*(?:const\s+)?([A-Z]\w*)\s*\(/g,
      evidence: ['extension_navigation'],
    },
    {
      re: /\bGet\.(?:to|off|offAll)\s*\(\s*(?:\(\)\s*=>\s*)?(?:const\s+)?([A-Z]\w*)\s*\(/g,
      evidence: ['package_navigation'],
    },
    {
      re: /\b(?:AutoRouter\.of\s*\([^)]*\)|context\.router)\s*\.\s*push\s*\(\s*(?:const\s+)?([A-Z]\w*)\s*\(/g,
      evidence: ['package_navigation'],
    },
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern.re)) {
      out.push({
        target: match[1],
        navigationKind: 'navigator_push',
        evidence: ['navigator_push', ...pattern.evidence],
      })
    }
  }
  return out
}

function hasAmbiguousFlutterNavigationSignal(source: string): boolean {
  return /\b(?:context\.(?:pushNamed|goNamed)\s*\(|Navigator(?:\s*\.\s*of\s*\([^)]*\))?\s*\.\s*(?:pushNamed|pushReplacementNamed|popAndPushNamed)\s*\(|[A-Za-z_]\w*(?:Key)?\.currentState\??\s*\.\s*(?:pushNamed|pushReplacementNamed|popAndPushNamed)\s*\(|routeFactories\s*\[|remoteConfig\.getString|factory\s*!?\s*\(|createRoute|resolveRoute)\b/.test(source)
}

function extractModalBuilderRoutes(
  source: string,
  kind: 'dialog' | 'bottom_sheet',
): FlutterInteractionRoute[] {
  const out: FlutterInteractionRoute[] = []
  const callee = kind === 'dialog'
    ? String.raw`(?:showDialog|showAdaptiveDialog|showCupertinoDialog)`
    : String.raw`(?:showModalBottomSheet|showBottomSheet)`
  const re = new RegExp(String.raw`\b${callee}(?:<[^>]+>)?\s*\(`, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) {
    const openParen = match.index + match[0].length - 1 // the `(` the regex matched — handles showModalBottomSheet<void>(
    const closeParen = findMatchingParen(source, openParen)
    if (closeParen < 0) continue
    const body = source.slice(openParen + 1, closeParen)
    const target = extractFlutterBuilderTarget(body)
    if (!target) continue
    out.push({
      target,
      navigationKind: kind,
      evidence: ['modal_builder'],
    })
  }
  return out
}

function extractFlutterBuilderTarget(source: string): string | null {
  const builderRe = /\b(?:builder|pageBuilder)\s*:\s*(?:\([^)]*\)|[A-Za-z_]\w*)\s*(?:=>\s*|\{[\s\S]{0,1500}?return\s+)(?:const\s+)?([A-Z]\w*)\s*\(/
  return builderRe.exec(source)?.[1] ?? null
}

function buildInternalInteractionPath(
  kind: 'navigator_push' | 'dialog' | 'bottom_sheet',
  parentPage: string | undefined,
  target: string,
): string {
  const prefix = kind === 'navigator_push' ? 'navigator' : kind === 'bottom_sheet' ? 'bottom-sheet' : 'dialog'
  const targetSlug = slug(labelFromComponent(target))
  if (!parentPage) return `internal://${prefix}/${targetSlug}`
  return `internal://${prefix}/${slug(labelFromComponent(parentPage))}/${targetSlug}`
}

function findMatchingParen(source: string, openParen: number): number {
  if (openParen < 0 || source[openParen] !== '(') return -1
  let depth = 0
  let quote: string | null = null
  for (let index = openParen; index < source.length; index += 1) {
    const ch = source[index]
    const prev = source[index - 1]
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '(') depth += 1
    if (ch === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function findParentPage(source: string): string | undefined {
  return source.match(/\bclass\s+(\w+)\s+extends\s+(?:ConsumerStatefulWidget|ConsumerWidget|HookConsumerWidget|HookWidget|GetView|GetWidget|GetResponsiveView|StatefulWidget|StatelessWidget)\b/)?.[1]
}

function findComponentNodeId(ctx: AnalyzerContext, componentName: string): string | null {
  return ctx.graphNodes.find((node) => node.name === componentName && (node.type === 'class' || node.type === 'function'))?.id ?? null
}

function labelFromComponent(componentName: string): string {
  return componentName.replace(/(?:Page|Screen|Widget|Panel)$/, '')
}

function slug(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'entry'
}

function stripDartComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

function makeSuspected(file: SourceFileContext): SuspectedNode {
  return {
    nodeId: file.fileNodeId,
    adapter: 'flutter_semantic',
    reason: 'semantic_navigation_ambiguous',
    contextHint: 'file',
  }
}
