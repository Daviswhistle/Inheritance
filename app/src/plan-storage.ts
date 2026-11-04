type JournalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type DurableJournal = {
  read(key: string): Promise<string | null | undefined>;
  write(key: string, value: string | null): Promise<void>;
  replace?(key: string, expected: string | null | undefined, value: string | null): Promise<boolean>;
};
const storageError = () => new Error("Your browser could not retain the plan recovery record. Restore browser storage and reopen the app before continuing.");
const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open("inheritance-plan-recovery", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("plans");
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(storageError());
  request.onblocked = () => reject(storageError());
});
const browserJournal: DurableJournal = {
  async read(key) {
    const db = await openDatabase();
    try {
      return await new Promise<string | null | undefined>((resolve, reject) => {
        const transaction = db.transaction("plans", "readonly");
        const request = transaction.objectStore("plans").get(key);
        transaction.oncomplete = () => resolve(request.result as string | null | undefined);
        transaction.onabort = transaction.onerror = () => reject(storageError());
      });
    } finally { db.close(); }
  },
  async write(key, value) {
    const db = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("plans", "readwrite", { durability: "strict" });
        if (transaction.durability !== "strict") { transaction.abort(); reject(storageError()); return; }
        transaction.oncomplete = () => resolve();
        transaction.onabort = transaction.onerror = () => reject(storageError());
        transaction.objectStore("plans").put(value, key);
      });
    } finally { db.close(); }
  },
  async replace(key, expected, value) {
    const db = await openDatabase();
    try {
      return await new Promise<boolean>((resolve, reject) => {
        const transaction = db.transaction("plans", "readwrite", { durability: "strict" });
        if (transaction.durability !== "strict") { transaction.abort(); reject(storageError()); return; }
        let changed = false;
        transaction.oncomplete = () => resolve(changed);
        transaction.onabort = transaction.onerror = () => reject(storageError());
        const store = transaction.objectStore("plans");
        const current = store.get(key);
        current.onsuccess = () => {
          // null permits a new request after either no record or a tombstone;
          // undefined is migration-only and must never match a tombstone.
          if (expected === null ? current.result != null : current.result !== expected) return;
          store.put(value, key);
          changed = true;
        };
      });
    } finally { db.close(); }
  },
};

/** IndexedDB is authoritative; localStorage is only a compatibility mirror.
 * Await strict transaction completion before any wallet request. A tombstone
 * prevents an older, asynchronously flushed mirror from reviving a cleared plan.
 */
export async function readPlanJournal<T>(key: string, parse: (raw: string) => T | null,
  mirror: JournalStorage = localStorage, legacy: JournalStorage = sessionStorage,
  durable: DurableJournal = browserJournal): Promise<T | null> {
  try {
    const current = await durable.read(key);
    if (current === null) return null;
    if (current !== undefined) {
      const parsed = parse(current);
      if (!parsed) throw storageError();
      return parsed;
    }
    const previous = mirror.getItem(key) ?? legacy.getItem(key);
    if (previous === null) return null;
    const parsed = parse(previous);
    if (!parsed) throw storageError();
    // Another window may have created or cleared the durable request since
    // this read began. Migrate only a key that is still genuinely absent.
    if (!await replacePlanJournal(key, undefined, previous, mirror, legacy, durable)) {
      return readPlanJournal(key, parse, mirror, legacy, durable);
    }
    return parsed;
  } catch { throw storageError(); }
}

export async function writePlanJournal(key: string, serialized: string,
  mirror: JournalStorage = localStorage, legacy: JournalStorage = sessionStorage,
  durable: DurableJournal = browserJournal): Promise<void> {
  try {
    await durable.write(key, serialized);
    // Keep legacy tooling readable, but never use this as proof of persistence.
    try { mirror.setItem(key, serialized); legacy.removeItem(key); } catch { /* Strict durable copy already committed. */ }
  } catch { throw storageError(); }
}

export async function clearPlanJournal(key: string,
  mirror: JournalStorage = localStorage, legacy: JournalStorage = sessionStorage,
  durable: DurableJournal = browserJournal): Promise<void> {
  try {
    await durable.write(key, null);
    try { legacy.removeItem(key); mirror.removeItem(key); } catch { /* Tombstone prevents stale-copy recovery. */ }
  } catch { throw storageError(); }
}

/** Compare and replace in one strict transaction. An older callback may never
 * update or clear a newer request, even when the requests have equal amounts. */
export async function replacePlanJournal(key: string, expected: string | null | undefined, value: string | null,
  mirror: JournalStorage = localStorage, legacy: JournalStorage = sessionStorage,
  durable: DurableJournal = browserJournal): Promise<boolean> {
  try {
    if (!durable.replace) throw storageError();
    const changed = await durable.replace(key, expected, value);
    if (changed) {
      try { legacy.removeItem(key); if (value === null) mirror.removeItem(key); else mirror.setItem(key, value); }
      catch { /* The durable request or tombstone is authoritative. */ }
    }
    return changed;
  } catch { throw storageError(); }
}
