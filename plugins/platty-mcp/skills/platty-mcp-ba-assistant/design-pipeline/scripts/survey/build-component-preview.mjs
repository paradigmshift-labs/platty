#!/usr/bin/env node
// Design pack survey — component preview built from the real implementation.
//
// The pack carries contracts, not implementations, so the review page can only draw the
// engine's wireframe primitives. This renders the actual WebView HDS components at a
// pinned commit, with the app's own Tailwind config, so a designer sees what the product
// really looks like and can switch variants to test them.
//
// Variant axes come from the pack's closed props: the preview never invents a prop value
// the contract does not allow.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, a) => (i % 2 ? acc : [...acc, [v.replace(/^--/, ''), a[i + 1]]]), []));
for (const key of ['webview', 'pack', 'out', 'commit']) if (!args[key]) throw new Error(`--${key} is required`);

const WEBVIEW = resolve(args.webview);
const pack = JSON.parse(readFileSync(args.pack, 'utf8'));
const sha = (text) => createHash('sha256').update(text).digest('hex');

// How each promoted component is imported and what a realistic instance looks like.
// `sample` values are Korean product copy, not lorem, so line breaks look real.
const COMPONENTS = [
  {name: 'Text', module: '@/libs/hds/base/Text/Text', named: 'Text', file: 'src/libs/hds/base/Text/Text.tsx',
   children: '제일건강원 생기맥문동 80mlX14입 2박스', axes: ['variant', 'weight', 'color']},
  {name: 'BoxButton', module: '@/libs/hds/box-button/BoxButton', named: 'BoxButton', file: 'src/libs/hds/box-button/BoxButton.tsx',
   children: '43,890원 구매하기', axes: ['size', 'variant', 'color', 'status']},
  {name: 'CapsuleButton', module: '@/libs/hds/capsule-button/CapsuleButton', named: 'CapsuleButton', file: 'src/libs/hds/capsule-button/CapsuleButton.tsx',
   children: '전체보기', axes: ['size', 'variant', 'color', 'status']},
  {name: 'TextButton', module: '@/libs/hds/text-button/TextButton', named: 'TextButton', file: 'src/libs/hds/text-button/TextButton.tsx',
   children: '더보기', axes: ['size', 'color', 'status']},
  {name: 'Checkbox', module: '@/libs/hds/base/controls/checkbox/Checkbox', named: 'Checkbox', file: 'src/libs/hds/base/controls/checkbox/Checkbox.tsx',
   props: {label: '전체 선택 (2/3)'}, axes: ['size', 'variant', 'checkboxStyle'], booleans: ['checked', 'disabled']},
  {name: 'Radio', module: '@/libs/hds/base/controls/radio/Radio', named: 'Radio', file: 'src/libs/hds/base/controls/radio/Radio.tsx',
   props: {label: '신용카드', name: 'pay'}, axes: ['size', 'alignItems'], booleans: ['checked', 'disabled']},
  {name: 'Switch', module: '@/libs/hds/base/controls/switch/Switch', named: 'Switch', file: 'src/libs/hds/base/controls/switch/Switch.tsx',
   props: {label: '알림 받기'}, axes: ['size', 'alignItems'], booleans: ['checked', 'disabled']},
  {name: 'Avatar', module: '@/libs/hds/base/Profile/Avatar/Avatar', named: 'Avatar', file: 'src/libs/hds/base/Profile/Avatar/Avatar.tsx', axes: ['size']},
  {name: 'UserAvatar', module: '@/libs/hds/base/Profile/Avatar/UserAvatar', named: 'UserAvatar', file: 'src/libs/hds/base/Profile/Avatar/UserAvatar.tsx',
   axes: ['size'], booleans: ['isNewUser', 'hasNotification']},
  {name: 'BackButton', module: '@/libs/hds/top-navigation/BackButton', default: true, file: 'src/libs/hds/top-navigation/BackButton.tsx',
   props: {onClick: '__noop__'}, axes: []},
  // A nav bar lays itself out across the full screen width, and its title is absolutely
  // positioned: inside a shrink-to-fit box it collapses to nothing. titleAs only changes
  // the tag, so eight cases of it would look identical — the contract booleans do not.
  {name: 'TopNavigation', module: '@/libs/hds/top-navigation/TopNavigation', default: true, file: 'src/libs/hds/top-navigation/TopNavigation.tsx',
   props: {title: '장바구니'}, axes: [], booleans: ['autoImplyBackbutton'], fullWidth: true, extraCases: [{label: 'subTitle', props: {subTitle: '3개 상품'}}]},
  {name: 'WebviewTopNavigation', module: '@/libs/hds/top-navigation/WebviewTopNavigation', default: true, file: 'src/libs/hds/top-navigation/WebviewTopNavigation.tsx',
   props: {title: '주문/결제'}, axes: [], booleans: ['autoImplyBackbutton'], fullWidth: true, extraCases: [{label: 'subTitle', props: {subTitle: '배송지 확인'}}]},
];

// --- variant axes from the pack contract ------------------------------------------
const interfaces = pack.componentProps?.interfaces ?? [];
const knowledge = new Map((pack.componentKnowledge ?? []).map((row) => [row.component, row]));

function contractFor(component) {
  const row = knowledge.get(component.name);
  const file = row?.interface?.file ?? component.file;
  const name = row?.interface?.interface;
  return interfaces.find((entry) => entry.file === file && (!name || entry.interface === name))
    ?? interfaces.find((entry) => entry.file === component.file);
}

function axisValues(contract, axis) {
  const prop = contract?.props?.find((row) => row.name === axis);
  if (!prop || !['closed-union', 'closed-cva'].includes(prop.kind)) return [];
  return (prop.values ?? []).map((value) => String(value).replace(/^'|'$/g, ''));
}

// The component's own cva defaultVariants are what a screen gets when it passes nothing,
// so a variant sheet should hold those steady and change one axis at a time. Falling back
// to the contract's first value would show every card in a state no screen starts from.
function defaultVariants(component) {
  const source = join(WEBVIEW, component.file);
  if (!existsSync(source)) return {};
  const text = readFileSync(source, 'utf8');
  const start = text.indexOf('defaultVariants');
  if (start === -1) return {};
  const open = text.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (; end < text.length; end += 1) {
    if (text[end] === '{') depth += 1;
    else if (text[end] === '}') { depth -= 1; if (!depth) break; }
  }
  const body = text.slice(open + 1, end);
  const values = {};
  for (const [, key, value] of body.matchAll(/([A-Za-z0-9_]+)\s*:\s*'([^']*)'/g)) values[key] = value;
  return values;
}

const cases = [];
for (const component of COMPONENTS) {
  const contract = contractFor(component);
  const axes = component.axes.map((axis) => ({axis, values: axisValues(contract, axis)})).filter((row) => row.values.length);
  const booleans = component.booleans ?? [];
  const defaults = defaultVariants(component);
  const base = Object.fromEntries(axes.map((row) => [row.axis,
    row.values.includes(defaults[row.axis]) ? defaults[row.axis] : row.values[0]]));
  const variants = [];
  if (!axes.length) variants.push({label: '기본', props: {}});
  for (const {axis, values} of axes) {
    for (const value of values) {
      variants.push({label: `${axis}=${value}`, axis, props: {...base, [axis]: value}});
    }
  }
  for (const flag of booleans) variants.push({label: flag, axis: flag, props: {...base, [flag]: true}});
  for (const extra of component.extraCases ?? []) variants.push({label: extra.label, props: {...base, ...extra.props}});
  const seen = new Set();
  for (const variant of variants) {
    const key = JSON.stringify(variant.props);
    if (seen.has(key) && variant.label !== '기본') continue;
    seen.add(key);
    cases.push({component: component.name, fullWidth: Boolean(component.fullWidth), ...variant});
  }
}

// --- render with the real components ------------------------------------------------
const entryPath = join(WEBVIEW, '.design-pack-preview-entry.jsx');
const bundlePath = join(WEBVIEW, '.design-pack-preview-bundle.cjs');
const imports = COMPONENTS.map((component) => component.default
  ? `import ${component.name} from '${component.module}';`
  : `import { ${component.named} as ${component.name} } from '${component.module}';`).join('\n');

// Navigation components call useRouter/usePathname; without Next's client contexts they
// throw instead of rendering. A stub router keeps the markup real and the click inert.
const entry = `import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
${imports}

const registry = {${COMPONENTS.map((c) => c.name).join(', ')}};
const client = new QueryClient();
const router = {push(){}, replace(){}, back(){}, forward(){}, refresh(){}, prefetch(){}};
const wrap = (node) => (
  <QueryClientProvider client={client}>
    <AppRouterContext.Provider value={router}>
      <PathnameContext.Provider value="/preview">
        <SearchParamsContext.Provider value={new URLSearchParams()}>{node}</SearchParamsContext.Provider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>
  </QueryClientProvider>
);
const cases = ${JSON.stringify(cases)};
const fixed = ${JSON.stringify(Object.fromEntries(COMPONENTS.map((c) => [c.name, c.props ?? {}])))};
const children = ${JSON.stringify(Object.fromEntries(COMPONENTS.filter((c) => c.children).map((c) => [c.name, c.children])))};
const noop = () => {};
const out = [];
for (const row of cases) {
  const Component = registry[row.component];
  const props = {...fixed[row.component], ...row.props};
  for (const [key, value] of Object.entries(props)) if (value === '__noop__') props[key] = noop;
  const kid = children[row.component];
  try {
    const html = renderToStaticMarkup(wrap(kid ? <Component {...props}>{kid}</Component> : <Component {...props} />));
    out.push({...row, html});
  } catch (error) {
    out.push({...row, error: String(error && error.message ? error.message : error).slice(0, 200)});
  }
}
process.stdout.write(JSON.stringify(out));
`;
writeFileSync(entryPath, entry);

const {createRequire} = await import('node:module');
const requireFromApp = createRequire(join(WEBVIEW, 'noop.js'));
const esbuild = requireFromApp('esbuild');

// Next gives a static image import an object ({src, width, height}), and components read
// `.src` from it. Loading images as bare data-url strings makes `.src` undefined, which is
// how the Radio control rendered as nothing but its label.
const MEDIA_TYPES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml'};

function pngSize(bytes) {
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) return {};
  return {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)};
}

function staticImageModule(path) {
  const bytes = readFileSync(path);
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
  const dataUri = `data:${MEDIA_TYPES[extension] ?? 'application/octet-stream'};base64,${bytes.toString('base64')}`;
  const {width = 0, height = 0} = extension === '.png' ? pngSize(bytes) : {};
  return {loader: 'js', contents: `export default ${JSON.stringify({src: dataUri, width, height, blurDataURL: dataUri})};`};
}

// next.config.mjs runs @svgr/webpack only for src/libs/hds/base/icons/assets; every other
// SVG stays a URL. Mirroring that split is what keeps both icon components and
// background-image assets working.
const SVGR_PATH = /src\/libs\/hds\/base\/icons\/assets\/.*\.svg$/i;

const appAssets = {
  name: 'app-assets',
  setup(build) {
    build.onLoad({filter: /\.(png|jpe?g|webp|gif)$/}, (file) => staticImageModule(file.path));
    build.onLoad({filter: /\.svg$/}, (file) => {
      if (!SVGR_PATH.test(file.path)) return staticImageModule(file.path);
      const source = readFileSync(file.path, 'utf8');
      const dataUri = 'data:image/svg+xml;base64,' + Buffer.from(source, 'utf8').toString('base64');
      return {
        loader: 'jsx',
        contents: `import * as React from 'react';
const src = ${JSON.stringify(dataUri)};
export default function SvgAsset(props) { return React.createElement('img', {src, alt: '', ...props}); }
export { src };`,
      };
    });
  },
};

// next/image refuses data URIs without a loader, so the asset-backed cases would fail.
// The preview swaps it for a plain img; layout behaviour of next/image is not reproduced.
const nextImageStub = {
  name: 'next-image-stub',
  setup(build) {
    build.onResolve({filter: /^next\/image$/}, () => ({path: 'next-image-stub', namespace: 'stub'}));
    build.onLoad({filter: /.*/, namespace: 'stub'}, () => ({
      loader: 'jsx',
      contents: `import * as React from 'react';
export default function NextImageStub({src, alt = '', width, height, ...rest}) {
  const source = typeof src === 'object' && src ? src.src : src;
  return React.createElement('img', {src: source, alt, width, height, ...rest});
}`,
    }));
  },
};

await esbuild.build({
  entryPoints: [entryPath],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  absWorkingDir: WEBVIEW,
  alias: {'@': join(WEBVIEW, 'src')},
  external: ['react', 'react-dom'],
  plugins: [appAssets, nextImageStub],
  outfile: bundlePath,
  logLevel: 'error',
});
const rendered = JSON.parse(execFileSync(process.execPath, [bundlePath], {cwd: WEBVIEW, maxBuffer: 64 * 1024 * 1024}).toString());

// --- compile the app's own Tailwind for exactly these classes ------------------------
const out = resolve(args.out);
mkdirSync(out, {recursive: true});
const markupPath = join(WEBVIEW, '.design-pack-preview-markup.html');
writeFileSync(markupPath, rendered.map((row) => row.html ?? '').join('\n'));
const cssEntry = join(WEBVIEW, '.design-pack-preview-input.css');
writeFileSync(cssEntry, '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');
const cssPath = join(WEBVIEW, '.design-pack-preview-output.css');
execFileSync(join(WEBVIEW, 'node_modules/.bin/tailwindcss'),
  ['-c', join(WEBVIEW, 'tailwind.config.ts'), '-i', cssEntry, '-o', cssPath, '--content', markupPath],
  {cwd: WEBVIEW, stdio: ['ignore', 'ignore', 'pipe']});

// --- page ---------------------------------------------------------------------------
const css = readFileSync(cssPath, 'utf8');
const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const byComponent = new Map();
for (const row of rendered) {
  if (!byComponent.has(row.component)) byComponent.set(row.component, []);
  byComponent.get(row.component).push(row);
}

function snippet(component, props, children) {
  const attrs = Object.entries(props).map(([key, value]) =>
    value === true ? ` ${key}` : typeof value === 'string' && value !== '__noop__' ? ` ${key}="${value}"` : value === '__noop__' ? ` ${key}={handleClick}` : ` ${key}={${JSON.stringify(value)}}`).join('');
  return children ? `<${component}${attrs}>${children}</${component}>` : `<${component}${attrs} />`;
}

const sections = [...byComponent.entries()].map(([name, rows]) => {
  const component = COMPONENTS.find((row) => row.name === name);
  const source = join(WEBVIEW, component.file);
  const revision = existsSync(source) ? sha(readFileSync(source)) : '';
  const cards = rows.map((row, index) => {
    const id = `${name}-${index}`;
    const body = row.error
      ? `<div class="failed">렌더 실패 — ${esc(row.error)}</div>`
      : row.html;
    return `<figure class="case" id="${id}">
      <figcaption>${esc(row.label)}</figcaption>
      <div class="stage${row.fullWidth ? ' stage-full' : ''}">${body}</div>
      <details><summary>코드</summary><pre><code>${esc(snippet(name, {...(component.props ?? {}), ...row.props}, component.children))}</code></pre></details>
    </figure>`;
  }).join('\n');
  return `<section class="component" data-component="${esc(name)}">
    <header><h2>${esc(name)}</h2><span class="mono">${esc(component.file)}</span>
      <span class="mono rev">sha256:${esc(revision.slice(0, 12))}</span></header>
    <div class="cases">${cards}</div>
  </section>`;
}).join('\n');

const failures = rendered.filter((row) => row.error).length;
const page = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>HDS 컴포넌트 미리보기 — ${esc(pack.version)}</title>
<style>${css}</style>
<style>
:root{color-scheme:light;--ink:#17141f;--ink2:#55506a;--ink3:#8a849c;--line:#e2deea;--ground:#faf9fc;--card:#fff;--accent:#5b45d6}
body{margin:0;background:var(--ground);color:var(--ink);font:15px/1.7 "Pretendard","IBM Plex Sans KR",-apple-system,sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:36px 20px 96px}
h1{font-size:26px;margin:0 0 8px;letter-spacing:-.02em}
.lede{color:var(--ink2);margin:0 0 8px;max-width:70ch}
.meta{font:12.5px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink3);margin-bottom:28px}
.component{border:1px solid var(--line);border-radius:12px;background:var(--card);margin-bottom:22px;overflow:hidden}
.component header{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px;padding:14px 18px;border-bottom:1px solid var(--line);background:#f6f4fb}
.component h2{font-size:17px;margin:0}
.mono{font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink3)}
.cases{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:0}
.case{margin:0;padding:14px 16px;border-top:1px solid var(--line);border-right:1px solid var(--line);display:grid;gap:10px;align-content:start}
figcaption{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--accent)}
.stage{display:flex;align-items:center;justify-content:center;min-height:72px;padding:12px;background:#fff;border:1px dashed var(--line);border-radius:8px;overflow:auto}
.stage-full>*{width:390px;flex:0 0 390px}
.case:has(.stage-full){grid-column:1/-1}
details summary{cursor:pointer;font-size:12.5px;color:var(--ink2)}
pre{margin:8px 0 0;padding:10px 12px;background:#f6f4fb;border-radius:8px;overflow-x:auto;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}
.failed{color:#b42318;font-size:13px}
.note{border-left:3px solid var(--accent);background:#f1eefb;padding:14px 18px;border-radius:0 10px 10px 0;margin:0 0 26px;font-size:14px;color:var(--ink2)}
.note b{color:var(--ink)}
</style></head>
<body><div class="wrap">
<h1>HDS 컴포넌트 미리보기</h1>
<p class="lede">팩 <b>${esc(pack.version)}</b>이 쓸 수 있는 컴포넌트를 <b>실제 WebView 구현</b>으로 렌더한 것입니다. 변형 값은 팩의 닫힌 props 계약에서만 가져왔습니다.</p>
<p class="meta">heroines-webview ${esc(args.commit)} · 앱의 tailwind.config.ts로 컴파일 · 렌더 ${rendered.length - failures}/${rendered.length}건 성공 · 고정 값은 구현의 defaultVariants</p>
<div class="note"><b>next/image는 미리보기에서 평범한 img로 대체했습니다.</b> 최적화·레이아웃 동작은 재현되지 않습니다.<br><b>이 페이지는 제품 구현이고, 팩 검토 화면의 컴포넌트 그림은 엔진이 그리는 와이어프레임입니다.</b> 둘은 일부러 다릅니다 — 엔진은 계층과 토큰 없이 뼈대만 그립니다. 여기서 실제 모양과 변형을 확인한 뒤, 팩에 승격된 상태 축이 실제로 표현 가능한지 판단하세요.</div>
${sections}
</div></body></html>`;

writeFileSync(join(out, 'component-preview.html'), page);

// Sidecar for the pack review page: same rendered cases, as data the review renderer can
// embed. It carries its own provenance because it comes from source, not from the pack.
const sidecar = {
  schema: 'design-pack-survey.component-preview.v1',
  repo: 'heroines-webview',
  commit: args.commit,
  pack: pack.version,
  generatedAt: new Date().toISOString(),
  limitation: 'Rendered from the WebView implementation at this commit with the app Tailwind config. next/image is replaced by a plain img; layout behaviour of next/image is not reproduced.',
  css,
  components: Object.fromEntries([...byComponent.entries()].map(([name, rows]) => {
    const component = COMPONENTS.find((row) => row.name === name);
    const source = join(WEBVIEW, component.file);
    return [name, {
      sourceFile: component.file,
      sourceSha256: existsSync(source) ? sha(readFileSync(source)) : '',
      cases: rows.map((row) => ({
        label: row.label,
        fullWidth: Boolean(row.fullWidth),
        html: row.html ?? '',
        error: row.error ?? '',
        code: snippet(name, {...(component.props ?? {}), ...row.props}, component.children),
      })),
    }];
  })),
};
writeFileSync(join(out, 'component-preview.json'), JSON.stringify(sidecar, null, 2) + '\n');
for (const path of [entryPath, bundlePath, markupPath, cssEntry, cssPath]) rmSync(path, {force: true});
console.log(JSON.stringify({out: join(out, 'component-preview.html'), components: byComponent.size, cases: rendered.length, failures}));
