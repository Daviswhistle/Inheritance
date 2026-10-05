import { Brand, Icon } from "./Icon";
import { Button } from "./ui/button";
import { USDC_ENABLED } from "@/config";
import { HAS_YIELD_ROUTES } from "@/assets";
import { LanguagePicker } from "@/i18n";
import { useLocale } from "@/locale-context";
import { localizeAppMessage } from "@/locale";

export function Landing({ installed, busy, onConnect, linkedVault, status }: { installed: boolean; busy: boolean; onConnect: () => void; linkedVault: string; status: string }) {
  const { t, locale } = useLocale();
  const appId = document.querySelector('meta[name="minikit:app-id"]')?.getAttribute("content") || "";
  const path = linkedVault ? `/?vault=${linkedVault}` : "/";
  const worldLink = `https://world.org/mini-app?app_id=${encodeURIComponent(appId)}&path=${encodeURIComponent(path)}`;
  const title = (linkedVault ? t("landing.title.invited") : t("landing.title.default")).split("\n");
  const assets = t(USDC_ENABLED ? "landing.assetChoice.both" : "landing.assetChoice.wld");
  const amounts = t(USDC_ENABLED ? "landing.amounts.both" : "landing.amounts.wld");
  return <div className="app-shell" lang={locale}>
    <header className="app-header"><div className="container-narrow header-content"><Brand /><div className="landing-header-actions"><span className="network-pill"><span className="live-dot" />World Chain</span><LanguagePicker /></div></div></header>
    <main className="container-narrow landing-content">
      <div className="landing-eyebrow"><Icon name="heart" size={16} /> {t("landing.eyebrow")}</div>
      <h1>{title[0]}<br />{linkedVault ? title[1] : <span>{title[1]}</span>}</h1>
      <p className="landing-description">{linkedVault ? t("landing.description.linked") : HAS_YIELD_ROUTES
        ? t("landing.description.yield", { assets })
        : t("landing.description.basic")}</p>
      <div className="vault-illustration" aria-hidden="true">
        <div className="illustration-orbit" /><div className="illustration-orbit orbit-two" />
        <div className="illustration-note"><span className="illustration-note-icon"><Icon name="heart" size={19} /></span>{t("landing.illustration.note")}</div>
        <div className="illustration-vault"><div className="illustration-vault-top"><Icon name="vault" size={26} /><span>{t("landing.illustration.plan")}</span></div><div className="illustration-vault-value">{t("landing.illustration.futureFirst")}<br /><span>{t("landing.illustration.futureSecond")}</span></div><div className="illustration-vault-bottom"><span className="live-dot" /> {t("landing.illustration.control")}</div></div>
        <span className="illustration-check"><Icon name="check" size={22} /></span>
      </div>
      <div className="landing-action">
        {installed ? <Button variant="primary" size="lg" onClick={onConnect} disabled={busy}>{busy ? <><span className="spinner" />{t("landing.connect.busy")}</> : <>{t("landing.connect.continue")}<Icon name="arrow" size={19} /></>}</Button> : <a className="btn btn-primary btn-lg" href={worldLink}>{t("landing.connect.open")}<Icon name="arrow" size={19} /></a>}
        <p>{t("landing.connect.signin")}</p>
      </div>
      {status && !/Open in World App.*bridge unavailable/i.test(status) && <p className="landing-feedback" role="status" aria-live="polite">{localizeAppMessage(locale, status)}</p>}
      <div className="landing-trust"><span><Icon name="check" size={15} />{t("landing.trust.plan")}</span><span><Icon name="check" size={15} />{t(HAS_YIELD_ROUTES ? "landing.trust.fee" : "landing.trust.noFee")}</span><span><Icon name="check" size={15} />{t("landing.trust.keys")}</span></div>
      <section className="landing-how" aria-labelledby="landing-how-title"><div className="landing-section-heading"><span className="eyebrow">{t("landing.steps.eyebrow")}</span><h2 id="landing-how-title">{t("landing.steps.title")}</h2></div><ol className="landing-steps">
        <li><span>01</span><div><h3>{t("landing.steps.one.title")}</h3><p>{t("landing.steps.one.body", { assets: amounts })}</p></div></li>
        <li><span>02</span><div><h3>{t("landing.steps.two.title")}</h3><p>{t(HAS_YIELD_ROUTES ? "landing.steps.two.yield" : "landing.steps.two.basic")}</p></div></li>
        <li><span>03</span><div><h3>{t("landing.steps.three.title")}</h3><p>{t(HAS_YIELD_ROUTES ? "landing.steps.three.yield" : "landing.steps.three.basic")}</p></div></li>
      </ol></section>
      <details className="landing-details"><summary>{t("landing.missed.summary")}<Icon name="help" size={19} /></summary><p>{t("landing.missed.body")}</p></details>
      <div className="landing-legal"><p>{t("landing.legal.disclaimer")} {HAS_YIELD_ROUTES ? `${t("landing.legal.yieldRisk")} ` : `${t("landing.legal.basic")} `}{t("landing.legal.networkFees")}</p><div><a href="/privacy.html">{t("landing.link.privacy")}</a><a href="/terms.html">{t("landing.link.terms")}</a><a href="/yield-terms.html">{t("landing.link.yieldTerms")}</a><a href="mailto:daviswhistle@naver.com">{t("landing.link.support")}</a>{!installed && <a href="https://world.org/world-app" target="_blank" rel="noreferrer">{t("landing.link.getApp")}</a>}</div></div>
    </main>
  </div>;
}
