import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { useLocale } from "@/locale-context";

export function ReleasePlanDialog({ busy, disabled, symbol, message, onClose, onConfirm }: {
  busy: boolean;
  disabled: boolean;
  symbol: string;
  message: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [accepted, setAccepted] = useState(false);

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    const opener = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Native modality makes the rest of the page inert and contains keyboard focus.
    dialog.showModal();
    dialog.querySelector<HTMLElement>("h2")?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      const target = opener instanceof HTMLElement && opener.isConnected && !opener.matches(":disabled")
        ? opener : document.querySelector<HTMLElement>("main h1");
      target?.focus({ preventScroll: true });
    };
  }, []);

  return <dialog ref={dialogRef} className="release-dialog" aria-labelledby="release-modal-title"
    aria-describedby="release-modal-desc" onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = event.currentTarget.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)");
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement?.id === "release-modal-title")) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    }}>
    <h2 id="release-modal-title" tabIndex={-1}>{t("assets.releaseTitle", { symbol })}</h2>
    <p id="release-modal-desc">{t("assets.releaseBody")}</p>
    <label className="release-consent">
      <input type="checkbox" className="release-ack" checked={accepted} onChange={event => setAccepted(event.target.checked)} />
      <span>{t("assets.releaseConsent")}</span>
    </label>
    {message && <p className="release-message" role="status">{message}</p>}
    <div className="release-actions">
      <Button onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
      <Button variant="primary" onClick={onConfirm} disabled={busy || disabled || !accepted}>{t("assets.releaseConfirm", { symbol })}</Button>
    </div>
  </dialog>;
}
