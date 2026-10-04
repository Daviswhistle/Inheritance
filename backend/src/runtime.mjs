import { DurableObject, env } from "cloudflare:workers";
import { primeFinalizerSigner, runFinalizerCycle } from "./finalizer.mjs";
import worker from "./worker.mjs";

primeFinalizerSigner(env);

// Only the scheduled Worker calls this internal RPC. Financial state remains in
// the existing D1 journal and its signer lease, including after object eviction.
export class InheritanceExecutor extends DurableObject {
  async runCycle() {
    return runFinalizerCycle(this.env);
  }
}

export default worker;
