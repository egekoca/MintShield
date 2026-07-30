import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getAddress,
  parseAbi,
  type Address,
} from "viem";
import {
  loadPublicConfig,
  loadXrplSeed,
} from "../src/config/env.js";
import { restoreWallet } from "../src/executor/xrpl.js";
import { createCoston2PublicClient } from "../src/flare/clients.js";
import {
  getPersonalAccount,
  getSmartAccountNonce,
  resolveFlareContracts,
} from "../src/flare/contracts.js";

type Deployment = {
  chainId: number;
  fxrp: Address;
  contracts: {
    router: { address: Address };
    adapter: { address: Address };
    vault: { address: Address };
  };
};

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
const publicClient = createCoston2PublicClient(
  loadPublicConfig().coston2RpcUrl,
);
const flare = await resolveFlareContracts(publicClient);
const wallet = restoreWallet(loadXrplSeed());
const personalAccount = await getPersonalAccount(
  publicClient,
  flare.masterAccountController,
  wallet.address,
);
const tokenAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);
const vaultAbi = parseAbi([
  "function mode() view returns (uint8)",
]);
const [
  chainId,
  nonce,
  personalAccountFxrp,
  personalAccountShares,
  vaultFxrp,
  vaultShareSupply,
  routerFxrp,
  adapterFxrp,
  personalAccountRouterAllowance,
  routerAdapterAllowance,
  adapterVaultAllowance,
  vaultMode,
] = await Promise.all([
  publicClient.getChainId(),
  getSmartAccountNonce(
    publicClient,
    flare.masterAccountController,
    personalAccount,
  ),
  publicClient.readContract({
    address: deployment.fxrp,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [personalAccount],
  }),
  publicClient.readContract({
    address: deployment.contracts.vault.address,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [personalAccount],
  }),
  publicClient.readContract({
    address: deployment.fxrp,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [deployment.contracts.vault.address],
  }),
  publicClient.readContract({
    address: deployment.contracts.vault.address,
    abi: tokenAbi,
    functionName: "totalSupply",
  }),
  publicClient.readContract({
    address: deployment.fxrp,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [deployment.contracts.router.address],
  }),
  publicClient.readContract({
    address: deployment.fxrp,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [deployment.contracts.adapter.address],
  }),
  publicClient.readContract({
    address: deployment.fxrp,
    abi: tokenAbi,
    functionName: "allowance",
    args: [personalAccount, deployment.contracts.router.address],
  }),
  publicClient.readContract({
    address: deployment.fxrp,
    abi: tokenAbi,
    functionName: "allowance",
    args: [
      deployment.contracts.router.address,
      deployment.contracts.adapter.address,
    ],
  }),
  publicClient.readContract({
    address: deployment.fxrp,
    abi: tokenAbi,
    functionName: "allowance",
    args: [
      deployment.contracts.adapter.address,
      deployment.contracts.vault.address,
    ],
  }),
  publicClient.readContract({
    address: deployment.contracts.vault.address,
    abi: vaultAbi,
    functionName: "mode",
  }),
]);

const checks = {
  chainIsCoston2: chainId === deployment.chainId,
  smartAccountNonceAdvancedThreeTimes: nonce === 3n,
  protectedAndRecoveredFxrpMatches:
    personalAccountFxrp === 3_900_000n,
  successfulDepositMintedExactShares: personalAccountShares === 1_000_000n,
  vaultReceivedExactFxrp: vaultFxrp === 1_000_000n,
  shareSupplyMatchesDeposit: vaultShareSupply === 1_000_000n,
  routerHasNoResidualFxrp: routerFxrp === 0n,
  adapterHasNoResidualFxrp: adapterFxrp === 0n,
  personalAccountAllowanceConsumed: personalAccountRouterAllowance === 0n,
  routerAllowanceCleared: routerAdapterAllowance === 0n,
  adapterAllowanceCleared: adapterVaultAllowance === 0n,
  vaultWasInSuccessMode: vaultMode === 0,
};
const failed = Object.entries(checks)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);

console.log(
  json({
    observedAt: new Date().toISOString(),
    chainId,
    personalAccount: getAddress(personalAccount),
    nonce,
    contracts: deployment.contracts,
    balancesUBA: {
      personalAccountFxrp,
      personalAccountShares,
      vaultFxrp,
      vaultShareSupply,
      routerFxrp,
      adapterFxrp,
    },
    allowancesUBA: {
      personalAccountToRouter: personalAccountRouterAllowance,
      routerToAdapter: routerAdapterAllowance,
      adapterToVault: adapterVaultAllowance,
    },
    vaultMode,
    checks,
    passed: failed.length === 0,
    failed,
  }),
);
if (failed.length > 0) process.exitCode = 1;
