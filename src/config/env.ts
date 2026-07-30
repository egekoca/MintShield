import type { Hex } from "viem";

export type PublicConfig = {
  coston2RpcUrl: string;
  xrplTestnetRpcUrl: string;
  verifierUrl: string;
  daLayerUrl: string;
};

export type ExecutorSecrets = {
  privateKey: Hex;
  verifierApiKey: string;
};

export function loadCoston2PrivateKey(
  env: NodeJS.ProcessEnv = process.env,
): Hex {
  const privateKey = env.COSTON2_PRIVATE_KEY;
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error(
      "COSTON2_PRIVATE_KEY must be a 0x-prefixed 32-byte private key",
    );
  }
  return privateKey as Hex;
}

export function loadPublicConfig(
  env: NodeJS.ProcessEnv = process.env,
): PublicConfig {
  return {
    coston2RpcUrl:
      env.COSTON2_RPC_URL ??
      "https://coston2-api.flare.network/ext/C/rpc",
    xrplTestnetRpcUrl:
      env.XRPL_TESTNET_RPC_URL ?? "wss://testnet.xrpl-labs.com",
    verifierUrl:
      env.VERIFIER_URL_TESTNET ??
      "https://fdc-verifiers-testnet.flare.network",
    daLayerUrl:
      env.COSTON2_DA_LAYER_URL ??
      "https://ctn2-data-availability.flare.network",
  };
}

export function loadExecutorSecrets(
  env: NodeJS.ProcessEnv = process.env,
): ExecutorSecrets {
  const privateKey = loadCoston2PrivateKey(env);
  const verifierApiKey = env.VERIFIER_API_KEY_TESTNET;
  if (!verifierApiKey) {
    throw new Error("VERIFIER_API_KEY_TESTNET is required");
  }
  return {
    privateKey: privateKey as Hex,
    verifierApiKey,
  };
}

export function loadXrplSeed(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const seed = env.XRPL_SEED;
  if (!seed) {
    throw new Error("XRPL_SEED is required for a live XRPL payment");
  }
  return seed;
}
