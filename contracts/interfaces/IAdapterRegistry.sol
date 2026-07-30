// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IAdapterRegistry {
    struct AdapterConfig {
        address implementation;
        address asset;
        bytes32 codeHash;
        uint256 maxAmount;
        uint64 version;
        bool enabled;
    }

    function getAdapter(bytes32 adapterId)
        external
        view
        returns (AdapterConfig memory config);
}
