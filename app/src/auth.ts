/**
 * 서버가 검증한 로그인 세션.
 *
 * 왜 서버 세션이 필요한가 — 월드앱 미니앱 로그인은 SIWE 서명을 받지만, 서명을
 * **서버에서 검증하지 않으면** 그 서명을 누가 만들었는지 확인할 사람이 없다.
 * 규칙도 "Always verify the returned SIWE payload on your backend" 라고 명시한다.
 * 검증은 Pages Function(`/api/auth/verify`)이 하고, 여기서는 그 결과만 신뢰한다.
 *
 * 세션에는 검증된 주소만 담는다. 서명·메시지는 저장하지 않는다 — 로그인 한 번의
 * 목적은 "이 사람이 이 주소의 소유자임을 확인" 이고, 그 확인이 끝났으면 서명
 * 자체를 들고 다닐 필요가 없다.
 */

const SESSION_KEY = "wld-session";
const ADDRESS_KEY = "wld-account";

/** 앱이 실제로 서빙되는 origin. 백엔드의 FRONTEND_ORIGIN 과 같아야 한다. */
function origin(): string {
  return typeof location !== "undefined" ? location.origin : "";
}

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 임베디드 컨텍스트에서 localStorage 가 막힐 수 있다. 로그인 자체는
    // 서버에서 이미 검증되었으므로, 저장 실패가 로그인 실패를 뜻하지 않는다.
    void 0;
  }
}

/**
 * 서버에서 로그인 nonce 를 받아온다.
 *
 * 클라이언트가 직접 만들면 안 된다. 서명은 서버가 발급한 nonce 와 한 쌍으로만
 * 유효하므로, 클라이언트가 만든 nonce 는 서버가 검증할 수 없고(위조 가능),
 * 규칙 위반이기도 하다.
 *
 * 서버에 닿지 못하면(로컬 개발, Pages Functions 미배포) null 을 돌려준다. 이
 * 경우 호출자는 로그인을 진행할 수 있지만 **검증 안 됨** 을 명시해야 한다.
 */
export async function fetchAuthNonce(): Promise<string | null> {
  try {
    const r = await fetch("/api/auth/nonce", { headers: { accept: "application/json" } });
    if (!r.ok) return null;
    const j = (await r.json()) as { nonce?: string };
    return j.nonce ?? null;
  } catch {
    return null;
  }
}

export type AuthResult =
  | { ok: true; address: string; verified: boolean }
  | { ok: false; error: string; userFacing: boolean };

/**
 * 월드앱에 로그인을 요청하고, 서버에서 서명을 검증받는다.
 *
 * `verified` 가 false 인 성공은 **서버 검증 없이 로그인한 것**을 뜻한다. 서버가
 * 닿지 않는 환경(로컬 개발)에서만 발생해야 하며, 그 사실을 숨기지 않기 위해
 * 결과에 담아서 돌려준다.
 */
export async function signInWithWorldApp(signature: (nonce: string) => Promise<{ ok: true; address: string; message: string; signature: string } | { ok: false; error: string; userFacing: boolean }>): Promise<AuthResult> {
  const nonce = await fetchAuthNonce();
  if (!nonce) {
    return { ok: false, error: "인증 서버에 연결할 수 없습니다", userFacing: true };
  }

  const signed = await signature(nonce);
  if (!signed.ok) return signed;

  try {
    const r = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nonce,
        payload: { message: signed.message, signature: signed.signature, address: signed.address },
      }),
    });
    const j = (await r.json()) as { isValid?: boolean; address?: string; message?: string };
    if (!r.ok || !j.isValid || !j.address) {
      return { ok: false, error: j.message || "서명 검증에 실패했습니다", userFacing: true };
    }
    // 서명이 가리키는 주소와 서명 요청 시 고른 주소가 같은지 확인한다.
    if (j.address.toLowerCase() !== signed.address.toLowerCase()) {
      return { ok: false, error: "서명 주소가 일치하지 않습니다", userFacing: true };
    }
    store(ADDRESS_KEY, j.address);
    store(SESSION_KEY, JSON.stringify({ address: j.address, at: Date.now() }));
    return { ok: true, address: j.address, verified: true };
  } catch {
    return { ok: false, error: "인증 서버에 연결할 수 없습니다", userFacing: true };
  }
}

/** 저장된 세션 주소. 없으면 null. */
export function readSessionAddress(): string | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { address?: string };
    return j.address ?? null;
  } catch {
    return null;
  }
}

export function clearSession() {
  store(SESSION_KEY, null);
  store(ADDRESS_KEY, null);
}

export { origin as authOrigin };
