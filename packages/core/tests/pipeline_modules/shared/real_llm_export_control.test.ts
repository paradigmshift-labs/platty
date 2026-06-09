import { describe, expect, it } from 'vitest'
import {
  assertRealLlmExportEnabled,
  mergeExportExitCode,
} from '@/pipeline_modules/shared/real_llm_export_control.js'

describe('real LLM export control', () => {
  it('requires PIPELINE_E2E_REAL_LLM=1 before running real export scripts', () => {
    expect(() => assertRealLlmExportEnabled({})).toThrow(/PIPELINE_E2E_REAL_LLM=1/)
    expect(() => assertRealLlmExportEnabled({ PIPELINE_E2E_REAL_LLM: '0' })).toThrow(/PIPELINE_E2E_REAL_LLM=1/)
    expect(() => assertRealLlmExportEnabled({ PIPELINE_E2E_REAL_LLM: '1' })).not.toThrow()
  })

  it('keeps a failed report exit code sticky for the script process', () => {
    expect(mergeExportExitCode(0, 0)).toBe(0)
    expect(mergeExportExitCode(0, 1)).toBe(1)
    expect(mergeExportExitCode(1, 0)).toBe(1)
    expect(mergeExportExitCode(1, 1)).toBe(1)
  })
})
