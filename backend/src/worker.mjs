import { DEFAULT_FRONTEND_ORIGIN, takeCooldown, takeRateLimit, verifySession } from "./session.mjs";
import { runFinalizerCycle, readFinalizerHealth } from "./finalizer.mjs";

const DEFAULT_RPC_URL = "https://worldchain-mainnet.g.alchemy.com/public";
// 라이브 응답에 노출한다. 배포가 실제로 반영됐는지 curl 로 확인할 수 있다
// (한동안 옛 코드가 도는 것 같아 이 필드로 판별했다).
const CODE_VERSION = "inheritance-usdc-1";
const SEND_NOTIFICATION_URL = "https://developer.world.org/api/v2/minikit/send-notification";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const WATCHER_PAGE_SIZE = 4;

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
  ASSET: "0x38d52e0f",              // asset()
  REWARD_TOKEN: "0xf7c618c1",        // rewardToken()
  FACTORY: "0xc45a0155",            // factory()
  VAULT_OF: "0x0709df45",           // vaultOf(address)
  KNOWN_VAULTS: "0x6e53033d",       // knownVaults(address), includes released yield vaults
  BALANCE_OF: "0x70a08231",         // balanceOf(address)
  IS_EXPIRED: "0x2f13b60c",         // isExpired()          카운트다운 종료, 상속인 미신청
  CLAIM_PENDING: "0x03a9f06e",      // claimPending()       상속인 신청함
  CHALLENGE_ENDS_AT: "0x765be13f",  // challengeEndsAt()    이의제기 끝나는 시각
  CLAIMABLE_NOW: "0xc4671608",      // claimableNow()       7일 지남, 최종 수령 가능
  TIME_REMAINING: "0xe3cfef60",     // timeRemaining()
  HEARTBEAT_INTERVAL: "0x561a4fac", // heartbeatInterval()
  CANCELLED: "0x12cd6595",          // inheritanceCancelled()
  CLAIMED_AT: "0xd2217fac",          // claimedAt()          최종 수령 완료 시각
  STRATEGY: "0xa8c62e76",            // strategy()
  TOTAL_ASSETS: "0x01e1d114",        // totalAssets()
  HAS_ASSETS: "0x5be9b2d3",          // hasAssets()
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

class HttpError extends Error {
  constructor(status, message, headers = {}, code = null) {
    super(message);
    this.status = status;
    this.headers = headers;
    this.code = code;
  }
}

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
  if (typeof hex !== "string" || !/^0x0{24}[0-9a-fA-F]{40}$/.test(hex)) {
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

const usdcFactoryConfig = (env, { factory, legacyFactory, yieldFactory, wld }) => {
  const keys = ["USDC_YIELD_FACTORY_ADDRESS", "USDC_MORPHO_VAULT_ADDRESS", "USDC_ADDRESS"];
  const values = keys.map((key) => env[key]);
  const configured = values.map((value) => value != null && String(value).trim() !== "");
  if (!configured.some(Boolean)) return null;
  if (!configured.every(Boolean)) {
    throw new HttpError(503, "Canonical USDC vault configuration is incomplete");
  }

  const [usdcYieldFactory, usdcStrategy, usdc] = values.map(normalizeAddress);
  const existingFactories = [factory, legacyFactory, yieldFactory].filter(Boolean);
  if (!usdcYieldFactory || !usdcStrategy || !usdc ||
      [usdcYieldFactory, usdcStrategy, usdc].includes(ZERO_ADDRESS) ||
      existingFactories.includes(usdcYieldFactory) || usdcYieldFactory === usdcStrategy ||
      usdcYieldFactory === usdc || usdc === wld || usdc === usdcStrategy) {
    throw new HttpError(503, "Canonical USDC vault configuration is invalid");
  }
  return { factoryAddress: usdcYieldFactory, strategyAddress: usdcStrategy, assetAddress: usdc };
};

const resolveCors = (request, env) => {
  const origin = request.headers.get("Origin");
  if (!origin) return { allowed: true, headers: {} };

  const allowedOrigin = (env.FRONTEND_ORIGIN || DEFAULT_FRONTEND_ORIGIN).trim();
  const base = {
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };

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
      "Cache-Control": "no-store",
      ...corsHeaders,
    },
  });
};

const readJson = async (request) => {
  const text = await request.text();
  if (text.length > 8192) throw new Error("Request body is too large");
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
    signal: AbortSignal.timeout(20_000),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    throw new Error(data?.error?.message || `RPC ${method} failed`);
  }
  return data.result;
};

const ethCall = async (env, to, data, blockTag = "latest") => {
  return rpc(env, "eth_call", [{ to, data }, blockTag]);
};

// Latest state gates access and sending. Only finalized state can permanently
// retire a watcher; a manual payout or slot release can disappear before finality.
const terminalFinalized = async (env, identity, released = false) => {
  try {
    if (released) {
      const mapped = decodeAddress(await ethCall(env, identity.factoryAddress,
        SELECTORS.VAULT_OF + padAddress(identity.ownerAddress), "finalized"));
      return mapped !== identity.vaultAddress;
    }
    return decodeUint(await ethCall(env, identity.vaultAddress, SELECTORS.CLAIMED_AT, "finalized")) > 0n;
  } catch {
    return false;
  }
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
const getVaultIdentity = async (env, vaultAddress) => {
  const vault = normalizeAddress(vaultAddress);
  if (!vault) throw new Error("Invalid vault address");
  const factory = normalizeAddress(env.FACTORY_ADDRESS);
  const legacyFactory = normalizeAddress(env.LEGACY_FACTORY_ADDRESS);
  const yieldFactory = normalizeAddress(env.YIELD_FACTORY_ADDRESS);
  const strategy = normalizeAddress(env.MORPHO_VAULT_ADDRESS);
  const wld = normalizeAddress(env.WLD_ADDRESS);
  if (!factory || factory === ZERO_ADDRESS || !wld || wld === ZERO_ADDRESS) {
    throw new HttpError(503, "Canonical vault configuration is missing");
  }
  const usdcConfig = usdcFactoryConfig(env, { factory, legacyFactory, yieldFactory, wld });
  const [ownerAddress, heirAddress, factoryAddress, claimedAt] = await Promise.all([
    ethCall(env, vault, SELECTORS.OWNER).then(decodeAddress),
    ethCall(env, vault, SELECTORS.HEIR).then(decodeAddress),
    ethCall(env, vault, SELECTORS.FACTORY).then(decodeAddress),
    // Settlement clears heir. Its timestamp must be known before granting heir access.
    ethCall(env, vault, SELECTORS.CLAIMED_AT).then(decodeUint),
  ]);

  const wldYieldVault = Boolean(yieldFactory && factoryAddress === yieldFactory);
  const usdcYieldVault = Boolean(usdcConfig && factoryAddress === usdcConfig.factoryAddress);
  const knownFactory = [factory, legacyFactory].filter(Boolean).includes(factoryAddress) ||
    wldYieldVault || usdcYieldVault;
  if (ownerAddress === ZERO_ADDRESS || !knownFactory) {
    throw new HttpError(400, "Vault is not from a configured inheritance factory");
  }

  let tokenAddress;
  if (usdcYieldVault) {
    const [factoryAsset, factoryRewardToken, factoryStrategy] = await Promise.all([
      ethCall(env, factoryAddress, SELECTORS.ASSET).then(decodeAddress),
      ethCall(env, factoryAddress, SELECTORS.REWARD_TOKEN).then(decodeAddress),
      ethCall(env, factoryAddress, SELECTORS.STRATEGY).then(decodeAddress),
    ]);
    if (factoryAsset !== usdcConfig.assetAddress || factoryRewardToken !== wld ||
        factoryStrategy !== usdcConfig.strategyAddress) {
      throw new HttpError(400, "Source factory does not match the configured USDC asset, strategy and WLD reward token");
    }
    const [assetAddress, rewardTokenAddress] = await Promise.all([
      ethCall(env, vault, SELECTORS.ASSET).then(decodeAddress),
      ethCall(env, vault, SELECTORS.REWARD_TOKEN).then(decodeAddress),
    ]);
    if (assetAddress !== usdcConfig.assetAddress || rewardTokenAddress !== wld) {
      throw new HttpError(400, "Vault does not use the configured USDC asset and WLD reward token");
    }
    tokenAddress = assetAddress;
  } else {
    tokenAddress = decodeAddress(await ethCall(env, vault, SELECTORS.WLD));
    if (tokenAddress !== wld) throw new HttpError(400, "Vault does not use the configured WLD token");
  }

  const expectedStrategy = usdcYieldVault ? usdcConfig.strategyAddress : strategy;
  if ((wldYieldVault || usdcYieldVault) &&
      (!expectedStrategy || decodeAddress(await ethCall(env, vault, SELECTORS.STRATEGY)) !== expectedStrategy)) {
    throw new HttpError(400, "Vault does not use the configured Morpho strategy");
  }
  const yieldVault = wldYieldVault || usdcYieldVault;
  const registered = yieldVault
    ? decodeBool(await ethCall(env, factoryAddress, SELECTORS.KNOWN_VAULTS + padAddress(vault)))
    : decodeAddress(await ethCall(env, factoryAddress, SELECTORS.VAULT_OF + padAddress(ownerAddress))) === vault;
  if (!registered) {
    throw Object.assign(new HttpError(400, yieldVault
      ? "Vault is not registered in its configured source factory"
      : "Vault is not the owner's current factory vault", {}, "vault_not_current"), {
      identity: { vaultAddress: vault, ownerAddress, factoryAddress },
    });
  }
  if (heirAddress === ZERO_ADDRESS && claimedAt === 0n) {
    throw new HttpError(400, "A vault without an heir must have a completed claim");
  }
  return { vaultAddress: vault, ownerAddress, heirAddress, factoryAddress, tokenAddress, claimedAt,
    yieldVault };
};

const requireVaultAccess = async (env, vaultAddress, walletAddress, ownerOnly = false) => {
  const identity = await getVaultIdentity(env, vaultAddress);
  if (!addrEq(walletAddress, identity.ownerAddress)
    && (ownerOnly || identity.claimedAt > 0n || !addrEq(walletAddress, identity.heirAddress))) {
    throw new HttpError(403, ownerOnly ? "Only the vault owner can disable reminders" : "Wallet is not the vault owner or heir");
  }
  return identity;
};

const getVaultSnapshot = async (env, vaultAddress, identity = null) => {
  const checked = identity || await getVaultIdentity(env, vaultAddress);
  const { vaultAddress: vault, ownerAddress, heirAddress, tokenAddress } = checked;

  const [isExpired, claimPending, claimableNow, cancelled, claimedAt,
    challengeEndsAt, timeRemaining, heartbeatInterval] = await Promise.all([
    readFlag(env, vault, SELECTORS.IS_EXPIRED, null),
    readFlag(env, vault, SELECTORS.CLAIM_PENDING, null),
    readFlag(env, vault, SELECTORS.CLAIMABLE_NOW, null),
    readFlag(env, vault, SELECTORS.CANCELLED, null),
    checked.claimedAt,
    readUint(env, vault, SELECTORS.CHALLENGE_ENDS_AT, null),
    readUint(env, vault, SELECTORS.TIME_REMAINING, null),
    readUint(env, vault, SELECTORS.HEARTBEAT_INTERVAL, null),
  ]);

  let vaultBalance = 0n;
  let hasVaultAssets;
  if (checked.yieldVault) {
    // The existence of protected receipts is independent of cash liquidity and
    // valuation. A failed quote must not suppress claims or their notifications.
    hasVaultAssets = decodeBool(await ethCall(env, vault, SELECTORS.HAS_ASSETS));
  }
  if (tokenAddress && tokenAddress !== ZERO_ADDRESS) {
    try {
      vaultBalance = decodeUint(await ethCall(env, checked.yieldVault ? vault : tokenAddress,
        checked.yieldVault ? SELECTORS.TOTAL_ASSETS : encodeBalanceOf(vault)));
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
    hasVaultAssets,
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
        last_error,
        alerts
      FROM watchers
      WHERE vault_address = ?
      LIMIT 1
    `
  )
    .bind(vaultAddress)
    .first();

  return row ? rowToWatcher(row) : null;
};

const listWatchers = async (env, onlyActive = false, walletAddress = null, page = null) => {
  const conditions = [];
  const bindings = [];
  if (onlyActive) conditions.push("active = 1");
  if (walletAddress) {
    conditions.push("(owner_address = ? OR heir_address = ?)");
    bindings.push(walletAddress, walletAddress);
  }
  if (page?.after) {
    conditions.push("vault_address > ?");
    bindings.push(page.after);
  }
  if (page) bindings.push(page.limit);
  const sql = `SELECT vault_address, owner_address, heir_address, active, created_at, updated_at,
    last_checked_at, last_claimable, last_vault_balance, notified_heir_address, notified_at, last_error, alerts
    FROM watchers ${conditions.length ? "WHERE " + conditions.join(" AND ") : ""}
    ${page ? "ORDER BY vault_address ASC LIMIT ?" : onlyActive && !walletAddress ? "ORDER BY COALESCE(last_checked_at,created_at),vault_address LIMIT 2" : ""}`;
  const statement = env.DB.prepare(sql);
  const result = await (bindings.length ? statement.bind(...bindings) : statement).all();
  return (result.results || []).map(rowToWatcher);
};

const countWatchers = async (env) => {
  const row = await env.DB.prepare("SELECT COUNT(1) AS count FROM watchers").first();
  return Number(row?.count || 0);
};

// A D1 lease prevents cron, check-now and registration from overwriting each other's
// delivery records. RPC/notification requests have 20 s timeouts; 5 min bounds a check.
const withWatcherLease = async (env, vaultAddress, operation) => {
  const token = crypto.randomUUID();
  const now = Date.now();
  const locked = await env.DB.prepare(`
    INSERT INTO notification_leases (vault_address, lock_token, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(vault_address) DO UPDATE SET lock_token = excluded.lock_token, expires_at = excluded.expires_at
    WHERE notification_leases.expires_at <= ? RETURNING lock_token
  `).bind(vaultAddress, token, now + 300_000, now).first();
  if (!locked) throw new HttpError(409, "Vault reminders are being updated; try again shortly");
  try {
    return await operation();
  } finally {
    await env.DB.prepare("DELETE FROM notification_leases WHERE vault_address = ? AND lock_token = ?")
      .bind(vaultAddress, token).run();
  }
};

const upsertWatcherFromSnapshot = async (env, snapshot) => withWatcherLease(env, snapshot.vaultAddress, async () => {
  const prev = await getWatcherByVault(env, snapshot.vaultAddress);
  const stamp = nowIso();
  const observedSettled = snapshot.claimedAt > 0n;
  const settled = observedSettled && await terminalFinalized(env, snapshot);
  const keepNotifiedHeir = prev?.notifiedHeirAddress && (observedSettled || addrEq(prev.notifiedHeirAddress, snapshot.heirAddress));
  const watcher = {
    vaultAddress: snapshot.vaultAddress,
    ownerAddress: snapshot.ownerAddress,
    heirAddress: observedSettled && !settled ? prev?.heirAddress || snapshot.heirAddress : snapshot.heirAddress,
    active: !settled,
    createdAt: prev?.createdAt || stamp,
    updatedAt: stamp,
    lastCheckedAt: prev?.lastCheckedAt || null,
    lastClaimable: !observedSettled && snapshot.claimableNow === true,
    lastVaultBalance: snapshot.vaultBalance.toString(),
    notifiedHeirAddress: keepNotifiedHeir ? prev.notifiedHeirAddress : null,
    notifiedAt: keepNotifiedHeir ? prev.notifiedAt : null,
    lastError: null,
    alerts: parseAlerts(prev?.alerts),
  };
  if (prev && !observedSettled && !addrEq(prev.heirAddress, snapshot.heirAddress)) {
    delete watcher.alerts[ALERT.HEIR_CLAIMABLE];
    delete watcher.alerts[ALERT.HEIR_FINALIZABLE];
  }
  await saveWatcher(env, watcher);
  return watcher;
});

/**
 * 월드앱 딥링크.
 *
 * 알림 API 는 worldapp://mini-app 딥링크를 받는다. 앱 내부 금고 경로는
 * 공식 path 파라미터에 URL 인코딩해서 넣어야 World App 이 전달한다.
 */
const miniAppDeepLink = (appId, vaultAddress) => {
  const base = `worldapp://mini-app?app_id=${appId}`;
  return vaultAddress ? `${base}&path=${encodeURIComponent(`/?vault=${vaultAddress}`)}` : base;
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
  );
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
    signal: AbortSignal.timeout(20_000),
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

/** 기한 임박 기준: 주기의 5% 이내. 주기 대비 비율이라 기간 길이와 무관하다. */
const EXPIRING_RATIO = 5n;
const EXPIRING_DIVISOR = 100n;

const decideAlerts = (snapshot, prevAlerts, nowMs = Date.now()) => {
  const alerts = [];
  const balance = snapshot.hasVaultAssets ?? snapshot.vaultBalance > 0n;
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
        title: "A claim was filed",
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
        title: "Your inheritance is ready",
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

const checkWatcher = async (env, watcher, caller = null) => {
  try {
    return await withWatcherLease(env, watcher.vaultAddress, async () => {
      // The cron list is only navigation. Read the latest row while holding the lease.
      const current = await getWatcherByVault(env, watcher.vaultAddress);
      if (!current?.active) return { notified: false, reason: "disabled" };
      const stamp = nowIso();
      let next = { ...current, updatedAt: stamp, lastCheckedAt: stamp };
      try {
        const snapshot = await getVaultSnapshot(env, current.vaultAddress);
        if (caller && !addrEq(caller, snapshot.ownerAddress)
          && (snapshot.claimedAt > 0n || !addrEq(caller, snapshot.heirAddress))) {
          throw new HttpError(403, "Wallet is not the vault owner or heir");
        }
        if (snapshot.claimedAt > 0n) {
          const finalized = await terminalFinalized(env, snapshot);
          await saveWatcher(env, {
            ...next, ownerAddress: snapshot.ownerAddress,
            heirAddress: finalized ? snapshot.heirAddress : current.heirAddress,
            active: !finalized, lastClaimable: false, lastVaultBalance: snapshot.vaultBalance.toString(), lastError: null,
          });
          return { notified: false, reason: finalized ? "already_settled" : "settlement_pending_finality" };
        }
        const prevAlerts = { ...parseAlerts(current.alerts) };
        if (!addrEq(current.heirAddress, snapshot.heirAddress)) {
          delete prevAlerts[ALERT.HEIR_CLAIMABLE];
          delete prevAlerts[ALERT.HEIR_FINALIZABLE];
        }
        next = {
          ...next, ownerAddress: snapshot.ownerAddress, heirAddress: snapshot.heirAddress,
          lastClaimable: snapshot.claimableNow === true,
          lastVaultBalance: snapshot.vaultBalance.toString(), lastError: null, alerts: prevAlerts,
        };
        // Unknown flags retain delivery history; only observed resets rearm a stage.
        if (snapshot.claimPending === false) delete prevAlerts[ALERT.OWNER_CLAIM_FILED];
        if (snapshot.isExpired === false || snapshot.claimPending === true) delete prevAlerts[ALERT.HEIR_CLAIMABLE];
        if (snapshot.timeRemaining !== null && snapshot.heartbeatInterval !== null
          && snapshot.timeRemaining > snapshot.heartbeatInterval * EXPIRING_RATIO / EXPIRING_DIVISOR) {
          delete prevAlerts[ALERT.OWNER_EXPIRING];
        }
        if (snapshot.claimableNow === false || snapshot.claimPending === false) delete prevAlerts[ALERT.HEIR_FINALIZABLE];

        const { alerts, reason } = decideAlerts(snapshot, prevAlerts, Date.parse(stamp));
        if (!alerts.length) {
          await saveWatcher(env, next);
          return { notified: false, reason };
        }
        // Persist attempts before the external send. A crash after API acceptance must
        // retain the 24 h cooldown, even if its delivery response was never saved.
        for (const alert of alerts) markAlert(prevAlerts, alert.kind, stamp, false, "delivery in progress");
        await saveWatcher(env, next);
        const sent = [];
        const undelivered = [];
        for (const alert of alerts) {
          try {
            const response = await sendWorldNotification(env, {
              walletAddress: alert.to, title: alert.title, message: alert.message,
              vaultAddress: snapshot.vaultAddress,
            });
            const outcome = readDelivery(response, alert.to);
            markAlert(prevAlerts, alert.kind, stamp, outcome.delivered, outcome.reason);
            if (outcome.delivered) sent.push(alert.kind);
            else undelivered.push(`${alert.kind}: ${outcome.reason}`);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            markAlert(prevAlerts, alert.kind, stamp, false, message);
            undelivered.push(`${alert.kind}: ${message}`);
          }
        }
        next.lastError = undelivered.length ? `undelivered ${undelivered.join("; ")}` : null;
        await saveWatcher(env, next);
        return { notified: sent.length > 0, reason: "sent", sent, undelivered };
      } catch (error) {
        if (error instanceof HttpError && error.status === 403) throw error;
        if (error instanceof HttpError && error.code === "vault_not_current") {
          // Access stays denied immediately. Preserve monitoring until a slot
          // release is final, so a removed release cannot orphan an eligible vault.
          const finalized = await terminalFinalized(env, error.identity, true);
          next.active = !finalized;
          next.lastError = error.message;
          await saveWatcher(env, next);
          return { notified: false, reason: finalized ? "no_longer_current" : "release_pending_finality" };
        }
        // Preserve any already-reserved delivery attempts when saving an error.
        next.lastError = error instanceof Error ? error.message : String(error);
        await saveWatcher(env, next);
        return { notified: false, reason: "error", error: next.lastError };
      }
    });
  } catch (error) {
    if (error instanceof HttpError && error.status === 409) return { notified: false, reason: "busy" };
    throw error;
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

const authenticate = async (request, env) => {
  if (!env.SIWE_SECRET) throw new HttpError(503, "Notification authentication is not configured");
  const authorization = request.headers.get("Authorization") || "";
  const token = /^Bearer ([^ ]+)$/.exec(authorization)?.[1];
  const claims = await verifySession(env.SIWE_SECRET, token, (env.FRONTEND_ORIGIN || DEFAULT_FRONTEND_ORIGIN).trim());
  if (!claims) throw new HttpError(401, "Your sign-in expired or is invalid. Sign in again.");
  return claims.sub;
};

const requireCooldown = async (env, key) => {
  if (!await takeCooldown(env.DB, key, 60_000)) {
    throw new HttpError(429, "Please wait one minute before trying again", { "Retry-After": "60" });
  }
};

const handleRequest = async (request, env) => {
  const cors = resolveCors(request, env);
  if (!cors.allowed) throw new HttpError(403, "Origin not allowed");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors.headers });
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/automation/health") {
    return jsonResponse(200, { status: "success", automation: await readFinalizerHealth(env) }, cors.headers);
  }
  if (request.method === "GET" && url.pathname === "/api/health") {
    await ensureSchema(env);
    return jsonResponse(200, {
      status: "ok", rpcUrl: (env.RPC_URL || DEFAULT_RPC_URL).trim() || DEFAULT_RPC_URL,
      watchers: await countWatchers(env), hasWorldAppId: Boolean((env.WORLD_APP_ID || "").trim()),
      hasNotifyApiKey: Boolean((env.WORLD_NOTIFY_API_KEY || "").trim()),
      hasSessionSecret: Boolean(env.SIWE_SECRET), codeVersion: CODE_VERSION,
      frontendOrigin: (env.FRONTEND_ORIGIN || DEFAULT_FRONTEND_ORIGIN).trim(),
    }, cors.headers);
  }
  if (!/^\/api\/notifications(?:\/|$)/.test(url.pathname)) throw new HttpError(404, "Not found");
  // Authentication is independent of CORS and precedes reads, RPC and notification work.
  const caller = await authenticate(request, env);
  await ensureSchema(env);
  if (!await takeRateLimit(env.DB, `api:${caller}`, 60, 60_000)) {
    throw new HttpError(429, "Too many notification requests; try again shortly", { "Retry-After": "60" });
  }

  if (request.method === "GET" && url.pathname === "/api/notifications") {
    const cursorParam = url.searchParams.get("cursor");
    if (cursorParam !== null && !ADDRESS_RE.test(cursorParam)) throw new HttpError(400, "Invalid vault-address cursor");
    const cursor = cursorParam?.toLowerCase() || null;
    // One SQL lookahead determines continuation; only four candidates incur RPCs.
    const candidates = await listWatchers(env, false, caller, { after: cursor, limit: WATCHER_PAGE_SIZE + 1 });
    const page = candidates.slice(0, WATCHER_PAGE_SIZE);
    const nextCursor = candidates.length > WATCHER_PAGE_SIZE ? page.at(-1).vaultAddress : null;
    const watchers = [];
    for (const watcher of page) {
      try {
        const identity = await requireVaultAccess(env, watcher.vaultAddress, caller);
        watchers.push({ ...watcher, ownerAddress: identity.ownerAddress, heirAddress: identity.heirAddress });
      } catch (error) {
        // Known stale membership/noncanonical identity grants no access. Transport,
        // config and subrequest-limit failures must never masquerade as a full page.
        if (error instanceof HttpError && (error.status === 400 || error.status === 403)) continue;
        if (error instanceof HttpError) throw error;
        throw new HttpError(503, "Could not verify your registered vaults. Try again shortly.");
      }
    }
    return jsonResponse(200, { status: "success", watchers, nextCursor }, cors.headers);
  }
  if (request.method === "GET" && url.pathname === "/api/notifications/status") {
    const vault = normalizeAddress(url.searchParams.get("vaultAddress"));
    if (!vault) throw new HttpError(400, "vaultAddress is required");
    await requireVaultAccess(env, vault, caller);
    return jsonResponse(200, { status: "success", watcher: await getWatcherByVault(env, vault) }, cors.headers);
  }
  if (request.method !== "POST") throw new HttpError(404, "Not found");
  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    throw new HttpError(400, error.message);
  }
  const vault = normalizeAddress(body?.vaultAddress);

  if (url.pathname === "/api/notifications/register") {
    if (!vault) throw new HttpError(400, "vaultAddress is required");
    const identity = await requireVaultAccess(env, vault, caller);
    for (const field of ["ownerAddress", "heirAddress"]) {
      if (body?.[field] !== undefined && !addrEq(body[field], identity[field])) throw new HttpError(400, `${field} mismatch`);
    }
    const snapshot = await getVaultSnapshot(env, vault, identity);
    const watcher = await upsertWatcherFromSnapshot(env, snapshot);
    return jsonResponse(200, { status: "success", watcher }, cors.headers);
  }
  if (url.pathname === "/api/notifications/unregister") {
    if (!vault) throw new HttpError(400, "vaultAddress is required");
    await requireVaultAccess(env, vault, caller, true);
    const removed = await withWatcherLease(env, vault, async () => {
      const current = await getWatcherByVault(env, vault);
      if (current) await saveWatcher(env, { ...current, active: false, updatedAt: nowIso() });
      return Boolean(current);
    });
    return jsonResponse(200, { status: "success", removed }, cors.headers);
  }
  if (url.pathname === "/api/notifications/test") {
    if (body?.walletAddress !== undefined && !addrEq(body.walletAddress, caller)) {
      throw new HttpError(403, "Test notifications can only be sent to your signed-in wallet");
    }
    if (body?.vaultAddress !== undefined) {
      if (!vault) throw new HttpError(400, "Invalid vaultAddress");
      await requireVaultAccess(env, vault, caller);
    }
    await requireCooldown(env, `test:${caller}`);
    const result = await sendWorldNotification(env, {
      walletAddress: caller, title: "WLD Inheritance Test", message: "Test notification from your mini app.", vaultAddress: vault,
    });
    return jsonResponse(200, { status: "success", result }, cors.headers);
  }
  if (url.pathname === "/api/notifications/check-now") {
    if (!vault) throw new HttpError(400, "vaultAddress is required; global checks are scheduled only");
    await requireVaultAccess(env, vault, caller);
    await requireCooldown(env, `check:${caller}`);
    const watcher = await getWatcherByVault(env, vault);
    const result = watcher ? await checkWatcher(env, watcher, caller) : { notified: false, reason: "not_registered" };
    return jsonResponse(200, {
      status: "success", summary: { checked: watcher?.active ? 1 : 0, notified: result.notified ? 1 : 0 }, result,
    }, cors.headers);
  }
  throw new HttpError(404, "Not found");
};

/**
 * 테스트 전용 노출.
 *
 * 결정 함수(decideAlerts 등)만 테스트하면 DB 쓰기 경로는 아무도 안 건드린다. 그래서
 * saveWatcher 가 자리표시자 13개에 바인딩 12개를 주고 .run(x) 로 하나를 밀어 넣은
 * 채로도 테스트는 초록이었다. 정작 실제 D1 은 매번 거절하고 있었다.
 * DB 를 만지는 함수는 밖에서 그대로 쓸 수 있게 여는 게 이 클래스를 막는다.
 */
export const __test = { saveWatcher, getWatcherByVault, listWatchers, rowToWatcher, getVaultSnapshot, upsertWatcherFromSnapshot, checkWatcher, runCheckCycle };

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cors = resolveCors(request, env);
      return jsonResponse(error instanceof HttpError ? error.status : 500, { status: "error", message }, { ...cors.headers, ...(error.headers || {}) });
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        // Alternate the two tasks to respect existing Free-plan subrequest limits.
        // Bounded batches advance persisted cursors; each task runs every two minutes.
        if (Math.floor(controller.scheduledTime / 60_000) % 2 === 0) {
          await ensureSchema(env);
          const result = await runFinalizerCycle(env);
          console.log(`[finalizer] checked=${result.checked || 0} finalized=${result.finalized || 0} reason=${result.reason}`);
          return;
        }
        const summary = await runCheckCycle(env);
        if (summary.notified > 0) {
          console.log(`[notify] sent=${summary.notified} checked=${summary.checked}`);
        }
      })()
    );
  },
};
