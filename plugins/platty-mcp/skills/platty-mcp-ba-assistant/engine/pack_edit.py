#!/usr/bin/env python3
"""Change what the design knowledge pack contains, through the seeds that produce it.

`pack.json` cannot be edited. The engine hashes every row against `upstream-manifest.json`
and refuses a pack whose rows do not match, so a hand edit does not produce a changed pack
— it produces a pack that will not load. Nor can most of the twelve source files be edited:
they are build products. The thing a person edits is the seed above them.

This tool routes an intent to that seed, refuses the routes that cannot work on this
machine, rebuilds, and verifies the result loads.

    doctor              what can and cannot be changed here, and why
    route <target>      the seed file, the regeneration command, and the rule
    promote-component   let a wireframe use a component whose contract is already packed
    build               regenerate upstream, build a new pack version, verify it loads
    diff <v1> <v2>      what changed between two pack versions
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import PLUGIN_ROOT, WORKSPACE_ROOT

PACK_ROOT = WORKSPACE_ROOT / 'design-knowledge'
BUILD_PACK = PLUGIN_ROOT / 'design-pipeline/scripts/build-pack.py'
KNOWLEDGE_FILE = PLUGIN_ROOT / 'design-pipeline/component-knowledge.json'

# engine.mjs STATE_AXES — a state the engine cannot assert is not a supported state.
STATE_AXES = ('visible', 'checked', 'selected', 'disabled', 'readonly',
              'busy', 'invalid', 'expanded', 'focus', 'value')

# engine.mjs templateNodeHtml / roleForNode — the roles a drawn node can actually carry.
ENGINE_ROLES = ('region', 'text', 'icon', 'button', 'checkbox', 'radio', 'switch',
                'select', 'textbox', 'disclosure', 'status')

SIBLING_REPOS = ('heroines-design-system', 'heroines-webview')

# Where an intent actually lands. `needs_siblings` marks the routes that read the two
# read-only reference repositories, which are not part of this workspace.
ROUTES = {
    'token': {
        'label': '토큰 값 (색·간격·타이포·반경)',
        'seed': 'heroines-design-system: packages/.../core.tokens.json, user.semantic.json',
        'regenerate': ['python3 scripts/tokens.py'],
        'needs_siblings': True,
        'rule': '토큰 정본은 HDS core와 user.semantic이다. 디자이너 관측과 Figma 스냅샷은 '
                '비교 근거일 뿐이며 값 차이를 자동 반영하지 않는다(상류 README). '
                '와이어프레임은 semantic 토큰만 쓰므로 palette를 늘려도 화면은 바뀌지 않는다.',
    },
    'component-contract': {
        'label': '컴포넌트 계약·props (새 컴포넌트 자체)',
        'seed': 'heroines-design-system / heroines-webview 의 TypeScript 소스',
        'regenerate': ['node expansion/extract-ui.mjs', 'node scripts/component-source.mjs'],
        'needs_siblings': True,
        'rule': '계약은 TypeScript 선언을 파싱해 만든다. 손으로 쓰지 않는다. '
                '이미 계약이 있는 컴포넌트를 와이어프레임에서 쓰고 싶은 것이라면 '
                '이 경로가 아니라 promote-component다.',
    },
    'component-promote': {
        'label': '컴포넌트 승격 (와이어프레임이 쓸 수 있게)',
        'seed': str(KNOWLEDGE_FILE.relative_to(PLUGIN_ROOT)),
        'regenerate': [],
        'needs_siblings': False,
        'rule': '계약이 팩에 있다는 것과 와이어프레임이 쓸 수 있다는 것은 다르다. '
                '엔진은 표현 가능한 상태 축(supportedStates)을 함께 요구하는데, 그것은 '
                '파서가 만들어내지 못하는 사람의 판단이다. promote-component로 추가한다.',
    },
    'role': {
        'label': '화면 역할 23개 (when·구성·상태·조판)',
        'seed': 'expansion/type-guidance.json',
        'regenerate': ['python3 expansion/build-rulebook.py'],
        'needs_siblings': False,
        'rule': '역할 한 개는 type-guidance.json의 [when, 구성, 상태계약, 조판계약] 네 문장이다. '
                'type-rules.json은 그 네 문장에서 생성되므로 직접 고치면 덮어써진다. '
                '역할 행은 「AI synthesis; human approval pending」으로 태그되며 '
                '이 상태는 빌더가 붙인다 — 손으로 approved라고 적지 않는다.',
    },
    'recipe': {
        'label': '레시피 규칙 (must / must_not / optional)',
        'seed': 'inputs/recipe-decisions.json, inputs/source-documents/',
        'regenerate': ['python3 scripts/recipes.py'],
        'needs_siblings': False,
        'rule': '모든 레시피는 draft다. must_not은 도메인 중립이라 모든 화면에 적용된다 — '
                '특정 화면에만 맞는 금지는 must_not이 아니다. '
                '역할이 없는 레시피는 영원히 발화하지 못하므로 빌드가 거부한다.',
    },
    'principle': {
        'label': '설계 원칙 33개',
        'seed': 'design/required/principles.json  (생성기 없음 — 직접 편집)',
        'regenerate': [],
        'needs_siblings': False,
        'rule': '이 파일은 빌드 산출물이 아니라 정본이다. 각 행은 id·title·concept·'
                'application·risk·mitigation_and_acceptance·enforcement·sources를 갖는다. '
                'enforcement는 실재하는 검사 경로여야 한다 — 연결 없는 원칙은 장식이다.',
    },
    'usability': {
        'label': '사용성 검사 10개',
        'seed': 'design/required/usability.json  (생성기 없음 — 직접 편집)',
        'regenerate': [],
        'needs_siblings': False,
        'rule': '이 파일도 정본이다. 각 행은 id·name·purpose·risk·check·evidenceMode를 갖는다. '
                '이 열 행은 팩 승인 항목이기도 하므로, 바꾸면 그 행의 승인이 무효가 된다.',
    },
    'reference': {
        'label': '참조 화면 (Figma 스크린샷)',
        'seed': 'inputs/figma-*.json, inputs/archive-expansion/',
        'regenerate': ['python3 scripts/inventory.py', 'python3 scripts/archive-expansion.py'],
        'needs_siblings': False,
        'rule': 'match_confidence가 high인 프레임만 팩에 복사된다. '
                '코드 문자열 검색만으로 high 판정을 만들지 않는다(상류 README) — '
                '스크린샷과 구조를 실제로 비교한 뒤에 판정한다.',
    },
}


def load_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def sha256_file(path):
    import hashlib
    digest = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def find_source_root(given=None):
    """The upstream design-pipeline checkout, or None."""
    candidates = [given, os.environ.get('BA_DESIGN_PIPELINE_SOURCE_ROOT'),
                  Path.home() / 'Downloads/design-pipeline']
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate).expanduser()
        if (path / 'tokens/tokens.json').exists():
            return path.resolve()
    return None


def latest_pack_dir():
    found = sorted(PACK_ROOT.glob('*/*/pack.json'))
    return found[-1].parent if found else None


def resolve_pack_dir(spec):
    if not spec:
        return latest_pack_dir()
    for guess in (PACK_ROOT / spec, Path(spec)):
        if (guess / 'pack.json').exists():
            return guess.resolve()
    raise ValueError(f'cannot find a pack for {spec!r}')


def build_pack_module():
    import importlib.util
    spec = importlib.util.spec_from_file_location('build_pack', BUILD_PACK)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# --- doctor ------------------------------------------------------------------------

def doctor(source_root, pack_dir):
    module = build_pack_module()
    report = {'source_root': str(source_root) if source_root else '',
              'pack': str(pack_dir) if pack_dir else '', 'checks': [], 'routes': {}}

    def check(name, ok, detail):
        report['checks'].append({'check': name, 'ok': bool(ok), 'detail': detail})
        return ok

    if not check('upstream_present', source_root,
                 '상류 design-pipeline 체크아웃. --source-root 또는 '
                 'BA_DESIGN_PIPELINE_SOURCE_ROOT로 지정한다.'):
        report['verdict'] = 'blocked'
        return report

    missing = [p for p in module.SOURCE_FILES if not (source_root / p).exists()]
    check('upstream_source_files', not missing,
          '12개 소스 파일 전부 존재' if not missing else '없는 파일: ' + ', '.join(missing))

    siblings = {name: (source_root.parent / name).exists() for name in SIBLING_REPOS}
    check('sibling_repos', all(siblings.values()),
          '토큰·컴포넌트 계약 재생성에 필요한 읽기 전용 참조 저장소. '
          + ', '.join(f'{k}={"있음" if v else "없음"}' for k, v in siblings.items()))

    if pack_dir:
        manifest = load_json(pack_dir / 'upstream-manifest.json')
        drifted = [row['path'] for row in manifest.get('sources', [])
                   if (source_root / row['path']).exists()
                   and sha256_file(source_root / row['path']) != row['sha256']]
        check('upstream_matches_pack', not drifted,
              '상류가 현재 팩과 같다 — 아직 반영할 변경이 없다' if not drifted
              else '상류가 앞서 있다(새 팩을 빌드해야 반영된다): ' + ', '.join(drifted))

        pack = load_json(pack_dir / 'pack.json')
        orphans = module.recipe_role_gaps(pack)
        check('recipe_roles_exist', not orphans,
              '모든 레시피가 실재하는 역할을 가리킨다' if not orphans else
              f'발화할 수 없는 레시피 {", ".join(orphans)} — 빌드가 거부한다. '
              'recipes/validation-input.json에서 기존 역할의 상태 규칙으로 옮기거나 역할을 추가한다.')

        try:
            import pack_approval
            state = pack_approval.status(pack_dir / 'pack.json')
            check('pack_approved', state.get('complete'),
                  f"승인 {state.get('approved', 0)}/{state.get('total', 0)} · "
                  f"미판정 {state.get('pending', 0)}"
                  + (' · 기록이 낡음' if state.get('stale') else ''))
        except (OSError, UnicodeError, ValueError, KeyError, ImportError) as exc:
            check('pack_approved', False, f'승인 상태를 읽지 못했다: {exc}')

    for name, route in ROUTES.items():
        seed = route['seed']
        blocked = ''
        if route['needs_siblings'] and not all(siblings.values()):
            blocked = '참조 저장소가 없다'
        elif not route['needs_siblings'] and not seed.startswith('tools/') and '(' not in seed:
            for part in seed.split(', '):
                part = part.split()[0] if part.split() else ''
                if not part:
                    continue
                # 씨앗은 `inputs/figma-*.json` 처럼 글롭으로 적힌다. 문자 그대로 찾으면
                # 실재하는 씨앗을 없다고 보고하고, 멀쩡한 경로가 막힌 것처럼 보인다.
                found = list(source_root.glob(part)) if '*' in part else \
                    ([source_root / part] if (source_root / part).exists() else [])
                if not found:
                    blocked = f'씨앗 파일이 없다: {part}'
                    break
        report['routes'][name] = {'label': route['label'], 'seed': seed,
                                  'available': not blocked, 'blocked_by': blocked}

    failures = [row for row in report['checks'] if not row['ok']]
    report['verdict'] = 'ready' if not failures else 'partial'
    report['blocked_routes'] = sorted(n for n, r in report['routes'].items() if not r['available'])
    return report


# --- promote-component -------------------------------------------------------------

def promote_component(args, pack_dir):
    entries = load_json(KNOWLEDGE_FILE)
    rows = entries['entries']
    ref = args.ref or f'component:{args.component}'
    errors = []

    if any(entry['row']['ref'] == ref for entry in rows):
        errors.append(f'{ref} 은 이미 승격되어 있다')
    if any(entry['row']['component'] == args.component for entry in rows):
        errors.append(f'컴포넌트 이름 {args.component!r} 이 이미 쓰이고 있다')

    states = [s.strip() for s in args.states.split(',') if s.strip()]
    unknown = [s for s in states if s not in STATE_AXES]
    if unknown:
        errors.append(f'엔진이 단정할 수 없는 상태 축: {", ".join(unknown)} '
                      f'(가능한 축: {", ".join(STATE_AXES)})')
    if 'visible' not in states:
        errors.append('visible은 모든 컴포넌트가 표현해야 하는 축이다')

    roles = [r.strip() for r in args.role.split(',') if r.strip()]
    strange = [r for r in roles if r not in ENGINE_ROLES]

    module = build_pack_module()
    if args.source_path not in module.SOURCE_FILES:
        errors.append(f'{args.source_path} 는 팩이 빌드하는 소스가 아니다 — '
                      f'revision과 authority를 기록할 수 없다 '
                      f'(가능: {", ".join(sorted(module.SOURCE_FILES))})')

    interface = None
    if args.interface_file or args.interface_name:
        if not (args.interface_file and args.interface_name):
            errors.append('--interface-file 과 --interface-name 은 함께 준다')
        else:
            interface = {'file': args.interface_file, 'interface': args.interface_name}
            if pack_dir:
                known = load_json(pack_dir / 'pack.json').get('componentProps', {}).get('interfaces', [])
                if not any(row.get('file') == args.interface_file
                           and row.get('interface') == args.interface_name for row in known):
                    errors.append(f'팩의 componentProps에 {args.interface_name}'
                                  f'@{args.interface_file} 이 없다 — 엔진이 계약을 찾지 못한다')
    if args.origin == 'upstream-derived-contract' and not interface:
        errors.append('upstream-derived-contract 는 닫힌 인터페이스를 가리켜야 한다. '
                      '인터페이스가 없으면 ba-authored-adapter 다')

    if errors:
        return {'ok': False, 'errors': errors}

    row = {'ref': ref, 'component': args.component, 'kind': args.kind,
           'roles': roles, 'supportedStates': states, 'sourcePath': args.source_path}
    if interface:
        row['interface'] = interface
    row['limitation'] = args.limitation
    rows.append({'origin': args.origin, 'row': row})

    if not args.dry_run:
        KNOWLEDGE_FILE.write_text(
            json.dumps(entries, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return {'ok': True, 'dry_run': args.dry_run, 'added': row, 'origin': args.origin,
            'total': len(rows),
            'warnings': ([f'role {", ".join(strange)} 는 엔진이 그리는 역할이 아니다 — '
                          f'그 노드는 일반 region으로 그려진다 '
                          f'(엔진 역할: {", ".join(ENGINE_ROLES)})'] if strange else []),
            'next': '변경은 새 팩 버전을 빌드해야 반영된다: '
                    'pack_edit.py build --version heroines/<새 날짜>'}


# --- build -------------------------------------------------------------------------

def run(command, cwd):
    result = subprocess.run(command, cwd=cwd, capture_output=True, text=True)
    return {'command': ' '.join(command), 'exit_code': result.returncode,
            'stderr': result.stderr.strip()[-1200:], 'stdout': result.stdout.strip()[-400:]}


def build(args, source_root, pack_dir):
    if not source_root:
        return {'ok': False, 'errors': ['상류 design-pipeline 체크아웃을 찾지 못했다 — '
                                        '--source-root 로 지정한다']}
    version = args.version
    if '/' not in version or '..' in version:
        return {'ok': False, 'errors': ['--version 은 <pack-id>/<release> 형식이다']}
    dest = PACK_ROOT / Path(version)
    if dest.exists() and not args.overwrite:
        return {'ok': False, 'errors': [
            f'{dest.relative_to(WORKSPACE_ROOT)} 는 이미 있다. 팩은 판본이라 제자리에서 바뀌지 않는다 — '
            '새 날짜를 준다. 같은 버전을 덮어쓰면 이 팩을 쓰던 모든 케이스가 '
            'hash mismatch 로 깨지고 승인이 stale 이 된다.']}

    existed = dest.exists()

    def clean_up():
        if existed or not dest.exists():
            return
        import shutil
        shutil.rmtree(dest, ignore_errors=True)

    steps = []
    targets = [t.strip() for t in (args.regenerate or '').split(',') if t.strip()]
    for target in targets:
        route = ROUTES.get(target)
        if not route:
            return {'ok': False, 'errors': [f'알 수 없는 대상 {target!r} '
                                            f'(가능: {", ".join(ROUTES)})']}
        if route['needs_siblings'] and not all((source_root.parent / n).exists() for n in SIBLING_REPOS):
            return {'ok': False, 'errors': [
                f'{target} 재생성은 읽기 전용 참조 저장소 {", ".join(SIBLING_REPOS)} 를 '
                f'{source_root.parent} 아래에 요구한다. 이 머신에는 없다.']}
        for command in route['regenerate']:
            steps.append(run(command.split(), source_root))
            if steps[-1]['exit_code'] != 0:
                clean_up()
                return {'ok': False, 'steps': steps,
                        'errors': [f'{target} 재생성 실패: {steps[-1]["command"]}']}

    steps.append(run(['python3', str(BUILD_PACK), '--source-root', str(source_root),
                      '--version', version, '--dest', str(dest)], PLUGIN_ROOT))
    if steps[-1]['exit_code'] != 0:
        clean_up()
        return {'ok': False, 'steps': steps, 'errors': ['팩 빌드가 거부했다 — stderr를 읽는다']}

    verify = run(['node', '-e', (
        "const {loadKnowledgePack} = await import('./src/engine.mjs');"
        f"const p = loadKnowledgePack({json.dumps(str(PACK_ROOT))}, {json.dumps(version)});"
        "console.log(JSON.stringify({hash: p.hash, roles: p.roles.length,"
        " components: p.componentKnowledge.length, references: p.references.length}));"
    ), '--input-type=module'],
        PLUGIN_ROOT / 'design-pipeline')
    steps.append(verify)
    if verify['exit_code'] != 0:
        clean_up()
        return {'ok': False, 'steps': steps,
                'errors': ['빌드된 팩을 엔진이 로드하지 못했다 — provenance 검증 실패']}

    review = run(['python3', str(PLUGIN_ROOT / 'scripts/pack_review.py'), version], WORKSPACE_ROOT)
    steps.append(review)
    if review['exit_code'] != 0:
        clean_up()
        return {'ok': False, 'steps': steps,
                'errors': ['검토 화면 생성이 실패했다 — 팩은 만들었지만 사람이 볼 수 없다']}

    # A pack whose review page renders a control as nothing still passes every hash check.
    # Rendering it here is the only place that catch happens before a designer sees it.
    audit = run(['node', str(PLUGIN_ROOT / 'design-pipeline/src/review-audit.mjs'),
                 '--page', str(dest / 'pack-review.html')], PLUGIN_ROOT / 'design-pipeline')
    steps.append(audit)
    findings = []
    skipped = ''
    try:
        parsed = json.loads(audit['stdout'] or '{}')
        findings = parsed.get('findings') or []
        skipped = parsed.get('skipped', '')
    except ValueError:
        findings = [{'area': 'audit', 'problems': ['감사 출력을 읽지 못했다']}]
    if findings and not args.allow_render_findings:
        clean_up()
        return {'ok': False, 'steps': steps, 'renderFindings': findings,
                'errors': ['검토 화면 렌더에 문제가 있다 — 고치거나 '
                           '--allow-render-findings 로 의도한 것임을 밝힌다']}

    return {'ok': True, 'version': version, 'dest': str(dest.relative_to(WORKSPACE_ROOT)),
            'engine_load': verify['stdout'], 'steps': steps,
            'renderAudit': skipped or ('문제 없음' if not findings else f'발견 {len(findings)}건'),
            'next': ['사람 승인: python3 scripts/pack_approval.py (팩 버전마다 한 번)',
                     '검토 화면: python3 scripts/pack_review.py ' + version,
                     '이전 팩을 쓰던 케이스는 자동으로 옮겨가지 않는다 — '
                     '새 팩을 쓰려면 3단계부터 다시 도출한다']}


# --- diff --------------------------------------------------------------------------

def pack_diff(left_dir, right_dir):
    import pack_tokens_css
    left = load_json(left_dir / 'pack.json')
    right = load_json(right_dir / 'pack.json')

    def tokens(pack):
        flat = pack_tokens_css.flatten(pack.get('tokens', {}))
        return {name: pack_tokens_css.resolve(flat, value) for name, value in flat.items()}

    left_tokens, right_tokens = tokens(left), tokens(right)
    changed = {name: {'from': left_tokens[name], 'to': right_tokens[name]}
               for name in set(left_tokens) & set(right_tokens)
               if left_tokens[name] != right_tokens[name]}

    def ids(pack, key, field):
        return {row.get(field, '') for row in pack.get(key, [])}

    out = {'from': left.get('version', ''), 'to': right.get('version', ''),
           'tokens': {'added': sorted(set(right_tokens) - set(left_tokens)),
                      'removed': sorted(set(left_tokens) - set(right_tokens)),
                      'changed': changed}}
    for key, field, label in (('componentKnowledge', 'ref', 'components'),
                              ('roles', 'id', 'roles'),
                              ('recipeRules', 'type', 'recipes'),
                              ('usability', 'id', 'usability'),
                              ('references', 'id', 'references')):
        before, after = ids(left, key, field), ids(right, key, field)
        out[label] = {'added': sorted(after - before), 'removed': sorted(before - after),
                      'total': len(after)}
    out['principles'] = {'total': len(right.get('principles', {}).get('principles', []))}
    return out


# --- cli ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--source-root', help='upstream design-pipeline checkout')
    parser.add_argument('--pack', help='pack version to read (default: newest)')
    commands = parser.add_subparsers(dest='command', required=True)

    commands.add_parser('doctor', help='what can be changed on this machine, and why not')

    route_parser = commands.add_parser('route', help='where an intent actually lands')
    route_parser.add_argument('target', nargs='?', choices=sorted(ROUTES))

    promote = commands.add_parser('promote-component',
                                  help='let a wireframe use an already-packed contract')
    promote.add_argument('--component', required=True, help='e.g. Radio')
    promote.add_argument('--role', required=True, help='comma separated, e.g. checkbox')
    promote.add_argument('--states', required=True,
                         help='comma separated supported state axes, must include visible')
    promote.add_argument('--source-path', required=True,
                         help='the pack source file this knowledge is read from')
    promote.add_argument('--limitation', required=True, help='what this row does NOT promise')
    promote.add_argument('--ref', help='default: component:<component>')
    promote.add_argument('--kind', default='native-adapter')
    promote.add_argument('--origin', default='ba-authored-adapter',
                         choices=('ba-authored-adapter', 'upstream-derived-contract'))
    promote.add_argument('--interface-file')
    promote.add_argument('--interface-name')
    promote.add_argument('--dry-run', action='store_true')

    build_parser = commands.add_parser('build', help='regenerate upstream and build a new pack')
    build_parser.add_argument('--version', required=True, help='heroines/YYYY-MM-DD')
    build_parser.add_argument('--regenerate', help='comma separated: ' + ', '.join(ROUTES))
    build_parser.add_argument('--overwrite', action='store_true',
                              help='DANGEROUS: breaks every case bound to that version')

    diff_parser = commands.add_parser('diff', help='what changed between two pack versions')
    diff_parser.add_argument('left')
    diff_parser.add_argument('right')

    args = parser.parse_args()
    try:
        source_root = find_source_root(args.source_root)
        pack_dir = resolve_pack_dir(args.pack) if args.pack else latest_pack_dir()
        if args.command == 'doctor':
            result = doctor(source_root, pack_dir)
        elif args.command == 'route':
            result = ({'targets': ROUTES} if not args.target
                      else {'target': args.target, **ROUTES[args.target]})
        elif args.command == 'promote-component':
            result = promote_component(args, pack_dir)
        elif args.command == 'build':
            result = build(args, source_root, pack_dir)
        else:
            result = pack_diff(resolve_pack_dir(args.left), resolve_pack_dir(args.right))
    except (OSError, UnicodeError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print(json.dumps({'error': str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get('ok', True) and not result.get('error') else 1


if __name__ == '__main__':
    sys.exit(main())
