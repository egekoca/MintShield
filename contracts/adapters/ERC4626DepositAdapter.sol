// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IMintShieldAdapter} from "../interfaces/IMintShieldAdapter.sol";

contract ERC4626DepositAdapter is IMintShieldAdapter {
    using SafeERC20 for IERC20;

    uint256 private constant MAX_RETURNDATA_BYTES = 256;

    bytes32 private constant CONDITION_ADAPTER_DATA =
        keccak256("ADAPTER_DATA_MUST_BE_EMPTY");
    bytes32 private constant CONDITION_INPUT_TRANSFER =
        keccak256("INPUT_TRANSFER_DELTA");
    bytes32 private constant CONDITION_VAULT_ASSET =
        keccak256("VAULT_ASSET_MISMATCH");
    bytes32 private constant CONDITION_SHARE_DELTA =
        keccak256("SHARE_DELTA_MISMATCH");
    bytes32 private constant CONDITION_RESIDUAL_ASSET =
        keccak256("ADAPTER_RESIDUAL_ASSET");
    bytes32 private constant CONDITION_RESIDUAL_ALLOWANCE =
        keccak256("VAULT_ALLOWANCE_NOT_ZERO");

    error OnlyRouter(address caller);
    error InvalidAddress();

    address public immutable router;
    address public immutable asset;
    address public immutable vault;
    bytes32 public immutable targetCodeHash;

    constructor(address routerAddress, address assetAddress, address vaultAddress) {
        if (
            routerAddress == address(0) ||
            assetAddress == address(0) ||
            vaultAddress.code.length == 0
        ) {
            revert InvalidAddress();
        }
        router = routerAddress;
        asset = assetAddress;
        vault = vaultAddress;
        targetCodeHash = vaultAddress.codehash;
    }

    function execute(
        address personalAccount,
        address assetAddress,
        uint256 amount,
        uint256 minOutput,
        bytes calldata adapterData
    )
        external
        returns (uint256 amountOut)
    {
        if (msg.sender != router) revert OnlyRouter(msg.sender);
        if (personalAccount == address(0) || assetAddress != asset) {
            revert UnsupportedTarget(vault);
        }
        if (adapterData.length != 0) {
            revert PostConditionFailed(CONDITION_ADAPTER_DATA);
        }
        bytes32 currentCodeHash = vault.codehash;
        if (currentCodeHash != targetCodeHash) {
            revert TargetCodeHashMismatch(
                vault,
                targetCodeHash,
                currentCodeHash
            );
        }

        _assertVaultAsset();

        IERC20 input = IERC20(asset);
        uint256 adapterBalanceBefore = input.balanceOf(address(this));
        input.safeTransferFrom(router, address(this), amount);
        if (input.balanceOf(address(this)) - adapterBalanceBefore != amount) {
            revert PostConditionFailed(CONDITION_INPUT_TRANSFER);
        }

        uint256 sharesBefore = IERC20(vault).balanceOf(personalAccount);
        amountOut = _deposit(amount, personalAccount);

        uint256 actualShares =
            IERC20(vault).balanceOf(personalAccount) - sharesBefore;
        if (actualShares != amountOut) {
            revert PostConditionFailed(CONDITION_SHARE_DELTA);
        }
        if (actualShares < minOutput) {
            revert MinimumOutputNotMet(actualShares, minOutput);
        }
        if (input.balanceOf(address(this)) != adapterBalanceBefore) {
            revert PostConditionFailed(CONDITION_RESIDUAL_ASSET);
        }
        if (input.allowance(address(this), vault) != 0) {
            revert PostConditionFailed(CONDITION_RESIDUAL_ALLOWANCE);
        }
    }

    function _assertVaultAsset() private view {
        (bool success, bytes memory returnData, uint256 fullReturnDataSize) =
            _boundedStaticCall(
                vault,
                abi.encodeCall(IERC4626.asset, ())
            );
        if (!success) {
            revert TargetCallFailed(
                _diagnosticHash(returnData, fullReturnDataSize)
            );
        }
        if (
            fullReturnDataSize != 32 ||
            abi.decode(returnData, (address)) != asset
        ) {
            revert PostConditionFailed(CONDITION_VAULT_ASSET);
        }
    }

    function _deposit(uint256 amount, address personalAccount)
        private
        returns (uint256 amountOut)
    {
        IERC20 input = IERC20(asset);
        input.forceApprove(vault, amount);
        (bool success, bytes memory returnData, uint256 fullReturnDataSize) =
            _boundedCall(
                vault,
                abi.encodeCall(
                    IERC4626.deposit,
                    (amount, personalAccount)
                )
            );
        if (!success) {
            revert TargetCallFailed(
                _diagnosticHash(returnData, fullReturnDataSize)
            );
        }
        if (fullReturnDataSize != 32) {
            revert PostConditionFailed(CONDITION_SHARE_DELTA);
        }
        amountOut = abi.decode(returnData, (uint256));
        input.forceApprove(vault, 0);
    }

    function _boundedCall(address target, bytes memory callData)
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
                gas(),
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

    function _boundedStaticCall(address target, bytes memory callData)
        private
        view
        returns (
            bool success,
            bytes memory returnData,
            uint256 fullReturnDataSize
        )
    {
        uint256 maxReturnData = MAX_RETURNDATA_BYTES;
        assembly ("memory-safe") {
            success := staticcall(
                gas(),
                target,
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
}
