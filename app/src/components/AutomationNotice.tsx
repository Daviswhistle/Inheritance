import { useEffect, useState } from "react";
import { NOTIFY_BACKEND_URL } from "@/config";
import { Icon } from "./Icon";
import { Button } from "./ui/button";

type Health = { enabled?: boolean; supported?: boolean; funded?: boolean; halted?: boolean; reason?: string };

export function AutomationNotice({ legacy, registered, canEnable, busy, onEnable }: {
  legacy: boolean; registered: boolean; canEnable: boolean; busy: boolean; onEnable: () => void;
}) {
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
  const ready = health?.enabled && health.supported && health.funded && !health.halted && ["ready", "pending"].includes(health.reason || "");
  return <div className={`automation-note ${ready && registered ? "automation-ready" : ""}`} role="status">
    <Icon name={legacy ? "help" : "check"} size={18} />
    <div><strong>{legacy ? "This earlier vault needs manual completion" : "After the seven-day review"}</strong>
      <p>{legacy ? "The heir completes the transfer in World App. The owner can renew until that transfer executes."
        : !registered ? "Enable monitoring so this vault can transfer automatically after the heir’s claim and review window."
        : health === null ? "Checking the automatic transfer service…"
        : ready ? "Automatic transfer is enabled. If the owner does not renew, the service sends the eligible balance to the named heir."
        : "Automatic transfer is currently unavailable. The heir can still complete an eligible transfer in World App."}</p>
      {!legacy && <p className="automation-footnote">Network or service delays can change the execution time. The owner can renew until the transfer executes.</p>}
      {!registered && canEnable && <Button size="sm" onClick={onEnable} disabled={busy}>{busy ? "Enabling…" : "Enable vault monitoring"}</Button>}
    </div>
  </div>;
}
