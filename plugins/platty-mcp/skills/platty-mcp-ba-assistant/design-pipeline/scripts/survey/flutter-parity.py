#!/usr/bin/env python3
"""Design pack survey — Flutter HDS parity against the design knowledge pack.

The Flutter foundations are hand-written Dart, not generated from the token source,
so they can drift from the pack silently. This reads the Dart literals and reports
three things: values that disagree, tokens one side has and the other does not, and
components the pack cannot express.

Dart is read with regular expressions, not a Dart parser: only literal declarations
are understood, and anything computed at runtime is invisible here.
"""
import argparse
import json
import re
from pathlib import Path


def dart_color(literal):
    """0xFFRRGGBB / Color.fromRGBO(r, g, b, a) -> (#rrggbb, alpha)."""
    hex_match = re.fullmatch(r'0x([0-9a-fA-F]{8})', literal.strip())
    if hex_match:
        value = hex_match.group(1)
        return '#' + value[2:].lower(), round(int(value[:2], 16) / 255, 3)
    rgbo = re.fullmatch(r'Color\.fromRGBO\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)', literal.strip())
    if rgbo:
        r, g, b, a = rgbo.groups()
        return '#%02x%02x%02x' % (int(r), int(g), int(b)), round(float(a), 3)
    return None, None


def parse_colors(text):
    palette, semantic = {}, {}
    for name, body in re.findall(r'final MaterialColor (\w+) = const MaterialColor\([^,]+,\s*\{(.*?)\}\)', text, re.S):
        for shade, literal in re.findall(r'(\d+):\s*Color\((0x[0-9a-fA-F]{8})\)', body):
            value, alpha = dart_color(literal)
            palette[f'{name}.{shade}'] = (value, alpha)
    for name, literal in re.findall(r'final Color (\w+) =\s*const (Color\(0x[0-9a-fA-F]{8}\)|Color\.fromRGBO\([^;]*?\));', text, re.S):
        inner = re.fullmatch(r'Color\((0x[0-9a-fA-F]{8})\)', literal.strip())
        value, alpha = dart_color(inner.group(1) if inner else literal)
        semantic[name] = (value, alpha)
    return palette, semantic


def parse_typography(text):
    styles = {}
    for name, body in re.findall(r'static const TextStyle (\w+) = TextStyle\((.*?)\);', text, re.S):
        size = re.search(r'fontSize:\s*([\d.]+)', body)
        weight = re.search(r'fontWeight:\s*FontWeight\.w(\d+)', body)
        height = re.search(r'height:\s*([\d.]+)', body)
        styles[name] = {
            'fontSize': float(size.group(1)) if size else None,
            'fontWeight': int(weight.group(1)) if weight else None,
            'lineHeightRatio': float(height.group(1)) if height else None,
        }
    return styles


def parse_shadows(text):
    shadows = {}
    for name, body in re.findall(r'static const (\w+) = BoxShadow\((.*?)\);', text, re.S):
        color = re.search(r'color:\s*(Color\.fromRGBO\([^)]*\)|Color\(0x[0-9a-fA-F]{8}\))', body)
        blur = re.search(r'blurRadius:\s*([\d.]+)', body)
        offset = re.search(r'Offset\(([\d.-]+),\s*([\d.-]+)\)', body)
        value, alpha = dart_color(color.group(1)) if color else (None, None)
        shadows[name] = {'color': value, 'alpha': alpha,
                         'blur': float(blur.group(1)) if blur else None,
                         'offsetY': float(offset.group(2)) if offset else None}
    return shadows


def pack_colors(tokens):
    """Pack DTCG colors -> {dotted name: (#rrggbb, alpha)}, aliases resolved.

    Semantic tokens are aliases into the palette ({color.palette.violet.700}); comparing
    them without resolving would report every semantic token as missing.
    """
    raw = {}

    def walk(node, path):
        if isinstance(node, dict):
            if '$value' in node:
                raw[path] = node['$value']
                return
            for key, child in node.items():
                if not key.startswith('$'):
                    walk(child, f'{path}.{key}' if path else key)

    walk(tokens.get('color', {}), 'color')

    def resolve(name, seen=()):
        value = raw.get(name)
        if isinstance(value, str):
            alias = re.fullmatch(r'\{([^}]+)\}', value.strip())
            if alias and name not in seen:
                return resolve(alias.group(1), seen + (name,))
            return None
        if isinstance(value, dict) and value.get('colorSpace') == 'srgb':
            components = value.get('components') or []
            if len(components) >= 3:
                return ('#' + ''.join(f'{round(c * 255):02x}' for c in components[:3]),
                        round(float(value.get('alpha', 1)), 3))
        return None

    return {name: pair for name in raw if (pair := resolve(name))}


CAMEL = re.compile(r'(?<!^)(?=[A-Z])')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--flutter', required=True, help='packages/user-flutter-ui directory')
    ap.add_argument('--pack', required=True)
    ap.add_argument('--webview', help='heroines-webview checkout, for component parity')
    ap.add_argument('--parity-map', help='HDS component-map.md, the declared cross-platform mapping')
    ap.add_argument('--out', required=True)
    args = ap.parse_args()

    foundation = Path(args.flutter) / 'lib/heroines_design_system/foundation'
    palette, semantic = parse_colors((foundation / 'hds_colors.dart').read_text(encoding='utf-8'))
    typography = parse_typography((foundation / 'hds_typography.dart').read_text(encoding='utf-8'))
    shadows = parse_shadows((foundation / 'hds_shadows.dart').read_text(encoding='utf-8'))

    pack = json.loads(Path(args.pack).read_text(encoding='utf-8'))
    tokens = pack['tokens']
    packed = pack_colors(tokens)
    packed_palette = {name.replace('color.palette.', ''): value for name, value in packed.items() if name.startswith('color.palette.')}
    packed_semantic = {name.replace('color.semantic.', ''): value for name, value in packed.items() if name.startswith('color.semantic.')}

    # palette: names differ across platforms (Dart "black.*" vs pack "gray.*"), so a value
    # match under another name is a naming difference, not a missing token.
    pack_palette_by_value = {}
    for name, (value, alpha) in packed_palette.items():
        pack_palette_by_value.setdefault((value, alpha), []).append(name)
    flutter_palette_by_value = {}
    for name, (value, alpha) in palette.items():
        flutter_palette_by_value.setdefault((value, alpha), []).append(name)
    palette_rows = []
    for name in sorted(set(palette) | set(packed_palette)):
        dart_value = palette.get(name)
        pack_value = packed_palette.get(name)
        if dart_value and pack_value:
            if dart_value[0] != pack_value[0]:
                palette_rows.append({'token': name, 'flutter': dart_value[0], 'pack': pack_value[0], 'issue': 'value-mismatch'})
        elif dart_value:
            twin = pack_palette_by_value.get(dart_value)
            palette_rows.append({'token': name, 'flutter': dart_value[0], 'pack': None,
                                 'issue': 'name-differs' if twin else 'flutter-only',
                                 'packTokenWithSameValue': twin[0] if twin else None})
        elif pack_value:
            twin = flutter_palette_by_value.get(pack_value)
            palette_rows.append({'token': name, 'flutter': None, 'pack': pack_value[0],
                                 'issue': 'name-differs' if twin else 'pack-only',
                                 'flutterTokenWithSameValue': twin[0] if twin else None})

    # semantic: dart grayStrong vs pack neutralGrayStrong etc. — match on value first, then name
    pack_by_value = {}
    for name, (value, alpha) in packed_semantic.items():
        pack_by_value.setdefault((value, alpha), []).append(name)
    semantic_rows = []
    for name, (value, alpha) in sorted(semantic.items()):
        same_name = packed_semantic.get(name)
        same_value = pack_by_value.get((value, alpha), [])
        if same_name and same_name[0] == value:
            status = 'match'
        elif same_value:
            status = 'match-different-name'
        elif same_name:
            status = 'value-mismatch'
        else:
            status = 'flutter-only'
        semantic_rows.append({'flutterToken': name, 'flutterValue': value, 'alpha': alpha,
                              'packToken': same_name and name or (same_value[0] if same_value else None),
                              'packValue': same_name[0] if same_name else (value if same_value else None),
                              'status': status})
    covered = {row['packToken'] for row in semantic_rows if row['packToken']}
    pack_only_semantic = sorted(set(packed_semantic) - covered)

    # typography: pack scale is size/lineHeight per role; Dart multiplies role x weight
    scale = tokens.get('typography', {}).get('scale', {})
    pack_scale = {}
    for role, entry in scale.items():
        size = entry.get('fontSize', {}).get('$value', {})
        line = entry.get('lineHeight', {}).get('$value', {})
        pack_scale[role] = {'fontSize': size.get('value') if isinstance(size, dict) else size,
                            'lineHeight': line.get('value') if isinstance(line, dict) else line}
    typo_rows = []
    for name, style in sorted(typography.items()):
        role = re.sub(r'(Bold|Medium|Regular)$', '', name)
        role_key = {'heading1': 'heading1', 'heading2': 'heading2', 'heading3': 'heading3'}.get(role, role)
        packed_role = pack_scale.get(role_key)
        line_px = round(style['fontSize'] * style['lineHeightRatio'], 2) if style['fontSize'] and style['lineHeightRatio'] else None
        row = {'flutterStyle': name, 'role': role_key, 'fontSize': style['fontSize'],
               'fontWeight': style['fontWeight'], 'lineHeightPx': line_px,
               'packFontSize': packed_role and packed_role['fontSize'],
               'packLineHeight': packed_role and packed_role['lineHeight']}
        if not packed_role:
            row['status'] = 'pack-missing-role'
        elif packed_role['fontSize'] != style['fontSize']:
            row['status'] = 'font-size-mismatch'
        elif line_px is not None and packed_role['lineHeight'] is not None and abs(line_px - packed_role['lineHeight']) > 0.51:
            row['status'] = 'line-height-mismatch'
        else:
            row['status'] = 'match'
        typo_rows.append(row)
    pack_only_roles = sorted(set(pack_scale) - {row['role'] for row in typo_rows})

    # shadows
    pack_shadow = tokens.get('shadow', {})
    shadow_rows = []
    for name, value in sorted(shadows.items()):
        entry = pack_shadow.get(name, {}).get('$value')
        packed_blur = packed_alpha = packed_offset = None
        if isinstance(entry, dict):
            blur = entry.get('blur')
            packed_blur = blur.get('value') if isinstance(blur, dict) else blur
            offset = entry.get('offsetY')
            packed_offset = offset.get('value') if isinstance(offset, dict) else offset
            color = entry.get('color')
            if isinstance(color, dict):
                packed_alpha = round(float(color.get('alpha', 1)), 3)
        shadow_rows.append({'shadow': name, 'flutter': value,
                            'packBlur': packed_blur, 'packOffsetY': packed_offset, 'packAlpha': packed_alpha,
                            'status': 'pack-missing' if entry is None else
                                      'match' if (packed_blur == value['blur'] and packed_alpha == value['alpha']) else 'value-mismatch'})

    # components
    flutter_components = sorted({
        re.sub(r'^hds_', '', path.stem) for path in (Path(args.flutter) / 'lib/heroines_design_system/component').rglob('*.dart')
        if path.stem.startswith('hds_') and 'style' not in path.parts
    })
    promoted = {row['component'] for row in pack['componentKnowledge']}

    def normalize(name):
        return re.sub(r'[^a-z0-9]', '', name.lower())

    # The design system states the cross-platform mapping itself; guessing from file names
    # reports HDSRadioButton as Flutter-only when the WebView has Radio.
    parity_map = {}
    if args.parity_map and Path(args.parity_map).exists():
        for line in Path(args.parity_map).read_text(encoding='utf-8').splitlines():
            cells = [cell.strip() for cell in line.split('|')[1:-1]]
            if len(cells) < 3 or cells[0] in ('HDS concept', '---') or set(cells[0]) <= {'-'}:
                continue
            concept, flutter_cell, webview_cell = cells[0], cells[1], cells[2]
            for symbol in re.findall(r'`([^`]+)`', flutter_cell):
                if symbol.startswith('HDS'):
                    parity_map[normalize(symbol)] = {'concept': concept, 'webview': webview_cell}

    promoted_norm = {normalize(c) for c in promoted}
    webview_names = {}
    if args.webview:
        hds_dir = Path(args.webview) / 'src/libs/hds'
        for path in hds_dir.rglob('*.tsx'):
            if 'icons' in path.parts or path.stem.endswith('.stories'):
                continue
            webview_names[normalize(path.stem)] = path.stem

    def candidates(name):
        # Dart names the control after its widget (radio_button); the WebView names the
        # concept (Radio). Compare both spellings before calling something unmapped.
        keys = [normalize(name)]  # exact spelling first, so TextButton never matches Text
        for suffix in ('button', 'display', 'box'):
            trimmed = normalize(name)
            if trimmed.endswith(suffix) and len(trimmed) > len(suffix) and trimmed[: -len(suffix)] not in keys:
                keys.append(trimmed[: -len(suffix)])
        return keys

    component_rows = []
    for name in flutter_components:
        symbol = 'hds' + normalize(name)
        mapped = parity_map.get(symbol)
        webview_stem = next((webview_names[key] for key in candidates(name) if key in webview_names), None)
        # the map's WebView cell names a path or a composition, not always a single component
        webview_from_map = None
        if mapped:
            paths = re.findall(r'`([^`]+)`', mapped['webview'])
            webview_from_map = paths[0] if paths else mapped['webview']
        component_rows.append({
            'flutter': name,
            'hdsConcept': mapped['concept'] if mapped else None,
            'webview': webview_stem or webview_from_map,
            'inWebview': bool(webview_stem) or bool(webview_from_map and webview_from_map.endswith('.tsx')),
            'inPack': any(key in promoted_norm for key in candidates(name)) or bool(webview_stem and normalize(webview_stem) in promoted_norm),
        })

    report = {
        'schema': 'design-pack-survey.flutter-parity.v1',
        'flutterPackage': str(Path(args.flutter)),
        'pack': pack['version'],
        'method': ('Dart literals read with regular expressions; computed or themed values are not seen. '
                   'Palette and semantic colors compare on hex and alpha, typography on size and line height, '
                   'shadows on blur, offset and alpha.'),
        'summary': {
            'paletteValueMismatch': sum(1 for row in palette_rows if row['issue'] == 'value-mismatch'),
            'paletteNameDiffers': sum(1 for row in palette_rows if row['issue'] == 'name-differs'),
            'paletteFlutterOnly': sum(1 for row in palette_rows if row['issue'] == 'flutter-only'),
            'palettePackOnly': sum(1 for row in palette_rows if row['issue'] == 'pack-only'),
            'semanticFlutterOnly': sum(1 for row in semantic_rows if row['status'] == 'flutter-only'),
            'semanticValueMismatch': sum(1 for row in semantic_rows if row['status'] == 'value-mismatch'),
            'semanticNameOnlyDifference': sum(1 for row in semantic_rows if row['status'] == 'match-different-name'),
            'semanticPackOnly': len(pack_only_semantic),
            'typographyStyles': len(typo_rows),
            'typographyMismatch': sum(1 for row in typo_rows if row['status'] not in ('match',)),
            'typographyPackOnlyRoles': pack_only_roles,
            'shadowIssues': sum(1 for row in shadow_rows if row['status'] != 'match'),
            'flutterComponents': len(component_rows),
            'flutterOnlyComponents': [row['flutter'] for row in component_rows if not row['inWebview']],
            'unmappedInParityMap': [row['flutter'] for row in component_rows if not row['hdsConcept']],
            'flutterComponentsNotInPack': [row['flutter'] for row in component_rows if not row['inPack']],
        },
        'palette': palette_rows,
        'semantic': semantic_rows,
        'semanticPackOnly': pack_only_semantic,
        'typography': typo_rows,
        'shadows': shadow_rows,
        'components': component_rows,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report['summary'], ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
