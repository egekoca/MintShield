// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IMintShieldAdapter} from "../interfaces/IMintShieldAdapter.sol";
import {IMintShieldRouter} from "../interfaces/IMintShieldRouter.sol";

/// @dev Test-only adapter for returndata and reentrancy boundary tests.
contract AdversarialAdapter is IMintShieldAdapter {
    enum Mode {
        LARGE_REVERT,
        MALFORMED_SUCCESS,
        LARGE_SUCCESS,
        REENTER,
        GAS_BURN
    }

    error ReentryBlocked(bytes32 revertDataHash);
    error ReentryUnexpectedlySucceeded();

    address public immutable router;
    Mode public immutable mode;

    constructor(address routerAddress, Mode adapterMode) {
        router = routerAddress;
        mode = adapterMode;
    }

    function execute(
        address,
        address asset,
        uint256,
        uint256,
        bytes calldata
    )
        external
        returns (uint256)
    {
        if (mode == Mode.LARGE_REVERT) {
            assembly ("memory-safe") {
                let size := 0x10000
                let pointer := mload(0x40)
                mstore(pointer, 0x08c379a0)
                revert(pointer, size)
            }
        }
        if (mode == Mode.MALFORMED_SUCCESS) {
            assembly ("memory-safe") {
                mstore(0x00, 1)
                return(0x01, 31)
            }
        }
        if (mode == Mode.LARGE_SUCCESS) {
            assembly ("memory-safe") {
                let size := 0x10000
                let pointer := mload(0x40)
                mstore(pointer, 1)
                return(pointer, size)
            }
        }
        if (mode == Mode.GAS_BURN) {
            assembly ("memory-safe") {
                for { } 1 { } { }
            }
        }

        IMintShieldRouter.MintShieldIntent memory nested =
            IMintShieldRouter.MintShieldIntent({
                personalAccount: address(this),
                asset: asset,
                inputAmount: 1,
                adapterId: bytes32(uint256(1)),
                adapterData: "",
                minOutput: 0,
                deadline: type(uint64).max,
                nonce: 1
            });
        (bool success, bytes memory reason) = router.call(
            abi.encodeCall(IMintShieldRouter.execute, (nested))
        );
        if (success) revert ReentryUnexpectedlySucceeded();
        revert ReentryBlocked(keccak256(reason));
    }
}
