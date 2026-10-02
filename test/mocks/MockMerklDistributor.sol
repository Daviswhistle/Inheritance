// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "../../contracts/interfaces/IERC20Minimal.sol";

/// @notice Local proof/funding fixture, not a claim of campaign eligibility.
/// Matches Merkl's cumulative leaf and sorted proof hashing and self-claim rule.
contract MockMerklDistributor {
    error InvalidProof();
    error NotWhitelisted();

    bytes32 public root;
    mapping(address => mapping(address => uint256)) public claimed;
    mapping(address => bool) public operators;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackSucceeded;

    function setRoot(bytes32 next) external {
        root = next;
    }

    function setOperator(address account, bool enabled) external {
        operators[account] = enabled;
    }

    function setCallback(address target, bytes memory data) external {
        callbackTarget = target;
        callbackData = data;
    }

    function claim(
        address[] calldata users,
        address[] calldata tokens,
        uint256[] calldata amounts,
        bytes32[][] calldata proofs
    ) external {
        require(users.length == 1 && tokens.length == 1 && amounts.length == 1 && proofs.length == 1, "lengths");
        if (users[0] != msg.sender && !operators[msg.sender]) revert NotWhitelisted();
        bytes32 leaf = keccak256(abi.encode(users[0], tokens[0], amounts[0]));
        for (uint256 i; i < proofs[0].length; ++i) {
            bytes32 sibling = proofs[0][i];
            leaf = leaf < sibling ? keccak256(abi.encode(leaf, sibling)) : keccak256(abi.encode(sibling, leaf));
        }
        if (leaf != root || root == bytes32(0)) revert InvalidProof();
        uint256 amount = amounts[0] - claimed[users[0]][tokens[0]];
        claimed[users[0]][tokens[0]] = amounts[0];
        if (amount != 0) require(IERC20(tokens[0]).transfer(users[0], amount), "funding");
        if (callbackTarget != address(0)) (callbackSucceeded,) = callbackTarget.call(callbackData);
    }
}
