# Product gap analysis

Last reviewed: 10 August 2026.

This document separates what the public demo proves today from work required
before a public-value pilot. It is intentionally stricter than the hackathon
demo checklist.

## Current readiness

| Area | State | Evidence |
|---|---|---|
| Failure-isolated contracts | Ready for testnet demonstration | Adversarial unit tests and Coston2 success/fallback receipts |
| Canonical `0xE0` recovery | Demonstrated | XRPL, FDC and Flare hashes in `evidence/bare-recovery.json` |
| Proof-aware full simulation | Implemented and required by the executor | Durable `SIMULATION_PASSED` state and unit tests |
| Public browser preview | Available | Live Coston2 reads at `mintshield.vercel.app` |
| Public evidence dashboard | Available | Redacted recorded transactions and explorer links |
| Public Xaman settlement | Not deployed | Requires durable storage, private worker and secret management |
| Local Xaman settlement | Operator-ready when configured | SQLite status API plus separate executor worker |
| CI | Implemented | GitHub Actions runs build, typecheck and full tests on Node.js 22 |

The original Coston2 success/fallback/recovery evidence was exported on 30
July 2026, before the full-simulation state was introduced; those records
remain historically accurate and do not claim a simulation step. A fresh
protected success and protected fallback were run 10 August 2026 against the
current post-timelock deployment, both carrying the `SIMULATION_PASSED`
checkpoint before broadcast and independently re-verified on-chain
(`npm run verify:settlements`); see
[Live evidence](LIVE_EVIDENCE.md#post-timelock-deployment--first-live-runs-10-august-2026).

## Prioritized remaining work

### P0 — before handling public value

1. Complete an independent smart-contract review and resolve all material
   findings. A Slither pass ran 10 August 2026 with no high/critical results
   (see [Security review](SECURITY_REVIEW.md)); third-party independent
   review remains open.
2. Move Router/Registry administration from a single testnet owner to a
   documented multisig/timelock design.
3. Deploy the durable API, database and executor worker in a private backend
   with encrypted secrets, backups, monitoring and an incident runbook.
4. Add rate limits, request authentication and anti-abuse controls to any
   public signing endpoint.

### P1 — before hackathon submission freeze

1. ~~Run one fresh protected success and one fallback with the full
   simulation gate, then export and verify the new evidence bundle.~~ Done
   10 August 2026 (Runs 4–5 in `docs/LIVE_EVIDENCE.md`).
2. Record the three-minute comparison demo using the exact published build
   (script ready in `docs/DEMO_SCRIPT.md`).
3. Run the Quick Start from a clean clone and save the result.
4. Publish the final DoraHacks description, architecture diagram, contract
   addresses and honest limitations (draft ready in `docs/SUBMISSION.md`;
   still needs the demo video link filled in and a final read-through before
   submitting).

### P2 — post-hackathon product work

1. Add browser end-to-end tests for preview, language switching, evidence
   filters and Xaman status rendering.
2. Add production observability for XRPL finality, FDC wait time, simulation
   failures, Flare receipts and recovery states.
3. Define and audit additional fixed-purpose adapters; do not expose arbitrary
   downstream calls.
4. Add a user-facing recovery assistant that points to canonical protocol
   recovery without taking custody or replacing `0xE0`.

## Non-goals that remain deliberate

- The public Vercel deployment is not a signing backend.
- MintShield does not replace Flare protocol recovery.
- Preview checks do not replace the proof-aware full simulation.
- Legacy evidence is not rewritten when a later executor safeguard is added.
