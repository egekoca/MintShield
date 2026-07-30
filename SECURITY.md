# Security policy

MintShield is experimental hackathon software. It has not been independently
audited and must not be used with production funds.

Please report suspected vulnerabilities privately to the maintainers rather
than opening a public issue. A dedicated security contact should be added before
the repository is published.

## Supported scope

Only the latest `main` branch and the Coston2 deployment listed in
`deployments/coston2.json` (once created) are in scope. Demo mocks are not
production contracts.

## Dependency note

`npm audit --omit=dev` reports no production dependency vulnerabilities at the
time of this build. A broad Flare Wagmi/code-generation package was deliberately
removed from the key-holding executor after it introduced unrelated legacy
deployment and cryptography dependencies; MintShield retains only the required
canonical ABI fragments.

The full audit currently reports 22 transitive advisories (7 low, 2 moderate,
13 high, 0 critical) in the Hardhat development toolchain. Those packages are
development-only, but the team should update the pinned toolchain as fixes
become available and must not process untrusted archives or remote build inputs
with it.

The executor uses Node's built-in SQLite API, which Node 24 still labels
experimental. Private keys and seeds are loaded from environment variables and
are never written to the database. The database does store a signed XRPL
transaction blob for crash-safe broadcast; protect it as sensitive operational
state.
