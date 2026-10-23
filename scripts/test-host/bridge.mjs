/**
 * Test-only World App host, below the real MiniKit SDK.
 * No SDK replacement or production entry imports this module.
 */
const VERSIONS = {
  attestation: 1, pay: 1, 'wallet-auth': 2, 'send-transaction': 2,
  'sign-message': 1, 'sign-typed-data': 1, 'share-contacts': 1,
  'request-permission': 1, 'get-permissions': 1,
  'send-haptic-feedback': 1, share: 1, chat: 1, 'close-miniapp': 1,
};
export const HOST_COMMANDS = ['wallet-auth', 'send-transaction', 'get-permissions', 'request-permission', 'share-contacts', 'chat'];
const needsApproval = command => ['wallet-auth', 'send-transaction', 'request-permission', 'share-contacts', 'chat'].includes(command);

function abortable(operation, signal) {
  if (!signal) return operation();
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(operation).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function installTestHost({
  window: win = globalThis.window, platform = 'android', execute,
  lookup, walletAddress, usernames = {}, approval = 'auto', onChange = () => {},
} = {}) {
  if (!win || typeof execute !== 'function') throw new Error('Test host requires a window and executor.');
  const nativePlatform = win.__INHERITANCE_TEST_NATIVE_HOST__?.platform ?? win.Android?.getPlatform?.();
  platform = nativePlatform ?? platform;
  if (!['ios', 'android'].includes(platform)) throw new Error('Unsupported test host platform.');
  const original = Object.fromEntries(['WorldApp', 'Android', 'webkit', '__INHERITANCE_TEST_HOST_RECEIVE__', 'fetch'].map(k => [k, win[k]]));
  const native = Boolean(nativePlatform);
  const history = [];
  const pending = new Map();
  const injected = [];
  const timers = new Map();
  let notifications = false;
  let disposed = false;
  let serial = 0;
  const notify = () => onChange({ history: [...history], pending: [...pending.values()].map(p => p.entry), platform, native });
  const deliver = (command, payload) => {
    if (!disposed) win.MiniKit?.trigger(command === 'pay' ? 'miniapp-payment' : `miniapp-${command}`, payload);
  };
  const settle = (id, allowed) => {
    const request = pending.get(id);
    if (!request) return false;
    pending.delete(id);
    request.resolve(allowed);
    notify();
    return true;
  };
  async function receive(raw) {
    if (disposed) return;
    let envelope;
    try { envelope = typeof raw === 'string' ? JSON.parse(raw) : raw; }
    catch { throw new Error('Invalid MiniKit bridge JSON.'); }
    if (!envelope || typeof envelope.command !== 'string') throw new Error('Invalid MiniKit bridge envelope.');
    const { command, version } = envelope;
    const entry = { id: ++serial, command, version, payload: envelope.payload, state: 'received', at: Date.now() };
    history.push(entry);
    if (history.length > 100) history.shift();
    notify();
    if (command === 'init') { entry.state = 'ready'; notify(); return; }
    let response;
    try {
      if (!HOST_COMMANDS.includes(command)) throw new Error(`Unsupported test host command: ${command}`);
      if (version !== VERSIONS[command]) throw new Error(`Unsupported ${command} version: ${version}`);
      const index = injected.findIndex(action => !action.command || action.command === command);
      const action = index < 0 ? null : injected.splice(index, 1)[0];
      if (action?.delay) {
        entry.state = 'delayed'; notify();
        await new Promise(resolve => { const timer = setTimeout(() => { timers.delete(timer); resolve(); }, action.delay); timers.set(timer, resolve); });
      }
      if (disposed) return;
      let allowed = action?.kind !== 'reject';
      if (allowed && approval === 'manual' && needsApproval(command)) {
        entry.state = 'awaiting-approval';
        allowed = await new Promise(resolve => { pending.set(entry.id, { entry, resolve }); notify(); });
      }
      if (disposed) return;
      if (!allowed) response = { status: 'error', error_code: 'user_rejected', version };
      else if (action?.kind === 'fail') response = { status: 'error', error_code: 'generic_error', version, details: 'Test host forced pre-submission failure' };
      else if (command === 'get-permissions') response = { status: 'success', version, permissions: { notifications } };
      else if (command === 'request-permission') {
        if (envelope.payload?.permission !== 'notifications') throw new Error('Only notification permission is implemented.');
        notifications = true;
        response = { status: 'success', version, permission: 'notifications' };
      } else if (command === 'share-contacts') {
        let contacts = Object.entries(usernames)
          .filter(([address]) => address.toLowerCase() !== walletAddress?.toLowerCase())
          .map(([walletAddress, username]) => ({ walletAddress, username, profilePictureUrl: null }));
        if (!envelope.payload?.isMultiSelectEnabled) contacts = contacts.slice(0, 1);
        response = { status: 'success', version, contacts, timestamp: new Date().toISOString() };
      } else if (command === 'chat') {
        // Record only. This host never delivers a message to a real person.
        response = { status: 'success', version, testHostDelivery: 'recorded-only' };
      } else {
        entry.state = 'executing'; notify();
        response = await execute(envelope);
      }
    } catch (error) {
      response = { status: 'error', error_code: 'generic_error', version, details: String(error?.message ?? error) };
    }
    entry.state = response.status === 'error' ? 'error' : 'success';
    entry.response = response;
    notify();
    deliver(command, response);
    return response;
  }
  win.__INHERITANCE_TEST_HOST_RECEIVE__ = receive;
  if (!native) {
    if (platform === 'ios') {
      win.Android = undefined;
      win.webkit = { messageHandlers: { minikit: { postMessage: receive } } };
    } else {
      win.webkit = undefined;
      win.Android = { postMessage: receive };
    }
  }
  // MiniKit 2.0.3 install rejects missing command names, even when an app does
  // not use them. Empty versions keep unused capabilities explicit; the host
  // rejects their execution. No fake implementations of pay/identity/etc.
  win.WorldApp = {
    world_app_version: 9999999, device_os: platform,
    wallet_address: walletAddress, safe_area_insets: { top: 0, bottom: 0, left: 0, right: 0 },
    supported_commands: Object.entries(VERSIONS).map(([name, version]) => ({ name, supported_versions: HOST_COMMANDS.includes(name) ? [version] : [] })),
  };
  if (original.fetch) {
    const fetchOriginal = original.fetch.bind(win);
    win.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, win.location.href);
      if (url.origin === 'https://usernames.worldcoin.org') {
        const entries = Object.entries(usernames);
        const profile = ([address, username] = []) => ({ address, username: username ?? null, profile_picture_url: null });
        let result;
        if (url.pathname === '/api/v1/query') {
          const body = init?.body ?? (typeof input?.clone === 'function' ? await input.clone().text() : '{}');
          const addresses = JSON.parse(body).addresses ?? [];
          result = addresses.map(address => profile(entries.find(([key]) => key.toLowerCase() === address.toLowerCase())));
        } else result = profile(entries.find(([, value]) => value === decodeURIComponent(url.pathname.split('/').pop())));
        return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
      }
      if (url.origin === 'https://developer.world.org' && /^\/api\/v2\/minikit\/userop\/0x[\da-f]{64}$/i.test(url.pathname)) {
        if (!lookup) throw new Error('User operation lookup is not configured for this test host.');
        const signal = init?.signal ?? input?.signal;
        const result = await abortable(() => lookup(url.pathname.split('/').pop(), { signal }), signal);
        return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
      }
      return fetchOriginal(input, init);
    };
  }
  const controller = {
    receive, history, get pending() { return [...pending.values()].map(p => p.entry); }, platform, native,
    approve: id => settle(id, true), reject: id => settle(id, false),
    setApproval(value) { if (!['auto', 'manual'].includes(value)) throw new Error('Invalid approval mode.'); approval = value; },
    rejectNext(command) { injected.push({ command, kind: 'reject' }); },
    failNext(command) { injected.push({ command, kind: 'fail' }); },
    delayNext(ms, command) { if (!Number.isFinite(ms) || ms < 0 || ms > 120_000) throw new Error('Delay must be 0–120000 ms.'); injected.push({ command, delay: ms }); },
    dispose() {
      disposed = true;
      for (const [timer, resolve] of timers) { clearTimeout(timer); resolve(); }
      timers.clear();
      for (const id of pending.keys()) settle(id, false);
      for (const [key, value] of Object.entries(original)) { if (value === undefined) delete win[key]; else win[key] = value; }
    },
  };
  return controller;
}
