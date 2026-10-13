import { useLocale } from "../locale-context";

export function TransferGuide() {
  const { t } = useLocale();
  return <div className="transfer-guide">
    <ol>
      <li><strong>{t("guide.control.title")}</strong><p>{t("guide.control.body")}</p></li>
      <li><strong>{t("guide.claim.title")}</strong><p>{t("guide.claim.body")}</p></li>
      <li><strong>{t("guide.review.title")}</strong><p>{t("guide.review.body")}</p></li>
    </ol>
    <p className="transfer-guide-note">{t("guide.note")}</p>
  </div>;
}
