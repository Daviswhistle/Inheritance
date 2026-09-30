// World Chain 에 팩토리를 배포하고, 올라간 코드를 검증한다.
//
// 왜 forge script 가 아닌가
// ------------------------
// `forge script … --broadcast` 는 시뮬레이션을 먼저 하고, 거기에 아카이브 상태가
// 필요해 공개 World Chain RPC 로는 전부 실패한다 (HTTP 500 / fork 불가). 그래서 실제
// 배포는 서명 → 수동 브로드캐스트로 한다. 서명 트랜잭션이 여러 엔드포인트로 나가도
// nonce 가 같아 중복 채굴이 되지 않는다.
//
// 이 스크립트가 하는 것
//   1. 체인 아이디와 WLD 가 컨트랙트인지 확인 (컨트랙트가 아니면 생성자가 revert)
//   2. CREATE 코드를 조립하고 **gasLimit 을 고정값으로** 준다
//   3. 서명하고 여러 엔드포인트로 순차 시도해 전송
//   4. 리ceipt 를 받고, **온체인 런타임 코드를 forge 아티팩트와 바이트 단위로 대조**한다
//   5. WLD() 와 createVault 시뮬레이션까지 확인하고 배포 기록을 남긴다
//
// 4번이 없으면 "리ceipt 가 왔다" 가 "옳은 코드가 올라갔다" 를 뜻하지 않는다.
//
// 사용:  node scripts/deploy-factory.mjs
// 키는 .env.deploy 에서 읽는다 (argv·환경변수 덤프로 절대 새지 않는다).
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const RPCS = [
  process.env.WORLD_RPC || "https://worldchain-mainnet.drpc.org",
  "https://worldchain-mainnet.g.alchemy.com/v2/demo",
];
const WLD = "0x2cfc85d8e48f8eab294be644d9e25c3030863003";
const CHAIN_ID = 480;
const ART = path.join(REPO, "out/InheritanceVaultWLDFactoryOnePerOwner.sol/InheritanceVaultWLDFactoryOnePerOwner.json");
const DEPLOYMENTS = path.join(REPO, "DEPLOYMENTS.md");

// 공개 RPC 는 가끔 감지 실패가 try/catch 밖으로 새어 프로세스를 죽인다.
process.on("unhandledRejection", () => {});
const { ethers } = await import(path.join(REPO, "app/node_modules/ethers/lib.esm/index.js"));

const log = (s) => console.log(s);
let fail = 0;
const check = (n, ok, d) => { if (!ok) fail++; log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };

// ── 키 ────────────────────────────────────────────────────────────
let envTxt;
try {
  envTxt = readFileSync(path.join(REPO, ".env.deploy"), "utf8");
} catch {
  console.error("  .env.deploy 이 없습니다. .env.deploy.example 을 보고 채워 넣으세요.");
  process.exit(2);
}
const rawPk = envTxt.split("\n").find((l) => l.startsWith("PRIVATE_KEY="))?.split("=")[1]?.trim();
if (!rawPk) { console.error("  .env.deploy 에 PRIVATE_KEY 가 없습니다."); process.exit(2); }
const wallet = new ethers.Wallet(rawPk.startsWith("0x") ? rawPk : "0x" + rawPk);
const from = await wallet.getAddress();

// ── 여러 엔드포인트 중 살아 있는 것을 매 호출마다 고른다 ──────────
const providers = RPCS.map((u) => new ethers.JsonRpcProvider(u, CHAIN_ID, { staticNetwork: true, batchMaxCount: 1 }));
async function anyCall(label, fn) {
  let last;
  for (let i = 0; i < 10; i++) {
    for (const p of providers) { try { return await fn(p); } catch (e) { last = e; } }
    await new Promise((r) => setTimeout(r, 1000 + i * 300));
  }
  throw new Error(`${label} 실패: ${String(last?.message).slice(0, 140)}`);
}

log(`\n  배포자 ${from}`);
log(`  체인 ${CHAIN_ID}, RPC ${RPCS.join(" / ")}`);

const bal = await anyCall("잔액", (p) => p.getBalance(from));
log(`  잔액 ${ethers.formatEther(bal)} ETH`);
const nonce = await anyCall("nonce", (p) => p.getTransactionCount(from));
log(`  nonce ${nonce}`);

const wldCode = await anyCall("WLD 코드", (p) => p.getCode(WLD));
check("WLD 가 컨트랙트다", wldCode !== "0x", WLD);

// ── CREATE 코드 ───────────────────────────────────────────────────
const art = JSON.parse(readFileSync(ART, "utf8"));
const ctorArg = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [WLD]);
const createCode = art.bytecode.object + ctorArg.slice(2);
log(`  생성 코드 ${(createCode.length - 2) / 2} 바이트`);

const predicted = ethers.getCreateAddress({ from, nonce });
log(`  예측 주소 ${predicted}`);

// gasLimit 은 고정값. estimateGas 를 쓰면 안 된다 — 공개 RPC 가 CREATE 에 대해
// 실제값의 1/27 을 돌려줬고, 그 값에 맞춰 잡은 첫 시도가 out-of-gas 로 revert 됐다.
const est = await anyCall("estimateGas", async (p) => {
  try { return await p.estimateGas({ from, data: createCode }); } catch { return 0n; }
}).catch(() => 0n);
const MIN_CREATE_GAS = 2_200_000n;
const GAS = 3_000_000n;
if (est && est < MIN_CREATE_GAS) {
  log(`  ⚠ estimateGas ${est} — CREATE 에 필요한 양보다 훨씬 작다. 무시하고 ${GAS} 을 쓴다`);
} else {
  log(`  gasLimit ${GAS} (estimateGas ${est || "실패"})`);
}

const fee = await anyCall("fee", (p) => p.getFeeData());
const cost = GAS * (fee.maxFeePerGas ?? 0n);
check("잔액이 충분하다", bal > cost * 2n, `${ethers.formatEther(bal)} ETH 보유, 상한 ${ethers.formatEther(cost)} ETH`);

const tx = await wallet.signTransaction({
  chainId: CHAIN_ID, nonce, to: null, data: createCode, gasLimit: GAS, type: 2,
  maxFeePerGas: fee.maxFeePerGas ?? 0x2e5f3a1000n,
  maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? 0x5f5e100n,
});
const hash = ethers.keccak256(tx);
log(`\n  서명 ${hash}`);

if (process.env.DRY_RUN) {
  log("  DRY_RUN — 브로드캐스트하지 않는다");
  process.exit(0);
}

log("  브로드캐스트…");
let sent = false;
for (let a = 0; a < 6 && !sent; a++) {
  for (const p of providers) { try { await p.broadcastTransaction(tx); sent = true; break; } catch {} }
  if (!sent) await new Promise((r) => setTimeout(r, 2500));
}
if (!sent) { console.error("  ✗ 전송 실패 — 체인에 아무것도 올라가지 않았다"); process.exit(1); }

let receipt;
for (let a = 0; a < 40 && !receipt; a++) {
  for (const p of providers) { try { receipt = await p.getTransactionReceipt(hash); if (receipt) break; } catch {} }
  if (!receipt) await new Promise((r) => setTimeout(r, 3000));
}
if (!receipt) { console.error("  ✗ 리ceipt 없음"); process.exit(1); }

check("트랜잭션 성공", receipt.status === 1, `status=${receipt.status}`);
check("생성 주소가 예측과 같다", receipt.contractAddress === predicted, receipt.contractAddress);
log(`  블록 ${receipt.blockNumber}, gasUsed ${receipt.gasUsed}`);

// ── 여기부터가 진짜 검증 ──────────────────────────────────────────
const deployed = receipt.contractAddress;
const onchain = ((await anyCall("코드", (p) => p.getCode(deployed))) || "0x").toLowerCase();
const wldHex = WLD.slice(2).toLowerCase();
const occurrences = onchain.split(wldHex).length - 1;
// 아티팩트는 불변 자리를 0 으로 남겨 둔다. 주소를 같은 길이의 0 으로 치환해야 길이가 맞아
// 비교된다. (지우면 길이부터 어긋나고 언제나 실패한다.)
const zeroed = onchain.split(wldHex).join("0".repeat(40));
check("온체인 코드가 아티팩트와 바이트 단위로 일치", zeroed === art.deployedBytecode.object.toLowerCase(),
  zeroed === art.deployedBytecode.object.toLowerCase()
    ? `${(onchain.length - 2) / 2} 바이트 완전 일치 (WLD 불변 ${occurrences}곳)`
    : "다름 — 배포된 것이 검증한 것과 아니다");

const iface = new ethers.Interface(art.abi);
const enc = (fn, ...a) => iface.encodeFunctionData(fn, a);
async function rawCall(data, fromAddr) {
  let out, err;
  for (let i = 0; i < 8 && out === undefined; i++) {
    for (const u of RPCS) {
      try {
        const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call",
            params: [{ from: fromAddr, to: deployed, data }, "latest"] }) });
        const j = await r.json();
        if (j.result !== undefined) out = j.result; else if (j.error) err = j.error;
      } catch {}
    }
    if (out === undefined) await new Promise((r) => setTimeout(r, 1200));
  }
  return { out, err };
}
// raw eth_call 을 쓴 이유: ethers 의 staticCall 은 rate-limit 된 노드에서 revert 가
// 아닌 전송 오류를 던지고 그것을 revert 로 오독한다 — 실제로 "createVault 실패" 라고
// 잘못 보고했다.
const probeOwner = "0x" + "22".repeat(20);
const cv = await rawCall(enc("createVault", "0x" + "33".repeat(20), 86400), probeOwner);
check("createVault 가 성공을 시뮬레이션한다", typeof cv.out === "string" && cv.out.length === 66,
  cv.out ? ethers.getAddress("0x" + cv.out.slice(-40)) : JSON.stringify(cv.err).slice(0, 90));
const bad = await rawCall(enc("createVault", ethers.ZeroAddress, 86400), probeOwner);
check("0 주소 상속인은 거부된다", bad.out === undefined,
  (bad.err?.data || "").toLowerCase().includes(iface.getError("InvalidAddress").selector.slice(2).toLowerCase())
    ? "InvalidAddress" : JSON.stringify(bad.err).slice(0, 70));

if (fail === 0) {
  const row = `\n| ${new Date().toISOString().slice(0, 10)} | \`${deployed}\` | ${receipt.blockNumber} | \`${hash}\` | ${receipt.gasUsed} | ${ethers.formatEther(BigInt(receipt.gasUsed) * (fee.maxFeePerGas ?? 0n))} ETH |\n`;
  let cur = "";
  try { cur = readFileSync(DEPLOYMENTS, "utf8"); } catch {}
  if (!cur.includes("## 메인넷")) {
    cur = `# 배포 기록\n\n## 메인넷 (World Chain, chainId 480)\n\n| 날짜 | 팩토리 | 블록 | tx | gasUsed | 비용 |\n|---|---|---|---|---|---|\n`;
  }
  cur += row;
  writeFileSync(DEPLOYMENTS, cur);
  log(`\n  기록 추가: DEPLOYMENTS.md`);
}

log(`\n  팩토리 ${deployed}`);
log(`  블록   ${receipt.blockNumber}`);
log(`  실패 ${fail}건`);
process.exit(fail ? 1 : 0);
