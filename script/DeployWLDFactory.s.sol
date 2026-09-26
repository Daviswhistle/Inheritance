// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {InheritanceVaultWLDFactoryOnePerOwner} from "../contracts/InheritanceVaultWLDFactoryOnePerOwner.sol";

/// @notice WLD 상속 금고 팩토리 배포.
/// @dev 배포 후 출력되는 factory address 와 배포 블록을 `app/.env` 의
///      VITE_FACTORY_ADDRESS / VITE_FACTORY_DEPLOY_BLOCK 에 반드시 맞춰줄 것.
///      (deploy block 은 broadcast 로그의 receipt.blockNumber 에서 확인할 수 있다)
contract DeployWLDFactory is Script {
    function run() external returns (address addr) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address wld = vm.envAddress("WLD_ADDRESS"); // 0x2cfc85... (World Chain)

        // EOA 를 넘기면 컨트랙트가 배포 단계에서 NotAContract 로 거부한다.
        require(wld.code.length > 0, "WLD_ADDRESS is not a contract");

        vm.startBroadcast(pk);
        InheritanceVaultWLDFactoryOnePerOwner f = new InheritanceVaultWLDFactoryOnePerOwner(wld);
        vm.stopBroadcast();
        addr = address(f);

        console2.log("FACTORY:", addr);
        console2.log("WLD:", wld);
    }
}
