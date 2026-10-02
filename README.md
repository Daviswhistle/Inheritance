# Inheritance

[Live app](https://inheritance.pages.dev/) · WLD를 선택한 사람에게 남기는 World App 미니앱입니다.
소유자가 타이머를 갱신하는 동안 자금을 관리합니다. 갱신을 멈추면 상속인이 신청하고,
7일 검토 기간 뒤 지정된 주소로 이체할 수 있습니다. 새 금고는 등록된 서버 감시가
자동 이체를 실행하며, 상속인의 수동 수령도 가능합니다.

## WLD 금고의 실제 규칙

| 단계 | 소유자 | 지정된 상속인 | 자동 실행 서비스 |
| --- | --- | --- | --- |
| 타이머 유효 | 갱신, 기간·상속인 변경, 출금, 상속 취소 | 신청 불가 | 이체 불가 |
| 타이머 만료 | 갱신 가능. 갱신 후 관리·출금 가능 | 신청 가능 | 신청을 대신하지 않음 |
| 신청 후 7일 | 갱신으로 신청 취소 가능 | 기다림 | 이체 불가 |
| 7일 경과, 미정산 | 실제 이체 전까지 갱신으로 취소 가능 | 수동 수령 가능 | 새 금고의 정해진 상속인에게만 이체 가능 |
| 정산 완료 | 잔여 WLD 회수, 빈 슬롯 해제 | 완료 | 재이체 불가 |

타이머 종료는 사망 확인이 아닙니다. 법적 유언장이나 신원·상속권 판단을 제공하지 않습니다.
거래 순서에 따라 소유자의 갱신과 만기 후 실행 중 먼저 확정된 것이 적용됩니다.
자동 실행은 감시 등록, 서버·RPC 가용성, 가스 잔액 및 지출 한도를 필요로 합니다.
정확히 7일째의 실행이나 알림 도착을 보장하지 않습니다. 독립 외부 보안 감사는 없습니다.

## 구성과 신뢰 경계

- `app/`: React/Vite/MiniKit 화면 및 Pages SIWE 인증 함수.
- `contracts/InheritanceVaultWLD*.sol`: 현재 WLD 전용 금고 및 주소당 하나의 금고를 관리하는 팩토리.
- `backend/`: Cloudflare D1을 공유하는 인증된 알림 API와 제한된 자동 실행기.
- `test/`, `scripts/verify/`: 계약 검증 및 실제 로컬 체인·브라우저 검증.
- `DEPLOYMENTS.md`: 배포 주소, 블록과 실제 거래 기록.

소유자·상속인 키는 서버에 전송하지 않습니다. WLD는 사용자별 금고 컨트랙트에 보관됩니다.
자동 실행기의 전용 키는 가스만 지급하며 수령자를 바꾸거나 활성 소유자 자금을 인출할 권한이 없습니다.
새 팩토리는 임의 호출자의 `executeInheritance(vault)`도 허용하지만 금고 소속과 계약 조건을 확인합니다.
기존 팩토리의 금고는 기존 주소와 수동 수령 경로를 그대로 사용합니다.
다중 토큰 계약은 현재 UI와 운영 배포의 대상이 아닙니다.

## 로컬 실행

```sh
npm ci
pnpm --dir app install --frozen-lockfile
cp app/.env.example app/.env
# 로컬 팩토리·토큰·RPC 주소를 app/.env에 지정
pnpm --dir app dev
```

실제 World App 지갑 쓰기는 MiniKit 브리지 안에서만 가능합니다. 일반 브라우저는 공개 안내와
World App 열기 링크를 표시합니다. `scripts/verify/run.sh all`은 별도 E2E 설정으로
Anvil 테스트 체인, 실제 Pages 서명 검증 핸들러와 브라우저를 실행합니다.

## 검증과 배포

```sh
forge fmt --check
forge test
node scripts/gen-abi-errors.mjs --check
pnpm --dir app typecheck
pnpm --dir app lint
pnpm --dir app build
node scripts/test-notify-auth.mjs
node scripts/test-notify-alerts.mjs
node scripts/test-notify-db.mjs
node scripts/test-transaction-confirmation.mjs
node scripts/test-finalizer.mjs
scripts/verify/run.sh all
```

main push는 GitHub Actions로 Pages와 Worker를 배포합니다. 공유 D1 마이그레이션과
동일한 `SIWE_SECRET` 준비가 성공해야 두 배포가 실행됩니다. 공개 팩토리·토큰·기존
팩토리 주소와 블록은 저장소 변수 및 배포 설정에 일치시킵니다. 키는 비공개 secret에만 저장합니다.
프론트는 MiniKit 사용자 작업 해시를 공식 상태 API로 실제 거래 해시에 변환하고 성공 레시트를 확인합니다.

[백엔드 설정](backend/README.md), [보안 경계](SECURITY.md),
[심사 안내](docs/REVIEW_NOTES.md), [출시 검증](docs/QA_CHECKLIST.md),
[개인정보 처리](https://inheritance.pages.dev/privacy.html), [약관](https://inheritance.pages.dev/terms.html).

## 선택형 Morpho 수익 금고

별도 `InheritanceVaultMorphoFactory`는 WLD를 고정 ERC-4626 금고에 예치하고
개인 상속 금고가 예치 지분을 보유합니다. 출금 시 남은 납입 원금보다 증가한 부분에만
고정 성과 수수료 10%(계약 상한 10%)를 부과합니다. 관리 수수료는 없으며 기존 WLD 금고는
자동으로 변환하지 않습니다. 상속 때 현금 인출이 실패하면 예치 지분과 대기 WLD를
상속인에게 전달합니다. 지분 수수료와 이자·인센티브의 차이는 [설계와 활성화 조건](docs/MORPHO_YIELD.md)에 설명합니다.

프론트의 `VITE_YIELD_FACTORY_ADDRESS` / `VITE_MORPHO_VAULT_ADDRESS`를 함께
설정하기 전에는 기능이 비활성입니다. 로컬 구현·검증과 메인넷 계약 배포·서비스 활성화는
별도 단계입니다. 현재 기본 배포 주소를 새 팩토리로 덮어쓰지 않습니다.

```sh
forge build
node scripts/test-yield-abi.mjs
node scripts/verify/morpho-yield.mjs
MORPHO_FORK_RPC=https://worldchain-mainnet.g.alchemy.com/public forge test --match-contract MorphoWorldChainForkTest -vv
```
