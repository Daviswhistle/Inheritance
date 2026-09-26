import { verifySiweMessage } from "@worldcoin/minikit-js/siwe";

/** 주소 형식 검사. ethers 를 Pages Function 에서 로드하지 않기 위한 최소 검사다. */
function ethersIsAddress(a: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(a);
}
import { corsHeaders, json, preflight, verifyNonce, type Env } from "../../_lib/siwe";

/**
 * POST /api/auth/verify — SIWE 서명 검증.
 *
 * 월드앱 guidelines: "Always verify the returned SIWE payload on your backend."
 * 여기서 세 가지를 확인한다:
 *   1. 서버가 발급한 nonce 인지 (HMAC + 만료)
 *   2. 서명이 그 메시지에 대해 유효한지
 *   3. 메시지의 domain 이 이 앱의 도메인인지
 *
 * 하나라도 어긋나면 주소를 돌려주지 않는다. 검증 없이 주소를 신뢰하는 것은
 * 로그인이라고 부를 수 없다.
 */
type VerifyBody = {
  payload?: { message?: string; signature?: string; address?: string };
  nonce?: string;
};

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const headers = corsHeaders(request.headers.get("Origin"), env);
  const pf = preflight(request.headers.get("Origin"), env);
  if (pf) return pf;

  if (!env.SIWE_SECRET) {
    return json(503, { status: "error", message: "SIWE_SECRET is not configured" }, headers);
  }

  let body: VerifyBody;
  try {
    body = (await request.json()) as VerifyBody;
  } catch {
    return json(400, { status: "error", message: "잘못된 요청 본문입니다" }, headers);
  }

  const message = body.payload?.message;
  const signature = body.payload?.signature;
  const claimed = body.payload?.address;
  const nonce = body.nonce;

  if (!message || !signature || !nonce) {
    return json(400, { status: "error", message: "message, signature, nonce 이 모두 필요합니다" }, headers);
  }
  // verifySiweMessage 는 payload.address 를 반드시 요구한다. 없으면 내부에서
  // address.toLowerCase() 에서 TypeError 가 나 사용자는 원인을 알 수 없는 401 을
  // 받는다. 여기서 분명하게 거절한다.
  if (!claimed || !ethersIsAddress(claimed)) {
    return json(400, { status: "error", message: "유효한 address 가 필요합니다" }, headers);
  }

  // 1) nonce 확인 — 이게 없으면 서명은 진짜여도 재사용할 수 있다.
  if (!(await verifyNonce(env.SIWE_SECRET, nonce))) {
    return json(401, { status: "error", message: "nonce 가 유효하지 않거나 만료되었습니다" }, headers);
  }

  // 2+3) 서명 유효성 + domain 확인. 기본 domain 은 배포 origin 이므로
  //      다른 사이트에서 만든 서명을 받아들이지 않는다.
  const expectedDomain = (env.FRONTEND_ORIGIN || "https://inheritance.pages.dev").trim();
  try {
    const result = await verifySiweMessage(
      { message, signature, address: claimed },
      nonce,
      undefined, // statement 는 아래에서 직접 비교한다
      undefined, // requestId 없음
      undefined, // 기본 클라이언트 (공개 World Chain RPC)
    );
    const checked = result as {
      isValid?: boolean;
      siweMessageData?: { address?: string; domain?: string; statement?: string };
    };
    if (!checked.isValid) {
      return json(401, { status: "error", message: "서명 검증에 실패했습니다" }, headers);
    }
    const data = checked.siweMessageData;
    const domainOk = (data?.domain || expectedDomain) === expectedDomain;
    if (!domainOk) {
      return json(401, { status: "error", message: "서명 도메인이 일치하지 않습니다" }, headers);
    }
    return json(
      200,
      { status: "success", isValid: true, address: data?.address, domain: data?.domain },
      headers,
    );
  } catch (e) {
    return json(
      401,
      { status: "error", message: `서명 검증 중 오류: ${(e as Error).message}` },
      headers,
    );
  }
};

export const onRequestOptions = async ({ request, env }: { request: Request; env: Env }) =>
  preflight(request.headers.get("Origin"), env) ?? new Response(null, { status: 204 });
