export const SESSION_TTL_SECONDS: number;
export const DEFAULT_FRONTEND_ORIGIN: string;
export type SessionClaims = { sub: string; aud: string; iat: number; exp: number };
export type RateLimitDatabase = {
  prepare(sql: string): {
    bind(...values: (string | number)[]): { first(): Promise<unknown> };
  };
};
export function issueSession(secret: string, address: string, audience: string, nowMs?: number): Promise<{ token: string; expiresAt: number }>;
export function verifySession(secret: string, token: string, audience: string, nowMs?: number): Promise<SessionClaims | null>;
export function takeRateLimit(db: RateLimitDatabase, key: string, limit: number, windowMs: number, nowMs?: number): Promise<boolean>;
export function takeCooldown(db: RateLimitDatabase, key: string, cooldownMs: number, nowMs?: number): Promise<boolean>;
