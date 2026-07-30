// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAdapterRegistry} from "./interfaces/IAdapterRegistry.sol";
import {IMintShieldAdapter} from "./interfaces/IMintShieldAdapter.sol";
import {IMintShieldRouter} from "./interfaces/IMintShieldRouter.sol";

contract MintShieldRouter is IMintShieldRouter, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant MAX_RETURNDATA_BYTES = 256;
    uint256 private constant FALLBACK_GAS_RESERVE = 120_000;
    uint256 public constant MIN_EXECUTION_GAS = 900_000;
    uint256 public constant ADAPTER_GAS_LIMIT = 500_000;

    uint8 public constant STATUS_SUCCESS = 1;
    uint8 public constant STATUS_FALLBACK = 2;

    uint8 public constant FAILURE_NONE = 0;
    uint8 public constant FAILURE_DEADLINE_EXPIRED = 1;
    uint8 public constant FAILURE_ADAPTER_DISABLED = 2;
    uint8 public constant FAILURE_CODEHASH_MISMATCH = 3;
    uint8 public constant FAILURE_INPUT_AMOUNT_MISMATCH = 4;
    uint8 public constant FAILURE_TARGET_REVERTED = 5;
    uint8 public constant FAILURE_MIN_OUTPUT_NOT_MET = 6;
    uint8 public constant FAILURE_POST_CONDITION = 7;
    uint8 public constant FAILURE_UNSUPPORTED_TARGET = 8;
    uint8 public constant FAILURE_ROUTER_PAUSED = 9;
    uint8 public constant FAILURE_INTENT_ALREADY_USED = 10;
    uint8 public constant FAILURE_AMOUNT_CAP_EXCEEDED = 11;
    uint8 public constant FAILURE_INVALID_INTENT = 12;
    uint8 public constant FAILURE_UNKNOWN_ADAPTER = 255;

    error OnlySelf();
    error InvalidRegistry();
    error InvalidProtectedAsset();
    error InexactAssetTransfer(uint256 expected, uint256 actual);
    error InvalidAdapterReturnData();
    error AdapterDidNotSpendExactInput(uint256 expectedBalance, uint256 actualBalance);
    error AdapterAllowanceNotCleared(uint256 remainingAllowance);
    error FallbackAccountingFailed(uint256 expectedBalance, uint256 actualBalance);
    error InsufficientExecutionGas(uint256 available, uint256 required);

    event RouterPauseChanged(bool paused);

    IAdapterRegistry public immutable registry;
    address public immutable protectedAsset;
    bool public paused;

    mapping(bytes32 intentId => bool consumed) public usedIntents;

    modifier onlySelf() {
        if (msg.sender != address(this)) revert OnlySelf();
        _;
    }

    constructor(
        address initialOwner,
        IAdapterRegistry adapterRegistry,
        address asset
    )
        Ownable(initialOwner)
    {
        if (address(adapterRegistry).code.length == 0) revert InvalidRegistry();
        if (asset == address(0)) revert InvalidProtectedAsset();
        registry = adapterRegistry;
        protectedAsset = asset;
    }

    function setPaused(bool shouldPause) external onlyOwner {
        paused = shouldPause;
        emit RouterPauseChanged(shouldPause);
    }

    function hashIntent(MintShieldIntent calldata intent)
        public
        view
        returns (bytes32 intentId)
    {
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                intent.personalAccount,
                intent.asset,
                intent.inputAmount,
                intent.adapterId,
                keccak256(intent.adapterData),
                intent.minOutput,
                intent.deadline,
                intent.nonce
            )
        );
    }

    function execute(MintShieldIntent calldata intent)
        external
        nonReentrant
        returns (ExecutionResult memory result)
    {
        uint256 availableGas = gasleft();
        if (availableGas < MIN_EXECUTION_GAS) {
            revert InsufficientExecutionGas(
                availableGas,
                MIN_EXECUTION_GAS
            );
        }
        bytes32 intentId = hashIntent(intent);

        if (
            intent.personalAccount != msg.sender ||
            intent.asset != protectedAsset ||
            intent.inputAmount == 0 ||
            intent.adapterId == bytes32(0)
        ) {
            return _unfundedFallback(
                intentId,
                intent.adapterId,
                FAILURE_INVALID_INTENT,
                bytes32(0)
            );
        }

        IERC20 asset = IERC20(intent.asset);
        uint256 balanceBefore = asset.balanceOf(address(this));

        (bool fundingSuccess, bytes memory fundingReason, uint256 fundingSize) =
            _boundedSelfCall(
                abi.encodeCall(
                    this.pullAsset,
                    (
                        intent.asset,
                        msg.sender,
                        intent.inputAmount,
                        balanceBefore
                    )
                )
            );
        if (!fundingSuccess) {
            return _unfundedFallback(
                intentId,
                intent.adapterId,
                FAILURE_INPUT_AMOUNT_MISMATCH,
                _diagnosticHash(fundingReason, fundingSize)
            );
        }

        if (usedIntents[intentId]) {
            return _fundedFallback(
                intentId,
                intent.adapterId,
                intent.inputAmount,
                balanceBefore,
                FAILURE_INTENT_ALREADY_USED,
                bytes32(0)
            );
        }
        usedIntents[intentId] = true;

        if (paused) {
            return _fundedFallback(
                intentId,
                intent.adapterId,
                intent.inputAmount,
                balanceBefore,
                FAILURE_ROUTER_PAUSED,
                bytes32(0)
            );
        }
        if (block.timestamp > intent.deadline) {
            return _fundedFallback(
                intentId,
                intent.adapterId,
                intent.inputAmount,
                balanceBefore,
                FAILURE_DEADLINE_EXPIRED,
                bytes32(0)
            );
        }

        IAdapterRegistry.AdapterConfig memory config =
            registry.getAdapter(intent.adapterId);
        if (
            !config.enabled ||
            config.implementation == address(0) ||
            config.asset != intent.asset
        ) {
            return _fundedFallback(
                intentId,
                intent.adapterId,
                intent.inputAmount,
                balanceBefore,
                FAILURE_ADAPTER_DISABLED,
                bytes32(0)
            );
        }
        if (intent.inputAmount > config.maxAmount) {
            return _fundedFallback(
                intentId,
                intent.adapterId,
                intent.inputAmount,
                balanceBefore,
                FAILURE_AMOUNT_CAP_EXCEEDED,
                bytes32(0)
            );
        }
        if (config.implementation.codehash != config.codeHash) {
            return _fundedFallback(
                intentId,
                intent.adapterId,
                intent.inputAmount,
                balanceBefore,
                FAILURE_CODEHASH_MISMATCH,
                bytes32(0)
            );
        }

        return _settleAdapter(
            intent,
            intentId,
            config.implementation,
            balanceBefore
        );
    }

    function _settleAdapter(
        MintShieldIntent calldata intent,
        bytes32 intentId,
        address adapter,
        uint256 balanceBefore
    )
        private
        returns (ExecutionResult memory result)
    {
        (
            bool success,
            bytes memory returnData,
            uint256 returnDataSize
        ) = _boundedSelfCall(
            abi.encodeCall(
                this.executeAdapter,
                (intent, adapter, balanceBefore)
            )
        );
        if (success && returnDataSize == 32) {
            uint256 amountOut = abi.decode(returnData, (uint256));
            emit IntentSettledSuccess(
                intentId,
                msg.sender,
                intent.adapterId,
                intent.inputAmount,
                amountOut
            );
            return ExecutionResult({
                intentId: intentId,
                status: STATUS_SUCCESS,
                failureCode: FAILURE_NONE,
                amountIn: intent.inputAmount,
                amountOut: amountOut
            });
        }
        if (success) {
            returnData = abi.encodeWithSelector(
                InvalidAdapterReturnData.selector
            );
            returnDataSize = returnData.length;
        }
        return _fundedFallback(
            intentId,
            intent.adapterId,
            intent.inputAmount,
            balanceBefore,
            _classifyAdapterFailure(returnData),
            _diagnosticHash(returnData, returnDataSize)
        );
    }

    /// @dev External self-call creates a rollback boundary for token funding.
    function pullAsset(
        address assetAddress,
        address from,
        uint256 amount,
        uint256 balanceBefore
    )
        external
        onlySelf
    {
        IERC20 asset = IERC20(assetAddress);
        asset.safeTransferFrom(from, address(this), amount);
        uint256 received = asset.balanceOf(address(this)) - balanceBefore;
        if (received != amount) revert InexactAssetTransfer(amount, received);
    }

    /// @dev The adapter call and every post-condition share one rollback boundary.
    function executeAdapter(
        MintShieldIntent calldata intent,
        address adapter,
        uint256 balanceBefore
    )
        external
        onlySelf
        returns (uint256 amountOut)
    {
        IERC20 asset = IERC20(intent.asset);
        asset.forceApprove(adapter, intent.inputAmount);

        (bool success, bytes memory returnData,) = _boundedCall(
            adapter,
            abi.encodeCall(
                IMintShieldAdapter.execute,
                (
                    intent.personalAccount,
                    intent.asset,
                    intent.inputAmount,
                    intent.minOutput,
                    intent.adapterData
                )
            ),
            ADAPTER_GAS_LIMIT
        );
        if (!success) {
            assembly ("memory-safe") {
                revert(add(returnData, 0x20), mload(returnData))
            }
        }
        if (returnData.length != 32) revert InvalidAdapterReturnData();
        amountOut = abi.decode(returnData, (uint256));
        if (amountOut < intent.minOutput) {
            revert IMintShieldAdapter.MinimumOutputNotMet(
                amountOut,
                intent.minOutput
            );
        }

        asset.forceApprove(adapter, 0);
        uint256 allowance = asset.allowance(address(this), adapter);
        if (allowance != 0) revert AdapterAllowanceNotCleared(allowance);

        uint256 finalBalance = asset.balanceOf(address(this));
        if (finalBalance != balanceBefore) {
            revert AdapterDidNotSpendExactInput(balanceBefore, finalBalance);
        }
    }

    /// @dev Calls this contract while reserving gas for the outer fallback path.
    function _boundedSelfCall(bytes memory callData)
        private
        returns (
            bool success,
            bytes memory returnData,
            uint256 fullReturnDataSize
        )
    {
        uint256 availableGas = gasleft();
        uint256 callGas = availableGas / 2;
        if (availableGas > FALLBACK_GAS_RESERVE) {
            callGas = availableGas - FALLBACK_GAS_RESERVE;
        }
        return _boundedCall(address(this), callData, callGas);
    }

    /// @dev Copies at most MAX_RETURNDATA_BYTES from an untrusted call.
    function _boundedCall(
        address target,
        bytes memory callData,
        uint256 callGas
    )
        private
        returns (
            bool success,
            bytes memory returnData,
            uint256 fullReturnDataSize
        )
    {
        uint256 maxReturnData = MAX_RETURNDATA_BYTES;
        assembly ("memory-safe") {
            success := call(
                callGas,
                target,
                0,
                add(callData, 0x20),
                mload(callData),
                0,
                0
            )
            fullReturnDataSize := returndatasize()
            let copySize := fullReturnDataSize
            if gt(copySize, maxReturnData) {
                copySize := maxReturnData
            }
            returnData := mload(0x40)
            mstore(returnData, copySize)
            returndatacopy(add(returnData, 0x20), 0, copySize)
            mstore(
                0x40,
                and(
                    add(add(returnData, 0x3f), copySize),
                    not(0x1f)
                )
            )
        }
    }

    function _diagnosticHash(bytes memory boundedData, uint256 fullDataSize)
        private
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(fullDataSize, boundedData));
    }

    function _unfundedFallback(
        bytes32 intentId,
        bytes32 adapterId,
        uint8 failureCode,
        bytes32 revertDataHash
    )
        private
        returns (ExecutionResult memory result)
    {
        emit IntentSettledFallback(
            intentId,
            msg.sender,
            adapterId,
            0,
            failureCode,
            revertDataHash
        );
        return ExecutionResult({
            intentId: intentId,
            status: STATUS_FALLBACK,
            failureCode: failureCode,
            amountIn: 0,
            amountOut: 0
        });
    }

    function _fundedFallback(
        bytes32 intentId,
        bytes32 adapterId,
        uint256 amount,
        uint256 balanceBefore,
        uint8 failureCode,
        bytes32 revertDataHash
    )
        private
        returns (ExecutionResult memory result)
    {
        IERC20(protectedAsset).safeTransfer(msg.sender, amount);
        uint256 finalBalance = IERC20(protectedAsset).balanceOf(address(this));
        if (finalBalance != balanceBefore) {
            revert FallbackAccountingFailed(balanceBefore, finalBalance);
        }

        emit IntentSettledFallback(
            intentId,
            msg.sender,
            adapterId,
            amount,
            failureCode,
            revertDataHash
        );
        return ExecutionResult({
            intentId: intentId,
            status: STATUS_FALLBACK,
            failureCode: failureCode,
            amountIn: amount,
            amountOut: 0
        });
    }

    function _classifyAdapterFailure(bytes memory reason)
        private
        pure
        returns (uint8 failureCode)
    {
        if (reason.length < 4) return FAILURE_UNKNOWN_ADAPTER;
        bytes4 selector;
        assembly ("memory-safe") {
            selector := mload(add(reason, 0x20))
        }

        if (selector == IMintShieldAdapter.TargetCallFailed.selector) {
            return FAILURE_TARGET_REVERTED;
        }
        if (selector == IMintShieldAdapter.MinimumOutputNotMet.selector) {
            return FAILURE_MIN_OUTPUT_NOT_MET;
        }
        if (
            selector == IMintShieldAdapter.PostConditionFailed.selector ||
            selector == InvalidAdapterReturnData.selector ||
            selector == AdapterDidNotSpendExactInput.selector ||
            selector == AdapterAllowanceNotCleared.selector
        ) {
            return FAILURE_POST_CONDITION;
        }
        if (
            selector == IMintShieldAdapter.UnsupportedTarget.selector ||
            selector == IMintShieldAdapter.TargetCodeHashMismatch.selector
        ) {
            return FAILURE_UNSUPPORTED_TARGET;
        }
        return FAILURE_UNKNOWN_ADAPTER;
    }
}
