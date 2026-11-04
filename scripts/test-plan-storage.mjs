import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "../app/node_modules/typescript/lib/typescript.js";
const source = readFileSync(new URL("../app/src/plan-storage.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { readPlanJournal, writePlanJournal, clearPlanJournal, replacePlanJournal } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
const durable = () => {
  const values = new Map();
  return { read: async key => values.get(key), write: async (key, value) => { values.set(key, value); },
    replace: async (key, expected, value) => { const current = values.get(key); if (expected === null ? current != null : current !== expected) return false; values.set(key, value); return true; } };
};
const key = "inheritance:pending-plan:0xowner";
const raw = JSON.stringify({ account: "0xowner", state: "submitting", request: "unknown" });
const parse = value => { try { const item = JSON.parse(value); return item.account === "0xowner" ? item : null; } catch { return null; } };
let checks = 0;
const check = async (name, run) => { await run(); checks++; console.log(`PASS ${name}`); };
await check("interrupted wallet requests survive loss of both browser-storage mirrors", async () => {
  const db = durable();
  await writePlanJournal(key, raw, storage(), storage(), db);
  assert.deepEqual(await readPlanJournal(key, parse, storage(), storage(), db), JSON.parse(raw));
});
await check("legacy session and local records migrate after durable completion", async () => {
  for (const location of ["mirror", "legacy"]) {
    const db = durable(), mirror = storage(), legacy = storage();
    (location === "mirror" ? mirror : legacy).setItem(key, raw);
    assert.deepEqual(await readPlanJournal(key, parse, mirror, legacy, db), JSON.parse(raw));
    assert.equal(await db.read(key), raw); assert.equal(legacy.getItem(key), null);
  }
});
await check("failed migration preserves the original recovery record", async () => {
  const legacy = storage(); legacy.setItem(key, raw);
  const db = { ...durable(), replace: async () => { throw new Error("disk failed"); } };
  await assert.rejects(readPlanJournal(key, parse, storage(), legacy, db), /recovery record/);
  assert.equal(legacy.getItem(key), raw);
});
await check("wallet send waits for actual durable commit, not mirror readback", async () => {
  let finish, sent = false;
  const commit = new Promise(resolve => { finish = resolve; });
  const operation = (async () => {
    await writePlanJournal(key, raw, storage(), storage(), { ...durable(), write: () => commit });
    sent = true;
  })();
  await Promise.resolve(); assert.equal(sent, false);
  finish(); await operation; assert.equal(sent, true);
});
await check("failed durable commit prevents the subsequent wallet send", async () => {
  let sent = false;
  await assert.rejects((async () => {
    await writePlanJournal(key, raw, storage(), storage(), { ...durable(), write: async () => { throw new Error("disk failed"); } });
    sent = true;
  })(), /recovery record/);
  assert.equal(sent, false);
});
await check("durable submitting record overrides stale ready mirrors", async () => {
  const db = durable(), mirror = storage(), legacy = storage();
  await db.write(key, raw);
  mirror.setItem(key, JSON.stringify({ account: "0xowner", state: "ready" }));
  legacy.setItem(key, mirror.getItem(key));
  assert.equal((await readPlanJournal(key, parse, mirror, legacy, db)).state, "submitting");
});
await check("invalid and foreign durable records remain blocked", async () => {
  for (const value of ["broken", JSON.stringify({ account: "0xother" })]) {
    const db = durable(); await db.write(key, value);
    await assert.rejects(readPlanJournal(key, parse, storage(), storage(), db), /recovery record/);
    assert.equal(await db.read(key), value);
  }
});
await check("unreadable durable storage cannot appear empty", async () => {
  await assert.rejects(readPlanJournal(key, parse, storage(), storage(), { ...durable(), read: async () => { throw new Error("denied"); } }), /recovery record/);
});
await check("clear tombstone prevents stale mirrors from resurrecting completed requests", async () => {
  const db = durable(), mirror = storage(), legacy = storage();
  await writePlanJournal(key, raw, mirror, legacy, db);
  await clearPlanJournal(key, mirror, legacy, db);
  mirror.setItem(key, raw); legacy.setItem(key, raw);
  assert.equal(await readPlanJournal(key, parse, mirror, legacy, db), null);
});
await check("clear preserves other wallets and waits for durable completion", async () => {
  const db = durable(), mirror = storage(), legacy = storage();
  await db.write("other-wallet", raw);
  await clearPlanJournal(key, mirror, legacy, db);
  assert.equal(await db.read("other-wallet"), raw);
  assert.equal(await db.read(key), null);
});
await check("concurrent journal creation permits one request and preserves its data", async () => {
  const db = durable(), mirror = storage(), legacy = storage();
  const values = await Promise.all([replacePlanJournal(key, null, "request-A", mirror, legacy, db), replacePlanJournal(key, null, "request-B", mirror, legacy, db)]);
  assert.deepEqual(values, [true, false]); assert.equal(await db.read(key), "request-A");
  assert.equal(await replacePlanJournal("other-wallet", null, "other", mirror, legacy, db), true);
});
await check("late updates and clears cannot change a newer request with the same amount", async () => {
  const db = durable(), mirror = storage(), legacy = storage();
  await replacePlanJournal(key, null, "request-A", mirror, legacy, db);
  await replacePlanJournal(key, "request-A", null, mirror, legacy, db);
  await replacePlanJournal(key, null, "request-B", mirror, legacy, db);
  for (const next of ["request-A-with-hash", null]) assert.equal(await replacePlanJournal(key, "request-A", next, mirror, legacy, db), false);
  assert.equal(await db.read(key), "request-B");
});
await check("delayed legacy migration cannot overwrite a newer journal or revive a tombstone", async () => {
  for (const newer of [JSON.stringify({account:"0xowner", state:"new-request"}), null]) {
    const db = durable(), mirror = storage(), legacy = storage(); mirror.setItem(key, raw);
    let resume; const gate = new Promise(resolve => {resume = resolve;}); let first = true;
    const delayed = {...db, read: async k => {const snapshot = await db.read(k); if(first){first=false;await gate;} return snapshot;}};
    const migration = readPlanJournal(key, parse, mirror, legacy, delayed);
    await Promise.resolve(); await Promise.resolve(); await db.write(key, newer); resume();
    assert.deepEqual(await migration, newer === null ? null : JSON.parse(newer));
    assert.equal(await db.read(key), newer);
  }
});
await check("missing atomic persistence support fails closed", async () => {
  await assert.rejects(replacePlanJournal(key, null, raw, storage(), storage(), {read:async()=>undefined,write:async()=>{}}), /recovery record/);
});
console.log(`${checks} plan-storage checks passed.`);
