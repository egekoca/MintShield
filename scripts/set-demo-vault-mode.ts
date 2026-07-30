import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getAddress,
  parseAbi,
  type Address,
} from "viem";
import {
  loadCoston2PrivateKey,
  loadPublicConfig,
} from "../src/config/env.js";
import {
  createCoston2PublicClient,
  createCoston2WalletClient,
} from "../src/flare/clients.js";
import { COSTON2_CHAIN_ID } from "../src/flare/contracts.js";

const MODES = {
  NONE: 0,
  REVERT_ALWAYS: 1,
  RETURN_ZERO_SHARES: 2,
  PARTIAL_OUTPUT: 3,
  PAUSED: 4,
  LARGE_REVERT: 5,
  MALFORMED_SUCCESS: 6,
  LARGE_SUCCESS: 7,
  GAS_BURN: 8,
} as const;

type ModeName = keyof typeof MODES;
type Deployment = {
  chainId: number;
  deployer: Address;
  contracts: {
    vault: { address: Address };
  };
};

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const requestedName = argument("--mode");
if (
  requestedName === undefined ||
  !Object.prototype.hasOwnProperty.call(MODES, requestedName)
) {
  throw new Error(
    `--mode must be one of: ${Object.keys(MODES).join(", ")}`,
  );
}
const modeName = requestedName as ModeName;
const requestedMode = MODES[modeName];
const broadcast = process.argv.includes("--broadcast");
const deployment = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "deployments/coston2.json"),
    "utf8",
  ),
) as Deployment;
const publicConfig = loadPublicConfig();
const publicClient = createCoston2PublicClient(publicConfig.coston2RpcUrl);
const vaultAbi = parseAbi([
  "function mode() view returns (uint8)",
  "function setMode(uint8 newMode)",
]);
const [chainId, code, currentMode] = await Promise.all([
  publicClient.getChainId(),
  publicClient.getCode({ address: deployment.contracts.vault.address }),
  publicClient.readContract({
    address: deployment.contracts.vault.address,
    abi: vaultAbi,
    functionName: "mode",
  }),
]);
if (
  chainId !== COSTON2_CHAIN_ID ||
  deployment.chainId !== COSTON2_CHAIN_ID
) {
  throw new Error(`Expected Coston2 chain ${COSTON2_CHAIN_ID}`);
}
if (code === undefined) throw new Error("FailureVault is not deployed");

const plan = {
  mode: broadcast ? "broadcast" : "dry-run",
  chainId,
  vault: deployment.contracts.vault.address,
  currentMode,
  requestedMode,
  requestedName: modeName,
};
if (!broadcast) {
  console.log(JSON.stringify(plan, null, 2));
  console.log(
    "\nDry-run only. Add --broadcast after reviewing the target and mode.",
  );
  process.exit(0);
}
if (currentMode === requestedMode) {
  console.log(
    JSON.stringify(
      {
        ...plan,
        changed: false,
        observedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const { account, client: walletClient } = createCoston2WalletClient(
  publicConfig.coston2RpcUrl,
  loadCoston2PrivateKey(),
);
if (getAddress(account.address) !== getAddress(deployment.deployer)) {
  throw new Error("Configured private key does not match manifest deployer");
}
const txHash = await walletClient.writeContract({
  account,
  chain: walletClient.chain,
  address: deployment.contracts.vault.address,
  abi: vaultAbi,
  functionName: "setMode",
  args: [requestedMode],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
if (receipt.status !== "success") {
  throw new Error(`FailureVault mode transaction failed: ${txHash}`);
}
const observedMode = await publicClient.readContract({
  address: deployment.contracts.vault.address,
  abi: vaultAbi,
  functionName: "mode",
});
if (observedMode !== requestedMode) {
  throw new Error(
    `Expected FailureVault mode ${requestedMode}, observed ${observedMode}`,
  );
}
console.log(
  JSON.stringify(
    {
      ...plan,
      changed: true,
      txHash,
      observedMode,
      blockNumber: receipt.blockNumber.toString(),
      observedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
