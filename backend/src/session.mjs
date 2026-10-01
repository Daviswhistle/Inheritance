// Shared by Pages (session issuer) and the notification Worker (verifier).
// The HMAC purpose prefix keeps this credential separate from other secret uses.
export const SESSION_TTL_SECONDS = 60 * 60;
export const DEFAULT_FRONTEND_ORIGIN = "https://inheritance.pages.dev";
const PURPOSE = "world-inheritance-session/v1.";
const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const encoder = new TextEncoder();

const keyFor = (secret, usage) => crypto.subtle.importKey(
  "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage],
);

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const encodePayload = (claims) => btoa(JSON.stringify(claims)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function issueSession(secret, address, audience, nowMs = Date.now()) {
  const sub = address.toLowerCase();
  if (!secret || !ADDRESS_RE.test(sub) || /^0x0{40}$/.test(sub) || !audience) {
    throw new Error("Invalid session configuration or address");
  }
  const iat = Math.floor(nowMs / 1000);
  const claims = { sub, aud: audience, iat, exp: iat + SESSION_TTL_SECONDS };
  const payload = encodePayload(claims);
  const signature = await crypto.subtle.sign("HMAC", await keyFor(secret, "sign"), encoder.encode(PURPOSE + payload));
  return { token: `v1.${payload}.${toHex(new Uint8Array(signature))}`, expiresAt: claims.exp * 1000 };
}

export async function verifySession(secret, token, audience, nowMs = Date.now()) {
  if (!secret || typeof token !== "string" || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[0-9a-f]{64}$/.test(parts[2])) return null;
  try {
    const signature = Uint8Array.from(parts[2].match(/../g), (byte) => Number.parseInt(byte, 16));
    if (!await crypto.subtle.verify("HMAC", await keyFor(secret, "verify"), signature, encoder.encode(PURPOSE + parts[1]))) return null;
    const claims = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    const now = Math.floor(nowMs / 1000);
    if (typeof claims.sub !== "string" || !ADDRESS_RE.test(claims.sub) || /^0x0{40}$/.test(claims.sub) || claims.aud !== audience
      || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)
      || claims.iat > now + 30 || claims.exp <= now || claims.exp - claims.iat !== SESSION_TTL_SECONDS) return null;
    return claims;
  } catch {
    return null;
  }
}

/** One atomic, persistent fixed-window counter; delayed requests cannot rewind it. */
export async function takeRateLimit(db, key, limit, windowMs, nowMs = Date.now()) {
  const windowStart = Math.floor(nowMs / windowMs) * windowMs;
  const row = await db.prepare(`
    INSERT INTO auth_rate_limits (rate_key, window_start, attempts, expires_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(rate_key) DO UPDATE SET
      window_start = excluded.window_start,
      attempts = CASE WHEN auth_rate_limits.window_start = excluded.window_start THEN auth_rate_limits.attempts + 1 ELSE 1 END,
      expires_at = excluded.expires_at
    WHERE auth_rate_limits.window_start < excluded.window_start
      OR (auth_rate_limits.window_start = excluded.window_start AND auth_rate_limits.attempts < ?)
    RETURNING attempts
  `).bind(key, windowStart, windowStart + windowMs, limit).first();
  return Boolean(row);
}

/** A minimum interval, including requests on opposite sides of a minute boundary. */
export async function takeCooldown(db, key, cooldownMs, nowMs = Date.now()) {
  const row = await db.prepare(`
    INSERT INTO auth_rate_limits (rate_key, window_start, attempts, expires_at) VALUES (?, ?, 1, ?)
    ON CONFLICT(rate_key) DO UPDATE SET window_start = excluded.window_start, attempts = 1, expires_at = excluded.expires_at
    WHERE auth_rate_limits.expires_at <= excluded.window_start RETURNING attempts
  `).bind(key, nowMs, nowMs + cooldownMs).first();
  return Boolean(row);
}
