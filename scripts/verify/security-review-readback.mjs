// Read-only security-review code comparison. No account keys or broadcasts.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { ethers } from "ethers";

const base = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(process.env.SECURITY_READBACK_OUT || resolve(tmpdir(), "inheritance-security-readback"));
mkdirSync(out, { recursive: true });
const blockText = process.env.SECURITY_READBACK_BLOCK || "37172835";
if (!/^[1-9]\d*$/.test(blockText) || !Number.isSafeInteger(Number(blockText))) throw Error("Invalid block number");
const block = Number(blockText);
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: base, encoding: "utf8" }).trim();
const workingTreeDirty = Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: base, encoding: "utf8" }).trim());
const tag = ethers.toQuantity(block);
let id = 0;
async function rpc(method, params) {
  const response = await fetch("https://worldchain-mainnet.g.alchemy.com/public", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    signal: AbortSignal.timeout(25000),
  });
  const result = await response.json();
  if (result.error) throw Error(JSON.stringify(result.error));
  return result.result;
}
function artifact(name) {
  return JSON.parse(readFileSync(`${base}/out/${name}.sol/${name}.json`, "utf8"));
}
function metadataStart(code) {
  const bytes = (code.length - 2) / 2;
  const length = parseInt(code.slice(-4), 16) + 2;
  if (!(length > 2 && length < 1024 && length <= bytes)) throw Error("Invalid CBOR trailer");
  const start = bytes - length;
  if ((parseInt(code.slice(2 + start * 2, 4 + start * 2), 16) >> 5) !== 5) {
    throw Error("Expected Solidity CBOR map");
  }
  return start;
}
function compare(code, expected, masks) {
  const actual = ethers.getBytes(code), target = ethers.getBytes(expected);
  const masked = new Uint8Array(target.length);
  for (const { start, length } of masks) masked.fill(1, start, start + length);
  const mismatches = [];
  if (actual.length === target.length) {
    for (let i = 0; i < target.length; ++i) if (!masked[i] && actual[i] !== target[i]) mismatches.push(i);
  }
  return { actualBytes: actual.length, compiledBytes: target.length,
    normalizedMatch: actual.length === target.length && mismatches.length === 0,
    mismatchCount: actual.length === target.length ? mismatches.length : null,
    firstMismatches: mismatches.slice(0, 8), masks };
}
const rows = [];
async function checkRuntime(name, address, nestedChild) {
  const art = artifact(name), code = await rpc("eth_getCode", [address, tag]);
  const expected = art.deployedBytecode.object;
  const masks = Object.values(art.deployedBytecode.immutableReferences || {}).flat();
  const start = metadataStart(expected);
  masks.push({ start, length: (expected.length - 2) / 2 - start, kind: "metadata" });
  if (nestedChild) {
    const child = artifact(nestedChild).bytecode.object.slice(2);
    const offset = expected.indexOf(child, 2);
    if (offset < 0 || offset % 2 !== 0) throw Error("Embedded child code not found");
    const childStart = metadataStart("0x" + child);
    masks.push({ start: (offset - 2) / 2 + childStart, length: child.length / 2 - childStart,
      kind: "embedded child metadata" });
  }
  const immutableValues = Object.fromEntries(Object.entries(art.deployedBytecode.immutableReferences || {})
    .map(([key, refs]) => [key, [...new Set(refs.map(r => "0x" + code.slice(2 + r.start * 2, 2 + (r.start + r.length) * 2)))]]));
  const row = { name, address, codeHash: ethers.keccak256(code), ...compare(code, expected, masks), immutableValues };
  rows.push(row);
  writeFileSync(`${out}/${name}.onchain.hex`, code + "\n");
  return row;
}
const chain = await rpc("eth_chainId", []);
if (BigInt(chain) !== 480n) throw Error("Wrong chain");
const header = await rpc("eth_getBlockByNumber", [tag, false]);
const configurations = [];
for (const [name, address, child, assetName] of [
  ["InheritanceVaultMorphoFactory", "0x1a856aE8c3abd8a3746F542688a1846Bc6208435", "InheritanceVaultMorpho", "WLD"],
  ["InheritanceVaultUSDCFactory", "0x87813F596E4ab2Ed29182Bd8A632d21Ae2A78DB2", "InheritanceVaultUSDC", "asset"],
]) {
  const factoryRow = await checkRuntime(name, address);
  const helper = ethers.getCreateAddress({ from: address, nonce: 1 });
  if (!Object.values(factoryRow.immutableValues).flat().some(value => value.toLowerCase().endsWith(helper.slice(2).toLowerCase()))) {
    throw Error("Factory does not reference the expected fixed deployer");
  }
  const helperRow = await checkRuntime(name.replace("Factory", "Deployer"), helper);
  const parts = [1, 2].map(nonce => ethers.getCreateAddress({ from: helper, nonce }));
  for (const part of parts) {
    if (!Object.values(helperRow.immutableValues).flat().some(value => value.toLowerCase().endsWith(part.slice(2).toLowerCase()))) {
      throw Error("Deployer does not reference expected immutable code part");
    }
  }
  const partCode = await Promise.all(parts.map(part => rpc("eth_getCode", [part, tag])));
  if (partCode.some(code => !code.startsWith("0x00"))) throw Error("Code parts are not STOP-prefixed");
  const creationCode = "0x" + partCode.map(code => code.slice(4)).join("");
  const expected = artifact(child).bytecode.object;
  const start = metadataStart(expected);
  rows.push({ name: `${child} immutable creation-code parts`, addresses: parts,
    codeHash: ethers.keccak256(creationCode), ...compare(creationCode, expected,
      [{ start, length: (expected.length - 2) / 2 - start, kind: "metadata" }]) });
  writeFileSync(`${out}/${child}.stored-creation.hex`, creationCode + "\n");
  const iface = new ethers.Interface(artifact(name).abi);
  const conf = { address, helper, child, parts };
  for (const getter of [assetName, "strategy", "feeRecipient", "performanceFeeBps"]) {
    const data = iface.encodeFunctionData(getter);
    conf[getter] = String(iface.decodeFunctionResult(getter, await rpc("eth_call", [{ to: address, data }, tag]))[0]);
  }
  if (assetName === "asset") {
    const token = new ethers.Interface(["function isBlacklisted(address) view returns (bool)"]);
    try {
      conf.feeRecipientUSDCBlacklisted = token.decodeFunctionResult("isBlacklisted", await rpc("eth_call", [
        { to: conf.asset, data: token.encodeFunctionData("isBlacklisted", [conf.feeRecipient]) }, tag,
      ]))[0];
    } catch { conf.feeRecipientUSDCBlacklisted = "getter unavailable"; }
  }
  configurations.push(conf);
}
await checkRuntime("InheritanceVaultWLDFactoryOnePerOwner", "0xb74342FC15C504108cFD91366493590A9d570D26", "InheritanceVaultWLD");
await checkRuntime("OperatorGasFunding", "0x7544804412033CBd0Eaf47eC5e356C161298F9e9");
const receipt = { chainId: 480, block, blockHash: header.hash, checkedAt: new Date().toISOString(),
  sourceCommit, workingTreeDirty, configurations, rows,
  note: "Read-only normalized comparisons exclude compiler CBOR metadata and compiler-declared runtime immutable offsets. Constructor configuration read separately. No transactions." };
writeFileSync(`${out}/live-readback.json`, JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ block, blockHash: header.hash, configurations,
  comparisons: rows.map(({ name, address, actualBytes, normalizedMatch, mismatchCount }) => ({ name, address, actualBytes, normalizedMatch, mismatchCount })) }, null, 2));
if (rows.some(row => !row.normalizedMatch)) process.exitCode = 1;
