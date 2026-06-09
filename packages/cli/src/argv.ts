export function hasFlag(argv: string[], flag: string) {
  return argv.includes(flag)
}

export function value(argv: string[], flag: string) {
  const index = argv.indexOf(flag)
  if (index === -1) return undefined
  return argv[index + 1]
}

export function stripGlobalFlags(argv: string[]) {
  const stripped: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index]
    if (part === '--json') continue
    if (part === '--root' || part === '--project') {
      index += 1
      continue
    }
    stripped.push(part)
  }
  return stripped
}

export function commandLabel(argv: string[]) {
  const command = stripGlobalFlags(argv)
  if (command.length === 0) return 'init'
  const [root, subcommand] = command
  if (!subcommand || subcommand.startsWith('--')) return root
  return `${root} ${subcommand}`
}

export function commandArgvAfter(commandName: string, argv: string[]) {
  const index = argv.indexOf(commandName)
  if (index === -1) return []
  return argv.slice(index + 1)
}
