import {
  getAddress,
  parseEventLogs,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import {
  directMintingAbi,
  memoInstructionsEventsAbi,
  mintShieldEventsAbi,
  type XrpPaymentProof,
} from "../flare/abis.js";

export type Settlement =
  | {
      status: "DELAYED";
      executionAllowedAt: bigint;
      transactionId: Hex;
      amount: bigint;
      delayKind: "RATE_LIMIT" | "LARGE_MINT";
    }
  | {
      status: "SETTLED_SUCCESS";
      intentId: Hex;
      amountIn: bigint;
      amountOut: bigint;
    }
  | {
      status: "SETTLED_FALLBACK";
      intentId: Hex;
      returnedAmount: bigint;
      failureCode: number;
      revertDataHash: Hex;
    }
  | {
      status: "RECOVERY_REQUIRED";
      reason: string;
    };

export class DirectMintSimulationError extends Error {
  constructor(cause: unknown) {
    const causeName =
      cause instanceof Error && cause.name.length > 0
        ? cause.name
        : "unknown RPC error";
    super(
      "Full executeDirectMintingWithData eth_call simulation failed; " +
        `broadcast blocked (${causeName})`,
      { cause },
    );
    this.name = "DirectMintSimulationError";
  }
}

export async function submitDirectMintWithData(input: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Account;
  assetManager: Address;
  proof: XrpPaymentProof;
  userOpData: Hex;
  callValue?: bigint;
  onTransactionHash?: (hash: Hex) => void;
  onSimulationSuccess?: () => void | Promise<void>;
  allowRevert?: boolean;
  gasLimit?: bigint;
}) {
  if (
    input.allowRevert === true &&
    (input.gasLimit === undefined || input.gasLimit <= 0n)
  ) {
    throw new Error("A positive gasLimit is required when allowRevert is true");
  }
  const request = {
    account: input.account,
    chain: input.walletClient.chain,
    address: getAddress(input.assetManager),
    abi: directMintingAbi,
    functionName: "executeDirectMintingWithData" as const,
    args: [input.proof, input.userOpData] as const,
    value: input.callValue ?? 0n,
    ...(input.gasLimit === undefined ? {} : { gas: input.gasLimit }),
  };
  let simulationPerformed = false;
  if (input.allowRevert !== true) {
    try {
      await input.publicClient.simulateContract(request);
    } catch (cause) {
      throw new DirectMintSimulationError(cause);
    }
    simulationPerformed = true;
    await input.onSimulationSuccess?.();
  }
  const hash = await input.walletClient.writeContract(request);
  input.onTransactionHash?.(hash);
  const receipt = await input.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" && input.allowRevert !== true) {
    throw new Error(`executeDirectMintingWithData reverted: ${hash}`);
  }
  return { hash, receipt, simulationPerformed };
}

export function classifySettlement(
  receipt: TransactionReceipt,
  expected: {
    personalAccount: Address;
    nonce: bigint;
    intentId?: Hex;
    router?: Address;
    masterAccountController?: Address;
    assetManager?: Address;
  },
): Settlement {
  const directMintLogs = parseEventLogs({
    abi: directMintingAbi,
    logs: receipt.logs,
    strict: true,
  });
  for (const log of directMintLogs) {
    if (
      log.eventName === "DirectMintingDelayed" ||
      log.eventName === "LargeDirectMintingDelayed"
    ) {
      if (
        expected.assetManager !== undefined &&
        getAddress(log.address) !== getAddress(expected.assetManager)
      ) {
        continue;
      }
      return {
        status: "DELAYED",
        executionAllowedAt: log.args.executionAllowedAt,
        transactionId: log.args.transactionId,
        amount: log.args.amount,
        delayKind:
          log.eventName === "LargeDirectMintingDelayed"
            ? "LARGE_MINT"
            : "RATE_LIMIT",
      };
    }
  }

  const settlementLogs = parseEventLogs({
    abi: mintShieldEventsAbi,
    logs: receipt.logs,
    strict: true,
  });
  for (const log of settlementLogs) {
    if (
      (expected.router !== undefined &&
        getAddress(log.address) !== getAddress(expected.router)) ||
      getAddress(log.args.personalAccount) !==
        getAddress(expected.personalAccount) ||
      (expected.intentId !== undefined &&
        log.args.intentId.toLowerCase() !== expected.intentId.toLowerCase())
    ) {
      continue;
    }
    if (log.eventName === "IntentSettledSuccess") {
      return {
        status: "SETTLED_SUCCESS",
        intentId: log.args.intentId,
        amountIn: log.args.amountIn,
        amountOut: log.args.amountOut,
      };
    }
    return {
      status: "SETTLED_FALLBACK",
      intentId: log.args.intentId,
      returnedAmount: log.args.returnedAmount,
      failureCode: log.args.failureCode,
      revertDataHash: log.args.revertDataHash,
    };
  }

  const userOperationLogs = parseEventLogs({
    abi: memoInstructionsEventsAbi,
    logs: receipt.logs,
    strict: true,
  });
  const userOpExecuted = userOperationLogs.some(
    (log) =>
      log.eventName === "UserOperationExecuted" &&
      (expected.masterAccountController === undefined ||
        getAddress(log.address) ===
          getAddress(expected.masterAccountController)) &&
      getAddress(log.args.personalAccount) ===
        getAddress(expected.personalAccount) &&
      log.args.nonce === expected.nonce,
  );
  return {
    status: "RECOVERY_REQUIRED",
    reason: userOpExecuted
      ? "UserOperationExecuted was emitted, but no matching MintShield settlement event was found"
      : "No delay, UserOperationExecuted, or MintShield settlement event was found",
  };
}
