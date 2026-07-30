# MintShield

MintShield is a failure-isolation layer for FXRP direct mints initiated through
Flare Smart Accounts. For a supported adapter, the intended DeFi action either
satisfies its on-chain post-conditions or the input FXRP is returned to the
user's Personal Account without reverting the enclosing user operation.

> One XRPL signature. The supported action succeeds, or the FXRP remains safely
> under the user's Personal Account control.

## Current status

The repository contains the local MVP foundation and its live-network execution
tooling:

- non-upgradeable `MintShieldRouter` with success/fallback settlement;
- owner-managed, codehash-pinned `AdapterRegistry`;
- fixed-target ERC-4626 deposit adapter;
- deterministic `FailureVault` for the comparison demo;
- a typed `0xFE` PackedUserOperation builder;
- exact direct-mint fee gross-up from live AssetManager settings;
- idempotent SQLite XRPL → FDC → Coston2 executor state machine;
- bounded FDC polling, proof-owner validation and delayed-mint retry;
- read-only Coston2 status, guarded deployment and JSON evidence commands;
- localhost dashboard and status API with redacted public job/timeline views
  and an explicit, backend-gated Xaman signing action;
- live, read-only protected-deposit preview with current Coston2 fee, Personal
  Account nonce, exact XRPL payment and `0xFE` commitment review;
- backend-only Xaman Testnet sign requests with QR/deeplink delivery,
  authoritative result checks, durable executor-job binding and an explicit
  credential-rotation gate;
- exact XRPL source, destination, amount, memo, delivery-result and
  DestinationTag validation before any FDC request;
- unit tests for revert isolation, rollback, min-output, replay, pause, caps,
  accounting deltas, allowances, false-success adapters and executor boundaries.
- bounded returndata/gas griefing defenses with adapter, vault and token
  adversarial tests.

The production-profile contracts are deployed and independently checked on
Coston2. Live evidence includes a successful protected deposit, two exact
protected fallbacks, a Router-less atomic revert, and the complete official
`0xE0` recovery path. The bare failure needed a second XRPL payment plus two
recovery finalizations; MintShield returned the newly minted FXRP in the
original outer transaction.

Current checks confirm 3.9 FXRP in the Personal Account, 1 msSHARE held by
that account, 1 FXRP backing the vault, and zero Router/adapter residual
balances and allowances.

## Coston2 deployment

Observed and verified on 30 July 2026 (`chainId` 114):

| Contract | Address |
|---|---|
| MintShieldRouter | `0x65CB77AD23022C03CEc15c6EEFf01c7dea056DF8` |
| AdapterRegistry | `0x0b8013EfE2d5c7B5be3b484ba0A275b71D719b17` |
| ERC4626DepositAdapter | `0x62Cb9B46824C194f84B497B1b6A50Ae57C51E19B` |
| FailureVault | `0xcB8E7C851102D4894532CbDC9cDA3C59DB3658c0` |
| FXRP | `0x0b6A3645c240605887a5532109323A3E12273dc7` |

The complete manifest, deployment transaction hashes, compiler profile and
runtime codehash are in [`deployments/coston2.json`](deployments/coston2.json).
Run `npm run verify:coston2` to recheck code, ownership, immutable wiring, gas
policy and registry configuration against live state.

The original deployment and its calibration fallback are preserved in
[`deployments/coston2-v1.json`](deployments/coston2-v1.json). Redacted
XRPL/FDC/Coston2 timelines, recovery proof and balance checks are under
[`evidence/`](evidence/).

## Why this exists

Flare's Personal Account executes a `Call[]` atomically. If any call reverts,
the entire user operation reverts. In the direct-mint path that revert propagates
through `MasterAccountController.handleMintedFAssets` and
`AssetManagerFXRP.executeDirectMintingWithData`; FXRP is not minted even though
the XRP payment already reached the Core Vault. Flare provides `0xE0` recovery,
but it requires a follow-up XRPL payment.

MintShield puts a supported downstream action behind a catchable external
subcall. Adapter execution and post-condition validation happen in the same
rollback boundary. A business-level failure is caught by the Router, which
settles normally and returns the exact input to the Personal Account.

## Quick start

Requirements: Node.js 22 or newer.

```bash
npm install
npm run check
```

`npm run check` compiles the Solidity contracts, type-checks the client builder,
and runs the local test suite.

Read current Coston2 protocol state without a private key:

```bash
npm run status:coston2
npm run deploy:coston2:plan
```

The first command resolves Flare contracts through the registry and reads the
current FXRP direct-mint settings. The second validates build artifacts and
prints the exact guarded deployment plan; it does not broadcast.

For a fresh live setup, copy `.env.example` to `.env`, fund the two testnet
accounts, deploy only after reviewing the dry-run, and then run:

```bash
npm run wallet:xrpl:testnet
npm run wallet:coston2:executor
npm run deploy:coston2
npm run verify:coston2
npm run preflight:integration
npm run executor:run -- --input executor-input.example.json
npm run evidence:export
npm run verify:settlements
```

The deliberate comparison and recovery commands are dry-runs unless
`--broadcast` is explicitly supplied:

```bash
npm run comparison:bare
npm run comparison:recover -- --job <job-id>
```

`wallet:xrpl:testnet` creates and faucet-funds a testnet-only XRPL wallet. It
saves the seed to the git-ignored `.env` with `0600` permissions and refuses to
replace an existing seed.

`executor:run` creates or resumes one durable job. It never creates a second
XRPL payment for the same Personal Account Smart Account nonce.

The optional evidence dashboard and status service listen on localhost by
default. Evidence, job and preview views are read-only; only the explicitly
enabled Xaman endpoint creates an external signing request:

```bash
npm run api:status
```

Open `http://127.0.0.1:8787/` for the responsive evidence dashboard and
protected-deposit preview. The preview reads current Coston2 protocol settings
and derives the public intent commitment without submitting a payment or
receiving a wallet secret. Its API exposes `/api/health`, `/api/jobs`,
`/api/jobs/:id`, read-only `POST /api/preview`, explicitly gated
`POST /api/xaman/sign-request` and redacted Xaman status; signed XRPL blobs,
private keys, Xaman secrets and raw user-operation data are never included in
browser responses.

Run the private executor worker in a second terminal. It resumes only signed
or later-stage jobs; it never asks the browser for an XRPL seed or Coston2
private key:

```bash
npm run executor:worker
```

The status API binds every returned Xaman payload UUID to the exact
`userOpHash`, full backend-only user-operation bytes, Personal Account nonce,
Core Vault destination and payment amount. Once Xaman reports a signed
transaction, the executor independently re-reads it from XRPL and rejects any
source, destination, amount, memo, delivered-amount or DestinationTag mismatch
before requesting an FDC proof.

Xaman credentials are backend-only. After creating or rotating the app
credentials, add them to the git-ignored `.env` and deliberately enable
signing:

```bash
XAMAN_ENABLE_SIGNING=true
XAMAN_API_KEY=...
XAMAN_API_SECRET=...
```

## Repository map

```text
contracts/
  MintShieldRouter.sol              failure isolation and settlement
  AdapterRegistry.sol               adapter policy, cap and codehash
  adapters/ERC4626DepositAdapter.sol
  interfaces/
  mocks/                            demo and adversarial test targets
src/client/protected-deposit.ts     approve + execute UserOp and 0xFE memo
src/flare/                         minimal canonical ABIs, lookup and fee quote
src/executor/                      durable XRPL/FDC/Flare pipeline
scripts/                           status, deployment, executor and evidence CLI
web/                               live evidence and Xaman signing dashboard
test/                               contract and encoding tests
docs/
  ARCHITECTURE.md
  IMPLEMENTATION_PLAN.md
  THREAT_MODEL.md
  RESEARCH_NOTES.md
```

## Scope

MVP scope is deliberately narrow: Coston2, FXRP, Flare Smart Accounts `0xFE`,
one fixed-target ERC-4626-style adapter, and one deterministic failure target.
It does not claim to protect malformed memo/nonce/proof failures, executor
liveness, minting delays, wrong Core Vault payments, arbitrary contracts, or
malicious approved adapters.

`FailureVault` is intentionally mutable and exists only to demonstrate success,
false-success and revert behavior. It is not a production yield target.

See [Architecture](docs/ARCHITECTURE.md),
[Implementation plan](docs/IMPLEMENTATION_PLAN.md), and
[Threat model](docs/THREAT_MODEL.md). Current internal findings and measurements
are in [Security review](docs/SECURITY_REVIEW.md), and the real transaction
timeline is in [Live evidence](docs/LIVE_EVIDENCE.md).

## Official references

- [Flare Smart Accounts overview](https://dev.flare.network/smart-accounts/overview)
- [Custom instruction (`0xFE`)](https://dev.flare.network/smart-accounts/custom-instruction)
- [Minting troubleshooting](https://dev.flare.network/fassets/troubleshooting/minting-troubleshooting)
- [Recover a stuck mint](https://dev.flare.network/smart-accounts/guides/typescript-viem/recover-stuck-mint-transaction-ts)
- [Flare Smart Accounts source](https://github.com/flare-foundation/flare-smart-accounts)
- [Flare Viem starter](https://github.com/flare-foundation/flare-viem-starter)
