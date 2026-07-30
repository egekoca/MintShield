import { resolve } from "node:path";
import { Client } from "xrpl";
import {
  parseAbi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import {
  loadExecutorSecrets,
  loadPublicConfig,
  loadXrplSeed,
} from "../src/config/env.js";
import {
  prepareXrpPaymentRequest,
  resolveFdcRequestTransaction,
  submitFdcRequest,
  validateXrpPaymentProof,
  waitForFdcProof,
} from "../src/executor/fdc.js";
import { submitDirectMintWithData } from "../src/executor/flare-submit.js";
import {
  encodeSkipMemo,
  isTransactionIdUsed,
  validateRecoveredStuckReceipt,
  validateRecoveryFlagReceipt,
} from "../src/executor/recovery.js";
import {
  ExecutorStateStore,
  type ExecutorJob,
  type JobStatus,
} from "../src/executor/state-store.js";
import {
  findValidatedXrplTransaction,
  prepareAndSignCoreVaultPayment,
  restoreWallet,
  submitSignedXrplPayment,
  waitForXrplFinality,
} from "../src/executor/xrpl.js";
import {
  createCoston2PublicClient,
  createCoston2WalletClient,
} from "../src/flare/clients.js";
import {
  readDirectMintingSettings,
  resolveFlareContracts,
} from "../src/flare/contracts.js";
import { quoteGrossDirectMint } from "../src/flare/preflight.js";

type RecoveryMetadata = {
  jobKind: "BARE_REVERT_COMPARISON";
  personalAccount: Address;
  coreVaultAddress: string;
  recoveryMemoData?: Hex;
  recoveryPaymentAmountDrops?: string;
  recoveryTxBlob?: string;
  recoveryXrplTxHash?: Hex;
  recoveryFdcRequest?: Hex;
  recoveryFdcTxHash?: Hex;
  recoveryVotingRound?: number;
  recoveryFlareTxHash?: Hex;
  stuckRetryFlareTxHash?: Hex;
  recoveryAmount?: string;
  recoveryExecutorFee?: string;
  recoveredStuckAmount?: string;
  stuckRetryExecutorFee?: string;
  recoveryBalanceBefore?: string;
  recoveryBalanceAfter?: string;
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

function recoveryMetadata(job: ExecutorJob): RecoveryMetadata {
  const value = job.metadata as Partial<RecoveryMetadata>;
  if (
    value.jobKind !== "BARE_REVERT_COMPARISON" ||
    typeof value.personalAccount !== "string" ||
    typeof value.coreVaultAddress !== "string"
  ) {
    throw new Error("Job is not a valid bare-revert comparison");
  }
  return value as RecoveryMetadata;
}

const recoveryStatuses = new Set<JobStatus>([
  "RECOVERY_REQUIRED",
  "RECOVERY_PAYMENT_SIGNED",
  "RECOVERY_PAYMENT_FINALIZED",
  "RECOVERY_FDC_REQUESTED",
  "RECOVERY_PROOF_READY",
  "RECOVERY_FLAG_SUBMITTED",
  "RECOVERY_FLAG_SET",
  "RECOVERY_STUCK_SUBMITTED",
  "RECOVERED",
]);
const jobId = argument("--job");
if (jobId === undefined) throw new Error("--job requires an executor job id");
const broadcast = process.argv.includes("--broadcast");
const recoveryNetAmountUBA = BigInt(
  argument("--recovery-net-uba") ?? "1000000",
);
if (recoveryNetAmountUBA <= 0n) {
  throw new RangeError("--recovery-net-uba must be positive");
}

const databasePath = resolve(
  process.cwd(),
  process.env.EXECUTOR_DB_PATH ?? "./data/mintshield.db",
);
const store = new ExecutorStateStore(databasePath);
const initialJob = store.require(jobId);
const initialMetadata = recoveryMetadata(initialJob);
if (!recoveryStatuses.has(initialJob.status)) {
  throw new Error(
    `Job ${jobId} is not recoverable from status ${initialJob.status}`,
  );
}
if (
  initialJob.xrplTxHash === undefined ||
  initialJob.fdcRequest === undefined ||
  initialJob.votingRound === undefined
) {
  throw new Error("Stuck job is missing XRPL/FDC coordinates");
}

const publicConfig = loadPublicConfig();
const secrets = loadExecutorSecrets();
const xrplWallet = restoreWallet(loadXrplSeed());
const publicClient = createCoston2PublicClient(publicConfig.coston2RpcUrl);
const { account, client: walletClient } = createCoston2WalletClient(
  publicConfig.coston2RpcUrl,
  secrets.privateKey,
);
const contracts = await resolveFlareContracts(publicClient);
const settings = await readDirectMintingSettings(
  publicClient,
  contracts.assetManagerFXRP,
);
const quote = quoteGrossDirectMint(recoveryNetAmountUBA, 0n, settings);
const recoveryMemoData = encodeSkipMemo({
  targetTransactionId: initialJob.xrplTxHash,
});
const [stuckTransactionUsed, currentNonce] = await Promise.all([
  isTransactionIdUsed({
    publicClient,
    masterAccountController: contracts.masterAccountController,
    transactionId: initialJob.xrplTxHash,
  }),
  publicClient.readContract({
    address: contracts.masterAccountController,
    abi: parseAbi([
      "function getNonce(address personalAccount) view returns (uint256)",
    ]),
    functionName: "getNonce",
    args: [initialMetadata.personalAccount],
  }),
]);
const plan = {
  mode: broadcast ? "broadcast" : "dry-run",
  jobId,
  status: initialJob.status,
  stuckXrplTxHash: initialJob.xrplTxHash,
  stuckTransactionUsed,
  personalAccount: initialMetadata.personalAccount,
  currentNonce,
  recoveryMemoData,
  recoveryPaymentAmountDrops: quote.paymentAmountUBA,
  recoveryNetAmountUBA,
  process: [
    "send 0xE0 recovery payment",
    "finalize recovery payment and verify IgnoreMemoSet",
    "resubmit original proof with original user-op bytes",
    "verify recovered FXRP and transaction-id consumption",
  ],
};
if (!broadcast) {
  console.log(json(plan));
  console.log(
    "\nDry-run only. Recovery sends a second XRPL payment; add --broadcast after review.",
  );
  store.close();
  process.exit(0);
}
if (stuckTransactionUsed && initialJob.status !== "RECOVERED") {
  throw new Error("Stuck XRPL transaction is already used; recovery is not applicable");
}

const xrplClient = new Client(publicConfig.xrplTestnetRpcUrl);
const tokenAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
]);

async function recoveryProof(details: RecoveryMetadata) {
  if (
    details.recoveryFdcRequest === undefined ||
    details.recoveryVotingRound === undefined ||
    details.recoveryXrplTxHash === undefined
  ) {
    throw new Error("Recovery job is missing proof coordinates");
  }
  const proof = await waitForFdcProof({
    publicClient,
    contracts,
    daLayerBaseUrl: publicConfig.daLayerUrl,
    abiEncodedRequest: details.recoveryFdcRequest,
    votingRound: details.recoveryVotingRound,
  });
  validateXrpPaymentProof({
    proof,
    transactionId: details.recoveryXrplTxHash,
    proofOwner: account.address,
  });
  return proof;
}

async function validateFlagReceipt(
  receipt: TransactionReceipt,
  job: ExecutorJob,
) {
  const details = recoveryMetadata(job);
  if (details.recoveryXrplTxHash === undefined) {
    throw new Error("Recovery XRPL hash is missing");
  }
  return validateRecoveryFlagReceipt(receipt, {
    masterAccountController: contracts.masterAccountController,
    personalAccount: details.personalAccount,
    targetTransactionId: job.xrplTxHash!,
    recoveryTransactionId: details.recoveryXrplTxHash,
  });
}

async function validateStuckReceipt(
  receipt: TransactionReceipt,
  job: ExecutorJob,
) {
  const details = recoveryMetadata(job);
  return validateRecoveredStuckReceipt(receipt, {
    masterAccountController: contracts.masterAccountController,
    personalAccount: details.personalAccount,
    stuckTransactionId: job.xrplTxHash!,
  });
}

try {
  while (true) {
    const job = store.require(jobId);
    const details = recoveryMetadata(job);
    if (job.status === "RECOVERED") {
      const released = store.releaseRecoveredIntentKey(job.id);
      console.log(json({ stage: "RECOVERY_COMPLETE", job: released }));
      break;
    }
    if (job.status === "RECOVERY_REQUIRED") {
      const balanceBefore = await publicClient.readContract({
        address: contracts.fxrp,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [details.personalAccount],
      });
      const signed = await prepareAndSignCoreVaultPayment({
        client: xrplClient,
        wallet: xrplWallet,
        destination: details.coreVaultAddress,
        amountDrops: quote.paymentAmountUBA,
        memoData: recoveryMemoData,
      });
      store.transition(job.id, "RECOVERY_PAYMENT_SIGNED", {
        metadata: {
          recoveryMemoData,
          recoveryPaymentAmountDrops: quote.paymentAmountUBA.toString(),
          recoveryTxBlob: signed.txBlob,
          recoveryXrplTxHash: signed.txHash,
          recoveryBalanceBefore: balanceBefore.toString(),
        },
      });
      continue;
    }
    if (job.status === "RECOVERY_PAYMENT_SIGNED") {
      if (
        details.recoveryXrplTxHash === undefined ||
        details.recoveryTxBlob === undefined
      ) {
        throw new Error("Signed recovery payment is incomplete");
      }
      const existing = await findValidatedXrplTransaction({
        client: xrplClient,
        transactionId: details.recoveryXrplTxHash,
      });
      if (existing === undefined) {
        await submitSignedXrplPayment({
          client: xrplClient,
          txBlob: details.recoveryTxBlob,
        });
      }
      const finality = await waitForXrplFinality({
        client: xrplClient,
        transactionId: details.recoveryXrplTxHash,
      });
      store.transition(job.id, "RECOVERY_PAYMENT_FINALIZED", {
        metadata: {
          recoveryXrplLedgerIndex: finality.txLedgerIndex,
          recoveryXrplValidatedLedgerIndex: finality.validatedLedgerIndex,
          recoveryXrplConfirmations: finality.confirmations,
        },
      });
      continue;
    }
    if (job.status === "RECOVERY_PAYMENT_FINALIZED") {
      if (details.recoveryXrplTxHash === undefined) {
        throw new Error("Finalized recovery payment is missing its hash");
      }
      const request = await prepareXrpPaymentRequest({
        transactionId: details.recoveryXrplTxHash,
        proofOwner: account.address,
        verifierBaseUrl: publicConfig.verifierUrl,
        apiKey: secrets.verifierApiKey,
      });
      const submitted = await submitFdcRequest({
        publicClient,
        walletClient,
        account,
        contracts,
        abiEncodedRequest: request,
        onTransactionHash: (txHash) => {
          store.transition(job.id, "RECOVERY_PAYMENT_FINALIZED", {
            metadata: {
              recoveryFdcRequest: request,
              recoveryFdcTxHash: txHash,
            },
          });
        },
      });
      store.transition(job.id, "RECOVERY_FDC_REQUESTED", {
        metadata: {
          recoveryFdcRequest: request,
          recoveryFdcTxHash: submitted.txHash,
          recoveryVotingRound: submitted.votingRound,
        },
      });
      continue;
    }
    if (job.status === "RECOVERY_FDC_REQUESTED") {
      let votingRound = details.recoveryVotingRound;
      if (
        votingRound === undefined &&
        details.recoveryFdcTxHash !== undefined
      ) {
        votingRound = (
          await resolveFdcRequestTransaction({
            publicClient,
            flareSystemsManager: contracts.flareSystemsManager,
            txHash: details.recoveryFdcTxHash,
          })
        ).votingRound;
        store.transition(job.id, "RECOVERY_FDC_REQUESTED", {
          metadata: { recoveryVotingRound: votingRound },
        });
      }
      if (votingRound === undefined) {
        throw new Error("Recovery FDC voting round is missing");
      }
      await recoveryProof({ ...details, recoveryVotingRound: votingRound });
      store.transition(job.id, "RECOVERY_PROOF_READY");
      continue;
    }
    if (job.status === "RECOVERY_PROOF_READY") {
      const proof = await recoveryProof(details);
      const submitted = await submitDirectMintWithData({
        publicClient,
        walletClient,
        account,
        assetManager: contracts.assetManagerFXRP,
        proof,
        userOpData: "0x",
        onTransactionHash: (txHash) => {
          store.transition(job.id, "RECOVERY_FLAG_SUBMITTED", {
            metadata: { recoveryFlareTxHash: txHash },
          });
        },
      });
      const result = await validateFlagReceipt(submitted.receipt, job);
      store.transition(job.id, "RECOVERY_FLAG_SET", {
        metadata: {
          recoveryAmount: result.recoveryAmount.toString(),
          recoveryExecutorFee: result.executorFee.toString(),
        },
      });
      continue;
    }
    if (job.status === "RECOVERY_FLAG_SUBMITTED") {
      if (details.recoveryFlareTxHash === undefined) {
        throw new Error("Recovery flag transaction hash is missing");
      }
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: details.recoveryFlareTxHash,
      });
      const result = await validateFlagReceipt(receipt, job);
      store.transition(job.id, "RECOVERY_FLAG_SET", {
        metadata: {
          recoveryAmount: result.recoveryAmount.toString(),
          recoveryExecutorFee: result.executorFee.toString(),
        },
      });
      continue;
    }
    if (job.status === "RECOVERY_FLAG_SET") {
      const proof = await waitForFdcProof({
        publicClient,
        contracts,
        daLayerBaseUrl: publicConfig.daLayerUrl,
        abiEncodedRequest: job.fdcRequest!,
        votingRound: job.votingRound!,
      });
      validateXrpPaymentProof({
        proof,
        transactionId: job.xrplTxHash!,
        proofOwner: account.address,
      });
      const submitted = await submitDirectMintWithData({
        publicClient,
        walletClient,
        account,
        assetManager: contracts.assetManagerFXRP,
        proof,
        userOpData: job.userOpData,
        onTransactionHash: (txHash) => {
          store.transition(job.id, "RECOVERY_STUCK_SUBMITTED", {
            metadata: { stuckRetryFlareTxHash: txHash },
          });
        },
      });
      const result = await validateStuckReceipt(submitted.receipt, job);
      const balanceAfter = await publicClient.readContract({
        address: contracts.fxrp,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [details.personalAccount],
      });
      store.transition(job.id, "RECOVERED", {
        metadata: {
          recoveredStuckAmount: result.amount.toString(),
          stuckRetryExecutorFee: result.executorFee.toString(),
          recoveryBalanceAfter: balanceAfter.toString(),
        },
      });
      continue;
    }
    if (job.status === "RECOVERY_STUCK_SUBMITTED") {
      if (details.stuckRetryFlareTxHash === undefined) {
        throw new Error("Stuck retry transaction hash is missing");
      }
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: details.stuckRetryFlareTxHash,
      });
      const result = await validateStuckReceipt(receipt, job);
      const balanceAfter = await publicClient.readContract({
        address: contracts.fxrp,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [details.personalAccount],
      });
      store.transition(job.id, "RECOVERED", {
        metadata: {
          recoveredStuckAmount: result.amount.toString(),
          stuckRetryExecutorFee: result.executorFee.toString(),
          recoveryBalanceAfter: balanceAfter.toString(),
        },
      });
      continue;
    }
    throw new Error(`Unsupported recovery status: ${job.status}`);
  }
} catch (error) {
  const current = store.require(jobId);
  store.transition(current.id, current.status, {
    lastError: error instanceof Error ? error.message : String(error),
  });
  throw error;
} finally {
  store.close();
  if (xrplClient.isConnected()) await xrplClient.disconnect();
}
