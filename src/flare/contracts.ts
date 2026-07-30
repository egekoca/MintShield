import {
  erc20Abi,
  getAddress,
  parseAbi,
  type Address,
  type PublicClient,
} from "viem";
import {
  assetManagerAbi,
  directMintingAbi,
  directMintingSettingsAbi,
  masterAccountControllerAbi,
} from "./abis.js";

export const COSTON2_CHAIN_ID = 114;
export const FLARE_CONTRACT_REGISTRY = getAddress(
  "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
);

const registryAbi = parseAbi([
  "function getContractAddressByName(string name) view returns (address)",
]);

export type FlareContractAddresses = {
  masterAccountController: Address;
  assetManagerFXRP: Address;
  fxrp: Address;
  fdcHub: Address;
  fdcVerification: Address;
  relay: Address;
  flareSystemsManager: Address;
};

export type DirectMintingSettings = {
  coreVaultXrplAddress: string;
  minimumFeeUBA: bigint;
  feeBIPS: bigint;
  defaultExecutorFeeUBA: bigint;
  hourlyLimitUBA: bigint;
  dailyLimitUBA: bigint;
  largeMintingThresholdUBA: bigint;
  largeMintingDelaySeconds: bigint;
};

async function addressByName(
  client: PublicClient,
  name: string,
): Promise<Address> {
  return client.readContract({
    address: FLARE_CONTRACT_REGISTRY,
    abi: registryAbi,
    functionName: "getContractAddressByName",
    args: [name],
  });
}

export async function resolveFlareContracts(
  client: PublicClient,
): Promise<FlareContractAddresses> {
  const [
    masterAccountController,
    assetManagerFXRP,
    fdcHub,
    fdcVerification,
    relay,
    flareSystemsManager,
  ] = await Promise.all([
    addressByName(client, "MasterAccountController"),
    addressByName(client, "AssetManagerFXRP"),
    addressByName(client, "FdcHub"),
    addressByName(client, "FdcVerification"),
    addressByName(client, "Relay"),
    addressByName(client, "FlareSystemsManager"),
  ]);
  const fxrp = await client.readContract({
    address: assetManagerFXRP,
    abi: assetManagerAbi,
    functionName: "fAsset",
  });

  return {
    masterAccountController,
    assetManagerFXRP,
    fxrp,
    fdcHub,
    fdcVerification,
    relay,
    flareSystemsManager,
  };
}

export async function readDirectMintingSettings(
  client: PublicClient,
  assetManagerFXRP: Address,
): Promise<DirectMintingSettings> {
  const [
    coreVaultXrplAddress,
    minimumFeeUBA,
    feeBIPS,
    defaultExecutorFeeUBA,
    hourlyLimitUBA,
    dailyLimitUBA,
    largeMintingThresholdUBA,
    largeMintingDelaySeconds,
  ] = await Promise.all([
    client.readContract({
      address: assetManagerFXRP,
      abi: directMintingAbi,
      functionName: "directMintingPaymentAddress",
    }),
    client.readContract({
      address: assetManagerFXRP,
      abi: directMintingSettingsAbi,
      functionName: "getDirectMintingMinimumFeeUBA",
    }),
    client.readContract({
      address: assetManagerFXRP,
      abi: directMintingSettingsAbi,
      functionName: "getDirectMintingFeeBIPS",
    }),
    client.readContract({
      address: assetManagerFXRP,
      abi: directMintingSettingsAbi,
      functionName: "getDirectMintingExecutorFeeUBA",
    }),
    client.readContract({
      address: assetManagerFXRP,
      abi: directMintingSettingsAbi,
      functionName: "getDirectMintingHourlyLimitUBA",
    }),
    client.readContract({
      address: assetManagerFXRP,
      abi: directMintingSettingsAbi,
      functionName: "getDirectMintingDailyLimitUBA",
    }),
    client.readContract({
      address: assetManagerFXRP,
      abi: directMintingSettingsAbi,
      functionName: "getDirectMintingLargeMintingThresholdUBA",
    }),
    client.readContract({
      address: assetManagerFXRP,
      abi: directMintingSettingsAbi,
      functionName: "getDirectMintingLargeMintingDelaySeconds",
    }),
  ]);

  return {
    coreVaultXrplAddress,
    minimumFeeUBA,
    feeBIPS,
    defaultExecutorFeeUBA,
    hourlyLimitUBA,
    dailyLimitUBA,
    largeMintingThresholdUBA,
    largeMintingDelaySeconds,
  };
}

export async function getPersonalAccount(
  client: PublicClient,
  masterAccountController: Address,
  xrplAddress: string,
) {
  return client.readContract({
    address: masterAccountController,
    abi: masterAccountControllerAbi,
    functionName: "getPersonalAccount",
    args: [xrplAddress],
  });
}

export async function getSmartAccountNonce(
  client: PublicClient,
  masterAccountController: Address,
  personalAccount: Address,
) {
  return client.readContract({
    address: masterAccountController,
    abi: masterAccountControllerAbi,
    functionName: "getNonce",
    args: [personalAccount],
  });
}

export async function getFxrpMetadata(
  client: PublicClient,
  fxrp: Address,
) {
  const [name, symbol, decimals] = await Promise.all([
    client.readContract({
      address: fxrp,
      abi: erc20Abi,
      functionName: "name",
    }),
    client.readContract({
      address: fxrp,
      abi: erc20Abi,
      functionName: "symbol",
    }),
    client.readContract({
      address: fxrp,
      abi: erc20Abi,
      functionName: "decimals",
    }),
  ]);
  return { name, symbol, decimals };
}
