# Threat model

## Assets and trust boundaries

The protected asset is FXRP controlled by a Flare Personal Account. Trust
crosses these boundaries:

1. XRPL wallet → client-generated payment and memo;
2. client → executor delivery of full `PackedUserOperation`;
3. FDC proof → AssetManager direct mint;
4. Flare Smart Accounts → MintShield Router;
5. Router → owner-approved adapter;
6. adapter → fixed DeFi target;
7. browser → localhost backend → Xaman signing API.

The XRPL signature and `0xFE` hash commitment prevent the executor from changing
the user operation. They do not prove that the frontend showed an honest,
human-readable intent.

## Security properties

- Router and adapters are non-upgradeable.
- The Router is reentrancy guarded and consumes an intent before target
  interaction.
- FXRP funding is exact and isolated in a catchable subcall.
- Adapter call plus all output/accounting checks share one rollback boundary.
- Router and adapter use balance deltas, not absolute zero-balance assumptions.
- Router→adapter and adapter→vault allowances are exact and reset to zero.
- Output is delivered directly to the Personal Account.
- Registry pins adapter codehash, asset and amount cap.
- Business failures settle as fallback; core accounting failures fail closed.

## Threats and controls

| Threat | Control | Residual risk |
|---|---|---|
| Frontend substitutes target or amount | 0xFE hash commitment; readable review; registry adapter ID | User can still sign a malicious UI payload |
| Executor changes calldata | `keccak256(_data)` checked against XRPL memo | Executor can censor or delay |
| Target revert/pause/cap | caught adapter boundary and exact FXRP refund | Protocol/memo errors remain outside boundary |
| Target returns false success | share balance delta and reported-return match | Only adapter-modeled invariants are checked |
| Target output below minimum | check inside rollback boundary | Bad `minOutput` chosen by user/client |
| Reentrancy | Router guard, early intent consumption, exact allowances | Novel token/target callback behavior needs fuzzing |
| Oversized return/revert data | copy at most 256 bytes at Router and vault boundaries | Diagnostic hash contains a bounded prefix, not the complete payload |
| Adapter gas griefing | fixed 500k adapter cap and 120k fallback reserve | Cap must be calibrated for every future adapter |
| Underfunded execution gas | 900k entry floor before token movement | Recalibrated from the first live Coston2 trace; recheck for every adapter |
| Donated token dust | per-intent balance snapshots | Directly donated tokens remain stranded by design |
| Malicious approved adapter | codehash, cap, owner policy, external call (no delegatecall) | An approved malicious adapter can steal its allowance |
| Adapter replacement | versioned registry event, codehash | Current owner is trusted during MVP |
| Proxy vault upgrade | fixed non-proxy MVP target | Generic proxy implementation cannot be pinned by `EXTCODEHASH` |
| Fee changes use old PA balance | explicit exact spend authorization and UI warning | Router cannot identify freshly minted units |
| Replay | domain-separated intent ID and Smart Account memo nonce | A malformed user operation can still require `0xE0` |
| Rate-limit delay | executor `DELAYED` state and same-proof retry | Operational liveness |
| Wrong Core Vault/payment below fee | runtime lookup and preflight | Some mistakes are irreversible and not recoverable |
| Packed user operation reverts at current Flare state | exact proof-aware `executeDirectMintingWithData` `eth_call` gates protected broadcast | State can change after simulation; on-chain deadline/slippage guards and isolation remain authoritative |
| Xaman API secret exposed to browser or logs | backend-only headers, redacted responses, git-ignored env and explicit enable gate | Host compromise can still expose process credentials |
| Forged Xaman QR/deeplink/status URL | response host/protocol allowlist and restrictive CSP | Xaman domain or local backend compromise remains trusted |
| WebSocket event spoofing or race | WebSocket is only a trigger; backend re-fetches authoritative payload status | Xaman API availability can delay confirmation |
| Wrong XRPL signer, network or payment fields | Xaman account/Testnet/txid checks plus independent XRPL source, Core Vault, amount, delivered amount, memo, finality and DestinationTag validation | XRPL node and Xaman availability can delay confirmation |

## Expected non-reverting failures

Deadline, disabled adapter, Router pause, amount cap, replay, funding mismatch,
target revert, minimum-output failure and modeled post-condition failure should
return a fallback result.

## Fail-closed conditions

The enclosing operation may still revert when:

- the Router reentrancy guard is triggered;
- `execute` receives less than the minimum safe gas floor;
- a fallback FXRP transfer itself fails;
- fallback balance accounting cannot return to the pre-call snapshot;
- Registry access is corrupted or unexpectedly reverts;
- an owner-only administrative invariant fails;
- the protected FXRP implementation violates assumed ERC-20 semantics in a way
  the isolated funding call cannot safely normalize.

These are intentionally routed to Flare's official stuck-mint recovery rather
than hidden by a false “safe” event.

## Required pre-production work

- Stateful fuzzing of success/fallback balance conservation.
- Invariant: Router cannot reduce any account's balance without that account
  being `msg.sender` in the current intent.
- Invariant: failed adapter path leaves target, adapter and output balances
  unchanged.
- Malicious ERC-20 return/reentrancy test corpus.
- Malicious/malformed adapter return-data test corpus.
- Recalibrate gas cap/reserve with a real Coston2 trace.
- Slither, coverage and independent audit.
- Multisig/timelock governance with published operational playbook.
