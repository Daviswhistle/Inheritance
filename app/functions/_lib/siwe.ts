/**
 * 월드앱 로그인(SIWE)용 서버 공통 코드.
 *
 * 왜 서버가 필요한가 — 월드앱 미니앱 심사 규칙은 로그인 서명을 **서버에서
 * 검증**하도록 요구한다. 클라이언트가 서명 결과를 받아 주소만 쓰면, 서명을
 * 누가 만들었는지 아무도 확인하지 않은 채 "로그인"이 성립한다. nonce 도
 * 서버가 발급해야 재사용 공격을 막을 수 있다.
 *
 * 왜 상태 저장소가 필요 없는가 — nonce 를 HMAC 으로 서명해 발급하고, 검증할 때
 * 같은 비밀키로 다시 확인한다. D1 이나 KV 없이 stateless 로 동작하므로
 * Pages Functions 에서 별도 바인딩을 붙일 필요가 없다. 재시도 공격은
 * 만료 시간으로 막는다.
 */

/** CORS. 월드앱 웹뷰는 origin 이 없으므로 '*' 가 아니라 명시적 origin 만 받는다. */
export function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = (env.FRONTEND_ORIGIN || "https://inheritance.pages.dev").trim();
  const req = (origin || "").trim();
  // 월드앱 안에서는 Origin 이 비어올 수 있다. 그 경우 허용 origin 으로 응답한다.
  const use = req === "" || req === allowed ? allowed : null;
  if (!use) return {};
  return {
    "Access-Control-Allow-Origin": use,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/**
 * CORS 프리플라이트 응답.
 *
 * **OPTIONS 요청에서만** 부른다. GET/POST 핸들러 안에서 부르면 그 204 응답이
 * 그대로 반환되어 GET 이 JSON 본문을 못 내보내게 된다 — 실제로 라이브의
 * `/api/auth/nonce` 가 204 만 돌려주는 버그가 이 때문이었다.
 */
export function preflight(origin: string | null, env: Env): Response {
  return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
}

const enc = new TextEncoder();

async function hmac(secret: string, msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const NONCE_TTL_MS = 10 * 60 * 1000;

export type Nonce = { value: string; issuedAt: number; expiresAt: number };

/**
 * nonce 는 **알파벳과 숫자만**으로 만들어야 한다.
 *
 * MiniKit 2.x 는 SIWE nonce 를 엄격하게 검증한다. 실제로 만난 오류:
 *   "Invalid nonce: must be alphanumeric only"
 * 점이든 하이픈이든 섞이면 서명 단계에서 걸린다. 처음에는
 * `<issuedAt>.<exp>.<base64url-hmac>` 형태로 만들었는데 이 때문에 로그인이
 * 서버 검증 단계에서 항상 거부됐다. 로컬 단위 테스트로는 안 잡히고 브라우저를
 * 태워야 보인이였다.
 *
 * 그래서 구분자를 전부 뺀다. 밀리초와 서명 모두 16진수라 0-9a-f 만 나오고
 * 그것이 전부 alphanumeric 이다. 고정 길이로 잘라 파싱하므로 구분자가 없어도
 * 모호함이 없다.
 */
const ISSUED_HEX = 12; // 48비트
const EXP_HEX = 12; // 48비트 — 현재 밀리초(약 1.79e12)는 16진수로 11자리다.
                    // 10자리로 맞추면 앞자리가 잘려 만료 검사가 전부 실패한다.
const SIG_HEX = 64; // SHA-256 = 256비트
const NONCE_LEN = ISSUED_HEX + EXP_HEX + SIG_HEX;

function toHex(n: number, width: number): string {
  const h = n.toString(16);
  if (h.length > width) {
    // 조용히 잘라내면 나중에 원인 파악이 불가능한 검증 실패가 된다. 즉시 드러낸다.
    throw new Error("siwe: 값이 지정한 16진수 너비를 넘었습니다 — 잘라내지 않습니다");
  }
  return h.padStart(width, "0");
}

export async function issueNonce(secret: string): Promise<Nonce> {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + NONCE_TTL_MS;
  const body = toHex(issuedAt, ISSUED_HEX) + toHex(expiresAt, EXP_HEX);
  const sig = await hmac(secret, body);
  let hex = "";
  for (const b of sig) hex += b.toString(16).padStart(2, "0");
  return { value: body + hex, issuedAt, expiresAt };
}

/**
 * nonce 의 서명과 만료를 확인한다.
 *
 * 만료를 서명 확인보다 먼저 보는 이유 — 만료된 값은 서명이 맞아도 쓸 수 없으니
 * 의미가 없다. 어느 쪽이든 거부지만, 만료를 먼저 보면 재시도 시도가 HMAC
 * 검증 비용을 내지 않는다.
 */
export async function verifyNonce(secret: string, value: string): Promise<boolean> {
  if (typeof value !== "string" || value.length !== NONCE_LEN) return false;
  // 여기서 걸러두지 않으면 MiniKit 측 SIWE 검증이 "must be alphanumeric only"
  // 로 거절한다. 서버가 먼저 명확히 거절하는 편이 diagnosable 하다.
  if (!/^[0-9a-f]+$/.test(value)) return false;

  const issuedRaw = value.slice(0, ISSUED_HEX);
  const expRaw = value.slice(ISSUED_HEX, ISSUED_HEX + EXP_HEX);
  const sigHex = value.slice(ISSUED_HEX + EXP_HEX);
  const issuedAt = Number.parseInt(issuedRaw, 16);
  const expiresAt = Number.parseInt(expRaw, 16);
  // 16진수 해석이 소실되면(앞자리가 0 이 아닌 값) 만료 판정이 뒤집힌다.
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) return false;
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return false;

  const now = Date.now();
  if (now > expiresAt) return false;
  if (issuedAt > now + 60_000) return false; // 미래 발급분은 시계 조작 대비로 거부

  const given = new Uint8Array(SIG_HEX / 2);
  for (let i = 0; i < given.length; i++) {
    given[i] = Number.parseInt(sigHex.slice(i * 2, i * 2 + 2), 16);
  }
  const expected = await hmac(secret, issuedRaw + expRaw);
  return constantTimeEqual(given, expected);
}

export type Env = {
  SIWE_SECRET?: string;
  FRONTEND_ORIGIN?: string;
};
