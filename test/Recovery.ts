import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sliceHex } from "viem";
import { encodeSkipMemo } from "../src/executor/recovery.js";

const TARGET = `0x${"ab".repeat(32)}`;

describe("0xE0 recovery encoding", function () {
  it("builds the exact 42-byte skip-memo instruction", function () {
    const memo = encodeSkipMemo({
      targetTransactionId: TARGET,
      walletId: 7,
      executorFeeUBA: 25_000n,
    });

    assert.equal((memo.length - 2) / 2, 42);
    assert.equal(sliceHex(memo, 0, 1), "0xe0");
    assert.equal(sliceHex(memo, 10, 42), TARGET);
  });

  it("rejects header values that do not fit", function () {
    assert.throws(() =>
      encodeSkipMemo({ targetTransactionId: TARGET, walletId: 256 }),
    );
    assert.throws(() =>
      encodeSkipMemo({
        targetTransactionId: TARGET,
        executorFeeUBA: 1n << 64n,
      }),
    );
  });
});
