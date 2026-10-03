// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Stores one inert chunk of creation bytecode as STOP-prefixed runtime data.
contract CreationCodePart {
    error PartTooLarge();

    constructor(bytes memory contents) {
        // The leading STOP makes this bytecode inert if it is ever called.
        if (contents.length > 24_575) revert PartTooLarge();
        bytes memory runtimeCode = abi.encodePacked(hex"00", contents);
        assembly ("memory-safe") {
            return(add(runtimeCode, 0x20), mload(runtimeCode))
        }
    }
}

/// @notice Deploys immutable code-data parts and reconstructs fixed child creation code.
/// This is an internal helper: the only create surface remains each fixed factory deployer.
library ImmutableCreationCode {
    error CreationCodeTooLarge();
    error CreationFailed();

    function store(bytes memory creationCode)
        internal
        returns (address firstPart, address secondPart, uint256 firstLength)
    {
        if (creationCode.length == 0 || creationCode.length > 49_150) revert CreationCodeTooLarge();
        firstLength = (creationCode.length + 1) / 2;
        uint256 secondLength = creationCode.length - firstLength;
        bytes memory first = new bytes(firstLength);
        bytes memory second = new bytes(secondLength);
        // Copy full words into the padded byte buffers. Per-byte Solidity loops
        // unnecessarily charge millions of gas during a factory deployment.
        assembly ("memory-safe") {
            let source := add(creationCode, 0x20)
            let firstData := add(first, 0x20)
            for { let i := 0 } lt(i, firstLength) { i := add(i, 0x20) } {
                mstore(add(firstData, i), mload(add(source, i)))
            }
            let secondData := add(second, 0x20)
            source := add(source, firstLength)
            for { let i := 0 } lt(i, secondLength) { i := add(i, 0x20) } {
                mstore(add(secondData, i), mload(add(source, i)))
            }
        }
        firstPart = address(new CreationCodePart(first));
        secondPart = address(new CreationCodePart(second));
    }

    function create(
        address firstPart,
        address secondPart,
        uint256 creationLength,
        uint256 firstLength,
        bytes memory constructorArgs
    ) internal returns (address child) {
        uint256 totalLength = creationLength + constructorArgs.length;
        uint256 secondLength = creationLength - firstLength;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            extcodecopy(firstPart, ptr, 1, firstLength)
            extcodecopy(secondPart, add(ptr, firstLength), 1, secondLength)
            let argsLength := mload(constructorArgs)
            let argsPtr := add(constructorArgs, 0x20)
            for { let offset := 0 } lt(offset, argsLength) { offset := add(offset, 0x20) } {
                mstore(add(add(ptr, creationLength), offset), mload(add(argsPtr, offset)))
            }
            child := create(0, ptr, totalLength)
            if iszero(child) {
                let revertSize := returndatasize()
                if gt(revertSize, 0) {
                    returndatacopy(0, 0, revertSize)
                    revert(0, revertSize)
                }
            }
            mstore(0x40, and(add(add(ptr, totalLength), 0x3f), not(0x1f)))
        }
        if (child == address(0)) revert CreationFailed();
    }
}
