import { USDC_ENABLED, YIELD_ENABLED } from "@/config";
import { useLocale } from "@/locale-context";
import { Icon } from "./Icon";
import { Button } from "./ui/button";
import { TransferGuide } from "./TransferGuide";
import { useActionClearance } from "@/use-action-clearance";

export function AccountEntry({ view, installed, busy, onConnect, onNavigate, linkedVault }: {
  view: "vault" | "money" | "inherit";
  installed: boolean;
  busy: boolean;
  onConnect: () => void;
  onNavigate: (view: "money" | "inherit") => void;
  linkedVault: string;
}) {
  const { t } = useLocale();
  const actionRef = useActionClearance();
  const appId = document.querySelector('meta[name="minikit:app-id"]')?.getAttribute("content") || "";
  const path = linkedVault ? `/?vault=${linkedVault}` : "/";
  const worldLink = `https://world.org/mini-app?app_id=${encodeURIComponent(appId)}&path=${encodeURIComponent(path)}`;
  const symbols = ["WLD", ...(USDC_ENABLED ? ["USDC"] : [])];
  const assets = symbols.join(" · ");
  const yieldAssets = [...(YIELD_ENABLED ? ["WLD"] : []), ...(USDC_ENABLED ? ["USDC"] : [])].join(" · ");

  return <section className={`account-entry entry-${view}`} aria-labelledby="account-entry-title">
    <div className="entry-access">
      {view === "vault" && <div className="entry-asset-badges" aria-label={t("assets.label")}>
        {symbols.map(symbol => <span key={symbol}><span className={`asset-token asset-token-${symbol.toLowerCase()}`} aria-hidden="true" />{symbol}</span>)}
      </div>}
      <h1 id="account-entry-title" tabIndex={-1}>{t(view === "inherit" && linkedVault ? "entry.linked.title" : `entry.${view}.title`, { assets })}</h1>
      <p>{t(view === "inherit" && linkedVault ? "entry.linked.body" : `entry.${view}.body`, { assets })}</p>
    </div>

    {view === "vault" && <div className="entry-promise">
      <Icon name="inherit" size={22} />
      <div><strong>{t("entry.home.control")}</strong><p>{t("entry.home.controlBody")}</p></div>
      {yieldAssets && <p className="entry-yield-note">{t("entry.yield.body", { assets: yieldAssets })}</p>}
    </div>}

    {view === "vault" && <div className="entry-shortcuts">
      <Button className="entry-shortcut" disabled={busy} onClick={() => onNavigate("inherit")}>
        <span><strong>{t("entry.home.plan")}</strong><small>{t("entry.home.planHint")}</small></span><Icon name="arrow" size={18} />
      </Button>
      <Button className="entry-shortcut" disabled={busy} onClick={() => onNavigate("money")}>
        <span><strong>{t("nav.money")}</strong><small>{t("entry.home.assetsHint")}</small></span><Icon name="arrow" size={18} />
      </Button>
    </div>}

    {view === "money" && <>
      <ul className="entry-assets" aria-label={t("assets.label")}>
        {(["WLD", ...(USDC_ENABLED ? ["USDC"] : [])]).map(symbol => <li className="entry-asset" key={symbol}>
          <span className={`asset-token asset-token-${symbol.toLowerCase()}`} aria-hidden="true" />
          <div><strong>{symbol}</strong><small>{t("entry.balance.label")}</small></div>
          <span className="entry-balance" role="img" aria-label={t("entry.balance.unavailable")}>—</span>
        </li>)}
      </ul>
      <p className="entry-context">{t("entry.money.preview")}</p>
    </>}

    {view === "inherit" && (linkedVault
      ? <div className="entry-shared-plan"><Icon name="inherit" size={24} />
        <div><strong>{t("entry.linked.reference")}</strong><span>{linkedVault}</span></div>
        <p>{t("entry.linked.next")}</p>
      </div>
      : <ol className="entry-plan-steps">
        {(["assets", "recipient", "checkin"] as const).map(step => <li key={step}>
          <strong>{t(`entry.step.${step}.title`)}</strong><p>{t(`entry.step.${step}.body`)}</p>
        </li>)}
      </ol>)}

    {view !== "money" && <details className="entry-rules"><summary>{t("guide.title")}</summary><TransferGuide /></details>}
    <div className="entry-action" ref={actionRef}>
      {installed
        ? <Button variant="primary" size="lg" onClick={onConnect} disabled={busy}>
          {busy ? <><span className="spinner" />{t("entry.connect.busy")}</> : <>{t("entry.connect.continue")}<Icon name="arrow" size={19} /></>}
        </Button>
        : <a className="btn btn-primary btn-lg" href={worldLink}>{t("entry.connect.open")}<Icon name="arrow" size={19} /></a>}
      <p>{t("entry.connect.note")}</p>
    </div>
  </section>;
}
