import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildImpactSnapshot,
  computeEvidenceId,
  computeImpactRevision,
} from '../impact-revision.mjs';

const baseInput = {
  status: 'investigated',
  sourceParity: 'confirmed',
  projectId: 'P',
  contextStatus: 'ready:fresh',
  productSegmentRevision: 'sha256:request',
  storiesRevision: 'sha256:stories',
  sourceCommits: [
    { repoId: 'repo-b', sourceCommit: 'bbb' },
    { repoId: 'repo-a', sourceCommit: 'aaa' },
  ],
  maxCrossEpicDepth: 2,
  impactCoverageLimits: ['z-limit', 'a-limit'],
  impactEvidenceMatrix: [
    {
      targetKind: 'api',
      target: 'POST /campaigns/:id/apply',
      direction: 'outbound',
      affectedEpic: 'EPIC-42',
      traversalDepth: '0',
      businessEvidence: ['BR-2', 'BR-1'],
      specEvidence: [],
      graphEvidence: [],
      sourceEvidence: ['source'],
      repoId: 'repo-heroines',
      sourceCommit: 'commit',
      file: 'src/campaign/apply.ts',
      symbol: 'applyCampaign',
      lineStart: '120',
      lineEnd: '144',
      matchedQuery: 'applyCampaign',
      observedBehavior: 'Applies a campaign.',
      confidence: 'confirmed',
      missingEvidence: [],
      nextExactRead: '',
    },
  ],
  affectedCodePathCoverage: [
    {
      anchor: 'campaign-apply',
      resolvedDocuments: ['DOC-2', 'DOC-1'],
      graphConfirmed: [],
      graphCandidatesOrTruncation: [],
      sourceFilesReadAndRoles: ['src/campaign/apply.ts#applyCampaign'],
      consumersChecked: ['controller'],
      unreadCandidatesAndReason: [],
      status: 'confirmed-path',
      nextExactRead: '',
    },
  ],
  crossEpicTraversal: {
    frontierEpicIds: [],
    visitedEpicIds: ['EPIC-42'],
    visitedSpecIds: [],
    visitedGraphSeeds: [],
    visitedCodeQueries: [],
    confirmedEdges: [],
    likelyEdges: [],
    candidateEdges: [],
    currentDepth: 0,
    maxDepth: 2,
    truncationReasons: [],
  },
};

test('computes the normative evidence id vector', () => {
  assert.equal(
    computeEvidenceId(baseInput.impactEvidenceMatrix[0]),
    'sha256:7ea5216a2dc21bca319602d4e0aaaa4be612f865e3b9c28e52d15a199277aab0',
  );
});

test('uses one exact canonical top-level impact snapshot schema', () => {
  const snapshot = buildImpactSnapshot(baseInput);

  assert.deepEqual(Object.keys(snapshot), [
    'affectedCodePathCoverage',
    'contextStatus',
    'crossEpicTraversal',
    'impactCoverageLimits',
    'impactEvidenceMatrix',
    'maxCrossEpicDepth',
    'productSegmentRevision',
    'projectId',
    'sourceCommits',
    'sourceParity',
    'status',
    'storiesRevision',
  ]);
  assert.equal(snapshot.impactEvidenceMatrix[0].evidenceId, computeEvidenceId(baseInput.impactEvidenceMatrix[0]));
});

test('set-like input order does not change impactRevision', () => {
  const reordered = structuredClone(baseInput);
  reordered.sourceCommits.reverse();
  reordered.impactCoverageLimits.reverse();
  reordered.impactEvidenceMatrix[0].businessEvidence.reverse();
  reordered.affectedCodePathCoverage[0].resolvedDocuments.reverse();

  assert.equal(computeImpactRevision(reordered), computeImpactRevision(baseInput));
});

test('evidence changes create a new impactRevision', () => {
  const changed = structuredClone(baseInput);
  changed.impactEvidenceMatrix[0].observedBehavior = 'Applies and audits a campaign.';

  assert.notEqual(computeImpactRevision(changed), computeImpactRevision(baseInput));
});

test('rejects a supplied evidence id that does not match its locator tuple', () => {
  const mismatched = structuredClone(baseInput);
  mismatched.impactEvidenceMatrix[0].evidenceId = 'sha256:not-the-locator-id';

  assert.throws(() => buildImpactSnapshot(mismatched), /evidenceId mismatch/);
});
