import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useLocale } from "@/locale-context";
import { Button } from "./ui/button";

export function MoneyReview({ title, busy, children, onClose, onConfirm }: {
  title: string; busy: boolean; children: ReactNode; onClose: () => void; onConfirm: () => void;
}) {
  const { t } = useLocale();
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    dialog.querySelector<HTMLElement>("h2")?.focus();
    return () => {
      dialog.close(); document.body.style.overflow = oldOverflow;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={ref} className="release-dialog money-review" aria-labelledby="money-review-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id="money-review-title" tabIndex={-1}>{title}</h2>
    {children}
    <p>{t("fees.network.brief")}</p>
    <div className="release-actions">
      <Button disabled={busy} onClick={onClose}>{t("common.cancel")}</Button>
      <Button variant="primary" disabled={busy} onClick={onConfirm}>{t("plan.action.confirm")}</Button>
    </div>
  </dialog>;
}
