import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DESIGN_SYSTEM_CONTRACT_SCHEMA = 'platty-design-system-html-contract.v1'

const PROJECT_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/u
const REGISTRATION_FILE = 'registration.json'
const CONTRACT_FILE = 'platty-design-system.json'
const REQUIRED_CONTRACT_PATHS = [
  ['designPrinciples', (contract) => contract.designPrinciples, 'file'],
  ['tokens.source', (contract) => contract.tokens?.source, 'file'],
  ['tokens.generator', (contract) => contract.tokens?.generator, 'file'],
  ['componentMap', (contract) => contract.componentMap, 'file'],
  ['htmlPrototype.root', (contract) => contract.htmlPrototype?.root, 'directory'],
  ['commands.validate', (contract) => contract.commands?.validate, 'command'],
  ['commands.test', (contract) => contract.commands?.test, 'command'],
  ['commands.browserVerification', (contract) => contract.commands?.browserVerification, 'command'],
]

export class DesignSystemSetupError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'DesignSystemSetupError'
    this.code = code
    this.details = details
  }
}

function fail(code, message, details = {}) {
  throw new DesignSystemSetupError(code, message, details)
}

function assertProjectId(projectId) {
  if (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)) {
    fail('DESIGN_SYSTEM_PROJECT_ID_INVALID', 'projectId must be 1-128 characters using letters, numbers, dot, underscore, or hyphen and must not begin with a separator.', { projectId })
  }
}

function stateRoot(plattyHome) {
  const selected = plattyHome ?? process.env.PLATTY_HOME ?? resolve(homedir(), '.platty')
  if (typeof selected !== 'string' || !isAbsolute(selected)) {
    fail('DESIGN_SYSTEM_PATH_ABSOLUTE_REQUIRED', 'plattyHome must be an absolute path.', { path: selected })
  }
  return resolve(selected)
}

function runGit(repositoryPath, args, code, message) {
  try {
    return execFileSync('git', args, { cwd: repositoryPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch (error) {
    fail(code, message, { repositoryPath, cause: error.message })
  }
}

function ensureAbsoluteRepositoryPath(repositoryPath) {
  if (typeof repositoryPath !== 'string' || !isAbsolute(repositoryPath)) {
    fail('DESIGN_SYSTEM_PATH_ABSOLUTE_REQUIRED', 'repositoryPath must be an absolute path.', { repositoryPath })
  }
  if (!existsSync(repositoryPath)) {
    fail('DESIGN_SYSTEM_REPOSITORY_NOT_FOUND', 'repositoryPath does not exist.', { repositoryPath })
  }
  let stat
  try {
    stat = lstatSync(repositoryPath)
  } catch (error) {
    fail('DESIGN_SYSTEM_REPOSITORY_NOT_FOUND', 'repositoryPath cannot be inspected.', { repositoryPath, cause: error.message })
  }
  if (stat.isSymbolicLink()) {
    fail('DESIGN_SYSTEM_REPOSITORY_SYMLINK', 'repositoryPath must not be a symbolic link.', { repositoryPath })
  }
  if (!stat.isDirectory()) {
    fail('DESIGN_SYSTEM_REPOSITORY_DIRECTORY_REQUIRED', 'repositoryPath must be a directory.', { repositoryPath })
  }
}

function canonicalGitTopLevel(repositoryPath) {
  const gitTopLevel = runGit(repositoryPath, ['rev-parse', '--show-toplevel'], 'DESIGN_SYSTEM_REPOSITORY_NOT_GIT', 'repositoryPath must be inside a Git repository.')
  let canonicalRepository
  try {
    canonicalRepository = realpathSync(gitTopLevel)
  } catch (error) {
    fail('DESIGN_SYSTEM_GIT_TOPLEVEL_REQUIRED', 'Git top-level cannot be resolved to a canonical path.', { gitTopLevel, cause: error.message })
  }
  if (canonicalRepository !== realpathSync(repositoryPath)) {
    fail('DESIGN_SYSTEM_GIT_TOPLEVEL_REQUIRED', 'repositoryPath must be the canonical Git top-level directory, not a nested path.', { repositoryPath, gitTopLevel: canonicalRepository })
  }
  return canonicalRepository
}

function ensureTrackedPath(repositoryPath, relativePath, field, kind) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || isAbsolute(relativePath)) {
    fail('DESIGN_SYSTEM_CONTRACT_PATH_INVALID', `${field} must be a non-empty repository-relative path.`, { field, path: relativePath })
  }
  const target = resolve(repositoryPath, relativePath)
  const relativeTarget = relative(repositoryPath, target)
  if (relativeTarget === '' || relativeTarget.startsWith(`..${'/'}`) || isAbsolute(relativeTarget)) {
    fail('DESIGN_SYSTEM_CONTRACT_PATH_INVALID', `${field} must remain inside the Design System repository.`, { field, path: relativePath })
  }
  if (!existsSync(target)) {
    fail('DESIGN_SYSTEM_CONTRACT_PATH_MISSING', `${field} points to a missing path.`, { field, path: relativePath })
  }
  const stat = lstatSync(target)
  if (stat.isSymbolicLink()) {
    fail('DESIGN_SYSTEM_CONTRACT_PATH_SYMLINK', `${field} must not point to a symbolic link.`, { field, path: relativePath })
  }
  if (kind === 'directory' && !stat.isDirectory()) {
    fail('DESIGN_SYSTEM_CONTRACT_PATH_TYPE_INVALID', `${field} must point to a directory.`, { field, path: relativePath })
  }
  if (kind === 'file' && !stat.isFile()) {
    fail('DESIGN_SYSTEM_CONTRACT_PATH_TYPE_INVALID', `${field} must point to a file.`, { field, path: relativePath })
  }
  runGit(repositoryPath, ['ls-files', '--error-unmatch', '--', relativePath], 'DESIGN_SYSTEM_CONTRACT_PATH_UNTRACKED', `${field} must be tracked by Git.`)
  return target
}

function readContract(repositoryPath) {
  const contractPath = joinPath(repositoryPath, CONTRACT_FILE)
  if (!existsSync(contractPath)) {
    fail('DESIGN_SYSTEM_CONTRACT_NOT_FOUND', 'platty-design-system.json is required at the Git top-level.', { contractPath })
  }
  runGit(repositoryPath, ['ls-files', '--error-unmatch', '--', CONTRACT_FILE], 'DESIGN_SYSTEM_CONTRACT_UNTRACKED', 'platty-design-system.json must be tracked by Git.')
  let contract
  try {
    contract = JSON.parse(readFileSync(contractPath, 'utf8'))
  } catch (error) {
    fail('DESIGN_SYSTEM_CONTRACT_INVALID', 'platty-design-system.json must contain valid JSON.', { contractPath, cause: error.message })
  }
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    fail('DESIGN_SYSTEM_CONTRACT_INVALID', 'Design System contract must be a JSON object.', { contractPath })
  }
  if (contract.schema !== DESIGN_SYSTEM_CONTRACT_SCHEMA) {
    fail('DESIGN_SYSTEM_CONTRACT_SCHEMA_UNSUPPORTED', `Design System contract schema must be ${DESIGN_SYSTEM_CONTRACT_SCHEMA}.`, { contractPath, schema: contract.schema })
  }
  const referenced = {}
  for (const [field, getValue, kind] of REQUIRED_CONTRACT_PATHS) {
    const value = getValue(contract)
    if (kind === 'command') {
      if (typeof value !== 'string' || value.trim().length === 0) {
        fail('DESIGN_SYSTEM_CONTRACT_FIELD_REQUIRED', `${field} must be a non-empty command string.`, { field })
      }
      continue
    }
    referenced[field] = ensureTrackedPath(repositoryPath, value, field, kind)
  }
  return {
    contractPath,
    contract,
    referenced,
  }
}

function joinPath(...parts) {
  return resolve(...parts)
}

export function designSystemRegistrationPath({ plattyHome, projectId }) {
  assertProjectId(projectId)
  return joinPath(stateRoot(plattyHome), 'design-systems', projectId, REGISTRATION_FILE)
}

export function inspectDesignSystemRepository(repositoryPath) {
  ensureAbsoluteRepositoryPath(repositoryPath)
  const canonicalRepositoryPath = canonicalGitTopLevel(repositoryPath)
  const gitRevision = runGit(canonicalRepositoryPath, ['rev-parse', 'HEAD'], 'DESIGN_SYSTEM_GIT_REVISION_REQUIRED', 'Design System repository must have a Git revision.')
  const { contractPath, contract } = readContract(canonicalRepositoryPath)
  return {
    repositoryPath: canonicalRepositoryPath,
    gitRevision,
    contractPath,
    contractSchema: contract.schema,
  }
}

function readRegistration(path, projectId) {
  if (!existsSync(path)) return null
  let registration
  try {
    registration = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail('DESIGN_SYSTEM_REGISTRATION_INVALID', 'Registration JSON must be valid JSON.', { registrationPath: path, cause: error.message })
  }
  if (!registration || typeof registration !== 'object' || Array.isArray(registration) || Object.keys(registration).sort().join(',') !== 'projectId,repositoryPath' || registration.projectId !== projectId || typeof registration.repositoryPath !== 'string' || !isAbsolute(registration.repositoryPath)) {
    fail('DESIGN_SYSTEM_REGISTRATION_INVALID', 'Registration must contain exactly projectId and canonical repositoryPath.', { registrationPath: path })
  }
  return registration
}

function writeRegistration(path, registration) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(registration, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    renameSync(temporaryPath, path)
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
  }
}

export function registerDesignSystem({ plattyHome, projectId, repositoryPath }) {
  assertProjectId(projectId)
  const evidence = inspectDesignSystemRepository(repositoryPath)
  const registrationPath = designSystemRegistrationPath({ plattyHome, projectId })
  const existing = readRegistration(registrationPath, projectId)
  const registration = { projectId, repositoryPath: evidence.repositoryPath }
  const idempotent = existing?.projectId === registration.projectId && existing?.repositoryPath === registration.repositoryPath
  if (!idempotent) writeRegistration(registrationPath, registration)
  return {
    status: 'design-system-registered',
    idempotent,
    registration,
    repository: {
      gitRevision: evidence.gitRevision,
      contractPath: evidence.contractPath,
      contractSchema: evidence.contractSchema,
    },
  }
}

export function resolveDesignSystem({ plattyHome, projectId }) {
  assertProjectId(projectId)
  const registrationPath = designSystemRegistrationPath({ plattyHome, projectId })
  if (!existsSync(registrationPath)) return { status: 'absent', projectId }
  try {
    const registration = readRegistration(registrationPath, projectId)
    const repository = inspectDesignSystemRepository(registration.repositoryPath)
    return {
      status: 'ready',
      registration,
      repository: {
        gitRevision: repository.gitRevision,
        contractPath: repository.contractPath,
        contractSchema: repository.contractSchema,
      },
    }
  } catch (error) {
    const setupError = error instanceof DesignSystemSetupError
      ? error
      : new DesignSystemSetupError('DESIGN_SYSTEM_RESOLUTION_FAILED', error.message)
    return {
      status: 'unavailable',
      projectId,
      registrationPath,
      availabilityGap: {
        code: setupError.code,
        message: setupError.message,
        recoveryOwner: 'Design System maintainer',
        details: setupError.details,
      },
    }
  }
}

function parseCliInput(inputPath) {
  if (typeof inputPath !== 'string' || !isAbsolute(inputPath)) {
    fail('DESIGN_SYSTEM_PATH_ABSOLUTE_REQUIRED', 'CLI input path must be absolute.', { inputPath })
  }
  let input
  try {
    input = JSON.parse(readFileSync(inputPath, 'utf8'))
  } catch (error) {
    fail('DESIGN_SYSTEM_INPUT_INVALID', 'CLI input must be readable JSON.', { inputPath, cause: error.message })
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('DESIGN_SYSTEM_INPUT_INVALID', 'CLI input must be a JSON object.', { inputPath })
  }
  return input
}

export function runCli(argv = process.argv.slice(2)) {
  const operation = argv[0]
  const inputFlag = argv[1]
  const inputPath = argv[2]
  if (!['register', 'resolve'].includes(operation) || inputFlag !== '--input' || typeof inputPath !== 'string') {
    fail('DESIGN_SYSTEM_CLI_USAGE', 'Usage: design-system-registration.mjs <register|resolve> --input <absolute-json-path>')
  }
  const input = parseCliInput(inputPath)
  if (operation === 'register') return registerDesignSystem(input)
  return resolveDesignSystem(input)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(runCli())}\n`)
  } catch (error) {
    const payload = error instanceof DesignSystemSetupError
      ? { status: 'failed', code: error.code, message: error.message, details: error.details }
      : { status: 'failed', code: 'DESIGN_SYSTEM_INTERNAL_ERROR', message: error.message }
    process.stderr.write(`${JSON.stringify(payload)}\n`)
    process.exitCode = 1
  }
}
