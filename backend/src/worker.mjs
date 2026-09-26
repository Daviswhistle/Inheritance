const DEFAULT_RPC_URL = "https://worldchain-mainnet.g.alchemy.com/public";
const SEND_NOTIFICATION_URL = "https://developer.worldcoin.org/api/v2/minikit/send-notification";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const SELECTORS = {
  OWNER: "0x8da5cb5b",
  HEIR: "0xe3cfef60",
  CAN_CLAIM: "0x6dc7a627",
  WLD: "0xde061d66",
  BALANCE_OF: "0x70a08231",
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
  last_error TEXT
);
`;

/** @type {Promise<void> | null} */
let schemaReady = null;

const nowIso = () => new Date().toISOString();

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
    throw new Error("Invalid encoded address");
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

const getVaultSnapshot = async (env, vaultAddress) => {
  const vault = normalizeAddress(vaultAddress);
  if (!vault) throw new Error("Invalid vault address");

  const ownerAddress = decodeAddress(await ethCall(env, vault, SELECTORS.OWNER));
  const heirAddress = decodeAddress(await ethCall(env, vault, SELECTORS.HEIR));
  const canClaim = decodeBool(await ethCall(env, vault, SELECTORS.CAN_CLAIM));

  let tokenAddress = null;
  try {
    tokenAddress = decodeAddress(await ethCall(env, vault, SELECTORS.WLD));
  } catch {
    tokenAddress = null;
  }

  let vaultBalance = 0n;
  if (tokenAddress && tokenAddress !== ZERO_ADDRESS) {
    const encoded = await ethCall(env, tokenAddress, encodeBalanceOf(vault));
    vaultBalance = decodeUint(encoded);
  }

  return {
    vaultAddress: vault,
    ownerAddress,
    heirAddress,
    tokenAddress,
    canClaim,
    vaultBalance,
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
        last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        last_error = excluded.last_error
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
      watcher.lastError
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

const sendWorldNotification = async (env, { walletAddress, title, message, miniAppPath = "/" }) => {
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
    },
    body: JSON.stringify({
      app_id: appId,
      wallet_addresses: [walletAddress],
      title,
      message,
      mini_app_path: miniAppPath,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.detail || data?.message || data?.error || `Notification API failed (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
};

const checkWatcher = async (env, watcher) => {
  const stamp = nowIso();
  try {
    const snapshot = await getVaultSnapshot(env, watcher.vaultAddress);
    const next = {
      ...watcher,
      ownerAddress: snapshot.ownerAddress,
      heirAddress: snapshot.heirAddress,
      active: true,
      updatedAt: stamp,
      lastCheckedAt: stamp,
      lastClaimable: snapshot.canClaim,
      lastVaultBalance: snapshot.vaultBalance.toString(),
      lastError: null,
    };

    if (!snapshot.canClaim) {
      next.notifiedHeirAddress = null;
      next.notifiedAt = null;
      await saveWatcher(env, next);
      return { notified: false, reason: "not_claimable" };
    }

    if (snapshot.vaultBalance <= 0n) {
      await saveWatcher(env, next);
      return { notified: false, reason: "empty_balance" };
    }

    if (next.notifiedHeirAddress && addrEq(next.notifiedHeirAddress, snapshot.heirAddress)) {
      await saveWatcher(env, next);
      return { notified: false, reason: "already_notified" };
    }

    await sendWorldNotification(env, {
      walletAddress: snapshot.heirAddress,
      title: "Inheritance claim is ready",
      message: "A vault that named you as heir is now claimable.",
      miniAppPath: `/?vault=${snapshot.vaultAddress}`,
    });
    next.notifiedHeirAddress = snapshot.heirAddress;
    next.notifiedAt = stamp;
    await saveWatcher(env, next);
    return { notified: true, reason: "sent" };
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
    const miniAppPath = vaultAddress ? `/?vault=${vaultAddress}` : "/";

    const result = await sendWorldNotification(env, {
      walletAddress,
      title,
      message,
      miniAppPath,
    });
    return jsonResponse(200, { status: "success", result }, cors.headers);
  }

  if (request.method === "POST" && url.pathname === "/api/notifications/check-now") {
    const summary = await runCheckCycle(env);
    return jsonResponse(200, { status: "success", summary }, cors.headers);
  }

  return jsonResponse(404, { status: "error", message: "Not found" }, cors.headers);
};

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
