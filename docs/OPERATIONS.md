# 독립 운영 모니터와 비용 보고서

## Watchdog Worker

`backend/watchdog.wrangler.toml`은 기존 Inheritance Worker와 분리된 Worker 설정입니다. `OPS_MONITOR` SQLite Durable Object 하나가 5분마다 고정된 production `/api/automation/health` endpoint를 읽습니다. URL은 코드의 allowlist와 완전히 일치해야 하며, HTTPS 외 URL, 사용자 정보, query, fragment, 다른 host/path는 거부됩니다. HTTP 공개 경로는 읽기 전용 `GET /api/health`뿐입니다. 이 경로는 저장된 monitor 상태만 반환하고 체크를 실행하지 않습니다.

운영 health 계약은 기존 `automation` 상태와 `automation.queue` 집계값입니다. 6분 넘은 executor cycle, 자동화 비활성/미지원, gas 부족, fee/daily cap, halt, 30분 넘은 pending transaction, 15분 넘은 due-check 지연과 연속 chain-read 오류를 감시합니다. Pending age는 최초 관측 이후 경과 시간이며 제출 시각을 추정하지 않습니다. Pending/queue age는 관련 집계 필드가 실제 응답에 있을 때만 판단합니다. 이전 runtime처럼 queue 값이 없으면 `not-yet-available`로 남기고 0으로 해석하지 않습니다.

첫 번째 연속 이상 샘플은 저장만 하고, 두 번째 연속 이상 샘플에서 incident를 만듭니다. 정상 응답도 두 번 연속 확인한 뒤 recovery를 보냅니다. SQLite outbox는 발송 의도와 시도 시각을 Telegram 호출 전에 저장합니다. 실패는 5분 뒤부터 재시도하며, 성공한 incident 알림의 반복 발송 간격은 최소 1시간입니다. 수락은 Telegram HTTP 성공과 응답의 `ok: true`를 모두 확인한 경우입니다. 이 방식은 프로세스 재시작과 동시 체크에서 로컬 중복을 막지만, Telegram이 메시지를 수락한 직후 응답이 유실된 경우 외부 API의 idempotency 지원 없이는 재전송 가능성을 없애지 못합니다.

배포 환경에는 secret `OPS_ALERT_TELEGRAM_TOKEN`과 `OPS_ALERT_TELEGRAM_CHAT_ID`를 별도로 설정합니다. 하나라도 없으면 공개 health의 `sinkConfigured`는 false, 전송 상태는 `not_configured`이며 메시지를 보냈다고 표시하지 않습니다. secret은 응답 본문, alert 문구, 로그에 넣지 않습니다. Telegram alert에는 일반 상태, `https://inheritance.pages.dev`, 집계 수만 들어갑니다. 문제 원인은 고정된 안전한 설명으로 표시하고 개별 vault, transaction hash, RPC 오류, RPC 주소는 포함하지 않습니다.

로컬 검사:

```sh
node scripts/test-ops-monitor.mjs
```

Wrangler dry-run은 저장소 의존성에 Wrangler가 설치된 환경에서 실행할 수 있습니다:

```sh
npx wrangler deploy --dry-run --config backend/watchdog.wrangler.toml
```

이 설정은 배포 승인이 아닙니다. 최종 배포 구성과 secret 설정은 운영자가 선택합니다.

## Realized fee와 operator expense 보고서

`scripts/ops-report.mjs`는 명시한 chain 480 block 범위와 설정에 입력한 vault만 조회합니다. vault는 설정된 trusted factory에서 왔는지, factory에 등록됐는지, WLD/USDC 및 reward token, strategy, fee recipient가 factory/vault에서 일치하는지 최종화된 상태로 검증합니다. 이벤트는 `PerformanceFeePaid`와 `RewardFeePaid`뿐입니다. 일반 principal transfer는 집계하지 않습니다. 알 수 없는 source, fee recipient, 통화, reorg, 미최종 블록은 오류로 기록하고 보고서를 incomplete로 만듭니다.

USDC vault의 `RewardFeePaid`는 WLD입니다. Performance fee의 WLD/USDC cash asset과 WLD reward fee는 별도 집계하고, `PerformanceFeePaid.shares`는 strategy별 receipt-share outflow로 따로 둡니다. receipt shares는 cash 합계에 더하지 않습니다. WLD는 18 decimals, USDC는 6 decimals를 on-chain에서 검증하고, share decimals는 각 strategy에서 읽습니다. 금액 원본은 BigInt raw units와 정확한 decimal 문자열로 출력합니다.

Expense는 사용자가 전달한 operator transaction hash receipt만 읽습니다. 성공/실패 receipt 모두 `gasUsed × effectiveGasPrice`를 비용으로 기록합니다. 개별 제출 영수증의 합계는 목록이 일부여도 따로 보이고, 해당 기간의 전체 비용 합계는 완전한 operator tx 목록을 지정했을 때만 나옵니다. chain 480의 L1/operator 추가 fee가 receipt나 inclusion-block oracle에서 확인되지 않으면 해당 값을 0으로 보정하지 않고 `null`로 두며 보고서를 incomplete로 표시합니다. `finalizer_budget` reservation은 지출로 취급하지 않습니다. 전체 operator tx 목록을 빠짐없이 제공했다고 설정하지 않으면 `netPnlEstimate`는 unavailable입니다.

명시한 기간의 USD net P&L 추정에는 WLD/USDC/ETH USD FX mark, mark 시각, 명시한 월간 server cost와 월, 해당 월 전체를 포함하는 finalized block 범위, 완전한 operator tx 목록이 모두 필요합니다. Receipt-share 값은 범위 끝 block의 `convertToAssets`로 계산한 추정치이며 현금 수입이 아닙니다. 모든 조건을 채워도 결과는 FX·share valuation 기반의 추정치입니다. 범위만 출력한 보고서는 lifetime 또는 한 달 전체 수익을 주장하지 않습니다.

설정 JSON 예시(모든 주소와 값은 실제 승인된 공개 주소·운영 입력으로 채웁니다):

```json
{
  "chainId": 480,
  "logPageSize": 90,
  "wldToken": "0x0000000000000000000000000000000000000001",
  "usdcToken": "0x0000000000000000000000000000000000000002",
  "trustedFactories": [
    { "address": "0x0000000000000000000000000000000000000003", "kind": "wld" },
    { "address": "0x0000000000000000000000000000000000000004", "kind": "usdc" }
  ],
  "vaults": [
    { "address": "0x0000000000000000000000000000000000000005", "factory": "0x0000000000000000000000000000000000000003", "kind": "wld" }
  ],
  "operatorAddresses": ["0x0000000000000000000000000000000000000006"],
  "operatorTransactionSetComplete": false
}
```

RPC URL은 JSON/report에 넣지 않습니다. 환경에서 `OPS_REPORT_RPC_URL` 또는 `RPC_URL`로 전달합니다. 보고서 파일은 JSON 기본 출력과 선택적 self-contained HTML입니다.

```sh
OPS_REPORT_RPC_URL="$YOUR_READ_ONLY_CHAIN_480_RPC" \
  node scripts/ops-report.mjs \
  --config ./ops-report-config.json \
  --from-block 37000000 --to-block 37001000 \
  --operator-tx 0xYOUR_KNOWN_OPERATOR_TRANSACTION_HASH \
  --json ./out/ops-report.json --html ./out/ops-report.html
```

`--operator-tx`는 반복할 수 있습니다. 전체 비용 목록을 완전하게 입력한 경우에만 `operatorTransactionSetComplete`를 true로 둡니다. 선택적 `fxMarksUsdPerToken` (`WLD`, `USDC`, `ETH`), `fxMarkAt`, `monthlyServerCostUsd`, `serverCostMonth`를 설정해야 월간 USD 추정이 가능하고, 보고 범위의 시작·끝 block timestamp가 그 달 전체를 포함해야 합니다. 최대 범위는 3,000,000 blocks이며, 전체 vault별 로그 조회는 최대 2,500회입니다. 기본 `logPageSize`는 공개 World Chain RPC의 100블록 제한보다 작은 90입니다. 이미 보유한 RPC가 더 넓은 범위를 지원하는 경우에만 이 값을 최대 2,000까지 설정할 수 있습니다. 공개 RPC에서 긴 구간은 별도 범위로 나누고 각 coverage를 보존합니다. 일부 구간만 조회한 결과로 월 전체 순이익을 표시하지 않으며, RPC 유료 업그레이드를 자동으로 수행하지 않습니다. 요청한 페이지 밖의 이벤트는 수입에서 제외하고 보고서를 incomplete로 표시합니다.

```sh
node scripts/test-ops-report.mjs
```

## 자산별 확인 예약

`InheritanceWatcher`는 정상적인 먼 마감의 자산을 최대 4시간 간격으로 확인하고, 기존 5% 체크인 경고 경계·만료·7일 이의기간 종료에 더 일찍 깨어납니다. 앱 등록/갱신은 즉시 확인을 예약합니다. 만료/수령 가능 자산은 5분, 미확인 상태·RPC 장애는 1분 뒤 다시 확인합니다. 지급 후보는 SQLite 파생 큐이며 최종 지급 전에 기존 금융 엔진이 실제 상태를 새로 검증합니다. 확정 대기 거래가 있어도 다른 자산의 확인과 알림은 별도 객체에서 진행됩니다.

기존 행은 분당 최대 200개씩 초기 예약합니다. 1,000개 로컬 행은 5회 호출로 모두 예약됐고, 지급 대기 행이 있어도 마지막 주소의 후보가 추가됐습니다. 이 결과는 실제 사용자 1,000명의 장기 운영이나 처리 SLA를 인증하지 않습니다. 같은 계정의 Cloudflare/D1 사용량·RPC·가스·금융 거래 최종화가 실제 처리량을 제한하며 요금제를 변경하지 않았습니다. 독립 경보 Worker도 같은 Cloudflare에 있으므로 제공자 전체 장애까지 외부에서 감시하는 서비스는 아닙니다.
