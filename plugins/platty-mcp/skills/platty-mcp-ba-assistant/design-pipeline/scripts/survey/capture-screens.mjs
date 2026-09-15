#!/usr/bin/env node
// Design pack survey — runtime capture feasibility for one scope of screens.
// Loads each route in a phone viewport against the app's msw mock mode, records what
// actually rendered (or why it did not), and writes content-addressed screenshots.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, a) => (i % 2 ? acc : [...acc, [v.replace(/^--/, ''), a[i + 1]]]), []));
for (const key of ['facts', 'base-url', 'out', 'node-modules']) if (!args[key]) throw new Error(`--${key} is required`);

const { chromium } = createRequire(join(resolve(args['node-modules']), 'noop.js'))('playwright');
const facts = JSON.parse(readFileSync(join(args.facts, 'screens.json'), 'utf8'));
const out = resolve(args.out);
mkdirSync(join(out, 'images'), { recursive: true });

// Dynamic segments need a value to load at all; a placeholder is honest about being one.
const SAMPLE = { productId: '1', orderId: '1', orderNumber: '1', goodId: '1', orderGoodId: '1', categoryId: '1', curationId: '1', diaryId: '1' };
const fill = (routePath) => routePath.replace(/:([^/]+)/g, (_, name) => SAMPLE[name] ?? '1');

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
});

const results = [];
for (const route of facts.routes) {
  const url = new URL(fill(route.routePath), args['base-url']).toString();
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('requestfailed', (r) => failedRequests.push(`${r.method()} ${r.url().slice(0, 120)}`));
  const row = { routePath: route.routePath, url, status: null, ok: false };
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    row.status = response?.status() ?? null;
    await page.waitForTimeout(4000);
    const probe = await page.evaluate(() => {
      const body = document.body;
      const text = (body?.innerText || '').trim();
      const visible = [...document.querySelectorAll('body *')].filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 2 && rect.height > 2;
      }).length;
      return {
        textLength: text.length,
        textSample: text.slice(0, 160),
        visibleElements: visible,
        hasNextError: Boolean(document.querySelector('nextjs-portal')),
        mswReady: window.__mswReady ?? null,
      };
    });
    Object.assign(row, probe);
    const buffer = await page.screenshot({ fullPage: true });
    const digest = createHash('sha256').update(buffer).digest('hex');
    const file = join(out, 'images', `${digest}.png`);
    writeFileSync(file, buffer);
    row.screenshot = `images/${digest}.png`;
    row.bytes = buffer.length;
    row.ok = !probe.hasNextError && probe.textLength > 0;
    row.renderVerdict = probe.hasNextError ? 'build-or-runtime-error'
      : probe.textLength === 0 ? 'blank'
      : /로그인|인증|unauthorized/i.test(probe.textSample) ? 'auth-wall'
      : /오류|실패|error/i.test(probe.textSample) ? 'error-state'
      : /로딩|loading/i.test(probe.textSample) ? 'loading-state'
      : 'rendered';
  } catch (error) {
    row.error = String(error).slice(0, 300);
    row.renderVerdict = 'navigation-failed';
  }
  row.consoleErrors = consoleErrors.slice(0, 5);
  row.failedRequests = failedRequests.slice(0, 5);
  results.push(row);
  console.log(`${row.renderVerdict.padEnd(22)} ${route.routePath}`);
  await page.close();
}
await browser.close();

const manifest = {
  schema: 'design-pack-survey.capture.v1',
  commit: facts.meta.commit,
  scope: facts.meta.scope,
  baseUrl: args['base-url'],
  viewport: '390x844 @2x, iPhone UA, ko-KR',
  mode: 'next dev with NEXT_PUBLIC_API_MOCKING=msw; no credentials supplied',
  capturedAt: new Date().toISOString(),
  limitations: [
    'Dynamic route segments use placeholder ids, so detail screens show not-found or error states rather than real records.',
    'msw handlers cover only a few endpoints today; unhandled calls reach no backend, so most screens capture loading or error states.',
    'No authenticated session and no native bridge, so screens gated on either cannot reach their signed-in state.',
    'One capture per route (default state only). State coverage requires fixtures per state.',
  ],
  verdictCounts: results.reduce((acc, r) => ({ ...acc, [r.renderVerdict]: (acc[r.renderVerdict] || 0) + 1 }), {}),
  results,
};
writeFileSync(join(out, 'capture-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest.verdictCounts));
