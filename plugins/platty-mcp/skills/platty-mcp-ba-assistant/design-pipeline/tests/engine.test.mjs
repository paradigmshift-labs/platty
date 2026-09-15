import assert from 'node:assert/strict';
import {cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import nodeTest from 'node:test';
import {chromium} from 'playwright';

import {
  loadKnowledgePack,
  prepareRun,
  validateSpec,
  runRuntime,
  freezeRun,
  gateRun,
  retryRun
} from '../src/engine.mjs';

const packageRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(import.meta.dirname, '../../..');
// The pack these tests read is private and not in the repository. BA_TEST_PACK_ROOT lets a
// machine point at one; tests/fixtures/build-fixture-pack.mjs writes a synthetic one.
const packRoot = resolve(process.env.BA_TEST_PACK_ROOT ?? join(repoRoot, 'design-knowledge'));
const fixtureMissing = existsSync(join(packRoot, 'heroines/2026-09-09/pack.json'))
  ? null
  : `fixture pack missing at ${packRoot}/heroines/2026-09-09 — run: node tests/fixtures/build-fixture-pack.mjs`;
// Skipping with the reason beats 40 identical ENOENT failures that hide what is wrong.
const test = (name, fn) => nodeTest(name, fixtureMissing ? {skip: fixtureMissing} : {}, fn);

function packet() {
  return {
    schema_version: 1,
    source: {
      path: '/case/screen-behavior.json',
      case_id: 'synthetic-screen',
      project_id: 'platty-synthetic',
      observed_revision: 'rev-screen-1',
      content_hash: 'a'.repeat(64),
      review_hash: 'b'.repeat(64),
      confirmation_turn_id: 'turn-123',
      input_hashes: {planning_context: 'p1', user_experience: 'u1'},
      knowledge_binding: {pack_id: 'heroines', version: '2026-09-09'}
    },
    knowledge_binding: {pack_id: 'heroines', version: '2026-09-09'},
    targets: [{
      target_id: 'screen',
      screen_id: 'screen',
      task: 'Wireframe 합성 선택 화면',
      purpose: '선택과 저장 상태를 확인한다.',
      audience: ['member'],
      nodes: [
        {element_id: 'root', parent_id: null, name: 'Root', semantic_type: 'region', purpose: 'screen root', information_refs: [], action_refs: [], repetition: 'none', source_ids: ['U1'], decision_ids: []},
        {element_id: 'bank', parent_id: 'root', name: '은행', semantic_type: 'select', purpose: '은행 선택', information_refs: [], action_refs: [], repetition: 'none', source_ids: ['U1'], decision_ids: []},
        {element_id: 'agree', parent_id: 'root', name: '동의', semantic_type: 'checkbox', purpose: '약관 동의', information_refs: [], action_refs: [], repetition: 'none', source_ids: ['U1'], decision_ids: []},
        {element_id: 'owner', parent_id: 'root', name: '예금주', semantic_type: 'input', purpose: '예금주 입력', information_refs: [], action_refs: [], repetition: 'none', source_ids: ['U1'], decision_ids: []},
        {element_id: 'submit', parent_id: 'root', name: '저장', semantic_type: 'button', purpose: '저장 실행', information_refs: [], action_refs: ['toggle'], repetition: 'none', source_ids: ['U1'], decision_ids: []},
        {element_id: 'details', parent_id: 'root', name: '상세', semantic_type: 'disclosure', purpose: '상세 안내', information_refs: [], action_refs: [], repetition: 'none', source_ids: ['U1'], decision_ids: []},
        {element_id: 'status', parent_id: 'root', name: '상태', semantic_type: 'status', purpose: '결과 피드백', information_refs: [], action_refs: [], repetition: 'none', source_ids: ['U1'], decision_ids: []}
      ],
      states: [
        {render_case_id: 'before', title: '입력 전', scenario_ids: ['save-flow'], sample_items: [], sample_groups: [], state_assignments: [], visible_information: ['은행', '예금주'], available_actions: ['은행 선택', '동의 체크', '저장'], blocked_actions_with_reasons: [], focus_expectation: '예금주 입력', equivalence_rationale: '기본 입력 상태'},
        {render_case_id: 'after', title: '저장 중', scenario_ids: ['save-flow'], sample_items: [], sample_groups: [], state_assignments: [], visible_information: ['저장 중'], available_actions: [], blocked_actions_with_reasons: ['저장 중 중복 제출 불가'], focus_expectation: '상태 메시지', equivalence_rationale: '비동기 저장 상태'}
      ],
      flows: [{
        transition_id: 'toggle',
        target_scope_ids: ['submit'],
        target_selector: {kind: 'element', symbol: 'submit', rule_id: ''},
        event: 'save',
        preconditions: ['은행과 예금주 입력'],
        before: [],
        after: [],
        observable_result: '저장 중 상태 표시',
        allowed_actions: ['click', 'select', 'check', 'keyboard'],
        preserved_values: [
          {scope_id: 'bank', item_ref: null, axis_id: 'selection', dimension: 'value_selection', value_id: 'selected'},
          {scope_id: 'owner', item_ref: null, axis_id: 'value', dimension: 'value', value_id: 'filled'}
        ],
        feedback: '저장 중입니다',
        focus_result: '상태 메시지',
        parent_transition_refs: [],
        scenario_ids: ['save-flow'],
        source_ids: ['U1'],
        decision_ids: [],
        interaction_contract: {origin: 'user_action', action: 'click', subject_scope_id: 'submit', item_ref: null, source: 'target_selector:element'}
      }],
      constraints: [{constraint_id: 'no-busy-enabled', scope_ids: ['submit'], condition: '저장 중에는 버튼을 다시 누를 수 없다.', required_outcome: 'busy와 disabled가 함께 표시된다.', forbidden_combinations: [], rationale: '중복 제출 방지', source_ids: ['U1'], decision_ids: []}],
      interaction_rules: [{rule_id: 'save-rule', kind: 'async_state', input_scope_ids: ['submit'], output_scope_ids: ['status'], condition_rows: [{id: 'save-start', when: [], effects: [], transition_ids: ['toggle'], scenario_ids: ['save-flow']}], source_ids: ['U1'], decision_ids: []}],
      inventory_links: [],
      design_handoffs: [{handoff_id: 'handoff', element_ids: ['bank', 'agree', 'owner', 'submit', 'details', 'status'], semantic_pattern: '계좌 저장 폼', required_state_refs: ['selection', 'checked', 'value', 'availability', 'busy', 'disclosure', 'visibility'], render_case_ids: ['before', 'after'], interaction_refs: ['toggle'], accessibility_expectations: ['저장 중 상태 메시지를 role=status로 제공한다.', '입력 보존과 포커스 결과를 확인한다.'], candidate_design_system_ref: 'role:account', mapping_status: 'mapped', gap: '', owner: 'synthetic designer'}],
      traceability: {source_ids: ['U1'], decision_ids: []}
    }],
    cross_screen_links: [],
    inventory_links: [],
    coverage_manifest: {screens: ['screen'], elements: ['root', 'bank', 'agree', 'owner', 'submit', 'details', 'status'], render_cases: ['before', 'after'], transitions: ['toggle'], flow_transitions: ['toggle'], cross_screen_links: [], design_handoffs: ['handoff'], source_ids: ['U1'], decision_ids: []}
  };
}

function authoredSpec() {
  const ref = (...segments) => segments.join('.');
  return {
    schema_version: 1,
    target_id: 'screen',
    roleBinding: {ref: 'role:account', type: 'account'},
    renderer: {entry: 'renderer/index.html', viewportMatrix: [{name: 'mobile', width: 390, height: 844}]},
    nodes: {
      root: {selector: '[data-node-id="root"]', component: 'Surface', role: 'region', knowledgeBinding: {ref: 'component:Surface'}},
      bank: {selector: '[data-node-id="bank"]', component: 'Select', role: 'select', knowledgeBinding: {ref: 'component:Select'}},
      agree: {selector: '[data-node-id="agree"]', component: 'Checkbox', role: 'checkbox', hdsInterface: {file: 'src/libs/hds/base/controls/checkbox/Checkbox.tsx', interface: 'CheckboxProps'}, props: {size: 'medium', variant: 'selection', checkboxStyle: 'square', checked: false}},
      owner: {selector: '[data-node-id="owner"]', component: 'Text Field', role: 'textbox', knowledgeBinding: {ref: 'component:Text Field'}},
      submit: {selector: '[data-node-id="submit"]', component: 'Button', role: 'button', hdsInterface: {file: 'src/libs/hds/base/button/Button.types.ts', interface: 'ButtonProps'}, props: {size: 'm', variant: 'solid', color: 'primary', loading: false}},
      details: {selector: '[data-node-id="details"]', component: 'Disclosure', role: 'button', knowledgeBinding: {ref: 'component:Disclosure'}},
      status: {selector: '[data-node-id="status"]', component: 'Status Message', role: 'status', knowledgeBinding: {ref: 'component:Status Message'}}
    },
    semanticTokens: [
      {token: ref('color', 'semantic', 'primaryStrong'), appliedTo: ['submit']},
      {token: ref('layout', 'space', 'margin', 'standard'), appliedTo: ['root']}
    ],
    stateAssertions: {
      before: {
        root: {visible: true},
        bank: {visible: true, selected: false, value: ''},
        agree: {visible: true, checked: false},
        owner: {visible: true, readonly: false, disabled: false, invalid: false, focus: true, value: ''},
        submit: {visible: true, disabled: false, busy: false},
        details: {visible: true, expanded: false},
        status: {visible: false}
      },
      after: {
        root: {visible: true},
        bank: {visible: true, selected: true, value: '국민은행'},
        agree: {visible: true, checked: true},
        owner: {visible: true, readonly: true, disabled: false, invalid: false, value: '김민지'},
        submit: {visible: true, disabled: true, busy: true},
        details: {visible: true, expanded: true},
        status: {visible: true, focus: true, value: '저장 중입니다'}
      }
    },
    transitionAssertions: {
      toggle: {
        transitionId: 'toggle',
        scenarioId: 'save-flow',
        renderCaseId: 'after',
        resultantStateId: 'after',
        interaction_contract: {origin: 'user_action', action: 'click', subject_scope_id: 'submit', item_ref: null, source: 'target_selector:element'}
      }
    },
    scenarios: [{
      id: 'before-state',
      renderCaseId: 'before',
      steps: [],
      preserve: []
    }, {
      id: 'save-flow',
      renderCaseId: 'after',
      steps: [
        {action: 'select', selector: '[data-node-id="bank"]', value: '국민은행'},
        {action: 'check', selector: '[data-node-id="agree"]'},
        {action: 'fill', selector: '[data-node-id="owner"]', value: '김민지'},
        {action: 'keyboard', key: 'Tab'},
        {action: 'click', selector: '[data-node-id="submit"]', transitionId: 'toggle'},
        {action: 'async', adapter: 'window.__wireframeAsyncSave'},
        {action: 'external-state', adapter: 'window.__wireframeExternalState', value: 'brandpay:pending'}
      ],
      preserve: [
        {selector: '[data-node-id="bank"]', property: 'value'},
        {selector: '[data-node-id="owner"]', property: 'value'}
      ]
    }]
  };
}


function listReferencePacket() {
  const p = packet();
  p.targets[0].task = 'List reference screen';
  p.targets[0].purpose = 'Browse saved items in a reusable list pattern.';
  p.targets[0].design_handoffs[0].semantic_pattern = 'list';
  p.targets[0].design_handoffs[0].candidate_design_system_ref = 'role:list';
  return p;
}

function prepareListReferenceRun() {
  const outputRoot = mkdtempSync(join(tmpdir(), 'ba-wireframe-root-'));
  const prepared = prepareRun(listReferencePacket(), {packRoot, outputRoot});
  writeRenderer(prepared.runDir);
  return prepared;
}

function readSelectedReferences(runDir) {
  return JSON.parse(readFileSync(join(runDir, 'selected-references.json'), 'utf8'));
}

function maliciousPacket() {
  const maliciousId = 'root" onclick="window.__attrXss=1';
  const p = packet();
  p.targets[0] = {
    ...p.targets[0],
    nodes: [{element_id: maliciousId, parent_id: null, name: '<img src=x onerror="window.__textXss=1">', semantic_type: 'region" onmouseover="window.__roleXss=1', purpose: 'Unsafe payload', information_refs: [], action_refs: [], repetition: 'none', source_ids: ['U1'], decision_ids: []}],
    states: [{render_case_id: 'default', title: 'Default', scenario_ids: [], sample_items: [], sample_groups: [], state_assignments: [], visible_information: [], available_actions: [], blocked_actions_with_reasons: [], focus_expectation: '', equivalence_rationale: 'Default'}],
    flows: [],
    constraints: [],
    interaction_rules: [],
    design_handoffs: [{handoff_id: 'handoff', element_ids: [maliciousId], semantic_pattern: 'Unsafe payload', required_state_refs: [], render_case_ids: ['default'], interaction_refs: [], accessibility_expectations: [], candidate_design_system_ref: 'role:account', mapping_status: 'mapped', gap: '', owner: 'test'}],
    traceability: {source_ids: ['U1'], decision_ids: []}
  };
  p.coverage_manifest = {screens: ['screen'], elements: [maliciousId], render_cases: ['default'], transitions: [], flow_transitions: [], cross_screen_links: [], design_handoffs: ['handoff'], source_ids: ['U1'], decision_ids: []};
  return p;
}

function writeDesignDecisions(runDir, overrides = {}) {
  const meta = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  const decisions = {
    target_id: meta.packet.targets[0].target_id,
    input_hash: meta.packet.source.content_hash,
    knowledge_hash: meta.knowledge.hash,
    stages: {
      roles: {status: 'verified', rationale: 'Role binding follows the packet handoff role.', evidence: ['runtime-playwright']},
      reference_transfer: {status: 'verified', rationale: 'Reference transfer is represented in current captures.', evidence: ['captures/before-mobile.png']},
      hierarchy: {status: 'verified', rationale: 'Hierarchy is verified against the rendered state.', evidence: ['runtime-playwright']},
      layout: {status: 'verified', rationale: 'Layout is visible in the current capture set.', evidence: ['captures/before-mobile.png']},
      components: {status: 'verified', rationale: 'Component contract is exercised by the transition.', evidence: ['transition:toggle:save-flow:after']},
      tokens: {status: 'verified', rationale: 'Token usage is visible in rendered browser output.', evidence: ['captures/after-mobile.png']}
    },
    ...overrides
  };
  writeFileSync(join(runDir, 'design-decisions.json'), JSON.stringify(decisions, null, 2));
  return decisions;
}

function writeAIReview(runDir, overrides = {}) {
  const meta = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  const runtime = JSON.parse(readFileSync(join(runDir, 'runtime.json'), 'utf8'));
  const validation = JSON.parse(readFileSync(join(runDir, 'spec-validation.json'), 'utf8'));
  const specArtifact = existsSync(join(runDir, 'design-spec.json')) ? 'design-spec.json' : 'design-spec.template.json';
  const capturePaths = runtime.captures.map((capture) => capture.path);
  const captureHashes = Object.fromEntries(runtime.captures.map((capture) => [capture.path, capture.imageHash]));
  const criteria = Object.fromEntries(['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'].map((id) => [id, {observation: `${id} reviewed against current captures`, evidence: [capturePaths[0]]}]));
  const selectedPath = join(runDir, 'selected-references.json');
  const selectedReferences = existsSync(selectedPath) ? JSON.parse(readFileSync(selectedPath, 'utf8')).references ?? [] : [];
  const viewedReferences = selectedReferences.map((reference) => ({
    id: reference.id,
    path: reference.path,
    hash: reference.hash,
    observations: [`Reviewed ${reference.id}`],
    transferredFeatures: ['applicable layout rhythm'],
    excludedFeatures: ['source-specific content']
  }));
  const review = {
    verdict: 'accept_ai',
    input_hash: meta.packet.source.content_hash,
    knowledge_hash: meta.knowledge.hash,
    spec_hash: sha256(join(runDir, specArtifact)),
    renderer_hash: sha256(join(runDir, validation.renderer.entry)),
    capture_hashes: captureHashes,
    viewedImages: capturePaths,
    viewed_captures: runtime.captures.map((capture) => ({path: capture.path, hash: capture.imageHash, observations: [`Reviewed ${capture.renderCaseId}`]})),
    viewed_references: viewedReferences,
    axes: ['information hierarchy', 'composition', 'density', 'spacing', 'typography', 'color', 'state distinction', 'accessibility'],
    criteria,
    findings: [],
    ...overrides
  };
  writeFileSync(join(runDir, 'ai-review.json'), JSON.stringify(review, null, 2));
  return review;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function writeUnsafeFreeze(runDir) {
  const artifacts = {};
  for (const name of ['packet.json', 'spec-validation.json', 'runtime.json', 'design-spec.json', 'traceability.json']) {
    artifacts[name] = {sha256: sha256(join(runDir, name))};
  }
  const runtime = JSON.parse(readFileSync(join(runDir, 'runtime.json'), 'utf8'));
  for (const capture of runtime.captures ?? []) artifacts[capture.path] = {sha256: sha256(join(runDir, capture.path))};
  writeFileSync(join(runDir, 'freeze.json'), JSON.stringify({frozenAt: new Date().toISOString(), artifacts}, null, 2));
}

function writeRenderer(runDir) {
  execFileSync('mkdir', ['-p', join(runDir, 'renderer')]);
  writeFileSync(join(runDir, 'design-spec.json'), JSON.stringify(authoredSpec(), null, 2));
  writeFileSync(join(runDir, 'traceability.json'), JSON.stringify({target_id: 'screen', covered: {nodes: ['root', 'bank', 'agree', 'owner', 'submit', 'details', 'status'], render_cases: ['before', 'after'], flows: ['toggle'], design_handoffs: ['handoff']}}, null, 2));
  writeFileSync(join(runDir, 'renderer/index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="./style.css"></head><body><main data-node-id="root" role="region" aria-label="계좌 저장"><label>은행<select data-node-id="bank"><option value="">선택</option><option>국민은행</option></select></label><label><input data-node-id="agree" type="checkbox"> 동의</label><input data-node-id="owner" aria-invalid="false" placeholder="예금주" autofocus><button data-node-id="details" aria-expanded="false">상세</button><button data-node-id="submit">저장</button><p data-node-id="status" role="status" aria-live="polite" hidden></p></main><script src="./app.js"></script></body></html>`);
  writeFileSync(join(runDir, 'renderer/style.css'), `:root{--hds-primary:#7256e9;--hds-margin:16px}main{margin:var(--hds-margin);display:grid;gap:16px}button{background:var(--hds-primary);min-height:44px}`);
  writeFileSync(join(runDir, 'renderer/app.js'), `window.__wireframeAsyncSave=async()=>{const status=document.querySelector('[data-node-id="status"]');const submit=document.querySelector('[data-node-id="submit"]');const owner=document.querySelector('[data-node-id="owner"]');const details=document.querySelector('[data-node-id="details"]');owner.readOnly=true;submit.disabled=true;submit.setAttribute('aria-busy','true');details.setAttribute('aria-expanded','true');status.hidden=false;status.textContent='저장 중입니다';status.tabIndex=-1;status.focus();};window.__wireframeExternalState=(value)=>{window.__lastExternalState=value};`);
}

function uniqueCaptureRepresentatives(runtime) {
  const byHash = new Map();
  for (const capture of runtime.captures ?? []) {
    if (!byHash.has(capture.imageHash)) byHash.set(capture.imageHash, capture);
  }
  return [...byHash.values()];
}

function writeVisualAliases(runDir, runtime) {
  const representatives = uniqueCaptureRepresentatives(runtime);
  const groups = representatives.map((representative) => ({
    imageHash: representative.imageHash,
    representativePath: representative.path,
    representativeId: `${representative.renderCaseId}-${representative.viewport}`,
    members: runtime.captures
      .filter((capture) => capture.imageHash === representative.imageHash)
      .map((capture) => ({
        path: capture.path,
        id: `${capture.renderCaseId}-${capture.viewport}`,
        renderCaseId: capture.renderCaseId,
        viewport: capture.viewport
      }))
      .sort((a, b) => a.path.localeCompare(b.path))
  })).sort((a, b) => a.representativePath.localeCompare(b.representativePath));
  writeFileSync(join(runDir, 'visual-aliases.json'), JSON.stringify({
    schema_version: 1,
    alias_basis: 'exact_image_sha256',
    runtime_capture_count: runtime.captures.length,
    unique_image_count: groups.length,
    groups,
    coverage: groups.flatMap((group) => group.members.map((member) => ({
      path: member.path,
      id: member.id,
      renderCaseId: member.renderCaseId,
      viewport: member.viewport,
      imageHash: group.imageHash,
      representativePath: group.representativePath,
      representativeId: group.representativeId
    }))).sort((a, b) => a.path.localeCompare(b.path))
  }, null, 2));
}

function authoredSpecWithDuplicateViewport() {
  const spec = authoredSpec();
  spec.renderer.viewportMatrix = [
    {name: 'mobile', width: 390, height: 844},
    {name: 'mobile-copy', width: 390, height: 844}
  ];
  return spec;
}

function prepareAuthoredRun(options = {}) {
  const outputRoot = mkdtempSync(join(tmpdir(), 'ba-wireframe-root-'));
  const prepared = prepareRun(packet(), {packRoot, outputRoot, ...options});
  writeRenderer(prepared.runDir);
  return prepared;
}

test('knowledge pack is comprehensive and provenance-bound', () => {
  const pack = loadKnowledgePack(packRoot, 'heroines/2026-09-09');

  assert.equal(pack.version, 'heroines/2026-09-09');
  assert.ok(pack.upstreamManifest.sources.every((source) => /^[a-f0-9]{64}$/.test(source.sha256)));
  assert.ok(Object.keys(pack.tokens.color.semantic).length >= 10);
  assert.ok(pack.componentContracts.components.length >= 1);
  assert.ok(pack.componentStateMap.length >= 7);
  assert.equal(pack.roles.length, 23);
  assert.equal(pack.recipeRules.length, 10);
  assert.ok(pack.principles.principles.length >= 1);
  assert.equal(pack.usability.length, 10);
  assert.ok(pack.references.every((reference) => reference.localPath && existsSync(resolve(packRoot, 'heroines/2026-09-09', reference.localPath))));
  assert.equal(pack.experiments, undefined);
  assert.equal(pack.galleries, undefined);
  assert.equal(pack.components, undefined);
  assert.equal(pack.semantic, undefined);
  assert.equal(pack.tokens.semantic, undefined);
  assert.ok(pack.componentKnowledge.every((row) => row.sourcePath && /^[a-f0-9]{64}$/.test(row.revision) && /^[a-f0-9]{64}$/.test(row.hash) && row.authority && row.limitation && row.origin));
  assert.ok(pack.componentKnowledge.some((row) => row.origin === 'ba-authored-adapter'));
  assert.ok(pack.componentKnowledge.some((row) => row.origin === 'upstream-derived-contract'));
});

test('prepare draws text and icon nodes as their own elements', () => {
  // Screens are mostly text and icons; without their own node kinds the wireframe
  // either loses them or dresses them up as regions, and a reviewer cannot tell
  // a heading apart from a container.
  const input = packet();
  const target = input.targets[0];
  target.nodes.push(
    {element_id: 'headline', parent_id: 'root', name: '계좌를 등록해주세요', semantic_type: 'text', purpose: '화면 제목', information_refs: [], action_refs: [], repetition: 'none', source_ids: ['U1'], decision_ids: []},
    {element_id: 'back-icon', parent_id: 'root', name: '뒤로가기', semantic_type: 'icon', purpose: '이전 화면으로', information_refs: [], action_refs: [], repetition: 'none', source_ids: ['U1'], decision_ids: []}
  );
  target.design_handoffs[0].element_ids.push('headline', 'back-icon');

  const prepared = prepareRun(input, {packRoot, outputRoot: mkdtempSync(join(tmpdir(), 'ba-node-roles-'))});
  const html = readFileSync(join(prepared.runDir, 'renderer/index.html'), 'utf8');

  assert.match(html, /<p data-node-id="headline" class="wireframe-text">계좌를 등록해주세요<\/p>/);
  assert.match(html, /<span data-node-id="back-icon" class="wireframe-icon" role="img" aria-label="뒤로가기" title="뒤로가기"><\/span>/);

  const spec = JSON.parse(readFileSync(join(prepared.runDir, 'design-spec.template.json'), 'utf8'));
  assert.equal(spec.nodes.headline.role, 'text');
  assert.equal(spec.nodes.headline.component, 'Text');
  assert.equal(spec.nodes['back-icon'].role, 'icon');
  assert.equal(spec.nodes['back-icon'].component, 'Icon');
});

test('prepare draws radio and switch nodes as themselves', () => {
  // Drawn as a checkbox, a radio tells the reviewer the wrong thing about the choice:
  // one of many versus one on its own. The design system has both, so the engine needs both.
  const input = packet();
  const target = input.targets[0];
  target.nodes.push(
    {element_id: 'pay-card', parent_id: 'root', name: '신용카드', semantic_type: 'radio', purpose: '결제 수단 선택', information_refs: [], action_refs: [], repetition: 'none', source_ids: ['U1'], decision_ids: []},
    {element_id: 'notify', parent_id: 'root', name: '알림 받기', semantic_type: 'switch', purpose: '알림 설정', information_refs: [], action_refs: [], repetition: 'none', source_ids: ['U1'], decision_ids: []}
  );
  target.design_handoffs[0].element_ids.push('pay-card', 'notify');

  const prepared = prepareRun(input, {packRoot, outputRoot: mkdtempSync(join(tmpdir(), 'ba-control-roles-'))});
  const html = readFileSync(join(prepared.runDir, 'renderer/index.html'), 'utf8');

  assert.match(html, /<input data-node-id="pay-card" type="radio" name="root"/);
  assert.match(html, /<button data-node-id="notify" type="button" role="switch" aria-checked="false">알림 받기<\/button>/);

  const spec = JSON.parse(readFileSync(join(prepared.runDir, 'design-spec.template.json'), 'utf8'));
  assert.equal(spec.nodes['pay-card'].role, 'radio');
  assert.equal(spec.nodes.notify.role, 'switch');
});

test('prepare accepts only adapter packet targets and rejects empty undercovered input', () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'ba-wireframe-root-'));
  const prepared = prepareRun(packet(), {packRoot, outputRoot});

  assert.ok(prepared.runId);
  assert.ok(prepared.runDir.startsWith(outputRoot));
  assert.equal(prepared.packet.targets[0].nodes.length, 7);
  assert.ok(existsSync(join(prepared.runDir, 'design-spec.template.json')));
  assert.ok(existsSync(join(prepared.runDir, 'renderer/index.html')));
  assert.equal(JSON.parse(readFileSync(join(prepared.runDir, 'packet.json'), 'utf8')).source.content_hash, 'a'.repeat(64));

  assert.throws(() => prepareRun({...packet(), targets: []}, {packRoot, outputRoot: mkdtempSync(join(tmpdir(), 'ba-wireframe-root-'))}), /at least one target/);
  const undercovered = packet();
  undercovered.targets[0].design_handoffs[0].render_case_ids = ['before'];
  assert.throws(() => prepareRun(undercovered, {packRoot, outputRoot: mkdtempSync(join(tmpdir(), 'ba-wireframe-root-'))}), /handoff render case coverage/);
  assert.throws(() => prepareRun({caseRef: 'legacy'}, {packRoot, outputRoot: mkdtempSync(join(tmpdir(), 'ba-wireframe-root-'))}), /wireframe_adapter packet/);
});




test('prepare excludes references without reference-specific grounding evidence', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'ba-pack-root-'));
  cpSync(resolve(packRoot, 'heroines'), join(tempRoot, 'heroines'), {recursive: true});
  const packPath = join(tempRoot, 'heroines/2026-09-09/pack.json');
  const pack = JSON.parse(readFileSync(packPath, 'utf8'));
  const referencePath = pack.references[0].localPath;
  const referenceHash = pack.references[0].sha256;
  pack.references = [{
    id: 'account-grounded',
    role: 'account 환급 계좌 은행 예금주 저장',
    localPath: referencePath,
    sha256: referenceHash,
    authority: 'test high-confidence frame',
    limitation: 'Contains account role evidence for bank, holder, and save flow.'
  }, {
    id: 'unrelated-notification',
    role: 'notification toast banner',
    localPath: referencePath,
    sha256: referenceHash,
    authority: 'test high-confidence frame',
    limitation: 'Unrelated notification reference.'
  }, {
    id: 'unrelated-cart',
    role: 'cart order item quantity',
    localPath: referencePath,
    sha256: referenceHash,
    authority: 'test high-confidence frame',
    limitation: 'Unrelated cart reference.'
  }];
  writeFileSync(packPath, JSON.stringify(pack, null, 2));

  const outputRoot = mkdtempSync(join(tmpdir(), 'ba-wireframe-root-'));
  const prepared = prepareRun(packet(), {packRoot: tempRoot, outputRoot});
  const selected = readSelectedReferences(prepared.runDir);

  assert.deepEqual(selected.references.map((reference) => reference.id), ['account-grounded']);
  assert.match(selected.references[0].selectionRationale, /role exact|role evidence|semantic evidence|target evidence/);

  pack.references = pack.references.filter((reference) => reference.id !== 'account-grounded');
  writeFileSync(packPath, JSON.stringify(pack, null, 2));
  const noMatch = prepareRun(packet(), {packRoot: tempRoot, outputRoot: mkdtempSync(join(tmpdir(), 'ba-wireframe-root-'))});
  const gap = readSelectedReferences(noMatch.runDir);
  assert.deepEqual(gap.references, []);
  assert.match(gap.referenceGap, /No grounded reference/);
});

test('prepare writes target-specific selected references with stable local evidence', () => {
  const {runDir} = prepareListReferenceRun();
  const selected = readSelectedReferences(runDir);

  assert.equal(selected.target_id, 'screen');
  assert.ok(selected.references.length > 0);
  assert.ok(selected.references.length <= 3);
  for (const reference of selected.references) {
    assert.ok(reference.id);
    assert.ok(reference.path.startsWith('references/'));
    assert.match(reference.hash, /^[a-f0-9]{64}$/);
    assert.ok(reference.roleEvidence.length > 0);
    assert.ok(reference.limitation);
    assert.ok(reference.selectionRationale);
    assert.equal(existsSync(resolve(packRoot, 'heroines/2026-09-09', reference.path)), true);
  }
});

test('prepare selects an explicitly bound existing-screen reference before lexical matches', () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'ba-wireframe-root-'));
  const p = packet();
  const referenceId = 'qO7H6YMiVXzaFY5nmv10Ck:1326:12244';
  p.targets[0].design_handoffs[0].candidate_design_system_ref = `reference:${referenceId}`;

  const prepared = prepareRun(p, {packRoot, outputRoot});
  const selected = JSON.parse(readFileSync(join(prepared.runDir, 'selected-references.json'), 'utf8'));

  assert.equal(selected.referenceGap, '');
  assert.equal(selected.references[0].id, referenceId);
  assert.ok(selected.references[0].selectionRationale.includes('explicit baseline reference'));
});

test('prepare leaves a reference gap when an explicit existing-screen reference is unknown', () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'ba-wireframe-root-'));
  const p = packet();
  p.targets[0].design_handoffs[0].candidate_design_system_ref = 'reference:missing-screen';

  const prepared = prepareRun(p, {packRoot, outputRoot});
  const selected = JSON.parse(readFileSync(join(prepared.runDir, 'selected-references.json'), 'utf8'));

  assert.deepEqual(selected.references, []);
  assert.match(selected.referenceGap, /No grounded reference/);
});

test('template renderer escapes node-derived text and attributes', async () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'ba-wireframe-root-'));
  const prepared = prepareRun(maliciousPacket(), {packRoot, outputRoot});
  const html = readFileSync(join(prepared.runDir, 'renderer/index.html'), 'utf8');

  assert.equal(html.includes('<img src=x'), false);
  assert.ok(html.includes('&lt;img src=x onerror=&quot;window.__textXss=1&quot;&gt;'));
  assert.ok(html.includes('data-node-id="root&quot; onclick=&quot;window.__attrXss=1"'));
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    assert.equal(await page.locator('img').count(), 0);
    assert.equal(await page.locator('section').first().getAttribute('onclick'), null);
    assert.equal(await page.locator('section').first().getAttribute('onmouseover'), null);
    assert.equal(await page.evaluate(() => window.__textXss ?? null), null);
  } finally {
    await browser.close();
  }
});

test('template renderer exposes semantic native controls without transition test controls', async () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'ba-wireframe-root-'));
  const prepared = prepareRun(packet(), {packRoot, outputRoot});
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(join(prepared.runDir, 'renderer/index.html')).href);
    await page.locator('select[data-node-id="bank"]').selectOption({label: '은행 선택'});
    await page.locator('input[type="checkbox"][data-node-id="agree"]').check();
    await page.locator('input[data-node-id="owner"]').fill('김민지');
    await page.locator('button[data-node-id="submit"]').click();

    assert.equal(await page.locator('select[data-node-id="bank"]').inputValue(), '은행 선택');
    assert.equal(await page.locator('input[type="checkbox"][data-node-id="agree"]').isChecked(), true);
    assert.equal(await page.locator('input[data-node-id="owner"]').inputValue(), '김민지');
    assert.equal(await page.locator('button[data-node-id="details"][aria-expanded]').count(), 1);
    assert.equal(await page.locator('[data-node-id="status"][role="status"][aria-live]').count(), 1);
    assert.equal(await page.locator('[data-wireframe-test-control], [data-test-control], button[data-transition-id]').count(), 0);
    assert.equal((await page.locator('main').innerText()).includes('toggle'), false);
    assert.equal((await page.locator('main').innerText()).includes('save-flow'), false);
  } finally {
    await browser.close();
  }
});

test('spec validates authored design spec, traceability, renderer containment, components, tokens, and pack hash', () => {
  const {runDir} = prepareAuthoredRun();
  const spec = validateSpec(runDir);

  assert.equal(spec.valid, true);
  assert.equal(spec.packet.source.content_hash, 'a'.repeat(64));
  assert.equal(spec.knowledge.hash, loadKnowledgePack(packRoot, 'heroines/2026-09-09').hash);
  assert.deepEqual(spec.traceability.missing, []);
  assert.deepEqual(spec.traceability.extra, []);
  assert.ok(spec.componentMappings.every((row) => row.supported === true));
  assert.ok(spec.tokenMappings.every((row) => row.supported === true));
  assert.ok(spec.componentMappings.some((row) => row.interface === 'ButtonProps'));
  assert.ok(spec.componentMappings.some((row) => row.knowledgeRef === 'component:Text Field'));

  const escaped = prepareAuthoredRun();
  const bad = authoredSpec();
  bad.renderer.entry = '../outside.html';
  writeFileSync(join(escaped.runDir, 'design-spec.json'), JSON.stringify(bad));
  assert.throws(() => validateSpec(escaped.runDir), /renderer entry outside run directory/);
});

test('spec rejects unknown component, interface, props, state axis, role, and knowledge refs', () => {
  const cases = [
    ['unknown component', (spec) => { spec.nodes.submit.component = 'Mystery'; }, /unknown component/],
    ['unknown interface', (spec) => { spec.nodes.submit.hdsInterface.interface = 'MissingProps'; }, /unknown interface/],
    ['unknown prop', (spec) => { spec.nodes.submit.props.notAProp = true; }, /unknown prop/],
    ['unsupported prop value', (spec) => { spec.nodes.submit.props.size = 'giant'; }, /unsupported prop value/],
    ['unsupported state', (spec) => { spec.stateAssertions.before.submit.readonly = false; }, /unsupported state/],
    ['unknown node role', (spec) => { spec.nodes.owner.role = 'space-cadet'; }, /unknown role/],
    ['unknown role binding', (spec) => { spec.roleBinding = {ref: 'role:ghost', type: 'ghost'}; }, /unknown role ref/],
    ['unknown knowledge ref', (spec) => { spec.nodes.owner.knowledgeBinding.ref = 'component:Ghost'; }, /unknown knowledge ref/]
  ];
  for (const [name, mutate, pattern] of cases) {
    const {runDir} = prepareAuthoredRun();
    const spec = authoredSpec();
    mutate(spec);
    writeFileSync(join(runDir, 'design-spec.json'), JSON.stringify(spec, null, 2));
    assert.throws(() => validateSpec(runDir), pattern, name);
  }
});

test('spec rejects actual node and render-case contract drift even when traceability claims coverage', () => {
  const cases = [
    ['missing spec node', (spec) => { delete spec.nodes.status; }, /spec nodes missing status/],
    ['extra spec node', (spec) => { spec.nodes.ghost = {selector: '[data-node-id="ghost"]', component: 'Surface', role: 'region', knowledgeBinding: {ref: 'component:Surface'}}; }, /spec nodes extra ghost/],
    ['missing state assertion render case', (spec) => { delete spec.stateAssertions.before; }, /stateAssertions missing before/],
    ['extra state assertion render case', (spec) => { spec.stateAssertions.ghost = {}; }, /stateAssertions extra ghost/],
    ['missing state assertion node', (spec) => { delete spec.stateAssertions.after.status; }, /stateAssertions.after missing status/],
    ['extra state assertion node', (spec) => { spec.stateAssertions.after.ghost = {visible: true}; }, /stateAssertions.after extra ghost/],
    ['missing scenario render case', (spec) => { spec.scenarios = spec.scenarios.filter((row) => row.renderCaseId !== 'before'); }, /scenarios missing before/],
    ['extra scenario render case', (spec) => { spec.scenarios.push({id: 'ghost', renderCaseId: 'ghost', steps: []}); }, /scenarios extra ghost/]
  ];
  for (const [name, mutate, pattern] of cases) {
    const {runDir} = prepareAuthoredRun();
    const spec = authoredSpec();
    mutate(spec);
    writeFileSync(join(runDir, 'design-spec.json'), JSON.stringify(spec, null, 2));
    assert.throws(() => validateSpec(runDir), pattern, name);
  }
});


test('spec requires exact packet flow transition assertions and executable scenario steps', () => {
  const cases = [
    ['missing transition assertion', (spec) => { delete spec.transitionAssertions.toggle; }, /transitionAssertions missing toggle/],
    ['unknown transition assertion', (spec) => { spec.transitionAssertions.ghost = {transitionId: 'ghost', scenarioId: 'save-flow', renderCaseId: 'after', resultantStateId: 'after'}; }, /transitionAssertions extra ghost/],
    ['mismatched transition assertion key', (spec) => { spec.transitionAssertions.toggle.transitionId = 'ghost'; }, /toggle: transitionId must match assertion key/],
    ['unknown transition scenario', (spec) => { spec.transitionAssertions.toggle.scenarioId = 'ghost'; }, /toggle: scenario missing ghost/],
    ['empty scenario cannot cover flow', (spec) => { spec.transitionAssertions.toggle.scenarioId = 'before-state'; }, /toggle: scenario before-state has no executable steps/],
    ['missing step transitionId', (spec) => { delete spec.scenarios.find((row) => row.id === 'save-flow').steps.find((step) => step.action === 'click').transitionId; }, /toggle: scenario save-flow must contain exactly one step/],
    ['duplicate step transitionId', (spec) => { spec.scenarios.find((row) => row.id === 'save-flow').steps.push({action: 'keyboard', key: 'Enter', transitionId: 'toggle'}); }, /toggle: scenario save-flow must contain exactly one step/],
    ['unknown step transitionId', (spec) => { spec.scenarios.find((row) => row.id === 'save-flow').steps[0].transitionId = 'ghost'; }, /unknown step transitionId ghost/]
  ];
  for (const [name, mutate, pattern] of cases) {
    const {runDir} = prepareAuthoredRun();
    const spec = authoredSpec();
    mutate(spec);
    writeFileSync(join(runDir, 'design-spec.json'), JSON.stringify(spec, null, 2));
    assert.throws(() => validateSpec(runDir), pattern, name);
  }
});

test('spec rejects external-state as the transition-driving step when user actions are available', () => {
  const {runDir} = prepareAuthoredRun();
  const spec = authoredSpec();
  const saveFlow = spec.scenarios.find((row) => row.id === 'save-flow');
  saveFlow.steps = [
    {action: 'external-state', adapter: 'window.__wireframeExternalState', value: 'forced', transitionId: 'toggle'}
  ];
  writeFileSync(join(runDir, 'design-spec.json'), JSON.stringify(spec, null, 2));

  assert.throws(() => validateSpec(runDir), /toggle: transition-driving step must use a real user action/);
});

test('spec rejects transition-driving steps that do not match the declared interaction contract', () => {
  const {runDir} = prepareAuthoredRun();
  const spec = authoredSpec();
  spec.transitionAssertions.toggle.interaction_contract.action = 'check';
  writeFileSync(join(runDir, 'design-spec.json'), JSON.stringify(spec, null, 2));

  assert.throws(() => validateSpec(runDir), /toggle: transition-driving step action click must match interaction contract check/);
});

test('runtime fails ambiguous selectors instead of sampling the first repeated item', async () => {
  const {runDir} = prepareAuthoredRun();
  const spec = authoredSpec();
  spec.scenarios.find((row) => row.id === 'save-flow').steps = [
    {action: 'select', selector: '[data-node-id="bank"]', value: '국민은행'},
    {action: 'fill', selector: '[data-node-id="owner"]', value: '김민지'},
    {action: 'click', selector: '[data-node-id="submit"]', transitionId: 'toggle'},
    {action: 'async', adapter: 'window.__wireframeAsyncSave'}
  ];
  writeFileSync(join(runDir, 'design-spec.json'), JSON.stringify(spec, null, 2));
  writeFileSync(join(runDir, 'renderer/index.html'), `<!doctype html><html><body><main data-node-id="root" role="region"><select data-node-id="bank"><option value="">선택</option><option>국민은행</option></select><input data-node-id="agree" type="checkbox"><input data-node-id="agree" type="checkbox" checked><input data-node-id="owner"><button data-node-id="details" aria-expanded="false">상세</button><button data-node-id="submit">저장</button><p data-node-id="status" role="status" aria-live="polite" hidden></p></main><script src="./app.js"></script></body></html>`);

  validateSpec(runDir);
  const runtime = await runRuntime(runDir);

  assert.equal(runtime.pass, false);
  assert.ok(runtime.assertionFailures.some((failure) => failure.includes('matched 2 elements')));
});

test('runtime can assert repeated item states with explicit item selectors', async () => {
  const {runDir} = prepareAuthoredRun();
  const spec = authoredSpec();
  spec.nodes.agree.itemSelectors = {
    A: '[data-node-id="agree"][data-item-ref="A"]',
    B: '[data-node-id="agree"][data-item-ref="B"]'
  };
  spec.stateAssertions.before.agree = {
    visible: true,
    items: {
      A: {checked: false},
      B: {checked: true}
    }
  };
  spec.stateAssertions.after.agree = spec.stateAssertions.before.agree;
  delete spec.stateAssertions.before.owner.focus;
  spec.scenarios.find((row) => row.id === 'save-flow').steps = [
    {action: 'select', selector: '[data-node-id="bank"]', value: '국민은행'},
    {action: 'fill', selector: '[data-node-id="owner"]', value: '김민지'},
    {action: 'click', selector: '[data-node-id="submit"]', transitionId: 'toggle'},
    {action: 'async', adapter: 'window.__wireframeAsyncSave'}
  ];
  writeFileSync(join(runDir, 'design-spec.json'), JSON.stringify(spec, null, 2));
  writeFileSync(join(runDir, 'renderer/index.html'), `<!doctype html><html><body><main data-node-id="root" role="region"><select data-node-id="bank"><option value="">선택</option><option>국민은행</option></select><input data-node-id="agree" data-item-ref="A" type="checkbox"><input data-node-id="agree" data-item-ref="B" type="checkbox" checked><input data-node-id="owner" autofocus><button data-node-id="details" aria-expanded="false">상세</button><button data-node-id="submit">저장</button><p data-node-id="status" role="status" aria-live="polite" hidden></p></main><script src="./app.js"></script></body></html>`);

  validateSpec(runDir);
  const runtime = await runRuntime(runDir);

  assert.deepEqual(runtime.assertionFailures, []);
  assert.deepEqual(runtime.transitionFailures, []);
  assert.equal(runtime.pass, true);
});

test('knowledge pack rejects missing or stale row provenance', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'ba-pack-root-'));
  cpSync(resolve(packRoot, 'heroines'), join(tempRoot, 'heroines'), {recursive: true});
  const packPath = join(tempRoot, 'heroines/2026-09-09/pack.json');
  const bad = JSON.parse(readFileSync(packPath, 'utf8'));
  bad.rowProvenance[0].revision = 'stale';
  writeFileSync(packPath, JSON.stringify(bad, null, 2));

  assert.throws(() => loadKnowledgePack(tempRoot, 'heroines/2026-09-09'), /row provenance/);

  const tempRoot2 = mkdtempSync(join(tmpdir(), 'ba-pack-root-'));
  cpSync(resolve(packRoot, 'heroines'), join(tempRoot2, 'heroines'), {recursive: true});
  const packPath2 = join(tempRoot2, 'heroines/2026-09-09/pack.json');
  const badComponent = JSON.parse(readFileSync(packPath2, 'utf8'));
  delete badComponent.componentKnowledge[0].origin;
  writeFileSync(packPath2, JSON.stringify(badComponent, null, 2));
  assert.throws(() => loadKnowledgePack(tempRoot2, 'heroines/2026-09-09'), /component knowledge provenance/);

  const tempRoot3 = mkdtempSync(join(tmpdir(), 'ba-pack-root-'));
  cpSync(resolve(packRoot, 'heroines'), join(tempRoot3, 'heroines'), {recursive: true});
  const packPath3 = join(tempRoot3, 'heroines/2026-09-09/pack.json');
  const badHash = JSON.parse(readFileSync(packPath3, 'utf8'));
  badHash.componentKnowledge[0].limitation = 'tampered after hashing';
  writeFileSync(packPath3, JSON.stringify(badHash, null, 2));
  assert.throws(() => loadKnowledgePack(tempRoot3, 'heroines/2026-09-09'), /row hash mismatch/);
});

test('runtime uses Playwright, captures required states and viewports, and checks state/action semantics', async () => {
  const {runDir} = prepareAuthoredRun();
  validateSpec(runDir);

  const runtime = await runRuntime(runDir);

  assert.equal(runtime.pass, true);
  assert.equal(runtime.evidenceKind, 'playwright-browser');
  assert.deepEqual(runtime.browserless, false);
  assert.equal(runtime.captures.length, 2);
  assert.ok(runtime.captures.every((capture) => existsSync(join(runDir, capture.path))));
  assert.ok(runtime.checkedAxes.includes('readonly'));
  assert.ok(runtime.checkedAxes.includes('expanded'));
  assert.equal(runtime.actions['external-state'], 1);
  assert.deepEqual(runtime.preservationFailures, []);
  assert.deepEqual(runtime.accessibilityFailures, []);
  assert.deepEqual(runtime.transitionFailures, []);
  assert.equal(runtime.transitionEvidence.length, 1);
  assert.deepEqual(runtime.transitionEvidence[0], {
    evidenceId: 'transition:toggle:save-flow:after',
    runtimeCheckId: 'transition-toggle',
    transitionId: 'toggle',
    scenarioId: 'save-flow',
    renderCaseId: 'after',
    origin: 'user_action',
    stepIndex: 4,
    action: 'click',
    nativeActionExecuted: true,
    selector: '[data-node-id="submit"]',
    selectorCount: 1,
    itemRef: null,
    stepExecuted: true,
    stepPassed: true,
    resultantStatePassed: true,
    preservationPassed: true,
    focusPassed: true,
    accessibilityPassed: true,
    pass: true
  });
});

test('runtime checks every item-specific assertion when repeated controls share an element id', async () => {
  const {runDir} = prepareAuthoredRun();
  const spec = authoredSpec();
  spec.nodes.agree.selector = '[data-node-id="criterion"]';
  spec.scenarios.find((row) => row.id === 'save-flow').steps = [
    {action: 'select', selector: '[data-node-id="bank"]', value: '국민은행'},
    {action: 'fill', selector: '[data-node-id="owner"]', value: '김민지'},
    {action: 'click', selector: '[data-node-id="submit"]', transitionId: 'toggle'},
    {action: 'async', adapter: 'window.__wireframeAsyncSave'},
    {action: 'external-state', adapter: 'window.__wireframeExternalState', value: 'brandpay:pending'}
  ];
  spec.stateAssertions.before.agree = [
    {item_ref: 'purchase', selector: '[data-node-id="criterion"][data-item-ref="purchase"]', states: {visible: true, checked: true}},
    {item_ref: 'review', selector: '[data-node-id="criterion"][data-item-ref="review"]', states: {visible: true, checked: false}}
  ];
  spec.stateAssertions.after.agree = spec.stateAssertions.before.agree;
  writeFileSync(join(runDir, 'design-spec.json'), JSON.stringify(spec, null, 2));
  writeFileSync(join(runDir, 'renderer/index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="./style.css"></head><body><main data-node-id="root" role="region" aria-label="계좌 저장"><label>은행<select data-node-id="bank"><option value="">선택</option><option>국민은행</option></select></label><label><input data-node-id="criterion" data-item-ref="purchase" type="checkbox" checked> 구매 조건</label><label><input data-node-id="criterion" data-item-ref="review" type="checkbox" checked> 리뷰 조건</label><input data-node-id="owner" aria-invalid="false" placeholder="예금주" autofocus><button data-node-id="details" aria-expanded="false">상세</button><button data-node-id="submit">저장</button><p data-node-id="status" role="status" aria-live="polite" hidden></p></main><script src="./app.js"></script></body></html>`);

  validateSpec(runDir);
  const runtime = await runRuntime(runDir);

  assert.equal(runtime.pass, false);
  assert.match(runtime.assertionFailures.join('\n'), /before\.agree\[review\]\.checked: expected false got true/);
});

test('runtime fails selected-reference preflight before browser execution', async () => {
  const {runDir} = prepareListReferenceRun();
  validateSpec(runDir);
  const selected = readSelectedReferences(runDir);
  selected.references[0].roleEvidence = [];
  selected.references[0].selectionRationale = 'Selected for handoff; using  with score 1.';
  writeFileSync(join(runDir, 'selected-references.json'), JSON.stringify(selected, null, 2));

  await assert.rejects(() => runRuntime(runDir), /selected references invalid/);
  assert.equal(existsSync(join(runDir, 'runtime.json')), false);
});

test('runtime reuses matching immutable evidence and reruns when renderer input changes', async () => {
  const {runDir} = prepareAuthoredRun();
  validateSpec(runDir);

  const first = await runRuntime(runDir);
  const firstRuntimeHash = sha256(join(runDir, 'runtime.json'));
  const second = await runRuntime(runDir);

  assert.equal(second.reused, true);
  assert.deepEqual(second.captures, first.captures);
  assert.equal(sha256(join(runDir, 'runtime.json')), firstRuntimeHash);

  writeFileSync(join(runDir, 'renderer/style.css'), 'main{margin:24px;display:grid;gap:16px}button{min-height:44px}\n');
  const changed = await runRuntime(runDir);

  assert.equal(changed.reused, false);
  assert.notDeepEqual(changed.captures.map((row) => row.imageHash), first.captures.map((row) => row.imageHash));
});

test('engine commands fail fast when prepared engine contract changes mid-run', () => {
  const {runDir} = prepareAuthoredRun();
  const metaPath = join(runDir, 'run.json');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  assert.match(meta.engine.contractHash, /^[a-f0-9]{64}$/);
  meta.engine.contractHash = '0'.repeat(64);
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  assert.throws(() => validateSpec(runDir), /engine contract changed since prepare/);
});

test('runtime writes exact-hash visual aliases and gate accepts reviewed representatives without dropping execution coverage', async () => {
  const {runDir} = prepareListReferenceRun();
  writeFileSync(join(runDir, 'design-spec.json'), JSON.stringify(authoredSpecWithDuplicateViewport(), null, 2));
  validateSpec(runDir);
  const runtime = await runRuntime(runDir);

  assert.equal(runtime.captures.length, 4);
  assert.equal(new Set(runtime.captures.map((row) => `${row.renderCaseId}:${row.viewport}`)).size, 4);
  assert.equal(runtime.transitionEvidence.length, 2);

  const aliases = JSON.parse(readFileSync(join(runDir, 'visual-aliases.json'), 'utf8'));
  assert.equal(aliases.runtime_capture_count, 4);
  assert.equal(aliases.unique_image_count, 2);
  assert.deepEqual(
    aliases.coverage.map((row) => [row.path, row.representativePath, row.imageHash]).sort(),
    runtime.captures.map((row) => {
      const representative = uniqueCaptureRepresentatives(runtime).find((item) => item.imageHash === row.imageHash);
      return [row.path, representative.path, row.imageHash];
    }).sort()
  );

  writeDesignDecisions(runDir);
  freezeRun(runDir);
  const representatives = uniqueCaptureRepresentatives(runtime);
  writeAIReview(runDir, {
    viewedImages: representatives.map((row) => row.path),
    viewed_captures: representatives.map((capture) => ({
      path: capture.path,
      hash: capture.imageHash,
      observations: [`Reviewed representative ${capture.renderCaseId}`]
    }))
  });

  const gate = gateRun(runDir);

  assert.equal(gate.verdict, 'accept_ai');
  assert.deepEqual(gate.viewedImages.sort(), representatives.map((row) => row.path).sort());
});

test('gate rejects visual alias artifacts that do not exactly cover runtime captures', async () => {
  const {runDir} = prepareAuthoredRun();
  writeFileSync(join(runDir, 'design-spec.json'), JSON.stringify(authoredSpecWithDuplicateViewport(), null, 2));
  validateSpec(runDir);
  const runtime = await runRuntime(runDir);
  writeDesignDecisions(runDir);
  freezeRun(runDir);
  const aliases = JSON.parse(readFileSync(join(runDir, 'visual-aliases.json'), 'utf8'));
  aliases.coverage.pop();
  writeFileSync(join(runDir, 'visual-aliases.json'), JSON.stringify(aliases, null, 2));
  const representatives = uniqueCaptureRepresentatives(runtime);
  writeAIReview(runDir, {
    viewedImages: representatives.map((row) => row.path),
    viewed_captures: representatives.map((capture) => ({
      path: capture.path,
      hash: capture.imageHash,
      observations: [`Reviewed representative ${capture.renderCaseId}`]
    }))
  });

  const gate = gateRun(runDir);

  assert.equal(gate.verdict, 'invalid');
  assert.ok(gate.errors.some((error) => error.includes('visual aliases')));
});

test('gate rejects empty visual alias groups even when coverage rows and frozen hash are forged', async () => {
  const {runDir} = prepareListReferenceRun();
  writeFileSync(join(runDir, 'design-spec.json'), JSON.stringify(authoredSpecWithDuplicateViewport(), null, 2));
  validateSpec(runDir);
  const runtime = await runRuntime(runDir);
  writeDesignDecisions(runDir);
  freezeRun(runDir);

  const aliasPath = join(runDir, 'visual-aliases.json');
  const aliases = JSON.parse(readFileSync(aliasPath, 'utf8'));
  aliases.groups = [];
  writeFileSync(aliasPath, JSON.stringify(aliases, null, 2));
  const freezePath = join(runDir, 'freeze.json');
  const freeze = JSON.parse(readFileSync(freezePath, 'utf8'));
  freeze.artifacts['visual-aliases.json'].sha256 = sha256(aliasPath);
  writeFileSync(freezePath, JSON.stringify(freeze, null, 2));
  writeAIReview(runDir, {viewedImages: [], viewed_captures: []});

  const gate = gateRun(runDir);

  assert.equal(gate.verdict, 'invalid');
  assert.ok(gate.errors.some((error) => error.includes('visual aliases')));
  assert.ok(gate.errors.some((error) => error.includes('viewed')));
  assert.equal(runtime.captures.length, 4);
});

test('freeze and gate never accept failing runtime and carry runtime failures', async () => {
  const {runDir} = prepareAuthoredRun();
  const spec = authoredSpec();
  spec.stateAssertions.after.status.value = '완료되었습니다';
  writeFileSync(join(runDir, 'design-spec.json'), JSON.stringify(spec, null, 2));
  validateSpec(runDir);
  const runtime = await runRuntime(runDir);

  assert.equal(runtime.pass, false);
  assert.ok(runtime.assertionFailures.some((failure) => failure.includes('after.status.value')));
  assert.throws(() => freezeRun(runDir), /runtime.pass true required/);

  writeUnsafeFreeze(runDir);
  writeAIReview(runDir);
  const gate = gateRun(runDir);

  assert.equal(gate.verdict, 'invalid');
  assert.ok(gate.errors.some((error) => error.includes('runtime assertion failure')));
  assert.ok(gate.runtimeFailures.assertionFailures.some((failure) => failure.includes('after.status.value')));
});


test('freeze requires authored design decisions and gate rejects stale decisions', async () => {
  const {runDir} = prepareAuthoredRun();
  validateSpec(runDir);
  await runRuntime(runDir);

  assert.throws(() => freezeRun(runDir), /design-decisions.json required/);

  writeDesignDecisions(runDir);
  const freeze = freezeRun(runDir);
  assert.ok(freeze.artifacts['design-decisions.json'].sha256);

  const stale = writeDesignDecisions(runDir, {stages: {...writeDesignDecisions(runDir).stages, tokens: {status: 'needs_work', rationale: 'Token evidence became stale.', evidence: ['captures/after-mobile.png']}}});
  assert.equal(stale.stages.tokens.status, 'needs_work');
  writeAIReview(runDir);
  const gate = gateRun(runDir);

  assert.equal(gate.verdict, 'invalid');
  assert.ok(gate.errors.some((error) => error.includes('design-decisions.json: frozen hash mismatch')));
  assert.ok(gate.errors.some((error) => error.includes('design decisions invalid')));
});

test('freeze validates design decision target, input, knowledge, and required stage shape', async () => {
  const cases = [
    [{target_id: 'other'}, /target_id must match packet target/],
    [{input_hash: 'c'.repeat(64)}, /input_hash must match packet source/],
    [{knowledge_hash: 'd'.repeat(64)}, /knowledge_hash must match prepared knowledge/],
    [{stages: {roles: {status: 'verified', evidence: ['role:account']}}}, /missing stage/]
  ];
  for (const [overrides, pattern] of cases) {
    const {runDir} = prepareAuthoredRun();
    validateSpec(runDir);
    await runRuntime(runDir);
    writeDesignDecisions(runDir, overrides);
    assert.throws(() => freezeRun(runDir), pattern);
  }
});


test('freeze validates authored decision rationale and current runtime evidence IDs', async () => {
  const cases = [
    ['missing rationale', (stages) => { delete stages.roles.rationale; }, /rationale required/],
    ['empty evidence', (stages) => { stages.roles.evidence = []; }, /evidence IDs required/],
    ['unknown evidence', (stages) => { stages.roles.evidence = ['capture:ghost']; }, /unknown evidence ID/]
  ];
  for (const [name, mutate, pattern] of cases) {
    const {runDir} = prepareAuthoredRun();
    validateSpec(runDir);
    await runRuntime(runDir);
    const valid = writeDesignDecisions(runDir);
    mutate(valid.stages);
    writeFileSync(join(runDir, 'design-decisions.json'), JSON.stringify(valid, null, 2));
    assert.throws(() => freezeRun(runDir), pattern, name);
  }
});

test('gate validates rich AI review hashes, captures, criteria, and actionable revise findings', async () => {
  const {runDir} = prepareAuthoredRun();
  validateSpec(runDir);
  await runRuntime(runDir);
  writeDesignDecisions(runDir);
  freezeRun(runDir);

  writeAIReview(runDir, {input_hash: 'c'.repeat(64)});
  let gate = gateRun(runDir);
  assert.equal(gate.verdict, 'invalid');
  assert.ok(gate.errors.some((error) => error.includes('AI review input_hash')));

  writeAIReview(runDir, {capture_hashes: {'captures/before-mobile.png': 'd'.repeat(64)}});
  gate = gateRun(runDir);
  assert.equal(gate.verdict, 'invalid');
  assert.ok(gate.errors.some((error) => error.includes('AI review capture_hashes')));

  const incompleteCriteria = writeAIReview(runDir);
  incompleteCriteria.criteria.W3.observation = '';
  writeFileSync(join(runDir, 'ai-review.json'), JSON.stringify(incompleteCriteria, null, 2));
  gate = gateRun(runDir);
  assert.equal(gate.verdict, 'invalid');
  assert.ok(gate.errors.some((error) => error.includes('AI review criteria.W3')));

  const genericCriteria = writeAIReview(runDir);
  for (const criterion of Object.values(genericCriteria.criteria)) criterion.observation = 'Reviewed against the current captures.';
  writeFileSync(join(runDir, 'ai-review.json'), JSON.stringify(genericCriteria, null, 2));
  gate = gateRun(runDir);
  assert.equal(gate.verdict, 'invalid');
  assert.ok(gate.errors.some((error) => error.includes('axis-specific observations')));

  writeAIReview(runDir, {verdict: 'revise', findings: [{axis: 'state distinction', evidence: 'too soft'}]});
  gate = gateRun(runDir);
  assert.equal(gate.verdict, 'invalid');
  assert.ok(gate.errors.some((error) => error.includes('revise findings must be actionable')));

  writeAIReview(runDir, {verdict: 'revise', findings: [{axis: 'state distinction', impact: 'medium', evidence: 'busy state needs stronger treatment in captures/after-mobile.png', recommendation: 'Strengthen busy-state treatment.', retryStage: 'tokens'}]});
  gate = gateRun(runDir);
  assert.equal(gate.verdict, 'revise');
  assert.equal(gate.retryStage, 'tokens');
});

test('gate allows byte-identical capture aliases to be reviewed once with exact coverage', async () => {
  const {runDir} = prepareListReferenceRun();
  writeFileSync(join(runDir, 'design-spec.json'), JSON.stringify(authoredSpecWithDuplicateViewport(), null, 2));
  validateSpec(runDir);
  const runtime = await runRuntime(runDir);
  writeDesignDecisions(runDir);
  freezeRun(runDir);

  const representatives = uniqueCaptureRepresentatives(runtime);
  writeAIReview(runDir, {
    capture_hashes: runtime.captures.map((capture) => capture.imageHash),
    viewedImages: representatives.map((capture) => capture.path),
    viewed_captures: representatives.map((capture) => ({
      path: capture.path,
      hash: capture.imageHash,
      observations: ['Reviewed the shared visual once because same-hash aliases are covered.'],
      covers: runtime.captures
        .filter((alias) => alias.imageHash === capture.imageHash)
        .map((alias) => `${alias.renderCaseId}-${alias.viewport}`)
    }))
  });
  const gate = gateRun(runDir);

  assert.equal(gate.verdict, 'accept_ai');
});

test('gate rejects capture aliases when duplicate coverage is missing or hash mismatched', async () => {
  const {runDir} = prepareListReferenceRun();
  writeFileSync(join(runDir, 'design-spec.json'), JSON.stringify(authoredSpecWithDuplicateViewport(), null, 2));
  validateSpec(runDir);
  const runtime = await runRuntime(runDir);
  writeDesignDecisions(runDir);
  freezeRun(runDir);
  const representatives = uniqueCaptureRepresentatives(runtime);
  const canonical = representatives[0];
  const nonRepresentative = runtime.captures.find((capture) => capture.imageHash === canonical.imageHash && capture.path !== canonical.path);

  writeAIReview(runDir, {
    capture_hashes: runtime.captures.map((capture) => capture.imageHash),
    viewedImages: [nonRepresentative.path],
    viewed_captures: [{
      path: nonRepresentative.path,
      hash: nonRepresentative.imageHash,
      observations: ['Reviewed a duplicate capture without linking it to its representative.'],
    }]
  });
  let gate = gateRun(runDir);
  assert.equal(gate.verdict, 'invalid');
  assert.ok(gate.errors.some((error) => error.includes('viewed_captures')));

  writeAIReview(runDir, {
    capture_hashes: runtime.captures.map((capture) => capture.imageHash),
    viewedImages: [canonical.path],
    viewed_captures: [{
      path: canonical.path,
      hash: 'd'.repeat(64),
      observations: ['Reviewed one capture with a stale hash.'],
      covers: runtime.captures.map((capture) => `${capture.renderCaseId}-${capture.viewport}`)
    }]
  });
  gate = gateRun(runDir);
  assert.equal(gate.verdict, 'invalid');
  assert.ok(gate.errors.some((error) => error.includes('viewed_captures')));
});


test('gate rejects freeze artifacts outside the exact current run artifact set', async () => {
  const cases = [
    ['relative traversal', (runDir, freeze) => {
      const outside = resolve(runDir, '..', 'outside.json');
      writeFileSync(outside, '{}');
      freeze.artifacts['../outside.json'] = {sha256: sha256(outside)};
    }, /frozen artifact path outside run directory|freeze artifacts extra/],
    ['absolute path', (runDir, freeze) => {
      const absolute = join(runDir, 'packet.json');
      freeze.artifacts[absolute] = {sha256: sha256(absolute)};
    }, /frozen artifact path must be relative|freeze artifacts extra/],
    ['extra benign file', (runDir, freeze) => {
      const benign = join(runDir, 'benign.json');
      writeFileSync(benign, '{}');
      freeze.artifacts['benign.json'] = {sha256: sha256(benign)};
    }, /freeze artifacts extra benign\.json/],
    ['missing capture', (_runDir, freeze) => {
      delete freeze.artifacts['captures/after-mobile.png'];
    }, /freeze artifacts missing captures\/after-mobile\.png/]
  ];

  for (const [name, mutate, pattern] of cases) {
    const {runDir} = prepareAuthoredRun();
    validateSpec(runDir);
    await runRuntime(runDir);
    writeDesignDecisions(runDir);
    const freeze = freezeRun(runDir);
    mutate(runDir, freeze);
    writeFileSync(join(runDir, 'freeze.json'), JSON.stringify(freeze, null, 2));
    writeAIReview(runDir);

    const gate = gateRun(runDir);

    assert.equal(gate.verdict, 'invalid', name);
    assert.ok(gate.errors.some((error) => pattern.test(error)), `${name}: ${gate.errors.join('\n')}`);
  }
});


test('gate requires exact reviewed selected references before accept_ai', async () => {
  const {runDir} = prepareListReferenceRun();
  validateSpec(runDir);
  await runRuntime(runDir);
  writeDesignDecisions(runDir);
  const freeze = freezeRun(runDir);
  assert.ok(freeze.artifacts['selected-references.json']);

  writeAIReview(runDir, {viewed_references: []});
  let gate = gateRun(runDir);
  assert.equal(gate.verdict, 'invalid');
  assert.ok(gate.errors.some((error) => error.includes('AI review viewed_references')));

  const selected = readSelectedReferences(runDir);
  writeAIReview(runDir, {
    viewed_references: selected.references.map((reference) => ({
      id: reference.id,
      path: reference.path,
      hash: reference.hash,
      observations: [`Reviewed ${reference.id}`],
      transferredFeatures: ['list rhythm'],
      excludedFeatures: ['source-specific copy']
    }))
  });
  gate = gateRun(runDir);
  assert.equal(gate.verdict, 'accept_ai');

  const staleReview = writeAIReview(runDir, {
    viewed_references: selected.references.map((reference, index) => ({
      id: reference.id,
      path: reference.path,
      hash: index === 0 ? 'd'.repeat(64) : reference.hash,
      observations: [`Reviewed ${reference.id}`],
      transferredFeatures: ['list rhythm'],
      excludedFeatures: ['source-specific copy']
    }))
  });
  assert.equal(staleReview.verdict, 'accept_ai');
  gate = gateRun(runDir);
  assert.equal(gate.verdict, 'invalid');
  assert.ok(gate.errors.some((error) => error.includes('AI review viewed_references')));
});

test('a selected reference the design took nothing from may say so', async () => {
  // The engine picks the reference set, not the reviewer. Demanding a transfer from every
  // one of them only makes the reviewer invent one.
  const {runDir} = prepareListReferenceRun();
  validateSpec(runDir);
  await runRuntime(runDir);
  writeDesignDecisions(runDir);
  freezeRun(runDir);
  const selected = readSelectedReferences(runDir);
  writeAIReview(runDir, {
    viewed_references: selected.references.map((reference, index) => ({
      id: reference.id,
      path: reference.path,
      hash: reference.hash,
      observations: [`Reviewed ${reference.id}`],
      transferredFeatures: index === 0 ? ['list rhythm'] : [],
      excludedFeatures: ['source-specific copy']
    }))
  });
  assert.equal(gateRun(runDir).verdict, 'accept_ai');

  // Saying nothing at all is still refused: the key has to be there, and the exclusion has
  // to explain what was left behind.
  writeAIReview(runDir, {
    viewed_references: selected.references.map((reference) => ({
      id: reference.id,
      path: reference.path,
      hash: reference.hash,
      observations: [`Reviewed ${reference.id}`],
      excludedFeatures: ['source-specific copy']
    }))
  });
  let gate = gateRun(runDir);
  assert.equal(gate.verdict, 'invalid');
  assert.ok(gate.errors.some((error) => error.includes('transferredFeatures required')));

  writeAIReview(runDir, {
    viewed_references: selected.references.map((reference) => ({
      id: reference.id,
      path: reference.path,
      hash: reference.hash,
      observations: [`Reviewed ${reference.id}`],
      transferredFeatures: [],
      excludedFeatures: []
    }))
  });
  gate = gateRun(runDir);
  assert.equal(gate.verdict, 'invalid');
  assert.ok(gate.errors.some((error) => error.includes('excludedFeatures required')));
});

test('spec rejects showing what a blocked action needs', () => {
  // An image review caught an expired screen still showing "남은 시간" in the accent colour.
  // Every machine check passed: each assertion was consistent with itself and nothing
  // compared the case's blocked action against what the spec kept on screen.
  const {runDir} = prepareAuthoredRun();
  assert.equal(validateSpec(runDir).valid, true);

  const packetPath = join(runDir, 'packet.json');
  const packet = JSON.parse(readFileSync(packetPath, 'utf8'));
  const target = packet.targets[0];
  const support = target.nodes.find((row) => row.semantic_type === 'status');
  support.purpose = '수락까지 남은 시간 제시';
  const state = target.states[0];
  state.blocked_actions_with_reasons = ['수락 — 기한이 지났다'];
  writeFileSync(packetPath, JSON.stringify(packet, null, 2));

  const specPath = join(runDir, 'design-spec.json');
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  spec.stateAssertions[state.render_case_id][support.element_id] = {visible: true};
  writeFileSync(specPath, JSON.stringify(spec, null, 2));
  assert.throws(() => validateSpec(runDir), /supports blocked action 수락 but is asserted visible/);

  // Hiding it in that one case is the fix.
  spec.stateAssertions[state.render_case_id][support.element_id] = {visible: false};
  writeFileSync(specPath, JSON.stringify(spec, null, 2));
  assert.equal(validateSpec(runDir).valid, true);
});

test('spec leaves the blocked control itself alone', () => {
  // A disabled control that is still on screen is what a blocked action looks like, not a
  // contradiction. Hiding it would remove the explanation of why it cannot be used.
  const {runDir} = prepareAuthoredRun();
  const packetPath = join(runDir, 'packet.json');
  const packet = JSON.parse(readFileSync(packetPath, 'utf8'));
  const target = packet.targets[0];
  const command = target.nodes.find((row) => (row.action_refs ?? []).length > 0);
  command.purpose = '수락해서 끝냄';
  const state = target.states[0];
  state.blocked_actions_with_reasons = ['수락 — 기한이 지났다'];
  writeFileSync(packetPath, JSON.stringify(packet, null, 2));

  const specPath = join(runDir, 'design-spec.json');
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  spec.stateAssertions[state.render_case_id][command.element_id] = {visible: true};
  writeFileSync(specPath, JSON.stringify(spec, null, 2));
  assert.equal(validateSpec(runDir).valid, true);
});

test('spec ignores blocked actions when nothing supports them', () => {
  const {runDir} = prepareAuthoredRun();
  const packetPath = join(runDir, 'packet.json');
  const packet = JSON.parse(readFileSync(packetPath, 'utf8'));
  packet.targets[0].states[0].blocked_actions_with_reasons = ['수락 — 기한이 지났다'];
  writeFileSync(packetPath, JSON.stringify(packet, null, 2));
  assert.equal(validateSpec(runDir).valid, true);
});

test('gate rejects selected references without grounded selection evidence', async () => {
  const {runDir} = prepareListReferenceRun();
  validateSpec(runDir);
  await runRuntime(runDir);
  const selected = readSelectedReferences(runDir);
  selected.references[0].roleEvidence = [];
  selected.references[0].selectionRationale = 'Selected for handoff; using  with score 1.';
  writeFileSync(join(runDir, 'selected-references.json'), JSON.stringify(selected, null, 2));
  writeDesignDecisions(runDir);
  assert.throws(() => freezeRun(runDir), /selected references invalid/);
  writeUnsafeFreeze(runDir);
  writeAIReview(runDir);

  const gate = gateRun(runDir);

  assert.equal(gate.verdict, 'invalid');
  assert.ok(gate.errors.some((error) => error.includes('selected-references')));
  assert.ok(gate.errors.some((error) => error.includes('roleEvidence')));
  assert.ok(gate.errors.some((error) => error.includes('selectionRationale')));
});

test('gate consumes explicit AI image and reference review and never marks BA final complete', async () => {
  const {runDir} = prepareListReferenceRun();
  validateSpec(runDir);
  await runRuntime(runDir);
  writeDesignDecisions(runDir);
  freezeRun(runDir);

  assert.equal(gateRun(runDir).verdict, 'insufficient_evidence');

  writeAIReview(runDir);
  const gate = gateRun(runDir);

  assert.equal(gate.verdict, 'accept_ai');
  assert.equal(gate.baFinalComplete, false);
  assert.equal(gate.complete, false);
});

test('opaque run ids are unique, contained, retry creates child runs, and frozen runs are immutable', async () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'ba-wireframe-root-'));
  const first = prepareRun(packet(), {packRoot, outputRoot});
  const second = prepareRun(packet(), {packRoot, outputRoot});

  assert.notEqual(first.runId, second.runId);
  assert.throws(() => prepareRun(packet(), {packRoot, outputRoot, runId: '../escape'}), /opaque run id/);
  assert.throws(() => prepareRun(packet(), {packRoot, outputRoot, runId: 'run-self-parent', parentRunId: 'run-self-parent'}), /parent run id cannot equal run id/);

  writeRenderer(first.runDir);
  validateSpec(first.runDir);
  await runRuntime(first.runDir);
  writeDesignDecisions(first.runDir);
  freezeRun(first.runDir);
  assert.throws(() => validateSpec(first.runDir), /frozen run is immutable/);

  const retry = retryRun(first.runDir, 'components');
  assert.equal(retry.parentRunId, first.runId);
  assert.equal(retry.retryStage, 'components');
  assert.ok(retry.runDir.startsWith(outputRoot));
});

test('CLI runs staged packet flow and gate supports revise verdicts', () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'ba-wireframe-cli-root-'));
  const inputFile = join(outputRoot, 'packet.json');
  writeFileSync(inputFile, JSON.stringify(packet()));

  const prepared = JSON.parse(execFileSync(process.execPath, ['src/cli.mjs', 'prepare', '--input', inputFile, '--output-root', outputRoot, '--pack-root', packRoot], {cwd: packageRoot}).toString());
  writeRenderer(prepared.runDir);

  for (const command of ['spec', 'runtime']) {
    execFileSync(process.execPath, ['src/cli.mjs', command, '--run-dir', prepared.runDir], {cwd: packageRoot});
  }
  writeDesignDecisions(prepared.runDir);
  execFileSync(process.execPath, ['src/cli.mjs', 'freeze', '--run-dir', prepared.runDir], {cwd: packageRoot});
  writeAIReview(prepared.runDir, {verdict: 'revise', findings: [{axis: 'state distinction', impact: 'medium', evidence: 'busy state needs stronger treatment in captures/after-mobile.png', recommendation: 'Strengthen busy-state treatment.', retryStage: 'tokens'}]});
  const gate = JSON.parse(execFileSync(process.execPath, ['src/cli.mjs', 'gate', '--run-dir', prepared.runDir], {cwd: packageRoot}).toString());

  assert.equal(gate.verdict, 'revise');
  assert.equal(gate.retryStage, 'tokens');
});

test('CLI emits compact summaries by default and full artifacts only when requested', () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'ba-wireframe-cli-root-'));
  const inputFile = join(outputRoot, 'packet.json');
  writeFileSync(inputFile, JSON.stringify(packet()));

  const prepared = JSON.parse(execFileSync(process.execPath, ['src/cli.mjs', 'prepare', '--input', inputFile, '--output-root', outputRoot, '--pack-root', packRoot], {cwd: packageRoot}).toString());
  assert.equal(prepared.command, 'prepare');
  assert.ok(prepared.runId);
  assert.ok(prepared.runDir);
  assert.equal(prepared.packet, undefined);

  writeRenderer(prepared.runDir);
  const specSummary = JSON.parse(execFileSync(process.execPath, ['src/cli.mjs', 'spec', '--run-dir', prepared.runDir], {cwd: packageRoot}).toString());
  assert.equal(specSummary.command, 'spec');
  assert.equal(specSummary.valid, true);
  assert.equal(specSummary.designSpec, undefined);

  const specFull = JSON.parse(execFileSync(process.execPath, ['src/cli.mjs', 'spec', '--run-dir', prepared.runDir, '--json', 'full'], {cwd: packageRoot}).toString());
  assert.equal(specFull.valid, true);
  assert.ok(specFull.designSpec);
});
