# Security review checkpoint

Review date: 3 August 2026. This is an internal engineering review, not an
independent audit.

## Resolved findings

### MS-01 — unbounded external returndata

Previous `catch (bytes memory reason)` and low-level calls could copy all
returndata from an adapter or vault. A hostile target could return tens of
kilobytes and consume memory/gas before the Router reached its fallback.

Resolution:

- Router self-calls copy at most 256 returndata bytes;
- Router→adapter calls copy at most 256 bytes;
- adapter `asset()` and `deposit()` calls copy at most 256 bytes;
- diagnostic hashes commit to copied data and the observed full returndata
  length;
- success paths require the exact 32-byte ABI return length.

Tests cover 64 KiB revert data, 64 KiB success data and a malformed 31-byte
success response at both Router→adapter and adapter→vault boundaries.

### MS-02 — unbounded adapter gas consumption

Keeping gas for fallback was sufficient for safety but not cost control. A
gas-burning adapter consumed all forwarded gas; measurement reached
15,718,838 gas while still settling as fallback.

Resolution:

- the MVP Router caps the immutable adapter call at `500,000` gas;
- it separately reserves `120,000` gas outside the self-call for refund and
  event settlement;
- gas-exhaustion adapters and vaults remain bounded by the fixed cap and
  fallback reserve.

The cap is intentionally specific to the single MVP adapter. Any future adapter
must be benchmarked and may require a versioned per-adapter gas policy.

### MS-03 — gas-estimation path ambiguity

At low transaction gas, an isolated funding self-call could run out of gas and
return a cheap business fallback. An estimator could then select that cheaper
path instead of providing enough gas for the intended action.

Resolution:

The first live Coston2 trace showed that a `500,000` entry floor let the
estimator choose a transaction where the adapter received only about `224,000`
gas. The target deposit then ran out of gas and correctly settled as fallback.
The floor is now `900,000` and the adapter cap is `500,000`; below the floor the
Router reverts before token movement. Tests verify the low-gas call fails closed
and leaves balances unchanged. A second XRPL → FDC → Coston2 run with the
revised deployment settled successfully with exact 1,000,000 UBA input/output.

### MS-04 — advisory checks mistaken for execution simulation

The browser could validate bounds, current nonce, live fees and signed limits,
but it could not faithfully execute the future Personal Account call before
the XRPL payment and FDC proof existed. Treating those checks as a complete
simulation would create false confidence.

Resolution:

- planning checks are explicitly labeled as advisory and the UI reports the
  full simulation as pending;
- after `PROOF_READY`, the executor performs `eth_call` on the exact
  `executeDirectMintingWithData(proof, userOpData)` request using the broadcast
  account and call value;
- a revert prevents `writeContract`; a pass is durably recorded as
  `SIMULATION_PASSED` before broadcast;
- a pass is labeled `OUTER_CALL_NON_REVERTING`; it does not misrepresent a
  possible isolated adapter fallback as guaranteed DeFi success;
- public job errors report that the simulation blocked broadcast without
  embedding proof or full user-operation arguments from the RPC error;
- delayed protected mints are re-simulated before retry;
- only the deliberate reverting bare comparison may bypass the gate, and the
  bypass policy is recorded separately;
- deadline, slippage and accounting checks remain enforced on-chain because
  state can change between simulation and inclusion.

## Adversarial test matrix

The local suite now exercises:

- target revert and false-success behavior;
- output below signed minimum;
- exact-input funding failure;
- malformed, oversized and gas-burning adapter responses;
- malformed, oversized and gas-burning vault responses;
- adapter and ERC-20 callback reentrancy;
- replay, pause, deadline, cap and codehash policy;
- donated dust and residual allowance checks;
- a stateful mixed success/fallback FXRP conservation sequence.

## Measurements

Hardhat default-profile measurements:

| Metric | Result |
|---|---:|
| Tests | 76 passing |
| Solidity line coverage | 91.62% |
| Solidity statement coverage | 83.21% |
| Router `execute` gas, median | 191,494 |
| Router `execute` gas, observed max | 622,983 |
| Router runtime bytecode | 7,069 bytes |
| Production dependency audit | 0 findings |

Coverage includes test-only mocks, so percentages should not be interpreted as
a security guarantee.

## Independent static analysis (Slither)

Run 10 August 2026 with `slither 0.11.4` / `solc 0.8.27`, targeting each
production contract individually (`--solc-remaps
@openzeppelin=node_modules/@openzeppelin`).

| Contract | Findings | Severity |
|---|---|---|
| `MintShieldRouter.sol` | 1 arbitrary-from, 5 strict-equality, 1 timestamp, 3 assembly, pragma/dead-code notes | None high/critical |
| `AdapterRegistry.sol` | 1 strict-equality, 1 timestamp, pragma notes | None high/critical |
| `ERC4626DepositAdapter.sol` | 1 arbitrary-from, 2 assembly, pragma notes | None high/critical |

No reentrancy, access-control, or unchecked-external-call findings. Reviewed
in detail:

- **arbitrary-from in `transferFrom`** (`Router.pullAsset`,
  `ERC4626DepositAdapter.execute`): both flagged calls use a caller-supplied
  `from`, but `pullAsset` is gated `onlySelf` and `from` is the Router's own
  validated `intent.personalAccount`, never arbitrary external input. False
  positive for this access pattern.
- **Strict equality on selectors / `effectiveAt == 0`**: intentional exact
  4-byte selector matching (`_classifyAdapterFailure`) and an explicit
  "no pending change" sentinel (`AdapterRegistry.activateAdapter`), not
  unsafe balance/state comparisons. Slither's detector is documented as
  prone to this class of false positive.
- **Assembly usage**: all in the reviewed bounded-returndata call helpers
  (MS-01 above) and OpenZeppelin's own `SafeERC20`/`StorageSlot`, not new
  unreviewed low-level code.
- **Pragma/solc-version notes**: OpenZeppelin's own floating pragmas
  (`^0.8.20`, `>=0.6.2`, `>=0.4.16`); MintShield's own files pin `^0.8.27`
  and the deployed build uses the exact `0.8.27` compiler.

This is an automated best-effort scan run by the project team, not an
independent third-party audit; it does not substitute for one. It closes the
"no static-analysis pass performed" gap listed below but not the "no
independent review" one.

## Open risks

- No independent third-party audit has been completed. A Slither static
  analysis pass has (see above); it found no high/critical issues but is not
  a substitute for independent review.
- Gas policy remains adapter-specific and must be recalibrated for every new
  target, even though the current policy passed a real Coston2 direct mint.
- Fallback still relies on normal FXRP ERC-20 transfer semantics.
- Registry ownership is centralized for the hackathon MVP.
- An owner-approved malicious adapter can spend its exact allowance while
  fabricating protocol-specific output unless its adapter invariants are
  independently reviewed.
- Runtime codehash does not identify a proxy implementation upgrade.

## Xaman boundary

Browser signing sessions persist only the Xaman payload UUID and public
transaction coordinates. API credentials remain backend-only and full
user-operation bytes remain in the executor database. A Xaman `signed` status
does not authorize FDC submission by itself: the worker re-reads the validated
XRPL transaction and requires the exact source account, Core Vault
destination, drops amount, delivered amount and 42-byte `0xFE` memo, with no
DestinationTag or partial-payment flag.
