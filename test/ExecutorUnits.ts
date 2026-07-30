import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Address, Hex } from "viem";
import type { XrpPaymentProof } from "../src/flare/abis.js";
import { validateXrpPaymentProof } from "../src/executor/fdc.js";
import {
  memoFromHex,
  normalizeXrplTransactionId,
  toXrplTransactionHash,
} from "../src/executor/xrpl.js";

const transactionId = `0x${"11".repeat(32)}` as Hex;
const proofOwner =
  "0x2222222222222222222222222222222222222222" as Address;

function validProof(): XrpPaymentProof {
  return {
    merkleProof: [],
    data: {
      attestationType: `0x${"33".repeat(32)}`,
      sourceId: `0x${"44".repeat(32)}`,
      votingRound: 10n,
      lowestUsedTimestamp: 20n,
      requestBody: { transactionId, proofOwner },
      responseBody: {
        blockNumber: 100n,
        blockTimestamp: 200n,
        sourceAddress: "rSource",
        sourceAddressHash: `0x${"55".repeat(32)}`,
        receivingAddressHash: `0x${"66".repeat(32)}`,
        intendedReceivingAddressHash: `0x${"66".repeat(32)}`,
        spentAmount: 1_000_012n,
        intendedSpentAmount: 1_000_000n,
        receivedAmount: 1_000_000n,
        intendedReceivedAmount: 1_000_000n,
        hasMemoData: true,
        firstMemoData: "0xfe00",
        hasDestinationTag: false,
        destinationTag: 0n,
        status: 0,
      },
    },
  };
}

describe("executor boundary validation", () => {
  it("normalizes XRPL transaction ids for FDC and rippled", () => {
    const uppercase = transactionId.slice(2).toUpperCase();
    assert.equal(normalizeXrplTransactionId(uppercase), transactionId);
    assert.equal(toXrplTransactionHash(transactionId), uppercase);
    assert.throws(() => normalizeXrplTransactionId("1234"), /32 hex bytes/);
  });

  it("encodes memo bytes without 0x for XRPL", () => {
    assert.deepEqual(memoFromHex("0xfe00aa"), {
      Memo: { MemoData: "FE00AA" },
    });
  });

  it("accepts only a successful, owned, matching XRPPayment proof", () => {
    const proof = validProof();
    assert.equal(
      validateXrpPaymentProof({ proof, transactionId, proofOwner }),
      proof,
    );

    const wrongStatus = validProof();
    wrongStatus.data.responseBody.status = 1;
    assert.throws(
      () =>
        validateXrpPaymentProof({
          proof: wrongStatus,
          transactionId,
          proofOwner,
        }),
      /non-success status/,
    );
    assert.throws(
      () =>
        validateXrpPaymentProof({
          proof,
          transactionId: `0x${"77".repeat(32)}`,
          proofOwner,
        }),
      /transactionId/,
    );
  });
});
