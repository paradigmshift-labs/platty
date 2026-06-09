import { ensureProjectConfig } from '../config-store.js'
import { resolveProjectRootForInit } from '../project-root.js'
import { failure, success, type PlattyCommandResponse } from '../output.js'

export interface InitCommandOptions {
  cwd: string
  root?: string
  project?: string
}

export async function runInitCommand(options: InitCommandOptions): Promise<PlattyCommandResponse> {
  if (options.project) {
    const result = failure('INIT_PROJECT_UNAVAILABLE', '--project is not supported for platty init')
    return { exitCode: 2, result, stdout: '', stderr: '' }
  }

  const projectRoot = await resolveProjectRootForInit(options.cwd, options.root)
  const stored = await ensureProjectConfig(projectRoot)
  const result = success({
    projectRoot: stored.config.projectRoot,
    configPath: stored.configPath,
    currentProject: stored.config.currentProject,
    created: stored.created,
  }, {
    evidenceRefs: [{ label: 'platty-config', path: stored.configPath }],
  })
  return { exitCode: 0, result, stdout: '', stderr: '' }
}
