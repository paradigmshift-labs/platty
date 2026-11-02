import base64
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import tomllib

root = Path(sys.argv[1]).resolve()
checks = []
def check(name, passed):
    checks.append((name, bool(passed)))
    print(('PASS: ' if passed else 'FAIL: ') + name)

skills = list(root.glob('plugins/*/skills/*/SKILL.md'))
check('one plugin, one platty-search skill', len(list((root / 'plugins').glob('*'))) == 1 and len(skills) == 1 and skills[0].parent.name == 'platty-search')
skill_root = root / 'plugins/platty/skills/platty-search'
files = list(skill_root.rglob('*.md'))
text = '\n'.join(p.read_text() for p in files)
check('English skill and eight English references', len(list((skill_root / 'references').glob('*.md'))) == 8 and not re.search(r'[\uac00-\ud7a3]', text))
check('MCP connection name is platty with expected MEKO project', 'Use only the configured `platty` MCP connection' in text and 'petshop-full' in text)
check('no previous customer repository assumptions', not re.search(r'ssgdx|shinsegae|heroines|developer-search-v7132', text, re.I))
check('all three capability gaps explicitly handled', all(s in text for s in ['guide_file_missing','authorized_context_missing','scheduler_not_imported']))
check('repository-relative paths retain module prefix', 'repository-relative' in text and 'pts-env-app/src/' in text)
check('incomplete searches cannot establish absence', 'complete' in text and 'truncated' in text and 'absence' in text)
broken = []
for p in root.rglob('*.md'):
    for target in re.findall(r'(?<!!)\[[^\]]+\]\(([^)]+)\)', p.read_text()):
        if re.match(r'\w+:|#', target): continue
        target = target.split('#', 1)[0]
        if target and not (p.parent / target).exists(): broken.append((str(p.relative_to(root)),target))
check('all relative Markdown links resolve', not broken)
if broken: print(broken)
try:
    claude = json.loads((root / '.claude-plugin/marketplace.json').read_text())
    codex = json.loads((root / '.agents/plugins/marketplace.json').read_text())
    check('both marketplaces contain only platty with MEKO identity', all(m['name'] == 'meko-poc' and len(m['plugins']) == 1 and m['plugins'][0]['name'] == 'platty' for m in [claude,codex]))
    manifests = [json.loads((root / f'plugins/platty/{d}/plugin.json').read_text()) for d in ['.claude-plugin','.codex-plugin']]
    check('plugin names and versions agree', manifests[0]['name'] == manifests[1]['name'] == 'platty' and manifests[0]['version'] == manifests[1]['version'] == (root/'plugins/platty/VERSION').read_text().strip())
    check('no bundled MCP credentials or auto updater', not list((root/'plugins').rglob('.mcp.json')) and not list((root/'plugins').rglob('platty-update-check')) and all('mcpServers' not in m for m in manifests))
    codex_config = tomllib.loads((root/'config/codex.config.toml.example').read_text())['mcp_servers']['platty']
    claude_config = json.loads((root/'config/claude.mcp.json.example').read_text())['mcpServers']['platty']
    check('Codex uses environment bearer token and correct endpoint', codex_config['url'] == 'https://meko-poc.platty-ai.com/mcp' and codex_config['bearer_token_env_var'] == 'MEKO_POC_TOKEN' and 'http_headers' not in codex_config)
    check('Claude uses environment bearer token and correct endpoint', claude_config['url'] == codex_config['url'] and claude_config['headers']['Authorization'] == 'Bearer ${MEKO_POC_TOKEN}')
except (OSError,ValueError,KeyError) as e:
    check('complete manifests and token-free configuration templates', False)
    print(type(e).__name__ + ': ' + str(e))
check('English user manual included', (root/'USER_GUIDE.md').is_file())
html = root/'guide/en/platty-demo.html'
html_text = html.read_text() if html.is_file() else ''
check('standalone English HTML manual included', '<html lang="en">' in html_text and 'id="skill"' in html_text and 'id="connect"' in html_text and 'id="verify"' in html_text)
check('Codex Git install pinned to feat/demo', 'codex plugin marketplace add paradigmshift-labs/platty --ref feat/demo' in html_text)
class ScreenshotParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.screenshots = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'img' and 'data-screenshot' in attrs:
            self.screenshots.append(attrs)
parser = ScreenshotParser()
parser.feed(html_text)
def valid_screenshot(attrs):
    original = root/'guide/en/verification'/attrs['data-screenshot']
    prefix = 'data:image/png;base64,'
    return bool(attrs.get('alt')) and original.is_file() and attrs.get('src', '').startswith(prefix) and base64.b64decode(attrs['src'][len(prefix):], validate=True) == original.read_bytes()
check('seven original screenshots embedded for offline sharing', len(parser.screenshots) == 7 and all(valid_screenshot(a) for a in parser.screenshots))
install_docs = [root/p for p in ['README.md', 'README.ko.md', 'GETTING_STARTED.md', 'USER_GUIDE.md', 'guide/en/platty-demo.html']]
check('installation docs use Git only', all(not re.search(r'\.zip|marketplace add [\"\']?\$PWD|marketplace add \.(?:<|\s)', p.read_text()) for p in install_docs))
check('no installation ZIP artifacts or packager', not list((root/'downloads').glob('*.zip')) and not (root/'scripts/package-demo.py').exists())
print(f'Result: {sum(ok for _,ok in checks)}/{len(checks)} checks passed')
sys.exit(0 if all(ok for _,ok in checks) else 1)
