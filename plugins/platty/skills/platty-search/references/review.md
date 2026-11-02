# Review before answering

Use one reviewer subagent when the runtime offers delegation. Give it the
question, selected connection/project, draft, exact search inputs, source
ranges, data items, call inventory, candidates, and known capability gaps.
Keep it on the same authorized MCP connection. Use the active runtime's
available model; this package has no mandatory model/provider switch.

Ask it to return findings, not rewrite the answer:

1. Reproduce relevant writer-search scope where supported. Identify missing
   candidate files, incomplete repositories/pages, or written tables absent
   from W1. Do not treat a truncated result as a complete match set.
2. Reopen the root methods and compare all relevant service/mapper calls,
   calls following validators, and error handling with the call inventory.
3. Check evidence for every conclusion, unread-row claims, negative/exact-count
   audits, alternatives, and correct unavailable-tool handling. Confirm that
   the answer preserves identifiers and labels and uses the requested language.

Return: missing candidates; missing calls; up to eight concrete repair reads;
unsupported claims; capability gaps. If none, say `No omissions identified`.

Perform one repair pass and update the draft/inventory. Name gaps remaining
after repair. Record the reviewer result and repair outcome. If delegation is
unavailable, run the same checklist yourself and record `Self-review;
independent review unavailable`. Do not claim an independent review occurred.
