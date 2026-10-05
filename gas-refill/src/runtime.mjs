import { DurableObject } from "cloudflare:workers";
import { readGasRefillHealth, runGasRefillCycle } from "./funding.mjs";
import worker from "./worker.mjs";

// The public Worker delegates only its Cron event. Public HTTP requests cannot
// trigger financial execution; the existing D1 signature journal and lease
// remain authoritative after eviction or overlapping invocations.
export class GasRefillExecutor extends DurableObject {
  async runCycle() { return runGasRefillCycle(this.env); }
  async readHealth() { return readGasRefillHealth(this.env); }
}

export default worker;
