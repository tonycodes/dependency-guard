# dependency-guard

`dependency-guard` is a zero-dependency Node.js 20+ CLI for reviewing npm dependency
updates before installation. It checks the lockfile, npm registry metadata, upstream
GitHub history, package contents, and npm's registry signatures, then writes a JSON
evidence report.

It never intentionally runs dependency lifecycle scripts. Installation uses
`npm ci --ignore-scripts`, and package inspection uses
`npm pack --dry-run --json --ignore-scripts`.

## Threat model

The guard is intended to catch:

- lock entries redirected away from the npm registry or missing cryptographic integrity;
- newly introduced transitive install scripts;
- unexpected direct-package lifecycle hooks;
- unsigned npm registry metadata;
- repository substitution and unexpected npm maintainers;
- provenance that names a different repository or a commit without a matching
  upstream version tag;
- packages whose `gitHead` cannot be tied to an upstream version tag;
- unusually fresh releases and unexpectedly large package archives;
- failures reported by `npm audit signatures` or `npm audit --omit=dev`.

The lockfile and registry metadata are parsed before `npm ci` runs. Any pre-install
failure still produces the requested report.

## Limitations

- The CLI cannot prove that an official upstream GitHub account, npm maintainer,
  release workflow, signing identity, or source repository itself is uncompromised.
- Presence of an npm registry signature is checked from metadata. Cryptographic
  signature and Sigstore attestation verification is delegated to
  `npm audit signatures` after the script-disabled install.
- Provenance validation checks the decoded SLSA statement's repository and requires
  its source commit to match an upstream version tag. It does not implement Sigstore
  cryptography independently.
- Upstream tag verification runs `git ls-remote` against public GitHub repositories.
  Private upstream repositories require Git credentials configured outside the tool.
- Only GitHub upstream repositories are currently verifiable. `init` warns and does
  not silently trust packages hosted elsewhere.
- `npm audit --omit=dev` follows npm's advisory database and may miss unknown issues.

This tool is one review gate, not a replacement for source review, least-privilege
CI credentials, lockfile review, or artifact isolation.

## Usage

No install is required from a checkout:

```sh
node bin/dependency-guard.js init \
  --path ../my-project \
  --output ../my-project/dependency-guard.policy.json

node bin/dependency-guard.js check \
  --path ../my-project \
  --policy ../my-project/dependency-guard.policy.json \
  --report ../my-project/dependency-guard-report.json
```

When installed as a CLI, use `dependency-guard` in place of
`node bin/dependency-guard.js`.

`--policy` is optional and uses the defaults below. `--report` is required. Use
`--skip-install` only when package installation and both npm audits are performed by
a separate, equivalent CI step. Skipping installation reduces assurance.

`init` refuses to overwrite an existing output file. Review every generated trust
entry before committing the policy; generation is a starting point, not approval.

## Gitea action

The repository includes a composite `action.yml`. Pin actions to the reviewed full
commit SHA, never a branch or mutable tag:

```yaml
steps:
  - uses: actions/checkout@<reviewed-40-character-commit-sha>
  - uses: https://git.nocker.cloud/tony/dependency-guard@<reviewed-40-character-commit-sha>
    with:
      path: .
      policy: dependency-guard.policy.json
      report: dependency-guard-report.json
```

The action invokes `node "$GITHUB_ACTION_PATH/bin/dependency-guard.js"` directly, so
it does not install the action's own dependencies. Configure a Node.js 20+ runner.
For private upstream repositories, configure minimally scoped Git credentials on the
runner without placing them in the policy or report.

## Policy

```json
{
  "allowInstallScripts": {
    "fsevents": {
      "versions": ["2.3.3"],
      "reason": "Reviewed optional native filesystem watcher install script.",
      "expiresAt": "2027-01-01T00:00:00Z"
    }
  },
  "allowDirectLifecycleScripts": {},
  "archiveSizeExceptions": {},
  "auditExceptions": {},
  "sourceEvidenceExceptions": {},
  "trustedRepositories": {
    "example-package": "https://github.com/example/example-package"
  },
  "trustedMaintainers": {
    "example-package": ["expected-npm-user"]
  },
  "minimumReleaseAgeHours": 72,
  "freshReleaseAction": "warn",
  "maxTarballSizeBytes": 20971520,
  "maxUnpackedSizeBytes": 104857600
}
```

- `allowInstallScripts` permits `hasInstallScript` only for listed exact versions.
- `allowDirectLifecycleScripts` separately permits exact direct package versions
  whose registry manifest declares `preinstall`, `install`, or `postinstall`.
- `archiveSizeExceptions` permits exact package versions to use reviewed archive
  limits above the project defaults.
- `auditExceptions` permits only listed GHSA advisories until each entry's expiry.
- `sourceEvidenceExceptions` permits only an exact package version to proceed when
  source provenance or tag evidence is unavailable. Each entry requires a detailed
  `reason` and an `expiresAt` ISO date, and produces a warning.
- `trustedRepositories` pins normalized GitHub repositories by package name.
- `trustedMaintainers` pins the complete npm maintainer set expected in exact-version
  metadata. Additions and removals both fail the check.
- `minimumReleaseAgeHours` defines the freshness threshold.
- `freshReleaseAction` is `warn` by default and may be changed to `fail`.
- Archive limits apply to the values emitted by `npm pack --dry-run --json`.

Unknown policy fields and malformed values fail closed.

## Exceptions

Treat exception maps as reviewed security exceptions. Lifecycle and archive entries
require exact versions, a detailed reason, and an expiry:

1. Confirm the exact package and locked version.
2. Inspect the lifecycle script and every executable or downloaded artifact it uses.
3. Confirm the repository, npm maintainers, release tag, and commit independently.
4. Prefer a package-specific exception over broad threshold changes.
5. Record the rationale and reviewer beside the policy change in the pull request.
6. Remove the exception when the package or dependency is removed.

Do not add a package to both lifecycle exception maps automatically. A transitive
`hasInstallScript` exception and a direct manifest-hook exception represent separate
trust decisions. Scripts remain disabled during the guard's own `npm ci`; an
exception permits review to pass but does not execute the script.

## Evidence report

The report contains:

- report version, timestamp, project path, status, and counts;
- lockfile version and number of registry package entries;
- exact direct package versions, repository, provenance path, release age,
  maintainer names, archive sizes, failures, and warnings;
- each npm command, exit code, timeout state, and redacted/truncated output;
- aggregate actionable failures and warnings.

Reports are created with owner-only permissions where supported. They intentionally
exclude environment variables, authentication headers, registry response bodies,
attestation bundles, and GitHub response bodies. Command output is redacted for
common credential labels and URL user information, but reports should still be
handled as CI evidence rather than published indiscriminately.

## Development

```sh
npm test
npm run check
```

Tests use `node:test`, temporary fixtures, and injected HTTP/process implementations.
They do not access the live network.
