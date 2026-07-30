import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { Client } from "xrpl";
import { loadPublicConfig } from "../src/config/env.js";

function hasConfiguredSeed(contents: string) {
  return contents
    .split(/\r?\n/)
    .some((line) => /^XRPL_SEED=.+/.test(line.trim()));
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
if (hasConfiguredSeed(existing)) {
  throw new Error(
    ".env already contains XRPL_SEED; refusing to replace an existing wallet",
  );
}

const config = loadPublicConfig();
const client = new Client(config.xrplTestnetRpcUrl);
await client.connect();
try {
  const funded = await client.fundWallet(undefined, {
    usageContext: "MintShield Flare Summer Signal testnet demo",
  });
  const seed = funded.wallet.seed;
  if (seed === undefined || seed === "") {
    throw new Error("XRPL wallet was funded but did not expose a seed to save");
  }
  const ledgerBalance = await client.getXrpBalance(funded.wallet.address);

  let next = existing;
  next = setEnvValue(next, "XRPL_TESTNET_RPC_URL", config.xrplTestnetRpcUrl);
  next = setEnvValue(next, "XRPL_SEED", seed);
  next = setEnvValue(next, "XRPL_ADDRESS", funded.wallet.address);

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
        network: "XRPL Testnet",
        address: funded.wallet.address,
        faucetBalanceXrp: funded.balance,
        verifiedLedgerBalanceXrp: ledgerBalance,
        credentialsSavedTo: ".env",
        fileMode: "0600",
        warning:
          "Testnet only. Never reuse this seed for XRPL Mainnet or real funds.",
      },
      null,
      2,
    ),
  );
} finally {
  await client.disconnect();
}
