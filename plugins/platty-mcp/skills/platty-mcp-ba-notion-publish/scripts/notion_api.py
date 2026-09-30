#!/usr/bin/env python3
"""Minimal Notion REST client for publishing BA documents.

usage:
  notion_api.py check
  notion_api.py page <page-id-or-url>
  notion_api.py search <query> [--data-source ID] [--limit 3]
  notion_api.py create --parent <page-id-or-url> --title TITLE --markdown-file FILE [--icon EMOJI]

Settings are read from the environment first, then from the local settings file
(PLATTY_BA_ENV_FILE, default ~/.config/platty-mcp/ba.env, `KEY = value` lines):
  NOTION_API_TOKEN                 Notion connection token (required)
  PLATTY_BA_NOTION_HOME_DATA_SOURCE data source where task pages live (optional)

The token is never printed or written anywhere. Every command prints one JSON object.
There is no update or delete command: this client only reads and creates pages.
Pages are created with the `markdown` body field (Notion-Version 2026-03-11), so the input is
Notion-flavored Markdown as written by md_to_notion.py.
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = 'https://api.notion.com/v1'
NOTION_VERSION = '2026-03-11'
DEFAULT_ENV_FILE = Path.home() / '.config' / 'platty-mcp' / 'ba.env'
ID = re.compile(r'([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})', re.I)


class NotionError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def read_env_file():
    path = Path(os.environ.get('PLATTY_BA_ENV_FILE') or DEFAULT_ENV_FILE).expanduser()
    values = {}
    try:
        lines = path.read_text(encoding='utf-8').splitlines()
    except OSError:
        return values
    for line in lines:
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        values[key.strip().removeprefix('export ').strip()] = value.strip().strip('"\'')
    return values


def setting(key, file_values):
    return (os.environ.get(key) or file_values.get(key) or '').strip()


def notion_id(text):
    """A page, database or data source id from an id or a Notion URL (the last id in it)."""
    found = ID.findall(text.split('?')[0])
    if not found:
        raise SystemExit(json.dumps({'error': 'not a Notion id or URL', 'input': text}, ensure_ascii=False))
    return '-'.join(found[-1]).lower()


class Client:
    def __init__(self, token):
        self.token = token

    def call(self, method, path, body=None, attempts=4):
        data = json.dumps(body).encode() if body is not None else None
        for attempt in range(attempts):
            req = urllib.request.Request(API + path, data=data, method=method, headers={
                'Authorization': f'Bearer {self.token}', 'Notion-Version': NOTION_VERSION,
                'Content-Type': 'application/json'})
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    return json.loads(r.read())
            except urllib.error.HTTPError as e:
                try:
                    err = json.loads(e.read() or b'{}')
                except ValueError:
                    err = {}
                if e.code in (429, 500, 502, 503) and attempt + 1 < attempts:
                    time.sleep(float(e.headers.get('Retry-After') or 2 * (attempt + 1)))
                    continue
                raise NotionError(e.code, err.get('code', ''), err.get('message', ''))


def plain(rich):
    return ''.join(t.get('plain_text', '') for t in rich or [])


def page_title(obj):
    if obj.get('title'):
        return plain(obj['title'])
    for prop in (obj.get('properties') or {}).values():
        if prop.get('type') == 'title':
            return plain(prop['title'])
    return ''


def summary(obj):
    parent = obj.get('parent') or {}
    kind = parent.get('type', '')
    return {'id': obj['id'], 'object': obj['object'], 'title': page_title(obj), 'url': obj.get('url'),
            'parent_type': kind, 'parent_id': parent.get(kind) if kind != 'workspace' else None,
            'is_database_row': kind in ('data_source_id', 'database_id'), 'in_trash': obj.get('in_trash', False)}


def cmd_check(client, file_values, _args):
    me = client.call('GET', '/users/me')
    out = {'ok': True, 'connection': me.get('name'), 'workspace': (me.get('bot') or {}).get('workspace_name'),
           'home_data_source': None}
    home = setting('PLATTY_BA_NOTION_HOME_DATA_SOURCE', file_values)
    if home:
        ds = client.call('GET', f'/data_sources/{notion_id(home)}')
        out['home_data_source'] = {'id': ds['id'], 'title': page_title(ds)}
    return out


def cmd_page(client, _file_values, args):
    return summary(client.call('GET', f'/pages/{notion_id(args.target)}'))


def title_property(client, data_source_id):
    ds = client.call('GET', f'/data_sources/{data_source_id}')
    for name, prop in (ds.get('properties') or {}).items():
        if prop.get('type') == 'title':
            return name
    raise NotionError(400, 'no_title_property', 'the data source has no title property')


def cmd_search(client, file_values, args):
    source = args.data_source or setting('PLATTY_BA_NOTION_HOME_DATA_SOURCE', file_values)
    if source:
        source = notion_id(source)
        prop = title_property(client, source)
        res = client.call('POST', f'/data_sources/{source}/query', {
            'filter': {'property': prop, 'title': {'contains': args.query}}, 'page_size': args.limit})
        scope = {'data_source': source}
    else:
        res = client.call('POST', '/search', {'query': args.query, 'page_size': args.limit,
                                              'filter': {'property': 'object', 'value': 'page'}})
        scope = {'workspace': True}
    return {**scope, 'results': [summary(o) for o in res.get('results', [])[:args.limit]]}


def cmd_create(client, _file_values, args):
    markdown = Path(args.markdown_file).read_text(encoding='utf-8')
    body = {'parent': {'page_id': notion_id(args.parent)},
            'properties': {'title': {'title': [{'type': 'text', 'text': {'content': args.title}}]}},
            'markdown': markdown}
    if args.icon:
        body['icon'] = {'type': 'emoji', 'emoji': args.icon}
    created = client.call('POST', '/pages', body)
    return {'created': True, 'id': created['id'], 'url': created.get('url'), 'title': args.title}


HINTS = {
    401: 'The token is invalid or revoked. Ask the Notion workspace admin for the current token.',
    403: 'The connection lacks a capability (read or insert content). Ask the Notion workspace admin.',
    404: 'Not found or not shared with the connection. Share the page (or a parent) with the connection.',
}


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='command', required=True)
    sub.add_parser('check')
    p = sub.add_parser('page')
    p.add_argument('target')
    s = sub.add_parser('search')
    s.add_argument('query')
    s.add_argument('--data-source', default='')
    s.add_argument('--limit', type=int, default=3)
    c = sub.add_parser('create')
    c.add_argument('--parent', required=True)
    c.add_argument('--title', required=True)
    c.add_argument('--markdown-file', required=True)
    c.add_argument('--icon', default='')
    args = ap.parse_args()
    file_values = read_env_file()
    token = setting('NOTION_API_TOKEN', file_values)
    if not token:
        print(json.dumps({'error': 'no NOTION_API_TOKEN in the environment or the settings file',
                          'settings_file': str(Path(os.environ.get('PLATTY_BA_ENV_FILE') or DEFAULT_ENV_FILE))}))
        return 2
    handler = {'check': cmd_check, 'page': cmd_page, 'search': cmd_search, 'create': cmd_create}[args.command]
    try:
        out = handler(Client(token), file_values, args)
    except NotionError as e:
        print(json.dumps({'error': e.code or 'http_error', 'status': e.status, 'message': e.message,
                          'hint': HINTS.get(e.status, '')}, ensure_ascii=False))
        return 1
    except urllib.error.URLError as e:
        print(json.dumps({'error': 'network', 'message': str(e.reason)}))
        return 1
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
