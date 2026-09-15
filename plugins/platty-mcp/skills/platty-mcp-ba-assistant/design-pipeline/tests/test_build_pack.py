import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE_FILES = [
    'tokens/tokens.json',
    'expansion/component-contracts.json',
    'components/props.json',
    'components/state-map.json',
    'expansion/ui-source-index.json',
    'expansion/type-rules.json',
    'recipes/validation-input.json',
    'design/required/principles.json',
    'design/required/usability.json',
    'inventory/figma-frames.jsonl',
    'inventory/expanded-frames.json',
    'expansion/additional-figma-evidence.json',
    'inventory/runtime-captures.json',
]


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def write_logical_source(root: Path):
    write_json(root / 'tokens/tokens.json', {'color': {'semantic': {'primaryStrong': '#7256e9'}}, 'layout': {'space': {'margin': {'standard': 16}}}})
    write_json(root / 'expansion/component-contracts.json', {'components': [{'name': 'Button', 'source': 'fixture'}]})
    write_json(root / 'components/props.json', {'interfaces': [{'file': 'src/libs/hds/base/button/Button.types.ts', 'interface': 'ButtonProps', 'props': [{'name': 'size', 'kind': 'closed-union', 'values': ['m']}]}]})
    write_json(root / 'components/state-map.json', [{'component': 'Button', 'states': ['visible', 'disabled', 'busy']}])
    write_json(root / 'expansion/ui-source-index.json', {'files': [{'path': 'src/libs/hds/base/button/Button.types.ts', 'hash': 'fixture'}]})
    write_json(root / 'expansion/type-rules.json', [{'id': 'type-list', 'type': 'list', 'label': 'List', 'when': 'Use for list screens', 'composition': ['rows']}])
    write_json(root / 'recipes/validation-input.json', [{'id': 'recipe-list', 'type': 'list'}])
    write_json(root / 'design/required/principles.json', {'principles': [{'id': 'hierarchy', 'text': 'Clear hierarchy'}]})
    write_json(root / 'design/required/usability.json', [{'id': 'visibility', 'text': 'Show status'}])
    write_json(root / 'expansion/additional-figma-evidence.json', [])
    (root / 'inventory').mkdir(parents=True, exist_ok=True)
    (root / 'inventory/figma-frames.jsonl').write_text(json.dumps({
        'frame_id': 'fixture:file:1:2',
        'file_key': 'fixture-file',
        'node_id': '1:2',
        'node_name': 'list',
        'match_status': 'matched',
        'match_confidence': 'high',
        'source_revision': 'fixture-rev',
        'selection_reason': 'Fixture high confidence list frame.'
    }) + '\n', encoding='utf-8')
    write_json(root / 'inventory/expanded-frames.json', [{
        'role': 'list',
        'screenshot': 'references/figma/expanded-list/screenshot.png',
        'match_status': 'matched',
        'match_confidence': 'high',
        'source_revision': 'expanded-rev'
    }])
    write_json(root / 'inventory/runtime-captures.json', {
        'schema': 'runtime-captures.v1',
        'source_revision': 'runtime-rev',
        'authority': 'Observation of the running application at this commit.',
        'limitation': 'Captured under mock conditions; not a designer-approved design.',
        'rows': [
            {
                'id': 'runtime:page-fixture-list',
                'route': '/page/fixture/list',
                'role': 'list',
                'state': 'default',
                'verdict': 'rendered',
                'included': True,
                'screenshot': 'references/runtime/page-fixture-list/screenshot.png',
            },
            {
                'id': 'runtime:page-fixture-cart',
                'route': '/page/fixture/cart',
                'role': 'list',
                'verdict': 'blank',
                'included': False,
                'screenshot': None,
                'excludedReason': '화면이 렌더되지 않았다',
            },
        ],
    })
    for screenshot in [root / 'references/figma/fixture-file/1-2/screenshot.png',
                       root / 'references/figma/expanded-list/screenshot.png',
                       root / 'references/runtime/page-fixture-list/screenshot.png']:
        screenshot.parent.mkdir(parents=True, exist_ok=True)
        screenshot.write_bytes(b'fixture-png-bytes')


def copy_logical_source(source: Path, dest: Path):
    shutil.copytree(source, dest, dirs_exist_ok=True)


class BuildPackTest(unittest.TestCase):
    def test_state_recipe_with_explicit_role_binding_is_packable(self):
        """A state recipe must be retained when it names its applicable screen role."""
        with tempfile.TemporaryDirectory(prefix='ba-pack-fixture-') as fixture, tempfile.TemporaryDirectory(prefix='ba-pack-dest-') as dest:
            source = Path(fixture)
            write_logical_source(source)
            write_json(source / 'recipes/validation-input.json', [{
                'id': 'recipe-blocked',
                'type': 'blocked',
                'appliesTo': ['list'],
            }])

            subprocess.run([
                'python3', str(PACKAGE_ROOT / 'scripts' / 'build-pack.py'),
                '--source-root', source,
                '--dest', dest,
                '--version', 'heroines/state-recipe',
            ], cwd=REPO_ROOT, check=True, capture_output=True, text=True)

            pack = json.loads((Path(dest) / 'pack.json').read_text(encoding='utf-8'))
            self.assertEqual(pack['recipeRules'][0]['type'], 'blocked')
            self.assertEqual(pack['recipeRules'][0]['appliesTo'], ['list'])


    def test_runtime_capture_becomes_a_reference_with_its_role(self):
        """A rendered capture is reference evidence; a screen that did not render is not."""
        with tempfile.TemporaryDirectory(prefix='ba-pack-fixture-') as fixture, tempfile.TemporaryDirectory(prefix='ba-pack-dest-') as dest:
            source = Path(fixture)
            write_logical_source(source)

            subprocess.run([
                'python3', str(PACKAGE_ROOT / 'scripts' / 'build-pack.py'),
                '--source-root', source,
                '--dest', dest,
                '--version', 'heroines/runtime-reference',
            ], cwd=REPO_ROOT, check=True, capture_output=True, text=True)

            pack = json.loads((Path(dest) / 'pack.json').read_text(encoding='utf-8'))
            runtime = [row for row in pack['references'] if row['id'].startswith('runtime:')]
            self.assertEqual([row['id'] for row in runtime], ['runtime:page-fixture-list'])
            self.assertEqual(runtime[0]['role'], 'list')
            self.assertEqual(runtime[0]['authority'], 'runtime-capture')
            self.assertEqual(runtime[0]['revision'], 'runtime-rev')
            self.assertIn('mock', runtime[0]['limitation'])
            self.assertTrue((Path(dest) / runtime[0]['localPath']).exists())

            manifest = json.loads((Path(dest) / 'upstream-manifest.json').read_text(encoding='utf-8'))
            self.assertIn('inventory/runtime-captures.json', [row['path'] for row in manifest['sources']])

    def test_manifest_and_pack_are_logical_for_different_source_roots(self):
        with tempfile.TemporaryDirectory(prefix='ba-pack-fixture-') as fixture, tempfile.TemporaryDirectory(prefix='ba-pack-src-a-') as src_a, tempfile.TemporaryDirectory(prefix='ba-pack-src-b-') as src_b, tempfile.TemporaryDirectory(prefix='ba-pack-dest-a-') as dest_a, tempfile.TemporaryDirectory(prefix='ba-pack-dest-b-') as dest_b:
            write_logical_source(Path(fixture))
            copy_logical_source(Path(fixture), Path(src_a))
            copy_logical_source(Path(fixture), Path(src_b))

            for src, dest in [(src_a, dest_a), (src_b, dest_b)]:
                subprocess.run([
                    'python3', str(PACKAGE_ROOT / 'scripts' / 'build-pack.py'),
                    '--source-root', src,
                    '--dest', dest,
                    '--version', 'heroines/test-pack',
                ], cwd=REPO_ROOT, check=True, capture_output=True, text=True)

            manifest_a = json.loads((Path(dest_a) / 'upstream-manifest.json').read_text(encoding='utf-8'))
            manifest_b = json.loads((Path(dest_b) / 'upstream-manifest.json').read_text(encoding='utf-8'))
            pack_a = json.loads((Path(dest_a) / 'pack.json').read_text(encoding='utf-8'))
            pack_b = json.loads((Path(dest_b) / 'pack.json').read_text(encoding='utf-8'))

            self.assertEqual(manifest_a, manifest_b)
            self.assertEqual(pack_a, pack_b)
            manifest_text = json.dumps(manifest_a, ensure_ascii=False)
            pack_text = json.dumps(pack_a, ensure_ascii=False)
            self.assertNotIn(str(fixture), manifest_text)
            self.assertNotIn(src_a, manifest_text)
            self.assertNotIn(src_b, manifest_text)
            self.assertNotIn(str(fixture), pack_text)
            self.assertNotIn(src_a, pack_text)
            self.assertNotIn(src_b, pack_text)
            self.assertIn('sourceIdentity', manifest_a)
            self.assertNotIn('sourceRoot', manifest_a)
            self.assertTrue(all(not Path(row['path']).is_absolute() for row in manifest_a['sources']))
            self.assertEqual(len(pack_a['references']), 3)


if __name__ == '__main__':
    unittest.main()
