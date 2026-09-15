#!/usr/bin/env node
// Audit a rendered pack review page.
//
// A review page fails quietly: a control whose asset did not load still occupies a box,
// a swatch with an unparsed color still paints white. This opens the page in a browser
// and reports what actually rendered, so a reviewer is not the one discovering it.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, a) => (i % 2 ? acc : [...acc, [v.replace(/^--/, ''), a[i + 1]]]), []));
if (!args.page) throw new Error('--page is required');

// playwright is this package's own dependency; a machine without a browser should say so
// rather than fail the build that called it.
let chromium;
try {
  ({ chromium } = createRequire(args['node-modules']
    ? resolve(args['node-modules'], 'noop.js')
    : import.meta.url)('playwright'));
} catch (error) {
  console.log(JSON.stringify({ skipped: 'playwright unavailable', detail: String(error).slice(0, 120) }));
  process.exit(0);
}

let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  console.log(JSON.stringify({ skipped: 'browser unavailable', detail: String(error).slice(0, 160) }));
  process.exit(0);
}
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 1 });
const consoleErrors = [];
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 160)); });
await page.goto('file://' + resolve(args.page));
await page.waitForTimeout(1200);
// force every lazy frame and image to settle
await page.evaluate(async () => {
  window.scrollTo(0, document.body.scrollHeight);
  await new Promise((done) => setTimeout(done, 600));
  window.scrollTo(0, 0);
});
await page.waitForTimeout(1200);

const report = await page.evaluate(() => {
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 1 && rect.height > 1 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const brokenAsset = (el) => {
    const style = getComputedStyle(el);
    const image = style.backgroundImage || '';
    return image.includes('undefined') || image.includes('[object') || image.includes('function');
  };

  const findings = [];

  // 1. product implementation frames
  const frames = [...document.querySelectorAll('iframe.impl-frame')];
  const framesReport = frames.map((frame) => {
    const head = frame.closest('.impl')?.querySelector('.impl-head')?.textContent?.trim() ?? '';
    const doc = frame.contentDocument;
    if (!doc) return { head, error: 'no document' };
    const figures = [...doc.querySelectorAll('figure')];
    const cases = figures.map((figure) => {
      const label = figure.querySelector('figcaption')?.textContent ?? '';
      const stage = figure.querySelector('.stage');
      const root = stage?.firstElementChild;
      const rect = root?.getBoundingClientRect();
      const controls = root ? [...root.querySelectorAll('input, button, [role]')] : [];
      const invisibleControls = controls.filter((el) => !(el.getBoundingClientRect().width > 1 && el.getBoundingClientRect().height > 1)
        && getComputedStyle(el).position !== 'absolute');
      const broken = root ? [root, ...root.querySelectorAll('*')].filter(brokenAsset).length : 0;
      const images = root ? [...root.querySelectorAll('img')] : [];
      const brokenImages = images.filter((img) => !img.complete || img.naturalWidth === 0).length;
      const text = (root?.textContent ?? '').trim();
      return {
        label,
        width: rect ? Math.round(rect.width) : 0,
        height: rect ? Math.round(rect.height) : 0,
        controls: controls.length,
        invisibleControls: invisibleControls.length,
        brokenBackgrounds: broken,
        brokenImages,
        empty: !root || (!text && !images.length && !controls.length),
      };
    });
    return { head, cases };
  });

  for (const frame of framesReport) {
    for (const row of frame.cases ?? []) {
      const problems = [];
      if (row.empty) problems.push('빈 렌더');
      if (row.invisibleControls) problems.push(`보이지 않는 컨트롤 ${row.invisibleControls}`);
      if (row.brokenBackgrounds) problems.push(`깨진 background ${row.brokenBackgrounds}`);
      if (row.brokenImages) problems.push(`깨진 이미지 ${row.brokenImages}`);
      if (row.width < 4 || row.height < 4) problems.push(`크기 ${row.width}x${row.height}`);
      if (problems.length) findings.push({ area: '제품 구현', where: `${frame.head} · ${row.label}`, problems });
    }
    if (frame.error) findings.push({ area: '제품 구현', where: frame.head, problems: [frame.error] });
  }

  // 2. engine wireframe demos
  for (const demo of document.querySelectorAll('.demo')) {
    const root = demo.querySelector('main')?.firstElementChild;
    const name = demo.closest('.row')?.querySelector('.name')?.textContent ?? '';
    const label = demo.closest('.state')?.querySelector('.lbl')?.textContent ?? '';
    if (!root || !visible(root)) findings.push({ area: '엔진 그림', where: `${name} · ${label}`, problems: ['그려지지 않음'] });
  }

  // 3. reference screenshots
  const shots = [...document.querySelectorAll('.shots img')];
  const brokenShots = shots.filter((img) => !img.complete || img.naturalWidth === 0);
  if (brokenShots.length) findings.push({ area: '참조 화면', where: `${brokenShots.length}/${shots.length}`, problems: ['이미지 로드 실패'] });

  // 4. token swatches
  const swatchProblems = [];
  for (const swatch of document.querySelectorAll('[class*="swatch"], .chip-color, .tok-color')) {
    // the grid that holds the chips carries the same word in its class; only leaves paint
    if (swatch.childElementCount) continue;
    const style = getComputedStyle(swatch);
    // A translucent token is drawn over a checkerboard, so "no background colour" is only a
    // fault when there is no background image either.
    const painted = (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)')
      || (style.backgroundImage && style.backgroundImage !== 'none');
    if (!painted) swatchProblems.push(swatch.className);
  }
  if (swatchProblems.length) findings.push({ area: '토큰', where: `${swatchProblems.length}개`, problems: ['배경색 없음'] });

  // 5. placeholder text that leaked into the page
  const body = document.body.innerText;
  for (const needle of ['undefined', 'NaN', '[object Object]', 'None', 'null']) {
    const count = body.split(needle).length - 1;
    if (count) findings.push({ area: '텍스트', where: needle, problems: [`${count}회 노출`] });
  }

  return {
    frames: framesReport.length,
    cases: framesReport.reduce((sum, frame) => sum + (frame.cases?.length ?? 0), 0),
    demos: document.querySelectorAll('.demo').length,
    shots: shots.length,
    findings,
  };
});

await browser.close();
report.consoleErrors = consoleErrors.slice(0, 5);
console.log(JSON.stringify(report, null, 1));
