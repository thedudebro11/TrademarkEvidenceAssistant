import { useRouter } from "./router.js";
import { HomePage } from "../pages/HomePage.js";
import { ReviewPage } from "../pages/ReviewPage.js";
import { PreparePackagePage } from "../pages/PreparePackagePage.js";
import { SettingsPage } from "../pages/SettingsPage.js";

/** Maps the 4 required routes to their page component. No routes for unimplemented features. */
export function RouteOutlet() {
  const { path } = useRouter();

  switch (path) {
    case "/review":
      return <ReviewPage />;
    case "/prepare":
      return <PreparePackagePage />;
    case "/settings":
      return <SettingsPage />;
    case "/":
    default:
      return <HomePage />;
  }
}

export function pageTitleForPath(path: string): string | undefined {
  switch (path) {
    case "/review":
      return "Review";
    case "/prepare":
      return "Prepare Package";
    case "/settings":
      return "Settings";
    default:
      return undefined;
  }
}
