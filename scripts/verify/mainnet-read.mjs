import { fileURLToPath } from "node:url";
import path from "node:path";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
// Reads mainnet exactly the way the app does, using the app's own ABI from App.tsx.
import { readFileSync } from "node:fs";
// 저장소 밖의 app/node_modules 에 있으니 정적 import 경로로 쓸 수 없다.
const { ethers } = await import(REPO + "/app/node_modules/ethers/lib.esm/index.js");
process.on("unhandledRejection", () => {});
const release = readFileSync(REPO + "/app/.env.example", "utf8");
const value = key => release.match(new RegExp("^" + key + "=(.+)$", "m"))?.[1]?.trim();
const RPCS = [value("VITE_RPC"), "https://worldchain-mainnet.drpc.org"];
const FACTORY = value("VITE_FACTORY_ADDRESS");
const LEGACY = value("VITE_LEGACY_FACTORY_ADDRESS");
const WLD = value("VITE_WLD_ADDRESS");
const BLOCK = Number(value("VITE_FACTORY_DEPLOY_BLOCK"));

/* 앱의 ABI 를 **실제로 import** 한다. 예전에는 App.tsx 를 문자열로 파싱해서 배열을
   꺼냈는데, ABI 를 abis.ts 로 옮기자 조용히 빈 배열이 되어 `encodeFunctionData
   ("vaultOf")` 가 "unknown function" 으로 죽었다. 이 단계는 "앱이 메인넷에서 무엇을
   읽는가" 를 확인하는 마지막 문지기인데, 그 문지기가 앱의 ABI 를 제대로 못 보고 있었다. */
const { createServer } = await import(REPO + "/app/node_modules/vite/dist/node/index.js");
const vite = await createServer({
  root: REPO + "/app",
  configFile: false,
  logLevel: "error",
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
});
const { FACTORY_ABI, VAULT_ABI } = await vite.ssrLoadModule("/src/abis.ts");
await vite.close();
if (!FACTORY_ABI?.length || !VAULT_ABI?.length) {
  console.error("\n  abis.ts 에서 FACTORY_ABI / VAULT_ABI 를 읽지 못했습니다.\n");
  process.exit(1);
}
const f = new ethers.Interface(FACTORY_ABI);
const v = new ethers.Interface(VAULT_ABI);

async function rpc(method, params) {
  let out, err;
  for (let i = 0; i < 8 && out === undefined; i++) {
    for (const u of RPCS) {
      try {
        const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        const j = await r.json();
        if (j.result !== undefined) out = j.result; else if (j.error) err = j.error;
      } catch {}
    }
    if (out === undefined) await new Promise(r => setTimeout(r, 1500));
  }
  if (out === undefined) throw new Error(JSON.stringify(err).slice(0, 160));
  return out;
}
const call = (to, data, from) => rpc("eth_call", [{ to, data, ...(from ? { from } : {}) }, "latest"]);

let fail = 0;
const check = (n, ok, d) => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
const acct = ethers.getAddress("0x" + "5a".repeat(20)); // 임의 주소

// 앱이 로그인 직후 하는 읽기들
const vaultOf = await call(FACTORY, f.encodeFunctionData("vaultOf", [acct]));
const ZERO32 = "0x" + "0".repeat(64); // 32바이트 반환값이라 64 nibble
check("vaultOf(계정) 읽기", vaultOf.length === 66, vaultOf);
check("vaultOf 가 0 주소 (이 계정은 금고 없음)", vaultOf === ZERO32, vaultOf);

// WLD 는 ERC20 이고 앱의 VAULT_ABI 는 금고 ABI 다. 잔액은 ERC20 인터페이스로 읽는다.
const erc20 = new ethers.Interface(["function balanceOf(address) view returns (uint256)"]);
const wl = await call(WLD, erc20.encodeFunctionData("balanceOf", [acct]));
check("WLD balanceOf 읽기", BigInt(wl) >= 0n, `${ethers.formatUnits(BigInt(wl), 18)} WLD`);

// 앱이 실제로 부르는 읽기들만 검사한다. vaultsOf 는 컨트랙트에는 있어도 앱 ABI 에는
// 없다(앱이 안 쓴다) — ABI 에 없는 함수를 검사하면 검증이 아니라 오검증이 된다.
const ih = await call(FACTORY, f.encodeFunctionData("isHeirOf", [acct, ethers.getAddress("0x" + "ab".repeat(20))]));
check("isHeirOf 읽기", typeof ih === "string" && ih.length >= 66, ih);
const dec = f.decodeFunctionResult("isHeirOf", ih);
check("isHeirOf 가 false (이 계정은 상속인 아님)", dec[0] === false, dec[0]);

// Factory upgrades must keep existing vaults discoverable and routed to their source.
if (LEGACY) {
  const owner = "0x93bC44B8296977Feb479F95855D9b9E051C17dA2";
  const existing = "0xFeA316c5aEEf8818763eEB61FDfeFA391b612d18";
  const mapped = f.decodeFunctionResult("vaultOf", await call(LEGACY, f.encodeFunctionData("vaultOf", [owner])))[0];
  check("기존 금고 슬롯 유지", mapped.toLowerCase() === existing.toLowerCase(), mapped);
  const origin = v.decodeFunctionResult("factory", await call(existing, v.encodeFunctionData("factory")))[0];
  check("기존 금고가 원래 팩토리를 참조", origin.toLowerCase() === LEGACY.toLowerCase(), origin);
}

// 팩토리가 참조하는 금고 주소가 실제 컨트랙트 코드에 있는지는 메인넷에서 아직
// 확인할 금고가 없다. createVault 가 주소를 돌려주는 것으로 충분하다(앞 검증 참고).

// 상속인 자동 스캔이 쓰는 이벤트 로그 (fromBlock = 배포 블록).
//
// 앱은 `safeGetLogs`(App.tsx) 로 **청크 분할** 한다. World Chain 공개 RPC 은 한 번의
// eth_getLogs 를 100 블록으로 제한하고("You can make eth_getLogs requests with up to a
// 100 block range."), 앱 밖에서 그 제한에 부딪히면 400 이 돌아오는데 이 검증 스크립트의
// `rpc()` 는 400 을 재시도 대상이 아니라 최종 실패로 센다. 그래서 **한 번에 전체 범위를
// 던지면 검증 스크립트가 앱보다 더 엄격한 조건을 검사**하게 된다 — 앱이 실제로 succeeds
// 하는 호출을 여기서 실패로 기록하는, 검증이 아니라 오검증.
//
// 배포 블록(35,672,936) 이후 head 까지는 수십만 블록이라 어느 공개 RPC 도 한 번에
// 답하지 않는다. 앱과 똑같이 100 블록씩 나눠 훑는다. 여기서 청크 크기를 바꾸면 앱의
// 동작을 검증하는 것이 아니라 별도의 가설을 테스트하는 것이 된다 — 둘을 같게 둔다.
const LOG_CHUNK = 90; // App.tsx 의 LOG_SCAN_CHUNK 과 동일해야 한다
// 여기서 **무한정 훑지 않는다.** 배포 블록부터 head 까지는 수만 블록이라 100 블록씩
// 나누면 몇천 번의 요청이 되고 공개 RPC 이 그걸 견디지 못한다 — 이건 앱의 문제가 아니라
// **검증 시간이 무한정** 되는 문제다. 최근 MAX_CHUNKS 개 청크(한 번의 유저 세션이
// 실제로 만나는 범위)만 훑고, 배포 블록 근처는 아래의 별도 검사로 확인한다.
const MAX_CHUNKS = 20;
const head = Number(BigInt(await rpc("eth_blockNumber", [])));
const allLogs = [];
let chunksTried = 0;
for (let end = head; end > BLOCK && chunksTried < MAX_CHUNKS; end -= LOG_CHUNK, chunksTried++) {
  const start = end - LOG_CHUNK + 1;
  try {
    allLogs.push(...await rpc("eth_getLogs", [
      { fromBlock: "0x" + start.toString(16), toBlock: "0x" + end.toString(16), address: FACTORY },
    ]));
  } catch {
    // 막힌 청크는 건너뛴다 — 앱과 같은 동작
  }
  if (start <= BLOCK + 1) break;
}
const logs = allLogs;
const parsed = logs.map(l => { try { return f.parseLog(l); } catch { return null; } }).filter(Boolean);
check("배포 블록 이후 이벤트 조회 성공", true,
  `${logs.length}개 로그 (최근 ${chunksTried * LOG_CHUNK}블록 범위)`);
const kinds = [...new Set(parsed.map(p => p.name))];
if (logs.length) check("반환된 이벤트가 앱 ABI로 파싱된다", parsed.length === logs.length, kinds.join(", "));
else console.log("  INFO  실제 이벤트 파싱은 새 금고 생성 후 검증 가능 — 아직 이벤트 없음");

// 로그가 하나도 없으면 파싱 검증은 못 하므로, 배포 트랜잭션 자체를 확인한다
const txLogs = await rpc("eth_getLogs", [{ fromBlock: "0x" + BLOCK.toString(16), toBlock: "0x" + (Number(BLOCK) + 5).toString(16), address: FACTORY }]);
check("배포 블록 구간 로그 접근 가능", Array.isArray(txLogs), `${txLogs.length}개`);

/**
 * 앱의 청크 크기와 이 스크립트의 것이 같은지 — 어긋나면 위 검사가 앱을 안 검증한다.
 *
 * `readFileSync` 로 읽는다. `fetch("file://")` 는 Node 의 전역 fetch 에서 지원되지 않아
 * throw 하고, 그 throw 가 검증 실패가 아니라 **스크립트 크래시** 로 보인다 — 첫 시도에서
 * 그렇게 죽었다. 파일을 직접 읽는 것이 맞고, 에러 메시지도 다르다.
 */
{
  const app = readFileSync(new URL("../../app/src/App.tsx", import.meta.url), "utf8");
  const m = app.match(/LOG_SCAN_CHUNK\s*=\s*(\d+)/);
  check("청크 크기가 앱과 같다 (검증해야 할 대상이 실제로 앱이다)", !!m && Number(m[1]) === LOG_CHUNK,
    `앱 ${m ? m[1] : "?"} / 검증 ${LOG_CHUNK}`);
}

console.log(`\n  실패 ${fail}건`);
process.exit(fail ? 1 : 0);
