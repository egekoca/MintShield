import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { UserOpCustomInstruction } from "@flarenetwork/smart-accounts-encoder";

export type MintShieldIntent = {
  personalAccount: Address;
  asset: Address;
  inputAmount: bigint;
  adapterId: Hex;
  adapterData: Hex;
  minOutput: bigint;
  deadline: bigint;
  nonce: bigint;
};

export type Call = {
  target: Address;
  value: bigint;
  data: Hex;
};

const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;

const packedUserOperationTuple = {
  type: "tuple",
  components: [
    { name: "sender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "initCode", type: "bytes" },
    { name: "callData", type: "bytes" },
    { name: "accountGasLimits", type: "bytes32" },
    { name: "preVerificationGas", type: "uint256" },
    { name: "gasFees", type: "bytes32" },
    { name: "paymasterAndData", type: "bytes" },
    { name: "signature", type: "bytes" },
  ],
} as const;

const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const personalAccountAbi = parseAbi([
  "function executeUserOp((address target,uint256 value,bytes data)[] calls) payable",
]);

const routerAbi = parseAbi([
  "function execute((address personalAccount,address asset,uint256 inputAmount,bytes32 adapterId,bytes adapterData,uint256 minOutput,uint64 deadline,uint256 nonce) intent) returns ((bytes32 intentId,uint8 status,uint8 failureCode,uint256 amountIn,uint256 amountOut) result)",
]);

const vaultAbi = parseAbi([
  "function deposit(uint256 assets,address receiver) returns (uint256 shares)",
]);

export function buildProtectedDepositCalls(
  router: Address,
  intent: MintShieldIntent,
): Call[] {
  return [
    {
      target: intent.asset,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [router, intent.inputAmount],
      }),
    },
    {
      target: router,
      value: 0n,
      data: encodeFunctionData({
        abi: routerAbi,
        functionName: "execute",
        args: [intent],
      }),
    },
  ];
}

export function encodePackedUserOperation(
  personalAccount: Address,
  smartAccountNonce: bigint,
  calls: Call[],
): Hex {
  const callData = encodeFunctionData({
    abi: personalAccountAbi,
    functionName: "executeUserOp",
    args: [calls],
  });

  return encodeAbiParameters(
    [packedUserOperationTuple],
    [
      {
        sender: personalAccount,
        nonce: smartAccountNonce,
        initCode: "0x",
        callData,
        accountGasLimits: ZERO_BYTES32,
        preVerificationGas: 0n,
        gasFees: ZERO_BYTES32,
        paymasterAndData: "0x",
        signature: "0x",
      },
    ],
  );
}

export function buildBareDepositCalls(input: {
  vault: Address;
  personalAccount: Address;
  asset: Address;
  amount: bigint;
}): Call[] {
  return [
    {
      target: input.asset,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [input.vault, input.amount],
      }),
    },
    {
      target: input.vault,
      value: 0n,
      data: encodeFunctionData({
        abi: vaultAbi,
        functionName: "deposit",
        args: [input.amount, input.personalAccount],
      }),
    },
  ];
}

export function buildCustomInstruction(
  personalAccount: Address,
  smartAccountNonce: bigint,
  calls: Call[],
  executorFeeUBA: bigint,
  walletId = 0,
) {
  if (walletId < 0 || walletId > 255) {
    throw new RangeError("walletId must fit in one byte");
  }
  if (executorFeeUBA < 0n || executorFeeUBA > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError("executorFeeUBA must fit in uint64");
  }

  const data = encodePackedUserOperation(
    personalAccount,
    smartAccountNonce,
    calls,
  );
  const userOpHash = keccak256(data);
  const memoData = new UserOpCustomInstruction({
    walletId,
    executorFeeUBA,
    userOperationHash: userOpHash,
  }).encode() as Hex;

  return {
    calls,
    data,
    userOpHash,
    memoData,
    totalCallValue: 0n,
  };
}

export function buildHashInstruction(
  router: Address,
  intent: MintShieldIntent,
  smartAccountNonce: bigint,
  executorFeeUBA: bigint,
  walletId = 0,
) {
  return buildCustomInstruction(
    intent.personalAccount,
    smartAccountNonce,
    buildProtectedDepositCalls(router, intent),
    executorFeeUBA,
    walletId,
  );
}

export function buildBareHashInstruction(input: {
  vault: Address;
  personalAccount: Address;
  asset: Address;
  amount: bigint;
  smartAccountNonce: bigint;
  executorFeeUBA: bigint;
  walletId?: number;
}) {
  return buildCustomInstruction(
    input.personalAccount,
    input.smartAccountNonce,
    buildBareDepositCalls(input),
    input.executorFeeUBA,
    input.walletId,
  );
}
