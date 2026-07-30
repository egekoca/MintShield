import type { DirectMintingSettings } from "./contracts.js";

export const MAX_BIPS = 10_000n;

export type GrossMintQuote = {
  desiredPersonalAccountUBA: bigint;
  memoExecutorFeeUBA: bigint;
  paymentAmountUBA: bigint;
  mintingFeeUBA: bigint;
  mintedToSmartAccountsUBA: bigint;
  expectedPersonalAccountUBA: bigint;
  residualPersonalAccountUBA: bigint;
  triggersLargeMintDelay: boolean;
};

export function computeMintingFeeUBA(
  receivedAmountUBA: bigint,
  feeBIPS: bigint,
  minimumFeeUBA: bigint,
) {
  if (receivedAmountUBA < 0n) {
    throw new RangeError("receivedAmountUBA cannot be negative");
  }
  if (feeBIPS < 0n || feeBIPS >= MAX_BIPS) {
    throw new RangeError("feeBIPS must be in [0, 10000)");
  }
  const relativeFee = (receivedAmountUBA * feeBIPS) / MAX_BIPS;
  const uncapped = relativeFee > minimumFeeUBA
    ? relativeFee
    : minimumFeeUBA;
  return uncapped < receivedAmountUBA ? uncapped : receivedAmountUBA;
}

export function quoteGrossDirectMint(
  desiredPersonalAccountUBA: bigint,
  memoExecutorFeeUBA: bigint,
  settings: Pick<
    DirectMintingSettings,
    "feeBIPS" | "minimumFeeUBA" | "largeMintingThresholdUBA"
  >,
): GrossMintQuote {
  if (desiredPersonalAccountUBA <= 0n) {
    throw new RangeError("desiredPersonalAccountUBA must be positive");
  }
  if (memoExecutorFeeUBA < 0n) {
    throw new RangeError("memoExecutorFeeUBA cannot be negative");
  }

  const netBeforeSystemFee =
    desiredPersonalAccountUBA + memoExecutorFeeUBA;
  const minimumFeeCandidate = netBeforeSystemFee + settings.minimumFeeUBA;
  const proportionalCandidate =
    (
      netBeforeSystemFee * MAX_BIPS +
      (MAX_BIPS - settings.feeBIPS) -
      1n
    ) / (MAX_BIPS - settings.feeBIPS);

  let paymentAmountUBA =
    minimumFeeCandidate > proportionalCandidate
      ? minimumFeeCandidate
      : proportionalCandidate;
  let mintingFeeUBA = computeMintingFeeUBA(
    paymentAmountUBA,
    settings.feeBIPS,
    settings.minimumFeeUBA,
  );
  let mintedToSmartAccountsUBA = paymentAmountUBA - mintingFeeUBA;
  let expectedPersonalAccountUBA =
    mintedToSmartAccountsUBA - memoExecutorFeeUBA;

  while (expectedPersonalAccountUBA < desiredPersonalAccountUBA) {
    paymentAmountUBA += 1n;
    mintingFeeUBA = computeMintingFeeUBA(
      paymentAmountUBA,
      settings.feeBIPS,
      settings.minimumFeeUBA,
    );
    mintedToSmartAccountsUBA = paymentAmountUBA - mintingFeeUBA;
    expectedPersonalAccountUBA =
      mintedToSmartAccountsUBA - memoExecutorFeeUBA;
  }

  return {
    desiredPersonalAccountUBA,
    memoExecutorFeeUBA,
    paymentAmountUBA,
    mintingFeeUBA,
    mintedToSmartAccountsUBA,
    expectedPersonalAccountUBA,
    residualPersonalAccountUBA:
      expectedPersonalAccountUBA - desiredPersonalAccountUBA,
    triggersLargeMintDelay:
      settings.largeMintingThresholdUBA > 0n &&
      paymentAmountUBA > settings.largeMintingThresholdUBA,
  };
}
