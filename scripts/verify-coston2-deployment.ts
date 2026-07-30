import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getAddress,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { loadPublicConfig } from "../src/config/env.js";
import { createCoston2PublicClient } from "../src/flare/clients.js";

type DeploymentContract = {
  address: Address;
  deploymentTxHash: Hex;
};

type Deployment = {
  chainId: number;
  deployer: Address;
  fxrp: Address;
  adapterId: Hex;
  maxAmountUBA: string;
  gasPolicy: {
    minimumExecutionGas: string;
    adapterGasLimit: string;
  };
  contracts: {
    registry: DeploymentContract;
    vault: DeploymentContract;
    router: DeploymentContract;
    adapter: DeploymentContract & { runtimeCodeHash: Hex };
  };
  configuration: {
    adapterVersion: number;
  };
};

const deployment = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "deployments/coston2.json"),
    "utf8",
  ),
) as Deployment;
const client = createCoston2PublicClient(loadPublicConfig().coston2RpcUrl);
const chainId = await client.getChainId();

const routerAbi = parseAbi([
  "function owner() view returns (address)",
  "function registry() view returns (address)",
  "function protectedAsset() view returns (address)",
  "function MIN_EXECUTION_GAS() view returns (uint256)",
  "function ADAPTER_GAS_LIMIT() view returns (uint256)",
]);
const adapterAbi = parseAbi([
  "function router() view returns (address)",
  "function asset() view returns (address)",
  "function vault() view returns (address)",
  "function targetCodeHash() view returns (bytes32)",
]);
const vaultAbi = parseAbi([
  "function asset() view returns (address)",
]);
const registryAbi = parseAbi([
  "function owner() view returns (address)",
  "function getAdapter(bytes32 adapterId) view returns ((address implementation,address asset,bytes32 codeHash,uint256 maxAmount,uint64 version,bool enabled))",
]);

const addresses = Object.values(deployment.contracts).map(
  (contract) => getAddress(contract.address),
);
const codes = await Promise.all(
  addresses.map((address) => client.getCode({ address })),
);
const [
  routerOwner,
  routerRegistry,
  routerAsset,
  minimumExecutionGas,
  adapterGasLimit,
  adapterRouter,
  adapterAsset,
  adapterVault,
  targetCodeHash,
  vaultAsset,
  registryOwner,
  registryAdapter,
] = await Promise.all([
  client.readContract({
    address: deployment.contracts.router.address,
    abi: routerAbi,
    functionName: "owner",
  }),
  client.readContract({
    address: deployment.contracts.router.address,
    abi: routerAbi,
    functionName: "registry",
  }),
  client.readContract({
    address: deployment.contracts.router.address,
    abi: routerAbi,
    functionName: "protectedAsset",
  }),
  client.readContract({
    address: deployment.contracts.router.address,
    abi: routerAbi,
    functionName: "MIN_EXECUTION_GAS",
  }),
  client.readContract({
    address: deployment.contracts.router.address,
    abi: routerAbi,
    functionName: "ADAPTER_GAS_LIMIT",
  }),
  client.readContract({
    address: deployment.contracts.adapter.address,
    abi: adapterAbi,
    functionName: "router",
  }),
  client.readContract({
    address: deployment.contracts.adapter.address,
    abi: adapterAbi,
    functionName: "asset",
  }),
  client.readContract({
    address: deployment.contracts.adapter.address,
    abi: adapterAbi,
    functionName: "vault",
  }),
  client.readContract({
    address: deployment.contracts.adapter.address,
    abi: adapterAbi,
    functionName: "targetCodeHash",
  }),
  client.readContract({
    address: deployment.contracts.vault.address,
    abi: vaultAbi,
    functionName: "asset",
  }),
  client.readContract({
    address: deployment.contracts.registry.address,
    abi: registryAbi,
    functionName: "owner",
  }),
  client.readContract({
    address: deployment.contracts.registry.address,
    abi: registryAbi,
    functionName: "getAdapter",
    args: [deployment.adapterId],
  }),
]);

const vaultCode = codes[1];
const checks = {
  chainId: chainId === deployment.chainId,
  allContractsDeployed: codes.every((code) => code !== undefined),
  routerOwner:
    getAddress(routerOwner) === getAddress(deployment.deployer),
  registryOwner:
    getAddress(registryOwner) === getAddress(deployment.deployer),
  routerRegistry:
    getAddress(routerRegistry) ===
    getAddress(deployment.contracts.registry.address),
  routerAsset: getAddress(routerAsset) === getAddress(deployment.fxrp),
  minimumExecutionGas:
    minimumExecutionGas ===
    BigInt(deployment.gasPolicy.minimumExecutionGas),
  adapterGasLimit:
    adapterGasLimit === BigInt(deployment.gasPolicy.adapterGasLimit),
  adapterRouter:
    getAddress(adapterRouter) === getAddress(deployment.contracts.router.address),
  adapterAsset: getAddress(adapterAsset) === getAddress(deployment.fxrp),
  adapterVault:
    getAddress(adapterVault) === getAddress(deployment.contracts.vault.address),
  vaultAsset: getAddress(vaultAsset) === getAddress(deployment.fxrp),
  targetCodeHash:
    vaultCode !== undefined && targetCodeHash === keccak256(vaultCode),
  registryImplementation:
    getAddress(registryAdapter.implementation) ===
    getAddress(deployment.contracts.adapter.address),
  registryAsset:
    getAddress(registryAdapter.asset) === getAddress(deployment.fxrp),
  registryCodeHash:
    registryAdapter.codeHash === deployment.contracts.adapter.runtimeCodeHash,
  registryMaxAmount:
    registryAdapter.maxAmount === BigInt(deployment.maxAmountUBA),
  registryVersion:
    registryAdapter.version === BigInt(deployment.configuration.adapterVersion),
  registryEnabled: registryAdapter.enabled,
};
const failed = Object.entries(checks)
  .filter(([, result]) => !result)
  .map(([name]) => name);

console.log(
  JSON.stringify(
    {
      observedAt: new Date().toISOString(),
      chainId,
      checks,
      passed: failed.length === 0,
      failed,
    },
    null,
    2,
  ),
);
if (failed.length > 0) process.exitCode = 1;
