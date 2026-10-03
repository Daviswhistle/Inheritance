import type { ReactNode } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { formatYieldAmount } from "@/yield";
import { formatPlanInterval, parseAssetAmount } from "@/plan";

type PlanAsset = "WLD" | "USDC";
type PlanRouteRow = { symbol: PlanAsset; decimals: number; mode: "morpho" | "plain"; amount: string; walletBalance: bigint | null };
type PlanAssetProgress = { symbol: PlanAsset; amount: string; decimals: number; mode: "morpho" | "plain"; depositState: "ready" | "submitting" | "submitted" | "complete" };
type PlanProgress = { heir: string; periodDays: number; createState: "ready" | "submitting" | "submitted" | "complete"; assets: PlanAssetProgress[];
  alignment?: { state: "submitting" | "submitted" } };
type AlignmentConflict = { symbol: PlanAsset; address: string; currentHeir: string; currentPeriodSeconds: bigint; requestedHeir: string; requestedPeriod: number };

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
  const hasYieldRoute = rows.some(row => row.mode === "morpho");
  const assetNames = rows.map(row => row.symbol).join(" and ");
  const amountStatus = (state: PlanAssetProgress["depositState"]) => ({
    ready: "Still to deposit", submitting: "Wallet request pending", submitted: "Verifying transaction", complete: "Verified",
  })[state];

  return <Card className="plan-setup-card">
    <CardHeader>
      <span className="eyebrow">One inheritance plan</span>
      <CardTitle>Choose your person and amounts</CardTitle>
      <p className="plan-card-intro">The app keeps {assetNames} in separate vaults and gives them the same heir and check-in interval.</p>
    </CardHeader>
    <CardContent className="grid gap-4">
      {pendingPlan && <section className="plan-resume" aria-labelledby="plan-resume-title">
        <div>
          <h3 id="plan-resume-title">Finish your saved plan</h3>
          <p>Completed assets stay in place. Resume only the unfinished work.</p>
          {(pendingPlan.createState === "submitting" || pendingPlan.createState === "submitted")
            && <p role="status">Checking the earlier vault request before continuing. No duplicate request will be sent.</p>}
          {pendingPlan.alignment && <p role="status">Checking the earlier settings request. Editing and new requests remain paused until its result is verified.</p>}
        </div>
        <dl className="plan-progress-list">
          {pendingPlan.assets.map(asset => <div key={asset.symbol}>
            <dt>{asset.symbol} · {formatYieldAmount(BigInt(asset.amount), asset.decimals)} {asset.symbol}</dt>
            <dd>{amountStatus(asset.depositState)}</dd>
          </div>)}
        </dl>
        <p className="text-xs text-gray-600">Heir {pendingPlan.heir.slice(0, 6)}…{pendingPlan.heir.slice(-4)} · {pendingPlan.periodDays} days</p>
        <Button variant="primary" disabled={busy || resumeDisabled} onClick={onResume}>
          {busy ? <><span className="spinner" />Resuming plan…</> : "Resume remaining setup"}
        </Button>
        {canEditRemaining && <>
          <Button disabled={busy} onClick={onEditRemaining}>Edit remaining setup</Button>
          <p className="text-xs text-gray-600">Clears only unsent setup. Completed deposits and existing vaults stay in place.</p>
        </>}
      </section>}

      {alignmentConflicts.length > 0 && <section className="plan-review" aria-labelledby="plan-review-title">
        <h3 id="plan-review-title">Review settings before continuing</h3>
        <p>These active vaults have different settings. Confirming updates their heir or check-in interval; it does not move funds.</p>
        {alignmentConflicts.some(conflict => conflict.currentPeriodSeconds !== BigInt(conflict.requestedPeriod) * 86400n)
          && <p>Changing an interval also checks in to that vault in the same transaction. Its new timer starts from that check-in, so a shorter interval cannot immediately expire your existing funds.</p>}
        <ul>
          {alignmentConflicts.map(conflict => <li key={conflict.address}>
            <strong>{conflict.symbol}</strong> · {conflict.address.slice(0, 6)}…{conflict.address.slice(-4)}: {conflict.currentHeir.slice(0, 6)}…{conflict.currentHeir.slice(-4)}, {formatPlanInterval(conflict.currentPeriodSeconds)}
            <span aria-hidden="true"> → </span>
            {conflict.requestedHeir.slice(0, 6)}…{conflict.requestedHeir.slice(-4)}, {conflict.requestedPeriod} days
            {conflict.currentPeriodSeconds !== BigInt(conflict.requestedPeriod) * 86400n
              && <span> · Check in and reset timer</span>}
          </li>)}
        </ul>
        <div className="flex gap-2 flex-wrap">
          <Button variant="primary" disabled={busy} onClick={onConfirmAlignment}>Confirm and align settings</Button>
          <Button disabled={busy} onClick={onCancelAlignment}>Keep existing settings</Button>
        </div>
      </section>}

      <div className="field-row">
        <label className="field-row-label" htmlFor="heir-input">Heir</label>
        <div className="field-row-controls">
          <Input id="heir-input" placeholder="@username or wallet address" value={heir} disabled={Boolean(pendingPlan) || busy}
            onChange={event => onHeirChange(event.target.value)} aria-describedby="heir-help" />
          <Button disabled={busy || Boolean(pendingPlan) || shareBusy} onClick={onPickHeir} title="Choose from World App contacts">
            {shareBusy ? "Opening…" : "Choose contact"}
          </Button>
        </div>
        <p id="heir-help" className="text-xs text-gray-600">Enter a World App username or the heir’s wallet address.</p>
        {heir && (resolvingHeir ? <p className="text-xs text-gray-600" role="status">Checking this person…</p>
          : heirResolved ? <p className="resolved-heir">{heirUsername ? `@${heirUsername}` : "Wallet address"}<span>{heirResolved.slice(0, 6)}…{heirResolved.slice(-4)}</span></p>
            : <p className="text-xs text-red-700" role="alert">No matching World App user or wallet address was found.</p>)}
        {heirSuspicious && <p className="text-xs text-yellow-800" role="alert">This is your own wallet. Inheritance stays cancelled while your own address is the heir.</p>}
      </div>

      <div className="field-row">
        <label className="field-row-label" htmlFor="period-input">Check-in interval</label>
        <div className="field-row-controls">
          <Input id="period-input" type="text" inputMode="numeric" className="plan-period-input" value={period} placeholder="30"
            disabled={Boolean(pendingPlan) || busy} onChange={event => onPeriodChange(event.target.value)} />
          <span className="field-suffix">days</span>
        </div>
        <div className="period-presets" aria-label="Suggested check-in intervals">
          {[30, 90, 180].map(days => <button key={days} type="button" className={`period-preset ${Number(period) === days ? "period-preset-selected" : ""}`}
            aria-pressed={Number(period) === days} disabled={Boolean(pendingPlan) || busy} onClick={() => onPreset(days)}>{days} days</button>)}
        </div>
        {!periodValid && <p className="text-xs text-red-700" role="alert">Choose an interval from 1 to 365 days.</p>}
      </div>

      <fieldset className="plan-assets" disabled={Boolean(pendingPlan) || busy}>
        <legend>Amounts to place in your plan</legend>
        {rows.map(row => <div className="plan-asset-row" key={row.symbol}>
          <div className="plan-asset-heading">
            <label htmlFor={`plan-${row.symbol.toLowerCase()}`}>{row.symbol}</label>
            <span>{row.mode === "morpho" ? "Morpho yield" : "Basic vault"}</span>
          </div>
          <div className="plan-amount-control">
            <Input id={`plan-${row.symbol.toLowerCase()}`} inputMode="decimal" placeholder="0" value={row.amount}
              onChange={event => onAmountChange(row.symbol, event.target.value)} aria-describedby={`plan-${row.symbol.toLowerCase()}-available`} />
            <strong>{row.symbol}</strong>
          </div>
          <p id={`plan-${row.symbol.toLowerCase()}-available`} className="text-xs text-gray-600">
            {row.walletBalance === null ? "Wallet balance is loading" : `Available: ${formatYieldAmount(row.walletBalance, row.decimals)} ${row.symbol}`}
          </p>
          {row.walletBalance !== null && (parseAssetAmount(row.amount, row.decimals) ?? 0n) > row.walletBalance
            && <p className="text-xs text-red-700" role="alert">This amount exceeds your available {row.symbol}.</p>}
        </div>)}
        <p className="text-xs text-gray-600">Enter at least one amount above zero. Each selected asset is created if needed and deposited in its own vault. WLD and USDC are never converted.</p>
      </fieldset>

      {hasYieldRoute && <section className="plan-risk" aria-labelledby="plan-risk-title">
        <h3 id="plan-risk-title">Morpho yield and risk</h3>
        <p>A 10% service fee applies to realized positive gains when you collect income or withdraw principal. Morpho’s own fees are deducted first; losses are recovered before a later fee. No fee is charged on principal.</p>
        <p>Values can fall. Cash withdrawals depend on Morpho liquidity; receipt shares may be delivered if cash is unavailable. Rates and campaign rewards vary, and no verified-human boost is assumed.</p>
        <p>If you miss a check-in, funds do not move automatically. Your heir must file a claim and wait through a seven-day review. You can renew until a transfer executes.</p>
        <a href="/yield-terms.html" target="_blank" rel="noreferrer">Read yield terms</a>
        <label className="yield-consent"><input id="yield-consent" type="checkbox" checked={yieldConsent} disabled={busy} onChange={event => onYieldConsent(event.target.checked)} />
          <span>I understand the fee, loss risk and liquidity limits.</span>
        </label>
      </section>}

      {reminderNote}

      <p className="text-xs text-gray-600">Creating a plan means you accept the <a href="/terms.html" className="underline">Terms</a> and <a href="/privacy.html" className="underline">Privacy Policy</a>.</p>
      <Button variant="primary" size="lg" className="plan-submit" disabled={busy || Boolean(pendingPlan) || createDisabled} onClick={onCreate}>
        {busy ? <><span className="spinner" />Setting up your plan…</> : "Create plan and deposit"}
      </Button>
    </CardContent>
  </Card>;
}
