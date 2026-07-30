// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IMintShieldAdapter} from "../interfaces/IMintShieldAdapter.sol";

/// @dev Test-only adapter that lies about success without consuming input.
contract NoSpendAdapter is IMintShieldAdapter {
    function execute(
        address,
        address,
        uint256,
        uint256 minOutput,
        bytes calldata
    )
        external
        pure
        returns (uint256 amountOut)
    {
        return minOutput;
    }
}
