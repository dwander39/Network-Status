# Project workflow

## Roles

| Role | Responsibility |
|---|---|
| **ChatGPT** | Orchestrator: builds work-package prompts, owns phase scope and sequencing |
| **Claude** | Primary builder: implements, runs focused build-time verification, documents |
| **Codex** | Independent verifier: broad regression, architecture/doc consistency, test-quality review, final-lock recommendation |
| **User** | Manual UI verification and final approval authority |

A builder's own passing checks never close a phase.

## Phase gates

Every work package or phase goes through, in order:

1. **Bounded scope**: written up front, including what is explicitly out of scope.
2. **Implementation** by the builder.
3. **Focused builder verification**: `npm run verify` plus the tests for the changed areas.
4. **Independent Codex verification**: broad regression and review.
5. **Manual UI verification** by the user when the phase touches UI or runtime behavior
   (see `docs/MANUAL-UI-CHECKLIST.md`, extended per phase).
6. **Documentation reconciliation**: `docs/CURRENT-STATE.md`, `docs/ARCHITECTURE.md` and
   `docs/TESTING.md` updated to match reality.
7. **Repository cleanliness**: clean working tree, no secrets, no generated artifacts committed,
   `git diff --check` clean.
8. **Commit and push** to `origin` (`https://github.com/dwander39/Network-Status.git`).
9. **Final-lock verification** before the next phase begins.

## Repository conventions

- Default branch `main`; remote `origin` = Network-Status. The earlier GitHub repo
  `dwander39/SystemStatus` is kept as remote `systemstatus` (history is identical up to the baseline).
- Commit subjects follow `type(scope): summary` (e.g. `feat(map): …`, `fix(arp): …`, `chore(baseline): …`).
- Keep each file's existing line endings until a dedicated normalization commit lands.
- `out/`, `release/`, `node_modules/`, `.env*`, logs and `.cursor/` are git-ignored.
