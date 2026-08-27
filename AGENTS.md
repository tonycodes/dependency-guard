# Agent Guide

This repository is a security-sensitive npm supply-chain gate. Keep changes small,
reviewable, dependency-free, and fail-closed.

## Requirements

- Support Node.js 20 and newer using ESM and built-in APIs only.
- Do not add runtime or development npm dependencies.
- Use `node:test`; tests must not access live npm or GitHub services.
- Inject or mock HTTP and child-process boundaries in tests.
- Never execute dependency lifecycle scripts. Preserve `--ignore-scripts` on both
  `npm ci` and `npm pack`.
- Use argument-array child processes with `shell: false` and bounded timeouts.
- Never log or report tokens, headers, environment values, registry response bodies,
  attestation bundles, or other credentials.
- Preserve exact repository, commit, tag, signature, integrity, and maintainer checks.
- Do not silently trust packages that lack a normalized GitHub repository.
- Do not commit generated evidence reports, package archives, fixtures containing
  real project data, credentials, or tokens.

## Project map

- `bin/dependency-guard.js`: executable entry point.
- `lib/cli.js`: commands and argument validation.
- `lib/project.js`: manifest/lock parsing and pre-install checks.
- `lib/policy.js`: policy defaults and validation.
- `lib/verify.js`: npm metadata, provenance, GitHub commit, and tag checks.
- `lib/check.js`: check orchestration and evidence report generation.
- `lib/init.js`: policy generation from exact locked direct versions.
- `lib/util.js`: URL normalization, bounded HTTP, process execution, and redaction.
- `test/`: offline unit and orchestration tests.
- `action.yml`: reusable Gitea composite action.

## Workflow

1. Inspect `git status --short` and preserve unrelated worktree changes.
2. Read the implementation and nearest tests before editing.
3. Add denial-path tests for malformed or adversarial inputs.
4. Run `npm test`, then `npm run check`, then `git diff --check`.
5. Review every spawned npm argument list and every report field before finishing.

Do not commit or push unless explicitly requested.
