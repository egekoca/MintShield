import {
  formatUnits,
  getAddress,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import {
  buildHashInstruction,
  type MintShieldIntent,
} from "../client/protected-deposit.js";
import {
  quoteGrossDirectMint,
  type GrossMintQuote,
} from "../flare/preflight.js";
import type { DirectMintingSettings } from "../flare/contracts.js";

const UBA_DECIMALS = 6;
const DECIMAL_INPUT = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

export type DepositPreviewInput = {
  xrplAddress: string;
  amountFxrp: string;
  minimumShares: string;
  executorFeeFxrp?: string;
  deadlineMinutes?: number;
};

export type PreviewDeployment = {
  router: Address;
  vault: Address;
  fxrp: Address;
  adapterId: Hex;
  adapterVersion: number;
  maxAmountUBA: bigint;
};

export type PreviewChainContext = {
  personalAccount: Address;
  smartAccountNonce: bigint;
  settings: DirectMintingSettings;
};

export type NormalizedPreviewInput = {
  xrplAddress: string;
  amountUBA: bigint;
  minimumShares: bigint;
  executorFeeUBA: bigint;
  deadlineMinutes: number;
};

function parseDecimal(value: unknown, field: string) {
  if (typeof value !== "string" || !DECIMAL_INPUT.test(value)) {
    throw new RangeError(`${field} must be a non-negative decimal with at most 6 places`);
  }
  return parseUnits(value, UBA_DECIMALS);
}

export function normalizeDepositPreviewInput(
  value: unknown,
): NormalizedPreviewInput {
  if (value === null || typeof value !== "object") {
    throw new TypeError("Preview input must be a JSON object");
  }
  const input = value as Partial<DepositPreviewInput>;
  if (typeof input.xrplAddress !== "string" || input.xrplAddress.length > 80) {
    throw new RangeError("xrplAddress must be a classic XRPL address");
  }
  const amountUBA = parseDecimal(input.amountFxrp, "amountFxrp");
  const minimumShares = parseDecimal(
    input.minimumShares,
    "minimumShares",
  );
  const executorFeeUBA = parseDecimal(
    input.executorFeeFxrp ?? "0",
    "executorFeeFxrp",
  );
  const deadlineMinutes = input.deadlineMinutes ?? 120;
  if (
    !Number.isSafeInteger(deadlineMinutes) ||
    deadlineMinutes < 10 ||
    deadlineMinutes > 1_440
  ) {
    throw new RangeError("deadlineMinutes must be an integer in [10, 1440]");
  }
  if (amountUBA <= 0n) {
    throw new RangeError("amountFxrp must be greater than zero");
  }
  if (minimumShares <= 0n) {
    throw new RangeError("minimumShares must be greater than zero");
  }
  return {
    xrplAddress: input.xrplAddress,
    amountUBA,
    minimumShares,
    executorFeeUBA,
    deadlineMinutes,
  };
}

function quoteView(quote: GrossMintQuote) {
  return {
    paymentAmountDrops: quote.paymentAmountUBA.toString(),
    paymentAmountXrp: formatUnits(quote.paymentAmountUBA, UBA_DECIMALS),
    mintingFeeUBA: quote.mintingFeeUBA.toString(),
    mintingFeeFxrp: formatUnits(quote.mintingFeeUBA, UBA_DECIMALS),
    executorFeeUBA: quote.memoExecutorFeeUBA.toString(),
    executorFeeFxrp: formatUnits(
      quote.memoExecutorFeeUBA,
      UBA_DECIMALS,
    ),
    expectedPersonalAccountUBA:
      quote.expectedPersonalAccountUBA.toString(),
    expectedPersonalAccountFxrp: formatUnits(
      quote.expectedPersonalAccountUBA,
      UBA_DECIMALS,
    ),
    triggersLargeMintDelay: quote.triggersLargeMintDelay,
  };
}

export function buildDepositPlan(input: {
  normalized: NormalizedPreviewInput;
  deployment: PreviewDeployment;
  chain: PreviewChainContext;
  nowSeconds: bigint;
}) {
  const { normalized, deployment, chain } = input;
  if (normalized.amountUBA > deployment.maxAmountUBA) {
    throw new RangeError(
      `amountFxrp exceeds adapter cap ${formatUnits(deployment.maxAmountUBA, UBA_DECIMALS)}`,
    );
  }
  const deadline =
    input.nowSeconds + BigInt(normalized.deadlineMinutes * 60);
  const intent: MintShieldIntent = {
    personalAccount: chain.personalAccount,
    asset: deployment.fxrp,
    inputAmount: normalized.amountUBA,
    adapterId: deployment.adapterId,
    adapterData: "0x",
    minOutput: normalized.minimumShares,
    deadline,
    nonce: chain.smartAccountNonce,
  };
  const quote = quoteGrossDirectMint(
    normalized.amountUBA,
    normalized.executorFeeUBA,
    chain.settings,
  );
  const instruction = buildHashInstruction(
    deployment.router,
    intent,
    chain.smartAccountNonce,
    normalized.executorFeeUBA,
  );

  const preview = {
    network: {
      name: "Flare Testnet Coston2",
      chainId: 114,
    },
    source: {
      xrplAddress: normalized.xrplAddress,
      destination: chain.settings.coreVaultXrplAddress,
    },
    intent: {
      personalAccount: getAddress(chain.personalAccount),
      nonce: chain.smartAccountNonce.toString(),
      router: deployment.router,
      asset: deployment.fxrp,
      inputAmountUBA: normalized.amountUBA.toString(),
      inputAmountFxrp: formatUnits(normalized.amountUBA, UBA_DECIMALS),
      adapterId: deployment.adapterId,
      adapterVersion: deployment.adapterVersion,
      target: deployment.vault,
      minimumSharesUBA: normalized.minimumShares.toString(),
      minimumShares: formatUnits(normalized.minimumShares, UBA_DECIMALS),
      deadline: deadline.toString(),
      deadlineIso: new Date(Number(deadline) * 1_000).toISOString(),
      fallbackReceiver: getAddress(chain.personalAccount),
    },
    quote: quoteView(quote),
    commitment: {
      userOpHash: instruction.userOpHash,
      memoData: instruction.memoData,
      memoBytes: (instruction.memoData.length - 2) / 2,
      callCount: instruction.calls.length,
    },
    preflight: {
      planningChecks: "PASSED",
      fullSimulation: "PENDING_FDC_PROOF",
      simulationTarget: "executeDirectMintingWithData",
      broadcastPolicy: "REQUIRE_FULL_ETH_CALL",
      secondaryChecks: [
        "INPUT_BOUNDS",
        "ADAPTER_CAP",
        "CURRENT_NONCE",
        "LIVE_FEE_QUOTE",
        "ONCHAIN_DEADLINE_AND_SLIPPAGE",
      ],
    },
    warnings: [
      ...(quote.triggersLargeMintDelay
        ? ["Payment exceeds the current large-mint threshold and can be delayed."]
        : []),
      "Testnet only. Review every field again in the external wallet.",
    ],
  };
  return {
    preview,
    execution: {
      intent,
      userOpHash: instruction.userOpHash,
      userOpData: instruction.data,
      memoData: instruction.memoData,
      totalCallValue: instruction.totalCallValue,
    },
  };
}

export function buildDepositPreview(
  input: Parameters<typeof buildDepositPlan>[0],
) {
  return buildDepositPlan(input).preview;
}
