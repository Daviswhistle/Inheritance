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
  const { t, locale } = useLocale();
  const now = Math.floor(Date.now() / 1000);
  const fresh = rates && now - rates.reportedAt <= RATE_MAX_AGE_SECONDS && rates.campaignEndsAt > now;
  const date = (stamp: number) => new Date(stamp * 1000).toLocaleDateString(locale === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return <div className="yield-rate-summary"><strong>{t("yield.rates.title")}</strong>
    {fresh ? <><dl className="yield-values"><div><dt>{t("yield.rates.lending")}</dt><dd>{formatRate(rates.lendingApr)}</dd></div>
      <div><dt>{t("yield.rates.rewards")}</dt><dd>{formatRate(rates.rewardApr)}</dd></div></dl>
      <p className="text-xs text-gray-600">{t("yield.rates.reported", { date: date(rates.reportedAt), end: date(rates.campaignEndsAt) })}</p>
    </> : <p role="status">{t(loading ? "yield.rates.loading" : "yield.rates.unavailable")}</p>}
    <p className="text-xs text-gray-600">{t("yield.rates.disclosure")}</p>
    <a className="text-blue-600 underline text-xs" href={`https://app.merkl.xyz/opportunities/world-chain/MORPHOVAULT/${strategy}`} target="_blank" rel="noreferrer">{t("yield.rates.source")}</a>
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
  const { t } = useLocale();
  return <Card><CardHeader><CardTitle>{t("yield.rewards.title")}</CardTitle></CardHeader><CardContent className="grid gap-3">
    {loading && <p role="status">{t("yield.rewards.loading")}</p>}
    {error && <p role="status" className="text-xs text-yellow-800">{error} {t("yield.rewards.error")}</p>}
    {data && <dl className="yield-values"><div><dt>{t("yield.rewards.ready")}</dt><dd>{formatYieldAmount(data.claimable)} WLD</dd></div><div><dt>{t("yield.rewards.pending")}</dt><dd>{formatYieldAmount(data.pending)} WLD</dd></div></dl>}
    {received !== null && <dl className="yield-values"><div><dt>{t(usdc ? "yield.rewards.held" : "yield.rewards.received")}</dt><dd>{formatYieldAmount(received)} WLD</dd></div></dl>}
    <p className="text-xs text-gray-600">{t(settled ? usdc ? "yield.rewards.lateUsdc" : "yield.rewards.lateWld" : usdc ? "yield.rewards.activeUsdc" : "yield.rewards.activeWld")}</p>
    {settled && recipient && <a className="text-blue-600 underline text-xs" href={`${EXPLORER}/address/${recipient}`} target="_blank" rel="noreferrer">{t("yield.rewards.recipient")}</a>}
    <p className="text-xs text-gray-600">{t("yield.rewards.eligibility")}</p>
    {data && data.claimable > 0n && <Button disabled={busy || loading || Boolean(error) || !canClaim} onClick={onClaim}>{t(settled ? "yield.rewards.claimLate" : usdc ? "yield.rewards.claimUsdc" : "yield.rewards.claimWld")}</Button>}
    {received !== null && received > 0n && (!usdc || settled) && <Button disabled={busy || !canClaim} onClick={onProcess}>{t(settled ? "yield.rewards.receiveLate" : "yield.rewards.reinvest")}</Button>}
    {usdc && canWithdraw && held !== null && held !== undefined && held > 0n && <Button disabled={busy || !canClaim} onClick={onWithdraw}>{t("yield.rewards.withdraw")}</Button>}
    <Button disabled={busy || loading} onClick={onRefresh}>{t("yield.rewards.refresh")}</Button>
  </CardContent></Card>;
}

export function YieldPositionCard({ position, holdings, terms, rates, ratesLoading, canExit, busy, onExit, route }: {
  position: YieldPosition | null; holdings: { idle: bigint; shares: bigint } | null;
  terms: YieldTerms | null; canExit: boolean; busy: boolean; onExit: () => void;
  rates: YieldRates | null; ratesLoading: boolean;
  route?: YieldRoute;
}) {
  const { t } = useLocale();
  const symbol = route?.symbol ?? "WLD";
  const fmt = (amount: bigint) => formatYieldAmount(amount, route?.decimals ?? 18);
  return <Card><CardHeader><CardTitle>{t("yield.position.title")}</CardTitle></CardHeader><CardContent className="grid gap-3">
    <YieldRateSummary rates={rates} loading={ratesLoading} strategy={route?.strategy} />
    {!position ? <p role="status">{t("yield.position.unavailable")}</p> : <>
      <div className="stat-row"><div className="stat yield-stat"><div className="stat-label">{t("yield.position.net", { symbol })}</div><div className="stat-value">{position.valued ? `${fmt(position.net)} ${symbol}` : t("home.value.unavailable")}</div></div></div>
      <dl className="yield-values"><div><dt>{t("yield.position.liquid")}</dt><dd>{fmt(position.liquid)} {symbol}</dd></div>
        <div><dt>{t("yield.position.fee")}</dt><dd>{position.valued ? `${fmt(position.fee)} ${symbol}` : t("home.value.unavailable")}</dd></div></dl>
      <p className="text-xs text-gray-600">{t("yield.position.disclosure", { percent: terms ? terms.feeBps / 100 : 10 })}</p>
    </>}
    {holdings ? <dl className="yield-values"><div><dt>{t("yield.position.shares")}</dt><dd>{formatYieldAmount(holdings.shares)}</dd></div>
      <div><dt>{t("yield.position.idle", { symbol })}</dt><dd>{fmt(holdings.idle)} {symbol}</dd></div></dl> : <p role="status">{t("yield.position.loading", { symbol })}</p>}
    {canExit && holdings && holdings.shares > 0n && <Button onClick={onExit} disabled={busy}>{t("yield.position.move")}</Button>}
    {canExit && <p className="text-xs text-gray-600">{t("yield.position.moveBody", { symbol })} {symbol === "USDC" && t("yield.position.usdcRewards")}</p>}
    <a className="text-blue-600 underline text-xs" href={`${EXPLORER}/address/${route?.strategy ?? MORPHO_VAULT_ADDRESS}`} target="_blank" rel="noreferrer">{t("yield.position.source")}</a>
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
