import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { useLocale } from "@/locale-context";
import type { LocaleKeyType } from "@/locale";
import type { EdgeEligibility, SupportedResidenceCountry } from "../../shared/new-plan-policy";
import "./NewPlanAccessNotice.css";

export type PlanAccessLocation = EdgeEligibility | { state: "checking" };

const countryKeys: Record<SupportedResidenceCountry, LocaleKeyType> = {
  KR: "plan.access.country.kr",
  AR: "plan.access.country.ar",
  CO: "plan.access.country.co",
};

export function NewPlanAccessNotice({
  account, location, residence, onRetry, onConfirmResidence, compact = false,
}: {
  account: string;
  location: PlanAccessLocation;
  residence: SupportedResidenceCountry | null;
  onRetry: () => void;
  onConfirmResidence: (country: SupportedResidenceCountry) => boolean;
  compact?: boolean;
}) {
  const { t } = useLocale();
  const [country, setCountry] = useState<SupportedResidenceCountry | "" | "other">("");
  const [confirmed, setConfirmed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    setCountry("");
    setConfirmed(false);
    setSaveFailed(false);
  }, [account]);

  if (location.state === "supported" && residence) return null;
  const checking = location.state === "checking";
  const supportedLocation = location.state === "supported";
  const title = checking ? "plan.access.checkingTitle"
    : supportedLocation ? "plan.access.residenceTitle"
      : location.state === "unsupported" ? "plan.access.unsupportedTitle" : "plan.access.unavailableTitle";
  const body = checking ? "plan.access.checkingBody"
    : supportedLocation ? "plan.access.residenceBody"
      : location.state === "unsupported" ? "plan.access.unsupportedBody" : "plan.access.unavailableBody";

  return <section className={`plan-access-notice${compact ? " plan-access-notice-compact" : ""}`}
    aria-labelledby="plan-access-title" aria-live={checking ? "polite" : undefined}>
    <h3 id="plan-access-title">{t(title)}</h3>
    <p>{t(body)}</p>
    {supportedLocation ? <div className="plan-residence-confirmation">
      <label className="field-row-label" htmlFor="plan-residence-country">{t("plan.access.residenceCountry")}</label>
      <select id="plan-residence-country" value={country} onChange={event => {
        setCountry(event.target.value as SupportedResidenceCountry | "" | "other");
        setConfirmed(false);
        setSaveFailed(false);
      }}>
        <option value="">{t("plan.access.residencePlaceholder")}</option>
        {(Object.keys(countryKeys) as SupportedResidenceCountry[]).map(code =>
          <option key={code} value={code}>{t(countryKeys[code])}</option>)}
        <option value="other">{t("plan.access.country.other")}</option>
      </select>
      {country === "other" && <p role="status">{t("plan.access.otherResidence")}</p>}
      <label className="plan-residence-attestation">
        <input id="plan-residence-attestation" type="checkbox" checked={confirmed} disabled={!country || country === "other"}
          onChange={event => setConfirmed(event.target.checked)} />
        <span>{t("plan.access.attest")}</span>
      </label>
      <Button variant="primary" disabled={!country || country === "other" || !confirmed} onClick={() => {
        const saved = country && country !== "other" ? onConfirmResidence(country) : false;
        setSaveFailed(!saved);
      }}>{t("plan.access.confirmResidence")}</Button>
      {saveFailed && <p className="plan-access-error" role="alert">{t("plan.access.saveFailed")}</p>}
    </div> : <Button size="sm" variant="ghost" disabled={checking} onClick={onRetry}>
      {t(checking ? "plan.access.checkingRetry" : "plan.access.retry")}
    </Button>}
  </section>;
}
