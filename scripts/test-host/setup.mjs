#!/usr/bin/env node
// Explicit opt-in tooling setup. Installs no global packages and touches no app lockfile.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(directory, "../../app");
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) throw new Error("The test host requires Node 22.13 or newer.");
if (!existsSync(path.join(app, "node_modules/vite")) || !existsSync(path.join(app, "node_modules/ethers"))) {
  throw new Error("Install app dependencies first: pnpm --dir app install --frozen-lockfile (or npx --yes pnpm@10 --dir app install --frozen-lockfile).");
}
const toolDirectory = path.join(directory, ".tools");
const bin = path.join(toolDirectory, "node_modules/.bin");
const env = { ...process.env, PATH: `${process.env.PATH || ""}${path.delimiter}${bin}` };
const available = tool => spawnSync(tool, ["--version"], { env, stdio: "ignore" }).status === 0;
if (available("forge") && available("anvil")) {
  console.log("Foundry and app dependencies are ready. Run npm run test-host.");
  process.exit(0);
}
mkdirSync(toolDirectory, { recursive: true });
writeFileSync(path.join(toolDirectory, "package.json"), JSON.stringify({ private: true, name: "inheritance-local-test-tools" }, null, 2) + "\n");
console.log("Installing official @foundry-rs/forge and @foundry-rs/anvil 1.7.1 into scripts/test-host/.tools (ignored by Git).");
const npmArgs = ["install", "--prefix", toolDirectory, "--no-save", "--package-lock=false", "--no-audit", "--no-fund", "@foundry-rs/forge@1.7.1", "@foundry-rs/anvil@1.7.1"];
const install = process.env.npm_execpath
  ? spawnSync(process.execPath, [process.env.npm_execpath, ...npmArgs], { stdio: "inherit" })
  : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", npmArgs, { stdio: "inherit", shell: process.platform === "win32" });
if (install.error) throw install.error;
if (install.status !== 0) process.exit(install.status || 1);
if (!available("forge") || !available("anvil")) throw new Error("Installed Foundry binaries could not run on this platform. Install Foundry manually and add forge/anvil to PATH.");
console.log("Ready. Run npm run test-host. Existing PATH tools take precedence over these local binaries.");
