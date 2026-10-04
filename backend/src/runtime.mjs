import { DurableObject, env } from "cloudflare:workers";
import { primeFinalizerSigner, readFinalizerHealth, runFinalizerCycle } from "./finalizer.mjs";
import worker from "./worker.mjs";
import { ensureScheduledWatcher, synchronizeWatcherTasks } from "./scheduling.mjs";
import { runScheduledWatcher } from "./watcher-task.mjs";

primeFinalizerSigner(env);

// Only the scheduled Worker calls this internal RPC. Financial state remains in
// the existing D1 journal and its signer lease, including after object eviction.
export class InheritanceExecutor extends DurableObject {
  async runCycle() {
    return runFinalizerCycle(this.env);
  }

  async readHealth() {
    return readFinalizerHealth(this.env);
  }

  async synchronize() {
    return synchronizeWatcherTasks(this.env);
  }
}

export class InheritanceWatcher extends DurableObject {
  tail = Promise.resolve();

  exclusive(work) {
    const previous = this.tail;
    let release;
    this.tail = new Promise(resolve => { release = resolve; });
    return (async () => {
      await previous;
      try { return await work(); }
      finally { release(); }
    })();
  }

  async ensureScheduled(address, immediate = false) {
    return this.exclusive(() => ensureScheduledWatcher(this.env, this.ctx.storage, address, immediate));
  }

  async alarm() {
    return this.exclusive(() => runScheduledWatcher(this.env, this.ctx.storage));
  }

  async checkNow(address, caller) {
    return this.exclusive(async () => {
      await ensureScheduledWatcher(this.env, this.ctx.storage, address, true);
      return runScheduledWatcher(this.env, this.ctx.storage, caller);
    });
  }
}

export default worker;
