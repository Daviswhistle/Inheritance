import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "../app/node_modules/vite/dist/node/index.js";

const requireApp = createRequire(new URL("../app/package.json", import.meta.url));
const React = requireApp("react");
const { renderToStaticMarkup } = requireApp("react-dom/server");

const strategy = "0x348831b46876d3dF2Db98BdEc5E3B4083329Ab9f";
const token = "0x2cFc85d8E48F8EAB294be644d9E25C3030863003";
Object.assign(process.env, { VITE_FACTORY_ADDRESS: "0x0000000000000000000000000000000000000001",
  VITE_WLD_ADDRESS: token, VITE_YIELD_FACTORY_ADDRESS: "0x0000000000000000000000000000000000000002",
  VITE_MORPHO_VAULT_ADDRESS: strategy });
const vite = await createServer({ root: fileURLToPath(new URL("../app/", import.meta.url)), configFile: false, logLevel: "error",
  resolve: { alias: { "@": fileURLToPath(new URL("../app/src/", import.meta.url)) } },
  optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false } });
const originalFetch = globalThis.fetch;
let checks = 0;
const check = (name, run) => { run(); checks++; console.log("PASS " + name); };
try {
  const { parseYieldRates, fetchYieldRates, formatRate, RATE_MAX_AGE_SECONDS } = await vite.ssrLoadModule("/src/yield-rates.ts");
  const { YieldRateSummary } = await vite.ssrLoadModule("/src/components/YieldVault.tsx");
  const { calculateIllustrativeFeeAmounts } = await vite.ssrLoadModule("/src/plan-fee-illustration.ts");
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
  const renderSummary = props => renderToStaticMarkup(React.createElement(YieldRateSummary, props));
  check("The shared summary shows asset-specific APRs, source links and UTC times", () => {
    const wld = renderSummary({ rates: { lendingApr: 1.2, rewardApr: 3.4, reportedAt: now - 100, campaignEndsAt: now + 3600 }, loading: false, strategy, symbol: "WLD" });
    const usdc = renderSummary({ rates: { lendingApr: 2.3, rewardApr: 5.6, reportedAt: now - 100, campaignEndsAt: now + 3600 }, loading: false, strategy: usdcStrategy, symbol: "USDC" });
    assert.match(wld, /1\.20%[\s\S]*3\.40%/); assert.match(usdc, /2\.30%[\s\S]*5\.60%/);
    assert.match(wld, /\d{1,2}:\d{2}/); assert.match(usdc, /UTC[\s\S]*UTC/);
    assert.match(wld, new RegExp(`data-rate-strategy="${strategy.toLowerCase()}"`));
    assert.match(usdc, new RegExp(`href="https:\/\/app\\.merkl\\.xyz\/opportunities\/world-chain\/MORPHOVAULT\/${usdcStrategy}"`));
  });
  check("Setup keeps the current rates and report time visible while retaining campaign limits and source in details", () => {
    const compact = renderSummary({ rates: { lendingApr: 1.2, rewardApr: 3.4, reportedAt: now - 100, campaignEndsAt: now + 3600 }, loading: false, strategy, symbol: "WLD", compact: true });
    assert.match(compact, /1\.20%[\s\S]*3\.40%[\s\S]*Reported[\s\S]*UTC[\s\S]*<details/);
    assert.match(compact, /<summary>Rate details and source<\/summary>[\s\S]*Campaign rewards are scheduled[\s\S]*app\.merkl\.xyz/);
  });
  check("Stale, failed and loading summaries never invent or retain a percentage", () => {
    const stale = renderSummary({ rates: { lendingApr: 9.99, rewardApr: 8.88, reportedAt: now - RATE_MAX_AGE_SECONDS - 1, campaignEndsAt: now + 3600 }, loading: false, strategy, symbol: "WLD" });
    const failed = renderSummary({ rates: null, loading: false, strategy, symbol: "WLD" });
    const loading = renderSummary({ rates: null, loading: true, strategy, symbol: "WLD" });
    for (const markup of [stale, failed]) { assert.match(markup, /Current rates are unavailable/); assert.doesNotMatch(markup, /<dl|<dd>|\d+\.\d+%/); }
    assert.match(loading, /Checking current rates/); assert.doesNotMatch(loading, /<dl|<dd>|\d+\.\d+%/);
  });
  check("The plan fee illustration uses the current rate and omits unknown or invalid rates", () => {
    const normalized = fee => fee && Object.fromEntries(Object.entries(fee).map(([key, value]) => [key, Math.round(value * 1e12) / 1e12]));
    assert.deepEqual(normalized(calculateIllustrativeFeeAmounts(0)), {
      grossLendingProfit: 10, strategyFee: 0, remaining: 10, inheritanceServiceFee: 1, net: 9,
    });
    assert.deepEqual(normalized(calculateIllustrativeFeeAmounts(10)), {
      grossLendingProfit: 10, strategyFee: 1, remaining: 9, inheritanceServiceFee: 0.9, net: 8.1,
    });
    assert.deepEqual(normalized(calculateIllustrativeFeeAmounts(12)), {
      grossLendingProfit: 10, strategyFee: 1.2, remaining: 8.8, inheritanceServiceFee: 0.88, net: 7.92,
    });
    assert.equal(calculateIllustrativeFeeAmounts(undefined), null);
    assert.equal(calculateIllustrativeFeeAmounts(Number.NaN), null);
    assert.equal(calculateIllustrativeFeeAmounts(101), null);
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
