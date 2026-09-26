# World Inheritance

World App에서 동작하는 WLD 상속 금고 Mini App입니다. 사용자가 금고 컨트랙트를 만들고
WLD를 입금한 뒤, 정해진 기간 동안 생존 신호(ping)를 보내지 않으면 상속인이 잔액을 수령합니다.

```
app/        World App Mini App (React + Vite + MiniKit)
contracts/  상속 금고 / 팩토리 Solidity 컨트랙트 (Foundry)
backend/    푸시 알림용 Cloudflare Worker (선택)
docs/       World App 심사 대응 문서
script/     배포 스크립트
test/       Foundry 테스트
```

## 핵심 규칙

상속이 의미를 가지려면 **만기 이후 소유자의 권한이 완전히 정지**해야 합니다.

| 호출 | 만기 전 | 만기 후 |
| --- | --- | --- |
| `ping` | 가능 | 불가 (`Expired`) |
| `updateHeir` / `updateHeartbeat` / `cancelInheritance` | 가능 | 불가 (`Expired`) |
| `ownerWithdrawWLD` | 가능 | 불가 (`Expired`) |
| `claim` | 불가 | **누구나 가능** |

이 규칙이 없으면 소유자가 만기 직전에 `ping` 로 금고를 되살리거나, `updateHeir` 로
상속인을 자기 자신으로 바꾼 뒤 `claim` 해서 전액을 되가져갈 수 있습니다.

`claim` 은 실행 직후 금고를 최종 상태로 만듭니다(`claimed` 플래그, 상속인 초기화).
그래야 나중에 들어온 입금이 상속인이 아닌 누구에게 다시 sweep되지 않습니다.

## 빠른 시작

### 1. 컨트랙트

```shell
forge build
forge test        # 72 tests
```

로컬 체인에서 테스트 토큰을 배포하려면 `CHAIN_ID=31337` 이 강제됩니다.

```shell
anvil
WLD_ADDRESS=<token addr> CHAIN_ID=31337 forge script script/DeployTestToken.s.sol:DeployTestToken --rpc-url http://127.0.0.1:8545 --private-key <anvil key>
WLD_ADDRESS=<token addr> forge script script/DeployWLDFactory.s.sol:DeployWLDFactory --rpc-url http://127.0.0.1:8545 --private-key <anvil key>
```

### 2. Mini App

```shell
cp app/.env.example app/.env
# VITE_FACTORY_ADDRESS, VITE_WLD_ADDRESS, VITE_FACTORY_DEPLOY_BLOCK 입력
pnpm --dir app install
pnpm --dir app dev
```

`.env` 가 없거나 주소 형식이 틀리면 흰 화면 대신 설정 안내 화면이 표시됩니다.

배포 후에는 반드시 아래 두 값을 맞출 것:

- `VITE_FACTORY_ADDRESS` — 배포된 팩토리 주소
- `VITE_FACTORY_DEPLOY_BLOCK` — `broadcast/<ChainId>/<Block>/run-latest.json` 의
  `receipt.blockNumber`. 부정확하면 `VaultCreated` 로그 조회가 틀려서
  상속인 금고 탐색이 누락됩니다.

### 3. 알림 백엔드 (선택)

`VITE_NOTIFY_BACKEND_URL` 이 비어 있으면 알림 카드 전체가 비활성화됩니다.
자세한 내용은 [`backend/README.md`](backend/README.md) 참고.

## 검증 명령어

```shell
forge fmt --check          # 포맷
forge test -vvv            # 컨트랙트 테스트
pnpm --dir app typecheck   # 타입
pnpm --dir app lint        # 린트
pnpm --dir app build       # 프로덕션 빌드
```

모두 `.github/workflows/ci.yml` 에서 자동 실행됩니다.

## 컨트랙트 구성

| 컨트랙트 | 역할 |
| --- | --- |
| `InheritanceVaultWLD` | WLD 전용 상속 금고. 펙토리가 생성합니다. |
| `InheritanceVaultWLDFactoryOnePerOwner` | 주소당 금고 1개 강제. 슬롯 해제 지원. |
| `InheritanceVaultTokens` | 허용목록 기반 다중 토큰 금고 (현재 UI 미연결). |
| `InheritanceVaultTokensFactoryOnePerOwner` | 위 금고의 팩토리. |
| `SafeERC20Lib` | 반환값 없는 비표준 토큰(USDT 스타일) 처리. |

입금은 `deposit()` 없이 ERC20 `transfer` 로 금고 주소에 직접 보내는 방식입니다.

## 알아둘 점

- ETH 는 상속 대상이 아닙니다. `receive` 가 revert 하므로 정상 입금이 불가능하고,
  `SELFDESTRUCT` 로 강제 입금된 ETH 만 `sweepEth` 로 회수할 수 있습니다.
- 상속 대상이 아닌 오입금 ERC20 은 만기 후에도 `ownerRescueUnknownERC20` 로 회수할 수
  있습니다. (만기 후 회수 경로가 없으면 잘못 전송된 토큰이 영구히 잠깁니다.)
- WLD 금고는 만기 후 소유자가 `ping` 할 수 없습니다. 되살리기를 허용하면 상속이 무의미해집니다.
- 금고는 주소당 1개입니다. 새 금고가 필요하면 만기 후 잔액을 비운 뒤
  `releaseMyVault()` 로 슬롯을 해제해야 합니다.

## 문서

- [`docs/REVIEW_NOTES.md`](docs/REVIEW_NOTES.md) — World App 심사 대응 및 결정 사항
- [`docs/QA_CHECKLIST.md`](docs/QA_CHECKLIST.md) — 출시 전 점검 목록
- [Foundry 문서](https://book.getfoundry.sh/)
