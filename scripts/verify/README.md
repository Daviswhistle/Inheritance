# 검증 하네스

단위 테스트가 못 잡은 버그들을 잡는 곳입니다. 실제로 돈을 잃게 만들던 문제들은
전부 여기서 나왔습니다 — 화면이 무엇을 말하는지와 체인이 무엇을 말하는지를 나란히
놓고 비교해서만 보이는 종류입니다.

```bash
scripts/verify/run.sh              # 전체 (로컬 체인을 새로 만들어 재현)
scripts/verify/run.sh e2e          # 브라우저 상태 전수 구동
scripts/verify/run.sh ux           # 390×844 레이아웃 감사
scripts/verify/run.sh stale        # 체인 끊김/복구
scripts/verify/run.sh selection    # 금고 전환 중 거래 차단과 공유 링크 재로그인
scripts/verify/run.sh mainnet      # 배포된 팩토리 읽기 경로
scripts/verify/run.sh selectors    # 앱 ABI ↔ 배포 바이트코드 (로컬 불필요)
npm run test:product-ui            # 실제 SDK + 새 로컬 체인: 한국어/영어 68개 화면 배치
```

`test:product-ui`는 `npm run test-host:setup` 이후 실행합니다. `CHROME_BIN`으로
Chromium 실행 파일을 지정할 수 있습니다. `AXE_CORE_PATH`에 설치된 `axe.min.js`의
경로를 지정하면 390px의 한국어·영어 37개 상태에서 WCAG A/AA 자동 검사도 실행합니다
(현재 검증 버전: axe-core 4.10.3). 탭의 읽기 초점, 44px 터치 영역,
고정 버튼의 실제 클릭 가능 여부, 마지막 안내문의 스크롤 여백, 검토 전 거래 차단과
명시적 동의를 검사합니다. 잘못된 출금 주소·금액 차단과 정상 USDC 출금도 로컬 체인 잔액으로 검증합니다.
상속인의 자산별 단계가 같거나 다른 경우의 다음 행동, 실제 클립보드에 복사한 수령 링크,
한국어 복사 알림과 헤더 아래 배치도 확인합니다. 종료 확인창은 320×360에서도 스크롤로
동의·취소·종료 버튼에 도달할 수 있어야 하며, 대상 자산, 초기 미동의, 배경 조작 차단,
양방향 Tab, Escape·취소 후 포커스 복귀를 검사합니다. 지갑 거절 후 플랜 유지와 창 안의
오류 안내, 명시적 재승인 후 온체인 종료도 검증합니다. 화면과 `product-ui-evidence.json`은 기본적으로
`/tmp/wld-verify/shots`에 남습니다. 브라우저 화면 검증이며 실기기 인증은 아닙니다.
화면 기준은 [World 디자인 지침](https://docs.world.org/mini-apps/guidelines/design-guidelines)과
[앱 지침](https://docs.world.org/mini-apps/guidelines/app-guidelines)을 따릅니다.
종료창의 상호작용은 [WAI 모달 지침](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)을 기준으로 합니다.

### WebKit 교차 검증

`test:webkit-ui`는 별도 WebKit 엔진과 실제 MiniKit의 iOS 통신 경로로 실행합니다.
검증 도구를 앱 의존성에 추가하지 않고 아래처럼 별도 위치에 둘 수 있습니다.

```sh
npm install --prefix /tmp/inheritance-webkit playwright@1.64.1
node /tmp/inheritance-webkit/node_modules/playwright/cli.js install webkit
# 필요한 Linux 시스템 라이브러리는 Playwright의 install-deps webkit 안내를 따릅니다.
PLAYWRIGHT_MODULE=/tmp/inheritance-webkit/node_modules/playwright/index.mjs npm run test:webkit-ui
```

한국어·영어 게스트 탐색과 320/390px 배치, 소유자 상세 화면, 실제 SDK 로그인,
한 번의 승인으로 WLD·USDC 예치, 두 자산 정기 확인, 상속인의 받을 플랜과 종료창을
검증합니다. 입력·탐색·동의·취소에는 브라우저의 실제 터치 입력을 사용합니다.
가로·세로 전환 후 입력값 유지, 브라우저 네트워크 차단·복구, 승인 거절,
승인 대기 중 새로고침과 브라우저 뒤로가기 후 복귀도 확인합니다. 이때 거래 요청 수와
실제 로컬 계약의 원금·정기 확인 시각을 대조해 승인되지 않은 요청의 재실행을 검사합니다.
예치가 체인에서 완료되고 SDK 응답을 받기 전 새로고침하는 경우도 검증합니다.
거래 ID가 없는 저장 기록을 과거 영수증으로 복구하고, WLD·USDC 각각의 정확한
예치액과 추가 거래가 없음을 확인합니다.
네트워크 차단은 WebKit 자체 기능이며, 조회를 촉발하는 visibility 이벤트는 테스트에서
발생시킵니다. 이 이벤트를 실제 OS 백그라운드 전환 검증으로 세지 않습니다.
29개 배치와 실행 결과는 `/tmp/inheritance-webkit-ui/evidence.json`, 화면은 같은
디렉터리에 남습니다. `WEBKIT_VERIFY_OUT`으로 위치를 바꿀 수 있습니다.
현재 확인한 버전은 Linux WebKit 27.2 / Playwright 1.64.1입니다.
실제 iPhone의 WKWebView·키보드·World App 승인 화면 검증은 별도로 필요합니다.
[Playwright 브라우저 설치 안내](https://playwright.dev/docs/browsers)를 참고하세요.

### 현재 UI로 스토어 이미지 갱신

`store-host-shots.mjs`는 매번 새 로컬 체인과 실제 SDK를 사용해 첫 진입, 플랜 입력,
소유자 홈, 수익 수령 화면을 캡처합니다. 예시 사용자 이름은 테스트 호스트에만
적용하며 제품 DOM이나 금액 표시를 덮어쓰지 않습니다. 수익 예시는 모의 전략의
교환비율을 올려 만들고 서비스 수수료 차감 후 9 USDC가 표시되는지 확인합니다.

```sh
PLAYWRIGHT_MODULE=/tmp/inheritance-webkit/node_modules/playwright/index.mjs \
CHROME_BIN=/path/to/chrome node scripts/verify/store-host-shots.mjs
UNIFIED_STORE_IMAGES=1 STORE_RAW_DIR=/tmp/inheritance-store \
CHROME_BIN=/path/to/chrome node scripts/make-store-images.mjs
```

캡처·출처 기록은 `/tmp/inheritance-store`, 조합한 PNG는 `app/public/store`에 저장됩니다.
각 PNG의 크기 제한을 검사하며, 업로드나 배포는 하지 않습니다.

`run.sh` 는 매번 **빈 체인**을 만듭니다(`reset.sh`). 기존 상태 위에 쌓아 두면
두 번째 실행부터 어제 금고가 남아 어긋난다 — 처음에 몇 번 연속 헷갈렸던 원인입니다.

## 단계

| 파일 | 확인하는 것 | 이 하네스가 실제로 잡은 것 |
|---|---|---|
| `selectors.mjs` | 앱이 부르는 모든 함수 선택자가 배포 바이트코드 안에 있는가 | 선택자 누락은 빌드 에러가 아니라 "앱이 없는 함수를 불러 revert" 다 |
| `verify.mjs` (E2E) | 모든 상태를 실제로 조작하고, 각 단언을 `cast` 출력과 대조 | 계약에만 있고 앱에 없던 정산 잔액 회수, 라벨이 거짓말하던 인출 버튼, 200일 금고를 30일로 바꾸던 기간 필드, 자기 금고가 있는 사람에게 버려지던 상속 링크 |
| `ux2.mjs` (UX) | 390×844, 계정 상태 8종 × 전 탭 — 넘침, 탭바 가림, 터치 영역, 빈 탭 | 연결로 남의 금고를 봤을 때 Owner 화법 온보딩이 튀어나오던 문제 |
| `stale2.mjs` | 체인이 죽고 복구될 때 화면 | 체인 죽어도 15초 폴이 실패를 삼켜 "돈이 사라졌다" 고 보이던 문제 |
| `vault-selection.mjs` | 두 팩토리 사이 금고 전환과 공유 링크 재로그인 후 실제 입금·청구 | 조회 중 이전 팩토리로 입금되는 문제와 세션 만료 후 공유 금고 선택이 풀리는 문제 |
| `mainnet-read.mjs` | 앱의 실제 읽기 경로가 배포된 팩토리에서 동작하는가 | — |

## 지원 파일

- `drv.mjs` — CDP 드라이버. `window.__E2E_SIGNER__` 로 서명 주입, 기기 390×844.
  여러 호출은 로컬 Anvil의 `MockWorldAppWallet`과 EIP-7702를 이용해 한 거래로
  실행한다. 마지막 호출 실패 시 앞선 생성·입금까지 되돌아가는지 검증하며,
  실제 World App의 승인 화면을 대신 검증하지는 않는다.
  **시나리오마다 새 프로필**을 쓴다. 재사용하면 `addScriptToEvaluateOnNewDocument`
  가 누적되어 조용히 이전 계정으로 테스트한다.
- `reset.sh` — anvil 재시작, 모크 WLD, 계정 민팅, 팩토리 배포, dev 서버 기동.
  마지막 줄에 팩토리 주소를 찍는다.
- `mint.mjs` — 하네스가 쓰는 계정에 모크 WLD를 민팅한다. 주소는 `drv.mjs` 에서
  가져온다(손으로 옮기다가 오타가 나면 cast 가 조용히 죽지 않는다).

## 알 수 없는 점

- **실제 World App의 승인 UI와 서비스 정책은 별도 검증** —
  [자체 테스트 호스트](../test-host/README.md)는 실제 SDK와 로컬 체인을 연결하며,
  [Android·iOS 셸](../../test-hosts/README.md)로 기기 WebView 테스트도 준비할 수 있습니다.
  이 결과가 실제 World App의 지갑 승인·서비스 연동 검증을 대신하지는 않습니다.
- **알림의 실제 수신은 World App 유저 계정 필요** — `sent: true` 를 보려면 World App 에서
  알림이 켜진 유저가 recipient 여야 한다. 그래야 `sent:true` / `User has disabled notifications` /
  `User not found` 를 구분할 수 있다.
- **공개 World Chain RPC 의 `estimateGas` 를 신뢰하지 말 것.** CREATE 에 대해 실제값의
  1/27 을 돌려줬다. gasLimit 을 그 값에 맞춰 잡으면 out-of-gas 로 revert 된다.
  고정값을 주고 검증한다.
