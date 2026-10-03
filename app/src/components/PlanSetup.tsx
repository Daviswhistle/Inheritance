import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { formatPlanInterval, parseAssetAmount } from "@/plan";
import "./PlanSetup.css";

type PlanAsset = "WLD" | "USDC";
type PlanRouteRow = { symbol: PlanAsset; decimals: number; mode: "morpho" | "plain"; amount: string; walletBalance: bigint | null };
type PlanAssetProgress = { symbol: PlanAsset; amount: string; decimals: number; mode: "morpho" | "plain"; depositState: "ready" | "submitting" | "submitted" | "complete" };
type PlanProgress = { heir: string; periodDays: number; createState: "ready" | "submitting" | "submitted" | "complete"; assets: PlanAssetProgress[];
  alignment?: { state: "submitting" | "submitted" } };
type AlignmentConflict = { symbol: PlanAsset; address: string; currentHeir: string; currentPeriodSeconds: bigint; requestedHeir: string; requestedPeriod: number };
type ReviewAsset = { symbol: PlanAsset; amount: string; decimals: number; mode: "morpho" | "plain" };
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
  busy, createDisabled, resumeDisabled, canEditRemaining, onEditRemaining, reminderNote,
}: {
  rows: PlanRouteRow[];
  reminderNote?: ReactNode;
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
  onCreate: () => void;
  onResume: () => void;
  canEditRemaining: boolean;
  onEditRemaining: () => void;
  busy: boolean;
  createDisabled: boolean;
  resumeDisabled: boolean;
}) {
  const [reviewSnapshot, setReviewSnapshot] = useState<ReviewSnapshot | null>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const wasReviewingRef = useRef(false);
  const createClickLocked = useRef(false);
  const hasYieldRoute = rows.some(row => row.mode === "morpho");

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
  const formValid = !invalidAmountRow && hasSelectedAsset && balancesValid && recipientValid && intervalValid && consentValid;

  const currentFingerprint = JSON.stringify({
    amounts: rows.map(row => [row.symbol, row.amount, row.decimals, row.mode]),
    heir,
    heirResolved,
    heirUsername,
    heirSuspicious,
    period,
    yieldConsent,
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

  const amountStatus = (state: PlanAssetProgress["depositState"]) => ({
    ready: "Still to deposit", submitting: "Wallet request pending", submitted: "Verifying transaction", complete: "Verified",
  })[state];

  const validationReason = (() => {
    if (pendingPlan) return "Finish the saved plan above before starting another plan.";
    if (invalidAmountRow) return `${invalidAmountRow.row.symbol} amount must be a non-negative number with up to ${invalidAmountRow.row.decimals} decimal places.`;
    if (!hasSelectedAsset) return "Enter an amount above zero for WLD or USDC.";
    if (amountWithoutBalance) return `Wait for your ${amountWithoutBalance.row.symbol} balance to finish loading.`;
    if (exceedsBalance) return `Lower the ${exceedsBalance.row.symbol} amount to your available balance.`;
    if (!trimmedHeir) return "Choose who should receive your plan.";
    if (resolvingHeir) return "Wait while we check the recipient.";
    if (heirSuspicious) return "Choose another wallet; your own wallet cannot be the recipient.";
    if (resolvedIsZero) return "Choose a recipient other than the zero address.";
    if (!recipientValid) return "Choose a contact or enter a username or address we can verify.";
    if (!intervalValid) return "Choose a check-in interval from 1 to 365 whole days.";
    if (!consentValid) return "Check the box to accept the yield fee and risk terms.";
    if (alignmentConflicts.length > 0) return "Review the existing settings above before continuing.";
    if (createDisabled) return "The app is still checking a wallet or plan requirement. Wait for it to finish, then review again.";
    return "";
  })();

  const startReview = () => {
    if (!canReview) return;
    const assets = selectedRows.map(item => ({
      symbol: item.row.symbol,
      amount: (item.amount as bigint).toString(),
      decimals: item.row.decimals,
      mode: item.row.mode,
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
    if (!reviewSnapshot || !showReview || !formValid || busy || pendingPlan || createDisabled || alignmentConflicts.length > 0 || createClickLocked.current) return;
    createClickLocked.current = true;
    try {
      onCreate();
    } catch (error) {
      createClickLocked.current = false;
      throw error;
    }
  };

  const amountSection = <fieldset className="plan-assets" disabled={Boolean(pendingPlan) || busy} aria-labelledby="plan-assets-title">
    <legend id="plan-assets-title">Amounts to add</legend>
    {rows.map(row => {
      const rowError = parseAssetAmount(row.amount.trim() || "0", row.decimals) === null;
      const rowOverBalance = row.walletBalance !== null && (parseAssetAmount(row.amount, row.decimals) ?? 0n) > row.walletBalance;
      const inputId = `plan-${row.symbol.toLowerCase()}`;
      const balanceId = `${inputId}-available`;
      const errorId = `${inputId}-error`;
      return <div className="plan-asset-row" key={row.symbol}>
        <div className="plan-asset-heading">
          <label htmlFor={inputId}>{row.symbol}</label>
          <span>{row.mode === "morpho" ? "Yield" : "Basic"}</span>
        </div>
        <div className="plan-amount-control">
          <Input id={inputId} inputMode="decimal" placeholder="0" value={row.amount}
            aria-invalid={rowError || rowOverBalance}
            aria-describedby={`${balanceId}${rowError || rowOverBalance ? ` ${errorId}` : ""}`}
            onChange={event => { setReviewSnapshot(null); onAmountChange(row.symbol, event.target.value); }} />
          <strong>{row.symbol}</strong>
        </div>
        <p id={balanceId} className="plan-asset-balance">
          {row.walletBalance === null ? "Wallet balance is loading" : `Available: ${formatExactTokenAmount(row.walletBalance, row.decimals)} ${row.symbol}`}
        </p>
        {rowError && <p id={errorId} className="plan-inline-error" role="alert">Use a non-negative amount with up to {row.decimals} decimal places.</p>}
        {!rowError && rowOverBalance && <p id={errorId} className="plan-inline-error" role="alert">This amount is above your available balance.</p>}
      </div>;
    })}
  </fieldset>;

  const riskDisclosure = <section className="plan-risk" aria-labelledby="plan-risk-title">
    <h3 id="plan-risk-title">Before you continue</h3>
    <ul className="plan-risk-points">
      <li>{hasYieldRoute ? "10% of realized profits after costs and recovered losses. Never charged on principal." : "No platform fee on your selected basic asset. Token values can change."}</li>
      {hasYieldRoute && <li>Invested funds can lose value. Cash withdrawals depend on liquidity.</li>}
      <li>A missed check-in does not pay automatically. Your heir must claim and wait seven days; you can renew before payment.</li>
    </ul>
    {hasYieldRoute && <label className="yield-consent"><input id="yield-consent" type="checkbox" checked={yieldConsent} disabled={busy}
      onChange={event => { setReviewSnapshot(null); onYieldConsent(event.target.checked); }} />
      <span>I understand the yield fee, loss and liquidity risks.</span>
    </label>}
    <details className="plan-more-details">
      <summary>More about deposits and yield</summary>
      <div>
        <p>WLD and USDC stay in their own assets and are never converted. You can add either one or both.</p>
        <p>Yield rates and rewards vary. A yield vault may not have enough cash for an immediate withdrawal; you may receive vault shares instead. The app does not assume a verified-human boost.</p>
        <a href="/yield-terms.html" target="_blank" rel="noreferrer">Read yield terms</a>
      </div>
    </details>
  </section>;

  const alignmentReview = alignmentConflicts.length > 0 && <section className="plan-review plan-alignment-review" aria-labelledby="plan-alignment-title">
    <h3 id="plan-alignment-title">Review existing settings</h3>
    <p>Some assets already have different settings. Confirming updates their recipient or check-in interval; it does not move funds.</p>
    {alignmentConflicts.some(conflict => conflict.currentPeriodSeconds !== BigInt(conflict.requestedPeriod) * 86400n)
      && <p>Changing an interval also checks in to that asset and starts its new timer from then. A shorter interval cannot immediately expire those funds.</p>}
    <ul>
      {alignmentConflicts.map(conflict => <li key={conflict.address}>
        <strong>{conflict.symbol}</strong> · {conflict.address.slice(0, 6)}…{conflict.address.slice(-4)}: {conflict.currentHeir.slice(0, 6)}…{conflict.currentHeir.slice(-4)}, {formatPlanInterval(conflict.currentPeriodSeconds)}
        <span aria-hidden="true"> → </span>
        {conflict.requestedHeir.slice(0, 6)}…{conflict.requestedHeir.slice(-4)}, {conflict.requestedPeriod} days
        {conflict.currentPeriodSeconds !== BigInt(conflict.requestedPeriod) * 86400n && <span> · Check in and reset timer</span>}
      </li>)}
    </ul>
    <div className="plan-action-row">
      <Button variant="primary" disabled={busy} onClick={onConfirmAlignment}>Confirm and align settings</Button>
      <Button disabled={busy} onClick={onCancelAlignment}>Keep existing settings</Button>
    </div>
  </section>;

  return <Card className="plan-setup-card">
    <CardHeader>
      <span className="eyebrow">One inheritance plan</span>
      <CardTitle>Set up your plan</CardTitle>
      <p className="plan-card-intro">Choose what to add, who should receive it and how often you check in.</p>
    </CardHeader>
    <CardContent className="plan-setup-content">
      {pendingPlan && <section className="plan-resume" aria-labelledby="plan-resume-title">
        <div>
          <h3 id="plan-resume-title">Finish your saved plan</h3>
          <p>Completed assets stay in place. Resume only the unfinished work.</p>
          {(pendingPlan.createState === "submitting" || pendingPlan.createState === "submitted")
            && <p role="status">Checking the earlier request before continuing. No duplicate request will be sent.</p>}
          {pendingPlan.alignment && <p role="status">Checking the earlier settings request. Editing and new requests remain paused until its result is verified.</p>}
        </div>
        <dl className="plan-progress-list">
          {pendingPlan.assets.map(asset => <div key={asset.symbol}>
            <dt>{asset.symbol} · {formatExactTokenAmount(BigInt(asset.amount), asset.decimals)} {asset.symbol}</dt>
            <dd>{amountStatus(asset.depositState)}</dd>
          </div>)}
        </dl>
        <p className="plan-pending-settings">Recipient {pendingPlan.heir.slice(0, 6)}…{pendingPlan.heir.slice(-4)} · Check in every {pendingPlan.periodDays} days</p>
        <Button variant="primary" disabled={busy || resumeDisabled} onClick={onResume}>
          {busy ? <><span className="spinner" />Resuming plan…</> : "Resume remaining setup"}
        </Button>
        {canEditRemaining && <>
          <Button disabled={busy} onClick={onEditRemaining}>Edit remaining setup</Button>
          <p className="plan-pending-settings">Only work that has not been sent is cleared. Completed deposits and existing assets stay in place.</p>
        </>}
      </section>}

      {!showReview && <>
        {amountSection}

        <div className="field-row">
          <label className="field-row-label" htmlFor="heir-input">Who should receive it?</label>
          <div className="field-row-controls plan-recipient-controls">
            <Input id="heir-input" placeholder="@username or wallet address" value={heir} disabled={Boolean(pendingPlan) || busy}
              onChange={event => { setReviewSnapshot(null); onHeirChange(event.target.value); }} aria-describedby="heir-help" />
            <Button disabled={busy || Boolean(pendingPlan) || shareBusy} onClick={() => { setReviewSnapshot(null); onPickHeir(); }} title="Choose from World App contacts">
              {shareBusy ? "Opening…" : "Choose contact"}
            </Button>
          </div>
          <p id="heir-help" className="plan-field-help">Enter a World App username or wallet address, or choose a contact.</p>
          {heir && (resolvingHeir ? <p className="plan-field-help" role="status">Checking this person…</p>
            : recipientValid ? <p className="resolved-heir">{heirUsername ? `@${heirUsername}` : "Wallet address"}<span>{heirResolved.slice(0, 6)}…{heirResolved.slice(-4)}</span></p>
              : <p className="plan-inline-error" role="alert">No matching recipient was found. Check the username or address.</p>)}
          {heirSuspicious && <p className="plan-inline-error" role="alert">Your own wallet cannot be the recipient.</p>}
        </div>

        <div className="field-row">
          <label className="field-row-label" htmlFor="period-input">Check-in interval</label>
          <div className="field-row-controls">
            <Input id="period-input" type="text" inputMode="numeric" className="plan-period-input" value={period} placeholder="30"
              disabled={Boolean(pendingPlan) || busy} onChange={event => { setReviewSnapshot(null); onPeriodChange(event.target.value); }} />
            <span className="field-suffix">days</span>
          </div>
          <div className="period-presets" aria-label="Suggested check-in intervals">
            {[30, 90, 180].map(days => <button key={days} type="button" className={`period-preset ${Number(period) === days ? "period-preset-selected" : ""}`}
              aria-pressed={Number(period) === days} disabled={Boolean(pendingPlan) || busy} onClick={() => { setReviewSnapshot(null); onPreset(days); }}>{days} days</button>)}
          </div>
          {!intervalValid && <p className="plan-inline-error" role="alert">Choose an interval from 1 to 365 whole days.</p>}
        </div>
      </>}

      {showReview && reviewSnapshot && <section className="plan-review plan-final-review" aria-labelledby="plan-review-title">
        <h3 id="plan-review-title" tabIndex={-1} ref={reviewHeadingRef}>Review before opening your wallet</h3>
        <dl className="plan-review-list">
          <div>
            <dt>Amounts</dt>
            <dd>{reviewSnapshot.assets.map(asset => <span className="plan-review-amount" key={asset.symbol}>
              {formatExactTokenAmount(BigInt(asset.amount), asset.decimals)} {asset.symbol}
            </span>)}</dd>
          </div>
          <div>
            <dt>Recipient</dt>
            <dd>
              {reviewSnapshot.heirUsername && <strong>@{reviewSnapshot.heirUsername.replace(/^@/, "")}</strong>}
              <span className="plan-review-address">{reviewSnapshot.heirAddress}</span>
            </dd>
          </div>
          <div><dt>Check-in</dt><dd>Every {reviewSnapshot.periodDays} days</dd></div>
          <div>
            <dt>Fee and risk</dt>
            <dd>
              {reviewSnapshot.assets.some(asset => asset.mode === "morpho")
                ? "10% of realized profits after loss recovery, never principal. Review the risks below."
                : "No platform fee on this basic asset. Review the risks below."}
            </dd>
          </div>
          <div><dt>If you miss a check-in</dt><dd>Your heir must claim and wait seven days. You can renew before the transfer executes.</dd></div>
        </dl>
      </section>}

      {alignmentReview}
      {riskDisclosure}

      {reminderNote && <details className="plan-reminder-details">
        <summary>Optional check-in reminders</summary>
        {reminderNote}
      </details>}

      <p className="plan-legal-copy">Creating a plan means you accept the <a href="/terms.html">Terms</a> and <a href="/privacy.html">Privacy Policy</a>.</p>
      {validationReason && <p className="plan-validation-message" role={formValid && createDisabled ? "status" : "alert"}>{validationReason}</p>}

      {showReview
        ? <div className="plan-step-actions">
          <Button variant="primary" size="lg" className="plan-submit" disabled={busy || Boolean(pendingPlan) || createDisabled || !formValid || alignmentConflicts.length > 0} onClick={confirmPlan}>
            {busy ? <><span className="spinner" />Setting up your plan…</> : "Confirm and deposit"}
          </Button>
          <Button disabled={busy || Boolean(pendingPlan)} onClick={editPlan}>Edit plan</Button>
        </div>
        : <Button variant="primary" size="lg" className="plan-submit" disabled={busy || Boolean(pendingPlan) || !canReview} onClick={startReview}>
          {busy ? <><span className="spinner" />Checking your plan…</> : pendingPlan ? "Plan already in progress" : "Review plan"}
        </Button>}
    </CardContent>
  </Card>;
}
