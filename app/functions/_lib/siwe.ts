import { DEFAULT_FRONTEND_ORIGIN } from "../../../backend/src/session.mjs";

export type Env = {
  SIWE_SECRET?: string;
  FRONTEND_ORIGIN?: string;
  DB?: {
    prepare(sql: string): {
      bind(...values: (string | number)[]): {
        run(): Promise<unknown>;
        first<T = Record<string, unknown>>(): Promise<T | null>;
      };
    };
  };
};

export const SIGN_IN_STATEMENT = "Sign in to Inheritance";
export const NONCE_TTL_MS = 10 * 60 * 1000;
export const NONCE_ISSUE_LIMIT = 30;
export const NONCE_ISSUE_WINDOW_MS = 60 * 1000;
const encoder = new TextEncoder();

export const frontendOrigin = (env: Env) => (env.FRONTEND_ORIGIN || DEFAULT_FRONTEND_ORIGIN).trim();
export const originAllowed = (origin: string | null, env: Env) => !origin || origin === frontendOrigin(env);

export function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  return {
    ...(originAllowed(origin, env) ? { "Access-Control-Allow-Origin": frontendOrigin(env) } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

export function preflight(origin: string | null, env: Env): Response {
  return new Response(null, { status: originAllowed(origin, env) ? 204 : 403, headers: corsHeaders(origin, env) });
}

async function nonceHash(nonce: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(nonce)));
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type Nonce = { value: string; issuedAt: number; expiresAt: number };

/** Cloudflare supplies this header. Never trust client-controlled forwarded headers.
 * Missing local/proxy metadata uses one shared, bounded bucket. The raw address is
 * used only in memory; D1 sees a secret-keyed digest that changes each minute. */
export async function takeNonceIssueAllowance(request: Request, env: Env): Promise<{ allowed: boolean; retryAfter: number }> {
  if (!env.DB || !env.SIWE_SECRET) throw new Error("Missing sign-in configuration");
  const now = Date.now();
  const windowStart = Math.floor(now / NONCE_ISSUE_WINDOW_MS) * NONCE_ISSUE_WINDOW_MS;
  const expiresAt = windowStart + NONCE_ISSUE_WINDOW_MS;
  const retryAfter = Math.max(1, Math.ceil((expiresAt - now) / 1000));
  const forwarded = request.headers.get("CF-Connecting-IP")?.trim().toLowerCase() || "";
  const looksLikeIp = forwarded.length <= 64 && /^[0-9a-f:.]+$/.test(forwarded) && (forwarded.includes(":") || forwarded.includes("."));
  const caller = looksLikeIp ? forwarded : "missing-cloudflare-ip";
  const key = await crypto.subtle.importKey("raw", encoder.encode(env.SIWE_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key,
    encoder.encode(`world-inheritance-nonce-limit/v1:${windowStart}:${caller}`)));
  const rateKey = "nonce:" + Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  // Saturated callers do only a read. The atomic conditional upsert still protects
  // against callers racing from below the cap, and denied races write zero rows.
  const previous = await env.DB.prepare("SELECT attempts FROM auth_rate_limits WHERE rate_key = ? AND expires_at > ?")
    .bind(rateKey, now).first<{ attempts: number }>();
  if (previous && previous.attempts >= NONCE_ISSUE_LIMIT) return { allowed: false, retryAfter };
  const claimed = await env.DB.prepare(`
    INSERT INTO auth_rate_limits (rate_key, window_start, attempts, expires_at) VALUES (?, ?, 1, ?)
    ON CONFLICT(rate_key) DO UPDATE SET attempts = auth_rate_limits.attempts + 1
    WHERE auth_rate_limits.attempts < ? AND auth_rate_limits.expires_at > ? RETURNING attempts
  `).bind(rateKey, windowStart, expiresAt, NONCE_ISSUE_LIMIT, now).first();
  return { allowed: Boolean(claimed), retryAfter };
}

export async function issueNonce(env: Env): Promise<Nonce> {
  if (!env.DB) throw new Error("Missing DB binding");
  const issuedAt = Date.now();
  const expiresAt = issuedAt + NONCE_TTL_MS;
  // 256 random bits; hexadecimal is compatible with MiniKit's alphanumeric nonce.
  const value = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("DELETE FROM auth_nonces WHERE expires_at <= ?").bind(issuedAt).run();
  await env.DB.prepare("DELETE FROM auth_rate_limits WHERE expires_at <= ?").bind(issuedAt).run();
  await env.DB.prepare("INSERT INTO auth_nonces (nonce_hash, issued_at, expires_at) VALUES (?, ?, ?)")
    .bind(await nonceHash(value), issuedAt, expiresAt).run();
  return { value, issuedAt, expiresAt };
}

/** Read before expensive signature verification. This does not consume the nonce. */
export async function verifyNonce(env: Env, value: string): Promise<boolean> {
  if (!env.DB || typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) return false;
  const row = await env.DB.prepare("SELECT nonce_hash FROM auth_nonces WHERE nonce_hash = ? AND expires_at > ?")
    .bind(await nonceHash(value), Date.now()).first();
  return Boolean(row);
}

/** Consume only after the signature and its domain, statement and address passed. */
export async function consumeNonce(env: Env, value: string): Promise<boolean> {
  if (!env.DB || typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) return false;
  const row = await env.DB.prepare("DELETE FROM auth_nonces WHERE nonce_hash = ? AND expires_at > ? RETURNING nonce_hash")
    .bind(await nonceHash(value), Date.now()).first();
  return Boolean(row);
}
