# Security review checkpoint

Review date: 30 July 2026. This is an internal engineering review, not an
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
| Tests | 66 passing |
| Solidity line coverage | 91.62% |
| Solidity statement coverage | 83.21% |
| Router `execute` gas, median | 191,494 |
| Router `execute` gas, observed max | 622,983 |
| Router runtime bytecode | 7,069 bytes |
| Production dependency audit | 0 findings |

Coverage includes test-only mocks, so percentages should not be interpreted as
a security guarantee.

## Open risks

- No independent audit or Slither run has been completed.
- Gas policy remains adapter-specific and must be recalibrated for every new
  target, even though the current policy passed a real Coston2 direct mint.
- Fallback still relies on normal FXRP ERC-20 transfer semantics.
- Registry ownership is centralized for the hackathon MVP.
- An owner-approved malicious adapter can spend its exact allowance while
  fabricating protocol-specific output unless its adapter invariants are
  independently reviewed.
- Runtime codehash does not identify a proxy implementation upgrade.
