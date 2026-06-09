import { describe, it, expect, vi } from 'vitest'

const fsState = vi.hoisted(() => ({
  statError: null as NodeJS.ErrnoException | Error | null,
  realpathError: null as Error | null,
  lstatError: null as NodeJS.ErrnoException | Error | null,
}))

vi.mock('node:fs', () => ({
  statSync: vi.fn(() => {
    if (fsState.statError) throw fsState.statError
    return { isDirectory: () => true }
  }),
  realpathSync: vi.fn((path: string) => {
    if (fsState.realpathError) throw fsState.realpathError
    return path
  }),
  lstatSync: vi.fn(() => {
    if (fsState.lstatError) throw fsState.lstatError
    return { isDirectory: () => true }
  }),
}))

const { validateRepo, ValidateRepoError } = await import('@/pipeline_modules/analyze_repo/f1_validate_repo.js')

function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException
  error.code = code
  return error
}

function expectCode(error: unknown, code: InstanceType<typeof ValidateRepoError>['code']) {
  expect(error).toBeInstanceOf(ValidateRepoError)
  expect((error as InstanceType<typeof ValidateRepoError>).code).toBe(code)
}

describe('validateRepo I/O error classification', () => {
  it('maps repo stat EACCES to PERMISSION_DENIED', () => {
    fsState.statError = errno('EACCES')
    fsState.realpathError = null
    fsState.lstatError = null

    try {
      validateRepo('.')
      throw new Error('expected validateRepo to throw')
    } catch (error) {
      expectCode(error, 'PERMISSION_DENIED')
    }
  })

  it('maps repo stat unknown errors to IO_ERROR', () => {
    fsState.statError = new Error('stat failed')
    fsState.realpathError = null
    fsState.lstatError = null

    try {
      validateRepo('.')
      throw new Error('expected validateRepo to throw')
    } catch (error) {
      expectCode(error, 'IO_ERROR')
    }
  })

  it('maps realpath failures to IO_ERROR', () => {
    fsState.statError = null
    fsState.realpathError = new Error('realpath failed')
    fsState.lstatError = null

    try {
      validateRepo('.')
      throw new Error('expected validateRepo to throw')
    } catch (error) {
      expectCode(error, 'IO_ERROR')
    }
  })

  it('maps .git lstat EACCES to PERMISSION_DENIED', () => {
    fsState.statError = null
    fsState.realpathError = null
    fsState.lstatError = errno('EACCES')

    try {
      validateRepo('.')
      throw new Error('expected validateRepo to throw')
    } catch (error) {
      expectCode(error, 'PERMISSION_DENIED')
    }
  })

  it('maps .git lstat unknown errors to IO_ERROR', () => {
    fsState.statError = null
    fsState.realpathError = null
    fsState.lstatError = new Error('lstat failed')

    try {
      validateRepo('.')
      throw new Error('expected validateRepo to throw')
    } catch (error) {
      expectCode(error, 'IO_ERROR')
    }
  })
})
