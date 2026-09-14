import Ajv from 'ajv';
import {chromium} from 'playwright';
import {createHash, randomUUID} from 'node:crypto';
import {existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const STATE_AXES = ['visible', 'checked', 'selected', 'disabled', 'readonly', 'busy', 'invalid', 'expanded', 'focus', 'value'];
export const SUPPORTED_ACTIONS = ['fill', 'click', 'check', 'select', 'keyboard', 'async', 'external-state'];
const USER_ACTIONS = new Set(['fill', 'click', 'check', 'select', 'keyboard']);
const FINAL_ARTIFACTS = ['packet.json', 'spec-validation.json', 'runtime.json', 'design-decisions.json', 'selected-references.json', 'visual-aliases.json'];
const REQUIRED_DECISION_STAGES = ['roles', 'reference_transfer', 'hierarchy', 'layout', 'components', 'tokens'];
const aiVerdicts = new Set(['accept_ai', 'revise', 'insufficient_evidence', 'invalid']);
const ENGINE_CONTRACT_VERSION = 'design-pipeline-engine-contract-v2';

const ajv = new Ajv({allErrors: true});
const packetSchema = {
  type: 'object',
  required: ['schema_version', 'source', 'knowledge_binding', 'targets', 'coverage_manifest'],
  properties: {
    schema_version: {const: 1},
    source: {
      type: 'object',
      required: ['case_id', 'content_hash', 'review_hash', 'confirmation_turn_id', 'project_id', 'observed_revision'],
      additionalProperties: true
    },
    knowledge_binding: {type: 'object', required: ['pack_id', 'version'], additionalProperties: true},
    targets: {type: 'array', minItems: 1},
    coverage_manifest: {type: 'object'}
  },
  additionalProperties: true
};
const validatePacketSchema = ajv.compile(packetSchema);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fileHash(path) {
  return sha256(readFileSync(path));
}

function objectHash(value) {
  return sha256(JSON.stringify(value, Object.keys(value).sort()));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function stableHash(value) {
  return sha256(JSON.stringify(canonical(value)));
}

function engineContract() {
  const sourceSha256 = fileHash(fileURLToPath(import.meta.url));
  return {
    version: ENGINE_CONTRACT_VERSION,
    sourceSha256,
    contractHash: stableHash({
      version: ENGINE_CONTRACT_VERSION,
      sourceSha256,
      stateAxes: STATE_AXES,
      supportedActions: SUPPORTED_ACTIONS,
      finalArtifacts: FINAL_ARTIFACTS,
      requiredDecisionStages: REQUIRED_DECISION_STAGES
    })
  };
}

function packDir(packRoot, version) {
  const [scope, release] = version.split('/');
  if (!scope || !release || version.includes('..')) throw new Error(`knowledge pack version must be scoped as name/version: ${version}`);
  return join(packRoot, scope, release);
}

function packVersionFromPacket(packet) {
  const binding = packet.knowledge_binding ?? packet.source?.knowledge_binding;
  const id = binding?.pack_id ?? 'heroines';
  const version = binding?.version ?? '2026-09-09';
  return id.includes('/') ? id : `${id}/${version}`;
}

export function loadKnowledgePack(packRoot, version) {
  const dir = packDir(packRoot, version);
  const packPath = join(dir, 'pack.json');
  const manifestPath = join(dir, 'upstream-manifest.json');
  const pack = readJson(packPath);
  const upstreamManifest = readJson(manifestPath);
  const hash = sha256(readFileSync(packPath) + readFileSync(manifestPath));
  if (pack.version !== version || upstreamManifest.packVersion !== version) throw new Error(`knowledge pack version mismatch for ${version}`);
  validatePackProvenance(pack, upstreamManifest);
  return {...pack, root: resolve(packRoot), upstreamManifest, upstreamManifestSha256: fileHash(manifestPath), hash};
}

function validatePackProvenance(pack, upstreamManifest) {
  const sourceHashes = new Map((upstreamManifest.sources ?? []).map((source) => [source.path, source.sha256]));
  if (!Array.isArray(pack.rowProvenance) || !pack.rowProvenance.length) throw new Error('row provenance missing');
  for (const row of pack.rowProvenance) {
    if (!row.collection || !row.sourcePath || !row.authority || !row.limitation) throw new Error('row provenance incomplete');
    if (!/^[a-f0-9]{64}$/.test(row.revision ?? '')) throw new Error(`row provenance stale or missing revision: ${row.collection}`);
    if (sourceHashes.get(row.sourcePath) !== row.revision) throw new Error(`row provenance does not match upstream manifest: ${row.collection}`);
  }
  for (const row of pack.componentKnowledge ?? []) {
    if (!row.sourcePath || !row.revision || !row.hash || !row.authority || !row.limitation || !row.origin) throw new Error(`component knowledge provenance incomplete: ${row.ref ?? 'unknown'}`);
    if (!/^[a-f0-9]{64}$/.test(row.revision) || !/^[a-f0-9]{64}$/.test(row.hash)) throw new Error(`component knowledge provenance invalid hash: ${row.ref}`);
    if (!['ba-authored-adapter', 'upstream-derived-contract'].includes(row.origin)) throw new Error(`component knowledge provenance invalid origin: ${row.ref}`);
    if (sourceHashes.get(row.sourcePath) !== row.revision) throw new Error(`component knowledge provenance stale: ${row.ref}`);
    const {hash, ...rowWithoutHash} = row;
    if (stableHash(rowWithoutHash) !== hash) throw new Error(`component knowledge provenance row hash mismatch: ${row.ref}`);
    if (row.origin === 'ba-authored-adapter' && !row.authority.startsWith('BA-authored')) throw new Error(`component knowledge provenance must distinguish BA-authored adapter: ${row.ref}`);
    if (row.origin === 'upstream-derived-contract' && row.authority.startsWith('BA-authored')) throw new Error(`component knowledge provenance cannot mark upstream contract as BA-authored: ${row.ref}`);
  }
}

function assertContained(root, path, label) {
  const absolute = resolve(root, path);
  if (relative(root, absolute).startsWith('..') || relative(root, absolute) === '..') throw new Error(`${label} outside run directory`);
  return absolute;
}

function assertOpaqueRunId(runId) {
  if (!/^[a-z0-9][a-z0-9-]{7,80}$/.test(runId)) throw new Error('opaque run id required');
}

function runMeta(runDir) {
  const meta = readJson(join(runDir, 'run.json'));
  assertEngineContract(meta);
  return meta;
}

function assertEngineContract(meta) {
  const expected = engineContract();
  if (!meta.engine?.contractHash) throw new Error('engine contract missing; rerun prepare');
  if (meta.engine.contractHash !== expected.contractHash) throw new Error('engine contract changed since prepare');
}

function statusFor(meta, status, extra = {}) {
  return {status, runId: meta.runId, parentRunId: meta.parentRunId ?? '', retryStage: meta.retryStage ?? '', source: meta.packet.source, knowledge: meta.knowledge, updatedAt: new Date().toISOString(), ...extra};
}

function ensureNotFrozen(runDir) {
  if (existsSync(join(runDir, 'freeze.json'))) throw new Error('frozen run is immutable');
}

function validatePacket(packet) {
  if (!validatePacketSchema(packet)) {
    const text = ajv.errorsText(validatePacketSchema.errors);
    if (text.includes('targets must NOT have fewer than 1 items')) throw new Error('at least one target required');
    throw new Error('wireframe_adapter packet schema required: ' + text);
  }
  for (const target of packet.targets) {
    if (!target.nodes?.length) throw new Error(`${target.target_id}: at least one node required`);
    if (!target.states?.length) throw new Error(`${target.target_id}: at least one render state required`);
    if (!target.design_handoffs?.length) throw new Error(`${target.target_id}: at least one design handoff required`);
    const stateIds = new Set(target.states.map((row) => row.render_case_id));
    const nodeIds = new Set(target.nodes.map((row) => row.element_id));
    const flowIds = new Set((target.flows ?? []).map((row) => row.transition_id));
    const ruleIds = new Set((target.interaction_rules ?? []).map((row) => row.rule_id ?? row.id));
    const handoffCases = new Set(target.design_handoffs.flatMap((row) => row.render_case_ids));
    for (const stateId of stateIds) if (!handoffCases.has(stateId)) throw new Error(`${target.target_id}: handoff render case coverage missing ${stateId}`);
    for (const handoff of target.design_handoffs) {
      for (const id of handoff.element_ids ?? []) if (!nodeIds.has(id)) throw new Error(`${target.target_id}: handoff unknown node ${id}`);
      // 세 층이 세 가지를 말하고 있었다. 이름은 「interaction」, 3단계는 전이 ∪ 상호작용 규칙을
      // 받고(screen_behavior.py: refs(..., set(transitions)|set(rules))), 여기는 전이만 받아
      // **3단계를 통과한 산출물이 4단계 prepare에서 스택 트레이스로 죽었다.**
      // packet은 이미 `interaction_rules`를 실어 나른다 — 읽기만 하면 된다.
      for (const id of handoff.interaction_refs ?? []) {
        if (flowIds.has(id) || ruleIds.has(id)) continue;
        throw new Error(`${target.target_id}: handoff interaction_refs ${id} names neither a transition nor an interaction rule`);
      }
    }
  }
}

function defaultDesignSpec(target) {
  const ref = (...segments) => segments.join('.');
  const componentFor = (node) => node.semantic_type === 'button' ? 'Button' : node.semantic_type === 'checkbox' ? 'Checkbox' : node.semantic_type === 'input' ? 'Text Field' : node.semantic_type === 'select' ? 'Select' : 'Surface';
  const nodes = Object.fromEntries(target.nodes.map((node) => [node.element_id, {
    selector: `[data-node-id="${node.element_id}"]`,
    component: componentFor(node),
    role: node.semantic_type === 'input' ? 'textbox' : node.semantic_type,
    knowledgeBinding: {ref: `component:${componentFor(node)}`}
  }]));
  const renderCaseIds = target.states.map((state) => state.render_case_id);
  return {
    schema_version: 1,
    target_id: target.target_id,
    roleBinding: {ref: 'role:account', type: 'account'},
    renderer: {entry: 'renderer/index.html', viewportMatrix: [{name: 'mobile', width: 390, height: 844}]},
    nodes,
    semanticTokens: [{token: ref('layout', 'space', 'margin', 'standard'), appliedTo: [target.nodes[0]?.element_id].filter(Boolean)}],
    stateAssertions: Object.fromEntries(renderCaseIds.map((renderCaseId) => [
      renderCaseId,
      Object.fromEntries(target.nodes.map((node) => [node.element_id, {visible: true}]))
    ])),
    scenarios: renderCaseIds.map((renderCaseId) => ({id: `${renderCaseId}-scenario`, renderCaseId, steps: [], preserve: []}))
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function roleForNode(node) {
  return node.semantic_type === 'input' ? 'textbox' : node.semantic_type;
}

function templateNodeHtml(node) {
  const id = escapeHtml(node.element_id);
  const name = escapeHtml(node.name);
  const purpose = escapeHtml(node.purpose || node.name || node.element_id);
  const role = escapeHtml(roleForNode(node));
  if (node.semantic_type === 'select') {
    return `<label class="wireframe-field"><span>${name}</span><select data-node-id="${id}" aria-label="${name}"><option value="">선택</option><option>${purpose}</option></select></label>`;
  }
  if (node.semantic_type === 'checkbox') {
    return `<label class="wireframe-check"><input data-node-id="${id}" type="checkbox"> <span>${name}</span></label>`;
  }
  if (node.semantic_type === 'input') {
    return `<label class="wireframe-field"><span>${name}</span><input data-node-id="${id}" aria-label="${name}" placeholder="${purpose}"></label>`;
  }
  if (node.semantic_type === 'button') {
    return `<button data-node-id="${id}" type="button">${name}</button>`;
  }
  if (node.semantic_type === 'disclosure') {
    return `<button data-node-id="${id}" type="button" aria-expanded="false">${name}</button>`;
  }
  if (node.semantic_type === 'status') {
    return `<p data-node-id="${id}" role="status" aria-live="polite">${name}</p>`;
  }
  return `<section data-node-id="${id}" role="${role}" aria-label="${name}">${name}</section>`;
}

function writeTemplateRenderer(runDir, target) {
  mkdirSync(join(runDir, 'renderer'), {recursive: true});
  const sections = target.nodes.map(templateNodeHtml).join('');
  writeFileSync(join(runDir, 'renderer/index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="./style.css"></head><body><main>${sections}</main><script src="./app.js"></script></body></html>`);
  writeFileSync(join(runDir, 'renderer/style.css'), 'main{margin:16px;display:grid;gap:16px;max-width:560px}section,label,p{min-height:44px}.wireframe-field,.wireframe-check{display:grid;gap:6px}input,select,button{min-height:44px;font:inherit}button{cursor:pointer}\n');
  writeFileSync(join(runDir, 'renderer/app.js'), 'for(const el of document.querySelectorAll(\'button[aria-expanded]\'))el.addEventListener(\'click\',()=>el.setAttribute(\'aria-expanded\',el.getAttribute(\'aria-expanded\')===\'true\'?\'false\':\'true\'));window.__wireframeExternalState=(value)=>{window.__lastExternalState=value};\n');
}

export function prepareRun(packet, {packRoot, outputRoot, runId, parentRunId = '', retryStage = ''}) {
  validatePacket(packet);
  const version = packVersionFromPacket(packet);
  const pack = loadKnowledgePack(packRoot, version);
  const root = resolve(outputRoot);
  const id = runId ?? `run-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  assertOpaqueRunId(id);
  if (parentRunId && parentRunId === id) throw new Error('parent run id cannot equal run id');
  const runDir = resolve(root, id);
  if (existsSync(runDir)) throw new Error(`run directory already exists: ${id}`);
  if (relative(root, runDir).startsWith('..')) throw new Error('run directory outside output root');
  mkdirSync(runDir, {recursive: true});
  const meta = {runId: id, parentRunId, retryStage, outputRoot: root, packet, knowledge: {version, root: resolve(packRoot), hash: pack.hash, upstreamManifestSha256: pack.upstreamManifestSha256}, engine: engineContract()};
  writeJson(join(runDir, 'run.json'), meta);
  writeJson(join(runDir, 'packet.json'), packet);
  writeJson(join(runDir, 'design-spec.template.json'), defaultDesignSpec(packet.targets[0]));
  writeJson(join(runDir, 'traceability.template.json'), {target_id: packet.targets[0].target_id, covered: {nodes: packet.targets[0].nodes.map((n) => n.element_id), render_cases: packet.targets[0].states.map((s) => s.render_case_id), flows: packet.targets[0].flows.map((f) => f.transition_id), design_handoffs: packet.targets[0].design_handoffs.map((h) => h.handoff_id)}});
  writeTemplateRenderer(runDir, packet.targets[0]);
  writeSelectedReferences(runDir, meta, pack, packet.targets[0]);
  writeJson(join(runDir, 'status.json'), statusFor(meta, 'prepared'));
  return {runId: id, runDir, packet, knowledge: meta.knowledge};
}

function tokenExists(pack, token) {
  let cursor = pack.tokens;
  for (const part of token.split('.')) cursor = cursor?.[part];
  return cursor !== undefined;
}

function componentKnowledge(pack, ref) {
  return (pack.componentKnowledge ?? []).find((row) => row.ref === ref);
}

function roleExists(pack, roleBinding) {
  if (!roleBinding?.ref || !roleBinding?.type) return false;
  return roleBinding.ref === `role:${roleBinding.type}` && (pack.roles ?? []).some((row) => row.type === roleBinding.type || row.id === roleBinding.ref.replace('role:', 'type-'));
}

function textTokens(value) {
  const text = Array.isArray(value) ? value.join(' ') : value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
  return new Set(text.toLowerCase().split(/[^0-9a-zA-Z가-힣]+/u).filter((token) => token.length >= 2));
}

function overlapScore(left, right) {
  let score = 0;
  for (const token of left) if (right.has(token)) score += 1;
  return score;
}

function roleRuleForRef(pack, ref) {
  const type = ref?.replace(/^role:/, '');
  return (pack.roles ?? []).find((row) => row.type === type || row.id === `type-${type}`) ?? null;
}

function selectReferencesForTarget(pack, target) {
  const handoffs = target.design_handoffs ?? [];
  const targetText = textTokens([
    target.task,
    target.purpose,
    ...(target.audience ?? []),
    ...(target.nodes ?? []).flatMap((node) => [node.name, node.semantic_type, node.purpose]),
    ...handoffs.flatMap((handoff) => [handoff.semantic_pattern, handoff.candidate_design_system_ref, ...(handoff.required_state_refs ?? []), ...(handoff.accessibility_expectations ?? [])])
  ]);
  const candidates = [];
  for (const handoff of handoffs) {
    const explicitId = String(handoff.candidate_design_system_ref ?? '').replace(/^reference:/, '');
    if (!String(handoff.candidate_design_system_ref ?? '').startsWith('reference:')) continue;
    const reference = (pack.references ?? []).find((row) => row.id === explicitId);
    if (!reference) continue;
    candidates.push({
      score: Number.MAX_SAFE_INTEGER,
      reference,
      roleEvidence: [`explicit baseline:${explicitId}`],
      selectionRationale: `Selected for ${handoff.handoff_id}; explicit baseline reference:${explicitId}.`
    });
  }
  for (const handoff of handoffs) {
    const roleRule = roleRuleForRef(pack, handoff.candidate_design_system_ref);
    const roleTokens = textTokens(roleRule ?? handoff.candidate_design_system_ref ?? '');
    const semanticTokens = textTokens(handoff.semantic_pattern ?? '');
    const roleType = roleRule?.type ?? handoff.candidate_design_system_ref?.replace(/^role:/, '') ?? '';
    for (const reference of pack.references ?? []) {
      const referencePath = reference.localPath ?? reference.path;
      if (!referencePath) continue;
      const referenceTokens = textTokens([reference.role, reference.authority, reference.limitation, reference.id]);
      const evidence = [];
      const roleExact = reference.role === roleType ? 8 : 0;
      const roleEvidenceMatch = overlapScore(roleTokens, referenceTokens) * 3;
      const semanticMatch = overlapScore(semanticTokens, referenceTokens) * 4;
      const targetMatch = overlapScore(targetText, referenceTokens) * 2;
      if (roleExact) evidence.push(`role exact:${roleType}`);
      if (roleEvidenceMatch) evidence.push(`role evidence:${[...roleTokens].filter((token) => referenceTokens.has(token)).sort().join(',')}`);
      if (semanticMatch) evidence.push(`semantic evidence:${[...semanticTokens].filter((token) => referenceTokens.has(token)).sort().join(',')}`);
      if (targetMatch) evidence.push(`target evidence:${[...targetText].filter((token) => referenceTokens.has(token)).sort().join(',')}`);
      const score = roleExact + roleEvidenceMatch + semanticMatch + targetMatch;
      const roleEvidence = [roleRule?.id ?? handoff.candidate_design_system_ref ?? '', roleRule?.when ?? '', ...(roleRule?.composition ?? [])].filter(Boolean);
      const groundedMatch = Boolean(roleExact || roleEvidenceMatch || semanticMatch);
      if (score > 0 && groundedMatch && roleEvidence.length) {
        candidates.push({
          score,
          reference,
          roleEvidence,
          selectionRationale: `Selected for ${handoff.handoff_id}; ${evidence.join('; ')}; score ${score}.`
        });
      }
    }
  }
  const deduped = new Map();
  for (const candidate of candidates.sort((a, b) => b.score - a.score || String(a.reference.id).localeCompare(String(b.reference.id)))) {
    if (!deduped.has(candidate.reference.id)) deduped.set(candidate.reference.id, candidate);
  }
  return [...deduped.values()].slice(0, 3).map(({reference, roleEvidence, selectionRationale}) => ({
    id: reference.id,
    path: reference.localPath ?? reference.path,
    hash: reference.sha256,
    role: reference.role ?? '',
    roleEvidence,
    authority: reference.authority ?? '',
    limitation: reference.limitation ?? '',
    selectionRationale
  }));
}

function writeSelectedReferences(runDir, meta, pack, target) {
  const references = selectReferencesForTarget(pack, target);
  const selected = {
    schema_version: 1,
    target_id: target.target_id,
    pack_version: meta.knowledge.version,
    knowledge_hash: meta.knowledge.hash,
    references,
    referenceGap: references.length ? '' : 'No grounded reference matched target handoff role, semantic pattern, or target evidence.'
  };
  writeJson(join(runDir, 'selected-references.json'), selected);
  return selected;
}

function readSelectedReferences(runDir) {
  const path = join(runDir, 'selected-references.json');
  return existsSync(path) ? readJson(path) : {references: []};
}

function validateSelectedReferences(runDir, meta) {
  const selected = readSelectedReferences(runDir);
  const errors = [];
  if (selected.knowledge_hash && selected.knowledge_hash !== meta.knowledge?.hash) errors.push('selected-references knowledge_hash must match prepared knowledge');
  for (const [index, reference] of (selected.references ?? []).entries()) {
    const prefix = `selected-references.references[${index}]`;
    if (!reference.id) errors.push(`${prefix}.id required`);
    if (!reference.path) errors.push(`${prefix}.path required`);
    if (!/^[a-f0-9]{64}$/.test(reference.hash ?? '')) errors.push(`${prefix}.hash required`);
    if (!Array.isArray(reference.roleEvidence) || !reference.roleEvidence.some((item) => typeof item === 'string' && item.trim())) errors.push(`${prefix}.roleEvidence required`);
    const rationale = reference.selectionRationale ?? '';
    if (typeof rationale !== 'string' || !rationale.trim()) {
      errors.push(`${prefix}.selectionRationale required`);
    } else {
      if (/using\s+with score/i.test(rationale)) errors.push(`${prefix}.selectionRationale contains empty evidence`);
      if (!/(role exact|role evidence|semantic evidence|target evidence|explicit baseline)/.test(rationale)) errors.push(`${prefix}.selectionRationale must include grounded role, semantic, or target evidence`);
    }
  }
  return errors;
}

function interfaceEntry(pack, hdsInterface) {
  if (!hdsInterface?.file || !hdsInterface?.interface) return null;
  return (pack.componentProps?.interfaces ?? []).find((row) => row.file === hdsInterface.file && row.interface === hdsInterface.interface) ?? null;
}

function parseClosedValue(value) {
  if (typeof value !== 'string') return value;
  const quoted = value.match(/^['"](.+)['"]$/);
  if (quoted) return quoted[1];
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function validateProps(nodeId, node, iface) {
  const errors = [];
  const props = node.props ?? {};
  const propMap = new Map((iface.props ?? []).map((prop) => [prop.name, prop]));
  for (const [name, value] of Object.entries(props)) {
    const prop = propMap.get(name);
    if (!prop) {
      errors.push(`${nodeId}: unknown prop ${name}`);
      continue;
    }
    if (prop.kind === 'closed-boolean' && typeof value !== 'boolean') errors.push(`${nodeId}: unsupported prop value ${name}`);
    if ((prop.kind === 'closed-union' || prop.kind === 'closed-cva') && prop.values) {
      const allowed = prop.values.map(parseClosedValue);
      if (!allowed.includes(value)) errors.push(`${nodeId}: unsupported prop value ${name}`);
    }
    if (prop.kind === 'open-string' && typeof value !== 'string') errors.push(`${nodeId}: unsupported prop value ${name}`);
    if (['unresolved', 'callback', 'union-with-open-or-unresolved'].includes(prop.kind)) errors.push(`${nodeId}: unsupported prop ${name}`);
  }
  return errors;
}

function resolveComponent(pack, nodeId, node) {
  const errors = [];
  let knowledge = null;
  let iface = null;
  if (node.knowledgeBinding?.ref) {
    knowledge = componentKnowledge(pack, node.knowledgeBinding.ref);
    if (!knowledge) errors.push(`${nodeId}: unknown knowledge ref ${node.knowledgeBinding.ref}`);
    else if (knowledge.component !== node.component) errors.push(`${nodeId}: unknown component ${node.component}`);
  }
  if (node.hdsInterface) {
    iface = interfaceEntry(pack, node.hdsInterface);
    if (!iface) errors.push(`${nodeId}: unknown interface ${node.hdsInterface.file}#${node.hdsInterface.interface}`);
    knowledge ??= (pack.componentKnowledge ?? []).find((row) => row.interface?.file === node.hdsInterface.file && row.interface?.interface === node.hdsInterface.interface);
    if (!knowledge) errors.push(`${nodeId}: missing component knowledge binding`);
    else if (knowledge.component !== node.component) errors.push(`${nodeId}: unknown component ${node.component}`);
  }
  if (!knowledge && !iface) errors.push(`${nodeId}: missing component interface or knowledge binding`);
  if (knowledge && !knowledge.roles.includes(node.role)) errors.push(`${nodeId}: unknown role ${node.role}`);
  if (iface) errors.push(...validateProps(nodeId, node, iface));
  else if (Object.keys(node.props ?? {}).length) errors.push(`${nodeId}: unknown prop ${Object.keys(node.props)[0]}`);
  return {errors, knowledge, iface};
}

function compareSet(errors, label, actualValues, expectedValues) {
  const actual = new Set(actualValues);
  const expected = new Set(expectedValues);
  const missing = [...expected].filter((value) => !actual.has(value)).sort();
  const extra = [...actual].filter((value) => !expected.has(value)).sort();
  if (missing.length) errors.push(`${label} missing ${missing.join(', ')}`);
  if (extra.length) errors.push(`${label} extra ${extra.join(', ')}`);
}

const CONTROL_TYPES = new Set(['command', 'button', 'link', 'checkbox', 'select', 'input', 'disclosure']);

// A render case that declares an action blocked must not also show what that action needs.
// Promoted from an image review: an expired screen kept "남은 시간 1일 4시간" in the accent
// colour while the state said the deadline had passed. Every machine check passed, because
// each assertion was consistent with itself; nothing compared the two records.
function blockedActionNames(state) {
  return (state.blocked_actions_with_reasons ?? [])
    .map((text) => String(text).split(/\s*[—–-]\s*/)[0].trim())
    .filter(Boolean);
}

function validateBlockedActionSupport(errors, spec, target) {
  const nodes = new Map((target.nodes ?? []).map((row) => [row.element_id, row]));
  for (const state of target.states ?? []) {
    const actions = blockedActionNames(state);
    if (!actions.length) continue;
    const assertions = spec.stateAssertions?.[state.render_case_id] ?? {};
    for (const [elementId, node] of nodes) {
      // A control that is meant to be shown disabled is what a blocked action looks like, not
      // a contradiction — hiding it would remove the explanation of why it cannot be used.
      const isControl = CONTROL_TYPES.has(node.semantic_type) || (node.action_refs ?? []).length > 0;
      if (isControl || actions.includes(node.name)) continue;
      const blocking = actions.filter((action) => (node.purpose ?? '').includes(action));
      if (!blocking.length) continue;
      if (stateAssertionRows(spec, state.render_case_id).some((row) => row.nodeId === elementId && row.states?.visible === true)) {
        errors.push(`${state.render_case_id}.${elementId}: supports blocked action ${blocking.join(', ')} but is asserted visible`);
      }
    }
  }
}

function validateTransitionAssertions(errors, spec, target) {
  const expectedFlowIds = target.flows.map((row) => row.transition_id);
  const expectedFlowSet = new Set(expectedFlowIds);
  const flowById = new Map((target.flows ?? []).map((row) => [row.transition_id, row]));
  const assertions = spec.transitionAssertions ?? {};
  compareSet(errors, 'transitionAssertions', Object.keys(assertions), expectedFlowIds);
  const scenarioById = new Map((spec.scenarios ?? []).map((scenario) => [scenario.id, scenario]));
  for (const scenario of spec.scenarios ?? []) {
    for (const step of scenario.steps ?? []) {
      if (step.transitionId && !expectedFlowSet.has(step.transitionId)) errors.push(`unknown step transitionId ${step.transitionId}`);
    }
  }
  for (const [transitionId, assertion] of Object.entries(assertions)) {
    if (assertion.transitionId !== transitionId) errors.push(`${transitionId}: transitionId must match assertion key`);
    const scenario = scenarioById.get(assertion.scenarioId);
    if (!scenario) {
      errors.push(`${transitionId}: scenario missing ${assertion.scenarioId}`);
      continue;
    }
    if (!(scenario.steps ?? []).length) errors.push(`${transitionId}: scenario ${scenario.id} has no executable steps`);
    if (assertion.renderCaseId && scenario.renderCaseId !== assertion.renderCaseId) errors.push(`${transitionId}: scenario renderCaseId must match assertion renderCaseId`);
    const matchedSteps = (scenario.steps ?? []).filter((step) => step.transitionId === transitionId);
    if (matchedSteps.length !== 1) errors.push(`${transitionId}: scenario ${scenario.id} must contain exactly one step with transitionId`);
    const transitionStep = matchedSteps[0];
    const flow = flowById.get(transitionId) ?? {};
    const hasAvailableUserAction = (flow.allowed_actions ?? []).some((action) => USER_ACTIONS.has(action));
    if (transitionStep && hasAvailableUserAction && !USER_ACTIONS.has(transitionStep.action)) {
      errors.push(`${transitionId}: transition-driving step must use a real user action`);
    }
    const contract = assertion.interaction_contract ?? assertion.interactionContract;
    const expectedContract = flow.interaction_contract ?? flow.interactionContract;
    if (expectedContract && !contract) {
      errors.push(`${transitionId}: interaction contract required`);
    } else if (expectedContract && stableHash(contract) !== stableHash(expectedContract)) {
      errors.push(`${transitionId}: interaction contract must mirror packet flow`);
    }
    if (transitionStep && contract?.action && transitionStep.action !== contract.action) {
      errors.push(`${transitionId}: transition-driving step action ${transitionStep.action} must match interaction contract ${contract.action}`);
    }
    if (transitionStep && contract?.origin === 'user_action') {
      if (!USER_ACTIONS.has(transitionStep.action)) errors.push(`${transitionId}: transition-driving step must use a real user action`);
      const subjectSelector = contract.subject_scope_id ? spec.nodes?.[contract.subject_scope_id]?.selector : '';
      const itemSelector = contract.item_ref && contract.subject_scope_id ? spec.nodes?.[contract.subject_scope_id]?.itemSelectors?.[contract.item_ref] : '';
      if (transitionStep.action !== 'keyboard') {
        if (!transitionStep.selector) errors.push(`${transitionId}: transition-driving step selector required`);
        else if (subjectSelector && transitionStep.selector !== subjectSelector && transitionStep.selector !== itemSelector) {
          errors.push(`${transitionId}: transition-driving step selector must target ${contract.subject_scope_id}`);
        }
      }
    }
  }
}

export function validateSpec(runDir) {
  ensureNotFrozen(runDir);
  const meta = runMeta(runDir);
  const pack = loadKnowledgePack(meta.knowledge.root, meta.knowledge.version);
  if (pack.hash !== meta.knowledge.hash) throw new Error('knowledge pack hash changed since prepare');
  const packet = readJson(join(runDir, 'packet.json'));
  if (objectHash(packet.source) !== objectHash(meta.packet.source)) throw new Error('packet source changed since prepare');
  const spec = readJson(join(runDir, existsSync(join(runDir, 'design-spec.json')) ? 'design-spec.json' : 'design-spec.template.json'));
  const traceability = readJson(join(runDir, existsSync(join(runDir, 'traceability.json')) ? 'traceability.json' : 'traceability.template.json'));
  const target = packet.targets.find((row) => row.target_id === spec.target_id);
  if (!target) throw new Error('design spec target does not match packet target');
  const errors = [];
  if (!roleExists(pack, spec.roleBinding)) errors.push(`unknown role ref ${spec.roleBinding?.ref ?? ''}`);
  const rendererEntry = assertContained(runDir, spec.renderer.entry, 'renderer entry');
  if (!existsSync(rendererEntry)) throw new Error('renderer entry missing');
  const expected = {
    nodes: new Set(target.nodes.map((row) => row.element_id)),
    render_cases: new Set(target.states.map((row) => row.render_case_id)),
    flows: new Set(target.flows.map((row) => row.transition_id)),
    design_handoffs: new Set(target.design_handoffs.map((row) => row.handoff_id))
  };
  const expectedNodeIds = [...expected.nodes];
  const expectedRenderCaseIds = [...expected.render_cases];
  compareSet(errors, 'spec nodes', Object.keys(spec.nodes ?? {}), expectedNodeIds);
  compareSet(errors, 'stateAssertions', Object.keys(spec.stateAssertions ?? {}), expectedRenderCaseIds);
  compareSet(errors, 'scenarios', (spec.scenarios ?? []).map((row) => row.renderCaseId), expectedRenderCaseIds);
  validateTransitionAssertions(errors, spec, target);
  validateBlockedActionSupport(errors, spec, target);
  for (const [renderCaseId, assertions] of Object.entries(spec.stateAssertions ?? {})) {
    compareSet(errors, `stateAssertions.${renderCaseId}`, Object.keys(assertions ?? {}), expectedNodeIds);
  }
  const missing = [];
  const extra = [];
  for (const [key, ids] of Object.entries(expected)) {
    const covered = new Set(traceability.covered?.[key] ?? []);
    for (const id of ids) if (!covered.has(id)) missing.push(`${key}:${id}`);
    for (const id of covered) if (!ids.has(id)) extra.push(`${key}:${id}`);
  }
  const componentMappings = [];
  const componentByElement = new Map();
  for (const [elementId, node] of Object.entries(spec.nodes ?? {})) {
    const resolved = resolveComponent(pack, elementId, node);
    errors.push(...resolved.errors);
    componentByElement.set(elementId, resolved.knowledge);
    componentMappings.push({
      elementId,
      component: node.component,
      interface: resolved.iface?.interface ?? '',
      interfaceFile: resolved.iface?.file ?? '',
      knowledgeRef: resolved.knowledge?.ref ?? node.knowledgeBinding?.ref ?? '',
      supported: resolved.errors.length === 0,
      props: node.props ?? {}
    });
  }
  const tokenMappings = (spec.semanticTokens ?? []).map((row) => ({...row, supported: tokenExists(pack, row.token)}));
  if (missing.length) errors.push('traceability missing ' + missing.join(', '));
  if (extra.length) errors.push('traceability extra ' + extra.join(', '));
  for (const row of tokenMappings) if (!row.supported) errors.push(`unsupported semantic token ${row.token}`);
  for (const renderCaseId of Object.keys(spec.stateAssertions ?? {})) {
    for (const row of stateAssertionRows(spec, renderCaseId)) {
      const knowledge = componentByElement.get(row.nodeId);
      if (!row.selector) errors.push(`${renderCaseId}.${row.label}: selector required`);
      if (!row.states || Array.isArray(row.states) || typeof row.states !== 'object') errors.push(`${renderCaseId}.${row.label}: states object required`);
      for (const axis of Object.keys(row.states ?? {})) {
        if (!STATE_AXES.includes(axis) || (axis !== 'value' && !knowledge?.supportedStates?.includes(axis))) errors.push(`${renderCaseId}.${row.label}: unsupported state ${axis}`);
      }
    }
  }
  const validation = {valid: errors.length === 0, errors, packet, designSpec: spec, traceability: {missing, extra}, renderer: {entry: relative(runDir, rendererEntry)}, knowledge: meta.knowledge, componentMappings, tokenMappings, roleRules: pack.roles, referenceLimitations: pack.references.map((r) => ({id: r.id, limitation: r.limitation}))};
  writeJson(join(runDir, 'spec-validation.json'), validation);
  writeJson(join(runDir, 'status.json'), statusFor(meta, validation.valid ? 'specified' : 'invalid_spec', {errors}));
  if (errors.length) throw new Error(errors.join('\n'));
  return validation;
}

function visibleExpression(el) {
  return !!(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none');
}

function stateAssertionRows(spec, renderCaseId) {
  const rows = [];
  const assertions = spec.stateAssertions?.[renderCaseId] ?? {};
  const stateEntries = (value) => Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => STATE_AXES.includes(key)));
  for (const [nodeId, entry] of Object.entries(assertions)) {
    if (Array.isArray(entry)) {
      for (const item of entry) {
        const itemRef = item?.item_ref ?? item?.itemRef ?? '';
        rows.push({
          nodeId,
          itemRef,
          selector: item?.selector ?? spec.nodes?.[nodeId]?.selector ?? '',
          states: stateEntries(item?.states ?? item?.assertions ?? {}),
          label: itemRef ? `${nodeId}[${itemRef}]` : nodeId
        });
      }
    } else if (entry?.items && typeof entry.items === 'object' && !Array.isArray(entry.items)) {
      const commonStates = stateEntries(entry);
      for (const [itemRef, itemStates] of Object.entries(entry.items)) {
        rows.push({
          nodeId,
          itemRef,
          selector: itemStates?.selector ?? spec.nodes?.[nodeId]?.itemSelectors?.[itemRef] ?? '',
          states: {...commonStates, ...stateEntries(itemStates?.states ?? itemStates?.assertions ?? itemStates)},
          label: `${nodeId}[${itemRef}]`
        });
      }
    } else {
      rows.push({
        nodeId,
        itemRef: '',
        selector: spec.nodes?.[nodeId]?.selector ?? '',
        states: stateEntries(entry),
        label: nodeId
      });
    }
  }
  return rows;
}

async function snapshotState(page, selector) {
  const locator = page.locator(selector);
  const count = await locator.count();
  if (count !== 1) throw new Error(`selector must match exactly one element: ${selector} matched ${count} elements`);
  return locator.evaluate((el) => {
    const visible = !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none');
    const value = 'value' in el ? el.value : (el.textContent || '').trim();
    return {
      visible,
      checked: Boolean(el.checked) || el.getAttribute('aria-checked') === 'true',
      selected: (el.tagName === 'SELECT' && el.value !== '') || el.getAttribute('aria-selected') === 'true',
      disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true',
      readonly: Boolean(el.readOnly) || el.getAttribute('aria-readonly') === 'true',
      busy: el.getAttribute('aria-busy') === 'true',
      invalid: el.getAttribute('aria-invalid') === 'true',
      expanded: el.getAttribute('aria-expanded') === 'true',
      focus: document.activeElement === el,
      value
    };
  });
}

async function applyStep(page, step) {
  const result = {
    action: step.action,
    selector: step.selector ?? '',
    selectorCount: step.selector ? await page.locator(step.selector).count() : null,
    itemRef: step.item_ref ?? step.itemRef ?? null,
    nativeActionExecuted: false,
    failure: ''
  };
  if (USER_ACTIONS.has(step.action) && step.action !== 'keyboard' && result.selectorCount !== 1) {
    result.failure = `${step.action} selector must match exactly one element: ${step.selector} matched ${result.selectorCount}`;
    return result;
  }
  if (step.action === 'fill') {
    await page.locator(step.selector).fill(step.value ?? '');
    result.nativeActionExecuted = true;
  } else if (step.action === 'click') {
    await page.locator(step.selector).click();
    result.nativeActionExecuted = true;
  } else if (step.action === 'check') {
    await page.locator(step.selector).check();
    result.nativeActionExecuted = true;
  } else if (step.action === 'select') {
    await page.locator(step.selector).selectOption({label: step.value});
    result.nativeActionExecuted = true;
  } else if (step.action === 'keyboard') {
    await page.keyboard.press(step.key ?? step.value);
    result.nativeActionExecuted = true;
  } else if (step.action === 'async') await page.evaluate(async (adapter) => {
    const fn = adapter.split('.').reduce((value, key) => value?.[key], window);
    if (typeof fn !== 'function') throw new Error(`async adapter missing: ${adapter}`);
    await fn();
  }, step.adapter);
  else if (step.action === 'external-state') await page.evaluate(({adapter, value}) => {
    const fn = adapter.split('.').reduce((current, key) => current?.[key], window);
    if (typeof fn !== 'function') throw new Error(`external-state adapter missing: ${adapter}`);
    fn(value);
  }, step);
  else throw new Error(`unsupported action ${step.action}`);
  return result;
}

async function assertState(page, spec, renderCaseId, checkedAxes, accessibilityFailures) {
  const failures = [];
  for (const row of stateAssertionRows(spec, renderCaseId)) {
    if (!row.selector) {
      failures.push(`${row.label}: missing selector`);
      continue;
    }
    let actual;
    try {
      actual = await snapshotState(page, row.selector);
    } catch (error) {
      failures.push(`${renderCaseId}.${row.label}: ${error.message}`);
      continue;
    }
    for (const [axis, value] of Object.entries(row.states)) {
      checkedAxes.add(axis);
      if (actual[axis] !== value) failures.push(`${renderCaseId}.${row.label}.${axis}: expected ${JSON.stringify(value)} got ${JSON.stringify(actual[axis])}`);
    }
    if (row.states.visible && spec.nodes[row.nodeId]?.role === 'status') {
      const ok = await page.locator(row.selector).evaluate((el) => el.getAttribute('role') === 'status' && Boolean(el.getAttribute('aria-live')));
      if (!ok) accessibilityFailures.push(`${row.label}: visible status needs role=status and aria-live`);
    }
  }
  return failures;
}

async function scenarioPage(browser, spec, runDir, scenario, viewport) {
  const page = await browser.newPage({viewport});
  await page.goto(pathToFileURL(assertContained(runDir, spec.renderer.entry, 'renderer entry')).href);
  await page.waitForLoadState('load');
  const preserved = new Map();
  const actions = {};
  const executedSteps = [];
  const stepFailures = [];
  for (const [stepIndex, step] of (scenario.steps ?? []).entries()) {
    let result;
    try {
      result = await applyStep(page, step);
    } catch (error) {
      throw new Error(`${scenario.id}:${step.transitionId ?? stepIndex}: ${error.message}`);
    }
    executedSteps.push({...result, stepIndex, transitionId: step.transitionId ?? ''});
    if (result.failure) stepFailures.push(`${scenario.id}: step ${stepIndex}: ${result.failure}`);
    actions[step.action] = (actions[step.action] ?? 0) + 1;
    if (!result.failure) for (const item of scenario.preserve ?? []) {
      if (item.selector === step.selector && ['fill', 'select', 'check'].includes(step.action)) {
        preserved.set(`${item.selector}:${item.property}`, (await snapshotState(page, item.selector))[item.property]);
      }
    }
  }
  return {page, preserved, actions, executedSteps, stepFailures};
}

export async function runRuntime(runDir) {
  ensureNotFrozen(runDir);
  const meta = runMeta(runDir);
  if (loadKnowledgePack(meta.knowledge.root, meta.knowledge.version).hash !== meta.knowledge.hash) throw new Error('knowledge pack hash changed since prepare');
  const validation = validateSpec(runDir);
  if (!validation.valid) throw new Error('valid spec required before runtime');
  const selectedReferenceErrors = validateSelectedReferences(runDir, meta);
  if (selectedReferenceErrors.length) throw new Error(`selected references invalid: ${selectedReferenceErrors.join('; ')}`);
  const spec = validation.designSpec;
  const runtimeInput = runtimeInputFingerprint(runDir, validation);
  if (runtimeCacheUsable(runDir, runtimeInput.fingerprint)) return {...readJson(join(runDir, 'runtime.json')), reused: true};
  const capturesDir = join(runDir, 'captures');
  mkdirSync(capturesDir, {recursive: true});
  const actions = Object.fromEntries(SUPPORTED_ACTIONS.map((action) => [action, 0]));
  const assertionFailures = [];
  const preservationFailures = [];
  const accessibilityFailures = [];
  const transitionFailures = [];
  const checkedAxes = new Set();
  const captures = [];
  const transitionEvidence = [];
  const browser = await chromium.launch({headless: true});
  try {
    for (const viewport of spec.renderer.viewportMatrix) {
      for (const renderCaseId of Object.keys(spec.stateAssertions ?? {})) {
        // 예전에는 렌더 케이스마다 **시나리오 하나**만 골라 돌렸다(`.find`). 그래서 복구 전이가
        // 정상 상태로 되돌아오면 두 전이가 한 렌더 케이스를 놓고 겹치고, 나중 것은 전이 증거를
        // 못 받아 실패했다. 「복구는 원래 상태로 돌아온다」는 아주 흔한 모양인데 파이프라인이
        // 그것을 표현할 수 없었다(7차 실측 — 착지 케이스를 따로 만들어 우회해야 했다).
        // 한 렌더 케이스에 여러 시나리오가 착지할 수 있다. 캡처는 그 화면 하나뿐이므로 한 장만 찍는다.
        const landing = (spec.scenarios ?? []).filter((row) => row.renderCaseId === renderCaseId);
        let capturedRenderCase = false;
        for (const scenario of (landing.length ? landing : [null])) {
        let page;
        let preserved = new Map();
        let executedSteps = [];
        let stepFailures = [];
        const scenarioPreservationFailures = [];
        if (scenario) {
          const result = await scenarioPage(browser, spec, runDir, scenario, {width: viewport.width, height: viewport.height});
          page = result.page;
          preserved = result.preserved;
          executedSteps = result.executedSteps;
          stepFailures = result.stepFailures;
          for (const [action, count] of Object.entries(result.actions)) actions[action] += count;
          for (const item of scenario.preserve ?? []) {
            const key = `${item.selector}:${item.property}`;
            if (preserved.has(key)) {
              const actual = (await snapshotState(page, item.selector))[item.property];
              if (actual !== preserved.get(key)) scenarioPreservationFailures.push(`${scenario.id}: ${key} was not preserved`);
            }
          }
          preservationFailures.push(...scenarioPreservationFailures);
          transitionFailures.push(...stepFailures);
        } else {
          page = await browser.newPage({viewport: {width: viewport.width, height: viewport.height}});
          await page.goto(pathToFileURL(assertContained(runDir, spec.renderer.entry, 'renderer entry')).href);
          await page.waitForLoadState('load');
        }
        const accessibilityBefore = accessibilityFailures.length;
        const stateFailures = await assertState(page, spec, renderCaseId, checkedAxes, accessibilityFailures);
        const scenarioAccessibilityFailures = accessibilityFailures.slice(accessibilityBefore);
        assertionFailures.push(...stateFailures);
        for (const [transitionId, assertion] of Object.entries(spec.transitionAssertions ?? {})) {
          if (assertion.scenarioId !== scenario?.id) continue;
          const step = executedSteps.find((row) => row.transitionId === transitionId);
          const contract = assertion.interaction_contract ?? assertion.interactionContract ?? {};
          const evidence = {
            evidenceId: `transition:${transitionId}:${scenario.id}:${renderCaseId}`,
            runtimeCheckId: `transition-${transitionId}`,
            transitionId,
            scenarioId: scenario.id,
            renderCaseId,
            origin: contract.origin ?? (USER_ACTIONS.has(step?.action) ? 'user_action' : 'system_adapter'),
            stepIndex: step?.stepIndex ?? -1,
            action: step?.action ?? '',
            nativeActionExecuted: step?.nativeActionExecuted ?? false,
            selector: step?.selector ?? '',
            selectorCount: step?.selectorCount ?? null,
            itemRef: step?.itemRef ?? contract.item_ref ?? contract.itemRef ?? null,
            stepExecuted: Boolean(step),
            stepPassed: Boolean(step) && !step.failure,
            resultantStatePassed: stateFailures.length === 0,
            preservationPassed: scenarioPreservationFailures.length === 0,
            focusPassed: !stateFailures.some((failure) => failure.includes('.focus')),
            accessibilityPassed: scenarioAccessibilityFailures.length === 0,
            pass: Boolean(step) && !step.failure && (contract.origin === 'user_action' ? step.nativeActionExecuted : true) && stateFailures.length === 0 && scenarioPreservationFailures.length === 0 && !stateFailures.some((failure) => failure.includes('.focus')) && scenarioAccessibilityFailures.length === 0
          };
          transitionEvidence.push(evidence);
          if (!evidence.pass) transitionFailures.push(`${transitionId}: mapped scenario ${scenario.id} did not satisfy transition evidence`);
        }
        if (!capturedRenderCase) {
          const path = `captures/${renderCaseId}-${viewport.name}.png`;
          await page.screenshot({path: join(runDir, path), fullPage: true});
          captures.push({renderCaseId, viewport: viewport.name, path, imageHash: fileHash(join(runDir, path)), sourceHash: fileHash(assertContained(runDir, spec.renderer.entry, 'renderer entry'))});
          capturedRenderCase = true;
        }
        await page.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  for (const transitionId of Object.keys(spec.transitionAssertions ?? {})) {
    if (!transitionEvidence.some((row) => row.transitionId === transitionId)) transitionFailures.push(`${transitionId}: no runtime transition evidence`);
  }
  const visualAlias = buildVisualAliases({captures});
  const runtime = {pass: assertionFailures.length === 0 && preservationFailures.length === 0 && accessibilityFailures.length === 0 && transitionFailures.length === 0, evidenceKind: 'playwright-browser', browserless: false, reused: false, runtimeInput, visualAlias: {path: 'visual-aliases.json', unique_image_count: visualAlias.unique_image_count, runtime_capture_count: visualAlias.runtime_capture_count}, checkedAxes: [...checkedAxes].sort(), actions, assertionFailures, preservationFailures, accessibilityFailures, transitionFailures, transitionEvidence, captures, limitations: ['Playwright verifies DOM state, interaction adapters, accessibility/status semantics, and screenshots for declared render cases. It does not perform AI visual judgement or real external-provider side effects.']};
  writeJson(join(runDir, 'runtime.json'), runtime);
  writeJson(join(runDir, 'visual-aliases.json'), visualAlias);
  writeJson(join(runDir, 'status.json'), statusFor(meta, runtime.pass ? 'runtime_passed' : 'runtime_failed'));
  return runtime;
}

function runtimeEvidenceIds(runtime) {
  return new Set([
    'runtime-playwright',
    ...(runtime?.captures ?? []).map((capture) => capture.path),
    ...(runtime?.captures ?? []).map((capture) => `${capture.renderCaseId}-${capture.viewport}`),
    ...(runtime?.transitionEvidence ?? []).flatMap((row) => [row.evidenceId, row.runtimeCheckId]).filter(Boolean)
  ]);
}

function exactMap(errors, label, actual, expected) {
  const actualKeys = Object.keys(actual ?? {}).sort();
  const expectedKeys = Object.keys(expected ?? {}).sort();
  const missing = expectedKeys.filter((key) => !(key in (actual ?? {})));
  const extra = actualKeys.filter((key) => !(key in expected));
  if (missing.length || extra.length) {
    errors.push(`${label} keys must match current runtime`);
    return;
  }
  for (const key of expectedKeys) {
    if (actual[key] !== expected[key]) errors.push(`${label}.${key} hash mismatch`);
  }
}

function currentSpecArtifact(runDir) {
  return existsSync(join(runDir, 'design-spec.json')) ? 'design-spec.json' : 'design-spec.template.json';
}

function currentRendererHash(runDir) {
  const validation = existsSync(join(runDir, 'spec-validation.json')) ? readJson(join(runDir, 'spec-validation.json')) : null;
  const entry = validation?.renderer?.entry ?? 'renderer/index.html';
  return fileHash(assertContained(runDir, entry, 'renderer entry'));
}

function recursiveFileHashes(rootDir) {
  const rows = [];
  function visit(dir) {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const stats = statSync(path);
      if (stats.isDirectory()) visit(path);
      else if (stats.isFile()) rows.push({path: relative(rootDir, path), sha256: fileHash(path)});
    }
  }
  visit(rootDir);
  return rows;
}

function runtimeInputFingerprint(runDir, validation) {
  const specArtifact = currentSpecArtifact(runDir);
  const rendererEntry = assertContained(runDir, validation.renderer.entry, 'renderer entry');
  const rendererRoot = dirname(rendererEntry);
  const input = {
    version: 1,
    engine: engineContract().contractHash,
    knowledge: validation.knowledge.hash,
    packet: fileHash(join(runDir, 'packet.json')),
    spec: fileHash(join(runDir, specArtifact)),
    selectedReferences: fileHash(join(runDir, 'selected-references.json')),
    rendererEntry: validation.renderer.entry,
    rendererFiles: recursiveFileHashes(rendererRoot),
    viewportMatrix: validation.designSpec.renderer.viewportMatrix,
    stateAssertions: Object.keys(validation.designSpec.stateAssertions ?? {}).sort(),
    scenarios: (validation.designSpec.scenarios ?? []).map((scenario) => ({id: scenario.id, renderCaseId: scenario.renderCaseId}))
  };
  return {fingerprint: stableHash(input), input};
}

function buildVisualAliases(runtime) {
  const representativesByHash = new Map();
  for (const capture of runtime.captures ?? []) {
    if (!representativesByHash.has(capture.imageHash)) representativesByHash.set(capture.imageHash, capture);
  }
  const groups = [...representativesByHash.entries()].map(([imageHash, representative]) => ({
    imageHash,
    representativePath: representative.path,
    representativeId: `${representative.renderCaseId}-${representative.viewport}`,
    members: (runtime.captures ?? [])
      .filter((capture) => capture.imageHash === imageHash)
      .map((capture) => ({
        path: capture.path,
        id: `${capture.renderCaseId}-${capture.viewport}`,
        renderCaseId: capture.renderCaseId,
        viewport: capture.viewport
      }))
      .sort((a, b) => a.path.localeCompare(b.path))
  })).sort((a, b) => a.representativePath.localeCompare(b.representativePath));
  return {
    schema_version: 1,
    alias_basis: 'exact_image_sha256',
    runtime_capture_count: (runtime.captures ?? []).length,
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
  };
}

function validateVisualAliases(runDir, runtime) {
  const aliasPath = join(runDir, 'visual-aliases.json');
  const errors = [];
  if (!existsSync(aliasPath)) return {valid: false, aliases: null, errors: ['visual aliases missing']};
  const aliases = readJson(aliasPath);
  if (aliases.alias_basis !== 'exact_image_sha256') errors.push('visual aliases must use exact_image_sha256 basis');
  const expectedAliases = buildVisualAliases(runtime ?? {captures: []});
  if (stableHash(aliases) !== stableHash(expectedAliases)) errors.push('visual aliases groups and coverage must exactly match runtime captures');
  const expected = new Map((runtime?.captures ?? []).map((capture) => [capture.path, {
    id: `${capture.renderCaseId}-${capture.viewport}`,
    renderCaseId: capture.renderCaseId,
    viewport: capture.viewport,
    imageHash: capture.imageHash
  }]));
  const coverage = aliases.coverage ?? [];
  const byPath = new Map();
  for (const row of coverage) {
    if (byPath.has(row.path)) errors.push(`visual aliases duplicate capture ${row.path}`);
    byPath.set(row.path, row);
  }
  compareSet(errors, 'visual aliases coverage', [...byPath.keys()], [...expected.keys()]);
  const representativeByHash = new Map();
  for (const capture of runtime?.captures ?? []) {
    if (!representativeByHash.has(capture.imageHash)) representativeByHash.set(capture.imageHash, capture.path);
  }
  for (const [path, capture] of expected) {
    const row = byPath.get(path);
    if (!row) continue;
    if (row.id !== capture.id || row.renderCaseId !== capture.renderCaseId || row.viewport !== capture.viewport || row.imageHash !== capture.imageHash) errors.push(`visual aliases ${path} capture mismatch`);
    const representativePath = representativeByHash.get(capture.imageHash);
    if (row.representativePath !== representativePath) errors.push(`visual aliases ${path} representative mismatch`);
    if (!existsSync(join(runDir, row.representativePath ?? ''))) errors.push(`visual aliases ${path} representative missing`);
  }
  if (aliases.runtime_capture_count !== expected.size) errors.push('visual aliases runtime_capture_count mismatch');
  if (aliases.unique_image_count !== representativeByHash.size) errors.push('visual aliases unique_image_count mismatch');
  return {valid: errors.length === 0, aliases, errors};
}

function runtimeCacheUsable(runDir, fingerprint) {
  if (!existsSync(join(runDir, 'runtime.json'))) return false;
  const runtime = readJson(join(runDir, 'runtime.json'));
  if (runtime.pass !== true || runtime.runtimeInput?.fingerprint !== fingerprint) return false;
  for (const capture of runtime.captures ?? []) {
    const path = join(runDir, capture.path);
    if (!existsSync(path) || fileHash(path) !== capture.imageHash) return false;
  }
  return validateVisualAliases(runDir, runtime).valid;
}

function currentKnowledgeHashes(meta) {
  const hashes = new Set([meta.knowledge?.hash].filter(Boolean));
  try {
    hashes.add(fileHash(join(packDir(meta.knowledge.root, meta.knowledge.version), 'pack.json')));
  } catch {
    // The prepared combined pack hash remains authoritative; the pack-file-only
    // hash is retained for wireframe_run compatibility when available.
  }
  return hashes;
}

function validateDesignDecisions(runDir, meta, runtime = null) {
  const decisionsPath = join(runDir, 'design-decisions.json');
  if (!existsSync(decisionsPath)) throw new Error('design-decisions.json required before freeze');
  const decisions = readJson(decisionsPath);
  const errors = [];
  const allowedEvidence = runtimeEvidenceIds(runtime);
  const targetIds = new Set((meta.packet.targets ?? []).map((target) => target.target_id));
  if (!targetIds.has(decisions.target_id)) errors.push('target_id must match packet target');
  if (decisions.input_hash !== meta.packet.source?.content_hash) errors.push('input_hash must match packet source');
  if (decisions.knowledge_hash !== meta.knowledge?.hash) errors.push('knowledge_hash must match prepared knowledge');
  if (!decisions.stages || typeof decisions.stages !== 'object' || Array.isArray(decisions.stages)) {
    errors.push('stages object required');
  } else {
    for (const stage of REQUIRED_DECISION_STAGES) {
      const row = decisions.stages[stage];
      if (!row) {
        errors.push(`missing stage ${stage}`);
        continue;
      }
      if (row.status !== 'verified') errors.push(`stages.${stage}.status must be verified`);
      if (typeof row.rationale !== 'string' || row.rationale.trim() === '') errors.push(`stages.${stage}.rationale required`);
      if (!Array.isArray(row.evidence)) {
        errors.push(`stages.${stage}.evidence must be an array`);
      } else if (!row.evidence.length) {
        errors.push(`stages.${stage}.evidence IDs required`);
      } else {
        for (const id of row.evidence) {
          if (typeof id !== 'string' || !allowedEvidence.has(id)) errors.push(`stages.${stage}.unknown evidence ID ${id}`);
        }
      }
    }
  }
  if (errors.length) throw new Error(`design decisions invalid: ${errors.join('; ')}`);
  return decisions;
}

function validateAIReview(runDir, meta, runtime, review) {
  const errors = [];
  const specArtifact = currentSpecArtifact(runDir);
  const expectedCaptureHashes = Object.fromEntries((runtime?.captures ?? []).map((capture) => [capture.path, capture.imageHash]));
  const expectedCaptureHashesById = Object.fromEntries((runtime?.captures ?? []).map((capture) => [`${capture.renderCaseId}-${capture.viewport}`, capture.imageHash]));
  const expectedCapturePaths = Object.keys(expectedCaptureHashes).sort();
  const aliasValidation = validateVisualAliases(runDir, runtime);
  if (!aliasValidation.valid) errors.push(`visual aliases invalid: ${aliasValidation.errors.join('; ')}`);
  const representativePaths = new Set((aliasValidation.aliases?.groups ?? []).map((group) => group.representativePath));
  const representativeHashes = new Set((aliasValidation.aliases?.groups ?? []).map((group) => group.imageHash));
  const selectedReferences = readSelectedReferences(runDir).references ?? [];
  const expectedReferenceHashes = Object.fromEntries(selectedReferences.map((reference) => [reference.path, reference.hash]));
  const expectedReferenceHashesById = Object.fromEntries(selectedReferences.map((reference) => [reference.id, reference.hash]));
  const allowedEvidence = runtimeEvidenceIds(runtime);
  if (review.input_hash !== meta.packet.source?.content_hash) errors.push('AI review input_hash must match current input');
  if (!currentKnowledgeHashes(meta).has(review.knowledge_hash)) errors.push('AI review knowledge_hash must match current pack');
  if (review.spec_hash !== fileHash(join(runDir, specArtifact))) errors.push('AI review spec_hash must match current spec');
  if (review.renderer_hash !== currentRendererHash(runDir)) errors.push('AI review renderer_hash must match current renderer');
  if (Array.isArray(review.capture_hashes)) {
    const expectedValues = Object.values(expectedCaptureHashes).sort();
    const actualValues = [...review.capture_hashes].sort();
    if (JSON.stringify(actualValues) !== JSON.stringify(expectedValues)) errors.push('AI review capture_hashes values must match current runtime');
  } else {
    exactMap(errors, 'AI review capture_hashes', review.capture_hashes, expectedCaptureHashes);
  }
  const viewedImages = [...(review.viewedImages ?? [])].sort();
  const viewedImagesExact = JSON.stringify(viewedImages) === JSON.stringify(expectedCapturePaths);
  const viewedImagesRepresentative = aliasValidation.valid && JSON.stringify(viewedImages) === JSON.stringify([...representativePaths].sort());
  if (!viewedImagesExact && !viewedImagesRepresentative) errors.push('AI review viewedImages must exactly match current captures or exact-hash visual representatives');
  const viewedCaptures = review.viewed_captures ?? [];
  if (!Array.isArray(viewedCaptures)) {
    errors.push('AI review viewed_captures required');
  } else {
    const viewedCaptureHashes = {};
    const viewedCaptureIds = {};
    const viewedCaptureImageHashes = new Set();
    for (const row of viewedCaptures) {
      const hash = row.hash ?? row.image_hash;
      if (row.path && expectedCaptureHashes[row.path]) {
        viewedCaptureHashes[row.path] = hash;
        viewedCaptureImageHashes.add(hash);
      } else if (row.id && expectedCaptureHashesById[row.id]) {
        viewedCaptureIds[row.id] = hash;
        viewedCaptureImageHashes.add(hash);
      } else {
        errors.push(`AI review viewed_captures unknown capture ${row.path ?? row.id ?? ''}`);
      }
      if (!Array.isArray(row.observations) || !row.observations.some((item) => typeof item === 'string' && item.trim())) errors.push(`AI review viewed_captures.${row.path ?? row.id ?? 'unknown'} observations required`);
    }
    const capturePathsExact = Object.keys(viewedCaptureHashes).length === expectedCapturePaths.length && Object.keys(viewedCaptureIds).length === 0;
    const captureIdsExact = Object.keys(viewedCaptureIds).length === Object.keys(expectedCaptureHashesById).length && Object.keys(viewedCaptureHashes).length === 0;
    const captureRepresentativesExact = aliasValidation.valid
      && Object.keys(viewedCaptureHashes).every((path) => representativePaths.has(path))
      && Object.keys(viewedCaptureIds).every((id) => (aliasValidation.aliases.groups ?? []).some((group) => group.representativeId === id))
      && JSON.stringify([...viewedCaptureImageHashes].sort()) === JSON.stringify([...representativeHashes].sort());
    if (capturePathsExact) exactMap(errors, 'AI review viewed_captures', viewedCaptureHashes, expectedCaptureHashes);
    else if (captureIdsExact) exactMap(errors, 'AI review viewed_captures', viewedCaptureIds, expectedCaptureHashesById);
    else if (!captureRepresentativesExact) errors.push('AI review viewed_captures must cover every capture or every exact-hash visual representative');
  }
  if (selectedReferences.length) {
    const viewedReferences = review.viewed_references ?? [];
    if (!Array.isArray(viewedReferences)) {
      errors.push('AI review viewed_references required');
    } else {
      const byPath = {};
      const byId = {};
      for (const row of viewedReferences) {
        if (row.path && expectedReferenceHashes[row.path]) byPath[row.path] = row.hash;
        else if (row.id && expectedReferenceHashesById[row.id]) byId[row.id] = row.hash;
        else errors.push(`AI review viewed_references unknown reference ${row.path ?? row.id ?? ''}`);
        if (!Array.isArray(row.observations) || !row.observations.some((item) => typeof item === 'string' && item.trim())) errors.push(`AI review viewed_references.${row.path ?? row.id ?? 'unknown'} observations required`);
        // A reference the engine selected but the design took nothing from must be able to
        // say so. Requiring a transfer from every selected reference only makes the reviewer
        // invent one, which is the opposite of what this evidence is for; the exclusion list
        // still has to explain what was left behind.
        const transferred = Array.isArray(row.transferredFeatures) && row.transferredFeatures.some((item) => typeof item === 'string' && item.trim());
        if (!Array.isArray(row.transferredFeatures) || (!transferred && row.transferredFeatures.length)) errors.push(`AI review viewed_references.${row.path ?? row.id ?? 'unknown'} transferredFeatures required`);
        if (!Array.isArray(row.excludedFeatures) || !row.excludedFeatures.some((item) => typeof item === 'string' && item.trim())) errors.push(`AI review viewed_references.${row.path ?? row.id ?? 'unknown'} excludedFeatures required`);
      }
      if (Object.keys(byPath).length) exactMap(errors, 'AI review viewed_references', byPath, expectedReferenceHashes);
      if (Object.keys(byId).length) exactMap(errors, 'AI review viewed_references', byId, expectedReferenceHashesById);
      if (!Object.keys(byPath).length && !Object.keys(byId).length) errors.push('AI review viewed_references must exactly match selected references');
    }
  }
  const criteriaRows = Array.isArray(review.criteria)
    ? Object.fromEntries(review.criteria.map((row) => [row.id, {observation: row.observation, evidence: row.evidence ?? row.evidence_ids}]))
    : review.criteria;
  const criterionObservations = [];
  for (const id of ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7']) {
    const row = criteriaRows?.[id];
    if (!row || typeof row.observation !== 'string' || row.observation.trim() === '') errors.push(`AI review criteria.${id} observation required`);
    else criterionObservations.push(row.observation.trim().replaceAll(/\s+/g, ' '));
    if (!Array.isArray(row?.evidence) || !row.evidence.length) {
      errors.push(`AI review criteria.${id} evidence required`);
    } else {
      for (const evidenceId of row.evidence) {
        if (!allowedEvidence.has(evidenceId)) errors.push(`AI review criteria.${id} unknown evidence ID ${evidenceId}`);
      }
    }
  }
  if (criterionObservations.length === 7 && new Set(criterionObservations).size === 1) {
    errors.push('AI review criteria require axis-specific observations');
  }
  if (review.verdict === 'revise') {
    if (!(review.findings ?? []).length) {
      errors.push('revise requires findings');
    } else {
      for (const finding of review.findings) {
        if (!finding.evidence || !finding.retryStage || !(finding.recommendation || finding.blocking)) errors.push('revise findings must be actionable');
      }
    }
  }
  return errors;
}

function expectedFrozenArtifactPaths(runDir, runtime) {
  const expected = new Set(FINAL_ARTIFACTS);
  expected.add(currentSpecArtifact(runDir));
  expected.add(existsSync(join(runDir, 'traceability.json')) ? 'traceability.json' : 'traceability.template.json');
  for (const capture of runtime?.captures ?? []) expected.add(capture.path);
  return expected;
}

function verifyFrozenArtifacts(runDir, runtime, freeze, errors) {
  const expected = expectedFrozenArtifactPaths(runDir, runtime);
  const artifacts = freeze.artifacts ?? {};
  const actual = new Set(Object.keys(artifacts));

  for (const path of expected) {
    if (!actual.has(path)) errors.push(`freeze artifacts missing ${path}`);
  }

  for (const [path, artifact] of Object.entries(artifacts)) {
    if (isAbsolute(path)) {
      errors.push(`${path}: frozen artifact path must be relative`);
      continue;
    }

    let artifactPath;
    try {
      artifactPath = assertContained(runDir, path, 'frozen artifact path');
    } catch (error) {
      errors.push(`${path}: ${error.message}`);
      continue;
    }

    if (!expected.has(path)) {
      errors.push(`freeze artifacts extra ${path}`);
      continue;
    }

    if (!existsSync(artifactPath)) {
      errors.push(`${path}: frozen artifact missing`);
      continue;
    }
    if (fileHash(artifactPath) !== artifact.sha256) errors.push(`${path}: frozen hash mismatch`);
  }
}

export function freezeRun(runDir) {
  const meta = runMeta(runDir);
  if (!existsSync(join(runDir, 'runtime.json'))) throw new Error('runtime evidence required before freeze');
  const runtime = readJson(join(runDir, 'runtime.json'));
  if (runtime.evidenceKind !== 'playwright-browser' || runtime.browserless) throw new Error('gate cannot accept browserless evidence');
  if (runtime.pass !== true) throw new Error('runtime.pass true required before freeze');
  const aliasValidation = validateVisualAliases(runDir, runtime);
  if (!aliasValidation.valid) throw new Error(`visual aliases invalid: ${aliasValidation.errors.join('; ')}`);
  validateDesignDecisions(runDir, meta, runtime);
  const selectedReferenceErrors = validateSelectedReferences(runDir, meta);
  if (selectedReferenceErrors.length) throw new Error(`selected references invalid: ${selectedReferenceErrors.join('; ')}`);
  const artifacts = {};
  for (const name of FINAL_ARTIFACTS) artifacts[name] = {sha256: fileHash(join(runDir, name))};
  artifacts[existsSync(join(runDir, 'design-spec.json')) ? 'design-spec.json' : 'design-spec.template.json'] = {
    sha256: fileHash(join(runDir, existsSync(join(runDir, 'design-spec.json')) ? 'design-spec.json' : 'design-spec.template.json'))
  };
  artifacts[existsSync(join(runDir, 'traceability.json')) ? 'traceability.json' : 'traceability.template.json'] = {
    sha256: fileHash(join(runDir, existsSync(join(runDir, 'traceability.json')) ? 'traceability.json' : 'traceability.template.json'))
  };
  for (const capture of runtime.captures ?? []) artifacts[capture.path] = {sha256: fileHash(join(runDir, capture.path))};
  const freeze = {frozenAt: new Date().toISOString(), knowledge: meta.knowledge, artifacts};
  writeJson(join(runDir, 'freeze.json'), freeze);
  writeJson(join(runDir, 'status.json'), statusFor(meta, 'frozen'));
  return freeze;
}

export function gateRun(runDir) {
  const meta = runMeta(runDir);
  const errors = [];
  if (!existsSync(join(runDir, 'freeze.json'))) errors.push('freeze required');
  const runtime = existsSync(join(runDir, 'runtime.json')) ? readJson(join(runDir, 'runtime.json')) : null;
  if (!runtime || runtime.evidenceKind !== 'playwright-browser' || runtime.browserless) errors.push('playwright browser evidence required');
  const runtimeFailures = {
    assertionFailures: runtime?.assertionFailures ?? [],
    preservationFailures: runtime?.preservationFailures ?? [],
    accessibilityFailures: runtime?.accessibilityFailures ?? [],
    transitionFailures: runtime?.transitionFailures ?? []
  };
  if (runtime && runtime.pass !== true) {
    for (const failure of runtimeFailures.assertionFailures) errors.push(`runtime assertion failure: ${failure}`);
    for (const failure of runtimeFailures.preservationFailures) errors.push(`runtime preservation failure: ${failure}`);
    for (const failure of runtimeFailures.accessibilityFailures) errors.push(`runtime accessibility failure: ${failure}`);
    for (const failure of runtimeFailures.transitionFailures) errors.push(`runtime transition failure: ${failure}`);
    if (!runtimeFailures.assertionFailures.length && !runtimeFailures.preservationFailures.length && !runtimeFailures.accessibilityFailures.length && !runtimeFailures.transitionFailures.length) errors.push('runtime.pass false');
  }
  const freeze = existsSync(join(runDir, 'freeze.json')) ? readJson(join(runDir, 'freeze.json')) : null;
  try {
    validateDesignDecisions(runDir, meta, runtime);
  } catch (error) {
    errors.push(error.message);
  }
  errors.push(...validateSelectedReferences(runDir, meta));
  if (freeze) {
    if (!freeze.artifacts?.['design-decisions.json']) errors.push('design-decisions.json missing from freeze');
    verifyFrozenArtifacts(runDir, runtime, freeze, errors);
  }
  const review = existsSync(join(runDir, 'ai-review.json')) ? readJson(join(runDir, 'ai-review.json')) : null;
  let verdict = errors.length ? 'invalid' : 'insufficient_evidence';
  let retryStage = '';
  if (review) {
    if (!aiVerdicts.has(review.verdict)) errors.push('invalid AI review verdict');
    errors.push(...validateAIReview(runDir, meta, runtime, review));
    const selectedReferences = readSelectedReferences(runDir).references ?? [];
    const lacksGroundedReference = !selectedReferences.length && review.verdict === 'accept_ai';
    const capturePaths = new Set((runtime?.captures ?? []).map((row) => row.path));
    const aliasValidation = validateVisualAliases(runDir, runtime);
    const representativePaths = new Set((aliasValidation.aliases?.groups ?? []).map((group) => group.representativePath));
    const viewed = new Set(review.viewedImages ?? []);
    if (!([...capturePaths].every((path) => viewed.has(path)) || (aliasValidation.valid && [...representativePaths].every((path) => viewed.has(path)) && viewed.size === representativePaths.size))) errors.push('AI review did not view every capture or exact-hash visual representative');
    if (!Array.isArray(review.axes) || review.axes.length === 0) errors.push('AI review axes required');
    retryStage = review.findings?.find((row) => row.retryStage)?.retryStage ?? '';
    verdict = errors.length ? 'invalid' : lacksGroundedReference ? 'insufficient_evidence' : review.verdict;
  }
  const gate = {verdict, complete: false, baFinalComplete: false, errors, runtimeFailures, retryStage, reviewId: review ? 'ai-review' : '', viewedImages: review?.viewedImages ?? [], limitations: runtime?.limitations ?? []};
  writeJson(join(runDir, 'gate.json'), gate);
  writeJson(join(runDir, 'status.json'), statusFor(meta, verdict === 'accept_ai' ? 'awaiting_ba_confirmation' : verdict === 'insufficient_evidence' ? 'needs_ai_review' : verdict, {verdict}));
  return gate;
}

export function retryRun(parentRunDir, retryStage) {
  const parent = runMeta(parentRunDir);
  const child = prepareRun(parent.packet, {packRoot: parent.knowledge.root, outputRoot: parent.outputRoot, parentRunId: parent.runId, retryStage});
  return {...child, parentRunId: parent.runId, retryStage};
}

export const buildSpec = validateSpec;
export const checkRuntime = runRuntime;
