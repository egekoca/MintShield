import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Client } from "xrpl";
import { loadExecutorSecrets, loadPublicConfig } from "../src/config/env.js";
import { MintShieldExecutorPipeline } from "../src/executor/pipeline.js";
import {
  ExecutorStateStore,
  type JobStatus,
} from "../src/executor/state-store.js";
import {
  createCoston2PublicClient,
  createCoston2WalletClient,
} from "../src/flare/clients.js";
import { resolveFlareContracts } from "../src/flare/contracts.js";

const RUNNABLE_STATUSES = new Set<JobStatus>([
  "XRPL_SIGNED",
  "XRPL_FINALIZED",
  "FDC_REQUESTED",
  "PROOF_READY",
  "SIMULATION_PASSED",
  "FLARE_SUBMITTED",
  "DELAYED",
]);

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolveSleep, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolveSleep, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function log(value: Record<string, unknown>) {
  console.log(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  );
}

const once = process.argv.includes("--once");
const pollIntervalMs = Number(
  process.env.EXECUTOR_WORKER_POLL_INTERVAL_MS ?? "5000",
);
if (
  !Number.isSafeInteger(pollIntervalMs) ||
  pollIntervalMs < 1_000 ||
  pollIntervalMs > 60_000
) {
  throw new Error(
    "EXECUTOR_WORKER_POLL_INTERVAL_MS must be an integer in [1000, 60000]",
  );
}

const publicConfig = loadPublicConfig();
const secrets = loadExecutorSecrets();
const publicClient = createCoston2PublicClient(publicConfig.coston2RpcUrl);
const { account, client: walletClient } = createCoston2WalletClient(
  publicConfig.coston2RpcUrl,
  secrets.privateKey,
);
const contracts = await resolveFlareContracts(publicClient);
const databasePath = resolve(
  process.cwd(),
  process.env.EXECUTOR_DB_PATH ?? "./data/mintshield.db",
);
mkdirSync(dirname(databasePath), { recursive: true });
const store = new ExecutorStateStore(databasePath);
const xrplClient = new Client(publicConfig.xrplTestnetRpcUrl);
const controller = new AbortController();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => controller.abort(new Error(signal)));
}

const pipeline = new MintShieldExecutorPipeline({
  store,
  publicClient,
  walletClient,
  account,
  contracts,
  verifierBaseUrl: publicConfig.verifierUrl,
  verifierApiKey: secrets.verifierApiKey,
  daLayerBaseUrl: publicConfig.daLayerUrl,
  xrplClient,
});

log({
  service: "mintshield-executor-worker",
  executor: account.address,
  chainId: 114,
  databasePath,
  pollIntervalMs,
  once,
});

try {
  while (!controller.signal.aborted) {
    const now = BigInt(Math.floor(Date.now() / 1_000));
    const jobs = store
      .listRunnable(now)
      .filter((job) => RUNNABLE_STATUSES.has(job.status));
    for (const job of jobs) {
      if (controller.signal.aborted) break;
      try {
        log({ event: "JOB_RESUME", jobId: job.id, status: job.status });
        const completed = await pipeline.run(job.id, {
          signal: controller.signal,
        });
        log({
          event: "JOB_CHECKPOINT",
          jobId: completed.id,
          status: completed.status,
        });
      } catch (error) {
        if (controller.signal.aborted) break;
        log({
          event: "JOB_ERROR",
          jobId: job.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (once) break;
    await sleep(pollIntervalMs, controller.signal);
  }
} catch (error) {
  if (!controller.signal.aborted) throw error;
} finally {
  store.close();
  if (xrplClient.isConnected()) await xrplClient.disconnect();
}
