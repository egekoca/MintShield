# Research notes and project verdict

Research date: 30 July 2026.

## Verdict

The core failure mode is real, narrow and Flare-specific enough to justify the
project. Official documentation states that one failed call reverts the full
Personal Account user operation, and that a Smart Account execution revert
prevents FXRP minting while XRP remains at the Core Vault. The official Smart
Accounts source confirms that memo dispatch is not wrapped in `try/catch`.

The idea survives the initial architecture review with one condition: the live
Coston2 comparison must reproduce the failure and safe fallback in the first
two development days. If the currently deployed Coston2 version or an official
vault path already catches the same downstream failure, the project must pivot
instead of shipping a redundant wrapper.

## What the document got right

- It targets `Interoperable Asset Products`, not the unrelated confidential
  compute bounty.
- It explicitly avoids claiming to replace FAssets or Smart Accounts.
- It scopes protection to supported adapters and downstream failures.
- It makes real XRPL Testnet + FDC + Coston2 evidence part of Definition of Done.
- It recognizes `msg.sender`, allowance, post-condition and proxy risks.
- It centers the demo on failure comparison, where the product value is visible.

## Architectural corrections applied

1. Absolute “residual balance must be zero” checks were replaced with
   per-call balance snapshots. Anyone can donate ERC-20 tokens to a Router.
2. Router-level `minOutput` validation moved inside an isolated external
   self-call so a failed post-condition rolls back target state.
3. Funding itself is isolated. An exact-input `transferFrom` failure returns
   normally with FXRP still in the Personal Account.
4. Replay, pause, deadline and caps consume/refund an exact allowance when
   funding is possible.
5. The ERC-4626 adapter is fixed to one target. A generic calldata forwarder
   would make the security claim unreviewable.
6. Codehash protection is described honestly: it does not detect ordinary proxy
   implementation upgrades.
7. “Fresh mint only” is not claimed. ERC-20 units from the same address are not
   provenance-aware.
8. Direct-mint gross-up uses the fee on the gross received amount. In the Smart
   Accounts branch, the memo executor fee is paid after minting; the ordinary
   AssetManager default executor fee is not deducted a second time during the
   normal `0xFE` path. A live `0xE0` recovery confirmed the ignored original
   memo uses the default executor fee, because its memo fee header is skipped.
9. The broad Flare Wagmi package was removed from the executor runtime. Its
   Coston2 v3.6.0 ABI fragments were narrowed to the canonical functions and
   tuples MintShield actually calls, avoiding UI/codegen packages in the
   key-holding process.

## Live Coston2 read-only snapshot

Observed 30 July 2026 through the public Coston2 RPC:

| Item | Value |
|---|---|
| Chain / observed block | `114` / `33416559` |
| Registry | `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` |
| MasterAccountController | `0x434936d47503353f06750Db1A444DBDC5F0AD37c` |
| AssetManagerFXRP | `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA` |
| FXRP | `0x0b6A3645c240605887a5532109323A3E12273dc7` |
| FdcHub | `0x48aC463d7975828989331F4De43341627b9c5f1D` |
| Core Vault XRPL address | `rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p` |
| Minimum fee / fee BIPS | `100000 UBA` / `25` |
| Large mint threshold / delay | `100000000000 UBA` / `3600 s` |

All resolved core addresses returned deployed bytecode. This table is evidence
of one observation, not an application configuration: the implementation
always resolves current addresses and settings at runtime.

## Hackathon fit

The published Summer Signal criteria emphasize product usefulness, meaningful
Flare integration, working technical execution, evidence of new work, clarity
and future potential. MintShield fits if the submission visibly proves:

- actual XRPL payment;
- actual FDC `XRPPayment` proof;
- `executeDirectMintingWithData` on Coston2;
- bare downstream revert causing the documented stuck behavior;
- the same target through MintShield producing a normal Flare transaction and
  Personal Account FXRP fallback;
- contract addresses, hashes, tests and a clear “built during hackathon” list.

A local Router demo alone would score poorly on integration quality.

## Primary official sources

- [Flare Smart Accounts overview](https://dev.flare.network/smart-accounts/overview)
- [Custom Instruction (`0xFE`)](https://dev.flare.network/smart-accounts/custom-instruction)
- [Minting troubleshooting](https://dev.flare.network/fassets/troubleshooting/minting-troubleshooting)
- [Recover Stuck Mint Transaction](https://dev.flare.network/smart-accounts/guides/typescript-viem/recover-stuck-mint-transaction-ts)
- [IPersonalAccount reference](https://dev.flare.network/smart-accounts/reference/IPersonalAccount)
- [IMasterAccountController reference](https://dev.flare.network/smart-accounts/reference/IMasterAccountController)
- [XRPPayment attestation](https://dev.flare.network/fdc/attestation-types/xrp-payment)
- [Check direct minting limits](https://dev.flare.network/fassets/developer-guides/fassets-mint-limits)
- [Smart Accounts source](https://github.com/flare-foundation/flare-smart-accounts)
- [Viem starter](https://github.com/flare-foundation/flare-viem-starter)

## Hackathon source note

The DoraHacks page currently challenges automated access. Timeline, prize and
judging text were cross-checked through the indexed event listing:
[Flare Summer Signal](https://www.hackathonradar.com/database/hackathon/93d91cae-47e7-4db4-8734-1a9ed4d3fc9a).
Before submission, the team should manually re-check the DoraHacks page while
logged in and capture the final form fields.
