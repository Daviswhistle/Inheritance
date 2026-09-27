/**
 * 알림 결정 로직 테스트.
 *
 * decideAlerts 는 "지금 누구에게 무엇을 보내야 하는가" 를 정한다. 상속이 두 단계로
 * 바뀌면서 이 로직이 통째로 바뀐 부분이므로, 각 상태를 명시적으로 고정해 검증한다.
 *
 * RPC 없이 순수 함수만 쓴다.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 워커 소스를 경로 하드코딩 없이 이 파일 위치에서 찾는다
const here = resolve(dirname(fileURLToPath(import.meta.url)), "..", "backend", "src");
const src = readFileSync(resolve(here, "worker.mjs"), "utf8");

// decideAlerts, ALERT, EXPIRING_* 를 워커에서 그대로 떼어낸다.
// 붙여서 쓰면 테스트와 제품이 같은 코드다 — 복사본을 테스트하는 셈이 된다.
const start = src.indexOf("const ALERT = {");
const end = src.indexOf("const checkWatcher = async");
assert.ok(start > 0 && end > start, "decideAlerts 블록을 찾지 못했다");
const zeroAt = src.indexOf("const ZERO_ADDRESS");
const zeroLine = src.slice(zeroAt).split("\n")[0];

// readDelivery 는 checkWatcher 뒤쪽(전송 헬퍼 근처)에 있으므로 따로 뺀다.
const rdStart = src.indexOf("const readDelivery = (res, walletAddress) => {");
const rdEnd = src.indexOf("const sendWorldNotification = async");
assert.ok(rdStart > 0 && rdEnd > rdStart, "readDelivery 블록을 찾지 못했다");

const extracted = [
  zeroLine,
  src.slice(start, end),
  src.slice(rdStart, rdEnd),
].join("\n");
writeFileSync(
  resolve(here, ".alerts-extract.mjs"),
  extracted + "\nexport { decideAlerts, shouldSend, markAlert, readDelivery, ALERT };\n",
);
const { decideAlerts, shouldSend, markAlert, readDelivery, ALERT } = await import(
  resolve(here, ".alerts-extract.mjs")
);

const OWNER = "0x1111111111111111111111111111111111111111";
const HEIR = "0x2222222222222222222222222222222222222222";
const ZERO = "0x0000000000000000000000000000000000000000";
const DAY = 86400n;

const base = {
  vaultAddress: "0x9999999999999999999999999999999999999999",
  ownerAddress: OWNER,
  heirAddress: HEIR,
  vaultBalance: 50000000000000000000n,
  isExpired: false,
  claimPending: false,
  claimableNow: false,
  cancelled: false,
  claimedAt: 0n,
  challengeEndsAt: 0n,
  timeRemaining: 30n * DAY,
  heartbeatInterval: 30n * DAY,
};

const kinds = (snap, prev = {}) => decideAlerts(snap, prev).alerts.map((a) => a.kind);
const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, msg: e.message });
  }
};

// ---------------------------------------------------------------- 상태별 검증

check("활성 + 시간 여유 → 아무 알림도 없음", () => {
  assert.deepEqual(kinds(base), []);
});

check("기한 임박 (주기의 5% 이내) → 피상속인에게 갱신 경고", () => {
  const k = kinds({ ...base, timeRemaining: DAY });   // 30일 중 1일 = 3.3%
  assert.deepEqual(k, [ALERT.OWNER_EXPIRING]);
});

check("기한 임박 경고는 한 번만 (dedupe)", () => {
  const snap = { ...base, timeRemaining: DAY };
  assert.deepEqual(kinds(snap, { [ALERT.OWNER_EXPIRING]: "2026-01-01" }), []);
});

check("기한 지남 + 미신청 → 상속인에게 신청 안내", () => {
  const k = kinds({ ...base, isExpired: true, timeRemaining: 0n });
  assert.deepEqual(k, [ALERT.HEIR_CLAIMABLE]);
});

check("상속인이 신청함 → 피상속인에게 최우선 알림", () => {
  const k = kinds({ ...base, claimPending: true, challengeEndsAt: 1_800_000_000n });
  assert.deepEqual(k, [ALERT.OWNER_CLAIM_FILED]);
});

check("신청 중에도 상속인 신청 안내는 반복하지 않음", () => {
  const k = kinds({ ...base, claimPending: true }, { [ALERT.HEIR_CLAIMABLE]: "x" });
  assert.deepEqual(k, [ALERT.OWNER_CLAIM_FILED]);
});

check("7일 경과 → 상속인에게 인출 가능 알림", () => {
  const k = kinds({ ...base, claimPending: true, claimableNow: true });
  assert.deepEqual(k, [ALERT.HEIR_FINALIZABLE]);
});

check("7일 경과 후에도 신청 알림은 반복하지 않음", () => {
  const k = kinds(
    { ...base, claimPending: true, claimableNow: true },
    { [ALERT.OWNER_CLAIM_FILED]: "x", [ALERT.HEIR_CLAIMABLE]: "x" },
  );
  assert.deepEqual(k, [ALERT.HEIR_FINALIZABLE]);
});

check("상속 취소(heir = owner) → 상속인 알림 없음", () => {
  const k = kinds({ ...base, heirAddress: OWNER, cancelled: true, isExpired: true });
  assert.deepEqual(k, []);
});

check("잔고 0 → 알림 없음", () => {
  assert.deepEqual(kinds({ ...base, vaultBalance: 0n, timeRemaining: DAY }), []);
});

check("상속 완료 → 알림 없음", () => {
  assert.deepEqual(kinds({ ...base, claimedAt: 1_800_000_000n }), []);
});

check("금고가 없음 → 알림 없음", () => {
  assert.deepEqual(kinds({ ...base, ownerAddress: ZERO }), []);
});

check("상태 미상(null) → 근거 없이 알림하지 않음", () => {
  // 예전 canClaim() 처럼 모르는 상태에서 sendsomething 하지 않는다.
  const k = kinds({ ...base, isExpired: null, claimPending: null, claimableNow: null });
  assert.deepEqual(k, []);
});

check("주기 길이와 무관하게 임박 판단이 성립 (1일 주기 5% = 72분)", () => {
  const k = kinds({ ...base, heartbeatInterval: DAY, timeRemaining: 30n * 60n });
  assert.deepEqual(k, [ALERT.OWNER_EXPIRING]);
  // 주기의 50% 가 남았으면 경고 대상 아님
  assert.deepEqual(kinds({ ...base, heartbeatInterval: DAY, timeRemaining: 12n * 3600n }), []);
});

check("알림 대상이 올바른 주체로 간다", () => {
  const a = decideAlerts({ ...base, claimPending: true, challengeEndsAt: 1_800_000_000n }, {}).alerts;
  assert.equal(a[0].to, OWNER, "신청 알림은 피상속인에게");
  const b = decideAlerts({ ...base, isExpired: true, timeRemaining: 0n }, {}).alerts;
  assert.equal(b[0].to, HEIR, "신청 안내는 상속인에게");
});

check("알림 문구에 이의제기 기한이 들어간다", () => {
  const a = decideAlerts({ ...base, claimPending: true, challengeEndsAt: 1_800_000_000n }, {}).alerts[0];
  assert.match(a.message, /2027/, "기한 날짜가 메시지에 포함돼야 한다");
});

// ------------------------------------------------- 전달 결과 판정 (실측에서 발견된 함정)
//
// 알림 API 는 200 을 주면서 동시에 sent:false 를 준다. 월드앱을 설치하지 않은
// 지갑이면 "User not found" 다. 예전 코드는 res.ok 만 봐서 이것을 성공으로
// 세었고, 그 결과 dedupe 키가 영구히 찍혀 상속인은 알림을 다시 못 받았다.

check("200 + sent:true → 전달로 인정", () => {
  const r = readDelivery({ success: true, result: [{ walletAddress: HEIR, sent: true }] }, HEIR);
  assert.equal(r.delivered, true);
});

check("200 + sent:false → 전달 실패로 인정 (이게 핵심)", () => {
  const r = readDelivery(
    { success: true, result: [{ walletAddress: HEIR, sent: false, reason: "User not found" }] },
    HEIR,
  );
  assert.equal(r.delivered, false, "200 이어도 미전달은 미전달이다");
  assert.equal(r.reason, "User not found");
});

check("주소 대소문자 무관하게 자기 행을 찾는다", () => {
  const r = readDelivery(
    { success: true, result: [{ walletAddress: HEIR.toLowerCase(), sent: true }] },
    HEIR,
  );
  assert.equal(r.delivered, true);
});

check("결과 행이 없으면 실패로 잡는다 (낙관적 판정 금지)", () => {
  const r = readDelivery({ success: true, result: [] }, HEIR);
  assert.equal(r.delivered, false);
});

check("결과의 delivered:false 는 24시간 뒤에 다시 보낸다", () => {
  const now = Date.parse("2026-09-27T00:00:00Z");
  const prev = {};
  markAlert(prev, ALERT.HEIR_CLAIMABLE, new Date(now).toISOString(), false, "User not found");
  assert.equal(shouldSend(prev, ALERT.HEIR_CLAIMABLE, now + 60_000), false, "재시도 간격 안이면 안 보낸다");
  assert.equal(shouldSend(prev, ALERT.HEIR_CLAIMABLE, now + 25 * 3600_000), true, "하루 지나면 다시 보낸다");
});

check("sent:false 였어도 상태가 그대로면 매 분 재시도하지 않는다", () => {
  // 1분 간격 cron 이므로 이게 안 막히면 분당 1440회 호출이 된다.
  const now = Date.parse("2026-09-27T00:00:00Z");
  const prev = {};
  markAlert(prev, ALERT.OWNER_EXPIRING, new Date(now).toISOString(), false, "User not found");
  let calls = 0;
  for (let m = 1; m <= 60; m += 1) {
    if (shouldSend(prev, ALERT.OWNER_EXPIRING, now + m * 60_000)) calls += 1;
  }
  assert.equal(calls, 0, "한 시간 동안 재시도 0회여야 한다");
});

check("전달 성공 기록도 24시간 뒤면 재무장된다", () => {
  const now = Date.parse("2026-09-27T00:00:00Z");
  const prev = {};
  markAlert(prev, ALERT.HEIR_FINALIZABLE, new Date(now).toISOString(), true);
  assert.equal(shouldSend(prev, ALERT.HEIR_FINALIZABLE, now + 3600_000), false);
  assert.equal(shouldSend(prev, ALERT.HEIR_FINALIZABLE, now + 25 * 3600_000), true);
});

check("옛 형식(문자열) 기록은 보낸 것으로 간주 — 즉시 재전송하지 않는다", () => {
  const prev = { [ALERT.OWNER_CLAIM_FILED]: "2026-01-01T00:00:00Z" };
  assert.equal(shouldSend(prev, ALERT.OWNER_CLAIM_FILED, Date.parse("2026-01-01T00:10:00Z")), false);
});

check("기록이 깨졌으면 보내는 쪽으로 (조용히 삼키지 않는다)", () => {
  const prev = { [ALERT.OWNER_EXPIRING]: { at: "not-a-date" } };
  assert.equal(shouldSend(prev, ALERT.OWNER_EXPIRING, Date.now()), true);
});

check("기록이 아예 없으면 보낸다", () => {
  assert.equal(shouldSend({}, ALERT.HEIR_CLAIMABLE, Date.now()), true);
});

// ---------------------------------------------------------------- 결과
console.log("\n  === 알림 결정 로직 ===");
for (const r of results) {
  console.log(`  ${r.ok ? "OK  " : "NG  "}${r.name}${r.msg ? "\n        " + r.msg.split("\n")[0] : ""}`);
}
const bad = results.filter((r) => !r.ok);
console.log(`\n  ${results.length - bad.length}/${results.length} 통과`);
process.exit(bad.length ? 1 : 0);
