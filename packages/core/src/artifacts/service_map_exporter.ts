import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ServiceMapArtifact } from './service_map_artifact.js'
import type { BusinessMapArtifact } from './business_map_artifact.js'
import { renderServiceMapHtml } from './service_map_html.js'

export interface WriteServiceMapArtifactsInput {
  artifact: ServiceMapArtifact
  businessMap?: BusinessMapArtifact
  outDir: string
}

export interface WrittenServiceMapArtifacts {
  jsonPath: string
  htmlPath: string
  reportPath: string
}

export function writeServiceMapArtifacts(input: WriteServiceMapArtifactsInput): WrittenServiceMapArtifacts {
  mkdirSync(input.outDir, { recursive: true })

  const jsonPath = join(input.outDir, 'service-map.json')
  const htmlPath = join(input.outDir, 'service-map.html')
  const reportPath = join(input.outDir, 'GRAPH_REPORT.md')
  const jsonArtifact = input.businessMap
    ? {
        ...input.artifact,
        businessSummary: input.businessMap.summary,
        businessContext: input.businessMap.views.businessContext,
      }
    : input.artifact

  writeFileSync(jsonPath, `${JSON.stringify(jsonArtifact, null, 2)}\n`)
  writeFileSync(htmlPath, renderServiceMapHtml(input.artifact, { businessMap: input.businessMap }))
  writeFileSync(reportPath, renderServiceMapReport(input.artifact, input.businessMap))

  return { jsonPath, htmlPath, reportPath }
}

function renderServiceMapReport(artifact: ServiceMapArtifact, businessMap?: BusinessMapArtifact): string {
  return `# Platty Service Map Report

Project: ${artifact.projectId}
Generated: ${artifact.generatedAt}

## Summary

- Nodes: ${artifact.summary.nodeCount}
- Edges: ${artifact.summary.edgeCount}
- Unresolved edges: ${artifact.summary.unresolvedEdgeCount}
- Node types: ${formatCounts(artifact.summary.nodeTypeCounts)}
- Edge kinds: ${formatCounts(artifact.summary.edgeKindCounts)}

## Artifacts

- JSON: service-map.json
- HTML: service-map.html

## Repository Map

${artifact.views.repoMap.nodes.map((node) => `- ${node.label}: ${node.count ?? 0} nodes`).join('\n') || '- No repository nodes'}
${businessMap ? `
## Business Context

- Domains: ${businessMap.summary.domainCount}
- EPICs: ${businessMap.summary.epicCount}
- Business documents: ${businessMap.summary.businessDocumentCount}
- UCS documents: ${businessMap.summary.ucsCount}

${businessMap.views.businessContext.domains.map((domain) => `- ${domain.name}: ${domain.epics.length} EPICs`).join('\n') || '- No domains'}
` : ''}
`
}

function formatCounts(counts: Record<string, number>) {
  const text = Object.entries(counts).map(([key, count]) => `${key} ${count}`).join(', ')
  return text || 'none'
}
