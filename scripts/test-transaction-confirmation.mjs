import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "../app/node_modules/typescript/lib/typescript.js";

const source = readFileSync(new URL("../app/src/transactions.ts", import.meta.url), "utf8");
const require = createRequire(new URL("../app/package.json", import.meta.url));
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  .replaceAll('from "ethers"', `from ${JSON.stringify(pathToFileURL(require.resolve("ethers")).href)}`);
const { ConfirmedTransactionFailure, confirmTransaction } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
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
    await assert.rejects(confirmTransaction({ waitForTransaction: () => { throw Error("must not wait"); } }, { txHash: userOp }), error =>
      error instanceof ConfirmedTransactionFailure && error.code === "USER_OPERATION_FAILED" && error.txHash === userOp);
  });
  await test("pending operation expires with check-before-retry guidance", async () => {
    globalThis.fetch = async () => Response.json({ status: "pending" });
    await assert.rejects(confirmTransaction({}, { txHash: userOp, timeoutMs: 5, intervalMs: 1 }), error =>
      !(error instanceof ConfirmedTransactionFailure) && /still confirming/.test(error.message));
  });
  await test("status-zero receipt is a typed terminal failure", async () => {
    await assert.rejects(confirmTransaction({ waitForTransaction: async () => ({ status: 0, hash: tx }) }, { txHash: tx, hashType: "transaction" }), error =>
      error instanceof ConfirmedTransactionFailure && error.code === "TRANSACTION_REVERTED" && error.txHash === tx);
  });
  await test("provider rejection with a status-zero receipt is still definitive", async () => {
    const error = Object.assign(new Error("transaction execution reverted"), { code: "CALL_EXCEPTION", receipt: { status: 0, hash: tx } });
    await assert.rejects(confirmTransaction({ waitForTransaction: async () => { throw error; } }, { txHash: tx, hashType: "transaction" }), failure =>
      failure instanceof ConfirmedTransactionFailure && failure.code === "TRANSACTION_REVERTED" && failure.txHash === tx);
  });
  await test("status-zero receipt for another or unknown hash stays unresolved", async () => {
    const wrong = `0x${"33".repeat(32)}`;
    for (const receipt of [{ status: 0, hash: wrong }, { status: 0 }]) {
      const error = Object.assign(new Error("provider response is uncertain"), { receipt });
      await assert.rejects(confirmTransaction({ waitForTransaction: async () => { throw error; } },
        { txHash: tx, hashType: "transaction" }), failure => failure === error);
    }
  });
  await test("a matching receipt with unavailable status cannot authorize a retry", async () => {
    await assert.rejects(confirmTransaction({ waitForTransaction: async () => ({ status: null, hash: tx }) },
      { txHash: tx, hashType: "transaction" }), error =>
      !(error instanceof ConfirmedTransactionFailure) && /still confirming/.test(error.message));
  });
  await test("provider error with null receipt status remains an ambiguous provider error", async () => {
    const error = Object.assign(new Error("receipt status unavailable"), { code: "CALL_EXCEPTION", receipt: { status: null, hash: tx } });
    await assert.rejects(confirmTransaction({ waitForTransaction: async () => { throw error; } },
      { txHash: tx, hashType: "transaction" }), failure => failure === error);
  });
  await test("confirmed receipt without observed outcome stays explicit", async () => {
    await assert.rejects(confirmTransaction({ waitForTransaction: async () => ({ status: 1 }) }, { txHash: tx, hashType: "transaction", timeoutMs: 5, intervalMs: 1, check: async () => false }), error =>
      !(error instanceof ConfirmedTransactionFailure) && /confirmed.*fresh vault/.test(error.message));
  });
  await test("missing identifier cannot report success", async () => {
    await assert.rejects(confirmTransaction({}, {}), error =>
      !(error instanceof ConfirmedTransactionFailure) && /valid transaction identifier/.test(error.message));
  });
} finally { globalThis.fetch = original; }
console.log(`${passes} passed, 0 failed`);
