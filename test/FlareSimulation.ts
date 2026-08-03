import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  Account,
  Address,
  Hex,
  PublicClient,
  TransactionReceipt,
  WalletClient,
} from "viem";
import type { XrpPaymentProof } from "../src/flare/abis.js";
import {
  DirectMintSimulationError,
  submitDirectMintWithData,
} from "../src/executor/flare-submit.js";

const transactionHash = `0x${"11".repeat(32)}` as Hex;
const assetManager =
  "0x2222222222222222222222222222222222222222" as Address;
const account = {
  address: "0x3333333333333333333333333333333333333333",
  type: "local",
} as unknown as Account;
const proof = {} as XrpPaymentProof;

function receipt(status: "success" | "reverted" = "success") {
  return {
    status,
    transactionHash,
    logs: [],
  } as unknown as TransactionReceipt;
}

describe("full direct-mint eth_call preflight", function () {
  it("records a successful simulation before broadcasting the same call", async function () {
    const order: string[] = [];
    const publicClient = {
      simulateContract: async () => {
        order.push("simulate");
        return { request: {}, result: undefined };
      },
      waitForTransactionReceipt: async () => {
        order.push("receipt");
        return receipt();
      },
    } as unknown as PublicClient;
    const walletClient = {
      chain: undefined,
      writeContract: async () => {
        order.push("broadcast");
        return transactionHash;
      },
    } as unknown as WalletClient;

    const result = await submitDirectMintWithData({
      publicClient,
      walletClient,
      account,
      assetManager,
      proof,
      userOpData: "0x1234",
      callValue: 7n,
      onSimulationSuccess: () => {
        order.push("record");
      },
    });

    assert.deepEqual(order, ["simulate", "record", "broadcast", "receipt"]);
    assert.equal(result.simulationPerformed, true);
  });

  it("blocks broadcast when the full simulation reverts", async function () {
    let broadcast = false;
    const publicClient = {
      simulateContract: async () => {
        throw new Error("CallFailed(1)");
      },
    } as unknown as PublicClient;
    const walletClient = {
      chain: undefined,
      writeContract: async () => {
        broadcast = true;
        return transactionHash;
      },
    } as unknown as WalletClient;

    await assert.rejects(
      submitDirectMintWithData({
        publicClient,
        walletClient,
        account,
        assetManager,
        proof,
        userOpData: "0x1234",
      }),
      (error: unknown) =>
        error instanceof DirectMintSimulationError &&
        /broadcast blocked/.test(error.message) &&
        !error.message.includes("CallFailed(1)"),
    );
    assert.equal(broadcast, false);
  });

  it("bypasses simulation only for an explicit reverting comparison", async function () {
    let simulated = false;
    const publicClient = {
      simulateContract: async () => {
        simulated = true;
      },
      waitForTransactionReceipt: async () => receipt("reverted"),
    } as unknown as PublicClient;
    const walletClient = {
      chain: undefined,
      writeContract: async () => transactionHash,
    } as unknown as WalletClient;

    const result = await submitDirectMintWithData({
      publicClient,
      walletClient,
      account,
      assetManager,
      proof,
      userOpData: "0x1234",
      allowRevert: true,
      gasLimit: 1_000_000n,
    });

    assert.equal(simulated, false);
    assert.equal(result.simulationPerformed, false);
    assert.equal(result.receipt.status, "reverted");
  });
});
