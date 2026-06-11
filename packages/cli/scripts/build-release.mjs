// Builds the publishable release artifact:
//   release/main.js  — @platty/core + cli bundled, minified, obfuscated (first-party code only)
//   release/wasm/    — tree-sitter grammar wasm files (resolved relative to the bundle)
// Third-party packages stay external and install from the registry via "dependencies".
import { build } from 'esbuild'
import obfuscatorPkg from 'javascript-obfuscator'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const coreDist = resolve(cliRoot, '../core/dist')
const coreSrc = resolve(cliRoot, '../core/src')
const releaseDir = resolve(cliRoot, 'release')
const bundlePath = resolve(releaseDir, 'main.js')

await rm(releaseDir, { recursive: true, force: true })
await mkdir(releaseDir, { recursive: true })

await build({
  entryPoints: [resolve(cliRoot, 'dist/main.js')],
  outfile: bundlePath,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  minify: true,
  sourcemap: false,
  // Bundle only first-party code: alias @platty/core into the bundle,
  // leave every other bare specifier as an external runtime dependency.
  alias: { '@platty/core': resolve(coreDist, 'index.js') },
  packages: 'external',
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
})

const minified = await readFile(bundlePath, 'utf8')
let withoutShebang = minified
while (withoutShebang.startsWith('#!')) withoutShebang = withoutShebang.slice(withoutShebang.indexOf('\n') + 1)

const obfuscated = obfuscatorPkg.obfuscate(withoutShebang, {
  target: 'node',
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  // Keep runtime cost low for an analysis-heavy CLI: no control-flow flattening / dead code.
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  debugProtection: false,
  disableConsoleOutput: false,
}).getObfuscatedCode()

await writeFile(bundlePath, `#!/usr/bin/env node\n${obfuscated}`, { mode: 0o755 })

await cp(resolve(coreSrc, 'db/migrations'), resolve(releaseDir, 'db/migrations'), { recursive: true })
await cp(resolve(coreDist, 'pipeline_modules/build_graph/adapters/wasm'), resolve(releaseDir, 'wasm'), { recursive: true })

const { size } = await import('node:fs').then((fs) => fs.statSync(bundlePath))
console.log(`release/main.js written (${(size / 1024 / 1024).toFixed(2)} MB), migrations and wasm assets copied`)
