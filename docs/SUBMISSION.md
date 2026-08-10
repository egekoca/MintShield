# DoraHacks submission draft — Flare Summer Signal

Draft text for the DoraHacks BUIDL submission form. Copy each section into the
matching form field. Update the `[fill in]` placeholders (demo video URL,
final commit hash, screen recording links) once produced, then delete this
line before submitting.

## Project name

MintShield

## Selected bounty

Bounty 1 — Interoperable Asset Products

MintShield is a failure-isolation layer for FXRP direct minting through Flare
Smart Accounts: exactly the FXRP-onboarding / DeFi-integration / asset-UX
category this bounty asks for.

## Short product description

When a user mints FXRP through a Flare Smart Account and immediately routes
it into a DeFi action in one signed operation, a revert anywhere downstream
reverts the *entire* user operation — the XRP already left the user's wallet
on XRPL, but the FXRP is never minted. Flare's own `0xE0` recovery path fixes
this, but it requires the user to notice, understand the failure, and send a
**second** XRPL payment. MintShield puts the downstream DeFi action behind a
catchable subcall: on success it settles normally; on failure it automatically
returns the exact FXRP input to the user's Personal Account in the same
transaction, with no revert and no second XRPL payment. One XRPL signature —
the action succeeds, or the user's FXRP comes back safely, every time.

## Target user

Wallets, dApps and DeFi protocols that want to offer "mint FXRP and use it in
one step" flows to end users without exposing them to the current failure
mode: retail users who would otherwise be stuck with an un-minted XRP payment
and no clear recovery path, and integrators who don't want to build and
support their own `0xE0` recovery UX.

## Demo link, video, or working app link

- Live application: https://mintshield.vercel.app
- Live read-only Coston2 preview and evidence dashboard included in the same
  link (`/api/readiness`, `/api/jobs`)
- Demo video: [fill in — 3-minute bare-revert vs. MintShield comparison,
  recorded per docs/DEMO_SCRIPT.md]

## GitHub repo / technical materials

- https://github.com/egekoca/MintShield (public)
- Architecture: `docs/ARCHITECTURE.md`
- Threat model: `docs/THREAT_MODEL.md`
- Security review + Slither pass: `docs/SECURITY_REVIEW.md`
- Live Coston2 evidence (real testnet transactions): `docs/LIVE_EVIDENCE.md`
- Honest gap analysis: `docs/GAP_ANALYSIS.md`

## How this project uses Flare

- **Flare Smart Accounts** — the protected deposit is built as a single
  `0xFE` custom-instruction Smart Account user operation
  (`src/client/protected-deposit.ts`): approve, then
  `MintShieldRouter.execute`, committed to the exact XRPL memo the user
  signs.
- **FAssets / AssetManager** — the executor reads live FXRP direct-minting
  settings (fee basis points, minimum fee, large-mint threshold) directly
  from the on-chain `AssetManagerFXRP` and grosses up the XRPL payment so the
  memo-encoded executor fee never eats into the signed Router input
  (`src/flare/preflight.ts`).
- **FDC (Flare Data Connector)** — the executor requests and polls an XRPL
  payment proof from FDC, validates the proof owner, and only then submits
  `executeDirectMintingWithData(proof, userOp)` to Flare
  (`src/executor/pipeline.ts`).
- **Proof-aware simulation** — before ever broadcasting, the executor runs a
  full `eth_call` of the exact proof-bearing transaction and requires it to
  pass, recording a durable `SIMULATION_PASSED` state — this is on top of
  what Flare's own tooling requires, not a replacement for it.

None of this is a superficial "we deployed to Coston2" integration: the
Router, Registry and adapter are non-upgradeable, codehash-pinned contracts
deployed and independently verified on Coston2, and every claim above is
backed by real XRPL → FDC → Coston2 transactions in `docs/LIVE_EVIDENCE.md`,
not local mocks.

## What was newly built, ported, integrated or improved during the program

MintShield did not exist before this hackathon program: the first commit is
dated 30 July 2026, inside the Flare Summer Signal development window (opened
29 June 2026). Everything below was built during the program, not ported in:

- The Router / Registry / adapter / FailureVault contract set and its
  adversarial test suite (reentrancy, gas griefing, returndata bombing,
  replay, false-success adapters).
- The typed `0xFE` Smart Account intent builder and exact fee gross-up logic
  against live AssetManager settings.
- The durable SQLite-backed XRPL → FDC → Coston2 executor state machine,
  including the proof-aware full-simulation gate added after the first live
  Coston2 runs surfaced a gas-estimation edge case (see `SECURITY_REVIEW.md`,
  MS-03).
- A 15-minute timelock on live-adapter reconfiguration in `AdapterRegistry`,
  added after an internal review found the owner could otherwise repoint a
  live adapter while a user's XRPL payment was still finalizing.
- The public read-only evidence dashboard and status API
  (`mintshield.vercel.app`), and the separate local operator stack (status
  API + executor worker + Xaman signing) for full settlement.
- Four real, on-chain Coston2 evidence runs: a safe-calibration fallback, a
  protected success, a deliberate protected fallback, and the full canonical
  `0xE0` bare-failure recovery — plus a fresh post-timelock run captured
  during the submission window (see `docs/LIVE_EVIDENCE.md`).

## Smart contract addresses (Coston2, chainId 114)

| Contract | Address |
|---|---|
| MintShieldRouter | `0x439A334B0ddB791e9b5E03C3D72311D8807B7C04` |
| AdapterRegistry | `0x0f834C0EC1d913fb0F0E628C9788Fac9b5266530` |
| ERC4626DepositAdapter | `0x821a6Ed361a083EA9b0cd068F0F1c2ba9bf964fc` |
| FailureVault | `0x645d07486A51E38Eca424De0B6c375a38CA88989` |
| FXRP | `0x0b6A3645c240605887a5532109323A3E12273dc7` |

Full manifest, deployment transaction hashes and compiler profile:
`deployments/coston2.json`. Re-verify against live chain state at any time
with `npm run verify:coston2`.

## Roadmap / next steps

- Independent third-party contract audit before handling non-testnet value
  (a Slither static-analysis pass found no high/critical issues, but is not
  a substitute for one — see `docs/SECURITY_REVIEW.md`).
- Move Router/Registry administration from a single testnet owner to a
  documented multisig/timelock design.
- Host the durable job store and executor worker as a monitored private
  backend so public users can complete a full signed settlement from
  `mintshield.vercel.app` itself, not only via the local operator stack.
- Add rate limiting and anti-abuse controls to the public signing endpoint
  before enabling it.
- Define and audit additional fixed-purpose adapters beyond the single
  ERC-4626 demo target, without exposing arbitrary downstream calls.
- Add production observability for XRPL finality, FDC wait time, simulation
  failures and recovery states.

## Additional context (encouraged, not required)

- **Deployed on**: Coston2 (Flare Testnet, chainId 114). Not yet on Songbird
  or Flare Mainnet.
- **User acquisition / traction**: none yet — this is a hackathon-stage MVP
  with real testnet evidence but no external users, pilots or partner
  conversations to date. We'd rather say that plainly than overstate it.
- **Honest limitations**: MVP scope is deliberately narrow — one fixed-target
  ERC-4626-style adapter, one deterministic failure target, Coston2 only. It
  does not claim to protect malformed memo/nonce/proof failures, executor
  liveness, minting delays, wrong Core Vault payments, arbitrary contracts,
  or malicious approved adapters. Full details in `docs/GAP_ANALYSIS.md`.
