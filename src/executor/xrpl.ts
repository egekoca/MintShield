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
const TF_PARTIAL_PAYMENT = 0x0002_0000;

export type ExpectedCoreVaultPayment = {
  transactionId: string;
  sourceAccount: string;
  destination: string;
  amountDrops: bigint;
  memoData: Hex;
};

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

export function validateCoreVaultPayment(
  transaction: unknown,
  expected: ExpectedCoreVaultPayment,
) {
  if (
    transaction === null ||
    Array.isArray(transaction) ||
    typeof transaction !== "object"
  ) {
    throw new Error("XRPL transaction response must be an object");
  }
  const raw = transaction as Record<string, unknown>;
  // rippled API version 2 nests transaction fields under `tx_json` instead
  // of returning them flat on the `tx` result; API version 1 (and hand-built
  // test fixtures) keep them flat. Normalize both shapes to one flat object.
  const txJson = raw.tx_json;
  const value =
    txJson !== null && !Array.isArray(txJson) && typeof txJson === "object"
      ? { ...raw, ...(txJson as Record<string, unknown>) }
      : { ...raw };
  // API version 2 also renames the Payment `Amount` field to `DeliverMax`
  // (the ledger's actual delivered amount is separately checked below via
  // meta.delivered_amount). Fall back to it when `Amount` is absent.
  if (value.Amount === undefined && value.DeliverMax !== undefined) {
    value.Amount = value.DeliverMax;
  }
  const meta =
    value.meta !== null &&
    !Array.isArray(value.meta) &&
    typeof value.meta === "object"
      ? (value.meta as Record<string, unknown>)
      : undefined;
  const expectedHash = toXrplTransactionHash(expected.transactionId);
  const expectedMemo = expected.memoData.slice(2).toUpperCase();
  const expectedAmount = assertDrops(expected.amountDrops);

  if (value.validated !== true) {
    throw new Error("XRPL payment is not validated");
  }
  if (
    typeof value.hash !== "string" ||
    value.hash.toUpperCase() !== expectedHash
  ) {
    throw new Error("XRPL payment hash does not match the Xaman result");
  }
  if (value.TransactionType !== "Payment") {
    throw new Error("XRPL transaction is not a Payment");
  }
  if (value.Account !== expected.sourceAccount) {
    throw new Error("XRPL payment source account does not match the intent");
  }
  if (value.Destination !== expected.destination) {
    throw new Error("XRPL payment destination is not the current Core Vault");
  }
  if (value.Amount !== expectedAmount) {
    throw new Error("XRPL payment amount does not match the signed intent");
  }
  if ("DestinationTag" in value) {
    throw new Error("Smart Account direct mint must not use a DestinationTag");
  }
  const flags = value.Flags;
  if (
    typeof flags === "number" &&
    (flags & TF_PARTIAL_PAYMENT) === TF_PARTIAL_PAYMENT
  ) {
    throw new Error("Partial-payment XRPL transactions are not supported");
  }
  if (meta?.TransactionResult !== "tesSUCCESS") {
    throw new Error("XRPL payment did not settle with tesSUCCESS");
  }
  if (meta.delivered_amount !== expectedAmount) {
    throw new Error("XRPL delivered amount does not match the signed intent");
  }
  const memos = value.Memos;
  if (!Array.isArray(memos) || memos.length !== 1) {
    throw new Error("XRPL payment must contain exactly one memo");
  }
  const memoEntry = memos[0];
  const memo =
    memoEntry !== null &&
    !Array.isArray(memoEntry) &&
    typeof memoEntry === "object" &&
    (memoEntry as Record<string, unknown>).Memo !== null &&
    typeof (memoEntry as Record<string, unknown>).Memo === "object"
      ? ((memoEntry as Record<string, unknown>).Memo as Record<
          string,
          unknown
        >)
      : undefined;
  if (
    typeof memo?.MemoData !== "string" ||
    memo.MemoData.toUpperCase() !== expectedMemo
  ) {
    throw new Error("XRPL payment memo does not match the 0xFE commitment");
  }

  return {
    transactionId: normalizeXrplTransactionId(value.hash),
    sourceAccount: value.Account,
    destination: value.Destination,
    amountDrops: value.Amount,
    memoData: `0x${memo.MemoData.toLowerCase()}` as Hex,
    ledgerIndex:
      typeof value.ledger_index === "number" ? value.ledger_index : undefined,
  };
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

function isTransactionNotFound(error: unknown) {
  const maybeError = error as {
    data?: { error?: string };
    message?: string;
  };
  return (
    maybeError.data?.error === "txnNotFound" ||
    maybeError.message?.includes("txnNotFound") === true
  );
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
      if (isTransactionNotFound(error)) return undefined;
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
      let tx:
        | {
            result: {
              validated?: boolean;
              ledger_index?: number;
            };
          }
        | undefined;
      try {
        tx = await input.client.request({
          command: "tx",
          transaction,
        });
      } catch (error) {
        if (!isTransactionNotFound(error)) throw error;
      }
      if (tx === undefined) {
        if (Date.now() >= deadline) {
          throw new Error(
            `XRPL transaction ${transaction} was not found before timeout`,
          );
        }
        await sleep(
          input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
          input.signal,
        );
        continue;
      }
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
