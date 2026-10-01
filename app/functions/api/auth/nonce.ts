import { corsHeaders, issueNonce, json, originAllowed, preflight, takeNonceIssueAllowance, type Env } from "../../_lib/siwe";

/**
 * GET /api/auth/nonce — 로그인용 nonce 발급.
 *
 * D1에 해시로 저장한 무작위 nonce는 검증 후 단 한 번만 소비할 수 있다.
 */
export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const headers = corsHeaders(request.headers.get("Origin"), env);
  if (!originAllowed(request.headers.get("Origin"), env)) {
    return json(403, { status: "error", message: "Origin not allowed" }, headers);
  }

  if (!env.SIWE_SECRET || !env.DB) {
    // 조용히 통과시키지 않는다. secret 이 없으면 검증이 불가능하므로
    // "설정 오류"를 명시해야 배포자가 알아차릴 수 있다.
    return json(503, { status: "error", message: "Sign-in is not configured" }, headers);
  }

  try {
    const allowance = await takeNonceIssueAllowance(request, env);
    if (!allowance.allowed) {
      return json(429, { status: "error", message: "Too many sign-in attempts. Wait a minute and try again." },
        { ...headers, "Retry-After": String(allowance.retryAfter) });
    }
    const nonce = await issueNonce(env);
    return json(200, { status: "success", nonce: nonce.value, expiresAt: nonce.expiresAt }, headers);
  } catch {
    return json(503, { status: "error", message: "Sign-in storage is unavailable" }, headers);
  }
};

export const onRequestOptions = async ({ request, env }: { request: Request; env: Env }) =>
  preflight(request.headers.get("Origin"), env);
