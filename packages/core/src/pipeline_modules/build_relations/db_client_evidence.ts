import type { CodeEdgeLike, SemanticIndex } from './types.js'

export function detectStaticMemberDbClientOrm(
  chainPath: string,
  index: SemanticIndex,
): string | null {
  const receiver = parseStaticMemberReceiver(chainPath)
  if (!receiver) return null

  const property = findStaticPropertyNode(receiver.owner, receiver.member, index)
  if (!property) return null

  const direct = detectPropertyOrm(property.id, index, new Set())
  if (direct) return direct

  if (/prisma/i.test(receiver.member)) {
    return detectSiblingClientOrm(receiver.owner, /prisma/i, 'prisma', index)
  }
  if (/kysely/i.test(receiver.member)) {
    return detectSiblingClientOrm(receiver.owner, /kysely/i, 'kysely', index)
  }

  return null
}

function parseStaticMemberReceiver(chainPath: string): { owner: string; member: string } | null {
  const match = chainPath.match(/^([A-Z][A-Za-z0-9_$]*)\.([A-Za-z_$][\w$]*)(?:\.|$)/)
  if (!match) return null
  return { owner: match[1]!, member: match[2]! }
}

function findStaticPropertyNode(owner: string, member: string, index: SemanticIndex) {
  const expectedName = `${owner}.${member}`
  for (const node of index.nodesById.values()) {
    if (node.name === expectedName) return node
  }
  return null
}

function detectSiblingClientOrm(
  owner: string,
  memberPattern: RegExp,
  expectedOrm: string,
  index: SemanticIndex,
): string | null {
  for (const node of index.nodesById.values()) {
    if (!node.name.startsWith(`${owner}.`)) continue
    const member = node.name.slice(owner.length + 1)
    if (!memberPattern.test(member)) continue
    const orm = detectPropertyOrm(node.id, index, new Set())
    if (orm === expectedOrm) return orm
  }
  return null
}

function detectPropertyOrm(
  nodeId: string,
  index: SemanticIndex,
  seen: Set<string>,
): string | null {
  if (seen.has(nodeId)) return null
  seen.add(nodeId)

  for (const edge of [
    ...(index.typeRefsBySource.get(nodeId) ?? []),
    ...(index.importsBySource.get(nodeId) ?? []),
    ...(index.callsBySource.get(nodeId) ?? []),
  ]) {
    const direct = detectOrmFromEdge(edge)
    if (direct) return direct
  }

  for (const call of index.callsBySource.get(nodeId) ?? []) {
    const chainPath = call.chainPath ?? ''
    const thisMember = chainPath.match(/^this\.([A-Za-z_$][\w$]*)/)?.[1]
    if (!thisMember) continue

    const owner = index.containsParentByChild.get(nodeId)
    if (!owner) continue
    const ownerNode = index.nodesById.get(owner)
    const ownerName = ownerNode?.name
    if (!ownerName) continue

    const target = findStaticPropertyNode(ownerName, thisMember, index)
    if (!target) continue
    const inherited = detectPropertyOrm(target.id, index, seen)
    if (inherited) return inherited
  }

  const node = index.nodesById.get(nodeId)
  if (!node) return null
  for (const fileNode of index.nodesByFile.get(node.filePath) ?? []) {
    for (const edge of index.importsBySource.get(fileNode.id) ?? []) {
      const imported = detectOrmFromEdge(edge)
      if (imported && propertyNameHintsOrm(node.name, imported)) return imported
    }
  }

  return null
}

function propertyNameHintsOrm(name: string, orm: string): boolean {
  if (orm === 'prisma') return /prisma/i.test(name)
  if (orm === 'kysely') return /kysely/i.test(name)
  return false
}

function detectOrmFromEdge(edge: CodeEdgeLike): string | null {
  const values = [edge.targetSpecifier, edge.targetSymbol].filter(Boolean).join(' ')
  if (/@prisma\/client|PrismaClient|PrismaService/.test(values)) return 'prisma'
  if (/\bkysely\b|Kysely/.test(values)) return 'kysely'
  return null
}
