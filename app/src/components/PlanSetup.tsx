import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Input } from "./ui/input";
import { formatPlanInterval, parseAssetAmount } from "@/plan";
import { useLocale } from "@/locale-context";
import { useActionClearance } from "@/use-action-clearance";
import "./PlanSetup.css";

type PlanAsset = "WLD" | "USDC";
type PlanRouteRow = { symbol: PlanAsset; decimals: number; mode: "morpho" | "plain"; amount: string; walletBalance: bigint | null; balanceUnavailable: boolean; underlyingFeePercent?: number };
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

function PlanLegalDialog({ document: legalDocument, onClose }: { document: "terms" | "privacy"; onClose: () => void }) {
  const { t } = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [visibleDocument, setVisibleDocument] = useState<"terms" | "privacy" | "yield">(legalDocument);
  const title = t(visibleDocument === "terms" ? "plan.legal.terms" : visibleDocument === "privacy" ? "plan.legal.privacy" : "plan.more.link");
  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    const opener = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialogRef} className="plan-legal-dialog" aria-labelledby="plan-legal-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id="plan-legal-title">{title}</h2><Button onClick={onClose}>{t("common.close")}</Button></header>
    <iframe src={`/${legalDocument}.html`} title={title}
      onLoad={event => {
        // Reuse the published documents while keeping their return links inside
        // this review: reloading the app would discard the unsubmitted draft.
        const frameDocument = event.currentTarget.contentDocument;
        if (frameDocument) setVisibleDocument(frameDocument.location.pathname === "/privacy.html" ? "privacy"
          : frameDocument.location.pathname === "/yield-terms.html" ? "yield" : "terms");
        frameDocument?.addEventListener("keydown", event => {
          if (event.key === "Escape") { event.preventDefault(); onClose(); }
        });
        frameDocument?.addEventListener("click", event => {
          // iframe nodes belong to another realm, so parent Element instanceof
          // checks would miss their links.
          const link = (event.target as Element | null)?.closest?.("a");
          if (!link) return;
          const destination = new URL(link.href, window.location.href);
          if (destination.origin === window.location.origin && destination.pathname === "/") {
            event.preventDefault(); onClose();
          }
        });
      }} />
  </dialog>;
}

export function PlanSetup({
  rows, heir, onHeirChange, onPickHeir, resolvingHeir, heirResolved, heirUsername, shareBusy,
  period, periodValid, onPeriodChange, onPreset, onAmountChange, yieldConsent, onYieldConsent, pendingPlan,
  heirSuspicious, alignmentConflicts, onConfirmAlignment, onCancelAlignment, onCreate, onResume,
  busy, createDisabled, resumeDisabled, canEditRemaining, onEditRemaining, onRefreshBalances,
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
  onRefreshBalances: () => void;
  busy: boolean;
  createDisabled: boolean;
  resumeDisabled: boolean;
}) {
  const { t, locale } = useLocale();
  const actionRef = useActionClearance(!pendingPlan);
  const [reviewSnapshot, setReviewSnapshot] = useState<ReviewSnapshot | null>(null);
  const [legalDocument, setLegalDocument] = useState<"terms" | "privacy" | null>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const resumeHeadingRef = useRef<HTMLHeadingElement>(null);
  const resumeAttention = useRef({ pending: false, busy: false });
  const hasPendingPlan = Boolean(pendingPlan);
  const wasReviewingRef = useRef(false);
  const createClickLocked = useRef(false);
  useEffect(() => {
    const previous = resumeAttention.current;
    resumeAttention.current = { pending: hasPendingPlan, busy };
    // A returned wallet request may replace the form below existing settings.
    // Show the recovery action once; background reads must not move the reader.
    if (!hasPendingPlan || busy || previous.pending && !previous.busy) return;
    let focused = false;
    const frame = requestAnimationFrame(() => {
      focused = true;
      resumeHeadingRef.current?.focus({ preventScroll: true });
      resumeHeadingRef.current?.scrollIntoView({ block: "start" });
    });
    return () => {
      cancelAnimationFrame(frame);
      // StrictMode may replay mount effects before the frame has run.
      if (!focused) resumeAttention.current = previous;
    };
  }, [hasPendingPlan, busy]);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let fullHeight = window.innerHeight, width = window.innerWidth, frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (width !== window.innerWidth) { width = window.innerWidth; fullHeight = window.innerHeight; }
        fullHeight = Math.max(fullHeight, window.innerHeight);
        const active = document.activeElement;
        const editing = active instanceof HTMLInputElement && !["checkbox", "radio", "button"].includes(active.type);
        // A native host may resize its WKWebView while rotating with the
        // keyboard already open, leaving no unoccluded height baseline yet.
        const keyboard = editing && viewport.scale === 1
          && (viewport.height < fullHeight - 120 || viewport.height < 200);
        document.documentElement.toggleAttribute("data-plan-keyboard", keyboard);
        if (keyboard && active instanceof HTMLElement) {
          const rect = active.getBoundingClientRect();
          const actionHeight = document.querySelector(".plan-primary-actions")?.getBoundingClientRect().height ?? 0;
          // A landscape keyboard can leave less than 80px of web content. Keep
          // both bounds compatible with the input height instead of alternating
          // between an impossible top/bottom position on every viewport scroll.
          const edge = Math.min(16, Math.max(0, (viewport.height - rect.height - actionHeight) / 2));
          const visibleBottom = viewport.offsetTop + viewport.height - actionHeight - edge;
          const visibleTop = viewport.offsetTop + Math.min(80, Math.max(0, viewport.height - actionHeight - rect.height - edge));
          if (rect.bottom > visibleBottom + 1) window.scrollBy(0, Math.ceil(rect.bottom - visibleBottom));
          else if (rect.top < visibleTop - 1) window.scrollBy(0, Math.floor(rect.top - visibleTop));
        }
      });
    };
    viewport.addEventListener("resize", update); viewport.addEventListener("scroll", update);
    window.addEventListener("resize", update); document.addEventListener("focusin", update); document.addEventListener("focusout", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    for (const element of document.querySelectorAll(".plan-setup-content, .plan-primary-actions")) observer?.observe(element);
    update();
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", update); viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update); document.removeEventListener("focusin", update); document.removeEventListener("focusout", update);
      document.documentElement.removeAttribute("data-plan-keyboard");
    };
  }, []);
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
  const unavailableBalance = selectedRows.find(item => item.row.balanceUnavailable);
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
  const balancesValid = !unavailableBalance && !amountWithoutBalance && !exceedsBalance;
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
    if (unavailableBalance) return t("plan.validation.balanceUnavailable", { symbol: unavailableBalance.row.symbol });
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
          {row.balanceUnavailable ? t("plan.balance.unavailable") : row.walletBalance === null ? t("plan.balance.loading") : t("plan.balance.available", { amount: formatExactTokenAmount(row.walletBalance, row.decimals), symbol: row.symbol })}
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
    <h3 id="plan-risk-title">{t("plan.risk.title")}</h3>
    <ul className="plan-risk-points">
      <li>{t("plan.risk.audit")}</li>
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

  return <Card className={`plan-setup-card ${pendingPlan ? "" : "plan-setup-with-actions"}`}>
    {!pendingPlan && <ol className="plan-steps" aria-label={t("plan.steps.label")}>
      <li aria-current={!showReview ? "step" : undefined}><span aria-hidden="true">1</span>{t("plan.steps.details")}</li>
      <li aria-current={showReview ? "step" : undefined}><span aria-hidden="true">2</span>{t("plan.steps.review")}</li>
    </ol>}
    {!showReview && !pendingPlan && <CardHeader>
      <p className="plan-card-intro">{t("plan.intro")}</p>
    </CardHeader>}
    <CardContent className="plan-setup-content">
      {pendingPlan && <section className="plan-resume" aria-labelledby="plan-resume-title">
        <div>
          <h3 id="plan-resume-title" tabIndex={-1} ref={resumeHeadingRef}>{t("plan.pending.title")}</h3>
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

      {!showReview && !pendingPlan && <>
        {amountSection}
        <Button size="sm" variant="ghost" className="plan-balance-refresh" disabled={busy} onClick={onRefreshBalances}>{t("plan.balance.refresh")}</Button>
        {rows.length > 0 && rows.every(row => !row.balanceUnavailable && row.walletBalance === 0n) && <div className="plan-funding-note" role="status">
          <strong>{t("plan.balance.emptyTitle")}</strong><p>{t("plan.balance.emptyBody")}</p>
        </div>}

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
              : !heirSuspicious && <p className="plan-inline-error" role="alert">{t("plan.recipient.notFound")}</p>)}
          {heirSuspicious && <p className="plan-inline-error" role="alert">{t("plan.recipient.self")}</p>}
        </div>

        <div className="field-row">
          <label className="field-row-label" htmlFor="period-input">{t("plan.interval.label")}</label>
          <div className="field-row-controls">
            <Input id="period-input" type="text" inputMode="numeric" className="plan-period-input" value={period} placeholder="30"
              disabled={Boolean(pendingPlan) || busy} aria-describedby="plan-interval-help" onChange={event => { setReviewSnapshot(null); onPeriodChange(event.target.value); }} />
            <span className="field-suffix">{t("plan.interval.days")}</span>
          </div>
          <div className="period-presets" aria-label={t("plan.interval.suggested")}>
            {[30, 90, 180].map(days => <button key={days} type="button" className={`period-preset ${Number(period) === days ? "period-preset-selected" : ""}`}
              aria-pressed={Number(period) === days} disabled={Boolean(pendingPlan) || busy} onClick={() => { setReviewSnapshot(null); onPreset(days); }}>{days} {t("plan.interval.days")}</button>)}
          </div>
          {!intervalValid && <p className="plan-inline-error" role="alert">{t("plan.interval.invalid")}</p>}
          <p id="plan-interval-help" className="plan-field-help">{intervalValid
            ? t("plan.interval.example", { days: periodDays }) : t("plan.interval.help")}</p>
          <details className="plan-timing-help"><summary>{t("plan.review.missedTitle")}</summary>
            <p>{t("plan.review.missedBody")}</p>
          </details>
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
        </dl>
        <section className="plan-review-terms">
          <h4>{t("plan.review.feeRisk")}</h4>
          <p>{t(reviewSnapshot.assets.some(asset => asset.mode === "morpho") ? "plan.review.yieldFee" : "plan.review.basicFee")}</p>
          {reviewSnapshot.assets.some(asset => asset.mode === "morpho") && <>
            <h4>{t("plan.review.strategyFee")}</h4>
            {feeGroups(reviewSnapshot.assets.filter(asset => asset.mode === "morpho")).map(asset => <p key={asset.symbol}>{strategyFeeText(asset)}</p>)}
          </>}
          <h4>{t("plan.review.missedTitle")}</h4><p>{t("plan.review.missedBody")}</p>
        </section>
        {riskDisclosure}
      </section>}

      {alignmentReview}
      {pendingPlan && hasYieldRoute && riskDisclosure}

      {showReview && <p className="plan-legal-copy">{t("plan.legal")} <a href="/terms.html" aria-haspopup="dialog" onClick={event => { event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); setLegalDocument("terms"); }}>{t("plan.legal.terms")}</a> {t("plan.legal.join")} <a href="/privacy.html" aria-haspopup="dialog" onClick={event => { event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); setLegalDocument("privacy"); }}>{t("plan.legal.privacy")}</a>.</p>}
      {legalDocument && <PlanLegalDialog document={legalDocument} onClose={() => setLegalDocument(null)} />}
      {validationReason && pendingPlan && (selectedRows.length > 0 || trimmedHeir || !intervalValid)
        && <p className="plan-validation-message" role="status">{validationReason}</p>}

      {!pendingPlan && <div className="plan-primary-actions" ref={actionRef}>
      <p className="plan-action-hint" role="status">{validationReason || t(showReview ? "plan.action.confirmHint" : "plan.action.reviewHint")}</p>
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
      </div>}
    </CardContent>
  </Card>;
}
