#!/usr/bin/env node
// Disposable test chain + real MiniKit SDK host. No production env files are read.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Prefer the developer's existing Foundry, then the explicit local setup fallback.
process.env.PATH = `${process.env.PATH || ""}${path.delimiter}${path.join(root, "scripts/test-host/.tools/node_modules/.bin")}`;
const require = createRequire(path.join(root, "app/package.json"));
const { ContractFactory, JsonRpcProvider, parseEther, parseUnits } = require("ethers");
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("node scripts/test-host/start.mjs [--lan] [--skip-build] [--port=7777]\nRequires Node 22.13+, Foundry (forge/anvil), and app dependencies. Fresh disposable chain on every launch; Ctrl+C stops it.");
  process.exit(0);
}
const unknown = args.find(arg => !["--lan", "--skip-build"].includes(arg) && !/^--port=\d+$/.test(arg));
if (unknown) throw new Error(`Unknown argument: ${unknown}`);
const port = Number(args.find(arg => arg.startsWith("--port="))?.split("=")[1] || 7777);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Use a port between 1024 and 65535.");
process.chdir(root);
if (!args.includes("--skip-build")) {
  const build = spawnSync("forge", ["build"], { stdio: "inherit" });
  if (build.error) throw new Error("Run npm run test-host:setup, or install Foundry and put forge/anvil on PATH.");
  if (build.status !== 0) process.exit(build.status || 1);
}
const socket = createServer();
await new Promise((resolve, reject) => socket.once("error", reject).listen(0, "127.0.0.1", resolve));
const rpcPort = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const directory = mkdtempSync(path.join(tmpdir(), "inheritance-host-"));
const rpc = `http://127.0.0.1:${rpcPort}`;
const anvil = spawn("anvil", ["--host", "127.0.0.1", "--port", String(rpcPort), "--chain-id", "480", "--silent"], { stdio: ["ignore", "ignore", "inherit"] });
let startupError;
anvil.on("error", error => { startupError = error; });
let vite;
let provider;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await vite?.close();
  provider?.destroy();
  anvil.kill("SIGTERM");
  rmSync(directory, { recursive: true, force: true });
}
process.once("SIGINT", () => void stop().then(() => process.exit(0)));
process.once("SIGTERM", () => void stop().then(() => process.exit(0)));
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startupError) throw new Error(`Cannot start Anvil: ${startupError.message}`);
    if (anvil.exitCode !== null) throw new Error("Anvil stopped before startup.");
    try {
      const response = await fetch(rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "web3_clientVersion", params: [] }) });
      const value = await response.json();
      if (!/^anvil/i.test(value.result || "")) throw new Error("Expected our disposable Anvil chain.");
      ready = true; break;
    } catch { await sleep(100); }
  }
  if (!ready) throw new Error("Anvil did not become ready.");
  provider = new JsonRpcProvider(rpc, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
  const signer = await provider.getSigner(0);
  const owner = signer.address;
  const heir = (await provider.getSigner(1)).address;
  const deploy = async (name, values, file = name) => {
    const artifact = JSON.parse(readFileSync(path.join(root, `out/${file}.sol/${name}.json`), "utf8"));
    const contract = await new ContractFactory(artifact.abi, artifact.bytecode.object, signer).deploy(...values);
    await contract.waitForDeployment(); return contract;
  };
  const wld = await deploy("MockERC20", ["Test Worldcoin", "WLD"]);
  const usdc = await deploy("MockUSDC", [], "MockRe7USDC");
  const plain = await deploy("InheritanceVaultWLDFactoryOnePerOwner", [await wld.getAddress()]);
  const wldStrategy = await deploy("MockERC4626", [await wld.getAddress()]);
  const usdcStrategy = await deploy("MockRe7USDC", [await usdc.getAddress()]);
  const wldFactory = await deploy("InheritanceVaultMorphoFactory", [await wld.getAddress(), await wldStrategy.getAddress(), heir, 1000]);
  const usdcFactory = await deploy("InheritanceVaultUSDCFactory", [await usdc.getAddress(), await usdcStrategy.getAddress(), await wld.getAddress(), heir, 1000]);
  const batchWallet = await deploy("MockWorldAppWallet", []);
  // Income accounting queries the fixed Merkl distributor address even when no
  // campaign is active. Provide its contract shape locally, never the real API.
  const distributor = "0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae";
  const distributorArtifact = JSON.parse(readFileSync(path.join(root, "out/MockMerklDistributor.sol/MockMerklDistributor.json"), "utf8"));
  await provider.send("anvil_setCode", [distributor, distributorArtifact.deployedBytecode.object]);
  await (await wld.mint(distributor, parseEther("10000"))).wait();
  for (const address of [owner, heir]) {
    await (await wld.mint(address, parseEther("500"))).wait();
    await (await usdc.mint(address, parseUnits("500", 6))).wait();
  }
  // Reserve mock liquidity for the operator's +10% yield scenario.
  await (await wld.mint(await wldStrategy.getAddress(), parseEther("10000"))).wait();
  await (await usdc.mint(await usdcStrategy.getAddress(), parseUnits("10000", 6))).wait();
  const fixture = { rpc, owner, heir, batchWallet: await batchWallet.getAddress(),
    wld: await wld.getAddress(), usdc: await usdc.getAddress(), plain: await plain.getAddress(),
    wldStrategy: await wldStrategy.getAddress(), usdcStrategy: await usdcStrategy.getAddress(),
    wldFactory: await wldFactory.getAddress(), usdcFactory: await usdcFactory.getAddress() };
  const fixtureFile = path.join(directory, "fixture.json");
  writeFileSync(fixtureFile, JSON.stringify(fixture));
  for (const key of Object.keys(process.env)) if (key.startsWith("VITE_")) delete process.env[key];
  Object.assign(process.env, { INHERITANCE_HOST_FIXTURE: fixtureFile,
    VITE_FACTORY_ADDRESS: fixture.plain, VITE_FACTORY_DEPLOY_BLOCK: "1", VITE_FACTORY_RELEASE_SUPPORTED: "true",
    VITE_WLD_ADDRESS: fixture.wld, VITE_YIELD_FACTORY_ADDRESS: fixture.wldFactory, VITE_YIELD_FACTORY_DEPLOY_BLOCK: "1", VITE_MORPHO_VAULT_ADDRESS: fixture.wldStrategy,
    VITE_USDC_ADDRESS: fixture.usdc, VITE_USDC_YIELD_FACTORY_ADDRESS: fixture.usdcFactory, VITE_USDC_YIELD_FACTORY_DEPLOY_BLOCK: "1", VITE_USDC_MORPHO_VAULT_ADDRESS: fixture.usdcStrategy,
    VITE_RPC: "http://inheritance-test.invalid/__host/rpc", VITE_NOTIFY_BACKEND_URL: "http://inheritance-test.invalid/__host", VITE_REQUIRE_VERIFY: "false" });
  const { createServer: createVite } = await import(path.join(root, "app/node_modules/vite/dist/node/index.js"));
  vite = await createVite({ root: path.join(root, "app"), configFile: path.join(root, "app/vite.config.host.ts"), envDir: false,
    server: { host: args.includes("--lan") ? "0.0.0.0" : "127.0.0.1", port, strictPort: true } });
  await vite.listen();
  console.log(`\nInheritance TEST HOST — disposable tokens, real MiniKit SDK\nhttp://localhost:${port}/\nOwner: ${owner}\nHeir:  ${heir}\nFixture: ${fixtureFile}\nAndroid USB: adb reverse tcp:${port} tcp:${port}`);
  if (args.includes("--lan")) {
    for (const rows of Object.values(networkInterfaces())) for (const row of rows || []) {
      if (row.family === "IPv4" && !row.internal) console.log(`Device URL: http://${row.address}:${port}/`);
    }
    console.log("LAN mode exposes disposable test controls to your network; use a trusted development network.");
  }
  console.log("Open Test controls for owner/heir, rejection, delay, time travel and mock yield. Ctrl+C stops this session.");
} catch (error) {
  await stop();
  console.error(error);
  process.exitCode = 1;
}
