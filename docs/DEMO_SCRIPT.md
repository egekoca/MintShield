# 3-minute demo script — bare revert vs. MintShield

For the DoraHacks submission video. Screen-record the terminal and the
explorer tabs listed below; no editing needed beyond trimming dead air.
Say the bracketed lines aloud or as on-screen captions.

Before recording, keep these tabs ready:
- `https://mintshield.vercel.app` (public dashboard)
- XRPL Testnet explorer: `https://testnet.xrpl.org`
- Coston2 explorer: `https://coston2-explorer.flare.network`
- A terminal in the repo root with `.env` already configured

## 0:00 – 0:20 — The problem

[On screen: `docs/ARCHITECTURE.md` diagram or the README opening lines.]

"When a Flare Smart Account mints FXRP and immediately uses it in one signed
operation, a revert anywhere downstream reverts the *whole* operation. The
XRP already left the user's wallet on XRPL — but the FXRP is never minted.
Flare's own `0xE0` recovery fixes this, but it needs a second XRPL payment
the user has to notice and send themselves."

## 0:20 – 1:10 — Bare failure (no MintShield)

```bash
npm run comparison:bare -- --broadcast
```

[While it runs, narrate:] "This sends a real XRPL payment, waits for the FDC
proof, and calls the target contract directly — no Router in front of it —
while the demo vault is deliberately set to always revert."

[Cut to the resulting Coston2 explorer tab for the reverted transaction.]

"The Flare transaction reverted. The FXRP was never minted. The user's XRP
payment is now stuck until they send a second payment carrying the `0xE0`
recovery instruction — that's `docs/LIVE_EVIDENCE.md`'s bare-failure
transaction, reproduced live."

## 1:10 – 2:20 — Protected success and fallback through MintShield

```bash
npm run executor:run -- --input executor-input.example.json
```

[Narrate while the job progresses through XRPL finality → FDC proof →
simulation → settlement:]

"Same XRPL payment, same FDC proof — but this time the intent goes through
MintShieldRouter. The executor won't broadcast until an `eth_call` simulation
of the exact proof-bearing transaction passes — that's the
`SIMULATION_PASSED` checkpoint in the job state."

[On screen: the final JSON with `"status": "SETTLED_SUCCESS"` and the
`flareTxHash`. Cut to the Coston2 explorer tx.]

"Settled successfully — FXRP went in, vault shares came out, 1:1."

[Toggle the vault to always-revert and run one more job:]

```bash
npm run vault:mode -- --mode REVERT_ALWAYS -- --broadcast
npm run executor:run -- --input executor-input-fallback.json
```

"Same failure condition as the bare comparison a minute ago — but this time
the Router catches the isolated revert inside the same transaction and
returns the exact FXRP input straight back to the Personal Account.
`SETTLED_FALLBACK`. No second payment. No stuck funds. One signature."

[Restore the vault:]

```bash
npm run vault:mode -- --mode NONE -- --broadcast
```

## 2:20 – 2:50 — Recovery, for the record

[On screen: `docs/LIVE_EVIDENCE.md` recovery section, or the
`evidence/bare-recovery.json` file.]

"For the case that already went wrong in the bare-failure demo, Flare's
canonical `0xE0` recovery still works exactly as documented — MintShield
doesn't replace it, it exists so most users never need it."

## 2:50 – 3:00 — Close

[On screen: `mintshield.vercel.app`, contract address table.]

"MintShield: non-upgradeable, codehash-pinned contracts, live and verified on
Coston2, full evidence and honest limitations in the repo."

---

## Notes for the person recording

- The Xaman-signed browser flow (QR/deeplink approval on a phone) is a
  separate, optional B-roll clip — it requires a live phone interaction and
  can't be scripted; keep it out of the timed 3-minute cut unless there's
  room, since the CLI flow above already demonstrates the identical
  executor pipeline end to end.
- Re-run `npm run vault:mode -- --mode NONE -- --broadcast` at the end even
  if the recording is aborted partway, so the vault isn't left in
  `REVERT_ALWAYS` for the next real user.
- If a take needs a fresh nonce (a prior job already occupies the current
  one), check `npm run status:coston2` for the live
  `personalAccount.nonce` before starting.
