# Phase 0 re-verification record (B1–B6)

> **Provenance.** This is a builder-written record, not Codex's own report. Codex's re-verification
> verdicts and findings were supplied by the ChatGPT orchestrator, which accepted them, in the
> "Phase 0 — Verified Implementation Reconciliation and Commit" work package (2026-10-28). Claude did
> not perform this verification. Claude's own observations are labeled **builder observation**.
>
> The original, failed verification report, [PHASE0-CODEX-VERIFICATION.md](PHASE0-CODEX-VERIFICATION.md)
> (`PHASE0_CONSOLIDATED_CORRECTIONS_REQUIRED`), is kept unchanged as the historical record.

## Verification history

| Round | Scope | Verdict | Outcome |
|---|---|---|---|
| 1 | Phase 0A + 0B | `PHASE0_CONSOLIDATED_CORRECTIONS_REQUIRED` | Defects B1–B5 found; record in `PHASE0-CODEX-VERIFICATION.md` |
| 2 | B1–B5 corrections | `PHASE0_REVERIFY_READY_FOR_MANUAL_UI` for B1–B5, plus `B6_MUST_FIX_BEFORE_PHASE0_LOCK` | B1–B5 accepted. B6 opened: unsupported Electron 33, 36 audit advisories, no renderer hardening |
| 3 | B1–B6 combined | **`PHASE0_B6_REVERIFY_READY_FOR_MANUAL_UI`** | Accepted by the orchestrator. Current |

## Round 3 findings (as supplied)

- All B1–B6 corrections independently verified.
- 155/155 automated tests pass (73 unit, 82 integration).
- Full verification command (`npm run verify`) PASS.
- Clean setup reproducible on **Windows x64** (`npm run setup`).
- Electron 44 runtime verification PASS.
- Native SQLite compatibility (better-sqlite3 13 N-API prebuild) PASS.
- Built-app and packaged-executable smoke verification PASS.
- Windows NSIS installer build PASS (built, not installed).
- Full and production `npm audit`: zero reported vulnerabilities.
- No real user data modified.
- `git diff --check` flags only CR-at-EOL on files stored with CRLF; `git -c core.whitespace=cr-at-eol
  diff --check` is clean. Resolved by `.gitattributes` (see WORKFLOW.md → Repository conventions).
- **Not yet done:** manual UI verification; in-place upgrade of an installed System Status app.

## Verification scope

- **Verified platform:** Windows x64 only. macOS and Linux were neither built nor run; nothing in
  this record implies they work.
- **Installer:** the NSIS artifact was built and its unpacked executable smoke-tested. Installing it,
  and upgrading an existing System Status installation in place, are **untested**.

## Known limitations recorded with this verification

These are accepted limitations, not blocking defects. None was introduced by B1–B6.

1. **Unsigned installer and executable.** No code-signing certificate is configured. *Builder
   observation:* `Get-AuthenticodeSignature` reports `NotSigned` for both `Network Status Setup 1.0.0.exe`
   and `win-unpacked\Network Status.exe`. Expect Windows SmartScreen / "unknown publisher" warnings.
2. **Electron fuses are at Electron's defaults.** No `electronFuses` configuration exists.
   *Builder observation* (fuse wire read from the packaged exe with `@electron/fuses`):
   - **enabled:** `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments`,
     `GrantFileProtocolExtraPrivileges`;
   - **disabled:** `EnableEmbeddedAsarIntegrityValidation`, `OnlyLoadAppFromAsar`,
     `EnableCookieEncryption`.

   Someone who can already run programs as the user could start the packaged exe as plain Node, or
   alter `app.asar`, without detection. Fuse hardening is future work, with its own packaged-build
   test pass.
3. **No Squirrel.Windows handling.** The only Windows target is NSIS. The app does not handle
   Squirrel install/update events (`--squirrel-*` arguments, `electron-squirrel-startup`), and this
   preparation was skipped on purpose. Adding a Squirrel target would require implementing and
   testing it.
4. Existing technical debt (CURRENT-STATE.md → Known defects) stays open, notably D11 (debug IPC
   registered in production) and D16 (installer shortcut AUMID).

## Status

- B1–B6: **IMPLEMENTED** and **INDEPENDENTLY VERIFIED**.
- Isolated manual UI verification: **AUTHORIZED**, **AWAITING USER MANUAL ACCEPTANCE**
  ([MANUAL-UI-CHECKLIST.md](MANUAL-UI-CHECKLIST.md)).
- Real-data migration: still restricted (verified backup and explicit user approval required).
- Installed-app upgrade: **DEFERRED / UNTESTED**.
- Phase 0: **NOT FINAL-LOCKED**. Phase 1: **not authorized**.
