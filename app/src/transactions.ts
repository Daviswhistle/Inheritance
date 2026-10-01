import type { AbstractProvider } from "ethers";

type Confirmation = {
  txHash?: string;
  hashType?: "transaction" | "user-operation";
  confirmations?: number;
  timeoutMs?: number;
  intervalMs?: number;
  check?: () => Promise<boolean>;
};

const HASH = /^0x[0-9a-fA-F]{64}$/;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** MiniKit v2 returns a user-operation hash, which has to be resolved first. */
export async function confirmTransaction(provider: AbstractProvider, options: Confirmation): Promise<boolean> {
  const { txHash, hashType = "user-operation", confirmations = 1, timeoutMs = 60_000, intervalMs = 1500, check } = options;
  if (!txHash || !HASH.test(txHash)) throw new Error("World App did not return a valid transaction identifier. Check your vault before trying again.");
  const deadline = Date.now() + timeoutMs;
  let canonicalHash = hashType === "transaction" ? txHash : "";
  while (!canonicalHash && Date.now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(5000, Math.max(1, deadline - Date.now())));
    try {
      const response = await fetch(`https://developer.world.org/api/v2/minikit/userop/${txHash}`, { signal: controller.signal });
      if (response.ok) {
        const data = await response.json() as { status?: string; transaction_hash?: string };
        if (data.status === "success" && data.transaction_hash && HASH.test(data.transaction_hash)) canonicalHash = data.transaction_hash;
        if (data.status === "failed") throw new Error("The transaction was not executed. Your vault has not been changed by this request.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("The transaction was not executed")) throw error;
    } finally { clearTimeout(timer); }
    if (!canonicalHash) await pause(intervalMs);
  }
  const remaining = deadline - Date.now();
  if (!canonicalHash || remaining <= 0) throw new Error("World App is still confirming this request. Check your vault before trying again.");
  const receipt = await provider.waitForTransaction(canonicalHash, confirmations, remaining);
  if (!receipt || receipt.status !== 1) throw new Error("The transaction reverted. Check your vault before trying again.");
  if (!check) return true;
  do {
    try { if (await check()) return true; } catch { /* Retry a transient read failure. */ }
    if (Date.now() >= deadline) break;
    await pause(intervalMs);
  } while (Date.now() < deadline);
  throw new Error("The transaction is confirmed, but fresh vault details are unavailable. Reopen the app to check the result.");
}
