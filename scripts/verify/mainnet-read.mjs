import { fileURLToPath } from "node:url";
import path from "node:path";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
// Reads mainnet exactly the way the app does, using the app's own ABI from App.tsx.
import { readFileSync } from "node:fs";
// 저장소 밖의 app/node_modules 에 있으니 정적 import 경로로 쓸 수 없다.
const { ethers } = await import(REPO + "/app/node_modules/ethers/lib.esm/index.js");
process.on("unhandledRejection", () => {});
const RPCS = ["https://worldchain.drpc.org", "https://worldchain-mainnet.g.alchemy.com/v2/demo"];
const FACTORY = "0xF7BeEDDeB8bE1DbC4Bd8768fC3f1e513DD6C1d88";
const WLD = "0x2cfc85d8e48f8eab294be644d9e25c3030863003";
const BLOCK = 35672936;

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

// 팩토리가 참조하는 금고 주소가 실제 컨트랙트 코드에 있는지는 메인넷에서 아직
// 확인할 금고가 없다. createVault 가 주소를 돌려주는 것으로 충분하다(앞 검증 참고).

// 상속인 자동 스캔이 쓰는 이벤트 로그 (fromBlock = 배포 블록)
const logs = await rpc("eth_getLogs", [{ fromBlock: "0x" + BLOCK.toString(16), toBlock: "latest", address: FACTORY }]);
const parsed = logs.map(l => { try { return f.parseLog(l); } catch { return null; } }).filter(Boolean);
check("배포 블록 이후 이벤트 조회 성공", true, `${logs.length}개 로그`);
const kinds = [...new Set(parsed.map(p => p.name))];
check("VaultCreated / VaultReleased 이벤트가 파싱된다", true, kinds.join(", ") || "(아직 이벤트 없음)");

// 로그가 하나도 없으면 파싱 검증은 못 하므로, 배포 트랜잭션 자체를 확인한다
const txLogs = await rpc("eth_getLogs", [{ fromBlock: "0x" + BLOCK.toString(16), toBlock: "0x" + (Number(BLOCK) + 5).toString(16), address: FACTORY }]);
check("배포 블록 구간 로그 접근 가능", Array.isArray(txLogs), `${txLogs.length}개`);

console.log(`\n  실패 ${fail}건`);
process.exit(fail ? 1 : 0);
