# Preserved storage contracts

These engines read and continue pre-naming sessions without rewriting content,
review hashes, user confirmations, or historical evidence. The public controller
routes legacy sessions here and presents semantic stage names. New sessions use
the named modules in the parent directory.

The historical module/template APIs remain available through thin parent-level
wrappers. Tests with numbered module names intentionally lock these old storage
contracts. New behavior and named-schema tests live in test_named_models.py and
test_named_session.py.

Engine copies preserve old validation rules; internal imports and project-root
resolution are adjusted for this location. Audit version capture points to the
actual preserved engines. routing.py is the explicit CLI/display compatibility
boundary. Do not restamp historical confirmations as a migration shortcut.
