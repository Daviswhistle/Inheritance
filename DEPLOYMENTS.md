# 배포 기록

앱이 실제로 대화하는 주소를 한 곳에 모았습니다. 여기 없는 주소가 코드나 저장소 변수에
들어 있으면 그 앱은 트랜잭션을 보낼 수 없습니다.

## 메인넷 (World Chain, chainId 480)

| 항목 | 값 |
|---|---|
| 팩토리 | `0xF7BeEDDeB8bE1DbC4Bd8768fC3f1e513DD6C1d88` |
| 배포 블록 | `35672936` |
| WLD | `0x2cfc85d8e48f8eab294be644d9e25c3030863003` |
| 배포 tx | `0x6674f81c833de535b13c4e2d450d8441e2c7f7d0d548c36c5c1f606ea4140cf6` |
| 런타임 코드 | 11307 바이트 (forge 아티팩트와 불변 제외 바이트 단위 일치 확인) |

앱이 트랜잭션을 보내는 주소는 이 둘뿐입니다. World App 은 allowlist 에 없는
주소로의 호출을 막으므로, 사용자마다 다른 금고 주소는 직접 호출할 수 없고 팩토리가
`vaultOf` 로 호출자를 다시 뽑아 라우팅합니다.

## 교체한 팩토리

| 주소 | 상태 |
|---|---|
| `0xF7BeEDDeB8bE1DbC4Bd8768fC3f1e513DD6C1d88` | 현재 사용 중 |
| `0x39721e856f5efa361b6428f056D437124F70C55E` | 폐기. 금고 0개라 교체 비용 없었음 |

`broadcast/DeployWLDFactory.s.sol/480/run-latest.json` 은 **여전히 폐기된 주소를
가리킨다** — 현재 배포가 `forge script` 이 아니라 수동 서명 Broadcast 로 이루어졌기
때문이다(아래 참고). 그 파일을 "최신 배포"로 읽지 말 것.

## 팩토리를 교체할 때

네 곳을 **같이** 갱신해야 합니다. 하나만 빼먹으면 이벤트 조회 `fromBlock` 이 틀려
금고 목록이 조용히 비어 보이거나, allowlist 스크립트가 옛 주소를 되살립니다.

1. `app/.env` — `VITE_FACTORY_ADDRESS`, `VITE_FACTORY_DEPLOY_BLOCK`
2. GitHub 저장소 변수 — 같은 두 개 (`gh variable set`)
3. `app/.env.example` — 같은 두 개
4. `scripts/portal-allowlist.py` — 하드코딩된 `FACTORY`

그리고 포털 allowlist 를 교체하고, `scripts/verify/run.sh mainnet` 으로 읽기 경로를
확인합니다.

## 배포는 왜 `forge script` 로 하지 않나

`forge script … --broadcast` 는 시뮬레이션을 먼저 하고 거기에 아카이브 상태가
필요합니다. 공개 World Chain RPC 로는 전부 실패합니다 (HTTP 500 또는 fork 불가).
그래서 실제 배포는 `scripts/deploy-factory.mjs` 로 합니다 — 서명 후 여러 엔드포인트로
순차 전송하고, **온체인 런타임 코드를 아티팩트와 바이트 단위로 대조**합니다.
리ceipt 가 왔다는 것과 옳은 코드가 올라갔다는 것은 다릅니다.

```
node scripts/deploy-factory.mjs            # 실제 배포
DRY_RUN=1 node scripts/deploy-factory.mjs  # 서명까지만
```

## 공개 RPC 를 신뢰하지 말 것

`estimateGas` 가 CREATE 에 대해 실제값의 **1/27** 을 돌려준 적이 있습니다
(54,406 vs 실제 1,452,293). 그 값에 맞춰 gasLimit 을 잡으면 out-of-gas 로 revert
됩니다. 배포 스크립트는 gasLimit 을 고정값(300만)으로 줍니다.
