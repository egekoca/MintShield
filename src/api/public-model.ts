import type { Hex } from "viem";
import type {
  ExecutorJob,
  JobStatus,
} from "../executor/state-store.js";

export type PublicJob = {
  id: string;
  intentKey: string;
  status: JobStatus;
  userOpHash: Hex;
  xrplTxHash?: Hex;
  votingRound?: number;
  flareTxHash?: Hex;
  executionAllowedAt?: string;
  lastError?: string;
  details: Record<string, unknown>;
  links: {
    xrpl?: string;
    flare?: string;
    fdc?: string;
  };
  timeline: Array<{
    status: JobStatus;
    state: "completed" | "current" | "pending" | "attention";
  }>;
  createdAt: string;
  updatedAt: string;
};

const orderedStatuses: readonly JobStatus[] = [
  "CREATED",
  "XRPL_SIGNED",
  "XRPL_FINALIZED",
  "FDC_REQUESTED",
  "PROOF_READY",
  "FLARE_SUBMITTED",
] as const;

const recoveryStatuses: readonly JobStatus[] = [
  "RECOVERY_REQUIRED",
  "RECOVERY_PAYMENT_SIGNED",
  "RECOVERY_PAYMENT_FINALIZED",
  "RECOVERY_FDC_REQUESTED",
  "RECOVERY_PROOF_READY",
  "RECOVERY_FLAG_SUBMITTED",
  "RECOVERY_FLAG_SET",
  "RECOVERY_STUCK_SUBMITTED",
  "RECOVERED",
] as const;

const publicMetadataKeys = new Set([
  "router",
  "personalAccount",
  "nonce",
  "coreVaultAddress",
  "paymentAmountDrops",
  "memoData",
  "callValue",
  "expectedIntentId",
  "fdcTxHash",
  "xrplLedgerIndex",
  "xrplValidatedLedgerIndex",
  "xrplConfirmations",
  "delayKind",
  "delayedAmount",
  "settledIntentId",
  "amountIn",
  "amountOut",
  "returnedAmount",
  "failureCode",
  "revertDataHash",
  "jobKind",
  "allowFlareRevert",
  "flareGasLimit",
  "recoveryXrplTxHash",
  "recoveryVotingRound",
  "recoveryFdcTxHash",
  "recoveryFlareTxHash",
  "stuckRetryFlareTxHash",
  "recoveryAmount",
  "recoveryExecutorFee",
  "recoveredStuckAmount",
  "stuckRetryExecutorFee",
  "recoveryBalanceBefore",
  "recoveryBalanceAfter",
  "originalIntentKey",
  "xamanPayloadUuid",
  "xamanExpiresAt",
  "xrplSourceAccount",
]);

function publicDetails(metadata: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => publicMetadataKeys.has(key)),
  );
}

function timeline(status: JobStatus): PublicJob["timeline"] {
  const recoveryIndex = recoveryStatuses.indexOf(status);
  if (recoveryIndex !== -1) {
    return [
      ...orderedStatuses.map((step) => ({
        status: step,
        state: "completed" as const,
      })),
      ...recoveryStatuses.map((step, index) => ({
        status: step,
        state:
          index < recoveryIndex
            ? ("completed" as const)
            : index === recoveryIndex
              ? step === "RECOVERY_REQUIRED"
                ? ("attention" as const)
                : ("current" as const)
              : ("pending" as const),
      })),
    ];
  }
  const currentIndex = orderedStatuses.indexOf(status);
  const base: PublicJob["timeline"] = orderedStatuses.map((step, index) => ({
    status: step,
    state:
      currentIndex === -1
        ? ("completed" as const)
        : index < currentIndex
          ? ("completed" as const)
          : index === currentIndex
            ? ("current" as const)
            : ("pending" as const),
  }));
  if (!orderedStatuses.includes(status)) {
    base.push({
      status,
      state:
        status === "SETTLED_SUCCESS" ||
        status === "SETTLED_FALLBACK" ||
        status === "RECOVERED"
          ? "current"
          : "attention",
    });
  }
  return base;
}

export function toPublicJob(job: ExecutorJob): PublicJob {
  return {
    id: job.id,
    intentKey: job.intentKey,
    status: job.status,
    userOpHash: job.userOpHash,
    ...(job.xrplTxHash === undefined ? {} : { xrplTxHash: job.xrplTxHash }),
    ...(job.votingRound === undefined
      ? {}
      : { votingRound: job.votingRound }),
    ...(job.flareTxHash === undefined
      ? {}
      : { flareTxHash: job.flareTxHash }),
    ...(job.executionAllowedAt === undefined
      ? {}
      : { executionAllowedAt: job.executionAllowedAt.toString() }),
    ...(job.lastError === undefined ? {} : { lastError: job.lastError }),
    details: publicDetails(job.metadata),
    links: {
      ...(job.xrplTxHash === undefined
        ? {}
        : {
            xrpl: `https://testnet.xrpl.org/transactions/${job.xrplTxHash.slice(2).toUpperCase()}`,
          }),
      ...(job.flareTxHash === undefined
        ? {}
        : {
            flare: `https://coston2-explorer.flare.network/tx/${job.flareTxHash}`,
          }),
      ...(job.votingRound === undefined
        ? {}
        : {
            fdc: `https://coston2-systems-explorer.flare.network/voting-round/${job.votingRound}?tab=fdc`,
          }),
    },
    timeline: timeline(job.status),
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString(),
  };
}

export function summarizeJobs(jobs: readonly ExecutorJob[]) {
  const byStatus = Object.fromEntries(
    jobs.map((job) => job.status).map((status) => [status, 0]),
  ) as Partial<Record<JobStatus, number>>;
  for (const job of jobs) byStatus[job.status] = (byStatus[job.status] ?? 0) + 1;
  return {
    total: jobs.length,
    active: jobs.filter(
      (job) =>
        ![
          "SETTLED_SUCCESS",
          "SETTLED_FALLBACK",
          "RECOVERED",
          "FAILED",
        ].includes(job.status),
    ).length,
    attention: jobs.filter((job) =>
      ["DELAYED", "RECOVERY_REQUIRED", "FAILED"].includes(job.status),
    ).length,
    byStatus,
  };
}
