// 스토어 제출용 스크린샷.
//
// 디자인 검토용 스크린샷(d*.png)과 **목적이 다르다.** 검토용은 아무 상태나 찍어도 되지만
// 스토어용은 리뷰어가 처음 보는 첫 화면이라 아래를 모두 만족해야 한다:
//   1. 실제로 나오는 화면이다 (옛 빌드 캡처를 다시 쓰지 않는다).
//   2. 앱이 보장하지 않는 것을 말하지 않는다. 예전 showcase_1 은 "After expiry the
//      balance … cannot be recovered" 라고 적혀 있었는데, 앱은 "실제로 인출할 때까지
//      아무 때나 갱신할 수 있다" 고 말한다 — 앱이 방금 고친 바로 그 오독이다. 스토어
//      이미지가 앱보다 위험한 설명을 하면 리뷰어는 "앱이 오해를 만든다" 고 본다.
//   3. 테스트 계정·로컬 주소·연결 실패 흔적이 없다.
//   4. 앱의 실제 가치가 보이는 상태다 (카운트다운, 진행 단계, 상속인 전달).
import { launch, ACCOUNTS, APP } from "/home/davis/world-inheritance-miniapp/scripts/verify/drv.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const F = process.env.FACTORY;
if (!F) { console.error("FACTORY 필요"); process.exit(2); }
// anvil 이 배포한 테스트 WLD. 주소를 조작하려다(첫 구현이 `replace` 로 주소를 만지다
// 틀렸다) 적금 승인이 revert 되어 "At stake 0.0 WLD" 가 찍혔다 — **주소를 눈으로 확인
// 하지 않은 탓**이다. Store 이미지에 0 WLD 가 뜨면 앱이 값을 못 지키는 것처럼 보인다.
const WLD = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const RPC = "http://127.0.0.1:8546";
const OUT = process.env.SHOT_DIR || "/tmp/qa/store";
mkdirSync(OUT, { recursive: true });

const cast = (a) => {
  const r = spawnSync("cast", a, { encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout || "").trim() };
};
const send = (to, sig, args, from) =>
  cast(["send", to, sig, ...args, "--from", from.a, "--private-key", from.pk, "--rpc-url", RPC, "--gas-limit", "3000000"]);

const owner = ACCOUNTS.a2;
const heir = ACCOUNTS.a3;

// 탭 라벨은 "Home"/"Assets"/"Plan"/"Help" 로 **대문자**다. 첫 구현은 소문자로
// 비교해서 클릭이 조용히 실패했고, "Plan" 탭을 "Home" 탭인 줄 알고 저장했다.
// 반환값을 실제로 확인해야 그 다음 줄이 조용히 잘못된 화면을 찍지 않는다.
// 스토어 이미지에는 `@e2e_3c44cd` 같은 테스트 계정이 보이면 안 된다. 리뷰어가 "테스트
// 빌드를 그대로 찍었구나" 하고 읽고, 앱이 미완성이라고 판단한다. 하네스는 `/@e2e_/` 로
// 로그인 성공을 판정하므로 접두어를 지우면 그 검사가 깨진다 — **스토어 캡처에만** 이름을
// 주입하고 하네스 경로는 건드리지 않는다. (minikit-stub.ts 의 getUserByAddress 참고)
// 주소별로 **다른** 이름을 준다. 한 이름만 주면 주인과 상속인이 같은 사람으로 찍힌다.
// a1(첫 진입 화면)·a2(주인)·a3(상속인) **전부** 등록한다. 하나라도 빠지면 그 화면의
// 좌상단에 `@e2e_709979` 가 그대로 찍힌다 — 스토어 이미지에서 테스트 계정은 "개발 중"
// 이라는 가장 강한 신호다.
const PRELOAD = `window.__E2E_USERNAMES__ = {
  "${ACCOUNTS.a1.a.toLowerCase()}": "davis",
  "${owner.a.toLowerCase()}": "davis",
  "${heir.a.toLowerCase()}": "alex",
};`;

const goto = async (p, t) => {
  const r = await p.ev(`return (()=>{const e=[...document.querySelectorAll(".tab-item")].filter(x=>x.offsetParent!==null)
      .find(x=>x.textContent.trim().toLowerCase()===${JSON.stringify(t.toLowerCase())});
      if(!e) return 'NO TAB: '+${JSON.stringify(t)};
      e.click(); return 'ok';})()`);
  if (String(r).trim() !== "ok") console.log(`  !! 탭 클릭 실패: ${r}`);
  return r;
};

const connect = async (p) => {
  await sleep(3000);
  await p.ev(`(()=>{const e=[...document.querySelectorAll("button")].find(x=>/^(Connect|Continue with World App)$/.test(x.innerText.trim()));if(e)e.click();return 1;})()`);
  await sleep(7000);
};
const capture = async (p, name) => {
  const shot = await p.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(`/tmp/wld-verify/shots/${name}.png`, Buffer.from(shot.data, "base64"));
};

// The public welcome screen is the store's first impression.
{
  const p = await launch({ pk: ACCOUNTS.a1.pk, url: APP, preload: PRELOAD });
  await sleep(2000);
  await capture(p, "store-0-welcome");
  await p.close();
}

// ── 1. 첫 진입 (금고 만들기) ──────────────────────────────────────────
// 폼을 **빈 채로** 찍지 않는다. 그렇게 하면 이 한 장이 "모든 것이 회색으로 죽은 화면"
// 으로 읽힌다 — Create vault 가 비활성이고 상속인 칸이 비어 있다. 앱이 **쓸 수 있는 상태**
// 를 보여주는 것이 스토어 이미지의 일이다.
{
  const p = await launch({ pk: ACCOUNTS.a1.pk, url: APP, preload: PRELOAD });
  await connect(p);
  const set = await p.ev(`return (()=>{
    const el = document.getElementById("heir-input");
    if (!el) return "NO heir-input";
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    s.call(el, "@alex");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return "ok";
  })()`);
  if (String(set).trim() !== "ok") console.log(`  상속인 입력 실패: ${set}`);
  await sleep(4000);
  await capture(p, "store-1-create");
  await p.close();
}

// ── 2. 카운트다운 진행 중 (Vault 탭) ───────────────────────────────────
send(F, "createVault(address,uint256)", [heir.a, "2592000"], owner);
const v = cast(["call", F, "vaultOf(address)(address)", owner.a, "--rpc-url", RPC]).out;
const ap = send(WLD, "approve(address,uint256)", [F, "100000000000000000000"], owner);
const dp = send(F, "deposit(uint256)", ["12000000000000000000"], owner);
console.log("  approve:", ap.ok, " deposit:", dp.ok, " vault:", v);
const bal = cast(["call", WLD, "balanceOf(address)(uint256)", v, "--rpc-url", RPC]).out;
console.log("  금고 잔액:", BigInt(bal.split(" ")[0] || 0) / 10n ** 18n, "WLD");

// 카운트다운을 **흘린** 상태로 찍는다. 생성 직후는 "30d 0h 0m 0s" 라고 0 에서 시작해
// "막 만든 화면" 으로 읽힌다. 2.5일 흐름 legit 한 구간을 만든다.
//
// `cast rpc` 의 인자는 **배열로 감싸지 않는다** (`'["216000"]'` 로 주면
// "data did not match any variant of untagged enum NumericSeq" 로 400 이 난다).
// 그래서 카운트다운이 흐르지 않은 채 30d 0h 0m 0s 가 그대로 찍혔다.
const adv = cast(["rpc", "evm_increaseTime", "216000", "--rpc-url", RPC]);
if (!adv.ok) console.log(`  시간 이동 실패: ${adv.out.slice(0, 100)}`);
cast(["rpc", "evm_mine", "--rpc-url", RPC]);
await sleep(1000);
{
  const p = await launch({ pk: owner.pk, url: APP, preload: PRELOAD });
  await connect(p);
  await goto(p, "home");
  await sleep(1800);
  await capture(p, "store-2-countdown");
  await goto(p, "plan");
  await sleep(1800);
  await capture(p, "store-3-steps");
  await p.close();
}

console.log("vault =", v);
console.log("완료:", OUT);
