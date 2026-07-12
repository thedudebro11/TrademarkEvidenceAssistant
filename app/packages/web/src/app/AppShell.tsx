import { Sidebar } from "../components/layout/Sidebar.js";
import { TopBar } from "../components/layout/TopBar.js";
import { RouteOutlet, pageTitleForPath } from "./routes.js";
import { useRouter } from "./router.js";
import { useAppState } from "./AppStateContext.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { StatusMessage } from "../components/ui/StatusMessage.js";

/**
 * Owns sidebar, top bar, content outlet, and the global error boundary.
 * Never owns review/scan/export/binder business logic —
 * docs/ui/UI_COMPONENT_ARCHITECTURE.md "Application shell".
 */
export function AppShell() {
  const { path } = useRouter();
  const { healthError } = useAppState();

  return (
    <div className="app-shell">
      <Sidebar />
      <div>
        <TopBar pageTitle={pageTitleForPath(path)} />
        <main className="app-shell__content">
          {healthError && (
            <div style={{ marginBottom: 20 }}>
              <StatusMessage tone="error">Backend unreachable: {healthError}</StatusMessage>
            </div>
          )}
          <ErrorBoundary>
            <RouteOutlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
