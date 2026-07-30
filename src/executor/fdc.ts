import {
  decodeAbiParameters,
  getAddress,
  toHex,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  fdcHubAbi,
  fdcRequestFeeConfigurationsAbi,
  fdcVerificationAbi,
  flareSystemsManagerAbi,
  relayAbi,
  xrpPaymentResponseAbiParameter,
  type XrpPaymentProof,
} from "../flare/abis.js";
import type { FlareContractAddresses } from "../flare/contracts.js";
import { normalizeXrplTransactionId } from "./xrpl.js";

const DEFAULT_VERIFIER_TIMEOUT_MS = 30_000;
const DEFAULT_FINALIZATION_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_PROOF_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_RELAY_POLL_MS = 15_000;
const DEFAULT_DA_POLL_MS = 10_000;

export type FdcProgress = (
  event:
    | { stage: "FDC_REQUEST_SUBMITTED"; txHash: Hex; votingRound: number }
    | { stage: "FDC_ROUND_FINALIZED"; votingRound: number }
    | { stage: "FDC_PROOF_READY"; votingRound: number },
) => void;

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted === true) throw signal.reason;
}

async function sleep(ms: number, signal?: AbortSignal) {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

async function postJson(
  url: string,
  body: unknown,
  options: {
    apiKey?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.apiKey === undefined
        ? {}
        : { "X-API-KEY": options.apiKey }),
    },
    body: JSON.stringify(body),
    signal: timeoutSignal(
      options.signal,
      options.timeoutMs ?? DEFAULT_VERIFIER_TIMEOUT_MS,
    ),
  });
  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} from ${new URL(url).origin}: ${responseBody.slice(0, 500)}`,
    );
  }
  return responseBody;
}

export async function prepareXrpPaymentRequest(input: {
  transactionId: string;
  proofOwner: Address;
  verifierBaseUrl: string;
  apiKey: string;
  sourceId?: "testXRP" | "XRP";
  signal?: AbortSignal;
}) {
  const transactionId = normalizeXrplTransactionId(input.transactionId);
  const url = `${input.verifierBaseUrl.replace(/\/$/, "")}/verifier/xrp/XRPPayment/prepareRequest`;
  const raw = await postJson(
    url,
    {
      attestationType: toHex("XRPPayment", { size: 32 }),
      sourceId: toHex(input.sourceId ?? "testXRP", { size: 32 }),
      requestBody: {
        transactionId,
        proofOwner: getAddress(input.proofOwner),
      },
    },
    { apiKey: input.apiKey, signal: input.signal },
  );
  const result: unknown = JSON.parse(raw);
  if (result === null || typeof result !== "object") {
    throw new Error("Verifier returned a non-object response");
  }
  const response = result as {
    status?: string;
    errorMessage?: string;
    abiEncodedRequest?: string;
  };
  if (
    response.status !== undefined &&
    response.status !== "VALID" &&
    !response.status.startsWith("OK")
  ) {
    throw new Error(
      `Verifier rejected XRPPayment request: ${response.status}${response.errorMessage === undefined ? "" : ` (${response.errorMessage})`}`,
    );
  }
  if (!/^0x[0-9a-fA-F]+$/.test(response.abiEncodedRequest ?? "")) {
    throw new Error("Verifier response is missing a valid abiEncodedRequest");
  }
  return response.abiEncodedRequest as Hex;
}

export async function submitFdcRequest(input: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Account;
  contracts: Pick<
    FlareContractAddresses,
    "fdcHub" | "flareSystemsManager"
  >;
  abiEncodedRequest: Hex;
  onTransactionHash?: (hash: Hex) => void;
  onProgress?: FdcProgress;
}) {
  const feeConfiguration = await input.publicClient.readContract({
    address: input.contracts.fdcHub,
    abi: fdcHubAbi,
    functionName: "fdcRequestFeeConfigurations",
  });
  const fee = await input.publicClient.readContract({
    address: feeConfiguration,
    abi: fdcRequestFeeConfigurationsAbi,
    functionName: "getRequestFee",
    args: [input.abiEncodedRequest],
  });
  const txHash = await input.walletClient.writeContract({
    account: input.account,
    chain: input.walletClient.chain,
    address: input.contracts.fdcHub,
    abi: fdcHubAbi,
    functionName: "requestAttestation",
    args: [input.abiEncodedRequest],
    value: fee,
  });
  input.onTransactionHash?.(txHash);
  const { votingRound } = await resolveFdcRequestTransaction({
    publicClient: input.publicClient,
    flareSystemsManager: input.contracts.flareSystemsManager,
    txHash,
  });
  input.onProgress?.({
    stage: "FDC_REQUEST_SUBMITTED",
    txHash,
    votingRound,
  });
  return { txHash, votingRound, fee };
}

export async function resolveFdcRequestTransaction(input: {
  publicClient: PublicClient;
  flareSystemsManager: Address;
  txHash: Hex;
}) {
  const receipt = await input.publicClient.waitForTransactionReceipt({
    hash: input.txHash,
  });
  if (receipt.status !== "success") {
    throw new Error(`FDC request transaction reverted: ${input.txHash}`);
  }
  const [block, firstRoundTimestamp, epochDuration] = await Promise.all([
    input.publicClient.getBlock({ blockNumber: receipt.blockNumber }),
    input.publicClient.readContract({
      address: input.flareSystemsManager,
      abi: flareSystemsManagerAbi,
      functionName: "firstVotingRoundStartTs",
    }),
    input.publicClient.readContract({
      address: input.flareSystemsManager,
      abi: flareSystemsManagerAbi,
      functionName: "votingEpochDurationSeconds",
    }),
  ]);
  if (block.timestamp < firstRoundTimestamp || epochDuration === 0n) {
    throw new Error("Invalid Flare voting-round timing configuration");
  }
  const roundBigInt =
    (block.timestamp - firstRoundTimestamp) / epochDuration;
  if (roundBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Voting round exceeds safe integer range: ${roundBigInt}`);
  }
  const votingRound = Number(roundBigInt);
  return { receipt, votingRound };
}

export async function waitForFdcProof(input: {
  publicClient: PublicClient;
  contracts: Pick<
    FlareContractAddresses,
    "fdcVerification" | "relay"
  >;
  daLayerBaseUrl: string;
  abiEncodedRequest: Hex;
  votingRound: number;
  finalizationTimeoutMs?: number;
  proofTimeoutMs?: number;
  relayPollMs?: number;
  daPollMs?: number;
  signal?: AbortSignal;
  onProgress?: FdcProgress;
}): Promise<XrpPaymentProof> {
  const protocolId = await input.publicClient.readContract({
    address: input.contracts.fdcVerification,
    abi: fdcVerificationAbi,
    functionName: "fdcProtocolId",
  });
  const finalizationDeadline =
    Date.now() +
    (input.finalizationTimeoutMs ?? DEFAULT_FINALIZATION_TIMEOUT_MS);
  while (true) {
    throwIfAborted(input.signal);
    const finalized = await input.publicClient.readContract({
      address: input.contracts.relay,
      abi: relayAbi,
      functionName: "isFinalized",
      args: [BigInt(protocolId), BigInt(input.votingRound)],
    });
    if (finalized) break;
    if (Date.now() >= finalizationDeadline) {
      throw new Error(
        `FDC voting round ${input.votingRound} did not finalize before timeout`,
      );
    }
    await sleep(input.relayPollMs ?? DEFAULT_RELAY_POLL_MS, input.signal);
  }
  input.onProgress?.({
    stage: "FDC_ROUND_FINALIZED",
    votingRound: input.votingRound,
  });

  const proofUrl = `${input.daLayerBaseUrl.replace(/\/$/, "")}/api/v1/fdc/proof-by-request-round-raw`;
  const proofDeadline =
    Date.now() + (input.proofTimeoutMs ?? DEFAULT_PROOF_TIMEOUT_MS);
  let lastError: unknown;
  while (true) {
    throwIfAborted(input.signal);
    try {
      const raw = await postJson(
        proofUrl,
        {
          votingRoundId: input.votingRound,
          requestBytes: input.abiEncodedRequest,
        },
        { signal: input.signal },
      );
      const result: unknown = JSON.parse(raw);
      if (result !== null && typeof result === "object") {
        const response = result as {
          response_hex?: Hex;
          proof?: readonly Hex[];
        };
        if (
          response.response_hex !== undefined &&
          /^0x[0-9a-fA-F]+$/.test(response.response_hex)
        ) {
          const [data] = decodeAbiParameters(
            [xrpPaymentResponseAbiParameter],
            response.response_hex,
          );
          const proof = {
            merkleProof: response.proof ?? [],
            data,
          } as XrpPaymentProof;
          input.onProgress?.({
            stage: "FDC_PROOF_READY",
            votingRound: input.votingRound,
          });
          return proof;
        }
      }
      lastError = undefined;
    } catch (error) {
      if (input.signal?.aborted === true) throw error;
      lastError = error;
    }
    if (Date.now() >= proofDeadline) {
      const detail =
        lastError instanceof Error ? `: ${lastError.message}` : "";
      throw new Error(
        `FDC proof for voting round ${input.votingRound} was not available before timeout${detail}`,
      );
    }
    await sleep(input.daPollMs ?? DEFAULT_DA_POLL_MS, input.signal);
  }
}

export function validateXrpPaymentProof(input: {
  proof: XrpPaymentProof;
  transactionId: string;
  proofOwner: Address;
}) {
  const transactionId = normalizeXrplTransactionId(input.transactionId);
  if (
    input.proof.data.requestBody.transactionId.toLowerCase() !==
    transactionId.toLowerCase()
  ) {
    throw new Error("FDC proof transactionId does not match the XRPL payment");
  }
  if (
    getAddress(input.proof.data.requestBody.proofOwner) !==
    getAddress(input.proofOwner)
  ) {
    throw new Error("FDC proofOwner does not match the executor account");
  }
  if (input.proof.data.responseBody.status !== 0) {
    throw new Error(
      `XRPL payment proof has non-success status ${input.proof.data.responseBody.status}`,
    );
  }
  if (input.proof.data.responseBody.receivedAmount <= 0n) {
    throw new Error("XRPL payment proof has no positive received amount");
  }
  return input.proof;
}
