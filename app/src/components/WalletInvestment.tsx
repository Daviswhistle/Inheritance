import { useEffect, useState } from "react";
import { Contract, type Provider } from "ethers";
import type { YieldRoute } from "@/assets";
import { MORPHO_ABI, formatYieldAmount, minimumOutput } from "@/yield";
import { useLocale } from "@/locale-context";
import { Button } from "./ui/button";

type Quote = { total: bigint; available: bigint; shares: bigint; held: bigint };

/** Wallet-held investments are separate from the inheritance contract's funds. */
export function WalletInvestment({ route, provider, account, held, busy, onRedeem }: {
  route: YieldRoute; provider: Provider | null; account: string; held: bigint;
  busy: boolean; onRedeem: (shares: bigint, minimum: bigint) => Promise<void>;
}) {
  const { t } = useLocale();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [failed, setFailed] = useState(false);
  const [review, setReview] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let current = true;
    setQuote(null); setFailed(false); setReview(false);
    if (!provider) { setFailed(true); return; }
    const deadline = window.setTimeout(() => { if (current) { setFailed(true); current = false; } }, 15000);
    const read = async () => {
      const token = new Contract(route.strategy, MORPHO_ABI, provider);
      const [balance, maximum, cash]: bigint[] = await Promise.all([
        token.balanceOf(account), token.maxRedeem(account), token.maxWithdraw(account),
      ]);
      const total: bigint = await token.previewRedeem(balance);
      const shares = total > 0n && total <= cash ? balance : balance < maximum ? balance : maximum;
      const available: bigint = shares > 0n ? await token.previewRedeem(shares) : 0n;
      if (current) { window.clearTimeout(deadline); setQuote({ total, available, shares, held: balance }); }
    };
    void read().catch(() => { window.clearTimeout(deadline); if (current) setFailed(true); });
    return () => { current = false; window.clearTimeout(deadline); };
  }, [provider, account, route.strategy, held, refresh]);
  const fmt = (value: bigint) => `${formatYieldAmount(value, route.decimals)} ${route.symbol}`;
  return <details className="wallet-investment">
    <summary>{t("walletShares.title", { symbol: route.symbol })}<span>{t("walletShares.outside")}</span></summary>
    <div className="wallet-investment-content">
      <p>{t("walletShares.body", { symbol: route.symbol })}</p>
      {!quote && <p role="status">{t(failed ? "walletShares.failed" : "walletShares.checking")}</p>}
      {quote && <>
        <dl className="yield-values">
          <div><dt>{t("walletShares.value")}</dt><dd>{fmt(quote.total)}</dd></div>
          <div><dt>{t("walletShares.available")}</dt><dd>{fmt(quote.available)}</dd></div>
        </dl>
        {quote.available <= 0n ? <p>{t("walletShares.noCash", { symbol: route.symbol })}</p> : review ? <section className="wallet-investment-review" aria-label={t("walletShares.review", { symbol: route.symbol })}>
          <h3>{t("walletShares.review", { symbol: route.symbol })}</h3><strong>{fmt(quote.available)}</strong>
          <p>{t("walletShares.fees")}</p>
          {quote.shares < quote.held && <p>{t("walletShares.partial")}</p>}
          <Button variant="primary" disabled={busy} onClick={async () => { await onRedeem(quote.shares, minimumOutput(quote.available)); setReview(false); setRefresh(value => value + 1); }}>{t("plan.action.confirm")}</Button>
          <Button disabled={busy} onClick={() => setReview(false)}>{t("common.cancel")}</Button>
        </section> : <Button disabled={busy} onClick={() => setReview(true)}>{t("walletShares.redeem", { symbol: route.symbol })}</Button>}
      </>}
      <details><summary>{t("walletShares.details")}</summary><p>{t("walletShares.units")}: {formatYieldAmount(held)}</p><p>Re7 {route.symbol} · Morpho</p></details>
      <Button disabled={busy} variant="ghost" onClick={() => setRefresh(value => value + 1)}>{t("walletShares.refresh")}</Button>
    </div>
  </details>;
}
