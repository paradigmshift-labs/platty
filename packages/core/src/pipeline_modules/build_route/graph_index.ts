import type { CodeNode, CodeEdge } from '@/db/schema/code_graph.js'
import type { CodeNodeType, EdgeRelation } from '@/db/schema/enums.js'

export interface GraphIndex {
  getNode(id: string): CodeNode | undefined
  getAllNodes(): CodeNode[]
  getAllEdges(): CodeEdge[]
  outgoingEdges(nodeId: string): CodeEdge[]
  incomingEdges(nodeId: string): CodeEdge[]
  edgesByRelation(relation: EdgeRelation): CodeEdge[]
  nodesByType(type: CodeNodeType): CodeNode[]
  nodesByFile(filePath: string): CodeNode[]
  nodesByFileGlob(globs: string[]): CodeNode[]
}

// 단순 glob → RegExp.
//   **  → 모든 디렉터리 (slash 포함, 0 segment 허용)
//   *   → 단일 segment (slash 제외)
//   ?   → 단일 char (slash 제외)
// {a,b} 등 확장 패턴은 미지원 — 필요 시 picomatch 도입.
function globToRegex(glob: string): RegExp {
  const ESCAPE = new Set(['.', '+', '^', '$', '(', ')', '|', '\\', '[', ']', '{', '}'])
  let r = ''
  let i = 0
  while (i < glob.length) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      r += '.*'
      i += 2
      if (glob[i] === '/') i += 1
    } else if (c === '*') {
      r += '[^/]*'
      i += 1
    } else if (c === '?') {
      r += '[^/]'
      i += 1
    } else if (ESCAPE.has(c)) {
      r += '\\' + c
      i += 1
    } else {
      r += c
      i += 1
    }
  }
  return new RegExp('^' + r + '$')
}

export function createGraphIndex(input: { nodes: CodeNode[]; edges: CodeEdge[] }): GraphIndex {
  const { nodes, edges } = input

  const byId = new Map<string, CodeNode>()
  const outgoing = new Map<string, CodeEdge[]>()
  const incoming = new Map<string, CodeEdge[]>()
  const byRelation = new Map<EdgeRelation, CodeEdge[]>()
  const byType = new Map<CodeNodeType, CodeNode[]>()
  const byFile = new Map<string, CodeNode[]>()

  for (const node of nodes) {
    byId.set(node.id, node)
    push(byType, node.type, node)
    push(byFile, node.filePath, node)
  }

  for (const edge of edges) {
    push(outgoing, edge.sourceId, edge)
    if (edge.targetId) push(incoming, edge.targetId, edge)
    push(byRelation, edge.relation, edge)
  }

  return {
    getNode: (id) => byId.get(id),
    getAllNodes: () => nodes,
    getAllEdges: () => edges,
    outgoingEdges: (nodeId) => outgoing.get(nodeId) ?? [],
    incomingEdges: (nodeId) => incoming.get(nodeId) ?? [],
    edgesByRelation: (relation) => byRelation.get(relation) ?? [],
    nodesByType: (type) => byType.get(type) ?? [],
    nodesByFile: (filePath) => byFile.get(filePath) ?? [],
    nodesByFileGlob: (globs) => {
      if (globs.length === 0) return []
      const regexes = globs.map(globToRegex)
      const seen = new Set<string>()
      const out: CodeNode[] = []
      for (const node of nodes) {
        if (seen.has(node.id)) continue
        if (regexes.some((re) => re.test(node.filePath))) {
          out.push(node)
          seen.add(node.id)
        }
      }
      return out
    },
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}
