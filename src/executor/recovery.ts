import {
  concatHex,
  getAddress,
  padHex,
  parseEventLogs,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { memoInstructionsEventsAbi } from "../flare/abis.js";
import { normalizeXrplTransactionId } from "./xrpl.js";

export function encodeSkipMemo(input: {
  targetTransactionId: string;
  walletId?: number;
  executorFeeUBA?: bigint;
}): Hex {
  const walletId = input.walletId ?? 0;
  const executorFeeUBA = input.executorFeeUBA ?? 0n;
  if (!Number.isInteger(walletId) || walletId < 0 || walletId > 255) {
    throw new RangeError("walletId must fit in one byte");
  }
  if (executorFeeUBA < 0n || executorFeeUBA > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError("executorFeeUBA must fit in uint64");
  }
  return concatHex([
    "0xe0",
    toHex(walletId, { size: 1 }),
    toHex(executorFeeUBA, { size: 8 }),
    padHex(normalizeXrplTransactionId(input.targetTransactionId), {
      size: 32,
    }),
  ]);
}

export async function isTransactionIdUsed(input: {
  publicClient: PublicClient;
  masterAccountController: Address;
  transactionId: string;
}) {
  return input.publicClient.readContract({
    address: input.masterAccountController,
    abi: memoInstructionsEventsAbi,
    functionName: "isTransactionIdUsed",
    args: [normalizeXrplTransactionId(input.transactionId)],
  });
}

function directMintEvent(
  receipt: TransactionReceipt,
  expected: {
    masterAccountController: Address;
    personalAccount: Address;
    transactionId: string;
  },
) {
  const transactionId = normalizeXrplTransactionId(expected.transactionId);
  const logs = parseEventLogs({
    abi: memoInstructionsEventsAbi,
    eventName: "DirectMintingExecuted",
    logs: receipt.logs,
    strict: true,
  });
  return logs.find(
    (log) =>
      getAddress(log.address) ===
        getAddress(expected.masterAccountController) &&
      getAddress(log.args.personalAccount) ===
        getAddress(expected.personalAccount) &&
      log.args.transactionId.toLowerCase() === transactionId.toLowerCase(),
  );
}

export function validateRecoveryFlagReceipt(
  receipt: TransactionReceipt,
  expected: {
    masterAccountController: Address;
    personalAccount: Address;
    targetTransactionId: string;
    recoveryTransactionId: string;
  },
) {
  if (receipt.status !== "success") {
    throw new Error(`Recovery flag transaction reverted: ${receipt.transactionHash}`);
  }
  const targetTransactionId = normalizeXrplTransactionId(
    expected.targetTransactionId,
  );
  const logs = parseEventLogs({
    abi: memoInstructionsEventsAbi,
    eventName: "IgnoreMemoSet",
    logs: receipt.logs,
    strict: true,
  });
  const ignoreMemoSet = logs.find(
    (log) =>
      getAddress(log.address) ===
        getAddress(expected.masterAccountController) &&
      getAddress(log.args.personalAccount) ===
        getAddress(expected.personalAccount) &&
      log.args.targetTxId.toLowerCase() === targetTransactionId.toLowerCase(),
  );
  const recoveryMint = directMintEvent(receipt, {
    masterAccountController: expected.masterAccountController,
    personalAccount: expected.personalAccount,
    transactionId: expected.recoveryTransactionId,
  });
  if (ignoreMemoSet === undefined || recoveryMint === undefined) {
    throw new Error(
      "Recovery receipt is missing matching IgnoreMemoSet or DirectMintingExecuted",
    );
  }
  return {
    targetTransactionId,
    recoveryAmount: recoveryMint.args.amount,
    executorFee: recoveryMint.args.executorFee,
  };
}

export function validateRecoveredStuckReceipt(
  receipt: TransactionReceipt,
  expected: {
    masterAccountController: Address;
    personalAccount: Address;
    stuckTransactionId: string;
  },
) {
  if (receipt.status !== "success") {
    throw new Error(`Stuck retry transaction reverted: ${receipt.transactionHash}`);
  }
  const mint = directMintEvent(receipt, {
    masterAccountController: expected.masterAccountController,
    personalAccount: expected.personalAccount,
    transactionId: expected.stuckTransactionId,
  });
  if (mint === undefined) {
    throw new Error(
      "Stuck retry receipt is missing matching DirectMintingExecuted",
    );
  }
  return {
    amount: mint.args.amount,
    executorFee: mint.args.executorFee,
  };
}
