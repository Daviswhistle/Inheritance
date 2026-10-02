import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import type { YieldPosition, YieldTerms } from "@/yield";
import type { WldRewards } from "@/rewards";
import { EXPLORER, MORPHO_VAULT_ADDRESS } from "@/config";
import { formatYieldAmount } from "@/yield";
import { formatRate, RATE_MAX_AGE_SECONDS } from "@/yield-rates";
import type { YieldRates } from "@/yield-rates";

function YieldRateSummary({ rates, loading }: { rates: YieldRates | null; loading: boolean }) {
  const now = Math.floor(Date.now() / 1000);
  const fresh = rates && now - rates.reportedAt <= RATE_MAX_AGE_SECONDS && rates.campaignEndsAt > now;
  return <div className="yield-rate-summary">
    <strong>Indicative annual rates</strong>
    {fresh ? <>
      <dl className="yield-values">
        <div><dt>Lending APR</dt><dd>{formatRate(rates.lendingApr)}</dd></div>
        <div><dt>General WLD rewards APR</dt><dd>{formatRate(rates.rewardApr)}</dd></div>
      </dl>
      <p className="text-xs text-gray-600">Reported {new Date(rates.reportedAt * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} (UTC). Rewards currently scheduled through {new Date(rates.campaignEndsAt * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}.</p>
    </> : <p role="status">{loading ? "Checking current rates…" : "Current rates are unavailable. Rewards and returns can change."}</p>}
    <p className="text-xs text-gray-600">Shown before our exit fee. Campaign eligibility varies; World App’s verified-human boost is excluded. These are reported rates, not a forecast of your earnings.</p>
    <a className="text-blue-600 underline text-xs" href={`https://app.merkl.xyz/opportunities/world-chain/MORPHOVAULT/${MORPHO_VAULT_ADDRESS}`} target="_blank" rel="noreferrer">View rate and reward source ↗</a>
  </div>;
}

export function YieldChoice({ kind, terms, rates, ratesLoading, consent, busy, onKind, onConsent }: {
  kind: "plain" | "yield"; terms: YieldTerms | null; consent: boolean; busy: boolean;
  rates: YieldRates | null; ratesLoading: boolean;
  onKind: (kind: "plain" | "yield") => void; onConsent: (value: boolean) => void;
}) {
  return <div className="yield-choice">
    <fieldset disabled={busy}><legend>How your vault holds WLD</legend>
      <label className={`yield-option ${kind === "plain" ? "yield-selected" : ""}`}>
        <input type="radio" name="vault-kind" value="plain" checked={kind === "plain"} onChange={() => onKind("plain")} />
        <span><strong>Keep WLD</strong><small>No platform fee. WLD stays in your personal vault.</small></span>
      </label>
      <label className={`yield-option ${kind === "yield" ? "yield-selected" : ""}`}>
        <input type="radio" name="vault-kind" value="yield" checked={kind === "yield"} disabled={!terms} onChange={() => onKind("yield")} />
        <span><strong>Earn with Morpho</strong><small>{terms ? `${terms.feeBps / 100}% of positive net gains, including claimed WLD rewards, on exit. No principal or management fee.` : "Checking the yield vault’s terms…"}</small></span>
      </label>
    </fieldset>
    {kind === "yield" && <div className="yield-disclosure">
      <YieldRateSummary rates={rates} loading={ratesLoading} />
      <p>WLD is supplied to Re7 WLD on Morpho. Its current performance fee is {terms?.underlyingFeePercent}% and can change; our fee applies after that cost. Returns vary and funds can lose value.</p>
      <p>Cash withdrawals depend on liquidity. If cash cannot be redeemed at inheritance, the heir receives receipt shares and any idle WLD. A positive-gain fee is then paid in shares, based on their quoted WLD value.</p>
      <p>Available WLD campaign rewards can be claimed and reinvested. Rewards and rates vary. This contract does not automatically qualify for World App’s verified-human boost. Existing vaults stay separate; moving funds requires your wallet approval.</p>
      <a href="/yield-terms.html" target="_blank" rel="noreferrer">Read yield terms ↗</a>
      {terms && <p><a href={`${EXPLORER}/address/${terms.recipient}`} target="_blank" rel="noreferrer">View service fee recipient ↗</a></p>}
      <label className="yield-consent"><input id="yield-consent" type="checkbox" checked={consent} disabled={busy} onChange={e => onConsent(e.target.checked)} /><span>I accept the fee, loss risk and possible receipt-share inheritance.</span></label>
    </div>}
  </div>;
}

export function YieldRewardsCard({ data, error, loading, settled, recipient, received, busy, canClaim, onClaim, onProcess, onRefresh }: {
  data: WldRewards | null; error: string; loading: boolean; settled: boolean; recipient: string;
  received: bigint | null; busy: boolean; canClaim: boolean; onClaim: () => void; onProcess: () => void; onRefresh: () => void;
}) {
  return <Card><CardHeader><CardTitle>WLD campaign rewards</CardTitle></CardHeader>
    <CardContent className="grid gap-3">
      {loading && <p role="status">Checking rewards for this vault…</p>}
      {error && <p role="status" className="text-xs text-yellow-800">{error} Your vault withdrawals and inheritance remain available.</p>}
      {data && <dl className="yield-values">
        <div><dt>Ready to claim</dt><dd>{formatYieldAmount(data.claimable)} WLD</dd></div>
        <div><dt>Awaiting reward publication</dt><dd>{formatYieldAmount(data.pending)} WLD</dd></div>
      </dl>}
      {received !== null && <dl className="yield-values"><div><dt>Received WLD awaiting processing</dt><dd>{formatYieldAmount(received)} WLD</dd></div></dl>}
      {settled ? <p className="text-xs text-gray-600">Late rewards go to the fixed inheritance recipient after the net-gain fee, including loss recovery. Anyone can relay the claim; the caller cannot change its recipient.</p>
        : <p className="text-xs text-gray-600">Claimed WLD is reinvested without increasing your deposited principal or resetting your timer. Its net gain is included in the exit fee. Pending rewards cannot be claimed yet.</p>}
      {settled && recipient && <a className="text-blue-600 underline text-xs" href={`${EXPLORER}/address/${recipient}`} target="_blank" rel="noreferrer">View inheritance recipient ↗</a>}
      <p className="text-xs text-gray-600">Eligibility and rewards vary by campaign. World App’s verified-human boost is not automatic for this vault.</p>
      {data && data.claimable > 0n && <Button disabled={busy || loading || Boolean(error) || !canClaim} onClick={onClaim}>
        {settled ? "Claim remaining inheritance rewards" : "Claim and reinvest WLD rewards"}
      </Button>}
      {received !== null && received > 0n && <Button disabled={busy || !canClaim} onClick={onProcess}>
        {settled ? "Receive remaining WLD rewards" : "Reinvest received WLD rewards"}
      </Button>}
      <Button disabled={busy || loading} onClick={onRefresh}>Refresh rewards</Button>
    </CardContent></Card>;
}

export function YieldPositionCard({ position, holdings, terms, rates, ratesLoading, canExit, busy, onExit }: {
  position: YieldPosition | null; holdings: { idle: bigint; shares: bigint } | null;
  terms: YieldTerms | null; canExit: boolean; busy: boolean; onExit: () => void;
  rates: YieldRates | null; ratesLoading: boolean;
}) {
  const fmt = formatYieldAmount;
  return <Card><CardHeader><CardTitle>Morpho yield position</CardTitle></CardHeader>
    <CardContent className="grid gap-3">
      <YieldRateSummary rates={rates} loading={ratesLoading} />
      {!position ? <p role="status">Value and cash liquidity are unavailable. Receipt shares can still be moved without a valuation.</p> : <>
        <div className="stat-row"><div className="stat yield-stat"><div className="stat-label">Estimated value after service fee</div><div className="stat-value">{position.valued ? `${fmt(position.net)} WLD` : "Value unavailable"}</div></div></div>
        <dl className="yield-values">
          <div><dt>Cash liquidity before service fee</dt><dd>{fmt(position.liquid)} WLD</dd></div>
          <div><dt>Estimated service fee for full exit</dt><dd>{position.valued ? `${fmt(position.fee)} WLD` : "Quote unavailable"}</dd></div>
        </dl>
        <p className="text-xs text-gray-600">{terms ? `${terms.feeBps / 100}%` : "A fixed share"} of positive net gains is charged when exiting, after the underlying vault’s fees. Loss recovery is not charged. This estimate can change and does not guarantee cash availability.</p>
      </>}
      {holdings ? <dl className="yield-values">
        <div><dt>Receipt shares held</dt><dd>{fmt(holdings.shares)}</dd></div>
        <div><dt>Idle WLD</dt><dd>{fmt(holdings.idle)} WLD</dd></div>
      </dl> : <p role="status">Checking receipt shares and idle WLD…</p>}
      {canExit && holdings && holdings.shares > 0n && <Button onClick={onExit} disabled={busy}>Move all receipt shares to my wallet</Button>}
      {canExit && <p className="text-xs text-gray-600">Moving shares works without cash liquidity and pays any positive-gain fee in shares. It does not cancel inheritance or move idle WLD.</p>}
      <a className="text-blue-600 underline text-xs" href={`${EXPLORER}/address/${MORPHO_VAULT_ADDRESS}`} target="_blank" rel="noreferrer">View underlying vault ↗</a>
    </CardContent></Card>;
}
