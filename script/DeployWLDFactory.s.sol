// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../contracts/InheritanceVaultWLDFactoryOnePerOwner.sol";

contract DeployWLDFactory is Script {
    function run() external returns (address addr) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address wld = vm.envAddress("WLD_ADDRESS"); // 0x2cfc85... (World Chain)
        vm.startBroadcast(pk);
        InheritanceVaultWLDFactoryOnePerOwner f = new InheritanceVaultWLDFactoryOnePerOwner(wld);
        vm.stopBroadcast();
        addr = address(f);
        console2.log("FACTORY:", addr);
    }
}
