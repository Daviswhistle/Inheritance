// Explicit opt-in; every transaction is sent to the local Anvil fork.
process.env.GAS_FUNDING_REAL_FORK = "true";
await import("./test-gas-refill.mjs");
