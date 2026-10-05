import { useEffect, useState } from "react";
import { NOTIFY_BACKEND_URL } from "@/config";
import { Icon } from "./Icon";
import { Button } from "./ui/button";
import { useLocale } from "@/locale-context";

type Health = { enabled?: boolean; supported?: boolean; funded?: boolean; halted?: boolean; reason?: string; factoryAddresses?: string[] };

export function AutomationNotice({ legacy, registered, canEnable, busy, onEnable, factoryAddress }: {
  legacy: boolean; registered: boolean; canEnable: boolean; busy: boolean; onEnable: () => void; factoryAddress?: string;
}) {
  const { t } = useLocale();
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    if (legacy || !NOTIFY_BACKEND_URL) return;
    let active = true;
    const controller = new AbortController();
    const check = async () => {
      try {
        const response = await fetch(`${NOTIFY_BACKEND_URL}/api/automation/health`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (active) setHealth(response.ok ? data.automation ?? {} : {});
      } catch { if (active) setHealth({}); }
    };
    void check();
    const timer = setInterval(() => void check(), 60_000);
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, [legacy]);
  const ready = health?.enabled && health.supported && health.funded && !health.halted && ["ready", "pending"].includes(health.reason || "") &&
    (!factoryAddress || health.factoryAddresses?.some(address => address.toLowerCase() === factoryAddress.toLowerCase()));
  return <div className={`automation-note ${ready && registered ? "automation-ready" : ""}`} role="status">
    <Icon name={legacy ? "help" : "check"} size={18} />
    <div><strong>{t(legacy ? "automation.legacyTitle" : "automation.title")}</strong>
      <p>{t(legacy ? "automation.legacy" : !registered ? "automation.enableNote"
        : health === null ? "automation.checking" : ready ? "automation.ready" : "automation.unavailable")}</p>
      {!legacy && <p className="automation-footnote">{t("automation.delay")}</p>}
      {!registered && canEnable && <Button size="sm" onClick={onEnable} disabled={busy}>{t(busy ? "automation.enabling" : "automation.enable")}</Button>}
    </div>
  </div>;
}
