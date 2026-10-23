// Served only by vite.config.host.ts. The production index keeps its normal entry.
import { installTestHost } from "/__host/bridge.mjs";

const rawFetch = window.fetch.bind(window);
async function local(path, body, options = {}) {
  const response = await rawFetch(path, { ...options, ...(body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Test host returned ${response.status}`);
  return result;
}
const config = await local("/__host/config");
if (!config.testOnly || config.chainId !== 480) throw new Error("Missing isolated test fixture.");
window.__INHERITANCE_TEST_CONFIG__ = config;
const parameters = new URLSearchParams(location.search);
const account = parameters.get("account") === "heir" ? "heir" : "owner";
// A direct URL edit/back navigation must not pair the owner's session with heir signing.
try {
  const session = JSON.parse(sessionStorage.getItem("wld-session") || "null");
  if (session?.address?.toLowerCase() !== config[account].toLowerCase()) sessionStorage.removeItem("wld-session");
} catch { sessionStorage.removeItem("wld-session"); }
const platform = parameters.get("platform") === "ios" ? "ios" : "android";
const approval = parameters.get("approval") === "auto" ? "auto" : "manual";
// No test interaction may fall through to a production RPC, notifier or API.
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
  if (url.origin === "http://inheritance-test.invalid") {
    return rawFetch(new Request(location.origin + url.pathname + url.search,
      typeof input === "object" && input instanceof Request ? input : init), init);
  }
  if (url.origin === location.origin) return rawFetch(input, init);
  if (url.origin === "https://api.merkl.xyz") {
    // On-chain mock rates/income remain real; no invented advertised APR.
    return Response.json([], { status: 200 });
  }
  throw new Error(`External network disabled by test host: ${url.origin}`);
};

const container = document.createElement("div");
container.id = "inheritance-test-controls";
const shadow = container.attachShadow({ mode: "open" });
shadow.innerHTML = `
  <style>
    :host { color-scheme: light; font: 14px/1.5 system-ui,sans-serif; color: #17251b; }
    * { box-sizing: border-box; }
    button, select { font: inherit; min-height: 44px; border: 1px solid #9aab9e; border-radius: 10px; padding: 8px 12px; background: white; color: inherit; }
    button { cursor: pointer; } button:disabled { opacity: .5; } button:focus-visible,select:focus-visible { outline: 3px solid #4773e0; outline-offset: 2px; }
    #toggle { position: fixed; left: 8px; top: max(4px,env(safe-area-inset-top)); z-index: 10001; min-height: 32px; padding: 3px 8px; background: #fff4c4; font-size: 11px; font-weight: 700; box-shadow: 0 1px 4px #0002; }
    dialog { position: fixed; inset: 0; width: min(100% - 24px,560px); max-height: 85dvh; padding: 20px; background: #f8faf7; color: inherit; border: 1px solid #9aab9e; border-radius: 18px; overflow-y: auto; }
    dialog::backdrop { background: #10261999; } h2 { font-size: 20px; margin: 0 0 8px; } p { margin: 8px 0; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; align-items: center; } .row > label { flex: 1; } label select { display: block; width: 100%; }
    #address { font: 12px/1.5 monospace; overflow-wrap: anywhere; } .note { color: #526457; font-size: 12px; } #status { min-height: 24px; }
    #pending > div { padding: 12px; margin: 12px 0; border: 2px solid #577e48; border-radius: 12px; } pre { font: 11px/1.4 monospace; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 160px; overflow: auto; }
    #log { padding-left: 20px; font-size: 12px; } #log li { margin: 6px 0; } .primary { background: #315a37; color: white; }
  </style>
  <button id="toggle" aria-haspopup="dialog">TEST · ${account}</button>
  <dialog aria-labelledby="title">
    <h2 id="title">Test host controls</h2>
    <p class="note">Disposable WLD / USDC. Real MiniKit SDK and contracts; simulated host approvals, notifications and Morpho strategy. Messages are recorded only.</p>
    <p id="runtime"></p><p id="address"></p>
    <div class="row">
      <label>Account<select id="account"><option value="owner">Owner</option><option value="heir">Heir</option></select></label>
      <label>Approval<select id="approval"><option value="manual">Ask each time</option><option value="auto">Auto approve</option></select></label>
    </div>
    <p class="note">Changing account reloads the app and signs out. Both accounts start with 500 test WLD and 500 test USDC.</p>
    <div id="pending"></div>
    <div class="row"><button id="reject">Reject next transaction</button><button id="reject-auth">Reject next sign-in</button><button id="delay">Delay next transaction 10s</button><button id="fail">Fail next transaction</button></div>
    <div class="row"><button data-days="1">Time +1 day</button><button data-days="7">Time +7 days</button><button data-days="31">Time +31 days</button><button id="yield">Mock yield +10%</button></div>
    <p class="note">Time and yield affect the shared disposable chain. Reload the app after a change. +31 days crosses the default 30-day check-in deadline; +7 days crosses a claim's waiting period.</p>
    <p id="status" role="status" aria-live="polite"></p>
    <div class="row"><button id="reload">Reload app</button><button id="close" class="primary">Return to app</button></div>
    <details><summary>Recent bridge commands</summary><ol id="log"></ol></details>
  </dialog>`;
document.body.appendChild(container);
const query = selector => shadow.querySelector(selector);
const dialog = query("dialog");
const show = () => { if (!dialog.open) dialog.showModal(); };
query("#toggle").onclick = show;
query("#close").onclick = () => dialog.close();
query("#reload").onclick = () => location.reload();
query("#address").textContent = `${account}: ${config[account]}\nRecipient fixture: ${config.heir}`;
query("#account").value = account;
query("#approval").value = approval;
let controller;
function render(state) {
  query("#runtime").textContent = `${state.platform} · ${state.native ? "native WebView bridge" : "browser bridge simulation"} · chain 480 (local)`;
  query("#log").replaceChildren(...state.history.slice(-12).reverse().map(entry => {
    const item = document.createElement("li");
    item.textContent = `${entry.command} v${entry.version} · ${entry.state}`;
    return item;
  }));
  query("#pending").replaceChildren(...state.pending.map(entry => {
    const item = document.createElement("div");
    const title = document.createElement("strong"); title.textContent = `Approve ${entry.command}?`;
    const payload = document.createElement("pre"); payload.textContent = JSON.stringify(entry.payload, null, 2);
    const approve = document.createElement("button"); approve.textContent = "Approve"; approve.className = "primary";
    approve.onclick = () => { controller.approve(entry.id); dialog.close(); };
    const reject = document.createElement("button"); reject.textContent = "Reject";
    reject.onclick = () => { controller.reject(entry.id); dialog.close(); };
    const row = document.createElement("div"); row.className = "row"; row.append(approve, reject);
    // Keep decisions above the potentially long payload in short native views.
    item.append(title, row, payload); return item;
  }));
  if (state.pending.length) show();
}
controller = installTestHost({ platform, walletAddress: config[account],
  usernames: { [config.owner]: "test_owner", [config.heir]: "test_heir" }, approval,
  execute: envelope => local("/__host/command", { envelope, role: account }),
  lookup: (hash, { signal } = {}) => local(`/__host/userop/${hash}`, undefined, { signal }), onChange: render,
});
window.__INHERITANCE_TEST_HOST__ = controller;
render({ platform: controller.platform, native: controller.native, history: controller.history, pending: [] });
query("#account").onchange = event => {
  sessionStorage.removeItem("wld-session");
  const url = new URL(location.href); url.searchParams.set("account", event.target.value); location.assign(url);
};
query("#approval").onchange = event => {
  controller.setApproval(event.target.value);
  const url = new URL(location.href); url.searchParams.set("approval", event.target.value); history.replaceState(null, "", url);
};
const status = message => { query("#status").textContent = message; };
query("#reject").onclick = () => { controller.rejectNext("send-transaction"); status("Next transaction will be rejected before submission."); };
query("#reject-auth").onclick = () => { controller.rejectNext("wallet-auth"); status("Next sign-in will be rejected."); };
query("#delay").onclick = () => { controller.delayNext(10_000, "send-transaction"); status("Next transaction will wait 10 seconds before approval."); };
query("#fail").onclick = () => { controller.failNext("send-transaction"); status("Next transaction will return a simulated host error."); };
async function control(button, body) {
  button.disabled = true;
  try {
    const result = await local("/__host/control", body);
    status(`Applied. Chain time: ${new Date(result.timestamp * 1000).toLocaleString()}. Reload app to refresh.`);
  } catch (error) { status(error.message); }
  finally { button.disabled = false; }
}
shadow.querySelectorAll("[data-days]").forEach(button => { button.onclick = () => control(button, { action: "time", days: Number(button.dataset.days) }); });
query("#yield").onclick = event => control(event.currentTarget, { action: "yield" });
// The bridge must exist before the unmodified app imports/installs MiniKit.
await import("/src/main.tsx");
