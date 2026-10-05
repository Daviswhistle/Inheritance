// Local-only unified-plan E2E. Uses actual Anvil deployments and the E2E-only
// MiniKit bridge and local monitoring HTTP fixture; it never reads app secrets
// or configures remote notification delivery.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RUN_DIR = process.env.VERIFY_TMP || "/tmp/wld-unified-plan";
process.env.VERIFY_TMP = RUN_DIR;
mkdirSync(RUN_DIR, { recursive: true });
const require = createRequire(new URL("../../app/package.json", import.meta.url));
const { Contract, ContractFactory, Interface, JsonRpcProvider, Wallet, parseUnits, ZeroAddress } = require("ethers");
const { launch, ACCOUNTS, HELPERS } = await import("./drv.mjs");

const SHOTS = path.join(RUN_DIR, "shots");
mkdirSync(SHOTS, { recursive: true });
const anvilLog = createWriteStream(path.join(RUN_DIR, "anvil.log"), { flags: "w" });
const evidence = {
  runtime: { chainId: 480, browser: "google-chrome --headless=new", rpcHost: "127.0.0.1", screenshots: [] },
  fixtures: { worldAppBridge: "local E2E MiniKit stub", auth: "local Pages Functions + in-memory D1",
    notifications: "local registration/status HTTP fixture; no remote delivery", externalFetches: [] },
  contracts: {},
  plan: {},
  checkIn: {},
  income: {},
  settingsAlignment: {},
  legacyIncome: {},
};
let passed = 0;
let page = null;
let alignmentPage = null;
let driftPage = null;
let legacyPage = null;
let heirPage = null;
let vite = null;
let provider = null;
let anvil = null;
let exitCode = 0;
let walletBuild = null;
const regressionPages = [];

const pass = (label, details = undefined) => {
  passed++;
  console.log(`PASS ${label}${details === undefined ? "" : ` · ${details}`}`);
};

async function freePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => socket.once("error", reject).listen(0, "127.0.0.1", resolve));
  const selected = socket.address().port;
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return selected;
}

async function until(work, label, timeoutMs = 35_000) {
  const end = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < end) {
    try { if (await work()) return; } catch (error) { lastError = error; }
    await sleep(150);
  }
  throw new Error(`${label} did not reach the expected state${lastError ? `: ${lastError.message}` : ""}`);
}

function artifact(name, file = name) {
  return JSON.parse(readFileSync(path.join(ROOT, "out", `${file}.sol`, `${name}.json`), "utf8"));
}

async function deploy(name, args, signer, file = name) {
  const value = artifact(name, file);
  const contract = await new ContractFactory(value.abi, value.bytecode.object, signer).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function clickButton(targetPage, label) {
  if (label === "Create plan and deposit") {
    if (!await targetPage.ev("return !!document.querySelector('.plan-final-review')")) await clickButton(targetPage, "Review plan");
    if (await targetPage.ev("return !!document.getElementById('yield-consent')")) await acceptYieldTerms(targetPage);
    return clickButton(targetPage, "Confirm and deposit");
  }
  if (label === "Review plan" && await targetPage.ev("return !!document.querySelector('.plan-final-review')")) return;
  const quoted = JSON.stringify(label);
  await targetPage.ev(`return __q.revealButton(${quoted})`);
  // Check availability and perform one native click in the same browser turn.
  // Separate CDP calls can observe a button just before a role refresh disables it.
  await until(() => targetPage.ev(`const button = [...document.querySelectorAll('button')]
    .find(item => item.textContent.trim() === ${quoted} && !item.disabled);
    if (!button) return false;
    return /^clicked /.test(__q.click(${quoted}));`), `enabled button ${label}`);
}

async function clickMatchingButton(targetPage, matcher) {
  const source = matcher.toString();
  const isAssetSelection = matcher("WLD") || matcher("USDC");
  if (isAssetSelection && !await targetPage.ev(`return [...document.querySelectorAll('button')].some(b=>b.offsetParent!==null&&(${source})(b.textContent.trim()))`)) await chooseTab(targetPage, "Assets");
  await until(() => targetPage.ev(`return [...document.querySelectorAll('button')].some(button => button.offsetParent !== null && !button.disabled && (${source})(button.textContent.trim()))`), `enabled button matching ${source}`);
  const result = await targetPage.ev(`const fn = (${source}); const button = [...document.querySelectorAll('button')].find(item => item.offsetParent !== null && !item.disabled && fn(item.textContent.trim())); if (!button) return 'missing'; button.click(); return button.textContent.trim();`);
  assert.notEqual(result, "missing");
  return result;
}

async function signIn(targetPage) {
  await targetPage.ev(HELPERS);
  await clickButton(targetPage, "Continue with World App");
  await until(() => targetPage.ev("return __q.tabs().length > 0 && !/Continue with World App/.test(document.body.innerText)"), "authenticated app shell");
}

async function chooseTab(targetPage, label) {
  await until(() => targetPage.ev(`return [...document.querySelectorAll('.tab-item')].some(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled)`), `available ${label} tab`);
  assert.match(await targetPage.ev(`return __q.tab(${JSON.stringify(label)})`), /^ok$/);
  await sleep(180);
  if (label === "Plan" && !await targetPage.ev("return !!document.getElementById('plan-wld')")) {
    const add = await targetPage.ev("return [...document.querySelectorAll('button')].some(b=>b.offsetParent!==null&&b.textContent.trim()==='Add to my plan')");
    if (add) {
      await until(() => targetPage.ev("const tab=[...document.querySelectorAll('.tab-item')].find(b=>b.textContent.trim()==='Plan');if(tab?.getAttribute('aria-current')!=='page'){tab?.click();return false;}const b=[...document.querySelectorAll('button')].find(b=>b.offsetParent!==null&&b.textContent.trim()==='Add to my plan'&&!b.disabled);if(!b)return false;b.click();return true;"), "available add-to-plan action");
      await until(() => targetPage.ev("return !!document.getElementById('plan-wld')"), "explicit add-to-plan form");
    }
  }
}

async function acceptYieldTerms(targetPage) {
  const mode = await targetPage.ev(`return document.getElementById('yield-consent') ? 'consent'
    : document.querySelector('.plan-resume') ? 'recovery' : 'review';`);
  // Historical receipt recovery sends no new deposits and needs no new consent.
  if (mode === "recovery") return;
  if (mode === "review") await clickButton(targetPage, "Review plan");
  await until(() => targetPage.ev("return !!document.getElementById('yield-consent') && !document.getElementById('yield-consent').disabled"), "available yield consent");
  await targetPage.ev("const box = document.getElementById('yield-consent'); if (!box.checked) box.click(); return box.checked;");
}

async function captureLayout(targetPage, name, width, criticalSelectors = []) {
  await targetPage.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 2, mobile: true });
  await targetPage.ev("window.scrollTo(0, 0); await new Promise(requestAnimationFrame); return true;");
  await sleep(180);
  const metrics = JSON.parse(await targetPage.ev(`
    const width = document.documentElement.clientWidth;
    const visible = element => { const r = element.getBoundingClientRect(); const s = getComputedStyle(element); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
    const offscreen = [...document.querySelectorAll('body *')].filter(visible).map(element => ({
      tag: element.tagName.toLowerCase(), id: element.id, className: typeof element.className === 'string' ? element.className.slice(0, 70) : '',
      right: Math.round(element.getBoundingClientRect().right), left: Math.round(element.getBoundingClientRect().left),
    })).filter(item => item.right > width + 1 || item.left < -1).slice(0, 12);
    const targets = ${JSON.stringify(criticalSelectors)}.map(selector => {
      const element = document.querySelector(selector); if (!element) return { selector, missing: true };
      const r = element.getBoundingClientRect(); return { selector, width: Math.round(r.width), height: Math.round(r.height), disabled: 'disabled' in element ? element.disabled : false };
    });
    return JSON.stringify({ viewport: width, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, offscreen, targets });
  `));
  assert.equal(metrics.viewport, width);
  assert.ok(metrics.documentWidth <= width, `${name} ${width}px document overflows horizontally: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.bodyWidth <= width, `${name} ${width}px body overflows horizontally: ${JSON.stringify(metrics)}`);
  const header = JSON.parse(await targetPage.ev("const brand=document.querySelector('.brand').getBoundingClientRect(); const actions=document.querySelector('.landing-header-actions').getBoundingClientRect(); return JSON.stringify({brandRight:brand.right,actionsLeft:actions.left})"));
  assert.ok(header.brandRight <= header.actionsLeft + 1, `${name} ${width}px header controls overlap the brand`);
  for (const target of metrics.targets) {
    assert.ok(!target.missing && target.height >= 40 && target.width >= 36,
      `${name} ${width}px target is missing or too small: ${JSON.stringify(target)}`);
  }
  const shot = await targetPage.shot(`unified-plan-${name}-${width}`);
  evidence.runtime.screenshots.push({ layout: name, width, path: shot, metrics });
  pass(`${name} ${width}px layout`, `no horizontal overflow; ${shot}`);
}

async function captureStore(targetPage, name, selector = "") {
  if (process.env.UNIFIED_STORE_IMAGES !== "1") return;
  await targetPage.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await targetPage.ev(`const target = ${JSON.stringify(selector)} ? document.querySelector(${JSON.stringify(selector)}) : null;
    window.scrollTo(0, target ? target.getBoundingClientRect().top + window.scrollY - 105 : 0);
    await new Promise(requestAnimationFrame); return true;`);
  const shot = await targetPage.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(shot.data, "base64"));
}

async function installBridgeRecorder(targetPage, rejectTarget = "") {
  const quoteReject = JSON.stringify(rejectTarget.toLowerCase());
  await targetPage.ev(`
    const fixture = await import('/src/test/minikit-stub.ts');
    const original = window.__E2E_ORIGINAL_SEND__ || fixture.MiniKit.sendTransaction.bind(fixture.MiniKit);
    window.__E2E_ORIGINAL_SEND__ = original;
    window.__E2E_BRIDGE_CALLS__ = [];
    window.__E2E_REJECTED_TARGET__ = ${quoteReject};
    window.__E2E_REJECT_ERROR_CODE__ = '';
    window.__E2E_REJECT_THROWS__ = false;
    fixture.MiniKit.sendTransaction = async request => {
      const { Wallet } = await import('/node_modules/.vite/deps/ethers.js');
      const ownerAddress = new Wallet(window.__E2E_SIGNER__.privateKey).address;
      window.__E2E_SETUP_SNAPSHOT__ = JSON.parse(sessionStorage.getItem('inheritance:pending-plan:' + ownerAddress.toLowerCase()) || 'null');
      const targets = request.transactions.map(tx => tx.to.toLowerCase());
      const reject = !!(window.__E2E_REJECTED_TARGET__ && targets.includes(window.__E2E_REJECTED_TARGET__));
      let result;
      if (reject) {
        window.__E2E_REJECTED_TARGET__ = '';
        const errorCode = window.__E2E_REJECT_ERROR_CODE__;
        window.__E2E_REJECT_ERROR_CODE__ = '';
        if (errorCode && window.__E2E_REJECT_THROWS__) {
          window.__E2E_REJECT_THROWS__ = false;
          window.__E2E_BRIDGE_CALLS__.push({ targets,
            transactions: request.transactions.map(tx => ({ to: tx.to.toLowerCase(), data: tx.data || '0x' })),
            hash: '', success: false, error: 'SDK ' + errorCode, error_code: errorCode });
          return await fixture.__throwSendTransactionError(errorCode);
        }
        if (errorCode) result = { executedWith: 'minikit', data: { status: 'fail', error_code: errorCode, error: 'E2E structured rejection' } };
        else {
          fixture.__setState({ failNextTx: true });
          result = await original(request);
        }
      } else if (request.transactions.length > 1) {
        result = await fixture.__sendAtomicBatch(request.transactions);
      } else {
        result = await original(request);
      }
      window.__E2E_BRIDGE_CALLS__.push({ targets, transactions: request.transactions.map(tx => ({ to: tx.to.toLowerCase(), data: tx.data || '0x' })),
        hash: result?.data?.transaction_hash || result?.data?.userOpHash || '', success: result?.data?.status === 'success',
        error: result?.data?.error || '', error_code: result?.data?.error_code || '' });
      return result;
    };
    return true;
  `);
}

async function sendAtomicFixtureBatch(targetPage, transactions) {
  const result = JSON.parse(await targetPage.ev(`
    const fixture = await import('/src/test/minikit-stub.ts');
    const result = await fixture.__sendAtomicBatch(${JSON.stringify(transactions)});
    return JSON.stringify(result);
  `));
  assert.equal(result?.data?.status, "success", `local EIP-7702 fixture batch failed: ${JSON.stringify(result)}`);
  return result;
}

function amountText(value, symbol) { return `${value} ${symbol}`; }

try {
  const anvilPort = await freePort();
  const rpc = `http://127.0.0.1:${anvilPort}`;
  evidence.runtime.rpcUrl = rpc;
  anvil = spawn("anvil", ["--host", "127.0.0.1", "--port", String(anvilPort), "--chain-id", "480", "--silent", "--block-time", "1", "--mixed-mining"], { stdio: ["ignore", "pipe", "pipe"] });
  anvil.stdout.pipe(anvilLog);
  anvil.stderr.pipe(anvilLog);
  await until(async () => {
    try { return (await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) })).ok; }
    catch { return false; }
  }, "local Anvil RPC");

  provider = new JsonRpcProvider(rpc, { chainId: 480, name: "local-anvil" }, { batchMaxCount: 1, cacheTimeout: -1 });
  const deployer = await provider.getSigner(0);
  assert.equal((await deployer.getAddress()).toLowerCase(), ACCOUNTS.a0.a.toLowerCase(), "Anvil account fixture does not match drv.mjs");
  // Compile only this test account in a disposable directory, retaining the
  // supplied income-factory artifacts. Real atomic receipts are essential:
  // several sequential EOA transactions cannot prove a MiniKit batch.
  walletBuild = mkdtempSync(path.join(tmpdir(), "inheritance-batch-wallet-"));
  mkdirSync(path.join(walletBuild, "src"));
  writeFileSync(path.join(walletBuild, "src/MockWorldAppWallet.sol"), readFileSync(path.join(ROOT, "test/mocks/MockWorldAppWallet.sol")));
  writeFileSync(path.join(walletBuild, "foundry.toml"), '[profile.default]\nsolc_version="0.8.24"\nevm_version="cancun"\noptimizer=true\noptimizer_runs=200\n');
  const compiled = spawnSync("forge", ["build", "--root", walletBuild, "--offline"], { encoding: "utf8" });
  assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
  const walletArtifact = JSON.parse(readFileSync(path.join(walletBuild, "out/MockWorldAppWallet.sol/MockWorldAppWallet.json")));
  const batchWallet = await new ContractFactory(walletArtifact.abi, walletArtifact.bytecode.object, deployer).deploy();
  await batchWallet.waitForDeployment();
  evidence.fixtures.atomicBatch = "real local EIP-7702 delegated account and a single canonical receipt";

  // These are ignored, supplied protocol artifacts. Do not run forge build here.
  const wld = await deploy("MockGasRefillERC20", ["Worldcoin", "WLD", 18], deployer, "MockGasRefill");
  const usdc = await deploy("MockGasRefillERC20", ["USD Coin", "USDC", 6], deployer, "MockGasRefill");
  const plainFactory = await deploy("InheritanceVaultWLDFactoryOnePerOwner", [await wld.getAddress()], deployer);
  const wldStrategy = await deploy("MockERC4626", [await wld.getAddress()], deployer);
  const usdcStrategy = await deploy("MockRe7USDC", [await usdc.getAddress()], deployer);
  const wldFactory = await deploy("InheritanceVaultMorphoFactory", [await wld.getAddress(), await wldStrategy.getAddress(), ACCOUNTS.a2.a, 1000], deployer);
  const usdcFactory = await deploy("InheritanceVaultUSDCFactory", [await usdc.getAddress(), await usdcStrategy.getAddress(), await wld.getAddress(), ACCOUNTS.a2.a, 1000], deployer);
  const distributorAddress = "0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae";
  const distributorArtifact = artifact("MockMerklDistributor");
  await provider.send("anvil_setCode", [distributorAddress, distributorArtifact.deployedBytecode.object]);
  await (await wld.mint(distributorAddress, parseUnits("100", 18))).wait();
  await (await wld.mint(ACCOUNTS.a0.a, parseUnits("100", 18))).wait();
  await (await usdc.mint(ACCOUNTS.a0.a, parseUnits("100", 6))).wait();
  await (await wld.mint(ACCOUNTS.a3.a, parseUnits("1", 18))).wait();
  assert.ok(await provider.getCode(distributorAddress) !== "0x");
  evidence.contracts = {
    wld: await wld.getAddress(), usdc: await usdc.getAddress(),
    plainFactory: await plainFactory.getAddress(), wldFactory: await wldFactory.getAddress(), usdcFactory: await usdcFactory.getAddress(),
    wldStrategy: await wldStrategy.getAddress(), usdcStrategy: await usdcStrategy.getAddress(),
    merklDistributorFixture: distributorAddress, feeRecipient: ACCOUNTS.a2.a,
  };
  pass("local income-capable contracts deployed", "WLD/USDC tokens, both strategies, both income factories, legacy factory and Merkl mock");

  const now = Math.floor(Date.now() / 1000);
  // Prevent inherited deployment VITE_* values from entering the browser bundle;
  // only the local addresses below are exposed to this E2E process.
  for (const key of Object.keys(process.env)) if (key.startsWith("VITE_")) delete process.env[key];
  Object.assign(process.env, {
    VITE_FACTORY_ADDRESS: await plainFactory.getAddress(), VITE_FACTORY_DEPLOY_BLOCK: "1",
    VITE_WLD_ADDRESS: await wld.getAddress(), VITE_RPC: rpc,
    VITE_LEGACY_FACTORY_ADDRESS: "", VITE_LEGACY_FACTORY_DEPLOY_BLOCK: "",
    VITE_NOTIFY_BACKEND_URL: "https://unified-notify.example", VITE_REQUIRE_VERIFY: "false", VITE_FACTORY_RELEASE_SUPPORTED: "true",
    VITE_YIELD_FACTORY_ADDRESS: await wldFactory.getAddress(), VITE_YIELD_FACTORY_DEPLOY_BLOCK: "1",
    VITE_MORPHO_VAULT_ADDRESS: await wldStrategy.getAddress(),
    VITE_USDC_ADDRESS: await usdc.getAddress(), VITE_USDC_YIELD_FACTORY_ADDRESS: await usdcFactory.getAddress(),
    VITE_USDC_YIELD_FACTORY_DEPLOY_BLOCK: "1", VITE_USDC_MORPHO_VAULT_ADDRESS: await usdcStrategy.getAddress(),
  });

  const port = await freePort();
  const { createServer: createVite } = await import(path.join(ROOT, "app/node_modules/vite/dist/node/index.js"));
  vite = await createVite({ root: path.join(ROOT, "app"), configFile: path.join(ROOT, "app/vite.config.e2e.ts"), envDir: false,
    logLevel: "error", server: { host: "127.0.0.1", port, strictPort: true } });
  await vite.listen();
  const appUrl = vite.resolvedUrls.local[0];
  const rateStrategies = [await wldStrategy.getAddress(), await usdcStrategy.getAddress()];
  function localPublicFixtures() {
    const strategies = window.__E2E_STRATEGIES__;
    const wldAddress = window.__E2E_WLD__;
    window.__E2E_REWARDS__ = {};
    window.__E2E_REWARDS_DOWN__ = false;
    window.__E2E_RATES_DOWN__ = false;
    window.__MONITOR_REGISTRATIONS__ = [];
    window.__MONITOR_REGISTERED__ = {};
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input?.url ?? String(input);
      if (url.startsWith("https://unified-notify.example/")) {
        const parsed = new URL(url);
        if (parsed.pathname === "/api/notifications/register") {
          const payload = JSON.parse(init.body);
          const authorization = new Headers(init.headers).get("Authorization");
          if (!authorization?.startsWith("Bearer ")) throw new Error("Monitoring registration must use the signed-in session");
          if (window.__MONITOR_UNRESPONSIVE__) return new Promise((resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(new DOMException("Monitoring fixture timed out", "AbortError")), { once: true });
          });
          await new Promise(resolve => setTimeout(resolve, 250));
          window.__MONITOR_REGISTRATIONS__.push(payload);
          window.__MONITOR_REGISTERED__[payload.vaultAddress.toLowerCase()] = true;
          return Response.json({ status: "success", watcher: { active: true } });
        }
        if (parsed.pathname === "/api/notifications/status") return Response.json({ status: "success",
          watcher: window.__MONITOR_REGISTERED__[parsed.searchParams.get("vaultAddress").toLowerCase()] ? { active: true } : null });
        if (parsed.pathname === "/api/notifications") return Response.json({ status: "success", watchers: [], nextCursor: null });
        if (parsed.pathname === "/api/automation/health") return Response.json({ automation: { enabled: true,
          supported: true, funded: true, halted: false, reason: "ready", factoryAddresses: window.__MONITOR_FACTORIES__ } });
        throw new Error("Unexpected local monitoring route: " + parsed.pathname);
      }
      const rates = url.match(/^https:\/\/api\.merkl\.xyz\/v4\/opportunities\?chainId=480&identifier=(0x[a-fA-F0-9]{40})$/)?.[1];
      if (rates) {
        const strategy = strategies.find(item => item.toLowerCase() === rates.toLowerCase());
        if (!strategy) throw new Error("Unexpected Morpho strategy rate request");
        const timestamp = Math.floor(Date.now() / 1000);
        return Response.json([{ chainId: 480, type: "MORPHOVAULT", identifier: strategy, status: "LIVE",
          latestCampaignEnd: String(timestamp + 86400), nativeAprRecord: { timestamp: String(timestamp - 5), value: 1.2 },
          aprRecord: { timestamp: String(timestamp - 5), cumulated: 3.4 },
          rewardsRecord: { breakdowns: [{ token: { address: wldAddress, chainId: 480, decimals: 18 } }] } }]);
      }
      if (/^https:\/\/api\.merkl\.xyz\/v4\/users\/0x[a-fA-F0-9]{40}\/rewards\?chainId=480$/.test(url)) return Response.json([]);
      if (url === window.__E2E_RPC__) return original(input, init);
      if (url.startsWith(location.origin + "/") || url.startsWith("/")) return original(input, init);
      window.__E2E_EXTERNAL_FETCHES__.push(url);
      throw new Error("External network blocked by unified-plan E2E fixture: " + url);
    };
  }
  const exampleNames = process.env.UNIFIED_STORE_IMAGES === "1"
    ? `window.__E2E_USERNAMES__ = ${JSON.stringify({ [ACCOUNTS.a0.a.toLowerCase()]: "amy", [ACCOUNTS.a1.a.toLowerCase()]: "alex" })};` : "";
  const pauseTermsPoll = `const originalInterval = window.setInterval; window.setInterval = (work,delay,...args) => originalInterval.call(window,delay === 30000 ? (...values) => { if(!window.__E2E_PAUSE_TERM_POLL__)work(...values); } : work,delay,...args);`;
  const preload = `${exampleNames}${pauseTermsPoll}window.__E2E_EXTERNAL_FETCHES__ = []; window.__E2E_RPC__ = ${JSON.stringify(rpc)}; window.__E2E_BATCH_WALLET__ = ${JSON.stringify(batchWallet.target)}; window.__E2E_STRATEGIES__ = ${JSON.stringify(rateStrategies)}; window.__MONITOR_FACTORIES__ = ${JSON.stringify([await plainFactory.getAddress(), await wldFactory.getAddress(), await usdcFactory.getAddress()])}; window.__E2E_WLD__ = ${JSON.stringify(await wld.getAddress())}; (${localPublicFixtures.toString()})(); (function(){${HELPERS}})();`;
  const pendingKey = `inheritance:pending-plan:${ACCOUNTS.a0.a.toLowerCase()}`;
  const wldAddress = await wld.getAddress();
  const wldFactoryAddress = (await wldFactory.getAddress()).toLowerCase();
  const usdcFactoryAddress = await usdcFactory.getAddress();
  // Exercise the real confirmation component without background App refreshes.
  // A pre-journal failure must allow retry using only the busy-state transition.
  const retryPage = await launch({ pk: ACCOUNTS.a0.pk, url: appUrl, preload });
  regressionPages.push(["pre-journal retry", retryPage]);
  await retryPage.ev(`
    const reactModule = await import('/node_modules/.vite/deps/react.js');
    const React = reactModule.default ?? reactModule;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const createRoot = dom.createRoot ?? dom.default.createRoot;
    const { PlanSetup } = await import('/src/components/PlanSetup.tsx');
    const mount = document.createElement('div'); mount.id = 'retry-plan';
    document.body.replaceChildren(mount);
    window.__PLAN_RETRY_CALLS__ = 0;
    function RetryPlan() {
      const [busy, setBusy] = React.useState(false);
      window.__FINISH_PLAN_RETRY__ = () => setBusy(false);
      return React.createElement(PlanSetup, {
        rows: [{ symbol: 'WLD', decimals: 18, mode: 'plain', amount: '1', walletBalance: 10000000000000000000n }],
        heir: '${ACCOUNTS.a1.a}', heirResolved: '${ACCOUNTS.a1.a}', heirUsername: '',
        resolvingHeir: false, heirSuspicious: false, shareBusy: false, period: '30', periodValid: true,
        yieldConsent: false, pendingPlan: null, alignmentConflicts: [], busy, createDisabled: false,
        resumeDisabled: false, canEditRemaining: false,
        onCreate: () => { window.__PLAN_RETRY_CALLS__++; setBusy(true); },
        onHeirChange: () => {}, onPickHeir: () => {}, onPeriodChange: () => {}, onPreset: () => {},
        onAmountChange: () => {}, onYieldConsent: () => {}, onConfirmAlignment: () => {},
        onCancelAlignment: () => {}, onResume: () => {}, onEditRemaining: () => {},
      });
    }
    createRoot(mount).render(React.createElement(RetryPlan)); return true;
  `);
  await clickButton(retryPage, "Review plan");
  for (let attempt = 1; attempt <= 2; attempt++) {
    await until(() => retryPage.ev("return !!document.querySelector('#retry-plan .plan-final-review') && !document.querySelector('#retry-plan .plan-submit').disabled"), "confirmation reenabled without unrelated render");
    await retryPage.ev("const button = document.querySelector('#retry-plan .plan-submit'); button.click(); button.click(); return true;");
    await until(() => retryPage.ev("return document.querySelector('#retry-plan .plan-submit').disabled"), "confirmation busy lock");
    assert.equal(await retryPage.ev("return window.__PLAN_RETRY_CALLS__"), attempt, "a duplicate tap must not start another request");
    await retryPage.ev("window.__FINISH_PLAN_RETRY__(); return true;");
  }
  await until(() => retryPage.ev("return !document.querySelector('#retry-plan .plan-submit').disabled"), "second confirmation failure allows another retry");
  evidence.plan.preJournalRetry = { attempts: 2, duplicateTapsBlocked: true, unrelatedRefreshRequired: false };
  pass("a failure before saving a plan reenables confirmation without editing or an unrelated refresh, while duplicate taps remain blocked");
  page = await launch({ pk: ACCOUNTS.a0.pk, url: appUrl, preload });
  await until(() => page.ev("return !!document.querySelector('.landing-content')"), "public welcome screen");
  await captureStore(page, "unified-store-welcome");
  await signIn(page);
  await chooseTab(page, "Plan");
  await installBridgeRecorder(page, await usdc.getAddress());

  await until(() => page.ev("return !!(document.getElementById('plan-wld') && document.getElementById('plan-usdc') && document.getElementById('heir-input'))"), "unified plan form");
  await until(() => page.ev("return /Available:/.test(document.body.innerText) && !/Wallet balance is loading/.test(document.body.innerText)"), "token balances");
  assert.equal(await page.ev("return document.getElementById('yield-consent') !== null"), false, "input step must not ask for consent before showing the review");
  assert.equal(await page.ev("return document.querySelector('.plan-submit')?.disabled"), true, "plan submission must require consent");
  await page.ev(`return __q.setInput('heir-input', ${JSON.stringify(ACCOUNTS.a1.a)})`);
  await page.ev("return __q.setInput('period-input', '30')");
  await page.ev("return __q.setInput('plan-wld', '2.5')");
  await page.ev("return __q.setInput('plan-usdc', '12.123456')");
  await until(() => page.ev("return /Resolved:|Wallet address/.test(document.querySelector('#heir-help')?.parentElement?.innerText || '') || document.querySelector('.resolved-heir') !== null"), "heir resolution");
  await until(() => page.ev("return !document.querySelector('.plan-submit').disabled"), "inputs can reach review without consent");
  assert.equal(await page.ev("return document.querySelectorAll('input[name=\"vault-kind\"]').length"), 0);
  assert.equal(await page.ev("return document.querySelector('.plan-risk') !== null"), false);
  for (const width of [320, 360, 390]) await captureLayout(page, "create", width, ["#plan-wld", "#plan-usdc", "#period-input", ".plan-submit"]);
  const selectedPlan = JSON.parse(await page.ev("return JSON.stringify({amounts:[document.getElementById('plan-wld').value, document.getElementById('plan-usdc').value], chooserCount:document.querySelectorAll('input[name=\"vault-kind\"]').length})"));
  assert.deepEqual(selectedPlan, { amounts: ["2.5", "12.123456"], chooserCount: 0 });
  await captureStore(page, "unified-store-create", "#plan-wld");
  await clickButton(page, "Review plan");
  assert.equal(await page.ev("return document.getElementById('yield-consent').checked"), false);
  assert.equal(await page.ev("return document.querySelector('.plan-submit').disabled"), true);
  await acceptYieldTerms(page);
  pass("inputs reach review without extra consent or risk panels; explicit consent gates the final wallet request");
  await until(() => page.ev("return !!document.querySelector('.plan-final-review')"), "local plan review");
  assert.match(await page.ev("return document.querySelector('.plan-final-review').innerText"), /2\.5 WLD[\s\S]*12\.123456 USDC/);
  assert.match(await page.ev("return document.querySelector('.plan-final-review').innerText"), new RegExp(ACCOUNTS.a1.a, 'i'));
  const feeReview = await page.ev("return document.querySelector('.plan-final-review').innerText");
  assert.match(feeReview, /Service fee: 10%/);
  assert.match(feeReview, /WLD \+ USDC: 10% of Morpho strategy profits/);
  assert.equal(JSON.parse(await page.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__ || [])")).length, 0, "review opened the wallet");
  assert.equal(await page.ev("return document.activeElement?.id"), 'plan-review-title');
  await captureLayout(page, "review", 320, [".plan-submit", ".plan-step-actions button"]);
  await captureLayout(page, "review", 390, [".plan-submit", ".plan-step-actions button"]);
  await page.ev("window.__E2E_PAUSE_TERM_POLL__=true;return true;");
  for(const percent of [12,10]){
    await (await wldStrategy.setFee(parseUnits(String(percent/100),18))).wait();
    assert.equal(await page.ev("return !!document.querySelector('.plan-final-review')"),true,"cached review should remain until fresh preflight observes the fee");
    await clickButton(page,"Confirm and deposit");
    await until(() => page.ev(`return /strategy fee changed/.test(document.body.innerText) && !document.querySelector('.plan-final-review') && !document.getElementById('yield-consent')`),"fresh fee drift stops before the wallet");
    assert.equal(JSON.parse(await page.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__ || [])")).length,0);
    assert.equal(await wldFactory.vaultOf(ACCOUNTS.a0.a),ZeroAddress);
    assert.equal(await usdcFactory.vaultOf(ACCOUNTS.a0.a),ZeroAddress);
    await acceptYieldTerms(page);
    await clickButton(page,"Review plan");
  }
  await page.ev("window.__E2E_PAUSE_TERM_POLL__=false;return true;");
  pass("service and strategy fees are shown separately; a real strategy-fee change invalidates approval before wallet submission");
  await clickButton(page, "Edit plan");
  assert.equal(await page.ev("return document.activeElement?.id"), 'plan-wld');
  await page.ev("return __q.setInput('plan-wld', '2.500000000000000001')");
  await clickButton(page, "Review plan");
  assert.match(await page.ev("return document.querySelector('.plan-final-review').innerText"), /2\.500000000000000001 WLD/);
  await clickButton(page, "Edit plan");
  await page.ev("return __q.setInput('plan-wld', '2.5')");
  await page.ev("return __q.setInput('plan-usdc', '12.1234567')");
  assert.equal(await page.ev("return document.querySelector('.plan-submit').disabled"), true, "excess USDC precision reached review");
  await page.ev("return __q.setInput('plan-usdc', '12.123456')");
  pass("plan review shows exact amounts and recipient without a wallet request; editing restores focus and rejects excess USDC precision");


  // A browser that cannot retain the crash-recovery journal must never hand a
  // create/deposit request to the wallet, including when writes silently vanish.
  for (const failure of ["throw", "discard"]) {
    await page.ev(`
      window.__E2E_STORAGE_SET__ = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key.startsWith('inheritance:pending-plan:')) {
          if (${JSON.stringify(failure)} === 'throw') throw new DOMException('fixture quota', 'QuotaExceededError');
          return;
        }
        return window.__E2E_STORAGE_SET__.call(this, key, value);
      };
      return true;
    `);
    await clickButton(page, "Create plan and deposit");
    await until(() => page.ev("return /could not save the plan recovery record/.test(document.body.innerText) && !document.querySelector('.plan-submit')?.disabled"), "failed recovery storage blocks submission");
    assert.equal(JSON.parse(await page.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__ || [])")).length, 0);
    assert.equal(await wldFactory.vaultOf(ACCOUNTS.a0.a), ZeroAddress);
    assert.equal(await usdcFactory.vaultOf(ACCOUNTS.a0.a), ZeroAddress);
    assert.equal(await page.ev(`return sessionStorage.getItem(${JSON.stringify(pendingKey)})`), null);
    await page.ev("Storage.prototype.setItem = window.__E2E_STORAGE_SET__; return true;");
  }
  evidence.plan.recoveryStorageFailure = { throws: "blocked", silentDiscard: "blocked", walletRequests: 0 };
  pass("failed or discarded recovery writes stop before any wallet request");

  await page.ev(`window.__E2E_REJECTED_TARGET__ = ${JSON.stringify(wldFactoryAddress)};
    window.__E2E_REJECT_ERROR_CODE__ = 'simulation_failed'; window.__E2E_REJECT_THROWS__ = true; return true;`);
  await clickButton(page, "Create plan and deposit");
  await until(() => page.ev(`
    const saved = JSON.parse(sessionStorage.getItem(${JSON.stringify(pendingKey)}) || 'null');
    return saved?.createState === 'ready' && window.__E2E_BRIDGE_CALLS__?.length === 1;
  `), "structured create simulation rejection returns to ready");
  const createSimulationSaved = JSON.parse(await page.ev(`return sessionStorage.getItem(${JSON.stringify(pendingKey)})`));
  const createSimulationCalls = JSON.parse(await page.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__ || [])"));
  assert.deepEqual(createSimulationSaved.assets.map(item => item.depositState), ["ready", "ready"]);
  assert.equal(createSimulationSaved.createTxHash, undefined);
  assert.equal(createSimulationCalls[0].success, false);
  assert.equal(createSimulationCalls[0].error_code, "simulation_failed");
  assert.ok(createSimulationCalls[0].targets.includes(wldFactoryAddress));
  assert.equal(await wldFactory.vaultOf(ACCOUNTS.a0.a), ZeroAddress, "failed create simulation registered a WLD vault");
  assert.equal(await usdcFactory.vaultOf(ACCOUNTS.a0.a), ZeroAddress, "failed create simulation registered a USDC vault");
  evidence.plan.structuredCreateRejection = { errorCode: createSimulationCalls[0].error_code,
    stateAfterRejection: createSimulationSaved.createState, walletCalls: createSimulationCalls.length };
  // Reproduce an actual older version's partially completed three-request setup.
  // Fresh setup batching is tested separately below; these historical receipts
  // must remain recoverable after the UI upgrade without repeating WLD.
  const sendLegacyFixture = async transactions => JSON.parse(await page.ev(`
    const fixture = await import('/src/test/minikit-stub.ts');
    return JSON.stringify(await fixture.MiniKit.sendTransaction({chainId:480,transactions:${JSON.stringify(transactions)}}));`));
  await page.ev("window.__E2E_REJECTED_TARGET__='';return true;");
  const legacyCreate = await sendLegacyFixture([
    {to:wldFactoryAddress,data:wldFactory.interface.encodeFunctionData('createVault',[ACCOUNTS.a1.a,30*86400])},
    {to:usdcFactoryAddress,data:usdcFactory.interface.encodeFunctionData('createVault',[ACCOUNTS.a1.a,30*86400])},
  ]);
  assert.equal(legacyCreate.data.status,'success');
  const legacyWldBeforeBlock = await provider.getBlockNumber();
  const legacyDeposit = await sendLegacyFixture([
    {to:wldAddress,data:wld.interface.encodeFunctionData('approve',[wldFactoryAddress,parseUnits('2.5',18)])},
    {to:wldFactoryAddress,data:wldFactory.interface.encodeFunctionData('depositWithMinShares',[parseUnits('2.5',18),1])},
  ]);
  assert.equal(legacyDeposit.data.status,'success');
  const legacyUncertainBlock = await provider.getBlockNumber();
  const legacyPending = {...createSimulationSaved,createState:'complete',createTargets:[],setupRequest:undefined,
    assets:createSimulationSaved.assets.map(asset => ({...asset,
      vault: '', depositState:asset.symbol === 'WLD' ? 'complete' : 'submitting',
      beforeBlock:asset.symbol === 'WLD' ? legacyWldBeforeBlock : legacyUncertainBlock}))};
  legacyPending.assets[0].vault=await wldFactory.vaultOf(ACCOUNTS.a0.a);
  legacyPending.assets[1].vault=await usdcFactory.vaultOf(ACCOUNTS.a0.a);
  await page.ev(`sessionStorage.setItem(${JSON.stringify(pendingKey)},${JSON.stringify(JSON.stringify(legacyPending))});window.__E2E_REJECTED_TARGET__=${JSON.stringify((await usdc.getAddress()).toLowerCase())};return true;`);
  await sendLegacyFixture([
    {to:await usdc.getAddress(),data:usdc.interface.encodeFunctionData('approve',[usdcFactoryAddress,parseUnits('12.123456',6)])},
    {to:usdcFactoryAddress,data:usdcFactory.interface.encodeFunctionData('depositWithMinShares',[parseUnits('12.123456',6),1])},
  ]);
  const legacyCalls=JSON.parse(await page.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__);"));
  await page.send('Page.reload',{ignoreCache:true});
  await until(async()=>{await page.ev(HELPERS);return page.ev("return __q.tabs().length > 0");},'historical partial setup restored');
  await chooseTab(page,'Plan');
  await installBridgeRecorder(page);
  await clickButton(page,'Resume remaining setup');
  await until(()=>page.ev("return /prior USDC request has no verifiable result/.test(document.body.innerText)"),'legacy uncertain request remains blocked');
  assert.equal(JSON.parse(await page.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__)")).length,0);
  const firstPageCalls = legacyCalls;
  assert.equal(firstPageCalls.length, 4, "expected structured create rejection, create retry, WLD deposit, and USDC rejection");
  assert.equal(firstPageCalls[0].error_code, "simulation_failed");
  assert.equal(firstPageCalls[1].success, true);
  assert.equal(firstPageCalls[2].success, true);
  assert.equal(firstPageCalls[3].success, false);
  assert.ok(firstPageCalls[3].targets.includes((await usdc.getAddress()).toLowerCase()), "rejection did not target the USDC deposit route");
  assert.equal(await usdcStrategy.balanceOf(await usdcFactory.vaultOf(ACCOUNTS.a0.a)), 0n, "rejected USDC deposit changed the vault");
  const storedAfterReject = JSON.parse(await page.ev(`return sessionStorage.getItem(${JSON.stringify(pendingKey)})`));
  assert.deepEqual(storedAfterReject.assets.map(item => [item.symbol, item.depositState]), [["WLD", "complete"], ["USDC", "submitting"]]);
  assert.equal(storedAfterReject.assets[1].txHash, undefined, "ID-less bridge failure was misclassified as safe to retry");
  assert.equal(storedAfterReject.assets[0].amount, parseUnits("2.5", 18).toString());
  assert.equal(storedAfterReject.assets[1].amount, parseUnits("12.123456", 6).toString());
  evidence.plan.rejection = { bridgeCalls: firstPageCalls, createStateAfterSimulationFailure: createSimulationSaved.createState,
    savedProgress: storedAfterReject.assets.map(item => ({ symbol: item.symbol, amount: item.amount, state: item.depositState })) };
  pass("ID-less bridge failure stays unresolved after WLD completes", "WLD is complete; USDC is submitting without an identifier; no USDC balance moved");
  const fundedWldAddress = await wldFactory.vaultOf(ACCOUNTS.a0.a);
  await until(() => page.ev(`return window.__MONITOR_REGISTRATIONS__.some(item => item.vaultAddress.toLowerCase() === ${JSON.stringify(fundedWldAddress.toLowerCase())})`), "monitoring completes for the funded first asset");
  const partialRegistration = JSON.parse(await page.ev("return JSON.stringify(window.__MONITOR_REGISTRATIONS__)"));
  assert.equal(partialRegistration.length, 1);
  assert.equal(partialRegistration[0].ownerAddress.toLowerCase(), ACCOUNTS.a0.a.toLowerCase());
  assert.equal(partialRegistration[0].heirAddress.toLowerCase(), ACCOUNTS.a1.a.toLowerCase());
  evidence.plan.partialMonitoring = { secondAsset: "unresolved", registrations: partialRegistration };
  pass("a confirmed WLD deposit receives monitoring while USDC remains unresolved");

  // A lost response for an executed deposit must also block the ordinary Send
  // form. Otherwise a second identical event makes the original receipt ambiguous.
  for (const state of ["submitting", "submitted"]) {
    const interrupted = structuredClone(storedAfterReject);
    interrupted.assets[0].depositState = state;
    interrupted.assets[0].txHash = state === "submitted" ? firstPageCalls[2].hash : undefined;
    interrupted.assets[0].hashType = state === "submitted" ? "transaction" : undefined;
    await page.ev(`sessionStorage.setItem(${JSON.stringify(pendingKey)}, ${JSON.stringify(JSON.stringify(interrupted))}); return true;`);
    await page.send("Page.reload", { ignoreCache: true });
    await until(async () => { await page.ev(HELPERS); return page.ev("return __q.tabs().length > 0"); }, "interrupted deposit restored");
    await chooseTab(page, "Assets");
    await clickMatchingButton(page, label => label === "WLD");
    await until(() => page.ev("return !!document.getElementById('deposit-amount') && /Resume your saved setup in Plan/.test(document.body.innerText)"), "Send recovery guard");
    assert.equal(await page.ev("return __q.btns().find(button => button.t === 'Deposit')?.d"), true);
    await installBridgeRecorder(page);
    await page.ev("__q.setInput('deposit-amount', '2.5'); const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'Deposit'); button.disabled = false; button.click(); return true;");
    await sleep(300);
    assert.equal(JSON.parse(await page.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__)" )).length, 0);
    assert.equal(await wldStrategy.balanceOf(fundedWldAddress), parseUnits("2.5", 18));
    assert.equal(JSON.parse(await page.ev(`return sessionStorage.getItem(${JSON.stringify(pendingKey)})`)).assets[0].depositState, state);
  }
  await chooseTab(page, "Plan");
  await acceptYieldTerms(page);
  await clickButton(page, "Resume remaining setup");
  await until(() => page.ev(`const saved = JSON.parse(sessionStorage.getItem(${JSON.stringify(pendingKey)}) || 'null');
    return saved?.assets?.[0]?.depositState === 'complete' && /prior USDC request has no verifiable result/.test(document.body.innerText);`), "original deposit recovers uniquely");
  assert.equal(JSON.parse(await page.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__)" )).length, 0);
  evidence.plan.sendRecoveryGuard = { states: ["submitting", "submitted"], additionalWalletRequests: 0,
    wldShares: String(await wldStrategy.balanceOf(fundedWldAddress)), originalRecovered: true };
  pass("Send blocks additional deposits for unresolved original requests and Resume recovers the unique original receipt");

  await page.send("Page.reload", { ignoreCache: true });
  await until(async () => { await page.ev(HELPERS); return page.ev("return __q.tabs().length > 0"); }, "restored session helpers");
  await until(() => page.ev("return __q.tabs().length > 0"), "session restored after reload");
  await chooseTab(page, "Plan");
  await until(() => page.ev("return __q.btns().some(button => button.t === 'Resume remaining setup')"), "saved plan resume affordance");
  await installBridgeRecorder(page);
  const savedAfterReload = JSON.parse(await page.ev(`return sessionStorage.getItem(${JSON.stringify(pendingKey)})`));
  assert.deepEqual(savedAfterReload.assets.map(item => [item.symbol, item.depositState]), [["WLD", "complete"], ["USDC", "submitting"]]);

  // Exercise the persisted crash window between wallet handoff and transaction hash.
  // The test knows this USDC request was not sent because the fixture rejected it;
  // the app itself must first leave this injected ambiguous state unresolved.
  const ambiguousBlock = await provider.getBlockNumber();
  savedAfterReload.assets[1].depositState = "submitting";
  savedAfterReload.assets[1].beforeBalance = "0";
  savedAfterReload.assets[1].beforeBlock = ambiguousBlock;
  delete savedAfterReload.assets[1].txHash;
  delete savedAfterReload.assets[1].hashType;
  await page.ev(`sessionStorage.setItem(${JSON.stringify(pendingKey)}, ${JSON.stringify(JSON.stringify(savedAfterReload))}); return true;`);
  await page.send("Page.reload", { ignoreCache: true });
  await until(async () => { await page.ev(HELPERS); return page.ev("return __q.tabs().length > 0"); }, "restored session helpers");
  await until(() => page.ev("return __q.tabs().length > 0"), "session restored with ambiguous progress");
  await chooseTab(page, "Plan");
  await installBridgeRecorder(page);
  await acceptYieldTerms(page);
  await clickButton(page, "Resume remaining setup");
  await until(() => page.ev("return /prior USDC request has no verifiable result yet/i.test(document.body.innerText)"), "ambiguous request remains unresolved");
  assert.equal(JSON.parse(await page.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__ || [])")).length, 0, "ambiguous state was resent");
  assert.equal(await wldStrategy.balanceOf(await wldFactory.vaultOf(ACCOUNTS.a0.a)), parseUnits("2.5", 18), "completed WLD was duplicated while resolving ambiguity");
  evidence.plan.ambiguousRecovery = { state: "submitting without tx hash", beforeBlock: ambiguousBlock, bridgeCallsWhileUnresolved: 0,
    status: "prior USDC request has no verifiable result yet. It was not repeated." };
  pass("ambiguous saved request stays unresolved and sends no duplicate transaction");

  // The earlier fixture rejection plus an empty event scan establishes this
  // injected request as a controlled safe-to-retry case.
  savedAfterReload.assets[1].depositState = "ready";
  delete savedAfterReload.assets[1].beforeBalance;
  delete savedAfterReload.assets[1].beforeBlock;
  await page.ev(`sessionStorage.setItem(${JSON.stringify(pendingKey)}, ${JSON.stringify(JSON.stringify(savedAfterReload))}); return true;`);
  await page.send("Page.reload", { ignoreCache: true });
  await until(async () => { await page.ev(HELPERS); return page.ev("return __q.tabs().length > 0"); }, "restored session helpers");
  await until(() => page.ev("return __q.tabs().length > 0"), "session restored for USDC retry");
  await chooseTab(page, "Plan");
  await installBridgeRecorder(page);
  await acceptYieldTerms(page);
  await page.ev(`window.__E2E_REJECTED_TARGET__ = ${JSON.stringify((await usdc.getAddress()).toLowerCase())};
    window.__E2E_REJECT_ERROR_CODE__ = 'simulation_failed'; return true;`);
  await clickButton(page, "Resume remaining setup");
  await until(() => page.ev(`
    const saved = JSON.parse(sessionStorage.getItem(${JSON.stringify(pendingKey)}) || 'null');
    return saved?.assets?.[1]?.depositState === 'ready' && window.__E2E_BRIDGE_CALLS__?.length === 1;
  `), "structured USDC simulation rejection returns to ready");
  const depositSimulationSaved = JSON.parse(await page.ev(`return sessionStorage.getItem(${JSON.stringify(pendingKey)})`));
  const depositSimulationCalls = JSON.parse(await page.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__ || [])"));
  assert.equal(depositSimulationSaved.assets[0].depositState, "complete");
  assert.equal(depositSimulationSaved.assets[1].depositState, "ready");
  assert.equal(depositSimulationCalls.length, 1);
  assert.equal(depositSimulationCalls[0].error_code, "simulation_failed");
  assert.equal(depositSimulationCalls[0].hash, "", "a failed simulation returned a transaction identifier");
  assert.equal(await wldStrategy.balanceOf(await wldFactory.vaultOf(ACCOUNTS.a0.a)), parseUnits("2.5", 18),
    "WLD changed while handling structured USDC failure");
  assert.equal(await usdcStrategy.balanceOf(await usdcFactory.vaultOf(ACCOUNTS.a0.a)), 0n,
    "failed USDC simulation changed the vault");
  evidence.plan.structuredDepositRejection = { errorCode: depositSimulationCalls[0].error_code,
    savedProgress: depositSimulationSaved.assets.map(item => [item.symbol, item.depositState]), bridgeCalls: depositSimulationCalls.length };
  await page.ev("window.__E2E_BRIDGE_CALLS__ = []; return true;");
  await clickButton(page, "Resume remaining setup");
  await until(async () => await usdcStrategy.balanceOf(await usdcFactory.vaultOf(ACCOUNTS.a0.a)) === parseUnits("12.123456", 18), "USDC-only resume deposit", 45_000);
  await until(() => page.ev("return /Your inheritance plan is ready/.test(document.body.innerText)"), "plan completion");
  const resumedCalls = JSON.parse(await page.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__ || [])"));
  assert.equal(resumedCalls.length, 1, "structured-failure retry should make exactly one asset wallet request");
  assert.deepEqual(resumedCalls[0].targets, [(await usdc.getAddress()).toLowerCase(), (await usdcFactory.getAddress()).toLowerCase()]);
  assert.equal(await wldStrategy.balanceOf(await wldFactory.vaultOf(ACCOUNTS.a0.a)), parseUnits("2.5", 18), "WLD amount changed during USDC-only resume");
  await until(() => page.ev(`return document.querySelector('.plan-overview-card') !== null && !/Updating…/.test(document.querySelector('.plan-overview-card')?.innerText || '')
    && /2\.5 WLD/.test(document.querySelector('.plan-overview-card')?.innerText || '')
    && /12\.123456 USDC/.test(document.querySelector('.plan-overview-card')?.innerText || '')`), "combined plan overview discovery", 35_000);

  const owner = ACCOUNTS.a0.a;
  const wldVaultAddress = await wldFactory.vaultOf(owner);
  const usdcVaultAddress = await usdcFactory.vaultOf(owner);
  const wldVault = new Contract(wldVaultAddress, artifact("InheritanceVaultMorpho").abi, provider);
  const usdcVault = new Contract(usdcVaultAddress, artifact("InheritanceVaultUSDC").abi, provider);
  const [wldDecimals, usdcDecimals, wldBasis, usdcBasis, wldOwner, usdcOwner,
    wldHeir, usdcHeir, wldHeartbeat, usdcHeartbeat, wldFactoryFromVault, usdcFactoryFromVault,
    wldTokenFromVault, usdcTokenFromVault] = await Promise.all([
    wld.decimals(), usdc.decimals(),
    wldVault.costBasis(), usdcVault.costBasis(), wldVault.owner(), usdcVault.owner(), wldVault.heir(), usdcVault.heir(),
    wldVault.heartbeatInterval(), usdcVault.heartbeatInterval(), wldVault.factory(), usdcVault.factory(),
    wldVault.WLD(), usdcVault.asset(),
  ]);
  const [wldShares, usdcShares, wldOwnerBalance, usdcOwnerBalance, wldPosition, usdcPosition] = await Promise.all([
    wldStrategy.balanceOf(wldVaultAddress), usdcStrategy.balanceOf(usdcVaultAddress),
    wld.balanceOf(owner), usdc.balanceOf(owner), wldVault.position(), usdcVault.position(),
  ]);
  for (const value of [wldOwner, usdcOwner]) assert.equal(value.toLowerCase(), owner.toLowerCase());
  for (const value of [wldHeir, usdcHeir]) assert.equal(value.toLowerCase(), ACCOUNTS.a1.a.toLowerCase());
  for (const value of [wldHeartbeat, usdcHeartbeat]) assert.equal(value, 30n * 86400n);
  assert.equal(wldDecimals, 18n); assert.equal(usdcDecimals, 6n);
  assert.equal(wldFactoryFromVault.toLowerCase(), (await wldFactory.getAddress()).toLowerCase());
  assert.equal(usdcFactoryFromVault.toLowerCase(), (await usdcFactory.getAddress()).toLowerCase());
  assert.equal(wldTokenFromVault.toLowerCase(), (await wld.getAddress()).toLowerCase());
  assert.equal(usdcTokenFromVault.toLowerCase(), (await usdc.getAddress()).toLowerCase());
  assert.equal(await wldFactory.knownVaults(wldVaultAddress), true);
  assert.equal(await usdcFactory.knownVaults(usdcVaultAddress), true);
  assert.equal(wldBasis, parseUnits("2.5", 18)); assert.equal(usdcBasis, parseUnits("12.123456", 6));
  assert.equal(wldShares, parseUnits("2.5", 18)); assert.equal(usdcShares, parseUnits("12.123456", 18));
  assert.equal(wldPosition.gross, parseUnits("2.5", 18)); assert.equal(usdcPosition.gross, parseUnits("12.123456", 6));
  assert.equal(wldOwnerBalance, parseUnits("97.5", 18)); assert.equal(usdcOwnerBalance, parseUnits("87.876544", 6));
  const overviewState = await page.ev("return document.querySelector('.plan-overview-card')?.innerText || ''");
  assert.match(overviewState, /2\.5 WLD/); assert.match(overviewState, /12\.123456 USDC/);
  assert.equal(await page.ev("return document.querySelectorAll('input[name=\"vault-kind\"]').length"), 0);
  assert.doesNotMatch(overviewState, /choose (a )?vault|primary vault|vault count/i);
  assert.equal(await page.ev("return document.querySelectorAll('.plan-overview-asset').length"), 2);
  evidence.plan = { ...evidence.plan, owner, heir: ACCOUNTS.a1.a, periodSeconds: "2592000",
    wld: { factory: await wldFactory.getAddress(), vault: wldVaultAddress, token: await wld.getAddress(), decimals: String(wldDecimals),
      deposit: String(wldBasis), strategyShares: String(wldShares), walletBalanceAfter: String(wldOwnerBalance),
      gross: String(wldPosition.gross), net: String(wldPosition.net), costBasis: String(wldBasis), owner: wldOwner, heir: wldHeir,
      heartbeatSeconds: String(wldHeartbeat), canonical: await wldFactory.vaultOf(owner) },
    usdc: { factory: await usdcFactory.getAddress(), vault: usdcVaultAddress, token: await usdc.getAddress(), decimals: String(usdcDecimals),
      deposit: String(usdcBasis), strategyShares: String(usdcShares), walletBalanceAfter: String(usdcOwnerBalance),
      gross: String(usdcPosition.gross), net: String(usdcPosition.net), costBasis: String(usdcBasis), owner: usdcOwner, heir: usdcHeir,
      heartbeatSeconds: String(usdcHeartbeat), canonical: await usdcFactory.vaultOf(owner) },
    resumedBridgeCalls: resumedCalls, overviewText: overviewState };
  pass("reload resumes only USDC and canonical discovery shows both assets separately", "1 active WLD vault and 1 active USDC vault; no primary-vault chooser");

  await captureLayout(page, "overview", 320, [".plan-overview-assets", ".plan-overview-asset", ".tab-item"]);
  await captureLayout(page, "overview", 360, [".plan-overview-assets", ".plan-overview-asset", ".tab-item"]);
  await captureLayout(page, "overview", 390, [".plan-overview-assets", ".plan-overview-asset", ".tab-item"]);
  await captureStore(page, "unified-store-overview");

  // Current setup: one atomic request, including both creations and deposits.
  await provider.send('anvil_setBalance',[ACCOUNTS.a10.a,'0x8ac7230489e80000']);
  await (await wld.mint(ACCOUNTS.a10.a, parseUnits('100',18))).wait();
  await (await usdc.mint(ACCOUNTS.a10.a, parseUnits('100',6))).wait();
  const freshPage = await launch({pk:ACCOUNTS.a10.pk,url:appUrl,preload});
  regressionPages.push(['one-request-setup',freshPage]);
  await signIn(freshPage);
  await chooseTab(freshPage,'Plan');
  await freshPage.ev(`__q.setInput('heir-input',${JSON.stringify(ACCOUNTS.a1.a)});__q.setInput('plan-wld','0.8');__q.setInput('plan-usdc','3');return true;`);
  await installBridgeRecorder(freshPage);
  await acceptYieldTerms(freshPage);
  assert.equal(await freshPage.ev("return !!document.querySelector('.plan-final-review') && document.getElementById('yield-consent').checked"),true);
  const freshKey=`inheritance:pending-plan:${ACCOUNTS.a10.a.toLowerCase()}`;
  await freshPage.ev(`window.__E2E_REJECTED_TARGET__=${JSON.stringify((await usdc.getAddress()).toLowerCase())};window.__E2E_REJECT_ERROR_CODE__='user_rejected';return true;`);
  await clickButton(freshPage,'Confirm and deposit');
  await until(()=>freshPage.ev(`const p=JSON.parse(sessionStorage.getItem(${JSON.stringify(freshKey)})||'null');return p?.createState==='ready' && !p.setupRequest && p.assets.every(a=>a.depositState==='ready');`),'whole setup rejection stays editable');
  assert.equal(await wldFactory.vaultOf(ACCOUNTS.a10.a),ZeroAddress);
  assert.equal(await usdcFactory.vaultOf(ACCOUNTS.a10.a),ZeroAddress);
  pass('one-request wallet cancellation creates neither asset and leaves both amounts ready');

  // Cause the final USDC deposit to revert on the actual local EVM after the
  // valid app quote. The earlier creation, approval and WLD deposit roll back.
  const badUsdc=usdcFactory.interface.encodeFunctionData('depositWithMinShares',[parseUnits('3',6),2n**255n]);
  await freshPage.ev(`const fixture=await import('/src/test/minikit-stub.ts');window.__FRESH_NORMAL_SEND__=fixture.MiniKit.sendTransaction;
    fixture.MiniKit.sendTransaction=async request=>{const transactions=[...request.transactions];transactions[transactions.length-1]={...transactions.at(-1),data:${JSON.stringify(badUsdc)}};return window.__FRESH_NORMAL_SEND__({...request,transactions});};window.__E2E_BRIDGE_CALLS__=[];return true;`);
  await clickButton(freshPage,'Resume remaining setup');
  await until(()=>freshPage.ev(`const p=JSON.parse(sessionStorage.getItem(${JSON.stringify(freshKey)})||'null');return /transaction reverted/i.test(document.body.innerText) && !p?.setupRequest && p?.assets.every(a=>a.depositState==='ready');`),'canonical batch revert returns entire setup to ready');
  const revertedCalls=JSON.parse(await freshPage.ev('return JSON.stringify(window.__E2E_BRIDGE_CALLS__)'));
  assert.equal(revertedCalls.length,1);
  const revertedReceipt=await provider.getTransactionReceipt(revertedCalls[0].hash);
  assert.equal(revertedReceipt.status,0);
  assert.equal(await wldFactory.vaultOf(ACCOUNTS.a10.a),ZeroAddress);
  assert.equal(await usdcFactory.vaultOf(ACCOUNTS.a10.a),ZeroAddress);
  assert.equal(await wld.balanceOf(ACCOUNTS.a10.a),parseUnits('100',18));
  assert.equal(await usdc.balanceOf(ACCOUNTS.a10.a),parseUnits('100',6));
  pass('last-call real EVM failure rolls back both creations, allowances and all deposits');
  await freshPage.ev("const fixture=await import('/src/test/minikit-stub.ts');fixture.MiniKit.sendTransaction=window.__FRESH_NORMAL_SEND__;window.__E2E_BRIDGE_CALLS__=[];return true;");
  await clickButton(freshPage,'Resume remaining setup');
  await until(()=>freshPage.ev(`return sessionStorage.getItem(${JSON.stringify(freshKey)})===null && /Your inheritance plan is ready/.test(document.body.innerText);`),'one-request setup completes',75000);
  const freshCalls=JSON.parse(await freshPage.ev('return JSON.stringify(window.__E2E_BRIDGE_CALLS__)'));
  assert.equal(freshCalls.length,1);
  assert.equal(freshCalls[0].transactions.length,6);
  const freshReceipt=await provider.getTransactionReceipt(freshCalls[0].hash);
  assert.equal(freshReceipt.status,1);
  const freshWld=await wldFactory.vaultOf(ACCOUNTS.a10.a),freshUsdc=await usdcFactory.vaultOf(ACCOUNTS.a10.a);
  assert.equal(await wldStrategy.balanceOf(freshWld),parseUnits('0.8',18));
  assert.equal(await usdcStrategy.balanceOf(freshUsdc),parseUnits('3',18));
  const freshSnapshot=JSON.parse(await freshPage.ev('return JSON.stringify(window.__E2E_SETUP_SNAPSHOT__)'));
  evidence.plan.oneRequestSetup={walletRequests:1,calls:6,canonicalReceipt:freshReceipt.hash,receiptStatus:1,revertReceipt:revertedReceipt.hash,revertStatus:0};
  pass('both asset creations and exact deposits complete in one wallet request and one canonical receipt');
  for(const identified of [false,true]) {
    const saved=structuredClone(freshSnapshot);
    if(identified) {saved.setupRequest.txHash=freshReceipt.hash;saved.setupRequest.hashType='transaction';}
    await freshPage.ev(`sessionStorage.setItem(${JSON.stringify(freshKey)},${JSON.stringify(JSON.stringify(saved))});return true;`);
    await freshPage.send('Page.reload',{ignoreCache:true});
    await until(async()=>{await freshPage.ev(HELPERS);return freshPage.ev('return __q.tabs().length>0');},'single setup receipt restored');
    await chooseTab(freshPage,'Plan');
    await installBridgeRecorder(freshPage);
    await clickButton(freshPage,'Resume remaining setup');
    await until(()=>freshPage.ev(`return sessionStorage.getItem(${JSON.stringify(freshKey)})===null;`),'entire setup recovered without resend',75000);
    assert.equal(JSON.parse(await freshPage.ev('return JSON.stringify(window.__E2E_BRIDGE_CALLS__)')).length,0);
    assert.equal(await wldStrategy.balanceOf(freshWld),parseUnits('0.8',18));
    assert.equal(await usdcStrategy.balanceOf(freshUsdc),parseUnits('3',18));
    pass(`${identified?'identified':'ID-less'} entire setup recovery proves both creations and deposits without another wallet request`);
  }
  const freshWldChild=new Contract(freshWld,artifact('InheritanceVaultMorpho').abi,provider);
  const freshUsdcChild=new Contract(freshUsdc,artifact('InheritanceVaultUSDC').abi,provider);
  const freshDeadline=Number(await freshWldChild.deadline());
  await provider.send('evm_setNextBlockTimestamp',[freshDeadline+1]);
  await provider.send('evm_mine',[]);
  const heirSigner=await provider.getSigner(1);
  await (await new Contract(wldFactoryAddress,wldFactory.interface,heirSigner).fileClaimFor(freshWld)).wait();
  await (await new Contract(usdcFactoryAddress,usdcFactory.interface,heirSigner).fileClaimFor(freshUsdc)).wait();
  await chooseTab(freshPage,'Home');
  await installBridgeRecorder(freshPage);
  await clickButton(freshPage,'Check in');
  await until(()=>freshPage.ev("return /Inheritance claims are pending for 2/.test(document.querySelector('.checkin-review')?.innerText||'');"),'pending claims require cancellation review');
  assert.equal(JSON.parse(await freshPage.ev('return JSON.stringify(window.__E2E_BRIDGE_CALLS__)')).length,0);
  await (await new Contract(wldFactoryAddress,wldFactory.interface,new Wallet(ACCOUNTS.a10.pk,provider)).pingMyVault()).wait();
  await clickButton(freshPage,'Cancel claims and check in');
  await until(()=>freshPage.ev("return /Inheritance claims are pending for 1/.test(document.querySelector('.checkin-review')?.innerText||'');"),'changed claim snapshot requires fresh review');
  assert.equal(JSON.parse(await freshPage.ev('return JSON.stringify(window.__E2E_BRIDGE_CALLS__)')).length,0);
  await clickButton(freshPage,'Cancel claims and check in');
  await until(()=>freshPage.ev("return /Checked in to all 2 active vaults/.test(document.body.innerText)&&!document.querySelector('.checkin-review');"),'reviewed cancellation check-in completes');
  assert.equal(await freshWldChild.claimFiledAt(),0n);
  assert.equal(await freshUsdcChild.claimFiledAt(),0n);
  assert.equal(JSON.parse(await freshPage.ev('return JSON.stringify(window.__E2E_BRIDGE_CALLS__)')).length,1);
  evidence.checkIn.pendingClaimReview={noSendBeforeReview:true,changedSnapshotRequiresReview:true,cancelledClaims:true};
  pass('claim cancellation needs explicit review, changed claims refresh that review, and both periods renew in one request');

  const pingsBefore = { WLD: await wldVault.lastPing(), USDC: await usdcVault.lastPing() };
  assert.equal(await page.ev("return document.querySelector('.checkin-review') !== null"), false);
  await provider.send("evm_increaseTime", [2]);
  await provider.send("evm_mine", []);
  await clickButton(page, "Check in");
  await until(async () => await wldVault.lastPing() > pingsBefore.WLD && await usdcVault.lastPing() > pingsBefore.USDC, "both canonical vault check-ins", 30_000);
  const pingsAfter = { WLD: await wldVault.lastPing(), USDC: await usdcVault.lastPing() };
  assert.ok(pingsAfter.WLD > pingsBefore.WLD); assert.ok(pingsAfter.USDC > pingsBefore.USDC);
  assert.equal(await wldVault.heartbeatInterval(), 30n * 86400n);
  assert.equal(await usdcVault.heartbeatInterval(), 30n * 86400n);
  evidence.checkIn = { before: { WLD: String(pingsBefore.WLD), USDC: String(pingsBefore.USDC) }, after: { WLD: String(pingsAfter.WLD), USDC: String(pingsAfter.USDC) } };
  await until(() => page.ev("return /Checked in to all 2 active vaults/.test(document.body.innerText) && !document.querySelector('.checkin-review')"), "both check-ins proven in one canonical batch receipt");
  pass("combined check-in updates both active vault timestamps");

  const generalWithdrawal = await page.ev(`
    const tabs = [...document.querySelectorAll('.tab-item')];
    const vaultTab = tabs.find(button => button.textContent.trim() === 'Assets');
    vaultTab?.click();
    return true;
  `);
  assert.equal(generalWithdrawal, true);
  await until(() => page.ev("return document.getElementById('withdraw-to') !== null && document.querySelector('.income-card #income-to') !== null"), "separate principal and income controls");
  pass("principal withdrawal and income collection remain separate controls");

  const initialIncomeRead = await wldVault.incomePosition();
  assert.ok(initialIncomeRead.valued, "new income API did not return a valued position");
  await (await wldStrategy.setRate(parseUnits("1.2", 18))).wait();
  await page.send("Page.reload", { ignoreCache: true });
  await until(async () => { await page.ev(HELPERS); return page.ev("return __q.tabs().length > 0"); }, "restored session helpers");
  await until(() => page.ev("return __q.tabs().length > 0"), "session restored for income screen");
  await chooseTab(page, "Assets");
  await until(async () => {
    const position = await wldVault.incomePosition();
    return position.valued && position.withdrawableNet > 0n && /Available after fee/i.test(await page.ev("return document.querySelector('.income-card')?.innerText || ''"));
  }, "positive, valued income display", 35_000);
  await page.ev("__q.reveal('#income-to'); return [...document.querySelectorAll('.income-card button')].find(button => button.textContent.trim() === 'My address')?.click() ?? false;");
  assert.equal(await page.ev("return document.getElementById('income-to')?.value"), owner);
  await page.ev("document.querySelector('.income-card button')?.scrollIntoView({block:'center'}); return true;");
  await page.ev("document.querySelector('.income-card')?.scrollIntoView({block:'start'}); window.scrollBy(0,-100); return true;");
  await page.ev("const details = document.getElementById('income-to')?.closest('details'); if (details?.open) details.querySelector('summary').click(); return true;");
  assert.equal(await page.ev("return document.querySelectorAll('.income-card').length"), 1, "income must render once");
  await captureLayout(page, "income", 320, [".income-collect", ".asset-switcher button", ".tab-item"]);
  await captureLayout(page, "income", 360, [".income-collect", ".asset-switcher button", ".tab-item"]);
  await captureLayout(page, "income", 390, [".income-collect", ".asset-switcher button", ".tab-item"]);
  await captureStore(page, "unified-store-income", ".income-card");
  await page.ev(`return __q.setInput('income-to', ${JSON.stringify(ACCOUNTS.a2.a)})`);
  await clickMatchingButton(page, text => text === 'USDC');
  await until(() => page.ev("return document.querySelectorAll('.income-card').length === 1 && document.querySelector('.income-card')?.innerText.includes('USDC') && document.getElementById('income-to')?.value.toLowerCase() === " + JSON.stringify(owner.toLowerCase())), "USDC income context and recipient reset");
  await clickMatchingButton(page, text => text === 'WLD');
  await until(() => page.ev("return document.querySelectorAll('.income-card').length === 1 && document.querySelector('.income-card')?.innerText.includes('WLD') && document.getElementById('income-to')?.value.toLowerCase() === " + JSON.stringify(owner.toLowerCase())), "WLD income context restored");
  assert.doesNotMatch(await page.ev("return document.querySelector('.income-card').innerText"), /USDC/);
  pass("asset switching shows one income card for the selected token and clears a custom receiving wallet");

  await page.ev("document.querySelector('.income-card')?.scrollIntoView({block:'start'}); return true;");
  const incomeBefore = await wldVault.incomePosition();
  assert.ok(incomeBefore.withdrawableNet > 0n);
  const beforeIncome = {
    costBasis: await wldVault.costBasis(), lastPing: await wldVault.lastPing(), deadline: await wldVault.deadline(),
    shares: await wldStrategy.balanceOf(wldVaultAddress), ownerToken: await wld.balanceOf(owner), feeToken: await wld.balanceOf(ACCOUNTS.a2.a),
  };
  await installBridgeRecorder(page);
  await clickMatchingButton(page, text => text.startsWith("Collect "));
  await until(async () => (await wldVault.incomePosition()).withdrawableNet === 0n, "income-only withdrawal receipt and updated position", 35_000);
  const afterIncome = {
    costBasis: await wldVault.costBasis(), lastPing: await wldVault.lastPing(), deadline: await wldVault.deadline(),
    shares: await wldStrategy.balanceOf(wldVaultAddress), ownerToken: await wld.balanceOf(owner), feeToken: await wld.balanceOf(ACCOUNTS.a2.a),
  };
  const incomeCall = JSON.parse(await page.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__ || [])"));
  assert.equal(incomeCall.length, 1);
  assert.deepEqual(incomeCall[0].targets, [(await wldFactory.getAddress()).toLowerCase()]);
  const incomeFactoryInterface = new Interface(artifact("InheritanceVaultMorphoFactory").abi);
  const incomeTx = incomeFactoryInterface.parseTransaction({ data: incomeCall[0].transactions[0].data });
  assert.equal(incomeTx?.name, "withdrawIncomeFromMyVault");
  const expectedMinNet = incomeBefore.withdrawableNet * 9950n / 10000n;
  assert.equal(String(incomeTx.args[0]).toLowerCase(), owner.toLowerCase());
  assert.equal(BigInt(incomeTx.args[1]), expectedMinNet, "income request did not preserve the displayed minimum-net floor");
  assert.equal(incomeCall[0].hash.length, 66, "the bridge did not return a transaction hash");
  assert.equal(incomeCall[0].success, true);
  assert.equal(afterIncome.costBasis, beforeIncome.costBasis, "income collection changed principal basis");
  assert.equal(afterIncome.lastPing, beforeIncome.lastPing, "income collection reset the check-in timer");
  assert.equal(afterIncome.deadline, beforeIncome.deadline, "income collection changed the inheritance deadline");
  const incomeReceipt = await provider.getTransactionReceipt(incomeCall[0].hash);
  assert.ok(incomeReceipt && incomeReceipt.status === 1, "income transaction receipt is missing or failed");
  const incomeEventLog = incomeReceipt.logs.find(log => log.address.toLowerCase() === wldVaultAddress.toLowerCase()
    && log.topics[0]?.toLowerCase() === wldVault.interface.getEvent("IncomeWithdrawn").topicHash.toLowerCase());
  assert.ok(incomeEventLog, "IncomeWithdrawn event not found on the personal vault");
  assert.equal(incomeReceipt.logs.some(log => log.address.toLowerCase() === wldFactoryAddress.toLowerCase()
    && log.topics[0]?.toLowerCase() === wldVault.interface.getEvent("IncomeWithdrawn").topicHash.toLowerCase()), false,
  "IncomeWithdrawn was incorrectly emitted by the factory");
  const verifiedIncomeEvent = wldVault.interface.parseLog({ topics: incomeEventLog.topics, data: incomeEventLog.data });
  const incomeArgs = verifiedIncomeEvent.args;
  const gross = BigInt(incomeArgs.gross), fee = BigInt(incomeArgs.fee), net = BigInt(incomeArgs.net);
  const recipient = String(incomeArgs.to);
  assert.equal(recipient.toLowerCase(), owner.toLowerCase());
  assert.equal(fee, gross * 1000n / 10000n, "income fee must be 10% of gross, rounded down to whole token units");
  assert.equal(net + fee, gross);
  assert.equal(afterIncome.ownerToken - beforeIncome.ownerToken, net, "owner did not receive the exact net income");
  assert.equal(afterIncome.feeToken - beforeIncome.feeToken, fee, "fee recipient did not receive the exact fee");
  assert.ok(gross > 0n && net > 0n && expectedMinNet > 0n);
  evidence.income = { receipt: incomeReceipt.hash, emitter: incomeEventLog.address, recipient,
    minNetSent: String(expectedMinNet), gross: String(gross), fee: String(fee), net: String(net),
    feeBps: "1000", feeRecipient: ACCOUNTS.a2.a,
    before: Object.fromEntries(Object.entries(beforeIncome).map(([key, value]) => [key, String(value)])),
    after: Object.fromEntries(Object.entries(afterIncome).map(([key, value]) => [key, String(value)])) };
  pass("income-only receipt pays owner net and 10% fee from the personal-vault event", `${gross} gross / ${fee} fee / ${net} net`);

  await provider.send("anvil_mine", ["0x41"]);
  assert.ok((await provider.getBlock("finalized")).number >= incomeReceipt.blockNumber, "local history fixture must finalize the actual receipt first");
  await page.ev("document.querySelector('.income-history-disclosure').open = true; return true;");
  await clickButton(page, "Refresh history");
  await until(() => page.ev("return document.querySelectorAll('.income-history-list li').length === 1"), "verified received income history");
  const receivedHistory = await page.ev("return document.querySelector('.income-history-content').innerText");
  assert.ok(receivedHistory.includes(require("ethers").formatUnits(net, 18)));
  assert.ok(receivedHistory.includes(require("ethers").formatUnits(fee, 18)));
  assert.ok(receivedHistory.toLowerCase().includes(owner.toLowerCase()));
  assert.equal(await page.ev(`return !!document.querySelector('a[href$="${incomeCall[0].hash}"]')`), true);
  evidence.income.history = { verifiedReceiptCount: 1, gross: String(gross), fee: String(fee), net: String(net) };
  pass("income history displays the genuine canonical WLD receipt and exact fee and net amounts");
  await page.ev(`
    window.__HISTORY_ORIGINAL_FETCH__ = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input?.url ?? String(input);
      if (url === window.__E2E_RPC__ && init?.body) {
        const payload = JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body));
        const requests = Array.isArray(payload) ? payload : [payload];
        const bad = requests.filter(request => request.method === 'eth_getBlockByNumber' && request.params[0] === 'finalized');
        if (bad.length) {
          const response = await window.__HISTORY_ORIGINAL_FETCH__(input, init);
          const results = await response.json();
          const values = Array.isArray(results) ? results : [results];
          const patched = values.map(result => bad.some(request => request.id === result.id)
            ? { id: result.id, jsonrpc: '2.0', error: { code: -32000, message: 'fixture finality rate limit' } } : result);
          return Response.json(Array.isArray(results) ? patched : patched[0]);
        }
      }
      return window.__HISTORY_ORIGINAL_FETCH__(input, init);
    };
    return true;
  `);
  await sleep(300);
  await clickButton(page, "Refresh history");
  await until(() => page.ev("return /The network did not provide a finalized block/.test(document.querySelector('.income-history-content')?.innerText || '')"), "temporary finality failure");
  assert.equal(await page.ev("return [...document.querySelectorAll('.income-history-card button')].some(button => button.textContent.trim() === 'Refresh history' && !button.disabled)"), true);
  await page.ev("window.fetch = window.__HISTORY_ORIGINAL_FETCH__; return true;");
  await sleep(300);
  await clickButton(page, "Refresh history");
  await until(() => page.ev("return document.querySelectorAll('.income-history-list li').length === 1"), "recovered finalized history");
  assert.equal(await page.ev(`return !!document.querySelector('a[href$="${incomeCall[0].hash}"]')`), true);
  pass("temporary finalized-block failure keeps manual retry available and recovers the actual income receipt");
  await clickMatchingButton(page, text => text === "USDC");
  assert.equal(await page.ev(`return document.querySelector('.income-history-content')?.innerHTML.includes(${JSON.stringify(incomeCall[0].hash)}) || false`), false);
  pass("switching history to USDC immediately excludes the previous WLD receipt");
  await clickMatchingButton(page, text => text === "WLD");
  await chooseTab(page, "Home");
  const currentHomeHeir = String(await wldVault.heir());
  const expectedHomeHeirName = await page.ev(`return window.__E2E_USERNAMES__?.[${JSON.stringify(currentHomeHeir.toLowerCase())}] || ${JSON.stringify(`e2e_${currentHomeHeir.slice(2, 8).toLowerCase()}`)};`);
  await until(() => page.ev(`return document.querySelector('.plan-common-settings')?.innerText.includes(${JSON.stringify(`@${expectedHomeHeirName}`)})`), "human-readable heir name");
  assert.equal(await page.ev(`return document.querySelector('.plan-common-settings strong')?.title.toLowerCase() === ${JSON.stringify(currentHomeHeir.toLowerCase())}`), true);
  pass("Home resolves the heir username while preserving the full canonical recipient address");
  await page.ev("const select=document.querySelector('.locale-picker select'); select.value='ko'; select.dispatchEvent(new Event('change',{bubbles:true})); return true;");
  await until(() => page.ev("return document.querySelector('.locale-picker select')?.value === 'ko' && /상속인/.test(document.body.innerText)"), "Korean Home");
  await until(() => page.ev("const labels=[...document.querySelectorAll('.plan-overview-asset small')];return labels.length===2 && labels.every(element => element.innerText.includes('서비스 수수료 차감 전'))"), "localized refreshed yield valuation labels");
  await chooseTab(page, "자산");
  assert.match(await page.ev("return document.querySelector('.asset-money-card').innerText"), /서비스 수수료 차감 전 운용 가치/);
  const feeLabelFits = JSON.parse(await page.ev("const label=document.querySelectorAll('.asset-money-card .stat-label')[1]; return JSON.stringify({full:label.scrollWidth <= label.clientWidth, wraps:getComputedStyle(label).whiteSpace});"));
  assert.equal(feeLabelFits.full, true);
  assert.equal(feeLabelFits.wraps, "normal");
  await chooseTab(page, "홈");
  await captureLayout(page, "home-ko", 320, [".tab-item"]);
  assert.equal(await page.ev("return localStorage.getItem('inheritance:locale')"), "ko");
  pass("explicit Korean selection translates Home and persists the preference");
  await page.ev("const select=document.querySelector('.locale-picker select'); select.value='en'; select.dispatchEvent(new Event('change',{bubbles:true})); return true;");
  await until(() => page.ev("return /Today, and for their tomorrow/.test(document.body.innerText)"), "restored English Home");
  pass("switching back restores the existing English navigation and launch copy");

  // Separate active vault to prove settings changes wait for explicit UI consent.
  await (await wldStrategy.setRate(parseUnits("1", 18))).wait();
  const alignSigner = await provider.getSigner(3);
  const alignFactory = new Contract(await wldFactory.getAddress(), artifact("InheritanceVaultMorphoFactory").abi, alignSigner);
  await (await alignFactory.createVault(ACCOUNTS.a4.a, 14 * 86400)).wait();
  const preexistingAlignVault = await wldFactory.vaultOf(ACCOUNTS.a3.a);
  assert.notEqual(preexistingAlignVault, ZeroAddress);
  alignmentPage = await launch({ pk: ACCOUNTS.a3.pk, url: appUrl, preload });
  await signIn(alignmentPage);
  await chooseTab(alignmentPage, "Plan");
  await installBridgeRecorder(alignmentPage);
  assert.equal(await alignmentPage.ev("return document.getElementById('yield-consent') !== null"), false);
  await alignmentPage.ev(`return __q.setInput('heir-input', ${JSON.stringify(ACCOUNTS.a5.a)})`);
  await alignmentPage.ev("return __q.setInput('period-input', '30')");
  await alignmentPage.ev("return __q.setInput('plan-wld', '0.25')");
  await until(() => alignmentPage.ev("return document.querySelector('.resolved-heir') !== null"), "alignment heir resolution");
  await acceptYieldTerms(alignmentPage);
  await until(() => alignmentPage.ev("return !document.querySelector('.plan-submit')?.disabled"), "alignment plan form");
  await clickButton(alignmentPage, "Create plan and deposit");
  await until(() => alignmentPage.ev("return document.querySelector('.plan-alignment-review') !== null"), "settings alignment review");
  assert.equal((await wldFactory.vaultOf(ACCOUNTS.a3.a)).toLowerCase(), preexistingAlignVault.toLowerCase());
  assert.equal((await new Contract(preexistingAlignVault, artifact("InheritanceVaultMorpho").abi, provider).heir()).toLowerCase(), ACCOUNTS.a4.a.toLowerCase());
  assert.equal(await new Contract(preexistingAlignVault, artifact("InheritanceVaultMorpho").abi, provider).heartbeatInterval(), 14n * 86400n);
  assert.equal(await wldStrategy.balanceOf(preexistingAlignVault), 0n, "settings changed before explicit consent");
  const reviewText = await alignmentPage.ev("return document.querySelector('.plan-alignment-review').innerText");
  assert.match(reviewText, /Confirm and align settings/);
  assert.match(reviewText, /WLD/);
  await clickButton(alignmentPage, "Confirm and align settings");
  await until(async () => {
    const vault = new Contract(preexistingAlignVault, artifact("InheritanceVaultMorpho").abi, provider);
    return (await vault.heir()).toLowerCase() === ACCOUNTS.a5.a.toLowerCase() && await vault.heartbeatInterval() === 30n * 86400n
      && await wldStrategy.balanceOf(preexistingAlignVault) === parseUnits("0.25", 18);
  }, "explicitly aligned settings and deposit", 35_000);
  await until(() => alignmentPage.ev("return /Your inheritance plan is ready/.test(document.body.innerText)"), "aligned plan confirmation in the app");
  evidence.settingsAlignment = { before: { heir: ACCOUNTS.a4.a, periodSeconds: String(14 * 86400), strategyShares: "0" },
    requested: { heir: ACCOUNTS.a5.a, periodSeconds: String(30 * 86400) }, after: { heir: await new Contract(preexistingAlignVault, artifact("InheritanceVaultMorpho").abi, provider).heir(),
      periodSeconds: String(await new Contract(preexistingAlignVault, artifact("InheritanceVaultMorpho").abi, provider).heartbeatInterval()), strategyShares: String(await wldStrategy.balanceOf(preexistingAlignVault)) },
    review: reviewText };
  pass("existing settings remain unchanged until the user confirms alignment");

  // An approval is a snapshot of the reviewed targets and their current settings.
  // A funded second asset added by another session requires a fresh review.
  const driftSigner = await provider.getSigner(8);
  const driftWldFactory = new Contract(await wldFactory.getAddress(), artifact("InheritanceVaultMorphoFactory").abi, driftSigner);
  const driftUsdcFactory = new Contract(await usdcFactory.getAddress(), artifact("InheritanceVaultUSDCFactory").abi, driftSigner);
  await (await wld.mint(ACCOUNTS.a8.a, parseUnits("1", 18))).wait();
  await (await usdc.mint(ACCOUNTS.a8.a, parseUnits("1", 6))).wait();
  await (await driftWldFactory.createVault(ACCOUNTS.a4.a, 14 * 86400)).wait();
  driftPage = await launch({ pk: ACCOUNTS.a8.pk, url: appUrl, preload });
  await signIn(driftPage);
  await chooseTab(driftPage, "Plan");
  await installBridgeRecorder(driftPage);
  await driftPage.ev(`return __q.setInput('heir-input', ${JSON.stringify(ACCOUNTS.a5.a)})`);
  await driftPage.ev("return __q.setInput('period-input', '30')");
  await driftPage.ev("return __q.setInput('plan-wld', '0.1')");
  await acceptYieldTerms(driftPage);
  await clickButton(driftPage, "Create plan and deposit");
  await until(() => driftPage.ev("return !!document.querySelector('.plan-alignment-review')"), "first one-asset review");
  assert.doesNotMatch(await driftPage.ev("return document.querySelector('.plan-alignment-review').innerText"), /USDC/);
  const driftUsdcCreateBeforeBlock = await provider.getBlockNumber();
  const driftUsdcCreateReceipt = await (await driftUsdcFactory.createVault(ACCOUNTS.a4.a, 14 * 86400)).wait();
  await (await new Contract(await usdc.getAddress(), artifact("MockGasRefillERC20", "MockGasRefill").abi, driftSigner)
    .approve(await usdcFactory.getAddress(), parseUnits("0.01", 6))).wait();
  await (await driftUsdcFactory.depositWithMinShares(parseUnits("0.01", 6), 1)).wait();
  const driftWldVault = new Contract(await wldFactory.vaultOf(ACCOUNTS.a8.a), artifact("InheritanceVaultMorpho").abi, provider);
  const driftUsdcVault = new Contract(await usdcFactory.vaultOf(ACCOUNTS.a8.a), artifact("InheritanceVaultUSDC").abi, provider);
  await clickButton(driftPage, "Confirm and align settings");
  await until(() => driftPage.ev("return /USDC/.test(document.querySelector('.plan-alignment-review')?.innerText || '')"), "changed target list requires re-review");
  assert.equal(JSON.parse(await driftPage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__ || [])")).length, 0);
  for (const child of [driftWldVault, driftUsdcVault]) {
    assert.equal((await child.heir()).toLowerCase(), ACCOUNTS.a4.a.toLowerCase());
    assert.equal(await child.heartbeatInterval(), 14n * 86400n);
  }
  await clickButton(driftPage, "Confirm and align settings");
  await until(() => driftPage.ev("return /Your inheritance plan is ready/.test(document.body.innerText)"), "fresh two-asset review completes");
  for (const child of [driftWldVault, driftUsdcVault]) {
    assert.equal((await child.heir()).toLowerCase(), ACCOUNTS.a5.a.toLowerCase());
    assert.equal(await child.heartbeatInterval(), 30n * 86400n);
  }
  evidence.settingsAlignment.changedTargets = { initial: ["WLD"], addedFundedAsset: "USDC", walletRequestsBeforeFreshApproval: 0 };
  pass("an added funded asset invalidates the old settings approval and requires a fresh review");

  // A zero quote or quote RPC failure happens before any deposit wallet request.
  // Keep a ready persisted step so the same plan can resume after the read recovers.
  const alignPendingKey = `inheritance:pending-plan:${ACCOUNTS.a3.a.toLowerCase()}`;
  const previewSelector = new Interface(artifact("MockERC4626").abi).getFunction("previewDeposit").selector;
  const previewRetryVault = await wldFactory.vaultOf(ACCOUNTS.a3.a);
  const previewRetryBefore = await wldStrategy.balanceOf(previewRetryVault);
  await chooseTab(alignmentPage, "Plan");
  await alignmentPage.ev("return __q.setInput('plan-wld', '0.125')");
  await alignmentPage.ev("return __q.setInput('plan-usdc', '')");
  await acceptYieldTerms(alignmentPage);
  await alignmentPage.ev(`
    window.__E2E_BRIDGE_CALLS__ = [];
    window.__REVIEW_PREVIEW_ZERO__ = true;
    window.__REVIEW_PREVIEW_FAIL__ = false;
    window.__REVIEW_PREVIEW_FAILURE_READS__ = 0;
    window.__REVIEW_FETCH__ = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input?.url ?? String(input);
      if (url === window.__E2E_RPC__ && init?.body) {
        const payload = JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body));
        const requests = Array.isArray(payload) ? payload : [payload];
        const bad = requests.filter(request => (window.__REVIEW_PREVIEW_ZERO__ || window.__REVIEW_PREVIEW_FAIL__) && request.method === 'eth_call'
          && (request.params[0].data || request.params[0].input || '').startsWith(${JSON.stringify(previewSelector)}));
        if (bad.length) {
          if (window.__REVIEW_PREVIEW_FAIL__) window.__REVIEW_PREVIEW_FAILURE_READS__ += bad.length;
          const response = await window.__REVIEW_FETCH__(input, init);
          const results = await response.json();
          const values = Array.isArray(results) ? results : [results];
          const patched = values.map(result => {
            if (!bad.some(request => request.id === result.id)) return result;
            return window.__REVIEW_PREVIEW_ZERO__
              ? { id: result.id, jsonrpc: '2.0', result: '0x' + '0'.repeat(64) }
              : { id: result.id, jsonrpc: '2.0', error: { code: -32000, message: 'review preview RPC failure' } };
          });
          return Response.json(Array.isArray(results) ? patched : patched[0]);
        }
      }
      return window.__REVIEW_FETCH__(input, init);
    };
    return true;
  `);
  await clickButton(alignmentPage, "Create plan and deposit");
  await until(() => alignmentPage.ev("return /No output is currently available/.test(document.body.innerText) && !document.querySelector('.plan-submit').disabled"), "zero quote leaves the reviewed draft editable");
  const zeroQuoteSaved = JSON.parse(await alignmentPage.ev(`return sessionStorage.getItem(${JSON.stringify(alignPendingKey)})`));
  assert.equal(zeroQuoteSaved, null, "a quote failure before handoff must not create a pending wallet request");
  assert.equal(JSON.parse(await alignmentPage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__ || [])")).length, 0,
    "zero quote happened after a wallet request");
  assert.equal(await wldStrategy.balanceOf(previewRetryVault), previewRetryBefore);
  await alignmentPage.ev("window.__REVIEW_PREVIEW_ZERO__ = false; window.__REVIEW_PREVIEW_FAIL__ = true; return true;");
  // Let the browser provider's short request cache expire before changing the
  // simulated response for the same previewDeposit calldata.
  await sleep(350);
  await clickButton(alignmentPage, "Create plan and deposit");
  await until(() => alignmentPage.ev("return window.__REVIEW_PREVIEW_FAILURE_READS__ > 0 && /Plan setup:/.test(document.body.innerText) && !/No output is currently available/.test(document.body.innerText) && !document.querySelector('.plan-submit').disabled"), "preview RPC failure leaves the reviewed draft editable");
  const previewFailureSaved = JSON.parse(await alignmentPage.ev(`return sessionStorage.getItem(${JSON.stringify(alignPendingKey)})`));
  assert.equal(previewFailureSaved, null);
  assert.equal(JSON.parse(await alignmentPage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__ || [])")).length, 0,
    "preview RPC failure happened after a wallet request");
  await alignmentPage.ev("window.__REVIEW_PREVIEW_FAIL__ = false; return true;");
  await clickButton(alignmentPage, "Create plan and deposit");
  await until(async () => await wldStrategy.balanceOf(previewRetryVault) === previewRetryBefore + parseUnits("0.125", 18), "retry after quote RPC recovers");
  await until(() => alignmentPage.ev("return /Your inheritance plan is ready/.test(document.body.innerText)"), "pre-send recovery plan completion");
  const preSendCalls = JSON.parse(await alignmentPage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__ || [])"));
  assert.equal(preSendCalls.length, 1, "quote retry must send exactly one deposit batch");
  evidence.plan.preSendFailure = { zeroQuoteState: "editable draft without a pending request",
    previewRpcState: "editable draft without a pending request", failedWalletCalls: 0,
    retryWalletCalls: preSendCalls.length, sharesAfterRetry: String(await wldStrategy.balanceOf(previewRetryVault)) };
  pass("zero quote and quote RPC failure leave a ready plan; retry completes without duplicate wallet calls");

  // A terminally reverted create receipt clears its old identifier and can be
  // retried; pending/no-identifier recovery remains covered below.
  await chooseTab(alignmentPage, "Plan");
  await (await usdc.mint(ACCOUNTS.a3.a, parseUnits("10", 6))).wait();
  await alignmentPage.ev("return __q.setInput('plan-wld', '')");
  await alignmentPage.ev("return __q.setInput('plan-usdc', '1')");
  await acceptYieldTerms(alignmentPage);
  const invalidCreate = new Interface(artifact("InheritanceVaultUSDCFactory").abi)
    .encodeFunctionData("createVault", [ACCOUNTS.a5.a, 0]);
  await alignmentPage.ev(`
    const fixture = await import('/src/test/minikit-stub.ts');
    window.__REVIEW_NORMAL_SEND__ = fixture.MiniKit.sendTransaction;
    window.__REVIEW_SEND_COUNT__ = 0;
    fixture.MiniKit.sendTransaction = async () => {
      window.__REVIEW_FAILED_HASH__ = '';
      window.__REVIEW_SEND_COUNT__++;
      const { Wallet, JsonRpcProvider } = await import('/node_modules/.vite/deps/ethers.js');
      const rpc = new JsonRpcProvider(window.__E2E_RPC__, 480, { staticNetwork: true, cacheTimeout: -1 });
      const wallet = new Wallet(window.__E2E_SIGNER__.privateKey, rpc);
      const tx = await wallet.sendTransaction({ to: ${JSON.stringify(usdcFactoryAddress)}, data: ${JSON.stringify(invalidCreate)}, gasLimit: 1000000n });
      window.__REVIEW_FAILED_HASH__ = tx.hash;
      return { executedWith: 'minikit', data: { status: 'success', transaction_hash: tx.hash } };
    };
    return true;
  `);
  await clickButton(alignmentPage, "Create plan and deposit");
  await until(() => alignmentPage.ev(`return window.__REVIEW_FAILED_HASH__
    && JSON.parse(sessionStorage.getItem(${JSON.stringify(alignPendingKey)}) || 'null')?.createState === 'ready'
    && /transaction reverted/i.test(document.body.innerText)`), "definitive create revert");
  const failedCreateHash = await alignmentPage.ev("return window.__REVIEW_FAILED_HASH__");
  assert.equal((await provider.getTransactionReceipt(failedCreateHash)).status, 0);
  let createFailureSaved = JSON.parse(await alignmentPage.ev(`return sessionStorage.getItem(${JSON.stringify(alignPendingKey)})`));
  assert.equal(createFailureSaved.createState, "ready");
  assert.equal(createFailureSaved.createTxHash, undefined);
  assert.deepEqual(createFailureSaved.createTargets, []);
  assert.equal(await usdcFactory.vaultOf(ACCOUNTS.a3.a), ZeroAddress, "reverted create unexpectedly registered a vault");
  await alignmentPage.ev("const fixture = await import('/src/test/minikit-stub.ts'); fixture.MiniKit.sendTransaction = window.__REVIEW_NORMAL_SEND__; return true;");
  await clickButton(alignmentPage, "Resume remaining setup");
  await until(async () => await usdcFactory.vaultOf(ACCOUNTS.a3.a) !== ZeroAddress
    && await usdcStrategy.balanceOf(await usdcFactory.vaultOf(ACCOUNTS.a3.a)) === parseUnits("1", 18), "create retry and USDC deposit");
  await until(() => alignmentPage.ev("return /Your inheritance plan is ready/.test(document.body.innerText)"), "create recovery plan completion");
  evidence.plan.createFailure = { receiptStatus: 0, stateAfterFailure: createFailureSaved.createState,
    staleIdentifier: createFailureSaved.createTxHash ?? null, retriedVault: await usdcFactory.vaultOf(ACCOUNTS.a3.a) };
  pass("status-zero vault creation returns to ready and resume creates and funds the vault");

  // Restore a genuine pre-batch version's partial plan: its WLD deposit is
  // already canonical. A reverted remaining USDC request must not repeat it.
  const terminalWldVault = await wldFactory.vaultOf(ACCOUNTS.a3.a);
  const terminalUsdcVault = await usdcFactory.vaultOf(ACCOUNTS.a3.a);
  const terminalWldBefore = await wldStrategy.balanceOf(terminalWldVault);
  const terminalUsdcBefore = await usdcStrategy.balanceOf(terminalUsdcVault);
  await sendAtomicFixtureBatch(alignmentPage, [
    { to: wldAddress, data: wld.interface.encodeFunctionData("approve", [wldFactoryAddress, parseUnits("0.1", 18)]), value: "0x0" },
    { to: wldFactoryAddress, data: wldFactory.interface.encodeFunctionData("depositWithMinShares", [parseUnits("0.1", 18), 1]), value: "0x0" },
  ]);
  const historicalPartialPlan = {
    version: 1, account: ACCOUNTS.a3.a, heir: ACCOUNTS.a5.a, periodDays: 30,
    createdAt: Date.now(), createState: "complete", createTargets: [], assets: [
      { symbol: "WLD", factory: wldFactoryAddress, asset: wldAddress, decimals: 18, mode: "morpho",
        amount: parseUnits("0.1", 18).toString(), vault: terminalWldVault, depositState: "complete" },
      { symbol: "USDC", factory: usdcFactoryAddress, asset: await usdc.getAddress(), decimals: 6, mode: "morpho",
        amount: parseUnits("0.25", 6).toString(), vault: terminalUsdcVault, depositState: "ready" },
    ],
  };
  await restorePlan(alignmentPage, historicalPartialPlan);
  await alignmentPage.ev(`
    window.__E2E_BRIDGE_CALLS__ = [];
    const fixture = await import('/src/test/minikit-stub.ts');
    window.__REVIEW_NORMAL_SEND__ = fixture.MiniKit.sendTransaction;
    window.__REVIEW_SEND_COUNT__ = 0;
    window.__REVIEW_SEND_TARGETS__ = [];
    window.__REVIEW_FAILED_HASH__ = '';
    const invalidDeposit = ${JSON.stringify(new Interface(artifact("InheritanceVaultUSDCFactory").abi)
      .encodeFunctionData("depositWithMinShares", [0, 1]))};
    fixture.MiniKit.sendTransaction = async request => {
      const targets = request.transactions.map(tx => tx.to.toLowerCase());
      if (targets.includes(${JSON.stringify(usdcFactoryAddress.toLowerCase())})) {
        window.__REVIEW_SEND_COUNT__++;
        window.__REVIEW_SEND_TARGETS__.push(targets);
        const { Wallet, JsonRpcProvider } = await import('/node_modules/.vite/deps/ethers.js');
        const rpc = new JsonRpcProvider(window.__E2E_RPC__, 480, { staticNetwork: true, cacheTimeout: -1 });
        const wallet = new Wallet(window.__E2E_SIGNER__.privateKey, rpc);
        const tx = await wallet.sendTransaction({ to: ${JSON.stringify(usdcFactoryAddress)}, data: invalidDeposit, gasLimit: 1000000n });
        window.__REVIEW_FAILED_HASH__ = tx.hash;
        return { executedWith: 'minikit', data: { status: 'success', transaction_hash: tx.hash } };
      }
      return window.__REVIEW_NORMAL_SEND__(request);
    };
    return true;
  `);
  await clickButton(alignmentPage, "Resume remaining setup");
  await until(() => alignmentPage.ev(`const saved = JSON.parse(sessionStorage.getItem(${JSON.stringify(alignPendingKey)}) || 'null');
    return window.__REVIEW_FAILED_HASH__ && saved?.assets?.[0]?.depositState === 'complete'
      && saved?.assets?.[1]?.depositState === 'ready' && /transaction reverted/i.test(document.body.innerText);`), "definitive USDC deposit revert");
  const failedDepositHash = await alignmentPage.ev("return window.__REVIEW_FAILED_HASH__");
  assert.equal((await provider.getTransactionReceipt(failedDepositHash)).status, 0);
  const depositFailureSaved = JSON.parse(await alignmentPage.ev(`return sessionStorage.getItem(${JSON.stringify(alignPendingKey)})`));
  assert.deepEqual(depositFailureSaved.assets.map(item => [item.symbol, item.depositState]), [["WLD", "complete"], ["USDC", "ready"]]);
  assert.equal(depositFailureSaved.assets[1].txHash, undefined);
  assert.equal(await wldStrategy.balanceOf(terminalWldVault), terminalWldBefore + parseUnits("0.1", 18));
  await alignmentPage.ev("const fixture = await import('/src/test/minikit-stub.ts'); fixture.MiniKit.sendTransaction = window.__REVIEW_NORMAL_SEND__; window.__E2E_BRIDGE_CALLS__ = []; return true;");
  await clickButton(alignmentPage, "Resume remaining setup");
  await until(async () => await usdcStrategy.balanceOf(terminalUsdcVault) === terminalUsdcBefore + parseUnits("0.25", 18), "USDC-only retry after terminal revert");
  await until(() => alignmentPage.ev("return /Your inheritance plan is ready/.test(document.body.innerText)"), "deposit recovery plan completion");
  const depositRetryCalls = JSON.parse(await alignmentPage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__ || [])"));
  assert.equal(depositRetryCalls.length, 1);
  assert.deepEqual(depositRetryCalls[0].targets, [(await usdc.getAddress()).toLowerCase(), usdcFactoryAddress.toLowerCase()]);
  assert.equal(await wldStrategy.balanceOf(terminalWldVault), terminalWldBefore + parseUnits("0.1", 18), "completed WLD deposit was repeated");
  evidence.plan.depositFailure = { receiptStatus: 0, failedProgress: depositFailureSaved.assets.map(item => [item.symbol, item.depositState]),
    retryTargets: depositRetryCalls[0].targets, wldSharesAfterRetry: String(await wldStrategy.balanceOf(terminalWldVault)) };
  pass("status-zero USDC deposit returns to ready; resume preserves completed WLD and sends only USDC");

  const recoveryOwner = ACCOUNTS.a3.a;
  const recoveryVaultAddress = await wldFactory.vaultOf(recoveryOwner);
  const recoveryPlanBase = {
    version: 1, account: recoveryOwner, heir: ACCOUNTS.a5.a, periodDays: 30, createdAt: Date.now(),
    createState: "complete", createTargets: [],
  };
  const depositWithLocalWallet = async amount => {
    const beforeBlock = await provider.getBlockNumber();
    const preview = await wldStrategy.previewDeposit(amount);
    const minShares = preview * 9950n / 10000n;
    const receipt = await sendAtomicFixtureBatch(alignmentPage, [
      { to: wldAddress, data: wld.interface.encodeFunctionData("approve", [wldFactoryAddress, amount]), value: "0x0" },
      { to: wldFactoryAddress, data: wldFactory.interface.encodeFunctionData("depositWithMinShares", [amount, minShares]), value: "0x0" },
    ]);
    const canonicalReceipt = await provider.getTransactionReceipt(receipt.data.transaction_hash);
    assert.equal(canonicalReceipt?.status, 1, "local EIP-7702 deposit receipt was not canonical success");
    return { beforeBlock, receipt: canonicalReceipt };
  };

  // A saved successful receipt remains proof after the owner later withdraws all shares.
  const submittedAmount = parseUnits("0.1", 18);
  const beforeSubmittedShares = await wldStrategy.balanceOf(recoveryVaultAddress);
  const submittedDeposit = await depositWithLocalWallet(submittedAmount);
  const afterSubmittedShares = await wldStrategy.balanceOf(recoveryVaultAddress);
  assert.ok(afterSubmittedShares > beforeSubmittedShares, "fixture deposit did not increase strategy shares");
  const withdrawAllShares = wldFactory.interface.encodeFunctionData("withdrawSharesFromMyVault", [recoveryOwner, afterSubmittedShares]);
  await sendAtomicFixtureBatch(alignmentPage, [{ to: wldFactoryAddress, data: withdrawAllShares, value: "0x0" }]);
  assert.equal(await wldStrategy.balanceOf(recoveryVaultAddress), 0n, "later owner withdrawal did not empty current shares");
  const submittedReceiptPlan = { ...recoveryPlanBase, assets: [{
    symbol: "WLD", factory: wldFactoryAddress, asset: wldAddress, decimals: 18, mode: "morpho",
    amount: submittedAmount.toString(), vault: recoveryVaultAddress, depositState: "submitted",
    beforeBalance: beforeSubmittedShares.toString(), beforeBlock: submittedDeposit.beforeBlock,
    txHash: submittedDeposit.receipt.hash, hashType: "transaction",
  }] };
  await alignmentPage.ev(`sessionStorage.setItem(${JSON.stringify(alignPendingKey)}, ${JSON.stringify(JSON.stringify(submittedReceiptPlan))}); return true;`);
  await alignmentPage.send("Page.reload", { ignoreCache: true });
  await until(async () => { await alignmentPage.ev(HELPERS); return alignmentPage.ev("return __q.tabs().length > 0"); }, "restored session helpers");
  await until(() => alignmentPage.ev("return __q.tabs().length > 0"), "session restored for saved deposit receipt");
  await chooseTab(alignmentPage, "Plan");
  await installBridgeRecorder(alignmentPage);
  await acceptYieldTerms(alignmentPage);
  await clickButton(alignmentPage, "Resume remaining setup");
  await until(() => alignmentPage.ev("return /Your inheritance plan is ready/.test(document.body.innerText)"), "saved receipt completes after withdrawal");
  assert.equal(JSON.parse(await alignmentPage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__ || [])")).length, 0,
    "saved submitted receipt triggered another wallet request");
  assert.equal(await wldStrategy.balanceOf(recoveryVaultAddress), 0n, "saved receipt recovery changed current shares");
  evidence.plan.submittedReceiptAfterWithdrawal = { receipt: submittedDeposit.receipt.hash,
    receiptStatus: submittedDeposit.receipt.status, sharesBefore: String(beforeSubmittedShares),
    sharesAfterOwnerWithdrawal: "0", walletRequestsOnResume: 0 };
  pass("saved canonical deposit receipt completes after later owner withdrawal without another send");

  // The crash-window scan must find a real personal deposit event older than the
  // discovery window; no-ID recovery cannot guess or resubmit if that scan misses.
  const noIdAmount = parseUnits("0.05", 18);
  const noIdDeposit = await depositWithLocalWallet(noIdAmount);
  await provider.send("anvil_mine", ["0x709"]);
  const noIdHead = await provider.getBlockNumber();
  assert.ok(noIdHead - noIdDeposit.receipt.blockNumber > 1800, "fixture receipt is not older than the discovery window");
  const noIdPlan = { ...recoveryPlanBase, assets: [{
    symbol: "WLD", factory: wldFactoryAddress, asset: wldAddress, decimals: 18, mode: "morpho",
    amount: noIdAmount.toString(), vault: recoveryVaultAddress, depositState: "submitting",
    beforeBlock: noIdDeposit.beforeBlock,
  }] };
  await alignmentPage.ev(`sessionStorage.setItem(${JSON.stringify(alignPendingKey)}, ${JSON.stringify(JSON.stringify(noIdPlan))}); return true;`);
  await alignmentPage.send("Page.reload", { ignoreCache: true });
  await until(async () => { await alignmentPage.ev(HELPERS); return alignmentPage.ev("return __q.tabs().length > 0"); }, "restored session helpers");
  await until(() => alignmentPage.ev("return __q.tabs().length > 0"), "session restored for old no-ID deposit");
  await chooseTab(alignmentPage, "Plan");
  await installBridgeRecorder(alignmentPage);
  await acceptYieldTerms(alignmentPage);
  await clickButton(alignmentPage, "Resume remaining setup");
  await until(() => alignmentPage.ev("return /Your inheritance plan is ready/.test(document.body.innerText)"), "old no-ID deposit recovery");
  assert.equal(JSON.parse(await alignmentPage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__ || [])")).length, 0,
    "old no-ID receipt recovery repeated a wallet request");
  assert.ok(await wldStrategy.balanceOf(recoveryVaultAddress) > 0n, "old no-ID deposit was not retained in the vault");
  evidence.plan.oldNoIdRecovery = { receipt: noIdDeposit.receipt.hash, receiptStatus: noIdDeposit.receipt.status,
    beforeBlock: noIdDeposit.beforeBlock, receiptBlock: noIdDeposit.receipt.blockNumber, currentHead: noIdHead,
    distanceFromHead: noIdHead - noIdDeposit.receipt.blockNumber, walletRequestsOnResume: 0 };
  pass("no-ID deposit older than 1,800 blocks is found from its saved start block without resending");

  // Existing basic-vault bytecode has no incomePosition API. The app must show that
  // limitation instead of describing an untracked balance as protected net income.
  const legacySigner = await provider.getSigner(6);
  const legacyFactoryWrite = new Contract(await plainFactory.getAddress(), artifact("InheritanceVaultWLDFactoryOnePerOwner").abi, legacySigner);
  await (await legacyFactoryWrite.createVault(ACCOUNTS.a7.a, 30 * 86400)).wait();
  const legacyVaultAddress = await plainFactory.vaultOf(ACCOUNTS.a6.a);
  assert.notEqual(legacyVaultAddress, ZeroAddress);
  assert.equal(artifact("InheritanceVaultWLD").abi.some(item => item.name === "incomePosition"), false);
  await legacyPage?.close();
  legacyPage = await launch({ pk: ACCOUNTS.a6.pk, url: appUrl, preload });
  await signIn(legacyPage);
  await chooseTab(legacyPage, "Assets");
  await until(() => legacyPage.ev("return document.querySelector('.income-card')?.innerText.includes('Separate income collection is not available')"), "legacy income API unavailable label");
  const legacyIncomeText = await legacyPage.ev("return document.querySelector('.income-card')?.innerText || ''");
  assert.doesNotMatch(legacyIncomeText, /Available after fee|Income before fee|Net income/i);
  assert.equal(await legacyPage.ev("return document.getElementById('withdraw-to') !== null"), true, "legacy principal withdrawal is no longer accessible");
  evidence.legacyIncome = { vault: legacyVaultAddress, apiPresentInArtifact: false, displayedText: legacyIncomeText, principalControlAccessible: true };
  pass("legacy vault without the income API is not labeled as protected income; principal controls stay available");

  const factoryAs = async (source, index) => new Contract(await source.getAddress(), source.interface, await provider.getSigner(index));
  const newRegressionPage = async (index, label) => {
    const targetPage = await launch({ pk: ACCOUNTS[`a${index}`].pk, url: appUrl, preload });
    regressionPages.push([label, targetPage]);
    await signIn(targetPage);
    return targetPage;
  };
  const preparePlanForm = async (targetPage, heirAddress, days, symbol, amount) => {
    await chooseTab(targetPage, "Plan");
    await until(() => targetPage.ev("if(document.getElementById('plan-wld'))return true;const b=[...document.querySelectorAll('button')].find(b=>b.offsetParent!==null&&!b.disabled&&b.textContent.trim()==='Create my own plan');b?.click();return false;"), "classified account with an explicit owner setup form");
    await installBridgeRecorder(targetPage);
    await targetPage.ev(`return __q.setInput('heir-input', ${JSON.stringify(heirAddress)})`);
    await targetPage.ev(`return __q.setInput('period-input', ${JSON.stringify(String(days))})`);
    const entered = await targetPage.ev(`return __q.setInput('plan-${symbol.toLowerCase()}', ${JSON.stringify(amount)})`);
    assert.match(entered, /^set /, 'plan amount field must be present');
    await until(() => targetPage.ev(`return document.getElementById('plan-${symbol.toLowerCase()}')?.value === ${JSON.stringify(amount)}`), 'entered plan amount is retained');
  };
  async function restorePlan(targetPage, saved) {
    const key = `inheritance:pending-plan:${saved.account.toLowerCase()}`;
    await targetPage.ev(`sessionStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(saved))}); return true;`);
    await targetPage.send("Page.reload", { ignoreCache: true });
    await until(async () => {
      await targetPage.ev(HELPERS);
      return targetPage.ev("return __q.tabs().length > 0");
    }, "regression session restored");
    await chooseTab(targetPage, "Plan");
    await installBridgeRecorder(targetPage);
    await acceptYieldTerms(targetPage);
    return key;
  }

  // Editing a definitely unsent second asset removes the completed first asset
  // from the new journal. Its monitoring must already have been committed.
  await (await wld.mint(ACCOUNTS.a2.a, parseUnits("1", 18))).wait();
  await (await usdc.mint(ACCOUNTS.a2.a, parseUnits("1", 6))).wait();
  const monitoredPage = await newRegressionPage(2, "partial-monitoring-edit");
  const monitoredSigner=await provider.getSigner(2);
  await (await new Contract(wldFactoryAddress,wldFactory.interface,monitoredSigner).createVault(ACCOUNTS.a5.a,30*86400)).wait();
  await (await new Contract(usdcFactoryAddress,usdcFactory.interface,monitoredSigner).createVault(ACCOUNTS.a5.a,30*86400)).wait();
  await (await wld.connect(monitoredSigner).approve(wldFactoryAddress,parseUnits('0.1',18))).wait();
  await (await new Contract(wldFactoryAddress,wldFactory.interface,monitoredSigner).depositWithMinShares(parseUnits('0.1',18),1)).wait();
  const monitoredKey = `inheritance:pending-plan:${ACCOUNTS.a2.a.toLowerCase()}`;
  const monitoredHistoricalPlan={version:1,account:ACCOUNTS.a2.a,heir:ACCOUNTS.a5.a,periodDays:30,createdAt:Date.now(),createState:'complete',createTargets:[],assets:[
    {symbol:'WLD',factory:wldFactoryAddress,asset:wldAddress,decimals:18,mode:'morpho',amount:parseUnits('0.1',18).toString(),vault:await wldFactory.vaultOf(ACCOUNTS.a2.a),depositState:'complete'},
    {symbol:'USDC',factory:usdcFactoryAddress,asset:await usdc.getAddress(),decimals:6,mode:'morpho',amount:parseUnits('0.1',6).toString(),vault:await usdcFactory.vaultOf(ACCOUNTS.a2.a),depositState:'ready'},
  ]};
  await restorePlan(monitoredPage,monitoredHistoricalPlan);
  await monitoredPage.ev(`window.__E2E_REJECTED_TARGET__=${JSON.stringify((await usdc.getAddress()).toLowerCase())};window.__E2E_REJECT_ERROR_CODE__='simulation_failed';return true;`);
  await clickButton(monitoredPage,'Resume remaining setup');
  await until(() => monitoredPage.ev(`const plan = JSON.parse(sessionStorage.getItem(${JSON.stringify(monitoredKey)}) || 'null');
    return plan?.assets?.[0]?.depositState === 'complete' && plan.assets[1].depositState === 'ready'
      && __q.btns().some(button => button.t === 'Edit remaining setup' && !button.d);`), "funded WLD and editable unsent USDC");
  const monitoredWld = await wldFactory.vaultOf(ACCOUNTS.a2.a);
  const monitoredUsdc = await usdcFactory.vaultOf(ACCOUNTS.a2.a);
  assert.equal(await wldStrategy.balanceOf(monitoredWld), parseUnits("0.1", 18));
  assert.equal(await usdcStrategy.balanceOf(monitoredUsdc), 0n);
  assert.equal(await monitoredPage.ev(`return window.__MONITOR_REGISTERED__[${JSON.stringify(monitoredWld.toLowerCase())}]`), true);
  await clickButton(monitoredPage, "Edit remaining setup");
  assert.equal(await monitoredPage.ev("return document.getElementById('plan-wld').value"), "");
  assert.equal(await monitoredPage.ev(`return sessionStorage.getItem(${JSON.stringify(monitoredKey)})`), null);
  await monitoredPage.ev("window.__E2E_REJECTED_TARGET__ = ''; window.__E2E_BRIDGE_CALLS__ = []; return true;");
  const manualDepositSnapshot = await provider.send("evm_snapshot", []);
  await chooseTab(monitoredPage, "Assets");
  await clickMatchingButton(monitoredPage, label => label === "USDC");
  await until(() => monitoredPage.ev("return !!document.getElementById('deposit-amount') && /Amount to deposit \\(USDC\\)/.test(document.body.innerText)"), "manual USDC management");
  await installBridgeRecorder(monitoredPage);
  await monitoredPage.ev("return __q.setInput('deposit-amount', '0.1')");
  await clickButton(monitoredPage, "Deposit");
  await until(() => monitoredPage.ev(`return /Deposit complete/.test(document.body.innerText)
    && window.__MONITOR_REGISTERED__[${JSON.stringify(monitoredUsdc.toLowerCase())}]
    && document.getElementById('deposit-amount')?.value === ''`), "manual deposit is monitored");
  assert.equal(await monitoredPage.ev("return __q.btns().some(button => button.t === 'Deposit' && button.d)"), true,
    "an empty amount cannot submit a second deposit");
  assert.equal(await usdcStrategy.balanceOf(monitoredUsdc), parseUnits("0.1", 18));
  assert.equal(JSON.parse(await monitoredPage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__)" )).length, 1);
  const manualRegistrations = JSON.parse(await monitoredPage.ev("return JSON.stringify(window.__MONITOR_REGISTRATIONS__)"));
  assert.equal(manualRegistrations.filter(item => item.vaultAddress.toLowerCase() === monitoredUsdc.toLowerCase()).length, 1);
  assert.equal(await monitoredPage.ev(`return sessionStorage.getItem(${JSON.stringify(monitoredKey)})`), null);
  evidence.plan.manualDepositMonitoring = { vault: monitoredUsdc, walletRequests: 1,
    registrations: manualRegistrations.filter(item => item.vaultAddress.toLowerCase() === monitoredUsdc.toLowerCase()) };
  pass("Send registers a new vault after a cancelled unified deposit is completed through ordinary deposit");
  assert.equal(await provider.send("evm_revert", [manualDepositSnapshot]), true);
  await chooseTab(monitoredPage, "Plan");
  await until(() => monitoredPage.ev("return !!document.getElementById('plan-usdc')"), "remaining setup restored after isolated manual scenario");
  await monitoredPage.ev("window.__E2E_BRIDGE_CALLS__ = []; return true;");
  await acceptYieldTerms(monitoredPage);
  await clickButton(monitoredPage, "Create plan and deposit");
  await until(() => monitoredPage.ev(`return /Your inheritance plan is ready/.test(document.body.innerText)
    && Object.keys(window.__MONITOR_REGISTERED__).length === 2`), "remaining USDC monitoring after edit");
  const monitoredCalls = JSON.parse(await monitoredPage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__)"));
  assert.equal(monitoredCalls.length, 1);
  assert.deepEqual(monitoredCalls[0].targets, [(await usdc.getAddress()).toLowerCase(), usdcFactoryAddress.toLowerCase()]);
  assert.equal(await wldStrategy.balanceOf(monitoredWld), parseUnits("0.1", 18));
  assert.equal(await usdcStrategy.balanceOf(monitoredUsdc), parseUnits("0.1", 18));
  evidence.plan.monitoringAfterEdit = { wld: monitoredWld, usdc: monitoredUsdc,
    registrations: JSON.parse(await monitoredPage.ev("return JSON.stringify(window.__MONITOR_REGISTRATIONS__)")), remainingRequests: 1 };
  pass("editing the unsent USDC amount preserves WLD monitoring and completes only the remaining USDC deposit");
  await preparePlanForm(monitoredPage, ACCOUNTS.a5.a, 30, "WLD", "0.001");
  await monitoredPage.ev("window.__MONITOR_UNRESPONSIVE__ = true; return true;");
  await clickButton(monitoredPage, "Create plan and deposit");
  await until(() => monitoredPage.ev("return /Some reminders could not be enabled/.test(document.body.innerText)"), "unresponsive monitoring request finishes without repeating funds");
  assert.equal(await monitoredPage.ev(`return sessionStorage.getItem(${JSON.stringify(monitoredKey)})`), null);
  assert.equal(await wldStrategy.balanceOf(monitoredWld), parseUnits("0.101", 18));
  assert.equal(JSON.parse(await monitoredPage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__)" )).length, 1);
  assert.equal(await monitoredPage.ev("return __q.btns().some(button => button.t === 'Resume remaining setup')"), false);
  await monitoredPage.ev("window.__MONITOR_UNRESPONSIVE__ = false; return true;");
  pass("unresponsive monitoring times out while the confirmed deposit stays complete and sends no duplicate funds");

  // A shorter interval must not expose existing, unselected funds to an
  // immediate claim. Isolate the 20-day chain-time advance from later scenarios.
  const alignmentSnapshot = await provider.send("evm_snapshot", []);
  await provider.send("evm_increaseTime", [20 * 86400]);
  await provider.send("evm_mine", []);
  const agedWld = new Contract(monitoredWld, artifact("InheritanceVaultMorpho").abi, provider);
  const agedWldPing = await agedWld.lastPing();
  const agedWldShares = await wldStrategy.balanceOf(monitoredWld);
  const agedBlock = await provider.getBlock("latest");
  assert.ok(agedWldPing + 86400n <= BigInt(agedBlock.timestamp), "the shortened interval must already be expired without a check-in");
  assert.equal(await agedWld.isExpired(), false, "the original funded WLD must still be active");
  await preparePlanForm(monitoredPage, ACCOUNTS.a5.a, 1, "USDC", "0.01");
  await clickButton(monitoredPage, "Create plan and deposit");
  await until(() => monitoredPage.ev("return !!document.querySelector('.plan-alignment-review')"), "shorter interval review");
  assert.match(await monitoredPage.ev("return document.querySelector('.plan-alignment-review').innerText"), /Changing an interval also checks in.*starts its new timer/);
  assert.equal(await agedWld.heartbeatInterval(), 30n * 86400n, "review must not change the old period");
  assert.equal(await agedWld.lastPing(), agedWldPing, "review must not check in before consent");
  await clickButton(monitoredPage, "Confirm and align settings");
  await until(() => monitoredPage.ev("return /Your inheritance plan is ready/.test(document.body.innerText)"), "shorter period with atomic check-in");
  const shortenedCalls = JSON.parse(await monitoredPage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__)"));
  assert.equal(shortenedCalls.length, 2, "only reviewed alignment and the selected USDC deposit are needed");
  const alignedReceipt = await provider.getTransactionReceipt(shortenedCalls[0].hash);
  const alignedEvents = alignedReceipt.logs.filter(log => log.address.toLowerCase() === monitoredWld.toLowerCase())
    .flatMap(log => { try { return [agedWld.interface.parseLog(log)]; } catch { return []; } });
  assert.ok(alignedEvents.some(event => event?.name === "Ping"), "alignment receipt must prove the WLD check-in");
  assert.ok(alignedEvents.some(event => event?.name === "HeartbeatUpdated" && event.args.newInterval === 86400n));
  assert.ok(await agedWld.lastPing() > agedWldPing);
  assert.equal(await agedWld.heartbeatInterval(), 86400n);
  assert.equal(await agedWld.isExpired(), false, "funded unselected WLD must not expire during setup");
  assert.equal(await wldStrategy.balanceOf(monitoredWld), agedWldShares, "aligning must not move or repeat WLD funds");
  assert.equal(await usdcStrategy.balanceOf(monitoredUsdc), parseUnits("0.11", 18));
  evidence.settingsAlignment.shortenedInterval = { existingLastPing: String(agedWldPing), currentLastPing: String(await agedWld.lastPing()),
    periodSeconds: String(await agedWld.heartbeatInterval()), existingWldExpired: false, unchangedWldShares: String(agedWldShares),
    receipt: alignedReceipt.hash, consentBeforeAnyChange: true };
  pass("shortening a 20-day-old funded WLD plan from 30 days to 1 day requires disclosed consent and an atomic check-in before the USDC deposit");
  const checkInBeforeBlock = await provider.getBlockNumber();
  const periodOnlyReceipt = await (await (await factoryAs(wldFactory, 2)).changeMyPeriod(30 * 86400)).wait();
  const missingCheckInPlan = { version: 1, account: ACCOUNTS.a2.a, heir: ACCOUNTS.a5.a, periodDays: 30,
    createdAt: Date.now(), createState: "complete", createTargets: [], assets: [{
      symbol: "USDC", factory: usdcFactoryAddress, asset: await usdc.getAddress(), decimals: 6, mode: "morpho",
      amount: parseUnits("0.001", 6).toString(), vault: monitoredUsdc, depositState: "ready",
    }], alignment: { state: "submitted", beforeBlock: checkInBeforeBlock, txHash: periodOnlyReceipt.hash,
      hashType: "transaction", targets: [{ factory: wldFactoryAddress, vault: monitoredWld,
        heir: ACCOUNTS.a5.a, periodSeconds: "86400", checkIn: true }] } };
  await restorePlan(monitoredPage, missingCheckInPlan);
  await clickButton(monitoredPage, "Resume remaining setup");
  await until(() => monitoredPage.ev("return /expected on-chain record could not be verified/.test(document.body.innerText)"), "period-only receipt cannot prove a requested check-in");
  assert.deepEqual(JSON.parse(await monitoredPage.ev(`return sessionStorage.getItem(${JSON.stringify(monitoredKey)})`)), missingCheckInPlan);
  assert.equal(JSON.parse(await monitoredPage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__)" )).length, 0);
  assert.equal(await monitoredPage.ev("return __q.btns().some(button => button.t === 'Edit remaining setup')"), false);
  assert.equal(await usdcStrategy.balanceOf(monitoredUsdc), parseUnits("0.11", 18));
  evidence.settingsAlignment.missingCheckIn = { receipt: periodOnlyReceipt.hash, journalPreserved: true, newWalletRequests: 0 };
  pass("a period-only receipt cannot resolve a journaled interval change that also requires a check-in");
  await monitoredPage.ev(`sessionStorage.removeItem(${JSON.stringify(monitoredKey)}); return true;`);
  assert.equal(await provider.send("evm_revert", [alignmentSnapshot]), true);
  await monitoredPage.send("Page.reload", { ignoreCache: true });
  await until(async () => { await monitoredPage.ev(HELPERS); return monitoredPage.ev("return __q.tabs().length > 0"); }, "restored original chain-time scenario");

  // The combined plan must review a funded basic vault as well as yield routes.
  await (await wld.mint(ACCOUNTS.a6.a, parseUnits("1", 18))).wait();
  await (await wld.transfer(legacyVaultAddress, parseUnits("0.2", 18))).wait();
  await (await usdc.mint(ACCOUNTS.a6.a, parseUnits("1", 6))).wait();
  await legacyPage.send("Page.reload", { ignoreCache: true });
  await until(async () => { await legacyPage.ev(HELPERS); return legacyPage.ev("return __q.tabs().length > 0"); }, "restored session helpers");
  await until(() => legacyPage.ev("return __q.tabs().length > 0"), "funded basic-vault session restored");
  await preparePlanForm(legacyPage, ACCOUNTS.a5.a, 30, "USDC", "0.1");
  await clickButton(legacyPage, "Create plan and deposit");
  await until(() => legacyPage.ev("return !!document.querySelector('.plan-alignment-review')"), "basic-vault settings review");
  const basicVault = new Contract(legacyVaultAddress, artifact("InheritanceVaultWLD").abi, provider);
  assert.equal((await basicVault.heir()).toLowerCase(), ACCOUNTS.a7.a.toLowerCase());
  assert.equal(JSON.parse(await legacyPage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__)")).length, 0);
  assert.match(await legacyPage.ev("return document.querySelector('.plan-alignment-review').innerText"), /WLD/);
  await clickButton(legacyPage, "Confirm and align settings");
  await until(() => legacyPage.ev("return /Your inheritance plan is ready/.test(document.body.innerText)"), "basic WLD aligned before USDC addition");
  assert.equal((await basicVault.heir()).toLowerCase(), ACCOUNTS.a5.a.toLowerCase());
  assert.equal(await basicVault.heartbeatInterval(), 30n * 86400n);
  assert.equal(await wld.balanceOf(legacyVaultAddress), parseUnits("0.2", 18));
  assert.equal(await wldFactory.vaultOf(ACCOUNTS.a6.a), ZeroAddress, "an unselected Morpho WLD vault was created");
  evidence.settingsAlignment.basicVault = { address: legacyVaultAddress, heir: await basicVault.heir(),
    balancePreserved: String(await wld.balanceOf(legacyVaultAddress)), unselectedYieldCreated: false };
  pass("adding USDC reviews and aligns funded basic WLD without moving its funds or creating an unselected vault");

  // Preserve exact contract seconds through both a combined check-in and review.
  await (await alignFactory.changeMyPeriod(30n * 86400n + 1n)).wait();
  await alignmentPage.send("Page.reload", { ignoreCache: true });
  await until(async () => { await alignmentPage.ev(HELPERS); return alignmentPage.ev("return __q.tabs().length > 0"); }, "restored session helpers");
  await until(() => alignmentPage.ev("return __q.tabs().length > 0"), "fractional-period session restored");
  await chooseTab(alignmentPage, "Home");
  await installBridgeRecorder(alignmentPage);
  const fractionalVault = new Contract(recoveryVaultAddress, artifact("InheritanceVaultMorpho").abi, provider);
  const fractionalBeforePing = await fractionalVault.lastPing();
  await clickButton(alignmentPage, "Check in");
  await until(() => alignmentPage.ev("return /Checked in to all 2 active vaults/.test(document.body.innerText)"), "fractional interval check-in verified");
  assert.ok(await fractionalVault.lastPing() > fractionalBeforePing);
  assert.equal(await fractionalVault.heartbeatInterval(), 30n * 86400n + 1n);
  const fractionalCalls = JSON.parse(await alignmentPage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__)"));
  assert.equal(fractionalCalls.length, 1);
  assert.equal(fractionalCalls[0].targets.length, 2);
  evidence.checkIn.exactSeconds = { periodSeconds: String(await fractionalVault.heartbeatInterval()),
    receipt: fractionalCalls[0].hash, verified: true };
  pass("combined check-in confirms a valid 30-day-plus-one-second interval without a false timeout");
  await preparePlanForm(alignmentPage, ACCOUNTS.a5.a, 30, "WLD", "0.01");
  await clickButton(alignmentPage, "Create plan and deposit");
  await until(() => alignmentPage.ev("return !!document.querySelector('.plan-alignment-review')"), "exact-seconds conflict review");
  assert.match(await alignmentPage.ev("return document.querySelector('.plan-alignment-review').innerText"), /30 days \+ 1 second/);
  await clickButton(alignmentPage, "Confirm and align settings");
  await until(() => alignmentPage.ev("return /Your inheritance plan is ready/.test(document.body.innerText)"), "exact-seconds alignment and deposit complete");
  assert.equal(await fractionalVault.heartbeatInterval(), 30n * 86400n);
  evidence.settingsAlignment.exactSeconds = { before: "2592001", after: String(await fractionalVault.heartbeatInterval()) };
  pass("alignment displays the extra second and sends the precise interval change before depositing");

  // A completed WLD deposit can later be withdrawn and released by its owner.
  // Resuming USDC must not recreate an empty WLD contract or require that slot.
  const releasedOwner = ACCOUNTS.a7.a;
  const releasedWldFactory = await factoryAs(wldFactory, 7);
  const releasedUsdcFactory = await factoryAs(usdcFactory, 7);
  const releasedSigner = await provider.getSigner(7);
  await (await wld.mint(releasedOwner, parseUnits("1", 18))).wait();
  await (await usdc.mint(releasedOwner, parseUnits("1", 6))).wait();
  await (await releasedWldFactory.createVault(ACCOUNTS.a5.a, 86400)).wait();
  await (await releasedUsdcFactory.createVault(ACCOUNTS.a5.a, 86400)).wait();
  const releasedWldVault = await wldFactory.vaultOf(releasedOwner);
  const remainingUsdcVault = await usdcFactory.vaultOf(releasedOwner);
  await (await wld.connect(releasedSigner).approve(wldFactoryAddress, parseUnits("0.1", 18))).wait();
  await (await releasedWldFactory.depositWithMinShares(parseUnits("0.1", 18), 1)).wait();
  await (await releasedWldFactory.withdrawSharesFromMyVault(releasedOwner, await wldStrategy.balanceOf(releasedWldVault))).wait();
  await (await releasedWldFactory.cancelMyInheritance()).wait();
  await provider.send("evm_increaseTime", [86402]);
  await provider.send("evm_mine", []);
  await (await releasedWldFactory.releaseMyVault()).wait();
  await (await releasedUsdcFactory.pingMyVault()).wait();
  const releasedPage = await newRegressionPage(7, "released-completed");
  const releasedPlan = { version: 1, account: releasedOwner, heir: ACCOUNTS.a5.a, periodDays: 1,
    createdAt: Date.now(), createState: "complete", createTargets: [], assets: [
      { symbol: "WLD", factory: wldFactoryAddress, asset: wldAddress, decimals: 18, mode: "morpho",
        amount: parseUnits("0.1", 18).toString(), vault: releasedWldVault, depositState: "complete" },
      { symbol: "USDC", factory: usdcFactoryAddress, asset: await usdc.getAddress(), decimals: 6, mode: "morpho",
        amount: parseUnits("0.1", 6).toString(), vault: remainingUsdcVault, depositState: "ready" },
    ] };
  const releasedKey = await restorePlan(releasedPage, releasedPlan);
  await clickButton(releasedPage, "Resume remaining setup");
  await until(() => releasedPage.ev("return /Remaining setup is complete/.test(document.body.innerText)"), "remaining asset completes after prior release");
  assert.equal(await wldFactory.vaultOf(releasedOwner), ZeroAddress);
  assert.equal(await usdcStrategy.balanceOf(remainingUsdcVault), parseUnits("0.1", 18));
  const releasedCalls = JSON.parse(await releasedPage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__)"));
  assert.equal(releasedCalls.length, 1);
  assert.deepEqual(releasedCalls[0].targets, [(await usdc.getAddress()).toLowerCase(), usdcFactoryAddress.toLowerCase()]);
  assert.equal(await releasedPage.ev(`return sessionStorage.getItem(${JSON.stringify(releasedKey)})`), null);
  evidence.plan.completedReleased = { original: releasedWldVault, replacement: ZeroAddress,
    remainingDeposit: "USDC", walletRequests: releasedCalls.length };
  pass("a released completed WLD step is preserved as history; resume deposits only USDC and creates no replacement WLD vault");

  // A published receipt remains valid after its original slot is replaced. The
  // original target must also be used when an ID-less request is recovered.
  const submittedOwner = ACCOUNTS.a9.a;
  const submittedFactory = await factoryAs(wldFactory, 9);
  const submittedSigner = await provider.getSigner(9);
  await (await wld.mint(submittedOwner, parseUnits("1", 18))).wait();
  await (await submittedFactory.createVault(ACCOUNTS.a5.a, 86400)).wait();
  const originalSubmittedVault = await wldFactory.vaultOf(submittedOwner);
  await (await wld.connect(submittedSigner).approve(wldFactoryAddress, parseUnits("0.1", 18))).wait();
  const originalBeforeBlock = await provider.getBlockNumber();
  const originalReceipt = await (await submittedFactory.depositWithMinShares(parseUnits("0.1", 18), 1)).wait();
  await (await submittedFactory.withdrawSharesFromMyVault(submittedOwner, await wldStrategy.balanceOf(originalSubmittedVault))).wait();
  await (await submittedFactory.cancelMyInheritance()).wait();
  await provider.send("evm_increaseTime", [86402]);
  await provider.send("evm_mine", []);
  await (await submittedFactory.releaseMyVault()).wait();
  await (await submittedFactory.createVault(ACCOUNTS.a5.a, 86400)).wait();
  const replacementSubmittedVault = await wldFactory.vaultOf(submittedOwner);
  const submittedPage = await newRegressionPage(9, "submitted-replaced");
  for (const state of ["submitted", "submitting"]) {
    const saved = { version: 1, account: submittedOwner, heir: ACCOUNTS.a5.a, periodDays: 1,
      createdAt: Date.now(), createState: "complete", createTargets: [], assets: [{
        symbol: "WLD", factory: wldFactoryAddress, asset: wldAddress, decimals: 18, mode: "morpho",
        amount: parseUnits("0.1", 18).toString(), vault: originalSubmittedVault, depositState: state,
        beforeBlock: originalBeforeBlock,
        ...(state === "submitted" ? { txHash: originalReceipt.hash, hashType: "transaction" } : {}),
      }] };
    const key = await restorePlan(submittedPage, saved);
    assert.equal(await submittedPage.ev("return __q.btns().some(button => button.t === 'Edit remaining setup')"), false);
    await submittedPage.ev(`
      window.__PLAN_WRITES__ = []; window.__PLAN_ORIGINAL_SET__ = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === ${JSON.stringify(key)}) window.__PLAN_WRITES__.push(JSON.parse(value));
        return window.__PLAN_ORIGINAL_SET__.call(this, key, value);
      }; return true;
    `);
    await clickButton(submittedPage, "Resume remaining setup");
    await until(() => submittedPage.ev("return /Remaining setup is complete/.test(document.body.innerText)"), "original replaced-vault receipt recovered");
    const writes = JSON.parse(await submittedPage.ev("return JSON.stringify(window.__PLAN_WRITES__)"));
    assert.ok(writes.length > 0);
    assert.ok(writes.every(plan => plan.assets[0].vault.toLowerCase() === originalSubmittedVault.toLowerCase()));
    assert.equal(await submittedPage.ev(`return sessionStorage.getItem(${JSON.stringify(key)})`), null);
    assert.equal(JSON.parse(await submittedPage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__)" )).length, 0);
    assert.equal(await wldFactory.vaultOf(submittedOwner), replacementSubmittedVault);
    assert.equal(await wldStrategy.balanceOf(replacementSubmittedVault), 0n);
    pass(`${state} deposit recovery keeps the original replaced-vault address and sends no new wallet request`);
  }
  evidence.plan.replacedSubmitted = { original: originalSubmittedVault, replacement: replacementSubmittedVault,
    receipt: originalReceipt.hash, bothIdentifierStatesRecovered: true, walletRequests: 0 };

  // Over-budget drafts are editable, and a fresh balance race is caught before
  // contract creation. A proven-unsent saved draft has an in-app edit path.
  await (await wld.mint(ACCOUNTS.a4.a, parseUnits("1", 18))).wait();
  const balancePage = await newRegressionPage(4, "balance-and-edit");
  await preparePlanForm(balancePage, ACCOUNTS.a5.a, 30, "WLD", "2");
  await until(() => balancePage.ev("return /This amount is above your available balance/.test(document.body.innerText)"), "oversized draft balance message");
  assert.equal(await balancePage.ev("return document.querySelector('.plan-submit').disabled"), true);
  assert.equal(await balancePage.ev("return document.getElementById('plan-wld').matches(':disabled')"), false);
  assert.equal(await wldFactory.vaultOf(ACCOUNTS.a4.a), ZeroAddress);
  const balanceKey = `inheritance:pending-plan:${ACCOUNTS.a4.a.toLowerCase()}`;
  assert.equal(await balancePage.ev(`return sessionStorage.getItem(${JSON.stringify(balanceKey)})`), null);
  pass("an amount above wallet balance stays editable and cannot create an empty vault");
  await balancePage.ev("return __q.setInput('plan-wld', '0.9')");
  await until(() => balancePage.ev("return !document.querySelector('.plan-submit').disabled"), "affordable cached draft");
  await clickButton(balancePage, "Review plan");
  await sleep(31_000);
  assert.equal(await balancePage.ev("return !!document.querySelector('.plan-final-review') && /0.9 WLD/.test(document.querySelector('.plan-final-review').innerText)"), true);
  pass("background heir refresh preserves a fresh owner's reviewed draft");
  await (await wld.connect(await provider.getSigner(4)).transfer(ACCOUNTS.a2.a, parseUnits("0.8", 18))).wait();
  await clickButton(balancePage, "Create plan and deposit");
  await until(() => balancePage.ev("return /Not enough WLD/.test(document.body.innerText)"), "fresh insufficient-balance preflight");
  assert.equal(await wldFactory.vaultOf(ACCOUNTS.a4.a), ZeroAddress);
  assert.equal(await balancePage.ev(`return sessionStorage.getItem(${JSON.stringify(balanceKey)})`), null);
  assert.equal(JSON.parse(await balancePage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__)" )).length, 0);
  pass("a fresh wallet-balance drop stops before any create, alignment or deposit wallet request");
  const editablePlan = { version: 1, account: ACCOUNTS.a4.a, heir: ACCOUNTS.a5.a, periodDays: 30,
    createdAt: Date.now(), createState: "complete", createTargets: [], assets: [{
      symbol: "WLD", factory: wldFactoryAddress, asset: wldAddress, decimals: 18, mode: "morpho",
      amount: parseUnits("2", 18).toString(), vault: "", depositState: "ready",
    }] };
  await restorePlan(balancePage, editablePlan);
  await clickButton(balancePage, "Edit remaining setup");
  assert.equal(await balancePage.ev(`return sessionStorage.getItem(${JSON.stringify(balanceKey)})`), null);
  assert.equal(await balancePage.ev("return document.getElementById('plan-wld').matches(':disabled')"), false);
  await balancePage.ev("return __q.setInput('plan-wld', '0.1')");
  await acceptYieldTerms(balancePage);
  await clickButton(balancePage, "Create plan and deposit");
  await until(() => balancePage.ev("return /Your inheritance plan is ready/.test(document.body.innerText)"), "corrected saved draft completes");
  const editedWldVault = await wldFactory.vaultOf(ACCOUNTS.a4.a);
  assert.equal(await wldStrategy.balanceOf(editedWldVault), parseUnits("0.1", 18));
  evidence.plan.unsentEditable = { originalAmount: "2", correctedAmount: "0.1", vault: editedWldVault };
  pass("proven-unsent saved setup can be edited in the app and completes with the corrected amount");

  // WLD held by a USDC plan remains an inheritance asset in the combined view.
  await (await wld.mint(usdcVaultAddress, parseUnits("3", 18))).wait();
  await page.send("Page.reload", { ignoreCache: true });
  await until(() => page.ev("return __q.tabs().length > 0"), "held-WLD overview reload");
  await chooseTab(page, "Home");
  const expectedCombinedWld = (await wldVault.position()).gross + await wld.balanceOf(usdcVaultAddress);
  await until(() => page.ev(`return /WLD includes rewards and gifts/.test(document.querySelector('.plan-overview-card')?.innerText || '')
    && / WLD$/.test(document.querySelector('.plan-overview-asset strong')?.innerText || '')`), "WLD includes USDC-held cash");
  const displayedWld = parseUnits((await page.ev("return document.querySelector('.plan-overview-asset strong').innerText")).split(" ")[0], 18);
  assert.ok(displayedWld <= expectedCombinedWld && expectedCombinedWld - displayedWld < 10n ** 12n);
  assert.match(await page.ev("return document.querySelector('.plan-overview-card').innerText"), /WLD includes rewards and gifts/);
  evidence.plan.additionalWld = { usdcVault: usdcVaultAddress, held: String(await wld.balanceOf(usdcVaultAddress)),
    combined: String(expectedCombinedWld) };
  pass("the WLD overview includes rewards and gifts held by an active USDC plan without converting its USDC");

  // Both thrown SDK policy errors and returned policy errors are definite
  // pre-submission failures. They must not create an unresolvable request.
  await (await usdc.mint(ACCOUNTS.a5.a, parseUnits("1", 6))).wait();
  const dailyPage = await newRegressionPage(5, "daily-policy");
  await preparePlanForm(dailyPage, ACCOUNTS.a1.a, 30, "USDC", "0.1");
  const dailyKey = `inheritance:pending-plan:${ACCOUNTS.a5.a.toLowerCase()}`;
  await dailyPage.ev(`window.__E2E_REJECTED_TARGET__ = ${JSON.stringify(usdcFactoryAddress.toLowerCase())};
    window.__E2E_REJECT_ERROR_CODE__ = 'daily_tx_limit_reached'; window.__E2E_REJECT_THROWS__ = true; return true;`);
  await clickButton(dailyPage, "Create plan and deposit");
  await until(() => dailyPage.ev(`return JSON.parse(sessionStorage.getItem(${JSON.stringify(dailyKey)}) || 'null')?.createState === 'ready'
    && __q.btns().some(button => button.t === 'Edit remaining setup' && !button.d)`), "daily create policy leaves editable ready plan");
  assert.equal(await usdcFactory.vaultOf(ACCOUNTS.a5.a), ZeroAddress);
  await dailyPage.ev(`window.__E2E_REJECTED_TARGET__ = ${JSON.stringify((await usdc.getAddress()).toLowerCase())};
    window.__E2E_REJECT_ERROR_CODE__ = 'daily_tx_limit_reached'; window.__E2E_REJECT_THROWS__ = false; return true;`);
  await clickButton(dailyPage, "Resume remaining setup");
  await until(() => dailyPage.ev(`const saved = JSON.parse(sessionStorage.getItem(${JSON.stringify(dailyKey)}) || 'null');
    return saved?.createState === 'ready' && saved.assets[0].depositState === 'ready'
      && __q.btns().some(button => button.t === 'Edit remaining setup' && !button.d);`), "daily batch policy leaves every call unsent");
  assert.equal(await usdcFactory.vaultOf(ACCOUNTS.a5.a), ZeroAddress);
  await dailyPage.ev("window.__E2E_REJECTED_TARGET__ = ''; window.__E2E_BRIDGE_CALLS__ = []; return true;");
  await clickButton(dailyPage, "Resume remaining setup");
  await until(() => dailyPage.ev("return /Your inheritance plan is ready/.test(document.body.innerText)"), "daily policy clears and saved plan resumes");
  const dailyUsdcVault = await usdcFactory.vaultOf(ACCOUNTS.a5.a);
  const dailyCalls = JSON.parse(await dailyPage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__)"));
  assert.equal(dailyCalls.length, 1);
  assert.equal(await usdcStrategy.balanceOf(dailyUsdcVault), parseUnits("0.1", 18));
  evidence.plan.dailyPolicy = { thrownCreateRejected: true, returnedDepositRejected: true,
    readyAfterBoth: true, retryRequests: 1, vault: dailyUsdcVault };
  pass("daily transaction policy rejection stays ready for both creation and deposit and resumes when the policy clears");

  // An ambiguous settings request must survive reload and block editing, further
  // alignment and deposit until the original event receipt is verified.
  await preparePlanForm(balancePage, ACCOUNTS.a1.a, 30, "WLD", "0.01");
  await clickButton(balancePage, "Create plan and deposit");
  await until(() => balancePage.ev("return !!document.querySelector('.plan-alignment-review')"), "alignment pending regression review");
  await balancePage.ev(`window.__E2E_REJECTED_TARGET__ = ${JSON.stringify(wldFactoryAddress)}; return true;`);
  await clickButton(balancePage, "Confirm and align settings");
  await until(() => balancePage.ev(`return JSON.parse(sessionStorage.getItem(${JSON.stringify(balanceKey)}) || 'null')?.alignment?.state === 'submitting'`), "ambiguous alignment journal retained");
  const uncertainAlignmentPlan = JSON.parse(await balancePage.ev(`return sessionStorage.getItem(${JSON.stringify(balanceKey)})`));
  assert.equal(await balancePage.ev("return __q.btns().some(button => button.t === 'Edit remaining setup')"), false);
  assert.equal(uncertainAlignmentPlan.alignment.targets[0].vault.toLowerCase(), editedWldVault.toLowerCase());
  await restorePlan(balancePage, uncertainAlignmentPlan);
  await clickButton(balancePage, "Resume remaining setup");
  await until(() => balancePage.ev("return /prior settings request has no verifiable result/.test(document.body.innerText)"), "ambiguous alignment is not repeated");
  assert.equal(JSON.parse(await balancePage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__)" )).length, 0);
  assert.equal(await balancePage.ev("return __q.btns().some(button => button.t === 'Edit remaining setup')"), false);
  pass("an ID-less settings request remains journaled after reload and blocks editing and new wallet requests");
  const unavailableAlignmentPlan = { ...uncertainAlignmentPlan, alignment: { ...uncertainAlignmentPlan.alignment,
    targets: uncertainAlignmentPlan.alignment.targets.map(target => ({ ...target, factory: ACCOUNTS.a9.a })) } };
  await restorePlan(balancePage, unavailableAlignmentPlan);
  assert.deepEqual(JSON.parse(await balancePage.ev(`return sessionStorage.getItem(${JSON.stringify(balanceKey)})`)), unavailableAlignmentPlan);
  assert.equal(await balancePage.ev("return __q.btns().some(button => button.t === 'Edit remaining setup')"), false);
  await clickButton(balancePage, "Resume remaining setup");
  await until(() => balancePage.ev("return /prior settings request has no verifiable result|original settings route is unavailable/.test(document.body.innerText)"), "unavailable original alignment route stays unresolved");
  assert.deepEqual(JSON.parse(await balancePage.ev(`return sessionStorage.getItem(${JSON.stringify(balanceKey)})`)), unavailableAlignmentPlan);
  assert.equal(JSON.parse(await balancePage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__)" )).length, 0);
  assert.equal(await balancePage.ev("return __q.btns().some(button => button.t === 'Edit remaining setup')"), false);
  evidence.plan.unavailableAlignment = { originalFactory: ACCOUNTS.a9.a, journalPreserved: true, walletRequests: 0, editable: false };
  pass("a removed original settings route preserves the unresolved journal and blocks edits and new wallet requests");
  await restorePlan(balancePage, uncertainAlignmentPlan);
  const delayedAlignmentReceipt = await (await (await factoryAs(wldFactory, 4)).updateMyHeir(ACCOUNTS.a1.a)).wait();
  // Anvil mines immediately; let ethers' 350 ms read cache observe the new head.
  await sleep(450);
  await clickButton(balancePage, "Resume remaining setup");
  await until(() => balancePage.ev("return /Your inheritance plan is ready/.test(document.body.innerText)"), "delayed original alignment receipt resumes deposit");
  const recoveredAlignmentCalls = JSON.parse(await balancePage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__)"));
  assert.equal(recoveredAlignmentCalls.length, 1);
  assert.deepEqual(recoveredAlignmentCalls[0].targets, [wldAddress.toLowerCase(), wldFactoryAddress]);
  assert.equal(await wldStrategy.balanceOf(editedWldVault), parseUnits("0.11", 18));
  assert.equal(await balancePage.ev(`return sessionStorage.getItem(${JSON.stringify(balanceKey)})`), null);
  evidence.plan.uncertainAlignment = { original: uncertainAlignmentPlan.alignment,
    receipt: delayedAlignmentReceipt.hash, onlyDepositSentAfterRecovery: true };
  pass("a verified delayed settings receipt clears the journal and resumes only the remaining deposit");
  const confirmedAlignmentPlan = { ...uncertainAlignmentPlan, assets: uncertainAlignmentPlan.assets.map(asset => ({
    ...asset, vault: editedWldVault, depositState: "complete",
  })), alignment: { ...uncertainAlignmentPlan.alignment, state: "submitted",
    txHash: delayedAlignmentReceipt.hash, hashType: "transaction" } };
  await restorePlan(balancePage, confirmedAlignmentPlan);
  assert.equal(await balancePage.ev("return __q.btns().some(button => button.t === 'Edit remaining setup')"), false);
  await clickButton(balancePage, "Resume remaining setup");
  await until(() => balancePage.ev("return /Your inheritance plan is ready/.test(document.body.innerText)"), "identified settings receipt recovery");
  assert.equal(JSON.parse(await balancePage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__)" )).length, 0);
  assert.equal(await wldStrategy.balanceOf(editedWldVault), parseUnits("0.11", 18));
  pass("an identified submitted settings receipt resolves without another settings or deposit request");

  // A status-zero alignment receipt is a proven failure and may be edited again.
  await preparePlanForm(balancePage, ACCOUNTS.a5.a, 30, "WLD", "0.001");
  await clickButton(balancePage, "Create plan and deposit");
  await until(() => balancePage.ev("return !!document.querySelector('.plan-alignment-review')"), "alignment revert review");
  await balancePage.ev(`
    const fixture = await import('/src/test/minikit-stub.ts'); window.__ALIGN_NORMAL_SEND__ = fixture.MiniKit.sendTransaction;
    const invalid = ${JSON.stringify(wldFactory.interface.encodeFunctionData("updateMyHeir", [ZeroAddress]))};
    fixture.MiniKit.sendTransaction = async () => {
      const { Wallet, JsonRpcProvider } = await import('/node_modules/.vite/deps/ethers.js');
      const wallet = new Wallet(window.__E2E_SIGNER__.privateKey, new JsonRpcProvider(window.__E2E_RPC__, 480, { staticNetwork: true, cacheTimeout: -1 }));
      const tx = await wallet.sendTransaction({ to: ${JSON.stringify(wldFactoryAddress)}, data: invalid, gasLimit: 1000000n });
      window.__ALIGN_FAILED_HASH__ = tx.hash;
      return { executedWith: 'minikit', data: { status: 'success', transaction_hash: tx.hash } };
    }; return true;
  `);
  await clickButton(balancePage, "Confirm and align settings");
  await until(() => balancePage.ev(`const saved = JSON.parse(sessionStorage.getItem(${JSON.stringify(balanceKey)}) || 'null');
    return window.__ALIGN_FAILED_HASH__ && saved && !saved.alignment
      && /transaction reverted/i.test(document.body.innerText) && __q.btns().some(button => button.t === 'Edit remaining setup');`), "reverted alignment becomes editable");
  const revertedAlignmentHash = await balancePage.ev("return window.__ALIGN_FAILED_HASH__");
  assert.equal((await provider.getTransactionReceipt(revertedAlignmentHash)).status, 0);
  assert.equal((await new Contract(editedWldVault, artifact("InheritanceVaultMorpho").abi, provider).heir()).toLowerCase(), ACCOUNTS.a1.a.toLowerCase());
  assert.equal(await wldStrategy.balanceOf(editedWldVault), parseUnits("0.11", 18));
  await balancePage.ev("const fixture = await import('/src/test/minikit-stub.ts'); fixture.MiniKit.sendTransaction = window.__ALIGN_NORMAL_SEND__; return true;");
  await clickButton(balancePage, "Edit remaining setup");
  pass("a reverted settings receipt clears only the failed request and restores editing without moving principal");

  // Original create receipts stay valid after later owner settings changes.
  for (const identified of [true, false]) {
    const historicalCreatePlan = { version: 1, account: ACCOUNTS.a8.a, heir: ACCOUNTS.a4.a, periodDays: 14,
      createdAt: Date.now(), createState: identified ? "submitted" : "submitting",
      createTargets: [usdcFactoryAddress], createBeforeBlock: driftUsdcCreateBeforeBlock,
      ...(identified ? { createTxHash: driftUsdcCreateReceipt.hash, createHashType: "transaction" } : {}), assets: [{
        symbol: "USDC", factory: usdcFactoryAddress, asset: await usdc.getAddress(), decimals: 6, mode: "morpho",
        amount: parseUnits("0.01", 6).toString(), vault: "", depositState: "ready",
      }] };
    await restorePlan(driftPage, historicalCreatePlan);
    await clickButton(driftPage, "Resume remaining setup");
    await until(() => driftPage.ev("return !!document.querySelector('.plan-alignment-review') && __q.btns().some(button => button.t === 'Edit remaining setup')"), "historical creation verified before settings review");
    assert.equal(JSON.parse(await driftPage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__)" )).length, 0);
    assert.equal((await driftUsdcVault.heir()).toLowerCase(), ACCOUNTS.a5.a.toLowerCase());
    assert.equal(await driftUsdcVault.heartbeatInterval(), 30n * 86400n);
    await clickButton(driftPage, "Edit remaining setup");
    pass(`${identified ? 'identified' : 'ID-less'} create receipt resolves after later heir and interval changes and requires a fresh settings review`);
  }
  evidence.plan.historicalCreate = { receipt: driftUsdcCreateReceipt.hash, beforeBlock: driftUsdcCreateBeforeBlock,
    mutableSettingsDidNotInvalidateProof: true, noWalletRequests: true };

  // A user with just one owned vault can return to it from another heir's link.
  await (await (await factoryAs(plainFactory, 5)).createVault(ACCOUNTS.a4.a, 30 * 86400)).wait();
  const otherOwnerVault = await plainFactory.vaultOf(ACCOUNTS.a5.a);
  await (await wld.transfer(otherOwnerVault, parseUnits("0.1", 18))).wait();
  const ownerManagementPage = await launch({ pk: ACCOUNTS.a4.pk, url: appUrl + '/?vault=' + otherOwnerVault, preload });
  regressionPages.push(["owned-management", ownerManagementPage]);
  await signIn(ownerManagementPage);
  await chooseTab(ownerManagementPage, "Home");
  await until(() => ownerManagementPage.ev("return !!document.querySelector('.plan-overview-card')"), "owned overview from incoming link");
  await clickButton(ownerManagementPage, "Manage assets and income");
  await until(() => ownerManagementPage.ev("return !!document.querySelector('.income-card') && !!document.getElementById('withdraw-to')"), "management focuses own income-capable vault");
  assert.equal(await wldFactory.vaultOf(ACCOUNTS.a4.a), editedWldVault);
  assert.equal(await ownerManagementPage.ev("return document.querySelector('.income-card').innerText.includes('Collect income')"), true);
  evidence.plan.managementFromLink = { linked: otherOwnerVault, managed: editedWldVault, ownPrincipalControl: true };
  pass("the personal overview management button selects the user's single owned vault when arriving through another owner's link");

  // Use the installed SDK's own command dispatcher to prove that an old World
  // App and an outside-World-App environment reject before any native handoff.
  await (await usdc.mint(submittedOwner, parseUnits("1", 6))).wait();
  const unavailablePage = await newRegressionPage(9, "sdk-availability");
  const unavailableKey = `inheritance:pending-plan:${submittedOwner.toLowerCase()}`;
  const useUnavailableSdk = async (insideWorldApp) => unavailablePage.ev(`
    const fixture = await import('/src/test/minikit-stub.ts');
    window.__AVAILABLE_LOCAL_SEND__ = fixture.MiniKit.sendTransaction;
    window.__UNAVAILABLE_HANDOFFS__ = []; window.__UNAVAILABLE_ERROR__ = ''; window.__UNAVAILABLE_REASON__ = '';
    if (${JSON.stringify(insideWorldApp)}) {
      window.WorldApp = { supported_commands: [{ name: 'send-transaction', supported_versions: [1] }] };
      window.Android = { postMessage: payload => window.__UNAVAILABLE_HANDOFFS__.push(payload) };
    }
    fixture.MiniKit.sendTransaction = async request => {
      try { return await fixture.__sendUnavailableTransaction(request); }
      catch (error) { window.__UNAVAILABLE_ERROR__ = error.name; window.__UNAVAILABLE_REASON__ = error.reason; throw error; }
    }; return true;
  `);
  const restoreAvailableSdk = async () => unavailablePage.ev(`
    const fixture = await import('/src/test/minikit-stub.ts');
    fixture.MiniKit.sendTransaction = window.__AVAILABLE_LOCAL_SEND__;
    delete window.WorldApp; delete window.Android; return true;
  `);
  await preparePlanForm(unavailablePage, ACCOUNTS.a5.a, 1, "USDC", "0.01");
  await useUnavailableSdk(true);
  await clickButton(unavailablePage, "Create plan and deposit");
  await until(() => unavailablePage.ev(`return window.__UNAVAILABLE_ERROR__ === 'CommandUnavailableError'
    && window.__UNAVAILABLE_REASON__ === 'oldAppVersion'
    && JSON.parse(sessionStorage.getItem(${JSON.stringify(unavailableKey)}) || 'null')?.createState === 'ready'
    && __q.btns().some(button => button.t === 'Edit remaining setup' && !button.d)`), "unsupported native command remains editable");
  assert.deepEqual(await unavailablePage.ev("return window.__UNAVAILABLE_HANDOFFS__"), []);
  assert.equal(await usdcFactory.vaultOf(submittedOwner), ZeroAddress);
  await restoreAvailableSdk();
  await clickButton(unavailablePage, "Resume remaining setup");
  await until(() => unavailablePage.ev(`return /Your inheritance plan is ready/.test(document.body.innerText)
    && sessionStorage.getItem(${JSON.stringify(unavailableKey)}) === null`), "available bridge resumes unsent creation");
  const sdkUsdcVault = await usdcFactory.vaultOf(submittedOwner);
  assert.equal(await usdcStrategy.balanceOf(sdkUsdcVault), parseUnits("0.01", 18));
  assert.equal(JSON.parse(await unavailablePage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__)" )).length, 1);
  pass("the installed SDK rejects an unsupported command before native handoff; creation stays editable and resumes after recovery");

  await preparePlanForm(unavailablePage, ACCOUNTS.a5.a, 1, "USDC", "0.002");
  await useUnavailableSdk(false);
  await clickButton(unavailablePage, "Create plan and deposit");
  await until(() => unavailablePage.ev(`const saved = JSON.parse(sessionStorage.getItem(${JSON.stringify(unavailableKey)}) || 'null');
    return window.__UNAVAILABLE_ERROR__ === 'CommandUnavailableError' && window.__UNAVAILABLE_REASON__ === 'notInWorldApp'
      && saved?.assets[0].depositState === 'ready'
      && __q.btns().some(button => button.t === 'Edit remaining setup' && !button.d);`), "unavailable browser command leaves deposit unsent");
  assert.deepEqual(await unavailablePage.ev("return window.__UNAVAILABLE_HANDOFFS__"), []);
  assert.equal(await usdcStrategy.balanceOf(sdkUsdcVault), parseUnits("0.01", 18));
  await restoreAvailableSdk();
  await clickButton(unavailablePage, "Resume remaining setup");
  await until(() => unavailablePage.ev(`return /Your inheritance plan is ready/.test(document.body.innerText)
    && sessionStorage.getItem(${JSON.stringify(unavailableKey)}) === null`), "available bridge resumes unsent deposit");
  assert.equal(await usdcStrategy.balanceOf(sdkUsdcVault), parseUnits("0.012", 18));
  assert.equal(JSON.parse(await unavailablePage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__)" )).length, 1);
  evidence.plan.sdkAvailability = { nativeHandoffs: 0, creationEditable: true, depositEditable: true,
    sdkError: "CommandUnavailableError", reasons: ["oldAppVersion", "notInWorldApp"], restoredDeposits: "0.012 USDC" };
  pass("the installed SDK rejects an outside-World-App deposit before native handoff and resumes once the bridge is restored");

  // A completed WLD terms read must not block a healthy remaining USDC deposit.
  const feeRecipientSelector = wldFactory.interface.getFunction("feeRecipient").selector;
  await unavailablePage.send("Page.addScriptToEvaluateOnNewDocument", { source: `
    const priorTermsFetch = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input?.url ?? String(input);
      if (url === ${JSON.stringify(rpc)} && init?.body) {
        const payload = JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body));
        const requests = Array.isArray(payload) ? payload : [payload];
        const bad = requests.filter(request => request.method === 'eth_call'
          && request.params[0].to?.toLowerCase() === ${JSON.stringify(wldFactoryAddress.toLowerCase())}
          && (request.params[0].data || request.params[0].input || '').startsWith(${JSON.stringify(feeRecipientSelector)}));
        if (bad.length) {
          window.__FAILED_COMPLETED_TERMS__ = (window.__FAILED_COMPLETED_TERMS__ || 0) + bad.length;
          const response = await priorTermsFetch(input, init);
          const replies = await response.json();
          const values = Array.isArray(replies) ? replies : [replies];
          const patched = values.map(reply => bad.some(request => request.id === reply.id)
            ? { jsonrpc: '2.0', id: reply.id, error: { code: -32000, message: 'E2E completed terms unavailable' } } : reply);
          return Response.json(Array.isArray(replies) ? patched : patched[0]);
        }
      }
      return priorTermsFetch(input, init);
    };
  ` });
  const termsOutagePlan = { version: 1, account: submittedOwner, heir: ACCOUNTS.a5.a, periodDays: 1,
    createdAt: Date.now(), createState: "complete", createTargets: [], assets: [
      { symbol: "WLD", factory: wldFactoryAddress, asset: wldAddress, decimals: 18, mode: "morpho",
        amount: parseUnits("0.1", 18).toString(), vault: originalSubmittedVault, depositState: "complete" },
      { symbol: "USDC", factory: usdcFactoryAddress, asset: await usdc.getAddress(), decimals: 6, mode: "morpho",
        amount: parseUnits("0.005", 6).toString(), vault: sdkUsdcVault, depositState: "ready" },
    ] };
  await restorePlan(unavailablePage, termsOutagePlan);
  await until(() => unavailablePage.ev("return window.__FAILED_COMPLETED_TERMS__ > 0 && __q.btns().some(button => button.t === 'Resume remaining setup' && !button.d)"), "completed terms outage does not gate USDC");
  await clickButton(unavailablePage, "Resume remaining setup");
  await until(() => unavailablePage.ev(`return /Remaining setup is complete/.test(document.body.innerText)
    && sessionStorage.getItem(${JSON.stringify(unavailableKey)}) === null`), "USDC completes despite completed WLD terms outage");
  assert.equal(await usdcStrategy.balanceOf(sdkUsdcVault), parseUnits("0.017", 18));
  assert.equal(await wldStrategy.balanceOf(replacementSubmittedVault), 0n);
  assert.equal(JSON.parse(await unavailablePage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__)" )).length, 1);
  pass("a completed WLD fee-query outage does not block the remaining healthy USDC deposit or repeat WLD");

  // Receipt verification is read-only and remains available without consent to
  // a new deposit. New funds still wait for the remaining asset's consent.
  const receiptFirstPlan = { ...termsOutagePlan, assets: [
    { ...termsOutagePlan.assets[0], depositState: "submitted", txHash: originalReceipt.hash,
      hashType: "transaction", beforeBlock: originalBeforeBlock },
    { ...termsOutagePlan.assets[1], amount: parseUnits("0.001", 6).toString() },
  ] };
  await restorePlan(unavailablePage, receiptFirstPlan);
  await unavailablePage.ev("const checkbox = document.getElementById('yield-consent'); if (checkbox.checked) checkbox.click(); return true;");
  await clickButton(unavailablePage, "Resume remaining setup");
  await until(() => unavailablePage.ev(`const saved = JSON.parse(sessionStorage.getItem(${JSON.stringify(unavailableKey)}) || 'null');
    return saved?.assets[0].depositState === 'complete' && saved.assets[1].depositState === 'ready'
      && /accept the Morpho fee and risk terms before sending/.test(document.body.innerText);`), "original receipt resolves before fresh consent");
  assert.equal(JSON.parse(await unavailablePage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__)" )).length, 0);
  assert.equal(await usdcStrategy.balanceOf(sdkUsdcVault), parseUnits("0.017", 18));
  await acceptYieldTerms(unavailablePage);
  await clickButton(unavailablePage, "Resume remaining setup");
  await until(() => unavailablePage.ev(`return /Remaining setup is complete/.test(document.body.innerText)
    && sessionStorage.getItem(${JSON.stringify(unavailableKey)}) === null`), "consent resumes only fresh remaining deposit");
  assert.equal(await usdcStrategy.balanceOf(sdkUsdcVault), parseUnits("0.018", 18));
  assert.equal(JSON.parse(await unavailablePage.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__)" )).length, 1);
  evidence.plan.remainingTerms = { completedWldTermsUnavailable: true, remainingUsdcCompleted: true,
    receiptVerifiedBeforeConsent: true, newRequestsBeforeConsent: 0 };
  pass("original receipt verification proceeds without new-deposit consent and pauses before any fresh funds until consent is given");

  // If a known funded route cannot be read, its total and membership status are
  // unavailable; a combined check-in stays disabled until all routes verify.
  await chooseTab(page, "Plan");
  await clickMatchingButton(page, text => text === "USDC");
  const readFailureUsdcVault = await usdcFactory.vaultOf(owner);
  const positionSelector = new Interface(artifact("InheritanceVaultUSDC").abi).getFunction("position").selector;
  await page.ev(`
    window.__REVIEW_FETCH__ = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input?.url ?? String(input);
      if (url === window.__E2E_RPC__ && init?.body) {
        const payload = JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body));
        const requests = Array.isArray(payload) ? payload : [payload];
        const bad = requests.filter(request => request.method === 'eth_call'
          && request.params[0].to?.toLowerCase() === ${JSON.stringify(readFailureUsdcVault.toLowerCase())}
          && (request.params[0].data || request.params[0].input || '').startsWith(${JSON.stringify(positionSelector)}));
        if (bad.length) {
          const response = await window.__REVIEW_FETCH__(input, init);
          const results = await response.json();
          const values = Array.isArray(results) ? results : [results];
          const patched = values.map(result => bad.some(request => request.id === result.id)
            ? { id: result.id, jsonrpc: '2.0', error: { code: -32000, message: 'review transient position failure' } } : result);
          return Response.json(Array.isArray(results) ? patched : patched[0]);
        }
      }
      return window.__REVIEW_FETCH__(input, init);
    };
    document.dispatchEvent(new Event('visibilitychange'));
    return true;
  `);
  await chooseTab(page, "Home");
  await until(() => page.ev(`return /Some vaults could not be refreshed/.test(document.querySelector('.plan-overview-card')?.innerText || '')
    && /Value unavailable/.test([...document.querySelectorAll('.plan-overview-asset')].find(item => item.querySelector('span')?.textContent === 'USDC')?.innerText || '')`), "unavailable funded USDC overview");
  const unavailableUsdc = await page.ev("return [...document.querySelectorAll('.plan-overview-asset')].find(item => item.querySelector('span')?.textContent === 'USDC')?.innerText || ''");
  assert.match(unavailableUsdc, /Status unavailable/);
  assert.doesNotMatch(unavailableUsdc, /Not added yet|0\.0 USDC/);
  assert.equal(await page.ev("return [...document.querySelectorAll('.plan-overview-card button')].find(button => button.textContent.trim() === 'Check in')?.disabled"), true);
  evidence.plan.readFailure = { usdcVault: readFailureUsdcVault, overview: unavailableUsdc, combinedCheckInDisabled: true };
  pass("funded USDC read failure makes its total unavailable and disables combined check-in");

  // A linked heir has status/timer content on Inherit; the owner-only Vault tab
  // is hidden when the viewer has no owned vault of their own.
  heirPage = await launch({ pk: ACCOUNTS.a1.pk, url: `${appUrl}?vault=${wldVaultAddress}`, preload });
  await signIn(heirPage);
  await chooseTab(heirPage, "Plan");
  await until(() => heirPage.ev("return document.querySelector('.heir-plan-card') !== null && document.querySelector('.inheritance-next') !== null"), "linked heir status and timer");
  const heirTabs = JSON.parse(await heirPage.ev("return JSON.stringify(__q.tabs())"));
  assert.equal(heirTabs.includes("Home"), false, "owner-only Vault tab stayed visible for an heir without an owned vault");
  assert.equal(await heirPage.ev("return document.querySelector('.tab-item-active')?.textContent.trim()"), "Plan");
  assert.equal(await heirPage.ev("return document.querySelector('.plan-overview-card') !== null"), false);
  assert.equal(await heirPage.ev("return [...document.querySelectorAll('button')].some(button => /^Check in$|Cancel claims and check in/.test(button.textContent))"), false);
  evidence.heirView = { tabs: heirTabs, activeTab: "Plan", statusVisible: true, timerVisible: true };
  pass("heir deep link keeps read-only status and timer visible without an empty Vault tab");

  const originalWldShares = await wldStrategy.balanceOf(wldVaultAddress);
  const originalUsdcShares = await usdcStrategy.balanceOf(usdcVaultAddress);
  const rotatedPlan = { version: 1, account: owner, heir: await wldVault.heir(),
    periodDays: Number(await wldVault.heartbeatInterval()) / 86400, createdAt: Date.now(), createState: "complete", createTargets: [],
    assets: [
      { symbol: "WLD", factory: await wldFactory.getAddress(), asset: await wld.getAddress(), decimals: 18, mode: "morpho",
        amount: parseUnits("2.5", 18).toString(), vault: wldVaultAddress, depositState: "complete" },
      { symbol: "USDC", factory: await usdcFactory.getAddress(), asset: await usdc.getAddress(), decimals: 6, mode: "morpho",
        amount: parseUnits("0.05", 6).toString(), vault: usdcVaultAddress, depositState: "ready" },
    ] };
  await page.ev(`sessionStorage.setItem(${JSON.stringify(pendingKey)}, ${JSON.stringify(JSON.stringify(rotatedPlan))}); return true;`);
  const replacementWldFactory = await deploy("InheritanceVaultMorphoFactory", [await wld.getAddress(), await wldStrategy.getAddress(), ACCOUNTS.a2.a, 1000], deployer);
  await vite.close();
  Object.assign(process.env, { VITE_YIELD_FACTORY_ADDRESS: await replacementWldFactory.getAddress(),
    VITE_LEGACY_YIELD_FACTORY_ADDRESSES: await wldFactory.getAddress(), VITE_LEGACY_YIELD_FACTORY_DEPLOY_BLOCK: "1" });
  vite = await createVite({ root: path.join(ROOT, "app"), configFile: path.join(ROOT, "app/vite.config.e2e.ts"), envDir: false,
    logLevel: "error", server: { host: "127.0.0.1", port, strictPort: true } });
  await vite.listen();
  await page.send("Page.reload", { ignoreCache: true });
  await until(async () => { await page.ev(HELPERS); return page.ev("return __q.tabs().length > 0"); }, "restored session helpers");
  await until(() => page.ev("return __q.tabs().length > 0"), "session restored after factory rotation");
  await chooseTab(page, "Plan");
  await installBridgeRecorder(page);
  await acceptYieldTerms(page);
  await clickButton(page, "Resume remaining setup");
  await until(() => page.ev("return /Your inheritance plan is ready/.test(document.body.innerText)"), "saved original-route plan completes after rotation");
  const rotationCalls = JSON.parse(await page.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__ || [])"));
  assert.equal(rotationCalls.length, 1);
  assert.deepEqual(rotationCalls[0].targets, [(await usdc.getAddress()).toLowerCase(), (await usdcFactory.getAddress()).toLowerCase()]);
  assert.equal(await wldStrategy.balanceOf(wldVaultAddress), originalWldShares);
  assert.equal(await usdcStrategy.balanceOf(usdcVaultAddress), originalUsdcShares + parseUnits("0.05", 18));
  assert.equal(await replacementWldFactory.vaultOf(owner), ZeroAddress);
  assert.equal(await page.ev(`return sessionStorage.getItem(${JSON.stringify(pendingKey)})`), null);
  evidence.plan.factoryRotation = { original: await wldFactory.getAddress(), replacement: await replacementWldFactory.getAddress(),
    remainingAsset: "USDC", walletRequests: 1, completedWldRepeated: false };
  pass("factory rotation preserves the saved original route and resumes only the remaining asset");

  await (await wldStrategy.setRate(parseUnits("1.6", 18))).wait();
  await chooseTab(page, "Plan");
  await clickMatchingButton(page, text => text === "WLD");
  const hasWldHistory = await page.ev("const details = document.querySelector('.asset-history'); if (details && !details.open) details.querySelector('summary').click(); return !!details;");
  if (hasWldHistory) await clickMatchingButton(page, text => /^Earlier WLD ·/.test(text));
  await chooseTab(page, "Assets");
  await until(() => page.ev("return /Available after fee/i.test(document.querySelector('.income-card')?.innerText || '')"), "income API on rotated legacy route");
  await page.ev("__q.reveal('#income-to'); [...document.querySelectorAll('.income-card button')].find(button => button.textContent.trim() === 'My address').click(); return true;");
  const rotatedIncomeBefore = { basis: await wldVault.costBasis(), ping: await wldVault.lastPing(),
    owner: await wld.balanceOf(owner), fee: await wld.balanceOf(ACCOUNTS.a2.a) };
  await page.ev("window.__E2E_BRIDGE_CALLS__ = []; return true;");
  await clickMatchingButton(page, text => text.startsWith("Collect "));
  await until(() => page.ev("return /Income collected/.test(document.body.innerText)"), "legacy route income receipt");
  const rotatedIncomeCalls = JSON.parse(await page.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__ || [])"));
  assert.equal(rotatedIncomeCalls.length, 1);
  assert.deepEqual(rotatedIncomeCalls[0].targets, [wldFactoryAddress]);
  const rotatedReceipt = await provider.getTransactionReceipt(rotatedIncomeCalls[0].hash);
  assert.equal(rotatedReceipt.status, 1);
  const rotatedEvent = rotatedReceipt.logs.filter(log => log.address.toLowerCase() === wldVaultAddress.toLowerCase())
    .map(log => { try { return wldVault.interface.parseLog(log); } catch { return null; } })
    .find(event => event?.name === "IncomeWithdrawn");
  assert.ok(rotatedEvent && rotatedEvent.args.net > 0n);
  assert.equal(await wldVault.costBasis(), rotatedIncomeBefore.basis);
  assert.equal(await wldVault.lastPing(), rotatedIncomeBefore.ping);
  assert.equal(await wld.balanceOf(owner) - rotatedIncomeBefore.owner, rotatedEvent.args.net);
  assert.equal(await wld.balanceOf(ACCOUNTS.a2.a) - rotatedIncomeBefore.fee, rotatedEvent.args.fee);
  assert.equal(rotatedEvent.args.fee, rotatedEvent.args.gross / 10n);
  evidence.legacyIncome.rotatedIncomeCapable = { receipt: rotatedReceipt.hash, originalFactory: wldFactoryAddress,
    net: String(rotatedEvent.args.net), fee: String(rotatedEvent.args.fee), principalAndTimerPreserved: true };
  pass("an income-capable legacy route still pays owner income and the 10% fee without changing principal or timer");
  await provider.send("anvil_mine", ["0x41"]);
  assert.ok((await provider.getBlock("finalized")).number >= rotatedReceipt.blockNumber);
  await page.ev("document.querySelector('.income-history-disclosure').open = true; return true;");
  await clickButton(page, "Refresh history");
  await until(() => page.ev(`return !!document.querySelector('.income-history-card a[href$="${rotatedReceipt.hash}"]')`), "income history on a rotated legacy route");
  const rotatedHistory = await page.ev("return document.querySelector('.income-history-content').innerText");
  assert.ok(rotatedHistory.includes(require("ethers").formatUnits(rotatedEvent.args.net, 18)));
  evidence.legacyIncome.rotatedIncomeCapable.historyReceiptVerified = true;
  pass("a rotated income-capable legacy vault preserves genuine income history through its deployed capability");
  // Exit the actual receipt shares: earlier rate fixtures intentionally have
  // limited cash liquidity, which must not be invented to prepare this archive.
  await (await wldFactory.connect(deployer).withdrawSharesFromMyVault(owner,
    await wldStrategy.balanceOf(wldVaultAddress))).wait();
  assert.equal(await wldVault.hasAssets(), false);
  await provider.send("evm_increaseTime", [Number(await wldVault.heartbeatInterval()) + 1]);
  await provider.send("evm_mine", []);
  await (await wldFactory.connect(deployer).releaseMyVault()).wait();
  assert.equal(await wldFactory.vaultOf(owner), ZeroAddress);
  await page.send("Page.navigate", { url: `${appUrl}?vault=${wldVaultAddress}` });
  await until(async () => { await page.ev(HELPERS); return page.ev("return __q.tabs().length > 0"); }, "released-vault session");
  await chooseTab(page, "Assets");
  await until(() => page.ev("return !!document.querySelector('.income-history-card')"), "released owner income history");
  await page.ev("document.querySelector('.income-history-disclosure').open = true; return true;");
  await clickButton(page, "Refresh history");
  await until(() => page.ev(`return !!document.querySelector('.income-history-card a[href$="${rotatedReceipt.hash}"]')`), "verified released-vault receipt");
  assert.equal(await page.ev("return !!document.querySelector('.income-card')"), false);
  evidence.legacyIncome.rotatedIncomeCapable.releasedHistoryVerified = true;
  pass("a verified owner can read released-vault income history while active income controls remain hidden");

  const pageErrors = [...(page?.logs ?? []), ...(alignmentPage?.logs ?? []), ...(driftPage?.logs ?? []), ...(legacyPage?.logs ?? []), ...(heirPage?.logs ?? []),
    ...regressionPages.flatMap(([, targetPage]) => targetPage.logs)];
  const uncaught = pageErrors.filter(line => line.startsWith("[EXC]") || /unhandledrejection|Uncaught/i.test(line));
  assert.deepEqual(uncaught, [], `headless browser reported uncaught exceptions: ${uncaught.join(" | ")}`);
  const external = [
    ...(page ? JSON.parse(await page.ev("return JSON.stringify(window.__E2E_EXTERNAL_FETCHES__ || [])")) : []),
    ...(alignmentPage ? JSON.parse(await alignmentPage.ev("return JSON.stringify(window.__E2E_EXTERNAL_FETCHES__ || [])")) : []),
    ...(driftPage ? JSON.parse(await driftPage.ev("return JSON.stringify(window.__E2E_EXTERNAL_FETCHES__ || [])")) : []),
    ...(legacyPage ? JSON.parse(await legacyPage.ev("return JSON.stringify(window.__E2E_EXTERNAL_FETCHES__ || [])")) : []),
    ...(heirPage ? JSON.parse(await heirPage.ev("return JSON.stringify(window.__E2E_EXTERNAL_FETCHES__ || [])")) : []),
    ...(await Promise.all(regressionPages.map(([, targetPage]) => targetPage.ev("return JSON.stringify(window.__E2E_EXTERNAL_FETCHES__ || [])")))).flatMap(value => JSON.parse(value)),
  ];
  assert.deepEqual(external, [], "unexpected external fetch escaped the local fixture");
  evidence.fixtures.externalFetches = external;
  evidence.browserLogs = { totalLines: pageErrors.length, uncaught };
  pass("browser stayed on local auth, RPC and mocked monitoring/public-rate routes", "no remote notification delivery or external fetch");
  evidence.result = { status: "PASS", checks: passed };
} catch (error) {
  exitCode = 1;
  evidence.result = { status: "FAIL", checks: passed, error: error?.stack || String(error) };
  if (page) {
    try { evidence.failurePage = await page.ev("return document.body.innerText"); } catch {}
    try { evidence.failureBridge = JSON.parse(await page.ev("return JSON.stringify(window.__E2E_BRIDGE_CALLS__ || [])")); } catch {}
    try { evidence.failurePlan = JSON.parse(await page.ev(`return JSON.stringify(JSON.parse(sessionStorage.getItem(${JSON.stringify('inheritance:pending-plan:0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266')}) || 'null'))`)); } catch {}
    try { evidence.failureScreenshot = await page.shot("unified-plan-failure"); } catch {}
  }
  evidence.failureContexts = {};
  for (const [label, targetPage] of [["alignment", alignmentPage], ["drift", driftPage], ["legacy", legacyPage], ["heir", heirPage], ...regressionPages]) {
    if (targetPage) try { evidence.failureContexts[label] = await targetPage.ev("return document.body.innerText + String.fromCharCode(10) + 'FIELDS ' + JSON.stringify([...document.querySelectorAll('input')].map(i=>({id:i.id,value:i.value,disabled:i.disabled})))"); } catch {}
  }
  console.error(error?.stack || error);
} finally {
  for (const [name, targetPage] of [["main", page], ["alignment", alignmentPage], ["drift", driftPage], ["legacy", legacyPage], ["heir", heirPage], ...regressionPages]) {
    if (!targetPage) continue;
    try { writeFileSync(path.join(RUN_DIR, `${name}-browser-console.log`), targetPage.logs.join("\n") + "\n"); } catch {}
    try { await targetPage.close(); } catch {}
    try { rmSync(targetPage.profile, { recursive: true, force: true }); } catch {}
  }
  try { await vite?.close(); } catch {}
  if (anvil && anvil.exitCode === null) {
    anvil.kill("SIGTERM");
    await Promise.race([new Promise(resolve => anvil.once("close", resolve)), sleep(1500)]);
  }
  try { await provider?.destroy(); } catch {}
  if (walletBuild) try { rmSync(walletBuild, { recursive: true, force: true }); } catch {}
  anvilLog.end();
  try { writeFileSync(path.join(RUN_DIR, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n"); } catch (error) {
    exitCode = 1;
    console.error(`Could not write evidence: ${error.message}`);
  }
  console.log(`EVIDENCE ${path.join(RUN_DIR, "evidence.json")}`);
  console.log(`SCREENSHOTS ${SHOTS}`);
  if (exitCode === 0) console.log(`PASS unified plan browser verification (${passed} checks)`);
}

process.exitCode = exitCode;
