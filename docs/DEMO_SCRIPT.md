# 3-minute demo script

For the DoraHacks submission video. Screen-record the terminal and the
explorer tabs listed below; no editing needed beyond trimming dead air.
Say the bracketed lines aloud or as on-screen captions. Structure: hook with
the user and problem immediately, prove the failure is real, then demo
**one** complete protected-mint flow end to end (both of its outcomes),
close with verifiability and honest scope.

Before recording, keep these tabs ready:
- `https://mintshield.vercel.app` (public dashboard — hero now leads with
  "You mint FXRP through a Flare Smart Account...")
- XRPL Testnet explorer: `https://testnet.xrpl.org`
- Coston2 explorer: `https://coston2-explorer.flare.network`
- A terminal in the repo root with `.env` already configured

## 0:00 – 0:15 — The user and the problem, immediately

[On screen: `mintshield.vercel.app` hero.]

"You're a Flare user. You mint FXRP through your Smart Account and use it
immediately in a DeFi action — one signature. If that next step fails, your
XRP is already spent, no FXRP was minted, and you're stuck until you notice
and send a second XRPL payment. That's the problem. MintShield fixes it."

## 0:15 – 0:40 — Prove the failure is real (compressed)

```bash
npm run comparison:bare -- --broadcast
```

[While it runs:] "Real XRPL payment, real FDC proof, calling the target
directly with no MintShield in front of it, target set to fail."

[Cut straight to the reverted Coston2 explorer tx — a couple of seconds, not
a full walkthrough.]

"Reverted. FXRP never minted. Stuck until a second payment. This is
`docs/LIVE_EVIDENCE.md`'s bare-failure case, reproduced live — now watch the
same failure through MintShield."

## 0:40 – 2:40 — One complete flow, both outcomes

This is the spine of the video: **one pipeline** — XRPL payment → FDC proof
→ full-call simulation → Coston2 settlement — shown completely, end to end,
run twice to show its two possible outcomes. Don't cut away mid-pipeline;
let each stage transition happen on screen.

```bash
npm run executor:run -- --input executor-input.example.json
```

[Narrate each stage as it appears in the job output:]

"One XRPL signature. The executor waits for XRPL finality, requests the FDC
proof, then — before it ever broadcasts — runs a real `eth_call` simulation
of the exact proof-bearing transaction. Only a passing simulation reaches
`SIMULATION_PASSED`. Then it submits to Flare."

[On screen: final JSON, `"status": "SETTLED_SUCCESS"`. Cut to the Coston2
explorer tx — a few seconds.]

"Settled. FXRP in, vault shares out, 1:1. That's outcome one: the action
succeeds."

[Toggle the same downstream target to fail, run the identical pipeline
again:]

```bash
npm run vault:mode -- --mode REVERT_ALWAYS -- --broadcast
npm run executor:run -- --input executor-input-fallback.json
```

"Same pipeline, same signature, same target — but now it fails downstream.
Watch: XRPL finality, FDC proof, simulation, submission — identical path.
The difference is what happens next."

[On screen: `"status": "SETTLED_FALLBACK"`. Cut to the Coston2 explorer tx.]

"The Router catches the isolated revert inside the same transaction and
returns the exact FXRP straight back to the Personal Account. Outcome two:
no revert, no second payment, no stuck funds — the exact same one signature
from a minute ago."

[Restore the target:]

```bash
npm run vault:mode -- --mode NONE -- --broadcast
```

## 2:40 – 2:55 — Verify it, don't take our word for it

[On screen: the contract address table and the two explorer tx links from
this recording, or `docs/SUBMISSION.md`'s "Verify it yourself" table.]

"Every transaction you just watched is public. Contracts are
non-upgradeable and codehash-pinned — re-check them yourself with
`npm run verify:coston2` and `npm run verify:settlements`, no trust
required. And for the case that already went wrong at the start of this
video, Flare's own canonical `0xE0` recovery still works exactly as
documented — MintShield doesn't replace it, it exists so most users never
need it."

## 2:55 – 3:00 — Close: what's real, what isn't yet

"Everything you saw is live Coston2 testnet, not a mock. What's still
missing: public browser signing, an independent audit, multisig ownership —
listed plainly, not hidden, in the repo's gap analysis."

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
- Keep the two "prove the failure" and "one complete flow" sections visually
  distinct (e.g. a title card) so a judge skimming the video timeline can
  tell which segment is which without watching narration.
