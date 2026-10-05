import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "../app/node_modules/vite/dist/node/index.js";

const address = value => `0x${BigInt(value).toString(16).padStart(40, "0")}`;
const upperAddressBody = value => `0x${value.slice(2).toUpperCase()}`;
const fixture = {
  VITE_FACTORY_ADDRESS: address(1),
  VITE_FACTORY_DEPLOY_BLOCK: "10",
  VITE_LEGACY_FACTORY_ADDRESS: address(2),
  VITE_LEGACY_FACTORY_DEPLOY_BLOCK: "5",
  VITE_WLD_ADDRESS: address(10),
  VITE_YIELD_FACTORY_ADDRESS: address(11),
  VITE_YIELD_FACTORY_DEPLOY_BLOCK: "100",
  VITE_MORPHO_VAULT_ADDRESS: address(12),
  VITE_LEGACY_YIELD_FACTORY_ADDRESSES: "",
  VITE_LEGACY_YIELD_FACTORY_DEPLOY_BLOCK: "",
  VITE_USDC_ADDRESS: address(20),
  VITE_USDC_YIELD_FACTORY_ADDRESS: address(21),
  VITE_USDC_YIELD_FACTORY_DEPLOY_BLOCK: "200",
  VITE_USDC_MORPHO_VAULT_ADDRESS: address(22),
  VITE_LEGACY_USDC_YIELD_FACTORY_ADDRESSES: "",
  VITE_LEGACY_USDC_YIELD_FACTORY_DEPLOY_BLOCK: "",
  VITE_RPC: "",
  VITE_REQUIRE_VERIFY: "false",
  VITE_WORLD_ACTION_ID: "",
  VITE_FACTORY_RELEASE_SUPPORTED: "",
  VITE_NOTIFY_BACKEND_URL: "",
  VITE_APP_ORIGIN: "",
};

// The test process is isolated from application defaults: do not let any other
// inherited VITE_ variable join the explicit fixture, and do not load .env files.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("VITE_") && !(key in fixture)) delete process.env[key];
}

const root = fileURLToPath(new URL("../app/", import.meta.url));
let checks = 0;
const check = async (name, run) => {
  await run();
  checks++;
  console.log(`PASS ${name}`);
};

const loadFixture = async (overrides, verify) => {
  const env = { ...fixture, ...overrides };
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  const vite = await createServer({
    root,
    configFile: false,
    envDir: false,
    logLevel: "error",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false },
  });
  try {
    const [config, assets, yieldAbi, basicAbi] = await Promise.all([
      vite.ssrLoadModule("/src/config.ts"),
      vite.ssrLoadModule("/src/assets.ts"),
      vite.ssrLoadModule("/src/yield.ts"),
      vite.ssrLoadModule("/src/abis.ts"),
    ]);
    await verify({ config, assets, yieldAbi, basicAbi });
  } finally {
    await vite.close();
  }
};

const expectConfigError = (name, overrides, message) => check(name, () => loadFixture(overrides, ({ config, assets }) => {
  assert.ok(config.CONFIG_ERROR, "invalid legacy route configuration must be exposed through CONFIG_ERROR");
  assert.ok(config.CONFIG_ERROR.includes(message), `expected CONFIG_ERROR to include ${message}`);
  assert.equal(assets.YIELD_ROUTES.some(route => route.legacy), false, "invalid routes must not be emitted");
}));

await check("primary WLD and USDC routes remain first and opt into income capability", () => loadFixture({}, ({ config, assets, yieldAbi, basicAbi }) => {
  assert.equal(config.CONFIG_ERROR, null);
  assert.deepEqual(assets.PRIMARY_YIELD_ROUTES.map(route => route.factory), [address(11), address(21)]);
  assert.deepEqual(assets.YIELD_ROUTES.map(route => route.factory), [address(11), address(21)]);
  assert.equal(assets.YIELD_ROUTES.find(route => route.symbol === "WLD").factory, address(11));
  assert.equal(assets.YIELD_ROUTES.find(route => route.symbol === "USDC").factory, address(21));
  assert.equal(assets.PRIMARY_YIELD_ROUTES[0].legacy, undefined);
  assert.equal(assets.PRIMARY_YIELD_ROUTES[0].factoryAbi, yieldAbi.INCOME_YIELD_FACTORY_ABI);
  assert.equal(assets.PRIMARY_YIELD_ROUTES[0].vaultAbi, yieldAbi.INCOME_YIELD_VAULT_ABI);
  assert.equal(assets.PRIMARY_YIELD_ROUTES[1].factoryAbi, yieldAbi.USDC_INCOME_YIELD_FACTORY_ABI);
  assert.equal(assets.PRIMARY_YIELD_ROUTES[1].vaultAbi, yieldAbi.USDC_INCOME_YIELD_VAULT_ABI);
  const contains = (abi, name) => abi.some(fragment => typeof fragment === "string"
    ? fragment.startsWith(`function ${name}(`) : fragment?.type === "function" && fragment.name === name);
  for (const [abi, functionName] of [[basicAbi.FACTORY_ABI, "withdrawIncomeFromMyVault"],
    [basicAbi.VAULT_ABI, "incomePosition"], [basicAbi.VAULT_ABI, "ownerWithdrawIncome"]]) {
    assert.equal(contains(abi, functionName), false, `basic ABI unexpectedly requires ${functionName}`);
  }
  assert.equal(assets.vaultLabel(address(11)), "WLD · Morpho yield");
}));

await check("both asset generations resolve with their matching token, strategy, ABIs and shared blocks", () => loadFixture({
  VITE_LEGACY_YIELD_FACTORY_ADDRESSES: `${address(31)}, ${upperAddressBody(address(32))}`,
  VITE_LEGACY_YIELD_FACTORY_DEPLOY_BLOCK: "75",
  VITE_LEGACY_USDC_YIELD_FACTORY_ADDRESSES: address(41),
  VITE_LEGACY_USDC_YIELD_FACTORY_DEPLOY_BLOCK: "175",
}, ({ config, assets, yieldAbi }) => {
  assert.equal(config.CONFIG_ERROR, null);
  const expected = [address(11), address(21), address(31), address(32), address(41)];
  assert.deepEqual(assets.YIELD_ROUTES.map(route => route.factory), expected);
  assert.deepEqual(assets.PRIMARY_YIELD_ROUTES.map(route => route.factory), expected.slice(0, 2));
  assert.equal(assets.YIELD_ROUTES.find(route => route.symbol === "WLD").factory, address(11));
  assert.equal(assets.YIELD_ROUTES.find(route => route.symbol === "USDC").factory, address(21));
  for (const factory of [address(31), address(32)]) {
    const route = assets.yieldRouteFor(factory);
    assert.equal(route.legacy, true);
    assert.equal(route.symbol, "WLD");
    assert.equal(route.asset, config.WLD_ADDRESS);
    assert.equal(route.strategy, config.MORPHO_VAULT_ADDRESS);
    assert.equal(route.block, 75);
    assert.equal(route.factoryAbi, yieldAbi.YIELD_FACTORY_ABI);
    assert.equal(route.vaultAbi, yieldAbi.YIELD_VAULT_ABI);
    assert.equal(route.tokenGetter, "WLD");
    assert.ok(assets.TRUSTED_FACTORIES.includes(factory));
    assert.equal(assets.vaultLabel(factory), "WLD · Legacy Morpho yield");
  }
  const usdcRoute = assets.yieldRouteFor(address(41));
  assert.equal(usdcRoute.legacy, true);
  assert.equal(usdcRoute.symbol, "USDC");
  assert.equal(usdcRoute.asset, config.USDC_ADDRESS);
  assert.equal(usdcRoute.strategy, config.USDC_MORPHO_VAULT_ADDRESS);
  assert.equal(usdcRoute.block, 175);
  assert.equal(usdcRoute.factoryAbi, yieldAbi.USDC_YIELD_FACTORY_ABI);
  assert.equal(usdcRoute.vaultAbi, yieldAbi.USDC_YIELD_VAULT_ABI);
  assert.equal(usdcRoute.tokenGetter, "asset");
  assert.ok(assets.TRUSTED_FACTORIES.includes(address(41)));
  assert.equal(assets.vaultLabel(address(41)), "USDC · Legacy Morpho yield");
}));

await check("an empty list means no legacy routes and does not require a deployment block", () => loadFixture({
  VITE_LEGACY_YIELD_FACTORY_ADDRESSES: "  ",
  VITE_LEGACY_YIELD_FACTORY_DEPLOY_BLOCK: "not-used-with-an-empty-list",
  VITE_LEGACY_USDC_YIELD_FACTORY_ADDRESSES: "",
  VITE_LEGACY_USDC_YIELD_FACTORY_DEPLOY_BLOCK: "",
}, ({ config, assets }) => {
  assert.equal(config.CONFIG_ERROR, null);
  assert.deepEqual(config.LEGACY_YIELD_FACTORY_ADDRESSES, []);
  assert.deepEqual(config.LEGACY_USDC_YIELD_FACTORY_ADDRESSES, []);
  assert.equal(assets.YIELD_ROUTES.some(route => route.legacy), false);
}));

await check("eight legacy addresses are accepted", () => {
  const addresses = Array.from({ length: 8 }, (_, index) => address(100 + index));
  return loadFixture({
    VITE_LEGACY_YIELD_FACTORY_ADDRESSES: addresses.join(","),
    VITE_LEGACY_YIELD_FACTORY_DEPLOY_BLOCK: "300",
  }, ({ config, assets }) => {
    assert.equal(config.CONFIG_ERROR, null);
    assert.deepEqual(config.LEGACY_YIELD_FACTORY_ADDRESSES, addresses);
    assert.deepEqual(assets.YIELD_ROUTES.slice(2).map(route => route.factory), addresses);
    assert.ok(assets.YIELD_ROUTES.slice(2).every(route => route.block === 300));
  });
});

await expectConfigError("empty list elements are rejected without throwing during module evaluation", {
  VITE_LEGACY_YIELD_FACTORY_ADDRESSES: `${address(31)}, ,${address(32)}`,
  VITE_LEGACY_YIELD_FACTORY_DEPLOY_BLOCK: "300",
}, "cannot contain empty entries");
await expectConfigError("malformed addresses are rejected through CONFIG_ERROR", {
  VITE_LEGACY_YIELD_FACTORY_ADDRESSES: `${address(31)},not-an-address`,
  VITE_LEGACY_YIELD_FACTORY_DEPLOY_BLOCK: "300",
}, "nonzero EVM addresses");
await expectConfigError("the zero address is rejected", {
  VITE_LEGACY_YIELD_FACTORY_ADDRESSES: address(0),
  VITE_LEGACY_YIELD_FACTORY_DEPLOY_BLOCK: "300",
}, "nonzero EVM addresses");
await expectConfigError("more than eight addresses are rejected", {
  VITE_LEGACY_YIELD_FACTORY_ADDRESSES: Array.from({ length: 9 }, (_, index) => address(100 + index)).join(","),
  VITE_LEGACY_YIELD_FACTORY_DEPLOY_BLOCK: "300",
}, "at most 8");
await expectConfigError("case-insensitive duplicates in one list are rejected", {
  VITE_LEGACY_YIELD_FACTORY_ADDRESSES: `${address(31)},${upperAddressBody(address(31))}`,
  VITE_LEGACY_YIELD_FACTORY_DEPLOY_BLOCK: "300",
}, "duplicate factory addresses");

for (const [label, duplicate] of [
  ["primary basic factory", fixture.VITE_FACTORY_ADDRESS],
  ["older basic factory", fixture.VITE_LEGACY_FACTORY_ADDRESS],
  ["primary WLD yield factory", fixture.VITE_YIELD_FACTORY_ADDRESS],
  ["primary USDC yield factory", fixture.VITE_USDC_YIELD_FACTORY_ADDRESS],
  ["WLD token", fixture.VITE_WLD_ADDRESS],
  ["USDC token", fixture.VITE_USDC_ADDRESS],
  ["WLD strategy", fixture.VITE_MORPHO_VAULT_ADDRESS],
  ["USDC strategy", fixture.VITE_USDC_MORPHO_VAULT_ADDRESS],
]) {
  await expectConfigError(`legacy factory duplication with ${label} is rejected`, {
    VITE_LEGACY_YIELD_FACTORY_ADDRESSES: duplicate,
    VITE_LEGACY_YIELD_FACTORY_DEPLOY_BLOCK: "300",
  }, "unique and separate");
}

await expectConfigError("legacy factory addresses cannot be duplicated across assets", {
  VITE_LEGACY_YIELD_FACTORY_ADDRESSES: address(31),
  VITE_LEGACY_YIELD_FACTORY_DEPLOY_BLOCK: "300",
  VITE_LEGACY_USDC_YIELD_FACTORY_ADDRESSES: address(31),
  VITE_LEGACY_USDC_YIELD_FACTORY_DEPLOY_BLOCK: "400",
}, "unique and separate");
await expectConfigError("WLD legacy routes require the configured primary WLD route", {
  VITE_YIELD_FACTORY_ADDRESS: "",
  VITE_MORPHO_VAULT_ADDRESS: "",
  VITE_LEGACY_YIELD_FACTORY_ADDRESSES: address(31),
  VITE_LEGACY_YIELD_FACTORY_DEPLOY_BLOCK: "300",
}, "primary WLD token, yield factory and Morpho strategy");
await expectConfigError("USDC legacy routes require the configured primary USDC route", {
  VITE_USDC_ADDRESS: "",
  VITE_USDC_YIELD_FACTORY_ADDRESS: "",
  VITE_USDC_MORPHO_VAULT_ADDRESS: "",
  VITE_LEGACY_USDC_YIELD_FACTORY_ADDRESSES: address(41),
  VITE_LEGACY_USDC_YIELD_FACTORY_DEPLOY_BLOCK: "400",
}, "primary USDC token, yield factory and Morpho strategy");

for (const invalidBlock of ["", "0", "-1", "1.5", "1e2", "24foo", "9007199254740992"]) {
  await expectConfigError(`invalid WLD legacy deployment block ${JSON.stringify(invalidBlock)} is rejected`, {
    VITE_LEGACY_YIELD_FACTORY_ADDRESSES: address(31),
    VITE_LEGACY_YIELD_FACTORY_DEPLOY_BLOCK: invalidBlock,
  }, "VITE_LEGACY_YIELD_FACTORY_DEPLOY_BLOCK must be a positive integer");
}
await expectConfigError("USDC legacy routes require their own discovery block", {
  VITE_LEGACY_USDC_YIELD_FACTORY_ADDRESSES: address(41),
  VITE_LEGACY_USDC_YIELD_FACTORY_DEPLOY_BLOCK: "",
}, "VITE_LEGACY_USDC_YIELD_FACTORY_DEPLOY_BLOCK must be a positive integer");

console.log(`${checks} legacy yield route checks passed.`);
