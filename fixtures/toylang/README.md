# fixtures/toylang

**Owner:** `contract-architect` (WP-03).

Synthetic language `toylang`. Until Gate G4 this is the only language allowed in fixtures (D5).

- `SPEC.md` — the language, the traps and which examples cover them, the sample-repo traps, and how the fixture Rule Set relates to all of it. Start here.
- `skills/` — Skill files (the `<skills-dir>` for `lsc ingest`, `lsc test`, `lsc compile`).
- `examples/` — sidecar examples (`examples/<construct>/<id>.tl` + `<id>.expect.yaml`).
- `sample-repo/` — unlabelled repository sample (`--sample`).

Example format: `src/examples/README.md`. If you edit a Skill file, update its `sha256` in `contract/fixtures/toylang.ruleset.json` (a test checks it).
