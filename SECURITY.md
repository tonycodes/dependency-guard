# Security Policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Send a private report to
the repository owner through the private security channel configured for the Gitea
organization. Include:

- the affected commit and Node.js/npm versions;
- a minimal reproduction using non-secret fixture data;
- the security boundary that was bypassed;
- whether dependency lifecycle code was executed;
- suggested remediation, if known.

Do not include npm tokens, GitHub tokens, private repository contents, generated
evidence reports, or production lockfiles unless the owner explicitly requests them
through an approved private channel.

## Supported versions

Only the current default branch is supported until stable releases are published.
Node.js 20 and newer are required.

## Security invariants

- Parse and reject unsafe lockfile state before installation.
- Never execute dependency lifecycle scripts.
- Never invoke npm without an explicit argument array and bounded timeout.
- Keep registry signature presence checks separate from the cryptographic validation
  delegated to `npm audit signatures`.
- Fail closed on malformed policy, metadata, provenance, Git refs, and command output.
- Do not write credentials, authorization headers, environment contents, metadata
  response bodies, or attestation bundles to reports.
- Do not weaken repository, commit, tag, signature, integrity, or lifecycle checks to
  accommodate a package. Require an explicit, version-pinned, expiring policy
  exception where one is supported.

## Disclosure

Please allow the maintainers reasonable time to reproduce and fix accepted reports
before public disclosure. The owner will coordinate a release and advisory when
appropriate.
