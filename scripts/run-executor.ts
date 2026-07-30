import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Client } from "xrpl";
import {
  getAddress,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { buildHashInstruction } from "../src/client/protected-deposit.js";
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

type ExecutorInput = {
  router: Address;
  adapterId: Hex;
  inputAmountUBA: string;
  minOutput: string;
  adapterData?: Hex;
  intentNonce?: string;
  deadline?: string;
  executorFeeUBA?: string;
  walletId?: number;
};

function readInput(): ExecutorInput {
  const argumentIndex = process.argv.indexOf("--input");
  const path =
    argumentIndex === -1
      ? "executor-input.json"
      : process.argv[argumentIndex + 1];
  if (path === undefined) throw new Error("--input requires a file path");
  const parsed: unknown = JSON.parse(
    readFileSync(resolve(process.cwd(), path), "utf8"),
  );
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("Executor input must be a JSON object");
  }
  const input = parsed as Partial<ExecutorInput>;
  if (
    typeof input.router !== "string" ||
    typeof input.adapterId !== "string" ||
    typeof input.inputAmountUBA !== "string" ||
    typeof input.minOutput !== "string"
  ) {
    throw new Error(
      "Input requires router, adapterId, inputAmountUBA and minOutput",
    );
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.adapterId)) {
    throw new Error("adapterId must be a 32-byte hex value");
  }
  return input as ExecutorInput;
}

function json(value: unknown) {
  return JSON.stringify(
    value,
    (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    2,
  );
}

const input = readInput();
const publicConfig = loadPublicConfig();
const secrets = loadExecutorSecrets();
const xrplWallet = restoreWallet(loadXrplSeed());
const publicClient = createCoston2PublicClient(publicConfig.coston2RpcUrl);
const { account, client: walletClient } = createCoston2WalletClient(
  publicConfig.coston2RpcUrl,
  secrets.privateKey,
);
const contracts = await resolveFlareContracts(publicClient);
const [settings, personalAccount] = await Promise.all([
  readDirectMintingSettings(publicClient, contracts.assetManagerFXRP),
  getPersonalAccount(
    publicClient,
    contracts.masterAccountController,
    xrplWallet.address,
  ),
]);
const smartAccountNonce = await getSmartAccountNonce(
  publicClient,
  contracts.masterAccountController,
  personalAccount,
);
const inputAmountUBA = BigInt(input.inputAmountUBA);
const executorFeeUBA = BigInt(input.executorFeeUBA ?? "0");
const quote = quoteGrossDirectMint(
  inputAmountUBA,
  executorFeeUBA,
  settings,
);
const intent = {
  personalAccount,
  asset: contracts.fxrp,
  inputAmount: inputAmountUBA,
  adapterId: input.adapterId,
  adapterData: input.adapterData ?? ("0x" as Hex),
  minOutput: BigInt(input.minOutput),
  deadline: BigInt(
    input.deadline ?? Math.floor(Date.now() / 1_000 + 2 * 60 * 60).toString(),
  ),
  nonce: BigInt(input.intentNonce ?? smartAccountNonce.toString()),
};
const instruction = buildHashInstruction(
  getAddress(input.router),
  intent,
  smartAccountNonce,
  executorFeeUBA,
  input.walletId ?? 0,
);

const routerReadAbi = parseAbi([
  "function hashIntent((address personalAccount,address asset,uint256 inputAmount,bytes32 adapterId,bytes adapterData,uint256 minOutput,uint64 deadline,uint256 nonce) intent) view returns (bytes32 intentId)",
]);
const expectedIntentId = await publicClient.readContract({
  address: getAddress(input.router),
  abi: routerReadAbi,
  functionName: "hashIntent",
  args: [intent],
});

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
    router: getAddress(input.router),
    personalAccount,
    nonce: smartAccountNonce,
    coreVaultAddress: settings.coreVaultXrplAddress,
    paymentAmountDrops: quote.paymentAmountUBA,
    callValue: instruction.totalCallValue,
    expectedIntentId,
  });
  console.log(
    json({
      stage: "JOB_READY",
      created,
      job,
      xrplSource: xrplWallet.address,
      executor: account.address,
      intent,
      quote,
    }),
  );
  const completed = await pipeline.run(job.id, { xrplWallet });
  console.log(json({ stage: "PIPELINE_STOPPED", job: completed }));
} finally {
  store.close();
  if (xrplClient.isConnected()) await xrplClient.disconnect();
}
