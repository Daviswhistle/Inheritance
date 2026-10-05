# Notification Backend (Cloudflare Workers)

금고별 상속 알림을 D1에 저장하고 필요한 다음 시점에 온체인 상태를 읽어 World App으로 보냅니다.
API 접근에는 Pages에서 검증한 World App 지갑 세션이 필요합니다. 알림 세션은
온체인 트랜잭션 서명 권한을 주지 않습니다.

## Configuration

Pages의 `app/wrangler.toml`과 Worker의 `backend/wrangler.toml`은 기존 D1
`world-inheritance-notify`를 `DB`로 공유합니다. 별도 DB를 만들지 않습니다.
`backend/migrations/0001_init.sql`부터 순서대로 적용합니다. `0003_auth.sql`에는
일회용 nonce 해시, 지속형 요청 제한과 금고별 처리 lease가 들어 있습니다.

- `FRONTEND_ORIGIN`: 정확한 SIWE 도메인, 세션 audience와 허용 브라우저 origin.
- `FACTORY_ADDRESS`: 현재 지원하는 팩토리.
- `LEGACY_FACTORY_ADDRESS`: 이전 금고 호환이 필요할 때만 지정하는 신뢰된 팩토리.
- `YIELD_FACTORY_ADDRESS` / `MORPHO_VAULT_ADDRESS`: 현재 WLD 수익 금고 팩토리와 전략.
- `LEGACY_YIELD_FACTORY_ADDRESSES`: 기존 WLD 수익 팩토리 주소의 선택형 쉼표 목록. 주소마다 최대 8개이며, 0 주소·중복·다른 자산 팩토리와의 중복은 거부합니다.
- `LEGACY_USDC_YIELD_FACTORY_ADDRESSES`: 기존 USDC 수익 팩토리의 같은 형식 목록. 기본 USDC 주소, 수익 팩토리와 전략 설정도 모두 필요합니다.
- `WLD_ADDRESS`: 고정된 World Chain WLD 토큰.
- `SIWE_SECRET`: Pages와 Worker가 공유하는 비공개 세션 서명 키.
- `WORLD_APP_ID`, `WORLD_NOTIFY_API_KEY`: 알림 발송 설정.

기본 금고는 `factory()`·`WLD()`·`vaultOf(owner)`가 일치해야 합니다. 수익 금고는
기본 팩토리와 자산별 명시적 주소 목록에 있는 출처만 인정하고, 해당 팩토리의
`knownVaults`·고정 전략·자산을 확인합니다. USDC는 `asset()`과 canonical WLD
`rewardToken()`도 따로 확인합니다. 주소 목록은 호출자가 보내는 값으로 확장되지 않습니다. 수익 금고의 슬롯 해제 후에도
원래 팩토리 등록은 검증할 수 있습니다. 임의 owner/heir 응답만으로 수신자를 신뢰하지 않습니다.

정산 완료는 필수 조회한 `claimedAt > 0`으로 확인합니다. 완료 시 `heir`가 0으로
바뀐 수익 금고는 finalized 블록의 불변 `inheritanceRecipient`를 검증해 owner와 실제 수령자에게
조회 권한을 허용합니다. 이전 heir의 캐시는 권한 근거가 아닙니다. 기본 금고는 불변 수령자
getter가 없으므로 완료 후 owner만 조회할 수 있으며 캐시 주소로 완료 알림을 보내지 않습니다.
수익 금고는 지급 확정 후 완료 알림을 시도하며 성공 결과를 저장한 뒤 감시를 종료합니다.
미전달은 하루 뒤 재시도하고, 아직 지급이 확정되지 않았다면 1분 뒤 다시 확인합니다.
기본 팩토리 슬롯 해제는 API 접근을 거절하고 기존 감시만
종료합니다. 수익 금고는 영구 등록을 확인해 보관된 링크와 늦은 보상 처리를 지원합니다.
RPC 실패나 정산 상태 미확인은 완료나 슬롯 해제로 간주하지 않습니다.

## Setup and deployment

키 값은 공개 환경 변수, 프론트 번들 또는 저장소에 넣지 않습니다.

```bash
npx wrangler secret put SIWE_SECRET --config backend/wrangler.toml
npx wrangler pages secret put SIWE_SECRET --project-name inheritance --config app/wrangler.toml
npx wrangler secret put WORLD_NOTIFY_API_KEY --config backend/wrangler.toml
npx wrangler secret put WORLD_APP_ID --config backend/wrangler.toml
npm run notify:d1:remote
npm run notify:deploy
```

Pages와 Worker에는 동일한 `SIWE_SECRET`을 설정합니다. 배포 workflow는 저장소의
기존 `SIWE_SECRET`을 stdin으로 양쪽에 주입하고 공유 D1 마이그레이션을 적용한 뒤
두 배포 job을 허용합니다. 어느 단계라도 실패하면 이후 배포가 진행되지 않습니다.

로컬에서는 `npm run notify:d1:local` 후 `npm run notify:dev`로 시작합니다.
Pages Functions도 같은 로컬 DB와 비공개 테스트용 `SIWE_SECRET`을 사용해야 합니다.
Vite E2E 설정은 실제 Pages 인증 핸들러와 메모리 SQLite를 사용해 일회용 nonce와
서명 검증, 세션 발급을 검증합니다. 프로덕션 빌드에는 E2E 설정을 사용하지 않습니다.

## Session contract

`GET /api/auth/nonce`는 256비트 무작위 알파벳·숫자 nonce를 발급합니다. D1에는
해시만 저장하며 10분 뒤 만료합니다. `POST /api/auth/verify`는 MiniKit SIWE
서명, 정확한 origin, `Sign in to Inheritance` 문구, 체인 480과 주소를 검증한 후
D1의 `DELETE ... RETURNING`으로 nonce를 한 번 소비합니다. 실패한 서명은 nonce를
소비하지 않으며 같은 서명의 재사용 또는 동시 검증으로 추가 세션을 발급하지 않습니다.

Nonce 발급은 Cloudflare가 확인한 연결 IP별 분당 30회로 제한합니다. 원본 IP 대신
분 단위 HMAC 키만 짧게 보관하며, 연결 정보가 없으면 별도의 공통 한도를 적용합니다.
한도에 도달한 요청은 추가 nonce나 제한 행을 쓰지 않고 429를 반환합니다.

성공 응답은 `{ status, isValid, address, domain, token, expiresAt }`입니다.
`expiresAt`은 밀리초 Unix 시각이며 세션은 1시간 동안 유효합니다. 프론트는
`sessionStorage`에 저장하고 `notificationFetch`를 통해
`Authorization: Bearer <token>`을 붙입니다. 오래된 주소만 있는 localStorage 기록은
세션으로 복원하지 않습니다. 만료되거나 Worker가 401을 반환하면 다시 로그인해야 합니다.

## API

`GET /api/health`와 CORS `OPTIONS`를 제외한 아래 API는 모두 인증을 요구합니다.
현재 온체인 권한을 확인하며 인증 없는 CLI 요청에도 똑같이 적용합니다.

| API | 권한과 요청 |
| --- | --- |
| `GET /api/notifications?cursor=0x...` | 호출자가 현재 owner/heir 또는 정산 확정 수익 금고의 불변 수령자인 watcher만 반환. 네 후보씩 canonical 검증하며 `nextCursor`가 있으면 다음 페이지를 조회. 이전 heir의 캐시만으로 접근 불가. RPC 장애는 503이며 빈 목록으로 숨기지 않음. |
| `GET /api/notifications/status?vaultAddress=0x...` | 현재 owner/heir 또는 정산 확정 수익 금고의 불변 수령자. |
| `POST /api/notifications/open` | 현재 heir만 가능. `{ "vaultAddress": "0x...", "notificationPermission": "granted" }`; permission은 `granted`, `denied`, `unknown` 중 하나. 마지막 방문/알림 권한을 저장하며 알림·거래는 보내지 않음. |
| `POST /api/notifications/register` | 현재 owner 또는 heir. `{ "vaultAddress": "0x..." }`; 선택한 owner/heir 필드는 온체인 값과 일치해야 함. |
| `POST /api/notifications/unregister` | 현재 owner만 가능. `{ "vaultAddress": "0x..." }`. |
| `POST /api/notifications/check-now` | 현재 owner 또는 heir. `{ "vaultAddress": "0x..." }` 한 건만 검사. 전역 수동 스캔 불가. |
| `POST /api/notifications/test` | 로그인한 본인에게 고정된 테스트 문구만 발송. `{ "walletAddress": "0x...", "vaultAddress": "0x..." }` 필드 선택 가능. 지갑은 세션 주체와 같아야 하며 금고를 지정하면 owner/heir 권한이 필요. `title`/`message` 입력은 사용하지 않음. |

전체 API는 지갑당 분당 60회로 제한합니다. 테스트 발송과 수동 검사는 각각 지갑당
최소 60초 간격이며 경계를 넘는 연속 요청, 새로운 Worker 인스턴스와 동시 요청에도
유지됩니다. 한도 초과는 429와 `Retry-After`를 반환합니다.

Cron·수동 검사·재등록·해제는 D1의 금고별 lease로 중복 처리와 상태 덮어쓰기를
막습니다. 전송 시도는 외부 API 호출 전에 저장하며 조회와 재등록에서도 `alerts`를
보존합니다. 기존 정책대로 같은 단계는 성공·미전달 모두 24시간 뒤 재시도할 수
있고, 실제 갱신·신청 취소·수신자 변경이 관측되면 관련 단계만 재무장합니다.
월드 알림 응답의 일치하는 수신자 행에서 `sent: true`가 확인돼야 전달로 기록합니다.
금고 알림은 공식 `worldapp://mini-app?app_id=...&path=...` 형식으로 앱 내부의
`/?vault=...` 경로를 전달합니다. 실기기에서의 알림 도착과 링크 열기는 별도 검증입니다.

## Verification

```bash
node scripts/test-notify-alerts.mjs
node scripts/test-notify-db.mjs
node scripts/test-notify-auth.mjs
pnpm --dir app typecheck
pnpm --dir app lint
pnpm --dir app build
```

인증 테스트는 실제 SDK 서명 검증, Pages 핸들러, Worker HTTP 경로와 SQLite를
사용합니다. RPC와 알림 API는 프로세스 내부의 대체 응답으로 처리하며 실제 전송이나
운영 데이터 변경은 하지 않습니다. 로컬 통과는 실제 배포·푸시 전달의 증거와 구분합니다.

## Automated execution

`FINALIZER_ENABLED=true` enables the cron-only `runFinalizerCycle`. A dedicated
`FINALIZER_PRIVATE_KEY` secret pays gas for zero-value `executeInheritance(vault)`
transactions to the verified source factory. It never signs on behalf of an owner or heir.
Every job stores its source factory. Recovery checks that the signed destination,
stored source and vault's immutable factory still agree with the configured asset
list and canonical factory membership.

The Worker entry primes a single in-memory signer when an isolate starts and the
executor is enabled with a key. Priming performs no network calls and logs no key
material. An invalid key does not prevent Worker startup; each execution and health
invocation still validates the configured key and reports `invalid_configuration`.
Invocation settings also detect key rotation and replace the cached signer.

The Worker alternates monitoring and execution on successive minute ticks so each
task runs every two minutes. Execution uses the internal `InheritanceExecutor`
Durable Object RPC, with the SQLite-backed class available on Workers Free. Its
default CPU allowance is 30 seconds per call, rather than the scheduled Worker's
10 ms Free allowance. No public HTTP route invokes this RPC. A missing binding
fails closed and public automation health reports `not_running`. All signer
leases, transactions and fee reservations remain in the existing D1 database;
no money or job records are moved to the object's own storage. Eviction or a
restart uses the existing durable recovery path. No subscription upgrade is
required. The current 720 executor calls/day fit within the 100,000/day Free
request allocation; account-wide duration and other service quotas still apply.
See [runtime limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
and [Free allocations](https://developers.cloudflare.com/durable-objects/platform/pricing/).

If there are no active monitoring rows and no pending transaction for the signer,
the executor records a completed idle cycle without chain RPCs. A pending
transaction is reconciled even when all monitoring rows are inactive. Every
nonempty execution and recovery cycle still verifies the chain, trusted factories
and gas controller before any submission. Health independently performs these
live checks even after an idle cycle. Shared ABI interfaces reuse parsed contract
definitions, without caching chain state across calls.

Each monitoring tick checks the two least-recently
checked active rows. The execution cursor scans up to its configured three rows
and submits at most one transaction per tick. Yield source validation can reduce
that scan to two rows for one WLD source or one row for multiple WLD sources or
USDC. These bounded tasks stay within existing subrequest limits; large queues may
delay checks and are not an exact-time promise.

Production caps in `wrangler.toml` are 250,000 execution gas, 0.01 gwei gas price,
0.00001 ETH per UTC day and an additional 0.000001 ETH fee reservation per
transaction. OP L1 data fees and possible operator fees are outside execution gas.
Current fee quotes must fit the separate reservation; actual receipt cost is
accounted and an overrun halts the signer. D1 retains the signed raw transaction
alongside its hash before broadcast. If the transaction is absent from the RPC,
the runner checks its signature, chain, sender, factory, zero value, calldata,
hash, caps and current claim before rebroadcasting those exact bytes. It never
signs a replacement nonce or reserves the pending transaction's budget twice.
Recovery and receipt polling occupy their own tick to preserve request limits.
A signer change cannot take over a pending claim job.

A receipt becomes `confirmed` only when its block hash remains canonical and its
block is at or below the RPC's `finalized` head. Until then, the job and full fee
reservation remain pending. A previously confirmed claim that becomes eligible
again is checked for a removed receipt. Recovery reuses the same signed transaction,
keeps previously accounted fees conservatively and adds a new capped reservation
atomically, then continues snapshot, simulation and broadcast on the next invocation.
This keeps the longer reorg path within the Worker request limit. Finite-cap replay
also checks the existing reservation before rebroadcasting the exact signed bytes;
it never charges the pending job a second time. Old rows without signed bytes halt
with `recovery_unavailable` if the transaction cannot be found; investigate them
instead of inventing a replacement.
Runtime schema upgrades preserve old rows, and signed bytes are never returned
by public health or included in application logs.

`GET /api/automation/health` is a read-only public operational endpoint used by the
interface. The HTTP Worker delegates this read to `InheritanceExecutor.readHealth`
so live ABI and signer checks use the same CPU allowance as execution. This method
never calls `runCycle` or changes the D1 journal. Disabled or unconfigured runtimes
return directly without a financial RPC. It exposes support, funding, last cycle, pending hash and caps, not the
key or credential-bearing RPC URL. `factoryAddresses` contains only factories
individually verified on that health read. `factoryStatuses` reports each configured
primary and legacy factory with its asset, support result and reason; unsupported or
unavailable legacy addresses are not advertised as ready. Health verifies up to
eight legacy factories per asset using bounded JSON-RPC batches within the Worker
external-request limit. A funded key without recent successful cron
execution is not evidence of a working service. Watch the cycle timestamp after
deployment and keep the manual heir completion path available.
`dailyReservedWei` records the current UTC day's reserved and settled ETH cost;
`dailyRemainingWei` is present only when the UTC-day limit is enabled.
`executionGasPriceWei` reports the current network gas price. `requiredReserveWei`
conservatively covers maximum allowed execution gas at that price plus the OP fee
reserve. Without a pending transfer, both the balance and remaining budget must
cover that reserve; insufficient budget reports `daily_cap`. An already reserved,
progressing transaction may stay `pending`; a blocked recovery reports its actual
completed-cycle failure instead. `running` means its next check is still underway.
`recentFailure` retains individual job history for diagnosis. A subsequent healthy
cycle restores readiness even while a cancelled claim remains in retry backoff.
Signer-wide failures, such as gas caps, retain priority over cancelled claims.

`FINALIZER_DAILY_GAS_CAP_ETH="0"` disables the executor's UTC-day ETH spending
limit only when `GAS_FUNDING_CONTRACT_ADDRESS` and `GAS_FUNDING_CODE_HASH` are
both configured. The Worker checks the live runtime hash and the controller's
`keeper()`, `treasury()` and `bot()` identities on every execution cycle and
health read. The keeper must equal the current finalizer signer; the treasury
and bot must match the fixed fee treasury and gas bot. A mismatch keeps automation
unready. The pinned controller is responsible for its separate operator-token
spending limit of 10 USD-equivalent per rolling 24 hours and its fixed gas
recipients. These public admin values are not client settings.
The deploy workflow reads `GAS_FUNDING_CONTRACT_ADDRESS`,
`GAS_FUNDING_CODE_HASH` and `FINALIZER_DAILY_GAS_CAP_ETH` from repository-level
GitHub Variables and passes configured values to the Worker. Leave them unset to
retain the `backend/wrangler.toml` daily cap. Set the cap variable to exactly
`0` only after the deployed controller address and pinned runtime hash are ready.

With the daily ETH cap disabled, health reports `dailyBudgetLimited: false` and
null `dailyCapWei`/`dailyRemainingWei`; it does not treat zero as an exhausted
budget. `dailyReservedWei` still records staged reservations and actual receipt
costs for the current UTC day. Physical keeper ETH, `FINALIZER_MAX_GAS`,
`FINALIZER_MAX_FEE_GWEI` and the separate OP fee reserve continue to bound each
transaction. Disabling the daily allowance does not authorize an unlimited gas
price or bypass pending-transaction, finality, lease or identity checks.

To replace the signer, configure its secret through GitHub Actions, fund its
public address with a small bounded ETH amount and verify its balance/health.
Never use a user's wallet or an owner key as this signer. Do not blindly clear
pending jobs or halt flags: first check the stored transaction on-chain and
account for its real fees. Monitor gas funding before it falls below the reserve.

### Optional Morpho yield factory

USDC support requires `USDC_YIELD_FACTORY_ADDRESS`, `USDC_MORPHO_VAULT_ADDRESS`
and `USDC_ADDRESS` together. Its asset and WLD reward getters, strategy underlying,
factory membership and receipt-block settlement are verified separately. With
USDC configured, the keeper scans one candidate and submits at most one transfer
per cycle under the existing signer, lease and budget, with a 900,000 gas bound
for the combined USDC-enabled deployment (850,000 when only WLD yield is enabled). Cash,
receipt, reward-only and total-loss outcomes need the fixed heir and matching
onchain settlement timestamp. Health advertises only individually verified factories.

Configure `YIELD_FACTORY_ADDRESS` and `MORPHO_VAULT_ADDRESS` together after the
separate yield contract release. Keep the existing `FACTORY_ADDRESS` and
`LEGACY_FACTORY_ADDRESS`; the same signer, lease, durable jobs and daily budget
cover both supported automatic-execution factories. Raw transaction recovery
validates the allowed destination and the vault's matching factory and strategy.
Receipt-only inheritance is eligible even when WLD cash is zero; the fixed
recipient's nonzero receipt-share event is payout evidence.

When a new WLD or USDC yield factory becomes primary, retain older source
addresses in `LEGACY_YIELD_FACTORY_ADDRESSES` or
`LEGACY_USDC_YIELD_FACTORY_ADDRESSES`. The deploy workflow always carries the
currently active production factories (`0xfC3F6f0B2234923b3F3aDBAaC797e920C8FdA248`
for WLD and `0x67c8DE756FCD04dc5976960533931984d0348758` for USDC) into those
lists as soon as a different primary is selected. GitHub variables with the same
names add any still-older versions; each list is limited to eight unique,
nonzero addresses and may not overlap the primary or other asset type. No owner
cap applies. The vault's reported factory is still checked against its factory
registry before notification access or automatic settlement.

The yield-enabled scan checks one candidate per cycle when USDC or multiple WLD
source factories are configured, because each distinct source needs its own
validation. A single WLD source can reuse that check and scan two candidates.
Yield execution still submits at most one transaction per cycle; these bounds
include the primary factory and gas-controller validation under the Workers Free
50 external-request limit. Use `FINALIZER_MAX_GAS=850000`
when enabling yield: a pinned World Chain fork showed cash inheritance using
352626 gas inside the gateway at block 35787339. Gas-exhaustion fallback is independently
bounded and the execution limit also covers the finalizer's 20% estimation margin.
This changes the maximum per-transaction reserve, not the daily ETH cap.
Keep the existing daily cap and OP fee reserve, verify live signer balance and
readiness, and do not silently top up or raise the daily budget.

Health returns `factoryAddresses` so the UI can verify that its selected yield
factory is supported. A healthy basic-only Worker must not advertise yield
automation as enabled. See [the yield release procedure](../docs/MORPHO_YIELD.md).
