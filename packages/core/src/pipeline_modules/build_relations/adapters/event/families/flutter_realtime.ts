import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CodeNodeLike, RelationCandidate } from '../../../types.js'

export function extractFlutterRealtimeCandidates(
  node: CodeNodeLike,
  repoPath: string | null,
): RelationCandidate[] {
  return [
    ...extractFlutterWebSocketChannelTargets(node, repoPath).map((target) => ({
      kind: 'event' as const,
      sourceNodeId: node.id,
      evidenceNodeIds: [node.id],
      targetSymbol: 'WebSocketChannel.connect',
      chainPath: null,
      firstArg: target,
      payload: {
        broker: 'websocket',
        direction: 'listen',
        adapter: 'flutter_web_socket_channel',
        library: 'web_socket_channel',
        url: target,
      },
    })),
    ...extractFlutterSocketIoClientEvents(node, repoPath).map((event) => ({
      kind: 'event' as const,
      sourceNodeId: node.id,
      evidenceNodeIds: [node.id],
      targetSymbol: event.direction === 'listen' ? 'socket.on' : 'socket.emit',
      chainPath: null,
      firstArg: event.target,
      payload: {
        broker: 'websocket',
        direction: event.direction,
        adapter: 'flutter_socket_io_client',
        library: 'socket_io_client',
        url: event.url,
        event: event.event,
      },
    })),
  ]
}

function extractFlutterWebSocketChannelTargets(
  node: Pick<CodeNodeLike, 'filePath' | 'lineStart' | 'lineEnd' | 'type'>,
  repoPath: string | null,
): string[] {
  if (!repoPath || !node.filePath.endsWith('.dart')) return []
  if (node.type !== 'method' && node.type !== 'function') return []
  if (node.lineStart == null || node.lineEnd == null) return []

  const fullPath = join(repoPath, node.filePath)
  if (!existsSync(fullPath)) return []

  const source = readFileSync(fullPath, 'utf8')
  if (!source.includes('web_socket_channel')) return []

  const nodeSource = sliceSourceLines(source, node.lineStart, node.lineEnd)
  if (!nodeSource.includes('WebSocketChannel.connect') && !nodeSource.includes('IOWebSocketChannel.connect')) {
    return []
  }

  const targets = new Set<string>()
  const connectRe = /\b(?:IO)?WebSocketChannel\s*\.\s*connect\s*\(\s*Uri\s*\.\s*parse\s*\(\s*([^)]+?)\s*\)\s*\)/g
  for (const match of nodeSource.matchAll(connectRe)) {
    const target = resolveDartStaticString(match[1], source)
    if (target && isStaticWebSocketUrl(target)) targets.add(target)
  }
  return [...targets]
}

function extractFlutterSocketIoClientEvents(
  node: Pick<CodeNodeLike, 'filePath' | 'lineStart' | 'lineEnd' | 'type'>,
  repoPath: string | null,
): Array<{ target: string; url: string; event: string; direction: 'listen' | 'publish' }> {
  if (!repoPath || !node.filePath.endsWith('.dart')) return []
  if (node.type !== 'method' && node.type !== 'function') return []
  if (node.lineStart == null || node.lineEnd == null) return []

  const fullPath = join(repoPath, node.filePath)
  if (!existsSync(fullPath)) return []

  const source = readFileSync(fullPath, 'utf8')
  if (!source.includes('socket_io_client')) return []

  const nodeSource = sliceSourceLines(source, node.lineStart, node.lineEnd)
  const url = extractFlutterSocketIoUrl(nodeSource, source)
  if (!url || !isStaticRealtimeUrl(url)) return []

  const events: Array<{ target: string; url: string; event: string; direction: 'listen' | 'publish' }> = []
  for (const match of nodeSource.matchAll(/\.\s*on\s*\(\s*(['"])([^'"]+)\1/g)) {
    const event = match[2]
    if (isStaticRealtimeEventName(event)) {
      events.push({ target: `${url}#${event}`, url, event, direction: 'listen' })
    }
  }
  for (const match of nodeSource.matchAll(/\.\s*emit\s*\(\s*(['"])([^'"]+)\1/g)) {
    const event = match[2]
    if (isStaticRealtimeEventName(event)) {
      events.push({ target: `${url}#${event}`, url, event, direction: 'publish' })
    }
  }
  return events
}

function extractFlutterSocketIoUrl(nodeSource: string, fileSource: string): string | null {
  const match = nodeSource.match(/\b(?:IO\.)?io\s*\(\s*([^,\n)]+)/)
  if (!match) return null
  return resolveDartStaticString(match[1], fileSource)
}

function sliceSourceLines(source: string, lineStart: number, lineEnd: number): string {
  const lines = source.split(/\r?\n/)
  return lines.slice(Math.max(0, lineStart - 1), Math.max(lineStart, lineEnd)).join('\n')
}

function resolveDartStaticString(raw: string, fileSource: string): string | null {
  const trimmed = raw.trim()
  const quoted = trimmed.match(/^['"]([^'"]+)['"]$/)?.[1]
  if (quoted) return quoted

  const identifier = trimmed.match(/^[A-Za-z_][\w]*$/)?.[0]
  if (!identifier) return null

  const constRe = new RegExp(`\\b(?:const|final|static\\s+const|static\\s+final)\\s+(?:String\\s+)?${identifier}\\s*=\\s*(['\\\"])([^'\\\"]+)\\1`)
  return fileSource.match(constRe)?.[2] ?? null
}

function isStaticWebSocketUrl(value: string): boolean {
  return /^wss?:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9._~!$&'()*+,;=:@/-]*)?$/.test(value)
}

function isStaticRealtimeUrl(value: string): boolean {
  return /^(?:https?|wss?):\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9._~!$&'()*+,;=:@/-]*)?$/.test(value)
}

function isStaticRealtimeEventName(value: string): boolean {
  return /^[A-Za-z0-9_.:-]+$/.test(value)
}
