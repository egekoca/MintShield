import {
  Client,
  Wallet,
  type Memo,
  type Payment,
} from "xrpl";
import type { Hex } from "viem";

export const XRPL_FDC_CONFIRMATIONS = 3;
const DEFAULT_FINALITY_TIMEOUT_MS = 90_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;

export function normalizeXrplTransactionId(value: string): Hex {
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("XRPL transaction id must contain exactly 32 hex bytes");
  }
  return `0x${normalized.toLowerCase()}`;
}

export function toXrplTransactionHash(value: string) {
  return normalizeXrplTransactionId(value).slice(2).toUpperCase();
}

export function memoFromHex(data: Hex): Memo {
  return { Memo: { MemoData: data.slice(2).toUpperCase() } };
}

function assertDrops(value: bigint) {
  if (value <= 0n) throw new RangeError("XRPL payment drops must be positive");
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("XRPL payment drops exceed supported safe range");
  }
  return value.toString();
}

async function withConnection<T>(client: Client, operation: () => Promise<T>) {
  const ownsConnection = !client.isConnected();
  if (ownsConnection) await client.connect();
  try {
    return await operation();
  } finally {
    if (ownsConnection && client.isConnected()) await client.disconnect();
  }
}

export async function prepareAndSignCoreVaultPayment(input: {
  client: Client;
  wallet: Wallet;
  destination: string;
  amountDrops: bigint;
  memoData: Hex;
}) {
  return withConnection(input.client, async () => {
    const payment: Payment = {
      TransactionType: "Payment",
      Account: input.wallet.address,
      Destination: input.destination,
      Amount: assertDrops(input.amountDrops),
      Memos: [memoFromHex(input.memoData)],
    };
    // Direct minting requires no DestinationTag. It is intentionally absent.
    const prepared = await input.client.autofill(payment);
    const signed = input.wallet.sign(prepared);
    return {
      txBlob: signed.tx_blob,
      txHash: normalizeXrplTransactionId(signed.hash),
      prepared,
    };
  });
}

export async function submitSignedXrplPayment(input: {
  client: Client;
  txBlob: string;
}) {
  return withConnection(input.client, async () => {
    const response = await input.client.submitAndWait(input.txBlob);
    const result = response.result;
    if (result.validated !== true) {
      throw new Error("XRPL payment was submitted but is not validated");
    }
    const transactionHash =
      "hash" in result && typeof result.hash === "string"
        ? result.hash
        : undefined;
    if (transactionHash === undefined) {
      throw new Error("Validated XRPL response did not include a transaction hash");
    }
    return {
      txHash: normalizeXrplTransactionId(transactionHash),
      ledgerIndex: result.ledger_index,
      result,
    };
  });
}

export async function findValidatedXrplTransaction(input: {
  client: Client;
  transactionId: string;
}) {
  const transaction = toXrplTransactionHash(input.transactionId);
  return withConnection(input.client, async () => {
    try {
      const response = await input.client.request({
        command: "tx",
        transaction,
      });
      return response.result.validated === true ? response.result : undefined;
    } catch (error) {
      const maybeError = error as {
        data?: { error?: string };
        message?: string;
      };
      if (
        maybeError.data?.error === "txnNotFound" ||
        maybeError.message?.includes("txnNotFound") === true
      ) {
        return undefined;
      }
      throw error;
    }
  });
}

async function sleep(ms: number, signal?: AbortSignal) {
  if (signal?.aborted === true) throw signal.reason;
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

export async function waitForXrplFinality(input: {
  client: Client;
  transactionId: string;
  confirmations?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}) {
  const transaction = toXrplTransactionHash(input.transactionId);
  const requiredConfirmations = input.confirmations ?? XRPL_FDC_CONFIRMATIONS;
  if (!Number.isSafeInteger(requiredConfirmations) || requiredConfirmations < 1) {
    throw new RangeError("XRPL confirmations must be a positive integer");
  }
  const deadline = Date.now() + (input.timeoutMs ?? DEFAULT_FINALITY_TIMEOUT_MS);

  return withConnection(input.client, async () => {
    while (true) {
      if (input.signal?.aborted === true) throw input.signal.reason;
      const tx = await input.client.request({
        command: "tx",
        transaction,
      });
      if (tx.result.validated !== true || tx.result.ledger_index === undefined) {
        throw new Error(`XRPL transaction ${transaction} is not validated`);
      }
      const ledger = await input.client.request({
        command: "ledger",
        ledger_index: "validated",
      });
      const txLedgerIndex = tx.result.ledger_index;
      const validatedLedgerIndex = ledger.result.ledger_index;
      const confirmations = validatedLedgerIndex - txLedgerIndex + 1;
      if (confirmations >= requiredConfirmations) {
        return { confirmations, txLedgerIndex, validatedLedgerIndex };
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `XRPL transaction ${transaction} reached ${confirmations}/${requiredConfirmations} confirmations before timeout`,
        );
      }
      await sleep(input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, input.signal);
    }
  });
}

export function restoreWallet(seed: string) {
  return Wallet.fromSeed(seed);
}
