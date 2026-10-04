import { useMemo } from "react";
import { EXPLORER } from "@/config";
import { formatExactTokenAmount, groupIncomeReceiptsByMonth, mergeBlockRanges } from "@/income-history";
import type { BlockRange, IncomeReceipt } from "@/income-history";
import { useLocale } from "@/locale-context";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";

export type IncomeHistoryView = {
  scope: string;
  status: "loading" | "ready" | "unsupported" | "finality-unavailable" | "error";
  startBlock: number;
  finalizedBlock: number | null;
  finalizedTimestamp: number | null;
  finalizedHash: string | null;
  coverage: BlockRange[];
  failed: BlockRange[];
  entries: IncomeReceipt[];
  nextBeforeBlock: number | null;
  loadingOlder: boolean;
  error: string;
};

export function IncomeHistoryCard({ data, symbol, decimals, onRefresh, onLoadOlder, busy = false }: {
  data: IncomeHistoryView | null;
  symbol: "WLD" | "USDC";
  decimals: number;
  onRefresh: () => void;
  onLoadOlder: () => void;
  busy?: boolean;
}) {
  const { locale, t } = useLocale();
  const history = data;
  const coverage = useMemo(() => mergeBlockRanges(history?.coverage ?? []), [history?.coverage]);
  const failed = useMemo(() => mergeBlockRanges(history?.failed ?? []), [history?.failed]);
  const complete = Boolean(history && history.status === "ready" && history.finalizedBlock !== null
    && coverage.length === 1 && coverage[0].fromBlock <= history.startBlock
    && coverage[0].toBlock >= history.finalizedBlock);
  const groups = useMemo(() => history?.finalizedTimestamp !== null && history?.finalizedTimestamp !== undefined
    ? groupIncomeReceiptsByMonth(history.entries, complete, history.finalizedTimestamp) : [],
  [history?.entries, history?.finalizedTimestamp, complete]);
  const displayLocale = locale === "ko" ? "ko-KR" : "en-US";
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(displayLocale, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  }), [displayLocale]);
  const monthFormat = useMemo(() => new Intl.DateTimeFormat(displayLocale, {
    year: "numeric", month: "long", timeZone: "UTC",
  }), [displayLocale]);
  const format = (amount: bigint) => `${formatExactTokenAmount(amount, decimals)} ${symbol}`;
  const monthDate = (month: string) => new Date(`${month}-01T00:00:00Z`);
  const coverageLabel = coverage.length
    ? coverage.map(range => `${range.fromBlock.toLocaleString(displayLocale)}–${range.toBlock.toLocaleString(displayLocale)}`).join(", ")
    : "—";
  const failedLabel = failed.map(range => `${range.fromBlock.toLocaleString(displayLocale)}–${range.toBlock.toLocaleString(displayLocale)}`).join(", ");

  return <Card className="income-history-card">
    <CardHeader><CardTitle>{t("history.title")}</CardTitle></CardHeader>
    <CardContent className="grid gap-3">
      <details className="income-history-disclosure">
        <summary>{t("history.disclosure")}</summary>
        <div className="income-history-content">
          {history?.status === "unsupported" ? <p role="status">{t("history.unsupported")}</p>
            : history?.status === "finality-unavailable" ? <div className="grid gap-2">
              <p role="status">{t("history.finalityUnavailable")}</p>
              <Button size="sm" disabled={busy} onClick={onRefresh}>{t("history.refresh")}</Button>
            </div>
              : history?.status === "loading" ? <p role="status">{t("history.loading")}</p>
                : history?.status === "error" ? <div className="grid gap-2">
                  <p role="alert">{t("history.retryError")}</p>
                  <Button size="sm" disabled={busy} onClick={onRefresh}>{t("history.refresh")}</Button>
                </div>
                  : history && <>
                    {history.status === "ready" && history.finalizedBlock !== null && <p className="income-history-coverage" role="status">
                      {complete
                        ? t("history.complete", { from: history.startBlock.toLocaleString(displayLocale), to: history.finalizedBlock.toLocaleString(displayLocale) })
                        : t("history.coverage", {
                          coverage: coverageLabel,
                          start: history.startBlock.toLocaleString(displayLocale),
                          finalized: history.finalizedBlock.toLocaleString(displayLocale),
                        })}
                    </p>}
                    {!complete && history.status === "ready" && <p className="income-history-partial" role="status">{t("history.partial")}</p>}
                    {failed.length > 0 && <p className="income-history-partial" role="alert">{t("history.gaps", { ranges: failedLabel })}</p>}
                    {history.error && <p className="income-history-partial" role="status">{t("history.unable")}</p>}
                    {history.entries.length === 0 && <p role="status">{complete ? t("history.emptyComplete") : t("history.emptyPartial")}</p>}
                    {groups.map(group => <section className="income-history-month" key={group.month} aria-label={monthFormat.format(monthDate(group.month))}>
                      <h3>{monthFormat.format(monthDate(group.month))} <span>{t("history.utc")}</span></h3>
                      {!complete && <p className="income-history-month-note">{t("history.monthPartial")}</p>}
                      {group.inProgress && <p className="income-history-month-note">{t("history.monthCurrent")}</p>}
                      {group.completeTotal && <dl className="income-history-total">
                        <dt>{t("history.monthTotal")}</dt>
                        <dd>{t("history.gross")}: {format(group.completeTotal.gross)} · {t("history.fee")}: {format(group.completeTotal.fee)} · {t("history.net")}: {format(group.completeTotal.net)}</dd>
                      </dl>}
                      <ol className="income-history-list">
                        {group.entries.map((entry: IncomeReceipt) => <li key={entry.key}>
                          <time dateTime={new Date(entry.timestamp * 1000).toISOString()}>{dateFormat.format(entry.timestamp * 1000)} {t("history.utc")}</time>
                          <dl>
                            <div><dt>{t("history.gross")}</dt><dd>{format(entry.gross)}</dd></div>
                            <div><dt>{t("history.fee")}</dt><dd>{format(entry.fee)}</dd></div>
                            <div><dt>{t("history.net")}</dt><dd>{format(entry.net)}</dd></div>
                            <div className="income-history-recipient"><dt>{t("history.recipient")}</dt><dd><a href={`${EXPLORER}/address/${entry.recipient}`} target="_blank" rel="noreferrer">{entry.recipient}</a></dd></div>
                          </dl>
                          <a className="income-history-transaction" href={`${EXPLORER}/tx/${entry.transactionHash}`} target="_blank" rel="noreferrer">
                            {t("history.tx")}: {entry.transactionHash.slice(0, 10)}…{entry.transactionHash.slice(-8)} ↗
                          </a>
                        </li>)}
                      </ol>
                    </section>)}
                    {history.status === "ready" && <div className="income-history-actions">
                      {failed.length > 0 && <Button size="sm" disabled={busy || history.loadingOlder} onClick={onLoadOlder}>
                        {history.loadingOlder ? t("history.loadingOlder") : t("history.retryMissing")}
                      </Button>}
                      {failed.length === 0 && history.nextBeforeBlock !== null && history.nextBeforeBlock >= history.startBlock && <Button size="sm" disabled={busy || history.loadingOlder} onClick={onLoadOlder}>
                        {history.loadingOlder ? t("history.loadingOlder") : t("history.loadOlder")}
                      </Button>}
                      <Button size="sm" variant="ghost" disabled={busy || history.loadingOlder} onClick={onRefresh}>{t("history.refresh")}</Button>
                    </div>}
                  </>}
          {!history && <div className="grid gap-2"><p role="status">{t("history.loading")}</p><Button size="sm" disabled={busy} onClick={onRefresh}>{t("history.refresh")}</Button></div>}
        </div>
      </details>
    </CardContent>
  </Card>;
}
