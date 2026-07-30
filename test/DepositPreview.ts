import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress } from "viem";
import {
  buildDepositPreview,
  normalizeDepositPreviewInput,
} from "../src/api/deposit-preview.js";

const deployment = {
  router: getAddress("0x1000000000000000000000000000000000000001"),
  vault: getAddress("0x2000000000000000000000000000000000000002"),
  fxrp: getAddress("0x3000000000000000000000000000000000000003"),
  adapterId: `0x${"44".repeat(32)}` as const,
  adapterVersion: 2,
  maxAmountUBA: 100_000_000n,
};

const chain = {
  personalAccount: getAddress(
    "0x4000000000000000000000000000000000000004",
  ),
  smartAccountNonce: 9n,
  settings: {
    coreVaultXrplAddress: "rCoreVault",
    minimumFeeUBA: 10_000n,
    feeBIPS: 10n,
    defaultExecutorFeeUBA: 100_000n,
    hourlyLimitUBA: 1_000_000_000n,
    dailyLimitUBA: 5_000_000_000n,
    largeMintingThresholdUBA: 50_000_000n,
    largeMintingDelaySeconds: 3_600n,
  },
};

describe("protected deposit preview", function () {
  it("normalizes six-decimal UI amounts and builds a review-safe commitment", function () {
    const normalized = normalizeDepositPreviewInput({
      xrplAddress: "rExample",
      amountFxrp: "1",
      minimumShares: "0.95",
      executorFeeFxrp: "0.025",
      deadlineMinutes: 90,
    });
    const preview = buildDepositPreview({
      normalized,
      deployment,
      chain,
      nowSeconds: 2_000_000_000n,
    });

    assert.equal(normalized.amountUBA, 1_000_000n);
    assert.equal(normalized.minimumShares, 950_000n);
    assert.equal(preview.intent.nonce, "9");
    assert.equal(preview.intent.minimumShares, "0.95");
    assert.equal(preview.intent.fallbackReceiver, chain.personalAccount);
    assert.equal(preview.commitment.memoBytes, 42);
    assert.equal(preview.commitment.callCount, 2);
    assert.match(preview.commitment.userOpHash, /^0x[0-9a-f]{64}$/);
    assert.equal(preview.quote.expectedPersonalAccountFxrp, "1");
  });

  it("rejects precision, invalid deadlines and values above the adapter cap", function () {
    assert.throws(() =>
      normalizeDepositPreviewInput({
        xrplAddress: "rExample",
        amountFxrp: "1.0000001",
        minimumShares: "1",
      }),
    );
    assert.throws(() =>
      normalizeDepositPreviewInput({
        xrplAddress: "rExample",
        amountFxrp: "1",
        minimumShares: "1",
        deadlineMinutes: 5,
      }),
    );
    const normalized = normalizeDepositPreviewInput({
      xrplAddress: "rExample",
      amountFxrp: "100.000001",
      minimumShares: "1",
    });
    assert.throws(() =>
      buildDepositPreview({
        normalized,
        deployment,
        chain,
        nowSeconds: 2_000_000_000n,
      }),
    );
  });
});
