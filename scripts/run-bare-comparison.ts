import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Client } from "xrpl";
import {
  getAddress,
  parseAbi,
  type Address,
} from "viem";
import { buildBareHashInstruction } from "../src/client/protected-deposit.js";
import {
  loadExecutorSecrets,
  loadPublicConfig,
  loadXrplSeed,
} from "../src/config/env.js";
import { MintShieldExecutorPipeline } from "../src/executor/pipeline.js";
import { ExecutorStateStore } from "../src/executor/state-store.js";
import { restoreWallet } from "../src/executor/xrpl.js";
import {
  createCoston2PublicClient,
  createCoston2WalletClient,
} from "../src/flare/clients.js";
import {
  getPersonalAccount,
  getSmartAccountNonce,
  readDirectMintingSettings,
  resolveFlareContracts,
} from "../src/flare/contracts.js";
import { quoteGrossDirectMint } from "../src/flare/preflight.js";

type Deployment = {
  chainId: number;
  contracts: {
    vault: { address: Address };
  };
};

type ComparisonInput = {
  inputAmountUBA: string;
  executorFeeUBA?: string;
  walletId?: number;
  flareGasLimit?: string;
};

function json(value: unknown) {
  return JSON.stringify(
    value,
    (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    2,
  );
}

const inputArgument = process.argv.indexOf("--input");
const inputPath =
  inputArgument === -1
    ? "bare-comparison-input.example.json"
    : process.argv[inputArgument + 1];
if (inputPath === undefined) throw new Error("--input requires a file path");
const input = JSON.parse(
  readFileSync(resolve(process.cwd(), inputPath), "utf8"),
) as Partial<ComparisonInput>;
if (
  typeof input.inputAmountUBA !== "string" ||
  !/^[1-9][0-9]*$/.test(input.inputAmountUBA)
) {
  throw new Error("inputAmountUBA must be a positive integer string");
}
const deployment = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "deployments/coston2.json"),
    "utf8",
  ),
) as Deployment;
const broadcast = process.argv.includes("--broadcast");
const publicConfig = loadPublicConfig();
const secrets = loadExecutorSecrets();
const xrplWallet = restoreWallet(loadXrplSeed());
const publicClient = createCoston2PublicClient(publicConfig.coston2RpcUrl);
const { account, client: walletClient } = createCoston2WalletClient(
  publicConfig.coston2RpcUrl,
  secrets.privateKey,
);
const contracts = await resolveFlareContracts(publicClient);
const vaultAbi = parseAbi([
  "function mode() view returns (uint8)",
]);
const [settings, personalAccount, vaultMode] = await Promise.all([
  readDirectMintingSettings(publicClient, contracts.assetManagerFXRP),
  getPersonalAccount(
    publicClient,
    contracts.masterAccountController,
    xrplWallet.address,
  ),
  publicClient.readContract({
    address: deployment.contracts.vault.address,
    abi: vaultAbi,
    functionName: "mode",
  }),
]);
const smartAccountNonce = await getSmartAccountNonce(
  publicClient,
  contracts.masterAccountController,
  personalAccount,
);
const inputAmountUBA = BigInt(input.inputAmountUBA);
const executorFeeUBA = BigInt(input.executorFeeUBA ?? "0");
const flareGasLimit = BigInt(input.flareGasLimit ?? "4000000");
const quote = quoteGrossDirectMint(
  inputAmountUBA,
  executorFeeUBA,
  settings,
);
const instruction = buildBareHashInstruction({
  vault: deployment.contracts.vault.address,
  personalAccount,
  asset: contracts.fxrp,
  amount: inputAmountUBA,
  smartAccountNonce,
  executorFeeUBA,
  walletId: input.walletId ?? 0,
});
const plan = {
  mode: broadcast ? "broadcast" : "dry-run",
  warning:
    "This comparison intentionally makes Coston2 finalization revert and requires official recovery.",
  xrplSource: xrplWallet.address,
  executor: account.address,
  vault: deployment.contracts.vault.address,
  vaultMode,
  requiredVaultMode: 1,
  smartAccountNonce,
  quote,
  userOpHash: instruction.userOpHash,
  flareGasLimit,
};
if (!broadcast) {
  console.log(json(plan));
  console.log(
    "\nDry-run only. Set REVERT_ALWAYS, review the plan, then add --broadcast.",
  );
  process.exit(0);
}
if (vaultMode !== 1) {
  throw new Error(
    `Bare comparison requires FailureVault REVERT_ALWAYS mode 1; observed ${vaultMode}`,
  );
}

const databasePath = resolve(
  process.cwd(),
  process.env.EXECUTOR_DB_PATH ?? "./data/mintshield.db",
);
mkdirSync(dirname(databasePath), { recursive: true });
const store = new ExecutorStateStore(databasePath);
const xrplClient = new Client(publicConfig.xrplTestnetRpcUrl);
try {
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
  const { job, created } = pipeline.createJob({
    intentKey: `${personalAccount.toLowerCase()}:${smartAccountNonce}`,
    userOpHash: instruction.userOpHash,
    userOpData: instruction.data,
    memoData: instruction.memoData,
    router: getAddress(deployment.contracts.vault.address),
    personalAccount,
    nonce: smartAccountNonce,
    xrplSourceAccount: xrplWallet.address,
    coreVaultAddress: settings.coreVaultXrplAddress,
    paymentAmountDrops: quote.paymentAmountUBA,
    callValue: instruction.totalCallValue,
    jobKind: "BARE_REVERT_COMPARISON",
    allowFlareRevert: true,
    flareGasLimit,
  });
  console.log(
    json({
      stage: "BARE_JOB_READY",
      ...plan,
      created,
      job,
    }),
  );
  const completed = await pipeline.run(job.id, { xrplWallet });
  console.log(json({ stage: "BARE_PIPELINE_STOPPED", job: completed }));
  if (completed.status !== "RECOVERY_REQUIRED") {
    throw new Error(
      `Expected RECOVERY_REQUIRED, observed ${completed.status}`,
    );
  }
} finally {
  store.close();
  if (xrplClient.isConnected()) await xrplClient.disconnect();
}
