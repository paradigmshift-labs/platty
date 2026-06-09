import type {
  AnalyzerContext,
  AnalyzerResult,
  BuildRouteAnalyzerAdapter,
  EntryPointDraft,
  SemanticEntryMetadata,
  SourceFileContext,
  SuspectedNode,
} from '../../../types.js'

export const reactSemanticAnalyzer: BuildRouteAnalyzerAdapter = {
  name: 'react_semantic',
  kind: 'semantic_page',
  framework: 'react',
  appliesTo: (ctx) => ['react', 'nextjs'].includes(ctx.stackInfo.framework)
    || ctx.detections.some((d) => d.active && ['react_router_v6', 'nextjs'].includes(d.framework)),
  candidateFiles: (ctx) => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const filePath of [...(ctx.stackInfo.routingFiles ?? []), ...(ctx.stackInfo.entrypointFiles ?? [])]) {
      if (isReactCandidatePath(filePath) && !seen.has(filePath)) {
        seen.add(filePath)
        out.push(filePath)
      }
    }
    for (const node of ctx.graphNodes) {
      if (!isReactRouteCandidatePath(node.filePath) || seen.has(node.filePath)) continue
      seen.add(node.filePath)
      out.push(node.filePath)
    }
    return out
  },
  analyzeFile: (file, ctx) => analyzeReactSemanticFile(file, ctx),
}

interface ReactSemanticTab {
  key?: string
  index?: number
  label: string
  component: string
}

function analyzeReactSemanticFile(file: SourceFileContext, ctx: AnalyzerContext): AnalyzerResult {
  const entryPoints: EntryPointDraft[] = []
  const suspected: SuspectedNode[] = []
  const source = stripJsComments(file.source)
  if (!hasReactSemanticSignal(source)) {
    return { entryPoints, suspected, diagnostics: { analyzedFiles: 1, semanticEntries: 0, semanticSuspected: 0 } }
  }
  if (/\b(?:getTabs|renderTab)\s*\(|\bconst\s+\w+\s*=\s*\w+\s*\[\s*activeTab\s*\]/.test(source)) {
    suspected.push(makeSuspected(file))
    return { entryPoints, suspected, diagnostics: { analyzedFiles: 1, semanticEntries: 0, semanticSuspected: 1 } }
  }
  if (/\b(DashboardGrid|Accordion|ProductCard|SalesCard|RevenueCard)\b/.test(source) && !/\b(TabsTrigger|TabsContent|TabPanel|BottomNavigation)\b/.test(source)) {
    return { entryPoints, suspected, diagnostics: { analyzedFiles: 1, semanticEntries: 0, semanticSuspected: 0 } }
  }

  const tabs = extractTabsTriggerConditionals(source)
    ?? extractIndexedPages(source)
    ?? []
  if (tabs.length === 0) {
    return { entryPoints, suspected, diagnostics: { analyzedFiles: 1, semanticEntries: 0, semanticSuspected: 0 } }
  }

  const parentRoute = routeFromFilePath(file.filePath)
  const parentPage = findParentComponent(source)
  for (let index = 0; index < tabs.length; index += 1) {
    const tab = tabs[index]
    const handlerNodeId = findComponentNodeId(ctx, tab.component)
    if (!handlerNodeId) {
      suspected.push(makeSuspected(file))
      continue
    }
    const metadata: SemanticEntryMetadata = {
      externalRoute: false,
      semanticEntry: true,
      parentRoute,
      parentPage,
      navigationKind: tab.index === undefined ? 'key_state_nav' : 'index_state_nav',
      index: tab.index,
      tabKey: tab.key,
      label: tab.label,
      evidence: tab.index === undefined
        ? ['tab_like_control', 'state_key_selector', 'conditional_component_render', 'nav_button_updates_selector']
        : ['tab_like_control', 'state_index_selector', 'single_child_by_index', 'component_array', 'label_list'],
    }
    entryPoints.push({
      framework: ctx.stackInfo.framework,
      kind: 'page',
      fullPath: `internal://${slug(parentRoute ?? parentPage ?? 'page')}/${slug(tab.label)}`,
      handlerNodeId,
      metadata: { ...metadata },
      detectionSource: 'semantic:react',
      confidence: 'high',
      detectionEvidence: {
        matchedRuleId: 'semantic:react:tabs',
        matchedNodeIds: [file.fileNodeId, handlerNodeId],
        matchedEdgeIds: [],
      },
    })
  }

  return {
    entryPoints,
    suspected,
    diagnostics: { analyzedFiles: 1, semanticEntries: entryPoints.length, semanticSuspected: suspected.length },
  }
}

function isReactCandidatePath(filePath: string): boolean {
  return /\.(tsx|jsx)$/.test(filePath) && !/(^|\/)test\//.test(filePath)
}

function isReactRouteCandidatePath(filePath: string): boolean {
  return isReactCandidatePath(filePath) && (
    /(^|\/)(src\/)?app\/.*\/page\.(tsx|jsx)$/.test(filePath) ||
    /(^|\/)(src\/)?pages\/.*\.(tsx|jsx)$/.test(filePath) ||
    /(^|\/)(app\/)?routes\/.+\.(tsx|jsx)$/.test(filePath)
  )
}

function hasReactSemanticSignal(source: string): boolean {
  return /\b(Tabs|TabList|TabPanel|TabsTrigger|TabsContent|BottomNavigation|selectedIndex|activeTab|currentTab|useState)\b/.test(source)
}

function extractTabsTriggerConditionals(source: string): ReactSemanticTab[] | null {
  const triggers = [...source.matchAll(/<TabsTrigger[^>]*value=["']([^"']+)["'][^>]*>([^<]+)<\/TabsTrigger>/g)]
    .map((match) => ({ key: match[1], label: match[2].trim() }))
  if (triggers.length === 0) return null
  const out: ReactSemanticTab[] = []
  for (const trigger of triggers) {
    const conditional = new RegExp(`(?:tab|activeTab|currentTab)\\s*===\\s*["']${escapeRegExp(trigger.key)}["']\\s*&&\\s*<([A-Z]\\w*)\\b`).exec(source)
    const content = new RegExp(`<TabsContent[^>]*value=["']${escapeRegExp(trigger.key)}["'][^>]*>[\\s\\S]{0,120}<([A-Z]\\w*)\\b`).exec(source)
    const component = conditional?.[1] ?? content?.[1]
    if (component) out.push({ ...trigger, component })
  }
  return out.length === triggers.length ? out : null
}

function extractIndexedPages(source: string): ReactSemanticTab[] | null {
  const pages = source.match(/\b(?:const|let)\s+pages\s*=\s*\[([\s\S]*?)\]/)
  const labels = source.match(/\b(?:const|let)\s+labels\s*=\s*\[([\s\S]*?)\]/)
  if (!pages || !labels || !/\bpages\s*\[\s*selectedIndex\s*\]/.test(source) || !/\bsetSelectedIndex\s*\(/.test(source)) return null
  const components = [...pages[1].matchAll(/<([A-Z]\w*)\b/g)].map((match) => match[1])
  const labelValues = [...labels[1].matchAll(/["']([^"']+)["']/g)].map((match) => match[1])
  if (components.length === 0 || components.length !== labelValues.length) return null
  return components.map((component, index) => ({ index, component, label: labelValues[index] }))
}

function routeFromFilePath(filePath: string): string | undefined {
  const app = filePath.match(/^(?:src\/)?app\/(.+)\/page\.(?:tsx|jsx)$/)
  if (app) return '/' + app[1].replace(/\([^)]*\)\//g, '').replace(/\/$/, '')
  const pages = filePath.match(/^(?:src\/)?pages\/(.+)\.(?:tsx|jsx)$/)
  if (pages) return '/' + pages[1].replace(/index$/, '').replace(/\/$/, '')
  return undefined
}

function findParentComponent(source: string): string | undefined {
  return source.match(/\bexport\s+default\s+function\s+(\w+)/)?.[1]
    ?? source.match(/\bfunction\s+(\w+)\s*\(/)?.[1]
}

function findComponentNodeId(ctx: AnalyzerContext, componentName: string): string | null {
  return ctx.graphNodes.find((node) => node.name === componentName && (node.type === 'function' || node.type === 'class'))?.id ?? null
}

function slug(value: string): string {
  return value
    .replace(/^\//, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'entry'
}

function stripJsComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function makeSuspected(file: SourceFileContext): SuspectedNode {
  return { nodeId: file.fileNodeId, adapter: 'react_semantic', reason: 'semantic_navigation_ambiguous', contextHint: 'file' }
}
