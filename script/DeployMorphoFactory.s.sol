// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {InheritanceVaultMorphoFactory} from "../contracts/InheritanceVaultMorphoFactory.sol";

/// @notice Dry-run by default. Broadcasting a new fee-bearing strategy is a
/// separate release action, never an implicit migration of existing vaults.
contract DeployMorphoFactory is Script {
    function run() external returns (address) {
        address wld = vm.envAddress("WLD_ADDRESS");
        address strategy = vm.envAddress("MORPHO_VAULT_ADDRESS");
        address feeRecipient = vm.envAddress("YIELD_FEE_RECIPIENT");
        uint256 fee = vm.envOr("YIELD_PERFORMANCE_FEE_BPS", uint256(1000));
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        InheritanceVaultMorphoFactory factory = new InheritanceVaultMorphoFactory(wld, strategy, feeRecipient, fee);
        vm.stopBroadcast();
        console2.log("YIELD_FACTORY:", address(factory));
        console2.log("MORPHO_VAULT:", strategy);
        console2.log("PERFORMANCE_FEE_BPS:", fee);
        console2.log("FEE_RECIPIENT:", feeRecipient);
        return address(factory);
    }
}
