// Real Pages handlers + signature verification + Worker HTTP paths against SQLite.
// No credentials, World notification deliveries or chain requests leave this process.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../app/node_modules/vite/dist/node/index.js";
import { Wallet } from "../app/node_modules/ethers/lib.esm/index.js";
import worker, { __test } from "../backend/src/worker.mjs";
import { issueSession, takeCooldown, takeRateLimit, verifySession } from "../backend/src/session.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://inheritance.pages.dev";
const SECRET = "test-only-session-secret-not-a-real-credential";
const FACTORY = "0xf7beeddeb8be1dbc4bd8768fc3f1e513dd6c1d88";
const LEGACY = "0x" + "aa".repeat(20);
const WLD = "0x2cfc85d8e48f8eab294be644d9e25c3030863003";
const USDC_FACTORY = "0x" + "bb".repeat(20);
const USDC = "0x79a02482a880bce3f13e09da970dc34db4cd24d1";
const USDC_STRATEGY = "0xb1e80387ebe53ff75a89736097d34dc8d9e9045b";
const USDC_VAULT = "0x" + "66".repeat(20);
const VAULT = "0x" + "99".repeat(20);
const OTHER_VAULT = "0x" + "88".repeat(20);
const FAKE_VAULT = "0x" + "77".repeat(20);
const ZERO = "0x" + "00".repeat(20);
const ownerWallet = Wallet.createRandom();
const OWNER = ownerWallet.address.toLowerCase();
const HEIR = Wallet.createRandom().address.toLowerCase();
const STRANGER = Wallet.createRandom().address.toLowerCase();
const OTHER_OWNER = Wallet.createRandom().address.toLowerCase();
const realFetch = globalThis.fetch;
const word = (value) => "0x" + BigInt(value).toString(16).padStart(64, "0");
const addressWord = (address) => "0x" + address.slice(2).padStart(64, "0");
let passed = 0;
let failed = 0;

const vite = await createServer({ configFile: false, root: path.join(ROOT, "app"), optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true }, appType: "custom" });
const siwe = await vite.ssrLoadModule("/functions/_lib/siwe.ts");
const nonceApi = await vite.ssrLoadModule("/functions/api/auth/nonce.ts");
const verifyApi = await vite.ssrLoadModule("/functions/api/auth/verify.ts");
const frontend = await vite.ssrLoadModule("/src/auth.ts");

function fixture() {
  const db = new DatabaseSync(":memory:");
  const migrations = path.join(ROOT, "backend/migrations");
  for (const filename of readdirSync(migrations).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) db.exec(readFileSync(path.join(migrations, filename), "utf8"));
  const DB = {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async run(...extra) { assert.equal(extra.length, 0); return db.prepare(sql).run(...args); },
        async first() { return db.prepare(sql).get(...args) ?? null; },
        async all() { return { results: db.prepare(sql).all(...args), success: true }; },
      };
    },
  };
  const env = { DB, SIWE_SECRET: SECRET, FRONTEND_ORIGIN: ORIGIN, FACTORY_ADDRESS: FACTORY, WLD_ADDRESS: WLD,
    WORLD_APP_ID: "app_auth_test", WORLD_NOTIFY_API_KEY: "test-only-notification-key" };
  const factoryStates = new Map();
  const vaults = new Map([
    [VAULT, { owner: OWNER, heir: HEIR, factory: FACTORY, wld: WLD, registered: true, pending: false, expired: false,
      finalizable: false, cancelled: false, claimedAt: 0, challengeEndsAt: 0, remaining: 86400, interval: 86400, balance: 10n ** 18n }],
    [OTHER_VAULT, { owner: OTHER_OWNER, heir: STRANGER, factory: FACTORY, wld: WLD, registered: true, pending: false,
      expired: true, finalizable: false, cancelled: false, claimedAt: 0, challengeEndsAt: 0, remaining: 0, interval: 86400, balance: 10n ** 18n }],
  ]);
  // Override a vault only when latest and finalized state differ in a reorg test.
  const finalizedVaults = new Map();
  const deliveries = [];
  let sendHook = null;
  const mockFetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://developer.world.org/")) {
      const payload = JSON.parse(init.body);
      deliveries.push(payload);
      if (sendHook) await sendHook(payload);
      return Response.json({ success: true, result: [{ walletAddress: payload.wallet_addresses[0], sent: true }] });
    }
    const body = JSON.parse(init.body);
    assert.equal(body.method, "eth_call", "Only read-only chain calls are allowed");
    const { to, data } = body.params[0];
    const stateVaults = body.params[1] === "finalized" ? new Map([...vaults, ...finalizedVaults]) : vaults;
    const selector = data.slice(0, 10);
    let result = word(0);
    if (selector === "0x0709df45") {
      const owner = "0x" + data.slice(-40);
      const registered = [...stateVaults].find(([, value]) => value.owner === owner && value.factory === to.toLowerCase() && value.registered);
      result = addressWord(registered?.[0] || "0x" + "00".repeat(20));
    } else if (selector === "0x6e53033d") {
      const value = stateVaults.get("0x" + data.slice(-40));
      result = word(value?.factory === to.toLowerCase() && (value.known ?? value.registered));
    } else if (to.toLowerCase() === WLD && selector === "0x70a08231") {
      result = word(stateVaults.get("0x" + data.slice(-40))?.balance ?? 0);
    } else {
      const factory = factoryStates.get(to.toLowerCase());
      const value = stateVaults.get(to.toLowerCase());
      if (factory) {
        const getters = { "0x38d52e0f": factory.asset, "0xf7c618c1": factory.rewardToken, "0xa8c62e76": factory.strategy };
        if (getters[selector]) result = addressWord(getters[selector]);
      } else if (value) {
        const selectors = {
          "0x8da5cb5b": addressWord(value.owner), "0x91f2ebb8": addressWord(value.heir),
          "0xc45a0155": addressWord(value.factory), "0xde061d66": addressWord(value.wld || ZERO),
          "0x38d52e0f": addressWord(value.asset || ZERO), "0xf7c618c1": addressWord(value.rewardToken || ZERO),
          "0xa8c62e76": addressWord(value.strategy || ZERO), "0x01e1d114": word(value.totalAssets ?? value.balance ?? 0),
          "0x5be9b2d3": word(value.hasAssets ?? BigInt(value.balance ?? 0) > 0n),
          "0x2f13b60c": word(value.expired), "0x03a9f06e": word(value.pending),
          "0xc4671608": word(value.finalizable), "0x12cd6595": word(value.cancelled),
          "0xd2217fac": word(value.claimedAt), "0x765be13f": word(value.challengeEndsAt),
          "0xe3cfef60": word(value.remaining), "0x561a4fac": word(value.interval),
        };
        result = selectors[selector] ?? word(0);
      }
    }
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  };
  return { db, DB, env, vaults, factoryStates, finalizedVaults, deliveries, mockFetch,
    setSendHook(fn) { sendHook = fn; }, close() { db.close(); } };
}

function configureUSDC(context, overrides = {}) {
  Object.assign(context.env, { USDC_YIELD_FACTORY_ADDRESS: USDC_FACTORY,
    USDC_MORPHO_VAULT_ADDRESS: USDC_STRATEGY, USDC_ADDRESS: USDC });
  context.factoryStates.set(USDC_FACTORY, { asset: USDC, strategy: USDC_STRATEGY, rewardToken: WLD });
  const value = { owner: OWNER, heir: HEIR, factory: USDC_FACTORY, asset: USDC, rewardToken: WLD,
    strategy: USDC_STRATEGY, known: true, registered: false, pending: false, expired: false,
    finalizable: false, cancelled: false, claimedAt: 0, challengeEndsAt: 0, remaining: 86400,
    interval: 86400, balance: 0n, totalAssets: 0n, hasAssets: true, ...overrides };
  context.vaults.set(USDC_VAULT, value);
  return value;
}

async function test(name, run) {
  const context = fixture();
  globalThis.fetch = context.mockFetch;
  try {
    await run(context);
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}\n${error.stack}`);
  } finally {
    globalThis.fetch = realFetch;
    context.close();
  }
}
const getNonce = (env, origin = ORIGIN, headers = {}) => nonceApi.onRequestGet({
  request: new Request(ORIGIN + "/api/auth/nonce", { headers: { ...headers, ...(origin ? { Origin: origin } : {}) } }), env,
});
const verify = (env, body) => verifyApi.onRequestPost({ request: new Request(ORIGIN + "/api/auth/verify", { method: "POST", headers: { Origin: ORIGIN }, body: JSON.stringify(body) }), env });
async function signed(nonce, overrides = {}) {
  const values = { domain: ORIGIN, address: ownerWallet.address, statement: "Sign in to Inheritance", chain: "480", expiration: null, ...overrides };
  const message = [`${values.domain} wants you to sign in with your Ethereum account:`, values.address, "", values.statement, "", `URI: ${values.domain}`,
    "Version: 1", `Chain ID: ${values.chain}`, `Nonce: ${nonce}`, `Issued At: ${new Date().toISOString()}`,
    ...(values.expiration ? [`Expiration Time: ${values.expiration}`] : [])].join("\n");
  return { nonce, payload: { message, address: values.address, signature: await ownerWallet.signMessage(message) } };
}
async function call(context, endpoint, address = OWNER, body, tokenOverride) {
  const token = tokenOverride === undefined ? (await issueSession(SECRET, address, ORIGIN)).token : tokenOverride;
  const request = new Request("https://notify.test/api/notifications" + endpoint, {
    method: body === undefined ? "GET" : "POST", headers: { Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return worker.fetch(request, context.env);
}
async function register(context, vault = VAULT, address = OWNER) {
  const response = await call(context, "/register", address, { vaultAddress: vault });
  assert.equal(response.status, 200, await response.text());
}
const watcher = (vault = VAULT, owner = OWNER, heir = HEIR, alerts = {}) => ({ vaultAddress: vault, ownerAddress: owner, heirAddress: heir,
  active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastCheckedAt: null, lastClaimable: false,
  lastVaultBalance: "1", notifiedHeirAddress: null, notifiedAt: null, lastError: null, alerts });
async function addRelatedWatchers(context, count = 11) {
  const addresses = [];
  for (let index = count; index > 0; index--) {
    const vault = "0x" + index.toString(16).padStart(40, "0");
    const owner = "0x" + (1000 + index).toString(16).padStart(40, "0");
    // Each owner's canonical factory slot is unique, with one shared current heir.
    context.vaults.set(vault, { ...context.vaults.get(VAULT), owner, heir: HEIR });
    await __test.saveWatcher(context.env, watcher(vault, owner, HEIR));
    addresses.push(vault);
  }
  return addresses.sort();
}

try {
  await test("random alphanumeric nonces differ at the same millisecond and only hashes are stored", async ({ env, db }) => {
    const values = await Promise.all(Array.from({ length: 20 }, () => siwe.issueNonce(env)));
    assert.equal(new Set(values.map((value) => value.value)).size, 20);
    for (const value of values) assert.match(value.value, /^[0-9a-f]{64}$/);
    const rows = db.prepare("SELECT * FROM auth_nonces").all();
    assert.equal(rows.length, 20);
    assert.ok(rows.every((row) => !values.some((value) => value.value === row.nonce_hash)));
  });
  await test("nonce is consumed exactly once under concurrent claims", async ({ env }) => {
    const nonce = await siwe.issueNonce(env);
    assert.equal(await siwe.verifyNonce(env, nonce.value), true);
    assert.deepEqual((await Promise.all([siwe.consumeNonce(env, nonce.value), siwe.consumeNonce(env, nonce.value)])).sort(), [false, true]);
    assert.equal(await siwe.verifyNonce(env, nonce.value), false);
  });
  await test("expired and unissued nonces are refused", async ({ env, db }) => {
    const nonce = await siwe.issueNonce(env);
    db.prepare("UPDATE auth_nonces SET expires_at = ?").run(Date.now() - 1);
    assert.equal(await siwe.verifyNonce(env, nonce.value), false);
    assert.equal(await siwe.consumeNonce(env, nonce.value), false);
    assert.equal(await siwe.verifyNonce(env, "f".repeat(64)), false);
  });
  await test("Pages fails closed without shared DB/secret and rejects unrelated Origin", async ({ env }) => {
    assert.equal((await getNonce({ ...env, DB: undefined })).status, 503);
    assert.equal((await getNonce({ ...env, SIWE_SECRET: undefined })).status, 503);
    assert.equal((await getNonce(env, "https://other.test")).status, 403);
  });
  await test("161 anonymous nonce requests from one trusted IP cap both nonce and counter writes", async ({ env, DB, db }) => {
    const realNow = Date.now;
    const fixedNow = Math.floor(realNow() / 60_000) * 60_000 + 1000;
    Date.now = () => fixedNow;
    const headers = { "CF-Connecting-IP": "203.0.113.42" };
    let mutatingStatements = 0;
    const prepare = DB.prepare.bind(DB);
    DB.prepare = (sql) => { if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) mutatingStatements++; return prepare(sql); };
    try {
      const statuses = [];
      for (let index = 0; index < 161; index++) statuses.push((await getNonce(env, null, headers)).status);
      assert.equal(statuses.filter((status) => status === 200).length, siwe.NONCE_ISSUE_LIMIT);
      assert.equal(statuses.filter((status) => status === 429).length, 161 - siwe.NONCE_ISSUE_LIMIT);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM auth_nonces").get().count, siwe.NONCE_ISSUE_LIMIT);
      const counters = db.prepare("SELECT * FROM auth_rate_limits").all();
      assert.equal(counters.length, 1);
      assert.equal(counters[0].attempts, siwe.NONCE_ISSUE_LIMIT);
      assert.match(counters[0].rate_key, /^nonce:[0-9a-f]{64}$/);
      assert.ok(!JSON.stringify(counters).includes(headers["CF-Connecting-IP"]));
      assert.equal(db.prepare("SELECT total_changes() AS count").get().count, siwe.NONCE_ISSUE_LIMIT * 2);
      const before = mutatingStatements;
      const denied = await getNonce(env, null, headers);
      assert.equal(denied.status, 429);
      assert.equal(denied.headers.get("Retry-After"), "59");
      assert.equal(mutatingStatements, before, "A saturated caller must not execute any mutating D1 statement");
    } finally { Date.now = realNow; }
  });
  await test("concurrent nonce bursts cannot overshoot the persistent anonymous limit", async ({ env, db }) => {
    const realNow = Date.now;
    const fixedNow = Math.floor(realNow() / 60_000) * 60_000 + 1000;
    Date.now = () => fixedNow;
    try {
      const responses = await Promise.all(Array.from({ length: 180 }, () => getNonce(env, null, { "CF-Connecting-IP": "2001:db8::42" })));
      assert.equal(responses.filter((response) => response.status === 200).length, siwe.NONCE_ISSUE_LIMIT);
      assert.equal(responses.filter((response) => response.status === 429).length, 180 - siwe.NONCE_ISSUE_LIMIT);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM auth_nonces").get().count, siwe.NONCE_ISSUE_LIMIT);
      assert.equal(db.prepare("SELECT attempts FROM auth_rate_limits").get().attempts, siwe.NONCE_ISSUE_LIMIT);
    } finally { Date.now = realNow; }
  });
  await test("nonce limits isolate trusted IPs and recover with a new minute-specific key", async ({ env, db }) => {
    const realNow = Date.now;
    let now = Math.floor(realNow() / 60_000) * 60_000 + 1000;
    Date.now = () => now;
    try {
      const headers = { "CF-Connecting-IP": "203.0.113.1" };
      for (let index = 0; index < siwe.NONCE_ISSUE_LIMIT; index++) assert.equal((await getNonce(env, null, headers)).status, 200);
      const previousKey = db.prepare("SELECT rate_key FROM auth_rate_limits").get().rate_key;
      assert.equal((await getNonce(env, null, headers)).status, 429);
      assert.equal((await getNonce(env, null, { "CF-Connecting-IP": "203.0.113.2" })).status, 200);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM auth_rate_limits").get().count, 2);
      now += siwe.NONCE_ISSUE_WINDOW_MS;
      assert.equal((await getNonce(env, null, headers)).status, 200);
      const next = db.prepare("SELECT * FROM auth_rate_limits").all();
      assert.equal(next.length, 1, "Accepted issuance cleans expired rate-limit rows");
      assert.notEqual(next[0].rate_key, previousKey);
      assert.equal(next[0].attempts, 1);
      assert.equal(next[0].expires_at - next[0].window_start, 60_000);
    } finally { Date.now = realNow; }
  });
  await test("missing Cloudflare metadata uses a bounded bucket and spoofed forwarded headers cannot bypass it", async ({ env, db }) => {
    const realNow = Date.now;
    const now = Math.floor(realNow() / 60_000) * 60_000 + 1000;
    Date.now = () => now;
    try {
      for (let index = 0; index < siwe.NONCE_ISSUE_LIMIT; index++) {
        assert.equal((await getNonce(env, null, { "X-Forwarded-For": `203.0.113.${index}`, Forwarded: `for=192.0.2.${index}` })).status, 200);
      }
      assert.equal((await getNonce(env, null, { "X-Forwarded-For": "198.51.100.1" })).status, 429);
      assert.equal((await getNonce(env, null, { "CF-Connecting-IP": "invalid-local-header" })).status, 429);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM auth_rate_limits").get().count, 1);
    } finally { Date.now = realNow; }
  });
  await test("valid SDK-verified SIWE issues wallet-bound session and replay is refused", async ({ env }) => {
    const nonce = (await (await getNonce(env)).json()).nonce;
    const body = await signed(nonce);
    const response = await verify(env, body);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal((await verifySession(SECRET, data.token, ORIGIN)).sub, OWNER);
    assert.equal(data.expiresAt > Date.now(), true);
    assert.equal((await verify(env, body)).status, 401);
  });
  await test("two concurrent full SIWE verifications issue only one session", async ({ env }) => {
    const nonce = await siwe.issueNonce(env);
    const body = await signed(nonce.value);
    assert.deepEqual((await Promise.all([verify(env, body), verify(env, body)])).map((response) => response.status).sort(), [200, 401]);
  });
  for (const [name, overrides] of [["domain", { domain: "https://other.test" }], ["statement", { statement: "Transfer your funds" }],
    ["chain", { chain: "1" }], ["expiration", { expiration: new Date(Date.now() - 60_000).toISOString() }]]) {
    await test(`invalid SIWE ${name} is refused without consuming the nonce`, async ({ env }) => {
      const nonce = await siwe.issueNonce(env);
      assert.equal((await verify(env, await signed(nonce.value, overrides))).status, 401);
      assert.equal(await siwe.verifyNonce(env, nonce.value), true);
    });
  }
  await test("bad signature and address mismatch cannot issue a session", async ({ env }) => {
    const nonce = await siwe.issueNonce(env);
    const body = await signed(nonce.value);
    body.payload.signature = await Wallet.createRandom().signMessage(body.payload.message);
    assert.equal((await verify(env, body)).status, 401);
    body.payload.address = STRANGER;
    assert.equal((await verify(env, body)).status, 401);
    assert.equal(await siwe.verifyNonce(env, nonce.value), true);
    assert.equal((await verify(env, null)).status, 400);
  });
  await test("session signature, audience, expiry, future timestamp and malformed tokens fail closed", async () => {
    const session = await issueSession(SECRET, OWNER, ORIGIN);
    assert.equal((await verifySession(SECRET, session.token, ORIGIN)).sub, OWNER);
    assert.equal(await verifySession("wrong-secret", session.token, ORIGIN), null);
    assert.equal(await verifySession(SECRET, session.token, "https://other.test"), null);
    assert.equal(await verifySession(SECRET, session.token.slice(0, -1) + (session.token.endsWith("0") ? "1" : "0"), ORIGIN), null);
    assert.equal(await verifySession(SECRET, session.token, ORIGIN, session.expiresAt), null);
    assert.equal(await verifySession(SECRET, (await issueSession(SECRET, OWNER, ORIGIN, Date.now() + 60_000)).token, ORIGIN), null);
    assert.equal(await verifySession(SECRET, "v1.invalid.000", ORIGIN), null);
  });
  await test("all notification paths require authentication, including no-Origin CLI requests", async (context) => {
    for (const [endpoint, body] of [["", undefined], [`/status?vaultAddress=${VAULT}`, undefined], ["/register", { vaultAddress: VAULT }],
      ["/unregister", { vaultAddress: VAULT }], ["/test", { walletAddress: OWNER }], ["/check-now", { vaultAddress: VAULT }]]) {
      assert.equal((await call(context, endpoint, OWNER, body, null)).status, 401);
    }
    assert.equal((await worker.fetch(new Request("https://notify.test/api/notifications"), context.env)).status, 401);
    assert.equal(context.deliveries.length, 0);
  });
  await test("Worker denies wrong signature/audience and expired credentials", async (context) => {
    const wrongKey = (await issueSession("wrong-key", OWNER, ORIGIN)).token;
    const wrongAudience = (await issueSession(SECRET, OWNER, "https://other.test")).token;
    const expired = (await issueSession(SECRET, OWNER, ORIGIN, Date.now() - 3600_000)).token;
    for (const token of [wrongKey, wrongAudience, expired]) assert.equal((await call(context, "/test", OWNER, {}, token)).status, 401);
    assert.equal(context.deliveries.length, 0);
  });
  await test("strangers cannot register, inspect, unregister or manually check another vault", async (context) => {
    await register(context);
    for (const [endpoint, body] of [["/register", { vaultAddress: VAULT }], [`/status?vaultAddress=${VAULT}`, undefined],
      ["/unregister", { vaultAddress: VAULT }], ["/check-now", { vaultAddress: VAULT }]]) {
      assert.equal((await call(context, endpoint, STRANGER, body)).status, 403);
    }
    assert.equal((await __test.getWatcherByVault(context.env, VAULT)).active, true);
    assert.equal(context.deliveries.length, 0);
  });
  await test("current heir can register/read/check but only owner can disable reminders", async (context) => {
    await register(context, VAULT, HEIR);
    assert.equal((await call(context, `/status?vaultAddress=${VAULT}`, HEIR)).status, 200);
    assert.equal((await call(context, "/check-now", HEIR, { vaultAddress: VAULT })).status, 200);
    assert.equal((await call(context, "/unregister", HEIR, { vaultAddress: VAULT })).status, 403);
    assert.equal((await call(context, "/unregister", OWNER, { vaultAddress: VAULT })).status, 200);
    assert.equal((await __test.getWatcherByVault(context.env, VAULT)).active, false);
  });
  await test("canonical provenance rejects impersonating factory, WLD and unmapped vaults", async (context) => {
    context.vaults.set(FAKE_VAULT, { ...context.vaults.get(VAULT), registered: false });
    assert.equal((await call(context, "/register", OWNER, { vaultAddress: FAKE_VAULT })).status, 400);
    context.vaults.get(VAULT).factory = LEGACY;
    assert.equal((await call(context, "/register", OWNER, { vaultAddress: VAULT })).status, 400);
    context.vaults.get(VAULT).factory = FACTORY;
    context.vaults.get(VAULT).wld = LEGACY;
    assert.equal((await call(context, "/register", OWNER, { vaultAddress: VAULT })).status, 400);
  });
  await test("explicit legacy factory is checked against its own owner mapping", async (context) => {
    context.env.LEGACY_FACTORY_ADDRESS = LEGACY;
    context.vaults.get(VAULT).factory = LEGACY;
    await register(context);
    context.vaults.get(VAULT).registered = false;
    assert.equal((await call(context, `/status?vaultAddress=${VAULT}`)).status, 400);
  });
  await test("USDC yield identity selects asset and reward getters and accepts known released vaults", async (context) => {
    const state = configureUSDC(context, { expired: true });
    await register(context, USDC_VAULT);
    const snapshot = await __test.getVaultSnapshot(context.env, USDC_VAULT);
    assert.equal(snapshot.tokenAddress, USDC);
    assert.equal(snapshot.vaultBalance, 0n);
    assert.equal(snapshot.hasVaultAssets, true);
    const response = await call(context, "/check-now", OWNER, { vaultAddress: USDC_VAULT });
    assert.equal(response.status, 200, await response.text());
    assert.deepEqual(context.deliveries[0].wallet_addresses, [HEIR]);
    assert.equal(state.registered, false, "yield registry membership is independent of the owner's current slot");

    state.heir = ZERO;
    state.claimedAt = 1;
    assert.equal((await call(context, `/status?vaultAddress=${USDC_VAULT}`, HEIR)).status, 403);
    assert.equal((await call(context, `/status?vaultAddress=${USDC_VAULT}`, OWNER)).status, 200);
  });
  for (const [label, change] of [
    ["asset", (state) => { state.asset = WLD; }],
    ["reward token", (state) => { state.rewardToken = LEGACY; }],
    ["strategy", (state) => { state.strategy = LEGACY; }],
    ["factory source", (state) => { state.factory = LEGACY; }],
    ["source registry", (state) => { state.known = false; }],
  ]) {
    await test(`USDC yield identity rejects a wrong ${label}`, async (context) => {
      const state = configureUSDC(context);
      change(state);
      assert.equal((await call(context, `/status?vaultAddress=${USDC_VAULT}`)).status, 400);
    });
  }
  await test("partial, zero, conflicting and WLD-alias USDC settings fail closed", async (context) => {
    context.env.USDC_YIELD_FACTORY_ADDRESS = USDC_FACTORY;
    assert.equal((await call(context, `/status?vaultAddress=${VAULT}`)).status, 503);
    Object.assign(context.env, { USDC_MORPHO_VAULT_ADDRESS: USDC_STRATEGY, USDC_ADDRESS: USDC });
    context.env.USDC_ADDRESS = ZERO;
    assert.equal((await call(context, `/status?vaultAddress=${VAULT}`)).status, 503);
    context.env.USDC_ADDRESS = USDC;
    context.env.USDC_YIELD_FACTORY_ADDRESS = FACTORY;
    assert.equal((await call(context, `/status?vaultAddress=${VAULT}`)).status, 503);
    context.env.USDC_YIELD_FACTORY_ADDRESS = USDC_FACTORY;
    context.env.USDC_ADDRESS = WLD;
    assert.equal((await call(context, `/status?vaultAddress=${VAULT}`)).status, 503);
  });
  await test("caller-supplied owner/heir cannot replace onchain recipient identities", async (context) => {
    assert.equal((await call(context, "/register", OWNER, { vaultAddress: VAULT, heirAddress: STRANGER })).status, 400);
    assert.equal((await call(context, "/register", OWNER, { vaultAddress: VAULT, ownerAddress: STRANGER })).status, 400);
    assert.equal(await __test.getWatcherByVault(context.env, VAULT), null);
  });
  await test("test sends only to the signed-in wallet and uses fixed trusted text", async (context) => {
    assert.equal((await call(context, "/test", OWNER, { walletAddress: HEIR })).status, 403);
    assert.equal((await call(context, "/test", OWNER, { vaultAddress: OTHER_VAULT })).status, 403);
    assert.equal((await call(context, "/test", OWNER, { walletAddress: OWNER, title: "Send funds here", message: "arbitrary spam" })).status, 200);
    assert.equal(context.deliveries.length, 1);
    assert.deepEqual(context.deliveries[0].wallet_addresses, [OWNER]);
    assert.equal(context.deliveries[0].title, "WLD Inheritance Test");
    assert.equal(context.deliveries[0].message, "Test notification from your mini app.");
    assert.equal(context.deliveries[0].mini_app_path, "worldapp://mini-app?app_id=app_auth_test");
  });
  await test("vault notifications open the intended vault through World App's nested path", async (context) => {
    assert.equal((await call(context, "/test", OWNER, { vaultAddress: VAULT })).status, 200);
    assert.equal(context.deliveries.length, 1);
    const link = new URL(context.deliveries[0].mini_app_path);
    assert.equal(link.protocol, "worldapp:");
    assert.equal(link.hostname, "mini-app");
    assert.equal(link.searchParams.get("app_id"), context.env.WORLD_APP_ID);
    const destination = new URL(link.searchParams.get("path"), ORIGIN);
    assert.equal(destination.origin, ORIGIN);
    assert.equal(destination.pathname, "/");
    assert.equal(destination.searchParams.get("vault"), VAULT);
  });
  await test("test and check-now cooldowns survive fresh Worker instances", async (context) => {
    await register(context);
    for (const [endpoint, body] of [["/test", {}], ["/check-now", { vaultAddress: VAULT }]]) {
      assert.equal((await call(context, endpoint, OWNER, body)).status, 200);
      const freshWorker = (await import(`../backend/src/worker.mjs?instance=${endpoint}`)).default;
      const token = (await issueSession(SECRET, OWNER, ORIGIN)).token;
      const request = new Request(`https://notify.test/api/notifications${endpoint}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      const response = await freshWorker.fetch(request, context.env);
      assert.equal(response.status, 429);
      assert.equal(response.headers.get("Retry-After"), "60");
    }
  });
  await test("atomic cooldown enforces 60 s across wall-clock minute boundaries", async ({ DB }) => {
    assert.equal(await takeCooldown(DB, "boundary", 60_000, 59_999), true);
    assert.equal(await takeCooldown(DB, "boundary", 60_000, 60_001), false);
    assert.equal(await takeCooldown(DB, "boundary", 60_000, 119_999), true);
    const attempts = await Promise.all(Array.from({ length: 8 }, () => takeCooldown(DB, "concurrent", 60_000, 1000)));
    assert.equal(attempts.filter(Boolean).length, 1);
  });
  await test("general API rate limit persists and caps authenticated notification reads", async (context) => {
    assert.equal(await takeRateLimit(context.DB, `api:${OWNER}`, 60, 60_000), true);
    for (let index = 1; index < 60; index++) assert.equal(await takeRateLimit(context.DB, `api:${OWNER}`, 60, 60_000), true);
    assert.equal((await call(context, "", OWNER)).status, 429);
  });
  await test("delayed prior-window requests cannot reset the current API limit", async ({ DB, db }) => {
    const key = "api:window-order";
    assert.equal(await takeRateLimit(DB, key, 2, 60_000, 59_998), true);
    assert.equal(await takeRateLimit(DB, key, 2, 60_000, 60_001), true);
    assert.equal(await takeRateLimit(DB, key, 2, 60_000, 60_002), true);
    assert.equal(await takeRateLimit(DB, key, 2, 60_000, 60_003), false);
    assert.equal(await takeRateLimit(DB, key, 2, 60_000, 59_999), false);
    assert.equal(await takeRateLimit(DB, key, 2, 60_000, 60_004), false);
    const current = db.prepare("SELECT window_start, attempts, expires_at FROM auth_rate_limits WHERE rate_key = ?").get(key);
    assert.equal(current.window_start, 60_000);
    assert.equal(current.attempts, 2);
    assert.equal(current.expires_at, 120_000);
    assert.equal(await takeRateLimit(DB, key, 2, 60_000, 120_001), true);
    assert.equal(await takeRateLimit(DB, key, 2, 60_000, 60_005), false);
    assert.equal(await takeRateLimit(DB, key, 2, 60_000, 120_002), true);
    assert.equal(await takeRateLimit(DB, key, 2, 60_000, 120_003), false);
  });
  await test("check-now requires one authorized vault and never scans other watchers", async (context) => {
    context.vaults.get(VAULT).expired = true;
    context.vaults.get(VAULT).remaining = 0;
    await register(context);
    await register(context, OTHER_VAULT, OTHER_OWNER);
    assert.equal((await call(context, "/check-now", OWNER, {})).status, 400);
    const response = await call(context, "/check-now", OWNER, { vaultAddress: VAULT });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).summary.checked, 1);
    assert.equal(context.deliveries.length, 1);
    assert.deepEqual(context.deliveries[0].wallet_addresses, [HEIR]);
    assert.equal((await __test.getWatcherByVault(context.env, OTHER_VAULT)).lastCheckedAt, null);
  });
  await test("watcher list is caller-scoped and stale cached heir membership grants no access", async (context) => {
    await register(context);
    await register(context, OTHER_VAULT, OTHER_OWNER);
    let data = await (await call(context, "", HEIR)).json();
    assert.deepEqual(data.watchers.map((entry) => entry.vaultAddress), [VAULT]);
    context.vaults.get(VAULT).heir = STRANGER;
    data = await (await call(context, "", HEIR)).json();
    assert.deepEqual(data.watchers, []);
    assert.equal((await call(context, `/status?vaultAddress=${VAULT}`, HEIR)).status, 403);
  });
  await test("eleven related vaults are returned across stable four-candidate pages below the Free external limit", async (context) => {
    const addresses = await addRelatedWatchers(context);
    let externalCalls = 0;
    globalThis.fetch = async (input, init) => {
      externalCalls++;
      if (externalCalls > 50) throw new Error("Too many external subrequests");
      return context.mockFetch(input, init);
    };
    const found = [];
    const counts = [];
    let cursor = null;
    do {
      externalCalls = 0;
      const response = await call(context, cursor ? `?cursor=${cursor}` : "", HEIR);
      assert.equal(response.status, 200, await response.clone().text());
      const data = await response.json();
      assert.ok(data.watchers.length <= 4);
      found.push(...data.watchers.map((entry) => entry.vaultAddress));
      assert.ok(externalCalls <= 24, `${externalCalls} external calls exceeds the four-candidate bound`);
      counts.push(externalCalls);
      assert.ok(data.nextCursor === null || !cursor || data.nextCursor > cursor);
      cursor = data.nextCursor;
    } while (cursor);
    assert.deepEqual(found, addresses);
    assert.deepEqual(counts, [24, 24, 18]);
    externalCalls = 0;
    assert.equal((await call(context, `?cursor=${addresses[3]}`, HEIR, undefined, null)).status, 401);
    assert.equal(externalCalls, 0, "Unauthenticated pagination must not make chain requests");
  });
  await test("watcher cursor is validated and filtered empty pages still advance to authorized vaults", async (context) => {
    const addresses = await addRelatedWatchers(context, 9);
    for (const address of addresses.slice(0, 4)) context.vaults.get(address).heir = STRANGER;
    for (const cursor of ["", "bad", "0x1", `${VAULT}extra`]) {
      assert.equal((await call(context, `?cursor=${encodeURIComponent(cursor)}`, HEIR)).status, 400);
    }
    let response = await call(context, "", HEIR);
    assert.equal(response.status, 200);
    let data = await response.json();
    assert.deepEqual(data.watchers, []);
    assert.equal(data.nextCursor, addresses[3]);
    response = await call(context, `?cursor=${data.nextCursor.toUpperCase().replace("0X", "0x")}`, HEIR);
    assert.equal(response.status, 200);
    data = await response.json();
    assert.deepEqual(data.watchers.map((entry) => entry.vaultAddress), addresses.slice(4, 8));
    assert.equal(data.nextCursor, addresses[7]);
    response = await call(context, `?cursor=${addresses.at(-1)}`, HEIR);
    assert.deepEqual(await response.json(), { status: "success", watchers: [], nextCursor: null });
  });
  await test("USDC discovery pages and two-watcher notification cycles remain below 50 external requests", async (context) => {
    const state = configureUSDC(context, { expired: true, remaining: 0 });
    const addresses = await addRelatedWatchers(context);
    for (const address of addresses) context.vaults.set(address, { ...state, owner: context.vaults.get(address).owner });
    let externalCalls = 0;
    globalThis.fetch = async (input, init) => {
      if (++externalCalls > 50) throw new Error("Too many external subrequests");
      return context.mockFetch(input, init);
    };
    const found = [], counts = [];
    let cursor = null;
    do {
      externalCalls = 0;
      const response = await call(context, cursor ? `?cursor=${cursor}` : "", HEIR);
      assert.equal(response.status, 200, await response.clone().text());
      const data = await response.json();
      found.push(...data.watchers.map(watcher => watcher.vaultAddress));
      counts.push(externalCalls);
      cursor = data.nextCursor;
    } while (cursor);
    assert.deepEqual(found, addresses);
    assert.deepEqual(counts, [44, 44, 33]);
    externalCalls = 0;
    const cycle = await __test.runCheckCycle(context.env);
    assert.equal(cycle.checked, 2);
    assert.equal(cycle.notified, 2);
    assert.equal(context.deliveries.length, 2);
    assert.equal(externalCalls, 42);
    console.log("  USDC pages: 44/44/33 requests; notification cycle: 42 requests");
  });
  await test("RPC failures during watcher verification fail the page instead of reporting partial success", async (context) => {
    const addresses = await addRelatedWatchers(context, 9);
    globalThis.fetch = async (input, init) => {
      const body = JSON.parse(init.body);
      if (body.params?.[0]?.to.toLowerCase() === addresses[1]) throw new Error("RPC temporarily unavailable");
      return context.mockFetch(input, init);
    };
    const response = await call(context, "", HEIR);
    assert.equal(response.status, 503);
    const data = await response.json();
    assert.equal(data.status, "error");
    assert.equal(data.watchers, undefined);
  });
  await test("pagination keeps existing cron batches ordered by oldest check", async (context) => {
    const addresses = await addRelatedWatchers(context, 9);
    for (const address of addresses) {
      context.db.prepare("UPDATE watchers SET last_checked_at = ? WHERE vault_address = ?").run("2026-10-01T10:00:00.000Z", address);
    }
    context.db.prepare("UPDATE watchers SET last_checked_at = ? WHERE vault_address = ?").run("2026-10-01T08:00:00.000Z", addresses[7]);
    context.db.prepare("UPDATE watchers SET last_checked_at = ? WHERE vault_address = ?").run("2026-10-01T09:00:00.000Z", addresses[4]);
    assert.deepEqual((await __test.listWatchers(context.env, true)).map((entry) => entry.vaultAddress), [addresses[7], addresses[4]]);
  });
  await test("alerts survive SELECT, list and repeated register upserts", async (context) => {
    const alerts = { heir_claimable: { at: new Date().toISOString(), delivered: true } };
    await __test.saveWatcher(context.env, watcher(VAULT, OWNER, HEIR, alerts));
    assert.deepEqual((await __test.getWatcherByVault(context.env, VAULT)).alerts, alerts);
    assert.deepEqual((await __test.listWatchers(context.env, true))[0].alerts, alerts);
    await register(context);
    await register(context);
    assert.deepEqual((await __test.getWatcherByVault(context.env, VAULT)).alerts, alerts);
  });
  await test("cron persists alert attempts before send and does not redeliver within cooldown", async (context) => {
    context.vaults.get(VAULT).pending = true;
    context.vaults.get(VAULT).challengeEndsAt = Math.floor(Date.now() / 1000) + 86400;
    await register(context);
    context.setSendHook(async () => {
      assert.equal((await __test.getWatcherByVault(context.env, VAULT)).alerts.owner_claim_filed.delivered, false);
    });
    await __test.runCheckCycle(context.env);
    await __test.runCheckCycle(context.env);
    await register(context);
    await __test.runCheckCycle(context.env);
    assert.equal(context.deliveries.length, 1);
    assert.equal((await __test.getWatcherByVault(context.env, VAULT)).alerts.owner_claim_filed.delivered, true);
  });
  await test("simultaneous check cycles acquire one durable lease and send once", async (context) => {
    context.vaults.get(VAULT).expired = true;
    context.vaults.get(VAULT).remaining = 0;
    await register(context);
    await Promise.all([__test.runCheckCycle(context.env), __test.runCheckCycle(context.env)]);
    assert.equal(context.deliveries.length, 1);
    assert.equal(context.db.prepare("SELECT COUNT(*) AS count FROM notification_leases").get().count, 0);
  });
  await test("accepted send followed by failed DB writes retains a durable attempt cooldown", async (context) => {
    context.vaults.get(VAULT).expired = true;
    context.vaults.get(VAULT).remaining = 0;
    await register(context);
    let failWrites = false;
    const prepare = context.DB.prepare.bind(context.DB);
    context.DB.prepare = (sql) => {
      const statement = prepare(sql);
      const run = statement.run.bind(statement);
      statement.run = async (...args) => {
        if (failWrites && /INSERT INTO watchers/i.test(sql)) throw new Error("simulated post-send DB failure");
        return run(...args);
      };
      return statement;
    };
    context.setSendHook(async () => { failWrites = true; });
    await assert.rejects(__test.runCheckCycle(context.env), /simulated post-send DB failure/);
    failWrites = false;
    const stored = await __test.getWatcherByVault(context.env, VAULT);
    assert.equal(stored.alerts.heir_claimable.reason, "delivery in progress");
    await __test.runCheckCycle(context.env);
    assert.equal(context.deliveries.length, 1);
  });
  await test("observed countdown renewal rearms expiry warnings", async (context) => {
    const state = context.vaults.get(VAULT);
    state.remaining = 100;
    await register(context);
    await __test.runCheckCycle(context.env);
    state.remaining = state.interval;
    await __test.runCheckCycle(context.env);
    assert.equal((await __test.getWatcherByVault(context.env, VAULT)).alerts.owner_expiring, undefined);
    state.remaining = 100;
    await __test.runCheckCycle(context.env);
    assert.equal(context.deliveries.length, 2);
  });
  await test("completed zero-heir vault still exposes a canonical snapshot and owner status", async (context) => {
    await register(context);
    Object.assign(context.vaults.get(VAULT), { heir: ZERO, claimedAt: Math.floor(Date.now() / 1000), balance: 0n });
    const snapshot = await __test.getVaultSnapshot(context.env, VAULT);
    assert.equal(snapshot.heirAddress, ZERO);
    assert.ok(snapshot.claimedAt > 0n);
    assert.equal((await call(context, `/status?vaultAddress=${VAULT}`, OWNER)).status, 200);
    const listed = await (await call(context, "", OWNER)).json();
    assert.deepEqual(listed.watchers.map((entry) => entry.vaultAddress), [VAULT]);
    assert.equal(listed.watchers[0].heirAddress, ZERO);
  });
  await test("completed vault grants no cached former-heir or stranger access", async (context) => {
    await register(context);
    Object.assign(context.vaults.get(VAULT), { heir: ZERO, claimedAt: Math.floor(Date.now() / 1000), balance: 0n });
    for (const address of [HEIR, STRANGER]) {
      for (const [endpoint, body] of [[`/status?vaultAddress=${VAULT}`, undefined], ["/register", { vaultAddress: VAULT }],
        ["/check-now", { vaultAddress: VAULT }], ["/unregister", { vaultAddress: VAULT }], ["/test", { vaultAddress: VAULT }]]) {
        assert.equal((await call(context, endpoint, address, body)).status, 403);
      }
      assert.deepEqual((await (await call(context, "", address)).json()).watchers, []);
    }
    // Even a mixed-block read retaining the old nonzero heir cannot grant access
    // once the required settlement timestamp proves the irreversible claim.
    context.vaults.get(VAULT).heir = HEIR;
    assert.equal((await call(context, `/status?vaultAddress=${VAULT}`, HEIR)).status, 403);
    assert.equal(context.deliveries.length, 0);
  });
  await test("completed checks deactivate safely and registration never rearms terminal delivery", async (context) => {
    const stamp = new Date().toISOString();
    const alerts = { heir_finalizable: { at: stamp, delivered: true } };
    await __test.saveWatcher(context.env, { ...watcher(VAULT, OWNER, HEIR, alerts), notifiedHeirAddress: HEIR, notifiedAt: stamp });
    // Late deposits do not revive inheritance reminders after the irreversible claim.
    Object.assign(context.vaults.get(VAULT), { heir: ZERO, claimedAt: Math.floor(Date.now() / 1000), balance: 1n, finalizable: true });
    assert.deepEqual(await __test.runCheckCycle(context.env), { checked: 1, notified: 0 });
    let stored = await __test.getWatcherByVault(context.env, VAULT);
    assert.equal(stored.active, false);
    assert.equal(stored.lastClaimable, false);
    assert.equal(stored.heirAddress, ZERO);
    assert.equal(stored.lastError, null);
    assert.deepEqual(stored.alerts, alerts);
    assert.deepEqual(await __test.runCheckCycle(context.env), { checked: 0, notified: 0 });
    await register(context);
    stored = await __test.getWatcherByVault(context.env, VAULT);
    assert.equal(stored.active, false);
    assert.deepEqual(stored.alerts, alerts);
    assert.equal(stored.notifiedHeirAddress, HEIR);
    assert.equal(stored.notifiedAt, stamp);
    assert.equal((await call(context, "/unregister", OWNER, { vaultAddress: VAULT })).status, 200);
    assert.equal(context.deliveries.length, 0);
  });
  await test("manual payout remains monitored before finality and a removed payout resumes alerts", async (context) => {
    const state = context.vaults.get(VAULT);
    Object.assign(state, { expired: true, pending: true, finalizable: true, challengeEndsAt: 1 });
    context.finalizedVaults.set(VAULT, { ...state });
    await register(context);
    Object.assign(state, { heir: ZERO, claimedAt: Math.floor(Date.now() / 1000), balance: 0n });
    await __test.runCheckCycle(context.env);
    let stored = await __test.getWatcherByVault(context.env, VAULT);
    assert.equal(stored.active, true);
    assert.equal(stored.heirAddress, HEIR);
    assert.equal(context.deliveries.length, 0);
    // Re-registering during the provisional payout must retain the same monitor.
    await register(context);
    stored = await __test.getWatcherByVault(context.env, VAULT);
    assert.equal(stored.active, true);
    assert.equal(stored.heirAddress, HEIR);
    Object.assign(state, context.finalizedVaults.get(VAULT));
    const result = await __test.runCheckCycle(context.env);
    assert.equal(result.checked, 1);
    assert.equal(result.notified, 1);
    assert.deepEqual(context.deliveries[0].wallet_addresses, [HEIR]);
    assert.equal(context.db.prepare("SELECT active FROM watchers WHERE vault_address=?").get(VAULT).active, 1);
    // After an actually finalized payout it can be retired permanently.
    Object.assign(state, { heir: ZERO, claimedAt: Math.floor(Date.now() / 1000), balance: 0n });
    context.finalizedVaults.set(VAULT, { ...state });
    await __test.runCheckCycle(context.env);
    assert.equal((await __test.getWatcherByVault(context.env, VAULT)).active, false);
  });
  await test("unavailable finalized payout evidence never retires a monitor", async (context) => {
    await register(context);
    Object.assign(context.vaults.get(VAULT), { heir: ZERO, claimedAt: Math.floor(Date.now() / 1000), balance: 0n });
    globalThis.fetch = async (input, init) => {
      if (JSON.parse(init.body).params?.[1] === "finalized") return Response.json({ error: { message: "finality unavailable" } });
      return context.mockFetch(input, init);
    };
    await __test.runCheckCycle(context.env);
    assert.equal((await __test.getWatcherByVault(context.env, VAULT)).active, true);
    await register(context);
    assert.equal((await __test.getWatcherByVault(context.env, VAULT)).active, true);
    assert.equal(context.deliveries.length, 0);
  });
  await test("provisional slot release remains monitored until it is finalized", async (context) => {
    await register(context);
    const state = context.vaults.get(VAULT);
    context.finalizedVaults.set(VAULT, { ...state });
    state.registered = false;
    assert.equal((await call(context, `/status?vaultAddress=${VAULT}`, OWNER)).status, 400);
    await __test.runCheckCycle(context.env);
    assert.equal((await __test.getWatcherByVault(context.env, VAULT)).active, true);
    state.registered = true;
    assert.equal((await __test.runCheckCycle(context.env)).checked, 1);
    assert.equal((await __test.getWatcherByVault(context.env, VAULT)).lastError, null);
    state.registered = false;
    context.finalizedVaults.set(VAULT, { ...state });
    await __test.runCheckCycle(context.env);
    assert.equal((await __test.getWatcherByVault(context.env, VAULT)).active, false);
    assert.equal(context.deliveries.length, 0);
  });
  await test("zero heir without settlement proof or failed settlement read cannot authorize or deactivate", async (context) => {
    await register(context);
    context.vaults.get(VAULT).heir = ZERO;
    assert.equal((await call(context, `/status?vaultAddress=${VAULT}`, OWNER)).status, 400);
    await __test.runCheckCycle(context.env);
    assert.equal((await __test.getWatcherByVault(context.env, VAULT)).active, true);
    globalThis.fetch = async (input, init) => {
      const body = JSON.parse(init.body);
      if (body.params?.[0]?.data === "0xd2217fac") return Response.json({ error: { message: "settlement read unavailable" } });
      return context.mockFetch(input, init);
    };
    assert.equal((await call(context, `/status?vaultAddress=${VAULT}`, OWNER)).status, 500);
    await __test.runCheckCycle(context.env);
    assert.equal((await __test.getWatcherByVault(context.env, VAULT)).active, true);
    assert.equal(context.deliveries.length, 0);
  });
  await test("terminal identity still requires trusted factory, WLD and current owner mapping", async (context) => {
    await register(context);
    const state = context.vaults.get(VAULT);
    Object.assign(state, { heir: ZERO, claimedAt: Math.floor(Date.now() / 1000) });
    state.wld = LEGACY;
    assert.equal((await call(context, `/status?vaultAddress=${VAULT}`, OWNER)).status, 400);
    state.wld = WLD;
    state.factory = LEGACY;
    assert.equal((await call(context, `/status?vaultAddress=${VAULT}`, OWNER)).status, 400);
    context.env.LEGACY_FACTORY_ADDRESS = LEGACY;
    assert.equal((await call(context, `/status?vaultAddress=${VAULT}`, OWNER)).status, 200);
    state.registered = false;
    assert.equal((await call(context, `/status?vaultAddress=${VAULT}`, OWNER)).status, 400);
    // A released slot cannot authorize access, and it no longer needs minute scans.
    await __test.runCheckCycle(context.env);
    assert.equal((await __test.getWatcherByVault(context.env, VAULT)).active, false);
    assert.deepEqual(await __test.runCheckCycle(context.env), { checked: 0, notified: 0 });
    assert.equal(context.deliveries.length, 0);
  });
  await test("CORS preflight permits Authorization and disallowed Origin is rejected", async (context) => {
    const preflight = await worker.fetch(new Request("https://notify.test/api/notifications/test", { method: "OPTIONS", headers: { Origin: ORIGIN } }), context.env);
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get("Access-Control-Allow-Headers"), /Authorization/);
    assert.equal((await worker.fetch(new Request("https://notify.test/api/notifications", { headers: { Origin: "https://other.test" } }), context.env)).status, 403);
  });

  function storage() {
    const values = new Map();
    return { getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key, value); }, removeItem(key) { values.delete(key); }, clear() { values.clear(); } };
  }
  globalThis.sessionStorage = storage();
  globalThis.localStorage = storage();
  globalThis.location = { origin: ORIGIN };
  await test("frontend rejects legacy address caches, stores tab session and attaches Bearer", async (context) => {
    frontend.clearSession();
    localStorage.setItem("wld-session", JSON.stringify({ address: STRANGER, at: Date.now() }));
    assert.equal(frontend.readSessionAddress(), null);
    globalThis.fetch = async (input, init) => {
      if (input === "/api/auth/nonce") return getNonce(context.env);
      if (input === "/api/auth/verify") return verify(context.env, JSON.parse(init.body));
      if (input.startsWith("https://notify.test/")) return worker.fetch(new Request(input, init), context.env);
      return context.mockFetch(input, init);
    };
    const result = await frontend.signInWithWorldApp(async (nonce) => ({ ok: true, ...(await signed(nonce)).payload }));
    assert.equal(result.ok, true);
    assert.equal(frontend.readSessionAddress().toLowerCase(), OWNER);
    assert.equal(localStorage.getItem("wld-session"), null);
    assert.ok(JSON.parse(sessionStorage.getItem("wld-session")).token);
    assert.equal((await frontend.notificationFetch("https://notify.test/api/notifications/test", { method: "POST", body: "{}" })).status, 200);
    assert.deepEqual(context.deliveries[0].wallet_addresses, [OWNER]);
  });
  await test("frontend expiry, token/address mismatch, logout and backend 401 clear credentials", async () => {
    const events = [];
    globalThis.window = { dispatchEvent(event) { events.push(event.type); } };
    frontend.clearSession();
    const session = await issueSession(SECRET, OWNER, ORIGIN);
    sessionStorage.setItem("wld-session", JSON.stringify({ address: STRANGER, ...session }));
    assert.equal(frontend.readSessionAddress(), null);
    const expired = await issueSession(SECRET, OWNER, ORIGIN, Date.now() - 3600_000);
    sessionStorage.setItem("wld-session", JSON.stringify({ address: OWNER, ...expired }));
    assert.equal(frontend.readSessionAddress(), null);
    assert.equal((await frontend.notificationFetch("https://notify.test/api/notifications")).status, 401);
    assert.deepEqual(events, ["inheritance:session-expired"]);
    sessionStorage.setItem("wld-session", JSON.stringify({ address: OWNER, ...session }));
    globalThis.fetch = async () => new Response(null, { status: 401 });
    assert.equal((await frontend.notificationFetch("https://notify.test/api/notifications")).status, 401);
    assert.deepEqual(events, ["inheritance:session-expired", "inheritance:session-expired"]);
    assert.equal(frontend.readSessionAddress(), null);
    sessionStorage.setItem("wld-session", JSON.stringify({ address: OWNER, ...session }));
    frontend.clearSession();
    assert.equal(sessionStorage.getItem("wld-session"), null);
    assert.equal(frontend.readSessionAddress(), null);
  });
  await test("server-issued sessions accept slow or fast device clocks while server expiry remains authoritative", async () => {
    const now = Date.now();
    const session = await issueSession(SECRET, OWNER, ORIGIN, now);
    const clock = Date.now;
    globalThis.fetch = async input => input === "/api/auth/nonce" ? Response.json({ nonce: "ab".repeat(32) })
      : Response.json({ isValid: true, address: OWNER, ...session });
    try {
      for (const offset of [-60_000, 60_000]) {
        frontend.clearSession();
        Date.now = () => now + offset;
        const result = await frontend.signInWithWorldApp(async () => ({ ok: true, address: OWNER, message: "server-verified fixture", signature: "fixture" }));
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.equal(frontend.readSessionAddress(), OWNER);
      }
      const expired = await issueSession(SECRET, OWNER, ORIGIN, now - 3600_000);
      assert.equal(await verifySession(SECRET, expired.token, ORIGIN, now), null);
    } finally { Date.now = clock; frontend.clearSession(); }
  });
  await test("a delayed previous-session 401 preserves a newly verified login", async (context) => {
    const events = [];
    globalThis.window = { dispatchEvent(event) { events.push(event.type); } };
    frontend.clearSession();
    const previous = await issueSession(SECRET, OWNER, ORIGIN, Date.now() - 1000);
    sessionStorage.setItem("wld-session", JSON.stringify({ address: OWNER, ...previous }));
    const held = [];
    globalThis.fetch = async () => new Promise(resolve => held.push(resolve));
    const first = frontend.notificationFetch("https://notify.test/old-first");
    const delayed = frontend.notificationFetch("https://notify.test/old-second");
    assert.equal(held.length, 2);
    held[0](new Response(null, { status: 401 }));
    assert.equal((await first).status, 401);
    assert.equal(frontend.readSessionAddress(), null);
    globalThis.fetch = async (input, init) => {
      if (input === "/api/auth/nonce") return getNonce(context.env);
      if (input === "/api/auth/verify") {
        // SDK verification runs on the server, outside the simulated browser.
        const browser = globalThis.window;
        delete globalThis.window;
        try { return await verify(context.env, JSON.parse(init.body)); }
        finally { globalThis.window = browser; }
      }
      return context.mockFetch(input, init);
    };
    const reconnected = await frontend.signInWithWorldApp(async nonce => ({ ok: true, ...(await signed(nonce)).payload }));
    assert.equal(reconnected.ok, true, JSON.stringify(reconnected));
    const next = sessionStorage.getItem("wld-session");
    assert.notEqual(JSON.parse(next).token, previous.token);
    held[1](new Response(null, { status: 401 }));
    assert.equal((await delayed).status, 401);
    assert.equal(sessionStorage.getItem("wld-session"), next);
    assert.equal(frontend.readSessionAddress().toLowerCase(), OWNER);
    assert.deepEqual(events, ["inheritance:session-expired"]);
  });
  const storeHeirSession = async () => {
    frontend.clearSession();
    sessionStorage.setItem("wld-session", JSON.stringify({ address: HEIR, ...(await issueSession(SECRET, HEIR, ORIGIN)) }));
  };
  await test("frontend authenticated pagination returns all related vaults and exposes a capped scan", async (context) => {
    const addresses = await addRelatedWatchers(context);
    await storeHeirSession();
    const externalCounts = [];
    let externalCalls = 0;
    globalThis.fetch = async (input, init) => {
      if (input.startsWith("https://notify.test/")) {
        assert.match(new Headers(init.headers).get("Authorization"), /^Bearer v1\./);
        externalCalls = 0;
        const response = await worker.fetch(new Request(input, init), context.env);
        externalCounts.push(externalCalls);
        return response;
      }
      externalCalls++;
      if (externalCalls > 50) throw new Error("Too many external subrequests");
      return context.mockFetch(input, init);
    };
    const data = await frontend.fetchRegisteredVaults("https://notify.test/");
    assert.deepEqual(data.watchers.map((entry) => entry.vaultAddress), addresses);
    assert.equal(data.truncated, false);
    assert.deepEqual(externalCounts, [24, 24, 18]);
    const capped = await frontend.fetchRegisteredVaults("https://notify.test", 1);
    assert.equal(capped.watchers.length, 4);
    assert.equal(capped.truncated, true);
  });
  await test("frontend follows empty pages and accepts older responses without a continuation cursor", async () => {
    await storeHeirSession();
    const urls = [];
    globalThis.fetch = async (input) => {
      urls.push(input);
      if (urls.length === 1) return Response.json({ status: "success", watchers: [], nextCursor: OTHER_VAULT });
      return Response.json({ status: "success", watchers: [{ vaultAddress: VAULT }] });
    };
    const data = await frontend.fetchRegisteredVaults("https://notify.test");
    assert.deepEqual(data, { watchers: [{ vaultAddress: VAULT }], truncated: false });
    assert.equal(new URL(urls[1]).searchParams.get("cursor"), OTHER_VAULT);
  });
  await test("frontend rejects malformed, repeated or backwards cursors and backend page failures", async () => {
    await storeHeirSession();
    for (const nextCursor of ["bad-cursor", "", 42, {}]) {
      globalThis.fetch = async () => Response.json({ status: "success", watchers: [], nextCursor });
      await assert.rejects(frontend.fetchRegisteredVaults("https://notify.test"), /Invalid registered vault cursor/);
    }
    for (const secondCursor of [VAULT, OTHER_VAULT]) {
      let pages = 0;
      globalThis.fetch = async () => Response.json({ status: "success", watchers: [], nextCursor: ++pages === 1 ? VAULT : secondCursor });
      await assert.rejects(frontend.fetchRegisteredVaults("https://notify.test"), /cursor did not advance/);
    }
    globalThis.fetch = async () => Response.json({ status: "error", message: "RPC temporarily unavailable" }, { status: 503 });
    await assert.rejects(frontend.fetchRegisteredVaults("https://notify.test"), /RPC temporarily unavailable/);
    await assert.rejects(frontend.fetchRegisteredVaults("https://notify.test", 0), /Invalid notification page limit/);
  });
  await test("frontend paginated 401 clears the session and never returns an incomplete success", async () => {
    await storeHeirSession();
    let pages = 0;
    globalThis.fetch = async () => ++pages === 1
      ? Response.json({ status: "success", watchers: [{ vaultAddress: OTHER_VAULT }], nextCursor: OTHER_VAULT })
      : Response.json({ status: "error", message: "Your sign-in expired. Sign in again." }, { status: 401 });
    await assert.rejects(frontend.fetchRegisteredVaults("https://notify.test"), /sign-in expired/);
    assert.equal(pages, 2);
    assert.equal(frontend.readSessionAddress(), null);
  });
} finally {
  await vite.close();
  globalThis.fetch = realFetch;
  delete globalThis.sessionStorage;
  delete globalThis.localStorage;
  delete globalThis.location;
  delete globalThis.window;
}
console.log(`\n${passed} passed / ${failed} failed`);
process.exitCode = failed ? 1 : 0;
