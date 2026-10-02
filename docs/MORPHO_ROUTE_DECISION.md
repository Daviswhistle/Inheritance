# 예치 경로 판단 — 2026-10-02

목표는 예치 기간 동안 수익을 얻고, 실현한 순이익의 10%로 상속 서비스 운영비를
충당하는 것이다. 기존 구현 여부가 후보 선택의 근거는 아니다. 같은 자산·체인에서
실제 예치 가능성, 수익의 출처와 자격, 원금 위험, 상속 호환성, 변경 비용을 비교한다.

## Feather 공지에 대한 정정

[2026-09-10 공지](https://feather.zone/blog/passing-the-torch-feather-will-now-run-the-worldcoin-earn-mini-app-powered-by-morpho)는
Morpho가 운영하던 World App **화면 운영과 소유권**을 Feather로 넘기는 내용이다.
기존 예치 계약·포지션·금리 계산을 바꾸거나 온체인 이전을 요구하는 공지가 아니다.
이 공지를 Re7 금고의 owner·curator 변경으로 해석하거나, 그 이유만으로 우리 WLD
예치를 중단해야 한다고 판단하는 것은 맞지 않는다. 우리 앱은 해당 화면을 경유하지
않고 고정된 ERC-4626 계약을 직접 호출한다. 외부 금고 자체의 운용 위험은 별도로 남는다.

## 확인한 대안과 선택

Morpho 공식 API에서 World Chain의 WLD·USDC·USDC.e 금고 7개를 조회했다.
현재 비교에 쓸 수 있는 후보는 Re7 WLD와 Re7 USDC였다. 나머지는 자산 규모가
0 또는 약 $1~$5인 시험·초기 금고였고, 짧은 timelock이나 예치 비활성 경고가 있었다.
색인 결과가 모든 프로토콜의 완전한 목록이라는 뜻은 아니다.

| 후보 | 이자·일반 보상 | 중요한 차이 | 판단 |
| --- | --- | --- | --- |
| Re7 WLD | 기본 약 0.00131%, 일반 WLD 보상 약 1.70011% | WLD 가격 위험, 인증 우대 보상은 별도 자격 | 현재 WLD 경로 유지. 더 나은 동일 자산 후보가 검증되지 않음 |
| Re7 USDC | 기본 약 1.79091%, 일반 보상 약 5.67924% | 원금·이자는 USDC, 캠페인 보상은 WLD | 추가 자산의 우선 후보. WLD와 수익 단위를 섞어 비교하거나 자동 환전하지 않음 |
| Feather의 타 체인 금고 | 체인·토큰·전략마다 다름 | 브리지, 수수료, 새 권한·상속·MiniKit 경로 필요 | 화면 운영 인계만으로 World Chain의 대체 전략이라고 볼 근거 없음 |

위 수치는 2026-10-02 08:18 UTC에 조회한 공식 Merkl 기록이다. 각 기록 기준 시각은
2026-10-02 00:00 UTC이며, 일반 캠페인의 당시 종료 예정일은 2026-10-31이다.
기본·보상 APR을 구분했고 우리 10% 수수료 적용 전이다. 고정 수익이나 개별 금고의
실제 적립을 뜻하지 않는다. 100만 USDC에서 기본 이자만 유지·실현된다면 연 서비스
수수료는 약 1,791 USDC라는 조건부 계산이 가능하지만 WLD 보상 수익은 별도다.

블록 **35796739**(2026-10-02 08:18:37 UTC)에서 두 Re7 금고의 자산 주소,
예치 가능성, owner, pendingOwner, fee, timelock을 직접 확인했다. 두 금고 모두
예치 가능, 외부 운용 수수료 10%, timelock 259200초였다. owner는
`0xD8B0F4e54a8dac04E0A57392f5A630cEdb99C940`, pendingOwner·curator는 0이었다.
owner가 운용 역할을 수행할 수 있으므로 curator가 0인 것이 관리자 부재를 뜻하지 않는다.
모든 수수료·역할 변경에 3일 지연이 적용되는 것도 아니다.

USDC 주소 `0x79A02482A880bCE3F13e09Da970dC34db4CD24d1`는 현재
[Circle의 World Chain USDC 목록](https://developers.circle.com/stablecoins/usdc-contract-addresses)과
Re7 USDC의 `asset()` 반환값이 일치한다. USDC는 6자리, Re7 USDC 지분은 18자리다.
WLD 전용 입출금·보상 계산에 주소만 대입해서 출시할 수 없다.

## 바로 반영하는 개선

수익형 선택 화면과 포지션 화면에 최신 **기본 이자 / 일반 WLD 보상**을 분리해
표시한다. 날짜·수수료 적용 전 여부·보상 출처·인증 우대 제외를 함께 보여준다.
다른 체인·금고·보상 토큰·인증 전용 캠페인, 오래된 기록, 종료된 캠페인은 수치에서
제외한다. 조회 실패는 기존 수치를 지우고 안내하며 금고 생성·출금·상속을 막지 않는다.
계약이나 요금, 사용자의 예치 경로를 바꾸지 않는 출시 품질 개선이다.

이 비교 이후 사용자 승인으로 **한 화면에서 관리하는 자산별 개인 금고**를
구현했다. USDC 원금·이자는 USDC로 지급하고 WLD 보상은 같은 고정 상속인에게
별도로 지급한다. USDC 실현 순이익은 USDC 손실 회복 후 10%, 실제 수령한 WLD 보상은
별도 10%이며 다른 통화의 손실과 상계하지 않는다. 6자리 USDC와 18자리 지분,
부분 출금·손실 회복·자동 지급·늦은 보상·교체 금고의 분리를 검증한다.
WLD 자동 환전이나 기존 금고의 강제 이전은 없다. 실제 운영 활성화는 새 계약의
배포·포털 등록·앱과 서버 설정이 함께 충족돼야 한다. [USDC 설계](USDC_YIELD.md)를 본다.

인증 우대는 주소가 World ID AddressBook에 실제 등록됐는지를 요구한다. 검증된
AddressBook 소스의 `verify`는 임의 account를 받을 수 있으므로 계약 등록 자체가
무조건 불가능한 것은 아니다. 그러나 같은 nullifier가 기존 지갑에 유효하게 묶인
동안 다른 주소로 등록하면 실패한다. 당시 verificationLength는 **168일**이었다.
기존 World App 인증을 우리 계약에 복제하는 방법으로 9%대를 약속할 수 없다.
공식 증명 생성 경로와 캠페인 정책을 확인하기 전에는 우대 보상을 포함하지 않는다.

## 재확인할 1차 자료

- [Morpho 공식 API](https://api.morpho.org/graphql): `vaults(first:100, where:{chainId_in:[480], assetSymbol_in:["WLD","USDC","USDC.e"]})`.
- [WLD 일반 보상](https://api.merkl.xyz/v4/opportunities/13294148486514685761), [일반 캠페인 조건](https://api.merkl.xyz/v4/campaigns/16943384849129919792), [인증 캠페인 조건](https://api.merkl.xyz/v4/campaigns/9669175194548720403).
- [USDC 일반 보상](https://api.merkl.xyz/v4/opportunities/11217817339280669184): 당시 reward token은 WLD.
- [World ID AddressBook 검증 소스](https://worldchain-mainnet.explorer.alchemy.com/api/v2/smart-contracts/0x57b930D551e677CC36e2fA036Ae2fe8FdaE0330D).
- [MetaMorpho V1 역할·수수료 코드](https://github.com/morpho-org/metamorpho/blob/main/src/MetaMorpho.sol).
