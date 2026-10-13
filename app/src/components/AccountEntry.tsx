import { USDC_ENABLED } from "@/config";
import { useLocale } from "@/locale-context";
import { Icon } from "./Icon";
import { Button } from "./ui/button";
import { TransferGuide } from "./TransferGuide";

export function AccountEntry({ view, installed, busy, onConnect, linkedVault }: {
  view: "vault" | "money" | "inherit";
  installed: boolean;
  busy: boolean;
  onConnect: () => void;
  linkedVault: string;
}) {
  const { t } = useLocale();
  const appId = document.querySelector('meta[name="minikit:app-id"]')?.getAttribute("content") || "";
  const path = linkedVault ? `/?vault=${linkedVault}` : "/";
  const worldLink = `https://world.org/mini-app?app_id=${encodeURIComponent(appId)}&path=${encodeURIComponent(path)}`;

  return <section className="account-entry" aria-labelledby="account-entry-title">
    {(view === "vault" || view === "money") && <div className="entry-assets" aria-label={t("assets.label")}>
      {(["WLD", ...(USDC_ENABLED ? ["USDC"] : [])]).map(symbol => <div className="entry-asset" key={symbol}>
        <span className={`asset-token asset-token-${symbol.toLowerCase()}`} aria-hidden="true" />
        <span>{symbol}</span><strong>—</strong>
        <small>{t("entry.balance.label")}</small>
      </div>)}
    </div>}
    <div className="entry-access">
      <h2 id="account-entry-title">{t(view === "inherit" && linkedVault ? "entry.linked.title" : `entry.${view}.title`)}</h2>
      <p>{t(view === "inherit" && linkedVault ? "entry.linked.body" : `entry.${view}.body`)}</p>
      <details className="entry-rules"><summary>{t("guide.title")}</summary><TransferGuide /></details>
    </div>
    <div className="entry-action">
      {installed
        ? <Button variant="primary" size="lg" onClick={onConnect} disabled={busy}>
          {busy ? <><span className="spinner" />{t("entry.connect.busy")}</> : <>{t("entry.connect.continue")}<Icon name="arrow" size={19} /></>}
        </Button>
        : <a className="btn btn-primary btn-lg" href={worldLink}>{t("entry.connect.open")}<Icon name="arrow" size={19} /></a>}
      <p>{t("entry.connect.note")}</p>
    </div>
  </section>;
}
