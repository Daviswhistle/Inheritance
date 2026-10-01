import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "../app/node_modules/typescript/lib/typescript.js";

const source = readFileSync(new URL("../app/src/transactions.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { confirmTransaction } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const userOp = `0x${"11".repeat(32)}`, tx = `0x${"22".repeat(32)}`;
const original = globalThis.fetch;
let passes = 0;
async function test(name, fn) { await fn(); console.log(`PASS ${name}`); passes++; }
try {
  await test("user-operation resolves before waiting for canonical receipt", async () => {
    let calls = 0;
    globalThis.fetch = async url => {
      assert.ok(url.endsWith(userOp)); calls++;
      return Response.json(calls === 1 ? { status: "pending" } : { status: "success", transaction_hash: tx });
    };
    const provider = { waitForTransaction: async hash => { assert.equal(hash, tx); return { status: 1 }; } };
    assert.equal(await confirmTransaction(provider, { txHash: userOp, timeoutMs: 200, intervalMs: 1, check: async () => true }), true);
    assert.equal(calls, 2);
  });
  await test("canonical transaction skips Portal and checks updated state", async () => {
    globalThis.fetch = async () => { throw Error("must not call Portal"); };
    let checks = 0;
    const provider = { waitForTransaction: async hash => { assert.equal(hash, tx); return { status: 1 }; } };
    assert.equal(await confirmTransaction(provider, { txHash: tx, hashType: "transaction", timeoutMs: 100, intervalMs: 1, check: async () => ++checks === 2 }), true);
    assert.equal(checks, 2);
  });
  await test("failed operation never waits for a transaction receipt", async () => {
    globalThis.fetch = async () => Response.json({ status: "failed" });
    await assert.rejects(confirmTransaction({ waitForTransaction: () => { throw Error("must not wait"); } }, { txHash: userOp }), /not executed/);
  });
  await test("pending operation expires with check-before-retry guidance", async () => {
    globalThis.fetch = async () => Response.json({ status: "pending" });
    await assert.rejects(confirmTransaction({}, { txHash: userOp, timeoutMs: 5, intervalMs: 1 }), /still confirming/);
  });
  await test("reverted receipt cannot report success", async () => {
    await assert.rejects(confirmTransaction({ waitForTransaction: async () => ({ status: 0 }) }, { txHash: tx, hashType: "transaction" }), /reverted/);
  });
  await test("confirmed receipt without observed outcome stays explicit", async () => {
    await assert.rejects(confirmTransaction({ waitForTransaction: async () => ({ status: 1 }) }, { txHash: tx, hashType: "transaction", timeoutMs: 5, intervalMs: 1, check: async () => false }), /confirmed.*fresh vault/);
  });
  await test("missing identifier cannot report success", async () => {
    await assert.rejects(confirmTransaction({}, {}), /valid transaction identifier/);
  });
} finally { globalThis.fetch = original; }
console.log(`${passes} passed, 0 failed`);
