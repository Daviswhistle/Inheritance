// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";

/// @notice 로컬 anvil 환경에서 테스트할 토큰 배포용.
/// @dev 프로덕션에서 쓰는 WLD 배포가 아니므로 반드시 로컬 체인에서만 실행할 것.
///      스크립트는 실수 방지를 위해 PRIVATE_KEY 와 CHAIN_ID 를 모두 요구한다.
contract DeployTestToken is Script {
    function run() external returns (address addr) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        uint256 chainId = vm.envUint("CHAIN_ID");
        require(chainId == 31337, "refusing to deploy test token on a live chain (CHAIN_ID must be 31337)");

        vm.startBroadcast(pk);
        MockERC20 t = new MockERC20("Worldcoin", "WLD");
        addr = address(t);
        vm.stopBroadcast();

        console2.log("TEST TOKEN:", addr);
    }
}
