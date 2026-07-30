import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getAddress,
  keccak256,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import {
  loadCoston2PrivateKey,
  loadPublicConfig,
} from "../src/config/env.js";
import {
  createCoston2PublicClient,
  createCoston2WalletClient,
} from "../src/flare/clients.js";
import {
  COSTON2_CHAIN_ID,
  resolveFlareContracts,
} from "../src/flare/contracts.js";

type Artifact = {
  abi: Abi;
  bytecode: Hex;
};

type Deployment = {
  chainId: number;
  deployer: Address;
  fxrp: Address;
  adapterId: Hex;
  maxAmountUBA: string;
  contracts: {
    registry: { address: Address };
    vault: { address: Address };
  };
};

function artifact(contractPath: string, name: string): Artifact {
  const path = resolve(
    process.cwd(),
    "artifacts",
    "contracts",
    contractPath,
    `${name}.json`,
  );
  const value = JSON.parse(readFileSync(path, "utf8")) as Partial<Artifact>;
  if (
    value.abi === undefined ||
    value.bytecode === undefined ||
    !value.bytecode.startsWith("0x")
  ) {
    throw new Error(`Invalid or missing build artifact: ${path}`);
  }
  return { abi: value.abi, bytecode: value.bytecode };
}

function json(value: unknown) {
  return JSON.stringify(
    value,
    (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    2,
  );
}

const deployment = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "deployments/coston2.json"),
    "utf8",
  ),
) as Deployment;
const builds = {
  router: artifact("MintShieldRouter.sol", "MintShieldRouter"),
  adapter: artifact(
    "adapters/ERC4626DepositAdapter.sol",
    "ERC4626DepositAdapter",
  ),
};
const publicConfig = loadPublicConfig();
const publicClient = createCoston2PublicClient(publicConfig.coston2RpcUrl);
const [chainId, flare] = await Promise.all([
  publicClient.getChainId(),
  resolveFlareContracts(publicClient),
]);
if (
  chainId !== COSTON2_CHAIN_ID ||
  deployment.chainId !== COSTON2_CHAIN_ID
) {
  throw new Error(`Expected Coston2 chain ${COSTON2_CHAIN_ID}`);
}
if (getAddress(flare.fxrp) !== getAddress(deployment.fxrp)) {
  throw new Error("Manifest FXRP no longer matches the Flare registry");
}

const routerReadAbi = parseAbi([
  "function MIN_EXECUTION_GAS() view returns (uint256)",
  "function ADAPTER_GAS_LIMIT() view returns (uint256)",
]);
const registryAbi = parseAbi([
  "function owner() view returns (address)",
  "function configureAdapter(bytes32 adapterId,address implementation,address asset,uint256 maxAmount,bool enabled)",
  "function getAdapter(bytes32 adapterId) view returns ((address implementation,address asset,bytes32 codeHash,uint256 maxAmount,uint64 version,bool enabled))",
]);
const registryOwner = await publicClient.readContract({
  address: deployment.contracts.registry.address,
  abi: registryAbi,
  functionName: "owner",
});
if (getAddress(registryOwner) !== getAddress(deployment.deployer)) {
  throw new Error("Manifest deployer is not the current registry owner");
}

const broadcast = process.argv.includes("--broadcast");
const plan = {
  mode: broadcast ? "broadcast" : "dry-run",
  chainId,
  deployer: deployment.deployer,
  registry: deployment.contracts.registry.address,
  vault: deployment.contracts.vault.address,
  fxrp: deployment.fxrp,
  adapterId: deployment.adapterId,
  maxAmountUBA: deployment.maxAmountUBA,
  expectedAdapterVersion: 2,
  contracts: {
    router: { creationBytecodeHash: keccak256(builds.router.bytecode) },
    adapter: { creationBytecodeHash: keccak256(builds.adapter.bytecode) },
  },
};
if (!broadcast) {
  console.log(json(plan));
  console.log(
    "\nDry-run only. Re-run with --broadcast after reviewing the migration.",
  );
  process.exit(0);
}

const privateKey = loadCoston2PrivateKey();
const { account, client: walletClient } = createCoston2WalletClient(
  publicConfig.coston2RpcUrl,
  privateKey,
);
if (getAddress(account.address) !== getAddress(deployment.deployer)) {
  throw new Error("Configured private key does not control the registry owner");
}

async function deployContract(
  name: string,
  build: Artifact,
  args: readonly unknown[],
): Promise<{ address: Address; txHash: Hex }> {
  const txHash = await walletClient.deployContract({
    account,
    chain: walletClient.chain,
    abi: build.abi,
    bytecode: build.bytecode,
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success" || receipt.contractAddress == null) {
    throw new Error(`${name} deployment failed: ${txHash}`);
  }
  return { address: getAddress(receipt.contractAddress), txHash };
}

const router = await deployContract("MintShieldRouter", builds.router, [
  account.address,
  deployment.contracts.registry.address,
  deployment.fxrp,
]);
const adapter = await deployContract(
  "ERC4626DepositAdapter",
  builds.adapter,
  [router.address, deployment.fxrp, deployment.contracts.vault.address],
);
const configureTxHash = await walletClient.writeContract({
  account,
  chain: walletClient.chain,
  address: deployment.contracts.registry.address,
  abi: registryAbi,
  functionName: "configureAdapter",
  args: [
    deployment.adapterId,
    adapter.address,
    deployment.fxrp,
    BigInt(deployment.maxAmountUBA),
    true,
  ],
});
const configureReceipt = await publicClient.waitForTransactionReceipt({
  hash: configureTxHash,
});
if (configureReceipt.status !== "success") {
  throw new Error(`Adapter configuration failed: ${configureTxHash}`);
}

const [routerCode, adapterCode, minimumExecutionGas, adapterGasLimit, config] =
  await Promise.all([
    publicClient.getCode({ address: router.address }),
    publicClient.getCode({ address: adapter.address }),
    publicClient.readContract({
      address: router.address,
      abi: routerReadAbi,
      functionName: "MIN_EXECUTION_GAS",
    }),
    publicClient.readContract({
      address: router.address,
      abi: routerReadAbi,
      functionName: "ADAPTER_GAS_LIMIT",
    }),
    publicClient.readContract({
      address: deployment.contracts.registry.address,
      abi: registryAbi,
      functionName: "getAdapter",
      args: [deployment.adapterId],
    }),
  ]);
if (routerCode === undefined || adapterCode === undefined) {
  throw new Error("Deployed runtime bytecode could not be read");
}
if (
  minimumExecutionGas !== 900_000n ||
  adapterGasLimit !== 500_000n ||
  config.version !== 2n ||
  getAddress(config.implementation) !== adapter.address
) {
  throw new Error("Post-migration verification failed");
}

console.log(
  json({
    ...plan,
    observedAt: new Date().toISOString(),
    deployments: {
      router: {
        ...router,
        runtimeCodeHash: keccak256(routerCode),
      },
      adapter: {
        ...adapter,
        runtimeCodeHash: keccak256(adapterCode),
      },
    },
    configuration: {
      txHash: configureTxHash,
      adapter: config,
    },
    gasPolicy: { minimumExecutionGas, adapterGasLimit },
  }),
);
