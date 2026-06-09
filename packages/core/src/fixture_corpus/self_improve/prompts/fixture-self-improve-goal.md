# Fixture Self-Improve Goal

Create or validate a fixture expected-output candidate from fixture source evidence.

Rules:

- Inspect fixture source files and metadata before deciding.
- Do not copy actual pipeline output into the candidate.
- Keep pipeline fixes narrow and preserve contracted stage interfaces.
- Treat service-scope fixtures as report-only unless a human explicitly approves promotion.
- Return structured evidence with confidence for every promoted candidate.
