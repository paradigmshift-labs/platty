import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {captureLayout} from '../src/layout-snapshot.mjs';

const PAGE = `<!doctype html><html><body style="margin:0">
<section data-node-id="list" role="region" aria-label="목록" style="padding:16px">
  <p data-node-id="title" style="margin:0;height:24px">보상 내역</p>
  <button data-node-id="row-action" type="button" style="display:block;height:40px">첫째</button>
  <button data-node-id="row-action" type="button" disabled style="display:block;height:40px">둘째</button>
  <label><input data-node-id="agree" type="checkbox" checked> <span>동의합니다</span></label>
  <ul data-node-id="rows"><li data-node-id="row">첫 행<span data-node-id="row-label">A</span></li><li data-node-id="row">둘째 행<span data-node-id="row-label">B</span></li></ul>
  <p data-node-id="hidden-note" style="display:none">숨김</p>
</section>
<div style="height:1200px"></div>
<p data-node-id="footer">끝</p>
</body></html>`;

async function snapshot() {
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}});
    await page.setContent(PAGE);
    return await captureLayout(page);
  } finally {
    await browser.close();
  }
}

test('layout snapshot records every data-node-id with its box, parent, text, and state', async () => {
  const layout = await snapshot();
  assert.equal(layout.schemaVersion, 1);
  assert.equal(layout.viewport.width, 390);
  const byId = (id) => layout.nodes.filter((row) => row.nodeId === id);

  const [title] = byId('title');
  assert.equal(title.parentNodeId, 'list');
  assert.equal(title.text, '보상 내역');
  assert.equal(title.box.x, 16);
  assert.equal(title.box.y, 16);
  assert.equal(title.box.height, 24);
  assert.equal(title.visible, true);

  const [list] = byId('list');
  assert.equal(list.parentNodeId, null);
  assert.equal(list.role, 'region');
});

test('repeated nodes keep their order and their own state', async () => {
  const layout = await snapshot();
  const rows = layout.nodes.filter((row) => row.nodeId === 'row-action');
  assert.deepEqual(rows.map((row) => row.occurrence), [0, 1]);
  assert.deepEqual(rows.map((row) => row.text), ['첫째', '둘째']);
  assert.deepEqual(rows.map((row) => row.state.disabled), [false, true]);
  assert.ok(rows[1].box.y > rows[0].box.y);
  const [agree] = layout.nodes.filter((row) => row.nodeId === 'agree');
  assert.equal(agree.state.checked, true);
  assert.equal(agree.label, '동의합니다');
});

test('a child of a repeated item names which occurrence it belongs to', async () => {
  const layout = await snapshot();
  const labels = layout.nodes.filter((row) => row.nodeId === 'row-label');
  assert.deepEqual(labels.map((row) => [row.text, row.parentNodeId, row.parentOccurrence]),
    [['A', 'row', 0], ['B', 'row', 1]]);
});

test('a container carries only its own text, not its children', async () => {
  const layout = await snapshot();
  const [list] = layout.nodes.filter((row) => row.nodeId === 'list');
  assert.equal(list.text, '');
  assert.equal(list.label, '목록');
  const rows = layout.nodes.filter((row) => row.nodeId === 'row');
  assert.deepEqual(rows.map((row) => row.text), ['첫 행', '둘째 행']);
});

test('each node carries the computed style the capture shows', async () => {
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}});
    await page.setContent(`<button data-node-id="more" style="font-size:14px;font-weight:600;color:rgb(74,74,74);
      background:rgb(255,255,255);border:1px solid rgb(233,233,233);border-bottom:none;border-radius:8px;text-align:center">더 보기</button>`);
    const [more] = (await captureLayout(page)).nodes;
    assert.equal(more.style.fontSize, 14);
    assert.equal(more.style.fontWeight, 600);
    assert.equal(more.style.color, 'rgb(74, 74, 74)');
    assert.equal(more.style.backgroundColor, 'rgb(255, 255, 255)');
    assert.equal(more.style.borderRadius, 8);
    assert.equal(more.style.textAlign, 'center');
    assert.deepEqual(more.style.border.top, {width: 1, color: 'rgb(233, 233, 233)'});
    assert.equal(more.style.border.bottom.width, 0);
  } finally {
    await browser.close();
  }
});

test('elements without a node id are kept as decorations of their nearest node', async () => {
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}});
    await page.setContent(`<body style="margin:0"><h1 class="title" style="margin:0;font-size:24px">적립금 내역</h1>
      <section data-node-id="balance" aria-label="잔액"><p class="bal-label" style="margin:0">지금까지 모인 적립금</p>
      <p class="bal-value" style="margin:0"><b>3,200</b>원</p><div class="plain"><span></span></div>
      <span class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgb(200,200,200)"></span></section></body>`);
    const layout = await captureLayout(page);
    const byClass = Object.fromEntries(layout.decorations.map((row) => [row.className || row.tag, row]));
    assert.equal(byClass.title.parentNodeId, null);
    assert.equal(byClass.title.text, '적립금 내역');
    assert.equal(byClass.title.style.fontSize, 24);
    assert.equal(byClass['bal-label'].parentNodeId, 'balance');
    assert.equal(byClass.b.text, '3,200');
    const won = byClass['bal-value'].textRuns[0];
    assert.equal(won.text, '원');
    assert.ok(won.box.x > byClass.b.box.x, 'the run sits after the number, not at the paragraph origin');
    assert.equal(byClass.spinner.style.border.top.width, 2);
    assert.equal(byClass.plain, undefined, 'an element with no text, fill, or border adds nothing');
    const [balance] = layout.nodes;
    assert.equal(balance.text, '');
  } finally {
    await browser.close();
  }
});

test('hidden nodes are kept but marked invisible, and page coordinates include scroll', async () => {
  const layout = await snapshot();
  const [hidden] = layout.nodes.filter((row) => row.nodeId === 'hidden-note');
  assert.equal(hidden.visible, false);
  const [footer] = layout.nodes.filter((row) => row.nodeId === 'footer');
  assert.ok(footer.box.y > 1200, `footer y ${footer.box.y} should be a page coordinate`);
  assert.ok(layout.viewport.scrollHeight > 1200);
});
