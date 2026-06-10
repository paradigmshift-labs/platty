import type { ServiceMapArtifact } from './service_map_artifact.js'
import type { BusinessMapArtifact } from './business_map_artifact.js'

export interface RenderServiceMapHtmlOptions {
  businessMap?: BusinessMapArtifact
}

export function renderServiceMapHtml(artifact: ServiceMapArtifact, options: RenderServiceMapHtmlOptions = {}): string {
  const payload = safeJson(artifact)
  const businessContextHtml = options.businessMap ? renderBusinessContextHtml(options.businessMap) : ''
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Platty Service Map</title>
  <style>
    :root { color-scheme: light; --bg: #f6f6f3; --ink: #171717; --muted: #666; --line: #d8d8d2; --panel: #fff; --accent: #0f766e; --warn: #b45309; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: var(--bg); }
    header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: start; padding: 18px 24px 14px; border-bottom: 1px solid var(--line); background: var(--panel); }
    h1 { margin: 0; font-size: 22px; line-height: 1.2; letter-spacing: 0; }
    button, input, select { font: inherit; }
    button { border: 1px solid var(--line); border-radius: 6px; padding: 7px 10px; background: #fff; color: var(--ink); cursor: pointer; }
    button:hover { border-color: #9ca3af; background: #f9fafb; }
    input[type="search"], select { width: 100%; border: 1px solid var(--line); border-radius: 6px; padding: 8px 9px; background: #fff; color: var(--ink); }
    label { display: flex; gap: 7px; align-items: center; font-size: 12px; color: #333; }
    .subtle { color: var(--muted); }
    .stats { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .stat { border: 1px solid var(--line); border-radius: 6px; padding: 7px 9px; background: #fbfbf9; font-size: 12px; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    main { display: grid; grid-template-columns: minmax(0, 1fr) 360px; height: calc(100vh - 102px); min-height: 640px; }
    .viewport { position: relative; min-width: 0; background: #fcfcfa; overflow: hidden; }
    canvas { width: 100%; height: 100%; display: block; cursor: grab; }
    canvas.dragging { cursor: grabbing; }
    .hud { position: absolute; left: 14px; bottom: 14px; display: flex; flex-wrap: wrap; gap: 8px; max-width: calc(100% - 28px); pointer-events: none; }
    .hud span { border: 1px solid rgba(216, 216, 210, .9); border-radius: 999px; padding: 5px 8px; background: rgba(255,255,255,.86); font-size: 12px; color: #444; }
    aside { border-left: 1px solid var(--line); background: var(--panel); overflow: auto; }
    .side { padding: 14px 16px 24px; }
    .side h2 { margin: 0 0 12px; font-size: 15px; }
    .side h3 { margin: 18px 0 8px; font-size: 13px; }
    .stack { display: grid; gap: 8px; }
    .checks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .item { border: 1px solid var(--line); border-radius: 6px; padding: 8px; font-size: 12px; background: #fff; overflow-wrap: anywhere; }
    .item strong { display: block; margin-bottom: 3px; }
    .row { display: flex; gap: 8px; }
    .row > * { flex: 1; }
    .legend { display: flex; flex-wrap: wrap; gap: 6px; }
    .legend-chip { border: 1px solid var(--line); border-radius: 999px; padding: 5px 8px; font-size: 12px; background: #fbfbf9; }
    .detail { min-height: 84px; }
    .viewer-button { width: 100%; text-align: left; }
    .doc-viewer { position: fixed; inset: 0; z-index: 20; display: none; background: rgba(17, 24, 39, .36); }
    .doc-viewer.open { display: grid; place-items: center; }
    .doc-viewer-shell { width: min(1180px, calc(100vw - 32px)); height: min(780px, calc(100vh - 32px)); display: grid; grid-template-rows: auto minmax(0, 1fr); border: 1px solid var(--line); border-radius: 8px; background: #fff; box-shadow: 0 24px 80px rgba(15, 23, 42, .28); overflow: hidden; }
    .doc-viewer-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
    .doc-viewer-title { min-width: 0; }
    .doc-viewer-title strong { display: block; font-size: 14px; }
    .doc-viewer-body { display: grid; grid-template-columns: 300px minmax(0, 1fr); min-height: 0; }
    .doc-list { overflow: auto; border-right: 1px solid var(--line); padding: 12px; background: #fbfbf9; }
    .doc-option { width: 100%; display: block; margin: 0 0 8px; text-align: left; }
    .doc-option.active { border-color: var(--accent); background: #e7f5f2; color: #064e45; }
    .doc-reader { min-width: 0; overflow: auto; padding: 24px 30px 42px; }
    .doc-page { display: none; max-width: 920px; }
    .doc-page.active { display: block; }
    .doc-page h2 { margin: 0 0 10px; font-size: 24px; line-height: 1.2; }
    .doc-meta-row { display: flex; flex-wrap: wrap; gap: 7px; margin: 0 0 18px; }
    .doc-meta-row span { border: 1px solid var(--line); border-radius: 999px; padding: 4px 8px; font-size: 12px; color: #475569; background: #f8fafc; }
    .markdown-body { font-size: 14px; line-height: 1.65; }
    .markdown-body h1 { margin: 0 0 16px; font-size: 25px; }
    .markdown-body h2 { margin: 24px 0 8px; padding-bottom: 5px; border-bottom: 1px solid #e2e8f0; font-size: 19px; }
    .markdown-body h3 { margin: 18px 0 7px; font-size: 15px; }
    .markdown-body p { margin: 8px 0; }
    .markdown-body ul { margin: 8px 0 14px 20px; padding: 0; }
    .markdown-body li { margin: 4px 0; }
    .markdown-body code { border: 1px solid #e2e8f0; border-radius: 4px; background: #f1f5f9; padding: 1px 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
    @media (max-width: 940px) {
      header { grid-template-columns: 1fr; padding: 14px 16px 12px; }
      .toolbar { justify-content: flex-start; }
      main { grid-template-columns: 1fr; height: auto; }
      .viewport { height: 72vh; min-height: 520px; }
      aside { border-left: 0; border-top: 1px solid var(--line); }
      .doc-viewer-body { grid-template-columns: 1fr; }
      .doc-list { max-height: 220px; border-right: 0; border-bottom: 1px solid var(--line); }
      .doc-reader { padding: 18px; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Platty Service Map</h1>
      <div class="subtle">Project ${escapeHtml(artifact.projectId)} - Generated ${escapeHtml(artifact.generatedAt)}</div>
      <div class="stats">
        <div class="stat">Nodes ${artifact.summary.nodeCount}</div>
        <div class="stat">Edges ${artifact.summary.edgeCount}</div>
        <div class="stat">Unresolved ${artifact.summary.unresolvedEdgeCount}</div>
        <div class="stat">Node types ${escapeHtml(compactCounts(artifact.summary.nodeTypeCounts))}</div>
      </div>
    </div>
    <div class="toolbar">
      <button id="zoomOut" type="button">-</button>
      <button id="zoomIn" type="button">+</button>
      <button id="fit" type="button">Fit</button>
      <button id="reset" type="button">Reset</button>
    </div>
  </header>
  <main>
    <section class="viewport">
      <canvas id="graphCanvas"></canvas>
      <div class="hud">
        <span id="zoomHud">100%</span>
        <span id="visibleHud">0 visible</span>
        <span id="hoverHud">Ready</span>
      </div>
    </section>
    <aside>
      <div class="side">
        <h2>Explore</h2>
        <div class="stack">
          <input id="search" type="search" placeholder="Search nodes, APIs, repos">
          <div class="row">
            <select id="repoFilter"><option value="">All repos</option></select>
            <select id="labelMode">
              <option value="smart">Smart labels</option>
              <option value="all">All labels</option>
              <option value="none">No labels</option>
            </select>
          </div>
          <label><input id="edgeToggle" type="checkbox" checked> Show edges</label>
        </div>
        <h3>Node Types</h3>
        <div id="typeChecks" class="checks"></div>
        <h3>Repositories</h3>
        <div id="repoList" class="stack"></div>
        ${businessContextHtml}
        <h3>Selected</h3>
        <div id="detail" class="item detail subtle">Click a node or repo zone.</div>
      </div>
    </aside>
  </main>
  <script>window.__PLATTY_SERVICE_MAP__=${payload};</script>
  <script>
(() => {
  const artifact = window.__PLATTY_SERVICE_MAP__;
  const graph = artifact.views.allNodes;
  const repoMap = artifact.views.repoMap;
  const canvas = document.getElementById('graphCanvas');
  const ctx = canvas.getContext('2d');
  const state = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
    dragX: 0,
    dragY: 0,
    hoverNode: null,
    selectedNode: null,
    selectedRepo: null,
    query: '',
    repo: '',
    labelMode: 'smart',
    showEdges: true,
    types: new Set(Object.keys(artifact.summary.nodeTypeCounts)),
  };

  const colors = {
    api: '#2563eb',
    db: '#7c3aed',
    event: '#db2777',
    external_link: '#b45309',
    external_service: '#ea580c',
    job: '#0891b2',
    screen: '#16a34a',
  };
  const nodes = graph.nodes.map((node) => ({ ...node, x: 0, y: 0, visible: true, degree: 0 }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = graph.edges.map((edge) => ({ ...edge, sourceNode: nodeById.get(edge.source), targetNode: nodeById.get(edge.target) }));
  for (const edge of edges) {
    if (edge.sourceNode) edge.sourceNode.degree += 1;
    if (edge.targetNode) edge.targetNode.degree += 1;
  }
  const repoGroups = buildRepoGroups(nodes);
  layoutNodes(repoGroups);
  initControls();
  resize();
  fitToGraph();
  draw();

  window.addEventListener('resize', () => { resize(); draw(); });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', onMouseUp);
  canvas.addEventListener('click', onClick);

  function buildRepoGroups(allNodes) {
    const groups = new Map();
    for (const node of allNodes) {
      const key = nodeGroupKey(node);
      if (!groups.has(key)) groups.set(key, { id: key, label: node.repoLabel || key, nodes: [], x: 0, y: 0, radius: 0 });
      groups.get(key).nodes.push(node);
    }
    return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  function layoutNodes(groups) {
    const maxCount = Math.max(...groups.map((repo) => repo.nodes.length));
    const maxRadius = Math.max(260, Math.sqrt(maxCount) * 23 + 90);
    const columns = Math.max(1, Math.ceil(Math.sqrt(groups.length)));
    const cell = Math.ceil(maxRadius * 2 + 240);
    groups.forEach((repo, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      repo.radius = Math.max(180, Math.sqrt(repo.nodes.length) * 23 + 90);
      repo.x = 80 + column * cell + cell / 2;
      repo.y = 80 + row * cell + cell / 2;
      repo.nodes.sort((a, b) => (b.degree - a.degree) || a.label.localeCompare(b.label));
      repo.nodes.forEach((node, nodeIndex) => {
        if (repo.nodes.length === 1) {
          node.x = repo.x;
          node.y = repo.y;
          return;
        }
        const angle = nodeIndex * 2.399963229728653;
        const distance = Math.sqrt((nodeIndex + 1) / repo.nodes.length) * (repo.radius - 64);
        node.x = repo.x + Math.cos(angle) * distance;
        node.y = repo.y + Math.sin(angle) * distance;
      });
    });
  }

  function initControls() {
    document.getElementById('zoomIn').addEventListener('click', () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.22));
    document.getElementById('zoomOut').addEventListener('click', () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1 / 1.22));
    document.getElementById('fit').addEventListener('click', () => { fitToGraph(); draw(); });
    document.getElementById('reset').addEventListener('click', () => { state.query = ''; state.repo = ''; state.types = new Set(Object.keys(artifact.summary.nodeTypeCounts)); syncControls(); applyFilters(); fitToGraph(); draw(); });
    document.getElementById('search').addEventListener('input', (event) => { state.query = event.target.value.toLowerCase().trim(); applyFilters(); draw(); });
    document.getElementById('repoFilter').addEventListener('change', (event) => { state.repo = event.target.value; applyFilters(); draw(); });
    document.getElementById('labelMode').addEventListener('change', (event) => { state.labelMode = event.target.value; draw(); });
    document.getElementById('edgeToggle').addEventListener('change', (event) => { state.showEdges = event.target.checked; draw(); });
    initDocViewer();

    const repoSelect = document.getElementById('repoFilter');
    for (const repo of repoGroups) {
      const option = document.createElement('option');
      option.value = repo.id;
      option.textContent = repo.label;
      repoSelect.appendChild(option);
    }
    syncControls();
  }

  function initDocViewer() {
    const open = document.getElementById('openDocViewer');
    const overlay = document.getElementById('docViewerOverlay');
    const close = document.getElementById('closeDocViewer');
    if (!open || !overlay || !close) return;
    open.addEventListener('click', () => overlay.classList.add('open'));
    close.addEventListener('click', () => overlay.classList.remove('open'));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) overlay.classList.remove('open');
    });
    for (const option of overlay.querySelectorAll('.doc-option')) {
      option.addEventListener('click', () => {
        const docId = option.getAttribute('data-doc-id');
        for (const candidate of overlay.querySelectorAll('.doc-option')) candidate.classList.toggle('active', candidate === option);
        for (const page of overlay.querySelectorAll('.doc-page')) page.classList.toggle('active', page.getAttribute('data-doc-id') === docId);
      });
    }
  }

  function syncControls() {
    document.getElementById('search').value = state.query;
    document.getElementById('repoFilter').value = state.repo;
    document.getElementById('labelMode').value = state.labelMode;
    document.getElementById('edgeToggle').checked = state.showEdges;
    const typeChecks = document.getElementById('typeChecks');
    typeChecks.innerHTML = '';
    for (const [type, count] of Object.entries(artifact.summary.nodeTypeCounts)) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = state.types.has(type);
      input.addEventListener('change', () => {
        if (input.checked) state.types.add(type);
        else state.types.delete(type);
        applyFilters();
        draw();
      });
      label.appendChild(input);
      label.appendChild(document.createTextNode(type + ' ' + count));
      typeChecks.appendChild(label);
    }
    const repoList = document.getElementById('repoList');
    repoList.innerHTML = '';
    for (const repo of repoMap.nodes) {
      const item = document.createElement('button');
      item.type = 'button';
      item.textContent = repo.label + ' - ' + (repo.count || 0);
      item.addEventListener('click', () => {
        state.repo = repo.id.startsWith('repo:') ? repo.id.replace(/^repo:/, '') : repo.id;
        document.getElementById('repoFilter').value = state.repo;
        applyFilters();
        focusRepo(state.repo);
        draw();
      });
      repoList.appendChild(item);
    }
  }

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
    canvas.height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function graphBounds() {
    const padding = 160;
    const minX = Math.min(...repoGroups.map((repo) => repo.x - repo.radius)) - padding;
    const minY = Math.min(...repoGroups.map((repo) => repo.y - repo.radius)) - padding;
    const maxX = Math.max(...repoGroups.map((repo) => repo.x + repo.radius)) + padding;
    const maxY = Math.max(...repoGroups.map((repo) => repo.y + repo.radius)) + padding;
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  function fitToGraph() {
    const bounds = graphBounds();
    const scale = Math.min(canvas.clientWidth / bounds.width, canvas.clientHeight / bounds.height);
    state.scale = clamp(scale, 0.08, 2.5);
    state.offsetX = (canvas.clientWidth - bounds.width * state.scale) / 2 - bounds.minX * state.scale;
    state.offsetY = (canvas.clientHeight - bounds.height * state.scale) / 2 - bounds.minY * state.scale;
  }

  function focusRepo(repoId) {
    const repo = repoGroups.find((candidate) => candidate.id === repoId);
    if (!repo) return;
    const scale = clamp(Math.min(canvas.clientWidth, canvas.clientHeight) / (repo.radius * 2.6), 0.18, 2.8);
    state.scale = scale;
    state.offsetX = canvas.clientWidth / 2 - repo.x * scale;
    state.offsetY = canvas.clientHeight / 2 - repo.y * scale;
  }

  function applyFilters() {
    const query = state.query;
    for (const node of nodes) {
      const searchable = [node.label, node.detail, node.repoLabel, node.type].filter(Boolean).join(' ').toLowerCase();
      node.visible = state.types.has(node.type)
        && (!state.repo || nodeGroupKey(node) === state.repo || node.repoId === state.repo)
        && (!query || searchable.includes(query));
    }
    updateHud();
  }

  function draw() {
    resize();
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    ctx.save();
    ctx.translate(state.offsetX, state.offsetY);
    ctx.scale(state.scale, state.scale);
    drawRepos();
    if (state.showEdges) drawEdges();
    drawNodes();
    ctx.restore();
    updateHud();
  }

  function drawRepos() {
    for (const repo of repoGroups) {
      const visibleCount = repo.nodes.filter((node) => node.visible).length;
      ctx.beginPath();
      ctx.arc(repo.x, repo.y, repo.radius, 0, Math.PI * 2);
      ctx.fillStyle = visibleCount ? '#f1f5f9' : '#f8fafc';
      ctx.strokeStyle = visibleCount ? '#94a3b8' : '#e2e8f0';
      ctx.lineWidth = 2 / state.scale;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1f2937';
      ctx.font = Math.max(16, 26 / state.scale) + 'px Inter, sans-serif';
      ctx.fillText(repo.label, repo.x - repo.radius + 24, repo.y - repo.radius + 38);
      ctx.fillStyle = '#64748b';
      ctx.font = Math.max(10, 13 / state.scale) + 'px Inter, sans-serif';
      ctx.fillText(visibleCount + ' / ' + repo.nodes.length + ' nodes', repo.x - repo.radius + 24, repo.y - repo.radius + 60);
    }
  }

  function drawEdges() {
    if (state.scale < 0.16 && !state.query && !state.selectedNode) return;
    ctx.lineWidth = Math.max(0.7, 1.1 / state.scale);
    for (const edge of edges) {
      if (!edge.sourceNode || !edge.targetNode) continue;
      if (!edge.sourceNode.visible || !edge.targetNode.visible) continue;
      const highlight = state.selectedNode && (edge.sourceNode.id === state.selectedNode.id || edge.targetNode.id === state.selectedNode.id);
      if (!highlight && state.scale < 0.45 && !state.query) continue;
      ctx.beginPath();
      ctx.moveTo(edge.sourceNode.x, edge.sourceNode.y);
      ctx.lineTo(edge.targetNode.x, edge.targetNode.y);
      ctx.strokeStyle = highlight ? '#111827' : edge.unresolved ? 'rgba(180,83,9,.42)' : 'rgba(100,116,139,.16)';
      ctx.stroke();
    }
  }

  function drawNodes() {
    const showAllLabels = state.labelMode === 'all';
    const showSmartLabels = state.labelMode === 'smart';
    for (const node of nodes) {
      if (!node.visible) continue;
      const radius = nodeRadius(node);
      const selected = state.selectedNode && state.selectedNode.id === node.id;
      const hovered = state.hoverNode && state.hoverNode.id === node.id;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = colors[node.type] || '#475569';
      ctx.strokeStyle = selected || hovered ? '#111827' : '#fff';
      ctx.lineWidth = (selected || hovered ? 3 : 1.4) / state.scale;
      ctx.fill();
      ctx.stroke();
      const labelAllowed = showAllLabels || (showSmartLabels && (state.scale > 0.58 || node.degree >= 10 || selected || hovered || state.query));
      if (labelAllowed) drawNodeLabel(node, radius);
    }
  }

  function drawNodeLabel(node, radius) {
    const text = trim(node.label, state.scale > 1.1 ? 42 : 30);
    const x = node.x + radius + 5 / state.scale;
    const y = node.y - 2 / state.scale;
    ctx.font = Math.max(9, 11 / state.scale) + 'px Inter, sans-serif';
    const width = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(255,255,255,.82)';
    ctx.fillRect(x - 2 / state.scale, y - 11 / state.scale, width + 4 / state.scale, 15 / state.scale);
    ctx.fillStyle = '#111827';
    ctx.fillText(text, x, y);
  }

  function nodeRadius(node) {
    const base = node.type === 'db' ? 6 : node.type === 'api' ? 7 : 6.5;
    return base + Math.min(5, Math.sqrt(node.degree) * 0.55);
  }

  function nodeGroupKey(node) {
    if (node.repoId) return node.repoId;
    const label = String(node.repoLabel || 'Unassigned').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return 'group:' + (label || 'unassigned');
  }

  function onWheel(event) {
    event.preventDefault();
    zoomAt(event.offsetX, event.offsetY, event.deltaY < 0 ? 1.16 : 1 / 1.16);
  }

  function zoomAt(screenX, screenY, factor) {
    const before = screenToWorld(screenX, screenY);
    state.scale = clamp(state.scale * factor, 0.05, 5);
    state.offsetX = screenX - before.x * state.scale;
    state.offsetY = screenY - before.y * state.scale;
    draw();
  }

  function onMouseDown(event) {
    state.dragging = true;
    state.dragX = event.clientX;
    state.dragY = event.clientY;
    canvas.classList.add('dragging');
  }

  function onMouseMove(event) {
    if (state.dragging) {
      state.offsetX += event.clientX - state.dragX;
      state.offsetY += event.clientY - state.dragY;
      state.dragX = event.clientX;
      state.dragY = event.clientY;
      draw();
      return;
    }
    const point = screenToWorld(event.offsetX, event.offsetY);
    state.hoverNode = nearestVisibleNode(point, 12 / state.scale);
    document.getElementById('hoverHud').textContent = state.hoverNode ? state.hoverNode.label : 'Ready';
    draw();
  }

  function onMouseUp() {
    state.dragging = false;
    canvas.classList.remove('dragging');
  }

  function onClick(event) {
    const point = screenToWorld(event.offsetX, event.offsetY);
    const node = nearestVisibleNode(point, 14 / state.scale);
    if (node) {
      state.selectedNode = node;
      state.selectedRepo = null;
      renderDetail(nodeDetail(node));
      draw();
      return;
    }
    const repo = repoGroups.find((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= candidate.radius);
    if (repo) {
      state.selectedNode = null;
      state.selectedRepo = repo;
      renderDetail(repoDetail(repo));
      draw();
    }
  }

  function nearestVisibleNode(point, threshold) {
    let best = null;
    let bestDistance = threshold;
    for (const node of nodes) {
      if (!node.visible) continue;
      const distance = Math.hypot(node.x - point.x, node.y - point.y);
      if (distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
    }
    return best;
  }

  function screenToWorld(x, y) {
    return { x: (x - state.offsetX) / state.scale, y: (y - state.offsetY) / state.scale };
  }

  function nodeDetail(node) {
    const adjacent = edges
      .filter((edge) => edge.sourceNode?.id === node.id || edge.targetNode?.id === node.id)
      .slice(0, 12)
      .map((edge) => '<div class="subtle">' + escapeHtml(edge.kind + ': ' + (edge.detail || '')) + '</div>')
      .join('');
    return '<strong>' + escapeHtml(node.label) + '</strong>'
      + '<div class="subtle">type: ' + escapeHtml(node.type) + '</div>'
      + '<div class="subtle">repo: ' + escapeHtml(node.repoLabel || node.repoId || 'External') + '</div>'
      + (node.detail ? '<div class="subtle">detail: ' + escapeHtml(node.detail) + '</div>' : '')
      + '<h3>Relations</h3>' + (adjacent || '<div class="subtle">No visible relations</div>');
  }

  function repoDetail(repo) {
    const counts = {};
    for (const node of repo.nodes) counts[node.type] = (counts[node.type] || 0) + 1;
    return '<strong>' + escapeHtml(repo.label) + '</strong>'
      + '<div class="subtle">' + repo.nodes.length + ' nodes</div>'
      + '<div class="subtle">' + escapeHtml(Object.entries(counts).map(([key, count]) => key + ' ' + count).join(', ')) + '</div>';
  }

  function renderDetail(html) {
    const detail = document.getElementById('detail');
    detail.classList.remove('subtle');
    detail.innerHTML = html;
  }

  function updateHud() {
    const visible = nodes.filter((node) => node.visible).length;
    document.getElementById('zoomHud').textContent = Math.round(state.scale * 100) + '%';
    document.getElementById('visibleHud').textContent = visible + ' visible';
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function trim(value, max) {
    return value.length > max ? value.slice(0, max - 3) + '...' : value;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
  </script>
</body>
</html>
`
}

function safeJson(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function compactCounts(counts: Record<string, number>) {
  const text = Object.entries(counts).map(([key, count]) => `${key} ${count}`).join(', ')
  return text || 'none'
}

function renderBusinessContextHtml(artifact: BusinessMapArtifact) {
  const domains = artifact.views.businessContext.domains
  const documents = domains.flatMap((domain) =>
    domain.epics.flatMap((epic) =>
      epic.documents.map((doc) => ({
        ...doc,
        domainName: domain.name,
        epicName: epic.name,
      })),
    ),
  )
  const domainHtml = domains
    .map((domain) => {
      const epics = domain.epics
        .map((epic) => {
          const docs = epic.documents
            .slice(0, 6)
            .map((doc) => `<div class="subtle">${escapeHtml(doc.type.toUpperCase())}: ${escapeHtml(doc.title)}</div>`)
            .join('')
          return `<div class="item"><strong>${escapeHtml(epic.name)}</strong><div class="subtle">${epic.documents.length} docs, ${epic.itemCount} items</div>${docs}</div>`
        })
        .join('')
      return `<div class="stack"><div class="item"><strong>${escapeHtml(domain.name)}</strong><div class="subtle">${domain.epics.length} EPICs</div></div>${epics}</div>`
    })
    .join('')
  const viewerHtml = renderDocumentViewerHtml(documents)
  return `
        <h3>Business Context</h3>
        <div class="stack">
          <div class="item">
            <strong>${artifact.summary.domainCount} domains / ${artifact.summary.epicCount} EPICs</strong>
            <div class="subtle">${artifact.summary.businessDocumentCount} business docs, ${artifact.summary.ucsCount} UCS, ${artifact.summary.epicDependencyCount} EPIC links</div>
          </div>
          ${viewerHtml}
          ${domainHtml || '<div class="item subtle">No EPIC or business document data yet.</div>'}
        </div>`
}

function renderDocumentViewerHtml(documents: Array<BusinessMapArtifact['views']['businessContext']['domains'][number]['epics'][number]['documents'][number] & { domainName: string; epicName: string }>) {
  if (!documents.length) return ''
  const firstId = documents[0]?.id
  const buttons = documents.map((doc, index) => `
            <button class="doc-option${index === 0 ? ' active' : ''}" type="button" data-doc-id="${escapeAttribute(doc.id)}">
              <strong>${escapeHtml(doc.title)}</strong>
              <div class="subtle">${escapeHtml(doc.type)} / ${escapeHtml(doc.epicName)}</div>
            </button>`).join('')
  const pages = documents.map((doc) => `
          <section class="doc-page${doc.id === firstId ? ' active' : ''}" data-doc-id="${escapeAttribute(doc.id)}">
            <h2>${escapeHtml(doc.title)}</h2>
            <div class="doc-meta-row">
              <span>${escapeHtml(doc.type)}</span>
              <span>${escapeHtml(doc.domainName)}</span>
              <span>${escapeHtml(doc.epicName)}</span>
              <span>${escapeHtml(doc.scope)}${doc.scopeId ? ` / ${escapeHtml(doc.scopeId)}` : ''}</span>
            </div>
            <div class="markdown-body">${renderMarkdownLite(doc.markdown)}</div>
          </section>`).join('')
  return `
          <button id="openDocViewer" class="viewer-button" type="button">Document Viewer (${documents.length})</button>
          <div id="docViewerOverlay" class="doc-viewer" role="dialog" aria-modal="true" aria-label="Document Viewer">
            <div class="doc-viewer-shell">
              <div class="doc-viewer-head">
                <div class="doc-viewer-title">
                  <strong>Document Viewer</strong>
                  <div class="subtle">Business documents linked to EPICs</div>
                </div>
                <button id="closeDocViewer" type="button">Close</button>
              </div>
              <div class="doc-viewer-body">
                <nav class="doc-list">${buttons}</nav>
                <article class="doc-reader">${pages}</article>
              </div>
            </div>
          </div>`
}

function renderMarkdownLite(markdown: string) {
  const lines = markdown.split(/\r?\n/)
  const html: string[] = []
  let inList = false
  const closeList = () => {
    if (inList) {
      html.push('</ul>')
      inList = false
    }
  }
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      closeList()
      continue
    }
    if (trimmed.startsWith('### ')) {
      closeList()
      html.push(`<h3>${inlineMarkdown(trimmed.slice(4))}</h3>`)
    } else if (trimmed.startsWith('## ')) {
      closeList()
      html.push(`<h2>${inlineMarkdown(trimmed.slice(3))}</h2>`)
    } else if (trimmed.startsWith('# ')) {
      closeList()
      html.push(`<h1>${inlineMarkdown(trimmed.slice(2))}</h1>`)
    } else if (trimmed.startsWith('- ')) {
      if (!inList) {
        html.push('<ul>')
        inList = true
      }
      html.push(`<li>${inlineMarkdown(trimmed.slice(2))}</li>`)
    } else {
      closeList()
      html.push(`<p>${inlineMarkdown(trimmed)}</p>`)
    }
  }
  closeList()
  return html.join('\n')
}

function inlineMarkdown(value: string) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function escapeAttribute(value: string) {
  return escapeHtml(value)
}
