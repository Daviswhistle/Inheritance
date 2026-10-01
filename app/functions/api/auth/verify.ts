import { verifySiweMessage } from "@worldcoin/minikit-js/siwe";
import { issueSession } from "../../../../backend/src/session.mjs";

/** 주소 형식 검사. ethers 를 Pages Function 에서 로드하지 않기 위한 최소 검사다. */
function ethersIsAddress(a: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(a);
}
import { consumeNonce, corsHeaders, frontendOrigin, json, originAllowed, preflight, SIGN_IN_STATEMENT, verifyNonce, type Env } from "../../_lib/siwe";

/**
 * POST /api/auth/verify — SIWE 서명 검증.
 *
 * 월드앱 guidelines: "Always verify the returned SIWE payload on your backend."
 * 여기서 세 가지를 확인한다:
 *   1. 서버가 발급한 일회용 무작위 nonce인지
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
  if (!originAllowed(request.headers.get("Origin"), env)) {
    return json(403, { status: "error", message: "Origin not allowed" }, headers);
  }

  if (!env.SIWE_SECRET || !env.DB) {
    return json(503, { status: "error", message: "Sign-in is not configured" }, headers);
  }

  let body: VerifyBody;
  try {
    body = (await request.json()) as VerifyBody;
  } catch {
    return json(400, { status: "error", message: "Invalid JSON body" }, headers);
  }

  const message = body?.payload?.message;
  const signature = body?.payload?.signature;
  const claimed = body?.payload?.address;
  const nonce = body?.nonce;

  if (typeof message !== "string" || !message || message.length > 8192 || typeof signature !== "string" || !signature
    || signature.length > 8192 || typeof nonce !== "string" || !nonce) {
    return json(400, { status: "error", message: "A valid message, signature and nonce are required" }, headers);
  }
  // verifySiweMessage 는 payload.address 를 반드시 요구한다. 없으면 내부에서
  // address.toLowerCase() 에서 TypeError 가 나 사용자는 원인을 알 수 없는 401 을
  // 받는다. 여기서 분명하게 거절한다.
  if (typeof claimed !== "string" || !ethersIsAddress(claimed) || /^0x0{40}$/i.test(claimed)) {
    return json(400, { status: "error", message: "A valid wallet address is required" }, headers);
  }

  // 1) nonce 확인 — 이게 없으면 서명은 진짜여도 재사용할 수 있다.
  try {
    if (!(await verifyNonce(env, nonce))) {
      return json(401, { status: "error", message: "Nonce is invalid, expired or already used" }, headers);
    }
  } catch {
    return json(503, { status: "error", message: "Sign-in storage is unavailable" }, headers);
  }

  // 2+3) 서명 유효성 + domain 확인. 기본 domain 은 배포 origin 이므로
  //      다른 사이트에서 만든 서명을 받아들이지 않는다.
  const expectedDomain = frontendOrigin(env);
  let data: { address?: string; domain?: string; statement?: string; chain_id?: string | number; uri?: string } | undefined;
  try {
    const result = await verifySiweMessage(
      { message, signature, address: claimed },
      nonce,
      SIGN_IN_STATEMENT,
      undefined, // requestId 없음
      undefined, // 기본 클라이언트 (공개 World Chain RPC)
    );
    const checked = result as {
      isValid?: boolean;
      siweMessageData?: { address?: string; domain?: string; statement?: string; chain_id?: string | number; uri?: string };
    };
    if (!checked.isValid) {
      return json(401, { status: "error", message: "Signature verification failed" }, headers);
    }
    data = checked.siweMessageData;
    // MiniKit returns the origin including its scheme. Match that exact value.
    if (data?.domain !== expectedDomain || data.statement !== SIGN_IN_STATEMENT || String(data.chain_id) !== "480"
      || !data.address || !ethersIsAddress(data.address) || data.address.toLowerCase() !== claimed.toLowerCase()) {
      return json(401, { status: "error", message: "Sign-in message does not match this app or wallet" }, headers);
    }
  } catch {
    return json(401, { status: "error", message: "Signature verification failed" }, headers);
  }
  try {
    // Two concurrent verifications may both validate the signature; only one DELETE wins.
    if (!await consumeNonce(env, nonce)) {
      return json(401, { status: "error", message: "Nonce is invalid, expired or already used" }, headers);
    }
    const session = await issueSession(env.SIWE_SECRET, data.address!, expectedDomain);
    return json(200, { status: "success", isValid: true, address: data.address, domain: data.domain, ...session }, headers);
  } catch {
    return json(503, { status: "error", message: "Sign-in storage is unavailable" }, headers);
  }
};

export const onRequestOptions = async ({ request, env }: { request: Request; env: Env }) =>
  preflight(request.headers.get("Origin"), env);
