import type { DepositPreviewInput } from "../api/deposit-preview.js";

const XAMAN_API_BASE = "https://xumm.app/api/v1/platform";
const CREDENTIAL_PATTERN = /^[0-9a-f-]{36}$/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type XamanCredentials = {
  apiKey: string;
  apiSecret: string;
};

export type XamanPaymentPreview = {
  source: {
    xrplAddress: string;
    destination: string;
  };
  intent: {
    inputAmountFxrp: string;
  };
  quote: {
    paymentAmountDrops: string;
    paymentAmountXrp: string;
  };
  commitment: {
    userOpHash: string;
    memoData: string;
  };
};

export type XamanPayloadTemplate = {
  txjson: {
    TransactionType: "Payment";
    Destination: string;
    Amount: string;
    Memos: Array<{ Memo: { MemoData: string } }>;
  };
  options: {
    submit: true;
    expire: number;
    force_network: "TESTNET";
  };
  custom_meta: {
    identifier: string;
    instruction: string;
    blob: {
      kind: "mintshield-protected-deposit";
      xrplAddress: string;
      destination: string;
      amountDrops: string;
      memoData: string;
      userOpHash: string;
    };
  };
};

export type CreatedXamanSignRequest = {
  uuid: string;
  deepLink: string;
  qrPng: string;
  websocketStatus: string;
  pushed: boolean;
};

type FetchLike = typeof fetch;

function safeXamanUrl(
  value: unknown,
  protocols: readonly string[],
  field: string,
) {
  if (typeof value !== "string") {
    throw new Error(`Xaman response is missing ${field}`);
  }
  const parsed = new URL(value);
  if (
    parsed.hostname !== "xumm.app" ||
    !protocols.includes(parsed.protocol)
  ) {
    throw new Error(`Xaman response contains an untrusted ${field}`);
  }
  return parsed.toString();
}

async function xamanRequest(
  credentials: XamanCredentials,
  path: string,
  init: RequestInit,
  fetchImpl: FetchLike,
) {
  const response = await fetchImpl(`${XAMAN_API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-api-key": credentials.apiKey,
      "x-api-secret": credentials.apiSecret,
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const detail =
      payload !== null &&
      typeof payload === "object" &&
      "message" in payload &&
      typeof payload.message === "string"
        ? `: ${payload.message}`
        : "";
    throw new Error(`Xaman API ${response.status}${detail}`);
  }
  return payload;
}

export function loadOptionalXamanCredentials(
  env: NodeJS.ProcessEnv = process.env,
): XamanCredentials | undefined {
  if (env.XAMAN_ENABLE_SIGNING !== "true") return undefined;
  const apiKey = env.XAMAN_API_KEY;
  const apiSecret = env.XAMAN_API_SECRET;
  if (
    !apiKey ||
    !apiSecret ||
    !CREDENTIAL_PATTERN.test(apiKey) ||
    !CREDENTIAL_PATTERN.test(apiSecret)
  ) {
    throw new Error(
      "XAMAN_API_KEY and XAMAN_API_SECRET must both be UUID credentials",
    );
  }
  return { apiKey, apiSecret };
}

export function buildXamanPaymentPayload(input: {
  preview: XamanPaymentPreview;
  identifier: string;
}): XamanPayloadTemplate {
  const { preview } = input;
  if (!UUID_PATTERN.test(input.identifier)) {
    throw new RangeError("Xaman sign-request identifier must be a UUID");
  }
  if (!/^0x[0-9a-f]{84}$/i.test(preview.commitment.memoData)) {
    throw new RangeError("MintShield memo must be exactly 42 bytes");
  }
  if (!/^[1-9][0-9]*$/.test(preview.quote.paymentAmountDrops)) {
    throw new RangeError("XRPL payment amount must be positive drops");
  }

  return {
    txjson: {
      TransactionType: "Payment",
      Destination: preview.source.destination,
      Amount: preview.quote.paymentAmountDrops,
      Memos: [
        {
          Memo: {
            MemoData: preview.commitment.memoData.slice(2).toUpperCase(),
          },
        },
      ],
    },
    options: {
      submit: true,
      expire: 5,
      force_network: "TESTNET",
    },
    custom_meta: {
      identifier: input.identifier,
      instruction:
        `MintShield protected deposit on XRPL Testnet: send ` +
        `${preview.quote.paymentAmountXrp} XRP to receive ` +
        `${preview.intent.inputAmountFxrp} FXRP for the protected action.`,
      blob: {
        kind: "mintshield-protected-deposit",
        xrplAddress: preview.source.xrplAddress,
        destination: preview.source.destination,
        amountDrops: preview.quote.paymentAmountDrops,
        memoData: preview.commitment.memoData,
        userOpHash: preview.commitment.userOpHash,
      },
    },
  };
}

export async function createXamanSignRequest(input: {
  credentials: XamanCredentials;
  payload: XamanPayloadTemplate;
  fetchImpl?: FetchLike;
}): Promise<CreatedXamanSignRequest> {
  const raw = await xamanRequest(
    input.credentials,
    "/payload",
    {
      method: "POST",
      body: JSON.stringify(input.payload),
    },
    input.fetchImpl ?? fetch,
  );
  if (raw === null || typeof raw !== "object") {
    throw new Error("Xaman returned an invalid payload response");
  }
  const response = raw as {
    uuid?: unknown;
    next?: { always?: unknown };
    refs?: { qr_png?: unknown; websocket_status?: unknown };
    pushed?: unknown;
  };
  if (
    typeof response.uuid !== "string" ||
    !UUID_PATTERN.test(response.uuid)
  ) {
    throw new Error("Xaman returned an invalid payload UUID");
  }
  return {
    uuid: response.uuid,
    deepLink: safeXamanUrl(response.next?.always, ["https:"], "deeplink"),
    qrPng: safeXamanUrl(response.refs?.qr_png, ["https:"], "QR URL"),
    websocketStatus: safeXamanUrl(
      response.refs?.websocket_status,
      ["wss:"],
      "WebSocket URL",
    ),
    pushed: response.pushed === true,
  };
}

export async function getXamanSignRequest(input: {
  credentials: XamanCredentials;
  uuid: string;
  fetchImpl?: FetchLike;
}) {
  if (!UUID_PATTERN.test(input.uuid)) {
    throw new RangeError("Invalid Xaman payload UUID");
  }
  return xamanRequest(
    input.credentials,
    `/payload/${input.uuid}`,
    { method: "GET" },
    input.fetchImpl ?? fetch,
  );
}

export function toPublicXamanStatus(raw: unknown) {
  if (raw === null || typeof raw !== "object") {
    throw new Error("Xaman returned an invalid status response");
  }
  const value = raw as {
    meta?: Record<string, unknown>;
    response?: Record<string, unknown>;
    custom_meta?: {
      blob?: Record<string, unknown>;
    };
  };
  const meta = value.meta ?? {};
  const response = value.response ?? {};
  const expected = value.custom_meta?.blob ?? {};
  const txid =
    typeof response.txid === "string" &&
    /^[0-9a-f]{64}$/i.test(response.txid)
      ? response.txid.toUpperCase()
      : undefined;
  const account =
    typeof response.account === "string" ? response.account : undefined;
  const expectedAccount =
    typeof expected.xrplAddress === "string"
      ? expected.xrplAddress
      : undefined;
  const dispatchedNodeType =
    typeof response.dispatched_nodetype === "string"
      ? response.dispatched_nodetype
      : undefined;
  const resolved = meta.resolved === true;
  const signed = meta.signed === true;

  return {
    resolved,
    signed,
    cancelled: meta.cancelled === true,
    expired: meta.expired === true,
    opened:
      meta.opened_by_deeplink === true ||
      meta.opened_by_deeplink === false,
    ...(txid === undefined ? {} : { txid }),
    ...(account === undefined ? {} : { account }),
    ...(dispatchedNodeType === undefined
      ? {}
      : { dispatchedNodeType }),
    checks: {
      signerMatches:
        signed &&
        account !== undefined &&
        expectedAccount !== undefined &&
        account === expectedAccount,
      testnet:
        signed &&
        dispatchedNodeType !== undefined &&
        dispatchedNodeType.toUpperCase().includes("TEST"),
      hasTransactionId: signed && txid !== undefined,
    },
  };
}

export type XamanSignRequestInput = DepositPreviewInput;
