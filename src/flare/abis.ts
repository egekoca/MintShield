import {
  parseAbi,
  type Abi,
  type AbiParameter,
  type ContractFunctionArgs,
} from "viem";

/**
 * Minimal canonical ABIs used by MintShield.
 *
 * Keeping only the required fragments avoids loading the UI/code-generation
 * dependency tree of flare-wagmi-periphery-package inside the key-holding
 * executor. The signatures and tuple layout are copied from Flare's v3.6.0
 * Coston2 periphery package.
 */
export const assetManagerAbi = parseAbi([
  "function fAsset() view returns (address)",
]);

export const directMintingSettingsAbi = parseAbi([
  "function getDirectMintingMinimumFeeUBA() view returns (uint256)",
  "function getDirectMintingFeeBIPS() view returns (uint256)",
  "function getDirectMintingExecutorFeeUBA() view returns (uint256)",
  "function getDirectMintingHourlyLimitUBA() view returns (uint256)",
  "function getDirectMintingDailyLimitUBA() view returns (uint256)",
  "function getDirectMintingLargeMintingThresholdUBA() view returns (uint256)",
  "function getDirectMintingLargeMintingDelaySeconds() view returns (uint256)",
]);

export const masterAccountControllerAbi = parseAbi([
  "function getPersonalAccount(string xrplOwner) view returns (address)",
  "function getNonce(address personalAccount) view returns (uint256)",
]);

export const fdcHubAbi = parseAbi([
  "function fdcRequestFeeConfigurations() view returns (address)",
  "function requestAttestation(bytes data) payable",
  "event AttestationRequest(bytes data, uint256 fee)",
]);

export const fdcRequestFeeConfigurationsAbi = parseAbi([
  "function getRequestFee(bytes data) view returns (uint256)",
]);

export const fdcVerificationAbi = parseAbi([
  "function fdcProtocolId() view returns (uint8)",
]);

export const flareSystemsManagerAbi = parseAbi([
  "function firstVotingRoundStartTs() view returns (uint64)",
  "function votingEpochDurationSeconds() view returns (uint64)",
]);

export const relayAbi = parseAbi([
  "function isFinalized(uint256 protocolId, uint256 votingRoundId) view returns (bool)",
]);

const xrpPaymentResponseComponents = [
  { name: "attestationType", internalType: "bytes32", type: "bytes32" },
  { name: "sourceId", internalType: "bytes32", type: "bytes32" },
  { name: "votingRound", internalType: "uint64", type: "uint64" },
  { name: "lowestUsedTimestamp", internalType: "uint64", type: "uint64" },
  {
    name: "requestBody",
    internalType: "struct IXRPPayment.RequestBody",
    type: "tuple",
    components: [
      { name: "transactionId", internalType: "bytes32", type: "bytes32" },
      { name: "proofOwner", internalType: "address", type: "address" },
    ],
  },
  {
    name: "responseBody",
    internalType: "struct IXRPPayment.ResponseBody",
    type: "tuple",
    components: [
      { name: "blockNumber", internalType: "uint64", type: "uint64" },
      { name: "blockTimestamp", internalType: "uint64", type: "uint64" },
      { name: "sourceAddress", internalType: "string", type: "string" },
      { name: "sourceAddressHash", internalType: "bytes32", type: "bytes32" },
      { name: "receivingAddressHash", internalType: "bytes32", type: "bytes32" },
      {
        name: "intendedReceivingAddressHash",
        internalType: "bytes32",
        type: "bytes32",
      },
      { name: "spentAmount", internalType: "int256", type: "int256" },
      { name: "intendedSpentAmount", internalType: "int256", type: "int256" },
      { name: "receivedAmount", internalType: "int256", type: "int256" },
      {
        name: "intendedReceivedAmount",
        internalType: "int256",
        type: "int256",
      },
      { name: "hasMemoData", internalType: "bool", type: "bool" },
      { name: "firstMemoData", internalType: "bytes", type: "bytes" },
      { name: "hasDestinationTag", internalType: "bool", type: "bool" },
      { name: "destinationTag", internalType: "uint256", type: "uint256" },
      { name: "status", internalType: "uint8", type: "uint8" },
    ],
  },
] as const satisfies readonly AbiParameter[];

const xrpPaymentProofParameter = {
  name: "_proof",
  internalType: "struct IXRPPayment.Proof",
  type: "tuple",
  components: [
    {
      name: "merkleProof",
      internalType: "bytes32[]",
      type: "bytes32[]",
    },
    {
      name: "data",
      internalType: "struct IXRPPayment.Response",
      type: "tuple",
      components: xrpPaymentResponseComponents,
    },
  ],
} as const satisfies AbiParameter;

export const xrpPaymentVerificationAbi = [
  {
    type: "function",
    name: "verifyXRPPayment",
    stateMutability: "view",
    inputs: [xrpPaymentProofParameter],
    outputs: [{ name: "_proved", internalType: "bool", type: "bool" }],
  },
] as const satisfies Abi;

export const directMintingAbi = [
  {
    type: "event",
    name: "DirectMintingDelayed",
    anonymous: false,
    inputs: [
      { name: "transactionId", type: "bytes32", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "executionAllowedAt", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "LargeDirectMintingDelayed",
    anonymous: false,
    inputs: [
      { name: "transactionId", type: "bytes32", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "executionAllowedAt", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "directMintingPaymentAddress",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "directMintingDelayState",
    stateMutability: "view",
    inputs: [{ name: "_transactionId", type: "bytes32" }],
    outputs: [
      { name: "_delayState", type: "uint8" },
      { name: "_allowedAt", type: "uint256" },
      { name: "_startedAt", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "executeDirectMintingWithData",
    stateMutability: "payable",
    inputs: [
      xrpPaymentProofParameter,
      { name: "_data", internalType: "bytes", type: "bytes" },
    ],
    outputs: [],
  },
] as const satisfies Abi;

export const memoInstructionsEventsAbi = parseAbi([
  "event UserOperationExecuted(address indexed personalAccount, uint256 indexed nonce)",
  "event IgnoreMemoSet(address indexed personalAccount, bytes32 indexed targetTxId)",
  "event DirectMintingExecuted(address indexed personalAccount, bytes32 indexed transactionId, string sourceAddress, uint256 amount, uint256 executorFee, address executor)",
  "function isTransactionIdUsed(bytes32 transactionId) view returns (bool)",
]);

export const mintShieldEventsAbi = parseAbi([
  "event IntentSettledSuccess(bytes32 indexed intentId, address indexed personalAccount, bytes32 indexed adapterId, uint256 amountIn, uint256 amountOut)",
  "event IntentSettledFallback(bytes32 indexed intentId, address indexed personalAccount, bytes32 indexed adapterId, uint256 returnedAmount, uint8 failureCode, bytes32 revertDataHash)",
]);

export type XrpPaymentProof = ContractFunctionArgs<
  typeof xrpPaymentVerificationAbi,
  "view",
  "verifyXRPPayment"
>[0];

export type XrpPaymentResponse = XrpPaymentProof["data"];
export const xrpPaymentResponseAbiParameter = {
  name: "response",
  type: "tuple",
  components: xrpPaymentResponseComponents,
} as const satisfies AbiParameter;
