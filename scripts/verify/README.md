# 검증 하네스

단위 테스트가 못 잡은 버그들을 잡는 곳입니다. 실제로 돈을 잃게 만들던 문제들은
전부 여기서 나왔습니다 — 화면이 무엇을 말하는지와 체인이 무엇을 말하는지를 나란히
놓고 비교해서만 보이는 종류입니다.

```bash
scripts/verify/run.sh              # 전체 (로컬 체인을 새로 만들어 재현)
scripts/verify/run.sh e2e          # 브라우저 상태 전수 구동
scripts/verify/run.sh ux           # 390×844 레이아웃 감사
scripts/verify/run.sh stale        # 체인 끊김/복구
scripts/verify/run.sh mainnet      # 배포된 팩토리 읽기 경로
scripts/verify/run.sh selectors    # 앱 ABI ↔ 배포 바이트코드 (로컬 불필요)
```

`run.sh` 는 매번 **빈 체인**을 만듭니다(`reset.sh`). 기존 상태 위에 쌓아 두면
두 번째 실행부터 어제 금고가 남아 어긋난다 — 처음에 몇 번 연속 헷갈렸던 원인입니다.

## 단계

| 파일 | 확인하는 것 | 이 하네스가 실제로 잡은 것 |
|---|---|---|
| `selectors.mjs` | 앱이 부르는 모든 함수 선택자가 배포 바이트코드 안에 있는가 | 선택자 누락은 빌드 에러가 아니라 "앱이 없는 함수를 불러 revert" 다 |
| `verify.mjs` (E2E) | 모든 상태를 실제로 조작하고, 각 단언을 `cast` 출력과 대조 | 계약에만 있고 앱에 없던 정산 잔액 회수, 라벨이 거짓말하던 인출 버튼, 200일 금고를 30일로 바꾸던 기간 필드, 자기 금고가 있는 사람에게 버려지던 상속 링크 |
| `ux2.mjs` (UX) | 390×844, 계정 상태 8종 × 전 탭 — 넘침, 탭바 가림, 터치 영역, 빈 탭 | 연결로 남의 금고를 봤을 때 Owner 화법 온보딩이 튀어나오던 문제 |
| `stale2.mjs` | 체인이 죽고 복구될 때 화면 | 체인 죽어도 15초 폴이 실패를 삼켜 "돈이 사라졌다" 고 보이던 문제 |
| `mainnet-read.mjs` | 앱의 실제 읽기 경로가 배포된 팩토리에서 동작하는가 | — |

## 지원 파일

- `drv.mjs` — CDP 드라이버. `window.__E2E_SIGNER__` 로 서명 주입, 기기 390×844.
  **시나리오마다 새 프로필**을 쓴다. 재사용하면 `addScriptToEvaluateOnNewDocument`
  가 누적되어 조용히 이전 계정으로 테스트한다.
- `reset.sh` — anvil 재시작, 모크 WLD, 계정 민팅, 팩토리 배포, dev 서버 기동.
  마지막 줄에 팩토리 주소를 찍는다.
- `mint.mjs` — 하네스가 쓰는 계정에 모크 WLD를 민팅한다. 주소는 `drv.mjs` 에서
  가져온다(손으로 옮기다가 오타가 나면 cast 가 조용히 죽지 않는다).

## 알 수 없는 점

- **실제 기기 World App 안에서의 흐름은 검증 불가** — MiniKit 브리지는 World App 안에만 있다.
- **알림의 실제 수신은 World App 유저 계정 필요** — `sent: true` 를 보려면 World App 에서
  알림이 켜진 유저가 recipient 여야 한다. 그래야 `sent:true` / `User has disabled notifications` /
  `User not found` 를 구분할 수 있다.
- **공개 World Chain RPC 의 `estimateGas` 를 신뢰하지 말 것.** CREATE 에 대해 실제값의
  1/27 을 돌려줬다. gasLimit 을 그 값에 맞춰 잡으면 out-of-gas 로 revert 된다.
  고정값을 주고 검증한다.
