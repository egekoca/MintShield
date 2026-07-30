import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { flareTestnet } from "viem/chains";

export function createCoston2PublicClient(rpcUrl: string) {
  return createPublicClient({
    chain: flareTestnet,
    transport: http(rpcUrl),
  });
}

export function createCoston2WalletClient(
  rpcUrl: string,
  privateKey: Hex,
) {
  const account = privateKeyToAccount(privateKey);
  return {
    account,
    client: createWalletClient({
      account,
      chain: flareTestnet,
      transport: http(rpcUrl),
    }),
  };
}
