// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IMintShieldRouter} from "../interfaces/IMintShieldRouter.sol";

/// @dev Test-only token that attempts to reenter Router.execute on funding.
contract ReentrantERC20 is ERC20 {
    address public router;
    bool public reentryEnabled;
    bool public attempted;
    bool public reentrySucceeded;

    constructor() ERC20("Reentrant FXRP", "rFXRP") {}

    function setRouter(address routerAddress) external {
        router = routerAddress;
    }

    function setReentryEnabled(bool enabled) external {
        reentryEnabled = enabled;
        attempted = false;
        reentrySucceeded = false;
    }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }

    function transferFrom(address from, address to, uint256 value)
        public
        override
        returns (bool)
    {
        if (
            reentryEnabled &&
            msg.sender == router &&
            !attempted
        ) {
            attempted = true;
            IMintShieldRouter.MintShieldIntent memory nested =
                IMintShieldRouter.MintShieldIntent({
                    personalAccount: address(this),
                    asset: address(this),
                    inputAmount: 1,
                    adapterId: bytes32(uint256(1)),
                    adapterData: "",
                    minOutput: 0,
                    deadline: type(uint64).max,
                    nonce: 1
                });
            (reentrySucceeded,) = router.call(
                abi.encodeCall(IMintShieldRouter.execute, (nested))
            );
        }
        return super.transferFrom(from, to, value);
    }
}
