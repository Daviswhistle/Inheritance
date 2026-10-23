type JournalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type DurableJournal = {
  read(key: string): Promise<string | null | undefined>;
  write(key: string, value: string | null): Promise<void>;
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
    await writePlanJournal(key, previous, mirror, legacy, durable);
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
