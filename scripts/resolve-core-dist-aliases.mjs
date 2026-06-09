import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const IMPORT_SPECIFIER_RE = /(?<leader>\bfrom\s*['"]|\bimport\s*(?:\(\s*)?['"])@\/(?<target>[^'"]+)(?<quote>['"])/g
const TARGET_EXTENSIONS = new Set(['.js', '.d.ts'])

export function rewriteCoreDistAliases(source, filePath, distRoot) {
  return source.replace(IMPORT_SPECIFIER_RE, (_match, leader, target, quote) => {
    const targetPath = resolve(distRoot, target)
    let rewritten = relative(dirname(filePath), targetPath).split(sep).join('/')
    if (!rewritten.startsWith('.')) rewritten = `./${rewritten}`
    return `${leader}${rewritten}${quote}`
  })
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listFiles(path))
    } else if (entry.isFile() && TARGET_EXTENSIONS.has(extensionFor(path))) {
      files.push(path)
    }
  }
  return files
}

function extensionFor(path) {
  return path.endsWith('.d.ts') ? '.d.ts' : path.slice(path.lastIndexOf('.'))
}

export async function rewriteCoreDistAliasFiles(distRoot) {
  const root = resolve(distRoot)
  const rootStat = await stat(root)
  if (!rootStat.isDirectory()) {
    throw new Error(`Core dist path is not a directory: ${root}`)
  }

  let changed = 0
  for (const file of await listFiles(root)) {
    const source = await readFile(file, 'utf8')
    const next = rewriteCoreDistAliases(source, file, root)
    if (next !== source) {
      await writeFile(file, next, 'utf8')
      changed += 1
    }
  }
  return { changed }
}

export async function copyCoreWasmAssets(distRoot, sourceRoot = resolve(distRoot, '../src')) {
  const sourceDir = resolve(sourceRoot, 'pipeline_modules/build_graph/adapters/wasm')
  const targetDir = resolve(distRoot, 'pipeline_modules/build_graph/adapters/wasm')
  await mkdir(targetDir, { recursive: true })

  let copied = 0
  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.wasm')) continue
    await copyFile(join(sourceDir, entry.name), join(targetDir, basename(entry.name)))
    copied += 1
  }
  return { copied }
}

async function main() {
  const distRoot = process.argv[2]
  if (!distRoot) {
    throw new Error('Usage: node scripts/resolve-core-dist-aliases.mjs <core-dist-dir>')
  }
  const aliasResult = await rewriteCoreDistAliasFiles(distRoot)
  const wasmResult = await copyCoreWasmAssets(resolve(distRoot))
  process.stdout.write(`Resolved core dist aliases in ${aliasResult.changed} files\n`)
  process.stdout.write(`Copied core WASM assets: ${wasmResult.copied}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
