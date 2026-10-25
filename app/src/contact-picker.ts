export type ContactPickerStatus =
  | "idle"
  | "opening"
  | "cancelled_waiting"
  | "timed_out_waiting"
  | "manual_waiting"
  | "context_waiting"
  | "cancelled"
  | "timed_out"
  | "manual"
  | "empty"
  | "failed";

export type ContactPickerSnapshot = {
  status: ContactPickerStatus;
  pending: boolean;
};

type AbandonReason = "cancelled" | "timed_out" | "manual" | "context";

type NativeRequest = {
  pending: boolean;
  active: boolean;
  reason: AbandonReason | null;
  timer: ReturnType<typeof setTimeout> | null;
};

/**
 * Coordinates the one native contacts request used by plan setup.
 *
 * MiniKit 2.0.3 does not identify individual share-contacts responses and has
 * no timeout. Keep this coordinator at module scope so an App remount cannot
 * start a second native request while the first SDK promise is still pending.
 */
export class ContactPickerCoordinator<T> {
  private request: NativeRequest | null = null;
  private current: ContactPickerSnapshot = { status: "idle", pending: false };
  private readonly listeners = new Set<(snapshot: ContactPickerSnapshot) => void>();
  private readonly timeoutMs: number;

  constructor(timeoutMs = 60_000) {
    this.timeoutMs = timeoutMs;
  }

  get snapshot(): ContactPickerSnapshot {
    return this.current;
  }

  subscribe(listener: (snapshot: ContactPickerSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  start(launch: () => Promise<T | null | undefined>, onSelected: (value: T) => void): boolean {
    if (this.request?.pending) return false;

    const request: NativeRequest = { pending: true, active: true, reason: null, timer: null };
    this.request = request;
    this.publish("opening", true);
    request.timer = setTimeout(() => {
      if (this.request !== request || !request.pending || !request.active) return;
      request.active = false;
      request.reason = "timed_out";
      this.publish("timed_out_waiting", true);
    }, this.timeoutMs);

    void Promise.resolve().then(launch).then(value => {
      if (this.request !== request || !request.active) return;
      if (value === null || value === undefined) {
        this.publish("empty", true);
        return;
      }
      onSelected(value);
    }).catch(() => {
      if (this.request === request && request.active) {
        request.active = false;
        this.publish("failed", true);
      }
    }).finally(() => {
      request.pending = false;
      if (request.timer) clearTimeout(request.timer);
      request.timer = null;
      if (this.request !== request) return;
      if (request.reason) {
        this.publish(request.reason === "context" ? "idle" : request.reason, false);
      } else if (this.current.status === "empty" || this.current.status === "failed") {
        this.publish(this.current.status, false);
      } else {
        this.publish("idle", false);
      }
    });
    return true;
  }

  cancel(): void {
    this.abandon("cancelled");
  }

  manualEdit(): void {
    this.abandon("manual");
  }

  invalidate(): void {
    this.abandon("context");
  }

  private abandon(reason: AbandonReason): void {
    const request = this.request;
    if (!request?.pending) {
      this.publish("idle", false);
      return;
    }
    request.active = false;
    request.reason = reason;
    if (request.timer) clearTimeout(request.timer);
    request.timer = null;
    this.publish(reason + "_waiting" as ContactPickerStatus, true);
  }

  private publish(status: ContactPickerStatus, pending: boolean): void {
    this.current = { status, pending };
    for (const listener of this.listeners) listener(this.current);
  }
}

export const contactPickerCoordinator = new ContactPickerCoordinator<Array<{ username: string; walletAddress: string }>[number]>();
