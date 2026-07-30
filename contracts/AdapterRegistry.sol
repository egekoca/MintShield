// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IAdapterRegistry} from "./interfaces/IAdapterRegistry.sol";

contract AdapterRegistry is IAdapterRegistry, Ownable2Step {
    error InvalidAdapterId();
    error InvalidImplementation(address implementation);
    error InvalidAsset();
    error InvalidMaxAmount();
    error AdapterNotConfigured(bytes32 adapterId);

    event AdapterConfigured(
        bytes32 indexed adapterId,
        address indexed implementation,
        address indexed asset,
        bytes32 codeHash,
        uint256 maxAmount,
        uint64 version,
        bool enabled
    );
    event AdapterEnabled(bytes32 indexed adapterId, bool enabled);

    mapping(bytes32 adapterId => AdapterConfig config) private adapters;

    constructor(address initialOwner) Ownable(initialOwner) {}

    function configureAdapter(
        bytes32 adapterId,
        address implementation,
        address asset,
        uint256 maxAmount,
        bool enabled
    )
        external
        onlyOwner
    {
        if (adapterId == bytes32(0)) revert InvalidAdapterId();
        if (implementation.code.length == 0) {
            revert InvalidImplementation(implementation);
        }
        if (asset == address(0)) revert InvalidAsset();
        if (maxAmount == 0) revert InvalidMaxAmount();

        AdapterConfig storage current = adapters[adapterId];
        uint64 nextVersion = current.version + 1;
        bytes32 codeHash = implementation.codehash;
        adapters[adapterId] = AdapterConfig({
            implementation: implementation,
            asset: asset,
            codeHash: codeHash,
            maxAmount: maxAmount,
            version: nextVersion,
            enabled: enabled
        });

        emit AdapterConfigured(
            adapterId,
            implementation,
            asset,
            codeHash,
            maxAmount,
            nextVersion,
            enabled
        );
    }

    function setAdapterEnabled(bytes32 adapterId, bool enabled)
        external
        onlyOwner
    {
        AdapterConfig storage config = adapters[adapterId];
        if (config.implementation == address(0)) {
            revert AdapterNotConfigured(adapterId);
        }
        config.enabled = enabled;
        emit AdapterEnabled(adapterId, enabled);
    }

    function getAdapter(bytes32 adapterId)
        external
        view
        returns (AdapterConfig memory config)
    {
        return adapters[adapterId];
    }
}
