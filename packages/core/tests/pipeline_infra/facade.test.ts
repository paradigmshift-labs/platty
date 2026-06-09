import { describe, expect, it } from 'vitest'
import {
  PipelineExecution,
  PipelineRun,
  cancelActivePipelineRun,
  linkPipelineRun,
  progressBus,
  resolveStageLlmPolicy,
  skippedReasonForStage,
} from '@/pipeline_infra/index.js'

describe('pipeline_infra facade', () => {
  it('exposes legacy-compatible infra through the new public boundary', () => {
    expect(PipelineRun).toBeTypeOf('function')
    expect(PipelineExecution).toBeTypeOf('function')
    expect(progressBus.publish).toBeTypeOf('function')
    expect(linkPipelineRun).toBeTypeOf('function')
    expect(cancelActivePipelineRun).toBeTypeOf('function')
    expect(resolveStageLlmPolicy).toBeTypeOf('function')
    expect(skippedReasonForStage).toBeTypeOf('function')
  })
})
