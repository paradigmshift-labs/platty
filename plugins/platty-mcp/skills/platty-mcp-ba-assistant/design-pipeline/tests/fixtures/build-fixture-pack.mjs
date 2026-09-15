#!/usr/bin/env node
// Build the knowledge pack the engine tests read.
//
// The real pack is private and never lives in this repository, so without this the whole
// engine suite fails with the same missing-file error and tells you nothing. This writes a
// pack from the upstream checkout when one is configured, and otherwise from a small
// synthetic source that exercises the same shapes.
//
//   node tests/fixtures/build-fixture-pack.mjs [--source-root <upstream>] [--dest <dir>]
//
// The destination defaults to the path the tests look at; point the tests elsewhere with
// BA_TEST_PACK_ROOT.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, value, index, all) => (index % 2 ? acc : [...acc, [value.replace(/^--/, ''), all[index + 1]]]), []));
const packageRoot = resolve(import.meta.dirname, '../..');
const skillsRoot = resolve(packageRoot, '..', '..');
const version = 'heroines/2026-09-09';
const dest = resolve(args.dest ?? process.env.BA_TEST_PACK_ROOT ?? join(skillsRoot, 'design-knowledge'), version);
const upstream = args['source-root'] ?? process.env.BA_DESIGN_PIPELINE_SOURCE_ROOT;

function writeJson(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

// Mirrors the source files build-pack.py requires. Values are synthetic but structurally
// what the builder and the engine expect, so a machine with no upstream can still run.
function writeSyntheticSource(root) {
  writeJson(join(root, 'tokens/tokens.json'), {
    color: {
      palette: { violet: { 700: { $type: 'color', $value: { colorSpace: 'srgb', components: [0.447, 0.337, 0.914], alpha: 1 } } } },
      semantic: { primaryStrong: { $type: 'color', $value: '{color.palette.violet.700}' } },
    },
    typography: { scale: { body: { fontSize: { $type: 'dimension', $value: { value: 18, unit: 'px' } }, lineHeight: { $type: 'dimension', $value: { value: 26, unit: 'px' } } } } },
    spacing: { 400: { $type: 'dimension', $value: { value: 16, unit: 'px' } } },
    layout: { space: { margin: { standard: { $type: 'dimension', $value: { value: 16, unit: 'px' } } } } },
  });
  writeJson(join(root, 'expansion/component-contracts.json'), { kind: 'fixture', components: [{ path: 'src/libs/hds/base/button/Button.types.ts', components: ['Button'] }] });
  writeJson(join(root, 'components/props.json'), {
    scope: 'fixture',
    interfaces: [{
      file: 'src/libs/hds/base/button/Button.types.ts', interface: 'ButtonProps', bases: [],
      props: [{ name: 'size', kind: 'closed-union', values: ["'m'"] }, { name: 'label', kind: 'open-string' }],
    }],
  });
  writeJson(join(root, 'components/state-map.json'), [{ component: 'Button', states: ['visible', 'disabled', 'busy'] }]);
  writeJson(join(root, 'expansion/ui-source-index.json'), [{ path: 'src/libs/hds/base/button/Button.types.ts', sha256: 'fixture', components: [], imports: [], strings: [], contracts: [], variants: [], hooks: [] }]);
  writeJson(join(root, 'expansion/type-rules.json'), [{
    id: 'type-list', type: 'list', label: '목록', status: 'AI synthesis; human approval pending',
    when: '여러 항목을 훑을 때', composition: ['머리말', '항목'], stateContract: '빈 목록과 로딩을 구분한다.',
    layoutContract: '항목 사이 간격을 일정하게 둔다.', screens: [], tokens: {}, exceptions: [], version: 'fixture',
  }]);
  writeJson(join(root, 'recipes/validation-input.json'), [{ id: 'recipe-list', type: 'list', status: 'draft', must: [], optional: [], must_not: [] }]);
  writeJson(join(root, 'design/required/principles.json'), { version: 'fixture', source: 'fixture', principles: [{ id: 'C01', scope: 'per_run', text: '위계를 먼저 정한다.' }], heuristicPolicy: 'fixture' });
  writeJson(join(root, 'design/required/usability.json'), [{ id: 'N01', text: '시스템 상태를 보여준다.' }]);
  writeJson(join(root, 'expansion/additional-figma-evidence.json'), []);
  writeJson(join(root, 'inventory/expanded-frames.json'), []);
  writeJson(join(root, 'inventory/runtime-captures.json'), { schema: 'runtime-captures.v1', source_revision: 'fixture', rows: [] });
  mkdirSync(join(root, 'inventory'), { recursive: true });
  writeFileSync(join(root, 'inventory/figma-frames.jsonl'), JSON.stringify({
    frame_id: 'fixture:file:1:2', file_key: 'fixture-file', node_id: '1:2', node_name: 'list',
    match_status: 'matched', match_confidence: 'high', source_revision: 'fixture',
    selection_reason: 'Fixture frame; reference evidence only.',
  }) + '\n');
  const screenshot = join(root, 'references/figma/fixture-file/1-2/screenshot.png');
  mkdirSync(resolve(screenshot, '..'), { recursive: true });
  // smallest valid PNG: the engine only hashes and copies it
  writeFileSync(screenshot, Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100' + '05fe02fe' + '0000000049454e44ae426082', 'hex'));
}

if (existsSync(join(dest, 'pack.json'))) {
  console.log(JSON.stringify({ ok: true, dest, note: 'already present' }));
  process.exit(0);
}

const source = upstream && existsSync(upstream) ? upstream : (() => {
  const root = mkdtempSync(join(tmpdir(), 'ba-fixture-source-'));
  writeSyntheticSource(root);
  return root;
})();

execFileSync('python3', [join(packageRoot, 'scripts/build-pack.py'), '--source-root', source, '--dest', dest, '--version', version],
  { cwd: packageRoot, stdio: ['ignore', 'inherit', 'inherit'] });
console.log(JSON.stringify({ ok: true, dest, from: source === upstream ? 'upstream' : 'synthetic' }));
