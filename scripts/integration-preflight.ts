import { Client, Wallet } from "xrpl";
import {
  formatEther,
  getAddress,
  isAddress,
  type Address,
} from "viem";
import {
  loadCoston2PrivateKey,
  loadPublicConfig,
  loadXrplSeed,
} from "../src/config/env.js";
import { createCoston2PublicClient } from "../src/flare/clients.js";
import {
  getPersonalAccount,
  getSmartAccountNonce,
  readDirectMintingSettings,
  resolveFlareContracts,
} from "../src/flare/contracts.js";
import { quoteGrossDirectMint } from "../src/flare/preflight.js";
import { privateKeyToAccount } from "viem/accounts";

type EndpointCheck = {
  url: string;
  reachable: boolean;
  status?: number;
  error?: string;
};

async function checkEndpoint(url: string): Promise<EndpointCheck> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
    });
    return { url, reachable: response.ok, status: response.status };
  } catch (error) {
    return {
      url,
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function json(value: unknown) {
  return JSON.stringify(
    value,
    (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    2,
  );
}

const config = loadPublicConfig();
const privateKey = loadCoston2PrivateKey();
const executor = privateKeyToAccount(privateKey);
const configuredExecutor = process.env.COSTON2_EXECUTOR_ADDRESS;
if (
  configuredExecutor !== undefined &&
  configuredExecutor !== "" &&
  getAddress(configuredExecutor) !== executor.address
) {
  throw new Error(
    "COSTON2_EXECUTOR_ADDRESS does not match COSTON2_PRIVATE_KEY",
  );
}
const xrplWallet = Wallet.fromSeed(loadXrplSeed());
const publicClient = createCoston2PublicClient(config.coston2RpcUrl);
const xrplClient = new Client(config.xrplTestnetRpcUrl);

const [chainId, blockNumber, contracts, executorBalanceWei, endpoints] =
  await Promise.all([
    publicClient.getChainId(),
    publicClient.getBlockNumber(),
    resolveFlareContracts(publicClient),
    publicClient.getBalance({ address: executor.address }),
    Promise.all([
      checkEndpoint(
        `${config.verifierUrl.replace(/\/$/, "")}/verifier/xrp/api-doc`,
      ),
      checkEndpoint(`${config.daLayerUrl.replace(/\/$/, "")}/api-doc`),
    ]),
  ]);

const settings = await readDirectMintingSettings(
  publicClient,
  contracts.assetManagerFXRP,
);
const personalAccount = await getPersonalAccount(
  publicClient,
  contracts.masterAccountController,
  xrplWallet.address,
);
const [personalAccountNonce, personalAccountCode] = await Promise.all([
  getSmartAccountNonce(
    publicClient,
    contracts.masterAccountController,
    personalAccount,
  ),
  publicClient.getCode({ address: personalAccount }),
]);

await xrplClient.connect();
let xrplBalanceDrops: bigint;
try {
  const accountInfo = await xrplClient.request({
    command: "account_info",
    account: xrplWallet.address,
    ledger_index: "validated",
  });
  xrplBalanceDrops = BigInt(accountInfo.result.account_data.Balance);
} finally {
  await xrplClient.disconnect();
}

const desiredUBA = BigInt(process.env.DESIRED_FXRP_UBA ?? "1000000");
const memoExecutorFeeUBA = BigInt(
  process.env.MEMO_EXECUTOR_FEE_UBA ?? "0",
);
const quote = quoteGrossDirectMint(
  desiredUBA,
  memoExecutorFeeUBA,
  settings,
);
const verifierKeyConfigured =
  (process.env.VERIFIER_API_KEY_TESTNET ?? "") !== "";

const routerEnvironment = process.env.MINTSHIELD_ROUTER_ADDRESS;
let router:
  | {
      address: Address;
      deployed: boolean;
    }
  | undefined;
if (
  routerEnvironment !== undefined &&
  routerEnvironment !== "" &&
  isAddress(routerEnvironment)
) {
  const address = getAddress(routerEnvironment);
  router = {
    address,
    deployed: (await publicClient.getCode({ address })) !== undefined,
  };
}

const checks = {
  chainIsCoston2: chainId === 114,
  executorHasGas: executorBalanceWei > 0n,
  xrplCanCoverQuotedPayment:
    xrplBalanceDrops > quote.paymentAmountUBA + 1_000n,
  verifierKeyConfigured,
  verifierReachable: endpoints[0]?.reachable === true,
  daLayerReachable: endpoints[1]?.reachable === true,
  routerConfiguredAndDeployed: router?.deployed === true,
};
const blockers = Object.entries(checks)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);

console.log(
  json({
    observedAt: new Date().toISOString(),
    network: { chainId, blockNumber },
    executor: {
      address: executor.address,
      balanceWei: executorBalanceWei,
      balanceC2FLR: formatEther(executorBalanceWei),
    },
    xrpl: {
      address: xrplWallet.address,
      balanceDrops: xrplBalanceDrops,
      balanceXrp: Number(xrplBalanceDrops) / 1_000_000,
    },
    personalAccount: {
      address: personalAccount,
      nonce: personalAccountNonce,
      deployed: personalAccountCode !== undefined,
    },
    quote,
    router,
    endpoints,
    checks,
    readyForContractDeployment:
      checks.chainIsCoston2 && checks.executorHasGas,
    readyForLiveProtectedMint: blockers.length === 0,
    blockers,
    nextActions: [
      ...(checks.executorHasGas
        ? []
        : [
            `Request C2FLR for ${executor.address} at https://faucet.flare.network/coston2`,
          ]),
      ...(checks.routerConfiguredAndDeployed
        ? []
        : [
            "Deploy MintShield contracts, then set MINTSHIELD_ROUTER_ADDRESS in .env",
          ]),
    ],
  }),
);
