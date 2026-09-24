# tests

Tests live in `tests/<module>/` and are owned by the owner of the matching `src/<module>/` (docs/ORCHESTRATION.md §2). `tests/tooling/` holds root-tooling smoke tests and is owned by `contract-architect`.

Tests never call a real model provider; use `FakeProvider` with recordings (D7).
