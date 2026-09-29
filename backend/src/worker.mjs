const DEFAULT_RPC_URL = "https://worldchain-mainnet.g.alchemy.com/public";
// 라이브 응답에 노출한다. 배포가 실제로 반영됐는지 curl 로 확인할 수 있다
// (한동안 옛 코드가 도는 것 같아 이 필드로 판별했다).
const CODE_VERSION = "two-step-1";
const SEND_NOTIFICATION_URL = "https://developer.world.org/api/v2/minikit/send-notification";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// 두 단계 상속 컨트랙트(InheritanceVaultWLD)의 함수 셀렉터.
//
// 여기를 잘못 채운 채로 오면 조용히 엉뚱한 값을 읽는다. 실제로 예전 셀렉터
// 목록에 있던 HEIR "0xe3cfef60" 은 heir() 가 아니라 timeRemaining() 이었다
// (heir() = 0x91f2ebb8). uint 를 주소로 디코딩하고 있었고, CAN_CLAIM
// "0x6dc7a627" 은 컨트랙트에서 아예 삭제된 함수다.
//
// 셀렉터는 함수 시그니처에서 파생되므로 시그니처를 바꿀 때마다 함께 갱신한다.
// 검증: scripts/verify-notify-selectors.sh
const SELECTORS = {
  OWNER: "0x8da5cb5b",              // owner()
  HEIR: "0x91f2ebb8",               // heir()
  WLD: "0xde061d66",                // WLD()
  BALANCE_OF: "0x70a08231",         // balanceOf(address)
  IS_EXPIRED: "0x2f13b60c",         // isExpired()          카운트다운 종료, 상속인 미신청
  CLAIM_PENDING: "0x03a9f06e",      // claimPending()       상속인 신청함
  CHALLENGE_ENDS_AT: "0x765be13f",  // challengeEndsAt()    이의제기 끝나는 시각
  CLAIMABLE_NOW: "0xc4671608",      // claimableNow()       7일 지남, 최종 수령 가능
  TIME_REMAINING: "0xe3cfef60",     // timeRemaining()
  HEARTBEAT_INTERVAL: "0x561a4fac", // heartbeatInterval()
  CANCELLED: "0x12cd6595",          // inheritanceCancelled()
  CLAIMED_AT: "0xd2217fac",          // claimedAt()          최종 수령 완료 시각
};

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS watchers (
  vault_address TEXT PRIMARY KEY,
  owner_address TEXT NOT NULL,
  heir_address TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_checked_at TEXT,
  last_claimable INTEGER NOT NULL DEFAULT 0,
  last_vault_balance TEXT NOT NULL DEFAULT '0',
  notified_heir_address TEXT,
  notified_at TEXT,
  last_error TEXT,
  alerts TEXT
);
`;

/** @type {Promise<void> | null} */
let schemaReady = null;

const nowIso = () => new Date().toISOString();

/**
 * 알림 dedupe 상태를 읽는다.
 *
 * JSON 이 깨졌거나 옛 행(컬럼 없음)이면 빈 객체로 시작한다. 상태를 잃는 것은
 * 알림을 한 번 더 보내는 것보다 나쁘지 않다.
 */
const parseAlerts = (raw) => {
  if (!raw) return {};
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};

const normalizeAddress = (value) => {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!ADDRESS_RE.test(v)) return null;
  return `0x${v.slice(2).toLowerCase()}`;
};

const addrEq = (a, b) => normalizeAddress(a) === normalizeAddress(b);

const padAddress = (address) => {
  const normalized = normalizeAddress(address);
  if (!normalized) throw new Error("Invalid address");
  return `${"0".repeat(24)}${normalized.slice(2)}`;
};

const encodeBalanceOf = (address) => `${SELECTORS.BALANCE_OF}${padAddress(address)}`;

const decodeAddress = (hex) => {
  if (typeof hex !== "string" || !hex.startsWith("0x") || hex.length < 42) {
    // 이 주소에 컨트랙트가 없거나 함수 호출이 revert 했다. eth_call 은 둘 다 빈
    // 결과를 돌려주므로 구분되지 않는다 — 어느 쪽이든 "여기에 금고가 없다" 고
    // 말하는 게 호출자에게 쓸모 있는 답이다.
    throw new Error("no contract at this address, or the call reverted");
  }
  return `0x${hex.slice(-40).toLowerCase()}`;
};

const decodeBool = (hex) => {
  if (typeof hex !== "string" || !hex.startsWith("0x")) throw new Error("Invalid encoded bool");
  return BigInt(hex) !== 0n;
};

const decodeUint = (hex) => {
  if (typeof hex !== "string" || !hex.startsWith("0x")) throw new Error("Invalid encoded uint");
  return BigInt(hex);
};

const resolveCors = (request, env) => {
  const origin = request.headers.get("Origin");
  if (!origin) return { allowed: true, headers: {} };

  const allowedOrigin = (env.FRONTEND_ORIGIN || "").trim();
  const base = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };

  if (!allowedOrigin) {
    return {
      allowed: true,
      headers: {
        ...base,
        "Access-Control-Allow-Origin": "*",
      },
    };
  }

  if (origin !== allowedOrigin) {
    return { allowed: false, headers: {} };
  }

  return {
    allowed: true,
    headers: {
      ...base,
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
    },
  };
};

const jsonResponse = (status, payload, corsHeaders = {}) => {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
    },
  });
};

const readJson = async (request) => {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON body");
  }
};

const ensureSchema = async (env) => {
  if (!env.DB) throw new Error("Missing DB binding");
  if (!schemaReady) {
    schemaReady = env.DB
      .prepare(CREATE_TABLE_SQL)
      .run()
      .then(() => {});
  }
  await schemaReady;
};

const rpc = async (env, method, params = []) => {
  const rpcUrl = (env.RPC_URL || DEFAULT_RPC_URL).trim() || DEFAULT_RPC_URL;
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    throw new Error(data?.error?.message || `RPC ${method} failed`);
  }
  return data.result;
};

const ethCall = async (env, to, data) => {
  return rpc(env, "eth_call", [{ to, data }, "latest"]);
};

/**
 * 컨트랙트 호출이 실패할 때 상태를 "모름" 으로 두고 계속 진행한다.
 * 조용히 아무 알림도 안 보내는 편이 나쁘다 — 일부 조회가 실패해도 나머지는 보낸다.
 */
const readFlag = async (env, to, selector, fallback = null) => {
  try {
    return decodeBool(await ethCall(env, to, selector));
  } catch {
    return fallback;
  }
};
const readUint = async (env, to, selector, fallback = null) => {
  try {
    return decodeUint(await ethCall(env, to, selector));
  } catch {
    return fallback;
  }
};

/**
 * 금고의 상속 파이프라인 상태를 한 번에 읽는다.
 *
 * 두 단계 상속이라 "지금 돈을 뺄 수 있나" 를 뜻하는 단일 불리언으로는 부족하다.
 * 누구에게 무엇을 알릴지가 이 값들에 달려 있으므로 전부 읽는다.
 */
const getVaultSnapshot = async (env, vaultAddress) => {
  const vault = normalizeAddress(vaultAddress);
  if (!vault) throw new Error("Invalid vault address");

  const ownerAddress = decodeAddress(await ethCall(env, vault, SELECTORS.OWNER));
  const heirAddress = decodeAddress(await ethCall(env, vault, SELECTORS.HEIR));

  const [isExpired, claimPending, claimableNow, cancelled, claimedAt,
    challengeEndsAt, timeRemaining, heartbeatInterval] = await Promise.all([
    readFlag(env, vault, SELECTORS.IS_EXPIRED, null),
    readFlag(env, vault, SELECTORS.CLAIM_PENDING, null),
    readFlag(env, vault, SELECTORS.CLAIMABLE_NOW, null),
    readFlag(env, vault, SELECTORS.CANCELLED, null),
    readUint(env, vault, SELECTORS.CLAIMED_AT, null),
    readUint(env, vault, SELECTORS.CHALLENGE_ENDS_AT, null),
    readUint(env, vault, SELECTORS.TIME_REMAINING, null),
    readUint(env, vault, SELECTORS.HEARTBEAT_INTERVAL, null),
  ]);

  let tokenAddress = null;
  try {
    tokenAddress = decodeAddress(await ethCall(env, vault, SELECTORS.WLD));
  } catch {
    tokenAddress = null;
  }

  let vaultBalance = 0n;
  if (tokenAddress && tokenAddress !== ZERO_ADDRESS) {
    try {
      vaultBalance = decodeUint(await ethCall(env, tokenAddress, encodeBalanceOf(vault)));
    } catch {
      vaultBalance = 0n;
    }
  }

  return {
    vaultAddress: vault,
    ownerAddress,
    heirAddress,
    tokenAddress,
    vaultBalance,
    isExpired,
    claimPending,
    claimableNow,
    cancelled,
    claimedAt,
    challengeEndsAt,
    timeRemaining,
    heartbeatInterval,
  };
};

const rowToWatcher = (row) => {
  return {
    vaultAddress: row.vault_address,
    ownerAddress: row.owner_address,
    heirAddress: row.heir_address,
    active: Number(row.active) !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastCheckedAt: row.last_checked_at || null,
    lastClaimable: Number(row.last_claimable) !== 0,
    lastVaultBalance: String(row.last_vault_balance || "0"),
    notifiedHeirAddress: row.notified_heir_address || null,
    notifiedAt: row.notified_at || null,
    alerts: parseAlerts(row.alerts),
    lastError: row.last_error || null,
  };
};

const saveWatcher = async (env, watcher) => {
  await env.DB.prepare(
    `
      INSERT INTO watchers (
        vault_address,
        owner_address,
        heir_address,
        active,
        created_at,
        updated_at,
        last_checked_at,
        last_claimable,
        last_vault_balance,
        notified_heir_address,
        notified_at,
        last_error,
        alerts
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(vault_address) DO UPDATE SET
        owner_address = excluded.owner_address,
        heir_address = excluded.heir_address,
        active = excluded.active,
        updated_at = excluded.updated_at,
        last_checked_at = excluded.last_checked_at,
        last_claimable = excluded.last_claimable,
        last_vault_balance = excluded.last_vault_balance,
        notified_heir_address = excluded.notified_heir_address,
        notified_at = excluded.notified_at,
        last_error = excluded.last_error,
        alerts = excluded.alerts
    `
  )
    .bind(
      watcher.vaultAddress,
      watcher.ownerAddress,
      watcher.heirAddress,
      watcher.active ? 1 : 0,
      watcher.createdAt,
      watcher.updatedAt,
      watcher.lastCheckedAt,
      watcher.lastClaimable ? 1 : 0,
      watcher.lastVaultBalance,
      watcher.notifiedHeirAddress,
      watcher.notifiedAt,
      watcher.lastError,
        // alerts 는 반드시 bind 안으로 들어가야 한다. 예전에는 .bind() 에 12개만 주고
        // 13번째를 .run(x) 로 넘겼는데, D1 은 "Wrong number of parameter bindings" 로
        // 거절한다 — 즉 saveWatcher 가 **한 번도 성공한 적이 없다**. 그래서 금고 등록이
        // 500 이고 watcher 가 영영 늘지 않았으며 알림 기능 전체가 죽어 있었다.
        // 순수 결정 함수만 테스트해서 눈치채지 못했다.
        JSON.stringify(watcher.alerts || {})
    )
      .run();
};

const getWatcherByVault = async (env, vaultAddress) => {
  const row = await env.DB.prepare(
    `
      SELECT
        vault_address,
        owner_address,
        heir_address,
        active,
        created_at,
        updated_at,
        last_checked_at,
        last_claimable,
        last_vault_balance,
        notified_heir_address,
        notified_at,
        last_error
      FROM watchers
      WHERE vault_address = ?
      LIMIT 1
    `
  )
    .bind(vaultAddress)
    .first();

  return row ? rowToWatcher(row) : null;
};

const listWatchers = async (env, onlyActive = false) => {
  const sql = onlyActive
    ? `
      SELECT
        vault_address,
        owner_address,
        heir_address,
        active,
        created_at,
        updated_at,
        last_checked_at,
        last_claimable,
        last_vault_balance,
        notified_heir_address,
        notified_at,
        last_error
      FROM watchers
      WHERE active = 1
    `
    : `
      SELECT
        vault_address,
        owner_address,
        heir_address,
        active,
        created_at,
        updated_at,
        last_checked_at,
        last_claimable,
        last_vault_balance,
        notified_heir_address,
        notified_at,
        last_error
      FROM watchers
    `;
  const result = await env.DB.prepare(sql).all();
  return (result.results || []).map(rowToWatcher);
};

const countWatchers = async (env) => {
  const row = await env.DB.prepare("SELECT COUNT(1) AS count FROM watchers").first();
  return Number(row?.count || 0);
};

const upsertWatcherFromSnapshot = async (env, snapshot) => {
  const prev = await getWatcherByVault(env, snapshot.vaultAddress);
  const stamp = nowIso();
  const keepNotifiedHeir = prev?.notifiedHeirAddress && addrEq(prev.notifiedHeirAddress, snapshot.heirAddress);
  const watcher = {
    vaultAddress: snapshot.vaultAddress,
    ownerAddress: snapshot.ownerAddress,
    heirAddress: snapshot.heirAddress,
    active: true,
    createdAt: prev?.createdAt || stamp,
    updatedAt: stamp,
    lastCheckedAt: prev?.lastCheckedAt || null,
    lastClaimable: snapshot.canClaim,
    lastVaultBalance: snapshot.vaultBalance.toString(),
    notifiedHeirAddress: keepNotifiedHeir ? prev.notifiedHeirAddress : null,
    notifiedAt: keepNotifiedHeir && snapshot.canClaim ? prev.notifiedAt : null,
    lastError: null,
  };
  await saveWatcher(env, watcher);
  return watcher;
};

/**
 * 월드앱 딥링크.
 *
 * 형식이 엄격하다. `/?vault=0x...` 같은 상대경로는 매번
 * "mini_app_path must be a valid WorldApp or World ID deeplink" 로 거절된다.
 * 반드시 `worldapp://mini-app?app_id=app_...` 여야 하고, 뒤에 파라미터를
 * 덧붙이는 것은 허용된다 (그래서 금고 주소를 함께 실었다).
 */
const miniAppDeepLink = (appId, vaultAddress) => {
  const base = `worldapp://mini-app?app_id=${appId}`;
  return vaultAddress ? `${base}&vault=${vaultAddress}` : base;
};

/**
 * API 응답에서 "실제로 전달됐는가" 를 읽는다.
 *
 * 응답은 { success, result: [{ walletAddress, sent, reason }] } 모양이다.
 * 200 이어도 sent:false 가 붙으면 전달되지 않은 것이다 — 월드앱을 설치하지
 * 않은 지갑이면 "User not found" 가 온다. 그걸 성공으로 세면 상속인은 알림을
 * 영영 못 받는다.
 */
const readDelivery = (res, walletAddress) => {
  const rows = Array.isArray(res?.result) ? res.result : [];
  const row = rows.find(
    (r) => typeof r?.walletAddress === "string" && r.walletAddress.toLowerCase() === walletAddress.toLowerCase(),
  ) || rows[0];
  if (!row) return { delivered: false, reason: "no result row" };
  if (row.sent === true) return { delivered: true, reason: null };
  return { delivered: false, reason: String(row.reason || "not delivered") };
};

const sendWorldNotification = async (env, { walletAddress, title, message, vaultAddress = null }) => {
  const appId = (env.WORLD_APP_ID || "").trim();
  const apiKey = (env.WORLD_NOTIFY_API_KEY || "").trim();
  if (!appId || !appId.startsWith("app_")) {
    throw new Error("Missing WORLD_APP_ID env (app_...)");
  }
  if (!apiKey) {
    throw new Error("Missing WORLD_NOTIFY_API_KEY env");
  }

  const res = await fetch(SEND_NOTIFICATION_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // User-Agent 를 반드시 명시한다. 이 API 앞단의 WAF 는 UA 가 없는 요청을
      // 403 으로 막는다 — 본문 없는 nginx 403 HTML 이 돌아온다.
      //
      // Workers 런타임의 fetch 는 기본적으로 UA 를 보내지 않아서 이 요청이 전부
      // 403 이었다. 같은 머신에서 curl 로 테스트하면 200 이라 "키가 잘못됐나"
      // 로 오해하기 쉽다. UA 가 문제인지 IP 가 문제인지는 UA 만 바꿔 보면 갈린다.
      "User-Agent": "world-inheritance-notify/1.0 (+https://inheritance.pages.dev)",
    },
    body: JSON.stringify({
      app_id: appId,
      wallet_addresses: [walletAddress],
      title,
      message,
        mini_app_path: miniAppDeepLink(appId, vaultAddress),
    }),
  });

  // 본문을 그대로 붙잡는다. JSON 이 아닐 수 있다 — 앞단에 막히면 HTML 이 온다.
  // res.json().catch(() => ({})) 로 삼키면 "Notification API failed (403)" 만
  // 남고 원인을 알 방법이 없다. 실제로 그랬다.
  const raw = await res.text().catch(() => "");
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    const code = data?.code ? `[${data.code}]` : "";
    const detail = data?.detail || data?.message || data?.error;
    const body = detail
      ? (typeof detail === "string" ? detail : JSON.stringify(detail))
      : (raw ? `non-JSON body: ${raw.slice(0, 300)}` : "empty body");
    throw new Error(
      `Notification API ${res.status} ${code} | ${body} | host=${new URL(SEND_NOTIFICATION_URL).host}`,
    );
  }
  return data;
};

/**
 * 알림 대상과时机.
 *
 * 예전 구현은 "canClaim() 이 참이 되면 상속인에게 1회" 뿐이었다. 두 단계 상속에서
 * 이건 순서가 뒤집혔다 — 그 시점에는 이미 상속인이 신청을 해야 하는 상태고,
 * 관심사가 가장 높은 시점은 그 *전* 이다.
 *
 * 실제로 보내는 알림:
 *   1) 상속인  — 카운트다운 종료. "지금 신청할 수 있다" (실행 가능한 유일한 신호)
 *   2) 피상속인 — 상속인이 신청함. "Someone is claiming your funds" (가장 강한 각성 신호)
 *   3) 피상속인 — 기한 임박. 갱신하라는 조기 경고
 *   4) 상속인  — 7일 경과. 이제 인출 가능
 *
 * dedupe 는 단계별로 따로 기억한다. "상속인이 신청함" 알림은 owner 가 갱신으로
 * 취소하면 다시 초기화돼야 하므로, 전체 상태가 아니라 알림 종류 단위로 관리한다.
 */
const ALERT = {
  HEIR_CLAIMABLE: "heir_claimable",
  OWNER_CLAIM_FILED: "owner_claim_filed",
  OWNER_EXPIRING: "owner_expiring",
  HEIR_FINALIZABLE: "heir_finalizable",
};

/**
 * 알림 재시도 간격.
 *
 * 이 값이 dedupe 를 성립시키는지 결정한다. 예전에는 "한 번이라도 시도를 했으면"
 * 로 기록했는데, 그건 전송 실패를 성공으로 취급하는 셈이 된다 — API 는
 * delivered 를 `sent: false` 로 200 과 함께 돌려주는데 예전 코드는 예외 없이
 * 성공으로 봤다. 그랬더니 월드앱을 아직 설치하지 않은 상속인은 영영 알림을
 * 못 받았다. 기록은 남기고 하루 뒤에 다시 시도한다.
 */
const ALERT_RETRY_MS = 24 * 60 * 60 * 1000;

/**
 * 이 알림을 지금 보낼 수 있는가.
 *
 * 상태가 되돌아가면(갱신으로 신청 취소 등) checkWatcher 가 기록을 지우므로
 * 즉시 다시 armed 된다. 여기서는 그 사이에 같은 단계를 몇 번 반복했는지만 본다.
 */
const shouldSend = (prevAlerts, kind, nowMs) => {
  const rec = prevAlerts[kind];
  if (!rec) return true;
  // 옛 형식(ISO 문자열) — 한 번 보냈다고 본다.
  if (typeof rec === "string") return false;
  const at = Date.parse(rec.at || "");
  if (!Number.isFinite(at)) return true;
  return nowMs - at >= ALERT_RETRY_MS;
};

/** 시도 결과를 기록한다. 실패도 기록한다 — 그래야 ��마다 재시도하지 않는다. */
const markAlert = (prevAlerts, kind, stamp, delivered, reason = null) => {
  prevAlerts[kind] = delivered ? { at: stamp, delivered: true } : { at: stamp, delivered: false, reason };
};

/** 기한 임박 기준: 주기의 20% 이내. 주기 대비 비율이라 기간 길이와 무관하다. */
const EXPIRING_RATIO = 5n;
const EXPIRING_DIVISOR = 100n;

const decideAlerts = (snapshot, prevAlerts, nowMs = Date.now()) => {
  const alerts = [];
  const balance = snapshot.vaultBalance > 0n;
  const heirIsReal = snapshot.heirAddress && snapshot.heirAddress !== ZERO_ADDRESS;
  const ownerIsReal = snapshot.ownerAddress && snapshot.ownerAddress !== ZERO_ADDRESS;
  // 상속 취소(heir = owner)면 상속인이 따로 없으므로 상속인 알림을 보내지 않는다.
  const cancelled = snapshot.cancelled === true || !heirIsReal;

  if (!balance || !ownerIsReal) return { alerts, reason: "empty_or_no_owner" };

  // 이미 상속이 끝났으면 더 알릴 것이 없다.
  if (snapshot.claimedAt && snapshot.claimedAt > 0n) {
    return { alerts, reason: "already_settled" };
  }

  // 2) 상속인이 신청했다 — 피상속인에게. 이게 제일 급하다.
  //
  // `claimPending` 로 판정하고 `challengeRunning` 은 보지 않는다 — 스냅샷이 그 값을
  // 반환하지 않아 조건이 영영 false 가 되고, 가장 중요한 알림이 조용히 사라진다.
  // (단위 테스트가 이걸 잡았다)
  //
  // 단 `claimableNow` 이면 이미 7일이 지나 되돌릴 수 없다. 그 뒤에도 같은 알림을
  // 보내면 소음이므로 제외한다.
  if (snapshot.claimPending === true && snapshot.claimableNow !== true) {
    if (shouldSend(prevAlerts, ALERT.OWNER_CLAIM_FILED, nowMs)) {
      const endsAt = snapshot.challengeEndsAt
        ? new Date(Number(snapshot.challengeEndsAt) * 1000).toISOString()
        : null;
      alerts.push({
        kind: ALERT.OWNER_CLAIM_FILED,
        to: snapshot.ownerAddress,
        title: "A claim was filed on your vault",
        message: endsAt
          ? `Your heir can withdraw unless you renew before ${endsAt}.`
          : "Your heir can withdraw unless you renew during the review window.",
      });
    }
  }

  if (cancelled) return { alerts, reason: "cancelled" };

  // 1) 카운트다운 종료, 아직 신청 없음 — 상속인에게. 지금이 행동할 수 있는 유일한 시점.
  if (snapshot.isExpired === true && snapshot.claimPending !== true) {
    if (shouldSend(prevAlerts, ALERT.HEIR_CLAIMABLE, nowMs)) {
      alerts.push({
        kind: ALERT.HEIR_CLAIMABLE,
        to: snapshot.heirAddress,
        title: "You can claim an inheritance",
        message: "A vault that named you as heir has finished its countdown. Open the app to file your claim.",
      });
    }
  }

  // 4) 7일 경과 — 상속인에게 이제 인출 가능.
  if (snapshot.claimableNow === true) {
    if (shouldSend(prevAlerts, ALERT.HEIR_FINALIZABLE, nowMs)) {
      alerts.push({
        kind: ALERT.HEIR_FINALIZABLE,
        to: snapshot.heirAddress,
        title: "Your inheritance is ready to withdraw",
        message: "The review window has passed. Open the app to withdraw.",
      });
    }
  }

  // 3) 기한 임박 — 피상속인에게. 주기 대비 비율.
  if (
    snapshot.isExpired !== true &&
    snapshot.timeRemaining !== null &&
    snapshot.heartbeatInterval !== null &&
    snapshot.heartbeatInterval > 0n
  ) {
    const threshold = (snapshot.heartbeatInterval * EXPIRING_RATIO) / EXPIRING_DIVISOR;
    if (snapshot.timeRemaining <= threshold) {
      if (shouldSend(prevAlerts, ALERT.OWNER_EXPIRING, nowMs)) {
        alerts.push({
          kind: ALERT.OWNER_EXPIRING,
          to: snapshot.ownerAddress,
          title: "Your vault is about to expire",
          message: "Renew the countdown or your heir can file a claim.",
        });
      }
    }
  }

  return { alerts, reason: alerts.length ? "pending" : "nothing_to_say" };
};

const checkWatcher = async (env, watcher) => {
  const stamp = nowIso();
  let lastErrorSeen = null;
  try {
    const snapshot = await getVaultSnapshot(env, watcher.vaultAddress);
    const prevAlerts = parseAlerts(watcher.alerts);

    const next = {
      ...watcher,
      ownerAddress: snapshot.ownerAddress,
      heirAddress: snapshot.heirAddress,
      active: true,
      updatedAt: stamp,
      lastCheckedAt: stamp,
      lastClaimable: snapshot.claimableNow === true,
      lastVaultBalance: snapshot.vaultBalance.toString(),
      lastError: null,
    };

    // 상태가 원래대로 돌아오면(갱신으로 신청 취소 등) 해당 단계의 dedupe 를 푼다.
    // 그래야 같은 알림이 필요할 때 다시 간다.
    if (snapshot.ownerStillActive !== false || snapshot.claimPending !== true) {
      delete prevAlerts[ALERT.OWNER_CLAIM_FILED];
    }
    if (snapshot.isExpired !== true || snapshot.claimPending === true) {
      delete prevAlerts[ALERT.HEIR_CLAIMABLE];
    }
    if (snapshot.timeRemaining === null || snapshot.timeRemaining > (snapshot.heartbeatInterval || 0n)) {
      delete prevAlerts[ALERT.OWNER_EXPIRING];
    }
    if (snapshot.claimableNow !== true || snapshot.claimPending !== true) {
      delete prevAlerts[ALERT.HEIR_FINALIZABLE];
    }

    const { alerts, reason } = decideAlerts(snapshot, prevAlerts, Date.parse(stamp));
    next.alerts = prevAlerts;

    if (!alerts.length) {
      await saveWatcher(env, next);
      return { notified: false, reason };
    }

    const sent = [];
    const undelivered = [];
    for (const a of alerts) {
      // 수신자별로 결과를 봐야 한다. API 는 "요청이 유효했다" 는 200 과
      // "이 지갑에는 전달하지 못했다" 는 sent:false 를 함께 돌려준다.
      // 지갑 단위로 판정하므로 수신자 여럿을 한 번에 넘길 수 없다.
      try {
        const res = await sendWorldNotification(env, {
          walletAddress: a.to,
          title: a.title,
          message: a.message,
          vaultAddress: snapshot.vaultAddress,
        });
        const outcome = readDelivery(res, a.to);
        markAlert(prevAlerts, a.kind, stamp, outcome.delivered, outcome.reason);
        if (outcome.delivered) {
          sent.push(a.kind);
        } else {
          undelivered.push(`${a.kind}: ${outcome.reason}`);
        }
      } catch (error) {
        // 한 건이 실패해도 나머지는 보낸다.
        const msg = error instanceof Error ? error.message : String(error);
        markAlert(prevAlerts, a.kind, stamp, false, msg);
        undelivered.push(`${a.kind}: ${msg}`);
        lastErrorSeen = msg;
      }
    }
    next.alerts = prevAlerts;
    // 미달한 게 있으면 반드시 드러낸다. 조용히 성공한 것처럼 보이면
    // "알림이 없다" 는 사실을 아무도 모르게 된다.
    next.lastError = undelivered.length ? `undelivered ${undelivered.join("; ")}` : null;
    await saveWatcher(env, next);
    return { notified: sent.length > 0, reason: "sent", sent, undelivered };
  } catch (error) {
    const next = {
      ...watcher,
      updatedAt: stamp,
      lastCheckedAt: stamp,
      lastError: error instanceof Error ? error.message : String(error),
    };
    await saveWatcher(env, next);
    return { notified: false, reason: "error", error: next.lastError };
  }
};

const runCheckCycle = async (env) => {
  await ensureSchema(env);
  const activeWatchers = await listWatchers(env, true);
  let checked = 0;
  let notified = 0;
  for (const watcher of activeWatchers) {
    const result = await checkWatcher(env, watcher);
    checked += 1;
    if (result.notified) notified += 1;
  }
  return { checked, notified };
};

const handleRequest = async (request, env) => {
  await ensureSchema(env);
  const cors = resolveCors(request, env);
  if (!cors.allowed) {
    return jsonResponse(403, { status: "error", message: "Origin not allowed" }, cors.headers);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors.headers });
  }

  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/api/health") {
    const watchers = await countWatchers(env);
    return jsonResponse(
      200,
      {
        status: "ok",
        rpcUrl: (env.RPC_URL || DEFAULT_RPC_URL).trim() || DEFAULT_RPC_URL,
        watchers,
        hasWorldAppId: Boolean((env.WORLD_APP_ID || "").trim()),
        hasNotifyApiKey: Boolean((env.WORLD_NOTIFY_API_KEY || "").trim()),
        codeVersion: CODE_VERSION,
        // CORS 가 실제로 잠겨 있는지 확인하려고 노출한다.
        frontendOrigin: (env.FRONTEND_ORIGIN || "").trim() || "(unset → CORS *)",
        frontendOrigin: (env.FRONTEND_ORIGIN || "").trim() || "(unset → CORS *)",
      },
      cors.headers
    );
  }

  if (request.method === "GET" && url.pathname === "/api/notifications") {
    const watchers = await listWatchers(env, false);
    return jsonResponse(200, { status: "success", watchers }, cors.headers);
  }

  if (request.method === "GET" && url.pathname === "/api/notifications/status") {
    const vaultAddress = normalizeAddress(url.searchParams.get("vaultAddress") || "");
    if (!vaultAddress) {
      return jsonResponse(400, { status: "error", message: "vaultAddress is required" }, cors.headers);
    }
    const watcher = await getWatcherByVault(env, vaultAddress);
    return jsonResponse(200, { status: "success", watcher }, cors.headers);
  }

  if (request.method === "POST" && url.pathname === "/api/notifications/register") {
    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      return jsonResponse(400, { status: "error", message: error.message }, cors.headers);
    }

    const vaultAddress = normalizeAddress(body?.vaultAddress || "");
    const ownerAddress = normalizeAddress(body?.ownerAddress || "");
    const heirAddress = normalizeAddress(body?.heirAddress || "");
    if (!vaultAddress) {
      return jsonResponse(400, { status: "error", message: "vaultAddress is required" }, cors.headers);
    }

    let snapshot;
    try {
      snapshot = await getVaultSnapshot(env, vaultAddress);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse(400, { status: "error", message }, cors.headers);
    }
    if (ownerAddress && !addrEq(ownerAddress, snapshot.ownerAddress)) {
      return jsonResponse(400, { status: "error", message: "ownerAddress mismatch" }, cors.headers);
    }
    if (heirAddress && !addrEq(heirAddress, snapshot.heirAddress)) {
      return jsonResponse(400, { status: "error", message: "heirAddress mismatch" }, cors.headers);
    }

    const watcher = await upsertWatcherFromSnapshot(env, snapshot);
    return jsonResponse(200, { status: "success", watcher }, cors.headers);
  }

  if (request.method === "POST" && url.pathname === "/api/notifications/unregister") {
    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      return jsonResponse(400, { status: "error", message: error.message }, cors.headers);
    }
    const vaultAddress = normalizeAddress(body?.vaultAddress || "");
    if (!vaultAddress) {
      return jsonResponse(400, { status: "error", message: "vaultAddress is required" }, cors.headers);
    }

    const stamp = nowIso();
    const current = await getWatcherByVault(env, vaultAddress);
    if (current) {
      await saveWatcher(env, {
        ...current,
        active: false,
        updatedAt: stamp,
      });
    }

    return jsonResponse(200, { status: "success", removed: Boolean(current) }, cors.headers);
  }

  if (request.method === "POST" && url.pathname === "/api/notifications/test") {
    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      return jsonResponse(400, { status: "error", message: error.message }, cors.headers);
    }

    const walletAddress = normalizeAddress(body?.walletAddress || "");
    const vaultAddress = normalizeAddress(body?.vaultAddress || "");
    if (!walletAddress) {
      return jsonResponse(400, { status: "error", message: "walletAddress is required" }, cors.headers);
    }
    const title = typeof body?.title === "string" && body.title ? body.title : "WLD Inheritance Test";
    const message =
      typeof body?.message === "string" && body.message ? body.message : "Test notification from your mini app.";

    const result = await sendWorldNotification(env, {
      walletAddress,
      title,
      message,
        vaultAddress,
    });
    return jsonResponse(200, { status: "success", result }, cors.headers);
  }

  if (request.method === "POST" && url.pathname === "/api/notifications/check-now") {
    const summary = await runCheckCycle(env);
    return jsonResponse(200, { status: "success", summary }, cors.headers);
  }

  return jsonResponse(404, { status: "error", message: "Not found" }, cors.headers);
};

/**
 * 테스트 전용 노출.
 *
 * 결정 함수(decideAlerts 등)만 테스트하면 DB 쓰기 경로는 아무도 안 건드린다. 그래서
 * saveWatcher 가 자리표시자 13개에 바인딩 12개를 주고 .run(x) 로 하나를 밀어 넣은
 * 채로도 테스트는 초록이었다. 정작 실제 D1 은 매번 거절하고 있었다.
 * DB 를 만지는 함수는 밖에서 그대로 쓸 수 있게 여는 게 이 클래스를 막는다.
 */
export const __test = { saveWatcher, getWatcherByVault, listWatchers, rowToWatcher, getVaultSnapshot };

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cors = resolveCors(request, env);
      return jsonResponse(500, { status: "error", message }, cors.headers);
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const summary = await runCheckCycle(env);
        if (summary.notified > 0) {
          console.log(`[notify] sent=${summary.notified} checked=${summary.checked}`);
        }
      })()
    );
  },
};
