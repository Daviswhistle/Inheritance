# Inheritance 스마트 컨트랙트 보안 검토 — 2026-11-03

검토 기준은 `aa67a75c382e44d9a30e95cdd09fc286a8b44861`의 계약 소스다.
수동 검토, Slither, Foundry 재현 테스트와 World Chain 읽기 전용 대조를 수행했다.
이 문서는 내부 코드 검토 결과이며 독립 외부 감사 인증이 아니다.

## 결과

검토 범위에서 무권한 자산 탈취, 상속 수령자 변경, 7일 대기 우회에 해당하는
Critical/High 취약점은 확인하지 못했다. 외부 구성요소 실패가 원금 지급까지 막는
조건부 Medium 위험 2건과 미배포 다중 토큰 계약의 Low 결함 1건을 확인했다.
세 건 모두 미해결 상태다. 재현 테스트의 통과는 해당 동작을 확인했다는 뜻이다.

| ID | 심각도 | 문제 | 발생 조건 | 상태 |
| --- | --- | --- | --- | --- |
| M-01 | Medium, 조건부 | 보상 조회 실패가 원금 출금·상속 정산도 중단 | Merkl `claimed` 조회 revert/ABI 실패 | 재현, 미해결 |
| M-02 | Medium, 조건부 | 수수료 지급 거부가 USDC 상속 전체를 중단 | 양의 실현 이익 + 수수료 수령자에 대한 USDC 송금 거부 | 재현, 미해결 |
| L-01 | Low, 미배포 계약 | 강제 ETH 입금으로 다중 토큰 금고 슬롯 해제 불가 | 누구나 금고에 1 wei 강제 송금 | 재현, 미해결 |

M-01과 M-02는 외부 장애를 주입해 확인한 가용성 문제다. 일반 외부 호출자가
그 장애를 일으킬 권한은 확인하지 못했다. 현재 장애가 발생했다는 보고도 아니다.
블록 `37172835`에서 실제 USDC 수수료 수령자의 `isBlacklisted`는 `false`였다.

## M-01 — 보상 조회 가용성에 원금 지급이 종속됨

**위치:** `contracts/InheritanceVaultMorpho.sol:320`, `:445`, `:577`, `:619`;
`contracts/InheritanceVaultUSDC.sol:299`, `:522`, `:570`, `:677`.

두 수익형 금고는 누적 보상을 계산할 때 고정 Merkl Distributor의 `claimed`를
직접 호출한다. 이 조회에는 실패 처리나 독립적인 원금 정산 경로가 없다.
보상 수령 이력이 전혀 없어도 호출하며, 조회가 실패하면 다음 동작이 revert된다.

- WLD: 부분 현금 출금, 전체 현금 출금, 상속 정산.
- USDC: 전체 출금, 상속 정산. USDC 부분 원금 출금은 별도로 가능하다.

상속 정산에서는 이 조회가 현금 redeem과 지분 이전 분기보다 먼저 실행된다.
따라서 현금 유동성이 충분하거나 지분 이전이 정상이어도 상속인은 지급받지 못한다.
`claimedAt`은 0으로 유지되고 자산은 금고에 남는다. 자산 탈취나 허위 정산은 아니다.

**재현:** 보상을 받지 않은 WLD·USDC 금고에 각각 100 WLD·100 USDC를 예치하고,
만료 → 지정 상속인의 신청 → 7일 경과 후 Distributor 조회만 revert시켰다.
두 팩토리의 `executeInheritance`가 모두 revert했다. 소유자의 WLD 현금 출금과
USDC 전체 출금도 중단됨을 확인했다.

소유자가 응답할 수 있다면 갱신 후 지분 출금으로 복구할 수 있다. USDC는 부분
원금 출금도 가능하다. 상속인에게는 같은 권한의 독립 지분 출금 함수가 없다.
일반적인 보상 캠페인 종료나 보상 claim 일시 중단이 곧바로 `claimed` getter를
고장 내는 것은 아니다. 이 재현의 전제는 getter 자체의 장애·비호환이다.

**권고:** 원금/지분 지급과 보상 정산의 실패 경계를 나눈다. 특히 상속은 수령자를
고정한 뒤 독립 지급과 보상 후속 처리를 허용하는 설계를 검토한다. 조회 실패를
단순히 보상 0으로 취급하면 늦게 받은 보상을 소유자의 기부금으로 오분류할 수
있으므로, 미확인 보상과 정산 후 잔여금 회수 규칙도 함께 보존해야 한다.

**증거:** `test/SecurityReview.t.sol`의
`testWLDPrincipalCashExitsDependOnMerklWithoutAnyRewards`,
`testUSDCFullPrincipalExitDependsOnMerklButPartialExitDoesNot`,
`testBothInheritancesDependOnMerklWithoutAnyRewards`.

## M-02 — 수수료 송금 실패가 USDC 상속 전체를 되돌림

**위치:** `contracts/InheritanceVaultUSDC.sol:577`, `:588`, `:671`.

`finalizeClaim`의 지분 이전 fallback은 `strategy.redeem`의 실패에만 적용된다.
redeem이 성공한 뒤 `_payFee`에서 수수료 수령자에 대한 USDC 전송이 실패하면
전체 정산이 revert된다. 이 경로에는 지분 지급을 명시적으로 선택하는 상속인용
진입점이 없다. 모든 예치 지분을 redeem할 수 있는 상태에서 발생하는 문제다.

**재현:** 100 USDC 예치 후 금고 지분 가치를 120 USDC로 만들었다.
원금 100과 이익 20에 대한 수수료 2가 계산되는 상태에서, 수수료 수령자에게
2 USDC를 보내는 호출만 revert시켰다. 현금 redeem, 지분 소각과 `claimedAt`
변경이 모두 rollback되고 상속인은 USDC·지분 어느 것도 받지 못했다.

USDC가 수수료 수령자를 차단하는 상황이 해당 조건의 예다. 수령자 키를 잃는
것만으로 ERC20 송금이 실패하지는 않는다. 현금 유동성 부족으로 redeem이 먼저
실패하는 경우는 다른 경로이며, 이 재현은 그 상황을 주장하지 않는다.
현재 수수료 수령자는 차단 상태가 아님을 읽기 전용으로 확인했다.

소유자가 응답할 수 있다면 `ping`으로 신청을 취소하고 지분을 출금할 수 있다.
테스트는 이 복구와 상속인의 소유자 출금 함수 호출 거부도 함께 확인한다.

**권고:** 고객 지급이 수수료 즉시 송금에 의존하지 않도록 수수료 채권/잔고를
별도로 적립하거나, 적격 상속인이 수령자 변경 없이 지분 지급을 선택할 수 있게
한다. 같은 트랜잭션 내부에서 실패를 안전하게 격리하고 재진입·중복 지급 및
수수료 회계 보존을 다시 검증해야 한다.

**증거:** `test/SecurityReview.t.sol`의
`testRejectedFeeTransferBlocksInheritanceWithoutShareFallback`.

## L-01 — 미배포 다중 토큰 금고의 강제 ETH 슬롯 잠금

**위치:** `contracts/InheritanceVaultTokens.sol:248`;
`contracts/InheritanceVaultTokensFactoryOnePerOwner.sol:64`.

다중 토큰 금고는 직접 ETH 송금을 거부하지만 ETH 회수 함수가 없다. 팩토리는
금고 ETH 잔액이 0이어야 소유자 슬롯을 해제한다. 공격자는 생성자에서
`SELFDESTRUCT`하는 계약으로 1 wei를 강제 송금해 영구적으로 이 조건을 막을 수 있다.
이 송금 방식은 현재 Cancun 규칙에서도 가능하다.

**영향:** 허용 토큰의 상속을 직접 탈취하는 문제는 아니지만, 해당 팩토리에서
소유자는 슬롯을 해제하거나 새 금고를 만들 수 없다. 현재 앱/운영 배포 대상인
WLD·Morpho·USDC 계약에는 소유자 ETH 회수 함수가 있어 이 결함과 구분된다.

**권고:** 다중 토큰 경로를 배포하기 전에 소유자 전용 강제 ETH 회수 함수를
추가하거나, ETH를 상속 자산으로 지원하지 않는 설계에 맞춰 슬롯 해제 조건을 조정한다.

**증거:** `test/SecurityReview.t.sol`의
`testForcedETHPermanentlyPreventsPrototypeSlotRelease`는 실제 생성자
`SELFDESTRUCT`를 사용한다. 단순 잔액 강제 설정만으로 결론을 낸 테스트가 아니다.

## 범위와 확인한 보호 조건

`contracts/`의 Solidity 파일 18개를 읽었다. 아래 범위에는 인터페이스 3개와
`SafeERC20Lib`, `YieldMath`, `GasPriceMath`, `ImmutableCreationCode`도 포함된다.

| 범위 | 검토 내용 |
| --- | --- |
| 보관형 WLD 금고·팩토리 | 소유자/상속인 라우팅, 신청·7일 대기·갱신·정산, 잔여금·강제 ETH 회수, 슬롯 해제 |
| Morpho WLD 금고·팩토리·배포 보조 계약 | 원금·기부금·보상 구분, 손실 이월, 수익만 출금, 슬리피지, 현금/지분 정산, 지연 보상 |
| USDC 금고·팩토리·배포 보조 계약 | 6/18 자리 단위, USDC/WLD 회계 분리, 수수료·손실, 출금·상속·지연 보상 |
| 다중 토큰 금고·팩토리 | 만료 후 지급, 토큰 목록 상한, 단일 토큰 지급, 복구와 슬롯 해제; 현재 운영 범위 밖 |
| 운영자 가스 충전 | 고정 treasury/bot/keeper, 호출 권한, 승인 회수, 고정 swap 경로, TWAP·일일 예산, 자금 잔액 대조 |

현재 팩토리의 소유자 작업은 호출자의 등록 금고로 제한된다. 수익형 팩토리의
외부 금고 작업은 영구 등록부로 소속을 확인한다. `executeInheritance`의 실행자는
수령자를 지정하지 못하며, 먼저 지정 상속인의 신청과 7일 경과가 필요하다.
소유자가 실제 지급 전까지 갱신으로 신청을 취소할 수 있는 동작은 명시된 설계다.

일반 ERC20 rescue로 기초 자산·지분·보호 보상을 빼내는 우회, 다른 소유자의
vaultOf 사용, 테스트된 재진입·중복 정산·지연 보상 탈취 경로는 확인하지 못했다.
수익 출금은 원금/실현 손실 기준 유지와 실제 수령액 검증을 수행한다.
기부 지분과 지갑의 직접 전략 투자는 서비스 수수료 추적 밖이라는 설계도 구분했다.
프로젝트 금고·팩토리에는 운영자 자산 압류나 업그레이드 진입점이 없다.

## 검증 결과와 증거 경계

- 전체 Foundry 실행: **402 통과, 실패 0, 생략 0**. 모든 포크 환경을 명시했다.
  이 수치에 아래 22개 포크 테스트와 추가 검토 테스트 6개가 포함된다.
- 고정 World Chain 블록 `35837437`, 해시
  `0x43ebd78a409a1788cca639dfabf52c4e09a24f71698793d9751ffdadaf7b4079`:
  포크 검증 **22 통과, 실패 0, 생략 0**, 6개 suite.
- 추가 테스트: 조건부 장애 재현 4개, 미배포 계약 결함 재현 1개,
  실제 Re7 지분 수수료 정상 부과 대조 1개.
- `forge fmt --check`, `forge build --sizes`, public/external NatSpec 203개 검사,
  custom error ABI 30종 일치 검사 통과.
- Slither 0.11.6, 22개 계약, 102개 detector: 경고 253개를 종류별로 검토했다.
  도구 분류는 High 64 / Medium 93 / Low 65 / Informational 31이다.
  이 숫자는 확정 취약점 개수가 아니다. 분류 근거는 함께 저장한 JSON에 있다.
  `locked-ether`는 L-01로 확인했으며, 고정 수령자 송금·재진입 guard·잔액 대조·
  의도된 수학 연산 등에 대한 경고를 확정 취약점으로 집계하지 않았다.
- CI 기준 custody + helper line coverage는 **94.79% (1202/1268)**로 통과했다.
  이 커버리지 실행은 로컬 테스트 380 통과와 포크 setup 6개 생략을 사용했으며,
  별도의 운영 설정 전체 실행 402 통과와 구분한다. `--ir-minimum`은 계측용 별도
  컴파일이며 운영 빌드의 바이트코드 증거가 아니다.

커버리지 한계도 남는다. `ImmutableCreationCode` line coverage는 39.47%,
`YieldMath`는 67.86%이고, Morpho 금고 branch coverage는 59.46%다. assembly와
도구 source mapping의 한계를 포함하므로 이를 곧바로 같은 비율의 미검토 코드로
해석하지 않는다. 반대로 높은 합산 line coverage가 수학 경계값, 모든 분기나
긴 임의 상태 전이를 증명하지도 않는다. 별도 stateful invariant 캠페인을 수행했다고
주장하지 않는다.

**수수료 가스 한도 대조:** 정상 Re7 지분 출금에서 150,000 gas 평가 한도로 인한
수수료 우회는 재현하지 못했다. 실제 포크에서 계산된 USDC 수수료 2,373 최소 단위에
대응하는 지분 `2301492453511049`가 수수료 수령자에게 정확히 지급됐다.
평가 실패 시 면제 자체는 기존에 문서화된 동작이다. 시장 수·전략 코드·가스 비용
변경으로 이 한도와 실제 평가 비용이 달라질 수 있으므로 현재 테스트를 일반 보증으로
확대하지 않는다.

**운영 코드 대조:** 블록 `37172835`, 해시
`0x7550763b7afd77de3c9f791735ed7e0a3305fb57f4cc597e930938b4bb64e2a5`에서
아래 현재 팩토리, 수익형 배포 보조 계약, 금고 생성 코드 조각, 가스 충전 계약을
확인했다. 컴파일러 메타데이터와 컴파일러가 지정한 runtime immutable 영역을 제외한
**8개 코드 비교가 일치**했다. 수익형 금고의 생성 코드는 배포 보조 계약이 참조하는
고정 두 조각의 STOP 접두어를 제거하고 재구성했다. 단순 코드 존재 확인과 구분된다.

| 현재 운영 경로 | 주소 |
| --- | --- |
| WLD 수익형 팩토리 | `0x1a856aE8c3abd8a3746F542688a1846Bc6208435` |
| USDC 수익형 팩토리 | `0x87813F596E4ab2Ed29182Bd8A632d21Ae2A78DB2` |
| 보관형 WLD 팩토리 | `0xb74342FC15C504108cFD91366493590A9d570D26` |
| 운영자 가스 충전 | `0x7544804412033CBd0Eaf47eC5e356C161298F9e9` |

수익형 팩토리의 기초 자산·전략·수수료 수령자·10% 수수료도 별도로 읽었다.
이는 메타데이터까지 포함한 exact source verification 주장이나 모든 사용자의
개별 금고 전수 잔액 조사와는 다르다. 이전 WLD/USDC 팩토리 배포 revision의
전체 소스 복원은 이번 현재 소스 검토에 포함하지 않았다.

Slither 원본, 테스트 로그와 읽기 전용 대조 스크립트는 로컬 작업 폴더
`/tmp/inheritance-security-20261103.TyXfDq/`에 있다. 장기 보관용 요약, 원본 해시,
계약 소스 해시와 공개 코드 대조 영수증은
[`SECURITY_REVIEW_2026-11-03.json`](SECURITY_REVIEW_2026-11-03.json)에 저장했다.
다른 PC용 인계에는 원본 로그를 담은
[`security-review-2026-11-03-evidence.tar.gz`](security-review-2026-11-03-evidence.tar.gz)도
포함했다. 받는 방법과 해시 검증은
[`SECURITY_HANDOFF_2026-11-03.md`](SECURITY_HANDOFF_2026-11-03.md)를 따른다.

## 컴파일러와 별도 확인 사항

운영과 같은 Foundry **v1.3.2**, Solidity **0.8.24**, optimizer 200,
EVM Cancun 설정을 사용했다. 도구는 별도 임시 폴더에서 실행했다.
기존 바이너리·계정·배포 설정은 변경하지 않았다.

Solidity 공식 현재 버그 목록에서 0.8.24 관련 항목도 대조했다. memory bytes 원소
`delete`, 상호 재귀 IR spill, storage 경계 wraparound의 관련 사용자 코드 패턴은
확인하지 못했다. `SOL-2026-7`의 optimizer bookkeeping 문제는 컴파일러 생성 코드까지
영향 여부를 완전히 배제했다고 주장하지 않는다. 실제 오컴파일/악용은 입증하지
못했으며, 후속 신규 배포에서는 수정 컴파일러로 빌드 비교와 재검증할 사안이다.
계측용 IR 커버리지 결과를 운영 설정의 오컴파일 부재 증명으로 사용하지 않는다.
현재 USDC 금고 runtime은 24,295 bytes로 EIP-170 한도까지 281 bytes만 남아 있다.
후속 수정은 코드 크기와 생성 코드 저장 경로를 다시 확인해야 한다.

보관형 WLD 상단 주석 중 갱신 가능 시점을 7일 창으로만 설명하는 부분과 실제
`ping` 동작의 차이, Morpho 문서의 redeem gas 350,000과 코드 300,000의 차이는
문서 정합성 보완 사항이다. 이것을 대기 기간 우회나 자산 탈취로 분류하지 않았다.

외부 Morpho/Re7 자체의 전체 감사, 시장/거버넌스 위험, 서버·지갑 키 보안,
World App 실기기 수락과 법적 검토는 이 계약 코드 검토의 증거 범위 밖이다.
현재 배포는 immutable이므로 소스 수정만으로 기존 금고가 고쳐지지 않는다.
M-01/M-02를 수정하려면 새 계약 설계와 신규 배포, 이용자가 선택하는 자산 이전 및
구형 경로 유지 계획이 필요하다. 이번 작업에서는 계약 수정·배포·운영 송금을 수행하지 않았다.

## 재현 명령

Foundry v1.3.2와 solc 0.8.24를 PATH/Foundry 설정으로 준비한 뒤 실행한다.

```sh
# 조건부 장애와 미배포 계약 결함 재현: 5개
forge test --match-path test/SecurityReview.t.sol -vv

# 실제 Re7 수수료 대조: 1개
SECURITY_FORK_RPC=https://worldchain-mainnet.g.alchemy.com/public \
SECURITY_FORK_BLOCK=35837437 \
forge test --match-contract SecurityReviewColdShareFeeForkTest -vv

# 모든 필수 포크 suite: 22개, 누락/생략 시 실패
WORLDCHAIN_FORK_RPC=https://worldchain-mainnet.g.alchemy.com/public \
WORLDCHAIN_FORK_BLOCK=35837437 \
node scripts/verify/worldchain-forks.mjs

# RPC 환경이 없을 때 fork setup 생략은 전체 검증 완료가 아니다.
forge test -vv
forge fmt --check
forge build --sizes
node scripts/check-natspec.mjs
node scripts/gen-abi-errors.mjs --check
forge coverage --report summary --ir-minimum > coverage-summary.txt
node scripts/check-custody-coverage.mjs coverage-summary.txt
```

## 1차 자료

- [ERC-4626 표준](https://eips.ethereum.org/EIPS/eip-4626): 지분/기초 자산 단위, quote와 실행, 인출 제한.
- [Morpho MetaMorpho 소스](https://github.com/morpho-org/metamorpho/blob/main/src/MetaMorpho.sol): 고정 연동 전략 인터페이스와 시장 순회 확인 자료.
- [Merkl Distributor 소스](https://github.com/AngleProtocol/merkl-contracts/blob/main/contracts/Distributor.sol): 누적 claimed 회계와 업그레이드 경계 확인 자료. 현재 main 소스를 특정 과거 배포의 exact source로 간주하지 않았다.
- [Solidity 알려진 버그](https://docs.soliditylang.org/en/latest/bugs.html),
  [버전별 목록](https://github.com/ethereum/solidity/blob/develop/docs/bugs_by_version.json): 컴파일러 점검.
- [EIP-6780](https://eips.ethereum.org/EIPS/eip-6780): `SELFDESTRUCT`의 ETH 이전 동작.
