# Impact Seed Packet

## Runtime Invocation Context

Keep this context at invocation time; do not persist it in the reusable packet.

```text
Impact Invocation Context (runtime only; not persisted in the reusable packet):
routeMode(answer | seed-only),
routeOrigin(user | retrieval | impact | sdd-spec | sdd-design).
```

`routeMode: seed-only` requires retrieval to return the packet to its caller
without escalating back to impact. Reuse an existing packet rather than running
semantic discovery, vocabulary normalization, EPIC mapping, business-document
gates, or exact spec selection again.

## Reusable Packets

```text
Impact Seed Packet:
projectId, rawQuestion, questionBranch, selectedInterpretation, contextStatus,
surfacesAlreadyRead, normalizedTerms(rawTerms, koreanCandidateTerms,
englishCandidateTerms, matchedGlossaryTerms, codeTerms, unresolvedTerms),
selectedEpics, exactDocumentItems, selectedSpecs, apiSpecCandidates,
screenSpecCandidates, eventSpecCandidates, scheduleSpecCandidates, graphSeeds,
codeSearchSeeds, unresolvedCandidates, coverageLimits.

Search Query Packet:
projectId, repoCandidates, exactRoutes, traceIds, specTitles, graphNodeIds,
relationTargets, symbols, fileHints, rawBusinessTerms,
normalizedBusinessTerms, koreanAliases, englishAliases, codeTerms,
modelAndTableTerms, eventAndServiceTerms, crossEpicCounterpartTerms,
attemptedQueries, matchedQuery.
```

Every business item must have a selected exact spec, unresolved candidate, or
explicit gap. Preserve all tied repositories in `repoCandidates`; do not choose
one by inference. Keep each attempted query and the `matchedQuery` that made a
file or symbol a candidate.

## Workspace Discovery And Source Reads

Follow this order exactly:

```text
workspace_repo_list -> select repo -> readonly_workspace_shell search -> exact source read
```

Call `workspace_repo_list` unless the selected `repoId` and analyzed commit are
already present. Use `readonly_workspace_shell` only after selection and only
with backend-documented, read-only forms of `rg`, `git grep`, `find`,
`ls`, `cat`, and `sed`. Search exact identifiers before aliases, bound match
counts and displayed regions, retain bounded output, and retain both
`matchedQuery` and the exact read.

**A grep hit remains a candidate until its exact source region is read.**

Never write or redirect files, install dependencies, execute project code, use
command substitution, read blocked secret or credential paths, or leave or
escape the selected repo root. An excessive match set is a coverage limit:
narrow the exact identifier, record the limit, and retain the next exact read.
