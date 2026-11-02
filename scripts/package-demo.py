"""Build the two MEKO demo downloads from an explicit package file list."""
from pathlib import Path
import hashlib
import zipfile

root = Path(__file__).resolve().parents[1]
output = root / 'downloads'
output.mkdir(exist_ok=True)

def archive(name, entries):
    target = output / name
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for relative, content in sorted(entries.items()):
            info = zipfile.ZipInfo(relative, (2026, 11, 2, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            bundle.writestr(info, content)
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    target.with_suffix('.zip.sha256').write_text(digest + '  ' + name + '\n')
    print(f'{name}: {len(entries)} files, SHA-256 {digest}')

files = [root / path for path in [
    'README.md', 'README.ko.md', 'GETTING_STARTED.md', 'USER_GUIDE.md', 'VERIFICATION.md',
    'LICENSE.md', 'verify-package.py', 'guide/en/platty-demo.html',
    'scripts/package-demo.py',
]]
for path in ['.agents', '.claude-plugin', 'config', 'plugins/platty']:
    files.extend(p for p in (root / path).rglob('*') if p.is_file())
assert all(p.is_file() and not p.is_symlink() for p in files)
archive('platty-meko-demo.zip', {
    'meko-poc/' + p.relative_to(root).as_posix(): p.read_bytes() for p in files
})

skill = root / 'plugins/platty/skills/platty-search'
entries = {
    'platty-search/' + p.relative_to(skill).as_posix(): p.read_bytes()
    for p in skill.rglob('*') if p.is_file()
}
assert len(entries) == 9, 'The skill must include SKILL.md and eight references'
entries['LICENSE.md'] = (root / 'LICENSE.md').read_bytes()
entries['README.md'] = (
    '# Platty Search for MEKO — English skill\n\n'
    'Keep platty-search/SKILL.md and all eight references together.\n'
    'Use the configured platty MCP connection and verify the default project '
    'is petshop-full. No access credential is included.\n\n'
    'This archive is for reviewing or updating the skill files in an existing '
    'installation. For first installation, use platty-meko-demo.zip and its '
    'guide/en/platty-demo.html manual, or install the feat/demo branch.\n\n'
    'https://github.com/paradigmshift-labs/platty/tree/feat/demo\n'
).encode()
archive('platty-search-english.zip', entries)
