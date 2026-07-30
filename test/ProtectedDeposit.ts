import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress, keccak256, sliceHex } from "viem";
import {
  buildBareDepositCalls,
  buildBareHashInstruction,
  buildHashInstruction,
  buildProtectedDepositCalls,
  type MintShieldIntent,
} from "../src/client/protected-deposit.js";

const PERSONAL_ACCOUNT = getAddress(
  "0x1000000000000000000000000000000000000001",
);
const FXRP = getAddress("0x2000000000000000000000000000000000000002");
const ROUTER = getAddress("0x3000000000000000000000000000000000000003");
const VAULT = getAddress("0x4000000000000000000000000000000000000004");

const intent: MintShieldIntent = {
  personalAccount: PERSONAL_ACCOUNT,
  asset: FXRP,
  inputAmount: 1_000_000n,
  adapterId: `0x${"11".repeat(32)}`,
  adapterData: "0x",
  minOutput: 900_000n,
  deadline: 2_000_000_000n,
  nonce: 7n,
};

describe("0xFE protected deposit builder", function () {
  it("builds approve then router.execute in the required order", function () {
    const calls = buildProtectedDepositCalls(ROUTER, intent);

    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.target, FXRP);
    assert.equal(calls[1]?.target, ROUTER);
    assert.equal(calls[0]?.value, 0n);
    assert.equal(calls[1]?.value, 0n);
  });

  it("builds the exact 42-byte 0xFE memo", function () {
    const result = buildHashInstruction(ROUTER, intent, 3n, 25_000n);

    assert.equal((result.memoData.length - 2) / 2, 42);
    assert.equal(sliceHex(result.memoData, 0, 1).toLowerCase(), "0xfe");
    assert.equal(sliceHex(result.memoData, 10, 42), result.userOpHash);
    assert.equal(result.userOpHash, keccak256(result.data));
    assert.equal(result.totalCallValue, 0n);
  });

  it("changes the commitment when the Smart Account nonce changes", function () {
    const first = buildHashInstruction(ROUTER, intent, 3n, 0n);
    const second = buildHashInstruction(ROUTER, intent, 4n, 0n);

    assert.notEqual(first.userOpHash, second.userOpHash);
  });

  it("builds a bare approve then vault deposit comparison instruction", function () {
    const calls = buildBareDepositCalls({
      vault: VAULT,
      personalAccount: PERSONAL_ACCOUNT,
      asset: FXRP,
      amount: 1_000_000n,
    });
    const instruction = buildBareHashInstruction({
      vault: VAULT,
      personalAccount: PERSONAL_ACCOUNT,
      asset: FXRP,
      amount: 1_000_000n,
      smartAccountNonce: 5n,
      executorFeeUBA: 0n,
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.target, FXRP);
    assert.equal(calls[1]?.target, VAULT);
    assert.equal(instruction.userOpHash, keccak256(instruction.data));
    assert.equal((instruction.memoData.length - 2) / 2, 42);
  });

  it("rejects memo header fields that exceed their encoded size", function () {
    assert.throws(() => buildHashInstruction(ROUTER, intent, 0n, 0n, 256));
    assert.throws(() =>
      buildHashInstruction(ROUTER, intent, 0n, 1n << 64n),
    );
  });
});
