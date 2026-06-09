import { createTokenAwareChunkPlanner, planTokenAwareReduceGroups } from '@/llm_large_task_runtime/gateway_chunk_planner.js'
import { extractJsonValue, parseJsonWithSchema } from '@/llm_large_task_runtime/json_parser.js'
import { resolveModelProfile } from '@/llm_large_task_runtime/model_profiles.js'
import { planLlmLargeTask } from '@/llm_large_task_runtime/planner.js'
import { runLlmGatewayTask } from '@/llm_large_task_runtime/run_gateway_task.js'
import { createTokenEstimator } from '@/llm_large_task_runtime/token_estimator.js'
import { resolveTokenBudget } from '@/llm_large_task_runtime/token_budget.js'
import { LlmGatewayError } from '@/llm_large_task_runtime/gateway_types.js'
import type {
  ChunkPlanner,
  LlmGatewayDebugEvent,
  LlmGatewayDebugRecorder,
  LlmGatewayErrorCode,
  LlmGatewayExecutionPolicy,
  LlmGatewayTelemetryEvent,
  LlmGatewayTelemetrySink,
  LlmGatewayTelemetrySnapshot,
  LlmGatewayRunResult,
  LlmGatewayTask,
  RunLlmGatewayTaskOptions,
  TokenBudget,
  ValidationResult,
} from '@/llm_large_task_runtime/gateway_types.js'
import type { PipelineLlmContext } from './llm_context.js'

export const PIPELINE_LEGACY_LARGE_TASK_ID = 'legacy.large_task.run'

export interface PipelineLegacyLargeTaskInput<TInput = unknown, TGraph = unknown, TProjection = unknown, TChunk = unknown, TMapOutput = unknown, TOutput = unknown> {
  task: LlmGatewayTask<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>
  input: TInput
  options?: RunLlmGatewayTaskOptions
}

export async function runPipelineLegacyLargeTask<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>(
  llm: PipelineLlmContext | undefined,
  task: LlmGatewayTask<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>,
  input: TInput,
  options: RunLlmGatewayTaskOptions = {},
): Promise<LlmGatewayRunResult<TOutput>> {
  if (!llm) return runLlmGatewayTask(task, input, options)
  return llm.gatewayTask<PipelineLegacyLargeTaskInput<TInput, TGraph, TProjection, TChunk, TMapOutput, TOutput>, LlmGatewayRunResult<TOutput>>(
    PIPELINE_LEGACY_LARGE_TASK_ID,
    { task, input, options },
    { subjectId: task.name },
  )
}

export {
  createTokenAwareChunkPlanner,
  createTokenEstimator,
  extractJsonValue,
  LlmGatewayError,
  parseJsonWithSchema,
  planLlmLargeTask,
  planTokenAwareReduceGroups,
  resolveModelProfile,
  resolveTokenBudget,
}
export type {
  ChunkPlanner,
  LlmGatewayDebugEvent,
  LlmGatewayDebugRecorder,
  LlmGatewayErrorCode,
  LlmGatewayExecutionPolicy,
  LlmGatewayRunResult,
  LlmGatewayTask,
  LlmGatewayTelemetryEvent,
  LlmGatewayTelemetrySink,
  LlmGatewayTelemetrySnapshot,
  RunLlmGatewayTaskOptions,
  TokenBudget,
  ValidationResult,
}
