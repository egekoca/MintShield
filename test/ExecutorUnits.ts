import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Address, Hex } from "viem";
import type { XrpPaymentProof } from "../src/flare/abis.js";
import { validateXrpPaymentProof } from "../src/executor/fdc.js";
import {
  memoFromHex,
  normalizeXrplTransactionId,
  toXrplTransactionHash,
  validateCoreVaultPayment,
} from "../src/executor/xrpl.js";

const transactionId = `0x${"11".repeat(32)}` as Hex;
const proofOwner =
  "0x2222222222222222222222222222222222222222" as Address;
const memoData = `0x${"fe00"}${"00".repeat(8)}${"11".repeat(32)}` as Hex;

function validTransaction(): Record<string, unknown> {
  return {
    validated: true,
    hash: transactionId.slice(2).toUpperCase(),
    ledger_index: 123,
    TransactionType: "Payment",
    Account: "rExpectedSource",
    Destination: "rExpectedCoreVault",
    Amount: "1100000",
    Memos: [{ Memo: { MemoData: memoData.slice(2).toUpperCase() } }],
    meta: {
      TransactionResult: "tesSUCCESS",
      delivered_amount: "1100000",
    },
  };
}

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
      validateXrpPaymentProof({
        proof,
        transactionId,
        proofOwner,
        expectedPayment: {
          sourceAddress: "rSource",
          receivedAmount: 1_000_000n,
          memoData: "0xfe00",
        },
      }),
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

    const wrongMemo = validProof();
    wrongMemo.data.responseBody.firstMemoData = "0xfe01";
    assert.throws(
      () =>
        validateXrpPaymentProof({
          proof: wrongMemo,
          transactionId,
          proofOwner,
          expectedPayment: {
            sourceAddress: "rSource",
            receivedAmount: 1_000_000n,
            memoData: "0xfe00",
          },
        }),
      /memo/,
    );
  });

  it("accepts only the exact validated Core Vault payment", () => {
    const expected = {
      transactionId,
      sourceAccount: "rExpectedSource",
      destination: "rExpectedCoreVault",
      amountDrops: 1_100_000n,
      memoData,
    };
    const validated = validateCoreVaultPayment(
      validTransaction(),
      expected,
    );
    assert.equal(validated.transactionId, transactionId);
    assert.equal(validated.memoData, memoData);

    for (const [field, value, message] of [
      ["Destination", "rAttacker", /Core Vault/],
      ["Amount", "1099999", /amount/],
      ["Account", "rWrongSigner", /source account/],
      ["DestinationTag", 7, /DestinationTag/],
      ["Memos", [], /exactly one memo/],
    ] as const) {
      const transaction = validTransaction();
      transaction[field] = value;
      assert.throws(
        () => validateCoreVaultPayment(transaction, expected),
        message,
      );
    }

    const partial = validTransaction();
    partial.Flags = 0x0002_0000;
    assert.throws(
      () => validateCoreVaultPayment(partial, expected),
      /Partial-payment/,
    );
    const wrongMemo = validTransaction();
    wrongMemo.Memos = [{ Memo: { MemoData: "FE00" } }];
    assert.throws(
      () => validateCoreVaultPayment(wrongMemo, expected),
      /0xFE commitment/,
    );
  });
});
