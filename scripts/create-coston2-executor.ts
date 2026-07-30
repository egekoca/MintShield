import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

function hasConfiguredValue(contents: string, key: string) {
  const expression = new RegExp(`^${key}=.+$`, "m");
  return expression.test(contents);
}

function setEnvValue(contents: string, key: string, value: string) {
  const expression = new RegExp(`^${key}=.*$`, "m");
  if (expression.test(contents)) {
    return contents.replace(expression, `${key}=${value}`);
  }
  const separator = contents.length === 0 || contents.endsWith("\n") ? "" : "\n";
  return `${contents}${separator}${key}=${value}\n`;
}

const envPath = resolve(process.cwd(), ".env");
const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
if (hasConfiguredValue(existing, "COSTON2_PRIVATE_KEY")) {
  throw new Error(
    ".env already contains COSTON2_PRIVATE_KEY; refusing to replace it",
  );
}

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);
let next = existing;
next = setEnvValue(
  next,
  "COSTON2_RPC_URL",
  "https://coston2-api.flare.network/ext/C/rpc",
);
next = setEnvValue(next, "COSTON2_PRIVATE_KEY", privateKey);
next = setEnvValue(next, "COSTON2_EXECUTOR_ADDRESS", account.address);
next = setEnvValue(
  next,
  "VERIFIER_URL_TESTNET",
  "https://fdc-verifiers-testnet.flare.network",
);
next = setEnvValue(
  next,
  "VERIFIER_API_KEY_TESTNET",
  "00000000-0000-0000-0000-000000000000",
);
next = setEnvValue(
  next,
  "COSTON2_DA_LAYER_URL",
  "https://ctn2-data-availability.flare.network",
);

const temporaryPath = `${envPath}.new`;
writeFileSync(temporaryPath, next, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o600,
});
renameSync(temporaryPath, envPath);
chmodSync(envPath, 0o600);

console.log(
  JSON.stringify(
    {
      network: "Flare Testnet Coston2",
      chainId: 114,
      executorAddress: account.address,
      nativeBalanceC2FLR: "0",
      credentialsSavedTo: ".env",
      fileMode: "0600",
      faucet: "https://faucet.flare.network/coston2",
      nextAction:
        "Request C2FLR for the executor address from the official faucet.",
      warning:
        "Testnet only. Never reuse this private key for Flare Mainnet or real funds.",
    },
    null,
    2,
  ),
);
