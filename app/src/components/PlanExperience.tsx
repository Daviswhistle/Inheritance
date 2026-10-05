import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { useLocale } from "../locale-context";
import { EXPLORER } from "../config";
import { formatYieldAmount } from "../yield";
import { groupInheritances, inheritanceStage, type HeirReadiness, type InheritancePosition, type SettingsTarget } from "../inheritance";
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export function HeirPlans({ positions, selectedOwner, loading, incomplete, busy, onOpen, onRefresh, onAction, permission, onEnableNotifications }: {
  positions: readonly InheritancePosition[]; selectedOwner: string; loading: boolean; incomplete: boolean; busy: boolean;
  onOpen: (address: string, assetDetails?: boolean) => void; onRefresh: () => void; onAction: (kind: "file" | "finish", positions: InheritancePosition[]) => void;
  permission: string; onEnableNotifications: () => void;
}) {
  const { t, locale } = useLocale();
  const date = (stamp: bigint | number) => new Date(Number(stamp) * 1000).toLocaleString(locale === "ko" ? "ko-KR" : "en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const groups = groupInheritances(positions);
  return <section className="heir-plans" aria-label={t("journey.heir.title")}>
    {loading && !groups.length && <p role="status">{t("journey.loading")}</p>}
    {groups.map(group => {
      const owner = group[0].owner, name = group[0].ownerName ? `@${group[0].ownerName}` : short(owner);
      const selected = !selectedOwner || owner.toLowerCase() === selectedOwner.toLowerCase();
      const filed = group.filter(p => inheritanceStage(p) === "expired" && p.hasAssets);
      const ready = group.filter(p => inheritanceStage(p) === "ready" && p.hasAssets);
      const completed = group.every(p => p.claimedAt > 0n);
      return <Card key={owner} className="heir-plan-card" data-owner={owner}>
        <CardHeader><span className="eyebrow">{t(completed ? "journey.receipt.title" : "journey.heir.title")}</span>
          <CardTitle>{t("journey.heir.from", { name })}</CardTitle>
          <p className="plan-card-intro">{t(completed ? "journey.heir.completed" : "journey.heir.description")}</p>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="inheritance-assets">
            {group.map(p => {
              const stage = inheritanceStage(p), r = p.receipt;
              return <div className="inheritance-asset" key={p.address} data-vault={p.address}>
                <div><strong>{p.symbol}</strong><span className={`inheritance-state state-${stage}`}>{t(`journey.stage.${stage}`)}</span></div>
                {p.claimedAt > 0n
                  ? r ? <>
                    <p className="inheritance-amount">{formatYieldAmount(r.cash, p.decimals)} {p.symbol} <small>{t("journey.receipt.cash")}</small></p>
                    {r.shares > 0n && <p>{formatYieldAmount(r.shares)} <small>{t("journey.receipt.shares")}</small></p>}
                    {r.rewardsWld > 0n && <p>{formatYieldAmount(r.rewardsWld)} WLD <small>{t("journey.receipt.rewards")}</small></p>}
                    <small>{date(r.timestamp)} · {t(r.finalized ? "journey.receipt.finalized" : "journey.receipt.confirming")}</small>
                    <a className="receipt-link" href={`${EXPLORER}/tx/${r.transactionHash}`} target="_blank" rel="noreferrer">{t("journey.receipt.transaction")}</a>
                    {r.shares > 0n && <p className="text-xs text-gray-600">{t("journey.receipt.sharesExplanation", { symbol: p.symbol })}</p>}
                  </> : <p role="status">{t("journey.receipt.unavailable")}</p>
                  : <>
                    <p className="inheritance-amount">{p.amount === null ? t("home.value.unavailable") : `${formatYieldAmount(p.amount, p.decimals)} ${p.symbol}`}</p>
                    <small>{t("journey.heir.estimate")}</small>
                    {p.additionalWld !== null && p.additionalWld > 0n && <small>{t("journey.heir.additionalWld", { amount: formatYieldAmount(p.additionalWld) })}</small>}
                    <p className="inheritance-next">{stage === "active" ? t("journey.heir.nextActive", { date: date(p.deadline) })
                      : stage === "waiting" ? t("journey.heir.nextWaiting", { date: date(p.challengeEndsAt) })
                        : stage === "expired" ? t(p.hasAssets ? "journey.heir.nextExpired" : "journey.heir.empty")
                          : stage === "ready" ? t(p.hasAssets ? "journey.heir.nextReady" : "journey.heir.empty") : t("journey.heir.cancelled")}</p>
                  </>}
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onOpen(p.address, true)}>{t("journey.action.openAsset", { symbol: p.symbol })}</Button>
              </div>;
            })}
          </div>
          {selected ? <>
            {filed.length > 0 && <Button variant="primary" disabled={busy || loading} onClick={() => onAction("file", filed)}>{t("journey.action.file")}</Button>}
            {filed.length > 1 && <p className="text-xs text-gray-600">{t("journey.action.together", { assets: [...new Set(filed.map(p => p.symbol))].join(" + ") })}</p>}
            {ready.length > 0 && <Button variant="primary" disabled={busy || loading} onClick={() => onAction("finish", ready)}>{t("journey.action.finish")}</Button>}
            {ready.length > 1 && <p className="text-xs text-gray-600">{t("journey.action.together", { assets: [...new Set(ready.map(p => p.symbol))].join(" + ") })}</p>}
            {!completed && <p className="text-xs text-gray-600">{t("journey.heir.ownerControl")}</p>}
            {!completed && permission !== "granted" && <Button variant="outline" disabled={busy} onClick={onEnableNotifications}>{t("home.reminders.enable")}</Button>}
            <details><summary>{t("journey.heir.details")}</summary>
              <ol className="inheritance-steps"><li>{t("journey.heir.stepOne")}</li><li>{t("journey.heir.stepTwo")}</li><li>{t("journey.heir.stepThree")}</li></ol>
              <a href={`${EXPLORER}/address/${owner}`} target="_blank" rel="noreferrer">{t("journey.heir.ownerWallet")}</a>
              {group.map(p => <div key={p.address}><a href={`${EXPLORER}/address/${p.address}`} target="_blank" rel="noreferrer">{p.symbol} · {short(p.address)}</a></div>)}
            </details>
          </> : <Button variant="outline" disabled={busy} onClick={() => onOpen(group[0].address)}>{t("journey.action.open")}</Button>}
        </CardContent>
      </Card>;
    })}
    {incomplete && <p role="status" className="plan-inline-error">{t("journey.incomplete")}</p>}
    {(groups.length > 0 || incomplete) && <Button size="sm" variant="ghost" disabled={busy || loading} onClick={onRefresh}>{t("journey.action.refresh")}</Button>}
  </section>;
}

export function OwnerPlanSettings({ heirLabel, period, onPeriod, heir, onHeir, resolvedHeir, resolving, busy, disabled, onPeriodReview, onHeirReview, onCancel, review, onConfirm, onDismiss, pending, onResume, onCheckIn, inconsistent }: {
  heirLabel: string; period: string; onPeriod: (value: string) => void; heir: string; onHeir: (value: string) => void;
  resolvedHeir: string; resolving: boolean; busy: boolean; disabled: boolean;
  onPeriodReview: () => void; onHeirReview: () => void; onCancel: () => void;
  review: SettingsTarget[] | null; onConfirm: () => void; onDismiss: () => void;
  pending: boolean; onResume: () => void; onCheckIn: () => void; inconsistent: boolean;
}) {
  const { t } = useLocale();
  return <Card className="owner-plan-settings"><CardHeader><CardTitle>{t("journey.owner.settings")}</CardTitle>
    <p className="plan-card-intro">{t("journey.owner.shared")}</p></CardHeader><CardContent className="grid gap-3">
      <dl className="plan-review-list"><div><dt>{t("plan.review.recipient")}</dt><dd>{heirLabel || t("home.settingsDiffer")}</dd></div></dl>
      {inconsistent && <p role="status">{t("journey.owner.inconsistent")}</p>}
      {pending ? <section role="status"><p>{t("journey.owner.pending")}</p><Button disabled={busy} onClick={onResume}>{t("journey.action.resume")}</Button></section> : review ? <section className="plan-review" aria-labelledby="settings-review-title">
        <h3 id="settings-review-title" tabIndex={-1}>{t("journey.owner.review")}</h3>
        <p>{t("journey.owner.reviewApplies", { assets: [...new Set(review.map(r => r.symbol))].join(" + ") })}</p>
        <dl className="plan-review-list">{review.map(r => <div key={r.vault}><dt>{r.symbol}</dt><dd><span className="plan-review-address">{r.nextHeir}</span><span>{t("plan.review.every", { days: Number(r.nextPeriod) / 86400 })}</span></dd></div>)}</dl>
        {review.some(r => r.checkIn) && <p>{t("journey.owner.newDeadline")}</p>}
        {review.some(r => r.nextHeir.toLowerCase() === r.heir.toLowerCase() && r.nextPeriod === r.period) && <p className="text-xs">{t("journey.owner.allIncluded")}</p>}
        <div className="plan-step-actions"><Button variant="primary" disabled={busy} onClick={onConfirm}>{t("journey.action.confirmSettings")}</Button><Button disabled={busy} onClick={onDismiss}>{t("journey.action.edit")}</Button></div>
      </section> : <>
        <div className="field-row"><label htmlFor="period-change">{t("journey.owner.interval")}</label><div className="field-row-controls">
          <Input id="period-change" inputMode="numeric" value={period} disabled={busy} onChange={e => onPeriod(e.target.value)} />
          <Button disabled={busy || disabled || !/^\d+$/.test(period) || Number(period) < 1 || Number(period) > 365} onClick={onPeriodReview}>{t("journey.action.changePeriod")}</Button>
        </div></div>
        <div className="field-row"><label htmlFor="new-heir-input">{t("journey.owner.heir")}</label><Input id="new-heir-input" value={heir} placeholder={t("plan.recipient.placeholder")} disabled={busy} onChange={e => onHeir(e.target.value)} /></div>
        {heir && <p className={resolvedHeir ? "plan-review-address" : "text-xs"}>{resolving ? t("plan.recipient.checking") : resolvedHeir || t("plan.recipient.notFound")}</p>}
        <Button disabled={busy || disabled || !resolvedHeir || resolving} onClick={onHeirReview}>{t("journey.action.changeHeir")}</Button>
        {disabled && <p>{t("journey.owner.checkInFirst")}</p>}
        <Button variant="outline" disabled={busy} onClick={onCheckIn}>{t("home.checkin.direct")}</Button>
        <details><summary>{t("journey.owner.stop")}</summary><p>{t("journey.owner.stopExplanation")}</p>
          <Button variant="danger" disabled={busy || disabled} onClick={onCancel}>{t("journey.action.cancelInheritance")}</Button></details>
      </>}
    </CardContent></Card>;
}

export function InviteHeir({ ready, name, link, busy, readiness, onChat, onLink, onMessage, onRefresh }: {
  ready: boolean; name: string; link: string; busy: boolean; readiness: HeirReadiness | null;
  onChat: () => void; onLink: () => void; onMessage: () => void; onRefresh: () => void;
}) {
  const { t, locale } = useLocale();
  return <Card className={`invite-heir-card ${ready ? "plan-ready-card" : ""}`}><CardHeader>
    <span className="eyebrow">{t(ready ? "journey.invite.ready" : "journey.invite.eyebrow")}</span>
    <CardTitle>{t("journey.invite.title")}</CardTitle><p className="plan-card-intro">{t("journey.invite.description")}</p>
  </CardHeader><CardContent className="grid gap-2">
    {name && <Button variant="primary" disabled={busy} onClick={onChat}>{t("journey.invite.chat")}</Button>}
    <div className="plan-step-actions"><Button disabled={busy} onClick={onLink}>{t("journey.invite.copyLink")}</Button><Button variant="ghost" disabled={busy} onClick={onMessage}>{t("journey.invite.copyMessage")}</Button></div>
    <details><summary>{t("journey.invite.link")}</summary><p className="plan-review-address">{link}</p></details>
    <div className="heir-readiness" role="status"><strong>{t("journey.invite.readiness")}</strong>
      <p>{!readiness ? t("journey.invite.notOpened") : t("journey.invite.opened", { date: new Date(readiness.openedAt).toLocaleDateString(locale === "ko" ? "ko-KR" : "en-US") })}</p>
      {readiness && <p>{t(readiness.notificationPermission === "granted" ? "journey.invite.notificationsOn" : readiness.notificationPermission === "denied" ? "journey.invite.notificationsOff" : "journey.invite.notificationsUnknown")}</p>}
      <small>{t("journey.invite.lastObserved")}</small><Button size="sm" variant="ghost" disabled={busy} onClick={onRefresh}>{t("journey.action.refresh")}</Button>
    </div>
  </CardContent></Card>;
}
