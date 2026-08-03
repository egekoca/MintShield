# MintShield architecture

## 1. Product invariant

For a configured FXRP adapter and a well-formed Personal Account call:

```text
SUCCESS  = adapter state commits, measured output >= signed minOutput
FALLBACK = adapter and target state roll back, exact input returns to caller
```

The Router returns normally for modeled business failures. This is what allows
the surrounding Personal Account user operation and direct mint to finalize.
Safety-critical accounting failures still revert and fall back to Flare's
official recovery path.

The invariant is intentionally not “the Router can never revert” and not “all
direct-mint failures are solved.”

## 2. Verified upstream behavior

The design depends on four current Flare behaviors:

1. `0xFE` commits to `keccak256(abi.encode(PackedUserOperation))` in a fixed
   42-byte XRPL memo.
2. `MasterAccountController` distributes minted FXRP to the Personal Account and
   dispatches the committed user operation in the same transaction.
3. `PersonalAccount.executeUserOp(Call[])` calls each target with the Personal
   Account as `msg.sender`; one failed call reverts the full batch.
4. There is no `try/catch` around memo dispatch in `handleMintedFAssets`, so a
   downstream revert rolls back distribution and direct mint finalization.

These are documented by Flare and visible in
`PersonalAccount.sol`, `MemoInstructions.sol`, and
`MemoInstructionsFacet.sol` in the official Smart Accounts repository.

## 3. Component topology

```text
XRPL wallet
  │ Payment to current Core Vault + 42-byte 0xFE memo
  ▼
XRPL Testnet ── FDC XRPPayment proof ──► executor
                                            │
                                            ▼
                         AssetManagerFXRP.executeDirectMintingWithData
                                            │
                                            ▼
                         MasterAccountController.handleMintedFAssets
                                            │
                          FXRP + dispatch    ▼
                                      Personal Account
                               Call 1: FXRP.approve(Router, exactInput)
                               Call 2: Router.execute(signed intent)
                                            │
                         exact transferFrom │
                                            ▼
                                     MintShieldRouter
                             ┌───────────────┴────────────────┐
                             │ isolated external self-call    │
                             ▼                                │
                      fixed-target adapter                    │
                             │ deposit + output checks        │
                             ▼                                │
                         ERC-4626 vault                       │
                             │                                │
                 success ────┘              revert/post-check failure
                    │                                      │
                    ▼                                      ▼
           shares to Personal Account          subcall state fully rolls back
                                               Router returns input FXRP
```

The client, executor, FDC and Flare protocol contracts are integration layers.
The new on-chain security boundary is Router → approved adapter → fixed target.

## 4. Intent and authorization

The signed intent contains:

- Personal Account and FXRP address;
- exact raw FXRP input amount;
- versioned adapter ID;
- adapter-specific data;
- minimum acceptable output;
- deadline;
- arbitrary replay nonce.

The intent ID is domain-separated by `chainId` and Router address. Adapter data
is committed by hash. The Smart Account's own memo nonce independently protects
the `PackedUserOperation`; the Router intent ID prevents the same economic
instruction from being settled twice under a newly signed Smart Account nonce.

The first user-op call grants the Router an exact allowance. The second call is
made with the Personal Account as `msg.sender`. The Router pulls only from that
caller and never from the address supplied by a third party.

## 5. Two nested rollback boundaries

### 5.1 Funding boundary

The Router calls its own `pullAsset` entry point externally and catches failure.
That self-call performs `transferFrom` and validates the exact balance delta.
If FXRP funding is insufficient or token behavior is inexact, the subcall rolls
back and the Router returns an unfunded fallback. FXRP therefore remains in the
Personal Account rather than reverting the direct mint.

### 5.2 Adapter boundary

The Router calls its own `executeAdapter` entry point externally. Inside that
single boundary it:

1. grants the adapter an exact allowance;
2. calls the adapter;
3. decodes its return value;
4. verifies `amountOut >= minOutput`;
5. resets and verifies allowance;
6. verifies the adapter spent exactly the funded input.

If any step fails, the entire wrapper subcall—including all adapter and vault
state—rolls back. The outer Router catches the revert and returns the original
FXRP.

This ordering matters. Checking `minOutput` in the outer Router after a
successful target call would be too late: the target state would already have
committed inside the Router frame.

Untrusted calls never copy more than 256 bytes of returndata. The diagnostic
hash commits to the bounded prefix and observed full length. The fixed MVP
adapter receives at most 500,000 gas, while the outer self-call retains 120,000
gas for refund accounting and settlement events.

`execute` requires 900,000 gas at entry. Below that floor it reverts before
funding. This avoids a gas estimator mistaking an out-of-gas funding subcall for
a legitimate inexpensive fallback.

## 6. Balance-delta accounting

Contracts cannot prevent arbitrary ERC-20 donations. Therefore “Router balance
must be zero” is not a safe invariant. MintShield snapshots the Router balance
before each intent:

```text
after pull     = balanceBefore + inputAmount
after success  = balanceBefore
after fallback = balanceBefore
```

The adapter applies the same rule to its own asset balance and measures the
Personal Account's vault-share delta. Donated dust is neither spent nor swept.

## 7. Adapter model

The MVP adapter is deployed for one immutable `(router, FXRP, vault)` tuple.
It verifies:

- only the Router can call it;
- the requested asset is the immutable FXRP address;
- target runtime codehash is unchanged;
- `vault.asset()` is FXRP;
- the exact input arrives from the Router;
- the vault-reported shares equal the Personal Account balance delta;
- actual shares meet `minOutput`;
- adapter residual FXRP and vault allowance return to their pre-call state.

The adapter sends vault shares directly to the Personal Account. It does not
custody output.

## 8. Registry and governance

`AdapterRegistry` binds an adapter ID to implementation, asset, runtime
codehash, max input, enabled state and monotonically increasing version.
The Router additionally pins one protected asset in its immutable constructor.

Hackathon governance is an explicit centralization point. The current owner can
configure or disable adapters and pause new adapter execution. Router pause is
a safe-fallback mode, not a global revert mode.

Before any public-value pilot:

- replace the EOA owner with a multisig;
- add a timelock for enabling/configuring adapters;
- retain immediate disable through a narrowly scoped guardian;
- audit both Router and each adapter;
- publish deployed bytecode hashes and amount caps.

## 9. Proxy caveat

`EXTCODEHASH` pins runtime bytecode at an address. For a proxy it normally pins
the proxy shell, not the implementation behind its storage slot. It therefore
does not detect a normal implementation upgrade.

The MVP must use a non-proxy demo vault or a target whose implementation can be
verified through an explicit, trustworthy interface. A production adapter for
an upgradeable vault needs protocol-specific implementation detection,
governance monitoring and an emergency-disable procedure. MintShield must not
claim that generic proxy upgrades are solved by codehash pinning.

## 10. Fresh-mint accounting caveat

The Personal Account may already hold FXRP. The Router authorizes and spends the
signed `inputAmount` from the account's total balance; it cannot distinguish
which token units were minted earlier in the same transaction. If the net mint
is lower than expected but the account has an old balance, some old FXRP can
satisfy the exact input.

The client must display “total FXRP authorized for this action,” calculate
current fees immediately before XRPL signing, and avoid promising that only
freshly minted token units are spent. This limitation cannot be repaired inside
an ordinary ERC-20 Router without an upstream protocol hook that passes the
fresh mint amount.

## 11. Failure classification

| Code | Failure | Router outcome |
|---:|---|---|
| 0 | none | success |
| 1 | deadline expired | funded fallback |
| 2 | adapter missing/disabled/asset mismatch | funded fallback |
| 3 | adapter runtime codehash mismatch | funded fallback |
| 4 | exact input cannot be pulled | unfunded fallback; FXRP stays in PA |
| 5 | target call reverted | adapter rollback + funded fallback |
| 6 | minimum output not met | adapter rollback + funded fallback |
| 7 | post-condition/return/accounting failure | rollback + fallback |
| 8 | unsupported target/target codehash | rollback + fallback |
| 9 | Router safety pause | funded fallback |
| 10 | intent already used | funded fallback |
| 11 | configured amount cap exceeded | funded fallback |
| 12 | malformed caller/asset/amount/adapter ID | unfunded fallback |
| 255 | unknown adapter error | rollback + funded fallback |

## 12. Off-chain state machine

On-chain settlement events are the source of truth. The executor database is a
retryable projection:

```text
CREATED
  → XRPL_SIGNED
  → XRPL_FINALIZED
  → FDC_REQUESTED
  → PROOF_READY
  → SIMULATION_PASSED
  → FLARE_SUBMITTED
  ├→ DELAYED(retryAt) ──→ SIMULATION_PASSED ──→ FLARE_SUBMITTED
  ├→ SETTLED_SUCCESS
  ├→ SETTLED_FALLBACK
  └→ RECOVERY_REQUIRED
       → RECOVERY_PAYMENT_SIGNED
       → RECOVERY_PAYMENT_FINALIZED
       → RECOVERY_FDC_REQUESTED
       → RECOVERY_PROOF_READY
       → RECOVERY_FLAG_SUBMITTED
       → RECOVERY_FLAG_SET
       → RECOVERY_STUCK_SUBMITTED
       → RECOVERED
```

Before an XRPL transaction exists, the unique intent key is
`(personalAccount, smartAccountNonce)` and is bound to one `userOpHash` and
full `_data`. The signed XRPL hash then has a database uniqueness constraint.
The worker persists the signed transaction blob before broadcast, the FDC
transaction hash before waiting for its receipt, and the Flare transaction hash
before waiting for settlement. Restarts reconcile those hashes instead of
creating a new payment.

Recovery is a separate, explicit state machine because `0xE0` requires a
second XRPL payment. Its signed blob is persisted before broadcast, both Flare
transaction hashes are checkpointed, and `IgnoreMemoSet` plus the recovered
`DirectMintingExecuted` event are validated before the job becomes
`RECOVERED`. Since an ignored UserOp does not advance the memo nonce, only a
fully recovered job may archive its original intent key and release
`(personalAccount, nonce)` for a fresh UserOp.

A delayed mint is not a failure and must be retried with the same payment/proof
after `executionAllowedAt`. No second XRP payment should be suggested for a
delay.

Every network loop is bounded by a timeout and accepts an `AbortSignal`.
Proof data is checked locally for matching XRPL transaction ID, executor-bound
`proofOwner`, success status and positive received amount before gas is spent.

`SIMULATION_PASSED` is the primary EVM preflight gate. Once the FDC proof is
available, the executor runs a full `eth_call` of the exact
`AssetManagerFXRP.executeDirectMintingWithData(proof, userOpData)` request with
the same executor account and native call value that will be broadcast. A
revert blocks submission and remains retryable from `PROOF_READY`; success is
persisted with the committed user-operation hash before `writeContract` is
allowed. Delayed mints repeat the simulation immediately before their retry.
A pass means the outer direct-mint call is non-reverting at the simulated
state; it does not promise adapter success, because an isolated MintShield
fallback is intentionally also a successful outer call.

Earlier planning checks—input bounds, adapter cap, current nonce, live fee
quote, deadline and minimum output—remain useful filters but cannot replace the
proof-aware full call because FXRP does not exist in the Personal Account until
the direct-mint transaction executes. The intentionally reverting bare
comparison is the only simulation bypass and is labeled
`BYPASSED_EXPECTED_REVERT`; its purpose is to exercise Flare's canonical
`0xE0` backstop, not to define a production execution policy.

The SQLite store contains a signed XRPL blob so an interrupted broadcast can
resume. It does not store either private key, but the database must still be
treated as sensitive operational data and protected by filesystem permissions.

## 13. Deployment lookup

Clients and executors must resolve `MasterAccountController`,
`AssetManagerFXRP`, FXRP and the current Core Vault payment address at runtime
through Flare's Contract Registry and contract getters. Addresses must not be
copied from documentation into application constants. The Coston2 chain ID is
114.

## 14. Direct-mint amount calculation

For the Smart Accounts path, the AssetManager calculates the system minting fee
from the gross XRP amount. It mints `gross - systemFee` to the Smart Accounts
controller, which then pays the executor fee encoded in the `0xFE` memo. The
ordinary AssetManager default executor fee is not an additional deduction in
this path while the `0xFE` memo is executed normally. If `0xE0` causes the
original memo to be ignored, that retry has no active memo fee header and the
controller deliberately uses the live default executor fee instead.

The client therefore solves:

```text
gross - max(minimumFee, floor(gross × feeBIPS / 10_000))
      - memoExecutorFee
      >= exact Router input
```

Rounding is integer UBA/drops only; no floating XRP arithmetic is used.
