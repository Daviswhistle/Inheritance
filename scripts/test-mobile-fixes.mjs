import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";

const require = createRequire(new URL("../app/package.json", import.meta.url));
const ts = require("typescript");

async function importTypeScript(relativePath) {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  const source = readFileSync(path, "utf8");
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors, [], path + " transpiles without errors");
  const dataUrl = "data:text/javascript;base64," + Buffer.from(result.outputText).toString("base64");
  return import(dataUrl);
}

const { ContactPickerCoordinator } = await importTypeScript("../app/src/contact-picker.ts");
const {
  requestAndReadNotificationPermission,
  notificationHealth,
} = await importTypeScript("../app/src/notification-state.ts");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

test("a contact selection is applied once and clears the picker state", async () => {
  const picker = new ContactPickerCoordinator(1000);
  const chosen = [];
  assert.equal(picker.start(() => Promise.resolve("0xabc"), value => chosen.push(value)), true);
  assert.deepEqual(picker.snapshot, { status: "opening", pending: true });
  await flushPromises();
  assert.deepEqual(chosen, ["0xabc"]);
  assert.deepEqual(picker.snapshot, { status: "idle", pending: false });
});

test("manual recipient edits invalidate a late native contact result", async () => {
  const picker = new ContactPickerCoordinator(1000);
  const result = deferred();
  const chosen = [];
  picker.start(() => result.promise, value => chosen.push(value));
  picker.manualEdit();
  assert.deepEqual(picker.snapshot, { status: "manual_waiting", pending: true });
  result.resolve("late contact");
  await flushPromises();
  assert.deepEqual(chosen, []);
  assert.deepEqual(picker.snapshot, { status: "manual", pending: false });
});

test("cancelling contact selection keeps the request locked and ignores its late result", async () => {
  const picker = new ContactPickerCoordinator(1000);
  const result = deferred();
  const chosen = [];
  picker.start(() => result.promise, value => chosen.push(value));
  picker.cancel();
  assert.deepEqual(picker.snapshot, { status: "cancelled_waiting", pending: true });
  result.resolve("late contact");
  await flushPromises();
  assert.deepEqual(chosen, []);
  assert.deepEqual(picker.snapshot, { status: "cancelled", pending: false });
});

test("timeout provides recovery without allowing overlap; late result stays ignored", async () => {
  const picker = new ContactPickerCoordinator(20);
  const result = deferred();
  const chosen = [];
  let launches = 0;
  assert.equal(picker.start(() => { launches++; return result.promise; }, value => chosen.push(value)), true);
  await sleep(35);
  assert.deepEqual(picker.snapshot, { status: "timed_out_waiting", pending: true });
  assert.equal(picker.start(() => { launches++; return Promise.resolve("overlap"); }, value => chosen.push(value)), false);
  assert.equal(launches, 1);
  result.resolve("late contact");
  await flushPromises();
  assert.deepEqual(chosen, []);
  assert.deepEqual(picker.snapshot, { status: "timed_out", pending: false });
});

test("only the original native promise settling unlocks a retry", async () => {
  const picker = new ContactPickerCoordinator(1000);
  const first = deferred();
  let launches = 0;
  assert.equal(picker.start(() => { launches++; return first.promise; }, () => {}), true);
  assert.equal(picker.start(() => { launches++; return Promise.resolve("second"); }, () => {}), false);
  await flushPromises();
  assert.equal(launches, 1);
  first.resolve(null);
  await flushPromises();
  assert.deepEqual(picker.snapshot, { status: "empty", pending: false });
  assert.equal(picker.start(() => { launches++; return Promise.resolve("second"); }, () => {}), true);
  await flushPromises();
  assert.equal(launches, 2);
  assert.deepEqual(picker.snapshot, { status: "idle", pending: false });
});

test("account or component invalidation prevents a stale picker callback", async () => {
  const picker = new ContactPickerCoordinator(1000);
  const result = deferred();
  const chosen = [];
  picker.start(() => result.promise, value => chosen.push(value));
  picker.invalidate();
  assert.deepEqual(picker.snapshot, { status: "context_waiting", pending: true });
  result.resolve("stale account contact");
  await flushPromises();
  assert.deepEqual(chosen, []);
  assert.deepEqual(picker.snapshot, { status: "idle", pending: false });
});

test("already_granted is an expected SDK outcome and readback confirms success", async () => {
  const error = Object.assign(new Error("Request permission failed"), { error_code: "already_granted" });
  const result = await requestAndReadNotificationPermission(
    () => Promise.reject(error),
    () => Promise.resolve({ notifications: true }),
  );
  assert.deepEqual(result.permission, { notifications: true });
  assert.equal(result.failure?.category, "expected");
  assert.equal(result.failure?.errorCode, "already_granted");
});

test("expected denied permission outcomes remain denied after readback", async () => {
  for (const errorCode of ["user_rejected", "permission_disabled", "already_requested"]) {
    const error = Object.assign(new Error("Request permission failed"), { error_code: errorCode });
    const result = await requestAndReadNotificationPermission(
      () => Promise.reject(error),
      () => Promise.resolve({ notifications: false }),
    );
    assert.deepEqual(result.permission, { notifications: false });
    assert.equal(result.failure?.category, "expected");
    assert.equal(result.failure?.errorCode, errorCode);
  }
});

test("unexpected SDK failures remain distinguishable even when readback reports on", async () => {
  const error = Object.assign(new Error("unsupported request"), { error_code: "generic_error" });
  const result = await requestAndReadNotificationPermission(
    () => Promise.reject(error),
    () => Promise.resolve({ notifications: true }),
  );
  assert.deepEqual(result.permission, { notifications: true });
  assert.equal(result.failure?.category, "unexpected");
  assert.equal(result.failure?.error, error);
});

test("permission readback failure is unknown, never inferred from request completion", async () => {
  const result = await requestAndReadNotificationPermission(
    () => Promise.resolve({ executedWith: "minikit" }),
    () => Promise.reject(new Error("bridge read failed")),
  );
  assert.equal(result.permission, null);
  assert.equal(result.failure, null);
});

test("without an open plan the terminal state only confirms wallet permission", () => {
  assert.deepEqual(notificationHealth({
    backendEnabled: true,
    permission: "granted",
    asked: true,
    hasWatchTarget: false,
    watchState: "unknown",
    deliveryNote: "",
  }), { level: "ok", text: "Notifications are on for this wallet." });
});

test("a real watch lookup in progress stays distinguishable from no plan", () => {
  assert.deepEqual(notificationHealth({
    backendEnabled: true,
    permission: "granted",
    asked: true,
    hasWatchTarget: true,
    watchState: "unknown",
    deliveryNote: "",
  }), { level: "checking", text: "Checking notification status…" });
});
