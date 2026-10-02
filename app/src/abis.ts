import type { InterfaceAbi } from "ethers";

/*
 * 이 앱이 두는 컨트랙트 ABI.
 *
 * World App 은 허용된 주소만 호출할 수 있어서 모든 사용자 조작이 팩토리(`*For`)를
 * 거친다. 그래도 금고(`InheritanceVaultWLD`)의 revert 가 그대로 올라오므로 두 ABI 를
 * 모두 쓴다 — `errors.ts` 가 revert 를 해독할 때도 둘이 필요하다.
 *
 * 커스텀 에러 항목은 `abi-errors.ts`(자동 생성)에서 가져온다. 예전에 여기에 error
 * 항목이 하나도 없어서 ethers 가 revert 를 이름으로 디코딩하지 못하고 셀렉터만
 * 사용자에게 보여줬다.
 */

import { VAULT_ERROR_ABI, FACTORY_ERROR_ABI } from "./abi-errors";

export const FACTORY_ABI = [
  "event VaultCreated(address indexed owner, address indexed heir, address vault, uint256 heartbeatInterval)",
  "event VaultReleased(address indexed owner, address indexed vault)",
  "function createVault(address heir, uint256 heartbeatInterval) external returns (address)",
  "function vaultOf(address owner) external view returns (address)",
  "function myVault() external view returns (address)",
  "function releaseMyVault() external returns (bool)",
  "function deposit(uint256 amount) external",
  "function pingMyVault() external",
  "function updateMyHeir(address newHeir) external",
  "function changeMyPeriod(uint256 newInterval) external",
  "function cancelMyInheritance() external",
  "function withdrawFromMyVault(address to, uint256 amount) external",
  "function rescueFromMyVault(address token, uint256 amount, address to) external",
  "function sweepSettledVaultFor(address to) external",
  "function fileClaimFor(address vault) external",
  "function finalizeClaimFor(address vault) external",
  "function isHeirOf(address owner, address vault) external view returns (bool)",
  ...FACTORY_ERROR_ABI,
] satisfies InterfaceAbi;

export const VAULT_ABI: InterfaceAbi = [
  "function WLD() view returns (address)",
  "function heir() view returns (address)",
  "function owner() view returns (address)",
  "function factory() view returns (address)",
  "function heartbeatInterval() view returns (uint256)",
  "function lastPing() view returns (uint256)",
  "function deadline() view returns (uint256)",
  "function claimFiledAt() view returns (uint256)",
  "function claimedAt() view returns (uint256)",
  "function CHALLENGE_PERIOD() view returns (uint256)",
  // 만료만으로는 자금이 움직이지 않는다. 아래 세 함수가 상속의 단계를 나타낸다.
  "function ownerStillActive() view returns (bool)",
  "function isExpired() view returns (bool)",
  "function claimPending() view returns (bool)",
  "function challengeRunning() view returns (bool)",
  "function claimableNow() view returns (bool)",
  "function challengeEndsAt() view returns (uint256)",
  "function inheritanceCancelled() view returns (bool)",
  "function timeRemaining() view returns (uint256)",
  "function isSettled() view returns (bool)",
  ...VAULT_ERROR_ABI,
];
