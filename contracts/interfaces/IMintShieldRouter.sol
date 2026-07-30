// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IMintShieldRouter {
    struct MintShieldIntent {
        address personalAccount;
        address asset;
        uint256 inputAmount;
        bytes32 adapterId;
        bytes adapterData;
        uint256 minOutput;
        uint64 deadline;
        uint256 nonce;
    }

    struct ExecutionResult {
        bytes32 intentId;
        uint8 status;
        uint8 failureCode;
        uint256 amountIn;
        uint256 amountOut;
    }

    event IntentSettledSuccess(
        bytes32 indexed intentId,
        address indexed personalAccount,
        bytes32 indexed adapterId,
        uint256 amountIn,
        uint256 amountOut
    );

    event IntentSettledFallback(
        bytes32 indexed intentId,
        address indexed personalAccount,
        bytes32 indexed adapterId,
        uint256 returnedAmount,
        uint8 failureCode,
        bytes32 revertDataHash
    );

    function execute(MintShieldIntent calldata intent)
        external
        returns (ExecutionResult memory result);

    function hashIntent(MintShieldIntent calldata intent)
        external
        view
        returns (bytes32 intentId);
}
