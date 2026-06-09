export type OutputLanguage = 'en' | 'ko'

export interface ResolveOutputLanguageInput {
  option?: OutputLanguage
  env?: Record<string, string | undefined>
  stageEnvName: string
}

export function resolveOutputLanguage(input: ResolveOutputLanguageInput): OutputLanguage {
  if (input.option) return input.option
  const env = input.env ?? process.env
  const value = env[input.stageEnvName] ?? env.SDD_OUTPUT_LANGUAGE
  if (value === undefined || value === '') return 'en'
  if (value === 'en' || value === 'ko') return value
  throw new Error(`${input.stageEnvName} must be "en" or "ko"`)
}

export function outputLanguageInstruction(language: OutputLanguage): string {
  const languageName = language === 'ko' ? 'Korean' : 'English'
  return [
    `Write user-facing natural-language values in ${languageName}.`,
    'Keep all internal schema keys, enum values, ids, document ids, source refs, code identifiers, function/class/component names, file paths, route paths, API paths, HTTP methods, table names, field names, event names, topics, broker names, framework/library names, and source literals exactly as written.',
    'Do not translate JSON keys or source identifiers.',
  ].join('\n')
}

export function judgeOutputLanguageInstruction(language: OutputLanguage): string {
  const languageName = language === 'ko' ? 'Korean' : 'English'
  return [
    `The document may use ${languageName} for user-facing natural-language prose.`,
    'Do not fail a document only because prose uses the configured output language.',
    'Still fail translated or altered schema keys, enum values, ids, document ids, source refs, code identifiers, paths, methods, table names, field names, event names, topics, framework/library names, or source literals.',
  ].join('\n')
}
