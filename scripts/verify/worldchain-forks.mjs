// Read mainnet state, execute only inside Forge's local forks. Never broadcast.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const rpc = process.env.WORLDCHAIN_FORK_RPC;
if (!rpc) throw new Error("Set WORLDCHAIN_FORK_RPC explicitly; this check must not silently skip.");
const forge = process.env.FORGE_BIN || "forge";
const cast = process.env.CAST_BIN || "cast";
const read = (...args) => {
  try {
    return execFileSync(cast, [...args, "--rpc-url", rpc], {
      encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error(`World Chain read failed: ${args[0]} (provider details withheld).`);
  }
};
if (read("chain-id") !== "480") throw new Error("Expected World Chain mainnet (480).");
const block = process.env.WORLDCHAIN_FORK_BLOCK || read("block-number");
if (!/^[1-9]\d*$/.test(block)) throw new Error("Expected a positive block number.");
const header = JSON.parse(read("block", block, "--json"));
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim());
const out = resolve(process.env.FORK_EVIDENCE_DIR || "/tmp/inheritance-worldchain-forks");
mkdirSync(out, { recursive: true });
const env = { ...process.env };
for (const prefix of ["WORLDCHAIN", "MORPHO", "USDC", "INCOME"]) {
  env[`${prefix}_FORK_RPC`] = rpc;
  env[`${prefix}_FORK_BLOCK`] = block;
}
const startedAt = new Date().toISOString();
console.log(`Testing local forks of World Chain block ${block}; no broadcasts.`);
const result = spawnSync(forge, ["test", "--match-contract", ".*ForkTest", "-vv"], {
  env, encoding: "utf8", timeout: 600_000, maxBuffer: 20 * 1024 * 1024,
});
// Provider errors can echo credential-bearing RPC URLs; redact before retention.
const log = `${result.stdout || ""}\n${result.stderr || ""}`.replaceAll(rpc, "[RPC]");
writeFileSync(resolve(out, "forge.log"), log);
const requiredSuites = ["GasRefillWorldChainForkTest", "OperatorGasFundingForkTest",
  "OwnerIncomeWorldChainForkTest", "MorphoWorldChainForkTest", "USDCWorldChainForkTest"];
const summary = log.match(/Ran (\d+) test suites[^\n]*: (\d+) tests passed, (\d+) failed, (\d+) skipped/);
const passed = result.status === 0 && !result.error && summary && Number(summary[1]) === 5
  && Number(summary[2]) > 0 && Number(summary[3]) === 0 && Number(summary[4]) === 0
  && requiredSuites.every(name => log.includes(`:${name}`));
const receipt = { startedAt, finishedAt: new Date().toISOString(),
  commit, dirty,
  forge: execFileSync(forge, ["--version"], { encoding: "utf8" }).trim(),
  chainId: 480, block, blockHash: header.hash,
  passed: Boolean(passed), tests: summary ? Number(summary[2]) : null,
  failures: summary ? Number(summary[3]) : null, skipped: summary ? Number(summary[4]) : null,
  scope: "Local fork execution; funded test accounts and reward-root fixtures. No native World App acceptance or mainnet transaction submission.",
};
writeFileSync(resolve(out, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt, null, 2));
if (!passed) {
  console.error(`Fork acceptance failed; inspect ${out}/forge.log.`);
  process.exitCode = 1;
}
