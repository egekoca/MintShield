import { createServer, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getAddress, type Address, type Hex } from "viem";
import {
  buildDepositPlan,
  normalizeDepositPreviewInput,
  type PreviewDeployment,
} from "../src/api/deposit-preview.js";
import {
  summarizeJobs,
  toPublicJob,
} from "../src/api/public-model.js";
import { loadPublicConfig } from "../src/config/env.js";
import { createProtectedMintJob } from "../src/executor/pipeline.js";
import { ExecutorStateStore } from "../src/executor/state-store.js";
import { normalizeXrplTransactionId } from "../src/executor/xrpl.js";
import { createCoston2PublicClient } from "../src/flare/clients.js";
import {
  getPersonalAccount,
  getSmartAccountNonce,
  readDirectMintingSettings,
  resolveFlareContracts,
} from "../src/flare/contracts.js";
import {
  buildXamanPaymentPayload,
  createXamanSignRequest,
  getXamanSignRequest,
  loadOptionalXamanCredentials,
  toPublicXamanStatus,
} from "../src/xaman/client.js";
import { isValidXrplClassicAddress } from "../src/xrpl/address.js";

function sendJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown,
) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  response.end(JSON.stringify(value));
}

const staticHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'self'; connect-src 'self' wss://xumm.app; img-src 'self' data: https://xumm.app; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

function sendStatic(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  body: Buffer,
) {
  response.writeHead(statusCode, {
    ...staticHeaders,
    "Content-Type": contentType,
    "Content-Length": body.byteLength,
  });
  response.end(body);
}

async function readJsonBody(request: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 16_384) {
      throw new RangeError("Request body exceeds 16 KiB");
    }
    chunks.push(buffer);
  }
  if (size === 0) throw new SyntaxError("Request body is required");
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

const databasePath = resolve(
  process.cwd(),
  process.env.EXECUTOR_DB_PATH ?? "./data/mintshield.db",
);
mkdirSync(dirname(databasePath), { recursive: true });
const store = new ExecutorStateStore(databasePath);
const webRoot = resolve(process.cwd(), "web");
const deploymentFile = JSON.parse(
  readFileSync(resolve(process.cwd(), "deployments/coston2.json"), "utf8"),
) as {
  chainId: number;
  fxrp: Address;
  adapterId: Hex;
  maxAmountUBA: string;
  contracts: {
    router: { address: Address };
    vault: { address: Address };
  };
  configuration: { adapterVersion: number };
};
if (deploymentFile.chainId !== 114) {
  throw new Error("Dashboard deployment manifest must target Coston2 chain 114");
}
const previewDeployment: PreviewDeployment = {
  router: getAddress(deploymentFile.contracts.router.address),
  vault: getAddress(deploymentFile.contracts.vault.address),
  fxrp: getAddress(deploymentFile.fxrp),
  adapterId: deploymentFile.adapterId,
  adapterVersion: deploymentFile.configuration.adapterVersion,
  maxAmountUBA: BigInt(deploymentFile.maxAmountUBA),
};
const publicConfig = loadPublicConfig();
const publicClient = createCoston2PublicClient(publicConfig.coston2RpcUrl);
const xamanCredentials = loadOptionalXamanCredentials();
const staticAssets = new Map([
  [
    "/",
    {
      type: "text/html; charset=utf-8",
      body: readFileSync(resolve(webRoot, "index.html")),
    },
  ],
  [
    "/support",
    {
      type: "text/html; charset=utf-8",
      body: readFileSync(resolve(webRoot, "support.html")),
    },
  ],
  [
    "/terms",
    {
      type: "text/html; charset=utf-8",
      body: readFileSync(resolve(webRoot, "terms.html")),
    },
  ],
  [
    "/privacy",
    {
      type: "text/html; charset=utf-8",
      body: readFileSync(resolve(webRoot, "privacy.html")),
    },
  ],
  [
    "/app.js",
    {
      type: "text/javascript; charset=utf-8",
      body: readFileSync(resolve(webRoot, "app.js")),
    },
  ],
  [
    "/styles.css",
    {
      type: "text/css; charset=utf-8",
      body: readFileSync(resolve(webRoot, "styles.css")),
    },
  ],
  [
    "/favicon.svg",
    {
      type: "image/svg+xml",
      body: readFileSync(resolve(webRoot, "favicon.svg")),
    },
  ],
  [
    "/assets/mintshield-icon.png",
    {
      type: "image/png",
      body: readFileSync(resolve(webRoot, "assets/mintshield-icon.png")),
    },
  ],
  [
    "/assets/mintshield-wordmark.png",
    {
      type: "image/png",
      body: readFileSync(resolve(webRoot, "assets/mintshield-wordmark.png")),
    },
  ],
  [
    "/assets/flag-gb.svg",
    {
      type: "image/svg+xml",
      body: readFileSync(resolve(webRoot, "assets/flag-gb.svg")),
    },
  ],
  [
    "/assets/flag-tr.svg",
    {
      type: "image/svg+xml",
      body: readFileSync(resolve(webRoot, "assets/flag-tr.svg")),
    },
  ],
]);
const host = process.env.STATUS_API_HOST ?? "127.0.0.1";
const port = Number(process.env.STATUS_API_PORT ?? "8787");
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("STATUS_API_PORT must be an integer in [1, 65535]");
}

async function createLivePlan(value: unknown) {
  const normalized = normalizeDepositPreviewInput(value);
  if (!isValidXrplClassicAddress(normalized.xrplAddress)) {
    throw new RangeError("xrplAddress must be a valid classic XRPL address");
  }
  const contracts = await resolveFlareContracts(publicClient);
  const [settings, personalAccount] = await Promise.all([
    readDirectMintingSettings(publicClient, contracts.assetManagerFXRP),
    getPersonalAccount(
      publicClient,
      contracts.masterAccountController,
      normalized.xrplAddress,
    ),
  ]);
  const smartAccountNonce = await getSmartAccountNonce(
    publicClient,
    contracts.masterAccountController,
    personalAccount,
  );
  return buildDepositPlan({
    normalized,
    deployment: previewDeployment,
    chain: { personalAccount, smartAccountNonce, settings },
    nowSeconds: BigInt(Math.floor(Date.now() / 1_000)),
  });
}

const server = createServer(async (request, response) => {
  if (request.url === undefined) {
    sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }
  const url = new URL(request.url, `http://${host}:${port}`);
  if (request.method === "POST" && url.pathname === "/api/preview") {
    try {
      const plan = await createLivePlan(await readJsonBody(request));
      sendJson(response, 200, { preview: plan.preview });
    } catch (cause) {
      if (
        cause instanceof RangeError ||
        cause instanceof SyntaxError ||
        cause instanceof TypeError
      ) {
        sendJson(response, 400, {
          error: "INVALID_PREVIEW_INPUT",
          message: cause.message,
        });
        return;
      }
      console.error("Preview failed", cause);
      sendJson(response, 503, {
        error: "PREVIEW_UNAVAILABLE",
        message: "Live Coston2 protocol data could not be read.",
      });
    }
    return;
  }
  if (
    request.method === "POST" &&
    url.pathname === "/api/xaman/sign-request"
  ) {
    if (xamanCredentials === undefined) {
      sendJson(response, 503, {
        error: "XAMAN_NOT_CONFIGURED",
        message: "Xaman backend credentials are not configured.",
      });
      return;
    }
    try {
      const plan = await createLivePlan(await readJsonBody(request));
      const intentKey =
        `${plan.execution.intent.personalAccount.toLowerCase()}:` +
        plan.execution.intent.nonce.toString();
      const existing = store.getByIntentKey(intentKey);
      if (existing !== undefined) {
        sendJson(response, 409, {
          error: "INTENT_ALREADY_ACTIVE",
          message:
            "This Personal Account nonce is already bound to an executor job.",
          job: toPublicJob(existing),
        });
        return;
      }
      const payload = buildXamanPaymentPayload({
        preview: plan.preview,
        identifier: randomUUID(),
      });
      const signRequest = await createXamanSignRequest({
        credentials: xamanCredentials,
        payload,
      });
      const created = createProtectedMintJob(store, {
        intentKey,
        userOpHash: plan.execution.userOpHash,
        userOpData: plan.execution.userOpData,
        memoData: plan.execution.memoData,
        router: previewDeployment.router,
        personalAccount: plan.execution.intent.personalAccount,
        nonce: plan.execution.intent.nonce,
        xrplSourceAccount: plan.preview.source.xrplAddress,
        coreVaultAddress: plan.preview.source.destination,
        paymentAmountDrops: BigInt(
          plan.preview.quote.paymentAmountDrops,
        ),
        callValue: plan.execution.totalCallValue,
      });
      const xamanExpiresAt = new Date(
        Date.now() + payload.options.expire * 60_000,
      ).toISOString();
      const job = store.transition(created.job.id, "CREATED", {
        metadata: {
          xamanPayloadUuid: signRequest.uuid,
          xamanExpiresAt,
        },
      });
      sendJson(response, 201, {
        preview: plan.preview,
        signRequest,
        job: toPublicJob(job),
      });
    } catch (cause) {
      if (
        cause instanceof RangeError ||
        cause instanceof SyntaxError ||
        cause instanceof TypeError
      ) {
        sendJson(response, 400, {
          error: "INVALID_SIGN_REQUEST_INPUT",
          message: cause.message,
        });
        return;
      }
      console.error("Xaman sign request failed", cause);
      sendJson(response, 502, {
        error: "XAMAN_SIGN_REQUEST_FAILED",
        message: "Xaman could not create the signing request.",
      });
    }
    return;
  }
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }
  const asset = staticAssets.get(url.pathname);
  if (asset !== undefined) {
    sendStatic(response, 200, asset.type, asset.body);
    return;
  }
  if (url.pathname === "/api/health") {
    sendJson(response, 200, {
      status: "ok",
      service: "mintshield-status-api",
      chainId: 114,
      xamanConfigured: xamanCredentials !== undefined,
      now: new Date().toISOString(),
    });
    return;
  }
  if (url.pathname === "/api/jobs") {
    const jobs = store.listAll();
    sendJson(response, 200, {
      summary: summarizeJobs(jobs),
      jobs: jobs.map(toPublicJob),
    });
    return;
  }
  if (url.pathname.startsWith("/api/xaman/sign-request/")) {
    if (xamanCredentials === undefined) {
      sendJson(response, 503, {
        error: "XAMAN_NOT_CONFIGURED",
        message: "Xaman backend credentials are not configured.",
      });
      return;
    }
    const uuid = decodeURIComponent(
      url.pathname.slice("/api/xaman/sign-request/".length),
    );
    try {
      let job = store.getByXamanPayloadUuid(uuid);
      if (job === undefined) {
        sendJson(response, 404, {
          error: "XAMAN_SIGN_REQUEST_NOT_FOUND",
        });
        return;
      }
      const raw = await getXamanSignRequest({
        credentials: xamanCredentials,
        uuid,
      });
      const signRequest = toPublicXamanStatus(raw);
      if (signRequest.resolved && signRequest.signed) {
        if (!Object.values(signRequest.checks).every(Boolean)) {
          sendJson(response, 409, {
            error: "XAMAN_SIGNING_VERIFICATION_FAILED",
            signRequest,
            job: toPublicJob(job),
          });
          return;
        }
        if (signRequest.txid === undefined) {
          throw new Error("Verified Xaman response is missing a transaction ID");
        }
        const xrplTxHash = normalizeXrplTransactionId(signRequest.txid);
        if (job.status === "CREATED") {
          job = store.transition(job.id, "XRPL_SIGNED", {
            xrplTxHash,
            metadata: {
              xamanResolvedAt: new Date().toISOString(),
            },
          });
        } else if (
          job.xrplTxHash !== undefined &&
          job.xrplTxHash.toLowerCase() !== xrplTxHash.toLowerCase()
        ) {
          throw new Error(
            "Executor job is already bound to a different XRPL transaction",
          );
        }
      }
      sendJson(response, 200, {
        signRequest,
        job: toPublicJob(job),
      });
    } catch (cause) {
      if (cause instanceof RangeError) {
        sendJson(response, 400, {
          error: "INVALID_XAMAN_PAYLOAD_ID",
          message: cause.message,
        });
        return;
      }
      console.error("Xaman status request failed", cause);
      sendJson(response, 502, {
        error: "XAMAN_STATUS_FAILED",
        message: "Xaman signing status could not be verified.",
      });
    }
    return;
  }
  if (url.pathname.startsWith("/api/jobs/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/jobs/".length));
    const job = store.get(id);
    if (job === undefined) {
      sendJson(response, 404, { error: "JOB_NOT_FOUND" });
      return;
    }
    sendJson(response, 200, { job: toPublicJob(job) });
    return;
  }
  sendJson(response, 404, { error: "NOT_FOUND" });
});

server.listen(port, host, () => {
  console.log(
    JSON.stringify({
      service: "mintshield-status-api",
      url: `http://${host}:${port}`,
      dashboard: `http://${host}:${port}/`,
      endpoints: [
        "/api/health",
        "/api/jobs",
        "/api/jobs/:id",
        "POST /api/preview",
        "POST /api/xaman/sign-request",
        "GET /api/xaman/sign-request/:uuid",
      ],
      xamanConfigured: xamanCredentials !== undefined,
      note: "Signed transaction blobs and secrets are redacted.",
    }),
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}
