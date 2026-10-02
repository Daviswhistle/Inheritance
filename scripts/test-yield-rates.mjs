import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "../app/node_modules/vite/dist/node/index.js";

const strategy = "0x348831b46876d3dF2Db98BdEc5E3B4083329Ab9f";
const token = "0x2cFc85d8E48F8EAB294be644d9E25C3030863003";
Object.assign(process.env, { VITE_FACTORY_ADDRESS: "0x0000000000000000000000000000000000000001",
  VITE_WLD_ADDRESS: token, VITE_YIELD_FACTORY_ADDRESS: "0x0000000000000000000000000000000000000002",
  VITE_MORPHO_VAULT_ADDRESS: strategy });
const vite = await createServer({ root: fileURLToPath(new URL("../app/", import.meta.url)), configFile: false, logLevel: "error",
  optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false } });
const originalFetch = globalThis.fetch;
let checks = 0;
const check = (name, run) => { run(); checks++; console.log("PASS " + name); };
try {
  const { parseYieldRates, fetchYieldRates, formatRate, RATE_MAX_AGE_SECONDS } = await vite.ssrLoadModule("/src/yield-rates.ts");
  const now = Math.floor(Date.now() / 1000);
  const entry = overrides => ({ chainId: 480, type: "MORPHOVAULT", identifier: strategy, status: "LIVE",
    latestCampaignEnd: String(now + 3600), nativeAprRecord: { timestamp: String(now - 100), value: 0.0013 },
    aprRecord: { timestamp: String(now - 200), cumulated: 1.7 },
    rewardsRecord: { breakdowns: [{ token: { address: token, chainId: 480, decimals: 18 } }] }, ...overrides });
  check("Verified-human rewards are excluded even when returned beside the general campaign", () => {
    const boost = entry({ type: "ERC20LOGPROCESSOR", aprRecord: { timestamp: String(now), cumulated: 7.55 } });
    assert.deepEqual(parseYieldRates([boost, entry()], now), { lendingApr: 0.0013, rewardApr: 1.7,
      reportedAt: now - 200, campaignEndsAt: now + 3600 });
  });
  check("Undated top-level totals cannot override the dated general rate", () => {
    assert.equal(parseYieldRates([entry({ totalApr: 9.25, apr: 8.5 })], now).rewardApr, 1.7);
  });
  for (const overrides of [{ chainId: 1 }, { identifier: token }, { type: "ERC20LOGPROCESSOR" }, { status: "PAST" },
    { latestCampaignEnd: String(now) }, { nativeAprRecord: { timestamp: String(now - RATE_MAX_AGE_SECONDS - 1), value: 0.0013 } },
    { aprRecord: { timestamp: String(now + 301), cumulated: 1.7 } },
    { aprRecord: { timestamp: String(now), cumulated: -1 } },
    { aprRecord: { timestamp: String(now), cumulated: "9.19" } },
    { rewardsRecord: { breakdowns: [{ token: { address: strategy, chainId: 480, decimals: 18 } }] } },
    { rewardsRecord: { breakdowns: [{ token: { address: token, chainId: 480, decimals: 6 } }] } }]) {
    check("An incompatible, stale or invalid rate is rejected", () => assert.throws(() => parseYieldRates([entry(overrides)], now)));
  }
  check("Ambiguous strategies and malformed results are rejected", () => {
    for (const data of [null, {}, [entry(), entry()], [], Array(33).fill(entry())]) assert.throws(() => parseYieldRates(data, now));
  });
  check("Tiny lending returns stay visible without rounding up", () => {
    assert.equal(formatRate(0.0013), "<0.01%"); assert.equal(formatRate(0), "0.00%"); assert.equal(formatRate(1.7), "1.70%");
  });
  const usdcStrategy = "0xb1E80387EbE53Ff75a89736097D34dC8D9E9045B";
  const usdcEntry = entry({ identifier: usdcStrategy, nativeAprRecord: { timestamp: String(now - 100), value: 1.79 },
    aprRecord: { timestamp: String(now - 200), cumulated: 5.68 } });
  check("USDC lending and WLD campaign rewards retain separate rates and the selected strategy", () => {
    assert.equal(parseYieldRates([usdcEntry], now, usdcStrategy).lendingApr, 1.79);
    assert.equal(parseYieldRates([usdcEntry], now, usdcStrategy).rewardApr, 5.68);
    assert.throws(() => parseYieldRates([usdcEntry], now, strategy));
    assert.throws(() => parseYieldRates([entry()], now, usdcStrategy));
  });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, `https://api.merkl.xyz/v4/opportunities?chainId=480&identifier=${strategy}`);
    assert.equal(options.credentials, "omit"); assert.equal(options.referrerPolicy, "no-referrer");
    return new Response(JSON.stringify([entry()]), { status: 200 });
  };
  assert.equal((await fetchYieldRates(new AbortController().signal)).rewardApr, 1.7); checks++;
  globalThis.fetch = async () => new Response("down", { status: 503 });
  await assert.rejects(fetchYieldRates(new AbortController().signal), /unavailable/); checks++;
  console.log(`${checks} yield-rate validation checks passed.`);
} finally { globalThis.fetch = originalFetch; await vite.close(); }
