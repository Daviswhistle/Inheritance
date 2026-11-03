import assert from "node:assert/strict";
import { Interface } from "ethers";
import { createServer } from "../app/node_modules/vite/dist/node/index.js";
const vite = await createServer({ root: process.cwd() + "/app", configFile: false, logLevel: "error", optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } });
try {
  const { readRewardsDeferred, verifiesDeferredSettlement, readExitPosition } = await vite.ssrLoadModule("/src/yield.ts");
  assert.equal(await readRewardsDeferred({ rewardsDeferred: async () => true }), true);
  assert.equal(await readRewardsDeferred({ rewardsDeferred: async () => false }), false);
  assert.equal(await readRewardsDeferred({ rewardsDeferred: async () => { throw { code: "CALL_EXCEPTION", data: "0x" }; } }), false);
  await assert.rejects(readRewardsDeferred({ rewardsDeferred: async () => { throw { code: "NETWORK_ERROR" }; } }));
  await assert.rejects(readRewardsDeferred({ rewardsDeferred: async () => { throw { code: "CALL_EXCEPTION", data: "0x12345678" }; } }));
  const principal = { shares: 100n, gross: 110n, net: 109n, fee: 1n, valued: true };
  let principalReads = 0;
  const source = { position: async () => { throw { code: "CALL_EXCEPTION" }; }, principalPosition: async () => { principalReads++; return principal; } };
  assert.deepEqual(await readExitPosition(source), { quote: principal, rewardsUnknown: true });
  assert.equal(principalReads, 1);
  await assert.rejects(readExitPosition({ ...source, position: async () => { throw { code: "NETWORK_ERROR" }; } }));
  assert.equal(principalReads, 1, "Network uncertainty cannot silently become a principal-only quote");
  await assert.rejects(readExitPosition({ ...source, principalPosition: async () => { throw { code: "CALL_EXCEPTION" }; } }));
  const vault = "0x1111111111111111111111111111111111111111", heir = "0x2222222222222222222222222222222222222222";
  const abi = new Interface(["event DeferredRewardsSettled(address indexed recipient,uint256 grossAssets)"]);
  // A zero-canonical epoch can settle gifts, or even an empty epoch. Only the fixed recipient's event proves reconciliation.
  for (const gross of [0n, 500n]) {
    const event = abi.encodeEventLog(abi.getEvent("DeferredRewardsSettled"), [heir, gross]);
    const logs = [{ address: vault, ...event }];
    assert.equal(verifiesDeferredSettlement(logs, vault, heir), true);
    assert.equal(verifiesDeferredSettlement(logs, heir, heir), false);
    assert.equal(verifiesDeferredSettlement(logs, vault, vault), false);
  }
  assert.equal(verifiesDeferredSettlement([], vault, heir), false);
  console.log("Deferred capability fallback and fixed-recipient settlement receipt checks passed.");
} finally { await vite.close(); }
