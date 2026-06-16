# NodeToolbox Constitution

> Canonical engineering principles for this project. The binding Articles are
> maintained in `.github/copilot-instructions.md` and the global `CLAUDE.md`;
> this file incorporates them by reference so the Spec Kit pipeline
> (`/speckit-plan`, `/speckit-analyze`) has a formal constitution to validate against.

## Principles (MUST)

- **Article III — Branching**: All work on feature branches (`feature|fix|chore|docs|hotfix|release/*`); never commit to `main`; every merge to `main` via a reviewed change.
- **Article IV — Code Quality**: Self-documenting names (no single-letter vars except loop indices / HTTP handler params); booleans prefixed `is/has/can/should/was`; functions verb-first and under 40 lines; no magic numbers; a purpose comment per file and a doc comment per exported function.
- **Article V — Testing**: TDD (red → green → refactor). Unit tests mock all I/O and run fast; integration tests use real infrastructure; UX tests use real events. A failing test precedes the implementation.
- **Article VI — Documentation**: `CHANGELOG.md` is the single source of truth for behaviour changes; do not create ad-hoc summary/status docs. The per-feature `specs/<feature>/` tree is the exempt Spec Kit pipeline artifact.
- **Article VII — Framework-First**: Before building infrastructure, confirm the governing framework/codebase does not already provide it; build custom only against a documented gap, recorded at the component.
- **Article VIII — Release**: Releases use the local pipeline (`scripts/local-release.ps1`) only; never GitHub Actions.
- **Article IX — Vault Zero-Knowledge**: Secrets are injected by the Forge Vault; a secret value never enters the conversation, a file, or a log.
- **Article X — Verification & Proof**: "It compiles" / "returned 200" is not proof; behaviour is verified with evidence.
- **Article XI — Output Restraint**: At most one dashboard artifact; no narration of internal phase names; no unsolicited Markdown summaries.

## Authority

Constitution conflicts found by `/speckit-analyze` are CRITICAL and require adjusting
the spec, plan, or tasks — not diluting the principle. Changing a principle itself is a
separate, explicit edit to this file and the source Articles.
