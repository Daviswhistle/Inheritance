import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { formatPlanInterval, parseAssetAmount } from "@/plan";
import { useLocale } from "@/locale-context";
import "./PlanSetup.css";

type PlanAsset = "WLD" | "USDC";
type PlanRouteRow = { symbol: PlanAsset; decimals: number; mode: "morpho" | "plain"; amount: string; walletBalance: bigint | null; underlyingFeePercent?: number };
type PlanAssetProgress = { symbol: PlanAsset; amount: string; decimals: number; mode: "morpho" | "plain"; depositState: "ready" | "submitting" | "submitted" | "complete" };
type PlanProgress = { heir: string; periodDays: number; createState: "ready" | "submitting" | "submitted" | "complete"; assets: PlanAssetProgress[];
  alignment?: { state: "submitting" | "submitted" } };
type AlignmentConflict = { symbol: PlanAsset; address: string; currentHeir: string; currentPeriodSeconds: bigint; requestedHeir: string; requestedPeriod: number };
type ReviewAsset = { symbol: PlanAsset; amount: string; decimals: number; mode: "morpho" | "plain"; underlyingFeePercent?: number };
type ReviewSnapshot = {
  fingerprint: string;
  assets: ReviewAsset[];
  heirAddress: string;
  heirUsername: string;
  periodDays: number;
};

function formatExactTokenAmount(amount: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return amount.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  if (decimals === 0) return whole.toString();
  const fraction = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function isWalletAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function PlanSetup({
  rows, heir, onHeirChange, onPickHeir, resolvingHeir, heirResolved, heirUsername, shareBusy,
  period, periodValid, onPeriodChange, onPreset, onAmountChange, yieldConsent, onYieldConsent, pendingPlan,
  heirSuspicious, alignmentConflicts, onConfirmAlignment, onCancelAlignment, onCreate, onResume,
  busy, createDisabled, resumeDisabled, canEditRemaining, onEditRemaining,
}: {
  rows: PlanRouteRow[];
  heir: string;
  onHeirChange: (value: string) => void;
  onPickHeir: () => void;
  resolvingHeir: boolean;
  heirResolved: string;
  heirUsername: string;
  shareBusy: boolean;
  period: string;
  periodValid: boolean;
  onPeriodChange: (value: string) => void;
  onPreset: (days: number) => void;
  onAmountChange: (symbol: PlanAsset, value: string) => void;
  heirSuspicious: boolean;
  yieldConsent: boolean;
  onYieldConsent: (value: boolean) => void;
  pendingPlan: PlanProgress | null;
  alignmentConflicts: AlignmentConflict[];
  onConfirmAlignment: () => void;
  onCancelAlignment: () => void;
  onCreate: (reviewedFees: Partial<Record<PlanAsset, number>>) => void;
  onResume: () => void;
  canEditRemaining: boolean;
  onEditRemaining: () => void;
  busy: boolean;
  createDisabled: boolean;
  resumeDisabled: boolean;
}) {
  const { t, locale } = useLocale();
  const [reviewSnapshot, setReviewSnapshot] = useState<ReviewSnapshot | null>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const wasReviewingRef = useRef(false);
  const createClickLocked = useRef(false);
  const formatInterval = (seconds: bigint) => {
    if (locale === "en") return formatPlanInterval(seconds);
    const days = seconds / 86400n;
    const remainder = seconds % 86400n;
    return remainder
      ? t("plan.interval.daysSeconds", { days: Number(days), seconds: Number(remainder) })
      : t("plan.interval.daysOnly", { days: Number(days) });
  };

  const parsedRows = rows.map(row => ({
    row,
    amount: parseAssetAmount(row.amount.trim() || "0", row.decimals),
  }));
  const selectedRows = parsedRows.filter(item => item.amount !== null && item.amount > 0n);
  const invalidAmountRow = parsedRows.find(item => item.amount === null);
  const amountWithoutBalance = selectedRows.find(item => item.row.walletBalance === null);
  const exceedsBalance = selectedRows.find(item => item.row.walletBalance !== null && item.amount !== null && item.amount > item.row.walletBalance);

  const trimmedHeir = heir.trim();
  const resolvedAddressValid = isWalletAddress(heirResolved);
  const resolvedIsZero = resolvedAddressValid && /^0x0{40}$/i.test(heirResolved);
  const typedAddress = isWalletAddress(trimmedHeir);
  const typedUsername = trimmedHeir.replace(/^@/, "").toLowerCase();
  const resolvedUsername = heirUsername.trim().replace(/^@/, "").toLowerCase();
  const recipientMatchesInput = resolvedAddressValid && (typedAddress
    ? trimmedHeir.toLowerCase() === heirResolved.toLowerCase()
    : Boolean(typedUsername && resolvedUsername && typedUsername === resolvedUsername));
  const recipientValid = Boolean(trimmedHeir && !resolvingHeir && recipientMatchesInput && !resolvedIsZero && !heirSuspicious);

  const periodText = period.trim();
  const periodDays = /^\d+$/.test(periodText) ? Number(periodText) : Number.NaN;
  const intervalValid = periodValid && Number.isSafeInteger(periodDays) && periodDays >= 1 && periodDays <= 365;
  const needsYieldConsent = selectedRows.some(item => item.row.mode === "morpho");
  const consentValid = !needsYieldConsent || yieldConsent;
  const hasSelectedAsset = selectedRows.length > 0;
  const balancesValid = !amountWithoutBalance && !exceedsBalance;
  const formValid = !invalidAmountRow && hasSelectedAsset && balancesValid && recipientValid && intervalValid;

  const currentFingerprint = JSON.stringify({
    amounts: rows.map(row => [row.symbol, row.amount, row.decimals, row.mode, row.underlyingFeePercent]),
    heir,
    heirResolved,
    heirUsername,
    heirSuspicious,
    period,
  });
  const canReview = formValid && !busy && !pendingPlan && !createDisabled && alignmentConflicts.length === 0;
  const showReview = Boolean(reviewSnapshot && reviewSnapshot.fingerprint === currentFingerprint && !pendingPlan && alignmentConflicts.length === 0);

  useEffect(() => {
    if (!busy) createClickLocked.current = false;
  }, [busy]);

  useEffect(() => {
    if (reviewSnapshot && (pendingPlan || reviewSnapshot.fingerprint !== currentFingerprint || alignmentConflicts.length > 0)) {
      setReviewSnapshot(null);
    }
  }, [reviewSnapshot, pendingPlan, currentFingerprint, alignmentConflicts.length]);

  useEffect(() => {
    if (showReview && !wasReviewingRef.current) reviewHeadingRef.current?.focus();
    if (!showReview && wasReviewingRef.current && !busy && !pendingPlan) {
      document.querySelector<HTMLInputElement>(".plan-setup-card .plan-amount-control input")?.focus();
    }
    wasReviewingRef.current = showReview;
  }, [showReview, busy, pendingPlan]);

  const amountStatus = (state: PlanAssetProgress["depositState"]) => t(({
    ready: "plan.progress.ready", submitting: "plan.progress.submitting", submitted: "plan.progress.submitted", complete: "plan.progress.complete",
  } as const)[state]);

  const validationReason = (() => {
    if (pendingPlan) return t("plan.validation.pending");
    if (invalidAmountRow) return t("plan.validation.amount", { symbol: invalidAmountRow.row.symbol, decimals: invalidAmountRow.row.decimals });
    if (!hasSelectedAsset) return t("plan.validation.enterAmount");
    if (amountWithoutBalance) return t("plan.validation.balanceLoading", { symbol: amountWithoutBalance.row.symbol });
    if (exceedsBalance) return t("plan.validation.balance", { symbol: exceedsBalance.row.symbol });
    if (!trimmedHeir) return t("plan.validation.chooseHeir");
    if (resolvingHeir) return t("plan.validation.resolving");
    if (heirSuspicious) return t("plan.validation.differentHeir");
    if (resolvedIsZero) return t("plan.validation.zeroAddress");
    if (!recipientValid) return t("plan.validation.recipient");
    if (!intervalValid) return t("plan.validation.interval");
    if (showReview && !consentValid) return t("plan.validation.consent");
    if (alignmentConflicts.length > 0) return t("plan.validation.alignment");
    if (createDisabled) return t("plan.validation.checking");
    return "";
  })();

  const startReview = () => {
    if (!canReview) return;
    const assets = selectedRows.map(item => ({
      symbol: item.row.symbol,
      amount: (item.amount as bigint).toString(),
      decimals: item.row.decimals,
      mode: item.row.mode,
      underlyingFeePercent: item.row.underlyingFeePercent,
    }));
    setReviewSnapshot({
      fingerprint: currentFingerprint,
      assets,
      heirAddress: heirResolved,
      heirUsername,
      periodDays,
    });
  };

  const editPlan = () => {
    if (busy || pendingPlan) return;
    setReviewSnapshot(null);
  };

  const confirmPlan = () => {
    if (!reviewSnapshot || !showReview || !formValid || !consentValid || busy || pendingPlan || createDisabled || alignmentConflicts.length > 0 || createClickLocked.current) return;
    createClickLocked.current = true;
    try {
      const reviewedFees: Partial<Record<PlanAsset, number>> = {};
      for(const asset of reviewSnapshot.assets)if(asset.mode === "morpho" && typeof asset.underlyingFeePercent === "number")reviewedFees[asset.symbol] = asset.underlyingFeePercent;
      onCreate(reviewedFees);
    } catch (error) {
      createClickLocked.current = false;
      throw error;
    }
  };

  const amountSection = <fieldset className="plan-assets" disabled={Boolean(pendingPlan) || busy} aria-labelledby="plan-assets-title">
    <legend id="plan-assets-title">{t("plan.amounts.title")}</legend>
    {rows.map(row => {
      const rowError = parseAssetAmount(row.amount.trim() || "0", row.decimals) === null;
      const rowOverBalance = row.walletBalance !== null && (parseAssetAmount(row.amount, row.decimals) ?? 0n) > row.walletBalance;
      const inputId = `plan-${row.symbol.toLowerCase()}`;
      const balanceId = `${inputId}-available`;
      const errorId = `${inputId}-error`;
      return <div className="plan-asset-row" key={row.symbol}>
        <div className="plan-asset-heading">
          <label htmlFor={inputId}>{row.symbol}</label>
          <span>{t(row.mode === "morpho" ? "plan.mode.yield" : "plan.mode.basic")}</span>
        </div>
        <div className="plan-amount-control">
          <Input id={inputId} inputMode="decimal" placeholder="0" value={row.amount}
            aria-invalid={rowError || rowOverBalance}
            aria-describedby={`${balanceId}${rowError || rowOverBalance ? ` ${errorId}` : ""}`}
            onChange={event => { setReviewSnapshot(null); onAmountChange(row.symbol, event.target.value); }} />
          <strong>{row.symbol}</strong>
        </div>
        <p id={balanceId} className="plan-asset-balance">
          {row.walletBalance === null ? t("plan.balance.loading") : t("plan.balance.available", { amount: formatExactTokenAmount(row.walletBalance, row.decimals), symbol: row.symbol })}
        </p>
        {rowError && <p id={errorId} className="plan-inline-error" role="alert">{t("plan.amount.errorPrecision", { decimals: row.decimals })}</p>}
        {!rowError && rowOverBalance && <p id={errorId} className="plan-inline-error" role="alert">{t("plan.amount.errorBalance")}</p>}
      </div>;
    })}
  </fieldset>;

  const strategyFeeText = (asset: { symbol: string; underlyingFeePercent?: number }) => {
    const fee = asset.underlyingFeePercent;
    return typeof fee === "number" && Number.isFinite(fee) && fee >= 0 && fee <= 100
      ? t("plan.risk.strategyFee", { symbol: asset.symbol, percent: new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(fee) })
      : t("plan.risk.strategyFeeChecking", { symbol: asset.symbol });
  };
  const feeGroups = (assets: readonly { symbol: string; underlyingFeePercent?: number }[]) => {
    const groups = new Map<number | undefined, string[]>();
    for (const asset of assets) groups.set(asset.underlyingFeePercent, [...(groups.get(asset.underlyingFeePercent) ?? []), asset.symbol]);
    return [...groups].map(([underlyingFeePercent, symbols]) => ({ symbol: symbols.join(" + "), underlyingFeePercent }));
  };
  const disclosedYieldRows = (pendingPlan ? rows.filter(row => pendingPlan.assets.some(asset => asset.symbol === row.symbol
    && asset.mode === "morpho" && asset.depositState === "ready")) : selectedRows.map(item => item.row)).filter(row => row.mode === "morpho");
  const hasYieldRoute = disclosedYieldRows.length > 0;
  const riskDisclosure = <section className="plan-risk" aria-labelledby="plan-risk-title">
    <h3 id="plan-risk-title" className={showReview ? "sr-only" : undefined}>{t("plan.risk.title")}</h3>
    <ul className="plan-risk-points">
      {!showReview && <li>{t(hasYieldRoute ? "plan.risk.yieldFee" : "plan.risk.basicFee")}</li>}
      {!showReview && feeGroups(disclosedYieldRows).map(row => <li key={row.symbol}>{strategyFeeText(row)}</li>)}
      {hasYieldRoute && <li>{t("plan.risk.value")}</li>}
      {!showReview && <li>{t("plan.risk.inheritance")}</li>}
    </ul>
    {hasYieldRoute && <label className="yield-consent"><input id="yield-consent" type="checkbox" checked={yieldConsent} disabled={busy}
      onChange={event => onYieldConsent(event.target.checked)} />
      <span>{t("plan.risk.consent")}</span>
    </label>}
    <details className="plan-more-details">
      <summary>{t("plan.more.summary")}</summary>
      <div>
        <p>{t("plan.more.assets")}</p>
        <p>{t("plan.more.liquidity")}</p>
        <a href="/yield-terms.html" target="_blank" rel="noreferrer">{t("plan.more.link")}</a>
      </div>
    </details>
  </section>;

  const alignmentReview = alignmentConflicts.length > 0 && <section className="plan-review plan-alignment-review" aria-labelledby="plan-alignment-title">
    <h3 id="plan-alignment-title">{t("plan.alignment.title")}</h3>
    <p>{t("plan.alignment.body")}</p>
    {alignmentConflicts.some(conflict => conflict.currentPeriodSeconds !== BigInt(conflict.requestedPeriod) * 86400n)
      && <p>{t("plan.alignment.timer")}</p>}
    <ul>
      {alignmentConflicts.map(conflict => <li key={conflict.address}>
        <strong>{conflict.symbol}</strong> · {conflict.address.slice(0, 6)}…{conflict.address.slice(-4)}: {conflict.currentHeir.slice(0, 6)}…{conflict.currentHeir.slice(-4)}, {formatInterval(conflict.currentPeriodSeconds)}
        <span aria-hidden="true"> → </span>
        {conflict.requestedHeir.slice(0, 6)}…{conflict.requestedHeir.slice(-4)}, {t("plan.alignment.days", { days: conflict.requestedPeriod })}
        {conflict.currentPeriodSeconds !== BigInt(conflict.requestedPeriod) * 86400n && <span>{t("plan.alignment.changeReset")}</span>}
      </li>)}
    </ul>
    <div className="plan-action-row">
      <Button variant="primary" disabled={busy} onClick={onConfirmAlignment}>{t("plan.alignment.confirm")}</Button>
      <Button disabled={busy} onClick={onCancelAlignment}>{t("plan.alignment.keep")}</Button>
    </div>
  </section>;

  return <Card className="plan-setup-card">
    {!showReview && <CardHeader>
      <CardTitle>{t("plan.title")}</CardTitle>
    </CardHeader>}
    <CardContent className="plan-setup-content">
      {pendingPlan && <section className="plan-resume" aria-labelledby="plan-resume-title">
        <div>
          <h3 id="plan-resume-title">{t("plan.pending.title")}</h3>
          <p>{t("plan.pending.body")}</p>
          {(pendingPlan.createState === "submitting" || pendingPlan.createState === "submitted")
            && <p role="status">{t("plan.pending.checkCreate")}</p>}
          {pendingPlan.alignment && <p role="status">{t("plan.pending.checkAlignment")}</p>}
        </div>
        <dl className="plan-progress-list">
          {pendingPlan.assets.map(asset => <div key={asset.symbol}>
            <dt>{asset.symbol} · {formatExactTokenAmount(BigInt(asset.amount), asset.decimals)} {asset.symbol}</dt>
            <dd>{amountStatus(asset.depositState)}</dd>
          </div>)}
        </dl>
        <p className="plan-pending-settings">{t("plan.pending.recipient", { address: `${pendingPlan.heir.slice(0, 6)}…${pendingPlan.heir.slice(-4)}`, days: pendingPlan.periodDays })}</p>
        <Button variant="primary" disabled={busy || resumeDisabled} onClick={onResume}>
          {busy ? <><span className="spinner" />{t("plan.pending.resumeBusy")}</> : t("plan.pending.resume")}
        </Button>
        {canEditRemaining && <>
          <Button disabled={busy} onClick={onEditRemaining}>{t("plan.pending.edit")}</Button>
          <p className="plan-pending-settings">{t("plan.pending.editNote")}</p>
        </>}
      </section>}

      {!showReview && <>
        {amountSection}

        <div className="field-row">
          <label className="field-row-label" htmlFor="heir-input">{t("plan.recipient.label")}</label>
          <div className="field-row-controls plan-recipient-controls">
            <Input id="heir-input" placeholder={t("plan.recipient.placeholder")} value={heir} disabled={Boolean(pendingPlan) || busy}
              onChange={event => { setReviewSnapshot(null); onHeirChange(event.target.value); }} aria-describedby="heir-help" />
            <Button disabled={busy || Boolean(pendingPlan) || shareBusy} onClick={() => { setReviewSnapshot(null); onPickHeir(); }} title={t("plan.recipient.chooseTitle")}>
              {shareBusy ? t("plan.recipient.opening") : t("plan.recipient.choose")}
            </Button>
          </div>
          <p id="heir-help" className="plan-field-help">{t("plan.recipient.help")}</p>
          {heir && (resolvingHeir ? <p className="plan-field-help" role="status">{t("plan.recipient.checking")}</p>
            : recipientValid ? <p className="resolved-heir">{heirUsername ? `@${heirUsername}` : t("plan.recipient.wallet")}<span>{heirResolved.slice(0, 6)}…{heirResolved.slice(-4)}</span></p>
              : <p className="plan-inline-error" role="alert">{t("plan.recipient.notFound")}</p>)}
          {heirSuspicious && <p className="plan-inline-error" role="alert">{t("plan.recipient.self")}</p>}
        </div>

        <div className="field-row">
          <label className="field-row-label" htmlFor="period-input">{t("plan.interval.label")}</label>
          <div className="field-row-controls">
            <Input id="period-input" type="text" inputMode="numeric" className="plan-period-input" value={period} placeholder="30"
              disabled={Boolean(pendingPlan) || busy} onChange={event => { setReviewSnapshot(null); onPeriodChange(event.target.value); }} />
            <span className="field-suffix">{t("plan.interval.days")}</span>
          </div>
          <div className="period-presets" aria-label={t("plan.interval.suggested")}>
            {[30, 90, 180].map(days => <button key={days} type="button" className={`period-preset ${Number(period) === days ? "period-preset-selected" : ""}`}
              aria-pressed={Number(period) === days} disabled={Boolean(pendingPlan) || busy} onClick={() => { setReviewSnapshot(null); onPreset(days); }}>{days} {t("plan.interval.days")}</button>)}
          </div>
          {!intervalValid && <p className="plan-inline-error" role="alert">{t("plan.interval.invalid")}</p>}
        </div>
      </>}

      {showReview && reviewSnapshot && <section className="plan-review plan-final-review" aria-labelledby="plan-review-title">
        <h3 id="plan-review-title" tabIndex={-1} ref={reviewHeadingRef}>{t("plan.review.title")}</h3>
        <dl className="plan-review-list">
          <div>
            <dt>{t("plan.review.amounts")}</dt>
            <dd>{reviewSnapshot.assets.map(asset => <span className="plan-review-amount" key={asset.symbol}>
              {formatExactTokenAmount(BigInt(asset.amount), asset.decimals)} {asset.symbol}
            </span>)}</dd>
          </div>
          <div>
            <dt>{t("plan.review.recipient")}</dt>
            <dd>
              {reviewSnapshot.heirUsername && <strong>@{reviewSnapshot.heirUsername.replace(/^@/, "")}</strong>}
              <span className="plan-review-address">{reviewSnapshot.heirAddress}</span>
            </dd>
          </div>
          <div><dt>{t("plan.review.interval")}</dt><dd>{t("plan.review.every", { days: reviewSnapshot.periodDays })}</dd></div>
          <div>
            <dt>{t("plan.review.feeRisk")}</dt>
            <dd>
              {reviewSnapshot.assets.some(asset => asset.mode === "morpho")
                ? t("plan.review.yieldFee")
                : t("plan.review.basicFee")}
            </dd>
          </div>
          {reviewSnapshot.assets.some(asset => asset.mode === "morpho") && <div>
            <dt>{t("plan.review.strategyFee")}</dt>
            <dd>{feeGroups(reviewSnapshot.assets.filter(asset => asset.mode === "morpho")).map(asset => <span className="plan-review-amount" key={asset.symbol}>{strategyFeeText(asset)}</span>)}</dd>
          </div>}
          <div><dt>{t("plan.review.missedTitle")}</dt><dd>{t("plan.review.missedBody")}</dd></div>
        </dl>
        {riskDisclosure}
      </section>}

      {alignmentReview}
      {pendingPlan && hasYieldRoute && riskDisclosure}

      {showReview && <p className="plan-legal-copy">{t("plan.legal")} <a href="/terms.html">{t("plan.legal.terms")}</a> {t("plan.legal.join")} <a href="/privacy.html">{t("plan.legal.privacy")}</a>.</p>}
      {validationReason && !pendingPlan && (selectedRows.length > 0 || trimmedHeir || !intervalValid)
        && <p className="plan-validation-message" role="status">{validationReason}</p>}

      {showReview
        ? <div className="plan-step-actions">
          <Button variant="primary" size="lg" className="plan-submit" disabled={busy || Boolean(pendingPlan) || createDisabled || !formValid || !consentValid || alignmentConflicts.length > 0} onClick={confirmPlan}>
            {busy ? <><span className="spinner" />{t("plan.action.settingUp")}</> : t("plan.action.confirm")}
          </Button>
          <Button disabled={busy || Boolean(pendingPlan)} onClick={editPlan}>{t("plan.action.edit")}</Button>
        </div>
        : <Button variant="primary" size="lg" className="plan-submit" disabled={busy || Boolean(pendingPlan) || !canReview} onClick={startReview}>
          {busy ? <><span className="spinner" />{t("plan.action.checking")}</> : pendingPlan ? t("plan.action.inProgress") : t("plan.action.review")}
        </Button>}
    </CardContent>
  </Card>;
}
