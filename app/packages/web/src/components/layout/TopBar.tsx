import { GlassPanel } from "../ui/GlassPanel.js";
import { useAppState } from "../../app/AppStateContext.js";

interface TopBarProps {
  pageTitle?: string;
}

/** Workspace name + compact status indicator. No search/notifications until real capabilities exist. */
export function TopBar({ pageTitle }: TopBarProps) {
  const { health, healthError } = useAppState();
  const ok = !!health && health.status === "ok" && !healthError;

  return (
    <GlassPanel as="header" className="topbar" variant="subtle">
      <div className="topbar__workspace">
        <span
          className={`topbar__status-dot topbar__status-dot--${ok ? "ok" : "error"}`}
          role="status"
          aria-label={ok ? "System status: connected" : "System status: unreachable"}
        />
        {health?.workspace.name ?? "Workspace"}
      </div>
      {pageTitle && <div className="topbar__title">{pageTitle}</div>}
    </GlassPanel>
  );
}
