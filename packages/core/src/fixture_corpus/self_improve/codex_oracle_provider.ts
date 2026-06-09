import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { getLlmAdapter } from '../../llm/registry.js'
import type { LlmAdapter } from '../../llm/types.js'
import type { OracleCandidateRequest, OracleProvider } from './oracle.js'
import type { JsonValue, OracleCandidate, SourceEvidence } from './types.js'

interface CodexOracleResponse {
  candidate: JsonValue
  confidence: 'low' | 'medium' | 'high'
  evidence: SourceEvidence[]
  notes?: string[]
}

export function createCodexOracleProvider(input: { model?: string; llm?: LlmAdapter } = {}): OracleProvider {
  const llm = input.llm ?? getLlmAdapter({
    provider: 'codex_cli',
    model: input.model ?? process.env.PLATTY_ORACLE_CODEX_MODEL ?? 'gpt-5.5',
  })
  return {
    async createCandidate(request) {
      const response = await llm.call({
        cwd: request.fixtureDir,
        reasoningEffort: 'high',
        timeoutMs: Number(process.env.PLATTY_ORACLE_TIMEOUT_MS ?? 600_000),
        systemPrompt: [
          'You create independent fixture oracle candidates for Platty.',
          'Use fixture source files and metadata as primary evidence.',
          'Do not copy actual pipeline output.',
          'Return JSON only.',
        ].join('\n'),
        prompt: renderPrompt(request),
      })
      const parsed = parseOracleResponse(response.content)
      mkdirSync(dirname(request.candidatePath), { recursive: true })
      writeFileSync(request.candidatePath, `${JSON.stringify(parsed.candidate, null, 2)}\n`, 'utf-8')
      return {
        fixtureId: request.fixtureId,
        stage: request.stage,
        candidatePath: request.candidatePath,
        confidence: parsed.confidence,
        evidence: parsed.evidence,
        ...(parsed.notes ? { notes: parsed.notes } : {}),
      } satisfies OracleCandidate
    },
  }
}

function renderPrompt(request: OracleCandidateRequest): string {
  return [
    'Create the candidate expected JSON for this fixture stage.',
    '',
    `Fixture id: ${request.fixtureId}`,
    `Stage: ${request.stage}`,
    `Fixture dir: ${request.fixtureDir}`,
    `Candidate path: ${request.candidatePath}`,
    `Expected path, if it exists, is historical context only: ${request.expectedPath}`,
    '',
    'Rules:',
    '- Inspect source files and metadata before deciding.',
    '- Do not read or copy actual/*.json to produce the candidate.',
    '- Candidate must be shaped like the stage expected oracle, not a report wrapper.',
    '- Evidence must cite fixture-relative source or metadata paths.',
    '',
    'Return exactly this JSON shape:',
    '{ "candidate": {}, "confidence": "low|medium|high", "evidence": [{ "path": "...", "summary": "...", "confidence": "low|medium|high" }], "notes": [] }',
  ].join('\n')
}

function parseOracleResponse(content: string): CodexOracleResponse {
  const parsed = JSON.parse(extractJsonObject(content)) as Partial<CodexOracleResponse>
  if (!isJsonValue(parsed.candidate)) throw new Error('oracle response candidate must be valid JSON')
  if (parsed.confidence !== 'low' && parsed.confidence !== 'medium' && parsed.confidence !== 'high') {
    throw new Error('oracle response confidence must be low, medium, or high')
  }
  if (!Array.isArray(parsed.evidence) || parsed.evidence.length === 0) {
    throw new Error('oracle response evidence is required')
  }
  for (const item of parsed.evidence) {
    if (
      typeof item?.path !== 'string'
      || typeof item.summary !== 'string'
      || (item.confidence !== 'low' && item.confidence !== 'medium' && item.confidence !== 'high')
    ) {
      throw new Error('oracle response evidence entries must include path, summary, and confidence')
    }
  }
  return {
    candidate: parsed.candidate,
    confidence: parsed.confidence,
    evidence: parsed.evidence,
    ...(Array.isArray(parsed.notes) ? { notes: parsed.notes.filter((note): note is string => typeof note === 'string') } : {}),
  }
}

function extractJsonObject(content: string): string {
  const trimmed = content.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (match?.[1]) return match[1].trim()
  throw new Error('oracle response must be a JSON object')
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).every(isJsonValue)
  return false
}
