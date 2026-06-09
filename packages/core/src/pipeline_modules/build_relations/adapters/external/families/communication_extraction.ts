import { getReceiverRoot } from '../../../graph_trace/receiver_identity.js'
import type { ExternalServiceExtractionFamily } from './extraction_types.js'
import { escapeRegExp, objectStringValue, readNodeSource } from './extraction_utils.js'

export const COMMUNICATION_SERVICE_EXTRACTION: ExternalServiceExtractionFamily = {
  services: ['novu'],
  targetArgs(service, context) {
    if (service !== 'novu') return null

    const workflow = context.call.firstArg
      ?? objectStringValue(context.call.literalArgs, 'name')
      ?? novuWorkflowNameFromSource(context)
    return workflow ? [workflow] : []
  },
}

function novuWorkflowNameFromSource(
  context: Parameters<NonNullable<ExternalServiceExtractionFamily['targetArgs']>>[1],
): string | null {
  const receiverRoot = getReceiverRoot(context.call.chainPath ?? '')
  if (!receiverRoot) return null

  const loaded = readNodeSource(context.inputs, context.sourceNodeId, context.index)
  if (!loaded) return null

  const pattern = new RegExp(String.raw`\b${escapeRegExp(receiverRoot)}\s*\.\s*trigger\s*\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?|['"][^'"]+['"])`, 'm')
  const rawArg = loaded.source.match(pattern)?.[1]
  if (!rawArg) return null

  const arg = rawArg.replace(/^['"]|['"]$/g, '')
  return context.resolveStaticArg(arg)
}
