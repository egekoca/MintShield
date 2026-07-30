import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViem],
  solidity: {
    profiles: {
      default: {
        version: "0.8.27",
        settings: {
          evmVersion: "cancun",
          optimizer: {
            enabled: true,
            runs: 500
          }
        }
      },
      production: {
        version: "0.8.27",
        settings: {
          evmVersion: "cancun",
          optimizer: {
            enabled: true,
            runs: 1000
          },
          viaIR: true
        }
      }
    }
  },
  networks: {
    coston2: {
      type: "http",
      chainType: "l1",
      chainId: 114,
      url: configVariable("COSTON2_RPC_URL"),
      accounts: [configVariable("COSTON2_PRIVATE_KEY")]
    }
  }
});
