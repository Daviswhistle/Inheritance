import assert from "node:assert/strict";
import { createServer } from "../app/node_modules/vite/dist/node/index.js";

// CI has no ignored app/.env. Use explicit public fixtures, never local secrets.
Object.assign(process.env, { VITE_FACTORY_ADDRESS: "0x0000000000000000000000000000000000000001",
  VITE_WLD_ADDRESS: "0x2cFc85d8E48F8EAB294be644d9E25C3030863003" });
const vite = await createServer({ root: process.cwd() + "/app", configFile: false, logLevel: "error",
  optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false } });
const originalFetch = globalThis.fetch;
let checks = 0;
const check = (name, work) => { work(); checks++; console.log("PASS " + name); };
try {
  const { parseWldRewards, fetchWldRewards } = await vite.ssrLoadModule("/src/rewards.ts");
  const { WLD_ADDRESS } = await vite.ssrLoadModule("/src/config.ts");
  const proof = "0x" + "12".repeat(32);
  const entry = overrides => [{ chain: { id: 480 }, rewards: [{ token: { address: WLD_ADDRESS, decimals: 18 },
    amount: "100", claimed: "40", pending: "7", proofs: [proof], ...overrides }] }];
  check("Cumulative rewards and unpublished amounts stay distinct", () => {
    assert.deepEqual(parseWldRewards(entry()), { cumulative: 100n, claimed: 40n, claimable: 60n, pending: 7n, proof: [proof] });
  });
  check("No published proof means nothing can be submitted", () => assert.equal(parseWldRewards(entry({ proofs: [] })).claimable, 0n));
  check("A replayed reward has no remaining claim", () => assert.equal(parseWldRewards(entry({ claimed: "100" })).claimable, 0n));
  check("Other chains and other reward tokens are excluded", () => {
    assert.equal(parseWldRewards([{ ...entry()[0], chain: { id: 1 } }]).claimable, 0n);
    assert.equal(parseWldRewards(entry({ token: { address: "0x0000000000000000000000000000000000000001", decimals: 18 } })).claimable, 0n);
  });
  for (const amount of ["-1", "1e18", "1.5", "", 100, ((1n << 208n)).toString()]) {
    check("Invalid amount rejected: " + String(amount).slice(0, 22), () => assert.throws(() => parseWldRewards(entry({ amount }))));
  }
  check("Wrong decimals cannot be interpreted as WLD", () => assert.throws(() => parseWldRewards(entry({ token: { address: WLD_ADDRESS, decimals: 6 } }))));
  check("Claimed greater than published total is rejected", () => assert.throws(() => parseWldRewards(entry({ claimed: "101" }))));
  for (const proofs of [["0x1234"], [5], Array(65).fill(proof), "invalid"]) {
    check("Malformed or excessive proof is rejected", () => assert.throws(() => parseWldRewards(entry({ proofs }))));
  }
  check("Ambiguous WLD entries are rejected", () => {
    const e = entry(); e[0].rewards.push(e[0].rewards[0]); assert.throws(() => parseWldRewards(e));
  });
  for (const bad of [null, {}, Array(33).fill({}), [{ chain: { id: 480 }, rewards: {} }]]) {
    check("Malformed response cannot enable a claim", () => assert.throws(() => parseWldRewards(bad)));
  }
  globalThis.fetch = async (url, options) => {
    assert.match(url, /^https:\/\/api\.merkl\.xyz\/v4\/users\/0x[a-f0-9]{40}\/rewards\?chainId=480$/);
    assert.equal(options.credentials, "omit");
    assert.equal(options.referrerPolicy, "no-referrer");
    return new Response(JSON.stringify(entry()), { status: 200 });
  };
  const signal = new AbortController().signal;
  assert.equal((await fetchWldRewards("0xA11CE00000000000000000000000000000000000", signal)).claimable, 60n);
  checks++;
  await assert.rejects(fetchWldRewards("not a vault", signal)); checks++;
  globalThis.fetch = async () => new Response("down", { status: 503 });
  await assert.rejects(fetchWldRewards(WLD_ADDRESS, signal), /temporarily unavailable/); checks++;
  console.log(`${checks} rewards validation checks passed.`);
} finally { globalThis.fetch = originalFetch; await vite.close(); }
