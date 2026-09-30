#!/usr/bin/env python3
"""Generate storyboard scene images with Gemini on Vertex AI, one per stage.

usage:
  gen_scenes.py <spec.json> --out <dir> [--only 2,5] [--force]

Authentication is the user's Google Application Default Credentials (ADC), created once with
`gcloud auth application-default login`. No API key is used or stored. The access token is
never written to disk or printed.

Settings are read from the environment first, then from the local settings file
(PLATTY_BA_ENV_FILE, default ~/.config/platty-mcp/ba.env, `KEY = value` lines):
  PLATTY_BA_VERTEX_PROJECT   Google Cloud project that runs Vertex AI (required)
  PLATTY_BA_VERTEX_LOCATION  Vertex AI location (default: global)
  PLATTY_BA_IMAGE_MODEL      image model (default: spec.art.model, then gemini-2.5-flash-image)

Without a project or ADC the script exits 0 with {"skipped": ...} so the builder falls back to
labelled placeholders.

Prompt = spec.art.style + spec.art.character + stage.scene.prompt + a fixed "no text" suffix.
Images are saved as <out>/img/scene-<n>.jpg (960x720) with Pillow; without Pillow, macOS `sips`
converts them to JPEG.
"""
import argparse
import base64
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

NO_TEXT = ' No text, no letters, no numbers, no captions, no frame labels, no logos anywhere in the image.'
DEFAULT_ENV_FILE = Path.home() / '.config' / 'platty-mcp' / 'ba.env'
DEFAULT_MODEL = 'gemini-2.5-flash-image'
TOKEN_URL = 'https://oauth2.googleapis.com/token'
GCLOUD_CANDIDATES = ('/opt/homebrew/bin/gcloud', '/usr/local/bin/gcloud',
                     str(Path.home() / 'google-cloud-sdk' / 'bin' / 'gcloud'),
                     '/opt/homebrew/share/google-cloud-sdk/bin/gcloud')


class Skip(Exception):
    pass


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


def setting(key, file_values, default=''):
    return (os.environ.get(key) or file_values.get(key) or default).strip()


def adc_path():
    explicit = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
    if explicit:
        return Path(explicit).expanduser()
    return Path.home() / '.config' / 'gcloud' / 'application_default_credentials.json'


def token_from_adc_file():
    """Refresh an `authorized_user` ADC file (what `gcloud auth application-default login` writes)."""
    try:
        creds = json.loads(adc_path().read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    if creds.get('type') != 'authorized_user':
        return None
    body = urllib.parse.urlencode({'grant_type': 'refresh_token', 'client_id': creds.get('client_id', ''),
                                   'client_secret': creds.get('client_secret', ''),
                                   'refresh_token': creds.get('refresh_token', '')}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(TOKEN_URL, data=body, method='POST'), timeout=30) as r:
            return json.loads(r.read()).get('access_token')
    except (urllib.error.URLError, ValueError) as e:
        raise Skip(f'ADC refresh failed ({type(e).__name__}); run `gcloud auth application-default login`')


def token_from_gcloud():
    exe = shutil.which('gcloud') or next((c for c in GCLOUD_CANDIDATES if Path(c).exists()), None)
    if not exe:
        return None
    try:
        out = subprocess.run([exe, 'auth', 'application-default', 'print-access-token'],
                             capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() if out.returncode == 0 and out.stdout.strip() else None


def access_token():
    bearer = token_from_adc_file() or token_from_gcloud()
    if not bearer:
        raise Skip('no Application Default Credentials; run `gcloud auth application-default login`')
    return bearer


def endpoint(project, location, model):
    host = 'aiplatform.googleapis.com' if location == 'global' else f'{location}-aiplatform.googleapis.com'
    return (f'https://{host}/v1/projects/{project}/locations/{location}'
            f'/publishers/google/models/{model}:generateContent')


def generate(url, bearer, prompt, aspect='4:3', attempts=3):
    body = json.dumps({
        'contents': [{'role': 'user', 'parts': [{'text': prompt}]}],
        'generationConfig': {'responseModalities': ['IMAGE'], 'imageConfig': {'aspectRatio': aspect}},
    }).encode()
    for attempt in range(attempts):
        req = urllib.request.Request(url, data=body, method='POST',
                                     headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {bearer}'})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                data = json.loads(r.read())
            break
        except urllib.error.HTTPError as e:
            detail = e.read()[:300].decode(errors='replace')
            if e.code in (429, 500, 503) and attempt + 1 < attempts:
                time.sleep(10 * (attempt + 1))
                continue
            raise RuntimeError(f'HTTP {e.code}: {detail}')
    for cand in data.get('candidates', []):
        for part in cand.get('content', {}).get('parts', []):
            inline = part.get('inlineData') or part.get('inline_data')
            if inline and inline.get('data'):
                return base64.b64decode(inline['data'])
    raise RuntimeError('no image in response: ' + json.dumps(data)[:300])


def save(raw, path):
    try:
        from PIL import Image
    except ImportError:
        save_without_pillow(raw, path)
        return
    im = Image.open(io.BytesIO(raw)).convert('RGB')
    w, h = im.size
    tw = int(h * 4 / 3)
    if tw < w:
        left = (w - tw) // 2
        im = im.crop((left, 0, left + tw, h))
    elif tw > w:
        th = int(w * 3 / 4)
        top = (h - th) // 2
        im = im.crop((0, top, w, top + th))
    im.resize((960, 720), Image.LANCZOS).save(path, quality=80, optimize=True, progressive=True)


def save_without_pillow(raw, path):
    """The image is already 4:3; convert to a 960x720 JPEG with macOS `sips`, else keep the bytes."""
    sips = shutil.which('sips') or ('/usr/bin/sips' if Path('/usr/bin/sips').exists() else None)
    if sips:
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
            tmp.write(raw)
        try:
            done = subprocess.run([sips, '-s', 'format', 'jpeg', '-s', 'formatOptions', '80', '-z', '720', '960',
                                   tmp.name, '--out', str(path)], capture_output=True, timeout=60)
            if done.returncode == 0 and path.exists():
                return
        finally:
            os.unlink(tmp.name)
    path.write_bytes(raw)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('spec')
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', default='')
    ap.add_argument('--force', action='store_true')
    a = ap.parse_args()
    spec = json.loads(Path(a.spec).read_text(encoding='utf-8'))
    art = spec.get('art', {})
    file_values = read_env_file()
    project = setting('PLATTY_BA_VERTEX_PROJECT', file_values)
    location = setting('PLATTY_BA_VERTEX_LOCATION', file_values, 'global')
    model = setting('PLATTY_BA_IMAGE_MODEL', file_values, art.get('model') or DEFAULT_MODEL)
    if not project:
        print(json.dumps({'skipped': 'no PLATTY_BA_VERTEX_PROJECT in the environment or the settings file'}))
        return 0
    try:
        bearer = access_token()
    except Skip as e:
        print(json.dumps({'skipped': str(e)}))
        return 0
    url = endpoint(project, location, model)
    only = {int(x) for x in a.only.split(',') if x.strip()}
    (Path(a.out) / 'img').mkdir(parents=True, exist_ok=True)
    results = []
    for i, st in enumerate(spec['stages'], start=1):
        scene = st.get('scene', {})
        if only and i not in only:
            continue
        if not scene.get('prompt') or not scene.get('image'):
            results.append({'stage': i, 'skipped': 'no prompt or image path'})
            continue
        path = Path(a.out) / scene['image']
        if path.exists() and not a.force:
            results.append({'stage': i, 'kept': str(path)})
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        prompt = ' '.join(x for x in (art.get('style', ''), art.get('character', ''), scene['prompt']) if x) + NO_TEXT
        try:
            save(generate(url, bearer, prompt), path)
            results.append({'stage': i, 'saved': str(path)})
        except (urllib.error.URLError, RuntimeError, OSError) as e:
            results.append({'stage': i, 'error': str(e)[:300]})
    print(json.dumps({'project': project, 'location': location, 'model': model, 'results': results}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
