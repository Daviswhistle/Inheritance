import { Brand, Icon } from "./Icon";
import { Button } from "./ui/button";
import { USDC_ENABLED } from "@/config";
import { HAS_YIELD_ROUTES } from "@/assets";

export function Landing({ installed, busy, onConnect, linkedVault, status }: { installed: boolean; busy: boolean; onConnect: () => void; linkedVault: string; status: string }) {
  const appId = document.querySelector('meta[name="minikit:app-id"]')?.getAttribute("content") || "";
  const path = linkedVault ? `/?vault=${linkedVault}` : "/";
  const worldLink = `https://world.org/mini-app?app_id=${encodeURIComponent(appId)}&path=${encodeURIComponent(path)}`;
  return <div className="app-shell">
    <header className="app-header"><div className="container-narrow header-content"><Brand /><span className="network-pill"><span className="live-dot" />World Chain</span></div></header>
    <main className="container-narrow landing-content">
      <div className="landing-eyebrow"><Icon name="heart" size={16} /> Made for the people who matter</div>
      <h1>{linkedVault ? <>Someone saved<br />a place for you.</> : <>A little care.<br /><span>A lasting gift.</span></>}</h1>
      <p className="landing-description">{linkedVault ? "You received an inheritance vault link. Sign in with your World App wallet to see the vault and whether you are its heir." : `Set aside ${USDC_ENABLED ? "WLD or USDC" : "WLD"} for someone you choose. Check in to keep it yours. If you stop, they have a clear path to receive it.`}</p>
      <div className="vault-illustration" aria-hidden="true">
        <div className="illustration-orbit" /><div className="illustration-orbit orbit-two" />
        <div className="illustration-note"><span className="illustration-note-icon"><Icon name="heart" size={19} /></span>For someone you love</div>
        <div className="illustration-vault"><div className="illustration-vault-top"><Icon name="vault" size={26} /><span>Your inheritance vault</span></div><div className="illustration-vault-value">Your future.<br /><span>Your choice.</span></div><div className="illustration-vault-bottom"><span className="live-dot" /> You stay in control</div></div>
        <span className="illustration-check"><Icon name="check" size={22} /></span>
      </div>
      <div className="landing-action">
        {installed ? <Button variant="primary" size="lg" onClick={onConnect} disabled={busy}>{busy ? <><span className="spinner" />Connecting…</> : <>Continue with World App<Icon name="arrow" size={19} /></>}</Button> : <a className="btn btn-primary btn-lg" href={worldLink}>Open in World App<Icon name="arrow" size={19} /></a>}
        <p>Wallet sign-in. No World ID verification required.</p>
      </div>
      {status && !/Open in World App.*bridge unavailable/i.test(status) && <p className="landing-feedback" role="status" aria-live="polite">{status}</p>}
      <div className="landing-trust"><span><Icon name="check" size={15} />Your own vault</span><span><Icon name="check" size={15} />{HAS_YIELD_ROUTES ? "Basic vault: no fee" : "No platform fee"}</span><span><Icon name="check" size={15} />You hold your keys</span></div>
      <section className="landing-how" aria-labelledby="landing-how-title"><div className="landing-section-heading"><span className="eyebrow">A simple plan</span><h2 id="landing-how-title">Three steps. One less worry.</h2></div><ol className="landing-steps">
        <li><span>01</span><div><h3>Choose your person</h3><p>Choose an asset, name an heir and set your check-in period. Creating a vault moves no funds.</p></div></li>
        <li><span>02</span><div><h3>Put a little aside</h3><p>Deposit into your personal vault. Earn with Morpho if you accept its fee and risks, then tell your heir and turn on reminders.</p></div></li>
        <li><span>03</span><div><h3>Check in. Carry on.</h3><p>Reset your timer to stay in control. If it ends, your heir can request the inheritance and wait seven days.</p></div></li>
      </ol></section>
      <details className="landing-details"><summary>What happens if I miss a check-in?<Icon name="help" size={19} /></summary><p>Missing a check-in does not move your funds. Your heir first files a claim, then waits a seven-day review window. A registered new vault can then transfer automatically to its named heir. You can reset the timer to cancel the claim until the transfer executes. Service or network delays can affect timing; the heir can also complete an eligible transfer in World App. Earlier vaults require manual completion.</p></details>
      <div className="landing-legal"><p>A personal transfer plan, not a legal will. Yield vaults charge 10% of realized gains; funds can lose value. Network fees may apply.</p><div><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a><a href="/yield-terms.html">Yield terms</a><a href="mailto:daviswhistle@naver.com">Support</a>{!installed && <a href="https://world.org/world-app" target="_blank" rel="noreferrer">Get World App ↗</a>}</div></div>
    </main>
  </div>;
}
