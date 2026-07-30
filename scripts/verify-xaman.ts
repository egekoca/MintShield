import {
  loadOptionalXamanCredentials,
  pingXaman,
} from "../src/xaman/client.js";

const credentials = loadOptionalXamanCredentials();
if (credentials === undefined) {
  throw new Error(
    "Set XAMAN_ENABLE_SIGNING=true with backend API credentials",
  );
}

const result = await pingXaman({ credentials });
console.log(
  JSON.stringify({
    service: "xaman-platform-api",
    authenticated: result.authenticated,
    applicationName: result.applicationName,
    disabled: result.disabled,
    secretsExposed: false,
  }),
);
