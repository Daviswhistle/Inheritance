# 스마트 컨트랙트 보안 검토 인계 — 2026-11-03

다른 PC에서 진행 중인 작업을 유지하면서 이 검토 결과를 받아 확인하기 위한 인계다.
보고서, 재현 테스트, 원본 로그와 읽기 전용 코드 대조 스크립트가 이 브랜치에 있다.
발견 사항은 수정하지 않았다.

## 받을 위치와 기준

- 저장소: https://github.com/Daviswhistle/Inheritance
- 인계 브랜치: `security-review/2026-11-03`
- 실제 검토·전체 테스트 기준: `aa67a75c382e44d9a30e95cdd09fc286a8b44861`
- 인계 브랜치의 시작점: `c73e6dd916880d9e347f1f4ee2301d042d39f332`
- 위 두 커밋 사이 변경은 `docs/MAC_HANDOFF.md`, `docs/RELEASE.md`,
  `docs/WORLD_APP_ACCEPTANCE.md`뿐이다. 계약 소스와 포크 실행기는 동일했다.
- 인계 시 `contracts/` 18개 파일의 SHA-256을 검토 영수증과 대조했다.

현재 PC의 작업을 덮어쓰지 않으려면 기존 clone에서 별도 worktree로 받는다.

```sh
git fetch origin
git worktree add --detach ../Inheritance-security-review origin/security-review/2026-11-03
cd ../Inheritance-security-review
git submodule update --init --recursive
```

저장소가 없는 PC에서는 다음으로 받는다.

```sh
git clone --recurse-submodules --branch security-review/2026-11-03 \
  https://github.com/Daviswhistle/Inheritance.git Inheritance-security-review
```

현재 main을 인계 브랜치로 reset하지 않는다. 인계 뒤 main이 더 진행됐다면 아래
계약 소스 해시를 먼저 비교해 검토 결과의 적용 범위를 판단한다.

## 먼저 읽을 파일

1. [상세 검토 결과와 권고](SECURITY_REVIEW_2026-11-03.md)
2. [검증 영수증과 계약 소스 해시](SECURITY_REVIEW_2026-11-03.json)
3. [장애·결함 재현 테스트](../test/SecurityReview.t.sol)
4. [실제 Re7 수수료 정상 부과 대조](../test/SecurityReviewFork.t.sol)

## 이어받을 핵심 결과

| ID | 결과 | 영향과 전제 |
| --- | --- | --- |
| M-01 | 조건부 Medium, 미해결 | Merkl `claimed` 조회 자체가 실패하면 WLD 현금 출금과 WLD/USDC 상속 정산이 막힌다. USDC 전체 출금도 영향받지만 부분 원금 출금은 가능하다. |
| M-02 | 조건부 Medium, 미해결 | 이익에 대한 USDC 수수료 송금이 거부되면 성공한 redeem까지 rollback된다. 상속인이 지분 지급을 명시적으로 선택하는 진입점이 없다. |
| L-01 | Low, 미해결, 미배포 경로 | 다중 토큰 금고에 1 wei ETH를 강제 송금하면 회수 함수가 없어 팩토리 슬롯을 영구 해제할 수 없다. |

M-01/M-02는 외부 장애를 주입해 재현했다. 일반 외부 호출자가 그 장애를 만들 수
있다는 뜻이나 현재 운영 장애의 증거로 전달하지 않는다. 조회 블록 `37172835`에서
실제 USDC 수수료 수령자는 블랙리스트 상태가 아니었다.

검토 범위에서 Critical/High는 확인하지 못했다. 독립 외부 감사 인증이나 모든
이전 배포 revision·개별 사용자 금고의 전수 조사 완료를 주장하지 않는다.

150,000 gas 지분 평가 한도로 수수료를 회피할 수 있다는 의심은 실제 Re7 포크에서
재현되지 않았다. 정상 수수료가 부과됨을 확인해 발견 사항에서 제외했다.
`SecurityReviewFork.t.sol`은 이 정상 동작을 확인하는 대조 테스트다.

## 확인된 실행 결과

- 운영 설정 전체 테스트: **402 통과 / 실패 0 / 생략 0**.
- 위 수치에 포함된 고정 블록 포크: **22 통과 / 실패 0 / 생략 0**, 6개 suite.
- 추가 검토 테스트 6개: 장애 재현 4개, 미배포 결함 재현 1개, 정상 수수료 대조 1개.
- custody + helper line coverage: **94.79% (1202/1268)**, CI 기준 통과.
  계측 실행 자체는 로컬 380 통과 / 포크 setup 6개 생략이며 전체 실행과 별도다.
- Slither: 22개 계약, 102개 detector, 원본 경고 253개를 종류별로 분류했다.
  도구의 High 64개를 확정 취약점 64개로 전달하면 안 된다.
- 운영 코드 비교: 8개 정규화 비교 일치. CBOR 메타데이터와 컴파일러가 지정한
  runtime immutable 영역을 제외한 비교이며, exact source verification과 구분한다.

이 결과는 이전 PC의 로컬 실행 증거다. 인계 브랜치에 대한 hosted CI의 성공을
뜻하지 않는다. 재현 테스트의 PASS도 결함 수정 완료를 뜻하지 않는다.

## 다른 PC에서 재현

Foundry **v1.3.2**, Solidity **0.8.24**, optimizer 200, EVM Cancun을 유지한다.
의존성은 저장소 lockfile과 submodule을 사용한다. SDK/UI 설치는 이 계약 검토에 필요하지 않다.

```sh
forge --version
forge build

# 외부 RPC 없이 장애/미배포 결함 5개 재현
forge test --match-path test/SecurityReview.t.sol -vv

# 같은 블록의 모든 포크 22개. RPC 누락·suite 누락·skip이면 실패한다.
WORLDCHAIN_FORK_RPC=https://worldchain-mainnet.g.alchemy.com/public \
WORLDCHAIN_FORK_BLOCK=35837437 \
node scripts/verify/worldchain-forks.mjs

# 전체 402개를 생략 없이 다시 실행
WORLDCHAIN_FORK_RPC=https://worldchain-mainnet.g.alchemy.com/public \
MORPHO_FORK_RPC=https://worldchain-mainnet.g.alchemy.com/public \
USDC_FORK_RPC=https://worldchain-mainnet.g.alchemy.com/public \
INCOME_FORK_RPC=https://worldchain-mainnet.g.alchemy.com/public \
SECURITY_FORK_RPC=https://worldchain-mainnet.g.alchemy.com/public \
WORLDCHAIN_FORK_BLOCK=35837437 MORPHO_FORK_BLOCK=35837437 \
USDC_FORK_BLOCK=35837437 INCOME_FORK_BLOCK=35837437 SECURITY_FORK_BLOCK=35837437 \
forge test -vv

forge fmt --check
node scripts/check-natspec.mjs
node scripts/gen-abi-errors.mjs --check
```

공개 RPC가 실패하면 네트워크/아카이브 제공 범위를 기록한다. 포크 테스트를 생략하고
동일한 검증을 마쳤다고 기록하지 않는다. 테스트 계정과 로컬 fork만 사용한다.

### 운영 코드의 읽기 전용 대조

현재 PC 경로에 의존하지 않는 스크립트를 함께 추가했다. root의 `ethers` 의존성이
필요하므로 `npm ci` 후 실행한다. 계정 키를 읽거나 트랜잭션을 전송하지 않는다.

```sh
npm ci
forge build
node scripts/verify/security-review-readback.mjs
```

기본값은 원 검토의 블록 `37172835`다. 다른 블록을 명시하려면
`SECURITY_READBACK_BLOCK=<블록번호>`를 사용한다. 결과는 기본적으로 OS 임시 폴더의
`inheritance-security-readback/`에 저장하며, `SECURITY_READBACK_OUT`으로 바꿀 수 있다.
새 실행 결과와 원 검토 영수증은 서로 덮어쓰지 않는다.

### 원본 로그 인계

[`security-review-2026-11-03-evidence.tar.gz`](security-review-2026-11-03-evidence.tar.gz)에
테스트·포크·커버리지·빌드 로그, Slither 원본 JSON, 운영 대조 영수증/원 스크립트,
Solidity 버그 목록 스냅샷을 넣었다. 원 검토 PC의 `/tmp`가 없어도 받을 수 있다.
Foundry/solc 바이너리, node_modules, 개인 키, `.env`, 서명·송금 자료는 포함하지 않았다.

압축 파일 SHA-256:
`822ae2f43a6fafc4cc30b82c9ba48c3d9b048fbd5f289dbeedf9bbc13de999cc`

```sh
SECURITY_EVIDENCE_DIR=$(mktemp -d)
tar -xzf docs/security-review-2026-11-03-evidence.tar.gz -C "$SECURITY_EVIDENCE_DIR"
python3 - "$SECURITY_EVIDENCE_DIR" <<'PY'
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
receipt = json.loads(pathlib.Path('docs/SECURITY_REVIEW_2026-11-03.json').read_text())
for item in receipt['raw_evidence']:
    data = (root / item['file']).read_bytes()
    assert len(data) == item['bytes'], item['file']
    assert hashlib.sha256(data).hexdigest() == item['sha256'], item['file']
for name, digest in receipt['contract_source_sha256'].items():
    assert hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest() == digest, name
print('PASS: raw evidence and all 18 reviewed contract source hashes match')
PY
```

압축 안의 `readback.mjs`는 원본 증거로서 당시 PC 경로를 보존했다.
다른 PC에서 재실행할 때는 위 `scripts/verify/security-review-readback.mjs`를 사용한다.

## 후속 검토 순서와 보존할 조건

1. M-01/M-02의 전제와 심각도를 독립적으로 확인한다. getter 장애와 단순 보상 claim
   중단을 혼동하지 않는다. 결함 재현과 현재 운영 발생 여부를 각각 기록한다.
2. M-01은 원금/지분 지급과 보상 정산을 분리하는 방향을 검토한다. 조회 실패를 무조건
   보상 0으로 처리하면 정산 후 소유자 sweep이 늦은 상속인 보상을 가져갈 수 있다.
3. M-02는 수수료 별도 적립 또는 적격 상속인의 고정 수령자 지분 지급 선택을 검토한다.
   수령자 변경, 중복 지급, 수수료 회계와 재진입 방어를 보존한다.
4. L-01은 미배포 다중 토큰 경로다. 실제 운영 경로와 구분해 회수 함수/슬롯 조건을 검토한다.
5. 현재 배포는 immutable이다. 소스 변경으로 기존 금고가 고쳐지지 않는다.
   새 설계·배포·이용자 선택 이전은 각각 별도로 다뤄야 한다. USDC runtime 여유는
   281 bytes이므로 새 코드 크기도 확인한다.

인계 요청 자체를 운영 배포·추가 실거래·World App 제출·외부 메시지 승인으로
확대하지 않는다. 해당 PC의 현재 사용자 지시와 최신 운영 문서를 함께 확인한다.
기존 고객 자산·구형 경로·다른 PC의 미완료 변경을 보존한다.
