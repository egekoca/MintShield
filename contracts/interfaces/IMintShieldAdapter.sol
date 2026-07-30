// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IMintShieldAdapter {
    error TargetCallFailed(bytes32 revertDataHash);
    error MinimumOutputNotMet(uint256 actualOutput, uint256 minimumOutput);
    error PostConditionFailed(bytes32 condition);
    error UnsupportedTarget(address target);
    error TargetCodeHashMismatch(address target, bytes32 expected, bytes32 actual);

    function execute(
        address personalAccount,
        address asset,
        uint256 amount,
        uint256 minOutput,
        bytes calldata adapterData
    )
        external
        returns (uint256 amountOut);
}
