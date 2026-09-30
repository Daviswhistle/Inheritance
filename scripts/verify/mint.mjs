// Mints mock WLD to every account the harness uses. Lives in its own file because
// mixing `require` and top-level `import` in `node -e` is ambiguous.
import { spawnSync } from "node:child_process";
import { ACCOUNTS } from "./drv.mjs";

const W = process.env.W;
const R = process.env.R;
const AMOUNT = "500000000000000000000"; // 500 WLD

const bad = Object.entries(ACCOUNTS).filter(([, v]) => !/^0x[0-9a-fA-F]{40}$/.test(v.a));
if (bad.length) {
  console.log("  주소 형식 오류:", bad.map(([k, v]) => `${k}(${v.a.length})`).join(", "));
  process.exit(1);
}
if (!/^0x[0-9a-fA-F]{40}$/.test(W)) {
  console.log("  WLD 주소 형식 오류:", W);
  process.exit(1);
}

for (const [k, v] of Object.entries(ACCOUNTS)) {
  if (k === "a0") continue; // the deployer already has ETH
  const r = spawnSync("cast", ["send", W, "mint(address,uint256)", v.a, AMOUNT,
    "--from", ACCOUNTS.a0.a, "--private-key", ACCOUNTS.a0.pk, "--rpc-url", R],
    { encoding: "utf8" });
  if (r.status !== 0) {
    console.log(`  민팅 실패 ${k}: ${(r.stderr || r.stdout || "").slice(0, 200)}`);
    process.exit(1);
  }
}
console.log(`  민팅된 계정: ${Object.keys(ACCOUNTS).filter((k) => k !== "a0").join(", ")}`);

// ETH 도 충전한다. anvil 은 기본 10개 계정(인덱스 0–9)만 미리 충전하므로, 여기서
// 추가한 전용 계정은 ETH 가 0 이다. WLD 는 있고 ETH 가 없으면 트랜잭션 자체가
// "insufficient funds for gas" 로 revert 해서 금고 생성부터 막힌다.
const RPC = process.env.R || "http://127.0.0.1:8546";
let funded = 0;
for (const [k, v] of Object.entries(ACCOUNTS)) {
  if (k === "a0") continue;
  const bal = spawnSync("cast", ["balance", v.a, "--rpc-url", RPC], { encoding: "utf8" }).stdout || "";
  if (BigInt((bal.trim().split(/\s+/)[0] || "0")) === 0n) {
    const r = spawnSync("cast", ["send", v.a, "--value", "10ether",
      "--from", ACCOUNTS.a0.a, "--private-key", ACCOUNTS.a0.pk, "--rpc-url", RPC],
      { encoding: "utf8" });
    if (r.status !== 0) { console.log(`  ETH 충전 실패 ${k}: ${(r.stderr || "").slice(0, 120)}`); process.exit(1); }
    funded++;
  }
}
if (funded) console.log(`  ETH 충전: ${funded}개 계정`);
