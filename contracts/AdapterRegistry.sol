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
    error NoPendingAdapterChange(bytes32 adapterId);
    error AdapterTimelockNotElapsed(bytes32 adapterId, uint64 effectiveAt);

    event AdapterConfigured(
        bytes32 indexed adapterId,
        address indexed implementation,
        address indexed asset,
        bytes32 codeHash,
        uint256 maxAmount,
        uint64 version,
        bool enabled
    );
    event AdapterChangeProposed(
        bytes32 indexed adapterId,
        address indexed implementation,
        address indexed asset,
        uint256 maxAmount,
        bool enabled,
        uint64 effectiveAt
    );
    event AdapterChangeCancelled(bytes32 indexed adapterId);
    event AdapterEnabled(bytes32 indexed adapterId, bool enabled);

    struct PendingAdapterConfig {
        address implementation;
        address asset;
        uint256 maxAmount;
        bool enabled;
        uint64 effectiveAt;
    }

    /// @notice Minimum wait between proposing and activating a change to an
    /// adapter that is already live, so a payment already in flight against
    /// the current implementation cannot be settled against a swapped-in one.
    /// A brand-new adapterId's first configuration is exempt: nothing can be
    /// depending on it yet, so it takes effect immediately.
    uint256 public constant ADAPTER_CHANGE_DELAY = 15 minutes;

    mapping(bytes32 adapterId => AdapterConfig config) private adapters;
    mapping(bytes32 adapterId => PendingAdapterConfig pending)
        private pendingAdapters;

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Configures an adapter. The first configuration of a given
    /// adapterId applies immediately. Any later change to an already-live
    /// adapterId is only scheduled here; it becomes active after
    /// ADAPTER_CHANGE_DELAY via activateAdapter().
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

        if (adapters[adapterId].version == 0) {
            _applyAdapterConfig(
                adapterId, implementation, asset, maxAmount, enabled
            );
            return;
        }

        uint64 effectiveAt = uint64(block.timestamp + ADAPTER_CHANGE_DELAY);
        pendingAdapters[adapterId] = PendingAdapterConfig({
            implementation: implementation,
            asset: asset,
            maxAmount: maxAmount,
            enabled: enabled,
            effectiveAt: effectiveAt
        });
        emit AdapterChangeProposed(
            adapterId, implementation, asset, maxAmount, enabled, effectiveAt
        );
    }

    /// @notice Applies a pending adapter change once its timelock has
    /// elapsed. Callable by anyone so activation cannot be selectively
    /// withheld by the owner once it is due.
    function activateAdapter(bytes32 adapterId) external {
        PendingAdapterConfig memory pending = pendingAdapters[adapterId];
        if (pending.effectiveAt == 0) revert NoPendingAdapterChange(adapterId);
        if (block.timestamp < pending.effectiveAt) {
            revert AdapterTimelockNotElapsed(adapterId, pending.effectiveAt);
        }
        delete pendingAdapters[adapterId];
        _applyAdapterConfig(
            adapterId,
            pending.implementation,
            pending.asset,
            pending.maxAmount,
            pending.enabled
        );
    }

    /// @notice Cancels a pending adapter change before it activates.
    function cancelAdapterChange(bytes32 adapterId) external onlyOwner {
        if (pendingAdapters[adapterId].effectiveAt == 0) {
            revert NoPendingAdapterChange(adapterId);
        }
        delete pendingAdapters[adapterId];
        emit AdapterChangeCancelled(adapterId);
    }

    function _applyAdapterConfig(
        bytes32 adapterId,
        address implementation,
        address asset,
        uint256 maxAmount,
        bool enabled
    )
        private
    {
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

    /// @notice Enables or disables an adapter immediately, with no timelock.
    /// Disabling is a fail-safe kill switch and must not be delayed; only
    /// re-pointing an adapterId at new code goes through configureAdapter's
    /// timelock.
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

    function getPendingAdapter(bytes32 adapterId)
        external
        view
        returns (PendingAdapterConfig memory pending)
    {
        return pendingAdapters[adapterId];
    }
}
