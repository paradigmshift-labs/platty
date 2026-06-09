import { Command, CommanderError } from 'commander'
import type { PlattyCommandRunOptions } from './main.js'
import { commandArgvAfter, stripGlobalFlags, value } from './argv.js'
import { failure, success, type PlattyCommandResponse } from './output.js'

const VERSION = '0.1.0'
const PUBLIC_COMMAND_ROOTS = new Set(['init', 'project', 'repo', 'run', 'runs', 'status', 'version'])

type DispatchOptions = PlattyCommandRunOptions & { cwd: string }
type CommandHandler = () => Promise<PlattyCommandResponse>
type SetResponseHandler = (handler: CommandHandler) => void

interface PassthroughCommand {
  allowUnknownOption(value?: boolean): PassthroughCommand
  allowExcessArguments(value?: boolean): PassthroughCommand
  arguments(description: string): PassthroughCommand
  action(handler: () => void): void
}

function versionResponse(): PlattyCommandResponse {
  return {
    exitCode: 0,
    result: success({ version: VERSION }),
    stdout: '',
    stderr: '',
  }
}

function helpResponse(stdout: string): PlattyCommandResponse {
  return {
    exitCode: 0,
    result: success(),
    stdout,
    stderr: '',
    skipDefaultRender: true,
  }
}

function unknownCommandResponse(argv: string[]): PlattyCommandResponse {
  const command = stripGlobalFlags(argv)
  const result = failure('UNKNOWN_COMMAND', `Unknown command: ${command.join(' ')}`)
  return { exitCode: 2, result, stdout: '', stderr: '' }
}

function notImplementedResponse(command: string): PlattyCommandResponse {
  const result = failure('COMMAND_NOT_IMPLEMENTED', `Command is not implemented yet: ${command}`)
  return { exitCode: 2, result, stdout: '', stderr: '' }
}

function commandRoot(argv: string[]) {
  return stripGlobalFlags(argv)[0]
}

function isVersionRequest(argv: string[]) {
  const command = stripGlobalFlags(argv)
  return command[0] === '--version' || command[0] === 'version'
}

function isTopLevelHelpRequest(argv: string[]) {
  const command = stripGlobalFlags(argv)
  return command[0] === '--help' || command[0] === '-h'
}

function configurePassthrough(command: PassthroughCommand) {
  return command
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .arguments('[args...]')
}

function setAction(command: PassthroughCommand, run: CommandHandler, setResponse: SetResponseHandler) {
  command.action(() => {
    setResponse(run)
  })
}

function createProgram(_argv: string[], _options: DispatchOptions, setResponse: SetResponseHandler) {
  const program = new Command()
  let helpText = ''

  program
    .name('platty')
    .description('Platty CLI for repository analysis and documentation workflows.')
    .exitOverride()
    .configureOutput({
      writeOut: (value) => {
        helpText += value
      },
      writeErr: (value) => {
        helpText += value
      },
    })
    .helpOption('-h, --help', 'display help for command')
    .option('--json', 'print machine-readable JSON')
    .option('--project <selector>', 'project id, name, slug, or current')
    .option('--root <path>', 'workspace root for init')

  program.configureHelp({
    sortSubcommands: true,
    sortOptions: true,
  })

  setAction(configurePassthrough(program.command('init').description('Initialize Platty state for a workspace.')), async () => {
    const { runInitCommand } = await import('./commands/init.js')
    return runInitCommand({ cwd: _options.cwd, root: value(_argv, '--root'), project: value(_argv, '--project') })
  }, setResponse)

  setAction(configurePassthrough(program.command('project').description('Create and manage Platty projects.')), async () => {
    const { runProjectCommand } = await import('./commands/project.js')
    return runProjectCommand(commandArgvAfter('project', stripGlobalFlags(_argv)), {
      cwd: _options.cwd,
      db: _options.db,
      openDb: _options.openDb,
      project: value(_argv, '--project'),
    })
  }, setResponse)

  setAction(configurePassthrough(program.command('repo').description('Register and manage local Git repositories.')), async () => {
    const { runRepoCommand } = await import('./commands/repo.js')
    return runRepoCommand(commandArgvAfter('repo', stripGlobalFlags(_argv)), {
      cwd: _options.cwd,
      db: _options.db,
      openDb: _options.openDb,
      project: value(_argv, '--project'),
    })
  }, setResponse)

  for (const name of ['status', 'run', 'runs'] as const) {
    setAction(configurePassthrough(program.command(name).description(`Run Platty ${name}.`)), async () => notImplementedResponse(name), setResponse)
  }

  setAction(configurePassthrough(program.command('version').description('Show Platty CLI version.')), async () => versionResponse(), setResponse)

  return { program, readHelp: () => helpText }
}

export async function runPlattyCommanderDispatch(argv: string[], options: DispatchOptions): Promise<PlattyCommandResponse> {
  if (isVersionRequest(argv)) return versionResponse()

  const routedCommand = commandRoot(argv)
  if (!routedCommand) {
    const { runInitCommand } = await import('./commands/init.js')
    return runInitCommand({ cwd: options.cwd, root: value(argv, '--root'), project: value(argv, '--project') })
  }
  if (!isTopLevelHelpRequest(argv) && !PUBLIC_COMMAND_ROOTS.has(routedCommand)) return unknownCommandResponse(argv)

  const dispatchState: { responseHandler?: CommandHandler } = {}
  const { program, readHelp } = createProgram(argv, options, (handler) => {
    dispatchState.responseHandler = handler
  })

  try {
    await program.parseAsync(argv, { from: 'user' })
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === 'commander.helpDisplayed') return helpResponse(readHelp())
      if (error.code === 'commander.unknownCommand') return unknownCommandResponse(argv)
      const result = failure('CLI_PARSE_ERROR', error.message)
      return { exitCode: 2, result, stdout: '', stderr: '' }
    }
    throw error
  }

  const handler = dispatchState.responseHandler
  if (!handler) return unknownCommandResponse(argv)
  return handler()
}
