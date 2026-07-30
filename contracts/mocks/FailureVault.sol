// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract FailureVault is ERC20 {
    using SafeERC20 for IERC20;

    enum Mode {
        NONE,
        REVERT_ALWAYS,
        RETURN_ZERO_SHARES,
        PARTIAL_OUTPUT,
        PAUSED,
        LARGE_REVERT,
        MALFORMED_SUCCESS,
        LARGE_SUCCESS,
        GAS_BURN
    }

    error ForcedFailure(Mode mode);

    IERC20 private immutable underlying;
    Mode public mode;

    constructor(IERC20 assetAddress)
        ERC20("MintShield Demo Vault Share", "msSHARE")
    {
        underlying = assetAddress;
    }

    function asset() external view returns (address) {
        return address(underlying);
    }

    function totalAssets() external view returns (uint256) {
        return underlying.balanceOf(address(this));
    }

    function previewDeposit(uint256 assets) external view returns (uint256) {
        return mode == Mode.PARTIAL_OUTPUT ? assets / 2 : assets;
    }

    function setMode(Mode newMode) external {
        mode = newMode;
    }

    function deposit(uint256 assets, address receiver)
        external
        returns (uint256 shares)
    {
        Mode currentMode = mode;
        if (
            currentMode == Mode.REVERT_ALWAYS ||
            currentMode == Mode.PAUSED
        ) {
            revert ForcedFailure(currentMode);
        }
        if (currentMode == Mode.LARGE_REVERT) {
            assembly ("memory-safe") {
                let size := 0x10000
                let pointer := mload(0x40)
                mstore(pointer, 0x08c379a0)
                revert(pointer, size)
            }
        }
        if (currentMode == Mode.MALFORMED_SUCCESS) {
            assembly ("memory-safe") {
                mstore(0x00, 1)
                return(0x01, 31)
            }
        }
        if (currentMode == Mode.LARGE_SUCCESS) {
            assembly ("memory-safe") {
                let size := 0x10000
                let pointer := mload(0x40)
                mstore(pointer, 1)
                return(pointer, size)
            }
        }
        if (currentMode == Mode.GAS_BURN) {
            assembly ("memory-safe") {
                for { } 1 { } { }
            }
        }

        underlying.safeTransferFrom(msg.sender, address(this), assets);
        shares = currentMode == Mode.PARTIAL_OUTPUT ? assets / 2 : assets;
        _mint(receiver, shares);

        if (currentMode == Mode.RETURN_ZERO_SHARES) {
            return 0;
        }
    }
}
