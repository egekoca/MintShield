import {
  formatUnits,
  type Address,
} from "viem";
import { loadPublicConfig } from "../src/config/env.js";
import { createCoston2PublicClient } from "../src/flare/clients.js";
import {
  COSTON2_CHAIN_ID,
  FLARE_CONTRACT_REGISTRY,
  getFxrpMetadata,
  getPersonalAccount,
  getSmartAccountNonce,
  readDirectMintingSettings,
  resolveFlareContracts,
} from "../src/flare/contracts.js";
import { quoteGrossDirectMint } from "../src/flare/preflight.js";

function json(value: unknown) {
  return JSON.stringify(
    value,
    (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    2,
  );
}

const config = loadPublicConfig();
const client = createCoston2PublicClient(config.coston2RpcUrl);
const [chainId, blockNumber, contracts] = await Promise.all([
  client.getChainId(),
  client.getBlockNumber(),
  resolveFlareContracts(client),
]);
if (chainId !== COSTON2_CHAIN_ID) {
  throw new Error(`Expected Coston2 chain ${COSTON2_CHAIN_ID}, got ${chainId}`);
}

const [settings, fxrp, codes] = await Promise.all([
  readDirectMintingSettings(client, contracts.assetManagerFXRP),
  getFxrpMetadata(client, contracts.fxrp),
  Promise.all(
    Object.entries(contracts).map(async ([name, address]) => ({
      name,
      address,
      deployed: (await client.getCode({ address })) !== undefined,
    })),
  ),
]);

const xrplAddress = process.env.XRPL_ADDRESS;
let personalAccount:
  | {
      xrplAddress: string;
      address: Address;
      nonce: bigint;
      deployed: boolean;
      nativeBalanceWei: bigint;
    }
  | undefined;
if (xrplAddress !== undefined && xrplAddress !== "") {
  const address = await getPersonalAccount(
    client,
    contracts.masterAccountController,
    xrplAddress,
  );
  const [nonce, code, nativeBalanceWei] = await Promise.all([
    getSmartAccountNonce(
      client,
      contracts.masterAccountController,
      address,
    ),
    client.getCode({ address }),
    client.getBalance({ address }),
  ]);
  personalAccount = {
    xrplAddress,
    address,
    nonce,
    deployed: code !== undefined,
    nativeBalanceWei,
  };
}

const desiredUBA = process.env.DESIRED_FXRP_UBA;
const executorFeeUBA = BigInt(process.env.MEMO_EXECUTOR_FEE_UBA ?? "0");
const quote =
  desiredUBA === undefined || desiredUBA === ""
    ? undefined
    : quoteGrossDirectMint(BigInt(desiredUBA), executorFeeUBA, settings);

console.log(
  json({
    observedAt: new Date().toISOString(),
    chainId,
    blockNumber,
    registry: FLARE_CONTRACT_REGISTRY,
    contracts,
    codeChecks: codes,
    fxrp: {
      ...fxrp,
      unitExample: `1 ${fxrp.symbol} = ${formatUnits(10n ** BigInt(fxrp.decimals), fxrp.decimals)} token`,
    },
    directMinting: settings,
    personalAccount,
    quote,
  }),
);
