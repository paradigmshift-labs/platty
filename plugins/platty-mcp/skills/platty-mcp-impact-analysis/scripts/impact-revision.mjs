#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MATRIX_SCALARS = [
  'evidenceId',
  'target',
  'targetKind',
  'direction',
  'affectedEpic',
  'traversalDepth',
  'repoId',
  'sourceCommit',
  'file',
  'symbol',
  'lineStart',
  'lineEnd',
  'matchedQuery',
  'observedBehavior',
  'confidence',
  'nextExactRead',
];

const MATRIX_ARRAYS = [
  'businessEvidence',
  'specEvidence',
  'graphEvidence',
  'sourceEvidence',
  'missingEvidence',
];

const COVERAGE_SCALARS = ['anchor', 'status', 'nextExactRead'];
const COVERAGE_ARRAYS = [
  'resolvedDocuments',
  'graphConfirmed',
  'graphCandidatesOrTruncation',
  'sourceFilesReadAndRoles',
  'consumersChecked',
  'unreadCandidatesAndReason',
];

const EDGE_SCALARS = [
  'sourceEpicId',
  'targetEpicId',
  'direction',
  'originLayer',
  'sourceDocumentId',
  'documentId',
  'documentType',
  'originalKind',
  'derivedKind',
  'role',
  'reason',
  'confidence',
];

const EDGE_ARRAYS = ['sourceDocumentIds', 'relationIds'];
const TRAVERSAL_STRING_ARRAYS = [
  'frontierEpicIds',
  'visitedEpicIds',
  'visitedSpecIds',
  'visitedGraphSeeds',
  'visitedCodeQueries',
  'truncationReasons',
];
const TRAVERSAL_EDGE_ARRAYS = ['confirmedEdges', 'likelyEdges', 'candidateEdges'];

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function scalar(value) {
  return value === undefined || value === null ? '' : String(value).replaceAll('\r\n', '\n');
}

function sortedStrings(value) {
  const input = Array.isArray(value) ? value : [];
  return [...new Set(input.map(scalar))].sort(compareUtf8);
}

function canonicalValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareUtf8)
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function sortCanonicalObjects(values) {
  return values
    .map((value) => canonicalValue(value))
    .sort((left, right) => compareUtf8(canonicalJson(left), canonicalJson(right)));
}

function normalizeInteger(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, received: ${value}`);
  }
  return parsed;
}

export function computeEvidenceId(row) {
  const tuple = [
    'targetKind',
    'target',
    'direction',
    'affectedEpic',
    'repoId',
    'file',
    'symbol',
    'lineStart',
    'lineEnd',
  ].map((field) => scalar(row?.[field]));
  return digest(JSON.stringify(tuple));
}

function normalizeMatrixRow(row = {}) {
  const normalized = {};
  for (const field of MATRIX_SCALARS) {
    normalized[field] = scalar(row[field]);
  }
  for (const field of MATRIX_ARRAYS) {
    normalized[field] = sortedStrings(row[field]);
  }

  const computedEvidenceId = computeEvidenceId(normalized);
  if (normalized.evidenceId && normalized.evidenceId !== computedEvidenceId) {
    throw new Error(
      `Impact evidenceId mismatch for ${normalized.target || '<unnamed>'}: ` +
        `${normalized.evidenceId} != ${computedEvidenceId}`,
    );
  }
  normalized.evidenceId = computedEvidenceId;
  return canonicalValue(normalized);
}

function normalizeCoverageRow(row = {}) {
  const normalized = {};
  for (const field of COVERAGE_SCALARS) {
    normalized[field] = scalar(row[field]);
  }
  for (const field of COVERAGE_ARRAYS) {
    normalized[field] = sortedStrings(row[field]);
  }
  return canonicalValue(normalized);
}

function normalizeEdge(edge = {}) {
  const normalized = {};
  for (const field of EDGE_SCALARS) {
    normalized[field] = scalar(edge[field]);
  }
  for (const field of EDGE_ARRAYS) {
    normalized[field] = sortedStrings(edge[field]);
  }
  return canonicalValue(normalized);
}

function normalizeTraversal(traversal = {}, defaultMaxDepth = 2) {
  const normalized = {};
  for (const field of TRAVERSAL_STRING_ARRAYS) {
    normalized[field] = sortedStrings(traversal[field]);
  }
  for (const field of TRAVERSAL_EDGE_ARRAYS) {
    const edges = Array.isArray(traversal[field]) ? traversal[field].map(normalizeEdge) : [];
    normalized[field] = sortCanonicalObjects(edges);
  }
  normalized.currentDepth = normalizeInteger(traversal.currentDepth, 0);
  normalized.maxDepth = normalizeInteger(traversal.maxDepth, defaultMaxDepth);
  return canonicalValue(normalized);
}

function normalizeSourceCommits(sourceCommits) {
  const commits = Array.isArray(sourceCommits)
    ? sourceCommits.map((entry) => ({
        repoId: scalar(entry?.repoId),
        sourceCommit: scalar(entry?.sourceCommit),
      }))
    : [];
  return commits.sort((left, right) => {
    const repoOrder = compareUtf8(left.repoId, right.repoId);
    return repoOrder === 0 ? compareUtf8(left.sourceCommit, right.sourceCommit) : repoOrder;
  });
}

export function buildImpactSnapshot(input = {}) {
  const maxCrossEpicDepth = normalizeInteger(input.maxCrossEpicDepth, 2);
  const matrix = Array.isArray(input.impactEvidenceMatrix)
    ? input.impactEvidenceMatrix.map(normalizeMatrixRow)
    : [];
  matrix.sort((left, right) => compareUtf8(left.evidenceId, right.evidenceId));

  const coverage = Array.isArray(input.affectedCodePathCoverage)
    ? input.affectedCodePathCoverage.map(normalizeCoverageRow)
    : [];

  return {
    affectedCodePathCoverage: sortCanonicalObjects(coverage),
    contextStatus: scalar(input.contextStatus),
    crossEpicTraversal: normalizeTraversal(input.crossEpicTraversal, maxCrossEpicDepth),
    impactCoverageLimits: sortedStrings(input.impactCoverageLimits),
    impactEvidenceMatrix: matrix,
    maxCrossEpicDepth,
    productSegmentRevision: scalar(input.productSegmentRevision),
    projectId: scalar(input.projectId),
    sourceCommits: normalizeSourceCommits(input.sourceCommits),
    sourceParity: scalar(input.sourceParity),
    status: scalar(input.status),
    storiesRevision: scalar(input.storiesRevision),
  };
}

export function computeImpactRevision(input) {
  return digest(canonicalJson(buildImpactSnapshot(input)));
}

function runCli() {
  const inputPath = process.argv[2];
  const printSnapshot = process.argv.includes('--json');
  const raw = inputPath && inputPath !== '-' ? readFileSync(inputPath, 'utf8') : readFileSync(0, 'utf8');
  const input = JSON.parse(raw);
  const snapshot = buildImpactSnapshot(input);
  const impactRevision = digest(canonicalJson(snapshot));

  if (printSnapshot) {
    process.stdout.write(`${JSON.stringify({ impactRevision, snapshot })}\n`);
    return;
  }
  process.stdout.write(`${impactRevision}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
