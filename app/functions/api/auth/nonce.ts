import { corsHeaders, issueNonce, json, preflight, type Env } from "../../_lib/siwe";

/**
 * GET /api/auth/nonce — 로그인용 nonce 발급.
 *
 * 클라이언트가 아니라 서버가 발급해야 한다. 서명이 붙은 SIWE 메시지는 서버가
 * 발급한 nonce 와 한 쌍으로만 유효하므로, 재사용하거나 위조할 수 없다.
 */
export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const headers = corsHeaders(request.headers.get("Origin"), env);

  if (!env.SIWE_SECRET) {
    // 조용히 통과시키지 않는다. secret 이 없으면 검증이 불가능하므로
    // "설정 오류"를 명시해야 배포자가 알아차릴 수 있다.
    return json(503, { status: "error", message: "SIWE_SECRET is not configured" }, headers);
  }

  const nonce = await issueNonce(env.SIWE_SECRET);
  return json(200, { status: "success", nonce: nonce.value, expiresAt: nonce.expiresAt }, headers);
};

export const onRequestOptions = async ({ request, env }: { request: Request; env: Env }) =>
  preflight(request.headers.get("Origin"), env);
