/** Previously server-verified credentials stay in this tab, expire after one hour,
 * and are reverified by the Worker on every notification request. A cached address
 * alone (including legacy localStorage records) grants no notification access. */
const SESSION_KEY = "wld-session";
const ADDRESS_KEY = "wld-account";
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
type Session = { address: string; token: string; expiresAt: number };
let memorySession: Session | null = null;

function origin(): string {
  return typeof location !== "undefined" ? location.origin : "";
}

function validSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<Session>;
  if (typeof session.address !== "string" || !ADDRESS_RE.test(session.address) || typeof session.token !== "string"
    || typeof session.expiresAt !== "number" || session.expiresAt <= Date.now()) return false;
  const parts = session.token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[0-9a-f]{64}$/.test(parts[2])) return false;
  try {
    // This checks local expiry/identity consistency; only the server verifies the HMAC.
    const claims = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))) as {
      sub?: string; aud?: string; iat?: number; exp?: number;
    };
    return claims.sub === session.address.toLowerCase() && claims.aud === origin()
      && Number.isSafeInteger(claims.iat) && Number.isSafeInteger(claims.exp)
      // Issuance uses the server clock. The Worker verifies its authenticated iat;
      // a slow device clock must not reject a newly verified sign-in.
      && claims.exp! - claims.iat! === 3600
      && claims.exp! * 1000 === session.expiresAt;
  } catch {
    return false;
  }
}

function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const session: unknown = JSON.parse(raw);
      if (validSession(session)) return session;
      clearSession();
      return null;
    }
  } catch {
    // Storage may be unavailable in embedded contexts. Memory lasts only this page.
  }
  if (validSession(memorySession)) return memorySession;
  clearSession();
  return null;
}

function saveSession(session: Session): void {
  memorySession = session;
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* tab memory fallback */ }
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(ADDRESS_KEY);
  } catch { /* optional legacy cleanup */ }
}

export async function fetchAuthNonce(): Promise<string | null> {
  try {
    const response = await fetch("/api/auth/nonce", { headers: { accept: "application/json" }, cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json() as { nonce?: string };
    return typeof data.nonce === "string" && /^[0-9a-f]{64}$/.test(data.nonce) ? data.nonce : null;
  } catch {
    return null;
  }
}

export type AuthResult =
  | { ok: true; address: string; verified: boolean }
  | { ok: false; error: string; userFacing: boolean };

export async function signInWithWorldApp(signature: (nonce: string) => Promise<{
  ok: true; address: string; message: string; signature: string;
} | { ok: false; error: string; userFacing: boolean }>): Promise<AuthResult> {
  const nonce = await fetchAuthNonce();
  if (!nonce) return { ok: false, error: "Cannot reach the sign-in server", userFacing: true };
  const signed = await signature(nonce);
  if (!signed.ok) return signed;
  try {
    const response = await fetch("/api/auth/verify", {
      method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ nonce, payload: { message: signed.message, signature: signed.signature, address: signed.address } }),
    });
    const data = await response.json() as {
      isValid?: boolean; address?: string; token?: string; expiresAt?: number; message?: string;
    };
    if (!response.ok || !data.isValid || typeof data.address !== "string" || data.address.toLowerCase() !== signed.address.toLowerCase()) {
      return { ok: false, error: data.message || "Signature verification failed", userFacing: true };
    }
    const session = { address: data.address, token: data.token, expiresAt: data.expiresAt };
    if (!validSession(session)) return { ok: false, error: "The sign-in server returned an invalid session", userFacing: true };
    saveSession(session);
    return { ok: true, address: session.address, verified: true };
  } catch {
    return { ok: false, error: "Cannot reach the sign-in server", userFacing: true };
  }
}

/** Restore the address only when the tab holds a consistent, unexpired session. */
export function readSessionAddress(): string | null {
  return readSession()?.address ?? null;
}

export function clearSession(): void {
  memorySession = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* storage may be blocked */ }
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(ADDRESS_KEY);
  } catch { /* legacy storage may be blocked */ }
}

export async function notificationFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const session = readSession();
  if (!session) {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("inheritance:session-expired"));
    return new Response(JSON.stringify({ status: "error", message: "Your sign-in expired. Sign in again." }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.token}`);
  const response = await fetch(url, { ...init, headers, cache: "no-store", redirect: "error" });
  if (response.status === 401) {
    // A request from the previous login may finish after a successful reconnect.
    const current = readSession();
    if (!current || current.token === session.token) {
      clearSession();
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("inheritance:session-expired"));
    }
  }
  return response;
}

export type RegisteredVaultWatcher = { vaultAddress: string; [key: string]: unknown };

/** Follow bounded server pages. A capped scan is explicitly incomplete; malformed
 * or nonadvancing cursors fail instead of quietly dropping registered vaults. */
export async function fetchRegisteredVaults(baseUrl: string, maxPages = 25): Promise<{
  watchers: RegisteredVaultWatcher[]; truncated: boolean;
}> {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw new Error("Invalid notification page limit");
  const endpoint = new URL(`${baseUrl.replace(/\/$/, "")}/api/notifications`, origin());
  const watchers = new Map<string, RegisteredVaultWatcher>();
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const url = new URL(endpoint);
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await notificationFetch(url.toString(), { headers: { accept: "application/json" } });
    const data = await response.json() as { status?: string; message?: string; watchers?: unknown; nextCursor?: unknown };
    if (!response.ok || data.status !== "success") throw new Error(data.message || "Could not load registered vaults");
    if (!Array.isArray(data.watchers)) throw new Error("Invalid registered vault list");
    for (const value of data.watchers) {
      if (!value || typeof value !== "object" || typeof value.vaultAddress !== "string" || !ADDRESS_RE.test(value.vaultAddress)) {
        throw new Error("Invalid registered vault list");
      }
      watchers.set(value.vaultAddress.toLowerCase(), value as RegisteredVaultWatcher);
    }
    // Older/local mock responses omit nextCursor to indicate a complete scan.
    if (data.nextCursor === undefined || data.nextCursor === null) return { watchers: [...watchers.values()], truncated: false };
    if (typeof data.nextCursor !== "string" || !ADDRESS_RE.test(data.nextCursor)) throw new Error("Invalid registered vault cursor");
    const next = data.nextCursor.toLowerCase();
    if (cursor && next <= cursor) throw new Error("Registered vault cursor did not advance");
    cursor = next;
  }
  return { watchers: [...watchers.values()], truncated: true };
}

export { origin as authOrigin };
