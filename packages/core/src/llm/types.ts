/**
 * LLM 어댑터 인터페이스.
 *
 * V1 인터페이스 (LLMAdapter / LLMResult / ModelTier / QueryOptions / ...) — 기존 V1 코드가 사용. 그대로 유지.
 * V2 인터페이스 (LlmAdapter / LlmRequest / LlmResponse / LlmProvider) — V2 신규. provider/model 명시 + pipeline_steps 자동 기록 (P12).
 *
 * 두 인터페이스는 공존. V2 어댑터는 내부적으로 V1 어댑터를 wrap 가능.
 */

// ────────────────────────────────────────
// V1 (기존 — 유지)
// ────────────────────────────────────────

export type ModelTier = 'fast' | 'smart' | 'best'

export interface ProgressEvent {
  /** 현재 턴 (1~maxTurns) */
  turn: number
  /** 최대 턴 */
  maxTurns: number
  /** 도구 이름: "Glob" | "Read" | "Grep" */
  tool?: string
  /** 도구 인자 요약 */
  args?: string
  /** UI 표시용 메시지 */
  message: string
}

export interface QueryOptions {
  tools?: string[]
  model?: ModelTier
  maxBudgetUsd?: number
  systemPrompt?: string
  cwd?: string
  maxTurns?: number
  timeoutMs?: number
  onProgress?: (event: ProgressEvent) => void
  signal?: AbortSignal
}

export interface LLMMessage {
  type: 'text' | 'tool_use' | 'tool_result' | 'error' | 'done'
  content: string
}

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_tokens: number
  cache_read_tokens: number
}

export interface LLMResult {
  text: string
  messages: LLMMessage[]
  tokenUsage: TokenUsage
  cost_usd: number
  duration_ms: number
  duration_api_ms: number
  model: string
}

export interface LLMAdapter {
  query(prompt: string, options?: QueryOptions): Promise<LLMResult>
}

// ────────────────────────────────────────
// V2 (신규 — provider/model 명시)
// ────────────────────────────────────────

export type LlmProvider = 'claude_code' | 'codex_sdk' | 'codex_cli' | 'claude_api' | 'openai_api' | 'gemini_api' | 'gemini_cli'
export type LlmReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface LlmRequest {
  systemPrompt?: string
  prompt: string
  maxTokens?: number
  reasoningEffort?: LlmReasoningEffort
  temperature?: number
  timeoutMs?: number
  /** 도구 사용 (provider별 매핑) */
  tools?: string[]
  cwd?: string
  signal?: AbortSignal
  /** Progress 콜백 (V2도 필요 시 V1 ProgressEvent 재사용) */
  onProgress?: (event: ProgressEvent) => void
  /** Optional metadata used by provider-neutral telemetry wrappers. */
  telemetry?: LlmCallMetadata
}

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
}

export interface LlmResponse {
  content: string
  usage: LlmUsage
  costUsd: number
  durationMs: number
  /** 실제 모델 이름 (어댑터가 spec.model을 변환했을 수 있음) */
  model: string
}

export interface LlmAdapter {
  readonly provider: LlmProvider
  readonly model: string
  call(req: LlmRequest): Promise<LlmResponse>
}

export interface LlmCallMetadata {
  stage?: string
  pass?: string
  attempt?: number
  tier?: string
  correlationId?: string
}
