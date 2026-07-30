import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getAddress,
  keccak256,
  parseAbi,
  toHex,
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

const artifacts = {
  registry: artifact("AdapterRegistry.sol", "AdapterRegistry"),
  router: artifact("MintShieldRouter.sol", "MintShieldRouter"),
  vault: artifact("mocks/FailureVault.sol", "FailureVault"),
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
if (chainId !== COSTON2_CHAIN_ID) {
  throw new Error(`Expected chain ${COSTON2_CHAIN_ID}, got ${chainId}`);
}

const adapterId = keccak256(toHex("MINTSHIELD_DEMO_ERC4626"));
const maxAmountUBA = BigInt(
  process.env.MINTSHIELD_ADAPTER_MAX_UBA ?? "100000000",
);
if (maxAmountUBA <= 0n) {
  throw new RangeError("MINTSHIELD_ADAPTER_MAX_UBA must be positive");
}

const plan = {
  mode: process.argv.includes("--broadcast") ? "broadcast" : "dry-run",
  chainId,
  rpcUrl: publicConfig.coston2RpcUrl,
  fxrp: flare.fxrp,
  adapterId,
  maxAmountUBA,
  contracts: Object.fromEntries(
    Object.entries(artifacts).map(([name, value]) => [
      name,
      { creationBytecodeHash: keccak256(value.bytecode) },
    ]),
  ),
  warning:
    "FailureVault is an intentionally mutable demo target, not a production yield vault.",
};

if (!process.argv.includes("--broadcast")) {
  console.log(json(plan));
  console.log(
    "\nDry-run only. Re-run with --broadcast after funding the Coston2 deployer.",
  );
  process.exit(0);
}

const privateKey = loadCoston2PrivateKey();
const { account, client: walletClient } = createCoston2WalletClient(
  publicConfig.coston2RpcUrl,
  privateKey,
);
const balance = await publicClient.getBalance({ address: account.address });
if (balance === 0n) {
  throw new Error(`Coston2 deployer ${account.address} has no native balance`);
}

async function deploy(
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

const registry = await deploy("AdapterRegistry", artifacts.registry, [
  account.address,
]);
const vault = await deploy("FailureVault", artifacts.vault, [flare.fxrp]);
const router = await deploy("MintShieldRouter", artifacts.router, [
  account.address,
  registry.address,
  flare.fxrp,
]);
const adapter = await deploy("ERC4626DepositAdapter", artifacts.adapter, [
  router.address,
  flare.fxrp,
  vault.address,
]);

const registryAdminAbi = parseAbi([
  "function configureAdapter(bytes32 adapterId,address implementation,address asset,uint256 maxAmount,bool enabled)",
  "function getAdapter(bytes32 adapterId) view returns ((address implementation,address asset,bytes32 codeHash,uint256 maxAmount,uint64 version,bool enabled))",
]);
const configureHash = await walletClient.writeContract({
  account,
  chain: walletClient.chain,
  address: registry.address,
  abi: registryAdminAbi,
  functionName: "configureAdapter",
  args: [adapterId, adapter.address, flare.fxrp, maxAmountUBA, true],
});
const configureReceipt = await publicClient.waitForTransactionReceipt({
  hash: configureHash,
});
if (configureReceipt.status !== "success") {
  throw new Error(`Adapter configuration failed: ${configureHash}`);
}
const configuredAdapter = await publicClient.readContract({
  address: registry.address,
  abi: registryAdminAbi,
  functionName: "getAdapter",
  args: [adapterId],
});

console.log(
  json({
    ...plan,
    observedAt: new Date().toISOString(),
    deployer: account.address,
    deployerBalanceBeforeWei: balance,
    deployments: { registry, vault, router, adapter },
    configuration: {
      txHash: configureHash,
      adapter: configuredAdapter,
    },
  }),
);
