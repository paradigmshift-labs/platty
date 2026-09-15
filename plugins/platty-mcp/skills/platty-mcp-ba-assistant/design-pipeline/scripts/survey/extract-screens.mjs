#!/usr/bin/env node
// Design pack survey — L1 extraction for Next.js app-router screens.
// Parses source with the target repo's own TypeScript (never executes app code),
// follows static, re-export and dynamic imports from each route entry, and records
// per-screen facts: component usage, style classes, state signals, API/navigation, copy.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, relative, resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  for (const key of ['root', 'scope', 'out', 'node-modules', 'commit']) {
    if (!out[key]) throw new Error(`--${key} is required`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const ROOT = resolve(args.root);
const requireFromTarget = createRequire(join(resolve(args['node-modules']), 'noop.js'));
const ts = requireFromTarget('typescript');

const sha = (text) => createHash('sha256').update(text).digest('hex');
const rel = (p) => relative(ROOT, p).split('\\').join('/');

// ---------- tsconfig path aliases ----------
const tsconfig = ts.parseConfigFileTextToJson('tsconfig.json', readFileSync(join(ROOT, 'tsconfig.json'), 'utf8')).config;
const baseUrl = resolve(ROOT, tsconfig.compilerOptions.baseUrl || '.');
const aliases = Object.entries(tsconfig.compilerOptions.paths || {})
  .map(([pattern, targets]) => ({ prefix: pattern.replace(/\*$/, ''), target: targets[0].replace(/\*$/, '') }))
  .sort((a, b) => b.prefix.length - a.prefix.length);

const CODE_EXT = ['.tsx', '.ts', '.jsx', '.js'];
function resolveModule(spec, fromFile) {
  let base = null;
  if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else {
    const alias = aliases.find((a) => spec.startsWith(a.prefix));
    if (alias) base = resolve(baseUrl, alias.target + spec.slice(alias.prefix.length));
  }
  if (!base) return { external: spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0] };
  if (existsSync(base) && statSync(base).isFile()) {
    return CODE_EXT.includes(extname(base)) ? { file: base } : { asset: rel(base) };
  }
  for (const ext of CODE_EXT) if (existsSync(base + ext)) return { file: base + ext };
  for (const ext of CODE_EXT) if (existsSync(join(base, 'index' + ext))) return { file: join(base, 'index' + ext) };
  return { unresolved: spec };
}

// ---------- tailwind theme (config transpiled, evaluated with target node_modules) ----------
function loadTailwindTheme() {
  const path = join(ROOT, 'tailwind.config.ts');
  const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const module = { exports: {} };
  const localRequire = createRequire(path);
  new Function('module', 'exports', 'require', outputText)(module, module.exports, (id) => {
    try { return localRequire(id); } catch { return requireFromTarget(id); }
  });
  const config = module.exports.default || module.exports;
  const theme = config.theme || {};
  const extend = theme.extend || {};
  const flatten = (obj, prefix = '') => Object.entries(obj || {}).flatMap(([k, v]) => {
    const key = k === 'DEFAULT' ? prefix.replace(/-$/, '') : prefix + k;
    return v && typeof v === 'object' && !Array.isArray(v) ? flatten(v, key + '-') : [[key, v]];
  });
  const keys = (group) => Object.fromEntries([...flatten(theme[group]), ...flatten(extend[group])]);
  return {
    colors: keys('colors'),
    fontSize: keys('fontSize'),
    spacing: keys('spacing'),
    borderRadius: keys('borderRadius'),
    boxShadow: keys('boxShadow'),
    fontFamily: keys('fontFamily'),
    overridesColors: Boolean(theme.colors),
    sha256: sha(readFileSync(path, 'utf8')),
  };
}
const THEME = loadTailwindTheme();
const DEFAULT_PALETTE = new Set('slate gray zinc neutral stone red orange amber yellow lime green emerald teal cyan sky blue indigo violet purple fuchsia pink rose'.split(' '));
const COLOR_KEYWORDS = new Set(['black', 'white', 'transparent', 'current', 'inherit']);
const COLOR_PREFIX = /^(bg|text|border(?:-[trblxy])?|from|via|to|fill|stroke|ring|outline|divide|placeholder|decoration|caret|accent|shadow)-(.+)$/;
const SPACING_PREFIX = /^(p[trblxy]?|m[trblxy]?|gap(?:-[xy])?|space-[xy]|w|h|min-w|min-h|max-w|max-h|top|right|bottom|left|inset(?:-[xy])?|size|translate-[xy]|basis|indent|scroll-[mp][trblxy]?)-(.+)$/;
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;

function classifyClass(raw) {
  const cls = raw.split(':').pop().replace(/^!/, '').replace(/^-/, '');
  if (cls.includes('[')) {
    const hex = cls.match(HEX);
    if (hex) return { kind: 'arbitrary-color', value: hex[0].toLowerCase() };
    if (SPACING_PREFIX.test(cls.split('-[')[0] + '-x')) return { kind: 'arbitrary-spacing' };
    if (/^text-\[\d/.test(cls)) return { kind: 'arbitrary-font-size' };
    if (/^rounded/.test(cls)) return { kind: 'arbitrary-radius' };
    return { kind: 'arbitrary-other' };
  }
  const color = cls.match(COLOR_PREFIX);
  if (color) {
    const name = color[2].replace(/\/\d+$/, '');
    if (color[1] === 'text' && name in THEME.fontSize) return { kind: 'theme-font-size', value: name };
    if (color[1] === 'text' && /^(xs|sm|base|lg|[2-9]?xl)$/.test(name)) return { kind: 'default-font-size', value: name };
    if (name in THEME.colors) return { kind: 'theme-color', value: name };
    if (COLOR_KEYWORDS.has(name)) return { kind: 'keyword-color', value: name };
    if (DEFAULT_PALETTE.has(name.split('-')[0]) && /-\d{2,3}$/.test(name)) return { kind: 'default-palette-color', value: name };
  }
  const spacing = cls.match(SPACING_PREFIX);
  if (spacing) {
    if (spacing[2] in THEME.spacing) return { kind: 'theme-spacing', value: spacing[2] };
    if (/^(\d+(\.5)?|px|auto|full|screen|fit|min|max)$/.test(spacing[2]) || /^\d+\/\d+$/.test(spacing[2])) return { kind: 'default-spacing', value: spacing[2] };
  }
  if (/^rounded/.test(cls)) {
    const name = cls.replace(/^rounded-?([trblse]{1,2}-)?/, '') || 'DEFAULT';
    return { kind: name in THEME.borderRadius ? 'theme-radius' : 'default-radius', value: name };
  }
  if (/^shadow(-|$)/.test(cls)) return { kind: 'shadow', value: cls };
  if (/^font-/.test(cls)) return { kind: 'font', value: cls };
  return { kind: 'layout-or-other' };
}

// ---------- per-file facts ----------
const CLASS_HELPERS = new Set(['cn', 'clsx', 'classNames', 'twMerge', 'twJoin', 'cva', 'cx']);
const STATE_SIGNAL = /^(isLoading|isPending|isFetching|isError|isEmpty|isSuccess|error|Skeleton\w*|Spinner|Loading\w*|ErrorBoundary|\w*BottomSheet\w*|\w*Modal\w*|\w*Dialog\w*|\w*Toast\w*|\w*Snackbar\w*|Empty\w*|Suspense)$/;
const HANGUL = /[\uac00-\ud7a3]/;
const factCache = new Map();

function containsJsx(node) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) { found = true; return; }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function stringsIn(node) {
  const out = [];
  const visit = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) { out.push(n.head.text); n.templateSpans.forEach((s) => out.push(s.literal.text)); }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

function fileFacts(file) {
  if (factCache.has(file)) return factCache.get(file);
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const facts = {
    path: rel(file), sha256: sha(text), lines: text.split('\n').length,
    edges: [], externals: new Set(), assets: new Set(), unresolved: new Set(),
    importMap: new Map(), jsx: new Map(), localComponents: new Set(),
    classes: [], styleProps: 0, hex: [], hooks: new Map(), conditionalRenders: 0,
    stateSignals: new Set(), copy: new Set(), api: new Set(), navigation: new Set(), bridge: new Set(),
    methodCalls: new Set(),
  };
  const addEdge = (spec, kind) => {
    const r = resolveModule(spec, file);
    if (r.file) facts.edges.push({ file: r.file, kind });
    else if (r.external) facts.externals.add(r.external);
    else if (r.asset) facts.assets.add(r.asset);
    else facts.unresolved.add(spec);
    return r;
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      const r = addEdge(spec, node.importClause?.isTypeOnly ? 'type' : 'static');
      const clause = node.importClause;
      const target = r.file ? rel(r.file) : r.external ? `pkg:${r.external}` : spec;
      if (clause?.name) facts.importMap.set(clause.name.text, { module: target, name: 'default' });
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        clause.namedBindings.elements.forEach((el) => facts.importMap.set(el.name.text, { module: target, name: (el.propertyName || el.name).text }));
      }
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) facts.importMap.set(clause.namedBindings.name.text, { module: target, name: '*' });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      addEdge(node.moduleSpecifier.text, 'reexport');
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      addEdge(node.arguments[0].text, 'dynamic');
    } else if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name && ts.isIdentifier(node.name) && /^[A-Z]/.test(node.name.text)) {
      facts.localComponents.add(node.name.text);
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      facts.jsx.set(tag, (facts.jsx.get(tag) || 0) + 1);
    }
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(source);
      if (name === 'className') stringsIn(node.initializer).forEach((s) => facts.classes.push(...s.split(/\s+/).filter(Boolean)));
      if (name === 'style') facts.styleProps += 1;
      if (name === 'href') stringsIn(node.initializer).filter((s) => s.startsWith('/')).forEach((s) => facts.navigation.add(s));
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const calleeName = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
      if (ts.isIdentifier(callee) && CLASS_HELPERS.has(callee.text)) node.arguments.forEach((a) => stringsIn(a).forEach((s) => facts.classes.push(...s.split(/\s+/).filter(Boolean))));
      if (/^use[A-Z]/.test(calleeName)) facts.hooks.set(calleeName, (facts.hooks.get(calleeName) || 0) + 1);
      if (ts.isPropertyAccessExpression(callee) && /^(push|replace|prefetch)$/.test(calleeName) && /router/i.test(callee.expression.getText(source))) {
        stringsIn(node.arguments[0] || node).filter((s) => s.startsWith('/')).forEach((s) => facts.navigation.add(s));
      }
      if (/callHandler|postMessage|sendToNative|nativeBridge/i.test(callee.getText(source))) facts.bridge.add(callee.getText(source).slice(0, 80));
      if (ts.isPropertyAccessExpression(callee)) facts.methodCalls.add(calleeName);
    }
    if ((ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && containsJsx(node.right))
      || (ts.isConditionalExpression(node) && (containsJsx(node.whenTrue) || containsJsx(node.whenFalse)))) {
      facts.conditionalRenders += 1;
    }
    if (ts.isIdentifier(node) && STATE_SIGNAL.test(node.text)) facts.stateSignals.add(node.text);
    if (ts.isJsxText(node)) { const t = node.text.trim(); if (t && HANGUL.test(t)) facts.copy.add(t); }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)) {
      const t = node.text;
      if (HANGUL.test(t) && !ts.isImportDeclaration(node.parent)) facts.copy.add(t.trim());
      if (/(^|\/)api\/|^\/v\d\//.test(t)) facts.api.add(t);
      (t.match(HEX) || []).forEach((h) => facts.hex.push(h.toLowerCase()));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  factCache.set(file, facts);
  return facts;
}

// ---------- layers ----------
function layerOf(path) {
  if (path.startsWith('src/app/')) return 'route-entry';
  if (path.startsWith('src/page/')) return 'page-module';
  if (path.startsWith('src/libs/hds/')) return 'hds';
  if (path.startsWith('src/widgets/')) return 'widget';
  if (path.startsWith('src/features/')) return 'feature';
  if (path.startsWith('src/shared/')) return 'shared';
  if (path.startsWith('src/components/')) return 'component';
  if (path.startsWith('src/icon/')) return 'icon';
  if (path.startsWith('src/infra/')) return 'infra';
  if (path.startsWith('src/context/')) return 'context';
  if (path.startsWith('src/constants/')) return 'constants';
  if (path.startsWith('src/mocks/')) return 'mocks';
  if (path.startsWith('src/libs/')) return 'lib';
  return 'other';
}
const RENDER_LAYERS = new Set(['route-entry', 'page-module', 'widget', 'feature', 'shared', 'component', 'icon', 'other']);

// ---------- API index: repository classes own the endpoint strings ----------
function walkFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (CODE_EXT.includes(extname(full))) out.push(full);
  }
  return out;
}
function buildApiIndex() {
  const byMethod = new Map();
  const infraDir = join(ROOT, 'src/infra');
  if (!existsSync(infraDir)) return byMethod;
  for (const file of walkFiles(infraDir).filter((f) => /Repository\.tsx?$/.test(f))) {
    const text = readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visitClass = (node) => {
      if (ts.isClassDeclaration(node) && node.name) {
        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member) || !member.name) continue;
          const method = member.name.getText(source);
          const paths = new Set(); const verbs = new Set();
          const scan = (n) => {
            if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
              const verb = n.expression.name.text;
              if (/^(get|post|put|patch|delete)$/.test(verb) && /api|instance|http|client/i.test(n.expression.expression.getText(source))) verbs.add(verb.toUpperCase());
            }
            if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n)) {
              const t = n.text.replace(/\?.*$/, '');
              if (/^\/?(api\/)?v\d\//.test(t)) paths.add(t.replace(/^\//, ''));
            }
            ts.forEachChild(n, scan);
          };
          if (member.body) scan(member.body);
          if (!paths.size) continue;
          const rows = byMethod.get(method) || [];
          rows.push({ repository: node.name.text, file: rel(file), method, verbs: [...verbs].sort(), paths: [...paths].sort() });
          byMethod.set(method, rows);
        }
      }
      ts.forEachChild(node, visitClass);
    };
    visitClass(source);
  }
  return byMethod;
}
const API_INDEX = buildApiIndex();

// Hooks wrap repository methods; a screen's API surface is the hooks it calls,
// not everything a barrel import happens to pull in.
function buildHookIndex() {
  const byHook = new Map();
  const infraDir = join(ROOT, 'src/infra');
  if (!existsSync(infraDir)) return byHook;
  for (const file of walkFiles(infraDir)) {
    const text = readFileSync(file, 'utf8');
    if (!/\buse[A-Z]/.test(text)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const record = (name, body) => {
      if (!/^use[A-Z]/.test(name) || !body) return;
      const rows = [];
      const scan = (n) => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
          for (const row of API_INDEX.get(n.expression.name.text) || []) rows.push(row);
        }
        ts.forEachChild(n, scan);
      };
      scan(body);
      if (rows.length) byHook.set(name, [...new Map(rows.map((r) => [`${r.repository}.${r.method}`, { ...r, hook: name, hookFile: rel(file) }])).values()]);
    };
    const visit = (node) => {
      if (ts.isFunctionDeclaration(node) && node.name) record(node.name.text, node.body);
      if (ts.isVariableDeclaration(node) && node.name && ts.isIdentifier(node.name) && node.initializer
        && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) record(node.name.text, node.initializer.body);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return byHook;
}
const HOOK_INDEX = buildHookIndex();

const TYPE_ISH = /(Props|Types?|EventIds|Request|Response|Options|State|Store|Link|Schema|Params|Key)$/;
const STATE_BUCKETS = [
  ['loading', /^(isLoading|isPending|isFetching|Loading|LoadingIcon|Skeleton\w*|Spinner|Suspense)$/],
  ['error', /^(isError|error|isFail\w*|ErrorBoundary|ErrorComponent|ErrorFallback)$/],
  ['empty', /^(isEmpty|Empty\w*|NoData\w*|NoResult\w*)$/],
  ['overlay', /^(\w*BottomSheet|\w*Modal|\w*Dialog|\w*Popup|\w*Drawer)$/],
  ['feedback', /^(\w*Toast|\w*Snackbar|\w*Alert)$/],
];

// ---------- routes ----------
function findRoutes(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return findRoutes(full);
    return entry.name === 'page.tsx' ? [full] : [];
  });
}
const routeFiles = findRoutes(resolve(ROOT, args.scope)).sort();

const count = (items) => Object.entries(items.reduce((acc, k) => ((acc[k] = (acc[k] || 0) + 1), acc), {})).sort((a, b) => b[1] - a[1]);

// pass 1: reachability per route
const reachByRoute = routeFiles.map((entry) => {
  const seen = new Map();
  const queue = [{ file: entry, depth: 0, via: 'entry' }];
  while (queue.length) {
    const { file, depth, via } = queue.shift();
    if (seen.has(file)) continue;
    seen.set(file, { depth, via });
    for (const edge of fileFacts(file).edges) if (edge.kind !== 'type' && !seen.has(edge.file)) queue.push({ file: edge.file, depth: depth + 1, via: edge.kind });
  }
  return { entry, seen };
});

// A file reached by nearly every screen is shared infrastructure, not screen composition.
const COMMON_THRESHOLD = 0.8;
const reachCount = new Map();
for (const { seen } of reachByRoute) for (const file of seen.keys()) reachCount.set(file, (reachCount.get(file) || 0) + 1);
const commonFiles = new Set([...reachCount.entries()].filter(([, n]) => n >= routeFiles.length * COMMON_THRESHOLD).map(([f]) => f));

// pass 2: per-route facts
const routes = reachByRoute.map(({ entry, seen }) => {
  const routePath = '/' + rel(dirname(entry)).replace(/^src\/app\//, '').replace(/\[([^\]]+)\]/g, ':$1');
  const files = [...seen.entries()].map(([file, meta]) => ({ ...fileFacts(file), ...meta, layer: layerOf(rel(file)), common: commonFiles.has(file) }));
  const screenFiles = files.filter((f) => !f.common);
  const renderFiles = files.filter((f) => RENDER_LAYERS.has(f.layer));
  const pageModules = [...new Set(files.filter((f) => f.layer === 'page-module').map((f) => f.path.split('/').slice(0, 3).join('/')))];

  // component usages: JSX tags in rendering files, attributed through that file's import map
  const usage = new Map();
  for (const f of renderFiles) {
    for (const [tag, n] of f.jsx) {
      if (/^[a-z]/.test(tag)) continue;
      const root = tag.split('.')[0];
      const imp = f.importMap.get(root);
      let key; let layer; let module;
      if (imp) {
        module = imp.module;
        layer = module.startsWith('pkg:') ? 'external' : layerOf(module);
        key = `${module}#${imp.name === 'default' ? root : imp.name}${tag.includes('.') ? tag.slice(root.length) : ''}`;
      } else if (f.localComponents.has(root)) { layer = 'local'; module = f.path; key = `${f.path}#${tag}`; }
      else { layer = 'unresolved'; module = f.path; key = `?#${tag}`; }
      const row = usage.get(key) || { key, name: tag, module, layer, count: 0, usedIn: new Set(), shared: !module.startsWith('pkg:') && commonFiles.has(resolve(ROOT, module)) };
      row.count += n; row.usedIn.add(f.path); usage.set(key, row);
    }
  }
  // API: query/mutation hooks this screen calls, plus direct repository calls in its own files
  const apiCalls = new Map();
  const addApi = (row, where, via) => {
    const key = `${row.repository}.${row.method}`;
    const hit = apiCalls.get(key) || { repository: row.repository, method: row.method, verbs: row.verbs, paths: row.paths, via: new Set(), calledIn: new Set() };
    hit.via.add(via); hit.calledIn.add(where); apiCalls.set(key, hit);
  };
  for (const f of screenFiles.filter((x) => RENDER_LAYERS.has(x.layer) || x.layer === 'infra')) {
    const ownFile = f.layer === 'route-entry' || f.layer === 'page-module';
    for (const hook of f.hooks.keys()) for (const row of HOOK_INDEX.get(hook) || []) addApi(row, f.path, `hook:${hook}`);
    if (ownFile) for (const method of f.methodCalls) for (const row of API_INDEX.get(method) || []) addApi(row, f.path, 'direct');
  }
  const stateEvidence = Object.fromEntries(STATE_BUCKETS.map(([bucket]) => [bucket, new Set()]));
  for (const f of screenFiles.filter((x) => RENDER_LAYERS.has(x.layer))) {
    const names = [...f.stateSignals, ...[...f.jsx.keys()].filter((t) => /^[A-Z]/.test(t))];
    for (const name of names) {
      if (TYPE_ISH.test(name)) continue;
      for (const [bucket, pattern] of STATE_BUCKETS) if (pattern.test(name)) stateEvidence[bucket].add(name);
    }
  }
  const classes = renderFiles.flatMap((f) => f.classes);
  const classified = classes.map(classifyClass);
  const byKind = count(classified.map((c) => c.kind));
  const tally = (kind) => count(classified.filter((c) => c.kind === kind).map((c) => c.value));
  const ownFiles = files.filter((f) => f.layer === 'route-entry' || f.layer === 'page-module');
  const hooks = new Map();
  renderFiles.forEach((f) => f.hooks.forEach((n, h) => hooks.set(h, (hooks.get(h) || 0) + n)));

  return {
    routePath,
    entry: rel(entry),
    dynamicParams: [...routePath.matchAll(/:([^/]+)/g)].map((m) => m[1]),
    pageModules,
    files: {
      reachable: files.length,
      screenSpecific: screenFiles.length,
      sharedInfrastructure: files.length - screenFiles.length,
      byLayer: Object.fromEntries(count(files.map((f) => f.layer))),
      ownedLines: ownFiles.reduce((s, f) => s + f.lines, 0),
      owned: ownFiles.map((f) => ({ path: f.path, sha256: f.sha256, lines: f.lines })),
    },
    components: [...usage.values()]
      .map((u) => ({ ...u, usedIn: [...u.usedIn].sort() }))
      .sort((a, b) => b.count - a.count),
    styles: {
      classCount: classes.length,
      byKind: Object.fromEntries(byKind),
      themeColors: tally('theme-color'),
      defaultPaletteColors: tally('default-palette-color'),
      arbitraryColors: tally('arbitrary-color'),
      themeFontSizes: tally('theme-font-size'),
      styleProps: renderFiles.reduce((s, f) => s + f.styleProps, 0),
      hexLiterals: count(renderFiles.flatMap((f) => f.hex)),
    },
    states: {
      hooks: Object.fromEntries([...hooks.entries()].sort((a, b) => b[1] - a[1])),
      conditionalRenders: renderFiles.reduce((s, f) => s + f.conditionalRenders, 0),
      buckets: Object.fromEntries(STATE_BUCKETS.map(([bucket]) => [bucket, [...stateEvidence[bucket]].sort()])),
    },
    api: [...apiCalls.values()].map((a) => ({ ...a, via: [...a.via].sort(), calledIn: [...a.calledIn].sort() })).sort((a, b) => (a.repository + a.method).localeCompare(b.repository + b.method)),
    navigation: [...new Set(renderFiles.flatMap((f) => [...f.navigation]))].sort(),
    bridge: [...new Set(files.flatMap((f) => [...f.bridge]))].sort(),
    copy: {
      owned: [...new Set(ownFiles.flatMap((f) => [...f.copy]))],
      reachableCount: new Set(renderFiles.flatMap((f) => [...f.copy])).size,
    },
    externals: [...new Set(files.flatMap((f) => [...f.externals]))].sort(),
    unresolvedImports: [...new Set(files.flatMap((f) => [...f.unresolved].map((u) => `${f.path} -> ${u}`)))].sort(),
  };
});

// ---------- component catalog across the scope ----------
const catalog = new Map();
for (const route of routes) {
  for (const c of route.components) {
    const row = catalog.get(c.key) || { key: c.key, name: c.name, module: c.module, layer: c.layer, totalCount: 0, routes: [] };
    row.totalCount += c.count; row.routes.push(route.routePath); catalog.set(c.key, row);
  }
}

const out = resolve(args.out);
mkdirSync(out, { recursive: true });
const meta = {
  schema: 'design-pack-survey.screens.v1',
  repo: 'heroines-webview',
  commit: args.commit,
  scope: args.scope,
  generatedAt: new Date().toISOString(),
  typescript: ts.version,
  tailwindConfigSha256: THEME.sha256,
  themeColorCount: Object.keys(THEME.colors).length,
  method: 'Static TypeScript AST; static+re-export+dynamic imports followed from each app-router page.tsx; type-only imports skipped; app code is not executed. JSX usage is counted in rendering layers (route-entry, page-module, widget, feature, shared, component, other); usage inside src/libs/hds internals is excluded from screen composition.',
  limitations: [
    'Reachable is not rendered: a component imported on a path is counted even if a runtime branch never shows it.',
    'Class strings built from variables or props outside className literals and cn/clsx/cva/twMerge arguments are not seen.',
    'Copy includes developer-facing Korean strings (logs, analytics labels) when they are string literals.',
    'Components passed as props or rendered through maps of component references are attributed only where written as JSX.',
  ],
};
writeFileSync(join(out, 'screens.json'), JSON.stringify({ meta, routes }, null, 2) + '\n');
writeFileSync(join(out, 'components.json'), JSON.stringify({ meta, components: [...catalog.values()].map((r) => ({ ...r, routeCount: new Set(r.routes).size, routes: [...new Set(r.routes)].sort() })).sort((a, b) => b.routeCount - a.routeCount || b.totalCount - a.totalCount) }, null, 2) + '\n');
writeFileSync(join(out, 'theme.json'), JSON.stringify({ meta: { sha256: THEME.sha256 }, colors: THEME.colors, fontSize: THEME.fontSize, spacing: THEME.spacing, borderRadius: THEME.borderRadius, boxShadow: THEME.boxShadow, fontFamily: THEME.fontFamily }, null, 2) + '\n');
console.log(JSON.stringify({ routes: routes.length, components: catalog.size, filesParsed: factCache.size, out }));
