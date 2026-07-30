import { resolve } from "node:path";
import { parseAbi, type Address, type Hex } from "viem";
import { loadPublicConfig } from "../src/config/env.js";
import {
  isTransactionIdUsed,
  validateRecoveredStuckReceipt,
  validateRecoveryFlagReceipt,
} from "../src/executor/recovery.js";
import { ExecutorStateStore } from "../src/executor/state-store.js";
import { createCoston2PublicClient } from "../src/flare/clients.js";
import {
  getSmartAccountNonce,
  readDirectMintingSettings,
  resolveFlareContracts,
} from "../src/flare/contracts.js";

type RecoveryDetails = {
  jobKind: "BARE_REVERT_COMPARISON";
  personalAccount: Address;
  nonce: string;
  recoveryXrplTxHash: Hex;
  recoveryVotingRound: number;
  recoveryFlareTxHash: Hex;
  stuckRetryFlareTxHash: Hex;
  recoveryBalanceBefore: string;
  recoveryBalanceAfter: string;
};

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function json(value: unknown) {
  return JSON.stringify(
    value,
    (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    2,
  );
}

const jobId = argument("--job");
if (jobId === undefined) throw new Error("--job requires an executor job id");
const store = new ExecutorStateStore(
  resolve(
    process.cwd(),
    process.env.EXECUTOR_DB_PATH ?? "./data/mintshield.db",
  ),
);
const job = store.require(jobId);
store.close();
const details = job.metadata as Partial<RecoveryDetails>;
if (
  job.status !== "RECOVERED" ||
  details.jobKind !== "BARE_REVERT_COMPARISON" ||
  typeof details.personalAccount !== "string" ||
  typeof details.nonce !== "string" ||
  typeof details.recoveryXrplTxHash !== "string" ||
  typeof details.recoveryVotingRound !== "number" ||
  typeof details.recoveryFlareTxHash !== "string" ||
  typeof details.stuckRetryFlareTxHash !== "string" ||
  typeof details.recoveryBalanceBefore !== "string" ||
  typeof details.recoveryBalanceAfter !== "string" ||
  job.xrplTxHash === undefined ||
  job.flareTxHash === undefined
) {
  throw new Error("Job does not contain a completed bare recovery");
}
const typed = details as RecoveryDetails;
const publicClient = createCoston2PublicClient(
  loadPublicConfig().coston2RpcUrl,
);
const contracts = await resolveFlareContracts(publicClient);
const [
  recoveryReceipt,
  stuckRetryReceipt,
  stuckTransactionUsed,
  currentNonce,
  settings,
  currentBalance,
] = await Promise.all([
  publicClient.getTransactionReceipt({ hash: typed.recoveryFlareTxHash }),
  publicClient.getTransactionReceipt({ hash: typed.stuckRetryFlareTxHash }),
  isTransactionIdUsed({
    publicClient,
    masterAccountController: contracts.masterAccountController,
    transactionId: job.xrplTxHash,
  }),
  getSmartAccountNonce(
    publicClient,
    contracts.masterAccountController,
    typed.personalAccount,
  ),
  readDirectMintingSettings(publicClient, contracts.assetManagerFXRP),
  publicClient.readContract({
    address: contracts.fxrp,
    abi: parseAbi([
      "function balanceOf(address account) view returns (uint256)",
    ]),
    functionName: "balanceOf",
    args: [typed.personalAccount],
  }),
]);
const recovery = validateRecoveryFlagReceipt(recoveryReceipt, {
  masterAccountController: contracts.masterAccountController,
  personalAccount: typed.personalAccount,
  targetTransactionId: job.xrplTxHash,
  recoveryTransactionId: typed.recoveryXrplTxHash,
});
const stuck = validateRecoveredStuckReceipt(stuckRetryReceipt, {
  masterAccountController: contracts.masterAccountController,
  personalAccount: typed.personalAccount,
  stuckTransactionId: job.xrplTxHash,
});
const balanceBefore = BigInt(typed.recoveryBalanceBefore);
const balanceAfter = BigInt(typed.recoveryBalanceAfter);
const expectedDelta =
  recovery.recoveryAmount -
  recovery.executorFee +
  stuck.amount -
  stuck.executorFee;
const checks = {
  jobRecovered: job.status === "RECOVERED",
  originalFlareFinalizationReverted: job.lastError?.includes(
    job.flareTxHash,
  ),
  recoveryMemoChargedSignedZeroFee: recovery.executorFee === 0n,
  ignoredMemoUsedDefaultExecutorFee:
    stuck.executorFee === settings.defaultExecutorFeeUBA,
  recoveryBalanceDeltaMatchesEvents:
    balanceAfter - balanceBefore === expectedDelta,
  currentBalanceMatchesCheckpoint: currentBalance === balanceAfter,
  stuckTransactionConsumed: stuckTransactionUsed,
  skippedUserOpDidNotAdvanceNonce: currentNonce === BigInt(typed.nonce),
};
const failed = Object.entries(checks)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);
console.log(
  json({
    observedAt: new Date().toISOString(),
    chainId: 114,
    jobId,
    status: job.status,
    personalAccount: typed.personalAccount,
    nonce: currentNonce,
    original: {
      xrplTxHash: job.xrplTxHash,
      fdcVotingRound: job.votingRound,
      revertedFlareTxHash: job.flareTxHash,
    },
    recoveryFlag: {
      xrplTxHash: typed.recoveryXrplTxHash,
      fdcVotingRound: typed.recoveryVotingRound,
      flareTxHash: typed.recoveryFlareTxHash,
      amount: recovery.recoveryAmount,
      executorFee: recovery.executorFee,
    },
    stuckRetry: {
      flareTxHash: typed.stuckRetryFlareTxHash,
      amount: stuck.amount,
      executorFee: stuck.executorFee,
    },
    balances: {
      before: balanceBefore,
      after: balanceAfter,
      expectedDelta,
      observedDelta: balanceAfter - balanceBefore,
    },
    checks,
    passed: failed.length === 0,
    failed,
  }),
);
if (failed.length > 0) process.exitCode = 1;
