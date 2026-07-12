import { RouterProvider } from "./app/router.js";
import { AppStateProvider } from "./app/AppStateContext.js";
import { AppShell } from "./app/AppShell.js";

export function App() {
  return (
    <RouterProvider>
      <AppStateProvider>
        <AppShell />
      </AppStateProvider>
    </RouterProvider>
  );
}
