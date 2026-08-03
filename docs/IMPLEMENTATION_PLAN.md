# Implementation plan

Target deadline: 14 August 2026. The sequence is risk-first: live protocol
assumptions are proven before frontend polish.

## Definition of Done

MintShield is submission-ready only when all of these are true:

- public repository installs and tests with one documented command;
- at least 20 meaningful contract/encoding tests pass;
- contracts deploy and verify on Coston2;
- one real XRPL Testnet payment completes a successful protected deposit;
- one bare protected-target failure reproduces the stuck-mint behavior;
- one real protected failure finalizes with FXRP in the Personal Account and no
  second recovery payment;
- balances, events, FDC round, XRPL hash and Flare hash are saved as evidence;
- executor treats delayed minting as retryable, not failed;
- README and demo state limitations without “all failures” or “arbitrary call”
  claims;
- three-minute video shows the comparison, not only the happy path.

## Phase 0 — foundation (completed)

- Read and challenge the detailed product document.
- Verify failure propagation in current Flare docs and source.
- Establish Hardhat 3 / Solidity 0.8.27 project.
- Implement Router, Registry, fixed ERC-4626 adapter and FailureVault.
- Implement typed protected-deposit/`0xFE` builder.
- Add success, rollback, false-return, min-output, replay, pause, cap, dust,
  allowance and governance tests.
- Document trust boundaries, proxy caveat and fresh-mint caveat.

Exit: local core compiles, type-checks and has 20+ passing tests.

## Phase 1 — 48-hour kill/go integration spike (successful live path complete)

### Day 1: official `0xFE` baseline

1. Fund an XRPL Testnet wallet and its deterministic Coston2 Personal Account.
2. Resolve current `MasterAccountController`, `AssetManagerFXRP`, FXRP and Core
   Vault address through the Flare Contract Registry.
3. Port the official Viem starter flow with the exact canonical XRPPayment tuple
   while adding bounded polling, durable checkpoints and proof validation.
4. Send a small XRPL payment with a simple `0xFE` call.
5. Finalize it through `executeDirectMintingWithData`.
6. Save proof round, transaction hashes, receipt logs and balance deltas.

Kill condition: the current deployed path cannot be made to work reliably after
checking official support channels and starter versions.

Current checkpoint: funded XRPL and Coston2 accounts completed protected
success/fallback, bare-revert and recovery flows through real FDC proofs. The
first protected run exposed live gas calibration; the revised deployment then
settled successfully. XRPL hashes, FDC rounds, Flare hashes and
balance/allowance checks are saved under `evidence/`.

### Day 2: prove both sides of the thesis

1. Deploy `FailureVault` in revert mode.
2. Build a bare UserOp that directly calls it and reproduce the upstream revert.
3. Confirm FXRP was not minted and the XRPL transaction remains recoverable.
4. Exercise official `0xE0` recovery once and save the evidence.
5. Deploy Registry, Router and adapter; repeat against the same target.
6. Confirm `IntentSettledFallback`, successful outer transaction and FXRP in PA.

Current checkpoint: complete on Coston2. The deliberate protected failure
returned exactly 1,000,000 UBA in the original finalization. The same target
without the Router reverted the Flare finalization and remained recoverable.
The official `0xE0` flow used a second XRPL payment, emitted `IgnoreMemoSet`,
and resubmitted the original proof successfully.

Pivot condition: the deployed official flow already isolates the target revert
or the comparison cannot reproduce the stated failure.

## Phase 2 — on-chain hardening (local checkpoint complete)

- Add Foundry-compatible fuzz/invariant tests or Hardhat Solidity fuzz tests.
- Bound revert-data hashing/gas behavior.
- Test reentrant token, reentrant vault and malformed adapter returndata.
- Add guardian/timelock design; deploy MVP ownership to a multisig if available.
- Run Slither and coverage; resolve high-confidence findings.
- Record bytecode size and gas for success/fallback.
- Freeze the MVP ABI after this phase.

Exit: no unresolved critical invariant violation; all known fail-closed paths
documented.

Current checkpoint: bounded returndata, fixed adapter gas cap, fallback gas
reserve, minimum entry gas, adapter/vault/token reentrancy tests, gas-burning
targets and a stateful FXRP conservation sequence are implemented. The first
live run proved fallback safety and exposed an under-sized gas floor; the
revised 900k/500k policy completed a second live success run. Coverage is
91.62% lines / 83.21% statements and the revised local adversarial maximum is
622,983 gas. Slither and independent review remain open before any public-value
pilot.

## Phase 3 — executor and evidence pipeline (recovery evidence complete)

The repository now contains a small, idempotent worker based on the official
Flare starter flow.

Persist:

```text
xrplTxHash, intentId, userOpHash, personalAccount,
status, fdcRound, flareTxHash, failureCode, retryAt,
createdAt, updatedAt
```

Required behaviors:

- wait for XRPL finality before FDC request;
- bind proof owner to the submitting executor or use open proof deliberately;
- verify delivered UserOp hash before spending gas;
- submit `executeDirectMintingWithData` exactly once per attempt;
- detect `DirectMintingDelayed`, store `executionAllowedAt`, retry same proof;
- reconcile state from chain events after restarts;
- never request a private key through the web application;
- separate demo wallet mode from production executor mode.
- persist the signed `0xE0` recovery payment before broadcast;
- resume recovery across recovery FDC, `IgnoreMemoSet` and stuck-proof retry
  checkpoints without creating another payment.

Exit: CLI produces deterministic JSON evidence for success, fallback and delay.

## Phase 4 — product UI (days 9–11)

Build only the screens needed to understand and run the proof:

1. Protected deposit form.
2. Human-readable intent review.
3. Xaman QR/deeplink signing.
4. XRPL → FDC → Coston2 event timeline.
5. Success/fallback result with balance delta.
6. Protocol-level diagnostics and official recovery guidance.
7. Developer evidence drawer with raw IDs and explorer links.

The review screen must show total XRP payment, expected net FXRP, exact FXRP
authorized for Router spend, adapter/version, target, minimum shares, deadline,
fallback receiver and executor fee.

Exit: an uninformed tester can distinguish fallback from stuck/recovery state.

Current checkpoint: the responsive localhost evidence dashboard is connected
to the redacted executor API. It shows protected success, exact fallback and
bare recovery as distinct states, renders the full XRPL → FDC → Coston2
timeline, and links each proof to the relevant explorer. The protected-deposit
review now reads the current direct-mint fee, Personal Account and nonce from
Coston2, then shows the exact XRPL payment, Router authorization, target,
minimum output, deadline, fallback receiver and 42-byte `0xFE` commitment.
The Xaman QR/deeplink backend and bilingual signing UI are implemented with
forced XRPL Testnet payloads, exact destination/amount/memo construction,
allowlisted Xaman URLs, WebSocket-triggered status refresh and redacted
authoritative result checks. Each returned Xaman payload is now bound to a
durable executor job before it reaches the browser. A signed result advances
that job without requiring an XRPL seed or signed blob, while the private
worker independently verifies the validated XRPL source, Core Vault,
amount, delivered amount, single `0xFE` memo, success code and absence of a
DestinationTag before FDC. Credentials remain backend-only and signing still
requires the explicit operator gate. The public UI now reports deployment
readiness directly and keeps legacy transaction history separate from the
newer full-simulation executor policy.

## Phase 5 — submission (days 12–14)

- Verify source on Coston2 explorer.
- Commit `deployments/coston2.json` with chain ID, addresses and codehashes.
- Commit `evidence/` JSON for one success, one fallback and one bare failure.
- Add architecture diagram and sequence diagram based on actual deployed flow.
- Record an uninterrupted three-minute demo.
- Publish “built before/during hackathon” separation.
- Add roadmap and adapter suitability checklist.
- Ask one external developer to run Quick Start from a clean clone.

Feature freeze begins two days before submission.

## Demo script

```text
0:00  one-signature XRPFi and the downstream revert problem
0:20  FailureVault mode and bare 0xFE payment
0:50  reverted Flare finalization; show why official recovery is needed
1:10  MintShield intent review and XRPL signature
1:35  FDC proof and executeDirectMintingWithData
1:55  adapter revert, Router fallback event, successful outer receipt
2:20  Personal Account FXRP balance and no second recovery payment
2:40  rollback boundary, adapter scope, honest limitations
```

## Submission checklist

- Project name and selected bounty.
- Product description and target user.
- Live app/demo and video.
- Public GitHub and license.
- Exact Flare integration explanation.
- New work completed during hackathon.
- Verified contract addresses and deployment details.
- XRPL, FDC and Coston2 evidence.
- Testing/security report.
- Roadmap and partner/user feedback.
