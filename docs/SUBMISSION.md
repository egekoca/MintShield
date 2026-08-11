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

**Problem, in one sentence:** a user signs one XRPL payment to mint FXRP and
use it immediately in a Flare Smart Account — and if the downstream DeFi
step fails, their XRP is spent, no FXRP was minted, and they're now stuck
until they notice, understand, and send a **second** XRPL payment carrying
Flare's `0xE0` recovery instruction.

MintShield removes that stuck state. It puts the downstream DeFi action
behind a catchable subcall inside the same signed operation: on success it
settles normally; on failure it automatically returns the exact FXRP input
to the user's Personal Account, in the same transaction, with no revert and
no second payment. One XRPL signature — the action succeeds, or the user's
FXRP comes back safely, every time.

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

**This isn't "an app that happens to be deployed on Flare" — the failure
mode MintShield fixes only exists because of two Flare-specific design
choices.** First, a Flare Smart Account's Personal Account executes its
`Call[]` atomically: any revert anywhere in the sequence reverts the whole
user operation, including the FXRP mint itself. Second, FXRP direct minting
is proof-gated — the XRPL payment settles irreversibly on XRPL *before* FDC
can even be asked for a proof, so by the time the mint call is made, the
user's XRP is already gone regardless of what happens next. Combine those
two and you get a real, reproducible stuck state that is specific to this
architecture, not a generic "smart contract might revert" concern. Move this
same flow to a chain without atomic Smart Account operations or without
proof-gated asset minting, and the failure mode this project exists to solve
simply doesn't arise the same way. Concretely:

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

## Verify it yourself

No claim above needs to be taken on faith — everything is either a public
transaction or a command you can run against live chain state.

**Freshest evidence (10 August 2026, current post-timelock deployment):**

| | XRPL payment | FDC round | Coston2 settlement |
|---|---|---|---|
| Protected success | [`0BA187…63AE1`](https://testnet.xrpl.org/transactions/0BA187D6DED57F6B7047137FB8B142973A30C3607A7564965918DEEB48063AE1) | [1421432](https://coston2-systems-explorer.flare.network/voting-round/1421432?tab=fdc) | [`4335FA…19694`](https://coston2-explorer.flare.network/tx/0x4335fac642646f5ccc5b93d60e5ab4ab68f818df03ef73215592d4b324519694) |
| Protected fallback | [`057F0C…99926`](https://testnet.xrpl.org/transactions/057F0C354C614512BE8AC45FB55C3429A0A1B9B7628F0908AE90B297B4099926) | [1421435](https://coston2-systems-explorer.flare.network/voting-round/1421435?tab=fdc) | [`52DC27…59133`](https://coston2-explorer.flare.network/tx/0x52dc27102f400ffc1d77ac5df258f1a4e9f9ba4f73ac7a26d26ce95a76259133) |

Both carry the `SIMULATION_PASSED` / `OUTER_CALL_NON_REVERTING` checkpoint
(the executor's own `eth_call` gate, recorded before it broadcast). Full
list including the original 30 July runs and the canonical `0xE0` recovery:
`docs/LIVE_EVIDENCE.md` and the machine-readable
[`evidence/live-runs.json`](../evidence/live-runs.json) /
[`evidence/bare-recovery.json`](../evidence/bare-recovery.json).

**Re-derive it yourself, no trust required:**

```bash
npm run verify:coston2       # contract code, ownership, wiring vs. live chain
npm run verify:settlements   # balances/allowances vs. the evidence claims above
npm run status:coston2       # current protocol state, read-only, no key needed
```

**Or skip the CLI** and just open the explorer links in the table, or
`mintshield.vercel.app`'s Evidence tab, which reads the same
`evidence/live-runs.json` file live.

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

## What's real, mocked, trusted, or still incomplete

**Real** — live on Coston2 testnet, independently verifiable, not simulated
in a UI or faked for the demo:
- Every XRPL payment, FDC proof request/round, and Coston2 transaction
  linked in this document and in `docs/LIVE_EVIDENCE.md`.
- The Router/Registry/adapter/vault contracts: non-upgradeable, deployed,
  codehash-pinned, independently re-checkable with `npm run verify:coston2`.
- The `eth_call` full-transaction simulation the executor requires before
  every broadcast — a real RPC call against the exact proof-bearing request,
  not a client-side approximation.
- The revert-isolation and fallback mechanism itself: exercised by the
  adversarial unit test suite (reentrancy, gas griefing, returndata
  bombing, false-success adapters) and by the live runs above.

**Mocked / a stand-in on purpose** — deliberately narrow for the MVP, not
disguised as more than it is:
- `FailureVault` and `ERC4626DepositAdapter` are a single fixed demo DeFi
  target (a bare ERC-4626-shaped deposit), not a real yield protocol. They
  exist to demonstrate success/false-success/revert behavior on the
  downstream side of the Router, and the vault mode can be flipped
  (`npm run vault:mode`) purely to reproduce both outcomes on demand.

**Trusted (by design, same as the rest of the FAssets ecosystem)**:
- Flare's own FDC attestation set and `AssetManagerFXRP` / direct-minting
  contracts — MintShield reads and calls these, it doesn't second-guess
  their correctness.
- Vercel, for hosting the public **read-only** preview/evidence site.
- Xaman, as the signer for the local operator flow — it never receives more
  than a payment template; the seed never leaves the user's wallet.

**Still incomplete** — not yet true, stated plainly rather than implied:
- Public, browser-based signing: the live `mintshield.vercel.app` deployment
  is read-only by design; a full signed settlement currently requires the
  local operator stack (durable job store + executor worker), documented in
  the README's "Local testnet operator" section.
- Independent third-party security audit (a Slither static-analysis pass
  found no high/critical issues, but that is not a substitute — see
  `docs/SECURITY_REVIEW.md`).
- Multisig/timelock administration for the Router/Registry — currently a
  single testnet owner key.
- Anything beyond the single fixed ERC-4626 adapter, and anything beyond
  Coston2 (no Songbird or Mainnet deployment yet).
- Malformed memo/nonce/proof failures, executor liveness, minting delays,
  wrong Core Vault payments, arbitrary contracts, or malicious approved
  adapters — explicitly out of MVP scope, not silently unhandled. Full list
  in `docs/GAP_ANALYSIS.md`.

## Additional context (encouraged, not required)

- **Deployed on**: Coston2 (Flare Testnet, chainId 114). Not yet on Songbird
  or Flare Mainnet.
- **User acquisition / traction**: none yet — this is a hackathon-stage MVP
  with real testnet evidence but no external users, pilots or partner
  conversations to date. We'd rather say that plainly than overstate it.
