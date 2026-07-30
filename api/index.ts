import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isValidClassicAddress } from "xrpl";
import { getAddress, type Address, type Hex } from "viem";
import {
  buildDepositPlan,
  normalizeDepositPreviewInput,
  type PreviewDeployment,
} from "../src/api/deposit-preview.js";
import { loadPublicConfig } from "../src/config/env.js";
import { createCoston2PublicClient } from "../src/flare/clients.js";
import {
  getPersonalAccount,
  getSmartAccountNonce,
  readDirectMintingSettings,
  resolveFlareContracts,
} from "../src/flare/contracts.js";

type EvidenceJob = {
  id: string;
  status: string;
  [key: string]: unknown;
};

type EvidenceExport = {
  summary: Record<string, unknown>;
  jobs: EvidenceJob[];
};

const deploymentFile = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "deployments/coston2.json"),
    "utf8",
  ),
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

const evidence = JSON.parse(
  readFileSync(resolve(process.cwd(), "evidence/live-runs.json"), "utf8"),
) as EvidenceExport;

if (deploymentFile.chainId !== 114) {
  throw new Error("Public deployment manifest must target Coston2 chain 114");
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

const protectedSteps = [
  "CREATED",
  "XRPL_SIGNED",
  "XRPL_FINALIZED",
  "FDC_REQUESTED",
  "PROOF_READY",
  "FLARE_SUBMITTED",
] as const;

function timeline(status: string) {
  const currentIndex = protectedSteps.indexOf(
    status as (typeof protectedSteps)[number],
  );
  const steps: Array<{ status: string; state: string }> =
    protectedSteps.map((step, index) => ({
      status: step,
      state:
        currentIndex === -1 || index < currentIndex
          ? "completed"
          : index === currentIndex
            ? "current"
            : "pending",
    }));
  if (currentIndex === -1) {
    steps.push({
      status,
      state: ["SETTLED_SUCCESS", "SETTLED_FALLBACK", "RECOVERED"].includes(
        status,
      )
        ? "current"
        : "attention",
    });
  }
  return steps;
}

function publicEvidenceJob(job: EvidenceJob) {
  return {
    ...job,
    timeline: timeline(job.status),
  };
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function readJsonBody(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 16_384) {
    throw new RangeError("Request body exceeds 16 KiB");
  }
  const text = await request.text();
  if (text.length === 0) throw new SyntaxError("Request body is required");
  if (Buffer.byteLength(text, "utf8") > 16_384) {
    throw new RangeError("Request body exceeds 16 KiB");
  }
  return JSON.parse(text) as unknown;
}

async function createLivePlan(value: unknown) {
  const normalized = normalizeDepositPreviewInput(value);
  if (!isValidClassicAddress(normalized.xrplAddress)) {
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

export default {
  async fetch(request: Request) {
    const url = new URL(request.url);
    const path = (
      url.searchParams.get("path") ??
      url.pathname.replace(/^\/api\/?/, "")
    ).replace(/^\/+/, "");

    if (request.method === "GET" && path === "health") {
      return json({
        status: "ok",
        service: "mintshield-public-api",
        chainId: 114,
        xamanConfigured: false,
        deploymentMode: "public-evidence",
        now: new Date().toISOString(),
      });
    }

    if (request.method === "GET" && path === "jobs") {
      return json({
        summary: evidence.summary,
        jobs: evidence.jobs.map(publicEvidenceJob),
      });
    }

    if (request.method === "GET" && path.startsWith("jobs/")) {
      const id = decodeURIComponent(path.slice("jobs/".length));
      const job = evidence.jobs.find((candidate) => candidate.id === id);
      return job === undefined
        ? json({ error: "JOB_NOT_FOUND" }, 404)
        : json({ job: publicEvidenceJob(job) });
    }

    if (request.method === "POST" && path === "preview") {
      try {
        const plan = await createLivePlan(await readJsonBody(request));
        return json({ preview: plan.preview });
      } catch (cause) {
        if (
          cause instanceof RangeError ||
          cause instanceof SyntaxError ||
          cause instanceof TypeError
        ) {
          return json(
            {
              error: "INVALID_PREVIEW_INPUT",
              message: cause.message,
            },
            400,
          );
        }
        console.error("Public preview failed", cause);
        return json(
          {
            error: "PREVIEW_UNAVAILABLE",
            message: "Live Coston2 protocol data could not be read.",
          },
          503,
        );
      }
    }

    if (path.startsWith("xaman/")) {
      return json(
        {
          error: "DURABLE_EXECUTOR_REQUIRED",
          message:
            "Public signing remains disabled until durable job storage and the executor worker are deployed.",
        },
        503,
      );
    }

    return json({ error: "NOT_FOUND" }, 404);
  },
};
