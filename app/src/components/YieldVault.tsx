import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import type { YieldPosition, YieldTerms } from "@/yield";
import type { WldRewards } from "@/rewards";
import { EXPLORER, MORPHO_VAULT_ADDRESS } from "@/config";
import { formatYieldAmount } from "@/yield";
import { formatRate, RATE_MAX_AGE_SECONDS } from "@/yield-rates";
import type { YieldRates } from "@/yield-rates";
import type { YieldRoute } from "@/assets";
import { useLocale } from "@/locale-context";

function YieldRateSummary({ rates, loading, strategy = MORPHO_VAULT_ADDRESS }: { rates: YieldRates | null; loading: boolean; strategy?: string }) {
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
    <a className="text-blue-600 underline text-xs" href={`https://app.merkl.xyz/opportunities/world-chain/MORPHOVAULT/${strategy}`} target="_blank" rel="noreferrer">View rate and reward source ↗</a>
  </div>;
}

export function YieldChoice({ kind, terms, rates, ratesLoading, consent, busy, onKind, onConsent, route }: {
  kind: "plain" | "yield"; terms: YieldTerms | null; consent: boolean; busy: boolean;
  rates: YieldRates | null; ratesLoading: boolean;
  onKind: (kind: "plain" | "yield") => void; onConsent: (value: boolean) => void;
  route?: YieldRoute;
}) {
  const symbol = route?.symbol ?? "WLD", usdc = symbol === "USDC";
  return <div className="yield-choice">
    <fieldset disabled={busy}><legend>How your vault holds {symbol}</legend>
      {!usdc && <label className={`yield-option ${kind === "plain" ? "yield-selected" : ""}`}>
        <input type="radio" name="vault-kind" value="plain" checked={kind === "plain"} onChange={() => onKind("plain")} />
        <span><strong>Keep WLD</strong><small>No platform fee. WLD stays in your personal vault.</small></span>
      </label>}
      <label className={`yield-option ${kind === "yield" ? "yield-selected" : ""}`}>
        <input type="radio" name="vault-kind" value="yield" checked={kind === "yield"} disabled={!terms} onChange={() => onKind("yield")} />
        <span><strong>Earn with Morpho</strong><small>{terms ? `${terms.feeBps / 100}% of positive net gains, including claimed WLD rewards, on exit. No principal or management fee.` : "Checking the yield vault’s terms…"}</small></span>
      </label>
    </fieldset>
    {kind === "yield" && <div className="yield-disclosure">
      <YieldRateSummary rates={rates} loading={ratesLoading} strategy={route?.strategy} />
      <p>{symbol} is supplied to Re7 {symbol} on Morpho. Its current performance fee is {terms?.underlyingFeePercent}% and can change; our fee applies after that cost. Returns vary and funds can lose value.</p>
      <p>Cash withdrawals depend on liquidity. If cash cannot be redeemed at inheritance, the heir receives receipt shares and any idle {symbol}. A positive-gain fee is then paid in shares, based on their quoted {symbol} value.</p>
      <p>{usdc ? "USDC principal and interest stay in USDC. Claimed WLD rewards are held separately and paid to you on withdrawal, or to the same heir at inheritance. USDC gains after USDC loss recovery and WLD rewards are charged 10% separately; they are not converted or offset across currencies. WLD gifts are not charged." : "Available WLD campaign rewards can be claimed and reinvested."} Rewards and rates vary. This contract does not automatically qualify for World App’s verified-human boost. Each vault has its own heir and countdown.</p>
      <a href="/yield-terms.html" target="_blank" rel="noreferrer">Read yield terms ↗</a>
      {terms && <p><a href={`${EXPLORER}/address/${terms.recipient}`} target="_blank" rel="noreferrer">View service fee recipient ↗</a></p>}
      <label className="yield-consent"><input id="yield-consent" type="checkbox" checked={consent} disabled={busy} onChange={e => onConsent(e.target.checked)} /><span>I accept the fee, loss risk and possible receipt-share inheritance.</span></label>
    </div>}
  </div>;
}

export function YieldRewardsCard({ data, error, loading, settled, recipient, received, busy, canClaim, onClaim, onProcess, onRefresh, usdc = false, canWithdraw = false, onWithdraw, held }: {
  data: WldRewards | null; error: string; loading: boolean; settled: boolean; recipient: string;
  received: bigint | null; busy: boolean; canClaim: boolean; onClaim: () => void; onProcess: () => void; onRefresh: () => void;
  usdc?: boolean; canWithdraw?: boolean; onWithdraw?: () => void; held?: bigint | null;
}) {
  return <Card><CardHeader><CardTitle>WLD campaign rewards</CardTitle></CardHeader>
    <CardContent className="grid gap-3">
      {loading && <p role="status">Checking rewards for this vault…</p>}
      {error && <p role="status" className="text-xs text-yellow-800">{error} Your vault withdrawals and inheritance remain available.</p>}
      {data && <dl className="yield-values">
        <div><dt>Ready to claim</dt><dd>{formatYieldAmount(data.claimable)} WLD</dd></div>
        <div><dt>Awaiting reward publication</dt><dd>{formatYieldAmount(data.pending)} WLD</dd></div>
      </dl>}
      {received !== null && <dl className="yield-values"><div><dt>{usdc ? "Claimed WLD held before fee" : "Received WLD awaiting processing"}</dt><dd>{formatYieldAmount(received)} WLD</dd></div></dl>}
      {settled ? <p className="text-xs text-gray-600">Late rewards go to the fixed inheritance recipient after the {usdc ? "10% WLD reward fee. USDC losses are accounted separately." : "net-gain fee, including loss recovery."} Anyone can relay the claim; the caller cannot change its recipient.</p>
        : <p className="text-xs text-gray-600">{usdc ? "Claimed WLD is held separately until withdrawal or inheritance. The fee is 10% of claimed WLD when paid; gifts are excluded. USDC gains and losses are accounted in USDC, without cross-currency offsets." : "Claimed WLD is reinvested without increasing your deposited principal or resetting your timer. Its net gain is included in the exit fee."} Pending rewards cannot be claimed yet.</p>}
      {settled && recipient && <a className="text-blue-600 underline text-xs" href={`${EXPLORER}/address/${recipient}`} target="_blank" rel="noreferrer">View inheritance recipient ↗</a>}
      <p className="text-xs text-gray-600">Eligibility and rewards vary by campaign. World App’s verified-human boost is not automatic for this vault.</p>
      {data && data.claimable > 0n && <Button disabled={busy || loading || Boolean(error) || !canClaim} onClick={onClaim}>
        {settled ? "Claim remaining inheritance rewards" : usdc ? "Claim WLD rewards to vault" : "Claim and reinvest WLD rewards"}
      </Button>}
      {received !== null && received > 0n && (!usdc || settled) && <Button disabled={busy || !canClaim} onClick={onProcess}>
        {settled ? "Receive remaining WLD rewards" : "Reinvest received WLD rewards"}
      </Button>}
      {usdc && canWithdraw && held !== null && held !== undefined && held > 0n && <Button disabled={busy || !canClaim} onClick={onWithdraw}>Withdraw held WLD to my wallet</Button>}
      <Button disabled={busy || loading} onClick={onRefresh}>Refresh rewards</Button>
    </CardContent></Card>;
}

export function YieldPositionCard({ position, holdings, terms, rates, ratesLoading, canExit, busy, onExit, route }: {
  position: YieldPosition | null; holdings: { idle: bigint; shares: bigint } | null;
  terms: YieldTerms | null; canExit: boolean; busy: boolean; onExit: () => void;
  rates: YieldRates | null; ratesLoading: boolean;
  route?: YieldRoute;
}) {
  const symbol = route?.symbol ?? "WLD";
  const fmt = (amount: bigint) => formatYieldAmount(amount, route?.decimals ?? 18);
  return <Card><CardHeader><CardTitle>Morpho yield position</CardTitle></CardHeader>
    <CardContent className="grid gap-3">
      <YieldRateSummary rates={rates} loading={ratesLoading} strategy={route?.strategy} />
      {!position ? <p role="status">Value and cash liquidity are unavailable. Receipt shares can still be moved without a valuation.</p> : <>
        <div className="stat-row"><div className="stat yield-stat"><div className="stat-label">Estimated {symbol} after service fee</div><div className="stat-value">{position.valued ? `${fmt(position.net)} ${symbol}` : "Value unavailable"}</div></div></div>
        <dl className="yield-values">
          <div><dt>Cash liquidity before service fee</dt><dd>{fmt(position.liquid)} {symbol}</dd></div>
          <div><dt>Estimated service fee for full exit</dt><dd>{position.valued ? `${fmt(position.fee)} ${symbol}` : "Quote unavailable"}</dd></div>
        </dl>
        <p className="text-xs text-gray-600">{terms ? `${terms.feeBps / 100}%` : "A fixed share"} of positive net gains is charged when exiting, after the underlying vault’s fees. Loss recovery is not charged. This estimate can change and does not guarantee cash availability.</p>
      </>}
      {holdings ? <dl className="yield-values">
        <div><dt>Receipt shares held</dt><dd>{formatYieldAmount(holdings.shares)}</dd></div>
        <div><dt>Idle {symbol}</dt><dd>{fmt(holdings.idle)} {symbol}</dd></div>
      </dl> : <p role="status">Checking receipt shares and idle {symbol}…</p>}
      {canExit && holdings && holdings.shares > 0n && <Button onClick={onExit} disabled={busy}>Move all receipt shares to my wallet</Button>}
      {canExit && <p className="text-xs text-gray-600">Moving shares works without cash liquidity and pays any positive-gain fee in shares. It does not cancel inheritance or move idle {symbol}{symbol === "USDC" ? " or WLD rewards" : ""}.</p>}
      <a className="text-blue-600 underline text-xs" href={`${EXPLORER}/address/${route?.strategy ?? MORPHO_VAULT_ADDRESS}`} target="_blank" rel="noreferrer">View underlying vault ↗</a>
    </CardContent></Card>;
}

export function IncomePositionCard({ state, symbol, decimals, position, to, account, disabledReason, recipientValid, canCollect, busy, onToChange, onCollect, onUseMyAddress, onRefresh }: {
  state: "loading" | "available" | "unavailable" | "error";
  symbol: "WLD" | "USDC";
  decimals: number;
  position: { gross: bigint; fee: bigint; net: bigint; withdrawableNet: bigint; valued: boolean } | null;
  to: string;
  account: string;
  disabledReason: string;
  recipientValid: boolean;
  canCollect: boolean;
  busy: boolean;
  onToChange: (value: string) => void;
  onCollect: () => void;
  onUseMyAddress: () => void;
  onRefresh: () => void;
}) {
  const { t } = useLocale();
  const fmt = (amount: bigint) => formatYieldAmount(amount, decimals);
  return <Card className="income-card">
    <CardHeader><CardTitle>{t("income.title")}</CardTitle></CardHeader>
    <CardContent className="grid gap-3">
      {state === "loading" && <p role="status">{t("income.loading")}</p>}
      {state === "unavailable" && <p className="text-sm text-gray-600">{t("income.unsupported")}</p>}
      {state === "error" && <div className="grid gap-2"><p role="alert" className="text-sm text-yellow-800">{t("income.error")}</p><Button disabled={busy} onClick={onRefresh}>{t("income.refresh")}</Button></div>}
      {state === "available" && position && <>
        {position.valued ? <>
          <div className="stat-row">
            <div className="stat income-stat">
              <div className="stat-label">{t("income.available")}</div>
              <div className="stat-value">{fmt(position.withdrawableNet)} {symbol}</div>
            </div>
          </div>
          <dl className="yield-values">
            <div><dt>{t("income.gross")}</dt><dd>{fmt(position.gross)} {symbol}</dd></div>
            <div><dt>{t("income.fee")}</dt><dd>{fmt(position.fee)} {symbol}</dd></div>
            <div><dt>{t("income.net")}</dt><dd>{fmt(position.net)} {symbol}</dd></div>
          </dl>
          <p className="income-explainer">{t("income.explainer")}</p>
          <p className="income-destination">{recipientValid
            ? to.toLowerCase() === account.toLowerCase() ? t("income.toWallet") : t("income.toAddress", { address: `${to.slice(0, 6)}…${to.slice(-4)}` })
            : t("income.chooseRecipient")}</p>
          <Button className="income-collect" variant="primary" disabled={busy || !canCollect || position.withdrawableNet <= 0n || !position.valued} onClick={onCollect}>
            {t("income.collect", { amount: fmt(position.withdrawableNet), symbol })}
          </Button>
          {disabledReason && <p className="income-explainer" role="status">{disabledReason}</p>}
          {!disabledReason && position.withdrawableNet <= 0n && <p className="income-explainer" role="status">{position.net > 0n
            ? t("income.withdrawable")
            : t("income.none")}</p>}
          <details className="income-recipient"><summary>{t("income.changeRecipient")}</summary><div>
          <div className="field-row">
            <label className="field-row-label" htmlFor="income-to">{t("income.sendTo")}</label>
            <div className="field-row-controls">
              <Input id="income-to" inputMode="text" autoComplete="off" placeholder="0x…" value={to} onChange={event => onToChange(event.target.value)} />
              <Button onClick={onUseMyAddress}>{t("income.myAddress")}</Button>
            </div>
            {to && !recipientValid && <p role="alert" className="text-xs text-red-700">{t("income.invalidAddress")}</p>}
          </div>
          </div></details>
          <details className="income-recipient"><summary>{t("income.feeDetails")}</summary><div>
            <p className="income-explainer">{t("income.feeDisclosure")}</p>
          </div></details>
        </> : <div className="grid gap-2"><p role="status">{t("income.noValue")}</p><Button disabled={busy} onClick={onRefresh}>{t("income.refresh")}</Button></div>}
      </>}
    </CardContent>
  </Card>;
}
