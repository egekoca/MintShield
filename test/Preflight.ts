import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeMintingFeeUBA,
  quoteGrossDirectMint,
} from "../src/flare/preflight.js";

describe("direct-mint preflight", function () {
  const settings = {
    feeBIPS: 25n,
    minimumFeeUBA: 100_000n,
    largeMintingThresholdUBA: 50_000_000n,
  };

  it("uses the minimum fee for a small mint", function () {
    assert.equal(computeMintingFeeUBA(1_000_000n, 25n, 100_000n), 100_000n);
  });

  it("uses the proportional fee for a larger mint", function () {
    assert.equal(
      computeMintingFeeUBA(100_000_000n, 25n, 100_000n),
      250_000n,
    );
  });

  it("grosses up payment so memo fee cannot consume signed Router input", function () {
    const quote = quoteGrossDirectMint(10_000_000n, 100_000n, settings);

    assert.ok(quote.expectedPersonalAccountUBA >= 10_000_000n);
    assert.ok(quote.residualPersonalAccountUBA <= 1n);
    assert.equal(
      quote.paymentAmountUBA - quote.mintingFeeUBA - 100_000n,
      quote.expectedPersonalAccountUBA,
    );
  });

  it("detects the strict greater-than large-mint delay threshold", function () {
    const quote = quoteGrossDirectMint(60_000_000n, 0n, settings);
    assert.equal(quote.triggersLargeMintDelay, true);

    const thresholdOnly = quoteGrossDirectMint(1_000_000n, 0n, {
      ...settings,
      largeMintingThresholdUBA: 2_000_000n,
    });
    assert.equal(thresholdOnly.triggersLargeMintDelay, false);
  });

  it("rejects invalid fee or amount inputs", function () {
    assert.throws(() => computeMintingFeeUBA(1n, 10_000n, 0n));
    assert.throws(() => quoteGrossDirectMint(0n, 0n, settings));
    assert.throws(() => quoteGrossDirectMint(1n, -1n, settings));
  });
});
