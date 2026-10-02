// 자동 생성 파일입니다. 직접 고치지 마세요 — scripts/gen-abi-errors.mjs 가 씁니다.
//
// 컨트랙트의 커스텀 에러 ABI. App.tsx 의 FACTORY_ABI / VAULT_ABI 에 붙이면 ethers 가
// revert 를 이름으로 디코딩합니다(Expired, VaultNotEmpty, NotHeir …). 이것이 없으면
// 4바이트 셀렉터만 보여주고 사용자는 무엇을 해야 하는지 알 수 없습니다.
//
// 생성: forge build && node scripts/gen-abi-errors.mjs
// 검증: node scripts/gen-abi-errors.mjs --check

/** InheritanceVaultWLD 의 커스텀 에러 17종. */
export const VAULT_ERROR_ABI = [
  {
    type: "error",
    name: "AlreadyClaimed",
  },
  {
    type: "error",
    name: "AlreadyFiled",
  },
  {
    type: "error",
    name: "ChallengeStillRunning",
  },
  {
    type: "error",
    name: "EthNotAccepted",
  },
  {
    type: "error",
    name: "EthTransferFailed",
  },
  {
    type: "error",
    name: "Expired",
  },
  {
    type: "error",
    name: "HeartbeatOutOfRange",
  },
  {
    type: "error",
    name: "InvalidAddress",
  },
  {
    type: "error",
    name: "NotExpiredYet",
  },
  {
    type: "error",
    name: "NotHeir",
  },
  {
    type: "error",
    name: "NotOwner",
  },
  {
    type: "error",
    name: "NotSettled",
  },
  {
    type: "error",
    name: "NothingToTransfer",
  },
  {
    type: "error",
    name: "Reentrancy",
  },
  {
    type: "error",
    name: "TokenCallFailed",
    inputs: [
    { name: "reason", type: "bytes" },
    ],
  },
  {
    type: "error",
    name: "TokenTransferFailed",
  },
  {
    type: "error",
    name: "WldOnly",
  },
];

/** InheritanceVaultWLDFactoryOnePerOwner 만에 있는 커스텀 에러 6종. */
export const FACTORY_ERROR_ABI = [
  {
    type: "error",
    name: "AlreadyHasVault",
  },
  {
    type: "error",
    name: "NoVault",
  },
  {
    type: "error",
    name: "NotAContract",
  },
  {
    type: "error",
    name: "NotExpired",
  },
  {
    type: "error",
    name: "NotOurVault",
  },
  {
    type: "error",
    name: "VaultNotEmpty",
  },
];

/** Additional opt-in yield contract errors. */
export const YIELD_VAULT_ERROR_ABI = [
  {
    type: "error",
    name: "InvalidAmount",
  },
  {
    type: "error",
    name: "InvalidFee",
  },
  {
    type: "error",
    name: "InvalidRewards",
  },
  {
    type: "error",
    name: "InvalidStrategy",
  },
  {
    type: "error",
    name: "MulDivOverflow",
  },
  {
    type: "error",
    name: "ProtectedToken",
  },
  {
    type: "error",
    name: "SlippageExceeded",
  },
];
export const YIELD_FACTORY_ERROR_ABI = [

];

/**
 * 커스텀 에러 이름 → 어느 계약의 것인지.
 *
 * InvalidAddress / NotOwner / NotHeir / TokenCallFailed / TokenTransferFailed 는 두
 * 계약에 모두 있다. 화면 문장은 이름만으로 정하므로 어느 계약에서 났는지는 알 필요가
 * 없고, 이 표는 사람이 문장을 고를 때 참조용이다.
 */
export const ERROR_SOURCE_BY_NAME: Record<string, "vault" | "factory"> = {
  "AlreadyClaimed": "vault",
  "AlreadyFiled": "vault",
  "ChallengeStillRunning": "vault",
  "EthNotAccepted": "vault",
  "EthTransferFailed": "vault",
  "Expired": "vault",
  "HeartbeatOutOfRange": "vault",
  "InvalidAddress": "vault",
  "NotExpiredYet": "vault",
  "NotHeir": "vault",
  "NotOwner": "vault",
  "NotSettled": "vault",
  "NothingToTransfer": "vault",
  "Reentrancy": "vault",
  "TokenCallFailed": "vault",
  "TokenTransferFailed": "vault",
  "WldOnly": "vault",
  "AlreadyHasVault": "factory",
  "NoVault": "factory",
  "NotAContract": "factory",
  "NotExpired": "factory",
  "NotOurVault": "factory",
  "VaultNotEmpty": "factory",
  "InvalidAmount": "vault",
  "InvalidFee": "vault",
  "InvalidRewards": "vault",
  "InvalidStrategy": "vault",
  "MulDivOverflow": "vault",
  "ProtectedToken": "vault",
  "SlippageExceeded": "vault",
};
