// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Local-only delegated account fixture for MiniKit's atomic transaction batch.
/// EIP-7702 keeps the authenticated EOA address as the caller of every target.
contract MockWorldAppWallet {
    struct Call {
        address to;
        bytes data;
        uint256 value;
    }

    function execute(Call[] calldata calls) external payable {
        require(msg.sender == address(this), "only self");
        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory result) = calls[i].to.call{value: calls[i].value}(calls[i].data);
            if (!ok) {
                assembly ("memory-safe") {
                    revert(add(result, 32), mload(result))
                }
            }
        }
    }
}
