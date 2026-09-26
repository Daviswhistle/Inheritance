// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {TestToken} from "../contracts/TestToken.sol";

contract DeployTestToken is Script {
    function run() external returns (address addr) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);
        TestToken t = new TestToken(1_000_000 ether);
        addr = address(t);
        vm.stopBroadcast();
        console2.log("TOKEN:", addr);
    }
}
