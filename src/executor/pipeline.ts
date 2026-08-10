import { Client, Wallet } from "xrpl";
import {
  getAddress,
  keccak256,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import type { FlareContractAddresses } from "../flare/contracts.js";
import {
  prepareXrpPaymentRequest,
  resolveFdcRequestTransaction,
  submitFdcRequest,
  validateXrpPaymentProof,
  waitForFdcProof,
} from "./fdc.js";
import {
  classifySettlement,
  submitDirectMintWithData,
} from "./flare-submit.js";
import {
  ExecutorStateStore,
  type ExecutorJob,
  type JobStatus,
} from "./state-store.js";
import {
  findValidatedXrplTransaction,
  prepareAndSignCoreVaultPayment,
  submitSignedXrplPayment,
  validateCoreVaultPayment,
  waitForXrplFinality,
} from "./xrpl.js";

type PipelineMetadata = {
  router: Address;
  personalAccount: Address;
  nonce: string;
  xrplSourceAccount: string;
  coreVaultAddress: string;
  paymentAmountDrops: string;
  memoData: Hex;
  callValue: string;
  expectedIntentId?: Hex;
  jobKind?: "PROTECTED" | "BARE_REVERT_COMPARISON";
  allowFlareRevert?: boolean;
  flareGasLimit?: string;
  simulationKind?: "EXECUTE_DIRECT_MINTING_WITH_DATA_ETH_CALL";
  simulationPolicy?: "REQUIRED_BEFORE_BROADCAST" | "BYPASSED_EXPECTED_REVERT";
  simulationResult?: "OUTER_CALL_NON_REVERTING";
  simulationPassedAt?: string;
  simulationAttempts?: number;
  simulationUserOpHash?: Hex;
  simulationCallValue?: string;
  simulationAssetManager?: Address;
  txBlob?: string;
  fdcTxHash?: Hex;
};

export type ProtectedMintJobInput = {
  intentKey: string;
  userOpHash: Hex;
  userOpData: Hex;
  memoData: Hex;
  router: Address;
  personalAccount: Address;
  nonce: bigint;
  xrplSourceAccount: string;
  coreVaultAddress: string;
  paymentAmountDrops: bigint;
  callValue?: bigint;
  expectedIntentId?: Hex;
  jobKind?: "PROTECTED" | "BARE_REVERT_COMPARISON";
  allowFlareRevert?: boolean;
  flareGasLimit?: bigint;
};

export type ExecutorPipelineDependencies = {
  store: ExecutorStateStore;
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Account;
  contracts: FlareContractAddresses;
  verifierBaseUrl: string;
  verifierApiKey: string;
  daLayerBaseUrl: string;
  xrplClient: Client;
};

function metadata(job: ExecutorJob): PipelineMetadata {
  const value = job.metadata as Partial<PipelineMetadata>;
  if (
    typeof value.router !== "string" ||
    typeof value.personalAccount !== "string" ||
    typeof value.nonce !== "string" ||
    typeof value.xrplSourceAccount !== "string" ||
    typeof value.coreVaultAddress !== "string" ||
    typeof value.paymentAmountDrops !== "string" ||
    typeof value.memoData !== "string" ||
    typeof value.callValue !== "string"
  ) {
    throw new Error(`Executor job ${job.id} has incomplete metadata`);
  }
  if (
    value.jobKind !== undefined &&
    value.jobKind !== "PROTECTED" &&
    value.jobKind !== "BARE_REVERT_COMPARISON"
  ) {
    throw new Error(`Executor job ${job.id} has an invalid job kind`);
  }
  if (
    value.allowFlareRevert !== undefined &&
    typeof value.allowFlareRevert !== "boolean"
  ) {
    throw new Error(`Executor job ${job.id} has an invalid revert policy`);
  }
  if (
    value.flareGasLimit !== undefined &&
    (typeof value.flareGasLimit !== "string" ||
      BigInt(value.flareGasLimit) <= 0n)
  ) {
    throw new Error(`Executor job ${job.id} has an invalid Flare gas limit`);
  }
  return value as PipelineMetadata;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A job that keeps throwing on the exact same status (e.g. a deterministic
 * validation error) is stuck, not merely delayed by a transient RPC blip.
 * After this many consecutive failures without status progress, the job is
 * moved to FAILED instead of being retried forever by the worker loop.
 */
const MAX_CONSECUTIVE_STATUS_ERRORS = 8;

type ErrorStreak = { status: JobStatus; count: number };

function nextErrorStreak(
  job: ExecutorJob,
  status: JobStatus,
): ErrorStreak {
  const previous = job.metadata.errorStreak as ErrorStreak | undefined;
  const count = previous?.status === status ? previous.count + 1 : 1;
  return { status, count };
}

export function createProtectedMintJob(
  store: ExecutorStateStore,
  input: ProtectedMintJobInput,
) {
  if (input.paymentAmountDrops <= 0n) {
    throw new RangeError("paymentAmountDrops must be positive");
  }
  if (keccak256(input.userOpData) !== input.userOpHash) {
    throw new Error("userOpHash does not commit to userOpData");
  }
  if (
    input.allowFlareRevert === true &&
    (input.jobKind !== "BARE_REVERT_COMPARISON" ||
      input.flareGasLimit === undefined ||
      input.flareGasLimit <= 0n)
  ) {
    throw new Error(
      "Reverting Flare broadcasts are allowed only for a bare comparison with an explicit gas limit",
    );
  }
  if (
    input.memoData.length !== 86 ||
    input.memoData.slice(0, 4).toLowerCase() !== "0xfe" ||
    `0x${input.memoData.slice(-64)}`.toLowerCase() !==
      input.userOpHash.toLowerCase()
  ) {
    throw new Error("0xFE memo does not commit to userOpHash");
  }
  return store.createOrGet({
    intentKey: input.intentKey,
    userOpHash: input.userOpHash,
    userOpData: input.userOpData,
    metadata: {
      router: getAddress(input.router),
      personalAccount: getAddress(input.personalAccount),
      nonce: input.nonce.toString(),
      xrplSourceAccount: input.xrplSourceAccount,
      coreVaultAddress: input.coreVaultAddress,
      paymentAmountDrops: input.paymentAmountDrops.toString(),
      memoData: input.memoData,
      callValue: (input.callValue ?? 0n).toString(),
      jobKind: input.jobKind ?? "PROTECTED",
      allowFlareRevert: input.allowFlareRevert ?? false,
      ...(input.flareGasLimit === undefined
        ? {}
        : { flareGasLimit: input.flareGasLimit.toString() }),
      ...(input.expectedIntentId === undefined
        ? {}
        : { expectedIntentId: input.expectedIntentId }),
    },
  });
}

export class MintShieldExecutorPipeline {
  readonly #dependencies: ExecutorPipelineDependencies;

  constructor(dependencies: ExecutorPipelineDependencies) {
    this.#dependencies = dependencies;
  }

  createJob(input: ProtectedMintJobInput) {
    return createProtectedMintJob(this.#dependencies.store, input);
  }

  async run(
    jobId: string,
    options: {
      xrplWallet?: Wallet;
      signal?: AbortSignal;
    } = {},
  ): Promise<ExecutorJob> {
    try {
      while (true) {
        const job = this.#dependencies.store.require(jobId);
        const details = metadata(job);
        if (
          job.status === "SETTLED_SUCCESS" ||
          job.status === "SETTLED_FALLBACK" ||
          job.status === "RECOVERY_REQUIRED" ||
          job.status.startsWith("RECOVERY_") ||
          job.status === "RECOVERED" ||
          job.status === "FAILED"
        ) {
          return job;
        }

        if (job.status === "DELAYED") {
          const now = BigInt(Math.floor(Date.now() / 1_000));
          if (
            job.executionAllowedAt !== undefined &&
            now < job.executionAllowedAt
          ) {
            return job;
          }
          await this.#submitFlare(job, details, options.signal);
          continue;
        }

        if (job.status === "CREATED") {
          if (options.xrplWallet === undefined) {
            throw new Error(
              "An XRPL wallet is required only for the CREATED -> XRPL_SIGNED step",
            );
          }
          if (options.xrplWallet.address !== details.xrplSourceAccount) {
            throw new Error(
              "XRPL signing wallet does not match the job source account",
            );
          }
          const signed = await prepareAndSignCoreVaultPayment({
            client: this.#dependencies.xrplClient,
            wallet: options.xrplWallet,
            destination: details.coreVaultAddress,
            amountDrops: BigInt(details.paymentAmountDrops),
            memoData: details.memoData,
          });
          this.#dependencies.store.transition(job.id, "XRPL_SIGNED", {
            xrplTxHash: signed.txHash,
            metadata: { txBlob: signed.txBlob },
          });
          continue;
        }

        if (job.status === "XRPL_SIGNED") {
          if (job.xrplTxHash === undefined) {
            throw new Error("XRPL_SIGNED job is missing its transaction hash");
          }
          const existing = await findValidatedXrplTransaction({
            client: this.#dependencies.xrplClient,
            transactionId: job.xrplTxHash,
          });
          if (existing === undefined && details.txBlob !== undefined) {
            const submitted = await submitSignedXrplPayment({
              client: this.#dependencies.xrplClient,
              txBlob: details.txBlob,
            });
            if (
              submitted.txHash.toLowerCase() !== job.xrplTxHash.toLowerCase()
            ) {
              throw new Error("Submitted XRPL hash differs from the signed hash");
            }
          }
          const finality = await waitForXrplFinality({
            client: this.#dependencies.xrplClient,
            transactionId: job.xrplTxHash,
            signal: options.signal,
          });
          const validatedTransaction = await findValidatedXrplTransaction({
            client: this.#dependencies.xrplClient,
            transactionId: job.xrplTxHash,
          });
          if (validatedTransaction === undefined) {
            throw new Error(
              "XRPL transaction disappeared after reaching finality",
            );
          }
          validateCoreVaultPayment(validatedTransaction, {
            transactionId: job.xrplTxHash,
            sourceAccount: details.xrplSourceAccount,
            destination: details.coreVaultAddress,
            amountDrops: BigInt(details.paymentAmountDrops),
            memoData: details.memoData,
          });
          this.#dependencies.store.transition(job.id, "XRPL_FINALIZED", {
            metadata: {
              xrplLedgerIndex: finality.txLedgerIndex,
              xrplValidatedLedgerIndex: finality.validatedLedgerIndex,
              xrplConfirmations: finality.confirmations,
            },
          });
          continue;
        }

        if (job.status === "XRPL_FINALIZED") {
          if (job.xrplTxHash === undefined) {
            throw new Error("XRPL_FINALIZED job is missing transaction hash");
          }
          const fdcRequest = await prepareXrpPaymentRequest({
            transactionId: job.xrplTxHash,
            proofOwner: this.#dependencies.account.address,
            verifierBaseUrl: this.#dependencies.verifierBaseUrl,
            apiKey: this.#dependencies.verifierApiKey,
            signal: options.signal,
          });
          const submitted = await submitFdcRequest({
            publicClient: this.#dependencies.publicClient,
            walletClient: this.#dependencies.walletClient,
            account: this.#dependencies.account,
            contracts: this.#dependencies.contracts,
            abiEncodedRequest: fdcRequest,
            onTransactionHash: (fdcTxHash) => {
              this.#dependencies.store.transition(job.id, "FDC_REQUESTED", {
                fdcRequest,
                metadata: { fdcTxHash },
              });
            },
          });
          this.#dependencies.store.transition(job.id, "FDC_REQUESTED", {
            fdcRequest,
            votingRound: submitted.votingRound,
          });
          continue;
        }

        if (job.status === "FDC_REQUESTED") {
          if (job.fdcRequest === undefined) {
            throw new Error("FDC_REQUESTED job is missing encoded request");
          }
          let votingRound = job.votingRound;
          if (votingRound === undefined) {
            if (details.fdcTxHash === undefined) {
              throw new Error(
                "FDC_REQUESTED job lacks both round and transaction hash",
              );
            }
            const resolved = await resolveFdcRequestTransaction({
              publicClient: this.#dependencies.publicClient,
              flareSystemsManager:
                this.#dependencies.contracts.flareSystemsManager,
              txHash: details.fdcTxHash,
            });
            votingRound = resolved.votingRound;
            this.#dependencies.store.transition(job.id, "FDC_REQUESTED", {
              votingRound,
            });
          }
          const proof = await waitForFdcProof({
            publicClient: this.#dependencies.publicClient,
            contracts: this.#dependencies.contracts,
            daLayerBaseUrl: this.#dependencies.daLayerBaseUrl,
            abiEncodedRequest: job.fdcRequest,
            votingRound,
            signal: options.signal,
          });
          validateXrpPaymentProof({
            proof,
            transactionId: job.xrplTxHash!,
            proofOwner: this.#dependencies.account.address,
            expectedPayment: {
              sourceAddress: details.xrplSourceAccount,
              receivedAmount: BigInt(details.paymentAmountDrops),
              memoData: details.memoData,
            },
          });
          this.#dependencies.store.transition(job.id, "PROOF_READY");
          continue;
        }

        if (
          job.status === "PROOF_READY" ||
          job.status === "SIMULATION_PASSED"
        ) {
          await this.#submitFlare(job, details, options.signal);
          continue;
        }

        if (job.status === "FLARE_SUBMITTED") {
          if (job.flareTxHash === undefined) {
            throw new Error("FLARE_SUBMITTED job is missing transaction hash");
          }
          const receipt =
            await this.#dependencies.publicClient.waitForTransactionReceipt({
              hash: job.flareTxHash,
            });
          this.#classifyReceipt(job, details, receipt);
          continue;
        }
      }
    } catch (error) {
      const current = this.#dependencies.store.require(jobId);
      if (
        current.status !== "SETTLED_SUCCESS" &&
        current.status !== "SETTLED_FALLBACK" &&
        current.status !== "FAILED"
      ) {
        const errorStreak = nextErrorStreak(current, current.status);
        const nextStatus: JobStatus =
          errorStreak.count >= MAX_CONSECUTIVE_STATUS_ERRORS
            ? "FAILED"
            : current.status;
        this.#dependencies.store.transition(current.id, nextStatus, {
          lastError: toErrorMessage(error),
          metadata: { errorStreak },
        });
      }
      throw error;
    }
  }

  async #submitFlare(
    job: ExecutorJob,
    details: PipelineMetadata,
    signal?: AbortSignal,
  ) {
    if (
      job.fdcRequest === undefined ||
      job.votingRound === undefined ||
      job.xrplTxHash === undefined
    ) {
      throw new Error("Proof-ready job is missing FDC or XRPL coordinates");
    }
    const proof = await waitForFdcProof({
      publicClient: this.#dependencies.publicClient,
      contracts: this.#dependencies.contracts,
      daLayerBaseUrl: this.#dependencies.daLayerBaseUrl,
      abiEncodedRequest: job.fdcRequest,
      votingRound: job.votingRound,
      signal,
    });
    validateXrpPaymentProof({
      proof,
      transactionId: job.xrplTxHash,
      proofOwner: this.#dependencies.account.address,
      expectedPayment: {
        sourceAddress: details.xrplSourceAccount,
        receivedAmount: BigInt(details.paymentAmountDrops),
        memoData: details.memoData,
      },
    });
    const allowRevert = details.allowFlareRevert ?? false;
    if (allowRevert) {
      this.#dependencies.store.transition(job.id, job.status, {
        lastError: null,
        metadata: {
          simulationKind: "EXECUTE_DIRECT_MINTING_WITH_DATA_ETH_CALL",
          simulationPolicy: "BYPASSED_EXPECTED_REVERT",
        },
      });
    }
    const submitted = await submitDirectMintWithData({
      publicClient: this.#dependencies.publicClient,
      walletClient: this.#dependencies.walletClient,
      account: this.#dependencies.account,
      assetManager: this.#dependencies.contracts.assetManagerFXRP,
      proof,
      userOpData: job.userOpData,
      callValue: BigInt(details.callValue),
      onSimulationSuccess: async () => {
        const current = this.#dependencies.store.require(job.id);
        const previousAttempts = current.metadata.simulationAttempts;
        const simulationAttempts =
          typeof previousAttempts === "number" &&
          Number.isSafeInteger(previousAttempts) &&
          previousAttempts >= 0
            ? previousAttempts + 1
            : 1;
        this.#dependencies.store.transition(job.id, "SIMULATION_PASSED", {
          lastError: null,
          metadata: {
            simulationKind: "EXECUTE_DIRECT_MINTING_WITH_DATA_ETH_CALL",
            simulationPolicy: "REQUIRED_BEFORE_BROADCAST",
            simulationResult: "OUTER_CALL_NON_REVERTING",
            simulationPassedAt: new Date().toISOString(),
            simulationAttempts,
            simulationUserOpHash: job.userOpHash,
            simulationCallValue: details.callValue,
            simulationAssetManager:
              this.#dependencies.contracts.assetManagerFXRP,
          },
        });
      },
      onTransactionHash: (flareTxHash) => {
        this.#dependencies.store.transition(job.id, "FLARE_SUBMITTED", {
          flareTxHash,
        });
      },
      allowRevert,
      ...(details.flareGasLimit === undefined
        ? {}
        : { gasLimit: BigInt(details.flareGasLimit) }),
    });
    this.#classifyReceipt(job, details, submitted.receipt);
  }

  #classifyReceipt(
    job: ExecutorJob,
    details: PipelineMetadata,
    receipt: TransactionReceipt,
  ) {
    if (receipt.status !== "success") {
      this.#dependencies.store.transition(job.id, "RECOVERY_REQUIRED", {
        lastError: `Flare transaction reverted: ${receipt.transactionHash}`,
      });
      return;
    }
    const result = classifySettlement(receipt, {
      personalAccount: details.personalAccount,
      nonce: BigInt(details.nonce),
      router: details.router,
      masterAccountController:
        this.#dependencies.contracts.masterAccountController,
      assetManager: this.#dependencies.contracts.assetManagerFXRP,
      ...(details.expectedIntentId === undefined
        ? {}
        : { intentId: details.expectedIntentId }),
    });
    if (result.status === "DELAYED") {
      this.#dependencies.store.transition(job.id, "DELAYED", {
        executionAllowedAt: result.executionAllowedAt,
        metadata: {
          delayKind: result.delayKind,
          delayedAmount: result.amount.toString(),
        },
      });
      return;
    }
    if (result.status === "RECOVERY_REQUIRED") {
      this.#dependencies.store.transition(job.id, "RECOVERY_REQUIRED", {
        lastError: result.reason,
      });
      return;
    }
    this.#dependencies.store.transition(job.id, result.status, {
      lastError: null,
      metadata:
        result.status === "SETTLED_SUCCESS"
          ? {
              settledIntentId: result.intentId,
              amountIn: result.amountIn.toString(),
              amountOut: result.amountOut.toString(),
            }
          : {
              settledIntentId: result.intentId,
              returnedAmount: result.returnedAmount.toString(),
              failureCode: result.failureCode,
              revertDataHash: result.revertDataHash,
            },
    });
  }
}
