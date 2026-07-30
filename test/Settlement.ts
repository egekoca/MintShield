import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  encodeEventTopics,
  encodeAbiParameters,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import {
  directMintingAbi,
  mintShieldEventsAbi,
} from "../src/flare/abis.js";
import { classifySettlement } from "../src/executor/flare-submit.js";

const personalAccount =
  "0x1111111111111111111111111111111111111111" as Address;
const intentId = `0x${"22".repeat(32)}` as Hex;

type ReceiptLog = TransactionReceipt["logs"][number];

function receipt(logs: ReceiptLog[]): TransactionReceipt {
  return {
    blockHash: `0x${"00".repeat(32)}`,
    blockNumber: 1n,
    contractAddress: null,
    cumulativeGasUsed: 1n,
    effectiveGasPrice: 1n,
    from: personalAccount,
    gasUsed: 1n,
    logs,
    logsBloom: `0x${"00".repeat(256)}`,
    status: "success",
    to: personalAccount,
    transactionHash: `0x${"33".repeat(32)}`,
    transactionIndex: 0,
    type: "eip1559",
  };
}

function eventLog(topics: [Hex, ...Hex[]], data: Hex): ReceiptLog {
  return {
    address: personalAccount,
    blockHash: `0x${"00".repeat(32)}`,
    blockNumber: 1n,
    data,
    logIndex: 0,
    removed: false,
    topics,
    transactionHash: `0x${"33".repeat(32)}`,
    transactionIndex: 0,
  };
}

describe("settlement classification", () => {
  it("prioritizes delayed direct minting", () => {
    const topics = encodeEventTopics({
      abi: directMintingAbi,
      eventName: "DirectMintingDelayed",
    });
    const data = encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [`0x${"44".repeat(32)}`, 10n, 2_000n],
    );
    assert.deepEqual(
      classifySettlement(receipt([eventLog(topics as [Hex, ...Hex[]], data)]), {
        personalAccount,
        nonce: 7n,
      }),
      {
        status: "DELAYED",
        executionAllowedAt: 2_000n,
        transactionId: `0x${"44".repeat(32)}`,
        amount: 10n,
        delayKind: "RATE_LIMIT",
      },
    );
  });

  it("recognizes a successful MintShield settlement", () => {
    const topics = encodeEventTopics({
      abi: mintShieldEventsAbi,
      eventName: "IntentSettledSuccess",
      args: { intentId, personalAccount, adapterId: `0x${"55".repeat(32)}` },
    });
    const data = encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }],
      [100n, 103n],
    );
    const result = classifySettlement(
      receipt([eventLog(topics as unknown as [Hex, ...Hex[]], data)]),
      {
      personalAccount,
      nonce: 7n,
      intentId,
      },
    );
    assert.deepEqual(result, {
      status: "SETTLED_SUCCESS",
      intentId,
      amountIn: 100n,
      amountOut: 103n,
    });
  });

  it("ignores a settlement topic emitted by the wrong contract", () => {
    const topics = encodeEventTopics({
      abi: mintShieldEventsAbi,
      eventName: "IntentSettledSuccess",
      args: { intentId, personalAccount, adapterId: `0x${"55".repeat(32)}` },
    });
    const data = encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }],
      [100n, 103n],
    );
    const result = classifySettlement(
      receipt([eventLog(topics as unknown as [Hex, ...Hex[]], data)]),
      {
        personalAccount,
        nonce: 7n,
        intentId,
        router: "0x9999999999999999999999999999999999999999",
      },
    );
    assert.equal(result.status, "RECOVERY_REQUIRED");
  });

  it("requires recovery when no expected event exists", () => {
    const result = classifySettlement(receipt([]), {
      personalAccount,
      nonce: 7n,
    });
    assert.equal(result.status, "RECOVERY_REQUIRED");
  });
});
