#!/usr/bin/env python3
"""Emit CSS custom properties from a design knowledge pack. Invents no value."""
import argparse
import json
from pathlib import Path
import re
import sys

GROUPS = ('color.semantic', 'spacing', 'radius', 'sizing', 'typography', 'layout')


def flatten(node, prefix=''):
    found = {}
    if isinstance(node, dict):
        if '$value' in node:
            return {prefix: node['$value']}
        for key, child in node.items():
            if not key.startswith('$'):
                found.update(flatten(child, f'{prefix}.{key}' if prefix else key))
    return found


def literal(value):
    if isinstance(value, dict):
        if 'value' in value:
            return f"{value['value']}{value.get('unit', '')}"
        if 'components' in value:
            red, green, blue = (round(part * 255) for part in value['components'])
            return f"rgba({red},{green},{blue},{value.get('alpha', 1)})"
    return str(value)


def resolve(tokens, value, depth=0):
    text = literal(value)
    alias = re.fullmatch(r'\{([^}]+)\}', text)
    if alias and depth < 8:
        return resolve(tokens, tokens.get(alias.group(1), text), depth + 1)
    return text


def emit(pack_path):
    tokens = flatten(json.loads(Path(pack_path).read_text(encoding='utf-8'))['tokens'])
    lines = [f'/* generated from {pack_path} — do not edit by hand */', ':root{']
    for name in sorted(tokens):
        if not name.startswith(GROUPS):
            continue
        value = resolve(tokens, tokens[name])
        if value.startswith('{') or value == 'None':
            continue
        lines.append(f"  --{name.replace('color.semantic.', '').replace('.', '-')}: {value};")
    lines.append('}')
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pack', type=Path)
    parser.add_argument('-o', '--output', type=Path)
    args = parser.parse_args()
    css = emit(args.pack)
    if args.output:
        args.output.write_text(css, encoding='utf-8')
        print(str(args.output))
    else:
        print(css, end='')
    return 0


if __name__ == '__main__':
    sys.exit(main())
