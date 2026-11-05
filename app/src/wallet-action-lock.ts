/** One account may have several app windows. Never queue an old approval behind
 * another action: it must be reviewed and deliberately requested again. */
export const WALLET_ACTION_BUSY = "Another window is checking or submitting a wallet action. Wait for it to finish, then try again.";

export async function withWalletActionLock<T>(account: string, action: () => Promise<T>,
  locks: Pick<LockManager, "request"> | undefined = globalThis.navigator?.locks): Promise<T> {
  // Durable compare-and-swap journals protect deposits and withdrawals even
  // on older WebViews. This optional lock also keeps other actions from racing.
  if (!locks) return action();
  if (!account) throw new Error("Connect your wallet before continuing.");
  return locks.request(`inheritance:wallet-action:${account.toLowerCase()}`,
    { mode: "exclusive", ifAvailable: true }, async lock => {
      if (!lock) throw new Error(WALLET_ACTION_BUSY);
      return action();
    });
}
